import os
from dotenv import load_dotenv

load_dotenv()  # reads .env in the project folder


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-change-me")
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL", "sqlite:///dairy_dev.db")
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,   # survive MySQL dropping idle connections
        "pool_recycle": 280,
    }
    BUSINESS_UTC_OFFSET_HOURS = int(os.environ.get("BUSINESS_UTC_OFFSET_HOURS", "3"))  # Kenya: UTC+3
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = os.environ.get("TEST_DATABASE_URL", "sqlite:///:memory:")
