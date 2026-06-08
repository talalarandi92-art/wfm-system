# ADD THIS TO CLAUDE CODE NOW

Important new mandatory requirements:

Before building more features, update the architecture and implementation plan to support:

## 1. Scalability
- The application must support at least 1,000 concurrent active users.
- The app must not freeze, hang, crash, duplicate requests, overwrite schedules, or lose data if many users submit requests at the same time.
- Heavy operations like Excel imports, exports, report generation, schedule generation, attendance recalculation, scorecard recalculation, and dashboard recalculation must run asynchronously using background jobs/queues.
- Use pagination, database indexes, caching, connection pooling, rate limiting, and optimized queries.
- Add load testing using k6, Artillery, or JMeter.
- The system must pass a 1,000 concurrent users load test before production.

## 2. Cybersecurity
- Apply enterprise-grade security from the start.
- Use secure authentication, strong password hashing, JWT refresh rotation, RBAC, backend permission checks, rate limiting, input validation, secure file upload handling, CORS restrictions, security headers, audit logs, and secret management.
- Protect against OWASP risks including SQL injection, XSS, CSRF, IDOR, brute force, broken access control, file upload abuse, and privilege escalation.
- Do not store secrets in code or frontend.
- Do not expose sensitive business logic only in frontend.

## 3. Intellectual Property Protection
- The project must be protected from copying/theft as much as technically possible.
- Keep repository private.
- Enforce 2FA for developers.
- Use branch protection and pull requests.
- Restrict repo/server/database access by least privilege.
- Add proprietary ownership notice.
- Do not expose production database publicly.
- Audit admin actions and large exports.
- Remove access immediately when someone leaves.
- Use NDAs/IP assignment/legal ownership documents for anyone with source access.

Read `docs/WFM_SECURITY_SCALABILITY_ADDENDUM.md` and incorporate it into the architecture before continuing.

Do not start coding until you explain:
1. Architecture changes needed
2. Backend security additions
3. Database indexes/queues/caching needed
4. Repository/deployment protection plan
5. Load testing plan
6. Security testing plan