"""Tests for the read endpoints and the web page that the screens depend on."""
from datetime import datetime, timedelta, timezone
import sqlite3
from decimal import Decimal as D
from app import create_app
from app.extensions import db
from test_workflow import dispatch, produce


def local_today(app):
    off = app.config["BUSINESS_UTC_OFFSET_HOURS"]
    return (datetime.now(timezone.utc) + timedelta(hours=off)).date()


def test_home_page_and_static_files_are_served(app):
    c = app.test_client()
    r = c.get("/")
    assert r.status_code == 200 and b"Dairy Farm Manager" in r.data
    assert r.headers["X-Frame-Options"] == "DENY" and "script-src 'self'" in r.headers["Content-Security-Policy"]
    for path in ("/static/css/style.css", "/static/js/app.js", "/static/js/api.js",
                 "/static/js/charts.js", "/static/vendor/chart.umd.js"):
        assert c.get(path).status_code == 200, path
    # no inline <script> or style="" (the page's security policy forbids them)
    html = r.data.decode()
    assert "<script>" not in html and ' style="' not in html and " onclick=" not in html
    assert "no-store" in r.headers["Cache-Control"]
    assert "no-store" in c.get("/static/js/api.js").headers["Cache-Control"]


def test_existing_sqlite_database_adds_buyer_payment_column(tmp_path):
    database = tmp_path / "legacy.db"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE dispatches (id INTEGER PRIMARY KEY)")

    class LegacySQLiteConfig:
        TESTING = True
        SQLALCHEMY_DATABASE_URI = f"sqlite:///{database}"
        SECRET_KEY = "test"

    legacy_app = create_app(LegacySQLiteConfig)
    with legacy_app.app_context():
        from sqlalchemy import inspect
        columns = {column["name"] for column in inspect(db.engine).get_columns("dispatches")}
        assert "payment_status" in columns


def test_api_responses_are_not_cached(app, milker):
    assert "no-store" in milker.get("/auth/me").headers["Cache-Control"]


def test_me_and_locations(app, milker, owner):
    me = milker.get("/auth/me").get_json()
    assert me["roles"] == ["MILKER"] and me["business"] == "Demo Dairy Business"
    loc = owner.get("/api/locations").get_json()
    assert [f["id"] for f in loc["farms"]] == [app.ids["farm"]]
    assert [s["id"] for s in loc["shops"]] == [app.ids["shop"]]   # never the other business's
    assert app.test_client().get("/auth/me").status_code == 401


def test_lists_show_what_was_recorded(app, milker, attendant):
    produce(milker, app, "100")
    d = dispatch(milker, app, "60").get_json()["record"]
    production = milker.get("/api/production").get_json()["items"][0]
    assert production["quantity_litres"] == "100.000"
    assert production["recorded_by"] == "Milker1"
    row = milker.get("/api/dispatches").get_json()["items"][0]
    assert row["status"] == "NOT_RECEIVED" and row["destination"] == "Main Shop"
    pend = attendant.get("/api/dispatches/pending").get_json()["items"]
    assert [p["id"] for p in pend] == [d["id"]]
    attendant.post("/api/receipts", json=dict(shop_id=app.ids["shop"], dispatch_id=d["id"],
                   received_at="2026-10-30T09:00:00", quantity_litres="58"))
    assert attendant.get("/api/dispatches/pending").get_json()["items"] == []
    rec = attendant.get("/api/receipts").get_json()["items"][0]
    assert rec["difference"] == "-2.000" and rec["reference"] == d["reference"]
    assert attendant.get("/api/production").status_code == 403       # shop attendant cannot see production list


def test_notifications_can_be_marked_read(app, milker, attendant, owner):
    produce(milker, app, "50")
    d = dispatch(milker, app, "10").get_json()["record"]
    attendant.post("/api/receipts", json=dict(shop_id=app.ids["shop"], dispatch_id=d["id"],
                   received_at="2026-10-30T09:00:00", quantity_litres="9"))
    n = owner.get("/api/notifications").get_json()["items"]
    assert len(n) == 1 and n[0]["is_read"] is False
    assert owner.post(f"/api/notifications/{n[0]['id']}/read").status_code == 200
    assert owner.get("/api/notifications").get_json()["items"][0]["is_read"] is True
    # someone else's notification id is not accessible
    assert milker.post(f"/api/notifications/{n[0]['id']}/read").status_code == 404


def test_dashboard_summary_numbers(app, milker, attendant, owner):
    owner.post("/api/prices", json=dict(product_type="FRESH_MILK", selling_price="60"))
    today = local_today(app).isoformat()
    for s, q in (("MORNING", "80"), ("EVENING", "40")):
        assert produce(milker, app, q, session=s, date=today).status_code == 201
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    d = dispatch(milker, app, "50", dispatched_at=now).get_json()["record"]
    attendant.post("/api/receipts", json=dict(shop_id=app.ids["shop"], dispatch_id=d["id"],
                   received_at=now, quantity_litres="48"))
    dispatch(milker, app, "20", dispatched_at=now, destination_type="EXTERNAL", destination_name="Hotel",
             destination_shop_id=None, dispatch_type="SALE")
    dispatch(milker, app, "5", dispatched_at=now, destination_type="EXTERNAL", destination_name="Home",
             destination_shop_id=None, dispatch_type="NON_SALE", non_sale_reason="Household")

    s = owner.get(f"/api/dashboard/summary?from={today}&to={today}").get_json()
    assert s["days"] == [today]
    assert s["production"] == {"MORNING": [80.0], "LUNCH": [0.0], "EVENING": [40.0]}
    assert s["sent_to_shop"] == [50.0] and s["received_at_shop"] == [48.0]
    assert s["external_sales_revenue"] == [1200.0]
    assert s["dispatch_by_type"] == {"TRANSFER": 50.0, "SALE": 20.0, "NON_SALE": 5.0}
    t = s["totals"]
    assert D(t["produced"]) == 120 and D(t["sent_to_shop"]) == 50 and D(t["external_sales_revenue"]) == 1200
    assert t["discrepancies"] == 1 and t["awaiting_receipt"] == 0
    assert s["issues"][0]["difference"] == "-2.000"
    farm = [r for r in s["stock"] if r["kind"] == "Farm" and r["product"] == "Fresh Milk"][0]
    assert D(farm["balance_litres"]) == 120 - 50 - 20 - 5
    assert D([r for r in s["stock"] if r["kind"] == "Shop" and r["product"] == "Fresh Milk"][0]["balance_litres"]) == 48


def test_dashboard_is_owner_only_and_validates_dates(app, milker, owner):
    assert milker.get("/api/dashboard/summary").status_code == 403
    assert owner.get("/api/dashboard/summary?from=2026-10-30&to=2026-10-01").status_code == 400
    assert owner.get("/api/dashboard/summary?from=bad").status_code == 400
    assert owner.get("/api/dashboard/summary?from=2020-01-01&to=2026-10-01").status_code == 400
    r = owner.get("/api/dashboard/summary")     # defaults: last 14 days
    assert r.status_code == 200 and len(r.get_json()["days"]) == 14


def test_evening_production_counts_before_a_late_morning_dispatch(app, milker):
    """Kenya is UTC+3: 08:00 local dispatch must come AFTER 06:00 local morning production."""
    produce(milker, app, "100", session="MORNING", date="2026-10-30")
    r = dispatch(milker, app, "60", dispatched_at="2026-10-30T05:00:00Z")   # = 08:00 in Kenya
    assert r.status_code == 201 and r.get_json()["warnings"] == []
