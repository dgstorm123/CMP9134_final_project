import pytest
from legacy_stats import _compute_base_score, _cap_score, MAX_SCORE
from robot_client import RobotStatus

# ── Coordinate Validation ──────────────────────────────────
def validate_coordinates(x: int, y: int) -> bool:
    return isinstance(x, int) and isinstance(y, int) and 0 <= x <= 20 and 0 <= y <= 20
 
class TestCoordinateValidation:
    def test_valid_center(self):
        assert validate_coordinates(10, 10) is True
 
    def test_valid_origin(self):
        assert validate_coordinates(0, 0) is True
 
    def test_valid_max(self):
        assert validate_coordinates(20, 20) is True
 
    def test_negative_x(self):
        assert validate_coordinates(-1, 5) is False
 
    def test_negative_y(self):
        assert validate_coordinates(5, -1) is False
 
    def test_over_max_x(self):
        assert validate_coordinates(21, 5) is False
 
    def test_over_max_y(self):
        assert validate_coordinates(5, 21) is False
 
    def test_float_rejected(self):
        assert validate_coordinates(5.5, 3) is False
 
    def test_string_rejected(self):
        assert validate_coordinates("a", 3) is False
 
 
# ── Legacy Stats Logic ─────────────────────────────────────

class TestComputeBaseScore:
    """Unit tests for _compute_base_score() calculation."""
 
    def test_normal_calculation(self):
        """Standard input: distance=100, battery=50, multiplier=10."""
        result = _compute_base_score(100, 50, 10)
        assert result == 20.0  # (100 * 10) / 50
 
    def test_zero_distance_returns_zero(self):
        """Edge case: zero distance should return 0."""
        assert _compute_base_score(0, 50, 10) == 0
 
    def test_zero_battery_returns_zero(self):
        """Edge case: zero battery should return 0 (avoid division by zero)."""
        assert _compute_base_score(100, 0, 10) == 0
 
    def test_negative_distance_returns_zero(self):
        """Negative distance is invalid — should return 0."""
        assert _compute_base_score(-5, 50, 10) == 0
 
 
class TestCapScore:
    """Unit tests for _cap_score() capping logic."""
 
    def test_below_max(self):
        """Score below MAX_SCORE should pass through unchanged."""
        assert _cap_score(50) == 50
 
    def test_above_max(self):
        """Score above MAX_SCORE should be capped."""
        assert _cap_score(150) == MAX_SCORE
 
    def test_exact_max(self):
        """Score exactly at MAX_SCORE should remain unchanged."""
        assert _cap_score(MAX_SCORE) == MAX_SCORE
 
 
# ── Legacy Stats Logic ─────────────────────────────────────


class TestRobotStatus:
    """Unit tests for RobotStatus dataclass."""
 
    def test_from_dict_valid_data(self):
        """Parse standard API response into RobotStatus."""
        data = {
            "id": "sim-001",
            "position": {"x": 5, "y": 10},
            "battery": 87.5,
            "status": "IDLE",
        }
        status = RobotStatus.from_dict(data)
        assert status.id == "sim-001"
        assert status.position_x == 5
        assert status.position_y == 10
        assert status.battery == 87.5
        assert status.status == "IDLE"
 
    def test_is_low_battery_true(self):
        """Battery at 19% should trigger low battery."""
        status = RobotStatus(battery=19.0)
        assert status.is_low_battery() is True
 
    def test_is_low_battery_false(self):
        """Battery at 20% should NOT trigger low battery."""
        status = RobotStatus(battery=20.0)
        assert status.is_low_battery() is False
 
    def test_is_dead(self):
        """Battery at 0% means robot is dead."""
        assert RobotStatus(battery=0.0).is_dead() is True
        assert RobotStatus(battery=1.0).is_dead() is False
 
    def test_is_stuck(self):
        """Status STUCK indicates obstacle collision."""
        assert RobotStatus(status="STUCK").is_stuck() is True
        assert RobotStatus(status="IDLE").is_stuck() is False