#!/usr/bin/env node
/**
 * Monthly per-key usage summary from api_usage, for billing conversations.
 *
 * Usage: node tools/usage-report.js [--month YYYY-MM] [--json]
 * Defaults to the previous calendar month. Reads DB_* env vars (or a local
 * .env in the repo root).
 */
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const db = require('../src/config/database');

function parseArgs(argv) {
  const args = { month: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--month') args.month = argv[++i];
    else if (argv[i] === '--json') args.json = true;
    else if (!args.month) args.month = argv[i];
  }
  if (!args.month) {
    const d = new Date();
    d.setMonth(d.getMonth() - 1, 1);
    args.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  if (!/^\d{4}-\d{2}$/.test(args.month)) {
    console.error(`invalid month "${args.month}" (expected YYYY-MM)`);
    process.exit(1);
  }
  return args;
}

(async () => {
  const { month, json } = parseArgs(process.argv);
  const start = `${month}-01`;
  const [year, mon] = month.split('-').map(Number);
  const endDate = new Date(Date.UTC(year, mon, 1));
  const end = endDate.toISOString().slice(0, 10);

  const result = await db.query(
    `SELECT key_label,
            count(*)::int AS requests,
            count(*) FILTER (WHERE status >= 400)::int AS errors,
            count(DISTINCT endpoint)::int AS endpoints
       FROM api_usage
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY key_label
      ORDER BY requests DESC`,
    [start, end]
  );

  if (json) {
    console.log(JSON.stringify({ month, keys: result.rows }, null, 2));
  } else {
    console.log(`API usage for ${month}`);
    if (!result.rows.length) {
      console.log('  (no metered requests this month)');
    }
    for (const row of result.rows) {
      console.log(
        `  ${row.key_label.padEnd(20)} ${String(row.requests).padStart(6)} requests` +
        `  ${String(row.errors).padStart(5)} errors  ${row.endpoints} endpoints`
      );
    }
  }
  await db.pool.end();
})().catch(error => {
  console.error('usage-report failed:', error.message);
  process.exit(1);
});
