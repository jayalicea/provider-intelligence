# Package B Priority Plan: Screening List Build

Status: prioritized 2026-09-12 over Packages A and C. Build sequence steps 1
through 4 were completed on 2026-09-12 and 2026-09-13; the file names below
are corrected to what was actually built.
Reason: durable signals (exclusions, licenses) outlast MIPS; does not depend on the
sunsetting MIPS program; tonight's MIPS-first seeding already feeds the demo story;
smallest gap between current platform and a sellable artifact.

## What Package B v1 is (fixed scope)

Input: client's provider roster (CSV of NPIs, names optional).
Output: same roster back, one row per provider, with:
  identity (name, taxonomy, practice address, from NPI registry),
  OIG exclusion status with exclusion type and date when found,
  source and as-of date on every field,
  a flags column: "EXCLUDED", "CLEAR", or "UNVERIFIED" (never overstate).
Out of scope for v1: license status (add-on later), monitoring over time, API access.

## Build sequence (this week, evenings and weekend)

1. LEIE ingest. **Done.** OIG publishes the LEIE as a monthly downloadable
   file (OIG website, public, no key). Built as `tools/leie-ingest.ps1`, not
   the `tools/fetch-leie.ps1` name planned here: download, parse, load into
   `oig_exclusions` keyed on NPI where present, with source and as-of date
   columns. `tools/monthly-leie-refresh.ps1` runs the scheduled refresh. Not
   an HTTP endpoint.
2. Screening script. **Done.** Built as `tools/screen-roster.js`, a node
   script using the project pg pool, not the `tools/screen-roster.ps1` name
   planned here. Matches on NPI first, falls back to name plus state only when
   NPI is missing, prefers a miss over a false clear, writes the flagged CSV
   with provenance columns. The same logic is exposed at
   `POST /api/v1/intelligence/screen-roster` and now also screens against the
   state Medicaid exclusion lists, which this plan predates.
3. Self-test. OIG publishes known excluded individuals; verify the matcher flags
   them by NPI and by name-fallback. Record results in the method statement.
4. Method statement. **Done**, at `docs/method-statement.md` (one page, ships
   with every deliverable): sources used,
   as-of dates, match logic, known limitations, and the exact sentence:
   "This report states what public sources published as of the dates shown.
   It does not certify any provider's status."

## Legal positioning (diligence, not legal advice)

Screening outputs used for credentialing or employment decisions may implicate
FCRA and state screening laws. Before selling into those use cases, confirm
applicability. Default positioning until then: quality-assurance and outreach
screening only, public data only, no BAA triggered.

## Pricing (v1)

Flat fee, $1,500 for up to 1,000 providers, 48-hour turnaround, one revision.
License status is a priced add-on once the per-state survey (Prompt D input)
identifies the cheapest reliable sources for the client's states.

## Outreach angle (first five contacts)

"I turn your provider roster into a screened, provenance-tagged CSV in 48 hours:
every provider checked against the OIG exclusions list, every value carrying its
source and as-of date, no black box." The demo: tonight's 13,500-provider cache
plus the screening script on a sample of their roster (free, 25 providers).

## Dependencies

Prompt D remains the umbrella; this file is the executable slice of it.
License status and the dossier endpoint wait for v1 revenue or a paying pilot.
