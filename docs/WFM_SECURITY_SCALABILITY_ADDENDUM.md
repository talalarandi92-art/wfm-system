# WFM SECURITY, SCALABILITY & IP PROTECTION ADDENDUM

## Purpose

This document adds mandatory non-functional requirements to the Boutiqaat WFM System.

These requirements are critical and must be considered before implementation, not after development.

The system must be designed so that:
1. The application can handle high concurrent usage without freezing, crashing, or becoming unusable.
2. The project code, business logic, database, and intellectual property are protected from theft, copying, unauthorized access, and misuse.
3. Security and scalability are part of the architecture from day one.

---

# 1. Scalability / Performance Requirements

## 1.1 Concurrent Users

The system must support at least:

- 1,000 concurrent active users
- Many users submitting requests at the same time
- Many approvers reviewing requests at the same time
- Agents checking schedules, scorecards, attendance, and requests
- RTA/WFM users monitoring live dashboards
- Admin users importing/exporting reports

The application must not freeze, hang, crash, duplicate requests, overwrite schedules, or lose data under this load.

## 1.2 Target Response Times

Recommended targets:

| Operation | Target |
|---|---:|
| Login | < 2 seconds |
| Open dashboard | < 3 seconds |
| Submit request | < 2 seconds |
| Approve/reject request | < 2 seconds |
| Load schedule grid | < 5 seconds |
| Search/filter employees | < 2 seconds |
| Export large reports | Async/background job |
| Large Excel import | Async/background job |
| Schedule generation | Async/background job |
| Recalculate attendance/HC | Async/background job |

If an operation takes time, the UI must show job progress/status instead of freezing.

## 1.3 Architecture Requirements

Claude Code must design with scalability in mind:

- Stateless backend APIs where possible
- PostgreSQL connection pooling
- Proper database indexing
- Server-side pagination
- Server-side filtering/search
- Caching for dashboard/reference data
- Background jobs for heavy processing
- Queue system for imports, exports, recalculations, notifications, and schedule generation
- Async processing for Excel imports and reports
- Rate limiting on APIs
- Avoid loading huge datasets into frontend memory
- Avoid recalculating heavy dashboards on every request
- Use transactions for approvals and schedule edits
- Use optimistic locking/versioning where concurrent edits can happen

Recommended components:
- Redis for cache/queues/rate limiting
- BullMQ or equivalent queue system
- Object storage for attachments/import files
- Read replica later if reporting becomes heavy
- CDN for static assets if needed

## 1.4 Database Performance

The database must include indexes for common filters:

- employee_id
- date
- function_id
- team_id
- schedule_id
- status
- request_type
- created_at
- shift_code
- import_batch_id

Composite indexes should exist for:

- employee_id + date
- function_id + date
- status + created_at
- request_type + status
- schedule_id + employee_id
- function_id + interval_start
- import_batch_id + row_status

Rules:
- No unbounded list queries.
- Pagination is required for all list APIs.
- Avoid N+1 queries.
- Use DB transactions for critical updates.
- Large dashboards should use snapshots/materialized views/cached aggregates where needed.

## 1.5 Heavy Operations Must Be Async

The following must not block the UI:

- Large Excel import
- Large Excel export
- Schedule generation
- Monthly schedule generation
- Attendance recalculation
- Headcount interval recalculation
- Shift-rate YTD recalculation
- Scorecard recalculation
- Report generation
- Bulk notifications

They must use:
- Job queue
- Progress status
- Retry handling
- Failure reason
- Audit log
- Result download when completed

## 1.6 Load Testing

Before production, the system must pass load testing.

Minimum scenarios:
- 1,000 users logged in
- 1,000 users opening dashboard
- 1,000 users submitting/viewing requests
- 200 users approving/rejecting requests
- 50 users exporting reports
- 10 users importing files
- Live dashboard refresh during active usage

Suggested tools:
- k6
- Artillery
- JMeter

Acceptance:
- No crash
- No duplicate approvals
- No data loss
- No schedule overwrite
- No database deadlocks under normal load
- Response times remain acceptable
- Heavy jobs do not freeze the app

---

# 2. Cybersecurity Requirements

## 2.1 Security From Day One

Security must be part of development from the beginning.

Use OWASP best practices and protect against:
- SQL injection
- XSS
- CSRF
- IDOR
- Brute force
- Broken access control
- File upload abuse
- Privilege escalation
- Sensitive data exposure

## 2.2 Authentication

Must include:
- Strong password hashing such as Argon2id or bcrypt
- JWT access tokens with short lifetime
- Refresh token rotation
- Refresh token revocation
- Secure logout
- Account disable/lock
- Password reset flow
- Optional MFA future
- Optional SSO/SAML/OIDC future

Never store plain-text passwords.

## 2.3 Authorization

Must include:
- Role-based access control
- Backend permission checks, not frontend-only
- Entity-level access checks
- Frontend route guards
- Permission-based action controls

Examples:
- Agent cannot view another agent’s private records.
- TL can only view assigned teams unless granted more.
- RTA can validate issues and monitor live operations.
- HR can manage attendance/leave/user activation.
- WFM/Supervisor can edit schedules.
- Only authorized users can export sensitive reports.

## 2.4 API Security

All APIs must include:
- DTO validation
- Input validation
- Output sanitization where needed
- Rate limiting
- Request size limits
- CORS restrictions
- CSRF protection if cookies are used
- Security headers
- Safe error responses without leaking stack traces
- Centralized exception handling

## 2.5 Data Protection

Protect:
- Employee personal data
- Emails
- Attendance records
- Scorecards
- Coaching notes
- HR records
- Imported Excel files
- Attachments
- Audit logs

Requirements:
- HTTPS/TLS in production
- Encryption at rest where infrastructure supports it
- Role-based data access
- Audit sensitive actions
- Mask sensitive fields where needed
- Secure backups

## 2.6 Secure File Upload

For Excel imports and attachments:
- Restrict allowed file types
- Restrict file size
- Validate file content, not only extension
- Store files outside public web root
- Generate safe file names
- Prevent path traversal
- Do not execute uploaded files
- Virus scanning recommended in production
- Attachment access must be permission-protected

## 2.7 Audit Logging

Audit must cover:
- Login attempts
- Failed login attempts
- User creation
- Role changes
- User activation/deactivation
- Schedule generation
- Schedule edits
- Schedule publish
- Request approval/rejection
- Attendance edits
- Import commit
- Sensitive exports
- Outage updates
- Technical issue updates
- Scorecard publish
- Settings changes

Audit log fields:
- Actor
- Action
- Entity type
- Entity ID
- Timestamp
- Old value
- New value
- IP/user agent if available
- Reason/comment if applicable

Audit logs should be append-only as much as possible.

---

# 3. Intellectual Property / Anti-Theft Protection

## 3.1 Important Reality

No system can fully guarantee that nobody can copy code if they have full source-code or server access.

But the project must strongly reduce theft risk using:
- Repository protection
- Access control
- Least privilege
- Secrets protection
- Ownership notices
- Audit trails
- Secure deployment
- Legal/IP agreements

## 3.2 Source Code Protection

Required:
- Keep repository private
- Use GitHub/GitLab/Bitbucket organization access controls
- Enforce 2FA for developers
- Least-privilege access
- Branch protection
- Pull requests required
- Code review required
- Disable force-push to main
- Track commit history
- Remove access immediately when someone leaves
- Use signed commits if possible

## 3.3 Secrets Protection

Never commit:
- Database passwords
- API keys
- JWT secrets
- SMTP passwords
- Cloud credentials
- Private keys
- Production environment variables

Use:
- `.env.example`
- Secret manager
- GitHub Actions secrets
- Cloud provider secrets
- Environment variables
- Secret scanning

## 3.4 Ownership Notice

Add ownership notice in:
- README
- LICENSE or proprietary notice
- Login/About page
- Footer
- Source headers if desired

Suggested notice:

> This software is proprietary and confidential. Unauthorized copying, distribution, modification, reverse engineering, or use is strictly prohibited without written permission from the owner.

## 3.5 Production Access Protection

Production access must be restricted:
- SSH keys only, not passwords
- MFA where available
- Firewall rules
- Database not publicly exposed
- Admin panel restricted
- Encrypted backups
- Protected logs
- Separate dev/staging/prod
- No shared admin accounts

## 3.6 Backend Owns Sensitive Logic

Frontend JavaScript can be viewed by users after deployment.

Therefore, sensitive logic must live in backend:
- Authorization
- Final schedule approval
- Attendance calculations
- Final scorecard calculations
- Generator save/publish
- Permission HC approval
- Security checks
- Business rule enforcement

Frontend may preview, but backend must validate again.

## 3.7 Legal Protection

Technical controls are not enough.

Recommended:
- NDA for anyone with code access
- IP ownership agreement
- Proprietary license
- Access policy
- Contractor/vendor agreement
- Written ownership statement

---

# 4. Required Additions To Architecture

Claude Code must add or verify:

## Backend
- Helmet/security headers
- CORS whitelist
- Rate limiting
- Request body size limits
- Global DTO validation
- Safe global exception filter
- Audit interceptor/middleware
- Permission guard
- Entity-level access checks
- Secure file upload validation
- Background queue structure
- Health check endpoint
- Graceful shutdown

## Frontend
- No secrets in frontend
- Route guards
- Role-based navigation
- Auto logout on invalid token
- Clear unauthorized messages
- No hidden admin action exposed to unauthorized roles

## Database
- Indexing strategy
- Migration-only schema changes
- No synchronize in production
- Audit protection
- Backups
- Transactions
- Concurrency/versioning for schedule edits

## DevOps
- Private repo
- Branch protection
- CI build
- Dependency scanning
- Secret scanning
- Staging environment
- Production environment
- Secure environment variables
- HTTPS
- Backup and monitoring plan

---

# 5. Acceptance Criteria

The system is not production-ready unless:

## Scalability
1. Supports 1,000 concurrent active users in load test.
2. Request submission does not duplicate or lose data under load.
3. Approval workflow remains consistent under concurrent approvals.
4. Schedule edits do not overwrite each other silently.
5. Large imports/exports run asynchronously.
6. Dashboards use optimized/cached queries.
7. Database indexes exist for critical queries.
8. API rate limiting is enabled.
9. UI remains responsive during heavy operations.

## Security
1. Authentication is secure.
2. Passwords are hashed.
3. Backend RBAC works.
4. Agents cannot access other agents’ private records.
5. Unauthorized users cannot edit schedules.
6. Exports are permission-controlled.
7. Audit logs record sensitive actions.
8. File uploads are validated.
9. Secrets are not committed.
10. Production DB is not public.
11. HTTPS is used in production.
12. Admin actions are logged.
13. Rate limiting protects login and APIs.
14. OWASP risks are addressed.
15. Repository access is private and controlled.