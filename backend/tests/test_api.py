"""Integration tests — API endpoints + auth + RBAC.
Uses conftest.py fixtures for DB setup/teardown and auth helpers.
"""


# ── Health ─────────────────────────────────────────────────
def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# ── Auth: Register ─────────────────────────────────────────
def test_register_new_user(client):
    r = client.post(
        "/api/auth/register",
        json={
            "username": "newuser",
            "password": "pass1234",  # ← FIX #2: no "role" field
        },
    )
    assert r.status_code == 201
    assert r.json()["username"] == "newuser"
    assert r.json()["role"] == "Viewer"  # ← always Viewer


def test_register_duplicate(client):
    client.post(
        "/api/auth/register", json={"username": "dup_user", "password": "pass1234"}
    )
    r = client.post(
        "/api/auth/register", json={"username": "dup_user", "password": "pass1234"}
    )
    assert r.status_code == 409


def test_register_short_username(client):
    r = client.post(
        "/api/auth/register", json={"username": "ab", "password": "pass1234"}
    )
    assert r.status_code == 422


def test_register_short_password(client):
    r = client.post(
        "/api/auth/register",
        json={"username": "validname", "password": "short"},  # < 8 chars
    )
    assert r.status_code == 422


# ── Auth: Login ────────────────────────────────────────────
def test_login_success(client):
    client.post(
        "/api/auth/register", json={"username": "logintest", "password": "pass1234"}
    )
    r = client.post(
        "/api/auth/login", json={"username": "logintest", "password": "pass1234"}
    )
    assert r.status_code == 200
    assert "access_token" in r.json()
    assert r.json()["role"] == "Viewer"  # ← FIX #2: Viewer, not Commander


def test_login_wrong_password(client):
    client.post(
        "/api/auth/register", json={"username": "wrongpw", "password": "pass1234"}
    )
    r = client.post(
        "/api/auth/login", json={"username": "wrongpw", "password": "wrongwrong"}
    )
    assert r.status_code == 401
    assert "Invalid username or password" in r.json()["detail"]


# ── Protected endpoints without token ──────────────────────
def test_status_no_token(client):
    r = client.get("/api/status")
    assert r.status_code == 401


def test_move_no_token(client):
    r = client.post("/api/move?x=5&y=5")  # ← FIX #3: query params
    assert r.status_code == 401


# ── RBAC: Viewer cannot move ───────────────────────────────
def test_viewer_cannot_move(client, viewer_token):
    r = client.post(
        "/api/move?x=5&y=5",  # ← FIX #3: query params
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 403


# ── RBAC: Viewer can read logs ─────────────────────────────
def test_viewer_can_read_logs(client, viewer_token):
    r = client.get(
        "/api/logs",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 200


# ── Legacy Stats ───────────────────────────────────────────
def test_mission_stats_recon(client):
    r = client.post("/api/mission_stats",
                    json={"type": 1, "dist": 50, "batt": 10})
    assert r.status_code == 200
    assert r.json()["status"] == "success"
    assert r.json()["mission"] == "recon"


def test_mission_stats_invalid_type(client):
    r = client.post("/api/mission_stats",
                    json={"type": 99, "dist": 50, "batt": 10})
    assert r.status_code == 400  # ← FIX #6: refactored raises 400


def test_mission_stats_missing_field(client):
    r = client.post("/api/mission_stats", json={"type": 1})
    assert r.status_code == 422
