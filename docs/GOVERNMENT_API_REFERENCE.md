# Provider Intelligence Platform: Government API Reference

This document describes how the Node.js/Express backend of the Provider Intelligence Platform integrates three public government APIs:

- **A.** The CMS Quality Payment Program (QPP) Experience dataset on data.cms.gov
- **B.** The Care Compare provider-data datastore API on data.cms.gov
- **C.** The NIH Clinical Tables NPI API

Every claim below is grounded in live verification or official documentation. Anything not confirmed is explicitly marked **UNVERIFIED**. Source URLs are cited inline throughout.

---

## Section A: CMS QPP Experience dataset

### Overview

The QPP Experience dataset contains clinician-level MIPS participation data (practice characteristics, performance category scores, final score, payment adjustment). The dataset reports 503,917 rows, verified via its stats endpoint.

- Data endpoint: `https://data.cms.gov/data-api/v1/dataset/7adb8b1b-b85c-4ed3-b314-064776e50180/data`
- Stats endpoint: `https://data.cms.gov/data-api/v1/dataset/7adb8b1b-b85c-4ed3-b314-064776e50180/data/stats` returns `{"found_rows":503917,"total_rows":503917}` (verified)
- Catalog metadata: `https://data.cms.gov/data.json`. Note: the per-dataset metadata endpoint `.../dataset/{uuid}` returns 404 (verified).
- Official API Guide (PDF): https://data.cms.gov/sites/default/files/2024-10/7ef65521-65a4-41ed-b600-3a0011f8ec4b/API%20Guide%20Formatted%201_6.pdf

### Auth and keys

No API key is required for the verified endpoints above; responses are plain JSON arrays of objects.

### Schema notes

Column names are lowercase with spaces, and all values are strings. Examples of verified columns: `provider key`, `practice state or us territory`, `practice size`, `clinician type`, `clinician specialty`, `years in medicare`, `npi`, `participation option`, `mips value pathway id`, `medicare patients`, `allowed charges`, `services`, `opted into mips`, `small practice status`, `rural status`, `final score`, `payment adjustment percentage`, plus quality, promoting interoperability (pi), improvement activities (ia), and cost category fields with measure id/score slots (quality slots 1..12, pi slots 1..21, cost slots 1..28 per the column listing; exact per-row slot population is UNVERIFIED from only 2 observed rows).

### Query syntax

| Feature | Syntax | Notes |
|---|---|---|
| Page size | `size=5000` | Max 5000 per docs; behavior above 5000 is UNVERIFIED |
| Offset | `offset=0` | 0-based |
| Column selection | `column=npi,final%20score` | URL-encode spaces |
| Sort ascending | `sort=npi` | |
| Sort descending | `sort=-npi` | |
| Equality filter | `filter[npi]=1376745471` | Verified; also `filter[practice%20state%20or%20us%20territory]=TX` |
| Operator filter | `filter[condition][path]=<col>&filter[condition][operator]=CONTAINS&filter[condition][value]=X` | Verified form for operators |
| Full-text | `keyword=<text>` | Documented; UNVERIFIED on this dataset |
| Multi-condition groups | `filter[root-group][group][conjunction]=AND` plus `memberOf` | Documented; UNVERIFIED on this dataset |

Documented operators: `=`, `<>`, `>`, `>=`, `<`, `<=`, `STARTS_WITH`, `CONTAINS`, `ENDS_WITH`, `IN`, `NOT IN`, `BETWEEN`, `NOT BETWEEN`, `IS NULL`, `IS NOT NULL`.

**Gotcha (verified):** the naive form `filter[col][operator]=contains&filter[col][value]=ZZ` is silently ignored. Always use the `filter[condition][...]` form for operator filters. URLs are limited to 8192 characters.

### Verified request/response snippets

`GET .../data?size=2` returns:

```json
[{"provider key":"000000001","practice state or us territory":"NY","practice size":"4030","clinician type":"Doctor of Medicine","clinician specialty":"Physician/General Surgery","years in medicare":"11","npi":"1376745471","final score":"100","payment adjustment percentage":"1.05"}]
```

(fields truncated; real rows contain many more columns)

`GET .../data?size=2&offset=1&column=npi,final%20score&sort=-npi` returns:

```json
[{"npi":"1992999122","final score":"75"},{"npi":"1992998736","final score":"94.79"}]
```

`GET .../data/stats?filter[npi]=1376745471` returns:

```json
{"found_rows":2,"total_rows":503917}
```

The stats endpoint honors filters (verified).

### Express integration notes

**Field name mapping:** column keys contain spaces and parentheses, which are awkward in JS. Map them at the ingestion boundary:

```js
const QPP_FIELD_MAP = {
  'npi': 'npi',
  'practice state or us territory': 'practiceState',
  'final score': 'finalScore',
  'payment adjustment percentage': 'paymentAdjustmentPct',
  'clinician specialty': 'specialty',
  'clinician type': 'clinicianType',
  'years in medicare': 'yearsInMedicare',
};

function mapQppRow(row) {
  const out = {};
  for (const [cmsKey, value] of Object.entries(row)) {
    const key = QPP_FIELD_MAP[cmsKey] || cmsKey.replace(/ /g, '_');
    out[key] = value;
  }
  return out;
}
```

**Pagination strategy:** use `size`/`offset` paging with `size=5000`. Use `GET .../data/stats` (optionally with the same filters) to read `found_rows` up front and compute the page count. All values arrive as strings, so coerce numerics (`final score`, `allowed charges`, `medicare patients`) after mapping, treating empty strings as null.

```js
const PAGE = 5000;
async function fetchQppPage(offset, params = {}) {
  const qs = new URLSearchParams({ size: PAGE, offset, ...params });
  const res = await fetch(`${QPP_BASE}/data?${qs}`);
  if (!res.ok) throw new Error(`QPP API ${res.status}`);
  return (await res.json()).map(mapQppRow);
}
```

### Verification status (A)

| Claim | Status |
|---|---|
| Data endpoint returns JSON array of objects | Verified |
| 503,917 total rows via /data/stats | Verified |
| size/offset/column/sort (incl. `-col` desc) | Verified |
| `filter[col]=value` equality, stats honors filters | Verified |
| `filter[condition][path|operator|value]` operator form | Verified |
| Naive `filter[col][operator]` form silently ignored | Verified |
| .../dataset/{uuid} metadata returns 404; use data.json | Verified |
| Max size 5000 per docs | Documented; size>5000 behavior UNVERIFIED |
| keyword= full-text on this dataset | UNVERIFIED |
| Group/conjunction syntax on this dataset | UNVERIFIED |
| Data dictionary for this UUID | UNVERIFIED |
| Exact pi/cost measure slot counts per row | UNVERIFIED (from 2 observed rows) |

---

## Section B: Care Compare provider-data datastore API

### Overview

Care Compare (Medicare Compare) datasets are served through a DKAN-style datastore on data.cms.gov using short Socrata-style dataset IDs plus a trailing resource index (`/0`). Verified endpoints return an envelope with `results`, `count`, `schema`, and an echoed `query`.

- Query endpoint: `GET https://data.cms.gov/provider-data/api/1/datastore/query/{dataset-id}/{resource-index}`
- Metastore list: `GET https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items?page-size=N` (page-size parameter partially UNVERIFIED)
- Metastore item: `GET https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/{id}`

### Dataset IDs (theme: Hospitals)

| Dataset | ID |
|---|---|
| Complications and Deaths, Hospital | ynj2-r877 |
| Unplanned Hospital Visits, Hospital | 632h-zaca |
| Healthcare Associated Infections, Hospital | 77hc-ibv8 |
| Patient survey (HCAHPS), Hospital | dgck-syfz |
| Hospital General Information | xubh-q36u |
| Footnote Crosswalk | y9us-9xdf |
| HCAHPS National | 99ue-w85f |
| HCAHPS State | 84jm-wiui |
| HAI National | yd3s-jyhd |
| HAI State | k2ze-bqvw |

### Auth and keys

No API key required for the verified GET endpoints. Caveat (verified): raw curl requests without browser-like headers can be blocked by Akamai; send a browser-like `User-Agent` from the backend.

### Query syntax (GET)

| Feature | Syntax |
|---|---|
| Limit | `limit=5000` |
| Offset | `offset=0` |
| Condition | `conditions[0][property]=facility_id&conditions[0][value]=010001&conditions[0][operator]==` |
| Sort | `sorts[0][property]=measure_id&sorts[0][order]=asc` |

A DKAN 1.x standard POST variant with JSON body `{"limit","offset","conditions":[{"property","value","operator"}],"sorts":[{"property","order"}]}` on the same path exists per DKAN conventions but is **UNVERIFIED** by live request (Akamai blocked POSTs from the test sandbox).

Verified example:

```
GET https://data.cms.gov/provider-data/api/1/datastore/query/ynj2-r877/0?limit=1&conditions[0][property]=facility_id&conditions[0][value]=010001&conditions[0][operator]==&sorts[0][property]=measure_id&sorts[0][order]=asc
```

This narrowed the count from 95,800 rows to 20 (verified).

### Column sets

Measure datasets (e.g., Complications and Deaths) use: `facility_id`, `facility_name`, `address`, `citytown`, `state`, `zip_code`, `countyparish`, `telephone_number`, `measure_id`, `measure_name`, `compared_to_national`, `denominator`, `score`, `lower_estimate`, `higher_estimate`, `footnote`, `start_date`, `end_date`. Unplanned Hospital Visits adds `number_of_patients` and `number_of_patients_returned`. `compared_to_national` takes values like `"No Different Than the National Rate"`. HCAHPS instead uses `hcahps_measure_id`, `hcahps_question`, `hcahps_answer_description`, `patient_survey_star_rating`, per-field `_footnote` columns, and `hcahps_answer_percent` (no `compared_to_national`).

The Footnote Crosswalk (`y9us-9xdf`, 32 rows) has columns `footnote` and `footnote_text`; examples: 1 = "The number of cases/patients is too few to report.", 2 = "Data submitted were based on a sample of cases/patients.", 3 = "Results are based on a shorter time period than required."

### Verified response snippets

`GET .../datastore/query/ynj2-r877/0?limit=1`:

```json
{"results":[{"facility_id":"010001","facility_name":"SOUTHEAST HEALTH MEDICAL CENTER","measure_id":"COMP_HIP_KNEE","compared_to_national":"No Different Than the National Rate","denominator":"33","score":"3.8","footnote":"","start_date":"04/01/2023","end_date":"03/31/2025"}],"count":95800}
```

(truncated; envelope also includes `schema` with field types/descriptions and an echoed `query`)

`GET .../datastore/query/632h-zaca/0?limit=1`:

```json
{"results":[{"facility_id":"010001","measure_id":"EDAC_30_AMI","measure_name":"Hospital return days for heart attack patients","compared_to_national":"Average Days per 100 Discharges","score":"-2.6","number_of_patients":"235"}],"count":67060}
```

`GET .../datastore/query/y9us-9xdf/0?limit=3`:

```json
{"results":[{"footnote":"1","footnote_text":"The number of cases/patients is too few to report."}],"count":32}
```

### Express integration notes

**Field name mapping:** columns are already snake_case and JS-friendly, but all values are strings. Build a per-dataset numeric coercion list (for example `score`, `denominator`, `lower_estimate`, `higher_estimate`, `patient_survey_star_rating`, `hcahps_answer_percent`), and always join the footnote code through the Footnote Crosswalk to get human-readable text. HCAHPS needs a separate mapper because of its `hcahps_*` columns.

**Pagination strategy:** use `limit`/`offset` against `datastore/query`, reading `count` from the envelope to compute pages. Note the resource index suffix: iterate `/0`, `/1`, ... only if the metastore indicates multiple resources (typical verified case is `/0`).

```js
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; ProviderIntelligencePlatform/1.0)' };

async function queryCareCompare(datasetId, { limit = 5000, offset = 0, conditions = [], sorts = [] } = {}) {
  const qs = new URLSearchParams({ limit, offset });
  conditions.forEach((c, i) => {
    qs.set(`conditions[${i}][property]`, c.property);
    qs.set(`conditions[${i}][value]`, c.value);
    qs.set(`conditions[${i}][operator]`, c.operator || '=');
  });
  sorts.forEach((s, i) => {
    qs.set(`sorts[${i}][property]`, s.property);
    qs.set(`sorts[${i}][order]`, s.order);
  });
  const url = `https://data.cms.gov/provider-data/api/1/datastore/query/${datasetId}/0?${qs}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Care Compare API ${res.status}`);
  return res.json(); // { results, count, schema, query }
}
```

### Verification status (B)

| Claim | Status |
|---|---|
| GET datastore/query/{id}/0 with limit, offset, conditions, sorts | Verified |
| Envelope shape: results, count, schema, query echo | Verified |
| Condition on facility_id reduces count 95,800 to 20 | Verified |
| Dataset IDs listed above | Verified |
| Column sets incl. HCAHPS variant and Footnote Crosswalk (32 rows) | Verified |
| Metastore items endpoints | Verified (page-size param partially UNVERIFIED) |
| POST JSON query body (DKAN 1.x style) | UNVERIFIED (Akamai blocked sandbox POSTs) |
| Akamai blocking of non-browser User-Agents | Verified from sandbox; send browser-like UA |

---

## Section C: NIH Clinical Tables NPI API

### Overview

The NLM Clinical Tables service offers free, keyless lookup of NPPES NPI data, with separate APIs for individuals and organizations. Source: https://clinicaltables.nlm.nih.gov/

- Individuals: `GET https://clinicaltables.nlm.nih.gov/api/npi_idv/v3/search` (verified 200)
- Organizations: `GET https://clinicaltables.nlm.nih.gov/api/npi_org/v3/search` (verified 200)
- `npi_util` does not exist (verified 404)
- Docs: https://clinicaltables.nlm.nih.gov/apidoc/npi_idv/v3/doc.html and https://clinicaltables.nlm.nih.gov/apidoc/npi_org/v3/doc.html
- Demos: https://clinicaltables.nlm.nih.gov/demo.html?db=npi_idv and ?db=npi_org

### Auth and terms of use

Per the FAQ (https://clinicaltables.nlm.nih.gov/faq.html): the service is free of charge, requires no registration and no API key, and is provided "as is". The advised maximum request rate is 25 requests/second (a soft limit; the enforced limit may be higher; HTTP 503 is possible; regular users above roughly 50 req/s are asked to contact NLM). Contact NLM if usage is expected to exceed 50,000 calls/day. Data provenance: NPPES NPI data plus NUCC taxonomy plus the CMS taxonomy crosswalk.

### Query parameters

| Param | Meaning | Notes |
|---|---|---|
| terms | Search terms | Automatically wildcarded |
| q | Elasticsearch-style fielded query | Not wildcarded; `q=addr_practice.state:NY` verified |
| df | Display fields | Default: NPI, name.full, provider_type, addr_practice.full |
| ef | Extra fields | Supports `field:alias`; values are arrays or nested JSON |
| sf | Search fields | |
| cf | Record id field | Default NPI |
| maxList | Max results | Cap 500; empty defaults to 500 |
| count, offset | Pagination | offset + count limited to 7500 |

Response is a JSON array `[total, ids, extra, display]`. `total` is capped at 10,000.

### Field reference (npi_idv; npi_org analogous)

`NPI`, `name.full/first/last`, `name_other.*`, `provider_type`, `addr_practice.full/line1/line2/city/state/zip/phone/fax/country`, `addr_mailing.*`, `licenses` (a list; dotted access such as `licenses[0].lic_number`), `licenses.taxonomy.code/grouping/classification/specialization`, `licenses.medicare.*`.

Verified gotchas: top-level `lic_num_1`/`lic_state_1` return null (use `licenses` sub-fields); bare `taxonomy_code` returns null (use `licenses.taxonomy.code`).

### Verified snippets

`GET /api/npi_idv/v3/search?terms=Smith&maxList=3`:

```json
[10000,["1942278643","1932712585","1285479402"],null,[["SMITH, SMITH","1942278643","Physician/Internal Medicine","9912 LITTLE RD, NEW PORT RICHEY, FL 34654"]]]
```

(truncated to one display row)

`GET /api/npi_idv/v3/search?terms=1003000126&ef=addr_practice.line1,addr_practice.city,addr_practice.state,taxonomy_code,provider_type`:

```json
[1,["1003000126"],{"addr_practice.line1":["6410 ROCKLEDGE DR STE 304"],"addr_practice.city":["BETHESDA"],"addr_practice.state":["MD"],"taxonomy_code":[null],"provider_type":["Physician/Hospitalist"]},[["ENKESHAFI, ARDALAN","1003000126","Physician/Hospitalist","6410 ROCKLEDGE DR STE 304, BETHESDA, MD 20817"]]]
```

Note `taxonomy_code: [null]`, illustrating the gotcha above; request `licenses.taxonomy.code` instead.

### Express integration notes

**Field name mapping:** the response is positional, not object-shaped. Normalize `[total, ids, extra, display]` into objects immediately:

```js
async function searchNpi(terms, { org = false, maxList = 50, ef = [] } = {}) {
  const base = `https://clinicaltables.nlm.nih.gov/api/${org ? 'npi_org' : 'npi_idv'}/v3/search`;
  const qs = new URLSearchParams({ terms, maxList });
  if (ef.length) qs.set('ef', ef.join(','));
  const res = await fetch(`${base}?${qs}`);
  if (!res.ok) throw new Error(`NPI API ${res.status}`);
  const [total, ids, extra, display] = await res.json();
  return ids.map((npi, i) => ({
    npi,
    display: display?.[i] ?? null,
    extra: Object.fromEntries(
      Object.entries(extra ?? {}).map(([k, v]) => [k.replace(/\./g, '_'), Array.isArray(v) ? v[i] : v])
    ),
    total,
  }));
}
```

**Pagination strategy:** use `count`/`offset`, respecting the offset + count <= 7500 window and the 10,000 cap on `total`; deep paging is not possible, so narrow with `terms` or `q` instead. Enforce a client-side rate limiter at or below 25 requests/second and retry on 503 with backoff.

### Verification status (C)

| Claim | Status |
|---|---|
| npi_idv and npi_org v3 search endpoints return 200 | Verified |
| npi_util 404 | Verified |
| terms auto-wildcard, q fielded non-wildcard (state:NY verified) | Verified |
| Response shape [total, ids, extra, display]; total cap 10,000 | Verified |
| maxList cap 500; empty defaults to 500 | Verified |
| offset + count limit 7500 | Verified |
| licenses sub-field access; lic_num_1/lic_state_1 and bare taxonomy_code return null | Verified |
| Free, no key, "as is", 25 req/s soft limit, 50,000 calls/day contact threshold | Verified from FAQ |

---

## Cross-cutting notes

- **Bot filtering:** data.cms.gov sits behind Akamai. Non-browser User-Agents can be blocked (verified from a test sandbox), and POST requests were blocked outright there. Send a browser-like User-Agent header and prefer GET for the provider-data datastore.
- **String-typed values:** all three APIs return numeric-looking fields as strings (or as arrays of values, in the NPI API's `ef` payload). Centralize type coercion in the mapping layer; treat empty strings and `[null]` arrays as missing data.
- **Caching implications:** all three APIs are read-only public datasets that change infrequently (QPP and Care Compare update on CMS publication cycles). Aggressive response caching (hours to days) with ETag or TTL-based invalidation is appropriate, reduces exposure to the NLM 25 req/s soft limit, and mitigates transient Akamai/503 failures. Cache keys should include the full query string since filters materially change results.
- **Joining across sources:** NPI is the natural join key between the QPP dataset (column `npi`) and the NPI API (cf=NPI). Care Compare datasets key on `facility_id` (CCN), not NPI; bridging facilities to clinicians requires an additional crosswalk that is out of scope and UNVERIFIED here.
