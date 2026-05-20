"""Shared test fixtures — DB setup, teardown, auth helpers."""
import os
import pytest

# Set env BEFORE importing app modules
os.environ["DATABASE_URL"] = "sqlite:///./test_run.db"
os.environ["JWT_SECRET"] = "test-secret-key"

from fastapi.testclient import TestClient
from main import app
from database import Base, engine, SessionLocal, User


@pytest.fixture(autouse=True)
def setup_db():
    """Create fresh tables before each test, drop after."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    if os.path.exists("./test_run.db"):
        os.remove("./test_run.db")


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def commander_token(client):
    """Register + promote to Commander + login → return token."""
    client.post("/api/auth/register", json={
        "username": "testcmdr", "password": "pass1234"
    })
    # Promote to Commander via direct DB (register always creates Viewer)
    db = SessionLocal()
    user = db.query(User).filter(User.username == "testcmdr").first()
    user.role = "Commander"
    db.commit()
    db.close()
    r = client.post("/api/auth/login", json={
        "username": "testcmdr", "password": "pass1234"
    })
    return r.json()["access_token"]


@pytest.fixture
def viewer_token(client):
    """Register as Viewer + login → return token."""
    client.post("/api/auth/register", json={
        "username": "testviewer", "password": "pass1234"
    })
    r = client.post("/api/auth/login", json={
        "username": "testviewer", "password": "pass1234"
    })
    return r.json()["access_token"]