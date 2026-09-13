# nppes-ingest backpressure refactor — load verification

Record of the measurements behind the backpressure refactor of
`tools/nppes-ingest.js`. Read together with `docs/nppes-v2-notes.md`.

## What could not be verified here, and why

The refactor was **not** verified against the real dissemination file
(`data/nppes/npidata_pfile_20050523-20260809.csv`, 11.4 GB, ~8.5M rows).
Two blockers, both environmental:

- `data/` is gitignored, so the real file is not in the repo and is not
  present in a fresh checkout.
- `download.cms.gov` is refused by this environment's egress policy
  (HTTP 403 on the proxy CONNECT for every NPPES URL), so the file could
  not be re-fetched.

Anyone with the real file should re-run the command in "Reproducing"
below against it and append the result. The numbers here come from a
generated stand-in, not from production data.

## Substitute fixture

`tools/` has no generator; the fixture was built ad hoc to match the
documented V.2 layout: **330 columns** in dissemination order, CRLF line
endings, MM/DD/YYYY dates, fields containing commas quoted, and a mix of
Y-flagged / N-only / empty taxonomy slots so all three
`pickPrimaryTaxonomy` branches are exercised.

- 8,000,000 data rows + header, 4.54 GB (~567 B/row).
- Narrower than the real file (~1.34 KB/row), because only the mapped
  columns carry values. Row *count* matches production scale; total bytes
  do not.

Database: stock PostgreSQL 16.13, defaults untouched (`fsync=on`,
`synchronous_commit=on`, `shared_buffers=128MB`, `max_wal_size=1GB`).

## Results

Same file, same database, same flags. "before" is the commit prior to the
refactor; "after" is the refactor.

| run | heap cap | outcome | peak RSS | wall |
|---|---|---|---|---|
| before | 6144 MB | INGEST_OK 8000000/8000000/8000000 | **5683 MB** | 551 s |
| after  | 6144 MB | INGEST_OK 8000000/8000000/8000000 | **133 MB** | 395 s |
| before | 1024 MB | **OOM, exit 134**, died at 640k rows | 1048 MB (cap) | 45 s |
| after  | 1024 MB | INGEST_OK 8000000/8000000/8000000 | **114 MB** | 391 s |

RSS sampled every 5 s. The shape is the point:

```
before, 1024 MB cap:  3 → 207 → 379 → 629 → 841 → 949 → 1048 MB → OOM
before, 6144 MB cap:  3 → 3649 → 4573 → 5226 → 5314 → 5233 → … → 5683 MB peak
after,  6144 MB cap:  3 → 128 → 128 → 132 → 129 → 132 → 131 MB
```

Before the refactor memory tracks rows read. After it, memory plateaus
inside the first minute and stays flat for the rest of the file, because
the read stream is paused while a batch flush is in flight. The refactored
run is also ~28% faster: the old version spent its time in GC pressure
near the heap ceiling.

Note the 6144 MB "before" run completed rather than crashing — this
fixture is 4.54 GB against the real file's 11.4 GB, so the same growth
curve has less distance to cover. The defect is the unbounded growth, and
that reproduces identically; the crash is just where the curve meets the
ceiling.

## Data integrity after the load

All counts are exact against what the fixture was built to contain:

| check | value |
|---|---|
| rows | 8,000,000 |
| distinct NPI | 8,000,000 (no dupes, no dropped records) |
| entity type 2 | 1,600,000 (every 5th row) |
| credential `NP, RN` | 1,600,000 (quoted field with an embedded comma) |
| `taxonomy_switch='Y'` | 6,881,412 |
| `taxonomy_switch='fallback_1'` | 1,039,380 |
| `taxonomy_switch IS NULL` | 79,208 (= 8M/101, rows with all slots empty) |
| `last_update_date IS NULL` | 2,666,667 (= 8M/3) |
| `primary_taxonomy_description` | null on every row (reserved for NUCC backfill) |

The three switch buckets sum to exactly 8,000,000.

## Reproducing

```
node --max-old-space-size=6144 tools/nppes-ingest.js \
  --file data/nppes/<npidata_pfile>.csv --source <label>
```

Sample RSS alongside it (`/proc/<pid>/status`, VmRSS) to confirm the
plateau. Expect a flat curve and a final line reading
`INGEST_OK parsed=N inserted=N table=N`.
