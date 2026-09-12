# Security Review: Provider Intelligence Platform

Review scope: architecture as described in project CORRECTIONS.md, frontend spec, and phynpi.md. No source code, Dockerfile, or deployment configuration was available for inspection. This is a design-level review; findings based on stated facts are actionable, findings requiring code verification are marked as such.

## 1. Current PHI Posture

The platform currently serves only public US government data: the NPI Registry (public under FOIA), the CMS MIPS QPP Experience dataset, and Care Compare hospital measures. No patient data, no user account data, no claims data is present.

Consequences:

- The HIPAA Security Rule (45 CFR 164 Subpart C) does not strictly apply today. There is no PHI, no covered-entity data, and presumably no business associate relationship with respect to this system.
- However, provider NPIs combined with search behavior can become sensitive. If any user authentication is ever added, server logs of search queries (for example, a logged-in user repeatedly searching providers in a specialty or geography) can reveal employment relationships, competitive intelligence, or investigation targets. That data becomes regulated by internal policy and possibly state privacy law even if not HIPAA PHI.
- The moment any protected data is introduced, the legal posture changes immediately and non-optionally:
  - User accounts tied to employer NPIs with any health-adjacent context: triggers contractual confidentiality obligations and potentially state law.
  - Saved watchlists, patient panels, claims data, or any data received from a covered entity: triggers HIPAA directly, including the requirement for a signed Business Associate Agreement (BAA) before the data is received, a formal risk analysis, and the full administrative, physical, and technical safeguards of the Security Rule. Receiving PHI first and signing the BAA later is itself a violation.
  - Operational changes at that point: access control, audit logging, encryption, workforce training, incident response plan, breach notification procedures (60 day clock under 45 CFR 164.400), and data retention/disposal policy all become mandatory, not aspirational.

Design implication: because protected data is a plausible future state, the auth, logging, and encryption gaps below should be fixed before the feature that introduces protected data ships, not after.

## 2. Hardening Backlog

### P0: Must fix before any real deployment (including the public-data app)

**P0-1. Unauthenticated bulk ingest endpoint (POST /providers/bulk-data)**

- What is wrong: The endpoint is described as "Bulk export/ingest". Ingest implies write access to the database via the API, there is no authentication or authorization layer anywhere in the materials, and the endpoint contract is unverified.
- Concrete risk: An unauthenticated write path to the primary data store is the single highest risk in the design. Any internet client can potentially insert, overwrite, or corrupt provider records and poison the PostgreSQL cache that all other endpoints read from. Because cache hit and miss shapes are normalized, poisoned cache rows are indistinguishable from legitimate ones to clients. Bulk export without auth also enables full-database exfiltration and denial of service via large exports.
- What must change: Verify the actual contract immediately. If ingest exists, remove it from the public API surface entirely; data loading should be an offline job (the documented top-up job pattern), not an HTTP endpoint. If it must remain an endpoint, require a strongly authenticated service account (mTLS or signed request, not a static bearer token in .env), IP allowlisting, payload size limits, schema validation on every row, and idempotent, audited writes. Bulk export needs auth, per-caller quotas, and row/byte caps.

**P0-2. No authentication or authorization layer**

- What is wrong: No auth mechanism is mentioned anywhere in the materials; treat it as absent. Every endpoint, including any future write or admin path, is anonymous.
- Concrete risk: Today this enables abuse of the bulk endpoint (P0-1), unlimited scraping, and cost amplification against upstream CMS APIs. For any future protected data it is a categorical blocker: HIPAA requires unique user identification (164.312(a)(2)(i)) and access control (164.312(a)(1)).
- What must change: For the public app, add at minimum API-key or OAuth2 client-credentials auth for any non-read-only endpoint. For future protected data: centralized identity (OIDC via a managed IdP, not hand-rolled password storage), short-lived access tokens, refresh token rotation, MFA for privileged roles, and server-side session invalidation. Never build session management from scratch.

**P0-3. No authorization or access control model (future protected data)**

- What is wrong: Even with authentication added, nothing in the design distinguishes what a caller may do or see.
- Concrete risk: Authenticated users could read or modify data belonging to other tenants or roles. Under HIPAA this violates minimum necessary (164.502(b)) and access control requirements.
- What must change: Define an RBAC model before protected data arrives: roles such as viewer, analyst, admin, service-account; enforce authorization in middleware on every route (deny by default); scope queries by tenant/organization at the database layer, not in application code that can be bypassed; consider PostgreSQL row-level security as a second enforcement layer.

**P0-4. No TLS termination mentioned anywhere**

- What is wrong: There is no mention of TLS termination, certificates, or HTTPS enforcement.
- Concrete risk: If deployed over plain HTTP, all API traffic (including future credentials and any protected data) is exposed in transit. Even today, plain HTTP allows response tampering by any network intermediary.
- What must change: Terminate TLS at a load balancer or reverse proxy (or managed platform equivalent), redirect all HTTP to HTTPS, set HSTS, and encrypt the app-to-PostgreSQL connection as well (sslmode=require at minimum, verify-full preferred). HIPAA 164.312(e)(1) makes transmission security mandatory once PHI exists.

**P0-5. No audit logging (future protected data)**

- What is wrong: No audit logging is mentioned. Services log real errors, but there is no record of who accessed or changed what.
- Concrete risk: Without audit trails, a breach or data corruption event cannot be detected, scoped, or reported. HIPAA requires audit controls (164.312(b)) and the ability to support breach notification.
- What must change: Log, at minimum: authentication success/failure, authorization denials, all data reads of protected records, all writes (with before/after identity of the actor), bulk operations, and administrative actions. Route audit events to a separate, append-only store (different credentials than the app DB), with integrity protection (hash chaining or a managed immutable log service) and a retention of at least 6 years to match HIPAA documentation retention expectations. Audit logs must not contain PHI payloads themselves.

**P0-6. Secrets handling is a single .env file with no management story**

- What is wrong: .env holds secrets; instructions say never print them; nothing else is known. No rotation, no access scoping, no distinction between dev and prod secrets.
- Concrete risk: .env files end up in git history, CI logs, container images, and developer laptops. A leaked database password against an internet-reachable PostgreSQL is a full compromise.
- What must change: Verify .env is in .gitignore and has never been committed (check history, not just current tree). Move production secrets to a secrets manager (AWS Secrets Manager, GCP Secret Manager, Vault, or platform-native secret stores), inject at runtime, rotate on a schedule and on any suspected exposure. Enforce in code review tooling (gitleaks or equivalent in CI). Never bake .env into Docker images or COPY it in a Dockerfile.

### P1: Fix before production hardening sign-off

**P1-1. In-memory fixed-window rate limiter**

- What is wrong: express-rate-limit was specified but is absent from package.json; src/middleware/rateLimiter.js is a custom in-memory fixed-window limiter: single-process, resets on restart, no distributed state.
- Concrete risk: Rate limits are trivially defeated by an application restart (including crashes the attacker can potentially induce), and are wrong by a factor of N once more than one process runs. Fixed-window counters also permit up to 2x the limit at window boundaries. Combined with P0-1/P0-2, there is effectively no abuse protection.
- What must change: Replace with a shared-store limiter (Redis-backed, sliding window), applied per-IP and per-credential, with stricter limits on the bulk endpoint and any write path. Do not ship hand-rolled rate limiting.

**P1-2. Error handling: 500 on not-found; error detail leakage risk**

- What is wrong: Services correctly log the real error and throw generic messages, but getProviderByNpi throws on not-found and it surfaces as a 500.
- Concrete risk: (a) A 404 condition returned as 500 corrupts monitoring, hides real 500s in noise, and trains operators to ignore alerts. (b) Any endpoint where the real error (which may include SQL text, stack traces, or query parameters) escapes the generic-message pattern leaks schema and internals to attackers. This must be verified in code for every route, since only the pattern was described, not proven.
- What must change: Map not-found to 404 with a stable error body. Add a final Express error-handling middleware that guarantees no stack trace, SQL, or internal path reaches the client in any environment, and verify NODE_ENV gating of Express default error output.

**P1-3. No security headers or CORS policy**

- What is wrong: Neither is mentioned in the materials.
- Concrete risk: Missing headers (CSP, X-Content-Type-Options, X-Frame-Options or frame-ancestors, Referrer-Policy) leave the React app exposed to clickjacking and XSS amplification. An absent CORS policy usually means either fully open (Access-Control-Allow-Origin: *) or broken. A wildcard origin is tolerable for truly public read-only data but becomes a data-leak vector the moment any credentialed endpoint exists.
- What must change: Add helmet with an explicit configuration. Define a CORS allowlist of known frontend origins; never combine credentials: true with wildcard origins. Revisit CORS before any authenticated endpoint ships.

**P1-4. Input validation on npi, taxonomy, and year parameters**

- What is wrong: Analytics SQL is parameterized ($1, $2, $3) and the one template-literal branch adds only a static clause with no user data, which is good. However, there is no mention of semantic validation: NPI is a 10-digit numeric string with a Luhn check digit, taxonomy codes have a known format, year has a bounded range. CMS QPP values arrive as strings (including footnote codes where scores are expected) and numeric coercion happens in services.
- Concrete risk: Parameterization stops SQL injection, but unvalidated inputs still cause: type-confusion errors that hit the 500 path, cache key pollution (every malformed param becomes a distinct cache row in PostgreSQL, an unbounded-growth / cache-flooding vector), and incorrect coercion of footnote codes into NaN or zero, producing silently wrong analytics presented as provider quality data.
- What must change: Validate and reject at the route boundary (e.g., zod or Joi schemas): NPI as exactly 10 digits passing Luhn, year within the supported CMS range, taxonomy against an allowlist or regex. Coerce QPP footnote codes to an explicit null/footnote state, never to a number. Cap pagination size and bulk request sizes.

**P1-5. Encryption at rest and database exposure (future protected data; baseline now)**

- What is wrong: No mention of encryption at rest, and PostgreSQL exposure is unaddressed. The DB is read-only in normal operation with a top-up job writing cache rows, which implies the app and job share write-capable credentials.
- Concrete risk: If the DB port is reachable or the host is compromised, all data (and future PHI) is exposed. Shared write credentials mean an app-tier SQL injection or SSRF gains write access the read-only design was supposed to prevent.
- What must change: PostgreSQL must listen only on a private network/interface, never publicly. Use separate DB roles: a read-only role for the API and a narrowly-scoped writer role for the top-up job only. Enable storage-level encryption (managed disk encryption is sufficient for public data; HIPAA at-rest encryption, 164.312(a)(2)(iv), is addressable but expected in practice for PHI).

**P1-6. Audit logging for the current app (abuse forensics)**

- What is wrong: Even without PHI, there is no logging of bulk endpoint usage, rate-limit hits, or validation failures.
- Concrete risk: Cache poisoning or bulk abuse would leave no forensic trail.
- What must change: Structured access logs (method, route, status, latency, caller identity once auth exists, rate-limit decisions) shipped to a log store outside the app host. Retention of at least 90 days for security events.

### P2: Harden and verify

**P2-1. Dependency hygiene and pinning**

- What is wrong: The rate-limiter discrepancy (documented dependency absent from package.json) suggests dependency drift. Nothing is said about lockfiles, pinning, or vulnerability scanning.
- Concrete risk: Unpinned or drifting dependencies pull in known-vulnerable versions of Express ecosystem packages; this is the most common real-world Node compromise path.
- What must change: Commit package-lock.json, use npm ci in builds and Docker, run npm audit and Dependabot/Renovate in CI, pin major versions, and add a CI gate that fails on known high/critical vulnerabilities.

**P2-2. Log content: query parameters and PII-adjacent search terms**

- What is wrong: Services "log the real error". Real errors in Express/Postgres frequently embed the offending query text and bound parameters, which for this app include provider names, specialties, and geographies that users searched for. If user accounts are ever added, these logs link identities to interest in specific providers.
- Concrete risk: Logs become an ungoverned secondary datastore of sensitive search behavior, typically shipped to third-party log services with weaker access controls than the primary DB.
- What must change: Log structured error metadata (error class, route, status, correlation ID) but redact bound parameter values and query strings by default. Document a log redaction policy and verify it in code review. Set access controls and retention on the log store.

**P2-3. Docker and deployment unknowns**

- What is wrong: Root Dockerfile and docker-compose.yml are planned (phynpi.md section 9) but not built; contents unknown.
- Concrete risk: Common failure modes to preclude by policy: running as root inside the container, COPY of .env into the image, latest base image tags, exposed database ports in compose, secrets in compose environment blocks, no read-only filesystem, no resource limits.
- What must change: When written, the Dockerfile must: use a pinned digest base image, a non-root USER, multi-stage build excluding devDependencies, no .env copied in, and a healthcheck. Compose must not publish the Postgres port on 0.0.0.0 and must source secrets from the environment or a secrets store, not committed files. Add container scanning (trivy or equivalent) in CI.

**P2-4. BAAs, hosting, backup/retention, incident response, de-identification (future protected data)**

- What is wrong: None of these are mentioned.
- What must change before any PHI:
  - BAA: signed with the hosting provider, database provider, log/monitoring vendors, and any subprocessors before PHI touches their systems.
  - Backup/retention: encrypted backups, tested restores, documented retention and secure disposal schedule.
  - Incident response: written plan with detection, containment, a designated security official, and breach notification workflow meeting the 60 day requirement.
  - Minimum necessary: analytics endpoints over protected data should return aggregates by default; record-level access only with explicit authorization scope.
  - De-identification: if analytics or exports ever derive from PHI, apply Safe Harbor (164.514(b)(2)) or expert determination before any broader release; footnote-coded, coerced-to-number quality data (see P1-4) also creates an accuracy risk if ever used for care decisions, so provenance metadata should be preserved.
- Concrete risk: Absent these, the first PHI ingestion is a compliance violation on day one and an unmanageable breach exposure.

**P2-5. Cache integrity and TTL design**

- What is wrong: API responses are cached in PostgreSQL with sync_timestamp TTL carried as a non-enumerable property.
- Concrete risk: Non-enumerable metadata is invisible to JSON serialization, which is fragile: any future serializer change may leak or drop it. More importantly, cache rows written by the ingest path (P0-1) inherit trust; a poisoned cache serves attacker-controlled data as authoritative CMS data.
- What must change: Treat cache writes as privileged (writer role only, P1-5). Add a provenance column (source, load job ID) and consider signing or checksumming bulk-loaded rows. Keep TTL and provenance in ordinary typed columns, not non-enumerable properties.

## 3. Insufficient Materials (could not be assessed)

The following could not be evaluated from the provided materials and require direct inspection:

- Authentication/authorization code: no evidence any exists; treated as absent. If auth code exists, it needs full review.
- The actual POST /providers/bulk-data contract and handler code: severity above is based on the description "export/ingest"; if it is export-only and read-only, P0-1 downgrades but auth and quotas are still required.
- Dockerfile and docker-compose.yml: not yet written; P2-3 is a policy list, not a review.
- .env handling in practice: git history, CI exposure, and image inclusion unverified.
- Deployment topology: TLS termination point, network segmentation, whether PostgreSQL is internet-reachable, host hardening: all unknown.
- The actual error-handling middleware and logger implementation: the "log real error, throw generic" pattern is asserted but not verified across all routes.
- Rate limiter thresholds and which routes it covers.
- Whether helmet, CORS middleware, or any validation library is present in package.json.
- Backup, monitoring, and alerting posture: not mentioned at all.

## 4. Summary of Top Risks

The dominant risk is the unauthenticated POST /providers/bulk-data endpoint, which as described offers anonymous write access to the database and cache that every other endpoint trusts, and it sits on a platform with no authentication layer, a rate limiter that resets on restart and cannot scale past one process, and secrets living in a single .env file with no management story. These four items (bulk ingest auth, an auth layer in general, a distributed rate limiter, and secrets management) are the P0 core for the current public-data app, together with TLS termination and audit logging. For the stated future of protected data, the system is not close to HIPAA-ready: it lacks authentication, authorization/RBAC, encryption in transit and at rest, audit trails, BAAs, backup and incident response plans, and all of these must exist before the first record of PHI is ingested, because receiving PHI before a BAA and safeguards are in place is itself a violation. The review is design-level; the bulk endpoint contract, error middleware, Docker assets, and deployment topology must be verified in code and infrastructure before this backlog can be considered complete.
