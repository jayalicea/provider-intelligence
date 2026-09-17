# ADR 0003: One insert pattern for every bulk loader, plus a self-verifying count rule

- Status: accepted
- Date: 2026-09-13 (recording a pattern established across three loaders)
- Applies to: `tools/nppes-ingest.js`, `tools/leie-ingest.ps1`,
  `tools/state-exclusions-ingest.ps1`

## Context

Three bulk loaders exist, and they are not alike in shape or scale:

| Loader | Source | Scale | Shape |
|---|---|---|---|
| `tools/nppes-ingest.js` | NPPES dissemination file | 9,726,865 rows, 11.4 GB, 330 source columns | fixed layout, mapped by header name |
| `tools/leie-ingest.ps1` | OIG LEIE `UPDATED.csv` | 84,001 rows | 18 source columns plus derived fields |
| `tools/state-exclusions-ingest.ps1` | State Medicaid exclusion CSV | 82,929 rows across 38 jurisdictions | 12 columns, arrives with a known misalignment defect |

They share three problems. Every one of them needs to move a lot of rows into
PostgreSQL quickly. Every one of them needs per-row work in JavaScript before
the insert (mapping 330 positional columns by header name, deriving
`display_name`, normalizing the LEIE's `0000000000` and `00000000` sentinels to
NULL, moving an ISO date out of the column it was misaligned into). And every
one of them can fail in ways that look like success: a swallowed promise
rejection drops a batch, a failed `TRUNCATE` leaves the previous load underneath
the new one, a mis-sized batch silently truncates.

The available insert strategies each fail one of those three requirements:

- **Per-row `INSERT`**: one round trip per row. At 9.7M rows this is not a
  candidate.
- **Multi-row `VALUES` with bind parameters**: fast, but the placeholder count
  is rows times columns, and PostgreSQL's extended protocol caps a statement at
  65,535 bind parameters. With NPPES mapped to roughly 30 stored columns that is
  about 2,000 rows per statement; the SQL text has to be rebuilt for every batch
  size, and getting the parameter ordering wrong shifts values into adjacent
  columns without any error.
- **`COPY FROM`**: the fastest option, and the right one when the file can go
  in as-is. Here it cannot. The loaders have already parsed CSV in order to do
  per-row repair, so using `COPY` means re-serializing repaired rows back into
  CSV or a binary format, which reintroduces exactly the quoting and escaping
  problems the parser just solved. NPPES's own quoting rules are non-standard
  enough to have earned a section in
  [docs/nppes-v2-notes.md](../nppes-v2-notes.md).
- **An ORM or query builder**: adds a dependency and a mapping layer to three
  standalone scripts whose entire job is a single insert statement.

## Decision

**Every bulk loader inserts through the same statement**, built from rows that
are plain JavaScript objects keyed by destination column name, serialized once
per batch as a single JSON bind parameter:

```sql
INSERT INTO <table>
SELECT * FROM jsonb_populate_recordset(null::<table>, $1::jsonb)
```

and **every bulk loader ends with the same three-way count check**, printing
`INGEST_OK parsed=N inserted=N table=N` on agreement and exiting non-zero with
`INGEST_FAILED` otherwise.

The supporting conventions, shared by all three:

- Rows accumulate in a batch array (500 for LEIE, 1,000 for NPPES and state
  exclusions) and the array is **snapshotted and replaced before the `await`**,
  so rows produced while a flush is in flight land in the next batch rather than
  being inserted twice or lost.
- The destination table is **truncated first**, making every loader idempotent
  and making a re-run a full replacement rather than a merge.
- The table's own row type (`null::<table>`) drives the cast, so the loader
  never writes a column list and never depends on column order.
- `parsed` counts rows read from the source, `inserted` counts rows the loader
  believes it wrote, and `table` is a `COUNT(*)` issued after the load
  completes.

Why `jsonb_populate_recordset` specifically:

- **One bind parameter per batch, regardless of batch size or column count.**
  The 65,535-parameter ceiling stops being a design input.
- **Column binding is by name, not by position.** A row object with keys in any
  order lands correctly, and a column added to the table later does not shift
  existing values sideways. Given that one of these three sources arrived with
  its columns already misaligned, positional binding was not an acceptable
  risk.
- **Type coercion is PostgreSQL's job.** The loaders hand over strings and
  nulls; `date`, `boolean` and the rest are resolved against the declared table
  type at insert time, so there is no second type system in JavaScript to keep
  in sync.
- **No CSV round trip.** Rows that were parsed and repaired in JavaScript go to
  the database as JSON, never back through CSV quoting.

Why the three-way count rather than two:

- `parsed` against `inserted` catches the loader losing rows to itself: a
  dropped batch, a rejected flush whose promise was not awaited, a filter that
  ran when it should not have.
- `inserted` against `table` catches the database disagreeing with the loader:
  a `TRUNCATE` that did not take, a concurrent writer, a batch that rolled back.
  The NPPES run is the worked example: the load reported
  `INGEST_OK parsed=9726865 inserted=9726865 table=9726865`, and because a
  25,000-row smoke load had preceded it, a failed truncate would have shown
  roughly 9,751,865 in the `table` position instead of matching. The check is
  what makes that a caught failure rather than a silently inflated table.

## Consequences

**What this buys.**

- One pattern to learn, review and debug across three loaders that otherwise
  share nothing. A fourth loader is a mapping function plus this statement.
- Bulk loads cannot silently half-succeed. The job either prints `INGEST_OK`
  with three agreeing numbers or exits non-zero.
- Re-running a loader is safe, which matters because these jobs are long
  (the national NPPES load is measured in tens of minutes) and get interrupted.
- Batch size is a free tuning knob, unconstrained by parameter limits.

**What this costs.**

- **`jsonb_populate_recordset` is slower than `COPY`.** Each batch pays JSON
  serialization in Node, parse and type coercion in PostgreSQL. This was
  accepted deliberately: at 9.7M rows the loader is still a tens-of-minutes job,
  and the refactor recorded in
  [docs/nppes-full-load-verification.md](../nppes-full-load-verification.md)
  shows the real bottleneck was memory growth, not the insert, with peak RSS
  dropping from 5,683 MB to 133 MB and wall time also improving by about 28%
  once the read stream was paused during flushes.
- **A whole batch is held in memory as a JSON string**, so batch size has a
  memory cost as well as a throughput benefit. This is why the batch sizes are
  in the hundreds to low thousands rather than tens of thousands, and why the
  read stream is paused while a flush is in flight.
- **The count check proves no row was lost. It does not prove every column was
  populated.** A misspelled key in the row object is simply not present in the
  JSON, `jsonb_populate_recordset` leaves that column NULL, and all three counts
  still agree. This is the pattern's real blind spot. The mitigation is a
  separate per-column verification step: the NPPES load verification records
  distinct-NPI counts, entity-type splits, taxonomy-switch bucket counts that
  sum exactly to the row total, and a deliberately quoted field containing an
  embedded comma. Any new loader owes the same kind of column-level check.
- **Truncate-first means no incremental loads.** A monthly refresh reloads the
  whole file. Correct for these three sources, all of which publish full
  replacements, and it would be the wrong pattern for a source that publishes
  deltas.
- **These loaders write outside the schema in `src/config/init.sql`.** Each
  creates its own table with `CREATE TABLE IF NOT EXISTS` and patches it with
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so `nppes_providers`,
  `oig_exclusions` and `state_exclusions` are defined by their loaders rather
  than by the schema file. That keeps a loader runnable standalone, at the cost
  of the schema living in two places.
