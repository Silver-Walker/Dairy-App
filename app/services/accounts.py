"""Accounts: first-run setup, creating/deactivating users, passwords, login lockout.
No emails are involved: the owner issues a TEMPORARY password and the person must change it at first login."""
import re
from datetime import timedelta

from werkzeug.security import check_password_hash, generate_password_hash

from ..extensions import db
from ..models import (AuditLog, Business, BusinessSettings, ExpenseCategory, Farm, Membership, Product,
                      Shop, User, utcnow)
from .errors import ConflictError, ForbiddenError, NotFoundError, ValidationError

ROLES = ("OWNER", "MILKER", "SHOP_ATTENDANT")
MAX_FAILED_LOGINS = 5
LOCK_MINUTES = 15
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{2,39}$")
EASY = {"password", "password1", "12345678", "123456789", "1234567890", "qwertyui", "qwerty123", "11111111",
        "00000000", "abcd1234", "letmein1", "iloveyou", "admin123"}
DUMMY_HASH = generate_password_hash("not-a-real-password")      # used to keep login timing similar for unknown names


def norm_username(value):
    return str(value or "").strip().lower()


def validate_username(username):
    if not USERNAME_RE.match(username):
        raise ValidationError("Username must be 3-40 characters: letters, numbers, dot, dash or underscore (no spaces).")


def validate_password(password, username=None):
    if not isinstance(password, str) or len(password) < 8:
        raise ValidationError("Password must be at least 8 characters.")
    if len(password) > 128:
        raise ValidationError("Password is too long (maximum 128 characters).")
    if password.lower() in EASY or (username and password.lower() == username.lower()):
        raise ValidationError("That password is too easy to guess. Choose something less obvious.")


def _audit(business_id, user_id, action, record_id, values):
    db.session.add(AuditLog(business_id=business_id, user_id=user_id, action=action, record_type="USER",
                            record_id=record_id, new_values_json=values))


# ---------------------------------------------------------------- first-run setup
def needs_setup():
    return User.query.count() == 0


def create_business_defaults(name, farm_name="Main Farm", shop_name="Main Shop"):
    """A new business with its settings, one farm, one shop, the three products and expense categories."""
    b = Business(name=name)
    db.session.add(b)
    db.session.flush()
    db.session.add(BusinessSettings(business_id=b.id))
    farm, shop = Farm(business_id=b.id, name=farm_name), Shop(business_id=b.id, name=shop_name)
    db.session.add_all([farm, shop])
    for pname, t in (("Fresh Milk", "FRESH_MILK"), ("Yoghurt", "YOGHURT"), ("Maziwa Mala", "MAZIWA_MALA")):
        db.session.add(Product(business_id=b.id, name=pname, product_type=t))
    for cat in ("Animal feeds", "Wages", "Transport", "Utilities", "Veterinary services", "Repairs", "Other"):
        db.session.add(ExpenseCategory(business_id=b.id, name=cat))
    db.session.flush()
    return b, farm, shop


def bootstrap(data):
    """First-run setup: only works while there are no users at all. Creates the business and its owner."""
    if not needs_setup():
        raise ForbiddenError("Setup has already been completed. Sign in instead.")
    business_name = str(data.get("business_name") or "").strip()
    if not business_name:
        raise ValidationError("Enter the name of your farm or business.")
    full_name = str(data.get("full_name") or "").strip()
    if not full_name:
        raise ValidationError("Enter your full name.")
    username = norm_username(data.get("username"))
    validate_username(username)
    validate_password(data.get("password"), username)
    try:
        b, farm, shop = create_business_defaults(business_name[:150], str(data.get("farm_name") or "Main Farm")[:150],
                                                 str(data.get("shop_name") or "Main Shop")[:150])
        u = User(username=username, full_name=full_name[:150], password_changed_at=utcnow())
        u.set_password(data["password"])
        db.session.add(u)
        db.session.flush()
        db.session.add(Membership(business_id=b.id, user_id=u.id, role="OWNER"))
        _audit(b.id, u.id, "SETUP", u.id, {"username": username, "business": business_name})
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return u, b


# ---------------------------------------------------------------- login protection
def check_login(username, password):
    """Returns (user, None) on success or (None, (http_status, message)) on failure. Locks after repeated failures."""
    now = utcnow()
    user = User.query.filter_by(username=norm_username(username)).first()
    if user and user.locked_until and user.locked_until > now:
        mins = int((user.locked_until - now).total_seconds() // 60) + 1
        return None, (429, f"Too many wrong passwords. This account is locked for about {mins} more minute(s). "
                           "The owner can unlock it sooner.")
    ok = bool(user) and user.is_active and user.check_password(password or "")
    if not user:
        check_password_hash(DUMMY_HASH, password or "")
    if not ok:
        if user:
            user.failed_login_count = (user.failed_login_count or 0) + 1
            if user.failed_login_count >= MAX_FAILED_LOGINS:
                user.locked_until = now + timedelta(minutes=LOCK_MINUTES)
                user.failed_login_count = 0
            db.session.commit()
        return None, (401, "Invalid username or password")
    user.failed_login_count, user.locked_until, user.last_login_at = 0, None, now
    db.session.commit()
    return user, None


# ---------------------------------------------------------------- owner: manage people
def _member(business_id, user_id):
    rows = Membership.query.filter_by(business_id=business_id, user_id=user_id).all()
    if not rows:
        raise NotFoundError("User not found")
    return rows


def list_users(business_id):
    now = utcnow()
    out = []
    for u in (User.query.join(Membership, Membership.user_id == User.id)
              .filter(Membership.business_id == business_id).order_by(User.id).distinct().all()):
        ms = Membership.query.filter_by(business_id=business_id, user_id=u.id).all()
        out.append({"id": u.id, "username": u.username, "full_name": u.full_name,
                    "roles": sorted(m.role for m in ms), "active": all(m.is_active for m in ms),
                    "must_change_password": bool(u.must_change_password),
                    "locked": bool(u.locked_until and u.locked_until > now),
                    "last_login_at": u.last_login_at.isoformat() + "Z" if u.last_login_at else None})
    return out


def create_user(business_id, actor_id, data):
    username = norm_username(data.get("username"))
    validate_username(username)
    full_name = str(data.get("full_name") or "").strip()
    if not full_name:
        raise ValidationError("Enter the person's full name.")
    role = str(data.get("role") or "").upper()
    if role not in ROLES:
        raise ValidationError("Choose a role: owner, milker or shop attendant.")
    validate_password(data.get("password"), username)
    if User.query.filter_by(username=username).first():
        raise ConflictError(f"The username '{username}' is already taken.")
    try:
        u = User(username=username, full_name=full_name[:150], must_change_password=True)
        u.set_password(data["password"])
        db.session.add(u)
        db.session.flush()
        db.session.add(Membership(business_id=business_id, user_id=u.id, role=role))
        _audit(business_id, actor_id, "CREATE", u.id, {"username": username, "role": role})
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return u


def _active_owner_count(business_id):
    return (Membership.query.join(User, User.id == Membership.user_id)
            .filter(Membership.business_id == business_id, Membership.role == "OWNER",
                    Membership.is_active.is_(True), User.is_active.is_(True)).count())


def set_active(business_id, actor_id, user_id, active):
    ms = _member(business_id, user_id)
    if not active:
        if user_id == actor_id:
            raise ValidationError("You cannot deactivate your own account.")
        if any(m.role == "OWNER" and m.is_active for m in ms) and _active_owner_count(business_id) <= 1:
            raise ValidationError("You cannot deactivate the only active owner.")
    for m in ms:
        m.is_active = bool(active)
    _audit(business_id, actor_id, "ACTIVATE" if active else "DEACTIVATE", user_id, {"active": bool(active)})
    db.session.commit()


def reset_password(business_id, actor_id, user_id, new_password):
    ms = _member(business_id, user_id)
    u = db.session.get(User, user_id)
    validate_password(new_password, u.username)
    u.set_password(new_password)
    u.must_change_password = True
    u.failed_login_count, u.locked_until = 0, None
    _audit(business_id, actor_id, "RESET_PASSWORD", user_id, {"username": u.username})
    db.session.commit()
    return u


def unlock(business_id, actor_id, user_id):
    _member(business_id, user_id)
    u = db.session.get(User, user_id)
    u.failed_login_count, u.locked_until = 0, None
    _audit(business_id, actor_id, "UNLOCK", user_id, {"username": u.username})
    db.session.commit()


def change_password(user_id, business_id, current, new):
    u = db.session.get(User, user_id)
    if not u.check_password(current or ""):
        raise ValidationError("Your current password is not correct.")
    if current == new:
        raise ValidationError("Choose a new password that is different from the current one.")
    validate_password(new, u.username)
    u.set_password(new)
    u.must_change_password = False
    u.password_changed_at = utcnow()
    _audit(business_id, user_id, "CHANGE_PASSWORD", user_id, {"username": u.username})
    db.session.commit()
