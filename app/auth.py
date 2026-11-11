from functools import wraps
from datetime import timedelta
import hashlib
import secrets
from flask import Blueprint, g, jsonify, request
from .extensions import db
from .models import AuthSession, Business, Membership, User, utcnow
from .services import accounts
from .services.errors import ServiceError

bp = Blueprint("auth", __name__, url_prefix="/auth")
SESSION_TTL = timedelta(hours=24)


def _start_session(user, memberships):
    AuthSession.query.filter(AuthSession.expires_at <= utcnow()).delete()
    token = secrets.token_urlsafe(32)
    auth_session = AuthSession(token_hash=hashlib.sha256(token.encode("ascii")).hexdigest(),
                               user_id=user.id, business_id=memberships[0].business_id,
                               expires_at=utcnow() + SESSION_TTL)
    db.session.add(auth_session)
    db.session.commit()
    return token, sorted(m.role for m in memberships)


@bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    user, failure = accounts.check_login(data.get("username"), data.get("password"))
    if failure:
        return jsonify(error=failure[1]), failure[0]
    q = Membership.query.filter_by(user_id=user.id, is_active=True)
    if data.get("business_id"):
        q = q.filter_by(business_id=data["business_id"])
    memberships = q.all()
    if not memberships:
        return jsonify(error="Your account has no active access. Ask the owner."), 403
    if len({m.business_id for m in memberships}) > 1:
        return jsonify(error="Multiple businesses; specify business_id"), 400
    token, roles = _start_session(user, memberships)
    return jsonify(user=user.full_name, business_id=memberships[0].business_id, roles=roles,
                   session_token=token,
                   must_change_password=bool(user.must_change_password))


@bp.get("/setup-status")
def setup_status():
    """The login page asks this: if there are no users yet it shows the 'create the owner account' form."""
    return jsonify(needs_setup=accounts.needs_setup())


@bp.post("/setup")
def setup():
    u, biz = accounts.bootstrap(request.get_json(silent=True) or {})
    ms = Membership.query.filter_by(user_id=u.id, is_active=True).all()
    token, roles = _start_session(u, ms)
    return jsonify(user=u.full_name, business_id=biz.id, roles=roles, session_token=token,
                   must_change_password=False), 201


@bp.errorhandler(ServiceError)
def handle_service_error(e):
    return jsonify(error=e.message, **e.extra), e.status


@bp.post("/logout")
def logout():
    token = request.headers.get("X-Tab-Session", "")
    if token:
        token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).hexdigest()
        AuthSession.query.filter_by(token_hash=token_hash).delete()
        db.session.commit()
    return jsonify(ok=True)


def login_required_roles(*roles, allow_password_change=False):
    """Server-side permission check. OWNER may do everything listed for any role."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            token = request.headers.get("X-Tab-Session", "")
            if not token:
                return jsonify(error="Authentication required"), 401
            token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).hexdigest()
            auth_session = db.session.get(AuthSession, token_hash)
            if not auth_session or auth_session.expires_at <= utcnow():
                if auth_session:
                    db.session.delete(auth_session)
                    db.session.commit()
                return jsonify(error="Session expired. Please sign in again."), 401
            uid, bid = auth_session.user_id, auth_session.business_id
            # Re-check membership each request so deactivation takes effect immediately.
            ms = Membership.query.filter_by(user_id=uid, business_id=bid, is_active=True).all()
            user = db.session.get(User, uid)
            if not ms or not user or not user.is_active:
                db.session.delete(auth_session)
                db.session.commit()
                return jsonify(error="Account no longer active"), 401
            if user.must_change_password and not allow_password_change:
                return jsonify(error="Please change your temporary password first.",
                               code="PASSWORD_CHANGE_REQUIRED"), 403
            have = {m.role for m in ms}
            if not (have & (set(roles) | {"OWNER"})):  # no roles listed => OWNER only
                return jsonify(error="You do not have permission for this action"), 403
            g.user_id, g.business_id, g.roles = uid, bid, have
            g.auth_session = auth_session
            return fn(*a, **kw)
        return wrapper
    return deco


@bp.get("/me")
@login_required_roles("MILKER", "SHOP_ATTENDANT", allow_password_change=True)
def me():
    """Who is logged in? The web page calls this on load to decide what to show."""
    user = db.session.get(User, g.user_id)
    biz = db.session.get(Business, g.business_id)
    return jsonify(user=user.full_name, username=user.username, business=biz.name,
                   business_id=g.business_id, roles=sorted(g.roles), must_change_password=bool(user.must_change_password))


@bp.post("/change-password")
@login_required_roles("MILKER", "SHOP_ATTENDANT", allow_password_change=True)
def change_password():
    data = request.get_json(silent=True) or {}
    accounts.change_password(g.user_id, g.business_id, data.get("current_password"), data.get("new_password"))
    return jsonify(ok=True)
