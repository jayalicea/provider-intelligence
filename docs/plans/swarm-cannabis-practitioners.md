STATE MEDICAL CANNABIS CERTIFYING PRACTITIONER SURVEY (50 states + DC)

Replace CONTACT below with a real email before running.

CONTEXT
There is no federal medical cannabis program or national practitioner registry.
Approximately 38 to 40 states plus DC operate state medical cannabis programs in
which licensed physicians (and in some states nurse practitioners or other
practitioners) become certified or registered to RECOMMEND (not prescribe) cannabis
to patients. States vary: some publish a public registry of certified practitioners,
some publish counts only, some keep the list private. Roughly a dozen states have no
medical cannabis program at all.

MISSION
For each of the 50 states plus DC, determine which category applies and extract the
practitioner list where it is public. Work all 51 jurisdictions to completion. Do not
stop to ask questions; where uncertain, mark needs_human_review rather than guessing.

CLASSIFY EACH STATE AS
(a) public_list: a public registry or list of certified practitioners exists -> extract it
(b) program_no_public_list: a program exists but the practitioner list is not public
    (counts only, or private) -> record with a source citation, no extraction
(c) no_program: the state has no medical cannabis program -> record with a source citation
Also note: which practitioner types may certify in that state (MD only, or also DO,
NP, PA), and whether the program is medical-only or also adult-use (adult-use may
remove the certification requirement entirely, making the question moot).

STRICT COLLECTION RULES (every subagent)
- Identify honestly: user agent contains "ProviderDataSurvey/1.0 (contact: CONTACT)".
  A standard browser user agent is acceptable only where a public endpoint refuses
  generic clients, never after an explicit block.
- Politeness: 3 to 8 seconds randomized delay per host, exponential backoff on 429/5xx,
  honor Retry-After, at most 30 requests per host, stop a source after 3 failures.
- Respect robots.txt and stated terms. No login, CAPTCHA bypass, or paywall work.
  Blocked sources are recorded, not circumvented. Lookup-by-name-only registries
  (no list view) are recorded as lookup_only, not scraped record by record.

NORMALIZED CSV COLUMNS (exactly, in this order, one row per practitioner)
state, source_name, source_url, practitioner_name, credential, npi, license_number,
certification_status, program_name, as_of, retrieval_method, provenance_note
np and license_number may be empty; certification_status as published (active,
registered, certified, expired, suspended); as_of = access date (YYYY-MM-DD).

DELIVERABLES (save all three with these exact names, as downloadable files)
1. state-cannabis-practitioners.csv  (all extracted practitioners, all states, one header)
2. cannabis-practitioner-survey.md  (51-row markdown table: state, classification,
   program_name, certifying_practitioner_types, practitioners_extracted, source_url,
   terms_summary, plus a header paragraph with totals and methodology)
3. blocked-sources.md               (every blocked/partial/lookup_only source, what
   blocked it, and the compliant path forward: registration, records request, manual
   collection)

FINAL MESSAGE REQUIREMENT (mandatory, not optional)
Your last message MUST contain, in full:
- the complete 51-row survey table inline as markdown (every state, no truncation),
- totals: states per classification, total practitioners extracted,
- one short paragraph on data quality (name formats, license numbers present?,
  NPIs present?, statuses as published?).
Do not summarize or point at files in place of the inline table. If a file failed to
save, say so explicitly and still provide the inline content.
