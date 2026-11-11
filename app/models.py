"""ORM models for the first workflow. Mirrors dairy_schema_v1.sql (the SQL file
also carries CHECK constraints and triggers; remaining tables are added in later phases)."""
from datetime import datetime, timezone
from werkzeug.security import check_password_hash, generate_password_hash
from .extensions import db


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


class Business(db.Model):
    __tablename__ = "businesses"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="ACTIVE")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(255), unique=True)
    password_hash = db.Column(db.String(255), nullable=False)
    full_name = db.Column(db.String(150), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    must_change_password = db.Column(db.Boolean, nullable=False, default=False)
    failed_login_count = db.Column(db.Integer, nullable=False, default=0)
    locked_until = db.Column(db.DateTime)
    last_login_at = db.Column(db.DateTime)
    password_changed_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class AuthSession(db.Model):
    __tablename__ = "auth_sessions"
    token_hash = db.Column(db.String(64), primary_key=True)
    user_id = db.Column(db.ForeignKey("users.id"), nullable=False)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class Membership(db.Model):
    __tablename__ = "business_memberships"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    user_id = db.Column(db.ForeignKey("users.id"), nullable=False)
    role = db.Column(db.String(30), nullable=False)  # OWNER | MILKER | SHOP_ATTENDANT
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (db.UniqueConstraint("business_id", "user_id", "role"),)


class Farm(db.Model):
    __tablename__ = "farms"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    name = db.Column(db.String(150), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)


class Shop(db.Model):
    __tablename__ = "shops"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    name = db.Column(db.String(150), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)


class Product(db.Model):
    __tablename__ = "products"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    product_type = db.Column(db.String(30), nullable=False)  # FRESH_MILK | YOGHURT | MAZIWA_MALA
    unit = db.Column(db.String(20), nullable=False, default="LITRE")
    __table_args__ = (db.UniqueConstraint("business_id", "product_type"),)


class MilkProduction(db.Model):
    __tablename__ = "milk_production"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    client_uuid = db.Column(db.String(36))
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    farm_id = db.Column(db.ForeignKey("farms.id"), nullable=False)
    session = db.Column(db.String(10), nullable=False)
    production_date = db.Column(db.Date, nullable=False)
    quantity_litres = db.Column(db.Numeric(12, 3), nullable=False)
    recorded_by = db.Column(db.ForeignKey("users.id"), nullable=False)
    entered_at = db.Column(db.DateTime, nullable=False)
    synced_at = db.Column(db.DateTime)
    notes = db.Column(db.Text)
    __table_args__ = (
        db.UniqueConstraint("farm_id", "production_date", "session", name="uq_prod_session"),
        db.UniqueConstraint("business_id", "client_uuid", name="uq_prod_client"),
    )


class Dispatch(db.Model):
    __tablename__ = "dispatches"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    reference = db.Column(db.String(30), nullable=False)
    client_uuid = db.Column(db.String(36))
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    farm_id = db.Column(db.ForeignKey("farms.id"), nullable=False)
    destination_type = db.Column(db.String(10), nullable=False)  # SHOP | EXTERNAL
    destination_shop_id = db.Column(db.ForeignKey("shops.id"))
    destination_name = db.Column(db.String(150))
    dispatched_at = db.Column(db.DateTime, nullable=False)
    dispatch_type = db.Column(db.String(10), nullable=False)  # TRANSFER | SALE | NON_SALE
    price_per_litre = db.Column(db.Numeric(12, 2))
    payment_status = db.Column(db.String(10))
    non_sale_reason = db.Column(db.String(255))
    recorded_by = db.Column(db.ForeignKey("users.id"), nullable=False)
    entered_at = db.Column(db.DateTime, nullable=False)
    synced_at = db.Column(db.DateTime)
    notes = db.Column(db.Text)
    items = db.relationship("DispatchItem", backref="dispatch", cascade="all, delete-orphan")
    __table_args__ = (
        db.UniqueConstraint("business_id", "reference", name="uq_dispatch_ref"),
        db.UniqueConstraint("business_id", "client_uuid", name="uq_dispatch_client"),
    )


class DispatchItem(db.Model):
    __tablename__ = "dispatch_items"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    dispatch_id = db.Column(db.ForeignKey("dispatches.id"), nullable=False)
    product_id = db.Column(db.ForeignKey("products.id"), nullable=False)
    quantity_litres = db.Column(db.Numeric(12, 3), nullable=False)
    line_total = db.Column(db.Numeric(14, 2))


class Receipt(db.Model):
    __tablename__ = "receipts"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    client_uuid = db.Column(db.String(36))
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    shop_id = db.Column(db.ForeignKey("shops.id"), nullable=False)
    dispatch_id = db.Column(db.ForeignKey("dispatches.id"), unique=True)
    received_at = db.Column(db.DateTime, nullable=False)
    recorded_by = db.Column(db.ForeignKey("users.id"), nullable=False)
    entered_at = db.Column(db.DateTime, nullable=False)
    synced_at = db.Column(db.DateTime)
    notes = db.Column(db.Text)
    items = db.relationship("ReceiptItem", backref="receipt", cascade="all, delete-orphan")
    __table_args__ = (db.UniqueConstraint("business_id", "client_uuid", name="uq_receipt_client"),)


class ReceiptItem(db.Model):
    __tablename__ = "receipt_items"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    receipt_id = db.Column(db.ForeignKey("receipts.id"), nullable=False)
    product_id = db.Column(db.ForeignKey("products.id"), nullable=False)
    quantity_litres = db.Column(db.Numeric(12, 3), nullable=False)


class StockMovement(db.Model):
    """Ledger: the source of truth for inventory."""
    __tablename__ = "stock_movements"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    product_id = db.Column(db.ForeignKey("products.id"), nullable=False)
    farm_id = db.Column(db.ForeignKey("farms.id"))
    shop_id = db.Column(db.ForeignKey("shops.id"))
    movement_type = db.Column(db.String(30), nullable=False)
    quantity_delta = db.Column(db.Numeric(12, 3), nullable=False)
    source_type = db.Column(db.String(30), nullable=False)
    source_id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), nullable=False)
    occurred_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    created_by = db.Column(db.ForeignKey("users.id"), nullable=False)
    __table_args__ = (
        db.UniqueConstraint("business_id", "source_type", "source_id", "movement_type",
                            name="uq_movement_once"),
    )


class Notification(db.Model):
    __tablename__ = "notifications"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    user_id = db.Column(db.ForeignKey("users.id"), nullable=False)
    notification_type = db.Column(db.String(30), nullable=False)
    title = db.Column(db.String(150), nullable=False)
    message = db.Column(db.Text, nullable=False)
    related_record_type = db.Column(db.String(40))
    related_record_id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"))
    is_read = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    read_at = db.Column(db.DateTime)


class AuditLog(db.Model):
    __tablename__ = "audit_logs"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    user_id = db.Column(db.ForeignKey("users.id"))
    action = db.Column(db.String(40), nullable=False)
    record_type = db.Column(db.String(40), nullable=False)
    record_id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"))
    new_values_json = db.Column(db.JSON)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class BusinessSettings(db.Model):
    __tablename__ = "business_settings"
    business_id = db.Column(db.ForeignKey("businesses.id"), primary_key=True)
    timezone = db.Column(db.String(64), nullable=False, default="Africa/Nairobi")
    closing_deadline_time = db.Column(db.Time, nullable=False, default=lambda: __import__("datetime").time(12, 0))
    discrepancy_threshold_litres = db.Column(db.Numeric(12, 3), nullable=False, default=1)
    currency = db.Column(db.String(3), nullable=False, default="KES")


class ExpenseCategory(db.Model):
    __tablename__ = "expense_categories"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    name = db.Column(db.String(80), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (db.UniqueConstraint("business_id", "name"),)


class ProductPrice(db.Model):
    __tablename__ = "product_prices"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    product_id = db.Column(db.ForeignKey("products.id"), nullable=False)
    selling_price = db.Column(db.Numeric(12, 2), nullable=False)
    effective_from = db.Column(db.DateTime, nullable=False)
    created_by = db.Column(db.ForeignKey("users.id"), nullable=False)


class ProcessingRecord(db.Model):
    __tablename__ = "processing_records"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    client_uuid = db.Column(db.String(36))
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    shop_id = db.Column(db.ForeignKey("shops.id"), nullable=False)
    processed_at = db.Column(db.DateTime, nullable=False)
    recorded_by = db.Column(db.ForeignKey("users.id"), nullable=False)
    entered_at = db.Column(db.DateTime, nullable=False)
    synced_at = db.Column(db.DateTime)
    notes = db.Column(db.Text)
    items = db.relationship("ProcessingItem", backref="processing", cascade="all, delete-orphan")
    __table_args__ = (db.UniqueConstraint("business_id", "client_uuid", name="uq_proc_client"),)


class ProcessingItem(db.Model):
    __tablename__ = "processing_items"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    processing_id = db.Column(db.ForeignKey("processing_records.id"), nullable=False)
    product_id = db.Column(db.ForeignKey("products.id"), nullable=False)
    movement_type = db.Column(db.String(10), nullable=False)  # INPUT | OUTPUT
    quantity_litres = db.Column(db.Numeric(12, 3), nullable=False)
    __table_args__ = (db.UniqueConstraint("processing_id", "product_id", "movement_type", name="uq_proc_item"),)


class Sale(db.Model):
    __tablename__ = "sales"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    client_uuid = db.Column(db.String(36))
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    shop_id = db.Column(db.ForeignKey("shops.id"), nullable=False)
    sale_date = db.Column(db.Date, nullable=False)
    recorded_by = db.Column(db.ForeignKey("users.id"), nullable=False)
    entered_at = db.Column(db.DateTime, nullable=False)
    synced_at = db.Column(db.DateTime)
    notes = db.Column(db.Text)
    items = db.relationship("SaleItem", backref="sale", cascade="all, delete-orphan")
    __table_args__ = (db.UniqueConstraint("business_id", "client_uuid", name="uq_sale_client"),)


class SaleItem(db.Model):
    __tablename__ = "sale_items"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    sale_id = db.Column(db.ForeignKey("sales.id"), nullable=False)
    product_id = db.Column(db.ForeignKey("products.id"), nullable=False)
    quantity_litres = db.Column(db.Numeric(12, 3), nullable=False)
    unit_price = db.Column(db.Numeric(12, 2), nullable=False)
    line_total = db.Column(db.Numeric(14, 2), nullable=False)


class StockLoss(db.Model):
    __tablename__ = "stock_losses"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    client_uuid = db.Column(db.String(36))
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    shop_id = db.Column(db.ForeignKey("shops.id"), nullable=False)
    product_id = db.Column(db.ForeignKey("products.id"), nullable=False)
    quantity_litres = db.Column(db.Numeric(12, 3), nullable=False)
    loss_reason = db.Column(db.String(10), nullable=False)
    occurred_at = db.Column(db.DateTime, nullable=False)
    recorded_by = db.Column(db.ForeignKey("users.id"), nullable=False)
    entered_at = db.Column(db.DateTime, nullable=False)
    synced_at = db.Column(db.DateTime)
    notes = db.Column(db.Text)
    __table_args__ = (db.UniqueConstraint("business_id", "client_uuid", name="uq_loss_client"),)


class StockClosing(db.Model):
    __tablename__ = "stock_closings"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    client_uuid = db.Column(db.String(36))
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    shop_id = db.Column(db.ForeignKey("shops.id"), nullable=False)
    closing_date = db.Column(db.Date, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="SUBMITTED")
    is_late = db.Column(db.Boolean, nullable=False, default=False)
    is_provisional = db.Column(db.Boolean, nullable=False, default=False)
    submitted_by = db.Column(db.ForeignKey("users.id"), nullable=False)
    entered_at = db.Column(db.DateTime, nullable=False)
    submitted_at = db.Column(db.DateTime)
    synced_at = db.Column(db.DateTime)
    notes = db.Column(db.Text)
    items = db.relationship("StockClosingItem", backref="closing", cascade="all, delete-orphan")
    __table_args__ = (db.UniqueConstraint("shop_id", "closing_date", name="uq_closing_day"),
                      db.UniqueConstraint("business_id", "client_uuid", name="uq_closing_client"))


class StockClosingItem(db.Model):
    __tablename__ = "stock_closing_items"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    closing_id = db.Column(db.ForeignKey("stock_closings.id"), nullable=False)
    product_id = db.Column(db.ForeignKey("products.id"), nullable=False)
    expected_quantity = db.Column(db.Numeric(12, 3), nullable=False)
    physical_quantity = db.Column(db.Numeric(12, 3), nullable=False)
    variance_quantity = db.Column(db.Numeric(12, 3), nullable=False)
    __table_args__ = (db.UniqueConstraint("closing_id", "product_id", name="uq_closing_product"),)


class StockAdjustment(db.Model):
    __tablename__ = "stock_adjustments"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    shop_id = db.Column(db.ForeignKey("shops.id"), nullable=False)
    product_id = db.Column(db.ForeignKey("products.id"), nullable=False)
    closing_item_id = db.Column(db.ForeignKey("stock_closing_items.id"))
    quantity_delta = db.Column(db.Numeric(12, 3), nullable=False)
    reason = db.Column(db.String(255), nullable=False)
    approved_by = db.Column(db.ForeignKey("users.id"), nullable=False)
    approved_at = db.Column(db.DateTime, nullable=False)


class OpeningBalance(db.Model):
    __tablename__ = "opening_balances"
    id = db.Column(db.BigInteger().with_variant(db.Integer, "sqlite"), primary_key=True)
    business_id = db.Column(db.ForeignKey("businesses.id"), nullable=False)
    product_id = db.Column(db.ForeignKey("products.id"), nullable=False)
    farm_id = db.Column(db.ForeignKey("farms.id"))
    shop_id = db.Column(db.ForeignKey("shops.id"))
    quantity_litres = db.Column(db.Numeric(12, 3), nullable=False)
    as_of = db.Column(db.DateTime, nullable=False)
    recorded_by = db.Column(db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    __table_args__ = (db.UniqueConstraint("farm_id", "product_id", name="uq_opening_farm"),
                      db.UniqueConstraint("shop_id", "product_id", name="uq_opening_shop"))
