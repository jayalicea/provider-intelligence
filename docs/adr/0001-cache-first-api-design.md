# ADR 0001: Cache-first API design, with upstream fetch on miss

- Status: accepted
- Date: 2026-09-13 (recording a decision taken during the initial backend build)
- Applies to: `src/services/npiService.js`, `src/services/cmsDataService.js`,
  `src/config/init.sql`

## Context

The platform sits in front of three free public government APIs: the NIH
Clinical Tables NPI registry, the CMS QPP Experience dataset on the
data.cms.gov data-api, and the CMS Care Compare provider-data datastore. The
obvious design is a live passthrough: take a request, call upstream, transform,
return. `phynpi.md` describes roughly that.

Building the real backend against the real APIs produced six live-verification
bugs, all recorded in [CORRECTIONS.md](../../CORRECTIONS.md) (repository root,
not under `docs/`). They are worth restating here because collectively they are
the argument against passthrough:

1. **Controller binding.** Registering `controller.searchProviders` as a bare
   method reference loses `this`, so `this.npiService` is `undefined` and every
   request throws. Routes now bind through a `bound()` helper.
2. **Wrong NPI endpoint.** `/npi_ind/v3/search` does not exist (verified 404).
   The individual-provider endpoint is `/npi_idv/v3/search`.
3. **Response envelope handling.** The NPI API does not return an array of
   provider objects. It returns a four-element positional envelope
   `[total, ids, extraFields, displayRows]`, where `extraFields` is a map of
   dotted path to parallel array and each display row is a positional
   `[name, NPI, provider_type, address]` whose first-two field order varies.
4. **`enumeration_type` constraint.** The design doc caches
   `provider_type` (a specialty string such as `"Physician/Internal Medicine"`)
   into a column whose CHECK constraint allows only `Individual` or
   `Organization`, so every insert violates the constraint.
5. **Dead MIPS dataset ID.** The per-performance-year dataset IDs
   (`py2023: 'a174-a962'` and friends) no longer resolve through the data API.
   The live path is the single rolling "Quality Payment Program Experience"
   dataset `7adb8b1b-b85c-4ed3-b314-064776e50180`, whose columns are lowercase
   with spaces, whose values are all strings, and which has no year column at
   all.
6. **Cache shape mismatch.** Returning the raw `pg` row on a cache hit and the
   transformed camelCase object on a miss gives the same endpoint two different
   response shapes.

Read together, bugs 2 through 5 say the same thing: these upstreams are not
stable, self-describing, or well-documented. Endpoint paths in the vendor's own
docs are wrong, response shapes are positional rather than keyed, dataset
identifiers rot, and every numeric value arrives as a string that may in fact
be a footnote code. Bug 6 says the thing that matters about caching: if a cache
exists at all, the two paths through it must be provably identical.

Separately, the upstreams impose real limits, documented in
[GOVERNMENT_API_REFERENCE.md](../GOVERNMENT_API_REFERENCE.md): the NLM service
advises a soft ceiling of 25 requests per second and asks heavy users to make
contact above 50,000 calls per day; `offset + count` is capped at 7,500 and
`total` at 10,000, so deep paging is impossible; data.cms.gov sits behind Akamai,
which blocks non-browser user agents and blocked POST outright from a test
sandbox; and 503s are expected rather than exceptional.

## Decision

Every read endpoint is served **cache-first from PostgreSQL, with an upstream
fetch only on a miss or an expired row**, and the fetched result is normalized
and written back to the cache before it is returned.

Concretely:

- `getProviderByNpi` reads `providers`, returns the cached row if
  `isCacheExpired` says no, and otherwise calls `/npi_idv/v3/search`,
  transforms the positional envelope, caches, and returns.
- `getMipsPerformance` and `getQualityMeasures` follow the same shape against
  `mips_performance_scores` and `quality_measures`.
- TTLs are per-source and set by how fast the source actually changes:
  **24 hours for NPI identity** (`npiService.isCacheExpired`) and **1 hour for
  MIPS performance** (`cmsDataService.isCacheExpired`). Identity moves on
  NPPES's monthly cadence; the MIPS shorter TTL is a hedge against CMS
  re-basing its single rolling vintage in place.
- The cache row's `sync_timestamp` is the only TTL input. It is attached to
  normalized objects as a **non-enumerable** property so TTL checks work while
  the timestamp never leaks into a JSON response.
- `normalizeProviderRow` and `normalizeMipsRow` map database rows back to the
  exact camelCase shape the upstream transform produces, and the test suite
  asserts equality between a fresh fetch and a cache hit.

Rejected alternative: **live passthrough with an in-process TTL map**. It keeps
no durable record, so every process restart re-exposes the platform to the full
upstream failure surface; it cannot serve a request when the upstream is down or
rate-limiting; and it makes the joined products (cohort, roster screening,
analytics) impossible, because they need to query across providers rather than
fetch them one at a time.

Rejected alternative: **scheduled full mirror of everything, no upstream reads
at request time**. Correct for the bulk datasets, which is exactly what
[ADR 0002](0002-file-based-leie-pipeline.md) and
[ADR 0003](0003-jsonb-populate-recordset-loaders.md) describe, but wrong for
Care Compare and QPP, where there is no bulk file to mirror through the data
API and coverage should follow demand.

## Consequences

**What this buys.**

- The messy upstream shape is normalized at exactly one boundary. Bugs 3 and 5
  are contained in `transformNpiResponse` and `transformMipsResponse` rather
  than being re-derived by every consumer.
- Upstream rate limits and Akamai blocking degrade a first request, not every
  request. A cached provider stays servable while the NLM service returns 503.
- SQL joins across cached providers, MIPS rows and exclusion tables become
  possible, which is what the cohort, watchlist and roster-screening features
  are built on.
- Provenance has somewhere to live. The `as_of`/`sync_timestamp` columns are
  what `DESIGN.md`'s provenance rule renders under every value.

**What this costs.**

- **Two code paths per endpoint that must not diverge.** This is bug 6, and it
  is permanent, not a one-off. The mitigation is the normalizer pair plus the
  byte-equality tests; any new cached field has to be added in three places
  (transform, insert, normalize) or a cache hit silently returns less than a
  miss. Bug 8 in CORRECTIONS.md is exactly that failure: a partial-column
  insert dropped address line 2, phone, taxonomy grouping and the verbatim full
  name from every cache hit.
- **TTL bugs are silent.** Bug 7 is the other side: the normalizers initially
  dropped `sync_timestamp`, `isCacheExpired` therefore saw `undefined` and
  treated every row as expired, and the cache became write-only. Nothing failed
  loudly; the platform simply paid full upstream cost on every request. The
  non-enumerable `sync_timestamp` and its tests exist because of this.
- **Stale reads are now possible by design.** A provider deactivated upstream
  can be served from cache for up to 24 hours. The product answer is not to
  shorten the TTL but to show the access date with every value and to say so in
  the disclaimer panel; the platform reports what a source published as of a
  date, and never certifies current truth.
- **The cache is a trust boundary.** Anything that can write a cache row can
  make the platform serve attacker-controlled data as authoritative CMS data.
  This is why `SECURITY_REVIEW.md` ranks the unauthenticated
  `POST /providers/bulk-data` endpoint as the single highest design risk, and
  why bulk loading is deliberately an offline job rather than an HTTP endpoint
  (ADR 0002).
- **A cache miss is slower than a passthrough**, because it pays the upstream
  latency plus an insert. Accepted: misses are the minority and the insert is
  what makes the next thousand reads cheap.
