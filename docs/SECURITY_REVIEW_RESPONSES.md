# Security Review Responses

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
