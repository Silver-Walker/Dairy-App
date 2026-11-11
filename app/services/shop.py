"""Shop operations: prices, sales, processing, losses and the daily stock closing.
Same rules as workflow.py: one database transaction per operation, nothing silently overwritten."""
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import func

from ..extensions import db
from ..models import (BusinessSettings, Membership, Notification, ProcessingItem, ProcessingRecord,
                      ProductPrice, Sale, SaleItem, Shop, StockAdjustment, StockClosing,
                      StockClosingItem, StockLoss, StockMovement, utcnow)
from .errors import ConflictError, NotFoundError, ValidationError
from .inventory import add_movement, balance
from .workflow import (Q2, Q3, _audit, _entered, _existing_by_uuid, _get_scoped, _notify_owners,
                       _product, day_last_second_utc, day_start_utc, dec, local_date, note_backdated,
                       offset, parse_dt)

PRODUCT_TYPES = ("FRESH_MILK", "YOGHURT", "MAZIWA_MALA")
LOSS_REASONS = ("SPOILAGE", "EXPIRY", "SPILLAGE", "OTHER")


def _ptype(value):
    p = str(value or "").upper()
    if p not in PRODUCT_TYPES:
        raise ValidationError("product_type must be FRESH_MILK, YOGHURT or MAZIWA_MALA")
    return p


def _parse_date(value, field):
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValidationError(f"{field} must be YYYY-MM-DD")


def _occurred_for_date(d, now):
    """Ledger time for an entry that only has a date: now if today, else midday of that day."""
    if d == local_date(now):
        return now
    return day_start_utc(d) + timedelta(hours=12)


def _not_future(dt, field, now):
    if dt > now + timedelta(minutes=5):
        raise ValidationError(f"{field} cannot be in the future")


# ===================================================== prices
def current_price(business_id, product_id, at=None):
    at = at or utcnow()
    row = (ProductPrice.query.filter(ProductPrice.business_id == business_id,
                                     ProductPrice.product_id == product_id,
                                     ProductPrice.effective_from <= at)
           .order_by(ProductPrice.effective_from.desc(), ProductPrice.id.desc()).first())
    return row.selling_price if row else None


def set_price(business_id, user_id, data):
    ptype = _ptype(data.get("product_type"))
    price = dec(data.get("selling_price"), "selling_price").quantize(Q2)
    product = _product(business_id, ptype)
    old = current_price(business_id, product.id)
    try:
        db.session.add(ProductPrice(business_id=business_id, product_id=product.id, selling_price=price,
                                    effective_from=utcnow(), created_by=user_id))
        _audit(business_id, user_id, "PRICE_CHANGE", "PRODUCT", product.id,
               {"product": ptype, "old": None if old is None else str(old), "new": str(price)})
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return {"product_type": ptype, "selling_price": str(price)}


def list_prices(business_id):
    from ..models import Product
    out = []
    for p in Product.query.filter_by(business_id=business_id).order_by(Product.id):
        cur = current_price(business_id, p.id)
        out.append({"product_type": p.product_type, "product": p.name,
                    "selling_price": None if cur is None else str(cur)})
    return out


# ===================================================== sales
def record_sale(business_id, user_id, data):
    existing = _existing_by_uuid(Sale, business_id, data.get("client_uuid"))
    if existing:
        return existing, False, []
    shop = _get_scoped(Shop, data.get("shop_id"), business_id, "Shop")
    now = utcnow()
    sale_date = _parse_date(data.get("sale_date") or local_date(now).isoformat(), "sale_date")
    if sale_date > local_date(now):
        raise ValidationError("sale_date cannot be in the future")
    items_in = data.get("items")
    if not isinstance(items_in, list) or not items_in:
        raise ValidationError("Add at least one product to sell")
    if len(items_in) > 20:
        raise ValidationError("Too many lines in one sale (maximum 20)")
    occurred = _occurred_for_date(sale_date, now)

    lines, warnings, need = [], [], {}
    for it in items_in:
        if not isinstance(it, dict):
            raise ValidationError("Invalid sale line")
        ptype = _ptype(it.get("product_type"))
        product = _product(business_id, ptype)
        qty = dec(it.get("quantity_litres"), "quantity_litres")
        list_price = current_price(business_id, product.id, now)
        raw = it.get("unit_price")
        if raw is None or str(raw).strip() == "":
            if list_price is None:
                raise ValidationError(f"No selling price is set for {product.name}. Ask the owner to set it.")
            price, differs = list_price, False
        else:
            price = dec(raw, "unit_price").quantize(Q2)
            differs = list_price is not None and price != list_price
        lines.append({"product": product, "qty": qty, "price": price, "differs": differs,
                      "list_price": list_price, "total": (qty * price).quantize(Q2)})
        need[product.id] = need.get(product.id, Decimal(0)) + qty
    for line in lines:
        pid = line["product"].id
        if pid in need:
            if balance(business_id=business_id, product_id=pid, shop_id=shop.id, up_to=occurred) < need[pid]:
                warnings.append(f"Selling more {line['product'].name} than the recorded shop stock; check receipts and processing.")
            del need[pid]

    entered_at, synced_at = _entered(data)
    try:
        sale = Sale(client_uuid=data.get("client_uuid"), business_id=business_id, shop_id=shop.id,
                    sale_date=sale_date, recorded_by=user_id, entered_at=entered_at, synced_at=synced_at,
                    notes=data.get("notes"))
        for l in lines:
            sale.items.append(SaleItem(business_id=business_id, product_id=l["product"].id, quantity_litres=l["qty"],
                                       unit_price=l["price"], line_total=l["total"]))
        db.session.add(sale)
        db.session.flush()
        for l, item in zip(lines, sale.items):
            add_movement(business_id=business_id, product_id=l["product"].id, quantity_delta=-l["qty"],
                         movement_type="SALE", source_type="SALE_ITEM", source_id=item.id,
                         occurred_at=occurred, user_id=user_id, shop_id=shop.id)
        total = sum((l["total"] for l in lines), Decimal(0))
        _audit(business_id, user_id, "CREATE", "SALE", sale.id,
               {"date": str(sale_date), "total": str(total),
                "lines": [{"p": l["product"].product_type, "q": str(l["qty"]), "price": str(l["price"])} for l in lines]})
        for l in lines:
            if l["differs"]:
                msg = (f"{l['product'].name} was sold at KSh {l['price']} but the list price is "
                       f"KSh {l['list_price']} (sale #{sale.id}).")
                warnings.append(msg)
                _notify_owners(business_id, "OTHER", "Sale price differs from list price", msg, "SALE", sale.id)
        late = note_backdated(business_id, shop.id, occurred, "Sale", "SALE", sale.id)
        if late:
            warnings.append(late)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return sale, True, warnings


# ===================================================== processing
def record_processing(business_id, user_id, data):
    existing = _existing_by_uuid(ProcessingRecord, business_id, data.get("client_uuid"))
    if existing:
        return existing, False, []
    shop = _get_scoped(Shop, data.get("shop_id"), business_id, "Shop")
    ptype = _ptype(data.get("product_type"))
    if ptype == "FRESH_MILK":
        raise ValidationError("Choose YOGHURT or MAZIWA_MALA as the product made")
    used = dec(data.get("input_litres"), "input_litres")
    made = dec(data.get("output_litres"), "output_litres")
    when = parse_dt(data.get("processed_at"), "processed_at")
    now = utcnow()
    _not_future(when, "processed_at", now)
    milk, out = _product(business_id, "FRESH_MILK"), _product(business_id, ptype)

    warnings = []
    if balance(business_id=business_id, product_id=milk.id, shop_id=shop.id, up_to=when) < used:
        warnings.append("Fresh milk used is more than the recorded shop stock at that time; check receipts.")
    if made > used:
        warnings.append("The amount produced is larger than the milk used; please double-check the figures.")

    entered_at, synced_at = _entered(data)
    try:
        rec = ProcessingRecord(client_uuid=data.get("client_uuid"), business_id=business_id, shop_id=shop.id,
                               processed_at=when, recorded_by=user_id, entered_at=entered_at,
                               synced_at=synced_at, notes=data.get("notes"))
        rec.items.append(ProcessingItem(business_id=business_id, product_id=milk.id, movement_type="INPUT", quantity_litres=used))
        rec.items.append(ProcessingItem(business_id=business_id, product_id=out.id, movement_type="OUTPUT", quantity_litres=made))
        db.session.add(rec)
        db.session.flush()
        add_movement(business_id=business_id, product_id=milk.id, quantity_delta=-used,
                     movement_type="PROCESSING_INPUT", source_type="PROCESSING_ITEM",
                     source_id=rec.items[0].id, occurred_at=when, user_id=user_id, shop_id=shop.id)
        add_movement(business_id=business_id, product_id=out.id, quantity_delta=made,
                     movement_type="PROCESSING_OUTPUT", source_type="PROCESSING_ITEM",
                     source_id=rec.items[1].id, occurred_at=when, user_id=user_id, shop_id=shop.id)
        _audit(business_id, user_id, "CREATE", "PROCESSING", rec.id,
               {"product": ptype, "milk_used": str(used), "produced": str(made)})
        late = note_backdated(business_id, shop.id, when, "Processing", "PROCESSING", rec.id)
        if late:
            warnings.append(late)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return rec, True, warnings


# ===================================================== losses
def record_loss(business_id, user_id, data):
    existing = _existing_by_uuid(StockLoss, business_id, data.get("client_uuid"))
    if existing:
        return existing, False, []
    shop = _get_scoped(Shop, data.get("shop_id"), business_id, "Shop")
    product = _product(business_id, _ptype(data.get("product_type")))
    qty = dec(data.get("quantity_litres"), "quantity_litres")
    reason = str(data.get("loss_reason", "")).upper()
    if reason not in LOSS_REASONS:
        raise ValidationError("loss_reason must be SPOILAGE, EXPIRY, SPILLAGE or OTHER")
    when = parse_dt(data.get("occurred_at"), "occurred_at")
    _not_future(when, "occurred_at", utcnow())
    warnings = []
    if balance(business_id=business_id, product_id=product.id, shop_id=shop.id, up_to=when) < qty:
        warnings.append("This loss is more than the recorded shop stock at that time.")
    entered_at, synced_at = _entered(data)
    try:
        loss = StockLoss(client_uuid=data.get("client_uuid"), business_id=business_id, shop_id=shop.id,
                         product_id=product.id, quantity_litres=qty, loss_reason=reason, occurred_at=when,
                         recorded_by=user_id, entered_at=entered_at, synced_at=synced_at,
                         notes=data.get("notes"))
        db.session.add(loss)
        db.session.flush()
        add_movement(business_id=business_id, product_id=product.id, quantity_delta=-qty,
                     movement_type="LOSS", source_type="STOCK_LOSS", source_id=loss.id,
                     occurred_at=when, user_id=user_id, shop_id=shop.id)
        _audit(business_id, user_id, "CREATE", "STOCK_LOSS", loss.id,
               {"product": product.product_type, "litres": str(qty), "reason": reason})
        late = note_backdated(business_id, shop.id, when, "Loss", "STOCK_LOSS", loss.id)
        if late:
            warnings.append(late)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return loss, True, warnings


# ===================================================== daily closing
def _deadline_time(business_id):
    s = db.session.get(BusinessSettings, business_id)
    t = s.closing_deadline_time if s and s.closing_deadline_time else time(12, 0)
    if isinstance(t, timedelta):                      # some MySQL drivers return TIME as a timedelta
        t = (datetime.min + t).time()
    return t


def closing_deadline_utc(business_id, closing_date):
    """Day D must be closed by the deadline time (default 12:00) on day D+1, business-local."""
    return datetime.combine(closing_date + timedelta(days=1), _deadline_time(business_id)) - offset()


def last_closed_date(shop_id):
    return db.session.query(func.max(StockClosing.closing_date)).filter(StockClosing.shop_id == shop_id).scalar()


def closing_status(business_id, shop_id, now=None):
    now = now or utcnow()
    today = local_date(now)
    last = last_closed_date(shop_id)
    base = {"deadline_time": _deadline_time(business_id).strftime("%H:%M"), "today": today.isoformat()}
    if last is None:
        return dict(base, first_closing=True, last_closed=None, next_date=None,
                    suggested_date=today.isoformat(), outstanding=[], overdue=[], provisional=False,
                    up_to_date=False)
    nxt = last + timedelta(days=1)
    outstanding, d = [], nxt
    while d < today:                                    # whole days that have ended without a closing
        outstanding.append(d)
        d += timedelta(days=1)
    overdue = [x for x in outstanding if now > closing_deadline_utc(business_id, x)]
    up_to_date = nxt > today
    return dict(base, first_closing=False, last_closed=last.isoformat(),
                next_date=None if up_to_date else nxt.isoformat(),
                suggested_date=None if up_to_date else nxt.isoformat(),
                outstanding=[x.isoformat() for x in outstanding], overdue=[x.isoformat() for x in overdue],
                provisional=bool(outstanding), up_to_date=up_to_date)


def check_overdue(business_id, now=None):
    """Create 'closing overdue' alerts (once per shop/day/person). Called whenever alerts or status are read."""
    now = now or utcnow()
    for shop in Shop.query.filter_by(business_id=business_id, is_active=True).all():
        st = closing_status(business_id, shop.id, now)
        for iso in st["overdue"]:
            d = date.fromisoformat(iso)
            key = int(d.strftime("%Y%m%d")) * 1000 + shop.id % 1000
            members = Membership.query.filter(Membership.business_id == business_id, Membership.is_active.is_(True),
                                              Membership.role.in_(("OWNER", "SHOP_ATTENDANT"))).all()
            for uid in {m.user_id for m in members}:
                if Notification.query.filter_by(user_id=uid, notification_type="CLOSING_OVERDUE",
                                                related_record_type="CLOSING_DATE", related_record_id=key).first():
                    continue
                db.session.add(Notification(
                    business_id=business_id, user_id=uid, notification_type="CLOSING_OVERDUE",
                    title="Stock closing overdue",
                    message=f"{shop.name}: the stock closing for {d:%d %b %Y} was due by {st['deadline_time']} the next day and is still missing.",
                    related_record_type="CLOSING_DATE", related_record_id=key))
    db.session.commit()


def expected_stock(business_id, shop_id, product_id, closing_date, prev_closing):
    """Expected = last confirmed physical count + everything that moved since, up to the end of the day.
    With no earlier closing the opening stock is zero and every movement counts."""
    end = day_last_second_utc(closing_date)
    q = db.session.query(func.coalesce(func.sum(StockMovement.quantity_delta), 0)).filter(
        StockMovement.business_id == business_id, StockMovement.shop_id == shop_id,
        StockMovement.product_id == product_id, StockMovement.occurred_at <= end)
    base = Decimal(0)
    if prev_closing is not None:
        after = day_last_second_utc(prev_closing.closing_date)
        q = q.filter(StockMovement.occurred_at > after)
        item = next((i for i in prev_closing.items if i.product_id == product_id), None)
        base = item.physical_quantity if item else Decimal(0)
    return (base + Decimal(str(q.scalar()))).quantize(Q3)


def submit_closing(business_id, user_id, data):
    existing = _existing_by_uuid(StockClosing, business_id, data.get("client_uuid"))
    if existing:
        return existing, False, []
    shop = _get_scoped(Shop, data.get("shop_id"), business_id, "Shop")
    now = utcnow()
    st = closing_status(business_id, shop.id, now)
    cdate = _parse_date(data.get("closing_date") or st["suggested_date"], "closing_date")
    if cdate > local_date(now):
        raise ValidationError("You cannot close a day that has not happened yet")
    if StockClosing.query.filter_by(shop_id=shop.id, closing_date=cdate).first():
        raise ConflictError("This day has already been closed")
    if not st["first_closing"] and cdate.isoformat() != st["next_date"]:
        missing = [x for x in st["outstanding"] if x < cdate.isoformat()] or [st["next_date"]]
        raise ConflictError("Earlier closings must be completed first, in order. Please close "
                            + ", ".join(missing) + " before " + cdate.isoformat() + ".", outstanding=missing)
    counts = data.get("counts")
    if not isinstance(counts, dict):
        raise ValidationError("Enter the physical count for fresh milk, yoghurt and maziwa mala")
    physical = {}
    for ptype in PRODUCT_TYPES:
        if counts.get(ptype) is None or str(counts.get(ptype)).strip() == "":
            raise ValidationError(f"Enter the physical count for {ptype.replace('_', ' ').lower()} (use 0 if none)")
        physical[ptype] = dec(counts[ptype], ptype, positive=False)
        if physical[ptype] < 0:
            raise ValidationError("Counts cannot be negative")

    prev = None if st["first_closing"] else StockClosing.query.filter_by(
        shop_id=shop.id, closing_date=date.fromisoformat(st["last_closed"])).first()
    is_late = now > closing_deadline_utc(business_id, cdate)
    entered_at, synced_at = _entered(data)
    try:
        c = StockClosing(client_uuid=data.get("client_uuid"), business_id=business_id, shop_id=shop.id,
                         closing_date=cdate, status="SUBMITTED", is_late=is_late, is_provisional=False,
                         submitted_by=user_id, entered_at=entered_at, submitted_at=now, synced_at=synced_at,
                         notes=data.get("notes"))
        issues = []
        for ptype in PRODUCT_TYPES:
            product = _product(business_id, ptype)
            exp = expected_stock(business_id, shop.id, product.id, cdate, prev)
            var = (physical[ptype] - exp).quantize(Q3)
            c.items.append(StockClosingItem(business_id=business_id, product_id=product.id, expected_quantity=exp,
                                            physical_quantity=physical[ptype], variance_quantity=var))
            if var != 0:
                issues.append(f"{product.name}: expected {exp} L, counted {physical[ptype]} L ({var:+} L)")
        if issues:
            c.status = "REVIEW_REQUIRED"
        db.session.add(c)
        db.session.flush()
        _audit(business_id, user_id, "CREATE", "STOCK_CLOSING", c.id,
               {"date": str(cdate), "late": is_late, "variances": issues})
        warnings = []
        if issues:
            msg = f"Stock closing for {cdate:%d %b %Y} has differences: " + "; ".join(issues) + "."
            _notify_owners(business_id, "STOCK_DISCREPANCY", "Stock closing discrepancy", msg, "STOCK_CLOSING", c.id)
            warnings.append("Differences were found and the owner has been notified: " + "; ".join(issues) + ".")
        if is_late:
            _notify_owners(business_id, "CLOSING_OVERDUE", "Stock closing submitted late",
                           f"The closing for {cdate:%d %b %Y} was submitted after the deadline.", "STOCK_CLOSING", c.id)
            warnings.append("This closing was submitted after the deadline.")
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return c, True, warnings


def review_closing(business_id, user_id, closing_id, data):
    """Owner decision on a closing with differences: accept the count (adjusting the ledger) or just mark reviewed."""
    c = db.session.get(StockClosing, closing_id)
    if c is None or c.business_id != business_id:
        raise NotFoundError("Closing not found")
    if c.status != "REVIEW_REQUIRED":
        raise ConflictError("This closing does not need review")
    adjust = bool(data.get("adjust"))
    notes = (data.get("notes") or "").strip()
    try:
        if adjust:
            when = day_last_second_utc(c.closing_date)   # same instant as the day boundary: never counted twice
            for it in c.items:
                if it.variance_quantity != 0:
                    adj = StockAdjustment(business_id=business_id, shop_id=c.shop_id, product_id=it.product_id,
                                          closing_item_id=it.id, quantity_delta=it.variance_quantity,
                                          reason=notes or f"Accepted physical count for {c.closing_date}",
                                          approved_by=user_id, approved_at=utcnow())
                    db.session.add(adj)
                    db.session.flush()
                    add_movement(business_id=business_id, product_id=it.product_id,
                                 quantity_delta=it.variance_quantity, movement_type="ADJUSTMENT",
                                 source_type="STOCK_ADJUSTMENT", source_id=adj.id, occurred_at=when,
                                 user_id=user_id, shop_id=c.shop_id)
        c.status = "REVIEWED"
        _audit(business_id, user_id, "REVIEW", "STOCK_CLOSING", c.id,
               {"adjusted": adjust, "notes": notes or None})
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return c
