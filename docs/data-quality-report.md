# Data quality report — 2026-09-15

Read-only audit over NPI-carrying tables. Registries legitimately
contain empty NPIs (older exclusions predate NPI issuance); those are
reported as facts, not automatically as defects.

## NPI format audit

Duplicate keys = keys (NPI, or NPI+year for the MIPS cache) with more
than one row; registry tables legitimately hold multiple records per NPI.

| Table | Rows | Null/empty NPI | Bad format (not 10 digits) | Duplicate keys |
| --- | ---: | ---: | ---: | ---: |
| National NPPES load (V.2) (`nppes_providers`) | 9726865 | 0 | 0 | 0 |
| Materialized national screening (`national_screening`) | 9726865 | 0 | 0 | 0 |
| Legacy provider cache (`providers`) | 21138 | 0 | 0 | 0 |
| MIPS score cache (`mips_performance_scores`) | 8420 | 0 | 0 | 0 |
| OIG LEIE (`oig_exclusions`) | 84001 | 75120 | 0 | 177 |
| State Medicaid exclusion lists (`state_exclusions`) | 82929 | 67678 | 0 | 1404 |

## Null-name counts

| Table | Field | Null/empty |
| --- | --- | ---: |
| `nppes_providers` | display name (org LBN, else first+last) | 351938 |
| `national_screening` | entity_name | 351938 |
| `providers` | name_full fallback | 0 |
| `oig_exclusions` | display name | 0 |
| `state_exclusions` | entity_name | 0 |

## Taxonomy code reference check

Skipped: no `taxonomy_codes` reference table exists in this database.
