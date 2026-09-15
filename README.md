# Provider Intelligence Platform

Express + PostgreSQL backend over free public government healthcare APIs
(NPI Registry, CMS QPP Experience, Care Compare, OIG LEIE, state Medicaid
exclusion lists), with a React frontend in `client/`. Design and research
docs live in `docs/`; `docs/openapi.yaml` is the machine-readable API spec.

## Running

```bash
npm install
npm test        # jest + supertest, fully offline (nock + mockDb)
npm start       # serves on :3000
```

## API

Base URL: `http://localhost:3000/api/v1`. All GET endpoints are open —
every upstream source is public government data. All non-GET endpoints
(roster screening, bulk data) require an API key, as does the admin usage
report on every method.

### Authentication (writes)

Keys are env-seeded (no key-management UI yet; see
`docs/SECURITY_REVIEW_RESPONSES.md`). Set `API_KEYS` in `.env` as
comma-separated `label:key` pairs and restart:

```
API_KEYS=billing:your-long-random-secret,partner:another-secret
```

Send the key on every write:

```bash
curl -X POST http://localhost:3000/api/v1/intelligence/screen-roster \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: your-long-random-secret' \
  -d '{"rows":[{"npi":"1366446619","lastname":"DOE","firstname":"JANE","state":"CA"}]}'
```

Missing or invalid keys return `401 {"error":"invalid or missing API key"}`.
Every authenticated request is metered into `api_usage`; operators can pull
per-key totals with `GET /api/v1/admin/usage?days=30` (also key-required)
or `npm run usage-report` for a monthly billing summary.

### Endpoint groups

- **Providers** — `GET /providers/search` (terms/state/city/taxonomy,
  offset pagination), `GET /providers/{npi}`, `GET /providers/{npi}/verification`
  (dossier with per-field provenance), `GET /providers/{npi}/mips-performance`,
  `GET /providers/{npi}/mips-trends`, `POST /providers/bulk-data` (key).
- **Quality** — `GET /quality-measures/{facilityId}?type=`.
- **Analytics** — `GET /analytics/group-performance?npis=…&year=`,
  `ranking/{npi}`, `trends/{npi}`, `benchmark/{npi}`.
- **Intelligence** — `GET /intelligence/cohort?source=cached|national&state=…`
  (national mode queries the 9.7M-row materialized `national_screening`
  table; rows capped at 500, verdict/enrichable flags per row),
  `GET /intelligence/exclusion-watchlist`, `POST /intelligence/screen-roster` (key).

Full request/response shapes: `docs/openapi.yaml` (OpenAPI 3.1).
