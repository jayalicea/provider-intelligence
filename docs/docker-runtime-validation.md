# Docker runtime validation

Record of validating the compose stack (`docker-compose.yml`, `Dockerfile`)
for the Provider Intelligence Platform.

## 2026-09-17: full runtime validation on the maintainer's machine

**Pass.** The stack was built, started, health-checked, and torn down on the
Windows maintainer host (Docker Desktop, engine 29.7.2, compose v5.5.1).

| Check | Result |
|---|---|
| `docker compose config` | **pass**, exit 0 |
| `docker compose up -d --build` | **pass** — db and app containers created, db `healthy` before app start |
| App container healthcheck | **pass** — `Up (healthy)` |
| `GET /health` | **pass** — `{"status":"healthy",...}` |
| `GET /api/v1/providers/search?state=MD&maxResults=5` | **pass** — HTTP 200 from the containerized app against the live NPI API |
| `docker compose down` | **pass** — containers and network removed cleanly |

The earlier "blocked" rows below refer to the build container's egress policy
only; they are superseded.

## Earlier attempt, in short

**The stack could not be brought up in the build container, so the smoke tests
were not run there.** The Docker daemon runs and compose resolves the
configuration, but no image can be pulled: the Docker Hub layer CDN is refused
by that environment's egress policy. Two genuine gaps were found and fixed by
inspection and offline validation; the runbook below is retained as a
reference.

## What was validated here

| Check | Result |
|---|---|
| Docker daemon reachable | yes (started in-container; `Server Version: 29.3.1`, storage driver `overlayfs`) |
| `docker compose version` | v5.1.1 |
| `docker compose config` resolves and interpolates | **pass**, exit 0 |
| `${DB_PASSWORD:?...}` interpolation from `.env` | **pass** — resolves into `POSTGRES_PASSWORD` |
| Both service healthchecks well-formed in the resolved config | **pass** |
| App healthcheck probe logic | **pass** — exit 0 against a live `/health`, exit 1 against a dead port |
| `/health` responds | **pass** — `{"status":"healthy","timestamp":...,"version":"1.0.0"}` |
| `.env` excluded from the image | **pass** — `.dockerignore` lists `.env` and `.env.*` |
| `docker compose build app` | **blocked** |
| `docker compose up -d --wait` | **blocked** |
| Smoke tests (`/health`, search, verification, watchlist) | **not run** |

## Why the image pull is blocked

```
docker pull postgres:15-alpine
15-alpine: Pulling from library/postgres
failed to copy: httpReadSeeker: failed open: failed to do request:
Get "https://production.cloudfront.docker.com/registry-v2/.../data?...": Forbidden
```

Narrowed down by probing each host the pull touches:

| Host | Result |
|---|---|
| `auth.docker.io/token` | 200 — allowed |
| `registry-1.docker.io/v2/` | 401 — allowed (401 is the normal unauthenticated answer) |
| `production.cloudfront.docker.com` | **CONNECT refused** |

So manifests resolve and the pull begins, then dies fetching layers. `docker
images` is empty, so nothing is cached to fall back on. This is a policy denial
rather than a transient failure, and the same policy blocks `www.nucc.org` and
`clinicaltables.nlm.nih.gov` (see `docs/taxonomy-crosswalk.md`).

Nothing in the compose configuration causes it, and no change to the stack can
work around it.

## Fixes that were genuinely required

### 1. `.env.example` did not exist

`docker-compose.yml` declares `env_file: .env` and interpolates
`${DB_PASSWORD:?DB_PASSWORD must be set in .env}`. Both require a `.env` that
is gitignored, and the repository carried no template — so a fresh clone could
not start the stack at all, and nothing documented which variables it needed.

`.dockerignore` already carried `!.env.example`, so the file was anticipated by
the project's own tooling and simply missing. It is now present, with
`DB_PASSWORD` marked required and a note that `DB_HOST`/`DB_PORT` only matter
for a non-compose run (the app service overrides them to `db:5432`).

No secret is committed: `.env.example` carries `change_me`.

### 2. The app service had no healthcheck

`depends_on: db: condition: service_healthy` makes the app wait for the
database, but nothing waited for the app. `docker compose up -d --wait` would
report the stack ready the moment the app container started — before Express
was listening — so a smoke test immediately afterwards could race it.

An app healthcheck now polls `/health`. The probe runs `node -e` rather than
`curl` or `wget`, so it depends on nothing beyond the image's own runtime; the
probe logic was verified directly (exit 0 against a live `/health`, exit 1
against a dead port).

## Runbook for a host that can pull images

```bash
cp .env.example .env          # then set DB_PASSWORD
docker compose build app
docker compose up -d --wait   # blocks until db and app are both healthy
```

Then smoke test **from inside the compose network**, so the app is reached by
its service name rather than a published port:

```bash
# 1. health
docker compose exec -T app node -e \
  "require('http').get('http://app:3000/health',r=>{r.pipe(process.stdout)})"

# 2. one search
docker compose exec -T app node -e \
  "require('http').get('http://app:3000/api/v1/providers/search?terms=smith&maxResults=5',r=>{r.pipe(process.stdout)})"

# 3. one verification dossier (any NPI cached in this database)
docker compose exec -T app node -e \
  "require('http').get('http://app:3000/api/v1/providers/1366446619/verification',r=>{r.pipe(process.stdout)})"

# 4. one watchlist call
docker compose exec -T app node -e \
  "require('http').get('http://app:3000/api/v1/intelligence/exclusion-watchlist?days=90',r=>{r.pipe(process.stdout)})"

docker compose down
```

Expected: (1) `{"status":"healthy",...}`; (2) `{"success":true,"data":[...]}`
(this one calls the NIH Clinical Tables API, so it needs outbound access to
`clinicaltables.nlm.nih.gov`); (3) a dossier, or 404 if that NPI is not cached;
(4) `{"success":true,"data":[...]}` — an empty array until the LEIE is loaded.

Searches 2 and 3 reach upstream government APIs; 1 and 4 are local-only.

## Notes on the database bootstrap

`src/config/init.sql` is mounted into `/docker-entrypoint-initdb.d/`, which
Postgres runs **only when the data directory is empty** — i.e. on first start
of the `postgres_data` volume. After a schema change, either apply the SQL by
hand or recreate the volume:

```bash
docker compose down -v && docker compose up -d --wait
```

`down -v` destroys the cached provider, MIPS and exclusion data in that volume.
