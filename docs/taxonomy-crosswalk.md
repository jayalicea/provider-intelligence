# Taxonomy crosswalk

NPPES ships taxonomy **codes** with no descriptions, so
`nppes_providers.primary_taxonomy_description` is null on every row after a
full load (see `docs/nppes-full-load-verification.md`). `taxonomy_codes` is the
crosswalk that turns a code into a label, and `tools/taxonomy-ingest.js` loads
it and backfills from it.

## Sources, in priority order

1. **NUCC published CSV** — `https://www.nucc.org/images/stories/CSV/nucc_taxonomy_260.csv`.
   Authoritative, and the source `docs/nppes-v2-notes.md` points at.
2. **NIH Clinical Tables taxonomy API** — `https://clinicaltables.nlm.nih.gov/api/taxonomy/v3/search`.
   Fallback. Answers with the 4-element positional envelope documented in
   AGENTS.md.
3. **`--file <path>`** — a pinned local copy, for an air-gapped run or to hold
   a specific vintage.

`taxonomy_codes.source` records which of the three a row came from, alongside
`as_of`, so a description always says where it originated.

## Neither remote source is reachable from the build container

Both hosts are refused by this environment's egress policy:

```
NUCC_CSV unavailable: HTTP 403 from https://www.nucc.org/images/stories/CSV/nucc_taxonomy_260.csv
NIH_CLINICAL_TABLES unavailable: HTTP 403 from https://clinicaltables.nlm.nih.gov/api/taxonomy/v3/search
```

The proxy denies the CONNECT for `www.nucc.org`, `nucc.org`, `www.wpc-edi.com`
and `clinicaltables.nlm.nih.gov` (a control request to `registry.npmjs.org`
returns 200, so the proxy itself is working). That is a policy denial, not a
transient failure, so the tool reports it and names the `--file` option rather
than retrying.

**Consequence: the load recorded in this repository used `--file`, not a live
source.** On a machine that can reach NUCC, `node tools/taxonomy-ingest.js`
takes the first branch with no further arguments and records `NUCC_CSV`.

Note the NIH branch's exact field names could not be confirmed against the live
service from here. Its parser is written to the documented envelope convention,
tolerates absent extra-field columns rather than requiring them, and is covered
by tests; treat the field names as unverified until a live run confirms them.

## Usage

```bash
node tools/taxonomy-ingest.js                       # NUCC, then NIH
node tools/taxonomy-ingest.js --source nih          # pin the fallback
node tools/taxonomy-ingest.js --file nucc.csv       # offline / pinned vintage
node tools/taxonomy-ingest.js --backfill-only       # re-run just the backfill
node tools/taxonomy-ingest.js --skip-backfill       # load the code set only
```

The tool truncates and reloads `taxonomy_codes`, then verifies
`parsed == inserted == table count`, exiting non-zero on any mismatch.

## What the backfill does, and does not, touch

It only ever fills what is **empty**:

- `nppes_providers.primary_taxonomy_description` where null or `''`;
- `providers.primary_taxonomy_description`, `taxonomy_grouping` and
  `taxonomy_classification` where null or `''`.

A description already present — from the NPI API, an earlier run, or manual
correction — is never overwritten, and a code absent from the crosswalk is left
null rather than guessed at. Re-running backfills zero rows.

## Where the labels surface

- `GET /api/v1/intelligence/cohort` joins `taxonomy_codes` and returns
  `COALESCE(t.description, p.primary_taxonomy_description)`. The `taxonomy`
  filter searches that same expression, so filtering and display cannot
  disagree.
- `GET /api/v1/providers/:npi` (cache path) joins the crosswalk and falls back
  `stored description -> crosswalk description -> provider_type`.
