"""
Database — MySQL connection + SQLAlchemy models.
=================================================
File: backend/database.py
Vai trò: Tạo kết nối MySQL và định nghĩa bảng dữ liệu.

Luồng chạy:
  Docker Compose khởi động container "database" (MySQL)
  → backend đợi MySQL ready (depends_on + healthcheck)
  → database.py tạo engine + session
  → auth.py và mission_logger.py import SessionLocal để đọc/ghi

Bảng dữ liệu:
  - users: username, password_hash, role, created_at
  - mission_logs: id, timestamp, username, command_type, params, result, ...
"""
import os
import logging
from datetime import datetime, timezone

from sqlalchemy import (
    create_engine, Column, Integer, String, Float,
    DateTime,
)
from sqlalchemy.orm import sessionmaker, declarative_base

logger = logging.getLogger(__name__)

# ── Đọc connection string từ biến môi trường ──────────────
# docker-compose.yml truyền: DATABASE_URL=mysql+pymysql://gcs:gcs_pass@database:3306/gcs_db
# Khi chạy local có thể dùng SQLite fallback
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./gcs_local.db"  # Fallback nếu không có MySQL
)

# ── Tạo SQLAlchemy engine ─────────────────────────────────
# Engine quản lý connection pool tới MySQL.
# pool_pre_ping=True: kiểm tra connection còn sống trước khi dùng
#                     (tránh lỗi "MySQL server has gone away")
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    echo=False,  # True = in SQL queries ra console (debug)
)

# ── Session factory ────────────────────────────────────────
# Mỗi request tạo 1 session → dùng xong đóng lại.
# autocommit=False: phải gọi session.commit() thủ công → an toàn hơn
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ── Base class cho tất cả models ───────────────────────────
Base = declarative_base()


# ══════════════════════════════════════════════════════════
# MODEL: User — Bảng "users" trong MySQL
# ══════════════════════════════════════════════════════════
# Tương ứng class User trong Class Diagram.
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="Viewer")  # Commander | Viewer
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


# ══════════════════════════════════════════════════════════
# MODEL: MissionLog — Bảng "mission_logs" trong MySQL
# ══════════════════════════════════════════════════════════
# Tương ứng class MissionLog trong Class Diagram.
# Ghi lại MỌI lệnh: ai gửi, khi nào, lệnh gì, kết quả ra sao.
class MissionLog(Base):
    __tablename__ = "mission_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    username = Column(String(50), nullable=False, index=True)
    command_type = Column(String(20), nullable=False)  # MOVE | RESET | STATUS
    parameters = Column(String(200), default="")       # "x:5,y:3"
    result = Column(String(200), default="")           # success | stuck | failed
    robot_battery = Column(Float, default=0.0)
    robot_x = Column(Integer, default=0)
    robot_y = Column(Integer, default=0)


# ══════════════════════════════════════════════════════════
# TẠO BẢNG — Chạy khi app khởi động
# ══════════════════════════════════════════════════════════
def init_db():
    """Tạo tất cả bảng nếu chưa tồn tại.

    Gọi trong main.py khi app khởi động:
        @app.on_event("startup")
        def startup():
            init_db()
    """
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created/verified: %s", DATABASE_URL)


# ══════════════════════════════════════════════════════════
# DEPENDENCY — Lấy database session cho mỗi request
# ══════════════════════════════════════════════════════════
def get_db():
    """FastAPI Depends() — mở session đầu request, đóng cuối request.

    Dùng trong route handler:
        @app.get("/api/users")
        def get_users(db: Session = Depends(get_db)):
            return db.query(User).all()
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()