"""
Mission Statistics Calculator — REFACTORED.
============================================
File: backend/legacy_stats.py

Refactoring changes:
  1. SECURITY: Replaced f-string SQL with structured logging
  2. READABILITY: Renamed single-letter vars (t→mission_type, d→distance, b→battery)
  3. VALIDATION: Added input validation via Pydantic (negative values, missing fields)
  4. TYPING: Added type hints and Pydantic request model
  5. CONSTANTS: Extracted magic numbers to named constants
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()

# ── Constants ──────────────────────────────────────────────
MISSION_RULES: dict[int, tuple[str, float]] = {
    1: ("recon", 10.0),
    2: ("transport", 5.0),
}
MAX_SCORE: float = 100.0
HEAVY_PAYLOAD_THRESHOLD: float = 50.0
PAYLOAD_PENALTY_RATE: float = 0.1


# ── Request Model ──────────────────────────────────────────
class MissionStatsRequest(BaseModel):
    """Validated request body for mission stats calculation."""
    type: int = Field(..., description="Mission type: 1=recon, 2=transport")
    dist: float = Field(..., ge=0, description="Distance travelled (non-negative)")
    batt: float = Field(..., ge=0, description="Battery consumed (non-negative)")
    payload_weight: float = Field(0, ge=0, description="Payload weight in kg")


# ── Pure functions ─────────────────────────────────────────

def _compute_base_score(distance: float, battery: float, multiplier: float) -> float:
    """Calculate base mission score. Returns 0 for zero/negative inputs."""
    if distance <= 0 or battery <= 0:
        return 0.0
    return (distance * multiplier) / battery


def _apply_payload_penalty(score: float, payload_weight: float) -> float:
    """Reduce score for heavy transport payloads (>50 kg)."""
    if payload_weight > HEAVY_PAYLOAD_THRESHOLD and score > 0:
        score -= payload_weight * PAYLOAD_PENALTY_RATE
    return score


def _cap_score(score: float) -> float:
    """Cap score at MAX_SCORE (100)."""
    return min(score, MAX_SCORE)


# ── API Endpoint ───────────────────────────────────────────

@router.post("/api/mission_stats")
def calc_stats(data: MissionStatsRequest):
    """Calculate mission performance statistics.

    FIXED: Previously used f-string SQL interpolation vulnerable to injection.
    Now uses Pydantic validation and structured logging instead.
    """
    mission = MISSION_RULES.get(data.type)
    if mission is None:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid mission type: {data.type}. Valid types: {list(MISSION_RULES.keys())}",
        )

    mission_name, multiplier = mission

    score = _compute_base_score(data.dist, data.batt, multiplier)
    score = _apply_payload_penalty(score, data.payload_weight)
    score = _cap_score(score)

    logger.info(
        "Mission stats: type=%s, score=%.2f, distance=%.1f, battery=%.1f",
        mission_name, score, data.dist, data.batt,
    )

    return {
        "status": "success",
        "mission": mission_name,
        "final_score": round(score, 2),
    }
