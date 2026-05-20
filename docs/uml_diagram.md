# UML Diagrams — Ground Control Station (GCS)

> **Module**: CMP9134 Software Engineering — University of Lincoln  
> **Project**: Robot Management System — Ground Control Station  
> **Diagram Tool**: Mermaid.js (renders natively on GitHub)  
> **Last Updated**: May 2026

---

## Table of Contents

1. [Use Case Diagram](#1-use-case-diagram)
2. [Activity Diagram — Move Robot Command](#2-activity-diagram--move-robot-command)
3. [Class Diagram — Backend OOP Structure](#3-class-diagram--backend-oop-structure)
4. [Sequence Diagrams](#4-sequence-diagrams)
   - 4.1 [User Registration](#41-sequence-diagram--user-registration)
   - 4.2 [User Login with JWT](#42-sequence-diagram--user-login-with-jwt)
   - 4.3 [Move Robot — Success Path](#43-sequence-diagram--move-robot-success)
   - 4.4 [Move Robot — All Alternative Paths](#44-sequence-diagram--move-robot-all-scenarios)
   - 4.5 [View Robot Status (Telemetry Polling)](#45-sequence-diagram--view-robot-status)
   - 4.6 [View Map and Obstacles](#46-sequence-diagram--view-map-and-obstacles)
   - 4.7 [View Sensor Data](#47-sequence-diagram--view-sensor-data)
   - 4.8 [View Mission Logs](#48-sequence-diagram--view-mission-logs)
5. [Component Diagram — Docker Architecture](#5-component-diagram--docker-architecture)
6. [Entity Relationship Diagram (ERD)](#6-entity-relationship-diagram)
7. [Feature-to-Diagram Traceability](#7-feature-to-diagram-traceability)

---

## 1. Use Case Diagram

**Purpose**: Define the external perspective — who uses the Ground Control Station and what actions are available to each role. This diagram maps the Role-Based Access Control (RBAC) permissions to system features.

**Actors**:
- **Commander**: Full access — can view all telemetry data AND issue move/reset commands to the robot.
- **Viewer**: Read-only access — can view status, map, sensors, and logs but CANNOT control the robot.
- **Auditor**: Limited access — can view mission logs for compliance investigation.
- **Robot API**: External system actor — the virtual robot simulation container that the GCS communicates with.

```mermaid
flowchart LR
    %% Define Actors
    C["🧑‍✈️ Commander"]
    V["👁️ Viewer"]
    A["📋 Auditor"]
    R["🤖 Robot API<br/>(External System)"]

    %% System Boundary
    subgraph GCS ["Ground Control Station (System Boundary)"]
        direction TB

        subgraph Auth ["Authentication"]
            Register(("Register Account"))
            Login(("Login (JWT)"))
        end

        subgraph Dashboard ["Visual Dashboard"]
            ViewStatus(("View Robot Status"))
            ViewMap(("View 2D Grid Map"))
            ViewSensor(("View Sensor Data"))
            ViewBattery(("View Battery Level"))
            ConnStatus(("View Connection Status"))
            WSStream(("WebSocket Telemetry"))
        end

        subgraph Control ["Robot Control"]
            Move(("Move Robot"))
            Reset(("Reset Simulation"))
        end

        subgraph Audit ["Mission Logging"]
            ViewLogs(("View Audit Logs"))
            LogCommand(("Log Command"))
        end
    end

    %% Commander connections — full access
    C --> Register
    C --> Login
    C --> ViewStatus
    C --> ViewMap
    C --> ViewSensor
    C --> ViewBattery
    C --> ConnStatus
    C --> WSStream
    C --> Move
    C --> Reset
    C --> ViewLogs

    %% Viewer connections — read-only
    V --> Register
    V --> Login
    V --> ViewStatus
    V --> ViewMap
    V --> ViewSensor
    V --> ViewBattery
    V --> ConnStatus
    V --> WSStream
    V --> ViewLogs

    %% Auditor connections — logs only
    A --> Login
    A --> ViewLogs

    %% Robot API as external actor
    R -.->|"REST API<br/>HTTP/WebSocket"| ViewStatus
    R -.-> Move
    R -.-> Reset
    R -.-> ViewMap
    R -.-> ViewSensor
    R -.-> WSStream

    %% Internal includes
    Move -.->|"«include»"| LogCommand
    Reset -.->|"«include»"| LogCommand
```

**RBAC Permission Matrix**:

| Actor | Register | Login | Status | Map | Sensors | Move | Reset | Logs | WebSocket |
|---|---|---|---|---|---|---|---|---|---|
| Commander | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Viewer | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (403) | ❌ (403) | ✅ | ✅ |
| Auditor | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |

**Code Enforcement**: The `require_commander()` FastAPI dependency checks the `role` claim in the JWT token. If `role != "Commander"`, the endpoint returns HTTP 403 Forbidden before any robot communication occurs.

---

## 2. Activity Diagram — Move Robot Command

**Purpose**: Model the complete decision flow when a Commander clicks the 'Move' button. Every diamond node represents an `if/else` block that MUST exist in the code. This diagram covers input validation, authentication, RBAC, battery checks, robot communication, retry logic, and result processing.

```mermaid
stateDiagram-v2
    [*] --> ReceiveMoveRequest

    ReceiveMoveRequest --> ValidateInput

    state validate_input <<choice>>
    ValidateInput --> validate_input

    validate_input --> ShowInputError : x or y not integer<br/>or outside 0-20
    validate_input --> CheckAuthentication : Valid coordinates

    ShowInputError --> [*]

    state check_auth <<choice>>
    CheckAuthentication --> check_auth

    check_auth --> Return401 : No JWT token<br/>or token expired
    check_auth --> CheckRole : JWT valid

    Return401 --> RedirectToLogin
    RedirectToLogin --> [*]

    state check_role <<choice>>
    CheckRole --> check_role

    check_role --> Return403 : Role = Viewer
    check_role --> CheckBattery : Role = Commander

    Return403 --> LogRejection403
    LogRejection403 --> ShowAccessDenied
    ShowAccessDenied --> [*]

    state check_battery <<choice>>
    CheckBattery --> check_battery

    check_battery --> ReturnBatteryError : Battery = 0%
    check_battery --> SendToRobotAPI : Battery > 0%

    ReturnBatteryError --> LogBatteryDead
    LogBatteryDead --> ShowBatteryDeadMessage
    ShowBatteryDeadMessage --> [*]

    state robot_responds <<choice>>
    SendToRobotAPI --> robot_responds

    robot_responds --> ProcessResponse : HTTP 200 OK
    robot_responds --> CheckRetryCount : HTTP 503 or Timeout

    state retry_check <<choice>>
    CheckRetryCount --> retry_check

    retry_check --> WaitExponentialBackoff : Retry count < 3
    retry_check --> LogFailure : Retry count = 3

    WaitExponentialBackoff --> SendToRobotAPI : Wait 2^n seconds<br/>(0.5s, 1s, 2s)

    LogFailure --> ShowSignalLost
    ShowSignalLost --> [*]

    state check_status <<choice>>
    ProcessResponse --> check_status

    check_status --> LogStuck : Status = STUCK
    check_status --> CheckLowBattery : Status = IDLE

    LogStuck --> ShowObstacleAlert
    ShowObstacleAlert --> UpdateGrid
    UpdateGrid --> [*]

    state check_low_battery <<choice>>
    CheckLowBattery --> check_low_battery

    check_low_battery --> LogSuccessWithWarning : Battery < 20%
    check_low_battery --> LogSuccess : Battery >= 20%

    LogSuccessWithWarning --> ShowLowBatteryWarning
    ShowLowBatteryWarning --> UpdateGrid

    LogSuccess --> UpdateGridSuccess
    UpdateGridSuccess --> ShowSuccessMessage
    ShowSuccessMessage --> [*]
```

**Decision Node Mapping to Code**:

| Decision Node | Yes Path | No Path | Code Location |
|---|---|---|---|
| Valid input? (integer, 0–20) | Continue to auth check | Show input error, return 422 | Frontend JS validation + Pydantic model auto-validation in FastAPI |
| Authenticated? (JWT valid) | Continue to role check | Return 401 Unauthorized, redirect to login | `get_current_user()` dependency in `main.py` |
| Role = Commander? | Continue to battery check | Return 403 Forbidden, log rejection | `require_commander()` dependency in `main.py` |
| Battery > 0%? | Send request to Robot API | Return error "Battery dead, return to (0,0)" | Status check before move in `main.py` move endpoint |
| Robot API responds? | Process the response | Enter retry loop | `_request_with_retry()` in `robot_client.py` |
| Retry count < 3? | Wait 2^n seconds, retry | Log failure, show Signal Lost | Retry counter inside `_request_with_retry()` loop |
| Status = STUCK? | Log "stuck" event, show obstacle alert on grid | Check for low battery warning | Check `response.status` field in move endpoint |
| Battery < 20% after move? | Show LOW_BATTERY warning alongside success | Show clean success message | Frontend JS checks battery in telemetry poll |

---

## 3. Class Diagram — Backend OOP Structure

**Purpose**: Show the complete Object-Oriented Programming structure of the backend. Each class maps directly to a Python class, Pydantic model, or SQLAlchemy model in the codebase. The diagram highlights the three design patterns: Singleton, Facade, and Observer.

```mermaid
classDiagram
    direction TB

    class RobotClient {
        <<Singleton + Facade>>
        -str _base_url
        -int max_retries = 3
        -float timeout = 5.0
        -list status_callbacks
        -ConnectionManager _conn_manager
        +get_status() RobotStatus
        +move(int x, int y) dict
        +reset() dict
        +get_map() MapData
        +get_sensor() SensorData
        -_request_with_retry(str method, str path, dict data) dict
    }

    class ConnectionManager {
        <<Observer>>
        -str _status
        -list~callback~ _observers
        +subscribe(callback fn) void
        +unsubscribe(callback fn) void
        +notify(str new_status) void
        +get_status() str
    }

    class RobotConnectionError {
        <<Exception>>
        +str message
    }

    class RobotStatus {
        <<Pydantic Model / Value Object>>
        +str id
        +int position_x [0-20]
        +int position_y [0-20]
        +float battery [0-100]
        +str status [IDLE|MOVING|LOW_BATTERY|STUCK]
        +is_low_battery() bool
        +is_dead() bool
        +is_stuck() bool
    }

    class MapData {
        <<Pydantic Model / Value Object>>
        +int width = 21
        +int height = 21
        +int[][] grid [0=free, 1=obstacle]
        +is_obstacle(int x, int y) bool
    }

    class SensorData {
        <<Pydantic Model / Value Object>>
        +dict proximity [N,S,E,W: int 0-5]
        +float[] lidar [360 values, range 0-10]
    }

    class ProximityData {
        <<Pydantic Model>>
        +int north [0-5]
        +int south [0-5]
        +int east [0-5]
        +int west [0-5]
    }

    class User {
        <<SQLAlchemy Model>>
        +int id [PK, auto-increment]
        +str username [unique, not null]
        +str password_hash [bcrypt, not null]
        +str role [Viewer|Commander]
        +datetime created_at
    }

    class MissionLog {
        <<SQLAlchemy Model>>
        +int id [PK, auto-increment]
        +datetime timestamp [UTC]
        +str username
        +str command_type [move|reset|status|map|sensor]
        +str parameters [JSON string]
        +str result
        +float robot_battery
        +int robot_x
        +int robot_y
    }

    class AuthService {
        <<Service>>
        +register(str username, str password, str role) User
        +login(str username, str password) str JWT
        +get_current_user(str token) User
        +require_commander(User user) User
        -_hash_password(str password) str
        -_verify_password(str password, str hash) bool
        -_create_token(dict payload) str
    }

    %% Relationships
    RobotClient "1" *-- "1" ConnectionManager : owns
    RobotClient ..> RobotStatus : returns
    RobotClient ..> MapData : returns
    RobotClient ..> SensorData : returns
    RobotClient ..> RobotConnectionError : throws
    SensorData "1" *-- "1" ProximityData : contains
    ConnectionManager "1" --> "*" RobotClient : notifies observers
    AuthService ..> User : manages
    AuthService ..> MissionLog : creates entries
    User "1" --> "*" MissionLog : generates
```

**Design Pattern Details**:

| Pattern | Applied To | How It Works | Why It Matters for Safety |
|---|---|---|---|
| **Singleton** | `robot = RobotClient()` at module level in `robot_client.py` | Python's module import system ensures only one instance exists. All route handlers in `main.py` share this single instance. | One controlled connection point prevents conflicting state. A single retry configuration and connection manager ensures predictable behaviour across all endpoints. |
| **Facade** | `RobotClient` class — methods `get_status()`, `move(x,y)`, `reset()`, `get_map()`, `get_sensor()` | Each method provides a clean, high-level interface. Internally, `_request_with_retry()` handles: httpx AsyncClient creation, URL construction, JSON serialisation, status code parsing, timeout management, and retry logic. | Callers (route handlers) never see HTTP complexity. This reduces the chance of developer error when calling the robot API — impossible to forget timeout configuration or retry logic. |
| **Observer** | `ConnectionManager` with `_observers` list | When `_request_with_retry()` detects a state change (connected → reconnecting → disconnected), it calls `_conn_manager.notify(new_state)`. All subscribed UI components update simultaneously. | Decouples connection monitoring from UI rendering. When the robot API drops, the battery bar, grid map, status indicator, and connection dot ALL update at the same time — no widget shows stale data while another shows 'Signal Lost'. |

---

## 4. Sequence Diagrams

### 4.1 Sequence Diagram — User Registration

**Purpose**: Trace the complete flow when a new user creates an account, from form submission through bcrypt hashing to database storage.

```mermaid
sequenceDiagram
    actor User as 👤 New User
    participant UI as Web Dashboard<br/>(Browser)
    participant Nginx as Nginx<br/>(Reverse Proxy)
    participant API as FastAPI<br/>(Backend)
    participant Auth as AuthService<br/>(auth.py)
    participant DB as MySQL<br/>(Database)

    User->>UI: Fill registration form<br/>(username, password, role)
    UI->>UI: Frontend validation<br/>(non-empty fields, password length)
    UI->>Nginx: POST /api/auth/register<br/>{username, password, role}
    Nginx->>API: Forward to backend:8000

    activate API
    API->>Auth: register(username, password, role)
    activate Auth

    Auth->>DB: SELECT * FROM users WHERE username = ?
    DB-->>Auth: No existing user found

    Auth->>Auth: hash = bcrypt.hash(password, rounds=12)
    Auth->>DB: INSERT INTO users (username, password_hash, role, created_at)
    DB-->>Auth: User created successfully (id=1)

    Auth-->>API: Return new User object
    deactivate Auth

    API-->>Nginx: 201 Created {message: "Registration successful"}
    deactivate API
    Nginx-->>UI: Forward response
    UI-->>User: Display success message<br/>Redirect to login page

    Note over User,DB: If username already exists:
    Note over Auth,DB: Auth returns 409 Conflict<br/>"Username already taken"
```

### 4.2 Sequence Diagram — User Login with JWT

**Purpose**: Trace the authentication flow from credential submission through bcrypt verification to JWT token issuance and storage.

```mermaid
sequenceDiagram
    actor User as 👤 User
    participant UI as Web Dashboard<br/>(Browser)
    participant Nginx as Nginx<br/>(Reverse Proxy)
    participant API as FastAPI<br/>(Backend)
    participant Auth as AuthService<br/>(auth.py)
    participant DB as MySQL<br/>(Database)

    User->>UI: Enter username + password
    UI->>Nginx: POST /api/auth/login<br/>{username, password}
    Nginx->>API: Forward to backend:8000

    activate API
    API->>Auth: login(username, password)
    activate Auth

    Auth->>DB: SELECT * FROM users<br/>WHERE username = ?
    DB-->>Auth: Return user record<br/>(id, username, password_hash, role)

    Auth->>Auth: bcrypt.verify(password, password_hash)

    alt Password matches
        Auth->>Auth: Create JWT payload<br/>{sub: username, role: role, exp: now+1h}
        Auth->>Auth: Sign JWT with HS256 secret key
        Auth-->>API: Return JWT token string
        API-->>Nginx: 200 OK {token: "eyJhbG...", role: "Commander"}
        Nginx-->>UI: Forward response
        UI->>UI: Store token in localStorage
        UI-->>User: Redirect to dashboard<br/>Show role badge
    else Password does NOT match OR username not found
        Auth-->>API: Raise 401 Unauthorized
        API-->>Nginx: 401 {error: "Invalid username or password"}
        Nginx-->>UI: Forward error response
        UI-->>User: Display generic error message
        Note over Auth: Same error for wrong username<br/>AND wrong password<br/>(prevents enumeration attacks)
    end

    deactivate Auth
    deactivate API
```

### 4.3 Sequence Diagram — Move Robot (Success)

**Purpose**: Trace the complete happy path of a Commander sending a move command through all system layers, from browser input to grid update.

```mermaid
sequenceDiagram
    actor Cmd as 🧑‍✈️ Commander
    participant UI as Web Dashboard<br/>(Browser)
    participant Nginx as Nginx<br/>(Reverse Proxy)
    participant API as FastAPI<br/>(Backend)
    participant Auth as AuthService
    participant RC as RobotClient<br/>(Facade)
    participant Robot as Robot API<br/>(Docker :5000)
    participant DB as MySQL<br/>(Database)

    Cmd->>UI: Enter X=5, Y=10<br/>Click 'MOVE' button
    UI->>UI: Validate input:<br/>integer, range 0-20
    UI->>Nginx: POST /api/move<br/>{x: 5, y: 10}<br/>Header: Authorization: Bearer eyJ...
    Nginx->>API: Forward to backend:8000

    activate API

    API->>Auth: get_current_user(token)
    Auth->>Auth: Decode JWT, verify signature & expiry
    Auth-->>API: User(username="operator1", role="Commander")

    API->>Auth: require_commander(user)
    Auth-->>API: ✅ Role check passed

    API->>RC: move(5, 10)
    activate RC

    RC->>Robot: POST /api/move<br/>{x: 5, y: 10}
    Note over RC,Robot: Random latency: 0.1s - 0.8s

    Robot-->>RC: 200 OK<br/>{id: "robot-01", position: {x:5, y:10},<br/>battery: 95.5, status: "IDLE"}
    deactivate RC

    RC->>RC: ConnectionManager.notify("connected")

    API->>DB: INSERT INTO mission_logs<br/>(timestamp, username="operator1",<br/>command_type="move",<br/>parameters='{"x":5,"y":10}',<br/>result="success",<br/>robot_battery=95.5, robot_x=5, robot_y=10)

    API-->>Nginx: 200 OK<br/>{position: {x:5,y:10}, battery: 95.5, status: "IDLE"}
    deactivate API

    Nginx-->>UI: Forward response
    UI->>UI: Update robot position on 2D grid canvas
    UI->>UI: Update battery bar (95.5% — green)
    UI->>UI: Update status indicator (IDLE — green)
    UI-->>Cmd: Grid shows robot at (5, 10)
```

### 4.4 Sequence Diagram — Move Robot (All Scenarios)

**Purpose**: Show all five alternative paths that can occur during a move command. This is the most complex sequence diagram, covering success, STUCK, dead battery, 503 retry, and Viewer rejection.

```mermaid
sequenceDiagram
    actor Cmd as 🧑‍✈️ Commander / 👁️ Viewer
    participant UI as Web Dashboard
    participant API as FastAPI Backend
    participant Auth as AuthService
    participant RC as RobotClient
    participant Robot as Robot API
    participant DB as MySQL

    Cmd->>UI: Click MOVE (x, y)
    UI->>API: POST /api/move {x, y}<br/>+ JWT token

    API->>Auth: Validate JWT + Check role

    alt Scenario 5: Viewer tries to move
        Auth-->>API: 403 Forbidden (role=Viewer)
        API->>DB: Log "rejected" (username, command, 403)
        API-->>UI: 403 {error: "Access Denied — Commander role required"}
        UI-->>Cmd: Show "Access Denied" toast
    else Authentication + RBAC passed (Commander)
        API->>RC: move(x, y)

        alt Scenario 4: Robot API outage (503 / Timeout)
            RC->>Robot: POST /api/move
            Robot-->>RC: 503 Service Unavailable

            RC->>RC: Retry 1: wait 0.5s
            RC->>Robot: POST /api/move (retry 1)
            Robot-->>RC: 503 Service Unavailable

            RC->>RC: Retry 2: wait 1.0s
            RC->>Robot: POST /api/move (retry 2)
            Robot-->>RC: 503 Service Unavailable

            RC->>RC: Retry 3: wait 2.0s
            RC->>Robot: POST /api/move (retry 3)
            Robot-->>RC: 503 Service Unavailable

            RC->>RC: ConnectionManager.notify("disconnected")
            RC-->>API: Raise RobotConnectionError

            API->>DB: Log "connection_failed"
            API-->>UI: 503 {error: "Robot unreachable"}
            UI-->>Cmd: Show "Signal Lost" (red banner)

        else Scenario 3: Dead Battery (0%)
            RC->>Robot: GET /api/status (pre-check)
            Robot-->>RC: {battery: 0.0, status: "LOW_BATTERY"}
            RC-->>API: Battery is 0%

            API->>DB: Log "battery_dead"
            API-->>UI: 400 {error: "Battery dead — return to (0,0) or reset"}
            UI-->>Cmd: Disable MOVE button, show warning

        else Robot API responds successfully
            RC->>Robot: POST /api/move {x, y}
            Robot-->>RC: 200 OK {position, battery, status}

            alt Scenario 2: STUCK (obstacle hit)
                Note over Robot: Target cell has obstacle
                RC-->>API: {status: "STUCK", position: unchanged}
                API->>DB: Log "stuck" (params, robot state)
                API-->>UI: 200 {status: "STUCK"}
                UI-->>Cmd: Red alert + obstacle marker on grid

            else Scenario 1: Success (IDLE)
                RC-->>API: {status: "IDLE", position: {x, y}, battery: N%}
                API->>DB: Log "success" (params, robot state)
                API-->>UI: 200 {status: "IDLE", position: {x,y}}
                UI->>UI: Update grid + battery bar + status
                UI-->>Cmd: Robot moved to (x, y) ✅
            end
        end
    end
```

### 4.5 Sequence Diagram — View Robot Status

**Purpose**: Trace the telemetry polling cycle that runs every 3 seconds to keep the dashboard updated with the robot's current state.

```mermaid
sequenceDiagram
    actor User as 👤 Authenticated User
    participant UI as Web Dashboard
    participant Nginx as Nginx
    participant API as FastAPI Backend
    participant RC as RobotClient
    participant Robot as Robot API

    loop Every 3 seconds (setInterval)
        UI->>Nginx: GET /api/status<br/>Header: Authorization: Bearer eyJ...
        Nginx->>API: Forward to backend:8000

        activate API
        API->>RC: get_status()
        activate RC
        RC->>Robot: GET /api/status
        Note over RC,Robot: Latency: 0.1s - 0.8s

        alt Robot API responds
            Robot-->>RC: 200 OK<br/>{id: "robot-01",<br/>position: {x: 5, y: 10},<br/>battery: 72.5,<br/>status: "IDLE"}
            RC->>RC: ConnectionManager.notify("connected")
            RC-->>API: Return RobotStatus object
            deactivate RC
            API-->>Nginx: 200 OK (JSON telemetry)
            deactivate API
            Nginx-->>UI: Forward response

            UI->>UI: Update robot icon position on 2D grid
            UI->>UI: Update battery bar<br/>(72.5% — green)
            UI->>UI: Update status text<br/>(IDLE — green dot)
            UI->>UI: Update connection indicator<br/>(Connected — green)

        else Robot API timeout/503
            Robot-->>RC: 503 or Timeout
            RC->>RC: _request_with_retry() begins
            RC->>RC: ConnectionManager.notify("reconnecting")
            RC-->>API: Eventually returns data or throws error
            API-->>UI: Response or error
            UI->>UI: Show "Reconnecting..." (yellow pulse)<br/>or "Signal Lost" (red)
        end
    end

    User-->>UI: Observes real-time dashboard updates
```

### 4.6 Sequence Diagram — View Map and Obstacles

**Purpose**: Trace how the 2D grid map is loaded and rendered, showing the 21×21 grid with 40 obstacles.

```mermaid
sequenceDiagram
    actor User as 👤 Authenticated User
    participant UI as Web Dashboard
    participant Nginx as Nginx
    participant API as FastAPI Backend
    participant RC as RobotClient
    participant Robot as Robot API

    User->>UI: Dashboard loads / clicks "Refresh Map"
    UI->>Nginx: GET /api/map<br/>Header: Authorization: Bearer eyJ...
    Nginx->>API: Forward to backend:8000

    activate API
    API->>RC: get_map()
    activate RC
    RC->>Robot: GET /api/map

    Robot-->>RC: 200 OK<br/>{width: 21, height: 21,<br/>grid: [[0,1,0,...], [0,0,1,...], ...]}
    Note over Robot: 40 obstacles randomly placed<br/>Position (0,0) always free
    deactivate RC

    RC-->>API: Return MapData object
    API-->>Nginx: 200 OK (map JSON)
    deactivate API
    Nginx-->>UI: Forward response

    UI->>UI: Parse 21×21 grid array
    UI->>UI: Render on HTML5 Canvas:<br/>• Free cells = dark background<br/>• Obstacle cells = red/grey blocks<br/>• Robot position = distinctive icon<br/>• Axis labels X (0-20), Y (0-20)

    UI-->>User: Display complete 2D grid map<br/>with obstacles and robot position
```

### 4.7 Sequence Diagram — View Sensor Data

**Purpose**: Trace how the robot's proximity sensors and lidar readings are retrieved and displayed.

```mermaid
sequenceDiagram
    actor User as 👤 Authenticated User
    participant UI as Web Dashboard
    participant Nginx as Nginx
    participant API as FastAPI Backend
    participant RC as RobotClient
    participant Robot as Robot API

    User->>UI: Navigate to sensor panel
    UI->>Nginx: GET /api/sensor<br/>Header: Authorization: Bearer eyJ...
    Nginx->>API: Forward to backend:8000

    activate API
    API->>RC: get_sensor()
    activate RC
    RC->>Robot: GET /api/sensor

    Robot-->>RC: 200 OK<br/>{proximity: {N: 3, S: 5, E: 1, W: 4},<br/>lidar: [2.5, 3.1, ..., 7.8]}
    Note over Robot: Proximity: distance to nearest obstacle<br/>in N/S/E/W (max range: 5 units)<br/>Lidar: 360 readings at 1° intervals<br/>(max range: 10 units)
    deactivate RC

    RC-->>API: Return SensorData object
    API-->>Nginx: 200 OK (sensor JSON)
    deactivate API
    Nginx-->>UI: Forward response

    UI->>UI: Display proximity readings:<br/>N=3, S=5, E=1, W=4
    UI->>UI: Display lidar visualization<br/>(360° distance array)

    UI-->>User: Show complete sensor readout
```

### 4.8 Sequence Diagram — View Mission Logs

**Purpose**: Trace how the audit trail is retrieved and displayed, showing the complete history of all commands sent to the robot.

```mermaid
sequenceDiagram
    actor User as 👤 Authenticated User<br/>(Any Role)
    participant UI as Web Dashboard
    participant Nginx as Nginx
    participant API as FastAPI Backend
    participant DB as MySQL Database

    User->>UI: Click "Mission Logs" tab
    UI->>Nginx: GET /api/logs?page=1&limit=20<br/>Header: Authorization: Bearer eyJ...
    Nginx->>API: Forward to backend:8000

    activate API
    API->>API: Verify JWT token (any role allowed)

    API->>DB: SELECT * FROM mission_logs<br/>ORDER BY timestamp DESC<br/>LIMIT 20 OFFSET 0

    DB-->>API: Return 20 log entries:<br/>[{id, timestamp, username,<br/>command_type, parameters,<br/>result, robot_battery,<br/>robot_x, robot_y}, ...]
    deactivate API

    API-->>Nginx: 200 OK {logs: [...], total: 156, page: 1}
    Nginx-->>UI: Forward response

    UI->>UI: Render log table:<br/>| Timestamp | User | Command | Params | Result | Battery | Position |
    UI->>UI: Display pagination controls<br/>(Page 1 of 8)

    UI-->>User: View chronological audit trail<br/>of all robot interactions
```

---

## 5. Component Diagram — Docker Architecture

**Purpose**: Show the physical deployment architecture — which Docker containers exist, what files they contain, how they communicate over the network, and which ports they use.

```mermaid
graph TB
    subgraph Host["Host Machine (Developer's Computer)"]
        Browser["🌐 Web Browser<br/>http://localhost:8080"]
    end

    subgraph DockerNetwork["Docker Network (gcs-network)"]
        subgraph FrontendContainer["frontend (Nginx Container)"]
            NginxConf["nginx.conf<br/>• Reverse proxy rules<br/>• /api/* → backend:8000<br/>• /ws/* → backend:8000<br/>• Security headers"]
            StaticFiles["public/<br/>• index.html<br/>• styles.css<br/>• app.js"]
        end

        subgraph BackendContainer["backend (FastAPI Container)"]
            MainPy["main.py<br/>• API route handlers<br/>• WebSocket endpoint<br/>• RBAC dependencies"]
            AuthPy["auth.py<br/>• JWT creation/verification<br/>• bcrypt hashing<br/>• Role enforcement"]
            RobotClientPy["robot_client.py<br/>• RobotClient (Singleton+Facade)<br/>• ConnectionManager (Observer)<br/>• _request_with_retry()"]
            ModelsPy["models.py<br/>• User (SQLAlchemy)<br/>• MissionLog (SQLAlchemy)<br/>• RobotStatus (Pydantic)<br/>• MapData (Pydantic)<br/>• SensorData (Pydantic)"]
            MissionLoggerPy["mission_logger.py<br/>• log_mission() function"]
            LegacyStatsPy["legacy_stats.py<br/>• Mission score calculation"]
        end

        subgraph RobotContainer["robot-api (Simulation Container)"]
            RobotSim["Virtual Robot Simulator<br/>• 21×21 grid environment<br/>• 40 random obstacles<br/>• Battery mechanics<br/>• Chaos monkey (503 errors)<br/>• Random latency (0.1-0.8s)"]
            SwaggerUI["Swagger UI<br/>/docs"]
            WSEndpoint["WebSocket<br/>/ws/telemetry (1Hz)"]
        end

        subgraph DatabaseContainer["database (MySQL 8.0 Container)"]
            UsersTable["users table<br/>• id, username<br/>• password_hash<br/>• role, created_at"]
            MissionLogsTable["mission_logs table<br/>• id, timestamp<br/>• username, command_type<br/>• parameters, result<br/>• robot_battery, robot_x, robot_y"]
            Volume["📦 Named Volume: db_data<br/>(persists across restarts)"]
        end
    end

    subgraph CI["GitHub Actions (CI/CD)"]
        Job1["Job 1: Lint + Unit Tests<br/>• Flake8 (complexity ≤ 5)<br/>• pytest on SQLite<br/>• Python 3.11 + 3.12 matrix"]
        Job2["Job 2: Docker Integration<br/>• docker-compose build<br/>• Health check wait<br/>• pytest inside backend container<br/>• Against real MySQL + Robot API"]
    end

    Browser -->|":8080 HTTP/WS"| FrontendContainer
    FrontendContainer -->|":8000 /api/* /ws/*"| BackendContainer
    BackendContainer -->|":5000 REST API"| RobotContainer
    BackendContainer -->|":3306 SQL"| DatabaseContainer

    style RobotContainer fill:#ff6b6b22,stroke:#ff6b6b
    style FrontendContainer fill:#4ecdc422,stroke:#4ecdc4
    style BackendContainer fill:#45b7d122,stroke:#45b7d1
    style DatabaseContainer fill:#96ceb422,stroke:#96ceb4
```

**Network Flow**: Browser → Nginx (:8080) → Backend (:8000) → Robot API (:5000, internal only). The browser NEVER communicates directly with the Robot API or Backend — all traffic is routed through Nginx. This eliminates CORS issues and adds a security layer by keeping internal services unexposed to the host.

**Container Details**:

| Container | Base Image | Exposed Port | Internal Port | Key Configuration |
|---|---|---|---|---|
| frontend | nginx:alpine | 8080 (host) | 80 | Reverse proxy: `/api/*` and `/ws/*` forwarded to backend:8000. Security headers: X-Frame-Options, X-Content-Type-Options. |
| backend | python:3.12-slim | — (internal only) | 8000 | Multi-stage Dockerfile: dev stage (hot-reload with uvicorn --reload) / production stage (non-root user 'gcs'). Reads `ROBOT_API_URL` and `DATABASE_URL` from environment. |
| robot-api | Pre-built simulation image | — (INTERNAL ONLY) | 5000 | NOT exposed to host — defence in depth. Only backend can reach it. Chaos monkey: latency 0.1–0.8s, 503 outages 5–10s. |
| database | mysql:8.0 | — (internal only) | 3306 | Stores `users` and `mission_logs` tables. Named volume `db_data` for persistence. |

---

## 6. Entity Relationship Diagram

**Purpose**: Show the database schema — the two tables that store all persistent data in the system.

```mermaid
erDiagram
    USERS {
        int id PK "Auto-increment primary key"
        varchar username UK "Unique, not null"
        varchar password_hash "bcrypt hash, not null"
        varchar role "Viewer | Commander"
        datetime created_at "UTC timestamp"
    }

    MISSION_LOGS {
        int id PK "Auto-increment primary key"
        datetime timestamp "UTC timestamp of command"
        varchar username FK "Operator who issued command"
        varchar command_type "move | reset | status | map | sensor"
        text parameters "JSON string: {x: 5, y: 10}"
        varchar result "success | stuck | connection_failed | rejected"
        float robot_battery "Battery % at time of command"
        int robot_x "Robot X position at time of command"
        int robot_y "Robot Y position at time of command"
    }

    USERS ||--o{ MISSION_LOGS : "generates"
```

**Table Details**:

The `users` table stores authentication data. Passwords are never stored in plain text — only bcrypt hashes with 12 salt rounds. The `role` column enforces RBAC at the application level.

The `mission_logs` table provides a complete, immutable audit trail. Every interaction with the robot is recorded with the operator's identity, the exact command and parameters, the robot's response, and the robot's state (battery and position) at the moment the command was executed. This supports forensic investigation of any incident.

---
