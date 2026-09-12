# CORRECTIONS.md — phynpi.md divergences from the working code

`phynpi.md` is the original design document. It was written against assumed
API shapes and was never fully executable as printed. This file lists every
divergence found while building the real backend, grounded in the actual code
in `src/` and live verification against the government APIs. Unless noted,
"the doc" means phynpi.md and "the code" means the current `src/` tree.

## The six live-verification bugs

### 1. Controller binding (doc §4.7)

The doc registers routes with bare method references:

```js
router.get('/search', controller.searchProviders); // `this` is lost
```

`ProviderController` is a class; Express invokes the handler with no
receiver, so `this.npiService` is `undefined` and every request throws.
**Working code:** `src/routes/providerRoutes.js` binds every method via a
`bound()` helper (`controller[method].bind(controller)`) before registration.

### 2. Wrong NPI endpoint (doc §2.1, §4.2, §7.1)

The doc uses `/npi_ind/v3/search` for individuals. That path does not exist
(verified 404). The real individual-provider endpoint is
**`/npi_idv/v3/search`** (organizations: `/npi_org/v3/search`;
`npi_util` also does not exist).
**Working code:** `src/config/api-config.js` `npiRegistry.endpoints.individual
= '/npi_idv/v3/search'`.

### 3. Response envelope handling (doc §4.4 `transformNpiResponse`)

The doc treats the NPI API response as an array of provider objects and maps
`item.NPI`, `item['name.full']`, etc. The real API returns a **4-element
positional envelope**: `[total, ids, extraFields, displayRows]`, where
`extraFields` is `{dotted.path: [parallel arrays]}` and each display row is a
positional `[name, NPI, provider_type, address]` array whose first-two field
order varies. Mapping object keys over that yields garbage.
**Working code:** `src/services/npiService.js` `transformNpiResponse` unpacks
the envelope, aligns `ef` parallel arrays by index, and reads `provider_type`
from display-row index 2. Extra fields must be requested as leaf paths via
`ef` (the doc's `licenses` object request returns unusable JSON strings).

### 4. `enumeration_type` constraint (doc §3.1, §4.4)

The doc sets `enumerationType: item.provider_type` and caches it into
`providers.enumeration_type`, whose CHECK constraint allows only
`'Individual'/'Organization'`. But `provider_type` is the specialty string
(e.g. `"Physician/Internal Medicine"`), so **every cache insert violates the
constraint**. The schema itself is fine.
**Working code:** `npiService.transformNpiResponse` hardcodes
`enumerationType: 'Individual'` (the `npi_idv` API returns individuals only);
the specialty is stored in `provider_type` / taxonomy fields instead.

### 5. Dead MIPS dataset ID (doc §2.3, §4.2, §7.1)

The doc fetches MIPS data per performance year via dataset IDs like
`py2023: 'a174-a962'` against `data.cms.gov/data-api/v1/dataset/{id}/data`.
Those provider-data catalog IDs **no longer resolve through the data API**
(the catalog datasets are CSV-download only now). The doc's assumption of
columns like `Performance Year`, `Final Score`, `Quality Score` is also
wrong for the live dataset.
**Working code:** `src/config/api-config.js` `mipsDataset =
'7adb8b1b-b85c-4ed3-b314-064776e50180'` — the "Quality Payment Program
Experience" data-api dataset (single rolling vintage, 503,917 rows verified).
Columns are lowercase with spaces (`final score`, `quality category score`,
`improvement activities (ia) category score`,
`promoting interoperability (pi) category score`, `cost category score`,
`participation option`, `reporting option`), all values strings, and there is
**no year column** — `cmsDataService` labels cached rows with the year the
caller requested (see `AGENTS.md`).

### 6. Cache shape mismatch (doc §4.4, §4.5)

The doc's `getCachedProvider`/`getCachedMipsData` return the raw `pg` row
(snake_case columns, extra fields, `sync_timestamp`) on a cache hit, while a
fresh API fetch returns the camelCase transformed object. Cache hit and cache
miss therefore produced **two different response shapes** for the same
endpoint.
**Working code:** `normalizeProviderRow` (npiService.js) and
`normalizeMipsRow` (cmsDataService.js) map DB rows back to the exact camelCase
API shape, and the test suite asserts byte-equality between fresh and
cache-hit responses.

## The two cache bugs the tests caught (commit 45acddb)

### 7. `sync_timestamp` dropped by the normalizers → cache never hit

The initial normalize functions built fresh objects without carrying
`sync_timestamp`; `isCacheExpired()` then always saw `undefined` and treated
every entry as expired, so **every request went upstream** and the DB cache
was write-only.
**Fix:** the normalized objects carry `sync_timestamp` as a
**non-enumerable** property — TTL checks work, and the timestamp never leaks
into JSON responses (asserted by tests).

### 8. Partial-column provider insert → cache hits silently lost data

The initial `cacheProvider` INSERT listed only a subset of columns, so
cache-hit responses were missing address line 2, phone, taxonomy grouping,
and the API's verbatim full name.
**Fix:** the insert now covers every schema column the transform produces,
and `providers` gained a `name_full` column (ALTER applied to the live DB and
added to `src/config/init.sql`).

## Additional divergences

- **Doc §6 analytics SQL is not executable as printed:** it uses `$0` as a
  bind parameter (PostgreSQL placeholders start at `$1`), and
  `json_agg(json_build_object('status', performance_status, 'count',
  status_count))` references a `status_count` column that is never selected.
  `src/services/analyticsService.js` implements the section's intent with
  valid SQL (placeholders from `$1`, aggregates computed with `FILTER`/`OVER`
  or in JS over fetched rows).
- **Doc §4.2 `mipsDatasets` per-year map** — superseded by the single rolling
  dataset (bug 5); `getMipsPerformance` no longer looks up a per-year ID.
- **Doc §10.2 rate limiting** uses `express-rate-limit`, which is **not in
  `package.json`** dependencies. `src/middleware/rateLimiter.js` implements
  the same factory interface (`rateLimiter({ windowMs, max })`) as an
  in-memory fixed-window limiter.
- **Care Compare column names** (doc §4.5 `transformQualityMeasuresResponse`)
  assumed human-readable names (`Facility ID`, `Measure ID`) from the data
  API. The provider-data datastore actually returns snake_case machine names
  (`facility_id`, `measure_id`, `compared_to_national`, ...); the transform
  was rewritten accordingly, plus defensive numeric coercion (scores can be
  footnote codes) and `MM/DD/YYYY` → ISO date normalization.
- **Doc §4.4 `getProviderByNpi` throws when the NPI is not found**, which
  surfaces as a 500. The controller's 404 branch exists but is unreachable
  for a genuine miss; current behavior for an unknown NPI is a 500
  (unchanged — noted here so the behavior is documented rather than
  accidental-looking).
