from .extensions import db
from .models import Membership, User
from .services.accounts import create_business_defaults


def seed_business(password, name="Demo Dairy Business", prefix=""):
    """Demo data for development/tests: a business with owner1 / milker1 / attendant1 (same password)."""
    b, farm, shop = create_business_defaults(name)
    users = {}
    for uname, role in (("owner1", "OWNER"), ("milker1", "MILKER"), ("attendant1", "SHOP_ATTENDANT")):
        u = User(username=prefix + uname, full_name=uname.title())
        u.set_password(password)
        db.session.add(u)
        db.session.flush()
        db.session.add(Membership(business_id=b.id, user_id=u.id, role=role))
        users[role] = u
    db.session.commit()
    return b, farm, shop, users
