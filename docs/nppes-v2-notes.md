# NPPES V.2 Reference Notes (from the August 2026 dissemination bundle)

Distilled from NPPES_Data_Dissemination_Readme_v.2.pdf (updated 2026-05-12),
NPPES_Data_Dissemination_CodeValues.pdf (updated 2025-02-01), and the real file
headers in data/nppes/. Read this before the full nppes_providers load or any
work on the reference files.

## Parser-critical facts

1. Quote handling (readme section 1.1): NPPES does NOT escape inner double quotes
   by doubling them. It REPLACES them with single quotes before writing. So no
   "" escape sequences exist in the data; a standard quote-aware CSV parser is
   correct, and values never contain literal double quotes.
2. The real August 2026 data header has 330 columns, ending with a trailing
   "Certification Date" (MM/DD/YYYY) after the 15 taxonomy group slots. The repo
   loader maps columns by header name, so the extra column is ignored safely.
   Add it to the table later only if we find a use for it.
3. "NPI Deactivation Reason Code" exists in the layout but is NOT publicly
   disseminated (readme 2.1); the column is empty in practice. Do not rely on it.
4. Dates are MM/DD/YYYY throughout; blanks are common.

## Code values that matter

- Entity Type: 1 = Individual, 2 = Organization.
- Primary Taxonomy Switch: X = not answered, Y = primary (exactly one per NPI),
  N = not primary. Confirms the Y-flag behavior the loader already implements.
- Group Taxonomy: 193200000X = Multi-Specialty Group, 193400000X = Single
  Specialty Group.
- Other Provider Identifier Type Codes include 01 (OTHER) and 05 (MEDICAID);
  the 50 identifier slots per row are Medicaid/other plan IDs, a future child
  table candidate.
- Taxonomy descriptions are NOT in any NPPES file. CodeValues points to the
  Washington Publishing Company (NUCC) site for the full code set. Source the
  NUCC crosswalk from NUCC/WPC directly when backfilling
  primary_taxonomy_description.

## Data quality quirks observed in the real othername sample

- Literal name values of "none" and "NONE" appear as actual Other Names.
- Typos exist in source data ("Hursing", "Helaht"); normalize before matching.
- Other Name Type Codes in the wild: 3 = Doing Business As (most common for
  orgs), 4 = Former Legal Business Name, 5 = Other Name. Type 6 in the main
  file means "more names exist in the othername reference file".

## The reference files (all keyed on NPI, all future child tables)

- npidata_pfile (11.4 GB, 330 cols): main provider file. Already ingested in
  smoke-test form (25k rows); full load is a 20 to 30 minute job in a quiet
  window.
- othername_pfile (~48 MB, 4 cols: NPI, Other Name, Type Code, Created Date):
  alternate names for Type 2 organizations. HIGH VALUE for Package B: excluded
  businesses are matched by name, and DBAs/former names are exactly what
  entity resolution needs. Ingest this before selling screening against
  business entities.
- pl_pfile (~116 MB, 10 cols): non-primary practice locations, includes a
  telephone extension field.
- endpoint_pfile (~122 MB, 19 cols): electronic endpoints (Direct addresses,
  FHIR URLs) plus affiliation names/addresses. Interesting for an
  interoperability story later; not on the current roadmap.

## Cadence

Monthly files fully replace the previous month; weekly incrementals cover new
and changed records only. A scheduled monthly refresh job (re-download, ingest,
swap) is the v2 pattern; weekly incrementals are optional.
