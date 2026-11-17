from decimal import Decimal
from flask import Blueprint, g, jsonify, request
from sqlalchemy import and_, func, or_
from .auth import login_required_roles
from .extensions import db
from .models import (AuditLog, Dispatch, DispatchItem, Expense, ExpenseCategory, ExpensePayment,
                     Notification, Product)
from .services import accounts, opening, shop as shop_svc, workflow
from .services.errors import ServiceError
from .services.inventory import balance

bp = Blueprint("api", __name__, url_prefix="/api")


@bp.errorhandler(ServiceError)
def handle_service_error(e):
    body = {"error": e.message}
    body.update(e.extra)
    return jsonify(body), e.status


def _result(obj, created, warnings, serializer):
    # 201 = new record, 200 = idempotent replay of an already-synced offline record
    return jsonify(record=serializer(obj), created=created, warnings=warnings), (201 if created else 200)


def _ser_prod(p):
    return {"id": p.id, "session": p.session, "date": p.production_date.isoformat(),
            "quantity_litres": str(p.quantity_litres)}


def _ser_dispatch(d):
    it = d.items[0]
    amount_paid = d.amount_paid or Decimal("0.00")
    total = it.line_total or Decimal("0.00")
    return {"id": d.id, "reference": d.reference, "type": d.dispatch_type,
            "destination": d.destination_name or d.destination_shop_id,
            "dispatched_at": _iso(d.dispatched_at),
            "quantity_litres": str(it.quantity_litres),
            "revenue": None if it.line_total is None else str(it.line_total),
            "status": d.status if hasattr(d, "status") else None,
            "payment_status": d.payment_status,
            "amount_paid": str(amount_paid),
            "remaining_balance": str(max(total - amount_paid, Decimal("0.00"))),
            "non_sale_reason": d.non_sale_reason}


def _ser_receipt(r):
    return {"id": r.id, "dispatch_id": r.dispatch_id, "quantity_litres": str(r.items[0].quantity_litres)}


@bp.post("/production")
@login_required_roles("MILKER")
def production():
    return _result(*workflow.record_production(g.business_id, g.user_id, request.get_json(silent=True) or {}), _ser_prod)


@bp.post("/dispatches")
@login_required_roles("MILKER")
def dispatches():
    return _result(*workflow.record_dispatch(g.business_id, g.user_id, request.get_json(silent=True) or {}), _ser_dispatch)


@bp.post("/direct-sales")
@login_required_roles()
def direct_sales():
    data = request.get_json(silent=True) or {}
    data["destination_type"] = "EXTERNAL"
    data["dispatch_type"] = "SALE"
    return _result(*workflow.record_dispatch(g.business_id, g.user_id, data, owner_direct=True), _ser_dispatch)


@bp.get("/direct-sales")
@login_required_roles()
def direct_sales_list():
    rows = (db.session.query(Dispatch, User.full_name)
            .join(User, User.id == Dispatch.recorded_by)
            .filter(Dispatch.business_id == g.business_id, Dispatch.destination_type == "EXTERNAL",
                    Dispatch.dispatch_type == "SALE")
            .order_by(Dispatch.dispatched_at.desc(), Dispatch.id.desc()).limit(200).all())
    return jsonify(items=[{"id": d.id, "reference": d.reference, "buyer": d.destination_name,
                           "sold_at": _iso(d.dispatched_at), "quantity_litres": str(d.items[0].quantity_litres),
                           "price_per_litre": None if d.price_per_litre is None else str(d.price_per_litre),
                           "total": None if d.items[0].line_total is None else str(d.items[0].line_total),
                           "payment_status": d.payment_status or "UNKNOWN",
                           "amount_paid": str(d.amount_paid or Decimal("0.00")),
                           "remaining_balance": str(max((d.items[0].line_total or Decimal("0.00")) -
                                                        (d.amount_paid or Decimal("0.00")), Decimal("0.00"))),
                           "recorded_by": who} for d, who in rows])


@bp.post("/direct-sales/<int:did>/payment")
@login_required_roles()
def direct_sale_payment(did):
    d = workflow.update_direct_sale_payment(g.business_id, g.user_id, did,
                                            request.get_json(silent=True) or {})
    total = d.items[0].line_total or Decimal("0.00")
    amount_paid = d.amount_paid or Decimal("0.00")
    return jsonify(record={"id": d.id, "payment_status": d.payment_status,
                           "amount_paid": str(amount_paid),
                           "remaining_balance": str(max(total - amount_paid, Decimal("0.00")))})


@bp.post("/farm-withdrawals")
@login_required_roles()
def farm_withdrawals():
    data = request.get_json(silent=True) or {}
    data.update(destination_type="EXTERNAL", destination_name="Owner personal use",
                dispatch_type="NON_SALE", non_sale_reason="Owner personal use")
    return _result(*workflow.record_dispatch(g.business_id, g.user_id, data), _ser_dispatch)


@bp.get("/farm-withdrawals")
@login_required_roles()
def farm_withdrawals_list():
    rows = (Dispatch.query.filter_by(business_id=g.business_id, destination_type="EXTERNAL",
                                     dispatch_type="NON_SALE", non_sale_reason="Owner personal use")
            .order_by(Dispatch.dispatched_at.desc(), Dispatch.id.desc()).limit(200).all())
    return jsonify(items=[{"id": d.id, "reference": d.reference, "taken_at": _iso(d.dispatched_at),
                           "quantity_litres": str(d.items[0].quantity_litres), "notes": d.notes}
                          for d in rows])


@bp.post("/receipts")
@login_required_roles("SHOP_ATTENDANT")
def receipts():
    return _result(*workflow.record_receipt(g.business_id, g.user_id, request.get_json(silent=True) or {}), _ser_receipt)


@bp.get("/dispatches/discrepancies")
@login_required_roles()  # OWNER only (no other role listed)
def discrepancies():
    return jsonify(items=workflow.dispatch_discrepancies(g.business_id))


@bp.get("/stock")
@login_required_roles("MILKER", "SHOP_ATTENDANT")
def stock():
    farm_id, shop_id = request.args.get("farm_id", type=int), request.args.get("shop_id", type=int)
    if bool(farm_id) == bool(shop_id):
        return jsonify(error="Provide exactly one of farm_id or shop_id"), 400
    out = []
    transit = _in_transit(g.business_id)
    products = Product.query.filter_by(business_id=g.business_id)
    if farm_id:
        products = products.filter_by(product_type="FRESH_MILK")
    for p in products.all():
        row = {"product": p.name, "type": p.product_type,
               "balance_litres": str(balance(business_id=g.business_id, product_id=p.id,
                                             farm_id=farm_id, shop_id=shop_id))}
        if shop_id:
            row["in_transit_litres"] = str(transit.get((shop_id, p.id), Decimal(0)))
        out.append(row)
    return jsonify(items=out)


@bp.get("/notifications")
@login_required_roles("MILKER", "SHOP_ATTENDANT")
def notifications():
    shop_svc.check_overdue(g.business_id)
    rows = Notification.query.filter_by(business_id=g.business_id, user_id=g.user_id) \
                             .order_by(Notification.created_at.desc()).limit(50).all()
    return jsonify(items=[{"id": n.id, "type": n.notification_type, "title": n.title,
                           "message": n.message, "is_read": n.is_read} for n in rows])


# =====================================================================
# Read-only endpoints used by the web screens (lists, dashboard, alerts)
# =====================================================================
from datetime import date, datetime, time, timedelta  # noqa: E402
from decimal import Decimal  # noqa: E402
from flask import current_app  # noqa: E402
from .models import (Farm, MilkProduction, ProcessingRecord, Receipt, Sale, SaleItem, Shop, StockClosing,  # noqa: E402
                     StockLoss, User, utcnow)


def _iso(dt):
    return dt.isoformat() + "Z" if dt else None   # times are stored in UTC


def _offset():
    return timedelta(hours=current_app.config["BUSINESS_UTC_OFFSET_HOURS"])


def _local_date(dt):
    return (dt + _offset()).date()


def _receipts_for(dispatch_ids):
    if not dispatch_ids:
        return {}
    rows = Receipt.query.filter(Receipt.dispatch_id.in_(dispatch_ids)).all()
    return {r.dispatch_id: r for r in rows}


def _dispatch_dict(d, receipt, shop_names):
    it = d.items[0]
    sent = it.quantity_litres
    got = receipt.items[0].quantity_litres if receipt else None
    status = None
    if d.destination_type == "SHOP":
        status = "NOT_RECEIVED" if receipt is None else ("MATCHED" if got == sent else "DISCREPANCY")
    return {"id": d.id, "reference": d.reference, "farm_id": d.farm_id,
            "dispatched_at": _iso(d.dispatched_at),
            "type": d.dispatch_type,
            "destination": shop_names.get(d.destination_shop_id) or d.destination_name,
            "quantity_litres": str(sent),
            "price_per_litre": None if d.price_per_litre is None else str(d.price_per_litre),
            "revenue": None if it.line_total is None else str(it.line_total),
            "payment_status": d.payment_status,
            "amount_paid": str(d.amount_paid or Decimal("0.00")),
            "remaining_balance": str(max((it.line_total or Decimal("0.00")) -
                                         (d.amount_paid or Decimal("0.00")), Decimal("0.00"))),
            "non_sale_reason": d.non_sale_reason,
            "received_litres": None if got is None else str(got),
            "difference": None if got is None else str(got - sent),
            "status": status}


@bp.get("/locations")
@login_required_roles("MILKER", "SHOP_ATTENDANT")
def locations():
    b = g.business_id
    return jsonify(
        farms=[{"id": f.id, "name": f.name} for f in Farm.query.filter_by(business_id=b, is_active=True)],
        shops=[{"id": s.id, "name": s.name} for s in Shop.query.filter_by(business_id=b, is_active=True)])


@bp.get("/production")
@login_required_roles("MILKER")
def list_production():
    limit = min(request.args.get("limit", 30, type=int), 200)
    query = (db.session.query(MilkProduction, User.full_name)
            .join(User, User.id == MilkProduction.recorded_by)
            .filter(MilkProduction.business_id == g.business_id))
    production_date = request.args.get("date")
    if production_date:
        try:
            production_date = date.fromisoformat(production_date)
        except ValueError:
            return jsonify(error="date must use YYYY-MM-DD format."), 400
        query = query.filter(MilkProduction.production_date == production_date)
    farm_id = request.args.get("farm_id", type=int)
    if request.args.get("farm_id") and farm_id is None:
        return jsonify(error="farm_id must be an integer."), 400
    if farm_id:
        query = query.filter(MilkProduction.farm_id == farm_id)
    rows = (query.order_by(MilkProduction.production_date.desc(), MilkProduction.id.desc())
            .limit(limit).all())
    return jsonify(items=[{"id": p.id, "date": p.production_date.isoformat(), "session": p.session,
                           "farm_id": p.farm_id, "quantity_litres": str(p.quantity_litres), "recorded_by": who,
                           "notes": p.notes} for p, who in rows])


@bp.get("/dispatches")
@login_required_roles("MILKER", "SHOP_ATTENDANT")
def list_dispatches():
    limit = min(request.args.get("limit", 30, type=int), 200)
    ds = (Dispatch.query.filter_by(business_id=g.business_id)
          .order_by(Dispatch.dispatched_at.desc(), Dispatch.id.desc()).limit(limit).all())
    shops = {s.id: s.name for s in Shop.query.filter_by(business_id=g.business_id)}
    recs = _receipts_for([d.id for d in ds])
    return jsonify(items=[_dispatch_dict(d, recs.get(d.id), shops) for d in ds])


@bp.get("/dispatches/pending")
@login_required_roles("SHOP_ATTENDANT")
def pending_dispatches():
    """Shop transfers that have been sent but not yet received."""
    ds = (db.session.query(Dispatch).outerjoin(Receipt, Receipt.dispatch_id == Dispatch.id)
          .filter(Dispatch.business_id == g.business_id, Dispatch.destination_type == "SHOP",
                  Receipt.id.is_(None))
          .order_by(Dispatch.dispatched_at.desc()).limit(50).all())
    shops = {s.id: s.name for s in Shop.query.filter_by(business_id=g.business_id)}
    return jsonify(items=[dict(_dispatch_dict(d, None, shops), shop_id=d.destination_shop_id) for d in ds])


@bp.get("/receipts")
@login_required_roles("SHOP_ATTENDANT")
def list_receipts():
    limit = min(request.args.get("limit", 30, type=int), 200)
    rows = (db.session.query(Receipt, User.full_name).join(User, User.id == Receipt.recorded_by)
            .filter(Receipt.business_id == g.business_id)
            .order_by(Receipt.received_at.desc(), Receipt.id.desc()).limit(limit).all())
    refs = {d.id: d for d in Dispatch.query.filter(
        Dispatch.id.in_([r.dispatch_id for r, _ in rows if r.dispatch_id] or [0]))}
    out = []
    for r, who in rows:
        d = refs.get(r.dispatch_id)
        got = r.items[0].quantity_litres
        sent = d.items[0].quantity_litres if d else None
        out.append({"id": r.id, "received_at": _iso(r.received_at), "quantity_litres": str(got),
                    "reference": d.reference if d else None,
                    "dispatched_litres": None if sent is None else str(sent),
                    "difference": None if sent is None else str(got - sent), "recorded_by": who})
    return jsonify(items=out)


@bp.post("/notifications/<int:nid>/read")
@login_required_roles("MILKER", "SHOP_ATTENDANT")
def mark_read(nid):
    n = Notification.query.filter_by(id=nid, user_id=g.user_id, business_id=g.business_id).first()
    if not n:
        return jsonify(error="Notification not found"), 404
    if not n.is_read:
        n.is_read, n.read_at = True, utcnow()
        db.session.commit()
    return jsonify(ok=True)


@bp.post("/notifications/read-all")
@login_required_roles("MILKER", "SHOP_ATTENDANT")
def mark_all_read():
    Notification.query.filter_by(user_id=g.user_id, business_id=g.business_id, is_read=False) \
        .update({"is_read": True, "read_at": utcnow()})
    db.session.commit()
    return jsonify(ok=True)


@bp.get("/dashboard/summary")
@login_required_roles()  # owner only
def dashboard_summary():
    off = _offset()
    today = _local_date(utcnow())
    try:
        d_to = date.fromisoformat(request.args.get("to") or today.isoformat())
        d_from = date.fromisoformat(request.args.get("from") or (d_to - timedelta(days=13)).isoformat())
    except ValueError:
        return jsonify(error="Dates must be YYYY-MM-DD"), 400
    if d_from > d_to:
        return jsonify(error="'from' must not be after 'to'"), 400
    if (d_to - d_from).days > 365:
        return jsonify(error="Please choose a range of at most one year"), 400

    days = [d_from + timedelta(days=i) for i in range((d_to - d_from).days + 1)]
    idx = {d: i for i, d in enumerate(days)}
    n = len(days)
    zero = lambda: [Decimal(0)] * n  # noqa: E731
    start_utc = datetime.combine(d_from, time.min) - off
    end_utc = datetime.combine(d_to + timedelta(days=1), time.min) - off
    b = g.business_id

    production = {"MORNING": zero(), "LUNCH": zero(), "EVENING": zero()}
    for p in MilkProduction.query.filter(MilkProduction.business_id == b,
                                         MilkProduction.production_date >= d_from,
                                         MilkProduction.production_date <= d_to):
        production[p.session][idx[p.production_date]] += p.quantity_litres

    to_shop, revenue = zero(), zero()
    by_type = {"TRANSFER": Decimal(0), "SALE": Decimal(0), "NON_SALE": Decimal(0)}
    ds = Dispatch.query.filter(Dispatch.business_id == b, Dispatch.dispatched_at >= start_utc,
                               Dispatch.dispatched_at < end_utc).order_by(Dispatch.dispatched_at).all()
    shops = {s.id: s.name for s in Shop.query.filter_by(business_id=b)}
    recs = _receipts_for([d.id for d in ds])
    awaiting, issues = 0, []
    for d in ds:
        it, i = d.items[0], idx[_local_date(d.dispatched_at)]
        by_type[d.dispatch_type] += it.quantity_litres
        if d.dispatch_type == "TRANSFER":
            to_shop[i] += it.quantity_litres
        if it.line_total is not None:
            revenue[i] += it.line_total
        if d.destination_type == "SHOP":
            row = _dispatch_dict(d, recs.get(d.id), shops)
            if row["status"] == "NOT_RECEIVED":
                awaiting += 1
            if row["status"] != "MATCHED":
                issues.append(row)

    received = zero()
    for r in Receipt.query.filter(Receipt.business_id == b, Receipt.received_at >= start_utc,
                                  Receipt.received_at < end_utc):
        received[idx[_local_date(r.received_at)]] += r.items[0].quantity_litres

    stock = []
    for p in Product.query.filter_by(business_id=b).order_by(Product.id):
        for f in Farm.query.filter_by(business_id=b, is_active=True):
            stock.append({"location": f.name, "kind": "Farm", "product": p.name,
                          "balance_litres": str(balance(business_id=b, product_id=p.id, farm_id=f.id))})
        for s in Shop.query.filter_by(business_id=b, is_active=True):
            stock.append({"location": s.name, "kind": "Shop", "product": p.name,
                          "balance_litres": str(balance(business_id=b, product_id=p.id, shop_id=s.id))})

    # ---- shop side: sales by product, losses, closings
    sales_by_product = {}
    prod_names = {p.id: p.name for p in Product.query.filter_by(business_id=b)}
    for p_id, name in prod_names.items():
        sales_by_product[name] = zero()
    shop_revenue = Decimal(0)
    for sale in Sale.query.filter(Sale.business_id == b, Sale.sale_date >= d_from, Sale.sale_date <= d_to):
        for it in sale.items:
            sales_by_product[prod_names[it.product_id]][idx[sale.sale_date]] += it.line_total
            shop_revenue += it.line_total
    lost = Decimal(0)
    for ls in StockLoss.query.filter(StockLoss.business_id == b, StockLoss.occurred_at >= start_utc,
                                     StockLoss.occurred_at < end_utc):
        lost += ls.quantity_litres
    shop_svc.check_overdue(b)
    overdue_days = sum(len(shop_svc.closing_status(b, sh.id)["overdue"])
                       for sh in Shop.query.filter_by(business_id=b, is_active=True))
    review_needed = StockClosing.query.filter_by(business_id=b, status="REVIEW_REQUIRED").count()

    transit_rows = []
    shop_names = {sh.id: sh.name for sh in Shop.query.filter_by(business_id=b)}
    for (sid, pid), litres in sorted(_in_transit(b).items()):
        transit_rows.append({"location": shop_names.get(sid, "?"), "kind": "On the way to", "product": prod_names[pid],
                             "balance_litres": str(litres)})
    transit_total = sum((Decimal(r["balance_litres"]) for r in transit_rows), Decimal(0))

    fl = lambda arr: [float(x) for x in arr]  # noqa: E731  (charts only need plain numbers)
    return jsonify(
        range={"from": d_from.isoformat(), "to": d_to.isoformat()},
        days=[d.isoformat() for d in days],
        production={k: fl(v) for k, v in production.items()},
        sent_to_shop=fl(to_shop), received_at_shop=fl(received), external_sales_revenue=fl(revenue),
        dispatch_by_type={k: float(v) for k, v in by_type.items()},
        shop_sales={k: fl(v) for k, v in sales_by_product.items()},
        totals={"produced": str(sum((sum(v) for v in production.values()), Decimal(0))),
                "sent_to_shop": str(sum(to_shop, Decimal(0))),
                "received_at_shop": str(sum(received, Decimal(0))),
                "external_sales_revenue": str(sum(revenue, Decimal(0))),
                "total_sales": str(shop_revenue + sum(revenue, Decimal(0))),
                "in_transit_litres": str(transit_total),
                "total_revenue": str(shop_revenue + sum(revenue, Decimal(0))),
                "shop_sales_revenue": str(shop_revenue), "losses_litres": str(lost),
                "closings_overdue": overdue_days, "closings_to_review": review_needed,
                "awaiting_receipt": awaiting,
                "discrepancies": sum(1 for r in issues if r["status"] == "DISCREPANCY")},
        issues=issues, stock=stock + transit_rows)


# =====================================================================
# Shop operations: prices, sales, processing, losses, daily closing
# =====================================================================
def _sale_dict(sale, who=None):
    names = {p.id: p.name for p in Product.query.filter_by(business_id=sale.business_id)}
    shop = Shop.query.filter_by(id=sale.shop_id, business_id=sale.business_id).first()
    return {"id": sale.id, "sale_date": sale.sale_date.isoformat(), "shop": shop.name if shop else "",
            "recorded_by": who, "notes": sale.notes,
            "total": str(sum((i.line_total for i in sale.items), Decimal(0))),
            "items": [{"product": names[i.product_id], "quantity_litres": str(i.quantity_litres),
                       "unit_price": str(i.unit_price), "line_total": str(i.line_total)} for i in sale.items]}


def _closing_dict(c, names, who=None):
    return {"id": c.id, "closing_date": c.closing_date.isoformat(), "status": c.status, "is_late": c.is_late,
            "submitted_at": _iso(c.submitted_at), "submitted_by": who, "notes": c.notes,
            "items": [{"product": names[i.product_id], "expected": str(i.expected_quantity),
                       "physical": str(i.physical_quantity), "variance": str(i.variance_quantity)}
                      for i in c.items]}


@bp.get("/prices")
@login_required_roles("SHOP_ATTENDANT")
def prices():
    return jsonify(items=shop_svc.list_prices(g.business_id))


@bp.get("/dispatches/price")
@login_required_roles("MILKER")
def dispatch_price():
    fresh_milk = next((item for item in shop_svc.list_prices(g.business_id)
                       if item["product_type"] == "FRESH_MILK"), None)
    return jsonify(selling_price=None if fresh_milk is None else fresh_milk["selling_price"])


@bp.post("/prices")
@login_required_roles()  # owner only: attendants cannot change selling prices
def set_price():
    out = shop_svc.set_price(g.business_id, g.user_id, request.get_json(silent=True) or {})
    return jsonify(record=out, created=True, warnings=[]), 201


@bp.post("/sales")
@login_required_roles("SHOP_ATTENDANT")
def sales_create():
    sale, created, warnings = shop_svc.record_sale(g.business_id, g.user_id, request.get_json(silent=True) or {})
    return jsonify(record=_sale_dict(sale), created=created, warnings=warnings), (201 if created else 200)


@bp.get("/sales")
@login_required_roles("SHOP_ATTENDANT")
def sales_list():
    limit = min(request.args.get("limit", 30, type=int), 200)
    rows = (db.session.query(Sale, User.full_name).join(User, User.id == Sale.recorded_by)
            .filter(Sale.business_id == g.business_id)
            .order_by(Sale.sale_date.desc(), Sale.id.desc()).limit(limit).all())
    return jsonify(items=[_sale_dict(s_, who) for s_, who in rows])


@bp.get("/sales/<int:sale_id>")
@login_required_roles("SHOP_ATTENDANT")
def sales_detail(sale_id):
    row = (db.session.query(Sale, User.full_name)
           .join(User, User.id == Sale.recorded_by)
           .filter(Sale.id == sale_id, Sale.business_id == g.business_id).first())
    if row is None:
        return jsonify(error="Sale not found."), 404
    sale, who = row
    return jsonify(record=_sale_dict(sale, who))


def _expense_period(period):
    days = {"week": 7, "month": 30, "3months": 90, "6months": 180, "year": 365}
    if period not in days:
        return None
    end = _local_date(utcnow())
    return end - timedelta(days=days[period] - 1), end


@bp.get("/expense-categories")
@login_required_roles()
def expense_categories():
    accounts.ensure_expense_categories(g.business_id)
    rows = (ExpenseCategory.query.filter_by(business_id=g.business_id, is_active=True)
            .filter(ExpenseCategory.name.in_(accounts.EXPENSE_CATEGORIES))
            .order_by(ExpenseCategory.name).all())
    return jsonify(items=[{"id": c.id, "name": c.name} for c in rows])


@bp.post("/expenses")
@login_required_roles()
def expenses_create():
    data = request.get_json(silent=True) or {}
    try:
        expense_date = date.fromisoformat(str(data.get("expense_date") or ""))
        category_id = int(str(data.get("category_id")))
        amount = Decimal(str(data.get("amount"))).quantize(Decimal("0.01"))
    except (TypeError, ValueError, ArithmeticError):
        return jsonify(error="Enter a valid date, category and amount."), 400
    if not amount.is_finite() or amount <= 0:
        return jsonify(error="Expense amount must be greater than zero."), 400
    if expense_date > _local_date(utcnow()):
        return jsonify(error="Expense date cannot be in the future."), 400
    category = ExpenseCategory.query.filter_by(
        id=category_id, business_id=g.business_id, is_active=True).first()
    if category is None:
        return jsonify(error="Choose a valid expense category."), 400
    payment_status = str(data.get("payment_status") or "").upper()
    if payment_status not in ("PAID", "UNPAID"):
        return jsonify(error="Payment status must be PAID or UNPAID."), 400
    area = str(data.get("area") or "").upper()
    if area not in ("FARM", "SHOP"):
        return jsonify(error="Choose whether this expense is on the farm or at the shop."), 400
    description = str(data.get("description") or "").strip()
    if len(description) > 4000:
        return jsonify(error="Description must be 4000 characters or fewer."), 400
    if category.name == "Equipment" and not description:
        return jsonify(error="Specify the equipment purchased or maintained in the description."), 400

    expense = Expense(business_id=g.business_id, category_id=category.id,
                      area=area, expense_date=expense_date, amount=amount,
                      description=description or None, recorded_by=g.user_id)
    db.session.add(expense)
    db.session.flush()
    if payment_status == "PAID":
        db.session.add(ExpensePayment(business_id=g.business_id, expense_id=expense.id,
                                      amount=amount, payment_date=expense_date,
                                      recorded_by=g.user_id))
    db.session.add(AuditLog(
        business_id=g.business_id, user_id=g.user_id, action="CREATE", record_type="EXPENSE",
        record_id=expense.id,
        new_values_json={"category": category.name, "area": area, "expense_date": expense_date.isoformat(),
                         "amount": str(amount), "payment_status": payment_status}))
    db.session.commit()
    return jsonify(record={"id": expense.id, "category": category.name, "area": area,
                           "expense_date": expense_date.isoformat(), "amount": str(amount),
                           "payment_status": payment_status}), 201


@bp.get("/expenses/unpaid")
@login_required_roles()
def expenses_unpaid():
    today = _local_date(utcnow())
    paid_total = func.coalesce(func.sum(ExpensePayment.amount), 0).label("paid_total")
    rows = (db.session.query(Expense, ExpenseCategory.name, paid_total)
            .join(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
            .outerjoin(ExpensePayment, and_(
                ExpensePayment.expense_id == Expense.id,
                ExpensePayment.business_id == g.business_id))
            .filter(Expense.business_id == g.business_id)
            .group_by(Expense.id, ExpenseCategory.name)
            .having(func.coalesce(func.sum(ExpensePayment.amount), 0) < Expense.amount)
            .order_by(Expense.expense_date.asc(), Expense.id.asc()).all())
    items = []
    total_due = Decimal(0)
    for expense, category, amount_paid in rows:
        due = expense.amount - Decimal(str(amount_paid))
        total_due += due
        items.append({
            "id": expense.id, "area": expense.area or "UNASSIGNED",
            "expense_date": expense.expense_date.isoformat(), "days_old": (today - expense.expense_date).days,
            "category": category, "description": expense.description,
            "amount_due": str(due), "amount_paid": str(amount_paid),
        })
    return jsonify(items=items, total_due=str(total_due))


@bp.post("/expenses/<int:eid>/pay")
@login_required_roles()
def expense_pay(eid):
    expense = Expense.query.filter_by(id=eid, business_id=g.business_id).first()
    if expense is None:
        return jsonify(error="Expense not found."), 404
    amount_paid = (db.session.query(func.coalesce(func.sum(ExpensePayment.amount), 0))
                  .filter_by(business_id=g.business_id, expense_id=expense.id).scalar())
    remaining = expense.amount - Decimal(str(amount_paid or 0))
    if remaining <= 0:
        return jsonify(error="This expense is already paid."), 409
    payment = ExpensePayment(
        business_id=g.business_id, expense_id=expense.id, amount=remaining,
        payment_date=_local_date(utcnow()), recorded_by=g.user_id)
    db.session.add(payment)
    db.session.add(AuditLog(
        business_id=g.business_id, user_id=g.user_id, action="CREATE", record_type="EXPENSE_PAYMENT",
        record_id=expense.id,
        new_values_json={"amount": str(remaining), "payment_date": payment.payment_date.isoformat()}))
    db.session.commit()
    return jsonify(record={"expense_id": expense.id, "amount_paid": str(remaining)}), 201


@bp.get("/expenses")
@login_required_roles()
def expenses_list():
    date_from = request.args.get("date_from")
    date_to = request.args.get("date_to")
    period = request.args.get("period", "month")
    if date_from or date_to:
        if not date_from or not date_to:
            return jsonify(error="Provide both date_from and date_to."), 400
        try:
            start = date.fromisoformat(date_from)
            end = date.fromisoformat(date_to)
        except ValueError:
            return jsonify(error="Dates must use YYYY-MM-DD format."), 400
        if start > end:
            return jsonify(error="date_from must be on or before date_to."), 400
        period_label = "custom"
    else:
        bounds = _expense_period(period)
        if bounds is None:
            return jsonify(error="Choose week, month, 3months, 6months, year, or provide a custom date range."), 400
        start, end = bounds
        period_label = period
    if (end - start).days > 365:
        return jsonify(error="Please choose a range of at most one year."), 400
    area = str(request.args.get("area", "TOTALS")).upper()
    if area not in ("FARM", "SHOP", "TOTALS"):
        return jsonify(error="Choose FARM, SHOP or TOTALS for the expense area."), 400
    area_filter = None if area == "TOTALS" else area
    expense_join = and_(
        Expense.category_id == ExpenseCategory.id,
        Expense.business_id == g.business_id,
        Expense.expense_date >= start,
        Expense.expense_date <= end,
    )
    if area_filter:
        expense_join = and_(expense_join, Expense.area == area_filter)
    categories = (db.session.query(
        ExpenseCategory.id, ExpenseCategory.name,
        func.coalesce(func.sum(Expense.amount), 0).label("total"))
        .outerjoin(Expense, expense_join)
        .filter(ExpenseCategory.business_id == g.business_id,
                or_(ExpenseCategory.name.in_(accounts.EXPENSE_CATEGORIES),
                    Expense.id.is_not(None)))
        .group_by(ExpenseCategory.id, ExpenseCategory.name)
        .order_by(ExpenseCategory.name).all())
    total = sum((Decimal(str(row.total)) for row in categories), Decimal(0))

    expense_daily_query = (db.session.query(Expense.expense_date, func.sum(Expense.amount))
                           .filter(Expense.business_id == g.business_id, Expense.expense_date >= start,
                                   Expense.expense_date <= end))
    if area_filter:
        expense_daily_query = expense_daily_query.filter(Expense.area == area_filter)
    expense_daily = {day: Decimal(str(value)) for day, value in
                     expense_daily_query.group_by(Expense.expense_date).all()}

    shop_revenue_daily = {
        day: Decimal(str(value)) for day, value in
        db.session.query(Sale.sale_date, func.sum(SaleItem.line_total))
        .join(SaleItem, SaleItem.sale_id == Sale.id)
        .filter(Sale.business_id == g.business_id, Sale.sale_date >= start, Sale.sale_date <= end)
        .group_by(Sale.sale_date).all()
    }
    off = _offset()
    start_utc = datetime.combine(start, time.min) - off
    end_utc = datetime.combine(end + timedelta(days=1), time.min) - off
    external_revenue_daily = {}
    for dispatched_at, line_total in (
        db.session.query(Dispatch.dispatched_at, DispatchItem.line_total)
        .join(DispatchItem, DispatchItem.dispatch_id == Dispatch.id)
        .filter(Dispatch.business_id == g.business_id, Dispatch.dispatched_at >= start_utc,
                Dispatch.dispatched_at < end_utc, Dispatch.destination_type == "EXTERNAL",
                Dispatch.dispatch_type == "SALE", DispatchItem.line_total.is_not(None)).all()
    ):
        day = _local_date(dispatched_at)
        external_revenue_daily[day] = external_revenue_daily.get(day, Decimal(0)) + Decimal(str(line_total))

    def revenue_between(from_date, to_date):
        shop_total = (db.session.query(func.coalesce(func.sum(SaleItem.line_total), 0))
                      .join(Sale, Sale.id == SaleItem.sale_id)
                      .filter(Sale.business_id == g.business_id, Sale.sale_date >= from_date,
                              Sale.sale_date <= to_date).scalar())
        from_utc = datetime.combine(from_date, time.min) - off
        to_utc = datetime.combine(to_date + timedelta(days=1), time.min) - off
        external_total = (db.session.query(func.coalesce(func.sum(DispatchItem.line_total), 0))
                          .join(Dispatch, Dispatch.id == DispatchItem.dispatch_id)
                          .filter(Dispatch.business_id == g.business_id, Dispatch.dispatched_at >= from_utc,
                                  Dispatch.dispatched_at < to_utc, Dispatch.destination_type == "EXTERNAL",
                                  Dispatch.dispatch_type == "SALE").scalar())
        return Decimal(str(shop_total or 0)) + Decimal(str(external_total or 0))

    def money_string(value):
        return str(Decimal(value).quantize(Decimal("0.01")))

    previous_days = (end - start).days + 1
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=previous_days - 1)
    previous_expense_query = (db.session.query(func.coalesce(func.sum(Expense.amount), 0))
                              .filter(Expense.business_id == g.business_id,
                                      Expense.expense_date >= previous_start,
                                      Expense.expense_date <= previous_end))
    if area_filter:
        previous_expense_query = previous_expense_query.filter(Expense.area == area_filter)
    previous_expenses = Decimal(str(previous_expense_query.scalar() or 0))
    previous_revenue = revenue_between(previous_start, previous_end)
    daily = []
    day_count = (end - start).days + 1
    for offset in range(day_count):
        day = start + timedelta(days=offset)
        daily.append({
            "date": day.isoformat(),
            "expenses": money_string(expense_daily.get(day, Decimal(0))),
            "revenue": money_string(shop_revenue_daily.get(day, Decimal(0)) +
                                    external_revenue_daily.get(day, Decimal(0))),
        })

    expense_filters = [Expense.business_id == g.business_id, Expense.expense_date >= start,
                       Expense.expense_date <= end]
    if area_filter:
        expense_filters.append(Expense.area == area_filter)
    rows = (db.session.query(Expense, ExpenseCategory.name, User.full_name)
            .join(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
            .join(User, User.id == Expense.recorded_by)
            .filter(*expense_filters)
            .order_by(Expense.expense_date.desc(), Expense.id.desc()).limit(200).all())
    ids = [expense.id for expense, _, _ in rows]
    paid = {}
    if ids:
        paid = dict(db.session.query(
            ExpensePayment.expense_id, func.sum(ExpensePayment.amount))
            .filter(ExpensePayment.business_id == g.business_id,
                    ExpensePayment.expense_id.in_(ids))
            .group_by(ExpensePayment.expense_id).all())
    items = []
    for expense, category_name, who in rows:
        amount_paid = Decimal(str(paid.get(expense.id) or 0))
        status = "PAID" if amount_paid >= expense.amount else (
            "PARTIALLY_PAID" if amount_paid > 0 else "UNPAID")
        items.append({"id": expense.id, "expense_date": expense.expense_date.isoformat(),
                      "category": category_name, "area": expense.area or "UNASSIGNED",
                      "amount": str(expense.amount),
                      "description": expense.description, "recorded_by": who,
                      "amount_paid": str(amount_paid), "payment_status": status})
    area_totals = (db.session.query(Expense.area, func.coalesce(func.sum(Expense.amount), 0))
                   .filter(Expense.business_id == g.business_id, Expense.expense_date >= start,
                           Expense.expense_date <= end)
                   .group_by(Expense.area).all())
    return jsonify(period=period_label, start_date=start.isoformat(), end_date=end.isoformat(),
                   area=area, total=str(total),
                   revenue=money_string(sum((Decimal(row["revenue"]) for row in daily), Decimal(0))),
                   daily=daily,
                   previous_period={"start_date": previous_start.isoformat(),
                                    "end_date": previous_end.isoformat(),
                                    "expenses": money_string(previous_expenses),
                                    "revenue": money_string(previous_revenue)},
                   totals_by_area={key or "UNASSIGNED": str(value) for key, value in area_totals},
                   by_category=[{"id": row.id, "category": row.name, "total": str(row.total)}
                                for row in categories],
                   items=items)


@bp.post("/processing")
@login_required_roles("SHOP_ATTENDANT")
def processing_create():
    rec, created, warnings = shop_svc.record_processing(g.business_id, g.user_id, request.get_json(silent=True) or {})
    return jsonify(record={"id": rec.id}, created=created, warnings=warnings), (201 if created else 200)


@bp.get("/processing")
@login_required_roles("SHOP_ATTENDANT")
def processing_list():
    limit = min(request.args.get("limit", 30, type=int), 200)
    names = {p.id: p.name for p in Product.query.filter_by(business_id=g.business_id)}
    rows = (db.session.query(ProcessingRecord, User.full_name).join(User, User.id == ProcessingRecord.recorded_by)
            .filter(ProcessingRecord.business_id == g.business_id)
            .order_by(ProcessingRecord.processed_at.desc(), ProcessingRecord.id.desc()).limit(limit).all())
    out = []
    for r, who in rows:
        inp = next(i for i in r.items if i.movement_type == "INPUT")
        outp = next(i for i in r.items if i.movement_type == "OUTPUT")
        out.append({"id": r.id, "processed_at": _iso(r.processed_at), "product": names[outp.product_id],
                    "milk_used": str(inp.quantity_litres), "produced": str(outp.quantity_litres),
                    "recorded_by": who, "notes": r.notes})
    return jsonify(items=out)


@bp.post("/losses")
@login_required_roles("SHOP_ATTENDANT")
def losses_create():
    rec, created, warnings = shop_svc.record_loss(g.business_id, g.user_id, request.get_json(silent=True) or {})
    return jsonify(record={"id": rec.id}, created=created, warnings=warnings), (201 if created else 200)


@bp.get("/losses")
@login_required_roles("SHOP_ATTENDANT")
def losses_list():
    limit = min(request.args.get("limit", 30, type=int), 200)
    names = {p.id: p.name for p in Product.query.filter_by(business_id=g.business_id)}
    rows = (db.session.query(StockLoss, User.full_name).join(User, User.id == StockLoss.recorded_by)
            .filter(StockLoss.business_id == g.business_id)
            .order_by(StockLoss.occurred_at.desc(), StockLoss.id.desc()).limit(limit).all())
    return jsonify(items=[{"id": l.id, "occurred_at": _iso(l.occurred_at), "product": names[l.product_id],
                           "quantity_litres": str(l.quantity_litres), "reason": l.loss_reason,
                           "recorded_by": who, "notes": l.notes} for l, who in rows])


@bp.get("/closings/status")
@login_required_roles("SHOP_ATTENDANT")
def closing_status_view():
    shop_id = request.args.get("shop_id", type=int)
    shop = Shop.query.filter_by(id=shop_id, business_id=g.business_id).first() if shop_id else None
    if not shop:
        return jsonify(error="shop_id is required"), 400
    shop_svc.check_overdue(g.business_id)
    return jsonify(shop_svc.closing_status(g.business_id, shop.id))


@bp.post("/closings")
@login_required_roles("SHOP_ATTENDANT")
def closing_create():
    c, created, warnings = shop_svc.submit_closing(g.business_id, g.user_id, request.get_json(silent=True) or {})
    names = {p.id: p.name for p in Product.query.filter_by(business_id=g.business_id)}
    return jsonify(record=_closing_dict(c, names), created=created, warnings=warnings), (201 if created else 200)


@bp.get("/closings")
@login_required_roles("SHOP_ATTENDANT")
def closing_list():
    limit = min(request.args.get("limit", 30, type=int), 200)
    names = {p.id: p.name for p in Product.query.filter_by(business_id=g.business_id)}
    rows = (db.session.query(StockClosing, User.full_name).join(User, User.id == StockClosing.submitted_by)
            .filter(StockClosing.business_id == g.business_id)
            .order_by(StockClosing.closing_date.desc()).limit(limit).all())
    return jsonify(items=[_closing_dict(c, names, who) for c, who in rows])


@bp.post("/closings/<int:cid>/review")
@login_required_roles()  # owner only
def closing_review(cid):
    c = shop_svc.review_closing(g.business_id, g.user_id, cid, request.get_json(silent=True) or {})
    return jsonify(record={"id": c.id, "status": c.status})


def _in_transit(business_id):
    """{(shop_id, product_id): litres} sent from the farm to a shop but not yet received."""
    rows = (db.session.query(Dispatch).outerjoin(Receipt, Receipt.dispatch_id == Dispatch.id)
            .filter(Dispatch.business_id == business_id, Dispatch.destination_type == "SHOP", Receipt.id.is_(None)).all())
    out = {}
    for d in rows:
        for it in d.items:
            key = (d.destination_shop_id, it.product_id)
            out[key] = out.get(key, Decimal(0)) + it.quantity_litres
    return out


# =====================================================================
# Owner: people, opening stock, activity log
# =====================================================================
@bp.get("/users")
@login_required_roles()  # owner only
def users_list():
    return jsonify(items=accounts.list_users(g.business_id))


@bp.post("/users")
@login_required_roles()
def users_create():
    u = accounts.create_user(g.business_id, g.user_id, request.get_json(silent=True) or {})
    return jsonify(record={"id": u.id, "username": u.username}, created=True, warnings=[]), 201


@bp.post("/users/<int:uid>/active")
@login_required_roles()
def users_active(uid):
    accounts.set_active(g.business_id, g.user_id, uid, bool((request.get_json(silent=True) or {}).get("active")))
    return jsonify(ok=True)


@bp.post("/users/<int:uid>/role")
@login_required_roles()
def users_change_role(uid):
    accounts.change_role(g.business_id, g.user_id, uid, (request.get_json(silent=True) or {}).get("role"))
    return jsonify(ok=True)


@bp.post("/users/<int:uid>/reset-password")
@login_required_roles()
def users_reset(uid):
    accounts.reset_password(g.business_id, g.user_id, uid, (request.get_json(silent=True) or {}).get("password"))
    return jsonify(ok=True)


@bp.post("/users/<int:uid>/unlock")
@login_required_roles()
def users_unlock(uid):
    accounts.unlock(g.business_id, g.user_id, uid)
    return jsonify(ok=True)


@bp.get("/opening-stock")
@login_required_roles()
def opening_list():
    return jsonify(items=opening.list_opening(g.business_id))


@bp.post("/opening-stock")
@login_required_roles()
def opening_create():
    items = opening.record_opening_stock(g.business_id, g.user_id, request.get_json(silent=True) or {})
    return jsonify(record={"items": items}, created=True, warnings=[]), 201


@bp.get("/audit")
@login_required_roles()
def audit_list():
    from .models import AuditLog
    limit = min(request.args.get("limit", 100, type=int), 500)
    rows = (db.session.query(AuditLog, User.full_name).outerjoin(User, User.id == AuditLog.user_id)
            .filter(AuditLog.business_id == g.business_id)
            .order_by(AuditLog.id.desc()).limit(limit).all())
    return jsonify(items=[{"id": a.id, "at": _iso(a.created_at), "user": who, "action": a.action,
                           "record_type": a.record_type, "record_id": a.record_id,
                           "details": a.new_values_json} for a, who in rows])
