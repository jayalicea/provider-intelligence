#!/usr/bin/env node
// Fills the `jurisdictions` array in client/src/data/coverage.json.
//
// The 51-row jurisdiction table (50 states + DC) needs two things this
// repository does not carry: the per-state status and official source URL
// recorded in data/exclusions/state-exclusion-survey.md, and the loaded
// state_exclusions table. data/ is gitignored, so neither is present in a
// fresh checkout and the table cannot be written by hand without inventing
// government source URLs. This script derives it from both on a machine that
// has them, and refuses to write a partial table.
//
// The survey is parsed as a markdown table whose header row names the columns;
// a row is matched to a jurisdiction by its two-letter code or full name. The
// database supplies the live record count per state, so the published counts
// are measured rather than transcribed.
//
// Usage: node tools/coverage-jurisdictions.js [--survey <path>] [--out <path>] [--dry-run]

const fs = require('fs');
const path = require('path');

const JURISDICTIONS = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
};
const EXPECTED_ROWS = 51;

const NAME_TO_CODE = Object.fromEntries(
  Object.entries(JURISDICTIONS).map(([code, name]) => [name.toUpperCase(), code])
);

// state_exclusions.state holds full state names ('Texas'), not codes ('TX').
function stateToCode(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  if (JURISDICTIONS[s]) return s;
  return NAME_TO_CODE[s] || null;
}

const DEFAULT_SURVEY = path.join('data', 'exclusions', 'state-exclusion-survey.md');
const DEFAULT_OUT = path.join('client', 'src', 'data', 'coverage.json');

function parseArgs(argv) {
  const args = { survey: DEFAULT_SURVEY, out: DEFAULT_OUT, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--survey') args.survey = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  return args;
}

// Markdown table -> array of objects keyed by lowercased header cell.
function parseMarkdownTable(text) {
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const header = cells(lines[i]).map(h => h.toLowerCase());
    if (!/^\s*\|[\s:|-]+$/.test(lines[i + 1] || '')) continue;
    for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const values = cells(lines[j]);
      const row = {};
      header.forEach((h, k) => { row[h] = values[k] ?? ''; });
      rows.push(row);
      i = j;
    }
  }
  return rows;
}

const pick = (row, ...names) => {
  for (const n of names) {
    const hit = Object.keys(row).find(k => k.includes(n));
    if (hit && row[hit]) return row[hit];
  }
  return null;
};

// A markdown link renders as [label](url); keep the url.
const unlink = v => {
  if (!v) return null;
  const m = String(v).match(/\((https?:\/\/[^)\s]+)\)/) || String(v).match(/(https?:\/\/\S+)/);
  return m ? m[1] : (String(v).trim() || null);
};

function matchJurisdiction(row) {
  const code = pick(row, 'code', 'abbr');
  if (code && JURISDICTIONS[String(code).trim().toUpperCase()]) {
    return String(code).trim().toUpperCase();
  }
  const name = pick(row, 'jurisdiction', 'state', 'name');
  if (!name) return null;
  const needle = String(name).replace(/\[|\]/g, '').trim().toLowerCase();
  const direct = Object.keys(JURISDICTIONS).find(k => k.toLowerCase() === needle);
  if (direct) return direct;
  return Object.keys(JURISDICTIONS).find(
    k => JURISDICTIONS[k].toLowerCase() === needle
  ) || null;
}

async function loadCounts() {
  const { Client } = require('pg');
  const env = {};
  try {
    for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch (e) { /* defaults below */ }

  const c = new Client({
    host: env.DB_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || process.env.DB_PORT || '5432', 10),
    database: env.DB_NAME || process.env.DB_NAME || 'provider_intelligence',
    user: env.DB_USER || process.env.DB_USER || 'admin',
    password: env.DB_PASSWORD || process.env.DB_PASSWORD || ''
  });
  await c.connect();
  try {
    const r = await c.query(
      `SELECT upper(state) AS state, count(*)::int AS records,
              max(source_name) AS source_name, max(source_url) AS source_url,
              max(as_of) AS as_of
       FROM state_exclusions GROUP BY upper(state)`
    );
    const byState = {};
    for (const row of r.rows) {
      const code = stateToCode(row.state);
      if (code) byState[code] = row;
    }
    return byState;
  } finally {
    await c.end();
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (!fs.existsSync(args.survey)) {
    console.error(`COVERAGE_FAILED survey not found: ${args.survey}`);
    console.error('Pass --survey <path> if it lives elsewhere. This table is not');
    console.error('written by hand: the per-state status and official source URL');
    console.error('come from the survey, and the counts come from state_exclusions.');
    process.exit(1);
  }

  const surveyRows = parseMarkdownTable(fs.readFileSync(args.survey, 'utf8'));
  const surveyByCode = {};
  for (const row of surveyRows) {
    const code = matchJurisdiction(row);
    if (code) surveyByCode[code] = row;
  }
  console.log(`survey: matched ${Object.keys(surveyByCode).length} of ${EXPECTED_ROWS} jurisdictions`);

  const counts = await loadCounts();
  console.log(`database: ${Object.keys(counts).length} jurisdictions present in state_exclusions`);

  const jurisdictions = Object.keys(JURISDICTIONS).sort().map(code => {
    const survey = surveyByCode[code] || {};
    const live = counts[code];
    return {
      code,
      name: JURISDICTIONS[code],
      status: pick(survey, 'status') || (live ? 'list ingested' : 'no public list identified'),
      records: live ? live.records : 0,
      sourceName: (live && live.source_name) || pick(survey, 'source name', 'publisher') || null,
      sourceUrl: unlink(pick(survey, 'official source', 'source url', 'url')) ||
        (live ? live.source_url : null),
      asOf: live && live.as_of ? new Date(live.as_of).toISOString().slice(0, 10) : null
    };
  });

  const missingUrl = jurisdictions.filter(j => j.records > 0 && !j.sourceUrl);
  if (jurisdictions.length !== EXPECTED_ROWS || missingUrl.length) {
    console.error(`COVERAGE_FAILED rows=${jurisdictions.length} expected=${EXPECTED_ROWS} ingested_without_source_url=${missingUrl.length}`);
    if (missingUrl.length) console.error(`  missing: ${missingUrl.map(j => j.code).join(', ')}`);
    process.exit(1);
  }

  const ingested = jurisdictions.filter(j => j.records > 0).length;
  const total = jurisdictions.reduce((a, j) => a + j.records, 0);
  console.log(`jurisdictions=${jurisdictions.length} ingested=${ingested} records=${total}`);

  if (total === 0 || ingested === 0) {
    console.error('COVERAGE_FAILED every jurisdiction measured zero records;');
    console.error('state_exclusions is empty or unreachable. Refusing to write an');
    console.error('all-zero table over the published registry figures.');
    process.exit(1);
  }

  if (args.dryRun) {
    console.log('COVERAGE_DRY_RUN no changes written');
    return;
  }

  const coverage = JSON.parse(fs.readFileSync(args.out, 'utf8'));
  coverage.jurisdictions = jurisdictions;
  const stateSet = coverage.datasets.find(d => d.id === 'state-medicaid-exclusions');
  if (stateSet) {
    stateSet.records = total;
    stateSet.jurisdictions = ingested;
  }
  fs.writeFileSync(args.out, `${JSON.stringify(coverage, null, 2)}\n`);
  console.log(`COVERAGE_OK wrote ${jurisdictions.length} jurisdictions to ${args.out}`);
}

if (require.main === module) {
  main().catch(e => { console.error('COVERAGE_FAILED:', e.message); process.exit(1); });
}

module.exports = { parseMarkdownTable, matchJurisdiction, unlink, JURISDICTIONS, EXPECTED_ROWS };
