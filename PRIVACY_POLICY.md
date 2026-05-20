# privacy policy - Robot Management System (Ground control System)

## 1 Data collected

**User Account Data:**
- Usernames chosen during registration
- Hashed passwords (stored using Bcrypt; raw passwords are never stored)
- Assigned user role (Viewer or Commander)

**Mission Logging / Audit Trail Data:**
- Timestamps of all commands issued to the robot
- Username of the operator who issued each command
- Command type and parameters (e.g., move to coordinates X=5, Y=10)
- Robot status responses associated with each command

**Technical Data:**
- Session tokens (JWT) for authentication purposes

## 2 Purpose of Collection 

- **User account data** is collected solely to implement Role-Based Access
  Control (RBAC), ensuring only authorised personnel can issue movement
  commands to the robot. This is a safety-critical requirement.
- **Audit trail data** is collected to satisfy the safety accountability
  requirements of the Ground Control Station. In the event of a robot
  malfunction or incident, the audit log enables post-incident investigation.
- **Session tokens** are used exclusively for authentication and expire
  after a defined period.

## 3. Data Minimisation

In accordance with GDPR Article 5(1)(c), this system applies the
**Data Minimisation** principle:

- Only data strictly necessary for system operation and safety auditing
  is collected.
- Raw passwords are never stored — only Bcrypt hashes.
- No unnecessary personal information (email, phone, address) is required
  for registration.
- Robot telemetry data (battery, position) is not linked to individual
  users unless as part of a commanded action.

## 4. Data Security

- All passwords are encrypted using **Bcrypt** hashing algorithm.
- Access to the audit log is restricted via **RBAC** — only users with
  the appropriate role can view mission logs.
- Authentication uses **JWT (JSON Web Tokens)** with expiration times.
- The application runs in **Docker containers**, providing process
  isolation.
- No hardcoded credentials exist in the codebase (enforced via the
  Definition of Done checklist in Pull Requests).

## 5. Data Retention & Right to Erasure

- Audit logs are retained for a maximum period appropriate to the
  operational context (e.g., 12 months for safety compliance).
- Users may request deletion of their personal data in accordance with
  GDPR Article 17 ("Right to be Forgotten").
- Upon account deletion, the user's personal identifiers in audit logs
  are anonymised (replaced with a hash) rather than deleted, to preserve
  the integrity of the safety audit trail.

## 6. Storage Limitation

Data is stored in a local database within the Docker
environment. No data is transmitted to external third-party services.

