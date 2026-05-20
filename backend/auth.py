"""

Security features:
  - Bcrypt password hashing (never store plaintext)
  - JWT tokens with configurable expiration
  - Role-Based Access Control (Commander | Viewer)
  - Defence-in-depth: hash + token + role check
 
Routes:
  POST /api/auth/register  → create account (default role: Viewer)
  POST /api/auth/login     → verify credentials → return JWT
  GET  /api/auth/me        → return current user info from token
 
Dependencies (for use in other routes):
  require_auth  → decode JWT, reject expired/invalid tokens
  require_role  → check user role, reject unauthorized access

"""

import os
import logging
from datetime import datetime, timezone, timedelta
 
import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from fastapi import Request
 
from database import get_db, User

logger = logging.getLogger(__name__)
 
# ── Configuration ──────────────────────────────────────────
JWT_SECRET = os.getenv("JWT_SECRET", "secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 1
 
router = APIRouter(prefix="/api/auth", tags=["Authentication"])
 
 
# -------------------- Request and respone model --------------------
class RegisterRequest(BaseModel):
    """Registration payload — username + password with validation."""
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8, max_length=128)
 
 
class LoginRequest(BaseModel):
    """Login payload — same fields as register."""
    username: str
    password: str
 
 
class TokenResponse(BaseModel):
    """Returned after successful login."""
    access_token: str
    token_type: str = "bearer"
    role: str
    username: str
 
 
class UserResponse(BaseModel):
    """Public user information (no password hash)."""
    id: int
    username: str
    role: str
    created_at: datetime

# -------------------- Password utilities  --------------------
def hash_password (plain: str) -> str: # hash password 
    """ create random salt round 12 -> combine wirh hash password like this ($2b$12$) , salt embedded in result   """
    salt = bcrypt.gensalt(rounds = 12) 
    return bcrypt.hashpw (plain.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against a bcrypt hash.
    Returns True if the password matches, False otherwise.
    Uses constant-time comparison to prevent timing attacks.
    """
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ------------------------- JWT ---------------------------
def create_token(username:str ,role: str) -> str: 
    """ 
    take token from  header "Authorization: Bearer eyJhbG..."
     Decode + check signature + date expired 
    give back payload (username, role) if fit
    Nếu sai/hết hạn → trả 401 Unauthorized
    """
    now = datetime.now(timezone.utc) 
    payload = {
      "sub": username,
      "role": role,
      "exp": now + timedelta(hours=JWT_EXPIRY_HOURS),
      "iat": now, 
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token.
    Raises jwt.ExpiredSignatureError if token has expired.
    Raises jwt.InvalidTokenError for any other validation failure.
    """
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
 

# ------------------------- FAST API ---------------------------

def _extract_token(request: Request) -> str:
    """Extract JWT from Authorization header: 'Bearer <token>'."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )
    return auth_header[7:]  # Strip "Bearer " prefix
 
 
def require_auth(request: Request) -> dict:
    """Dependency: require a valid JWT token.
 
    Usage:
        @app.get("/api/protected")
        def protected(user: dict = Depends(require_auth)):
            return {"hello": user["sub"]}
    """
    token = _extract_token(request)
    try:
        payload = decode_token(token)
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
 
def require_commander(user: dict = Depends(require_auth)) -> dict:
    """Dependency: require Commander role.
 
    Stacks on top of require_auth — first validates token,
    then checks role. Returns 403 Forbidden for Viewers.
    Usage:
        @app.post("/api/move")
        def move(user: dict = Depends(require_commander)):
            ...
    """
    if user.get("role") != "Commander":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Commander role required for this action",
        )
    return user

# ------------------------- Route handle ---------------------------

@router.post("/register", response_model=UserResponse,
             status_code=status.HTTP_201_CREATED) 
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    """Create a new user account.
    - Default role: Viewer (cannot send move commands)
    - Password stored as bcrypt hash
    - Rejects duplicate usernames with 409 Conflict
    """
    # Check if username already exists
    existing = db.query(User).filter(User.username == body.username).first()  # check ava of user -> exited -> code 409 
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )
 
    # Create user with hashed password
    user = User(
        username=body.username,
        password_hash=hash_password(body.password), # using hash fuc brycpt never store as plaintext 
        role="Viewer",  # Default is viewer — admin can promote to Commander 
    )
    db.add(user)
    db.commit()
    db.refresh(user)
 
    logger.info("New user registered: %s (role: %s)", user.username, user.role)
    return user
 
 
@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate user and return a JWT token.
    Security: uses generic error message "Invalid username or password"
    for BOTH wrong username and wrong password — prevents enumeration.
    """
    user = db.query(User).filter(User.username == body.username).first() # find user by username 
 
    # Generic error for both "user not found" and "wrong password"
    if not user or not verify_password(body.password, user.password_hash): #Verify password with bcrypt -> if not fit -> flag error
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    token = create_token(user.username, user.role) # if right -> create JWT token -> give back to client 
    logger.info("User logged in: %s (role: %s)", user.username, user.role)
 
    return TokenResponse(
        access_token=token,
        role=user.role,
        username=user.username,
    )
 
@router.get("/me", response_model=UserResponse)
def get_current_user(
    user: dict = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Return the current authenticated user's profile."""
    db_user = db.query(User).filter(User.username == user["sub"]).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    return db_user
 

# ------------------------- DATABASE ---------------------------
def seed_default_users(db: Session) -> None:
    """Create a default Commander account if no users exist.
    Called once at startup from main.py to ensure there is always
    at least one Commander who can control the robot.
    """
    if db.query(User).count() == 0: # if db emty create new account admin/admin123! with role Commander -> so still have people can control robot
        admin = User(
            username="admin",
            password_hash=hash_password("admin123!"),
            role="Commander",
        )
        db.add(admin)
        db.commit()
        logger.info("Seeded default Commander account: admin")