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

- Backend: `npm test` — **6 suites, 59 tests, all green** (51 pre-existing +
  8 new). New: `tests/pagination.test.js` (2) and the Phase 2B block in
  `tests/analytics.test.js` (8 covering: null-scored ranking target with
  reason, percentile denominator excluding nulls, NaN benchmark unscored
  status, peerCount excluding unscored peers, scoredCount in group
  performance, single-row stddev null-not-NaN, trends warning field, empty
  npis 400).
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
- `docker compose build` — **skipped**: Docker Desktop daemon not running
  (npipe connect failure). Manual review only, per the runbook's skip path.
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
6. Docker image build is unverified (daemon offline); only compose config
   validation and manual review were possible.
