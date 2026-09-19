# License Source Survey — US Medical License Status Data

Research only; no ingestion code. Supports open work item #2 in `docs/HANDOFF.md`
(add the license leg to `GET /providers/:npi/verification`).

Goal of the survey: identify **free, no-auth, machine-readable** sources of
license **status** (active / expired / disciplined, expiration date, license
type) per state, so we can decide what to ingest before building anything.

**Verification discipline:** every claim below is marked `verified live
YYYY-MM-DD` only if a URL or search result from that source was actually
fetched in this session (2026-09-17), otherwise `unverified`. Search-result
snippets from the official site are noted as `verified via official page in
search results`; treat those as weaker than a direct fetch.

---

## 1. NPPES (baseline — already ingested by this platform)

The NPI Registry API (NIH Clinical Tables, `npi_idv`) exposes a `licenses`
list per provider with `lic_number`, `lic_state`, and taxonomy info, but **no
status and no expiration date**.

Verified live 2026-09-17:

```
GET https://clinicaltables.nlm.nih.gov/api/npi_idv/v3/search?terms=1376745471&ef=licenses
→ {"licenses":[[{"taxonomy":{...},"lic_number":"323394","lic_state":"NY",
    "is_primary_taxonomy":"Y",...}, {..."lic_number":"0101239900","lic_state":"VA"...},
    {..."lic_number":"MD040834","lic_state":"DC"...}]]}
```

Facts:

- License fields live under `licenses` (a list). Top-level `lic_num_1` /
  `lic_state_1` return null; bare `taxonomy_code` returns null (already
  documented in `docs/GOVERNMENT_API_REFERENCE.md`, re-verified today).
- Available: license number, license state, taxonomy code/grouping/
  classification, whether it is the primary taxonomy. **Not available:
  status, expiration date, discipline, license type beyond taxonomy.**
- The NPPES dissemination file carries the same data (licenses are part of
  the NPPES record structure; `Other Identifiers` section is for non-NPI
  identifiers such as DEA/Medicaid numbers, not state licenses) — unverified
  against a fresh file in this session, but the API field set mirrors it.
- Data is self-reported by the provider at NPI enumeration/renewal and is
  frequently stale; useful as a baseline pointer ("this provider claims
  license X in state Y"), not as a status source.

Conclusion: NPPES gives us (npi → license number, state) candidates. Status
must come from elsewhere.

## 2. State licensing boards — 51-row survey

Categories: **bulk/api** = free, no-auth, machine-readable full download or
query API; **lookup-only** = free public web lookup, automatable only by
scraping (legally/technically fragile); **paid** = bulk sold by the board;
**none found**.

| State | Board/agency | Category | URL | Fields | Verified |
|---|---|---|---|---|---|
| AL | Board of Medical Examiners + ABN (nursing via Nursys) | lookup-only | https://www.alabama.gov/ (license search); https://www.abn.alabama.gov/licensing/verification/nursys/ | name, license no, status, expiration | lookup verified via official page in search results (ABN Nursys page) 2026-09-17; medical board lookup unverified |
| AK | State Medical Board (Division of Corporations, Business & Professional Licensing) | lookup-only | https://license.alaska.gov/ | name, license no, status, expiration | unverified |
| AZ | Arizona Medical Board / Board of Osteopathic Examiners | lookup-only | https://www.azmd.gov/ | name, license no, status, expiration, discipline | unverified |
| AR | Arkansas State Medical Board | lookup-only | https://www.armedicalboard.org/ | name, license no, status | unverified |
| CA | Medical Board of California / Osteopathic Medical Board (BreEZe/DCA) | lookup-only | https://search.dca.ca.gov/ | name, license no, type, status, expiration, addresses | unverified (widely documented free lookup; no bulk) |
| CO | Dept. of Regulatory Agencies (DORA) | **bulk/api** | https://data.colorado.gov/resource/7s5z-vewr.json (Socrata, keyless) | name, city/state/zip, license type, license number, first issue date, last renewed date, **expiration date, status description** | **verified live 2026-09-17** (sample row returned all fields above) |
| CT | Dept. of Public Health | lookup-only | https://elicense.ct.gov/ | name, license no, status, expiration | unverified |
| DE | Division of Professional Regulation | lookup-only | https://delaware.gov/ (DPR license search) | name, license no, status, expiration | unverified |
| DC | Dept. of Licensing & Consumer Protection (Board of Medicine) | lookup-only | https://dcra.dc.gov/ | name, license no, status, expiration | unverified |
| FL | Dept. of Health, Division of Medical Quality Assurance (MQA) | **bulk (free, account-gated)** + lookup | https://data-download.mqa.flhealthsource.gov/ (bulk portal, HTTP 200 verified live); https://mqa-internet.doh.state.fl.us/MQASearchServices/ (lookup) | name, license no, profession, status, expiration, discipline | portal verified live 2026-09-17 (200); lookup print view verified live (rendered practitioner-detail PDF); bulk download requires free MQA account per official/aggregator docs — unverified directly |
| GA | Georgia Composite Medical Board (SOS Professional Licensing) | lookup-only | https://verify.sos.ga.gov/ | name, license no, status | unverified |
| HI | Dept. of Commerce & Consumer Affairs (DCCA) | lookup-only | https://cca.hawaii.gov/ (license search) | name, license no, status, expiration | unverified |
| ID | Board of Medicine (BOM) | lookup-only | https://bom.idaho.gov/ | name, license no, status | unverified |
| IL | Division of Professional Regulation (IDFPR) | lookup-only | https://online-professional-license-search.p.illinois.gov/ | name, license no, status, expiration | unverified |
| IN | Professional Licensing Agency | lookup-only | https://mylicense.in.gov/ | name, license no, status, expiration | unverified |
| IA | Board of Medicine | lookup-only | https://medicine.iowa.gov/ (license search) | name, license no, status | unverified |
| KS | Board of Healing Arts | lookup-only | https://www.ksbha.org/ | name, license no, status, expiration | unverified |
| KY | Board of Medical Licensure | lookup-only | https://kbml.ky.gov/ | name, license no, status | unverified |
| LA | State Board of Medical Examiners | lookup-only | https://www.lsbme.la.gov/ | name, license no, status | unverified |
| ME | Board of Licensure in Medicine | lookup-only | https://www.maine.gov/ (professional license search) | name, license no, status, expiration | unverified |
| MD | Board of Physicians | lookup-only | https://www.mbp.md.gov/ | name, license no, status | unverified |
| MA | Board of Registration in Medicine | lookup-only | https://www.mass.gov/ (license check) | name, license no, status (incl. restricted), expiration | lookup documented via official mass.gov user guide found in search results 2026-09-17; endpoint unverified |
| MI | Bureau of Professional Licensing (LARA) | lookup-only | https://www.michigan.gov/ (license lookup) | name, license no, status, expiration | unverified |
| MN | Board of Medical Practice | lookup-only | https://mn.gov/ (license lookup) | name, license no, status | unverified |
| MS | State Board of Medical Licensure | **paid** bulk ($300) + lookup | https://www.msbml.ms.gov/Verification | "Electronic Database Download $300 plus convenience fee… complete list of currently licensed physicians" | verified via official page in search results 2026-09-17; price/fields not fetched |
| MO | Board of Registration for the Healing Arts | lookup-only | https://pr.mo.gov/ | name, license no, status | unverified |
| MT | Board of Medical Examiners (DOLI) | lookup-only | https://dli.mt.gov/ | name, license no, status | unverified |
| NE | DHHS Licensure Unit | lookup-only | https://dhhs.ne.gov/ | name, license no, status | unverified |
| NV | State Board of Medical Examiners / Osteopathic Medicine | lookup-only | https://leg.state.nv.us/ (license lookup) | name, license no, status | unverified |
| NH | Office of Professional Licensure & Certification | lookup-only | https://www.oplc.nh.gov/ | name, license no, status, expiration | unverified |
| NJ | Division of Consumer Affairs | lookup-only | https://www.njconsumeraffairs.gov/ | name, license no, status, expiration | unverified |
| NM | Medical Board | lookup-only | https://www.nmmb.state.nm.us/ | name, license no, status | unverified |
| NY | Office of the Professions (NYSED) | lookup-only | https://www.op.nysed.gov/opsearches.htm (301 → HTTPS, verified live 2026-09-17); health.data.ny.gov has *Board Actions* dataset (discipline only: license no, action, date — verified via official dataset page in search results 2026-09-17), no active-licensure bulk found | name, profession, license no, date of licensure, status, expiration/registration | lookup endpoint responds (verified live 2026-09-17); fields per official OP pages; no free bulk found |
| NC | Medical Board | lookup-only | https://www.ncmedboard.org/ | name, license no, status | unverified |
| ND | State Board of Medical Examiners | lookup-only | https://www.ndbomex.org/ | name, license no, status | unverified |
| OH | State Medical Board (eLicense) + DataOhio | **bulk/api (CSV)** + lookup | https://data.ohio.gov/wps/portal/gov/data/view/state-of-ohio-licensure ("State of Ohio Licensure – Individual", CSV download, 24 agencies) | professional license records incl. license number, status | existence verified via official page in search results 2026-09-17; direct portal URL returned 404 today — link rot, dataset likely relocated; **endpoint unverified** |
| OK | Medical Board | lookup-only | https://www.okmedicalboard.org/ | name, license no, status | unverified |
| OR | Medical Board | lookup-only | https://www.oregon.gov/omb/ | name, license no, status | unverified |
| PA | Dept. of State — Bureau of Professional & Occupational Affairs | lookup-only | https://www.pals.pa.gov/ | name, license no, status, expiration | unverified |
| RI | Dept. of Health (RIDOH license lookup) | lookup-only | https://health.ri.gov/ | name, license no, status | unverified |
| SC | LLR — Board of Medical Examiners | lookup-only | https://verify.llr.sc.gov/ | name, license no, status, expiration | unverified |
| SD | Board of Medical & Osteopathic Examiners | lookup-only | https://doh.sd.gov/ | name, license no, status | unverified |
| TN | Board of Medical Examiners / Dept. of Health | lookup-only | https://www.tn.gov/ (license verification) | name, license no, status, expiration | unverified |
| TX | Texas Medical Board | **bulk/api** | https://data.texas.gov/resource/tm3v-pfq9.json (Socrata, keyless); dataset page https://data.texas.gov/dataset/DataSet-01-All-Licenses/tm3v-pfq9 | license type, name, DOB, **license number, issue date, expiration date, registration status + status date, disciplinary status, license status, currently-licensed flag** | **verified live 2026-09-17** (sample row returned all fields above) |
| UT | Division of Professional Licensing (DOPL) | lookup-only | https://dopl.utah.gov/ | name, license no, status, expiration | unverified |
| VT | Office of Professional Regulation | lookup-only | https://secure.professional.vermont.gov/ | name, license no, status, expiration | unverified |
| VA | Dept. of Health Professions | lookup-only | https://www.dhp.virginia.gov/ | name, license no, status, expiration | unverified |
| WA | Medical Commission | lookup-only | https://dobsearch.wa.gov/ | name, license no, status, expiration | unverified |
| WV | Board of Medicine | lookup-only | https://www.wvbom.wv.gov/ | name, license no, status | unverified |
| WI | Medical Examining Board (DSPS) | lookup-only | https://apps.dpi.wi.gov/ (DSPS license lookup) | name, license no, status, expiration | unverified |
| WY | Board of Medicine | lookup-only | https://wyomedboard.wyo.gov/ | name, license no, status | unverified |

Notes on the table:

- **Deep-dives actually executed this session (5+):** TX Socrata API (live
  JSON row), CO Socrata API (live JSON row), FL bulk portal (HTTP 200) + FL
  lookup print view (live PDF render), NY OP search page (301 → HTTPS),
  Nursys QuickConfirm page (302 → login-gated search form), NPPES `licenses`
  field (live JSON).
- Most states use one of a handful of lookup vendors (Accela/LaGov/permit
  search, eLicense, BreEZe, PALS). A shared vendor means a generic scraper
  may cover many states, but scraping is fragile and its ToS was **not**
  surveyed here — flagged for legal review before any scraping build.
- Mississippi explicitly sells its full physician list ($300) — lookup-only
  for free automation.
- Ohio and DC have open-data programs likely to carry licensure data (Ohio's
  "State of Ohio Licensure – Individual" CSV was found in search results but
  the portal URL 404'd today — needs relocation). DC open data unverified.

## 3. Nursys (nursing licenses)

- Nursys QuickConfirm is a **free public web lookup** (name, jurisdiction,
  license type, number, compact status, active flag, original issue date,
  expiration date, discipline) covering participating boards of nursing —
  effectively all US jurisdictions for RN/LPN/APRN; CNAs are **not** covered.
  (Verified via Nursys/NCBSN FAQ pages in search results 2026-09-17; the
  search form endpoint `https://www.nursys.com/LQCFolder/LQCSearch.aspx`
  responds (302) live 2026-09-17.)
- **No free bulk/API.** The free components are per-lookup and/or the e-Notify
  push service (requires enrollment — per-nurse consent, not usable for
  screening a roster). Bulk/commercial access is the **paid QuickConfirm**
  product (per-verification pricing).
- Automation options: (a) screen-scrape QuickConfirm per nurse — fragile,
  ToS not reviewed; (b) fall back to each state's board-of-nursing lookup or
  bulk file where it exists (TX, CO, FL, OH datasets above include nursing
  license types).
- Conclusion: nursing licenses are automatable per-state, not via a single
  free national feed.

## 4. FSMB / Federation of State Medical Boards

- **Physician Data Center (PDC) is paid-only** for organizations (per-profile
  lookups / API integrations, e.g. the Modio integration). No free public
  query of PDC.
- FCVS (Federation Credentials Verification Service) is a **paid** service
  ($395 initial per the FSMB fee page found in search results 2026-09-17) for
  individuals obtaining verified credential portfolios; not a status feed.
- The one free FSMB artifact is the annual FSMB Census of actively licensed
  physicians (aggregate counts by state/specialty/age) — useful as a coverage
  benchmark, not per-provider status.
- Conclusion: FSMB is a **paid aggregator**; not usable under this platform's
  "no paid feeds" constraint.

## 5. Federal aggregators (CMS / HRSA)

No federal source publishes per-provider medical **license status**. Verified
by this session's searches plus the platform's existing API reference:

- **NPPES** (NIH/CMS HHS): license number + state only, self-reported, no
  status — see §1.
- **Care Compare / QPP datasets** (this platform already integrates both):
  no license fields at all (`docs/GOVERNMENT_API_REFERENCE.md`).
- **Medicare Data on Provider Practice Specialty**: derived from NPPES
  taxonomy; no license status (unverified this session; consistent with the
  NPPES field set).
- **IQIES / Provider Enrollment (PECOS)**: Medicare enrollment, not state
  licensure; public datasets (e.g. the HHS open-data "Medicaid Provider
  Enrollment" catalog listing found in search results 2026-09-17) do not
  include state license status.
- **NPDB**: adverse actions only, and access is restricted/paid — not usable.
- Conclusion: there is no federal license-status leg to stand on; the gap must
  be closed state by state.

---

## Summary counts

- **Bulk/API, free, verified live this session: 2** (TX, CO) — plus FL's
  account-gated free bulk portal (HTTP 200 verified; account requirement not
  independently verified).
- **Bulk found but endpoint not re-verified: 1** (OH — portal link rot).
- **Paid bulk: 1** (MS $300; plus FSMB PDC nationally).
- **Lookup-only (free public search, no bulk): the remaining ~46 states + DC.**
- **None found: 0** — every state has at least a free public lookup.

## Best 5 concrete sources (verified endpoints)

1. **Texas Medical Board — data.texas.gov Socrata** `https://data.texas.gov/resource/tm3v-pfq9.json` — free, keyless, SoQL-queryable, all license types, includes `license_status`, `registration_status`, `disciplinary_status`, `license_expiration_date`, `currently_licensed`. Verified live 2026-09-17.
2. **Colorado DORA — data.colorado.gov Socrata** `https://data.colorado.gov/resource/7s5z-vewr.json` — free, keyless, includes `licensetype`, `licensenumber`, `licenseexpirationdate`, `licensestatusdescription`, `licensefirstissuedate`, `licenselastreneweddate`. Verified live 2026-09-17.
3. **Florida MQA bulk portal** `https://data-download.mqa.flhealthsource.gov/` — all ~200 MQA professions incl. MD/DO/PA/RN/APRN, daily refresh; free account required per docs. Portal responds (200); download flow unverified. Complement with the live lookup service at `mqa-internet.doh.state.fl.us/MQASearchServices` (verified rendering).
4. **NPPES/NPI API `licenses` field** (already in-platform) — gives (npi, license number, state) candidates to match against state files; no status. Verified live 2026-09-17.
5. **New York Office of the Professions lookup** `https://www.op.nysed.gov/opsearches.htm` (responds; HTTPS redirect verified live) + `health.data.ny.gov` Professional Medical Conduct Board Actions dataset (discipline, Socrata-style) — good discipline leg; status is lookup-only.

## Recommended phased ingestion plan

- **Phase 0 (baseline, no new feeds):** persist NPPES `licenses`
  (number + state) from the already-ingested dissemination file / NPI API as
  the candidate license set per provider. Honest dossier leg: "claimed
  licenses, unverified status."
- **Phase 1 (bulk, free, keyless — build first):** TX + CO Socrata feeds.
  Same Socrata protocol as data.texas.gov patterns already known; join on
  (license number, state). Expected coverage: high, since these two states
  are among the largest physician populations.

**Phase 1 status: BUILT 2026-09-18.** `license_status` table
(`src/config/migrations/20260918_license_status.sql`), loader
`tools/license-status-ingest.js` (Socrata `$limit`/`$offset` pagination,
TRUNCATE + reload per state, parsed vs inserted vs table count
self-verification, `--dry-run` and `--source tx|co`), and the verification
dossier now attaches a `verified` block per matched license
(`src/controllers/providerController.js`). Column names re-verified by
direct fetch 2026-09-18:

- TX `tm3v-pfq9`: `license_type`, `first_name`, `last_name`,
  `year_of_birth`, `license_number`, `license_issue_date`,
  `license_expiration_date`, `registration_status`,
  `registration_status_date`, `disciplinary_status`, `license_status`,
  `degree`, `practice_address`/`practice_city`/`practice_state`/
  `practice_zip`, `currently_licensed`. Note: TX `license_number` arrives
  as a plain string; leading zeros matter, load as TEXT.
- CO `7s5z-vewr`: `lastname`, `firstname`, `middlename`, `city`, `state`,
  `mailzipcode`, `licensetype`, `licensenumber`,
  `licensefirstissuedate`, `licenselastreneweddate`,
  `licenseexpirationdate`, `licensestatusdescription`,
  `linktoverifylicense`, `linktoviewhealthcareprofile`. No separate status
  date is published; `licenselastreneweddate` is used as `status_date`.
- **Phase 2 (bulk, free w/ account):** FL MQA portal (register free account,
  verify download flow), then re-locate and ingest the Ohio DataOhio
  licensure CSV once its relocated URL is confirmed.
- **Phase 3 (lookup augmentation, per-provider):** for the remaining states,
  augment status via official lookups only where a roster provider actually
  holds a license in that state (join from Phase 0 candidates). Do **not**
  bulk-scrape; review ToS/robots per board first. Prioritize the
  largest-license-count states.
- **Phase 4 (discipline signal):** ingest free discipline datasets where they
  exist as structured data (NY health.data.ny.gov board actions; TX
  `disciplinary_status` already in the feed; FL discipline extracts).
- **Out of scope under current constraints:** FSMB PDC and MS paid list (paid),
  Nursys bulk (paid; nursing only), and any federal aggregator (none exists).

## Open questions / follow-ups

- Ohio DataOhio dataset relocation URL (portal 404 today).
- Florida MQA bulk account requirement — verify by registering.
- Scraping ToS for the top ~10 lookup-only states (CA, NY, PA, WA, IL, MI,
  NJ, GA, VA, NC) if Phase 3 proceeds.
- Whether the NPPES dissemination file's license rows differ from the NPI
  API's `licenses` field set (re-check against a fresh monthly file).
