"""
Robot API client scaffold.

Provides a small async wrapper around the Virtual Robot REST API.
Students should extend this with retry logic, error handling, and
any additional endpoints exposed by the robot simulator.
"""

from __future__ import annotations
import asyncio
import logging
import os
from typing import Any, Callable 
from dataclasses import dataclass, field

import httpx

ROBOT_API_URL = os.getenv("ROBOT_API_URL", "http://localhost:5000")

logger = logging.getLogger(__name__)


"""
Design Patterns:
  - Facade: RobotClient hides HTTP/retry complexity behind clean methods
  - Observer: ConnectionManager notifies subscribers on status changes
  - Dataclass: RobotStatus encapsulates robot state with helper methods
 
Retry Strategy:
  Exponential backoff: 0.5s → 1.0s → 2.0s (3 attempts)
  Handles transient 503 errors from the robot simulator's noise simulation.
"""

class RobotConnectionError(Exception): # exception 
    """Raised when a request to the robot API fails."""

@dataclass
class RobotStatus:
    id: str = "unknown"
    position_x: int = 0
    position_y: int = 0
    battery: float = 100.0
    status: str = "IDLE"
    connected: bool = True
 
    def is_low_battery(self) -> bool:
        return self.battery < 20.0
 
    def is_dead(self) -> bool:
        return self.battery <= 0.0
 
    def is_stuck(self) -> bool:
        return self.status == "STUCK"
 
    @classmethod
    def from_dict(cls, data: dict) -> RobotStatus:
        pos = data.get("position", {})
        return cls(
            id=data.get("id", "unknown"),
            position_x=pos.get("x", 0),
            position_y=pos.get("y", 0),
            battery=data.get("battery", 0.0),
            status=data.get("status", "unknown"),
        )

#### connection manager
class ConnectionManager:
    """Notifies subscribers when connection status changes."""
    def __init__(self):
        self._status: str = "disconnected"
        self._observers: list[Callable] = []
 
    def subscribe(self, callback: Callable) -> None:
        self._observers.append(callback)
 
    def notify(self, new_status: str) -> None:
        if new_status != self._status:
            old = self._status
            self._status = new_status
            logger.info("Connection: %s → %s", old, new_status)
            for cb in self._observers:
                cb(new_status)
 
    def get_status(self) -> str:
        return self._status
 

class RobotClient:
    """Minimal async HTTP client for the Virtual Robot API.   
    Facade pattern: hides HTTP/retry complexity behind clean methods."""

    def __init__(self, base_url: str = ROBOT_API_URL) -> None:
        self._base = base_url.rstrip("/")
        self.max_retries: int = 3
        self.timeout: float = 5.0
        self.connection = ConnectionManager()

# -------------------- retry logic ---------------------------------
    async def _request_with_retry (self, method: str, path: str, **kwargs) -> dict[str, Any]:

        """Send an HTTP request with exponential backoff retry.
            Args:
                method: HTTP method ("GET" or "POST")
                path:   API path (e.g. "/api/status")
                **kwargs: passed to httpx (json, params, etc.)
    
            Returns:
                Parsed JSON response as a dict.
    
            Raises:
                RobotConnectionError: after all retries are exhausted.
    
            Retry strategy:
                Attempt 1: immediate
                Attempt 2: wait 0.5s
                Attempt 3: wait 1.0s
                (exponential backoff: delay = 0.5 * 2^attempt)  
        """
        last_error = None 
        for attempt in range (self.max_retries):
            try: 
                if attempt > 0:
                    # backoff: 0,5s , 1s 
                    delay = 0.5 * (2 ** (attempt - 1))
                    self.connection.notify("reconnecting")
                    logger.info(
                        "Retry %d/%d for %s %s (waiting %.1fs)",
                        attempt + 1, self.max_retries, method, path, delay,
                    )
                    await asyncio.sleep(delay)

                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.request(
                        method, f"{self._base}{path}", **kwargs)
                    response.raise_for_status()
                # success - mark connected and return data
                self.connection.notify("connected")
                self.connection.notify("connected")
                return response.json()
 
            except httpx.HTTPStatusError as exc:
                last_error = exc
                # 503 = transient outage from robot noise simulation → retry
                if exc.response.status_code == 503:
                    logger.warning("Robot returned 503 (attempt %d)", attempt + 1)
                    continue
                # Other HTTP errors (4xx) should not be retried
                raise RobotConnectionError(
                    f"Robot API error {exc.response.status_code}: {exc}"
                ) from exc
 
            except (httpx.ConnectError, httpx.TimeoutException) as exc:
                last_error = exc
                logger.warning(
                    "Connection failed (attempt %d): %s", attempt + 1, exc
                )
                continue
 
            except Exception as exc:
                last_error = exc
                logger.error("Unexpected error: %s", exc)
                break
 
        # All retries exhausted
        self.connection.notify("disconnected")
        raise RobotConnectionError(
            f"Robot unreachable after {self.max_retries} attempts: {last_error}"
        )

# ---------------------- API methods -----------------------------        
    # get status 
    async def get_status(self) -> dict[str, Any]: # get status 
        """Fetch current robot status (position, battery, state)."""
        return await self._request_with_retry("GET", "/api/status")

    # Move - POST
    async def move(self, x: int, y: int) -> dict[str, Any]: # move 
        """Send a move command to the robot."""
        return await self._request_with_retry("POST", "/api/move", json = {"x":x, "y":y})

    # reset 
    async def reset(self) -> dict[str, Any]:
        """POST /api/reset → reset simulation."""
        return await self._request_with_retry("POST", "/api/reset")

    #async def get_map()
    async def get_map(self) -> dict[str, Any]:
        """GET /api/map → 21×21 obstacle grid."""
        return await self._request_with_retry("GET", "/api/map")

    # get_sensor ()
    async def get_sensor(self) -> dict[str, Any]:
        """GET /api/sensor → proximity + lidar."""
        return await self._request_with_retr





# Module-level singleton used by main.py
robot = RobotClient()

