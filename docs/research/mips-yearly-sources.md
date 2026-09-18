# Multi-year MIPS sources — research notes

Supports HANDOFF.md open-work item 7 (true multi-year MIPS data) and
CODE_REVIEW finding C1 (every multi-year trend is a request label on a
single rolling vintage).

Research state: incomplete (the research session hit a quota limit). What
follows is verified live on 2026-09-18; the sibling-dataset enumeration did
not finish and is marked accordingly.

## Key finding: archived per-year MIPS datasets exist on the provider-data
datastore

The data.cms.gov data-api rolling dataset (UUID
`7adb8b1b-b85c-4ed3-b314-064776e50180`) has no year column, but CMS keeps
per-performance-year "Clinician Public Reporting: Overall MIPS Performance"
snapshots as provider-data datastore datasets. HANDOFF.md says the per-year
IDs are "dead for the data API" — that is true for the data-api, but they
are alive on the provider-data datastore (the Care Compare style API this
platform already uses).

Verified live 2026-09-18:

- Dataset `a174-a962`, title "PY 2024 Clinician Public Reporting: Overall
  MIPS Performance", landing page
  `https://data.cms.gov/provider-data/dataset/a174-a962`.
- Query API responds:
  `GET https://data.cms.gov/provider-data/api/1/datastore/query/a174-a962/0?limit=2`
  returned per-NPI rows with columns `npi`, `provider_last_name`,
  `provider_first_name`, `quality_category_score`, `pi_category_score`,
  `ia_category_score`, `cost_category_score`, `final_mips_score_without_cpb`,
  `final_mips_score`, `org_pac_id`, `source`, `facility_name`,
  `facilitybased_scoring_certification_number`.
- Full CSV download (from the data.cms.gov data.json catalog distribution
  record, HTTP 200, ~40 MB):
  `https://data.cms.gov/provider-data/sites/default/files/resources/6b9e57db797c95853b034b329b1212b2_1787091345/ec_score_file.csv`

Machine column names are snake_case here, unlike the data-api rolling
dataset's lowercase-with-spaces columns, so the existing cmsDataService
mapping does not apply directly.

## Not yet established (insufficient materials)

- Which other performance years are published as sibling datasets (PY
  2017-2023 archives). The metastore keyword search endpoint did not filter
  as expected during this session and the full data.json catalog fetch
  returned only 159 datasets, so the sibling list is incomplete. Next step:
  enumerate archived "Clinician Public Reporting" datasets by paging the
  metastore or scraping the archive listing, and record each year's
  identifier, vintage, and download URL the same way as above.
- Whether the archived per-year files are stable/snapshotted or re-based in
  place (the rolling dataset is re-based). The PY 2024 file's presence under
  a content-hash resource path suggests snapshots, but this is unverified.
- Row counts per year for coverage.json.

## Recommended ingestion path (Phase A0)

1. Enumerate all archived PY datasets; record identifier, title, vintage,
   CSV URL, row count.
2. Bulk-load each year's CSV into `mips_performance_scores` with
   `performance_year` taken from the dataset title's PY label, replacing the
   request-label behavior. The UNIQUE (npi, performance_year) constraint
   already supports this.
3. Keep the rolling dataset for current-year freshness; only archived years
   become true year-labeled rows.
4. After two or more real years land, revisit `/analytics/trends`: the
   rolling-vintage warning can be dropped for providers whose years are all
   archive-sourced, but must stay wherever the rolling vintage is involved.
