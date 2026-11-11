"""Prices, sales, processing, losses and the daily closing rules (noon deadline, in-order closing)."""
from datetime import datetime
from decimal import Decimal as D
import uuid
import pytest
from test_workflow import dispatch, produce, stock

SHOP_FIELDS = lambda app: dict(shop_id=app.ids["shop"])


@pytest.fixture()
def clock(monkeypatch):
    """Freeze 'now'. Kenya is UTC+3, so 07:00Z = 10:00 local."""
    import app.services.shop as shop_mod
    state = {"now": datetime(2026, 11, 2, 7, 0, 0)}
    monkeypatch.setattr(shop_mod, "utcnow", lambda: state["now"])
    return state


@pytest.fixture()
def stocked(app, owner, milker, attendant, clock):
    """Shop has 100 L fresh milk (received 1 Nov), prices set: milk 80, yoghurt 150, maziwa mala 120."""
    for t, p in (("FRESH_MILK", "80"), ("YOGHURT", "150"), ("MAZIWA_MALA", "120")):
        assert owner.post("/api/prices", json=dict(product_type=t, selling_price=p)).status_code == 201
    produce(milker, app, "200", date="2026-11-01")
    d = dispatch(milker, app, "100", dispatched_at="2026-11-01T05:00:00Z").get_json()["record"]
    r = attendant.post("/api/receipts", json=dict(shop_id=app.ids["shop"], dispatch_id=d["id"],
                       received_at="2026-11-01T06:00:00Z", quantity_litres="100"))
    assert r.status_code == 201
    return attendant


def sale(c, app, items, date="2026-11-01", **extra):
    return c.post("/api/sales", json=dict(shop_id=app.ids["shop"], sale_date=date, items=items, **extra))


def shop_stock(c, app):
    return stock(c, shop_id=app.ids["shop"])


def counts(m, y, z):
    return {"FRESH_MILK": m, "YOGHURT": y, "MAZIWA_MALA": z}


def close(c, app, date, **cnt):
    return c.post("/api/closings", json=dict(shop_id=app.ids["shop"], closing_date=date, counts=counts(**cnt)))


# ---------------------------------------------------------------- prices
def test_only_owner_sets_prices_and_history_is_kept(app, owner, milker, attendant, stocked):
    assert owner.get("/api/prices").status_code == 200
    assert milker.get("/api/prices").status_code == 403
    assert milker.post("/api/prices", json=dict(product_type="FRESH_MILK", selling_price="95")).status_code == 403
    assert attendant.post("/api/prices", json=dict(product_type="YOGHURT", selling_price="1")).status_code == 403
    r = sale(attendant, app, [dict(product_type="FRESH_MILK", quantity_litres="10")])
    assert r.get_json()["record"]["items"][0]["unit_price"] == "80.00"
    assert owner.post("/api/prices", json=dict(product_type="FRESH_MILK", selling_price="90")).status_code == 201
    sale(attendant, app, [dict(product_type="FRESH_MILK", quantity_litres="10")])
    items = [i["unit_price"] for s in attendant.get("/api/sales").get_json()["items"] for i in s["items"]]
    assert sorted(items) == ["80.00", "90.00"]            # AT-008: old sale keeps its old price
    assert {p["product_type"]: p["selling_price"] for p in attendant.get("/api/prices").get_json()["items"]}["FRESH_MILK"] == "90.00"
    assert owner.post("/api/prices", json=dict(product_type="FRESH_MILK", selling_price="-5")).status_code == 400


# ---------------------------------------------------------------- sales
def test_sale_reduces_stock_and_calculates_revenue(app, stocked):
    r = sale(stocked, app, [dict(product_type="FRESH_MILK", quantity_litres="30")])
    assert r.status_code == 201 and r.get_json()["record"]["total"] == "2400.00"
    assert shop_stock(stocked, app)["FRESH_MILK"] == D("70")


def test_same_product_at_two_prices_in_one_sale(app, stocked):
    r = sale(stocked, app, [dict(product_type="FRESH_MILK", quantity_litres="10"),
                            dict(product_type="FRESH_MILK", quantity_litres="5", unit_price="70")])
    rec = r.get_json()["record"]
    assert rec["total"] == "1150.00"                      # 10*80 + 5*70
    assert any("list price" in w for w in r.get_json()["warnings"])


def test_price_deviation_notifies_owner(app, stocked, owner):
    sale(stocked, app, [dict(product_type="FRESH_MILK", quantity_litres="5", unit_price="60")])
    n = owner.get("/api/notifications").get_json()["items"]
    assert any("price differs" in x["title"].lower() for x in n)


def test_sale_validation(app, stocked, owner):
    assert sale(stocked, app, []).status_code == 400
    assert sale(stocked, app, [dict(product_type="FRESH_MILK", quantity_litres="0")]).status_code == 400
    assert sale(stocked, app, [dict(product_type="CHEESE", quantity_litres="1")]).status_code == 400
    assert sale(stocked, app, [dict(product_type="FRESH_MILK", quantity_litres="1")], date="2026-11-09").status_code == 400
    # a product without a price cannot be sold until the owner sets one
    from app.extensions import db
    from app.models import ProductPrice
    ProductPrice.query.filter_by(product_id=2).delete()      # same session as the requests (see MySQL snapshot note)
    db.session.commit()
    r = sale(stocked, app, [dict(product_type="YOGHURT", quantity_litres="1")])
    assert r.status_code == 400 and "No selling price" in r.get_json()["error"]


def test_selling_more_than_stock_warns_but_records(app, stocked):
    r = sale(stocked, app, [dict(product_type="FRESH_MILK", quantity_litres="150")])
    assert r.status_code == 201 and r.get_json()["warnings"]


def test_sale_is_idempotent(app, stocked):
    cu = str(uuid.uuid4())
    a = sale(stocked, app, [dict(product_type="FRESH_MILK", quantity_litres="10")], client_uuid=cu)
    b = sale(stocked, app, [dict(product_type="FRESH_MILK", quantity_litres="10")], client_uuid=cu)
    assert (a.status_code, b.status_code) == (201, 200)
    assert shop_stock(stocked, app)["FRESH_MILK"] == D("90")


# ---------------------------------------------------------------- processing & losses
def test_processing_uses_actual_output_not_input(app, stocked):
    r = stocked.post("/api/processing", json=dict(shop_id=app.ids["shop"], product_type="YOGHURT",
                     input_litres="20", output_litres="18", processed_at="2026-11-01T08:00:00Z"))
    assert r.status_code == 201
    s = shop_stock(stocked, app)
    assert s["FRESH_MILK"] == D("80") and s["YOGHURT"] == D("18")        # AT-006
    assert stocked.get("/api/processing").get_json()["items"][0]["produced"] == "18.000"


def test_processing_validation_and_warnings(app, stocked):
    body = dict(shop_id=app.ids["shop"], processed_at="2026-11-01T08:00:00Z")
    assert stocked.post("/api/processing", json=dict(body, product_type="FRESH_MILK", input_litres="5", output_litres="5")).status_code == 400
    assert stocked.post("/api/processing", json=dict(body, product_type="YOGHURT", input_litres="0", output_litres="5")).status_code == 400
    r = stocked.post("/api/processing", json=dict(body, product_type="MAZIWA_MALA", input_litres="500", output_litres="600"))
    assert r.status_code == 201 and len(r.get_json()["warnings"]) == 2   # over stock + output > input


def test_loss_reduces_stock_and_is_not_a_sale(app, stocked):
    r = stocked.post("/api/losses", json=dict(shop_id=app.ids["shop"], product_type="FRESH_MILK",
                     quantity_litres="3", loss_reason="spoilage", occurred_at="2026-11-01T09:00:00Z"))
    assert r.status_code == 201
    assert shop_stock(stocked, app)["FRESH_MILK"] == D("97")
    assert stocked.get("/api/sales").get_json()["items"] == []
    assert stocked.get("/api/losses").get_json()["items"][0]["reason"] == "SPOILAGE"
    bad = stocked.post("/api/losses", json=dict(shop_id=app.ids["shop"], product_type="FRESH_MILK",
                       quantity_litres="1", loss_reason="theft", occurred_at="2026-11-01T09:00:00Z"))
    assert bad.status_code == 400


def test_attendant_endpoints_closed_to_milker(app, milker):
    for path in ("/api/sales", "/api/losses", "/api/processing", "/api/closings", "/api/prices"):
        assert milker.get(path).status_code == 403, path


# ---------------------------------------------------------------- daily closing
def day1_activity(c, app):
    sale(c, app, [dict(product_type="FRESH_MILK", quantity_litres="30")])
    c.post("/api/processing", json=dict(shop_id=app.ids["shop"], product_type="YOGHURT", input_litres="20",
           output_litres="18", processed_at="2026-11-01T08:00:00Z"))
    c.post("/api/losses", json=dict(shop_id=app.ids["shop"], product_type="FRESH_MILK", quantity_litres="2",
           loss_reason="SPILLAGE", occurred_at="2026-11-01T09:00:00Z"))
    # expected on 1 Nov: milk 100-30-20-2 = 48, yoghurt 18, maziwa mala 0


def test_closing_requires_all_three_counts(app, stocked):
    r = stocked.post("/api/closings", json=dict(shop_id=app.ids["shop"], closing_date="2026-11-01",
                     counts={"FRESH_MILK": "5"}))
    assert r.status_code == 400 and "yoghurt" in r.get_json()["error"]
    assert close(stocked, app, "2026-11-01", m="-1", y="0", z="0").status_code == 400
    assert close(stocked, app, "2026-11-05", m="1", y="0", z="0").status_code == 400   # future day


def test_matching_closing_is_clean(app, stocked, owner):
    day1_activity(stocked, app)
    r = close(stocked, app, "2026-11-01", m="48", y="18", z="0")
    assert r.status_code == 201
    rec = r.get_json()["record"]
    assert rec["status"] == "SUBMITTED" and not rec["is_late"]
    assert [i["variance"] for i in rec["items"]] == ["0.000"] * 3
    assert not any("closing" in n["title"].lower() for n in owner.get("/api/notifications").get_json()["items"])
    assert close(stocked, app, "2026-11-01", m="48", y="18", z="0").status_code == 409   # already closed


def test_discrepancy_flags_review_and_notifies_owner(app, stocked, owner):
    day1_activity(stocked, app)
    r = close(stocked, app, "2026-11-01", m="47", y="18", z="0")           # 1 L short
    rec = r.get_json()["record"]
    assert rec["status"] == "REVIEW_REQUIRED" and rec["items"][0]["variance"] == "-1.000"
    assert r.get_json()["warnings"]
    n = owner.get("/api/notifications").get_json()["items"]
    assert any(x["type"] == "STOCK_DISCREPANCY" and "closing" in x["title"].lower() for x in n)


def test_confirmed_physical_count_becomes_next_days_opening_stock(app, stocked, owner):
    day1_activity(stocked, app)
    close(stocked, app, "2026-11-01", m="47", y="18", z="0")               # physical 47, expected was 48
    sale(stocked, app, [dict(product_type="FRESH_MILK", quantity_litres="5")], date="2026-11-02")
    r = close(stocked, app, "2026-11-02", m="42", y="18", z="0")           # 47 - 5 = 42, not 43
    rec = r.get_json()["record"]
    assert rec["items"][0]["expected"] == "42.000" and rec["status"] == "SUBMITTED"


def test_days_must_be_closed_in_order(app, stocked, clock):
    day1_activity(stocked, app)
    close(stocked, app, "2026-11-01", m="48", y="18", z="0")
    clock["now"] = datetime(2026, 11, 4, 10, 0, 0)                         # 13:00 local on 4 Nov
    st = stocked.get(f"/api/closings/status?shop_id={stocked.application.ids['shop']}").get_json()
    assert st["outstanding"] == ["2026-11-02", "2026-11-03"] and st["provisional"] is True
    assert st["overdue"] == ["2026-11-02", "2026-11-03"]                   # both past their noon deadline
    r = close(stocked, app, "2026-11-04", m="48", y="18", z="0")
    assert r.status_code == 409 and "2026-11-02" in r.get_json()["error"]
    # transactions are still allowed while a closing is missing
    assert sale(stocked, app, [dict(product_type="FRESH_MILK", quantity_litres="1")], date="2026-11-04").status_code == 201


def test_late_closing_is_flagged_and_chain_continues(app, stocked, owner, clock):
    day1_activity(stocked, app)
    close(stocked, app, "2026-11-01", m="48", y="18", z="0")
    clock["now"] = datetime(2026, 11, 4, 10, 0, 0)
    late = close(stocked, app, "2026-11-02", m="48", y="18", z="0")
    assert late.status_code == 201 and late.get_json()["record"]["is_late"] is True
    ok = close(stocked, app, "2026-11-03", m="48", y="18", z="0")
    assert ok.status_code == 201 and ok.get_json()["record"]["is_late"] is True
    st = stocked.get(f"/api/closings/status?shop_id={app.ids['shop']}").get_json()
    assert st["outstanding"] == [] and st["provisional"] is False and st["next_date"] == "2026-11-04"
    assert any("late" in n["title"].lower() for n in owner.get("/api/notifications").get_json()["items"])


def test_deadline_is_noon_next_day_and_alerts_are_not_duplicated(app, stocked, owner, clock):
    day1_activity(stocked, app)
    close(stocked, app, "2026-11-01", m="48", y="18", z="0")
    sid = app.ids["shop"]
    clock["now"] = datetime(2026, 11, 3, 8, 59, 0)                         # 11:59 local on 3 Nov
    assert stocked.get(f"/api/closings/status?shop_id={sid}").get_json()["overdue"] == []
    clock["now"] = datetime(2026, 11, 3, 9, 1, 0)                          # 12:01 local
    assert stocked.get(f"/api/closings/status?shop_id={sid}").get_json()["overdue"] == ["2026-11-02"]
    for who in (stocked, owner):
        stocked.get("/api/notifications"); owner.get("/api/notifications")
        items = who.get("/api/notifications").get_json()["items"]
        assert len([i for i in items if i["type"] == "CLOSING_OVERDUE"]) == 1, "alert once per person"


def test_owner_review_accepting_count_adjusts_ledger_once(app, stocked, owner, attendant):
    day1_activity(stocked, app)
    c = close(stocked, app, "2026-11-01", m="47", y="18", z="0").get_json()["record"]
    assert attendant.post(f"/api/closings/{c['id']}/review", json={"adjust": True}).status_code == 403
    assert shop_stock(stocked, app)["FRESH_MILK"] == D("48")               # ledger still says 48
    assert owner.post(f"/api/closings/{c['id']}/review", json={"adjust": True, "notes": "Spillage"}).status_code == 200
    assert shop_stock(stocked, app)["FRESH_MILK"] == D("47")               # now aligned with the count
    assert owner.post(f"/api/closings/{c['id']}/review", json={"adjust": True}).status_code == 409
    # the adjustment must not be double counted in the next day's expected stock
    sale(stocked, app, [dict(product_type="FRESH_MILK", quantity_litres="5")], date="2026-11-02")
    r = close(stocked, app, "2026-11-02", m="42", y="18", z="0").get_json()["record"]
    assert r["status"] == "SUBMITTED" and r["items"][0]["expected"] == "42.000"
    assert shop_stock(stocked, app)["FRESH_MILK"] == D("42")               # ledger and physical agree


def test_entry_added_to_a_closed_day_is_flagged_not_overwritten(app, stocked, owner):
    day1_activity(stocked, app)
    close(stocked, app, "2026-11-01", m="48", y="18", z="0")
    r = stocked.post("/api/losses", json=dict(shop_id=app.ids["shop"], product_type="FRESH_MILK",
                     quantity_litres="1", loss_reason="OTHER", occurred_at="2026-11-01T10:00:00Z"))
    assert r.status_code == 201 and any("after that day was closed" in w for w in r.get_json()["warnings"])
    assert any("closed day" in n["title"].lower() for n in owner.get("/api/notifications").get_json()["items"])
    closing = stocked.get("/api/closings").get_json()["items"][0]
    assert closing["items"][0]["physical"] == "48.000"                     # the confirmed count is untouched


def test_dashboard_includes_shop_figures(app, stocked, owner):
    sale(stocked, app, [dict(product_type="FRESH_MILK", quantity_litres="10"),
                        dict(product_type="YOGHURT", quantity_litres="0.5")], date="2026-11-02")
    stocked.post("/api/losses", json=dict(shop_id=app.ids["shop"], product_type="FRESH_MILK", quantity_litres="2",
                 loss_reason="SPOILAGE", occurred_at="2026-11-02T04:00:00Z"))
    s = owner.get("/api/dashboard/summary?from=2026-11-01&to=2026-11-02").get_json()
    assert s["shop_sales"]["Fresh Milk"] == [0.0, 800.0] and s["shop_sales"]["Yoghurt"] == [0.0, 75.0]
    assert D(s["totals"]["shop_sales_revenue"]) == 875 and D(s["totals"]["losses_litres"]) == 2
    assert s["totals"]["closings_to_review"] == 0
