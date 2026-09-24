# AGENTS.md — Provider Intelligence Platform

## Project overview

Provider Intelligence Platform: an Express + PostgreSQL backend that
integrates three free public government healthcare APIs, plus a React (Vite)
frontend in `client/`.

- **NPI Registry (NIH Clinical Tables)** — provider search/detail.
- **CMS QPP Experience dataset (data.cms.gov data-api)** — clinician MIPS
  performance scores.
- **Care Compare provider-data datastore (data.cms.gov/provider-data)** —
  hospital quality measures.

Postgres is used as the cache/persistence layer (providers, MIPS scores,
quality measures fetched from the upstream APIs). The overnight seeding
script populates `providers` and `mips_performance_scores` from these APIs;
do not interfere with it while it runs.

Authoritative research notes (verified live against the real APIs):
`docs/GOVERNMENT_API_REFERENCE.md`. Frontend blueprint:
`docs/FRONTEND_SPEC.md`. `phynpi.md` is the original design doc and is
**known to contain errors** — see `CORRECTIONS.md` before trusting it.

## Directory layout

```
src/
  app.js                  Express app (middleware, routes, health, api-docs)
  config/
    api-config.js         Upstream API base URLs, dataset IDs, rate limits
    database.js           pg Pool (reads DB_* env vars)
    init.sql              Schema: providers, mips_performance_scores, ...
    migrations/           Incremental DDL (e.g. cannabis_certifications)
  controllers/            HTTP layer (validation, 400/404/500 handling)
  middleware/             errorHandler.js, rateLimiter.js (in-memory)
  routes/                 Express routers (bind controller methods!)
  services/               npiService, cmsDataService, analyticsService
  utils/                  apiClient (axios wrapper), logger (winston)
tools/                    One-off ingest/backfill scripts (cannabis registries,
                          license backfill); not part of the served app.
                          cannabis-nppes-match.js backfills missing NPIs on
                          cannabis_certifications from the local nppes_providers
                          load (offline; cannabis-npi-enrich.js is the API path);
                          cannabis-nppes-resolve.js scores quarantined rows on
                          ZIP/city/middle-initial signals and auto-accepts
                          decisive winners
tests/                    jest + supertest, offline via nock + mockDb
client/                   Vite + React frontend (separate package.json)
docs/                     Research docs and frontend spec
tmp/                      Scratch inputs for ingest tools (PDFs/txt exports)
```

`jest.config.js` keeps `testPathIgnorePatterns` pointed at
`<rootDir>/provider-intelligence/` in case a nested checkout ever
reappears; there is none today.

## Run commands

```bash
npm install                          # backend deps
psql -U admin -f src/config/init.sql # DB schema (or run the SQL in a psql
                                     # session against database provider_intelligence)
npm test                             # jest --coverage (fully offline)
npm start                            # node src/app.js, serves on :3000
```

Frontend (`client/`, needs the backend on :3000):

```bash
cd client && npm install && npm run dev   # Vite dev server, proxies /api
```

## Corrected API facts (verified live; phynpi.md is wrong on these)

### NPI API (NIH Clinical Tables)

- Individuals endpoint: `GET https://clinicaltables.nlm.nih.gov/api/npi_idv/v3/search`
  (`npi_ind` does not exist — the doc's `/npi_ind/v3/search` is wrong;
  organizations use `/npi_org/v3/search`).
- Response is a **4-element positional envelope**:
  `[total, ids, extraFields, displayRows]` — NOT an array of provider
  objects. `extraFields` is `{dotted.path: [values...]}` (parallel arrays,
  index-aligned with `ids`); `displayRows[i]` is `[name, NPI, provider_type,
  address]` (row order of the first two varies). See
  `src/services/npiService.js` `transformNpiResponse`.
- Gotchas: request leaf fields via `ef` (`licenses.taxonomy.code`, not bare
  `taxonomy_code`); top-level `lic_num_1` returns null.
- `npi_idv` returns individuals only, so `enumerationType` is `'Individual'`.
- `maxList` caps at 500; `offset + count <= 7500`; soft rate limit ~25 req/s.

### MIPS dataset (CMS QPP Experience)

- Data endpoint:
  `GET https://data.cms.gov/data-api/v1/dataset/7adb8b1b-b85c-4ed3-b314-064776e50180/data`
  (dataset UUID `7adb8b1b-b85c-4ed3-b314-064776e50180`; the doc's per-year
  IDs such as `a174-a962` are dead for the data API).
- Returns a **bare JSON array** of objects (no envelope). Stats:
  `.../data/stats` returns `{"found_rows": N, "total_rows": N}`.
- Column names are **lowercase with spaces**: `npi`, `final score`,
  `quality category score`, `improvement activities (ia) category score`,
  `promoting interoperability (pi) category score`, `cost category score`,
  `participation option`, `reporting option`. All values are strings;
  coerce numerics, empty string = null.
- There is **no year column** — it is a single rolling vintage. The year a
  cached row is labeled with is the year the caller requested.

### Care Compare (provider-data datastore)

- Query endpoint:
  `GET https://data.cms.gov/provider-data/api/1/datastore/query/{dataset-id}/0`
  (trailing `/0` is the resource index).
- Envelope: `{results: [...], count, schema, query}`.
- Query params: `limit`, `offset`,
  `conditions[0][property]=facility_id&conditions[0][value]=010001&conditions[0][operator]==`,
  `sorts[0][property]=measure_id&sorts[0][order]=asc`.
- Send a browser-like `User-Agent`; Akamai blocks bare curl UAs and POSTs.
- Machine column names are snake_case: `facility_id`, `measure_id`,
  `measure_name`, `score`, `denominator`, `lower_estimate`,
  `higher_estimate`, `compared_to_national`, `start_date`, `end_date`.
  `score` may be a footnote code, not a number — coerce defensively.

### Backend conventions

- Controller methods must be **bound** before passing to Express
  (`routes/providerRoutes.js` has a `bound()` helper) or `this` is lost.
- Cache hits must return the same camelCase shape as fresh API transforms
  (`normalizeProviderRow` / `normalizeMipsRow`); `sync_timestamp` is carried
  as a non-enumerable property for TTL checks and never serialized.
- Validation failures return 400 with `{ error: "..." }`; upstream failures
  surface as 500 with a generic message.
