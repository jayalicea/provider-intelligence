#!/usr/bin/env node
// Records scheduled refresh-job runs in data_refresh_runs (read by
// GET /health/data). Called by tools/run-tracked.ps1; usable directly:
//
//   node tools/refresh-run.js start <job>                  -> prints run id
//   node tools/refresh-run.js finish <id> <exitCode> [detail]
//
// Exit code 0 records 'success', anything else 'failed'.
require('dotenv').config();
const REFRESH_JOBS = require('../src/config/refresh-jobs');

async function start(db, job) {
  if (!REFRESH_JOBS[job]) {
    throw new Error(`unknown job "${job}" (known: ${Object.keys(REFRESH_JOBS).join(', ')})`);
  }
  const { rows } = await db.query('INSERT INTO data_refresh_runs (job) VALUES ($1) RETURNING id', [job]);
  return rows[0].id;
}

async function finish(db, id, exitCode, detail) {
  const code = parseInt(exitCode, 10);
  if (!/^\d+$/.test(String(id)) || Number.isNaN(code)) {
    throw new Error('usage: finish <id> <exitCode> [detail]');
  }
  await db.query(
    `UPDATE data_refresh_runs
        SET finished_at = NOW(), status = $2, exit_code = $3, detail = $4
      WHERE id = $1`,
    [id, code === 0 ? 'success' : 'failed', code, detail ? String(detail).slice(0, 2000) : null]
  );
}

async function main([cmd, ...args]) {
  const db = require('../src/config/database');
  try {
    if (cmd === 'start') console.log(await start(db, args[0]));
    else if (cmd === 'finish') await finish(db, args[0], args[1], args.slice(2).join(' '));
    else throw new Error('usage: refresh-run.js start <job> | finish <id> <exitCode> [detail]');
  } finally {
    await db.pool.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(err => {
    console.error(`refresh-run: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { start, finish };
