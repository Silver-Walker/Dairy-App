import click
from flask import Flask, jsonify, request, send_from_directory
from config import Config
from .extensions import db


def create_app(config=Config):
    app = Flask(__name__)
    app.config.from_object(config)
    db.init_app(app)

    from . import auth, routes
    app.register_blueprint(auth.bp)
    app.register_blueprint(routes.bp)

    @app.get("/")
    def home():
        """The whole web interface is one HTML page; JavaScript does the rest."""
        return send_from_directory(app.static_folder, "index.html")

    @app.after_request
    def security_headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "same-origin"
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "connect-src 'self'; frame-ancestors 'none'")
        if request.path.startswith(("/api/", "/auth/")):
            resp.headers["Cache-Control"] = "no-store"   # never cache business data
        elif request.path == "/" or request.path in {
            "/static/js/api.js", "/static/js/app.js", "/static/js/charts.js"
        }:
            resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/health")
    def health():
        return jsonify(status="ok")

    @app.cli.command("seed-demo")
    @click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True)
    def seed_demo(password):
        """Create a demo business with owner/milker/attendant users."""
        from .seed import seed_business
        seed_business(password)
        click.echo("Created users: owner1, milker1, attendant1")

    from . import models  # noqa: F401
    # Only auto-create tables for throw-away SQLite. MySQL tables come from dairy_schema_v1.sql.
    if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite"):
        with app.app_context():
            db.create_all()
            from sqlalchemy import inspect, text
            dispatch_columns = {column["name"] for column in inspect(db.engine).get_columns("dispatches")}
            if "payment_status" not in dispatch_columns:
                with db.engine.begin() as connection:
                    connection.execute(text("ALTER TABLE dispatches ADD COLUMN payment_status VARCHAR(10)"))

    from . import cli
    cli.register(app)

    @app.cli.command("check-db")
    def check_db():
        """Verify the MySQL connection and that the expected tables exist."""
        from sqlalchemy import inspect, text
        expected = {t.name for t in db.metadata.sorted_tables}
        try:
            version = db.session.execute(text("SELECT VERSION()")).scalar()
            found = set(inspect(db.engine).get_table_names())
        except Exception as exc:  # show the real reason, not a stack trace
            click.echo(f"FAILED to connect: {exc.__class__.__name__}: {exc}")
            raise SystemExit(1)
        click.echo(f"Connected. Server version: {version}")
        click.echo(f"Tables in database: {len(found)}")
        missing = sorted(expected - found)
        if missing:
            click.echo("MISSING tables the code needs: " + ", ".join(missing))
            raise SystemExit(1)
        click.echo("OK: every table used by the code exists.")
        try:
            ver = db.session.execute(text("SELECT version FROM schema_version ORDER BY applied_at DESC LIMIT 1")).scalar()
            click.echo(f"Database schema version: {ver}")
        except Exception:
            db.session.rollback()
            if not str(db.engine.url).startswith("sqlite"):
                click.echo("Database schema version: unknown. If this database was made with the old v1 file, "
                           "see database/upgrade/dairy_migrate_v1_to_v2.sql")
    return app
