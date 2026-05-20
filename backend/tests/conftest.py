"""Shared test fixtures — DB setup, teardown, auth helpers."""

import os
import pytest

# ── Set env BEFORE any app module is imported ──────────────
os.environ["DATABASE_URL"] = "sqlite://"  # in-memory SQLite
os.environ["JWT_SECRET"] = "test-secret-key"

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

# Create a SINGLE in-memory engine shared across the test session
_test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_TestSession = sessionmaker(
    autocommit=False, autoflush=False, bind=_test_engine)

# Patch database module BEFORE main.py imports it
import database  # noqa: E402

database.engine = _test_engine
database.SessionLocal = _TestSession

from database import Base, User  # noqa: E402
from main import app  # noqa: E402
from database import get_db  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


# Override FastAPI's get_db to use our test session
def _override_get_db():
    db = _TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture(autouse=True)
def setup_db():
    """Create fresh tables before each test, drop after."""
    Base.metadata.create_all(bind=_test_engine)
    yield
    Base.metadata.drop_all(bind=_test_engine)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def commander_token(client):
    """Register + promote to Commander + login → return token."""
    client.post(
        "/api/auth/register", json={"username": "testcmdr", "password": "pass1234"}
    )
    # Promote to Commander via direct DB (register always creates Viewer)
    db = _TestSession()
    user = db.query(User).filter(User.username == "testcmdr").first()
    user.role = "Commander"
    db.commit()
    db.close()
    r = client.post(
        "/api/auth/login", json={"username": "testcmdr", "password": "pass1234"}
    )
    return r.json()["access_token"]


@pytest.fixture
def viewer_token(client):
    """Register as Viewer + login → return token."""
    client.post(
        "/api/auth/register", json={"username": "testviewer", "password": "pass1234"}
    )
    r = client.post(
        "/api/auth/login", json={"username": "testviewer", "password": "pass1234"}
    )
    return r.json()["access_token"]
