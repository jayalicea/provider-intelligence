# GTM Plan: Productized Data Services (near-term revenue)

Generated 2026-09-12 from prompt 1 (productized-services). Inputs at time of writing:
- Availability: ~2 hours weeknight evenings, most of weekend days (~10 to 14 hours/week)
- Employment: no agreement restricting adjacent-domain sales
- Rule: nothing sold before a working artifact exists (no vaporware)

## 0. Gating diligence

Employment agreement: cleared, none restricting adjacent domains. Standing gates for all engagements:
- Public-data-only until a BAA is in place; any PHI triggers BAA requirement first.
- FCRA applicability review before any screening output is used for credentialing or employment decisions.
- This file is diligence, not legal advice.

## 1. Packaged offers

### Package A: Provider Data Cleanup Sprint
- Outcome: a messy NPI, QPP, or Care Compare extract becomes a clean, queryable table with source and as-of date on every field.
- Scope: one dataset, one delivery, written schema doc, two revision passes.
- Out of scope: ongoing maintenance, dashboards, any PHI.
- Price band: $1,200 to $2,500.
- Reasoning: deliverable in 3 to 4 evenings, small-check budget, matches a fixed micro-engagement rate.

### Package B: Screening List Build
- Outcome: one-time screened list (NPIs + OIG exclusion status + license status where available) for the client's active provider roster.
- Scope: up to 1,000 providers, CSV with provenance columns.
- Out of scope: ongoing monitoring, API access, employment decisions.
- Price band: $1,500 to $3,000.
- Reasoning: the v1 dossier sold as a service before the product exists; requires only the LEIE build, the smallest piece of the verification product plan.

### Package C: Provider Intelligence Pilot
- Outcome: two-week hosted pilot of the verification dossier endpoint plus dashboard for one team, up to 500 lookups.
- Scope: read-only API key, CSV and JSON export, weekly call.
- Out of scope: SLA guarantees, on-prem, custom integrations.
- Price band: $2,500 to $4,000 pilot fee, credited toward subscription on conversion.
- Reasoning: bridge from services to product revenue; requires the verification product build complete first.

## 2. Segment ranking by speed-to-cash

1. Small-practice MIPS and quality consultants: solo owners, pain every reporting season, decide in one call. Sell Package A and B; MIPS is sunsetting, do not sell MIPS analytics.
2. Credentialing and onboarding teams at small hospitals and MSPs: highest willingness to pay, need Package C (blocked on build). Second in line, first in value.
3. Lab and diagnostics outreach teams: natural Package A fit, but most have an existing vendor; unpredictable cycles.
4. Small payer and ACO analysts: real budgets, slow procurement. Last priority.

## 3. Outreach

### 10-contact list template (columns)
Name | Organization | Role | Segment (1-4) | Trigger (specific current reason they feel the pain) | Contact source (mutual, LinkedIn, association directory) | Status (Identified, Contacted, Replied, Call booked)

Hunting grounds: LinkedIn titles "credentialing specialist", "quality consultant", "MIPS coordinator"; state MGMA chapter directories; local medical society newsletters.

### Email variant
Subject: provider data question

Hi [name], I build pipelines over the public CMS and NPI datasets (NPPES, QPP, Care Compare, OIG exclusions). I keep source and as-of date on every field, which is where most commercial extracts cut corners.

I have a working platform, not a pitch deck. I am looking for three people on credentialing or quality teams willing to describe what they pay for provider data today and what is still broken about it, in a 20-minute call. No sales pitch in the first half.

Would [two specific slots] work?

### LinkedIn variant (connection note, under 300 characters)
Hi [name], I build on public CMS/NPI provider data with full provenance per field. Looking for 3 credentialing or quality folks to describe what they pay for provider data and what is still broken, 20 min, no pitch. Open to a call?

Voice rules: concise, direct, operational, no hype, no em-dashes. Sell curiosity about their problem, not the product.

## 4. Discovery call script (20 minutes)

- 0 to 2: introductions, one sentence on what you built, ask permission to question first.
- 2 to 10 (learn): What do you pay for provider data or screening today? What is still broken (stale rows, footnote codes, no as-of dates, mismatched identifiers)? If a trusted feed with provenance existed, what would you point it at first? Budget this quarter, and who else signs off?
- 10 to 15 (mirror): replay their most expensive problem. Describe the smallest Package A or B variant addressing exactly that: one sentence of scope, one price from the band, no deck.
- 15 to 20 (convert): if interested, written proposal within 48 hours. If not, ask for one referral. Either way, permission to follow up in 30 days. Stop pitching at minute 15.

## 5. Conversion path

- Proposal template (one page): problem in their words, outcome in one sentence, scope in and out, timeline in evenings-and-weekend units (never promise business-hours delivery), fixed price, 50% deposit to start, remainder at delivery.
- Milestones: deposit on signature; midpoint check-in for datasets over 500 rows; final at delivery.
- Smallest first engagement: Package A on a single dataset.
- Testimonial ask at delivery: two sentences on what changed, plus permission to reference by name or generically ("a 12-person credentialing team in Ohio").

## 6. Proof page outline (one page)

1. Headline: "Provider data with a paper trail."
2. Three redacted screenshots of the running dashboard (reuse detail.png, mips.png, quality.png after repo cleanup).
3. One sample row showing every field with source and as-of date (discipline from GOVERNMENT_API_REFERENCE.md).
4. Headers/excerpts of CODE_REVIEW.md and SECURITY_REVIEW.md as QA evidence.
5. "Built entirely on public CMS and NIH data. No PHI handled. BAA available for scoped engagements."
6. Footer: email + calendar link.

## One-week action checklist (cash order)

- Day 1 (2h, evening): freeze Package A scope and one price in band; draft proof page copy.
- Day 2 (2h, evening): build 10-contact list, at least 6 rows with real triggers.
- Day 3 (2h, evening): send 3 emails; log statuses.
- Day 4 (2h, evening): 2 more emails + 3 LinkedIn connection notes.
- Day 5 (3h, weekend): polish proof page, wire calendar link, reply same-day to responses.
- Day 6 (3h, weekend): start the OIG LEIE ingest build (public monthly flat file; fastest path to Package B existing).
- Day 7 (2h, weekend): book first discovery call, target on or before 2026-09-26.

## Honest expectations

Hours-capped side income in the hundreds to low thousands per engagement, prone to feast and famine, does not compound. What compounds is the artifact: each engagement hardens the platform that becomes the verification product.
