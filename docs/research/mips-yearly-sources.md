# Multi-year MIPS sources — research notes

Supports HANDOFF.md open-work item 7 (true multi-year MIPS data) and
CODE_REVIEW finding C1 (every multi-year trend is a request label on a
single rolling vintage).

Research state: enumeration complete for Phase A0 (2026-09-18). The
sibling-dataset question is answered in the negative: CMS re-bases one
dataset in place; per-year vintages were recovered from Wayback captures
(PY 2018-2020, 2022-2024). PY 2017 and PY 2021 remain insufficient
materials.

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

## Sibling-year enumeration (verified live 2026-09-18)

Techniques used: provider-data metastore
(`/api/1/metastore/schemas/dataset/items`, 237 current datasets),
data.cms.gov `data.json` (159 datasets), and web.archive.org snapshots of
both the metastore items endpoint and the `ec_score_file.csv` distribution
files.

**Key finding: there are no sibling per-year datasets.** CMS publishes
exactly ONE "Clinician Public Reporting: Overall MIPS Performance" dataset
(`a174-a962`) and re-bases it in place each year; the metastore title and
the CSV distribution change, the dataset id does not. Verified by snapshot
diff (all verified live 2026-09-18 against web.archive.org):

- 2021-04-19 snapshot: title "PY 2018 ...", distribution
  `.../a0f235e13d54670824f07977299e80e3_1611967946/ec_score_file.csv`
  (web.archive.org/web/20210419231836/)
- 2021-10-06 snapshot: title "PY 2019 ...", distribution
  `..._1622837122/ec_score_file.csv`
  (web.archive.org/web/20211006144700/)
- 2022-04-16 snapshot: title "PY 2020 ...", distribution
  `..._1645646732/ec_score_file.csv`
  (web.archive.org/web/20220416011833/)
- 2023-12-04 snapshot: title "PY 2021 ...", distribution
  `..._1697774725/ec_score_file.csv`
  (web.archive.org/web/20231204015056/)
- 2025 snapshot: title "PY 2023 ...", distribution
  `.../6b9e57db797c95853b034b329b1212b2_1763510763/ec_score_file.csv`
- 2026-09-18 live: title "PY 2024 ...", distribution
  `..._1787091345/ec_score_file.csv`

Consequently the earlier assumption that "archived PY datasets exist as
sibling datasets" is wrong: older vintages survive only as Wayback Machine
captures of the per-vintage CSV resource paths (the paths are
content-hash-timestamped, so each vintage has a stable, distinct URL). The
PY label for each capture is taken from the nearest contemporaneous
metastore title, recorded above.

Per-year availability (CSV bulk source, verified 2026-09-18):

| PY | Dataset id | CSV resource | Retrieval | Status |
|----|-----------|--------------|-----------|--------|
| 2018 | a174-a962 | .../a0f235e1..._1611967946/ec_score_file.csv | Wayback capture 2021-04-20 | downloaded, 889,593 data lines, 666,264 distinct NPIs |
| 2019 | a174-a962 | .../a0f235e1..._1622837122/ec_score_file.csv | Wayback capture 2021-07-15 | downloaded, 954,654 data lines, 719,244 distinct NPIs |
| 2020 | a174-a962 | .../a0f235e1..._1645646732/ec_score_file.csv | Wayback capture 2022-03-09 | downloaded, 933,504 data lines, 704,331 distinct NPIs |
| 2021 | a174-a962 | .../a0f235e1..._1697774725/ec_score_file.csv | no Wayback capture; live URL 404 (verified 2026-09-18) | insufficient materials (exists per 2023-12-04 metastore snapshot, not retrievable) |
| 2022 | a174-a962 | .../6b9e57db..._1721952317/ec_score_file.csv | Wayback capture 2025-09-09 | downloaded, 624,209 data lines, 534,992 distinct NPIs |
| 2023 | a174-a962 | .../6b9e57db..._1763510763/ec_score_file.csv | Wayback capture 2026-03-04 | downloaded, 541,334 data lines, 477,587 distinct NPIs |
| 2024 | a174-a962 | .../6b9e57db..._1787091345/ec_score_file.csv | live, HTTP 200, ~40 MB | downloaded, 520,011 data lines, 461,358 distinct NPIs |
| 2017 | n/a | n/a | not on provider-data catalog (earliest metastore snapshot, 2021-04, already shows PY 2018) | insufficient materials |

Header layouts differ by vintage and must be mapped by name, not position
(verified from the downloaded files 2026-09-18):

- PY 2018: `npi, org_pac_id, lst_nm, frst_nm, source,
  quality_category_score, pi_category_score, cost_category_score,
  ia_category_score, final_mips_score` (note: cost before ia).
- PY 2019: `NPI, Org_PAC_ID, lst_nm, frst_nm, source, facility_ccn,
  facility_lbn, Quality_category_score, PI_category_score,
  IA_category_score, Cost_category_score, final_MIPS_score`.
- PY 2020: same as 2019 plus `final_MIPS_score_without_CPB` before
  `final_MIPS_score`; values may be `N/A`.
- PY 2022-2024: `NPI, Org_PAC_ID, Provider Last Name, Provider First Name,
  source, Facility-based scoring Certification number, Facility Name,
  Quality_category_score, PI_category_score, IA_category_score,
  Cost_category_score, final_MIPS_score_without_CPB, final_MIPS_score`.

Row counts above were measured 2026-09-18 on the downloaded copies under
`data/mips-yearly/`. CMS publishes one row per (clinician, org
affiliation), so every vintage repeats NPIs; the loader keeps the first
row per NPI (the table key is UNIQUE (npi, performance_year)), which is
why distinct-NPI counts are lower than data-line counts.

Not yet established (insufficient materials):

- Whether the archived per-year files are stable or re-based: the
  content-hash resource paths suggest snapshots, but only the metastore
  title evidence above supports the PY labels; unverified beyond that.
- PY 2021 bulk data: no capture of the 1697774725 resource exists and the
  live URL is gone.

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
