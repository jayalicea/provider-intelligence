# Prompt Review: Provider Intelligence Platform Resume Prompt

Red team analysis of the resume prompt for an autonomous coding agent. Findings are grouped into (1) ambiguities, (2) ordering problems, (3) missing instructions. Each finding quotes the exact problem wording, explains the failure mode, and gives exact replacement wording. A full corrected rewrite of the prompt is at the end.

---

## 1. Ambiguities

### Finding 1.1: "Adopt and complete" is undefined (no inventory step)

Problem wording:

> "Adopt and complete the uncommitted client/ work rather than starting over."

Failure mode: The agent is told what to do (adopt) but not how to evaluate what exists. Without an explicit inventory step (git status, git diff, reading each new file under src/), the agent may (a) rewrite working code because it does not match the agent's preferred style, (b) keep broken half-finished code because it assumes prior work was correct, or (c) mix the two unpredictably. The final "summary of what was adopted vs newly built" is impossible to write accurately if no inventory was ever taken.

Replacement wording:

> "First, inventory the uncommitted work before writing any code: run git status and git diff, list every modified and new file under client/, read each one, and record for each file whether it is complete, partial, or broken. Write this inventory to client/ADOPTION_NOTES.md (or the scratch location you use for the final summary). Only then decide, file by file, what to keep, fix, or replace. Do not rewrite a working file wholesale; extend or repair it."

### Finding 1.2: Scope of each "Commit" is undefined

Problem wording:

> "Add offset support to the search service and controller, write a test for it, then run a top-up ... Commit."

and

> "Then continue phases in order, committing after each"

Failure mode: The working tree already contains uncommitted client/ changes when Phase 0 begins. A bare "Commit." instruction invites `git commit -am` or `git add -A`, which sweeps the half-finished frontend into the Phase 0 backend commit. Conversely, if the frontend was stashed, a careless `git stash pop` at the wrong time can collide with later edits. The prompt never says to use targeted staging or what each commit must contain.

Replacement wording:

> "Commit with a targeted stage only: git add the specific files changed for pagination (search service, search controller, new test file). Verify with git status immediately before committing that no client/ files are staged. Never use git add -A, git add ., or git commit -a for any phase commit."

### Finding 1.3: "Verify each page renders against the live backend" has no procedure

Problem wording:

> "Verify each page renders against the live backend."

Failure mode: "Verify" and "live backend" are both undefined. The agent does not know whether the backend is already running, whether it should start it (npm run dev? node server?), which .env file to use, whether the database is up, which port the Vite dev server should occupy, or what counts as "renders" (HTTP 200 from curl? a browser screenshot? absence of console errors?). An agent may mark the phase done after `vite build` succeeds, never having loaded a page, or may hang waiting for a backend that was never started.

Replacement wording:

> "Start the backend if it is not already listening on port 3000 (check with curl http://localhost:3000/health or the equivalent; if not running, start it with the project's documented start command using the existing .env). Start the Vite dev server and, for each route (search, provider detail, MIPS dashboard, quality measures), fetch the page through the dev server and confirm the underlying API calls return HTTP 200 with non-empty JSON. Record one verification line per page (route, API endpoint hit, response status, row count) for the final summary. A page that returns 4xx/5xx or empty data is not 'rendered'."

### Finding 1.4: "environment variables aligned with .env" is unsafe and vague

Problem wording:

> "Root Dockerfile and docker-compose.yml per section 9 of phynpi.md, environment variables aligned with .env"

Failure mode: Three distinct risks. (a) The agent may COPY .env into the image or bake secrets into the Dockerfile as ENV lines. (b) The agent may commit .env or an env_file reference that leaks values. (c) "Aligned" is undefined: does it mean compose passes through the same variable names, or duplicates the values? The separate constraint "never print .env secrets" is not scoped to the Docker phase, so the agent may not connect the two.

Replacement wording:

> "Docker must reference the same variable names that .env defines, but must never contain secret values: docker-compose.yml should use env_file: .env or ${VAR} interpolation, the Dockerfile must not COPY .env or set any secret with ENV/ARG, and you must create a .dockerignore (at minimum: .env, node_modules, client/node_modules, .git, *.tmp.js, *.png) and confirm .env is already in .gitignore. Never print, echo, cat, or log .env contents at any point."

### Finding 1.5: "database is read-only except for the Phase 0 top-up" is imprecisely scoped

Problem wording:

> "the database is read-only except for the Phase 0 top-up"

Failure mode: "Read-only" is ambiguous about what counts as a write. The top-up itself writes cache rows, so the constraint contradicts itself unless scoped. The agent cannot tell whether migrations, schema changes, TRUNCATE/reseed for testing, or inserting fixture rows for frontend development are allowed. An overcautious agent may refuse the top-up; an undercautious one may run a migration.

Replacement wording:

> "The only permitted database writes are INSERT operations on the provider cache tables performed by the Phase 0 top-up via the existing search endpoint. No schema changes, no migrations, no DELETE/UPDATE/TRUNCATE, no manual SQL inserts, and no writes of any kind after Phase 0 completes. All other phases must treat the database as strictly read-only."

### Finding 1.6: No handling for spec vs reality mismatches in FRONTEND_SPEC

Problem wording:

> "Finish the React frontend per docs/FRONTEND_SPEC.md"

Failure mode: Response shapes in FRONTEND_SPEC.md are marked UNVERIFIED. If the agent builds against the spec's assumed shapes and the live API differs, every page renders empty or crashes, and the failure surfaces only at final verification (or never). The prompt gives no precedence rule: is the spec authoritative or the live backend?

Replacement wording:

> "Before building any data-fetching component, verify the response shape of each endpoint you will consume (search, provider detail, group-performance, ranking, trends, benchmark, quality measures) with curl against the live backend, and record the actual shapes. FRONTEND_SPEC.md sections marked UNVERIFIED are hypotheses, not contracts: the live backend response shape is authoritative. Where the spec and backend differ, build to the backend and note the discrepancy in the final summary. Do not modify backend endpoints to match the spec."

---

## 2. Ordering problems

### Finding 2.1: Phase 0 "Commit" happens before the uncommitted frontend work is protected

Problem wording:

> "A previous session died mid Phase 3: the working tree contains uncommitted frontend work in client/ ..."
> "PHASE 0 - Pagination fix and data top-up (do this first): ... Commit."

Failure mode: This is the single most dangerous gap. The prompt orders Phase 0 (including a commit) before any instruction to secure the uncommitted client/ work. Concrete failure modes: (a) the Phase 0 commit sweeps the frontend files into an unrelated backend commit, entangling history and making the "adopted vs newly built" summary unrecoverable; (b) the agent runs git checkout, git reset --hard, or git stash to get a clean tree for Phase 0 testing and loses the work permanently; (c) the agent hand-copies files aside and restores them incorrectly.

Replacement wording:

> "STEP 0 (before everything, before Phase 0): protect the uncommitted work. Run git status and git stash list to confirm the current state, then create a WIP commit of all uncommitted client/ changes on the current branch with message 'WIP: adopt prior session frontend work (uncommitted state at resume)'. This commit is not final; you will amend or build on it in Phase 3. If you prefer a branch, create client-wip and commit there, then return to the main branch for Phase 0. Do not run git reset --hard, git checkout --, or git clean at any point in this session. Verify after this step that git status is clean and the client/ files still exist on disk."

(Note: a WIP commit on the main branch followed by Phase 0 work on top is also acceptable if the prompt states that the Phase 3 commit will reconcile; the critical requirement is that the work is committed somewhere recoverable before any other git or build operation.)

### Finding 2.2: Phase numbering confusion and no failure policy for the top-up

Problem wording:

> "PHASE 0 - Pagination fix and data top-up (do this first)"
> "Then continue phases in order, committing after each"

Failure mode: "Continue phases in order" after an inserted Phase 0 is confusing (order is 0, 3, 4; phases 1 and 2 are done). Worse, the top-up is a multi-step external operation with no retry, idempotency, or partial-failure policy: if the run dies after 4 of 9 states, the agent does not know whether re-running is safe (duplicate rows?), whether to resume from the failed state, or whether to block Phase 3. Since the top-up goes "through the API," re-running pages should hit cache, but the prompt never says the caching is idempotent, so an agent may assume it is or is not, with no way to check.

Replacement wording:

> "Execute phases in this order: Step 0 (protect uncommitted work), Phase 0 (pagination plus top-up), Phase 3 (frontend), Phase 4 (Docker). Phases 1 and 2 are already committed; do not touch them. The top-up is resumable: it issues the same paginated API calls, and already-cached pages are served from cache, so re-running it after an interruption is safe and will not duplicate provider rows. If the top-up is interrupted, resume from the first (state, offset) pair that did not return a full page. If any state's total after the top-up is still near 500, the pagination fix is not working; stop and fix it before proceeding to Phase 3."

### Finding 2.3: No policy when the row-count target is missed

Problem wording:

> "Verify the providers table grows toward ~13,500 rows and report final counts."

Failure mode: "Grows toward" is not a pass/fail criterion. If the table reaches 11,000 rows, the agent does not know whether to accept, investigate, or halt. Combined with no retry policy, the agent may either stall Phase 0 forever retrying a source API that simply has fewer results, or sail past a broken pagination fix that capped every state at 500.

Replacement wording:

> "After the top-up, record the providers row count per state and in total. Pass criteria: each of the 9 states has grown materially beyond its pre-top-up count of ~500 (expected ~1,500 per state, ~13,500 total). If a state is still at or near its pre-top-up count, treat it as a failure of the pagination fix or the top-up loop, debug it, and do not proceed to Phase 3 until resolved. If the source API simply returns fewer results for some states (e.g. a short final page), accept the shortfall, document the per-state counts and the reason in the final summary, and proceed."

---

## 3. Missing instructions

### Finding 3.1: No test gate; nothing says to run the existing suite

Problem wording:

> "Add offset support to the search service and controller, write a test for it"

Failure mode: The agent writes one new test but is never told to run the existing test suite. The pagination fix touches a committed backend service; if it breaks existing search tests, nothing in the prompt catches it, and the constraint "do not modify the committed backend services beyond the Phase 0 pagination fix" could be silently violated in spirit (behavioral regression without code change elsewhere).

Replacement wording:

> "Write a test proving offset returns a distinct, non-overlapping page (e.g. page at offset 0 and page at offset 500 share zero provider IDs). Then run the entire existing backend test suite, not just the new test. All pre-existing tests must pass; if the pagination fix breaks any of them, fix the implementation, not the existing tests, unless a test was itself asserting the buggy no-offset behavior (in that case, document the change)."

### Finding 3.2: No general junk/guardrail check before the final commit

Problem wording:

> "Cleanup in the final commit: delete analytics-verify.tmp.js, dbcheck.tmp.js, and the root-level PNG screenshots (detail.png, mips.png, quality.png, search.png) if still present."

Failure mode: The cleanup list is exhaustive-sounding but actually enumerates only known junk. The agent may itself create new junk (scratch scripts, node_modules accidentally staged, dist/ build output, .env, screenshots it took for verification) and commit it, because nothing says to audit the staged set. The four PNGs named are suspiciously likely to be regenerated by the agent during Phase 3 verification.

Replacement wording:

> "Before every commit, and especially the final one, run git status and review the staged file list. Never commit: node_modules/, dist/, .env, *.tmp.js, verification screenshots, or any file you created for scratch/debugging. Delete the known junk if present (analytics-verify.tmp.js, dbcheck.tmp.js, detail.png, mips.png, quality.png, search.png) and also remove any equivalent scratch files you created during this session."

### Finding 3.3: No startup/environment bootstrap instructions

Problem wording: (absent entirely; the prompt assumes a running system)

> "Vite dev proxy to the backend on port 3000."

Failure mode: The agent does not know whether dependencies are installed (client/node_modules may not exist after a dead session), whether the database container/service is up, or whether the backend is running. It may burn its budget rediscovering the environment or, worse, run a fresh npm install that rewrites package-lock.json, which then pollutes the "adopted" package files and confuses the adopt-vs-rebuild decision.

Replacement wording:

> "Environment bootstrap, first thing after Step 0: confirm the database is reachable and the backend starts with the existing .env; if backend dependencies are missing, run npm install (not npm upgrade) in the backend; if client/node_modules is missing, run npm install in client/ using the existing package-lock.json, and do not modify package.json or package-lock.json unless a dependency is genuinely missing from the uncommitted work (document any such change)."

### Finding 3.4: No definition of done per phase and no destination for the summary

Problem wording:

> "Finish with a summary of what was adopted vs newly built, test results, final database counts, and known gaps."

Failure mode: "Finish with a summary" does not say where the summary goes (stdout only? a file? a committed file?), and no phase has explicit exit criteria, so the agent decides for itself when each phase is done. Summaries printed only to the transcript are lost when the session ends, repeating the exact failure that created this mess.

Replacement wording:

> "Each phase is done only when its exit criteria are met: Phase 0 exits when the new test plus full suite pass and per-state counts are recorded; Phase 3 exits when all four pages are verified against the live backend per the verification procedure; Phase 4 exits when docker compose config (or manual inspection if unavailable) validates and the .dockerignore check passes. Write the final summary to SUMMARY.md at the repo root and commit it (or to the location the human specified), covering: files adopted from the uncommitted work vs files newly built, full test output summary, per-state and total provider counts, Docker validation result, and known gaps."

### Finding 3.5: No guardrail against destructive git operations

Problem wording: (absent)

Failure mode: Autonomous agents recovering from failed builds or merge confusion commonly reach for git reset --hard, git checkout -- ., git clean -fd, or git stash drop. With uncommitted work being the whole point of the session, any of these is catastrophic and irreversible. The prompt must prohibit them explicitly because no other instruction does.

Replacement wording:

> "Prohibited for the entire session: git reset --hard, git checkout --, git restore ., git clean, git stash drop, git push --force, and deleting any file outside the explicit cleanup list without first confirming it is your own scratch file. If you believe the tree is corrupted, stop and report instead of resetting."

### Finding 3.6: "write a test for it" does not specify what the test must prove

Problem wording:

> "write a test for it"

Failure mode: A test that merely asserts HTTP 200 on a request with offset=500 can pass even if offset is still ignored (same first page returned again). The regression the prompt exists to fix requires asserting non-overlap or distinct content.

Replacement wording:

> "The test must fail against the old behavior: request page 1 (offset 0) and page 2 (offset 500) for a state with more than 500 providers and assert the two result sets are disjoint and page 2 is non-empty. A test that would pass with offset ignored is not acceptable."

---

## Corrected full rewrite of the prompt

> ---
> Resume the Provider Intelligence Platform. git log shows phases 1 and 2 committed (grounding docs in AGENTS.md and CORRECTIONS.md, analytics service with group-performance, ranking, trends, benchmark endpoints). A previous session died mid Phase 3: the working tree contains uncommitted frontend work in client/ (modified App.jsx, index.css, vite.config.js, index.html, package files, plus new src/api, src/components, src/hooks, src/pages directories). That uncommitted work is valuable and irreplaceable; protecting it is your first job.
>
> GLOBAL RULES (apply all session):
> - Prohibited git operations: git reset --hard, git checkout --, git restore ., git clean, git stash drop, git push --force. If the tree seems corrupted, stop and report instead of resetting.
> - Never use git add -A, git add ., or git commit -a. Stage files explicitly by name and run git status immediately before every commit to confirm only intended files are staged.
> - Never commit: node_modules/, dist/, .env, *.tmp.js, screenshots, or scratch/debug files.
> - Never print, echo, cat, or log .env contents.
> - Database: the only permitted writes are INSERTs into the provider cache tables via the existing search endpoint during the Phase 0 top-up. No schema changes, migrations, DELETE/UPDATE/TRUNCATE, or manual SQL. All other phases are strictly read-only against the database.
> - Do not modify committed backend services except the Phase 0 pagination fix.
>
> STEP 0 - Protect uncommitted work (before anything else): run git status and git stash list. Create a WIP commit of all uncommitted client/ changes with message "WIP: adopt prior session frontend work (uncommitted state at resume)". Verify git status is clean and the client/ files still exist on disk. Only then proceed.
>
> ENVIRONMENT BOOTSTRAP: confirm the database is reachable. Check whether the backend is listening on port 3000 (curl the health or root endpoint); if not, start it using the existing .env. If dependencies are missing, run npm install (never npm upgrade) in backend and/or client/ using the existing lockfiles. Do not modify package.json or lockfiles unless a dependency is genuinely missing; document any such change.
>
> PHASE 0 - Pagination fix and data top-up:
> 1. The search endpoint ignores the offset parameter (confirmed: 9 states seeded 3 pages each produced only ~500 unique providers per state, 4,502 total rows). Add offset support to the search service and controller. Do not change anything else in the backend.
> 2. Write a test that fails against the old behavior: request offset 0 and offset 500 for a state with more than 500 providers and assert the two pages are disjoint and page 2 is non-empty. Run the entire existing backend test suite; all pre-existing tests must pass. If the fix breaks an existing test, fix the implementation, not the test, unless the test was asserting the buggy no-offset behavior (document that case).
> 3. Run the top-up: for each of the 9 seeded states (MD, VA, PA, NY, IL, OH, FL, TX, CA), fetch pages at offset 500 and 1000 (maxResults 500) through the API so pages 2 and 3 get cached. The top-up is idempotent (cached pages are re-served, not duplicated), so if interrupted, resume from the first (state, offset) pair that did not complete.
> 4. Verify: record per-state and total row counts in the providers table. Pass: every state has grown materially beyond ~500 (expected ~1,500 per state, ~13,500 total). If any state is still near 500, treat it as a pagination-fix failure: debug and fix before continuing. If the source API legitimately returns fewer results for a state (short final page), accept it and document the counts and reason.
> 5. Commit with a targeted stage of only the pagination files (service, controller, test). Confirm via git status that no client/ files are staged.
>
> PHASE 3 - Frontend:
> 1. Inventory first: run git show on the WIP commit (or review the files on disk) and read every file under client/. Record for each file whether it is complete, partial, or broken, in client/ADOPTION_NOTES.md. Decide file by file what to keep, fix, or replace. Do not rewrite working files wholesale.
> 2. Before building data-fetching components, curl each endpoint you will consume (search, provider detail, group-performance, ranking, trends, benchmark, quality measures) against the live backend and record the actual response shapes. FRONTEND_SPEC.md entries marked UNVERIFIED are hypotheses; the live backend is authoritative. Build to the backend shape and note discrepancies in the final summary. Do not change backend endpoints to match the spec.
> 3. Complete per docs/FRONTEND_SPEC.md: provider search with filters (name, state, city, taxonomy), provider detail view, MIPS dashboard with category bar chart and multi-year trend line chart (recharts), hospital quality measures table with national comparison badges. Vite dev proxy to the backend on port 3000.
> 4. Verify each page: start the Vite dev server; for each route (search, provider detail, MIPS dashboard, quality measures), load the page through the dev server and confirm the underlying API calls return HTTP 200 with non-empty data. Record one line per page (route, endpoint, status, row count). 4xx/5xx or empty data means not done.
> 5. Commit with targeted staging of client/ files only. This commit (or these commits) should reconcile with the WIP commit so history shows what was adopted vs built.
>
> PHASE 4 - Docker:
> 1. Root Dockerfile and docker-compose.yml per section 9 of phynpi.md. Reference the same variable names .env defines, but never include secret values: use env_file: .env or ${VAR} interpolation in compose; never COPY .env or set secrets via ENV/ARG in the Dockerfile.
> 2. Create .dockerignore (at minimum: .env, node_modules, client/node_modules, .git, *.tmp.js, *.png) and confirm .env is in .gitignore.
> 3. Validate with docker compose config if available; if not, do a careful manual review and note that validation was skipped. Do not run docker compose build or up unless the environment supports it; report if skipped.
> 4. Commit with targeted staging.
>
> FINAL CLEANUP AND SUMMARY:
> 1. Delete if present: analytics-verify.tmp.js, dbcheck.tmp.js, detail.png, mips.png, quality.png, search.png, plus any scratch files you created this session.
> 2. Run git status and audit the staged/unstaged lists one final time against the never-commit list.
> 3. Write the final summary to SUMMARY.md at the repo root and commit it: files adopted from the prior session vs newly built (per ADOPTION_NOTES.md), test results (new pagination test plus full suite), per-state and total provider counts, page-by-page verification results, Docker validation result, and known gaps.
>
> Phase exit criteria: Phase 0 exits when the new test and full suite pass and counts are recorded; Phase 3 exits when all four pages verify against the live backend; Phase 4 exits when compose config validates (or the skip is documented). Execute in order: Step 0, bootstrap, Phase 0, Phase 3, Phase 4, final cleanup and summary. Phases 1 and 2 are already committed; do not touch them.
> ---

---

## Severity summary

Most dangerous gaps, ranked: (1) the missing Step 0 protection of uncommitted client/ work combined with a Phase 0 "Commit" creates a direct path to sweeping the frontend into a wrong commit or destroying it with a reset, which is the only irreversible failure in the prompt; (2) undefined commit scoping plus no prohibition on git add -A / reset --hard removes every guardrail that would catch mistake (1); (3) the unverified FRONTEND_SPEC shapes with no verify-first instruction means the entire frontend phase can be built against wrong API contracts and fail only at the end; (4) the top-up has no pass/fail criterion, retry, or idempotency policy, so a silent pagination-fix failure propagates into every later phase; (5) "verify renders" and the Docker .env handling are undefined in ways that respectively allow fake completion and secret leakage into an image or commit.
