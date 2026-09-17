# ADR 0004: Source state Medicaid exclusion lists from the OpenSanctions mirror, flag overlap rather than dedupe across sources

- Status: accepted
- Date: 2026-09-13 (recording the decision behind the state exclusions ingest)
- Applies to: `tools/state-exclusions-ingest.ps1`,
  `tools/coverage-jurisdictions.js`, `src/services/exclusionService.js`,
  `client/src/data/coverage.json`

## Context

The federal LEIE ([ADR 0002](0002-file-based-leie-pipeline.md)) is not the whole
exclusion picture. State Medicaid agencies maintain their own exclusion and
termination lists, and a provider can be excluded by a state while absent from
the federal list. A screening product that checks only the LEIE returns CLEAR
for those providers, which is the exact failure the method statement is written
to avoid.

Getting the state lists is the problem. There are 51 jurisdictions (50 states
plus the District of Columbia) and no shared format, schedule, or access
convention. Lists appear as PDFs, spreadsheets, HTML tables, and search forms
that return nothing without a query. Some states publish weekly, some annually,
some republish the federal LEIE under a state heading. Nothing resembling a
common API exists.

Two properties of this platform constrain the answer. First, the build runs on
roughly ten to fourteen hours a week
([docs/plans/gtm-productized-services.md](../plans/gtm-productized-services.md)),
so 51 bespoke extractors is not a maintainable commitment; each one is a
scraper that will break, and a broken exclusion scraper fails by returning zero
matches, which the screening path reads as CLEAR. Second, provenance is the
product. Whatever the source, each row has to carry the jurisdiction, the
official source name and URL, and an as-of date, or it cannot appear in an
output that claims a paper trail.

## Decision

**Source the state lists through the OpenSanctions public mirror of official
state lists rather than extracting from 51 state sites, accept the 38
jurisdictions that mirror covers, flag federal overlap instead of removing it,
and record in the published coverage registry that commercial deployments must
re-extract from the official state URLs or license OpenSanctions directly.**

Three parts, taken separately.

### 1. Thirty-eight jurisdictions, and the other thirteen are named as gaps

The mirror (`us_medicaid_exclusions`) covers 38 jurisdictions, loaded as 82,929
exclusion records as of 2026-09-13. That is the coverage the platform claims,
in `client/src/data/coverage.json`, with the publisher recorded as "State
Medicaid agencies (38 jurisdictions)" and the provenance line stating plainly
that the data was sourced via the OpenSanctions mirror and not scraped from each
state directly.

The jurisdictions not covered are not silently omitted.
`tools/coverage-jurisdictions.js` builds a table of all 51, marks each one
either as ingested or as "no public list identified", and **refuses to write a
partial table**: it exits non-zero unless it produced exactly 51 rows and every
ingested jurisdiction carries a source URL. A reader of the Coverage page sees
which states were checked, not just which ones had data.

The per-state status and official source URL come from a survey file under
`data/`, and the record counts come from the loaded `state_exclusions` table, so
the published numbers are measured rather than transcribed. Both inputs live in
gitignored `data/`, which is why the committed `jurisdictions` array is empty in
a fresh checkout and why the script will not fabricate one.

### 2. Overlap is flagged, not deduplicated

Deduplication happens at two levels, and only one of them removes rows.

**Within the dataset**, rows are keyed on
`(state, lowercased entity_name, exclusion_date)` and later duplicates are
dropped during the load, counted and reported as `DUPES_SKIPPED`. This removes
true repeats inside one source.

**Across sources**, no row is ever removed. After the load, a single `UPDATE`
sets `state_exclusions.leie_overlap = true` for any row that matches an
`oig_exclusions` row by NPI, or whose lowercased `entity_name` exactly matches a
lowercased LEIE `display_name`. The count is reported as `LEIE_OVERLAP`.

Flagging rather than deleting, for three reasons:

- Many states republish the federal list. Deleting the state copy would discard
  the state's own `as_of` date, `source_name`, `source_url` and
  `exclusion_type`, which are precisely the provenance fields the output is
  supposed to carry. "Also on the federal list" and "only on the federal list"
  are different facts about a provider, and the flag preserves the difference.
- Name matching across sources is not reliable enough to justify destruction. A
  lowercased exact-name match is a strong hint and a weak proof; an organization
  that differs by a suffix matches nothing, and two individuals sharing a name
  match each other. A boolean annotation is the right weight for that evidence.
  Deleting on it is not.
- Deletion is irreversible within a load; a flag can be recomputed. Both
  loaders truncate first, so a changed overlap rule is a re-run, not a repair.

### 3. The mirror is for evaluation, not for resale

`coverage.json` carries the constraint as a note attached to the dataset, so it
renders on the Coverage page rather than living only in a plan document:
commercial deployments should re-extract from the official state URLs recorded
per jurisdiction, or license OpenSanctions directly. The mirror is suitable for
evaluation and internal screening, not for redistribution.

The evidence from the load supports treating the mirror as a third-party
artifact rather than a primary source: the delivered CSV arrived with a column
misalignment, ISO dates sitting in the `exclusion_type` column, which the loader
detects and repairs, counting the repairs as `REPAIRED`. A source that needs
repair on arrival is a source whose output should be re-derived before anyone
sells a verdict based on it.

Rejected alternative: **build 51 state extractors**. Highest fidelity and
unquestionable provenance, and it is what a commercial deployment must
eventually do, but it is a permanent maintenance load whose failure mode is a
false CLEAR. Not affordable at the current hours budget as a precondition for
having any state coverage at all.

Rejected alternative: **ship LEIE only, and treat state lists as out of scope**.
Cheapest, and dishonest for a product positioned on screening completeness.

Rejected alternative: **merge state and federal rows into one exclusions table
and deduplicate**. One query path instead of two, at the cost of losing the
jurisdictional provenance that distinguishes this product from a black-box
vendor verdict.

## Consequences

**What this buys.**

- State coverage exists at all, at 82,929 records across 38 jurisdictions,
  without committing to 51 scrapers.
- `exclusionService` resolves an identity against both `oig_exclusions` and
  `state_exclusions`, so a provider excluded only by a state is not returned as
  CLEAR.
- Coverage is honest at the jurisdiction level. The registry distinguishes
  ingested from "no public list identified", and the generator fails rather than
  publishing a partial table.
- The overlap flag lets an output say "also on the federal list" without
  asserting that the state record is redundant, and it is recomputed on every
  load.

**What this costs.**

- **Thirteen jurisdictions have no state-level coverage.** A provider excluded
  only by one of those states is returned CLEAR against state lists. This is a
  disclosed coverage gap, visible per jurisdiction on the Coverage page, not a
  silent one, and it is the strongest argument for the per-state extraction work
  the commercial note points at.
- **A dependency on a third party's extraction quality.** The misaligned column
  is proof that the mirror's output needs validation, and the repair step is
  compensating for a defect this project did not introduce and cannot fix
  upstream. A future format change on the mirror's side breaks the load.
- **Freshness varies by state and is not controlled here.** Each state publishes
  on its own schedule and the mirror adds its own lag. Per-row `as_of` dates
  carry that unevenness into the output rather than hiding it behind a single
  dataset-level vintage, but a state list can be materially older than the LEIE
  snapshot beside it.
- **The commercial constraint is a real product boundary, not a footnote.**
  Package B deliverables built on the mirror are evaluation and internal
  screening. Selling redistributed output requires the re-extraction work or a
  license first, and the note in `coverage.json` exists so that constraint
  travels with the data rather than living in a plan nobody reads at sale time.
- **`leie_overlap` is advisory and imperfect.** Name-based matching produces
  both false positives, where distinct entities share a name, and false
  negatives, where a suffix or punctuation differs. It informs presentation; it
  must not gate a verdict.
