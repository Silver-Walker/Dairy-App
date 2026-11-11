from decimal import Decimal
import uuid

D = Decimal


def stock(client, **q):
    r = client.get("/api/stock", query_string=q)
    assert r.status_code == 200, r.get_json()
    return {i["type"]: D(i["balance_litres"]) for i in r.get_json()["items"]}


def produce(c, app, litres, session="MORNING", date="2026-10-30", **extra):
    return c.post("/api/production", json=dict(farm_id=app.ids["farm"], session=session,
                  production_date=date, quantity_litres=litres, **extra))


def dispatch(c, app, litres, **extra):
    body = dict(farm_id=app.ids["farm"], destination_type="SHOP",
                destination_shop_id=app.ids["shop"], dispatched_at="2026-10-30T08:00:00",
                quantity_litres=litres)
    body.update(extra)
    return c.post("/api/dispatches", json=body)


# ---- AT-001 / AT-002
def test_production_increases_farm_stock(app, milker):
    assert produce(milker, app, "150").status_code == 201
    assert stock(milker, farm_id=app.ids["farm"])["FRESH_MILK"] == D("150")
    farm_items = milker.get(f"/api/stock?farm_id={app.ids['farm']}").get_json()["items"]
    assert [item["type"] for item in farm_items] == ["FRESH_MILK"]


def test_dispatch_to_shop_reduces_farm_stock_and_is_not_revenue(app, milker):
    produce(milker, app, "150")
    r = dispatch(milker, app, "100")
    assert r.status_code == 201
    rec = r.get_json()["record"]
    assert rec["type"] == "TRANSFER" and rec["revenue"] is None
    assert rec["reference"].startswith("DSP-20261030-")
    assert stock(milker, farm_id=app.ids["farm"])["FRESH_MILK"] == D("50")


# ---- AT-003 / AT-004
def test_external_must_be_classified(app, milker):
    produce(milker, app, "50")
    r = dispatch(milker, app, "10", destination_type="EXTERNAL", destination_name="Hotel X",
                 destination_shop_id=None)
    assert r.status_code == 400 and "SALE or NON_SALE" in r.get_json()["error"]


def test_external_non_sale_needs_reason_and_no_revenue(app, milker):
    produce(milker, app, "50")
    base = dict(destination_type="EXTERNAL", destination_name="Household", destination_shop_id=None,
                dispatch_type="NON_SALE")
    assert dispatch(milker, app, "5", **base).status_code == 400
    r = dispatch(milker, app, "5", non_sale_reason="Household use", **base)
    assert r.status_code == 201 and r.get_json()["record"]["revenue"] is None
    assert stock(milker, farm_id=app.ids["farm"])["FRESH_MILK"] == D("45")


def test_external_sale_deducts_once_and_uses_owner_price(app, owner, milker):
    from datetime import datetime, timedelta, timezone
    owner.post("/api/prices", json=dict(product_type="FRESH_MILK", selling_price="60"))
    now = datetime.now(timezone.utc).replace(microsecond=0)
    produce(milker, app, "50", date=(now + timedelta(hours=3)).date().isoformat())
    r = dispatch(milker, app, "30", dispatched_at=now.isoformat(), destination_type="EXTERNAL",
                 destination_name="Hotel X", destination_shop_id=None, dispatch_type="SALE",
                 price_per_litre="999")
    assert r.status_code == 201
    assert r.get_json()["record"]["revenue"] == "1800.00"
    assert stock(milker, farm_id=app.ids["farm"])["FRESH_MILK"] == D("20")  # deducted once


def test_owner_can_record_direct_farm_sale_to_friend(app, owner, milker):
    from datetime import datetime, timedelta, timezone
    owner.post("/api/prices", json=dict(product_type="FRESH_MILK", selling_price="60"))
    now = datetime.now(timezone.utc).replace(microsecond=0)
    produce(milker, app, "50", date=(now + timedelta(hours=3)).date().isoformat())
    assert milker.post("/api/direct-sales", json={}).status_code == 403
    response = owner.post("/api/direct-sales", json=dict(
        farm_id=app.ids["farm"], destination_name="Paul's friend",
        quantity_litres="5", price_per_litre="75", payment_status="UNPAID",
        dispatched_at=now.isoformat()))
    assert response.status_code == 201
    assert response.get_json()["record"]["revenue"] == "375.00"
    assert stock(owner, farm_id=app.ids["farm"])["FRESH_MILK"] == D("45")
    sale_id = response.get_json()["record"]["id"]
    assert owner.get("/api/direct-sales").get_json()["items"][0]["payment_status"] == "UNPAID"
    updated = owner.post(f"/api/direct-sales/{sale_id}/payment", json={"payment_status": "PAID"})
    assert updated.status_code == 200 and updated.get_json()["record"]["payment_status"] == "PAID"


def test_owner_can_record_personal_farm_use_without_revenue(app, owner, milker):
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc).replace(microsecond=0)
    produce(milker, app, "50", date=(now + timedelta(hours=3)).date().isoformat())
    response = owner.post("/api/farm-withdrawals", json=dict(
        farm_id=app.ids["farm"], quantity_litres="5", dispatched_at=now.isoformat()))
    assert response.status_code == 201
    assert response.get_json()["record"]["revenue"] is None
    assert stock(owner, farm_id=app.ids["farm"])["FRESH_MILK"] == D("45")


# ---- AT-005
def test_short_receipt_flags_discrepancy_and_notifies_owner(app, milker, attendant, owner):
    produce(milker, app, "150")
    d = dispatch(milker, app, "100").get_json()["record"]
    r = attendant.post("/api/receipts", json=dict(shop_id=app.ids["shop"], dispatch_id=d["id"],
                       received_at="2026-10-30T09:00:00", quantity_litres="98"))
    assert r.status_code == 201
    assert any("difference -2" in w for w in r.get_json()["warnings"])
    # shop gets what was actually received; farm lost what was sent
    assert stock(attendant, shop_id=app.ids["shop"])["FRESH_MILK"] == D("98")
    assert stock(milker, farm_id=app.ids["farm"])["FRESH_MILK"] == D("50")
    items = owner.get("/api/dispatches/discrepancies").get_json()["items"]
    assert items[0]["status"] == "DISCREPANCY" and items[0]["difference"] == "-2.000"
    # owner notified (owner reads own notifications)
    notes = owner.get("/api/notifications").get_json()["items"]
    assert notes and notes[0]["type"] == "DISPATCH_DISCREPANCY"


def test_dispatch_cannot_be_received_twice(app, milker, attendant):
    produce(milker, app, "50")
    d = dispatch(milker, app, "10").get_json()["record"]
    body = dict(shop_id=app.ids["shop"], dispatch_id=d["id"], received_at="2026-10-30T09:00:00",
                quantity_litres="10")
    assert attendant.post("/api/receipts", json=body).status_code == 201
    assert attendant.post("/api/receipts", json=body).status_code == 409
    assert stock(attendant, shop_id=app.ids["shop"])["FRESH_MILK"] == D("10")


# ---- offline idempotency (AT-022)
def test_replayed_offline_submission_does_not_duplicate(app, milker):
    cu = str(uuid.uuid4())
    r1 = produce(milker, app, "80", client_uuid=cu, entered_at="2026-10-30T06:45:00")
    r2 = produce(milker, app, "80", client_uuid=cu, entered_at="2026-10-30T06:45:00")
    assert r1.status_code == 201 and r2.status_code == 200
    assert stock(milker, farm_id=app.ids["farm"])["FRESH_MILK"] == D("80")


def test_duplicate_session_is_rejected(app, milker):
    assert produce(milker, app, "50").status_code == 201
    assert produce(milker, app, "60").status_code == 409


def test_negative_or_bad_quantity_rejected(app, milker):
    assert produce(milker, app, "-5").status_code == 400
    assert produce(milker, app, "abc").status_code == 400
    assert produce(milker, app, "NaN").status_code == 400


def test_dispatch_beyond_stock_warns_but_records(app, milker):
    r = dispatch(milker, app, "10")
    assert r.status_code == 201 and r.get_json()["warnings"]


# ---- roles & tenant isolation (AT-023)
def test_roles_enforced(app, milker, attendant):
    assert produce(attendant, app, "10").status_code == 403
    assert attendant.post("/api/dispatches", json={}).status_code == 403
    assert milker.post("/api/receipts", json={}).status_code == 403
    assert milker.get("/api/dispatches/discrepancies").status_code == 403


def test_unauthenticated_blocked(app):
    assert app.test_client().get("/api/stock?farm_id=1").status_code == 401


def test_cannot_use_another_business_farm_or_dispatch(app, milker, attendant):
    r = milker.post("/api/production", json=dict(farm_id=app.ids["farm2"], session="MORNING",
                    production_date="2026-10-30", quantity_litres="10"))
    assert r.status_code == 404
    produce(milker, app, "50")
    d = dispatch(milker, app, "10").get_json()["record"]
    other = attendant.post("/api/receipts", json=dict(shop_id=app.ids["shop2"], dispatch_id=d["id"],
                           received_at="2026-10-30T09:00:00", quantity_litres="10"))
    assert other.status_code == 404


def test_ledger_unique_per_event_and_audit_written(app, milker):
    from app.models import AuditLog, StockMovement
    produce(milker, app, "70")
    with app.app_context():
        assert StockMovement.query.count() == 1
        assert AuditLog.query.filter_by(record_type="MILK_PRODUCTION").count() == 1
