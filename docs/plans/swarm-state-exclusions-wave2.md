STATE MEDICAID EXCLUSION SURVEY, WAVE 2 (6 jurisdictions only: CT, ID, IL, IN, FL, VT)

CONTEXT
A prior survey covered 51 jurisdictions and extracted 38 state lists. Six jurisdictions
remain unresolved: CT, ID, IL, IN were marked needs_human_review (the prior pass found
candidates but could not classify or extract confidently), and FL, VT were blocked (FL by
a Cloudflare challenge, VT by a 403). Your job is to resolve exactly these six, nothing
else.

PER-STATE TASKS
CT: the prior pass found multiple candidate lists (DMHAS exclusions, Medicaid sanctions,
DSS). Determine which is the official Medicaid exclusion/sanction list (or whether CT
maintains several with different scopes), and extract the Medicaid-relevant one(s), noting
scope per list.
ID: determine whether Idaho maintains its own Medicaid exclusion list beyond LEIE
republication; the prior pass was unsure. If the list is just LEIE, classify as
republication with evidence.
IL: Illinois HFS maintains a provider terminations/suspensions listing; extract it and
classify. Watch for multiple formats (web page vs downloadable file).
IN: Indiana maintains a Medicaid exclusion list via FSSA or the state OIG; locate the
authoritative one and extract it.
FL: prior pass hit a Cloudflare challenge on flmedicaidmanagedcare or the AHCA portal.
Try the official Florida Medicaid portal paths, AHCA provider sanction publications, and
any direct downloadable files (xls/csv/pdf) that avoid the challenged page. If every
automated path is challenged, record blocked precisely and identify the compliant manual
path (what a human would click).
VT: prior pass got a 403. Try the Vermont Medicaid provider exclusion page and any
downloadable file, with the honest identifying user agent below. If still refused, record
blocked precisely.

COLLECTION RULES (same as wave 1)
- User agent: "ProviderDataSurvey/1.0 (contact: CONTACT)". Browser UA only where a public
  endpoint refuses generic clients, never after an explicit block.
- 3 to 8 second randomized delays, backoff on 429/5xx, max 30 requests per host, stop a
  source after 3 failures. Respect robots.txt. No CAPTCHA bypass, no logins, no paywalls.
- OpenSanctions mirrors of these states' official lists are acceptable sources (they are
  how wave 1 succeeded for 35 states); record retrieval_method accordingly and cite the
  official state URL in source_url as wave 1 did.
- Flag rows suspected of being federal LEIE republications as suspected_leie_republication.

NORMALIZED COLUMNS (identical to wave 1, so rows append to the existing dataset)
state, source_name, source_url, entity_name, npi, exclusion_type, exclusion_date,
reinstatement_date, as_of, retrieval_method, provenance_note, suspected_leie_republication
NOTE: wave 1 had a column-alignment quirk where a date could land in exclusion_type; check
your output and put dates in exclusion_date, types in exclusion_type.

DELIVERABLES
1. state-exclusions-wave2.csv (all rows for the six states, one header)
2. state-exclusions-wave2-survey.md (six-row table: state, status extracted_N_rows |
   blocked | not_maintained | republication_only, list_type, source_url, retrieval_method,
   terms_summary, plus one paragraph on CT's multi-list finding if real)
3. blocked-sources-wave2.md for any state still unresolved, with the precise compliant
   manual path.

FINAL MESSAGE (mandatory, inline): the six-row table, per-state row counts, total rows,
which states were resolved vs still blocked, and one sentence per blocked state naming the
manual path a human should use.
