const crypto = require('crypto');
const db = require('../config/database');
const { logger } = require('../utils/logger');

/**
 * Env-seeded API key set (Package C, single-operator bootstrap).
 *
 * There is no key-management UI yet, so keys come from the API_KEYS env var
 * as comma-separated `label:key` pairs, loaded once at startup into memory.
 * Lookup compares SHA-256 digests with a constant-time comparison so key
 * material never sits in a plain-object map keyed by the raw secret.
 *
 * Format: API_KEYS="billing:secret-one,partner:secret-two"
 */
function parseEnvKeys(raw) {
  const keys = new Map(); // sha256(rawKey) -> label
  for (const pair of String(raw || '').split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    if (sep <= 0 || sep === trimmed.length - 1) {
      logger.warn('apiKeyService: ignoring malformed API_KEYS entry (expected label:key)');
      continue;
    }
    const label = trimmed.slice(0, sep).trim();
    const key = trimmed.slice(sep + 1).trim();
    if (!label || !key) continue;
    keys.set(crypto.createHash('sha256').update(key).digest('hex'), label);
  }
  return keys;
}

const keyIndex = parseEnvKeys(process.env.API_KEYS);

function timingSafeEqualHex(a, b) {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

class ApiKeyService {
  constructor(index = keyIndex) {
    this.index = index;
  }

  configured() {
    return this.index.size > 0;
  }

  /** Returns the key's label on match, null otherwise. Constant-time. */
  authenticate(rawKey) {
    if (!rawKey || typeof rawKey !== 'string') return null;
    const digest = crypto.createHash('sha256').update(rawKey).digest('hex');
    for (const [hash, label] of this.index) {
      if (timingSafeEqualHex(digest, hash)) return label;
    }
    return null;
  }

  /** Fire-and-forget metering row; a logging failure must never break a request. */
  recordUsage({ keyLabel, endpoint, method, status }) {
    db.query(
      'INSERT INTO api_usage (key_label, endpoint, method, status) VALUES ($1, $2, $3, $4)',
      [keyLabel, endpoint, method, status]
    ).catch(error => logger.error('api_usage insert failed:', error));
  }

  /**
   * Per-key totals and per-endpoint breakdowns for the last `days` days.
   * Output is capped: at most 100 keys and 500 breakdown rows.
   */
  async getUsage({ days = 30 } = {}) {
    const window = Math.min(Math.max(parseInt(days, 10) || 30, 1), 90);
    const params = [`${window} days`];

    const byKeySql = `
      SELECT key_label,
             count(*)::int AS requests,
             count(*) FILTER (WHERE status >= 400)::int AS errors,
             min(created_at) AS first_used,
             max(created_at) AS last_used
        FROM api_usage
       WHERE created_at >= now() - $1::interval
       GROUP BY key_label
       ORDER BY requests DESC
       LIMIT 100
    `;
    const byEndpointSql = `
      SELECT key_label, endpoint, method, count(*)::int AS requests
        FROM api_usage
       WHERE created_at >= now() - $1::interval
       GROUP BY key_label, endpoint, method
       ORDER BY requests DESC
       LIMIT 500
    `;

    const [byKey, byEndpoint] = await Promise.all([
      db.query(byKeySql, params),
      db.query(byEndpointSql, params)
    ]);

    return {
      days: window,
      byKey: byKey.rows,
      byEndpoint: byEndpoint.rows,
      capped: byKey.rows.length >= 100 || byEndpoint.rows.length >= 500
    };
  }
}

module.exports = ApiKeyService;
