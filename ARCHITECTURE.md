# System Architecture — Ground Control Station

## Architectural Pattern: Layered Architecture + Client-Server

The Ground Control Station system follow Layered Architecture

Architectural Pattern: Layered Architecture + Client-Server
The GCS system follows a Layered Architecture pattern:

Layer 1: Presentation Layer (Frontend)

- Technology: HTML/CSS/JavaScript + Nginx
- Responsibility: Display dashboard, receive user input, call API
- Files: frontend/public/index.html, frontend/nginx.conf

Layer 2: Application Layer (Backend)

- Technology: Python FastAPI + Uvicorn
- Responsibility: Authentication, RBAC, business logic, mission logging
- Files: backend/main.py, backend/auth.py, backend/mission_log.py

Layer 3: Integration Layer (Robot Client)

- Technology: httpx (async HTTP client)
- Responsibility: Communicate with Robot API, retry logic, error handling
- Files: backend/robot_client.py
- Design Patterns: Singleton + Facade

Layer 4: External Services

- Robot API: Docker Container, REST endpoints
- Database: SQLite (users + mission logs)

Why Choose Layered Architecture?

- Separation of Concerns: Each layer only knows the layer directly below it
- Testability: Can test each layer independently (mock the layer below)
- Maintainability: Frontend changes do not affect backend
- Suits Client-Server: Browser (client) → Nginx → FastAPI (server) → Robot API

Design Patterns Applied
1. Singleton Pattern (Creational)

- Problem: Only need 1 instance of RobotClient connected to Robot API
- Solution: Module-level singleton: robot = RobotClient() at end of file
- Benefits: Avoid creating multiple HTTP connections, share state (connection_status)

2. Facade Pattern (Structural)

- Problem: Business logic code should not know details about HTTP headers, JSON parsing, retries
- Solution: RobotClient hides everything behind a clean interface: move(x, y), get_status()
- Benefits: main.py only needs to call await robot.move(5, 3) — no need to know about httpx

3. Observer Pattern (Behavioral) 

- Problem: Multiple UI widgets need to know when connection status changes
- Solution: ConnectionManager allows subscribe/unsubscribe callbacks
- Benefits: Loose coupling — adding new widgets requires no changes to RobotClient