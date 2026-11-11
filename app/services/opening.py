"""Opening stock: the milk, yoghurt and maziwa mala already on hand when a business starts using the system."""
from ..extensions import db
from ..models import Farm, OpeningBalance, Product, Shop, StockMovement, User, utcnow
from .errors import ConflictError, ValidationError
from .inventory import add_movement
from .workflow import _audit, _get_scoped, _product, dec, parse_dt
from datetime import timedelta

PTYPES = ("FRESH_MILK", "YOGHURT", "MAZIWA_MALA")


def record_opening_stock(business_id, user_id, data):
    kind = str(data.get("location_type") or "").upper()
    if kind == "FARM":
        loc = _get_scoped(Farm, data.get("location_id"), business_id, "Farm")
    elif kind == "SHOP":
        loc = _get_scoped(Shop, data.get("location_id"), business_id, "Shop")
    else:
        raise ValidationError("location_type must be FARM or SHOP")
    as_of = parse_dt(data.get("as_of"), "as_of")
    if as_of > utcnow() + timedelta(minutes=5):
        raise ValidationError("The opening stock date cannot be in the future")
    items = data.get("items")
    if not isinstance(items, dict):
        raise ValidationError("Enter the quantities you have on hand")
    wanted = {}
    for ptype, raw in items.items():
        ptype = str(ptype).upper()
        if ptype not in PTYPES:
            raise ValidationError(f"Unknown product {ptype}")
        if raw is None or str(raw).strip() == "":
            continue
        if kind == "FARM" and ptype != "FRESH_MILK":
            raise ValidationError("Only fresh milk is held at the farm")
        qty = dec(raw, ptype, positive=False)
        if qty < 0:
            raise ValidationError("Quantities cannot be negative")
        wanted[ptype] = qty
    if not wanted:
        raise ValidationError("Enter at least one quantity (use 0 if you have none)")

    col = OpeningBalance.farm_id if kind == "FARM" else OpeningBalance.shop_id
    mcol = StockMovement.farm_id if kind == "FARM" else StockMovement.shop_id
    products = {t: _product(business_id, t) for t in wanted}
    for t, p in products.items():
        if OpeningBalance.query.filter(col == loc.id, OpeningBalance.product_id == p.id).first():
            raise ConflictError(f"Opening stock for {p.name} at {loc.name} was already entered. "
                                "Use a stock adjustment (from a daily closing) to change stock later.")
        if StockMovement.query.filter(mcol == loc.id, StockMovement.product_id == p.id,
                                      StockMovement.occurred_at < as_of).first():
            raise ValidationError(f"{p.name} at {loc.name} already has activity before that date. "
                                  "Choose an earlier date for the opening stock.")
    try:
        for t, qty in wanted.items():
            p = products[t]
            row = OpeningBalance(business_id=business_id, product_id=p.id, quantity_litres=qty, as_of=as_of,
                                 recorded_by=user_id, farm_id=loc.id if kind == "FARM" else None,
                                 shop_id=loc.id if kind == "SHOP" else None)
            db.session.add(row)
            db.session.flush()
            if qty > 0:
                add_movement(business_id=business_id, product_id=p.id, quantity_delta=qty,
                             movement_type="OPENING_BALANCE", source_type="OPENING_BALANCE", source_id=row.id,
                             occurred_at=as_of, user_id=user_id,
                             farm_id=loc.id if kind == "FARM" else None, shop_id=loc.id if kind == "SHOP" else None)
        _audit(business_id, user_id, "CREATE", "OPENING_STOCK", loc.id,
               {"location": f"{kind}:{loc.name}", "items": {k: str(v) for k, v in wanted.items()}})
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return list_opening(business_id)


def list_opening(business_id):
    names = {p.id: p.name for p in Product.query.filter_by(business_id=business_id)}
    farms = {f.id: f.name for f in Farm.query.filter_by(business_id=business_id)}
    shops = {s.id: s.name for s in Shop.query.filter_by(business_id=business_id)}
    out = []
    for r in OpeningBalance.query.filter_by(business_id=business_id).order_by(OpeningBalance.id).all():
        out.append({"id": r.id, "location": ("Farm: " + farms[r.farm_id]) if r.farm_id else ("Shop: " + shops[r.shop_id]),
                    "product": names[r.product_id], "quantity_litres": str(r.quantity_litres),
                    "as_of": r.as_of.isoformat() + "Z"})
    return out
