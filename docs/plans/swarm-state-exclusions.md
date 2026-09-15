STATE MEDICAID EXCLUSION SURVEY (51 jurisdictions: 50 states + DC)

Replace CONTACT below with a real email before running.

MISSION
For each US state plus DC, determine whether the state Medicaid agency maintains its OWN
exclusion or sanction list (beyond republishing the federal LEIE), and if so extract it
into a normalized dataset. These lists are public records published for screening reuse.
Work all 51 jurisdictions to completion. Do not stop to ask questions; where uncertain,
mark needs_human_review rather than guessing.

STRICT COLLECTION RULES (every subagent)

- Identify honestly: user agent contains "ProviderDataSurvey/1.0 (contact: jayalicea@gmail.com)".
A standard browser user agent is acceptable only where a public endpoint refuses
generic clients, never after an explicit block.
- Politeness: 3 to 8 seconds randomized delay per host, exponential backoff on 429/5xx,
honor Retry-After, at most 30 requests per host, stop a source after 3 failures.
- Respect robots.txt and stated terms. No login, CAPTCHA bypass, or paywall work.
Blocked sources are recorded, not circumvented.
- Flag any row that appears to duplicate a federal LEIE entry as
suspected_leie_republication so we can dedupe later.

CLASSIFY EACH STATE AS
(a) independent state list, (b) state list plus LEIE republication, or (c) none found
(state relies on LEIE only). Record list_type accordingly.

NORMALIZED CSV COLUMNS (exactly, in this order)
state, source_name, source_url, entity_name, npi, exclusion_type, exclusion_date,
reinstatement_date, as_of, retrieval_method, provenance_note, suspected_leie_republication

DELIVERABLES (save all three with these exact names, as downloadable files)

1. state-medicaid-exclusions.csv  (all extracted rows, all states, one header row)
2. state-exclusion-survey.md     (51-row markdown table: state, status, source_url,
list_type, rows_extracted, retrieval_method, terms_summary, plus a header paragraph
with totals and methodology)
3. blocked-sources.md            (every blocked/partial source: what blocked it, and the
compliant path forward: registration, records request, manual download)

FINAL MESSAGE REQUIREMENT (this is mandatory, not optional)
Your last message MUST contain, in full:

- the complete 51-row survey table inline as markdown (every state, no truncation),
- total extracted row count and per-status counts (how many extracted, blocked,
not_maintained, not_found),
- one short paragraph on data quality (uniform columns? dates as published? NPIs
10-digit where present?).
Do not summarize or point at files in place of the inline table. If a file failed to
save, say so explicitly and still provide the inline content.