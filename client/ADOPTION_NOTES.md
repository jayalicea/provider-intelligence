# ADOPTION_NOTES.md — Phase 3 frontend inventory and adoption decisions

Inventory of the uncommitted frontend work recovered from the prior session
(WIP commit `2b06aa8`), decided file by file. Design authority:
`docs/DESIGN.md` (tokens, copy, empty/loading/error states, disclaimer panel);
`docs/mockup/dashboard-mockup.html` (layout target). Data authority: the live
backend on :3000 (`/api/v1/...`), per Prompt A Phase 3 step 2.

## Live API shapes verified 2026-09-12 (all return `{success, data, count?}`)

- `GET /api/v1/providers/search?terms=&state=&city=&taxonomy=&maxResults=&offset=`
  (note: `terms`, not the spec's `query`) → `data` is an array of providers
  with nested `name/address/taxonomy/license` objects, plus `total`
  (upstream match count), `offset` and `limit` since 2026-09-17. `maxResults`
  caps at 500; `offset + maxResults` must not exceed 7500.
- `GET /api/v1/providers/:npi` → single provider object (same nested shape)
  with `mipsPerformance` (null unless `?includeMips=true`).
- `GET /api/v1/providers/:npi/mips-performance` → camelCase MIPS row with
  `performanceYear` (e.g. 2025). No `paymentAdjustmentPct` in the live shape.
- `GET /api/v1/providers/:npi/mips-trends` → **parallel arrays**
  (`performanceYears`, `finalScores`, ...) — NOT the array of records the
  spec assumed. `api/client.js` reshapes these into per-year records.
  This endpoint has **no rolling-vintage warning field** (that field exists
  only on `/api/v1/analytics/trends/:npi`), so the vintage banner on the
  trends chart is the persistent static text from DESIGN.md §4.
- `GET /api/v1/providers/quality-measures/:facilityId` (mounted under
  `/providers`, not the API root) → array of camelCase rows
  (`facilityId, measureId, measureName, score, denominator, lowerEstimate,
  higherEstimate, comparedToNational, startDate, endDate`). **No
  `facilityName` and no `footnote` field** in the live shape.
- Analytics endpoints (`/api/v1/analytics/...`) were hardened in Phase 2B and
  are consumed only indirectly by the pages above.

## File-by-file inventory

| File | Status | Decision |
|---|---|---|
| `src/App.jsx` | Partial | Keep routing; adopt DESIGN brand frame: rename brand to ProviderLens, add "Public data only" tag and the verbatim "About this data" disclaimer panel. |
| `src/api/client.js` | Complete | Keep as-is. Already built to the live backend shapes (envelope unwrap, quality path under `/providers`, trends parallel-array reshape). |
| `src/hooks/useFetch.js` | Complete | Keep. Deliberate deviation from the spec's React Query recommendation: the prior session chose a lighter plain-fetch hook; it satisfies the loading/error/refetch contract the pages need. |
| `src/components/SearchBar.jsx` | Complete | Keep. Submit-on-Enter/button satisfies DESIGN's "filters are a form; Enter submits". |
| `src/components/FilterPanel.jsx` | Complete | Keep. |
| `src/components/ProviderResultsTable.jsx` | Partial | Keep structure; swap spinner for skeleton rows (DESIGN: "never spinners on data surfaces") and add NPI Registry provenance line; align empty copy with DESIGN. |
| `src/components/ProviderProfileCard.jsx` | Partial | Keep; add provenance subline (DESIGN §3 centerpiece). |
| `src/components/MipsSummaryCard.jsx` | Partial | Keep bars/KPI structure; add "CMS QPP Experience, accessed ..." provenance; unscored copy per DESIGN; skeleton instead of spinner. |
| `src/components/CategoryBarChart.jsx` | Complete | Keep (recharts bar chart; spec's primary-series color rule is superseded by DESIGN's teal accent — bar fill updated). |
| `src/components/ScoreTrendChart.jsx` | Partial | Keep chart; the vintage-warning banner lives in the page above it (mockup layout), not in this component. |
| `src/components/QualityMeasuresTable.jsx` | Partial | Restructure columns to DESIGN: Measure \| Score \| National comparison \| As of. Drop the Footnote column (live API has no `footnote` field — spec hypothesis disproven). Null score renders gray "Not reported". Skeleton loading. |
| `src/components/NationalComparisonBadge.jsx` | Partial | Copy per DESIGN exactly: "Better than national" (green), "Same as national" (neutral), "Worse than national" (red), "Not reported" (gray). The prior footnote-label map was dropped: with no `footnote` field in the live API it was dead code, and DESIGN renders unknown scores as plain "Not reported". |
| `src/components/LoadingSpinner.jsx` | Complete | Keep for non-data surfaces (detail cards); tables switch to skeletons. |
| `src/components/ErrorBanner.jsx` | Complete | Keep; pages render DESIGN's error sentence. |
| `src/components/EmptyState.jsx` | Complete | Keep. |
| `src/pages/ProviderSearchPage.jsx` | Partial | Keep URL-param state mirroring; copy per DESIGN (H1 "Find a provider", sub, placeholders, empty/no-results text). |
| `src/pages/ProviderDetailPage.jsx` | Complete | Keep. Route structure (separate MIPS dashboard page) kept over the mockup's in-card tabs; the tabs in the mockup link to views that map to distinct routes here. Quality Measures tab is not applicable to individual providers (no facility link in the NPI data), so it exists only as the facility route. Recorded as deliberate deviation. |
| `src/pages/MipsDashboardPage.jsx` | Partial | Add the persistent rolling-vintage info banner above the trend chart (DESIGN §4 / mockup). |
| `src/pages/HospitalQualityPage.jsx` | Partial | Copy per DESIGN ("Hospital quality measures", Care Compare provenance line). |
| `src/pages/NotFoundPage.jsx` | Complete | Keep. |
| `src/index.css` | Partial | Tokens re-based on DESIGN.md (teal accent, good/warn/bad, unscored gray, 4px radius, 14px base) — DESIGN wins over FRONTEND_SPEC §6 palette where they conflict. Add: skeleton rows, disclaimer panel, header tag, info banner, provenance lines, "Not reported" badge, mono utility. |
| `vite.config.js`, `index.html`, `package.json`, lockfile | Complete | Keep. Proxy `/api` → :3000 satisfies the spec's dev-proxy requirement. `index.html` title updated to ProviderLens. Deviations from spec stack: JavaScript (not TypeScript), React 19 + react-router v7, plain fetch hook instead of TanStack Query — the prior session's choices, kept rather than rewritten. |

## Discrepancies between spec hypotheses and the live backend

1. Search uses `terms`/`maxResults`/`offset` and, since 2026-09-17, returns
   `total`/`offset`/`limit` alongside `data`/`count`. The results table shows
   "N of M matching providers" from `total` (hidden again when the MIPS-only
   checkbox filters client-side, since `total` then no longer matches the
   displayed subset). Full "Page X of Y" navigation was not built: the page
   still requests a single `maxResults=50` page and there is no offset
   control in the UI.
2. `mips-trends` returns parallel arrays, not records (client reshapes).
3. Quality rows have no `facilityName` (page heading uses the facility ID)
   and no `footnote` (footnote column/tooltips not possible against live data).
4. `mips-performance` has no `paymentAdjustmentPct`.
5. Quality measures live at `/api/v1/providers/quality-measures/:facilityId`.

## Update 2026-09-18: licenses block on the verification dossier

The verification dossier (`GET /api/v1/providers/:npi/verification`) now
includes a `licenses` block: `{ note, values: [...] }`, where each license
field (`number`, `state`, `isPrimaryTaxonomy`, `taxonomyCode`,
`taxonomyClassification`, `taxonomySpecialization`) is wrapped with
`{ value, source, asOf }` provenance, same as the identity block. The values
are self-reported NPPES data, not verified board statuses, and the `note`
field says exactly that. Since 2026-09-18 a license may also carry a
`verified` block (`{ status, expirationDate, disciplinaryStatus, source,
asOf }`, first three provenance-wrapped) when an ingested state board row
(Texas Medical Board or Colorado DORA via `tools/license-status-ingest.js`)
matches its (state, license number); licenses without a match have no
`verified` key. `Provider360Page` renders the list with the note under a
"Licenses" section and appends the board status (status, expiration,
discipline) with its own provenance when present; providers with no cached
license rows show "No licenses reported."

## Update 2026-09-19: CSV export (Story 3.1)

Both exports are `format=csv` query params on existing GET endpoints, served
as `text/csv` attachments; JSON shapes are unchanged.

- `GET /api/v1/providers/search?...&format=csv` → `provider-search.csv`,
  header row `npi, name, credential, taxonomy_code, taxonomy_description,
  city, state, zip, phone` (snake_case, always emitted, empty results
  included). `ProviderSearchPage` renders an "Export CSV" anchor (`.btn`)
  inside the filter card when criteria are present, carrying the current
  URL-param filters; the MIPS-only checkbox is client-side only and does not
  affect the export.
- `GET /api/v1/providers/:npi/mips-performance?format=csv&startYear=&endYear=`
  → `mips-performance-{npi}.csv`, one row per cached year in the range
  (defaults 2018..previous year). Header row `performance_year, final_score,
  quality_score, improvement_activities_score,
  promoting_interoperability_score, cost_score, performance_status,
  data_source, year_source`; `year_source` (`archive` vs `rolling`) keeps
  archived per-year vintages distinguishable from request-labeled rolling
  rows. `MipsDashboardPage` renders an "Export CSV" anchor for the same
  2018..END_YEAR range the trends chart uses.
- `client/src/api/client.js` gains an `exportUrls` helper (URL builders, not
  axios calls) since exports are plain browser downloads.

## Update 2026-09-19: user-curated provider watchlist (V2 Stories 2.1 and 2.2)

Built client-only, no new dependencies, no backend changes.

- **Route**: `/my-providers` (nav label "My Providers", listed after the
  exclusion "Watchlist"). Page: `src/pages/MyProvidersPage.jsx`.
- **Storage**: localStorage key `providerlens.watchlist`, shape
  `{ version: 1, npis: string[], addedAt: { [npi]: ISO date } }`, capped at
  200 NPIs (rejected adds surface a visible message). NPIs validated as
  10-digit strings on load; malformed entries are dropped. Pure logic in
  `src/lib/watchlist.js`, React wrapper in `src/hooks/useWatchlist.js`.
- **Detail-page integration**: `src/components/WatchlistToggle.jsx`
  ("Add to watchlist" / "Watching") rendered on `ProviderDetailPage`. Search
  results rows were left untouched as the less invasive choice.
- **Summaries**: the page fetches `GET /api/v1/providers/:npi` per watched
  NPI (the cap of 200 makes per-NPI fetches acceptable; no batch endpoint
  exists). Rows show name, NPI, state, taxonomy, added date, and Remove.
  Providers missing from the cache stay listed with a "Not available" row.
- **Share token**: the NPI array serialized as JSON, UTF-8 encoded, unpadded
  base64url (`+` → `-`, `/` → `_`, no `=`). Example: `["1234567890"]` becomes
  `WyIxMjM0NTY3ODkwIl0`. Encoders/decoders exported from `src/lib/watchlist.js`;
  `/my-providers?list=<token>` merges into the local list (dedupe, inline
  notice of how many were added) and removes the query param.
- Story statuses recorded in `docs/V2_ROADMAP.md` (Feature 2, Stories 2.1 and
  2.2): shipped 2026-09-19, client-only, no-auth path per the Tension 1
  decision. Server persistence remains Story 2.3 (blocked on auth).

## Update 2026-09-19: side-by-side provider comparison (V2 Story 5.2)

Built client-only, no new dependencies, no backend changes.

- **Route**: `/compare` (nav label "Compare", listed after "My Providers").
  Page: `src/pages/ComparePage.jsx`.
- **Storage**: localStorage key `providerlens.compare`, a plain JSON array of
  NPI strings (deliberately not the watchlist's object envelope), capped at 3.
  Storage is separate from the watchlist; validation reuses `isValidNpi` from
  `src/lib/watchlist.js`. Pure logic in `src/lib/compare.js`, React wrapper in
  `src/hooks/useCompare.js`. Rejected adds (invalid, duplicate, or full)
  surface an inline `notice-banner`.
- **Data**: per NPI, `GET /api/v1/providers/:npi` (summary) and
  `GET /api/v1/analytics/trends/:npi` (per-year records, not the parallel
  arrays of `mips-trends`) are fetched with nested `Promise.allSettled`. An
  NPI where both settle rejected renders an explicit "Could not be loaded"
  row with a remove action, never a blank row.
- **Chart**: `src/components/CompareTrendChart.jsx`, one recharts `Line` per
  provider keyed by NPI, x = `year`, y = final score, colors
  `#0F6B5C` / `#4C8055` / `#B7791F` (DESIGN tokens, same idiom as
  `ScoreTrendChart`). Missing years stay `undefined` so the line breaks
  rather than implying continuity (deliberate deviation from
  `ScoreTrendChart`'s `connectNulls`, to avoid implying values that were
  never reported).
- **Table**: one column per year across the union of reported years; missing
  (year, provider) pairs render the established gray `score-null` "Not
  reported" cell. No value is estimated.
- **Rolling-vintage note**: the analytics trends response carries `warning`
  when any row is a request label on the rolling CMS vintage (null when all
  rows are `year_source = 'archive'`). When any charted series has a
  warning, a small provenance line under the chart names the affected NPIs
  and repeats the warning's meaning in plain language.
- **Detail-page integration**: `src/components/CompareButton.jsx` next to
  `WatchlistToggle` on `ProviderDetailPage`; it writes the NPI to local
  storage first, then navigates to `/compare`.
- Story status recorded in `docs/V2_ROADMAP.md` (Feature 5, Story 5.2):
  shipped 2026-09-19, client-only.
