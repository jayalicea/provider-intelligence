# ProviderLens (Provider Intelligence Platform)

ProviderLens is a US healthcare provider intelligence platform built entirely on
public government data. It joins provider identity from the NPPES/NPI registry,
MIPS performance from the CMS Quality Payment Program Experience dataset,
hospital quality measures from CMS Care Compare, and exclusion status from the
OIG LEIE plus 38 state Medicaid exclusion lists, and it renders every value with
the source it came from and the date that source was read. The product rule is
that the interface never looks more certain than the data: a null stays null, a
footnote-suppressed score renders as "Not reported" with its reason, and a
screening verdict is `EXCLUDED`, `CLEAR`, or `UNVERIFIED`, never a guess. The
stack is an Express + PostgreSQL backend (`src/`), offline bulk loaders
(`tools/`), and a React/Vite client (`client/`).

## Coverage

Figures below are the registry in `client/src/data/coverage.json`, generated
2026-09-13. Nothing here is computed at request time; each figure carries the
vintage it was measured at.

| Dataset | Publisher | Records | As of | Cadence |
|---|---|---|---|---|
| OIG LEIE | HHS Office of Inspector General | 84,001 exclusion records | 2026-09-12 | Monthly, with weekly supplements |
| State Medicaid exclusion lists | State Medicaid agencies (38 jurisdictions) | 82,929 exclusion records | 2026-09-13 | Varies by state |
| NPPES national registry | CMS / NPPES | 9,726,865 providers | 2026-08 (August 2026 dissemination file, V.2 layout) | Monthly full replacement, weekly incrementals |
| CMS Care Compare quality measures | CMS | 2,342 hospitals cached | per value | Rolling; CMS refreshes on its own schedule |
| CMS QPP MIPS | CMS Quality Payment Program | 8,400 providers cached | per value | One rolling vintage; CMS re-bases in place |

Notes that ship with those numbers:

- The NPPES count includes deactivated enumerations, which is why it exceeds
  the number of active NPIs. The full-file load is recorded in
  [docs/nppes-full-load-verification.md](docs/nppes-full-load-verification.md)
  as `INGEST_OK parsed=9726865 inserted=9726865 table=9726865` (2026-09-13).
- Care Compare and QPP MIPS are caches that grow as facilities and providers
  are requested, not bulk loads. Each cached value carries its own access date
  rather than a shared dataset-level vintage.
- The state Medicaid lists are sourced via the OpenSanctions public mirror of
  official state lists. Commercial deployments should re-extract from the
  official per-state URLs or license OpenSanctions directly; the mirror is
  suitable for evaluation and internal screening, not for redistribution.

The NPPES vintage in [docs/nppes-v2-notes.md](docs/nppes-v2-notes.md) (August
2026 dissemination bundle, V.2 layout, 330-column `npidata_pfile`) agrees with
the registry. See "Known documentation gaps" below for the one figure in that
file that does not.

## Architecture

- **Express API, layered.** `src/routes` binds controller methods explicitly
  (an unbound method loses `this`), `src/controllers` validates and maps errors,
  `src/services` holds the logic. Four routers mount under `/api/v1`:
  `providers`, `analytics`, `intelligence` and `admin`. Reads are open;
  every non-GET request under `/api/v1`, and every method under
  `/api/v1/admin`, requires an `X-API-Key` header.
- **PostgreSQL is the cache and the store.** `src/config/init.sql` defines
  `providers`, `mips_performance_scores`, `quality_measures` and friends, with
  later changes applied as dated files under `src/config/migrations/`; the
  bulk-loaded `nppes_providers`, `oig_exclusions` and `state_exclusions` tables
  are created by their loaders in `tools/`.
- **Cache-first upstream reads with TTLs.** A request is served from PostgreSQL
  when the cached row is fresh (24 hours for NPI identity, 1 hour for MIPS) and
  fetched upstream on a miss, then cached. Cache hits and fresh fetches return
  byte-identical shapes, asserted by the test suite.
- **Bulk data arrives offline, never over HTTP.** `tools/nppes-ingest.js`,
  `tools/leie-ingest.ps1` and `tools/state-exclusions-ingest.ps1` stream files
  into Postgres via `jsonb_populate_recordset`, truncate first so re-runs are
  idempotent, and fail loudly unless parsed, inserted and table counts agree.
- **React/Vite client with provenance as the design centerpiece.** `client/`
  renders each government-sourced value with its source and access date, reads
  its coverage figures from the committed `client/src/data/coverage.json`, and
  degrades to an explicit gray unscored state instead of inventing values.

## Quickstart

Prerequisites: Node.js 22 LTS and PostgreSQL 15.

```bash
git clone https://github.com/jayalicea/provider-intelligence.git
cd provider-intelligence
npm install
```

Create the database and load the schema:

```bash
createdb -U admin provider_intelligence
psql -U admin -d provider_intelligence -f src/config/init.sql
```

Then apply the dated migrations in `src/config/migrations/` in filename order.

Create a `.env` in the repo root. There is no `.env.example` committed; these
are the variables the code actually reads (`src/config/database.js`,
`src/app.js`):

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=provider_intelligence
DB_USER=admin
DB_PASSWORD=your-password
PORT=3000
CORS_ORIGIN=http://localhost:5173
API_KEYS=local:some-long-random-string
```

`API_KEYS` is a comma-separated list of `label:key` pairs, read at startup.
Without it every write and every admin request returns 401, which is the
intended default; GET endpoints stay open either way.

`.env` is gitignored and must stay that way. Upstream API base URLs and dataset
IDs are not environment variables; they live in `src/config/api-config.js`.

Run the tests (fully offline, `nock` plus a mock database, so no network or
PostgreSQL is required):

```bash
npm test
```

Start the backend on port 3000:

```bash
npm start          # node src/app.js
npm run dev        # nodemon, same entrypoint
```

Start the client dev server, which proxies `/api` to port 3000:

```bash
cd client && npm install && npm run dev   # Vite on :5173
```

Docker is an alternative to the local Postgres steps: `docker compose up`
builds the app image and starts PostgreSQL 15 with `init.sql` applied on first
boot. `DB_PASSWORD` must be set in `.env` or compose fails fast.

## Documentation index

### Reference and research

- [docs/README.md](docs/README.md) - backend overview, setup and API reference.
- [docs/GOVERNMENT_API_REFERENCE.md](docs/GOVERNMENT_API_REFERENCE.md) - the
  authoritative notes on the three upstream APIs, with every claim marked
  verified or UNVERIFIED.
- [docs/nppes-v2-notes.md](docs/nppes-v2-notes.md) - NPPES V.2 layout, parser
  gotchas and reference-file inventory.
- [docs/nppes-full-load-verification.md](docs/nppes-full-load-verification.md) -
  measurements behind the national NPPES load and the backpressure refactor.
- [docs/method-statement.md](docs/method-statement.md) - the screening method
  statement that ships with every Package B deliverable.

### Design and specification

- [docs/DESIGN.md](docs/DESIGN.md) - design tokens, copy deck and the
  provenance rule. Normative for the frontend.
- [docs/FRONTEND_SPEC.md](docs/FRONTEND_SPEC.md) - route table, component props
  and API contracts for the client.
- [docs/mockup/dashboard-mockup.html](docs/mockup/dashboard-mockup.html) -
  static visual mockup of the dashboard.

### Decision records

- [docs/adr/](docs/adr/) - architecture decision records, in context /
  decision / consequences form: [0001](docs/adr/0001-cache-first-api-design.md)
  cache-first API design,
  [0002](docs/adr/0002-file-based-leie-pipeline.md) file-based LEIE pipeline,
  [0003](docs/adr/0003-jsonb-populate-recordset-loaders.md) the shared bulk
  loader insert pattern and count rule, and
  [0004](docs/adr/0004-open-sanctions-state-lists.md) state exclusion list
  sourcing.

### Reviews and roadmap

- [docs/CODE_REVIEW.md](docs/CODE_REVIEW.md) - adversarial review of
  `analyticsService.js`, findings by severity.
- [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) - design-level security and
  HIPAA-posture hardening backlog.
- [docs/SECURITY_REVIEW_RESPONSES.md](docs/SECURITY_REVIEW_RESPONSES.md) -
  what has been done about the security backlog, per shipped package, with
  the deferrals named.
- [docs/PROMPT_REVIEW.md](docs/PROMPT_REVIEW.md) - red-team review of the
  session resume prompt.
- [docs/V2_ROADMAP.md](docs/V2_ROADMAP.md) - personas, user stories and phased
  effort estimates.
- [docs/plan.md](docs/plan.md) - the parallel review task that produced the four
  files above.

### Plans and go-to-market

- [docs/plans/gtm-productized-services.md](docs/plans/gtm-productized-services.md) -
  packaged offers, segments, outreach and the proof-page outline.
- [docs/plans/package-b-priority.md](docs/plans/package-b-priority.md) - the
  screening-list build prioritized over the other packages.
- [docs/plans/verification-product.md](docs/plans/verification-product.md) -
  source prompt for the MIPS-independent verification dossier.
- [docs/plans/productized-services.md](docs/plans/productized-services.md) -
  source prompt for the go-to-market plan.
- [docs/plans/kimi-code-prompts.md](docs/plans/kimi-code-prompts.md) - the
  runbook of agent prompts and their runtime routing rules.

### Marketing

- [docs/marketing/index.html](docs/marketing/index.html) - the one-page proof
  page, built to the outline in `docs/plans/gtm-productized-services.md`
  section 6. Self-contained static HTML, no live data, no internal endpoints.
  The three screenshot slots reference redacted captures that still need to be
  taken.

### Archive

- [docs/\_archive/resume-prompt.md](docs/_archive/resume-prompt.md) - the
  original resume prompt reviewed in PROMPT_REVIEW.md.
- [docs/\_archive/final-resume-prompt\_0912.md](docs/_archive/final-resume-prompt_0912.md) -
  the corrected prompt that was actually executed.
- `docs/_archive/Kimi_Agent_Provider Intelligence API Docs.zip` - cloud-agent
  API documentation deliverable, kept for provenance.
- `docs/_archive/Kimi_Agent_平台代码安全评审.zip` - cloud-agent security review
  deliverable, kept for provenance.

Repository-root documents that are not under `docs/`:
[AGENTS.md](AGENTS.md) (working conventions and corrected API facts),
[CORRECTIONS.md](CORRECTIONS.md) (every divergence between `phynpi.md` and the
working code), [SUMMARY.md](SUMMARY.md) (the execution record of the frontend
and Docker phases), and `phynpi.md` (the original design document, known to
contain errors; read CORRECTIONS.md before trusting it).

## Known documentation gaps

- `docs/nppes-v2-notes.md` still describes `npidata_pfile` as "already ingested
  in smoke-test form (25k rows)". The national load has since completed at
  9,726,865 rows, which is what `coverage.json` publishes and what
  `docs/nppes-full-load-verification.md` records. The notes file is the stale
  one.
- `client/src/data/coverage.json` carries an empty `jurisdictions` array while
  its state Medicaid entry refers to per-jurisdiction source URLs "below". That
  table is generated by `tools/coverage-jurisdictions.js` from a survey file and
  a loaded database, both of which live under the gitignored `data/`, so it is
  empty in a fresh checkout by design.

## Scope and disclaimer

ProviderLens reports what public US government sources publish, as of the access
date shown with each value. It is not medical advice, is not a credentialing
decision, and certifies nothing. Values may be stale or incorrect at the source;
verify against the source directly. No PHI is handled.

## License

MIT
