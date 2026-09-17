# Open PR Triage Report

Read-only triage of every open pull request. **No remote writes performed.**

---

## 1. Run context

| Item | Value |
|---|---|
| Timestamp (UTC) | 2026-09-15 01:43 – 02:05 |
| Node | v22.22.2 |
| npm | 10.9.7 |
| Postgres reachable | **No** (`/var/run/postgresql:5432 - no response`) |
| Enumeration method | **GitHub MCP API** (`list_pull_requests`, state=open). `gh` CLI is not installed in this container; the MCP server is authenticated, so the actual open-PR list was used rather than the `git ls-remote` branch-name fallback. |
| Open PRs found | 9 — #17, #16, #15, #14, #13, #12, #11, #10, #6 |
| Baseline | `origin/main` @ `7cd60ba` |
| Writes | temp local branches `triage-base`, `triage-pr*` (all deleted) + this file. Local `main` left untouched at `6e65166`. |

### Two environment findings that change how this report reads

**1. Postgres being down did NOT invalidate any test.** The suite is fully mocked (`tests/helpers/mockDb.js` + `nock`); `npm test` on unmodified `main` passes **143/144 (1 skipped), exit 0** with no database running. I grepped every failure log for `ECONNREFUSED`, `role ... does not exist`, and `database ... does not exist`: **zero matches across all 9 PRs.** There are therefore **no ENV-classified failures in this report.** Test results here are trustworthy. (This contradicts the assumption in the triage brief — worth knowing, as it means the results are stronger than expected, not weaker.)

**2. Root `npm run lint` fails on `main` itself, for all 9 PRs, for the same reason.** There is no root ESLint config — the repo's only `eslint.config.js` lives in `client/`. ESLint 8.57.1 with `--ext .js` walks into `client/` and errors `ESLint couldn't find a configuration file`. Exit code 2 on `main` and on every PR head. **This signal has zero per-PR discriminating power**; no PR introduced it and no PR fixes it. It is a pre-existing repo defect (already noted by the author in #12). Where a PR touches `client/`, I ran `client/ npm run lint` instead, which does carry signal.

### One deliberate deviation from the brief

Step 3 as specified resets the tree to `origin/main` and *then* runs install/lint/test without checking out the PR branch — that would have tested `main` nine times and produced an identical, meaningless row for every PR. I instead checked out each PR head (`origin/B`) for the lint/test run. Additionally, where the trial merge was clean I ran the suite **on the merged tree**, which catches semantic conflicts a head-only test misses.

---

## 2. Per-PR table

Test counts differ between heads because the branches sit on bases of different ages; the merged-tree column is the like-for-like comparison against `main`'s 143/144.

| PR | Title | Files vs main | Install | Lint (root) | Test — PR head | Test — merged tree | Merges into main |
|---|---|---|---|---|---|---|---|
| **#17** | Add the one-page proof page | 23 *(3 own)* | pass | fail¹ | pass 142/143 | — | **CONFLICT** |
| **#16** | Audit docs/ and correct stale claims | 22 *(16 own)* | pass | fail¹ | pass 142/143 | — | **CONFLICT** |
| **#15** | Add the marketing proof page | 2 | pass | fail¹ | pass 123/123 | pass 143/144 | CLEAN |
| **#14** | Validate compose stack; env template + healthcheck | 3 | pass | fail¹ | pass 123/123 | pass 143/144 | CLEAN |
| **#13** | Record four architecture decisions as ADRs | 6 | pass | fail¹ | pass 142/143 | — | **CONFLICT** |
| **#12** | Batch the cohort exclusion scan | 4 | pass | fail¹ | pass 147/148 | pass 148/149 | CLEAN |
| **#11** | Add a root README as the project front door | 1 | pass | fail¹ | pass 142/143 | — | **CONFLICT** |
| **#10** | NUCC taxonomy crosswalk + backfill | 7 | pass | fail¹ | pass 138/138 | pass 158/159 | CLEAN |
| **#6** | Add coverage page with dataset registry | 2 | pass | fail¹ / client lint **pass** | **FAIL 7/96** ² | pass 143/144 | CLEAN ³ |

¹ Pre-existing root-ESLint-config failure, identical on `main`. Not attributable to any PR.
² Not ENV, not a defect in #6's own diff — see §7.
³ Merges cleanly but **must not be merged as-is** — see §7.

`npm ci` succeeded for all 9 PRs (~7s each, warm cache). No BUILD_FAIL.

---

## 3. Merge conflicts vs main

Four PRs conflict, all on **exactly one file, for one shared root cause**.

| PR | Unmerged files |
|---|---|
| #11 | `README.md` |
| #13 | `README.md` |
| #16 | `README.md` |
| #17 | `README.md` |

**Root cause: an add/add conflict, not a mechanical one.** The merge base carries no `README.md`. `main` has since gained a 61-line README (commit `fd88c98`, *"docs(api): OpenAPI 3.1 spec + README API section"*), while #11 adds an independently written 232-line README. Both sides are new files.

This makes #11's stated premise — *"The repository had no root `README.md`"* — **stale**. It was true when the PR was written; it is not true now. The two files also disagree on product naming:

- `main`: "# Provider Intelligence Platform"
- #11: "# ProviderLens (Provider Intelligence Platform)"

#13, #16 and #17 are **stacked on #11** and inherit the same conflict; they contain no independent conflict of their own.

**Verified:** resolving the README once at #11 unblocks the whole chain. Simulating `11 → 13 → 16 → 17` with #11's README taken, all three subsequent merges applied **CLEAN** and the suite stayed green (143/144).

---

## 4. Cross-PR file overlaps

Files touched by 2+ PRs. Note that #17/#16/#13 overlap each other largely by **stack inheritance** (a diff vs `main` includes their ancestors' commits), not by independent edits — "own diff" columns separate the two.

| File | PRs | Nature |
|---|---|---|
| `README.md` | #17, #16, #13, #11 | Stack inheritance + #13 and #17 each add their own index lines |
| `docs/adr/*.md` (5 files) | #17, #16, #13 | Stack inheritance — originates in #13 only |
| `docs/CODE_REVIEW.md`, `DESIGN.md`, `FRONTEND_SPEC.md`, `GOVERNMENT_API_REFERENCE.md`, `PROMPT_REVIEW.md`, `README.md`, `SECURITY_REVIEW.md`, `SECURITY_REVIEW_RESPONSES.md`, `V2_ROADMAP.md`, `method-statement.md`, `nppes-v2-notes.md`, `plan.md`, `plans/kimi-code-prompts.md`, `plans/package-b-priority.md`, `plans/verification-product.md` (15 files, all under `docs/`) | #17, #16 | Stack inheritance — originates in #16 only |
| `docs/plans/gtm-productized-services.md` | #17, #16 | **Genuine overlap** — both independently edit this file |
| **`docs/marketing/index.html`** | **#17, #15** | **Genuine overlap — competing implementations. See §5.** |
| **`src/services/intelligenceService.js`** | **#12, #10** | **Genuine overlap — verified compatible. See below.** |
| **`tests/helpers/mockDb.js`** | **#12, #10** | **Genuine overlap — verified compatible.** |

### #10 / #12 — the only real code overlap, and it is safe

Both modify the cohort query in `intelligenceService.js` and the shared mock. I did not assume textual auto-merge meant correctness:

- Merged **both orders** (`10→12` and `12→10`): auto-merge clean, zero unmerged paths in both directions.
- Ran the full suite on the **combined tree**: **163 passed / 164 (1 skipped), exit 0.**
- Arithmetic confirms neither PR's tests were lost: 143 (main) + 15 (#10's new tests) + 5 (#12's new tests) = 163.

**Conclusion: #10 and #12 are genuinely independent despite touching the same two files.** Order between them does not matter.

---

## 5. Likely duplicates

### #15 vs #17 — LIKELY DUPLICATE (high confidence)

Both create `docs/marketing/index.html` as the proof page built from §6 of `docs/plans/gtm-productized-services.md`, from two separate agent sessions.

| | #15 | #17 |
|---|---|---|
| Branch | `claude/task4-marketing-onepager` | `claude/ecstatic-planck-wntvwr-marketing` |
| Head committed | 2026-09-14 00:07 | **2026-09-15 00:56 ← newer** |
| `index.html` size | 308 lines | **759 lines** |
| Extra file | `docs/marketing/images/README.md` | — (screenshots noted in the plan file) |
| Merges into main alone | CLEAN | CONFLICT (README, via stack) |

The two files are not near-identical in text (974-line diff) but are **functionally the same deliverable** — same target path, same source outline, same three redacted-screenshot sections, same coverage figures (both cite 9,726,865 / 84,001 / 82,929 across 38 jurisdictions), same QA-excerpt section, same contact placeholders. They differ mainly in depth and in the judgement call about which review findings to quote.

**Verified conflict:** merging #15 then #17 produces an add/add conflict on `docs/marketing/index.html` (plus the inherited `README.md`). **Only one of these can land.** #17 is newer and substantially more complete; #15 is standalone and merges cleanly today.

No other near-identical pair exists. #6's overlap with `main` is a different phenomenon — see §7.

---

## 6. Recommended merge order

Only PRs whose clean merge I verified are recommended for merging. Each line gives the reason.

**Tier 1 — verified clean, no decisions required (merge tonight):**

1. **#14** (compose/env/healthcheck) — touches `.env.example`, `docker-compose.yml` and one doc; shares **zero** files with any other open PR, so it can land first with no ordering risk.
2. **#10** (taxonomy crosswalk) — verified clean merge and 158/159 on the merged tree; land it immediately before #12 because they share two files.
3. **#12** (cohort exclusion batching) — verified clean merge, and verified compatible with #10 in both orders with the combined suite at 163/164; adjacent to #10 so the shared-file merges are reviewed together.

**Tier 2 — mergeable only after a human decision:**

4. **#11** (root README) — merges only once you decide between `main`'s existing 61-line README and #11's 232-line "ProviderLens" rewrite; this is a product-naming and content call, not something triage should guess at.
5. **#13** (ADRs) — verified CLEAN once #11's README is resolved; must follow #11 because it is stacked on it and adds its own ADR index lines to that README.
6. **#16** (docs audit) — verified CLEAN on the chain; must follow #13, which is its PR base.
7. **#17 *or* #15** (proof page — **pick one, not both**) — #17 is newer and more complete but only merges on the resolved chain; #15 is smaller and merges cleanly into `main` today. If you take #17, close #15; if you take #15, #17 must drop its `index.html`.

**Should be rebased/regenerated rather than merged:**

- **#6** — merges cleanly and passes on the merged tree, but would **regress published coverage figures** (§7). Do not merge in its current state.

**Note on Tier 2:** I am *not* asserting #11/#13/#16/#17 "merge cleanly" — they do not, as they stand. I verified only that the chain resolves cleanly *after* a manual README resolution at #11.

---

## 7. Blocked / needs attention

### #6 — would publish incorrect compliance figures. Highest-priority finding.

`npm test` on #6's head fails **7 of 96** tests, all in `tests/providers.test.js`, all `Nock: Disallowed net connect for clinicaltables.nlm.nih.gov`. Classification:

- **Not ENV** — no Postgres involvement; zero `ECONNREFUSED`/`database`/`role does not exist` matches.
- **Not a defect in #6's diff** — #6 touches only `.gitignore` and `coverage.json`, neither of which is on that code path.
- **Stale base.** The branch is **41 commits behind `main`** and predates the nock-isolation fix (the author flagged this: *"Depends on #2"*). On the merged tree the failures vanish: **143/144, exit 0.**

**But the merge-clean result hides a real data regression.** #6's coverage page component is *already in `main`*; its remaining diff would change the published registry as follows:

| Field | `main` | #6 | Effect |
|---|---|---|---|
| `state-medicaid-exclusions.records` | **82,929** | **0** | regression |
| `state-medicaid-exclusions.jurisdictions` | **38** | **0** | regression |
| top-level `jurisdictions[]` | `[]` | 51 rows, **every one `records: 0`** | table added, counts empty |

`tools/coverage-jurisdictions.js` was evidently run against an **unloaded `state_exclusions` table**, so every measured count came back zero and the dataset-level totals were overwritten with 0. Merging this would make the compliance-facing Coverage page state **0 exclusion records across 0 jurisdictions**, contradicting `main`, the method statement, and the 82,929 / 38 figures cited by both #15 and #17. No test covers these values, which is why the merged tree stays green.

The 51-row table itself is valuable — 44 rows carry real official state source URLs and the status split (38 `extracted`, 4 `needs_human_review`, 2 `blocked`, 7 `not_maintained`) matches `main`'s 38 jurisdictions. **Recommendation: rebase onto current `main` and re-run the generator against a loaded database**, then re-verify `records` and `jurisdictions` before merge. The tool's "refuses to write a partial table" guard did not catch the all-zero case — worth a guard on zero counts.

*(Checked and dismissed: #6's `.gitignore` change also strips a UTF-8 BOM. I verified with `git check-ignore` that git strips the BOM itself and `node_modules/` **is** correctly ignored on `main` — so that part is cosmetic, not a bug fix.)*

### Failed lint — all 9 PRs, pre-existing

Root `npm run lint` exits 2 on `main` and every PR head: no root ESLint config exists. **No PR is individually blocked by this**, but the repo has no working root lint at all, so nothing is being linted in CI outside `client/`. Worth a follow-up PR adding a root config. `client/ npm run lint` passes on `main` and on #6 (the only PR touching `client/`).

### CODE (non-ENV) test failures

**None.** Every PR's test failures were attributable to stale bases, not to the diff under review. No PR introduces a failing test.

### Other items worth your eye

- **#14** — the author states plainly that the compose smoke tests **were never executed**; no image could be pulled (`production.cloudfront.docker.com` CONNECT refused). The `.env.example` and healthcheck additions are sound and the merge/tests are clean, but *the healthcheck probe has not been exercised against a running container.* Merging is low-risk; treat the validation doc as partially unverified.
- **#10** — the NUCC and NIH taxonomy sources are both blocked by egress policy (HTTP 403), so the loader was verified only via `--file`. The author flags the NIH branch's field names as unverified. The code path is tested; the live-source behaviour is not.
- **#16** — the largest docs diff (16 files own). It corrects genuinely stale claims, but it rewrites `docs/README.md`'s entire API section; that is the one file here where a careless merge could reintroduce documentation drift against `main`'s newer OpenAPI work (`fd88c98`). Review that file specifically.

---

## Verification summary

- 9 PRs enumerated, installed, linted, tested, and trial-merged.
- 5 merge cleanly into `main`: #15, #14, #12, #10, #6.
- 4 conflict, all on `README.md`, all one root cause: #17, #16, #13, #11.
- 1 verified duplicate pair: #15 / #17.
- 1 verified-compatible code pair: #10 / #12 (combined suite 163/164).
- 1 PR with a data regression that tests do not catch: #6.
- **No remote writes performed.** All temp branches deleted; working tree clean.
