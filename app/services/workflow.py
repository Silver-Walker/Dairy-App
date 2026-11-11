"""Business operations: production, dispatch, receipt.
Each function runs in ONE database transaction: the record, its stock movements,
the audit entry and any notifications commit together or not at all."""
import re
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation

from flask import current_app
from ..extensions import db
from sqlalchemy import func
from ..models import (AuditLog, Dispatch, DispatchItem, Farm, Membership, MilkProduction,
                      Notification, Product, ProductPrice, Receipt, ReceiptItem, Shop,
                      StockClosing, utcnow)
from .errors import ConflictError, NotFoundError, ValidationError
from .inventory import add_movement, balance

SESSIONS = {"MORNING": time(6, 0), "LUNCH": time(12, 0), "EVENING": time(18, 0)}
Q3 = Decimal("0.001")
Q2 = Decimal("0.01")


# ---------- helpers ----------
def offset():
    return timedelta(hours=current_app.config["BUSINESS_UTC_OFFSET_HOURS"])


def local_date(dt):
    """UTC datetime -> the calendar date on the wall clock of the business."""
    return (dt + offset()).date()


def day_start_utc(d):
    return datetime.combine(d, time.min) - offset()


def day_last_second_utc(d):
    """The last second of local day d, expressed in UTC."""
    return day_start_utc(d + timedelta(days=1)) - timedelta(seconds=1)


def note_backdated(business_id, shop_id, occurred_at, what, rtype, rid):
    """If a stock entry lands on a day that is already closed, tell the owner (never overwrite)."""
    last = db.session.query(func.max(StockClosing.closing_date)).filter(StockClosing.shop_id == shop_id).scalar()
    if last and local_date(occurred_at) <= last:
        msg = (f"{what} dated {local_date(occurred_at)} was recorded after that day was closed. "
               f"The closing figures up to {last} may need review.")
        _notify_owners(business_id, "STOCK_DISCREPANCY", "Entry added to a closed day", msg, rtype, rid)
        return msg
    return None

def dec(value, field, *, positive=True):
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValidationError(f"{field} must be a number")
    if not d.is_finite():
        raise ValidationError(f"{field} must be a number")
    if positive and d <= 0:
        raise ValidationError(f"{field} must be greater than zero")
    return d.quantize(Q3)


def parse_dt(value, field):
    if not value:
        raise ValidationError(f"{field} is required")
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise ValidationError(f"{field} must be an ISO date/time")
    if d.tzinfo:
        d = d.astimezone(timezone.utc).replace(tzinfo=None)
    return d


def _entered(data):
    """Original (possibly offline) entry time + server sync time."""
    if data.get("entered_at"):
        return parse_dt(data["entered_at"], "entered_at"), utcnow()
    return utcnow(), None


def _get_scoped(model, obj_id, business_id, label):
    obj = db.session.get(model, obj_id) if obj_id else None
    if obj is None or obj.business_id != business_id:
        raise NotFoundError(f"{label} not found")
    return obj


def _product(business_id, ptype="FRESH_MILK"):
    p = Product.query.filter_by(business_id=business_id, product_type=ptype).first()
    if not p:
        raise NotFoundError(f"{ptype} product is not configured")
    return p


def _audit(business_id, user_id, action, record_type, record_id, values):
    db.session.add(AuditLog(business_id=business_id, user_id=user_id, action=action,
                            record_type=record_type, record_id=record_id, new_values_json=values))


def _notify_owners(business_id, ntype, title, message, rtype, rid):
    owners = Membership.query.filter_by(business_id=business_id, role="OWNER", is_active=True).all()
    for m in owners:
        db.session.add(Notification(business_id=business_id, user_id=m.user_id,
                                    notification_type=ntype, title=title, message=message,
                                    related_record_type=rtype, related_record_id=rid))


def _existing_by_uuid(model, business_id, client_uuid):
    if not client_uuid:
        return None
    return model.query.filter_by(business_id=business_id, client_uuid=client_uuid).first()


# ---------- production ----------
def record_production(business_id, user_id, data):
    existing = _existing_by_uuid(MilkProduction, business_id, data.get("client_uuid"))
    if existing:
        return existing, False, []  # idempotent replay of an offline submission

    farm = _get_scoped(Farm, data.get("farm_id"), business_id, "Farm")
    session = str(data.get("session", "")).upper()
    if session not in SESSIONS:
        raise ValidationError("session must be MORNING, LUNCH or EVENING")
    qty = dec(data.get("quantity_litres"), "quantity_litres")
    try:
        pdate = datetime.fromisoformat(str(data.get("production_date"))).date()
    except ValueError:
        raise ValidationError("production_date must be YYYY-MM-DD")

    if MilkProduction.query.filter_by(farm_id=farm.id, production_date=pdate, session=session).first():
        raise ConflictError("Production for this farm, date and session already exists. "
                            "Submit a correction request instead.")
    entered_at, synced_at = _entered(data)
    try:
        rec = MilkProduction(client_uuid=data.get("client_uuid"), business_id=business_id,
                             farm_id=farm.id, session=session, production_date=pdate,
                             quantity_litres=qty, recorded_by=user_id, entered_at=entered_at,
                             synced_at=synced_at, notes=data.get("notes"))
        db.session.add(rec)
        db.session.flush()
        add_movement(business_id=business_id, product_id=_product(business_id).id,
                     quantity_delta=qty, movement_type="PRODUCTION", source_type="MILK_PRODUCTION",
                     source_id=rec.id, occurred_at=datetime.combine(pdate, SESSIONS[session])
                                 - timedelta(hours=current_app.config["BUSINESS_UTC_OFFSET_HOURS"]),
                     user_id=user_id, farm_id=farm.id)
        _audit(business_id, user_id, "CREATE", "MILK_PRODUCTION", rec.id,
               {"session": session, "date": str(pdate), "litres": str(qty)})
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return rec, True, []


# ---------- dispatch ----------
def _next_reference(business_id, when):
    prefix = f"DSP-{when:%Y%m%d}-"
    n = Dispatch.query.filter(Dispatch.business_id == business_id,
                              Dispatch.reference.like(prefix + "%")).count() + 1
    return f"{prefix}{n:04d}"


def record_dispatch(business_id, user_id, data, *, owner_direct=False):
    existing = _existing_by_uuid(Dispatch, business_id, data.get("client_uuid"))
    if existing:
        return existing, False, []

    farm = _get_scoped(Farm, data.get("farm_id"), business_id, "Farm")
    qty = dec(data.get("quantity_litres"), "quantity_litres")
    when = parse_dt(data.get("dispatched_at"), "dispatched_at")
    dest = str(data.get("destination_type", "")).upper()

    shop_id = price = reason = dest_name = payment_status = None
    line_total = None
    product = _product(business_id)
    if dest == "SHOP":
        shop = _get_scoped(Shop, data.get("destination_shop_id"), business_id, "Destination shop")
        shop_id, dtype = shop.id, "TRANSFER"
    elif dest == "EXTERNAL":
        dest_name = (data.get("destination_name") or "").strip()
        if not dest_name:
            raise ValidationError("destination_name is required for external dispatches")
        dtype = str(data.get("dispatch_type", "")).upper()
        if dtype not in ("SALE", "NON_SALE"):
            raise ValidationError("External dispatches must be classified as SALE or NON_SALE")
        if dtype == "SALE":
            if owner_direct and data.get("price_per_litre") not in (None, ""):
                price = dec(data["price_per_litre"], "price_per_litre").quantize(Q2)
            else:
                configured_price = (ProductPrice.query.filter(
                    ProductPrice.business_id == business_id,
                    ProductPrice.product_id == product.id,
                    ProductPrice.effective_from <= when)
                    .order_by(ProductPrice.effective_from.desc(), ProductPrice.id.desc())
                    .first())
                if not configured_price:
                    raise ValidationError(
                        "The owner must set a fresh milk price under Prices before recording an external sale")
                price = configured_price.selling_price
            line_total = (qty * price).quantize(Q2)
        if owner_direct:
            payment_status = str(data.get("payment_status", "")).upper()
            if payment_status not in ("PAID", "UNPAID"):
                raise ValidationError("payment_status must be PAID or UNPAID")
        else:
            payment_status = None
        if dtype == "NON_SALE":
            reason = (data.get("non_sale_reason") or "").strip()
            if not reason:
                raise ValidationError("non_sale_reason is required when the dispatch is not a sale")
    else:
        raise ValidationError("destination_type must be SHOP or EXTERNAL")

    warnings = []
    if balance(business_id=business_id, product_id=product.id, farm_id=farm.id, up_to=when) < qty:
        warnings.append("Dispatch exceeds recorded farm stock at that time; check production entries.")

    entered_at, synced_at = _entered(data)
    try:
        d = Dispatch(reference=_next_reference(business_id, when), client_uuid=data.get("client_uuid"),
                     business_id=business_id, farm_id=farm.id, destination_type=dest,
                     destination_shop_id=shop_id, destination_name=dest_name, dispatched_at=when,
                     dispatch_type=dtype, price_per_litre=price, payment_status=payment_status,
                     non_sale_reason=reason,
                     recorded_by=user_id, entered_at=entered_at, synced_at=synced_at,
                     notes=data.get("notes"))
        d.items.append(DispatchItem(business_id=business_id, product_id=product.id, quantity_litres=qty, line_total=line_total))
        db.session.add(d)
        db.session.flush()
        # ONE farm deduction per dispatch, regardless of type (sale or not).
        add_movement(business_id=business_id, product_id=product.id, quantity_delta=-qty,
                     movement_type="DISPATCH", source_type="DISPATCH_ITEM", source_id=d.items[0].id,
                     occurred_at=when, user_id=user_id, farm_id=farm.id)
        _audit(business_id, user_id, "CREATE", "DISPATCH", d.id,
               {"reference": d.reference, "type": dtype, "litres": str(qty),
                "revenue": str(line_total) if line_total is not None else None})
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return d, True, warnings


def update_direct_sale_payment(business_id, user_id, dispatch_id, data):
    dispatch = Dispatch.query.filter_by(id=dispatch_id, business_id=business_id,
                                        destination_type="EXTERNAL", dispatch_type="SALE").first()
    if not dispatch:
        raise NotFoundError("Buyer sale not found")
    status = str(data.get("payment_status", "")).upper()
    if status not in ("PAID", "UNPAID"):
        raise ValidationError("payment_status must be PAID or UNPAID")
    if dispatch.payment_status == status:
        return dispatch
    old_status = dispatch.payment_status
    try:
        dispatch.payment_status = status
        _audit(business_id, user_id, "UPDATE", "DIRECT_FARM_SALE", dispatch.id,
               {"payment_status": {"old": old_status, "new": status}})
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return dispatch


# ---------- receipt ----------
def record_receipt(business_id, user_id, data):
    existing = _existing_by_uuid(Receipt, business_id, data.get("client_uuid"))
    if existing:
        return existing, False, []

    shop = _get_scoped(Shop, data.get("shop_id"), business_id, "Shop")
    qty = dec(data.get("quantity_litres"), "quantity_litres", positive=False)
    if qty < 0:
        raise ValidationError("quantity_litres cannot be negative")
    received_at = parse_dt(data.get("received_at"), "received_at")

    dispatch = None
    if data.get("dispatch_id"):
        dispatch = _get_scoped(Dispatch, data["dispatch_id"], business_id, "Dispatch")
        if dispatch.destination_type != "SHOP" or dispatch.destination_shop_id != shop.id:
            raise ValidationError("This dispatch was not sent to this shop")
        if Receipt.query.filter_by(dispatch_id=dispatch.id).first():
            raise ConflictError("This dispatch has already been received")

    product = _product(business_id)
    entered_at, synced_at = _entered(data)
    warnings = []
    try:
        r = Receipt(client_uuid=data.get("client_uuid"), business_id=business_id, shop_id=shop.id,
                    dispatch_id=dispatch.id if dispatch else None, received_at=received_at,
                    recorded_by=user_id, entered_at=entered_at, synced_at=synced_at,
                    notes=data.get("notes"))
        r.items.append(ReceiptItem(business_id=business_id, product_id=product.id, quantity_litres=qty))
        db.session.add(r)
        db.session.flush()
        # Shop stock increases by what was ACTUALLY received.
        add_movement(business_id=business_id, product_id=product.id, quantity_delta=qty,
                     movement_type="RECEIPT", source_type="RECEIPT_ITEM", source_id=r.items[0].id,
                     occurred_at=received_at, user_id=user_id, shop_id=shop.id)
        _audit(business_id, user_id, "CREATE", "RECEIPT", r.id,
               {"dispatch": dispatch.reference if dispatch else None, "litres": str(qty)})

        if dispatch:
            sent = dispatch.items[0].quantity_litres
            diff = qty - sent
            if diff != 0:
                msg = (f"{dispatch.reference}: dispatched {sent} L, received {qty} L "
                       f"(difference {diff:+} L).")
                warnings.append(msg)
                _notify_owners(business_id, "DISPATCH_DISCREPANCY", "Dispatch discrepancy", msg,
                               "DISPATCH", dispatch.id)
        else:
            warnings.append("Receipt is not linked to a dispatch; it cannot be reconciled.")
        late = note_backdated(business_id, shop.id, received_at, "Milk receipt", "RECEIPT", r.id)
        if late:
            warnings.append(late)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return r, True, warnings


def dispatch_discrepancies(business_id):
    out = []
    for d in Dispatch.query.filter_by(business_id=business_id, destination_type="SHOP") \
                           .order_by(Dispatch.dispatched_at.desc()).all():
        sent = d.items[0].quantity_litres
        rec = Receipt.query.filter_by(dispatch_id=d.id).first()
        if rec is None:
            status, received, diff = "NOT_RECEIVED", None, None
        else:
            received = rec.items[0].quantity_litres
            diff = received - sent
            status = "MATCHED" if diff == 0 else "DISCREPANCY"
        out.append({"dispatch_id": d.id, "reference": d.reference, "dispatched": str(sent),
                    "received": None if received is None else str(received),
                    "difference": None if diff is None else str(diff), "status": status})
    return out
