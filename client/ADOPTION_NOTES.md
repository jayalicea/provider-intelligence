# ADOPTION_NOTES.md — Phase 3 frontend inventory and adoption decisions

## 2026-09-19: Home page front door + verification passport link (Provider detail)

- `/` no longer redirects to `/providers`; it renders the new `HomePage` (`client/src/pages/HomePage.jsx`), composed of the existing `StatBand` + `StatBandCaption` (moved off the search page), a plain-language lede stating the platform's positioning (identity and integrity screening over public US government data, as-of dates per value), and a grid of eight link cards (Provider Search, Cohort Explorer, Screen a Roster, My Providers, Compare, Benchmark, Coverage, Watchlist), each a title plus one-sentence description.
- `StatBand` and `StatBandCaption` were removed from `ProviderSearchPage.jsx`; the search page keeps filters, results, and the MIPS-only note. The band's own comment about the "landing page" is now accurate again.
- New CSS in `client/src/index.css`: `.link-card-grid`, `.link-card`, `.link-card-title`, built on the existing `.card` style and tokens (`--surface`, `--border`, `--primary`, `--text`, `--space-*`). Cards are whole-surface `Link`s, auto-fill grid with 230px minimum columns.
- `App.jsx`: "Home" is the first nav entry; the `Navigate` import went away with the old redirect.
- `ProviderDetailPage.jsx`: added a `btn`-style link "Open verification passport" to `/providers/:npi/360` with an adjacent muted line, "Includes license status where board data is available." No license summary line was added: `GET /providers/:npi` returns normalized identity only (single `license` object), and license rows with board-verified status live on the verification dossier (360) endpoint, which the new link points to. No new fetch was introduced.
- No new dependencies; no backend changes. `npm run lint` and `npm run build` pass.

## 2026-09-19: Watchlist token v2 + score drop alerts (Stories 1.1, 1.2)

- Watchlist storage shape is now `{ version: 2, npis, addedAt, alert: { enabled, dropThreshold } }` under the same key `providerlens.watchlist`. `loadWatchlist` migrates v1 on load (alert defaults to `{ enabled: false, dropThreshold: 10 }`); the 200-NPI cap logic is unchanged. Malformed alert configs fall back to the default rather than poisoning the load.
- Share token format v2: base64url JSON object `{ npis, alert }` instead of the bare NPI array. `decodeShareToken` accepts both formats and always returns `{ npis, alert }` (`alert: null` for legacy tokens), so old `?list=` links keep working. `encodeShareToken(npis, alert)` emits v2 only when the alert is enabled; otherwise it emits the legacy bare array so links shared with older deployments still decode. Verified by a node round-trip one-liner against the real module (v1, v2, legacy decode, v1 storage migration, malformed alert, garbage token).
- `/my-providers` gained a settings block (enable checkbox, 1-100 threshold input) and client-side alert evaluation per Story 1.1: on page load only, each watched NPI's trends (`GET /api/v1/analytics/trends/:npi`) are compared across consecutive archive years. Deviation to note: the endpoint does not expose per-row `year_source`, so the client treats a response as all-archive only when the endpoint's rolling-vintage `warning` field is null; a response carrying the warning is skipped rather than compared, and providers with fewer than two scored archive years are never flagged. No new dependencies; `npm run lint` and `npm run build` pass.

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

## Update 2026-09-19: percentile rank over time vs taxonomy cohort (V2 Story 5.1)

Built client-only, no new dependencies, no backend changes.

- **Integration choice**: a new headed section on the existing MIPS dashboard
  page (`src/pages/MipsDashboardPage.jsx`), directly below the raw-score
  `ScoreTrendChart` it contextualizes. The page is short (two charts), so a
  new route or tabs would add navigation weight for no gain.
- **Data**: `GET /api/v1/analytics/percentile-trends/:npi` via a new
  `api.getPercentileTrends(npi)` helper in `src/api/client.js`. Archive years
  only; each row carries the provider percentile (0-100, null when not scored
  that year), cohort score-space quartiles, and provenance.
- **Chart**: `src/components/PercentileTrendChart.jsx`, recharts, DESIGN
  token palette (`#0F6B5C` / `#4C8055` / `#52606D`), same card/spinner/banner
  idiom as `ScoreTrendChart`. Deliberate deviation from the story sketch: the
  endpoint's cohort median/p25/p75 are final-score values (PERCENTILE_CONT
  over cohort scores), not percentile ranks, so one shared 0-100 percentile
  axis would mix units. The chart therefore uses two y axes: provider
  percentile rank on the left (line, domain 0-100), cohort final score on
  the right (dashed median line plus a p25-to-p75 band via two stacked
  `Area` series, fill opacity 0.2). Legend and axis labels name each unit in
  plain language.
- **Data honesty**: a null percentile renders as a line gap (no
  `connectNulls`); years with no provider row are absent from the axis; a 404
  (no resolvable primary taxonomy) renders an explicit note that percentile
  context is unavailable for this provider, not an empty box or error
  banner. Provenance line (source and as-of) renders under the chart.
- Story status recorded in `docs/V2_ROADMAP.md` (Feature 5, Story 5.1):
  shipped 2026-09-19, client-only.

## Update 2026-09-19: taxonomy peer benchmark report (V2 Story 4.1)

Full-stack: new backend endpoint plus a new client route. No new
dependencies.

- **Route**: `/benchmark` (`src/pages/BenchmarkPage.jsx`), registered in
  `src/App.jsx`. Linked from the MIPS dashboard percentile section
  (`src/pages/MipsDashboardPage.jsx`): when the provider's taxonomy resolves,
  the link is prefilled (`/benchmark?taxonomy=<code>`); otherwise it is a
  plain link. Deliberately not added to the top nav: the report is an
  analyst tool reached in context from a provider, not a primary browse
  surface.
- **Data**: `GET /api/v1/analytics/taxonomy-benchmark?taxonomy=<code>&year=<py>`
  via `api.getTaxonomyBenchmark(taxonomy, year)` in `src/api/client.js`. Both
  params required; archive years 2018-2020 and 2022-2024 only. Response:
  summary stats (`scoredCount`, `mean`, `quartiles.p25/p50/p75`, `min`,
  `max`), live-computed `deciles.d10..d90`, a per-state breakdown
  (`states: [{ state, scoredCount, median }]`, sorted by count), and
  `provenance { source, as_of }`. 404 means the taxonomy-year pair is not
  materialized; the page renders an explicit empty state saying so, not an
  error banner.
- **Form**: taxonomy code input with a `datalist` of the four largest
  cohorts (207Q00000X, 207R00000X, 363A00000X, 363LF0000X); free text
  always allowed, client-side format check (3-10 letters/digits). Year is a
  `<select>` of the six archive years, so invalid years are unrepresentable.
  URL `?taxonomy=` prefill seeds the input.
- **Charts**: recharts `BarChart` of the decile ladder: one bar per decile
  threshold (d10..d90) with a dashed mean `ReferenceLine`. Honest
  representation choice: the data is nine PERCENTILE_CONT cut points plus
  min/max, not a binned sample, so the chart is a ladder of thresholds
  (labeled as such) rather than a histogram that would imply counts. A
  companion table lists each decile value and the band it closes above the
  previous threshold. A top-10 state table (scored count, median) follows.
  Summary stat band reuses the `.stat-band` idiom.
- **Provenance**: a note under the report names the source and as-of and
  states which figures are materialized aggregates vs computed at read time.
- Story status recorded in `docs/V2_ROADMAP.md` (Feature 4, Story 4.1):
  shipped 2026-09-19. State breakdown included (the story listed it); the
  story's "top/bottom deciles" map to the d10/d90 ends of the ladder.
