Resume the Provider Intelligence Platform. git log shows phases 1 and 2 committed (grounding docs in AGENTS.md and CORRECTIONS.md, analytics service with group-performance, ranking, trends, benchmark endpoints). A previous session died mid Phase 3: the working tree contains uncommitted frontend work in client/ (modified App.jsx, index.css, vite.config.js, index.html, package files, plus new src/api, src/components, src/hooks, src/pages directories). That uncommitted work is valuable and irreplaceable; protecting it is your first job.

GLOBAL RULES (apply all session):
- Prohibited git operations: git reset --hard, git checkout --, git restore ., git clean, git stash drop, git push --force. If the tree seems corrupted, stop and report instead of resetting.
- Never use git add -A, git add ., or git commit -a. Stage files explicitly by name and run git status immediately before every commit to confirm only intended files are staged.
- Never commit: node_modules/, dist/, .env, *.tmp.js, screenshots, or scratch/debug files.
- Never print, echo, cat, or log .env contents.
- Database: the only permitted writes are INSERTs into the provider cache tables via the existing search endpoint during the Phase 0 top-up, plus the Phase 2B hardening changes explicitly listed there. No schema changes beyond those listed, no migrations, no DELETE/UPDATE/TRUNCATE, no manual SQL inserts. All other phases are strictly read-only against the database.
- Do not modify committed backend services except the Phase 0 pagination fix and the Phase 2B hardening fixes.

STEP 0 - Protect uncommitted work (before anything else): run git status and git stash list. Create a WIP commit of all uncommitted client/ changes with message "WIP: adopt prior session frontend work (uncommitted state at resume)". Verify git status is clean and the client/ files still exist on disk. Only then proceed.

ENVIRONMENT BOOTSTRAP: confirm the database is reachable. Check whether the backend is listening on port 3000 (curl the health endpoint); if not, start it using the existing .env. If dependencies are missing, run npm install (never npm upgrade) in backend and/or client/ using the existing lockfiles. Do not modify package.json or lockfiles unless a dependency is genuinely missing; document any such change.

PHASE 0 - Pagination fix and data top-up:
1. The search endpoint ignores the offset parameter (confirmed: 9 states seeded 3 pages each produced only ~500 unique providers per state, 4,502 total rows). Add offset support to the search service and controller. Do not change anything else in the backend.
2. Write a test that fails against the old behavior: request offset 0 and offset 500 for a state with more than 500 providers and assert the two pages are disjoint and page 2 is non-empty. Run the entire existing backend test suite; all pre-existing tests must pass. If the fix breaks an existing test, fix the implementation, not the test, unless the test was asserting the buggy no-offset behavior (document that case).
3. Run the top-up: for each of the 9 seeded states (MD, VA, PA, NY, IL, OH, FL, TX, CA), fetch pages at offset 500 and 1000 (maxResults 500) through the API so pages 2 and 3 get cached. The top-up is idempotent (cached pages are re-served, not duplicated), so if interrupted, resume from the first (state, offset) pair that did not complete.
4. Verify: record per-state and total row counts in the providers table. Pass: every state has grown materially beyond ~500 (expected ~1,500 per state, ~13,500 total). If any state is still near 500, treat it as a pagination-fix failure: debug and fix before continuing. If the source API legitimately returns fewer results for a state (short final page), accept it and document the counts and reason.
5. Commit with a targeted stage of only the pagination files (service, controller, test). Confirm via git status that no client/ files are staged.

PHASE 2B - Analytics hardening (fix the confirmed bugs from docs/CODE_REVIEW.md before building the frontend on top):
1. src/services/analyticsService.js: make num() return null for NaN (non-finite) inputs instead of NaN.
2. getRanking: ORDER BY final_score DESC NULLS LAST, exclude null-scored rows from the window partition, return rank null with reason for unscored targets.
3. getRanking: compute percentile numerator and denominator over non-null rows only (COUNT(final_score) FILTER ... / COUNT(final_score)).
4. getBenchmark: return null or an explicit unscored status when providerScore or the quartiles are null/non-finite, before quartile classification.
5. getBenchmark: use COUNT(final_score) for peer_count so unscored peers are not counted.
6. getGroupPerformance: report scored counts alongside row counts; validate npis is an array of strings, cap at 5,000, 400 on empty array.
7. Add UNIQUE (npi, performance_year) to mips_performance_scores if not already present (verify DDL first), and add an index on (performance_year, npi) if missing. Update src/config/init.sql to match.
8. getTrends: add a warning field to the response stating that performance_year values are request labels on a rolling CMS vintage and year-over-year trends may reflect re-based scores rather than true performance change.
9. Write regression tests for each fix (null-scored provider ranking, NaN score benchmark, disjoint offset pages already covered, single-row group stddev). Run the full suite until green. Commit with targeted staging.

PHASE 3 - Frontend:
1. Inventory first: review the WIP commit and read every file under client/. Record for each file whether it is complete, partial, or broken, in client/ADOPTION_NOTES.md. Decide file by file what to keep, fix, or replace. Do not rewrite working files wholesale.
2. Before building data-fetching components, curl each endpoint you will consume (search, provider detail, group-performance, ranking, trends, benchmark, quality measures) against the live backend and record the actual response shapes. docs/FRONTEND_SPEC.md entries marked UNVERIFIED are hypotheses; the live backend is authoritative. Build to the backend shape and note discrepancies in the final summary. Do not change backend endpoints to match the spec.
3. Complete per docs/FRONTEND_SPEC.md: provider search with filters (name, state, city, taxonomy), provider detail view, MIPS dashboard with category bar chart and multi-year trend line chart (recharts), hospital quality measures table with national comparison badges. Vite dev proxy to the backend on port 3000.
4. Verify each page: start the Vite dev server; for each route (search, provider detail, MIPS dashboard, quality measures), load the page through the dev server and confirm the underlying API calls return HTTP 200 with non-empty data. Record one line per page (route, endpoint, status, row count). 4xx/5xx or empty data means not done.
5. Commit with targeted staging of client/ files only. This commit (or these commits) should reconcile with the WIP commit so history shows what was adopted vs built.

PHASE 4 - Docker:
1. Root Dockerfile and docker-compose.yml per section 9 of phynpi.md. Reference the same variable names .env defines, but never include secret values: use env_file: .env or ${VAR} interpolation in compose; never COPY .env or set secrets via ENV/ARG in the Dockerfile.
2. Create .dockerignore (at minimum: .env, node_modules, client/node_modules, .git, *.tmp.js, *.png) and confirm .env is in .gitignore.
3. Validate with docker compose config if available; if not, do a careful manual review and note that validation was skipped. Do not run docker compose build or up unless the environment supports it; report if skipped.
4. Commit with targeted staging.

FINAL CLEANUP AND SUMMARY:
1. Delete if present: analytics-verify.tmp.js, dbcheck.tmp.js, detail.png, mips.png, quality.png, search.png, plus any scratch files you created this session.
2. Run git status and audit the staged/unstaged lists one final time against the never-commit list.
3. Write the final summary to SUMMARY.md at the repo root and commit it: files adopted from the prior session vs newly built (per ADOPTION_NOTES.md), test results (new pagination and hardening tests plus full suite), per-state and total provider counts, page-by-page verification results, Docker validation result, known gaps (must include the rolling-vintage limitation on multi-year trends from CODE_REVIEW.md finding C1, and any shortfall states from the top-up).

Phase exit criteria: Phase 0 exits when the new test and full suite pass and counts are recorded; Phase 2B exits when all regression tests pass; Phase 3 exits when all four pages verify against the live backend; Phase 4 exits when compose config validates (or the skip is documented). Execute in order: Step 0, bootstrap, Phase 0, Phase 2B, Phase 3, Phase 4, final cleanup and summary. Phases 1 and 2 are already committed; do not touch them.
