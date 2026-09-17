#!/usr/bin/env node
/**
 * API key lifecycle management, backed by the api_keys table.
 *
 * Only SHA-256 digests are stored. The raw key is printed exactly once, at
 * issue time; there is no way to recover it afterwards.
 *
 * Usage:
 *   node tools/api-keys.js issue <label>
 *   node tools/api-keys.js list
 *   node tools/api-keys.js revoke <label>
 *
 * Reads DB_* env vars (or a local .env in the repo root).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha256hex = value => crypto.createHash('sha256').update(value).digest('hex');

// 24 random bytes = 192 bits of key material, base64url-encoded.
function generateKey() {
  return crypto.randomBytes(24).toString('base64url');
}

async function issueKey(client, label) {
  if (!label || !String(label).trim()) throw new Error('a label is required');
  const key = generateKey();
  await client.query(
    'INSERT INTO api_keys (key_hash, label) VALUES ($1, $2)',
    [sha256hex(key), String(label).trim()]
  );
  return { label: String(label).trim(), key };
}

async function listKeys(client) {
  const { rows } = await client.query(
    'SELECT label, created_at, revoked_at FROM api_keys ORDER BY created_at ASC'
  );
  return rows;
}

async function revokeKey(client, label) {
  if (!label) throw new Error('a label is required');
  const res = await client.query(
    'UPDATE api_keys SET revoked_at = now() WHERE label = $1 AND revoked_at IS NULL',
    [label]
  );
  if (!res.rowCount) throw new Error(`no active key with label "${label}"`);
  return res.rowCount;
}

function readEnvFile() {
  const env = {};
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch (e) { /* fall back to process env / defaults */ }
  return env;
}

async function main() {
  const [command, label] = process.argv.slice(2);
  if (!['issue', 'list', 'revoke'].includes(command)) {
    console.error('usage: node tools/api-keys.js <issue <label>|list|revoke <label>>');
    process.exit(1);
  }

  const env = readEnvFile();
  const { Client } = require('pg');
  const client = new Client({
    host: env.DB_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || process.env.DB_PORT || '5432', 10),
    database: env.DB_NAME || process.env.DB_NAME || 'provider_intelligence',
    user: env.DB_USER || process.env.DB_USER || 'admin',
    password: env.DB_PASSWORD || process.env.DB_PASSWORD || ''
  });

  await client.connect();
  try {
    if (command === 'issue') {
      const { label: issuedLabel, key } = await issueKey(client, label);
      console.log(`issued key "${issuedLabel}"`);
      console.log(`  ${key}`);
      console.log('  Save this key now. It is shown only once and cannot be recovered.');
    } else if (command === 'list') {
      const rows = await listKeys(client);
      if (!rows.length) {
        console.log('(no keys in api_keys)');
      }
      for (const row of rows) {
        const status = row.revoked_at ? `revoked ${row.revoked_at}` : 'active';
        console.log(`  ${row.label.padEnd(20)} created ${row.created_at}  ${status}`);
      }
    } else {
      await revokeKey(client, label);
      console.log(`revoked key "${label}"`);
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('api-keys failed:', e.message); process.exit(1); });
}

module.exports = { issueKey, listKeys, revokeKey, generateKey, sha256hex };
