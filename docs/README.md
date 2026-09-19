# Provider Intelligence Platform

Accurate as of 2026-09-15. This file describes the backend; the project front
door is the root [README.md](../README.md), and the decisions behind the
architecture are recorded in [docs/adr/](adr/).

Several sections of this file were originally written from `phynpi.md`, the
original design document, which is known to contain errors. Every divergence
between that document and the working code is catalogued in
[CORRECTIONS.md](../CORRECTIONS.md) and is not repeated here; read it before
trusting anything `phynpi.md` says about endpoints, response shapes or dataset
IDs.

A Node.js/Express + PostgreSQL backend for US healthcare provider intelligence. It integrates CMS Quality Payment Program (QPP) data, CMS Care Compare hospital quality measures, and the NIH Clinical Tables NPI registry API over HTTP, and the NPPES dissemination file, the OIG LEIE and 38 state Medicaid exclusion lists as offline bulk loads.

## 1. Project Overview

The Provider Intelligence Platform lets users:

- **Search providers**: Look up individual clinicians and organizations by name, state, city, and taxonomy, backed by the NPI registry and local data.
- **View MIPS performance scores and trends**: Retrieve Merit-based Incentive Payment System (MIPS) final scores and category scores for a given NPI, including year-over-year trends. The responses carry no payment-adjustment field, and the "years" are request labels on a single rolling CMS vintage rather than distinct measurement periods; the trends endpoint says so in a `warning` field.
- **View hospital quality measures**: Retrieve CMS Care Compare quality measures for a facility, with national comparisons. Note that the live datastore rows carry no `footnote` field, so footnote explanations are not available from this path despite the CMS Footnote Crosswalk existing as a separate dataset.
- **Screen against exclusion lists**: Resolve an identity against the federal OIG LEIE and the state Medicaid exclusion lists, returning `EXCLUDED`, `CLEAR` or `UNVERIFIED`. The match rules and their limits are specified in `docs/method-statement.md`.

## 2. Architecture

The backend follows a layered service pattern:

**Routes -> Controllers -> Services -> PostgreSQL / External API Clients**

There is no repository layer; services query the database directly through the
shared `pg` pool.

- **Express server**: HTTP routing, request validation, error handling middleware.
- **PostgreSQL 15 database**: Local persistence. `src/config/init.sql` creates `providers`, `provider_addresses`, `provider_taxonomies`, `mips_performance_scores`, `quality_measures` and `api_request_log`; dated files under `src/config/migrations/` add later objects, including `api_keys` and `api_usage`. There is no bulk-import job-state table. The three bulk tables (`nppes_providers`, `oig_exclusions`, `state_exclusions`) are created by their loaders in `tools/`, not by `init.sql`.
- **Service layer**: Business logic, combining cached rows with live upstream API data. `npiService`, `cmsDataService`, `analyticsService`, `exclusionService`, `intelligenceService`, `apiKeyService`. There is no separate repository layer; services issue their own queries through `src/config/database.js`.
- **Caching layer**: PostgreSQL itself is the cache. There is no in-process cache and no `node-cache` dependency: a read is served from the `providers`, `mips_performance_scores` or `quality_measures` table when the row is fresh, and fetched upstream and written back when it is not. Freshness is decided per source from the row's `sync_timestamp`: 24 hours for NPI identity, 1 hour for MIPS performance. Concurrent identical in-flight requests are coalesced (single-flight): a miss joins the upstream call already in flight for the same key via `src/utils/coalescer.js`, so N simultaneous misses produce one upstream request. Rationale and consequences: [ADR 0001](adr/0001-cache-first-api-design.md).

### Upstream API constraints that drive caching

| Upstream API | Constraints |
|---|---|
| CMS data-api (QPP Experience) | Paginated in 5000-row pages via `size`/`offset` |
| CMS provider-data datastore/query (Care Compare) | Datastore query endpoint per dataset |
| Clinical Tables NPI API (npi_idv / npi_org) | Advised soft rate limit of 25 req/s, `maxList` capped at 500, offset + count capped at 7500 |

### Architecture diagram

```
            +-----------+
            |  Clients  |
            +-----+-----+
                  |
                  v
        +-------------------+
        |  Express Routes   |
        +-------------------+
                  |
                  v
        +-------------------+
        |   Controllers     |
        +-------------------+
                  |
                  v
        +-------------------+
        |     Services      |
        +----+---------+----+
             |         |
             v         v
   +-------------+  +-------------------+
   | pg pool     |  | External API      |
   | (cache read)|  | Clients (on miss) |
   +------+------+  +---------+---------+
          |                   |
          v                   v
   +-------------+  +---------------------------+
   | PostgreSQL  |  | CMS QPP API / Care Compare|
   | 15          |  | NIH Clinical Tables NPI   |
   +-------------+  +---------------------------+
```

## 3. Prerequisites and Windows Setup

### Prerequisites

- Node.js 22 LTS
- PostgreSQL 15

### Setup steps

1. Install Node.js 22 LTS and PostgreSQL 15. On Windows, use the official installers and ensure `psql` is on your PATH (for example, `C:\Program Files\PostgreSQL\15\bin`).

2. Clone the repository:

   ```bash
   git clone https://github.com/your-org/provider-intelligence-platform.git
   cd provider-intelligence-platform
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Create the database. The defaults in `src/config/database.js` are database
   `provider_intelligence` and role `admin`, and `docker-compose.yml` uses the
   same pair:

   ```bash
   createdb -U admin provider_intelligence
   ```

   or:

   ```bash
   psql -U admin -c "CREATE DATABASE provider_intelligence;"
   ```

5. Run the schema initialization script, then the dated migrations in
   `src/config/migrations/` in filename order:

   ```bash
   psql -U admin -d provider_intelligence -f src/config/init.sql
   ```

6. Create a `.env` in the repository root. **There is no committed
   `.env.example`.** These are the variables the code actually reads
   (`src/config/database.js`, `src/app.js`, `src/utils/logger.js`); anything
   else in a `.env` is inert:

   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=provider_intelligence
   DB_USER=admin
   DB_PASSWORD=your-password
   PORT=3000
   CORS_ORIGIN=http://localhost:5173
   LOG_LEVEL=info
   API_KEYS=local:some-long-random-string
   ```

   `API_KEYS` is a comma-separated list of `label:key` pairs, parsed at
   startup by `src/services/apiKeyService.js`. If it is unset, every write and
   every admin request returns 401 while GET endpoints keep working.

   Upstream base URLs, dataset IDs and cache TTLs are **not** environment
   variables. Base URLs and dataset IDs live in `src/config/api-config.js`; the
   TTLs are constants in the two service files. There is no `DATABASE_URL`,
   `CMS_QPP_API_BASE_URL`, `CMS_PROVIDER_DATA_BASE_URL`, `NPI_API_BASE_URL` or
   `CACHE_TTL` in this codebase.

### npm scripts

| Script | Command | Description |
|---|---|---|
| start | `npm start` | Start the full stack: API on :3000 plus the Vite client on :5173 |
| start:api | `npm run start:api` | API only (`node src/app.js`; what the Docker image runs) |
| dev | `npm run dev` | Full stack with nodemon hot reload on the API |
| test | `npm test` | Run the test suite |
| lint | `npm run lint` | Run ESLint |

## 4. API Reference

Every router mounts under `/api/v1`. Paths in this section are the real,
complete paths; earlier revisions of this file listed them without the prefix
and put quality measures on a router that does not exist.

Two unauthenticated utility routes sit outside the versioned prefix:
`GET /health` and `GET /api-docs`. The endpoint map `GET /api-docs` returns is
itself written without the `/api/v1` prefix, so treat this file as the
authority on paths.

**Authentication.** `src/middleware/apiKeyAuth.js` is mounted on `/api/v1`.
Every non-GET request, and every request of any method under
`/api/v1/admin`, requires an `X-API-Key` header matching a `label:key` pair
from the `API_KEYS` environment variable; a miss returns 401. GET endpoints
outside `/admin` stay open, deliberately, on the posture that every upstream
source is free public government data. Authenticated requests are metered into
`api_usage`.

Every handler returns the same envelope: `{ "success": true, "data": ... }`,
with `count` added on list responses, and
`{ "success": false, "error": "..." }` on failure. There is no `page`, `limit`
or `total` anywhere; search is capped by `maxResults` and there is no
server-side pagination.

### Provider routes (`src/routes/providerRoutes.js`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/providers/search` | Query params are `terms`, `state`, `city`, `taxonomy`, `maxResults` (default 50), `offset`. The search term is **`terms`, not `query`**. |
| GET | `/api/v1/providers/:npi` | Provider detail, with `mipsPerformance` merged in when available. |
| GET | `/api/v1/providers/:npi/verification` | Verification dossier. Cache-only: it reports what the cache holds and never fetches upstream at request time. 404 when the NPI is not cached. |
| GET | `/api/v1/providers/:npi/mips-performance` | Optional `year` query param, defaulting to last year. |
| GET | `/api/v1/providers/:npi/mips-trends` | Optional `startYear` (default 2018) and `endYear`. |
| GET | `/api/v1/providers/quality-measures/:facilityId` | Care Compare measures. Mounted on the **providers** router, not on a top-level `/quality-measures`. |

(The former `POST /api/v1/providers/bulk-data` was removed on 2026-09-17 per
`docs/SECURITY_REVIEW.md` P0-1; bulk loads are offline jobs.)

### Analytics routes (`src/routes/analyticsRoutes.js`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/analytics/group-performance` | Group MIPS statistics for a set of NPIs. Rejects a non-array or non-string `npis` input with 400. |
| GET | `/api/v1/analytics/ranking/:npi` | Rank and percentile against peers, optionally within a taxonomy. Unscored providers return a null rank with a reason rather than rank 1. |
| GET | `/api/v1/analytics/trends/:npi` | Multi-year MIPS scores. The response carries a `warning` field stating that year labels are request vintages on a rolling CMS dataset. |
| GET | `/api/v1/analytics/benchmark/:npi` | Score against the national average and quartiles. Returns `status: "unscored"` rather than defaulting an unscored provider into the bottom quartile. |

### Intelligence routes (`src/routes/intelligenceRoutes.js`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/intelligence/cohort` | Joined providers, latest MIPS and exclusion verdicts for a state. `source=cached` (default) reads the request-time cache; `source=national` runs the same contract over the full `nppes_providers` load. Any other value is a 400. |
| GET | `/api/v1/intelligence/exclusion-watchlist` | Cached providers carrying an exclusion match. |
| POST | `/api/v1/intelligence/screen-roster` | Screens parsed roster rows against the LEIE and the state Medicaid exclusion lists. Requires `X-API-Key`. |

### Admin routes (`src/routes/adminRoutes.js`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/admin/usage` | Per-key request totals and per-endpoint breakdowns over the last `days=N`. Key-protected like every `/admin` path, including on GET. |

### Response shape notes

These are the shapes the live backend actually returns. They differ from the
hypotheses in `docs/FRONTEND_SPEC.md`, which were written before the backend
existed; the client's reconciliation is recorded in
`client/ADOPTION_NOTES.md`.

- **Search** returns `{ success, data: [...], count }`. There is no `total`,
  `page` or `limit`, so a client renders the returned count rather than
  "Page X of Y".
- **`mips-trends`** returns **parallel arrays**, not an array of records:
  `data` is `{ npi, performanceYears, finalScores, qualityScores,
  improvementActivitiesScores, promotingInteroperabilityScores, costScores }`,
  index-aligned. The client reshapes them into per-year records.
- **`mips-performance`** has no `paymentAdjustmentPct` field.
- **Quality measures** rows carry no `facilityName` and no `footnote`, so a
  facility heading uses the facility ID and footnote tooltips are not possible
  against live data.
- **An unknown NPI on `GET /api/v1/providers/:npi`** currently surfaces as a
  500, not a 404. This is a known and documented behavior, not an accident;
  see `CORRECTIONS.md`.

Rate limiting applies to every router: 100 requests per minute per caller,
fixed window, in-process (`src/middleware/rateLimiter.js`). It resets on
restart and does not coordinate across processes; `docs/SECURITY_REVIEW.md`
P1-1 covers the consequences.

## 5. Data Sources

| Source | URL | Notes |
|---|---|---|
| CMS QPP Experience (data-api) | `https://data.cms.gov/data-api/v1/dataset/7adb8b1b-b85c-4ed3-b314-064776e50180/data` | Column names are lowercase with spaces. Paginate with `size` and `offset`, maximum page size 5000 rows. |
| CMS Care Compare (provider-data) | `https://data.cms.gov/provider-data/api/1/datastore/query/{dataset-id}/0` | Example dataset IDs: `ynj2-r877` (Complications and Deaths), `632h-zaca` (Unplanned Hospital Visits), `77hc-ibv8` (Healthcare-Associated Infections), `dgck-syfz` (HCAHPS). |
| NIH Clinical Tables NPI API | `https://clinicaltables.nlm.nih.gov/api/npi_idv/v3/search` and `https://clinicaltables.nlm.nih.gov/api/npi_org/v3/search` | Free, no API key. Advised soft rate limit of 25 requests per second, `maxList` maximum 500, offset + count capped at 7500. |
| NPPES dissemination file | `https://download.cms.gov/nppes/NPI_Files.html` | Bulk file, not an API. Loaded offline by `tools/nppes-ingest.js` into `nppes_providers`. Monthly full replacement. |
| OIG LEIE | `https://oig.hhs.gov/exclusions/exclusions_list.asp` | Monthly downloadable file, no query API. Loaded offline by `tools/leie-ingest.ps1` into `oig_exclusions`. See [ADR 0002](adr/0002-file-based-leie-pipeline.md). |
| State Medicaid exclusion lists | `https://www.opensanctions.org/datasets/us_medicaid_exclusions/` | 38 jurisdictions, sourced via the OpenSanctions mirror of official state lists. Loaded offline by `tools/state-exclusions-ingest.ps1` into `state_exclusions`. See [ADR 0004](adr/0004-open-sanctions-state-lists.md). |

The three bulk sources are loaded by offline jobs, never over HTTP at request
time. Their row counts and vintages are published in
`client/src/data/coverage.json`; the root [README.md](../README.md) reproduces
them.

## 6. Roadmap

Status as of 2026-09-14. The three items originally listed here have all
shipped:

- **Analytics module**: shipped. `src/services/analyticsService.js` plus the
  four `/api/v1/analytics` routes above. The severity findings in
  `docs/CODE_REVIEW.md` were subsequently addressed; see the status banner at
  the top of that file.
- **React frontend**: shipped. `client/` is a Vite + React app; see
  `docs/DESIGN.md` for the normative design system and `client/ADOPTION_NOTES.md`
  for how it reconciles with `docs/FRONTEND_SPEC.md`.
- **Docker support**: shipped. `Dockerfile` (Node 20 Alpine, no secrets baked
  in) and `docker-compose.yml` (app plus PostgreSQL 15, schema bootstrapped
  from `init.sql`). The image build is verified; `docker compose up` runtime
  validation has not been run.

What is still open is tracked in `docs/V2_ROADMAP.md` (phased user stories)
and `docs/SECURITY_REVIEW.md` (the P0 and P1 hardening backlog, most of which
is still open).

## 7. License

MIT
