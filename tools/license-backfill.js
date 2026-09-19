#!/usr/bin/env node
// Backfills provider_licenses for providers already cached in `providers`
// whose licenses were never captured (the licenses column was added after
// the original seed). Fetches each provider's record from the NPI Registry
// with ef=licenses and upserts the provider_licenses rows exactly the way
// cacheProvider does. Never touches providers rows themselves.
//
// Usage: node tools/license-backfill.js [--limit N] [--offset N] [--dry-run]
//        [--delay-ms N]   (default 100ms, well under the ~25 req/s soft limit)

const fs = require('fs');
const https = require('https');

const NPI_URL = 'https://clinicaltables.nlm.nih.gov/api/npi_idv/v3/search';

function readEnvFile() {
  const env = {};
  try {
    for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch (e) { /* fall back to process env / defaults */ }
  return env;
}

function parseArgs(argv) {
  const args = { limit: null, offset: 0, dryRun: false, delayMs: 100 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--offset') args.offset = parseInt(argv[++i], 10);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--delay-ms') args.delayMs = parseInt(argv[++i], 10);
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  return args;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'provider-intelligence-license-backfill/1.0 (public data)' },
      timeout: 30000,
    }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`bad JSON from ${url}: ${e.message}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timed out: ${url}`)));
    req.on('error', reject);
  });
}

function parseLicenses(raw) {
  if (!raw) return [];
  let arr = raw;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch (e) { return []; }
  }
  if (!Array.isArray(arr) || !Array.isArray(arr[0])) return [];
  return arr[0]
    .filter(l => l && l.lic_number && l.lic_state)
    .map(l => ({
      number: String(l.lic_number),
      state: String(l.lic_state).slice(0, 2).toUpperCase(),
      isPrimaryTaxonomy: l.is_primary_taxonomy === 'Y',
      taxonomyCode: l.taxonomy && l.taxonomy.code ? String(l.taxonomy.code) : null,
      taxonomyClassification: l.taxonomy && l.taxonomy.classification ? String(l.taxonomy.classification) : null,
      taxonomySpecialization: l.taxonomy && l.taxonomy.specialization ? String(l.taxonomy.specialization) : null,
    }));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv);
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
    const missing = await c.query(`
      SELECT p.npi FROM providers p
      WHERE NOT EXISTS (SELECT 1 FROM provider_licenses pl WHERE pl.npi = p.npi)
      ORDER BY p.npi
      LIMIT ${args.limit ? parseInt(args.limit, 10) : 'ALL'}
      OFFSET ${parseInt(args.offset, 10) || 0}`);
    const npis = missing.rows.map(r => r.npi);
    console.log(`backfill candidates: ${npis.length}`);

    let fetched = 0, withLicenses = 0, rows = 0, failed = 0;
    for (const npi of npis) {
      let envelope;
      try {
        envelope = await fetchJson(`${NPI_URL}?terms=${encodeURIComponent(npi)}&df=npi&ef=licenses`);
      } catch (e) {
        failed++;
        console.error(`  ${npi}: fetch failed: ${e.message}`);
        await sleep(args.delayMs);
        continue;
      }
      fetched++;
      const licenses = parseLicenses(envelope && envelope[2] && envelope[2].licenses);
      if (licenses.length) withLicenses++;
      rows += licenses.length;

      if (!args.dryRun) {
        await c.query('DELETE FROM provider_licenses WHERE npi = $1', [npi]);
        for (const l of licenses) {
          await c.query(
            `INSERT INTO provider_licenses
               (npi, license_number, issuing_state, is_primary_taxonomy,
                taxonomy_code, taxonomy_classification, taxonomy_specialization,
                source, as_of)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'NPI Registry',CURRENT_DATE)
             ON CONFLICT (npi, license_number, issuing_state) DO NOTHING`,
            [npi, l.number, l.state, l.isPrimaryTaxonomy,
             l.taxonomyCode, l.taxonomyClassification, l.taxonomySpecialization]);
        }
      }
      if (fetched % 500 === 0) console.log(`  progress: fetched=${fetched} with_licenses=${withLicenses} rows=${rows} failed=${failed}`);
      await sleep(args.delayMs);
    }
    console.log(`LICENSE_BACKFILL_${args.dryRun ? 'DRY_RUN' : 'OK'} fetched=${fetched} with_licenses=${withLicenses} rows=${rows} failed=${failed}`);
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('LICENSE_BACKFILL_FAILED:', e.message); process.exit(1); });
}

module.exports = { parseLicenses };
