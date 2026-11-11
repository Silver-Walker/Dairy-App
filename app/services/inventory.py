"""Stock ledger helpers. All stock changes go through add_movement()."""
from decimal import Decimal
from sqlalchemy import func
from ..extensions import db
from ..models import StockMovement


def add_movement(*, business_id, product_id, quantity_delta, movement_type, source_type,
                 source_id, occurred_at, user_id, farm_id=None, shop_id=None):
    if (farm_id is None) == (shop_id is None):
        raise ValueError("A stock movement needs exactly one of farm_id / shop_id")
    m = StockMovement(
        business_id=business_id, product_id=product_id, farm_id=farm_id, shop_id=shop_id,
        movement_type=movement_type, quantity_delta=quantity_delta, source_type=source_type,
        source_id=source_id, occurred_at=occurred_at, created_by=user_id,
    )
    db.session.add(m)
    return m


def balance(*, business_id, product_id, farm_id=None, shop_id=None, up_to=None):
    """Ledger balance at a location, optionally as at a point in time."""
    q = db.session.query(func.coalesce(func.sum(StockMovement.quantity_delta), 0)).filter(
        StockMovement.business_id == business_id,
        StockMovement.product_id == product_id,
    )
    q = q.filter(StockMovement.farm_id == farm_id) if farm_id else q.filter(StockMovement.shop_id == shop_id)
    if up_to is not None:
        q = q.filter(StockMovement.occurred_at <= up_to)
    return Decimal(str(q.scalar()))
