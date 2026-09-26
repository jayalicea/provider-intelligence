# POS iQIES file (Home Health + ASC + Hospice) - discovery notes (2026-09-26)

Next provider-type slice after CLIA labs. ONE CSV covers three facility
types; the identity key is again `prvdr_num` (CMS Certification Number,
the facility analog of NPI/CLIA).

## Source

- data.gov catalog: "Provider of Services File - Internet Quality
  Improvement and Evaluation System - Home Health Agency, Ambulatory
  Surgical Center, and Hospice Providers"
  (slug: provider-of-services-file-internet-quality-improvement-and-evaluation-system-home-health-a)
- Latest CSV verified: Q1 2026 vintage (published 2026-04):
  `https://data.cms.gov/sites/default/files/2026-04/90983850-6dfe-4886-9dfa-1a3890a655b3/POS_File_iQIES_Q1_2026.csv`
  (175 MB, 77,283 provider rows, ~230 columns)
- Also has per-vintage data-api endpoints (`/data-api/v1/dataset/{uuid}/data`).

## Format differences from the CLIA POS file (a new column map is required)

- Lowercase snake headers (`prvdr_num`, `fac_name`, `prvdr_type_id`,
  `prvdr_sbtyp_id`, ...), NOT the uppercase CMS abbreviations.
- Dates already ISO (`2021-07-21`), not YYYYMMDD.
- "Not Available" sentinel strings instead of empty fields.
- `prvdr_type_id` distinguishes the three provider types
  (sample row shows `3` for an HHA - verify the code list during ingest
  build).
- Many service-indication columns (hha_aide_srvc_cd, pharmacy, etc.).

## Next steps (one focused session)

1. Column census: distinct `prvdr_type_id` values + counts; pick the
   subset of columns to persist (mirror the clia_labs pattern:
   identity, demographics, certification, history columns).
2. `src/config/migrations/20260XXX_facilities.sql` + `tools/facility-ingest.js`
   modeled directly on tools/clia-ingest.js (same temp-table merge;
   mind the parameter cap lessons: batch <= 1500 rows, readline AFTER
   DB setup, NOT EXISTS retire).
3. Endpoints `/api/v1/facilities/search` + `/:ccn` mirroring /labs.
4. Quarterly task: extend tools/clia-refresh.ps1's catalog discovery to
   also match `POS_File_iQIES_Qn_YYYY.csv`.
