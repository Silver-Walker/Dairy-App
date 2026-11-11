"""Commands for managing users from the terminal (no code editing needed).
    flask --app wsgi list-users
    flask --app wsgi create-user
    flask --app wsgi reset-password
Passwords are never stored in the code or the database as text, only as a secure hash."""
import glob
import os
import shutil
import sqlite3
import subprocess
from datetime import datetime

import click
from sqlalchemy.engine import make_url

from .extensions import db
from .models import Business, Membership, User
from .services import accounts
from .services.errors import ServiceError

ROLES = ["OWNER", "MILKER", "SHOP_ATTENDANT"]


def _business(business_id):
    if business_id:
        b = db.session.get(Business, business_id)
        if not b:
            raise click.ClickException(f"No business with id {business_id}.")
        return b
    all_b = Business.query.all()
    if len(all_b) == 1:
        return all_b[0]
    raise click.ClickException("There are no businesses yet (run seed-demo first)." if not all_b else
                               "More than one business exists; add --business-id.")


def register(app):
    @app.cli.command("list-users")
    def list_users():
        """Show every user, role and whether the account is active (passwords are never shown)."""
        rows = (db.session.query(User, Membership, Business)
                .join(Membership, Membership.user_id == User.id)
                .join(Business, Business.id == Membership.business_id).order_by(User.id).all())
        if not rows:
            click.echo("No users yet. Run: flask --app wsgi seed-demo")
        for u, m, b in rows:
            click.echo(f"{u.username:<15} {m.role:<15} {'active' if u.is_active and m.is_active else 'DISABLED':<9} "
                       f"{u.full_name}  [{b.name}]")

    @app.cli.command("create-user")
    @click.option("--username", prompt=True)
    @click.option("--full-name", prompt="Full name")
    @click.option("--role", prompt=True, type=click.Choice(ROLES, case_sensitive=False))
    @click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True)
    @click.option("--business-id", type=int, default=None)
    def create_user(username, full_name, role, password, business_id):
        """Add a new user. They must change this temporary password the first time they sign in."""
        b = _business(business_id)
        try:
            u = accounts.create_user(b.id, None, {"username": username, "full_name": full_name,
                                                  "role": role, "password": password})
        except ServiceError as e:
            raise click.ClickException(e.message)
        click.echo(f"Created {role.upper()} '{u.username}' in {b.name}.")

    @app.cli.command("reset-password")
    @click.option("--username", prompt=True)
    @click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True)
    def reset_password(username, password):
        """Set a new password for an existing user (use this if a password is forgotten)."""
        u = User.query.filter_by(username=username.strip()).first()
        if not u:
            raise click.ClickException("No such user. See: flask --app wsgi list-users")
        try:
            accounts.validate_password(password, u.username)
        except ServiceError as e:
            raise click.ClickException(e.message)
        u.set_password(password)
        u.must_change_password, u.failed_login_count, u.locked_until = True, 0, None
        db.session.commit()
        click.echo(f"Password changed for '{u.username}'. They must choose a new one at next sign-in.")


    @app.cli.command("backup")
    @click.option("--folder", default="backups", show_default=True, help="Where to put the backup file.")
    @click.option("--keep", default=30, show_default=True, type=int, help="How many recent backups to keep.")
    def backup(folder, keep):
        """Save ALL business data to a file (run this daily; copy the file to a flash drive or cloud too).
        MySQL: a data-only dump that restores onto a database created from database/dairy_schema_v2.sql."""
        url = make_url(app.config["SQLALCHEMY_DATABASE_URI"])
        os.makedirs(folder, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        if url.get_backend_name() == "sqlite":
            target = os.path.join(folder, f"dairy_{stamp}.db")
            src, dst = sqlite3.connect(db.engine.url.database), sqlite3.connect(target)
            with dst:
                src.backup(dst)
            src.close(); dst.close()
        else:
            exe = os.environ.get("MYSQLDUMP_PATH") or shutil.which("mysqldump")
            if not exe:
                found = sorted(glob.glob(r"C:\Program Files\MySQL\MySQL Server *\bin\mysqldump.exe"), reverse=True)
                exe = found[0] if found else None
            if not exe:
                raise click.ClickException("mysqldump was not found. Add MYSQLDUMP_PATH=full\\path\\to\\mysqldump.exe to your .env file.")
            target = os.path.join(folder, f"dairy_{stamp}.sql")
            user = os.environ.get("BACKUP_DB_USER") or url.username
            pw = os.environ.get("BACKUP_DB_PASSWORD") or url.password or ""
            cmd = [exe, f"--host={url.host or 'localhost'}", f"--port={url.port or 3306}", f"--user={user}",
                   "--no-create-info", "--skip-triggers", "--complete-insert", "--single-transaction",
                   "--no-tablespaces", f"--ignore-table={url.database}.schema_version", "--default-character-set=utf8mb4", f"--result-file={target}", url.database]
            res = subprocess.run(cmd, env=dict(os.environ, MYSQL_PWD=pw), capture_output=True, text=True)
            if res.returncode != 0:
                if os.path.exists(target):
                    os.remove(target)
                raise click.ClickException("Backup failed: " + (res.stderr.strip() or "unknown error"))
        size = os.path.getsize(target)
        click.echo(f"Backup saved: {os.path.abspath(target)} ({size:,} bytes)")
        files = sorted(glob.glob(os.path.join(folder, "dairy_*")))
        for old in files[:-keep] if keep > 0 else []:
            os.remove(old)
