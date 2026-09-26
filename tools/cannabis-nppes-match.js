#!/usr/bin/env node
// Cross-reference cannabis_certifications rows that still have npi IS NULL
// against the FULL local NPPES enumeration load (nppes_providers, ~9.7M
// rows) — offline, no API rate limits. This is the bulk-matching sibling of
// tools/cannabis-npi-enrich.js (which queries the Clinical Tables API per
// name and is the better fit for states we have not loaded into NPPES).
//
// Same audit gate, same provenance-note conventions, same review CSV shape:
//   - rows with a source city (FL, AL): auto-accept only a unique
//     name-filtered NPPES candidate in that city
//   - rows without a city (WV): accept only a unique EXACT-name candidate
//   - everything else is quarantined (never written) with a reason and
//     exported for human review via tools/cannabis-npi-review.js
//
// Usage: node tools/cannabis-nppes-match.js [--state AL] [--dry-run] [--limit N]
//        (default: all states present in cannabis_certifications)

const fs = require('fs');
const path = require('path');
const { filterByName, normalizeName, stripMiddleInitials } = require('./cannabis-npi-enrich');
const { parseQpList } = require('./cannabis-ingest');
const { parseWvList } = require('./cannabis-ingest-wv');
const { parseAlList } = require('./cannabis-ingest-al');
const { parsePaList } = require('./cannabis-ingest-pa');
const { parseOkList } = require('./cannabis-ingest-ok');

// Per-state source texts for the city signal (the schema keeps addresses
// out; the parsed rows carry cities in memory only). AL is license-less, so
// its city map is keyed by normalized name instead of license.
const SOURCE_FILE = {
  FL: { file: 'tmp/qplist.txt', parse: parseQpList, key: 'license' },
  WV: { file: 'tmp/wv-physicians.txt', parse: parseWvList, key: 'license' },
  AL: { file: 'tmp/al-physicians.txt', parse: parseAlList, key: 'name' },
  PA: { file: 'tmp/pa-practitioners.txt', parse: parsePaList, key: 'name' },
  OK: { file: 'tmp/ok-physicians.txt', parse: parseOkList, key: 'name' },
};

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
  const args = { state: null, dryRun: false, limit: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--state') args.state = String(argv[++i] || '').toUpperCase();
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  if (args.state && !SOURCE_FILE[args.state]) {
    console.error(`Unsupported --state ${args.state} (known: ${Object.keys(SOURCE_FILE).join(', ')})`);
    process.exit(1);
  }
  return args;
}

// Replace any prior NPI-match note so re-runs stay idempotent. Mirrors
// tools/cannabis-npi-enrich.js.
function freshNote(note) {
  return String(note || '')
    .replace(/ \| NPI matched \d{4}-\d{2}-\d{2}: [^|]*$/g, '')
    .replace(/ \| NPI match quarantined \d{4}-\d{2}-\d{2}: [^|]*$/g, '')
    .trim();
}

function csvField(v) {
  const s = String(v == null ? '' : v);
  return /[",\n;|]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Pure audit gate, identical semantics to the enrich tool's loop: accept or
// quarantine one source row given its (name-filtered) NPPES candidates.
function decideRow({ city, matches, first }) {
  if (city) {
    if (matches.length === 0) return { status: 'quarantine', reason: 'no-candidates' };
    const cityMatches = matches.filter(cd => cd.city === city);
    if (cityMatches.length === 1) {
      return { status: 'accept', npi: cityMatches[0].npi, note: 'NPPES unique name+city match' };
    }
    return {
      status: 'quarantine',
      reason: cityMatches.length > 1
        ? 'multiple-city-matches'
        : (matches.length === 1 ? 'unique-name-no-city' : 'name-matches-no-city-confirmation'),
    };
  }
  const exact = matches.filter(cd => cd.first === first);
  if (exact.length === 1) {
    return { status: 'accept', npi: exact[0].npi, note: 'NPPES unique name match (no city in source)' };
  }
  return {
    status: 'quarantine',
    reason: exact.length > 1 ? 'multiple-city-matches' : 'name-matches-no-city-confirmation',
  };
}

function formatCandidate(cd) {
  const fullName = [cd.first, normalizeName(cd.raw.middle), cd.last]
    .filter(Boolean).join(' ');
  const cred = cd.raw.credential ? `, ${normalizeName(cd.raw.credential)}` : '';
  const zip = String(cd.raw.zip || '').replace(/\D/g, '').slice(0, 5);
  return `${cd.npi}|${fullName}${cred}|${cd.city}|${zip}|${normalizeName(cd.raw.taxonomyClassification) || ''}`;
}

// City per source row: license-keyed for FL/WV, name-keyed for license-less AL.
function buildCityMap(state) {
  const { file, parse, key } = SOURCE_FILE[state];
  const text = fs.readFileSync(file, 'utf8');
  const { rows } = parse(text);
  const map = new Map();
  for (const r of rows) {
    const city = (r.city || '').toUpperCase().trim();
    if (!city) continue;
    if (key === 'license') map.set(r.license, city);
    else map.set(`${normalizeName(r.last)}|${normalizeName(stripMiddleInitials(r.first))}`, city);
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv);
  const today = new Date().toISOString().slice(0, 10);

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
    const statesRes = await c.query(
      `SELECT DISTINCT state FROM cannabis_certifications
        WHERE npi IS NULL ORDER BY state`
    );
    const states = (args.state ? [args.state] : statesRes.rows.map(r => r.state))
      .filter(s => SOURCE_FILE[s]);
    const skippedStates = (args.state ? [] : statesRes.rows.map(r => r.state))
      .filter(s => !SOURCE_FILE[s]);

    for (const state of states) {
      const limitClause = args.limit ? `LIMIT ${parseInt(args.limit, 10)}` : '';
      const res = await c.query(
        `SELECT license_number, practitioner_last_name, practitioner_first_name, provenance_note
           FROM cannabis_certifications
          WHERE npi IS NULL AND state = $1
          ORDER BY practitioner_last_name, practitioner_first_name
          ${limitClause}`,
        [state]
      );
      const dbRows = res.rows;
      const cityMap = buildCityMap(state);

      // Group by normalized name so each distinct name costs one indexed query.
      const groups = new Map();
      for (const r of dbRows) {
        const first = normalizeName(stripMiddleInitials(r.practitioner_first_name));
        const last = normalizeName(r.practitioner_last_name);
        const key = `${last}|${first}`;
        const city = r.license_number
          ? (cityMap.get(r.license_number) || '')
          : (cityMap.get(key) || '');
        if (!groups.has(key)) groups.set(key, { last, first, rows: [] });
        groups.get(key).rows.push({
          license: r.license_number,
          lastName: r.practitioner_last_name,
          firstName: r.practitioner_first_name,
          city,
          provenance: r.provenance_note,
        });
      }

      const accepted = [];    // { license, lastName, firstName, npi, provenance }
      const quarantined = []; // { license, lastName, firstName, last, first, city, reason, candidateCount, detail, provenance }
      let groupsDone = 0;

      for (const g of groups.values()) {
        groupsDone++;
        if (groupsDone % 200 === 0) console.log(`  ${state}: ${groupsDone}/${groups.size} names`);

        const result = await c.query(
          `SELECT npi, first_name, middle_name, credential,
                  practice_city, practice_zip, primary_taxonomy_description
             FROM nppes_providers
            WHERE entity_type_code = '1'
              AND last_name = $1
              AND first_name LIKE $2 || '%'
              AND practice_state = $3`,
          [g.last, g.first, state]
        );
        const candidates = result.rows.map(n => ({
          npi: String(n.npi),
          first: normalizeName(n.first_name),
          last: g.last,
          city: String(n.practice_city || '').toUpperCase().trim(),
          raw: {
            middle: n.middle_name,
            credential: n.credential,
            zip: n.practice_zip,
            taxonomyClassification: n.primary_taxonomy_description,
          },
        }));
        const matches = filterByName(candidates, g.last, g.first);
        const detail = matches.map(formatCandidate).join('; ');

        for (const r of g.rows) {
          const decision = decideRow({ city: r.city, matches, first: g.first });
          if (decision.status === 'accept') {
            accepted.push({
              license: r.license,
              lastName: r.lastName,
              firstName: r.firstName,
              npi: decision.npi,
              provenance: `${freshNote(r.provenance)} | NPI matched ${today}: ${decision.note}`,
            });
          } else {
            quarantined.push({
              license: r.license,
              lastName: r.lastName,
              firstName: r.firstName,
              last: g.last,
              first: g.first,
              city: r.city,
              reason: decision.reason,
              candidateCount: matches.length,
              detail,
              provenance: r.provenance,
            });
          }
        }
      }

      // Review CSV, even on --dry-run (same shape as the enrich tool).
      fs.mkdirSync(path.join('data', 'cannabis'), { recursive: true });
      const csvPath = path.join('data', 'cannabis', `${state.toLowerCase()}-nppes-match-review-${today}.csv`);
      const csvLines = ['license_number,last,first,city,reason,candidate_count,candidates'];
      for (const q of quarantined) {
        csvLines.push([q.license, q.last, q.first, q.city, q.reason, q.candidateCount, q.detail || ''].map(csvField).join(','));
      }
      fs.writeFileSync(csvPath, csvLines.join('\r\n') + '\r\n');

      const byReason = {};
      for (const q of quarantined) byReason[q.reason] = (byReason[q.reason] || 0) + 1;

      if (!args.dryRun) {
        await c.query('BEGIN');
        try {
          for (const a of accepted) {
            if (a.license) {
              await c.query(
                `UPDATE cannabis_certifications
                    SET npi = $1, provenance_note = $2
                  WHERE state = $3 AND license_number = $4`,
                [a.npi, a.provenance, state, a.license]
              );
            } else {
              await c.query(
                `UPDATE cannabis_certifications
                    SET npi = $1, provenance_note = $2
                  WHERE state = $3 AND practitioner_last_name = $4
                    AND practitioner_first_name = $5 AND npi IS NULL`,
                [a.npi, a.provenance, state, a.lastName, a.firstName]
              );
            }
          }
          for (const q of quarantined) {
            const note = `${freshNote(q.provenance)} | NPI match quarantined ${today}: ${q.reason}`;
            if (q.license) {
              await c.query(
                `UPDATE cannabis_certifications SET provenance_note = $1
                  WHERE state = $2 AND license_number = $3`,
                [note, state, q.license]
              );
            } else {
              await c.query(
                `UPDATE cannabis_certifications SET provenance_note = $1
                  WHERE state = $2 AND practitioner_last_name = $3
                    AND practitioner_first_name = $4 AND npi IS NULL`,
                [note, state, q.lastName, q.firstName]
              );
            }
          }
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      }

      console.log(`state: ${state}${args.dryRun ? ' (dry-run)' : ''}`);
      console.log(`unmatched rows: ${dbRows.length} (${groups.size} distinct names)`);
      console.log(`auto-accepted: ${accepted.length} rows`);
      console.log(`quarantined rows by reason: ${JSON.stringify(byReason)}`);
      console.log(`review CSV: ${csvPath} (${quarantined.length} rows)`);
      console.log(`CANNABIS_NPPES_MATCH_${args.dryRun ? 'DRY_RUN_' : 'OK_'}${state} accepted=${accepted.length} quarantined=${quarantined.length}`);
    }

    if (skippedStates.length) {
      console.log(`skipped states with no source parser: ${skippedStates.join(', ')} (use cannabis-npi-enrich.js)`);
    }
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('CANNABIS_NPPES_MATCH_FAILED:', e.message); process.exit(1); });
}

module.exports = { decideRow, freshNote };
