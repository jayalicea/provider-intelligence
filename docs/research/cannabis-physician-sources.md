# Cannabis certifying-physician list sources — expansion survey

Scope: which US states (and DC) with legal medical cannabis programs publish a
list of registered / certifying / recommending physicians (or practitioners)
that is **free** and at least partially machine-readable. Purpose: expansion
order for the Florida OMMU Qualified Physician List ingest.

> **Florida is covered separately by the ingest build** (weekly Qualified
> Physician List PDF, license-number keyed, from
> https://knowthefactsmmj.com/physicians/list/, verified 2026-09-19). Florida
> facts are repeated briefly below for completeness; this document surveys the
> other 50 jurisdictions.

## Expansion states survey

Categories:

- **bulk/api** — free structured download or API (best for ingest).
- **document** — downloadable file (PDF/Excel/HTML roster) like Florida.
- **lookup-only** — interactive web search/list; no file download.
- **none-published** — program exists, but the practitioner list is not public
  (often confirmed by an official agency statement).
- **no-program** — no operational medical cannabis program (see grouped line).

Verification discipline: `2026-09-19` means the source was fetched live that
day (format/fields/cadence confirmed). `unverified` means the row rests on
search-result snippets and official pages seen but not fetched; no URLs below
were invented. Everything here is free; no list found behind login or payment.

| State | Program agency | Category | URL | Fields | Cadence | Verified |
|---|---|---|---|---|---|---|
| AL | Alabama Medical Cannabis Commission (AMCC) | document (PDF) | https://amcc.alabama.gov/wp-content/uploads/2026/09/AMCC-Registered-Certifying-Physicians.pdf | Physician name, degree (MD/DO), specialty, office address, city, county, phone, registration expiration date. **No license # / NPI.** | PDF states "Current as of" date (9/18/2026 on check); uploads under monthly folder (2026/09) | 2026-09-19 |
| AK | AK Dept. of Commerce — Alcohol & Marijuana Control Office | none-published | — | No state certifier registry; any AK-licensed physician may certify. | — | unverified |
| AZ | Arizona Dept. of Health Services | none-published | — | No ADHS list of certifying physicians surfaced (two searches). | — | unverified |
| AR | Arkansas Dept. of Health | none-published | https://healthy.arkansas.gov/programs-services/data-statistics-registries/medical-marijuana/faqs/ | ADH FAQ: department does not recommend physicians; no list published. | — | unverified |
| CA | CA Dept. of Public Health — MMICP | none-published | https://www.cdph.ca.gov/Programs/CHSI/Pages/MMICP-FAQs.aspx | CDPH FAQ: "The state MMICP does not maintain lists of physicians, nor is it a referral service." No state registry of recommending physicians. | — | 2026-09-19 |
| CO | CO Dept. of Public Health & Environment — Medical Marijuana Registry | none-published | https://cdphe.colorado.gov/medical-marijuana-registry-providers | CDPHE page covers provider self-registration only; no public roster of certifying providers. | — | 2026-09-19 |
| CT | CT Dept. of Consumer Protection — Medical Marijuana Program | none-published | — | No DCP certifying-physician list surfaced. | — | unverified |
| DE | DE Dept. of Health & Social Services | none-published | — | No DHSS practitioner list surfaced. | — | unverified |
| DC | DC Alcoholic Beverage and Cannabis Administration (ABCA) | document (XLSX + PDF) | https://abca.dc.gov/publication/medical-cannabis-program-registered-healthcare-practitioners | Last name, first name, MI, **DC medical license number** (e.g. MD037500), provider type (Physician/APRN/PA), practice name, address (split fields), phone. | ABCA: "Updates to the roster are made biannually." Latest attachments: XLSX Aug 2023, PDF July 2024 (stale). | 2026-09-19 |
| FL | FL Dept. of Health — Office of Medical Marijuana Use | document (weekly PDF) — **baseline, built** | https://knowthefactsmmj.com/physicians/list/ | Physician name, license number (keyed), practice info (per ingest build). | Weekly PDF. | 2026-09-19 |
| GA | GA Dept. of Public Health Low THC Oil Registry / GA Access to Medical Cannabis Commission | lookup-only? | https://georgiacannabis.org/ | Third-party sources point patients to DPH to "find a registered physician," but no list URL could be confirmed (commission site 403s to bots). | — | unverified |
| HI | Hawaii Dept. of Health — Medical Cannabis Registry Program | document (HTML roster) | https://health.hawaii.gov/medicalcannabisregistry/find-a-medical-provider/ | Self-reported "Medical Provider Contact List" embedded on page (~12 providers with phone numbers at check). No license #. | No stated cadence; email-to-update. | 2026-09-19 |
| ID | — | no-program | — | See grouped line below. | — | unverified |
| IL | IL Dept. of Public Health — Medical Cannabis Patient Program | none-published | https://dph.illinois.gov/content/dam/soi/en/web/idph/files/publications/publicationsmcpppatientbrochure.pdf | Physician writes certification; no IDPH certifying-physician roster surfaced. | — | unverified |
| IN | — | no-program (CBD only) | — | See grouped line below. | — | unverified |
| IA | Iowa HHS — Bureau of Cannabis Regulation (Medical Cannabidiol, low-THC) | none-published | — | Practitioner signs written certification; no public list surfaced. | — | unverified |
| KS | — | no-program | — | See grouped line below. | — | unverified |
| KY | Kentucky Office of Medical Cannabis | lookup-only | https://kymedcan.ky.gov/patients-and-caregivers/Pages/find-a-practitioner.aspx | "Authorized Practitioner Directory": searchable list of practitioners authorized to certify, with contact info, address, specialty; search by city/county/ZIP/specialty. | Directory tool; no stated cadence. | 2026-09-19 |
| LA | Louisiana Dept. of Health — Cannabis Program | none-published | https://ldh.la.gov/bureau-of-sanitarian-services/medical-marijuana | LDH: "No state agency maintains a list or directory of clinicians recommending marijuana to patients presently." LSBME no longer tracks them either. | — | 2026-09-19 |
| ME | Maine Office of Cannabis Policy | none-published | — | Written-certification model; no certifier list surfaced. | — | unverified |
| MD | Maryland Cannabis Administration (MCA) | lookup-only | https://cannabis.maryland.gov/pages/medical_cannabis.aspx (Find a Provider → https://onestop.md.gov/list_views/601c0fdaf9d7557af267e291) | "Find a Provider" roster of MCA-registered certifying providers rendered in Maryland OneStop portal (JS app; returned 204/403 to plain curl — needs headless scrape). | Live system; no stated cadence. | 2026-09-19 |
| MA | MA Cannabis Control Commission — Medical Use of Marijuana Program | none-published | https://www.mass.gov/doc/health-care-provider-step-by-step-registration-information/download | CCC registers certifying healthcare providers; no public roster surfaced (third parties, e.g. MPAA, maintain their own lists). | — | unverified |
| MI | MI Cannabis Regulatory Agency | none-published | https://www.michigan.gov/cra | Any MI-licensed MD/DO may certify; no physician roster (CRA "Verify a License" covers facilities/businesses). | — | unverified |
| MN | MN Office of Cannabis Management — Division of Medical Cannabis | none-published | https://mn.gov/ocm/dmc/data-reports/data-projects/weekly-updates.jsp | Only **aggregate weekly counts** of registered certifying practitioners (e.g. 2,845) — no names. Patients locate practitioners themselves. | Weekly (Fridays) aggregate data. | unverified |
| MS | MS Dept. of Health — Medical Cannabis Program (MMCP) | none-published | https://msdh.ms.gov/page/30,0,425.html | Practitioners register in MMCP portal; no public list surfaced. | — | unverified |
| MO | MO Dept. of Health & Senior Services — Division of Cannabis Regulation | none-published | https://health.mo.gov/safety/cannabis/tutorials/pdf/tutorial-16-508.pdf | Certifying physician/NP registration exists (free, portal-based); no public roster surfaced. | — | unverified |
| MT | MT Dept. of Revenue — Cannabis & Alcohol Regulation Division | none-published | https://revenue.mt.gov/card/cannabis/physician-information | DOR: "does not offer advice or maintain a list of specific physicians." Any licensed MD/DO may sign. | — | 2026-09-19 |
| NE | — | no-program (not yet operational) | — | See grouped line below. | — | unverified |
| NV | NV Div. of Public & Behavioral Health (DHHS) | none-published | — | Attending-physician statement model; no certifier list surfaced. | — | unverified |
| NH | NH DHHS — Therapeutic Cannabis Program | none-published | https://www.dhhs.nh.gov/programs-services/population-health/therapeutic-cannabis | Program materials: "There is not a public list of medical providers who participate in the Program." | — | unverified |
| NJ | NJ Cannabis Regulatory Commission — Medicinal Cannabis Program | lookup-only | https://www.nj.gov/cannabis/medicinalcannabis/find-provider | "Find a Provider" web tool; program FAQ states "A public list of already participating practitioners is available." Tool is JS-driven (page shell only in raw HTML). | Live tool; no stated cadence. | 2026-09-19 |
| NM | NM Dept. of Health — Medical Cannabis Program | none-published | https://www.nmhealth.org/about/mcpp/mcp/hpp/ | Practitioner certification model; no public practitioner list surfaced. | — | unverified |
| NY | NY Office of Cannabis Management / NY Dept. of Health | **bulk/api** (Socrata dataset) | https://www.health.ny.gov/regulations/medical_marijuana_practitioner_list/ → https://data.ny.gov/d/gegk-4ghy | "Public List of Consenting Medical Cannabis Program Practitioners" — certifying providers who consented to public listing, published as data.ny.gov Socrata dataset gegk-4ghy. Schema not confirmed: 2026-09-20 retry: data.ny.gov host live, but the dataset page and resource endpoint both 404 (`dataset.missing`); the Socrata catalog still indexes it, so it is retired/broken rather than moved — no successor dataset located. | Rolling dataset (Socrata) — currently unavailable. | 2026-09-20 (host live; dataset 404, schema unconfirmed) |
| NC | — | no-program | — | See grouped line below. | — | unverified |
| ND | ND Dept. of Health & Human Services | none-published | https://www.ndhealth.gov/ | No certifying-practitioner list surfaced. | — | unverified |
| OH | State Medical Board of Ohio / OMMCP | lookup-only | https://med.ohio.gov/for-the-public/medical-marijuana | "Find a CTR Physician" interactive search (physicians holding Certificate to Recommend). | Live search; no stated cadence. | 2026-09-19 |
| OK | Oklahoma Medical Marijuana Authority (OMMA) | document (PDF) | https://oklahoma.gov/content/dam/ok/en/omma/forms/Registered%20Physicians.pdf | First name, last name, type (MD/DO), practice, address, phone. **No license # / NPI.** Opt-in list (SB 1066 registration required since 2026-01-01). | New program; no stated cadence. HTTP Last-Modified 2026-09-09 at check. | 2026-09-19 |
| OR | Oregon Health Authority — OMMP | none-published | https://www.oregon.gov/oha/ph/diseasesconditions/chronicdisease/medicalmarijuanaprogram/pages/physicians.aspx | Any licensed MD/DO/PA may sign Attending Provider's Statement; no roster. | — | unverified |
| PA | PA Dept. of Health — Medical Marijuana Program | document (PDF) | https://www.pa.gov/content/dam/copapwp-pagov/en/health/documents/topics/documents/programs/medical-marijuana/_jcr_content/_cq_discarded/403bfb39-2c05-4a1d-8d5b-eb766e113988/DOH%20Approved%20Practitioners.pdf | County, practitioner name + degree, location (partial address), specialty. 84 pages. **No license # / NPI.** | "Updated periodically" per PDF; data **as of 2024-07-31** at check (stale; note `_cq_discarded` in URL — PDF may be a retired copy). **2026-09-20 retry: URL still serves the PDF (HTTP 200, application/pdf, 1.15MB) and the internal date is still July 31, 2024 — a stale copy still being served, not a relocated live list.** | 2026-09-20 (URL alive; content stale) |
| RI | RI Dept. of Health — Medical Marijuana Program | none-published | https://health.ri.gov/medical-marijuana/information/patients-caregivers | No recommending-physician roster surfaced. | — | unverified |
| SC | — | no-program | — | See grouped line below. | — | unverified |
| SD | SD Dept. of Health — Office of Medical Cannabis | none-published | https://doh.sd.gov/programs/medical-cannabis/patients-cargivers-practitioners/ | Official FAQ: "the South Dakota Medical Cannabis Program does not maintain a list of practitioners who will provide a certification for medical cannabis use." | — | 2026-09-19 |
| TN | — | no-program (CBD-only oil, tightly limited) | — | See grouped line below. | — | unverified |
| TX | TX Dept. of Public Safety — Compassionate Use Program (CURT) | lookup-only | https://curt.dps.texas.gov/app/public/searchPhysician.xhtml | Public CURT physician search (low-THC program): county/city/ZIP + physician search. No bulk download. | Live registry search. | 2026-09-19 |
| UT | Utah Dept. of Health & Human Services — Center for Medical Cannabis | document (HTML roster) | https://medicalcannabis.utah.gov/find-a-provider/ | Full recommending-provider table embedded in page HTML (423 table rows; expandable entries), self-reported/opt-in. No license # in listing. | "Table below to find a recommending medical provider"; no stated cadence. | 2026-09-19 |
| VT | VT Cannabis Control Board — Medical Cannabis Registry | none-published | — | Health Care Professional Verification model; no public list surfaced. | — | unverified |
| VA | VA Cannabis Control Authority | lookup-only? | https://cca.virginia.gov/medicalcannabis/providers/portalhelp | Practitioners register as "Registered Practitioner for Cannabis Oil" (a DHP-regulated profession); searchable via VA DHP license lookup. No certifier roster per se. | — | unverified |
| WA | WA Dept. of Health | none-published | https://doh.wa.gov/you-and-your-family/cannabis/medical-cannabis/healthcare-practitioners | Authorization-form model; no practitioner registry list. | — | unverified |
| WV | WV Office of Medical Cannabis (OMC) | document (PDF) | https://omc.wv.gov/patients/schedule-an-appointment/Documents/PHYSICIANS%20LIST%20-%20UPDATED.pdf | Physician name + **WV medical license number** (e.g. PHY000136), specialty, contact info (email/phone/web), county-grouped incl. out-of-state and telehealth companies; ~69 physicians at check. | "UPDATED" in filename; no date inside PDF; OMC page calls it "current." | 2026-09-19 |
| WI | — | no-program (CBD only) | — | See grouped line below. | — | unverified |
| WY | — | no-program | — | See grouped line below. | — | unverified |

**No-program group (9 states, unverified — confirm before each expansion pass):**
Idaho, Kansas, South Carolina, Wyoming (complete prohibition per May-2026
third-party legislative roundup); North Carolina (no program per multiple 2026
sources; only tribal-land adult-use on EBCI land); Nebraska (Initiatives
437/438 passed Nov 2024; Nebraska Medical Cannabis Commission still standing
up the program — no operational registry or certifier list as of 2026);
Indiana, Tennessee, Wisconsin (CBD/low-THC-only frameworks with no physician
certification registry).

## Deep-dive notes (all fetched and verified live 2026-09-19)

- **Alabama (best document find):** single-page-ish PDF, "Current as of
  9/18/2026" — data one day old at check. ~50 physicians. Includes
  registration expiration date (useful for TTL). No license number, so
  name+address fuzzy-matching against NPPES would be needed. Monthly
  `/uploads/YYYY/MM/` URL pattern is pollable.
- **West Virginia:** only PDF besides Florida with physician **license
  numbers** (PHY-prefixed WV license). Small (~69 physicians) but precisely
  keyed. Undated PDF, no machine-readable feed.
- **DC:** best structured find — true XLSX with split address fields and DC
  medical license numbers, plus PDF twin. Caveat: attachments lag (XLSX Aug
  2023, PDF Jul 2024) despite the "biannual updates" claim; verify the
  attachment date before ingesting.
- **Oklahoma:** new SB 1066 opt-in registry (mandatory since 2026-01-01).
  PDF served from oklahoma.gov DAM with fresh Last-Modified (2026-09-09).
  No license numbers; several hundred entries; opt-in = incomplete roster.
- **Pennsylvania:** 84-page PDF but stale (as-of 2024-07-31) and hosted under
  a `_cq_discarded` AEM path — likely a retired copy; the live list may have
  moved. Re-locate before building.
- **New York:** only true **bulk/api** find — Socrata dataset gegk-4ghy of
  consenting certifying providers, linked from the (live) NYSDOH practitioner
  list page. data.ny.gov was in maintenance at check time, so schema/fields
  are unconfirmed; retry the API before ranking above document sources.
  Note: consent-based list = incomplete roster.
- **Utah / Hawaii:** full rosters embedded in page HTML (no download). Utah
  is large and table-scrapeable; Hawaii is a tiny self-reported contact list.
- **Lookup tier (OH, TX, KY, NJ, MD):** all verified live interactive tools.
  Texas CURT is a plain JSF form (county/city/ZIP). Kentucky's directory and
  Maryland's OneStop list are full browsable rosters behind JS — scrapeable
  with a headless browser but no official file.

## Expansion candidates beyond FL, ranked

1. **New York** — Socrata API; re-verify when data.ny.gov returns. (bulk/api)
2. **Alabama** — freshest document source (day-old data), stable monthly URL. (document)
3. **West Virginia** — license-number keyed, exact match against license data. (document)
4. **DC** — XLSX with license numbers; watch attachment staleness. (document)
5. **Oklahoma** — fresh, large, but no license # and opt-in. (document)
6. **Pennsylvania** — large but stale + possibly retired URL; re-locate first. (document)
7. **Utah** — scrapeable HTML roster; self-reported data. (document-equivalent)
8. **Hawaii** — tiny self-reported HTML list; low value. (document-equivalent)

Lookup-only if scraping is ever approved: KY and MD (full rosters), then OH,
TX, NJ (per-query search tools).

## Login / paywall / pay-per-access findings

None. Every source listed above is free and required no login at check time.
(Georgia's commission site 403s non-browser agents — bot protection, not a
paywall; Maryland OneStop needs JS execution, not credentials.)

## Caveats

- `unverified` rows are search-snippet level; confirm the official page before
  any build decision. The `2026-09-19` fetches confirm the source existed and
  its format that day only.
- Opt-in/consent lists (NY, OK, UT, HI) understate the true certifier
  population; Florida's OMMU list is a complete regulatory roster, so these
  are not directly equivalent for analytics.
- Pennsylvania's and DC's published files appear stale despite "periodic"
  update claims — capture the internal as-of date during ingest.
