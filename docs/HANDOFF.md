# HANDOFF: Provider Intelligence Platform

Purpose: a complete, self-contained context transfer so another model or
engineer can continue this project without re-deriving anything. Written
2026-09-15 against commit `6e65166` (branch `claude/quirky-wozniak-pqia6u`,
identical to `main`, 0 commits ahead / 0 behind).

Provenance of this document: it is reconstructed from the repository itself
(git history, source, docs, and a live test run in a clean container), not
from session memory. Every claim below is traceable to a file or a command
output. Where the repo records a claim that could not be re-verified here
(anything needing the production database or blocked network egress), it is
labeled "recorded, not re-verified".

---

## 1. What this is

A US healthcare provider intelligence platform: Node/Express + PostgreSQL
backend, React (Vite) frontend in `client/`, built on four public government
data sources. No PHI, no paid data feeds, no API keys required upstream.

Product thesis (from `docs/plans/verification-product.md`): the durable value
of public data is **provider identity plus integrity signal** (exclusions,
license status), not MIPS performance. CMS has proposed sunsetting traditional
MIPS after the 2028 performance period, so MIPS stays a labeled add-on and is
never the product's foundation.

Two revenue paths are documented and partially built:
- **Package B, Screening List Build** (`docs/plans/package-b-priority.md`):
  a client roster CSV comes back screened against exclusion registries with
  provenance on every field. Flat fee $1,500 per 1,000 providers. The build
  that makes it sellable is done.
- **Package C, Provider Intelligence Pilot**: hosted pilot with API key and
  metering. The key layer and metering are built; the key management UI is not.

---

## 2. Current verified state

Re-verified in this container on 2026-09-15:

```
npm ci && npx jest
Test Suites: 1 skipped, 10 passed, 10 of 11 total
Tests:       1 skipped, 142 passed, 143 total
Time:        4.3 s
```

The skipped test is `tests/nppes-schema.test.js:66`, a schema-drift check that
self-skips when no database is configured. The whole suite is offline: `nock`
intercepts upstream HTTP, `tests/helpers/mockDb.js` fakes `pg`.

Git state: `claude/quirky-wozniak-pqia6u` == `origin/main` == `6e65166`.
Working tree clean apart from this document. `node_modules/` is absent from a
fresh checkout; run `npm ci` in the root and in `client/`.

---

## 3. Architecture

```
src/
  app.js                  Express app; mounts apiKeyAuth on /api/v1, then routers
  config/
    api-config.js         Upstream base URLs, dataset IDs, rate limits
    database.js           pg Pool from DB_* env vars
    init.sql              Full schema (providers, mips, quality, api_keys, api_usage)
    migrations/           20260914_api_keys_usage.sql, 20260914_nppes_cohort_indexes.sql
  controllers/            provider, analytics, intelligence, admin
  middleware/             apiKeyAuth.js, errorHandler.js, rateLimiter.js (in-memory)
  routes/                 one router per controller; every method .bind()ed
  services/               npiService, cmsDataService, analyticsService,
                          exclusionService, intelligenceService, apiKeyService
  utils/                  apiClient (axios wrapper), logger (winston)
tests/                    jest + supertest, fully offline (nock + mockDb)
tools/                    ingest and ops scripts (.js cross-platform, .ps1 Windows)
client/                   Vite + React 19 + react-router 7 + recharts, own package.json
docs/                     research, reviews, design, plans, this file
```

Layering rule: routes bind controller methods, controllers validate and shape
HTTP, services own SQL and upstream calls. Controllers never write SQL.

### Endpoint surface

Public reads (no key):
- `GET /health`, `GET /api-docs`
- `GET /api/v1/providers/search?state=&name=&city=&taxonomy=&maxResults=&offset=`
- `GET /api/v1/providers/:npi`
- `GET /api/v1/providers/:npi/verification` (dossier, cache-only, per-field provenance)
- `GET /api/v1/providers/:npi/mips-performance`
- `GET /api/v1/providers/:npi/mips-trends`
- `GET /api/v1/providers/quality-measures/:facilityId` (note: mounted under /providers)
- `GET /api/v1/analytics/group-performance?npis=`
- `GET /api/v1/analytics/ranking/:npi`
- `GET /api/v1/analytics/trends/:npi`
- `GET /api/v1/analytics/benchmark/:npi`
- `GET /api/v1/intelligence/cohort?state=&taxonomy=&minScore=&source=cached|national&name=`
- `GET /api/v1/intelligence/exclusion-watchlist?state=&days=`

Key-required (`X-API-Key` header, all non-GET under /api/v1 plus all of /admin):
- `POST /api/v1/intelligence/screen-roster` (max 1,000 rows)
- `GET /api/v1/admin/usage?days=N`

Rate limiting: in-memory fixed window, 100 req/min per router. It is per
process and resets on restart; it is not a real quota system.

---

## 4. Ground truth on the upstream APIs

This is the highest-value section. The original design document `phynpi.md`
is wrong on most of it; `CORRECTIONS.md` enumerates every divergence and
`AGENTS.md` carries the corrected facts. Do not trust `phynpi.md`.

### NPI Registry (NIH Clinical Tables)
- Individuals: `GET https://clinicaltables.nlm.nih.gov/api/npi_idv/v3/search`.
  `npi_ind` and `npi_util` do not exist (404). Organizations: `/npi_org/v3/search`.
- Response is a **4-element positional envelope**: `[total, ids, extraFields,
  displayRows]`, not an array of objects. `extraFields` is
  `{dotted.path: [parallel arrays]}` index-aligned with `ids`. `displayRows[i]`
  is `[name, NPI, provider_type, address]` and the order of the first two varies.
- Request leaf fields via `ef` (`licenses.taxonomy.code`, never bare
  `taxonomy_code`). Top-level `lic_num_1` returns null.
- `npi_idv` returns individuals only, so `enumerationType` is hardcoded
  `'Individual'`. Writing `provider_type` into `enumeration_type` violates the
  CHECK constraint; that was bug 4 in CORRECTIONS.md.
- `maxList` caps at 500. `offset + count <= 7500`. Soft limit ~25 req/s.
- **Pagination trap**: the API paginates on `count`, not `maxList`, once
  `offset` is present. Sending `offset` without `count` silently returns 7 rows.
  This bug made 9 states of seeding produce duplicate page 1s (4,502 rows where
  13,500 were expected).

### CMS QPP Experience (MIPS)
- `GET https://data.cms.gov/data-api/v1/dataset/7adb8b1b-b85c-4ed3-b314-064776e50180/data`
- Returns a **bare JSON array**, no envelope. `/data/stats` gives
  `{found_rows, total_rows}` (503,917 rows verified).
- Column names are lowercase with spaces: `npi`, `final score`,
  `quality category score`, `improvement activities (ia) category score`,
  `promoting interoperability (pi) category score`, `cost category score`,
  `participation option`, `reporting option`. Every value is a string; empty
  string means null.
- **There is no year column.** It is one rolling vintage. The `performance_year`
  stored on a cached row is the year the *caller asked for*, not the year the
  data describes. Per-year dataset IDs from the old catalog (`a174-a962` etc.)
  are dead for the data API.
- Consequence (CODE_REVIEW finding C1): every multi-year MIPS trend in this
  platform is a request label on a single vintage. Year-over-year movement can
  reflect re-based scores rather than real change. `/analytics/trends` carries a
  `warning` field saying so and the MIPS dashboard renders a persistent banner.
  Do not remove either without replacing the underlying data.

### CMS Care Compare (provider-data datastore)
- `GET https://data.cms.gov/provider-data/api/1/datastore/query/{dataset-id}/0`
  (trailing `/0` is the resource index).
- Envelope `{results, count, schema, query}`. Params: `limit`, `offset`,
  `conditions[0][property|value|operator]`, `sorts[0][property|order]`.
- Send a browser-like `User-Agent`; Akamai blocks bare curl UAs and POSTs.
- Machine column names are snake_case (`facility_id`, `measure_id`, `score`,
  `compared_to_national`, ...). `score` can be a footnote code, not a number,
  so coerce defensively. Dates arrive MM/DD/YYYY and are normalized to ISO.
- Dataset IDs in use: `ynj2-r877` (complications/deaths), `632h-zaca`,
  `77hc-ibv8`, `dgck-syfz`, `xubh-q36u` (hospital general info).

### NPPES full dissemination file
- `https://download.cms.gov/nppes/NPI_Files.html`, monthly full replacement.
- V.2 layout. Real August 2026 header has **330 columns** including a trailing
  `Certification Date`. Loader maps by header name so extra columns are ignored.
- NPPES does **not** double inner quotes; it replaces them with single quotes,
  so no `""` escape sequences exist in the data.
- Primary Taxonomy Switch: the readme documents `X`, the live file uses `Y`/`N`.
  The loader treats `X` or `Y` as primary, falls back to slot 1, else null.
- Taxonomy *descriptions* are in no NPPES file; they come from the NUCC/WPC
  crosswalk. `nppes_providers.primary_taxonomy_description` is null on every
  row, reserved for that backfill.
- Full file is 11.4 GB, 9,726,865 rows. That count includes deactivated
  enumerations, which is why it exceeds the "7 to 8 million active NPIs" figure.

### OIG LEIE
- Stable monthly URL `https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv`
  (proven 2026-09-12; the refresh script scrapes only as fallback).
- `excldate`, `reindate`, `dob` are YYYYMMDD **text**. `00000000` and empty
  string both mean "absent"; the ingest normalizes them to null.
- The literal string `NULL` appears in name columns and means missing.
- NPI column carries `0000000000` as a no-NPI sentinel.

---

## 5. Data model and loaded volumes

Tables (see `src/config/init.sql` plus ingest-created tables):

| Table | Created by | Rows recorded | Vintage |
|---|---|---|---|
| `providers` | API cache writes via search/detail | 13,502 across 9 states | rolling cache |
| `mips_performance_scores` | `tools/overnight-mips-seed.ps1` | per-NPI, UNIQUE (npi, performance_year) | rolling vintage |
| `quality_measures` | on-demand Care Compare cache | ~2,342 hospitals cached | per value |
| `nppes_providers` | `tools/nppes-ingest.js` | 9,726,865 | Aug 2026 V.2 file |
| `oig_exclusions` | `tools/leie-ingest.ps1` | 84,001 | as_of 2026-09-12 |
| `state_exclusions` | `tools/state-exclusions-ingest.ps1` | 82,929 across 38 jurisdictions | as_of 2026-09-13 |
| `api_keys` | migration `20260914_api_keys_usage.sql` | provisioned, **not read at runtime** | n/a |
| `api_usage` | metering middleware | per request | n/a |

These counts are recorded, not re-verified: the production database lives on
the maintainer's Windows box, and `data/` is gitignored so ingest inputs are
absent from a fresh checkout. The same figures are committed in
`client/src/data/coverage.json`, which the Coverage page and the landing
StatBand both read so the UI can never disagree with itself.

The two exclusion tables and the 9.7M NPPES load are the platform's real moat.
Everything else is cache over a live API.

Note on state exclusions: sourced via the **OpenSanctions public mirror** of
official state lists, not scraped per state. `coverage.json` says so explicitly
and warns that a commercial deployment must re-extract from official state URLs
or license OpenSanctions. Do not quietly drop that caveat.

---

## 6. Build history, chronological

Phases 1 and 2 (grounding docs, analytics service) predate the recorded runbook.
What follows is what git shows, oldest first.

**Prompt A execution, 2026-09-12** (`SUMMARY.md` is the contemporaneous record):
- `2b06aa8` WIP commit protecting uncommitted frontend work found at resume.
- `1e22cd4` Phase 0: search pagination fix (`offset` + `count`) plus regression
  test. Then a top-up run at offsets 500 and 1000 for 9 states (MD VA PA NY IL
  OH FL TX CA), concurrency 2 with 429 backoff, taking `providers` from 4,502 to
  13,502 rows (~1,500 per state).
- `4df9858` Phase 2B: nine analytics hardening fixes from `docs/CODE_REVIEW.md`,
  with regression tests and a DB index. Specifically: `num()` returns null not
  NaN; `ORDER BY final_score DESC NULLS LAST` with null-scored rows out of the
  window partition and rank null plus a reason for unscored targets; percentile
  numerator and denominator over non-null rows only; benchmark returns an
  explicit unscored status instead of misclassifying null as bottom quartile;
  `COUNT(final_score)` for peer_count; scored counts alongside row counts in
  group performance plus input validation (array of strings, cap 5,000, 400 on
  empty); UNIQUE (npi, performance_year) and an index on (performance_year, npi);
  the rolling-vintage warning field on `/analytics/trends`.
- `bec2e79` Phase 3: frontend completed to `docs/DESIGN.md`, verified page by
  page against the live backend on :3000 through the Vite proxy.
- `8a82388` Phase 4: Dockerfile, docker-compose.yml, .dockerignore. Node
  20-alpine, no Redis service (the `redis` dependency in package.json is dead
  code, nothing imports it), secrets via `env_file` and `${DB_PASSWORD:?}`
  interpolation only. `docker compose config` validates and `docker compose
  build app` succeeded; `docker compose up` runtime validation was never run.

**Package B, verification and screening, 2026-09-12 to 09-13:**
- `32a435e` LEIE loader rewritten to a direct CSV parse with schema migration
  and self-verifying counts.
- `0589232` `exclusionService`: NPI-first LEIE resolution with name plus state
  fallback.
- `c53e505` `GET /providers/:npi/verification` dossier endpoint.
- `793b536` `tools/screen-roster.js` plus `data/sample-roster.csv`.
- `7923a09`, `42fc7a2` tests for resolution, the endpoint, and DOB confirmation.
- `cd2d72d`, `9c80467` DOB confirmation added to the name-fallback path.
- `b6ca051`, `9e141e6` `docs/method-statement.md`, the one-pager that ships with
  every screening deliverable.

**NPPES national load, 2026-09-12 to 09-13:**
- `715e4d0` `tools/nppes-ingest.js` plus the `nppes_providers` table.
- `31dfe50` practice/mailing address column key mapping fix.
- `4bcf75c` parser tests.
- `36f14a2` backpressure refactor: the read stream pauses while a batch flush is
  in flight. Measured on an 8M-row fixture: peak RSS fell from 5,683 MB to
  133 MB and wall time dropped 28%; the pre-refactor version OOMed at a 1 GB cap
  after 640k rows. `4c16327` and `891c727` record the measurements and then the
  real production run: `INGEST_OK parsed=9726865 inserted=9726865 table=9726865`.
  Full detail in `docs/nppes-full-load-verification.md`.

**Intelligence layer and UI, 2026-09-13:**
- `69398f9` cohort tests and the verification MIPS block.
- `eec19d2` Provider 360 verification passport page.
- `df4eec5` Cohort Explorer page with LEIE integrity screening.
- `edd83c1` nock isolation fix so suites pass in any worker combination.
- `c3c40c9` atomic quality-measures cache refresh plus dedup
  (`tools/quality-measures-dedup.js`) and a UNIQUE index on
  (facility_id, measure_id, data_source) that makes the duplicate state
  unrepresentable.
- `9075a34` exclusion watchlist endpoint and page.
- `f0bb0c5` Coverage page backed by the `coverage.json` dataset registry.
- `a1a3c69`, `fe95ba9` state Medicaid exclusion ingest (38 states, 82,929 rows,
  LEIE overlap flagged) and matcher support.
- `76743cc` design-system pass across the client.

**National cohort, 2026-09-14:**
- `859729a` `source=national` mode over `nppes_providers`.
- `a62e784` Cached/National source toggle in the UI.
- `0053b8c` stat band leading with nationally searchable providers.
- `21f09d9` hotfix: the national cohort query referenced nonexistent NPPES
  column names.

**Package C, API keys and metering, 2026-09-14:**
- `b9bcf48` `api_keys` / `api_usage` migration plus env-seeded key loader.
- `8392f98` `X-API-Key` required on all non-GET `/api/v1` writes.
- `470a820` `api_usage` metering plus `GET /api/v1/admin/usage`.
- `930989e` `tools/usage-report.js`, monthly per-key report for billing.
- `7b50705` LEIE refresh/update tools, wave-3 hospital script, runbook prompts.

---

## 7. Invariants that must not be broken

These are load-bearing. Violating any one reintroduces a bug that was already
found and fixed.

1. **Bind controller methods.** `router.get('/x', controller.method)` loses
   `this` and every request throws. Every router uses a `bound()` helper.
2. **Cache hit and cache miss must return byte-identical shapes.**
   `normalizeProviderRow` and `normalizeMipsRow` map DB rows back to the exact
   camelCase transform output. Tests assert equality.
3. **`sync_timestamp` is carried as a non-enumerable property.** TTL checks need
   it; JSON responses must never contain it. Drop it and the cache silently
   becomes write-only (every request goes upstream). That was bug 7.
4. **Prefer a miss over a false clear.** In `exclusionService`, CLEAR is returned
   only when a definitive non-match was established. A database error can never
   produce CLEAR; it produces UNVERIFIED. A false clear is the worst possible
   failure mode for a screening product.
5. **UNVERIFIED is not a clearance** and must never be rendered or exported as
   one.
6. **Every value carries source and as-of.** This is the product differentiator,
   stated in the method statement and the UI disclaimer. A field without
   provenance is a bug.
7. **A DOB mismatch downgrades to UNVERIFIED**, it does not clear and does not
   exclude. The candidate stays visible for manual review.
8. **Never present MIPS year-over-year movement without the rolling-vintage
   warning.**
9. **Roster screening is client-side parse, server-side resolve.** The browser
   reads the CSV and posts parsed rows; no file is ever uploaded. Keep it that
   way, it is what keeps the platform out of file-handling and PHI territory.
10. **Ingest is offline jobs, never HTTP endpoints.** Refreshes run from
    `tools/`, scheduled, not exposed.
11. **No secrets in committed files.** `.env` is gitignored, has never been
    committed (verified against full history), and is in `.dockerignore`.
    See the exception in section 9.

---

## 8. Frontend

React 19, react-router 7, recharts 3, Vite 8. `client/vite.config.js` proxies
`/api` to `http://localhost:3000`. Brand is "ProviderLens". `docs/DESIGN.md` is
the authority on tokens and copy; `docs/mockup/dashboard-mockup.html` is the
visual target.

Routes:
- `/providers` search with filters
- `/providers/:npi` detail
- `/providers/:npi/360` Provider 360 verification passport
- `/providers/:npi/mips` MIPS dashboard (category bars, trend line, warning banner)
- `/facilities/:facilityId/quality` hospital quality table
- `/cohort` Cohort Explorer with a Cached/National source toggle
- `/watchlist` recent still-active exclusions
- `/upload-roster` client-side CSV parse, posts rows to screen-roster
- `/coverage` dataset registry rendered from `coverage.json`

Copy rules that are verbatim and must not be paraphrased: the "About this data"
disclaimer panel in `App.jsx`, and the national comparison badges
("Better than national" / "Same as national" / "Worse than national" /
"Not reported"). The footer's global as-of is deliberately the **oldest**
dataset vintage in the registry: the platform is only as current as its
stalest source.

Known API-versus-spec discrepancies, recorded in `client/ADOPTION_NOTES.md`:
the search param is `terms` not `query`; trends come back as parallel arrays;
there is no `facilityName`, no `footnote`, no `paymentAdjustmentPct`; quality
measures are mounted under `/providers`. The live backend is authoritative,
`docs/FRONTEND_SPEC.md` entries marked UNVERIFIED are hypotheses.

---

## 9. Security posture, honestly stated

Built (documented in `docs/SECURITY_REVIEW_RESPONSES.md`):
- `X-API-Key` on all non-GET `/api/v1` requests and on all of `/api/v1/admin`.
  Keys are compared as SHA-256 digests with `crypto.timingSafeEqual`, so raw key
  material is never a map key.
- Per-request metering into `api_usage`, fire and forget, a logging failure
  never breaks a request.
- helmet, cors, compression, request logging, generic error messages upstream.

Not built, from `docs/SECURITY_REVIEW.md` P0:
- **P0-1 closed (2026-09-17)**: `POST /providers/bulk-data` was removed from
  the public API surface entirely (route, controller, service method), per the
  review's recommendation in favor of offline jobs.
- **P0-2 partial**: GET endpoints are deliberately open (all upstream sources
  are free public data). That is a defensible product decision, not an
  oversight, but it means no per-caller quota on reads.
- **P0-3 absent**: no authorization model, no roles, no tenancy.
- **P0-4 absent**: no TLS termination story, no `sslmode=require` on the pg
  connection.
- **P0-5 absent**: no audit logging.
- **P0-6 partial**: secrets are a bare `.env`, no managed store, no rotation.
- **Deferred**: key management. `api_keys` exists as a table but is never read
  at runtime. Issuing, rotating, or revoking a key means editing `API_KEYS` and
  restarting. `revoked_at` is not honored anywhere.

**Live finding, unresolved:** `tools/update-local-db.ps1:14` contains a
hardcoded database password in cleartext (`$env:PGPASSWORD = '...'`), committed
to the repository. It is the maintainer's local Postgres password on a Windows
dev box, not a production credential, but it is in git history and a public push
would expose it. Recommended action, in order: rotate the local Postgres
password, change the script to read `DB_PASSWORD` from `.env` like every other
tool does, and decide whether history rewriting is warranted given the repo's
visibility. This is stated here because no other document in the repo records it.

---

## 10. Environment notes

**Maintainer's machine** (where all ingest actually runs): Windows, project at
`C:\Users\casalab\provider-intelligence`, local PostgreSQL database
`provider_intelligence`, user `admin`. The `.ps1` tools hardcode that path.
Logs go to `logs/` (gitignored).

**This container / any fresh checkout**: `data/` is gitignored, so no ingest
inputs exist. Outbound egress is filtered: `download.cms.gov` and `data.cms.gov`
return 403 at the proxy. Therefore **no ingest or live-API work can be done
here**, only code, tests, and docs. The test suite is fully offline by design
and does pass here.

Runtime routing rule from the runbook, worth repeating because it has already
cost one wasted run: prompts that touch `data/`, `tools/`, localhost ports, or
the database must run **on the maintainer's machine**. Cloud agent sandboxes
have no access to the repo or the database and will produce a synthetic rebuild
that looks plausible and commits nothing. That happened once with the NPPES
pipeline prompt.

Commands:
```
npm ci                                   # backend deps
psql -U admin -f src/config/init.sql     # schema
npm test                                 # jest --coverage, offline
npm start                                # :3000
npm run usage-report                     # previous month per-key billing summary
cd client && npm ci && npm run dev       # Vite, proxies /api to :3000
```

---

## 11. Open work, ranked

1. **Rotate and de-hardcode the password in `tools/update-local-db.ps1`.**
   Smallest effort, only item with a real exposure.
2. **License status ingest.** The single biggest product gap. The verification
   dossier promises identity + exclusion + license, and license is missing.
   It needs a per-state source survey (cheapest reliable path per state) before
   any build. Until it lands, Package B v1 sells identity plus exclusions only.
3. **NUCC taxonomy description backfill.** `nppes_providers.primary_taxonomy_
   description` is null on all 9.7M rows. Source the crosswalk from NUCC/WPC.
   Without it the national cohort can filter by taxonomy code but cannot
   display a human-readable specialty.
4. **Key management backed by `api_keys`.** Honor `revoked_at` at
   authentication time; add issue/rotate/revoke. Required before any real pilot
   customer.
5. ~~**Remove or relocate `POST /providers/bulk-data`** per P0-1.~~ Done
   2026-09-17: endpoint removed entirely.
6. **`docker compose up` runtime validation.** Build is verified, runtime is not.
7. **True multi-year MIPS data (Phase A0 in `docs/V2_ROADMAP.md`).** Requires
   hunting archived per-year QPP/Physician Compare CSVs and adding a real
   `performance_year` sourced from each file's vintage. Everything multi-year is
   built on sand until this lands. Judgment call: MIPS is sunsetting after 2028,
   so weigh this against item 2, which does not decay.
8. **Server-side pagination on search.** The backend has no `total`/`page`/
   `limit`; results are capped by `maxResults` and the table reports a count
   rather than "Page X of Y".
9. **TLS, audit logging, authorization model** if the platform is ever hosted
   for a customer rather than demoed.

---

## 12. Working rules that have applied to this repo

From `docs/plans/kimi-code-prompts.md`, and they have held through every session:

- Prohibited git operations: `reset --hard`, `checkout --`, `restore .`,
  `clean`, `stash drop`, `push --force`. If the tree looks corrupted, stop and
  report rather than reset.
- Never `git add -A` or `git add .`; stage explicitly by name and run
  `git status` immediately before every commit.
- Never commit `node_modules/`, `dist/`, `.env`, `*.tmp.js`, screenshots, or
  scratch files.
- Never print, echo, or log `.env` contents.
- Push after every phase commit so nothing lives only on one machine.
- Database writes are limited to the explicitly authorized ones; no ad hoc
  DELETE/UPDATE/TRUNCATE outside the self-verifying ingest scripts, which
  TRUNCATE by design and verify parsed == inserted == table count.
- House style: no em-dashes, plain operational language, no vaporware. Nothing
  is sold before a working artifact exists.
- Documentation discipline: when a claim cannot be verified, write "insufficient
  materials" or "recorded, not re-verified" rather than guessing. Every review
  document in `docs/` follows this.

## 13. Document map

| File | What it is |
|---|---|
| `AGENTS.md` | Corrected API facts and backend conventions. Read first. |
| `CORRECTIONS.md` | Every divergence between `phynpi.md` and reality. |
| `phynpi.md` | Original design doc. **Known wrong.** Historical only. |
| `SUMMARY.md` | Contemporaneous record of the Prompt A build. |
| `docs/GOVERNMENT_API_REFERENCE.md` | Live-verified upstream API research. |
| `docs/CODE_REVIEW.md` | C1-C3, H1-H5, M1-M6, L1-L5 findings on analytics. |
| `docs/SECURITY_REVIEW.md` | P0/P1/P2 hardening backlog, HIPAA-oriented. |
| `docs/SECURITY_REVIEW_RESPONSES.md` | What was fixed and what was deferred. |
| `docs/method-statement.md` | Ships with every screening deliverable. |
| `docs/nppes-v2-notes.md` | Parser-critical NPPES facts. |
| `docs/nppes-full-load-verification.md` | Memory measurements and the real load. |
| `docs/DESIGN.md`, `docs/FRONTEND_SPEC.md` | Design system and frontend blueprint. |
| `docs/V2_ROADMAP.md` | Personas, user stories, phased roadmap with effort. |
| `docs/plans/kimi-code-prompts.md` | The runbook: prompts A through E. |
| `docs/plans/verification-product.md` | The product build plan. |
| `docs/plans/package-b-priority.md` | The sellable slice, fixed scope. |
| `docs/plans/gtm-productized-services.md` | Packages, pricing, outreach. |
| `client/ADOPTION_NOTES.md` | File-by-file adopted vs built, spec discrepancies. |
