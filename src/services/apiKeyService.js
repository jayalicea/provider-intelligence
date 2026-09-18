const crypto = require('crypto');
const db = require('../config/database');
const { logger } = require('../utils/logger');

/**
 * API key set (Package C).
 *
 * At startup the active (non-revoked) rows of the api_keys table are loaded
 * into memory by loadFromDatabase(); if the table is unreadable or missing,
 * the service falls back to keys from the API_KEYS env var (comma-separated
 * `label:key` pairs). Lookup compares SHA-256 digests with a constant-time
 * comparison so key material never sits in a plain-object map keyed by the
 * raw secret, and never queries the database per request.
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
  constructor(index = parseEnvKeys(process.env.API_KEYS)) {
    this.index = index;
    this.source = 'env';
  }

  /** Reload the in-memory set from the API_KEYS env var. */
  useEnvKeys() {
    this.index = parseEnvKeys(process.env.API_KEYS);
    this.source = 'env';
  }

  /**
   * Replace the in-memory key set with the active rows of the api_keys table.
   * Revoked rows (revoked_at set) are excluded. On any database error the
   * env-seeded set is kept and a warning is logged, so a missing table or a
   * DB outage never takes down authentication.
   */
  async loadFromDatabase() {
    try {
      const { rows } = await db.query(
        'SELECT key_hash, label FROM api_keys WHERE revoked_at IS NULL'
      );
      const index = new Map();
      for (const row of rows) {
        if (row.key_hash && row.label) index.set(String(row.key_hash), String(row.label));
      }
      this.index = index;
      this.source = 'database';
      logger.info(`apiKeyService: loaded ${index.size} active key(s) from api_keys`);
    } catch (error) {
      logger.warn(`apiKeyService: api_keys unreadable (${error.message}); using API_KEYS env keys`);
    }
  }

  /**
   * Periodic hot-reload entry point. Safe to call on a schedule: any DB
   * error is caught here and in loadFromDatabase(), so a failed reload never
   * rejects and never replaces the currently served key set.
   */
  async reloadKeys() {
    try {
      await this.loadFromDatabase();
    } catch (error) {
      logger.warn(`apiKeyService: periodic reload failed (${error.message}); keeping previous key set`);
    }
  }

  /**
   * Start reloading the key set from the api_keys table every `intervalMs`.
   * Defaults to API_KEY_RELOAD_SECONDS (default 60) when intervalMs is not a
   * positive number. Calling startReloading again replaces the timer.
   */
  startReloading(intervalMs) {
    this.stopReloading();
    const envSeconds = parseInt(process.env.API_KEY_RELOAD_SECONDS, 10);
    const seconds = Number.isFinite(envSeconds) && envSeconds > 0 ? envSeconds : 60;
    const ms = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : seconds * 1000;
    this._reloadTimer = setInterval(() => {
      this.reloadKeys().catch(error => {
        logger.warn(`apiKeyService: periodic reload failed (${error.message}); keeping previous key set`);
      });
    }, ms);
    if (typeof this._reloadTimer.unref === 'function') this._reloadTimer.unref();
    return this._reloadTimer;
  }

  /** Stop the periodic reload timer, if running. */
  stopReloading() {
    if (this._reloadTimer) {
      clearInterval(this._reloadTimer);
      this._reloadTimer = null;
    }
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
// Shared instance so the auth middleware and the admin controller agree on
// the same in-memory key set.
module.exports.shared = new ApiKeyService(keyIndex);
