# National screening headlines

Audit numbers from the materialized `national_screening` table (built from
`nppes_providers` + `oig_exclusions` + `state_exclusions` +
`mips_performance_scores`). Facts only — what enters `coverage.json` is a
human decision. Source of truth: `node tools/national-headlines.js`.

Computed at: 2026-09-15 (nightly build; the table is rebuilt by
`tools/overnight-national-screening.js`).

| Figure | Count |
| --- | ---: |
| Total NPIs screened | 9,726,865 |
| Active LEIE exclusions found among them | 8,700 |
| State-list-only hits (state EXCLUDED, LEIE clear) | 9,435 |
| Both-registry hits (LEIE + state EXCLUDED) | 3,856 |
| Reinstatement records (either registry) | 0 |
| MIPS-scored providers (latest score cached) | 8,356 |
| Individuals | 7,767,205 |
| Organizations | 1,959,660 |

Notes:

- LEIE and state verdicts are stored per registry; a "both-registry hit" is
  a row with an active exclusion record in each. Read-time resolution still
  cites LEIE first, matching the service semantics.
- The MIPS figure reflects the local `mips_performance_scores` cache, not
  national MIPS participation; it grows as cohorts are screened and cached.
- Zero reinstatement records means no matched NPI carried a non-null
  reinstatement date in either registry at build time.
