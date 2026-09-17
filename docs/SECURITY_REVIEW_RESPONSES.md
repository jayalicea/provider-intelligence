# Security Review Responses

The response log for [SECURITY_REVIEW.md](SECURITY_REVIEW.md): what has been
done about that backlog, package by package, and what was deferred on purpose.
The review file holds the findings and an inspection banner; this file holds
the answers. Claims below were re-verified against the code on 2026-09-15.

## Package C: API keys and metering (2026-09-14)

- **Write protection.** All non-GET endpoints under `/api/v1` require an
  `X-API-Key` header validated against the env-seeded key set (constant-time
  compare of SHA-256 digests). GET endpoints remain open, matching the
  product's public-data posture (every upstream source is a free public
  government API).
- **Key storage.** Keys live in the `API_KEYS` env var as comma-separated
  `label:key` pairs and are loaded into memory at startup. The `api_keys`
  table is provisioned by migration `20260914_api_keys_usage.sql` but is not
  yet read at runtime.
- **DEFERRED: key-management UI.** Issuing, rotating, and revoking keys
  still requires editing `API_KEYS` and restarting the service. Runtime key
  management backed by the `api_keys` table (with `revoked_at` honored at
  authentication time) is deferred to a follow-up once an operator UI
  exists. Until then, key rotation is an env edit plus a bounce, and a
  revoked key is removed from `API_KEYS` rather than flagged in the table.
- **Metering.** Every API-key-authenticated request writes one row to
  `api_usage` (key_label, endpoint pattern, method, status).
  `GET /api/v1/admin/usage?days=N` reports per-key totals and per-endpoint
  breakdowns and requires a valid key itself.

## Package P0: bulk-data removal (2026-09-17)

- **P0-1 closed.** `POST /api/v1/providers/bulk-data` is removed from the
  public API surface entirely: route (`src/routes/providerRoutes.js`),
  controller method (`bulkProviderData`), and the service methods that existed
  only for it (`getBulkMipsPerformance`, `chunkArray` in
  `src/services/cmsDataService.js`). Bulk data loads remain offline jobs in
  `tools/`; `docs/openapi.yaml`, `README.md`, `docs/README.md`, and
  `docs/FRONTEND_SPEC.md` no longer list the endpoint.
