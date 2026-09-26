// Schema migration runner for src/config/migrations/*.sql.
//
// Applies pending files in filename order, each in its own transaction, and
// records it in schema_migrations (filename, sha256 checksum, applied_at).
// Assumes init.sql has already been loaded (docker-compose does this on
// first start; otherwise `psql -f src/config/init.sql`).
//
// A migration may declare `-- requires-table: <name>` header lines for tables
// created outside this directory (e.g. nppes_providers by
// tools/nppes-ingest.js). If a required table is missing, that migration is
// deferred (left pending, not failed) and applied on a later run.
//
// Usage:
//   npm run migrate             apply pending migrations
//   npm run migrate -- status   list applied / pending / changed files
//   npm run migrate -- baseline record every file as applied WITHOUT running
//                               it (one-time, for databases migrated by hand
//                               before this runner existed)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const TRACKING_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT PRIMARY KEY,
  checksum   CHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

function loadMigrations(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(filename => {
      const sql = fs.readFileSync(path.join(dir, filename), 'utf8');
      const requiresTables = [...sql.matchAll(/^--\s*requires-table:\s*([\w.]+)\s*$/gm)].map(m => m[1]);
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      return { filename, sql, checksum, requiresTables };
    });
}

// Pure: classify files against schema_migrations rows.
function plan(migrations, appliedRows) {
  const applied = new Map(appliedRows.map(r => [r.filename, r.checksum.trim()]));
  const known = new Set(migrations.map(m => m.filename));
  return {
    pending: migrations.filter(m => !applied.has(m.filename)),
    changed: migrations.filter(m => applied.has(m.filename) && applied.get(m.filename) !== m.checksum),
    missing: [...applied.keys()].filter(f => !known.has(f))
  };
}

async function appliedRows(client) {
  await client.query(TRACKING_DDL);
  const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations ORDER BY filename');
  return rows;
}

async function tableExists(client, name) {
  const { rows } = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [name]);
  return rows[0].ok;
}

async function status(client, migrations = loadMigrations()) {
  return plan(migrations, await appliedRows(client));
}

async function up(client, migrations = loadMigrations(), log = console.log) {
  const { pending, changed } = plan(migrations, await appliedRows(client));
  for (const m of changed) {
    log(`WARNING: ${m.filename} was edited after it was applied (checksum differs); not re-run.`);
  }
  const result = { applied: [], deferred: [] };
  for (const m of pending) {
    const missing = [];
    for (const t of m.requiresTables) {
      if (!(await tableExists(client, t))) missing.push(t);
    }
    if (missing.length) {
      log(`deferred ${m.filename}: missing table(s) ${missing.join(', ')}`);
      result.deferred.push(m.filename);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [m.filename, m.checksum]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      err.message = `${m.filename}: ${err.message}`;
      throw err;
    }
    log(`applied  ${m.filename}`);
    result.applied.push(m.filename);
  }
  return result;
}

async function baseline(client, migrations = loadMigrations()) {
  const { pending } = plan(migrations, await appliedRows(client));
  for (const m of pending) {
    await client.query(
      'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING',
      [m.filename, m.checksum]
    );
  }
  return pending.map(m => m.filename);
}

async function main(cmd = 'up') {
  require('dotenv').config();
  const { pool } = require('./database');
  const client = await pool.connect();
  try {
    if (cmd === 'status') {
      const all = loadMigrations();
      const s = await status(client, all);
      const pending = new Set(s.pending.map(m => m.filename));
      const changed = new Set(s.changed.map(m => m.filename));
      for (const m of all) {
        const state = pending.has(m.filename) ? 'pending' : changed.has(m.filename) ? 'CHANGED' : 'applied';
        console.log(`${state.padEnd(8)} ${m.filename}`);
      }
      for (const f of s.missing) console.log(`MISSING  ${f} (recorded as applied, file not found)`);
    } else if (cmd === 'baseline') {
      const marked = await baseline(client);
      console.log(`baseline: recorded ${marked.length} migration(s) as applied without running them`);
    } else if (cmd === 'up') {
      const r = await up(client);
      console.log(`done: ${r.applied.length} applied, ${r.deferred.length} deferred`);
    } else {
      throw new Error(`unknown command "${cmd}" (use up, status, or baseline)`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main(process.argv[2]).catch(err => {
    console.error(`migrate failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { loadMigrations, plan, up, baseline, status, TRACKING_DDL };
