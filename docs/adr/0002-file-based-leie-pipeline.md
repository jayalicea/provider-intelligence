# ADR 0002: Load the OIG LEIE from the published flat file, not from an API

- Status: accepted
- Date: 2026-09-13 (recording a decision taken during the Package B build)
- Applies to: `tools/leie-ingest.ps1`, `tools/monthly-leie-refresh.ps1`,
  `src/services/exclusionService.js`

## Context

Package B, the Screening List Build described in
[docs/plans/package-b-priority.md](../plans/package-b-priority.md), sells one
thing: a client's provider roster returned with an exclusion verdict and a
provenance column on every field. The federal source for that verdict is the
HHS Office of Inspector General List of Excluded Individuals and Entities
(LEIE).

The question at build time was how to read it. The surrounding platform already
reads three government sources over HTTP and caches the responses
([ADR 0001](0001-cache-first-api-design.md)), so an API path would have been the
consistent choice. It is not available:

- **OIG publishes no public query API for the LEIE.** The published
  machine-readable access path is a downloadable database: a monthly full file
  (`UPDATED.csv`), supplemented by monthly exclusion and reinstatement
  supplement files. There is no keyed or keyless endpoint that answers "is this
  NPI excluded", and there is no vendor-documented query syntax to build
  against. OIG also offers an interactive online search form for human use;
  driving that form programmatically would be scraping an interface that
  carries no stability contract, not consuming an API.
- The screening workload is the wrong shape for per-record lookups anyway. A
  Package B engagement screens **up to 1,000 providers in one batch** and the
  platform also runs a national cohort and watchlist view. Even if a lookup
  endpoint existed, 1,000 sequential calls against a government service with an
  advisory rate limit is a worse design than one file read.
- A false CLEAR is the worst failure this product can produce. The method
  statement's rule is "prefer a miss over a false clear"
  ([docs/method-statement.md](../method-statement.md)). A network path
  introduces a failure mode, the partially-successful batch, in which some rows
  are checked and some are not, and the loader has to decide what a timed-out
  row means. A local snapshot removes that decision: either the snapshot loaded
  completely or the ingest failed and nothing is screened against it.

The flat file also happens to carry what provenance requires: a single,
nameable artifact with a known publication cadence, which can be stamped with a
`source` (the file name) and an `as_of` (the load date) on every row.

## Decision

The LEIE is ingested from the **published OIG flat file into a local
`oig_exclusions` table**, on a scheduled offline job. Screening reads only that
local snapshot. No request-time HTTP call reaches OIG.

Concretely:

- `tools/leie-ingest.ps1` picks the CSV out of `data/leie/`, parses it in Node
  with a quote-aware state machine, and streams batches of 500 rows into
  `oig_exclusions` using the shared loader pattern in
  [ADR 0003](0003-jsonb-populate-recordset-loaders.md).
- Every row is stamped with `source` (the source file name) and `as_of` (the
  load date), and gains a derived `display_name` (`busname`, else
  `lastname, firstname`) so name matching has one canonical field.
- The LEIE's no-NPI sentinel `0000000000` and the all-zero date sentinel
  `00000000` are normalized to NULL at parse time, so a sentinel can never be
  mistaken for a real identifier.
- The table is **truncated before each load**, which makes the job idempotent
  and makes the monthly full file the only source of truth. There is no
  incremental merge to get wrong.
- `tools/monthly-leie-refresh.ps1` runs the download-and-reload cycle on the
  monthly cadence, matching OIG's publication schedule.
- Refresh is a scheduled job, never an HTTP endpoint. This is the same
  constraint `SECURITY_REVIEW.md` P0-1 arrives at from the security side: an
  unauthenticated write path into a cache that every read endpoint trusts is the
  highest risk in the design.

Rejected alternative: **scrape the OIG online exclusion search**. It would give
per-query freshness, but against an HTML interface with no stability contract,
no documented rate policy, and a failure mode (a layout change) that produces
zero matches rather than an error. Zero matches is a false CLEAR.

Rejected alternative: **a commercial screening API**. Faster to integrate and
someone else's maintenance burden, but it inverts the product thesis. The
platform's claim is that every value carries its own public-source provenance;
reselling a vendor's verdict means reselling a verdict whose method the client
cannot inspect, and it adds a per-lookup cost to a package priced as a flat fee.

## Consequences

**What this buys.**

- Screening is a local SQL query. A 1,000-provider roster is one batch against
  an indexed table, not 1,000 network calls, so Package B's 48-hour turnaround
  is bounded by human work rather than by a third party's rate limit.
- The snapshot is a citable artifact. Every output row can name the file it was
  checked against and the date it was loaded, which is what
  `docs/method-statement.md` promises recipients.
- The ingest is deterministic and re-runnable. Truncate-first plus the
  self-verifying count check (ADR 0003) means a re-run either reproduces the
  same table or fails loudly.
- No OIG availability incident can ever affect a screening run.

**What this costs.**

- **Staleness between refreshes is structural.** A provider excluded the day
  after a load will not appear until the next one. This is disclosed rather
  than engineered away: the method statement names it as stale-source risk, and
  every output field carries its as-of date so a recipient can judge freshness.
  Shortening the refresh cycle does not remove the gap, it only narrows it.
- **The refresh is an operational obligation.** A missed monthly run silently
  ages the snapshot; nothing in the read path notices. The mitigation is the
  scheduled job plus the `as_of` column being rendered next to every verdict,
  so an aged snapshot is visible to the person reading the output rather than
  only to whoever maintains the loader.
- **Local disk and load time are now part of the system.** As of 2026-09-12 the
  snapshot is 84,001 rows, which is small; the cost is real but not yet
  material.
- **`data/` is gitignored**, so the source file is absent from a fresh checkout
  and the loader cannot be exercised end to end in CI or in a development
  container. The self-verifying count check is what stands in for that: it runs
  wherever the real file is, and it fails the job rather than reporting a
  partial load as success.
- **Match quality, not source freshness, is now the dominant risk.** With the
  network problem gone, the remaining failure modes are name normalization,
  missing NPIs on LEIE rows, and date-of-birth disambiguation. Those are
  documented as known limitations in the method statement, and they are why a
  name-only match with a disagreeing DOB downgrades to UNVERIFIED rather than
  asserting EXCLUDED.
