HEALTHCARE ENFORCEMENT EVENT MONITOR, ROLLING 30-DAY WINDOW

CONTEXT
Exclusion lists (federal LEIE, state Medicaid lists) lag reality by months: the
exclusion date trails the underlying investigation, settlement, or board action by a
long administrative tail. The events themselves are public the day they happen. This
task structures the most recent 30 days of US healthcare enforcement events into a
normalized dataset that complements exclusion-list screening with an early-signal layer.

MISSION
Collect healthcare enforcement actions published in the last 30 days (from today's
date) across federal and state sources. Produce one normalized event table with strict
provenance. The dataset's job is to surface providers and entities in trouble BEFORE
they appear on any exclusion list.

SOURCE MAP (fan out one subagent per source family; add sources you find)
- Federal: DOJ press releases (healthcare fraud, False Claims Act, opioid cases),
  OIG Office of Investigations enforcement actions, CMS program-integrity revocations
  and terminations, DEA administrative actions against registrants.
- State: state Attorney General healthcare-fraud announcements, state Medicaid
  program-integrity actions, state medical board disciplinary orders published in the
  window, state pharmacy board actions.
Classify jurisdiction as federal or the two-letter state code.

NORMALIZED COLUMNS (exactly, one row per event)
event_date, source_name, source_url, jurisdiction, entity_name, npi, entity_type,
action_type, summary, as_of, retrieval_method, provenance_note
action_type vocabulary: exclusion, suspension, revocation, settlement, conviction,
indictment, board_action, dea_action, other (explain in summary).
npi only when the source states it (10 digits); entity_type: individual, organization,
or unknown. summary: one sentence, factual, no editorializing. as_of = access date.
If the same event appears in multiple sources, emit ONE row and record both URLs in
provenance_note.

COLLECTION RULES
- Public sources only. Identify as "ProviderDataSurvey/1.0 (contact: CONTACT)".
  No CAPTCHA bypass, no logins, no paywalls, no evading blocks. Respect robots.txt.
- Politeness: 3 to 8 seconds randomized delay per host, backoff on 429/5xx, at most
  30 requests per host, stop a source after 3 failures and record it.
- Prefer official primary sources (.gov, state boards) over news coverage; when only
  news coverage exists, mark retrieval_method as press_report with the outlet named.
- Every row must trace to a source_url and as_of date. Unverifiable events are left
  out, not guessed.

DELIVERABLES (save all three, downloadable)
1. enforcement-events-30d.csv
2. enforcement-sources.md (sources swept, coverage notes, blocked/failed sources with
   compliant paths, and counts per source family)
3. enforcement-summary.md (counts by action_type and jurisdiction, the five highest-
   impact events with one-paragraph context each, and a note on any event involving an
   entity that also appears on a public exclusion list, if you happen to observe one)

FINAL MESSAGE REQUIREMENT (mandatory)
Your last message MUST contain inline: total events collected, counts by action_type,
counts by jurisdiction, sources swept vs blocked, and the five highlighted events.
Do not point at files in place of the inline summary.
