import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import pytest
from app import create_app
from app.extensions import db
from app.seed import seed_business
from config import TestConfig

PW = "Test-pass-123"


def _reset(app):
    """SQLite: rebuild. MySQL: empty every table (the schema comes from the .sql file)."""
    from sqlalchemy import text
    if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite"):
        db.drop_all(); db.create_all()
        return
    assert "test" in app.config["SQLALCHEMY_DATABASE_URI"].split("/")[-1], \
        "Refusing to wipe a database whose name does not contain 'test'"
    with db.engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for t in conn.execute(text("SHOW FULL TABLES WHERE Table_type='BASE TABLE'")).fetchall():
            conn.execute(text(f"TRUNCATE TABLE `{t[0]}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))


@pytest.fixture()
def app():
    app = create_app(TestConfig)
    with app.app_context():
        _reset(app)
        b, farm, shop, users = seed_business(PW)
        b2, farm2, shop2, _ = seed_business(PW, name="Other Business", prefix="x_")
        app.ids = dict(biz=b.id, farm=farm.id, shop=shop.id, biz2=b2.id, farm2=farm2.id, shop2=shop2.id)
        yield app
        db.session.remove()


@pytest.fixture()
def empty_app():
    """A brand-new installation: no users, no business (what you see the first time you open the app)."""
    app = create_app(TestConfig)
    with app.app_context():
        _reset(app)
        yield app
        db.session.remove()


def login(app, username):
    c = app.test_client()
    r = c.post("/auth/login", json={"username": username, "password": PW})
    assert r.status_code == 200, r.get_json()
    c.environ_base["HTTP_X_TAB_SESSION"] = r.get_json()["session_token"]
    return c


@pytest.fixture()
def milker(app): return login(app, "milker1")
@pytest.fixture()
def attendant(app): return login(app, "attendant1")
@pytest.fixture()
def owner(app): return login(app, "owner1")
