#!/usr/bin/env node
// Cross-reference clia_labs to organization NPIs in the local NPPES load.
// Both sides carry full legal names, so the match is stricter than the
// cannabis physician matching: same normalized lab name + state + city,
// and the candidate org NPI must be UNIQUE for that triple. Only that
// decisive case writes npi; everything else stays null (a wrong NPI link
// is worse than none).
//
// Usage: node tools/clia-npi-match.js [--dry-run]

function readEnvFile() {
  const fs = require('fs');
  const env = {};
  try {
    for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch (e) { /* fall back to process env / defaults */ }
  return env;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { Client } = require('pg');
  const env = readEnvFile();
  const c = new Client({
    host: env.DB_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || process.env.DB_PORT || '5432', 10),
    database: env.DB_NAME || process.env.DB_NAME || 'provider_intelligence',
    user: env.DB_USER || process.env.DB_USER || 'admin',
    password: env.DB_PASSWORD || process.env.DB_PASSWORD || '',
  });
  await c.connect();

  try {
    const candidates = await c.query(
      `SELECT COUNT(*)::int n FROM (
         SELECT l.clia_number
           FROM clia_labs l
           JOIN nppes_providers np
             ON np.entity_type_code = '2'
            AND upper(np.legal_business_name) = upper(l.lab_name)
            AND np.practice_state = l.state
            AND upper(np.practice_city) = upper(l.city)
          WHERE l.npi IS NULL
          GROUP BY l.clia_number
         HAVING COUNT(*) = 1
       ) decisive`
    );
    console.log(`decisive unique name+state+city matches: ${candidates.rows[0].n}`);

    if (dryRun) {
      console.log(`CLIA_NPI_MATCH_DRY_RUN candidates=${candidates.rows[0].n}`);
      return;
    }

    const upd = await c.query(
      `UPDATE clia_labs l
          SET npi = sub.npi, sync_timestamp = CURRENT_TIMESTAMP
         FROM (
           SELECT l2.clia_number, min(np.npi) AS npi
             FROM clia_labs l2
             JOIN nppes_providers np
               ON np.entity_type_code = '2'
              AND upper(np.legal_business_name) = upper(l2.lab_name)
              AND np.practice_state = l2.state
              AND upper(np.practice_city) = upper(l2.city)
            WHERE l2.npi IS NULL
            GROUP BY l2.clia_number
           HAVING COUNT(*) = 1
         ) sub
        WHERE l.clia_number = sub.clia_number`
    );

    console.log(`CLIA_NPI_MATCH_OK linked=${upd.rowCount}`);
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('CLIA_NPI_MATCH_FAILED:', e.message); process.exit(1); });
}
