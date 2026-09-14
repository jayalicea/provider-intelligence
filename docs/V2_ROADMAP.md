# Provider Intelligence Platform: V2 Roadmap

This document defines user stories and a phased roadmap for the next version of the Provider Intelligence Platform, building on the current Express + PostgreSQL backend and React frontend (provider search, provider detail, MIPS dashboard, Care Compare quality measures).

Status as of 2026-09-14. No phase below has been executed as a phase, but the
client has grown routes and one story has been satisfied incidentally, and the
names now collide. Three clarifications:

- **Story 3.2 (printable provider summary) is effectively shipped.** A print
  stylesheet lives at the end of `client/src/index.css` and `docs/DESIGN.md`
  section 8 makes the one-page Provider 360 print report normative. Phase A
  should be re-scoped accordingly rather than re-estimating it at 0.5 weekend.
- **The shipped `/watchlist` route is an exclusion watchlist**, backed by
  `GET /api/v1/intelligence/exclusion-watchlist`: it lists cached providers
  carrying an OIG LEIE or state Medicaid exclusion match. It is not Story 2.1's
  user-curated MIPS watchlist, which is still unbuilt, and it holds no per-user
  state, so it does not resolve Tension 1.
- **The shipped `/providers/:npi/360`, `/cohort`, `/upload-roster` and
  `/coverage` routes** are exclusion-screening and coverage-reporting surfaces,
  unrelated to the stories below.

Everything else in Phase A0 through Phase C remains open, including Phase A0
itself, which is the prerequisite for every story that involves a year or a
percentile. CSV export (Story 3.1) is not built: the only CSV handling in the
client is roster upload, which is an input path, not an export.

## Personas

1. **Practice Manager (PM)**: Runs a small medical practice, tracks the MIPS scores of their own providers, wants early warning when performance slips.
2. **Healthcare Analyst (HA)**: Works at a payer, ACO, or health system, compares providers and peer groups, produces reports for stakeholders.
3. **Consultant (C)**: Advises multiple practices on MIPS participation, needs shareable artifacts (files, links) rather than accounts on yet another platform.
4. **Credentialing Staff (CS)**: Verifies provider quality signals during onboarding and recredentialing cycles, needs quick exports for files and audits.

## Design Tensions and Decisions (Up Front)

### Tension 1: Alerts and watchlists imply per-user state, which implies auth
The platform has no auth today. Two paths:

- **No-auth interim path**: Watchlists stored in browser localStorage, with an option to serialize the list (a set of NPIs plus alert thresholds) into a URL-safe token for sharing. Score drop alerts are evaluated client side on revisit: when a user opens a watchlist, the app fetches current scores and compares against a snapshot stored in localStorage from the last visit. No email, no server state. Cost: about 2 to 3 weekends total for watchlist plus alert rules.
- **Full path**: User accounts (email + password or magic link), server persisted watchlists, and a scheduled job (cron or pg-boss worker) that detects score drops after each data refresh and sends email alerts via a transactional provider (Resend, SES). Cost: about 4 to 6 weekends (auth is the majority of it), plus ongoing ops burden.

Decision: ship the no-auth path in Phase B, defer the full path to Phase C. This matches the consultant and practice manager personas, who mostly need shareable links, not logins.

### Tension 2: Score drop alerts depend on true multi-year MIPS data
The CMS QPP Experience dataset is a single rolling vintage with no true year column; current multi-year data is thin and partially synthetic. Without real per-year vintages, score drop alerts and multi-year comparisons are built on sand.

**Prerequisite data acquisition work (Phase A0, 2 weekends)**:
- Locate archived QPP Experience / Physician Compare downloadable CSVs per performance year (CMS data catalog snapshots, web.archive.org copies, CMS Data API versioning).
- Add a `performance_year` column sourced from the vintage of each file, plus an ingestion pipeline that loads each year into `mips_performance_scores` keyed on (npi, performance_year).
- Backfill at least 3 performance years for the existing 9 states so trends and drops are real.
Cost drivers: archival CSV hunting and schema drift between vintages (column names change year to year).

### Tension 3: Export
- CSV is trivial: stream existing endpoint results with a `format=csv` query param or a small serializer. Half a weekend.
- PDF needs a renderer. Options: client side via print stylesheet plus `window.print()` (cheap, ugly), client side via jsPDF (medium), server side via Puppeteer/Chromium rendering the React report page (best looking, heaviest, adds a big dependency). Recommend server side Puppeteer for the benchmarking report only, print stylesheet for everything else. 1 to 2 weekends.
- Taxonomy benchmarking reports can reuse the existing group stats/ranking/percentile service, but at 1M+ provider scale percentiles must be precomputed: a nightly materialization job that writes per-taxonomy-per-year aggregates to a summary table. 1 weekend, mostly query tuning.

### Tension 4: Multi-year comparisons vs the existing trends endpoint
The existing endpoint already returns multi-year trend lines with direction analysis. V2 adds:
- Side-by-side peer cohorts: compare a provider's trend against the median/percentile band of their same-taxonomy cohort across years.
- Percentile-over-time charts: provider's national percentile rank plotted per year, not raw score.
This requires the Phase A0 data prerequisite and the per-year percentile materialization.

---

## User Stories

### Feature 1: MIPS Score Drop Alerts

- **Story 1.1**: As a Practice Manager, I want to flag my providers and set a score drop threshold so that I see a warning banner when any of them drops by more than that amount since my last visit.
  - Value: Early warning before a bad MIPS year becomes a payment penalty.
  - Effort: 1.5 weekends. Cost drivers: alert rule model, client side evaluation logic, snapshot storage.
  - Depends on: Story 2.1 (watchlists), Phase A0 data.
- **Story 1.2**: As a Consultant, I want to share an alert configuration as a link so that my client sees the same flagged drops without creating an account.
  - Value: Consultants work across platforms; links are the deliverable.
  - Effort: 0.5 weekend (extends the watchlist URL token).
- **Story 1.3**: As a Practice Manager, I want to receive an email when a watched provider's score drops after a data refresh so that I do not have to remember to check.
  - Value: True push alerting.
  - Effort: 3 weekends. Cost drivers: auth, scheduled job, email provider integration, unsubscribe/compliance.
  - Depends on: Full auth path (Phase C).

### Feature 2: Provider Watchlists

- **Story 2.1**: As a Credentialing Staff member, I want to save a list of NPIs to a watchlist in my browser so that I can re-check the same providers each cycle without re-searching.
  - Value: Removes repetitive search work for recurring reviews.
  - Effort: 1 weekend. Cost drivers: localStorage store, watchlist UI (add/remove/reorder), integration with search and detail pages.
- **Story 2.2**: As a Consultant, I want to share my watchlist as a URL so that clients open the exact same provider set.
  - Value: Shareability without accounts.
  - Effort: 0.5 weekend (base64/compressed token of NPI list in the URL, decode on load).
- **Story 2.3**: As a Practice Manager, I want my watchlist to survive browser changes and be visible to my staff so that the whole office works from one list.
  - Value: Team visibility.
  - Effort: 2 weekends on top of auth. Cost drivers: server persistence, per-user and per-org list scoping.
  - Depends on: Full auth path (Phase C).

### Feature 3: CSV/PDF Export

- **Story 3.1**: As a Healthcare Analyst, I want to export search results and a provider's MIPS scores to CSV so that I can do my own analysis in Excel.
  - Value: Analysts live in spreadsheets; CSV unblocks them immediately.
  - Effort: 0.5 weekend. Cost drivers: CSV serializer, streaming for large result sets, filename/column conventions.
- **Story 3.2**: As a Credentialing Staff member, I want a printable provider summary page so that I can attach it to a credentialing file as a PDF.
  - Value: Audit ready artifact with zero backend work.
  - Effort: 0.5 weekend (print stylesheet + browser print to PDF).
- **Story 3.3**: As a Healthcare Analyst, I want a polished PDF benchmarking report so that I can send it directly to leadership.
  - Value: Presentation quality deliverable.
  - Effort: 1.5 weekends. Cost drivers: Puppeteer/Chromium server dependency, report template, chart rendering server side.
  - Depends on: Feature 4 benchmarking.

### Feature 4: Taxonomy Peer Benchmarking Reports

- **Story 4.1**: As a Healthcare Analyst, I want a per-taxonomy benchmark report (distribution, quartiles, top/bottom deciles, state breakdown) so that I can contextualize any provider against their true peer group.
  - Value: Extends the existing ranking service into a complete, navigable report.
  - Effort: 2 weekends. Cost drivers: materialized per-taxonomy-per-year aggregates for 1M+ row scale, report UI with recharts.
  - Depends on: Percentile materialization job (shared with Feature 5).
- **Story 4.2**: As a Consultant, I want the benchmark report exportable as PDF so that it becomes my client deliverable.
  - Value: The report is the product a consultant sells.
  - Effort: included in 3.3.

### Feature 5: Multi-Year Comparisons

- **Story 5.1**: As a Healthcare Analyst, I want to see a provider's percentile rank plotted over multiple years against their taxonomy cohort's median and interquartile band so that I can distinguish provider drift from market wide movement.
  - Value: Raw score trends mislead when cutoffs and cohort medians shift; percentile over time does not.
  - Effort: 1 weekend (new chart component + percentile-over-time endpoint reading materialized aggregates).
  - Depends on: Phase A0 data, materialization job.
- **Story 5.2**: As a Practice Manager, I want to compare two or three of my providers side by side across years so that I can see who is improving and who is slipping.
  - Value: Direct internal comparison for incentive and remediation decisions.
  - Effort: 1 weekend. Cost drivers: multi-series trend chart, provider picker limited to small N.

---

## Phases

### Phase A0: Real Multi-Year Data (prerequisite, 2 weekends)
Archived QPP CSV acquisition, `performance_year` backfill, per-vintage ingestion pipeline, plus the per-taxonomy-per-year percentile materialization job. Nothing user facing, but everything below that involves years or percentiles depends on it.

### Phase A: Lowest Effort, Highest Value, No Auth (3.5 weekends total)
1. Story 3.1: CSV export (0.5)
2. Story 3.2: printable provider summary (0.5)
3. Story 2.1: localStorage watchlist (1)
4. Story 2.2: shareable watchlist URL (0.5)
5. Story 5.2: side-by-side provider comparison chart (1), uses existing trends data and degrades gracefully until A0 lands.

### Phase B: Builds on A, Moderate Effort (5 weekends total, assumes A0 done)
1. Story 1.1: client side score drop alerts on watchlists (1.5)
2. Story 1.2: shareable alert config link (0.5)
3. Story 5.1: percentile-over-time chart with cohort band (1)
4. Story 4.1: taxonomy peer benchmarking report UI (2)

### Phase C: Auth and Heavy Lifting (6.5+ weekends total)
1. Auth foundation: accounts, sessions, email verification (2.5)
2. Story 2.3: server persisted watchlists (2)
3. Story 1.3: scheduled drop detection + email alerts (1.5)
4. Story 3.3 / 4.2: server side PDF benchmarking report via Puppeteer (1.5, parallelizable)

---

## Summary Table

| Story | Phase | Effort (weekends) | Depends On |
|---|---|---|---|
| A0: multi-year data acquisition + materialization | A0 | 2 | none |
| 3.1 CSV export | A | 0.5 | none |
| 3.2 Printable summary (print to PDF) | A | 0.5 | none |
| 2.1 localStorage watchlist | A | 1 | none |
| 2.2 Shareable watchlist URL | A | 0.5 | 2.1 |
| 5.2 Side-by-side provider comparison | A | 1 | existing trends endpoint; A0 for full value |
| 1.1 Client side score drop alerts | B | 1.5 | 2.1, A0 |
| 1.2 Shareable alert config link | B | 0.5 | 2.2, 1.1 |
| 5.1 Percentile-over-time vs cohort band | B | 1 | A0 materialization |
| 4.1 Taxonomy benchmarking report | B | 2 | A0 materialization |
| Auth foundation | C | 2.5 | none (can start anytime) |
| 2.3 Server persisted watchlists | C | 2 | auth |
| 1.3 Email score drop alerts | C | 1.5 | auth, 1.1, A0 |
| 3.3/4.2 PDF benchmarking report | C | 1.5 | 4.1 |

Total: roughly 15 weekends for Phases A0 through B, plus roughly 7.5 weekends for Phase C. The single biggest risk is the archival QPP data hunt in A0; if per-year vintages cannot be found, Features 1 and 5 should be descoped to "change since last refresh" semantics using platform owned snapshots going forward.
