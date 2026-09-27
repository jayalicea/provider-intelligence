# Target Markets for Roadmap Phases A–C

Status: analysis, 2026-09-26. Not validated with customers yet. See
"Validation step" at the end.

Context: the project keeps adding data sources (cannabis, CLIA, facilities)
while `docs/V2_ROADMAP.md` phases A–C are still open. Choosing a target
user should decide which phase work comes first.

## Candidates

### 1. Credentialing / compliance teams (small–mid groups, ASCs, home health)
- **Data fit:** NPPES + OIG LEIE + state Medicaid exclusions + license
  status + MIPS already joined. Roster upload and the exclusion watchlist
  are the core of their workflow.
- **Would pay for:** monthly roster re-screening (per CMS/OIG guidance),
  audit-ready per-provider reports, alerts on new exclusions or license lapses.
- **Phases:** A (exports, printable summary) and B (watchlists, alerts);
  C auth is needed soon because rosters are sensitive.
- **Risk:** crowded market (Verisys, symplr, ProviderTrust); compete on
  price and simplicity. NCQA-grade credentialing needs primary-source
  verification that is not in place.

### 2. MIPS consultants and billing / revenue-cycle firms
- **Data fit:** MIPS history (PY 2018–2024), taxonomy percentiles,
  benchmark and ranking endpoints. They need shareable artifacts, not
  accounts, matching the Phase B no-auth design.
- **Would pay for:** prospect lists, before/after client reports, peer
  comparisons.
- **Phases:** A and B map almost directly.
- **Risk:** small market, demand spikes around MIPS deadlines, CMS scores
  lag by about a year.

### 3. Medical-cannabis ecosystem (dispensaries, compliance vendors, watchdogs)
- **Data fit:** multi-state certifying-physician data linked to NPI,
  licenses, and exclusions. Probably unique.
- **Would pay for:** certifying-physician verification, regional lists,
  change alerts.
- **Phases:** mainly B.
- **Risk:** niche, rules differ by state, banking/payment friction.
  Defensible but low ceiling.

### 4. Payers and network-adequacy teams (small plans, TPAs, ACOs)
- **Data fit:** facilities, CLIA labs, coverage jurisdictions, provider
  quality support directory accuracy (No Surprises Act) and adequacy work.
- **Would pay for:** directory scrubbing (inactive NPIs, exclusions, wrong
  taxonomy), quality tiering.
- **Phases:** C (server state, scheduled jobs, auth) plus ops hardening.
- **Risk:** long sales cycles, SOC 2 questionnaires, needs a sales motion.

### 5. Journalists, researchers, policy analysts
- **Data fit:** national headlines and data-quality reports already exist
  in `docs/`.
- **Would pay for:** little directly; value is distribution, credibility,
  and inbound leads for 1–4.
- **Phases:** A (exports, methodology pages).
- **Risk:** weak revenue. Treat as a channel, not a customer.

## Recommendation

Lead with **#1 (credentialing / exclusion screening)**, with **#2** as a
secondary audience served by the same Phase A/B features.

- Screening is a recurring legal obligation, so demand is steady rather
  than seasonal.
- Existing features (roster upload, exclusion watchlist, license status)
  are closest to a product.
- It gives Phase C auth a concrete reason to exist.
- Offer #3 as an add-on module rather than the main focus.

What would change this: direct access to one of these groups (e.g. working
at a practice, ACO, or cannabis operator) makes that group the right first
target, because distribution matters more than market size at this stage.

## Validation step

Outreach copy and interview guide: `docs/CUSTOMER_DISCOVERY.md`.

Before building Phase B, show the Upload Roster → screening report flow to
5–10 credentialing managers and ask whether they would pay for monthly
re-screening. Their answers decide whether Phase C auth is worth building.
