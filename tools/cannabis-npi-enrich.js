#!/usr/bin/env node
// NPI-enrich cannabis_certifications from the NPI Registry (Clinical Tables
// API). State program lists publish no NPIs, so matching starts
// license-number-keyed and barely lights up; this tool resolves NPIs by name:
// one lookup per distinct (last, first) among rows with npi IS NULL for the
// requested state, and writes npi back ONLY through an audit gate. Rows whose
// source row carries a city (FL) auto-accept a unique name+city candidate.
// Rows with no city in the source (WV) accept only a unique EXACT-name
// candidate — the weaker signal is explicit in the provenance note. Everything
// else is quarantined (never written) with a reason and exported for human
// review:
//
//   no-candidates                     name filter rejected every candidate
//   unique-name-no-city               exactly one FL name match, city differs
//   name-matches-no-city-confirmation name matches exist but not the source city
//   multiple-city-matches             >1 candidate where one was required
//   lookup-failed                     API error after retry
//
// FL cities/zip come from re-parsing tmp/qplist.txt; the WV source PDF is
// county-grouped and its parser keeps addresses out, so WV rows deliberately
// carry no city signal and use the weaker gate.
//
// Usage: node tools/cannabis-npi-enrich.js [--state WV] [--dry-run] [--delay-ms N] [--limit N]
//        (default state FL, 100ms delay)

const fs = require('fs');
const path = require('path');
const { parseQpList } = require('./cannabis-ingest.js');
const { parseWvList } = require('./cannabis-ingest-wv.js');
const { parseAlList } = require('./cannabis-ingest-al.js');
const { parsePaList } = require('./cannabis-ingest-pa.js');

const NPI_URL = 'https://clinicaltables.nlm.nih.gov/api/npi_idv/v3/search';
// Per-state source texts for the city lookup (schema keeps addresses out, so
// the parsed rows carry them in memory only). AL and PA are license-less:
// their city maps are keyed by normalized name instead of license.
const SOURCE_FILE = { FL: 'tmp/qplist.txt', WV: 'tmp/wv-physicians.txt', AL: 'tmp/al-physicians.txt', PA: 'tmp/pa-practitioners.txt' };
const NAME_KEYED_STATES = new Set(['AL', 'PA']);
const NAME_KEYED_PARSER = { AL: parseAlList, PA: parsePaList };
// Verified live (2026-09-20): dotted leaf paths return values; bare
// first_name/last_name come back null (same convention as
// transformNpiResponse in src/services/npiService.js).
const EXTRA_FIELDS = [
  'name.first', 'name.middle', 'name.last', 'name.credential',
  'addr_practice.city', 'addr_practice.zip', 'licenses.taxonomy.classification'
].join(',');

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
  const args = { state: 'FL', dryRun: false, delayMs: 100, limit: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--state') args.state = String(argv[++i] || '').toUpperCase();
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--delay-ms') args.delayMs = parseInt(argv[++i], 10);
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  if (!SOURCE_FILE[args.state]) {
    console.error(`Unsupported --state ${args.state} (known: ${Object.keys(SOURCE_FILE).join(', ')})`);
    process.exit(1);
  }
  return args;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.get(url, {
      headers: { 'User-Agent': 'provider-intelligence-cannabis-npi-enrich/1.0 (public data)' },
      timeout: 30000,
    }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`bad JSON: ${e.message}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timed out: ${url}`)));
    req.on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Uppercase, periods stripped, whitespace collapsed — for grouping/filtering.
function normalizeName(s) {
  return String(s || '').toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

// Drop middle initials ("JOHN Q" -> "JOHN") before grouping/filtering.
function stripMiddleInitials(first) {
  const tokens = String(first || '').split(/\s+/).filter(Boolean);
  const kept = tokens.filter(t => !/^[A-Za-z]{1}\.?$/.test(t));
  return kept.length ? kept.join(' ') : first;
}

// Replace any prior NPI-match note so re-runs stay idempotent.
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

// One state-filtered lookup for a name; returns parsed candidates with the
// requested extra fields (dotted leaf paths). tools/cannabis-npi-review.js
// reuses this; the audit gate here is untouched by that.
async function lookupCandidates(last, first, state, extraFields = EXTRA_FIELDS) {
  const params = new URLSearchParams({
    terms: `${last} ${first}`,
    q: `addr_practice.state:${state}`,
    df: 'NPI',
    ef: extraFields,
    maxList: '50'
  });
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const envelope = await fetchJson(`${NPI_URL}?${params.toString()}`);
      if (!Array.isArray(envelope) || envelope.length < 3) return [];
      const ids = envelope[1] || [];
      const extra = envelope[2] || {};
      const at = (k, i) => (Array.isArray(extra[k]) ? extra[k][i] : undefined);
      return ids.map((npi, i) => ({
        npi: String(npi),
        first: normalizeName(at('name.first', i)),
        last: normalizeName(at('name.last', i)),
        city: String(at('addr_practice.city', i) || '').toUpperCase().trim(),
        // Everything requested beyond the base shape, for callers like
        // cannabis-npi-review.js that need fuller candidate detail.
        raw: {
          middle: at('name.middle', i),
          credential: at('name.credential', i),
          zip: at('addr_practice.zip', i),
          taxonomyClassification: at('licenses.taxonomy.classification', i)
        }
      }));
    } catch (e) {
      lastErr = e;
      await sleep(1000);
    }
  }
  throw lastErr;
}

// Name filter: last exact; first exact, or the source first is a prefix of the
// candidate first (>= 4 chars) to absorb middle-name expansion. Shared with
// tools/cannabis-npi-review.js.
function filterByName(candidates, last, first) {
  return candidates.filter(cd =>
    cd.last === last &&
    (cd.first === first ||
      (first.length >= 4 && cd.first.startsWith(first)))
  );
}

function formatCandidate(cd) {
  const fullName = [cd.first, normalizeName(cd.raw.middle), cd.last]
    .filter(Boolean).join(' ');
  const cred = cd.raw.credential ? `, ${normalizeName(cd.raw.credential)}` : '';
  const zip = String(cd.raw.zip || '').replace(/\D/g, '').slice(0, 5);
  return `${cd.npi}|${fullName}${cred}|${cd.city}|${zip}|${normalizeName(cd.raw.taxonomyClassification) || ''}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const state = args.state;
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
    const res = await c.query(
      `SELECT license_number, practitioner_last_name, practitioner_first_name, provenance_note
         FROM cannabis_certifications
        WHERE npi IS NULL AND state = $1
        ORDER BY practitioner_last_name, practitioner_first_name
        ${args.limit ? `LIMIT ${parseInt(args.limit, 10)}` : ''}`,
      [state]
    );
    const dbRows = res.rows;

    // Source city per row, re-derived from the source text. WV's parser
    // returns no cities (addresses stay out of the schema by design), so WV
    // rows carry none and go through the weaker exact-name gate below. AL
    // rows carry no license, so their city map is name-keyed.
    const sourceText = fs.readFileSync(SOURCE_FILE[state], 'utf8');
    const cityByRowKey = state === 'FL'
      ? new Map(parseQpList(sourceText).rows.map(r => [r.license, r.city || '']))
      : NAME_KEYED_STATES.has(state)
        ? new Map(NAME_KEYED_PARSER[state](sourceText).rows.map(r => [
            `${normalizeName(r.last)}|${normalizeName(stripMiddleInitials(r.first))}`,
            r.city || '']))
        : new Map(parseWvList(sourceText).rows.map(r => [r.license, r.city || '']));

    // Group by normalized name so each distinct name costs one API call.
    const groups = new Map();
    for (const r of dbRows) {
      const first = normalizeName(stripMiddleInitials(r.practitioner_first_name));
      const last = normalizeName(r.practitioner_last_name);
      const key = `${last}|${first}`;
      if (!groups.has(key)) groups.set(key, { last, first, rows: [] });
      const rowKey = r.license_number
        ? r.license_number
        : `${normalizeName(r.practitioner_last_name)}|${normalizeName(stripMiddleInitials(r.practitioner_first_name))}`;
      groups.get(key).rows.push({
        license: r.license_number,
        lastName: r.practitioner_last_name,
        firstName: r.practitioner_first_name,
        city: (cityByRowKey.get(rowKey) || '').toUpperCase(),
        provenance: r.provenance_note
      });
    }

    const accepted = [];   // { license, npi, provenance }
    const quarantined = []; // { license, last, first, city, reason, candidateCount, provenance }
    let lookedUp = 0;
    let acceptedNames = 0;

    for (const g of groups.values()) {
      lookedUp++;
      if (lookedUp % 100 === 0) console.log(`  progress: ${lookedUp}/${groups.size} names`);
      let acceptedAtGroupStart = accepted.length;

      let candidates;
      try {
        candidates = await lookupCandidates(g.last, g.first, state);
      } catch (e) {
        console.warn(`  warn: lookup failed for ${g.last} ${g.first}: ${e.message}`);
        for (const r of g.rows) {
          quarantined.push({ license: r.license, lastName: r.lastName, firstName: r.firstName, last: g.last, first: g.first, city: r.city, reason: 'lookup-failed', candidateCount: 0, provenance: r.provenance });
        }
        await sleep(args.delayMs);
        continue;
      }

      // Name filter (shared via filterByName with cannabis-npi-review.js).
      const matches = filterByName(candidates, g.last, g.first);

      if (matches.length === 0) {
        for (const r of g.rows) {
          quarantined.push({ license: r.license, lastName: r.lastName, firstName: r.firstName, last: g.last, first: g.first, city: r.city, reason: 'no-candidates', candidateCount: 0, provenance: r.provenance });
        }
        await sleep(args.delayMs);
        continue;
      }

      const detail = matches.map(formatCandidate).join('; ');
      for (const r of g.rows) {
        if (r.city) {
          // City gate: auto-accept only a unique name-filtered candidate in
          // the source row's city.
          const cityMatches = matches.filter(cd => cd.city === r.city);
          if (cityMatches.length === 1) {
            accepted.push({
              license: r.license,
              lastName: r.lastName,
              firstName: r.firstName,
              npi: cityMatches[0].npi,
              provenance: `${freshNote(r.provenance)} | NPI matched ${today}: unique name+city match`
            });
          } else {
            const reason = cityMatches.length > 1
              ? 'multiple-city-matches'
              : (matches.length === 1 ? 'unique-name-no-city' : 'name-matches-no-city-confirmation');
            quarantined.push({ license: r.license, lastName: r.lastName, firstName: r.firstName, last: g.last, first: g.first, city: r.city, reason, candidateCount: matches.length, detail, provenance: r.provenance });
          }
        } else {
          // No city in the source (WV): accept only a unique EXACT-name
          // candidate in the state; the weaker signal is in the note.
          const exact = matches.filter(cd => cd.first === g.first);
          if (exact.length === 1) {
            accepted.push({
              license: r.license,
              lastName: r.lastName,
              firstName: r.firstName,
              npi: exact[0].npi,
              provenance: `${freshNote(r.provenance)} | NPI matched ${today}: unique name match (no city in source)`
            });
          } else {
            const reason = exact.length > 1 ? 'multiple-city-matches' : 'name-matches-no-city-confirmation';
            quarantined.push({ license: r.license, lastName: r.lastName, firstName: r.firstName, last: g.last, first: g.first, city: r.city, reason, candidateCount: matches.length, detail, provenance: r.provenance });
          }
        }
      }
      if (accepted.length > acceptedAtGroupStart) acceptedNames++;
      await sleep(args.delayMs);
    }

    // Review CSV (one line per quarantined row, candidates side by side),
    // even on --dry-run.
    fs.mkdirSync(path.join('data', 'cannabis'), { recursive: true });
    const csvPath = path.join('data', 'cannabis', `${state === 'FL' ? '' : state.toLowerCase() + '-'}npi-match-review-${today}.csv`);
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
              `UPDATE cannabis_certifications
                  SET provenance_note = $1
                WHERE state = $2 AND license_number = $3`,
              [note, state, q.license]
            );
          } else {
            await c.query(
              `UPDATE cannabis_certifications
                  SET provenance_note = $1
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
    console.log(`names looked up: ${lookedUp}`);
    console.log(`auto-accepted: ${acceptedNames} names, ${accepted.length} rows`);
    console.log(`quarantined rows by reason: ${JSON.stringify(byReason)}`);
    console.log(`review CSV: ${csvPath} (${quarantined.length} rows)`);
    console.log(`CANNABIS_NPI_ENRICH_${args.dryRun ? 'DRY_RUN_' : 'OK_'}${state} accepted=${accepted.length} quarantined=${quarantined.length}`);
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('CANNABIS_NPI_ENRICH_FAILED:', e.message); process.exit(1); });
}

module.exports = { lookupCandidates, filterByName, normalizeName, stripMiddleInitials };
