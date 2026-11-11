"""First-run setup, account management, login protection, opening stock, in-transit, activity log, backup."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D
import os
import sqlite3
import pytest
from conftest import PW, login
from test_workflow import dispatch, produce, stock

STRONG = "Farm-Fresh-2026"


def client(app, username, password=PW):
    c = app.test_client()
    r = c.post("/auth/login", json={"username": username, "password": password})
    if r.status_code == 200:
        c.environ_base["HTTP_X_TAB_SESSION"] = r.get_json()["session_token"]
    return c, r


def make_user(owner, username="jane", role="MILKER", password="Temp-pass-77", name="Jane Doe"):
    return owner.post("/api/users", json=dict(username=username, full_name=name, role=role, password=password))


# ------------------------------------------------------------------ first-run setup
def test_first_run_setup_creates_owner_once(empty_app):
    c = empty_app.test_client()
    assert c.get("/auth/setup-status").get_json() == {"needs_setup": True}
    assert c.post("/auth/login", json={"username": "x", "password": "y"}).status_code == 401
    body = dict(business_name="Green Acres", full_name="Mary Owner", username="Mary", password=STRONG)
    assert c.post("/auth/setup", json=dict(body, password="short")).status_code == 400
    assert c.post("/auth/setup", json=dict(body, password="password")).status_code == 400      # too easy
    assert c.post("/auth/setup", json=dict(body, username="a b")).status_code == 400
    assert c.post("/auth/setup", json=dict(body, business_name="")).status_code == 400
    r = c.post("/auth/setup", json=body)
    assert r.status_code == 201 and r.get_json()["roles"] == ["OWNER"]
    c.environ_base["HTTP_X_TAB_SESSION"] = r.get_json()["session_token"]
    me = c.get("/auth/me").get_json()                                  # signed in straight away
    assert me["username"] == "mary" and me["business"] == "Green Acres"
    loc = c.get("/api/locations").get_json()
    assert len(loc["farms"]) == 1 and len(loc["shops"]) == 1           # farm + shop created for them
    assert c.get("/auth/setup-status").get_json() == {"needs_setup": False}
    # the setup page is now permanently disabled
    assert empty_app.test_client().post("/auth/setup", json=dict(body, username="hacker")).status_code == 403
    assert client(empty_app, "mary", STRONG)[1].status_code == 200


def test_logins_in_separate_tabs_have_independent_sessions(app):
    owner_client, owner_login = client(app, "owner1", PW)
    milker_client, milker_login = client(app, "milker1", PW)
    assert owner_login.status_code == milker_login.status_code == 200
    assert owner_login.get_json()["session_token"] != milker_login.get_json()["session_token"]
    assert owner_client.get("/auth/me").get_json()["username"] == "owner1"
    assert milker_client.get("/auth/me").get_json()["username"] == "milker1"
    assert milker_client.post("/auth/logout").status_code == 200
    assert owner_client.get("/auth/me").get_json()["username"] == "owner1"


def test_independent_sessions_ignore_shared_browser_cookie(app):
    c = app.test_client()
    c.set_cookie("session", "a-shared-cookie-must-not-authenticate")
    owner_login = c.post("/auth/login", json={"username": "owner1", "password": PW})
    milker_login = c.post("/auth/login", json={"username": "milker1", "password": PW})
    owner_token = owner_login.get_json()["session_token"]
    milker_token = milker_login.get_json()["session_token"]
    assert c.get("/auth/me", headers={"X-Tab-Session": owner_token}).get_json()["username"] == "owner1"
    assert c.get("/auth/me", headers={"X-Tab-Session": milker_token}).get_json()["username"] == "milker1"
    assert c.get("/auth/me").status_code == 401


# ------------------------------------------------------------------ accounts
def test_owner_creates_user_who_must_change_temporary_password(app, owner, milker):
    assert milker.post("/api/users", json={}).status_code == 403
    r = make_user(owner)
    assert r.status_code == 201
    assert make_user(owner).status_code == 409                                              # username taken
    assert make_user(owner, username="bad name").status_code == 400
    assert make_user(owner, username="bob", password="123").status_code == 400
    assert make_user(owner, username="bob", role="BOSS").status_code == 400

    c, login_r = client(app, "jane", "Temp-pass-77")
    assert login_r.status_code == 200 and login_r.get_json()["must_change_password"] is True
    blocked = c.get("/api/locations")
    assert blocked.status_code == 403 and blocked.get_json()["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert c.get("/auth/me").get_json()["must_change_password"] is True                    # allowed
    assert c.post("/auth/change-password", json=dict(current_password="wrong", new_password=STRONG)).status_code == 400
    assert c.post("/auth/change-password", json=dict(current_password="Temp-pass-77", new_password="abc")).status_code == 400
    assert c.post("/auth/change-password", json=dict(current_password="Temp-pass-77", new_password="Temp-pass-77")).status_code == 400
    assert c.post("/auth/change-password", json=dict(current_password="Temp-pass-77", new_password=STRONG)).status_code == 200
    assert c.get("/api/locations").status_code == 200                                       # unlocked now
    assert client(app, "jane", "Temp-pass-77")[1].status_code == 401                        # old password dead
    assert client(app, "jane", STRONG)[1].get_json()["must_change_password"] is False
    listing = {u["username"]: u for u in owner.get("/api/users").get_json()["items"]}
    assert listing["jane"]["roles"] == ["MILKER"] and listing["jane"]["last_login_at"]


def test_users_list_only_shows_own_business_and_cannot_touch_others(app, owner):
    names = {u["username"] for u in owner.get("/api/users").get_json()["items"]}
    assert names == {"owner1", "milker1", "attendant1"}                                      # not x_owner1 ...
    from app.models import User
    with app.app_context():
        other = User.query.filter_by(username="x_milker1").first().id
    assert owner.post(f"/api/users/{other}/active", json={"active": False}).status_code == 404
    assert owner.post(f"/api/users/{other}/reset-password", json={"password": STRONG}).status_code == 404
    assert client(app, "x_milker1")[1].status_code == 200                                    # still works


def test_deactivate_and_reactivate(app, owner, milker):
    from app.models import User
    with app.app_context():
        mid = User.query.filter_by(username="milker1").first().id
        oid = User.query.filter_by(username="owner1").first().id
    assert owner.post(f"/api/users/{oid}/active", json={"active": False}).status_code == 400   # not yourself / last owner
    assert milker.get("/api/locations").status_code == 200
    assert owner.post(f"/api/users/{mid}/active", json={"active": False}).status_code == 200
    assert milker.get("/api/locations").status_code == 401                                      # live session ends at once
    assert client(app, "milker1")[1].status_code == 403                                         # cannot sign in
    assert owner.post(f"/api/users/{mid}/active", json={"active": True}).status_code == 200
    assert client(app, "milker1")[1].status_code == 200


def test_cannot_deactivate_the_only_owner_even_via_second_owner(app, owner):
    make_user(owner, username="boss2", role="OWNER")
    c, r = client(app, "boss2", "Temp-pass-77")
    c.post("/auth/change-password", json=dict(current_password="Temp-pass-77", new_password=STRONG))
    from app.models import User
    with app.app_context():
        o1 = User.query.filter_by(username="owner1").first().id
    assert c.post(f"/api/users/{o1}/active", json={"active": False}).status_code == 200      # two owners: fine
    c2, _ = client(app, "boss2", STRONG)
    from app.models import User as U
    with app.app_context():
        b2 = U.query.filter_by(username="boss2").first().id
    assert c2.post(f"/api/users/{b2}/active", json={"active": False}).status_code == 400     # self


def test_owner_resets_forgotten_password(app, owner):
    assert owner.post("/api/users/%d/reset-password" % 0, json={"password": STRONG}).status_code == 404
    from app.models import User
    with app.app_context():
        mid = User.query.filter_by(username="milker1").first().id
    assert owner.post(f"/api/users/{mid}/reset-password", json={"password": "short"}).status_code == 400
    assert owner.post(f"/api/users/{mid}/reset-password", json={"password": "Brand-new-55"}).status_code == 200
    assert client(app, "milker1", PW)[1].status_code == 401
    c, r = client(app, "milker1", "Brand-new-55")
    assert r.get_json()["must_change_password"] is True


# ------------------------------------------------------------------ login protection
def test_lockout_after_five_wrong_passwords_and_owner_unlock(app, owner):
    for _ in range(5):
        assert client(app, "milker1", "wrong-password")[1].status_code == 401
    c, r = client(app, "milker1", PW)                                     # even the right password is refused now
    assert r.status_code == 429 and "locked" in r.get_json()["error"]
    listing = {u["username"]: u for u in owner.get("/api/users").get_json()["items"]}
    assert listing["milker1"]["locked"] is True
    from app.models import User
    with app.app_context():
        mid = User.query.filter_by(username="milker1").first().id
    assert owner.post(f"/api/users/{mid}/unlock").status_code == 200
    assert client(app, "milker1", PW)[1].status_code == 200


def test_successful_login_resets_the_failure_counter(app):
    for _ in range(4):
        client(app, "milker1", "nope-nope")
    assert client(app, "milker1", PW)[1].status_code == 200
    for _ in range(4):
        client(app, "milker1", "nope-nope")
    assert client(app, "milker1", PW)[1].status_code == 200               # would be locked if the counter was not reset


def test_lockout_expires(app, monkeypatch):
    import app.services.accounts as acc
    for _ in range(5):
        client(app, "milker1", "bad-bad-bad")
    real = acc.utcnow
    monkeypatch.setattr(acc, "utcnow", lambda: real() + timedelta(minutes=16))
    assert client(app, "milker1", PW)[1].status_code == 200


def test_usernames_are_case_insensitive_and_errors_do_not_reveal_which_part_was_wrong(app):
    assert client(app, "  MILKER1 ", PW)[1].status_code == 200
    a = client(app, "milker1", "wrong-pass")[1].get_json()["error"]
    b = client(app, "no-such-user", "wrong-pass")[1].get_json()["error"]
    assert a == b == "Invalid username or password"


# ------------------------------------------------------------------ opening stock
def past(days=1, hours=0):
    return (datetime.now(timezone.utc) - timedelta(days=days, hours=hours)).replace(microsecond=0).isoformat()


def test_opening_stock_feeds_the_ledger_and_the_first_closing(app, owner, attendant):
    shop = app.ids["shop"]
    body = dict(location_type="SHOP", location_id=shop, as_of=past(), items={"FRESH_MILK": "40", "YOGHURT": "5", "MAZIWA_MALA": ""})
    assert attendant.post("/api/opening-stock", json=body).status_code == 403
    r = owner.post("/api/opening-stock", json=body)
    assert r.status_code == 201
    s = stock(owner, shop_id=shop)
    assert s["FRESH_MILK"] == D("40") and s["YOGHURT"] == D("5") and s["MAZIWA_MALA"] == D("0")
    # the first daily closing counts it as expected stock
    today = (datetime.now(timezone.utc) + timedelta(hours=app.config["BUSINESS_UTC_OFFSET_HOURS"])).date().isoformat()
    c = attendant.post("/api/closings", json=dict(shop_id=shop, closing_date=today,
                       counts={"FRESH_MILK": "40", "YOGHURT": "5", "MAZIWA_MALA": "0"}))
    assert c.status_code == 201 and c.get_json()["record"]["status"] == "SUBMITTED"
    # entering it again is refused
    assert owner.post("/api/opening-stock", json=body).status_code == 409
    assert len(owner.get("/api/opening-stock").get_json()["items"]) == 2


def test_opening_stock_validation(app, owner, milker):
    farm = app.ids["farm"]
    base = dict(location_type="FARM", location_id=farm, as_of=past())
    assert owner.post("/api/opening-stock", json=dict(base, items={"YOGHURT": "5"})).status_code == 400     # farm holds milk only
    assert owner.post("/api/opening-stock", json=dict(base, items={"FRESH_MILK": "-1"})).status_code == 400
    assert owner.post("/api/opening-stock", json=dict(base, items={})).status_code == 400
    assert owner.post("/api/opening-stock", json=dict(base, items={"FRESH_MILK": "5"}, as_of=past(-2))).status_code == 400  # future
    assert owner.post("/api/opening-stock", json=dict(location_type="FARM", location_id=app.ids["farm2"], as_of=past(),
                                                      items={"FRESH_MILK": "5"})).status_code == 404       # other business
    produce(milker, app, "10", date=datetime.now(timezone.utc).date().isoformat())
    early = dict(base, as_of=past(days=3), items={"FRESH_MILK": "5"})
    assert owner.post("/api/opening-stock", json=early).status_code == 201                                  # earlier than activity: ok


def test_opening_stock_dated_after_activity_is_refused(app, owner, milker):
    produce(milker, app, "10", date=(datetime.now(timezone.utc) - timedelta(days=2)).date().isoformat())
    r = owner.post("/api/opening-stock", json=dict(location_type="FARM", location_id=app.ids["farm"], as_of=past(0, 1),
                                                   items={"FRESH_MILK": "5"}))
    assert r.status_code == 400 and "activity before" in r.get_json()["error"]


# ------------------------------------------------------------------ stock in transit + revenue
def test_stock_in_transit_is_visible_until_received(app, owner, milker, attendant):
    produce(milker, app, "150")
    d = dispatch(milker, app, "100").get_json()["record"]
    shop = app.ids["shop"]

    def transit():
        row = [i for i in attendant.get(f"/api/stock?shop_id={shop}").get_json()["items"] if i["type"] == "FRESH_MILK"][0]
        return D(row["in_transit_litres"])
    assert transit() == 100
    s = owner.get("/api/dashboard/summary").get_json()
    assert D(s["totals"]["in_transit_litres"]) == 100
    assert any(r["kind"] == "On the way to" and D(r["balance_litres"]) == 100 for r in s["stock"])
    attendant.post("/api/receipts", json=dict(shop_id=shop, dispatch_id=d["id"], received_at="2026-10-30T09:00:00Z", quantity_litres="98"))
    assert transit() == 0
    assert D(owner.get("/api/dashboard/summary").get_json()["totals"]["in_transit_litres"]) == 0


def test_total_revenue_combines_shop_sales_and_external_sales(app, owner, milker, attendant):
    owner.post("/api/prices", json=dict(product_type="FRESH_MILK", selling_price="80"))
    now = datetime.now(timezone.utc).replace(microsecond=0)
    produce(milker, app, "100", date=(now + timedelta(hours=3)).date().isoformat())
    dispatch(milker, app, "20", dispatched_at=now.isoformat(), destination_type="EXTERNAL", destination_name="Hotel",
             destination_shop_id=None, dispatch_type="SALE")                                               # 1,600 external
    d = dispatch(milker, app, "50", dispatched_at=now.isoformat()).get_json()["record"]
    attendant.post("/api/receipts", json=dict(shop_id=app.ids["shop"], dispatch_id=d["id"], received_at=now.isoformat(), quantity_litres="50"))
    attendant.post("/api/sales", json=dict(shop_id=app.ids["shop"], items=[dict(product_type="FRESH_MILK", quantity_litres="10")]))  # 800
    owner.post("/api/direct-sales", json=dict(
        farm_id=app.ids["farm"], destination_name="Owner's buyer", quantity_litres="5",
        price_per_litre="75", payment_status="PAID", dispatched_at=now.isoformat()))  # 375
    t = owner.get("/api/dashboard/summary").get_json()["totals"]
    assert D(t["external_sales_revenue"]) == 1975
    assert D(t["shop_sales_revenue"]) == 800
    assert D(t["total_sales"]) == D(t["total_revenue"]) == 2775


# ------------------------------------------------------------------ activity log
def test_activity_log_records_who_did_what(app, owner, milker, attendant):
    make_user(owner, username="kim")
    produce(milker, app, "30")
    items = owner.get("/api/audit").get_json()["items"]
    kinds = {(i["record_type"], i["action"]) for i in items}
    assert ("USER", "CREATE") in kinds and ("MILK_PRODUCTION", "CREATE") in kinds
    prod = [i for i in items if i["record_type"] == "MILK_PRODUCTION"][0]
    assert prod["user"] == "Milker1" and prod["details"]["litres"] == "30.000"
    assert milker.get("/api/audit").status_code == 403 and attendant.get("/api/audit").status_code == 403


# ------------------------------------------------------------------ backup
def test_backup_command_creates_a_restorable_copy(tmp_path):
    from app import create_app
    from app.extensions import db
    from app.seed import seed_business
    from config import TestConfig

    class FileConfig(TestConfig):
        SQLALCHEMY_DATABASE_URI = f"sqlite:///{tmp_path / 'live.db'}"
    app = create_app(FileConfig)
    with app.app_context():
        db.drop_all(); db.create_all(); seed_business(PW)
    out = tmp_path / "bk"
    r = app.test_cli_runner().invoke(args=["backup", "--folder", str(out), "--keep", "2"])
    assert r.exit_code == 0 and "Backup saved" in r.output
    files = list(out.glob("dairy_*.db"))
    assert len(files) == 1
    con = sqlite3.connect(files[0])
    assert con.execute("select count(*) from users").fetchone()[0] == 3
    con.close()


# ------------------------------------------------------------------ database-level tenant isolation (MySQL only)
def test_database_itself_rejects_cross_business_links(app):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    from app.extensions import db
    if db.engine.dialect.name != "mysql":
        pytest.skip("composite foreign keys exist in the MySQL schema only")
    i = app.ids
    with pytest.raises(IntegrityError):
        db.session.execute(text(
            "INSERT INTO milk_production (business_id, farm_id, session, production_date, quantity_litres, recorded_by, entered_at)"
            f" VALUES ({i['biz']}, {i['farm2']}, 'MORNING', '2026-11-01', 5, 1, NOW())"))
        db.session.commit()
    db.session.rollback()
