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
