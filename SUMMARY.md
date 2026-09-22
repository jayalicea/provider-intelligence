# SUMMARY — Prompt A execution (Phases 0, 2B, 3, 4 + final cleanup)

Date: 2026-09-12. Executed per `docs/plans/kimi-code-prompts.md` Prompt A.
Phases 1 and 2 were already committed and were not touched.

## Commit history

| Commit | Content |
|---|---|
| `2b06aa8` | WIP: adopt prior session frontend work (uncommitted state at resume) — Step 0 protection |
| `1e22cd4` | Phase 0: search pagination fix (offset + count) + regression test |
| `4df9858` | Phase 2B: analytics hardening (9 items) + regression tests + DB index |
| `bec2e79` | Phase 3: frontend completed to DESIGN.md, verified against live backend |
| `8a82388` | Phase 4: Dockerfile, docker-compose.yml, .dockerignore |

## Prior session's work: adopted vs newly built

Full file-by-file inventory in `client/ADOPTION_NOTES.md`. In brief:

**Adopted unchanged** (already built correctly to the live API):
`api/client.js` (envelope unwrap, quality path under `/providers`,
mips-trends parallel-array reshape), `useFetch` hook, `vite.config.js`
(proxy to :3000), `package.json`/lockfile, `FilterPanel`, `EmptyState`,
`LoadingSpinner`, `ProviderDetailPage`, `NotFoundPage`, `ScoreTrendChart`
(chart body), `main.jsx`.

**Adopted and modified**: all other pages and components — restyled to
DESIGN.md tokens (teal accent, 4px radius, 14px base), ProviderLens brand
frame with the verbatim "About this data" disclaimer panel, provenance
sublines on all government-sourced values, skeleton rows replacing spinners
on data surfaces, badge copy exactly per DESIGN ("Better than national" /
"Same as national" / "Worse than national" / "Not reported"), quality table
restructured to Measure | Score | National comparison | As of, rolling-vintage
banner above the trend chart, DESIGN error copy. Four lint errors in the WIP
code were fixed (unused footnote export, SearchBar setState-in-effect,
useFetch deps literal).

**Newly built**: `client/ADOPTION_NOTES.md`, Dockerfile, docker-compose.yml,
.dockerignore, SUMMARY.md.

## Test results

- Backend: `npm test` — **6 suites, 60 tests, all green** (51 pre-existing at
  commit `95e441c` + 8 new from Phases 0/2B + 1 added by the `hasMipsData`
  feature commit `c48fa5f`). Re-verified 2026-09-12 (Prompt C): 60 passed,
  60 total, 3.2s. New tests: `tests/pagination.test.js` (2) and the Phase 2B
  block in `tests/analytics.test.js` (8 covering: null-scored ranking target
  with reason, percentile denominator excluding nulls, NaN benchmark
  unscored status, peerCount excluding unscored peers, scoredCount in group
  performance, single-row stddev null-not-NaN, trends warning field on
  `/analytics/trends`, empty npis 400).
- Client: `npm run lint` (in `client/`) — clean.

## Phase 0: pagination and top-up

- Root cause: the NPI Clinical Tables API paginates on `count` (default 7),
  not `maxList`, once `offset` is present — offset requests silently
  returned 7 rows. Fix sends `offset` + `count`; controller validates offset.
- Top-up ran offsets 500 and 1000 (maxResults 500) for all 9 states through
  the API, caching each provider via the detail endpoint (the only
  cache-write path), throttled to concurrency 2 with 429 backoff.
- Final provider counts: CA 1500, FL 1501, IL 1500, MD 1500, NY 1501,
  OH 1500, PA 1500, TX 1500, VA 1500 — **total 13,502** (from 4,502).

## Phase 3: page-by-page verification (Vite :5173, proxy to :3000)

| Route | Endpoint(s) | Status | Data |
|---|---|---|---|
| `/providers` | `GET /api/v1/providers/search?state=MD` | 200 | 500 rows |
| `/providers/1366443152` | `GET /api/v1/providers/1366443152` | 200 | npi 1366443152 |
| `/providers/1366443152/mips` | `.../mips-performance` + `.../mips-trends` | 200 | finalScore 85.83, 8 trend years |
| `/facilities/140010/quality` | `GET /api/v1/providers/quality-measures/140010` | 200 | 20 rows |

All routes and all edited JSX modules compiled by the dev server with no
errors. Spec-vs-backend discrepancies are listed in ADOPTION_NOTES.md
(`terms` not `query`; parallel-array trends; no `facilityName`/`footnote`;
no `paymentAdjustmentPct`; quality measures mounted under `/providers`).

## Phase 4: Docker

- `docker compose config` — **validates**.
- `docker compose build app` — **verified 2026-09-12**: image
  `provider-intelligence-app` built successfully (~8s) with the Docker
  engine running.
- Remaining optional step: `docker compose up` runtime validation
  (containerized app + Postgres healthcheck + schema bootstrap) — not yet
  run; it does not depend on the local dev database.
- Deviations from phynpi.md §9.1 (documented, file known to contain errors):
  Node 20-alpine instead of 18; **no Redis service** (the codebase has no
  redis usage; REDIS_* .env vars are dead); compose uses `env_file: .env`
  plus `${DB_PASSWORD:?}` interpolation — no secret values in any committed
  file; `.env` confirmed in `.gitignore` and `.dockerignore`.

## Known gaps and limitations

1. **Rolling-vintage limitation (CODE_REVIEW.md finding C1)**: all
   "multi-year" MIPS trends are request labels on a single rolling CMS
   QPP Experience vintage — year-over-year movement may reflect re-based
   scores, not true performance change. The API now carries a warning field
   on `/analytics/trends`, and the MIPS dashboard renders a persistent
   banner with the same content.
2. **Shortfall states**: none — every seeded state reached ~1,500 rows.
   (TX was at 500 before the top-up because the offset bug made its pages
   2/3 duplicates of page 1, not because the source lacks providers.)
3. Search results are capped by `maxResults` with no server-side pagination
   (the backend search has no `total`/`page`/`limit`); the results table
   reports the returned count rather than "Page X of Y".
4. The provider `mips-trends` endpoint has no warning field (the analytics
   trends endpoint does); the UI banner is static copy per DESIGN.md.
5. `tools/kimi-web.bat` (predates this session) is left untracked and
   uncommitted — not part of this deliverable.
6. Docker: image build verified, but `docker compose up` runtime validation
   (app + database containers) has not been run.

---

# SUMMARY — cannabis-certification feature (2026-09-19/20)

Date: 2026-09-20. Follow-up batch: FL OMMU "Qualified Physician List"
ingest, search filter + badge, NPI enrichment, provider-detail surfacing,
weekly refresh pipeline.

## What was built

- **Schema** (`src/config/migrations/20260919_cannabis_certifications.sql`):
  `cannabis_certifications` — 2,009 FL OMMU qualified physicians keyed by
  `UNIQUE(state, license_number)`, indexed on `(license_number, state)`;
  source/provenance columns per the survey CSV shape. First/last stored split
  (the source publishes separate columns; its "Last/First" labels are swapped
  relative to their content — stored as actual first/last).
- **Ingest** (`tools/cannabis-ingest.js`): parses the fixed-width PDF text
  (61 pages, per-page column offsets; 662/2,009 rows split by the extractor
  and rejoined in list order; glued license tokens split on the ME/OS/ACN
  prefix set). Re-ingests are lossless: `npi` is never in the ON CONFLICT
  update list and existing `NPI matched/quarantined` provenance segments are
  carried forward.
- **Search annotation** (`npiService.annotateCannabisCertification`): one
  UNION query per search over cached license joins (`provider_licenses`,
  `providers`) plus directly-enriched NPIs; degrades to false on error.
  Frontend: `cannabisOnly` checkbox composing with `mipsOnly`
  (`ProviderSearchPage.jsx`) and a `badge badge-accent` in the results table.
- **NPI enrichment** (`tools/cannabis-npi-enrich.js`): one lookup per distinct
  name against the NPI Registry (FL practice addresses), audit-gated.
  Auto-accepts only a unique name+city match: **383 rows enriched; 1,626
  quarantined** (1,267 no-candidates, 265 unique-name-no-city, 87
  name-matches-no-city-confirmation, 7 multiple-city-matches) with reasons in
  `provenance_note` and a review CSV under `data/cannabis/`. UNION match
  count went 15 → **394**.
- **Provider detail** (`npiService.getCannabisCertification` +
  `providerController.getProvider`): response now carries
  `cannabisCertification` (`{certified, programName, state, asOf, sourceName,
  sourceUrl, certificationStatus}`, null when absent); profile card renders a
  badge row with program name and list as-of date.
- **Weekly refresh** (`tools/cannabis-refresh.ps1`, modeled on
  `monthly-leie-refresh.ps1`): resolves the current `QP_List/MMDDYY.pdf` from
  the list page, `pdftotext -layout`, lossless re-ingest, drops licenses
  absent from the new list, re-enriches new rows, logs a summary line to
  `logs/cannabis-refresh.log`. Verified end-to-end twice with `-Force`:
  2,009 upserts, 0 dropped, 0 new enrichments, all 383 NPIs and match notes
  intact.

## Test results

- Backend: `npm test` — **29 suites, 387 tests, all green** (new: search
  cannabisCertified true/false + enriched-NPI cases, provider-detail
  certified/null cases). `npx eslint` clean on touched files.
- Client: `npm run lint` clean, `npm run build` succeeds.

## Known gaps and limitations

1. 1,626 rows remain NPI-less pending human review (`data/cannabis/
   npi-match-review-2026-09-20.csv`); the 265 `unique-name-no-city` rows are
   the strongest candidates.
2. The annotation is only as good as the local license cache: uncached
   providers never light up via license joins (by design); enriched NPIs
   bypass this.
3. Nothing is committed to git per batch instructions; the review CSV is
   intentionally untracked.
