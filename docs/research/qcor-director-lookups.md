# CLIA laboratory director data: QCOR findings (2026-09-26)

Goal: attach laboratory-director identities to `clia_labs` rows, for
watchlist subsets first (bounded, rate-limited), because no bulk director
source exists.

## What the POS CLIA file does NOT have

`clia_labs` comes from the POS Clinical Laboratories CSV; its schema has
no director fields. The only CMS source of CLIA director information is
QCOR (Quality, Certification and Oversight Reports,
https://qcor.cms.gov/main.jsp), which is interactive by design.

## QCOR mechanics (probed live 2026-09-26)

- Lookup form: `GET https://qcor.cms.gov/advanced_find_provider.jsp?which=4&backReport=active_CLIA.jsp`
  (linked from `/CLIA_Labs` and the main page).
- Form fields (`providerSearch`, POSTs to the same URL):
  `name`, `prvdr` (provider/CLIA number), `director` (DIRECTOR NAME
  search), `state`, `city`, `zip`, `intern`, `exempt`, `report`,
  `apptype`. Validation lives in `/includes/js_functions.js`.
- A "Download CSV" submit exists (`doDownload()`); the exact parameter
  it sets was not captured - a browser devtools pass will show it.
- A first POST with a subset of fields returned no rows; the full field
  set (and valid `report`/`apptype` values) must be replicated.

## Recommended next steps (one focused session)

1. In a browser, run one search on QCOR with devtools open; copy the
   exact POST body for both Search and Download CSV. (The newly
   installed desktop-browser tool can do this after /reload.)
2. Build `tools/clia-director-qcor.js`: input = a watchlist subset (e.g.
   labs surfaced by `/api/v1/labs/alerts`, or `--clia 34D...,21D...`);
   one request per lab with a delay (>=1s); parse director name from the
   response; match the director against `nppes_providers`
   (entity_type '1', name+state, unique-candidate gate - same audit
   discipline as the cannabis tools); write
   `director_first_name/last_name/npi` columns (migration).
3. If the Download CSV mechanism generalizes, prefer one bounded CSV
   pull per watchlist batch over per-lab page scraping.

## Rate / courtesy posture

QCOR is a government operational system, not a bulk API. Keep lookups
to small watchlist subsets (tens, not thousands), with delays, a
descriptive User-Agent, and off-peak hours.
