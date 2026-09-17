#!/usr/bin/env node
// NUCC healthcare provider taxonomy crosswalk: loads the code set into
// taxonomy_codes, then backfills the descriptions NPPES does not carry.
//
// NPPES ships taxonomy *codes* only -- no descriptions -- so
// nppes_providers.primary_taxonomy_description is null on every row after a
// full load (see docs/nppes-full-load-verification.md). This tool supplies the
// crosswalk that fills it.
//
// Source priority, per docs/nppes-v2-notes.md:
//   1. the NUCC published CSV code list (authoritative);
//   2. the NIH Clinical Tables healthcare-provider-taxonomy API (fallback);
//   3. --file <path>, for an air-gapped run or a pinned vintage.
// Whichever is used is recorded in taxonomy_codes.source, so a row always
// says where its description came from.
//
// Usage:
//   node tools/taxonomy-ingest.js [--source auto|nucc|nih] [--file <path>]
//                                 [--backfill-only] [--skip-backfill]

const fs = require('fs');
const https = require('https');

const NUCC_URL = 'https://www.nucc.org/images/stories/CSV/nucc_taxonomy_260.csv';
const NIH_URL = 'https://clinicaltables.nlm.nih.gov/api/taxonomy/v3/search';

const DDL = `CREATE TABLE IF NOT EXISTS taxonomy_codes (
  code text PRIMARY KEY,
  description text,
  grouping text,
  classification text,
  specialization text,
  source text,
  as_of date
)`;

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_taxonomy_codes_desc ON taxonomy_codes(lower(description))"
];

// --- parsing ---------------------------------------------------------------

const clean = v => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// Quote-aware CSV splitter, same convention as the other loaders here.
function parseLine(line) {
  const rec = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') { inQ = true; }
    else if (ch === ',') { rec.push(field); field = ''; }
    else field += ch;
  }
  rec.push(field);
  return rec;
}

// A code's human label. NUCC's own "Display Name" is preferred; otherwise it is
// built from classification and specialization, which is how the code set reads
// when Display Name is absent from an older vintage.
function describe(row) {
  const display = clean(row.display_name);
  if (display) return display;
  const classification = clean(row.classification);
  const specialization = clean(row.specialization);
  if (classification && specialization) return `${classification}, ${specialization}`;
  return classification || specialization || null;
}

/**
 * NUCC CSV -> rows. Columns are located by header name (the vintage changes
 * their order), and the header may carry a UTF-8 BOM.
 */
function parseNuccCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];
  const header = parseLine(lines[0].replace(/^\uFEFF/, ''))
    .map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const at = name => header.indexOf(name);
  const idx = {
    code: at('code'),
    grouping: at('grouping'),
    classification: at('classification'),
    specialization: at('specialization'),
    display_name: at('display_name')
  };
  if (idx.code === -1) {
    throw new Error(`NUCC CSV header has no Code column (saw: ${header.join(', ')})`);
  }
  const out = [];
  for (const line of lines.slice(1)) {
    const f = parseLine(line);
    const get = i => (i === -1 ? null : clean(f[i]));
    const code = get(idx.code);
    if (!code) continue;
    const row = {
      code,
      grouping: get(idx.grouping),
      classification: get(idx.classification),
      specialization: get(idx.specialization),
      display_name: get(idx.display_name)
    };
    row.description = describe(row);
    out.push(row);
  }
  return out;
}

/**
 * NIH Clinical Tables -> rows.
 *
 * Clinical Tables answers with the 4-element positional envelope documented in
 * AGENTS.md: [total, codes, extraFields, displayRows], where extraFields is
 * {dotted.name: [values...]} index-aligned with codes. This parser is written
 * against that documented convention and is covered by tests; the live
 * taxonomy endpoint could not be reached from the build environment to confir
 * the exact field names, so unknown extra fields are tolerated rather than
 * required.
 */
function parseNihEnvelope(body) {
  if (!Array.isArray(body) || body.length < 2) {
    throw new Error('NIH response is not the expected 4-element envelope');
  }
  const codes = Array.isArray(body[1]) ? body[1] : [];
  const extra = (body[2] && typeof body[2] === 'object') ? body[2] : {};
  const display = Array.isArray(body[3]) ? body[3] : [];
  const pick = (names, i) => {
    for (const n of names) {
      const col = extra[n];
      if (Array.isArray(col) && clean(col[i]) !== null) return clean(col[i]);
    }
    return null;
  };
  return codes.map((code, i) => {
    const row = {
      code: clean(code),
      grouping: pick(['grouping', 'taxonomy.grouping'], i),
      classification: pick(['classification', 'taxonomy.classification'], i),
      specialization: pick(['specialization', 'taxonomy.specialization'], i),
      display_name: pick(['display_name', 'display', 'name'], i) ||
        (Array.isArray(display[i]) ? clean(display[i][0]) : null)
    };
    row.description = describe(row);
    return row;
  }).filter(r => r.code);
}

// --- fetching --------------------------------------------------------------

function fetchUrl(url, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        // Some of these hosts reject bare client user agents (AGENTS.md).
        'User-Agent': 'Mozilla/5.0 (compatible; provider-intelligence taxonomy-ingest)',
        Accept: '*/*'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchUrl(res.headers.location, { timeoutMs }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timed out after ${timeoutMs}ms: ${url}`)));
    req.on('error', reject);
  });
}

/**
 * Resolve the code set, honouring source priority. Returns
 * { rows, sourceLabel } so the loaded rows always carry their origin.
 */
async function loadRows(args, fetcher = fetchUrl) {
  if (args.file) {
    const text = fs.readFileSync(args.file, 'utf8');
    const rows = text.trimStart().startsWith('[')
      ? parseNihEnvelope(JSON.parse(text))
      : parseNuccCsv(text);
    return { rows, sourceLabel: `file:${args.file}` };
  }

  const attempts = args.source === 'nih'
    ? [['NIH_CLINICAL_TABLES', NIH_URL]]
    : args.source === 'nucc'
      ? [['NUCC_CSV', NUCC_URL]]
      : [['NUCC_CSV', NUCC_URL], ['NIH_CLINICAL_TABLES', NIH_URL]];

  const failures = [];
  for (const [label, url] of attempts) {
    try {
      console.log(`fetching ${label}: ${url}`);
      const body = await fetcher(
        label === 'NIH_CLINICAL_TABLES'
          ? `${url}?terms=&maxList=500&df=code,display_name&ef=grouping,classification,specialization`
          : url
      );
      const rows = label === 'NIH_CLINICAL_TABLES'
        ? parseNihEnvelope(JSON.parse(body))
        : parseNuccCsv(body);
      if (!rows.length) throw new Error('source returned no usable rows');
      return { rows, sourceLabel: label };
    } catch (e) {
      console.error(`  ${label} unavailable: ${e.message}`);
      failures.push(`${label}: ${e.message}`);
    }
  }
  throw new Error(
    `no taxonomy source reachable. ${failures.join('; ')}. ` +
    'Pass --file <path> with a downloaded NUCC CSV to load without network access.'
  );
}

// --- backfill --------------------------------------------------------------

// Only ever fills what is empty: a description already present (from NPPES
// othernames, the NPI API, or an earlier run) is never overwritten.
const BACKFILL = {
  nppes_providers: `
    UPDATE nppes_providers p
       SET primary_taxonomy_description = t.description
      FROM taxonomy_codes t
     WHERE p.primary_taxonomy_code = t.code
       AND t.description IS NOT NULL
       AND (p.primary_taxonomy_description IS NULL OR p.primary_taxonomy_description = '')`,
  providers: `
    UPDATE providers p
       SET primary_taxonomy_description =
             COALESCE(NULLIF(p.primary_taxonomy_description, ''), t.description),
           taxonomy_grouping =
             COALESCE(NULLIF(p.taxonomy_grouping, ''), t.grouping),
           taxonomy_classification =
             COALESCE(NULLIF(p.taxonomy_classification, ''), t.classification)
      FROM taxonomy_codes t
     WHERE p.primary_taxonomy_code = t.code
       AND (p.primary_taxonomy_description IS NULL OR p.primary_taxonomy_description = ''
            OR p.taxonomy_grouping IS NULL OR p.taxonomy_grouping = ''
            OR p.taxonomy_classification IS NULL OR p.taxonomy_classification = '')`
};

async function tableExists(c, name) {
  const r = await c.query('SELECT to_regclass($1) AS reg', [name]);
  return Boolean(r.rows[0].reg);
}

async function backfill(c) {
  const out = {};
  for (const [table, sql] of Object.entries(BACKFILL)) {
    if (!await tableExists(c, table)) {
      console.log(`  ${table}: not present, skipped`);
      out[table] = null;
      continue;
    }
    const r = await c.query(sql);
    out[table] = r.rowCount;
    console.log(`  ${table}: ${r.rowCount} row(s) backfilled`);
  }
  return out;
}

// --- cli -------------------------------------------------------------------

function parseArgs(argv) {
  const args = { source: 'auto', file: null, backfillOnly: false, skipBackfill: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = String(argv[++i]).toLowerCase();
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--backfill-only') args.backfillOnly = true;
    else if (a === '--skip-backfill') args.skipBackfill = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  if (!['auto', 'nucc', 'nih'].includes(args.source)) {
    console.error(`--source must be auto, nucc or nih (got ${args.source})`);
    process.exit(1);
  }
  return args;
}

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

async function main() {
  const args = parseArgs(process.argv);
  const { Client } = require('pg');
  const env = readEnvFile();
  const AS_OF = new Date().toISOString().slice(0, 10);

  const c = new Client({
    host: env.DB_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || process.env.DB_PORT || '5432', 10),
    database: env.DB_NAME || process.env.DB_NAME || 'provider_intelligence',
    user: env.DB_USER || process.env.DB_USER || 'admin',
    password: env.DB_PASSWORD || process.env.DB_PASSWORD || ''
  });

  await c.connect();
  try {
    await c.query(DDL);
    for (const sql of INDEXES) await c.query(sql);

    if (args.backfillOnly) {
      const existing = await c.query('SELECT count(*)::int AS n, max(source) AS source FROM taxonomy_codes');
      if (existing.rows[0].n === 0) {
        console.error('TAXONOMY_FAILED taxonomy_codes is empty; load it before backfilling');
        process.exit(1);
      }
      console.log(`backfilling from ${existing.rows[0].n} codes (source ${existing.rows[0].source})`);
      const counts = await backfill(c);
      console.log(`TAXONOMY_OK backfill_only nppes=${counts.nppes_providers} providers=${counts.providers}`);
      return;
    }

    const { rows, sourceLabel } = await loadRows(args);
    const withDescription = rows.filter(r => r.description).length;
    console.log(`parsed ${rows.length} code(s) from ${sourceLabel}; ${withDescription} carry a description`);

    await c.query('TRUNCATE taxonomy_codes');
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 1000) {
      const batch = rows.slice(i, i + 1000).map(r => ({
        code: r.code,
        description: r.description,
        grouping: r.grouping,
        classification: r.classification,
        specialization: r.specialization,
        source: sourceLabel,
        as_of: AS_OF
      }));
      const res = await c.query(
        'INSERT INTO taxonomy_codes SELECT * FROM jsonb_populate_recordset(null::taxonomy_codes, $1::jsonb) ON CONFLICT (code) DO NOTHING',
        [JSON.stringify(batch)]
      );
      inserted += res.rowCount;
    }

    const table = parseInt((await c.query('SELECT count(*) AS n FROM taxonomy_codes')).rows[0].n, 10);
    const duplicates = rows.length - inserted;
    if (inserted !== table) {
      console.error(`TAXONOMY_FAILED parsed=${rows.length} inserted=${inserted} table=${table}`);
      process.exit(1);
    }

    if (!args.skipBackfill) await backfill(c);

    console.log(
      `TAXONOMY_OK source=${sourceLabel} parsed=${rows.length} inserted=${inserted} ` +
      `table=${table} duplicate_codes=${duplicates} as_of=${AS_OF}`
    );
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('TAXONOMY_FAILED:', e.message); process.exit(1); });
}

module.exports = {
  parseLine, parseNuccCsv, parseNihEnvelope, describe, loadRows, parseArgs,
  NUCC_URL, NIH_URL, DDL, BACKFILL
};
