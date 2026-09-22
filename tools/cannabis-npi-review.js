#!/usr/bin/env node
// Decision-support pass over the FL quarantine backlog, plus an optional
// promotion mode. Default (read-only): for every cannabis_certifications row
// that is npi-less with a quarantine note whose reason is NOT no-candidates
// (the name resolved to at least one FL candidate but failed the audit gate),
// re-resolve the name against the NPI Registry and dump every name-filtered
// candidate with full detail to a CSV for human review.
//
// --promote-zip (writes DB): for rows quarantined as unique-name-no-city —
// exactly one name-filtered FL candidate, city mismatch — promote the row
// when that candidate's zip5 equals the OMMU row's zip5 (the OMMU zip comes
// from re-parsing tmp/qplist.txt, whose parser reads the Zip column). The
// promoted note says "unique name+zip match". Everything else stays
// quarantined untouched, and the regenerated CSV lists only still-quarantined
// rows. Without --promote-zip this tool performs no database writes.
//
// Usage: node tools/cannabis-npi-review.js [--promote-zip] [--dry-run] [--limit N] [--delay-ms N]
//        (default 100ms delay)

const fs = require('fs');
const path = require('path');
const { parseQpList } = require('./cannabis-ingest.js');
const {
  lookupCandidates, filterByName, normalizeName, stripMiddleInitials
} = require('./cannabis-npi-enrich.js');

const STATE = 'FL';
const QPLIST_FILE = 'tmp/qplist.txt';
// Base shape plus the detail fields the review CSV needs per candidate.
const EXTRA_FIELDS = [
  'name.first', 'name.middle', 'name.last', 'name.credential',
  'addr_practice.city', 'addr_practice.zip', 'licenses.taxonomy.classification'
].join(',');

const zip5 = z => String(z || '').replace(/\D/g, '').slice(0, 5);

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
  const args = { promoteZip: false, dryRun: false, limit: null, delayMs: 100 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--promote-zip') args.promoteZip = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--delay-ms') args.delayMs = parseInt(argv[++i], 10);
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  return args;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function csvField(v) {
  const s = String(v == null ? '' : v);
  return /[",\n;|]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Quarantine reason from the provenance note; null when not quarantined.
function quarantineReason(note) {
  const m = String(note || '').match(/ \| NPI match quarantined \d{4}-\d{2}-\d{2}: ([^|]+)$/);
  return m ? m[1].trim() : null;
}

// Strip a prior NPI-match note so promotion replaces the quarantine note.
function freshNote(note) {
  return String(note || '')
    .replace(/ \| NPI matched \d{4}-\d{2}-\d{2}: [^|]*$/g, '')
    .replace(/ \| NPI match quarantined \d{4}-\d{2}-\d{2}: [^|]*$/g, '')
    .trim();
}

function formatCandidate(cd) {
  const fullName = [cd.first, normalizeName(cd.raw.middle), cd.last]
    .filter(Boolean).join(' ');
  const cred = cd.raw.credential ? `, ${normalizeName(cd.raw.credential)}` : '';
  return `${cd.npi}|${fullName}${cred}|${cd.city}|${zip5(cd.raw.zip)}|${normalizeName(cd.raw.taxonomyClassification) || ''}`;
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
    const res = await c.query(
      `SELECT license_number, practitioner_last_name, practitioner_first_name, provenance_note
         FROM cannabis_certifications
        WHERE npi IS NULL AND state = $1
        ORDER BY practitioner_last_name, practitioner_first_name`,
      [STATE]
    );

    // Keep only quarantined rows whose reason means candidates exist; the
    // promotion pass narrows further to unique-name-no-city.
    const dbRows = [];
    const byReasonSeen = {};
    for (const r of res.rows) {
      const reason = quarantineReason(r.provenance_note);
      if (!reason) continue;                       // never enriched / stale
      if (reason === 'no-candidates') continue;    // nothing to detail
      if (args.promoteZip && reason !== 'unique-name-no-city') continue;
      byReasonSeen[reason] = (byReasonSeen[reason] || 0) + 1;
      dbRows.push(r);
    }
    const limited = args.limit ? dbRows.slice(0, parseInt(args.limit, 10)) : dbRows;

    const { rows: qpRows } = parseQpList(fs.readFileSync(QPLIST_FILE, 'utf8'));
    const cityByLicense = new Map(qpRows.map(r => [r.license, r.city || '']));
    const zipByLicense = new Map(qpRows.map(r => [r.license, zip5(r.zip)]));

    const groups = new Map();
    for (const r of limited) {
      const first = normalizeName(stripMiddleInitials(r.practitioner_first_name));
      const last = normalizeName(r.practitioner_last_name);
      const key = `${last}|${first}`;
      if (!groups.has(key)) groups.set(key, { last, first, rows: [] });
      groups.get(key).rows.push({
        license: r.license_number,
        ommuFirst: r.practitioner_first_name,
        ommuLast: r.practitioner_last_name,
        city: cityByLicense.get(r.license_number) || '',
        zip: zipByLicense.get(r.license_number) || '',
        note: r.provenance_note,
        reason: quarantineReason(r.provenance_note)
      });
    }

    const csvLines = ['license_number,ommu_first,ommu_last,ommu_city,reason,candidate_count,candidates'];
    const promoted = [];
    let lookedUp = 0, failed = 0;
    for (const g of groups.values()) {
      lookedUp++;
      if (lookedUp % 50 === 0) console.log(`  progress: ${lookedUp}/${groups.size} names`);
      let candidates;
      try {
        candidates = await lookupCandidates(g.last, g.first, EXTRA_FIELDS);
      } catch (e) {
        failed++;
        console.warn(`  warn: lookup failed for ${g.last} ${g.first}: ${e.message}`);
        candidates = [];
      }
      const matches = filterByName(candidates, g.last, g.first);
      const detail = matches.map(formatCandidate).join('; ');
      for (const r of g.rows) {
        // Zip promotion: exactly one name-filtered candidate whose zip5
        // matches the OMMU row's zip5. Everything else stays quarantined.
        const zipMatch = args.promoteZip && matches.length === 1 &&
          r.zip && zip5(matches[0].raw.zip) === r.zip;
        if (zipMatch) {
          promoted.push({
            license: r.license,
            npi: matches[0].npi,
            note: `${freshNote(r.note)} | NPI matched ${today}: unique name+zip match`
          });
          continue;
        }
        csvLines.push(
          [r.license, r.ommuFirst, r.ommuLast, r.city, r.reason, matches.length, detail]
            .map(csvField).join(',')
        );
      }
      await sleep(args.delayMs);
    }

    fs.mkdirSync(path.join('data', 'cannabis'), { recursive: true });
    const csvPath = path.join('data', 'cannabis', `npi-match-review-detail-${today}.csv`);
    fs.writeFileSync(csvPath, csvLines.join('\r\n') + '\r\n');

    if (promoted.length && !args.dryRun) {
      await c.query('BEGIN');
      try {
        for (const p of promoted) {
          await c.query(
            `UPDATE cannabis_certifications
                SET npi = $1, provenance_note = $2
              WHERE state = $3 AND license_number = $4`,
            [p.npi, p.note, STATE, p.license]
          );
        }
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }

    const csvRows = csvLines.length - 1;
    console.log(`mode: ${args.promoteZip ? (args.dryRun ? 'promote-zip DRY-RUN' : 'promote-zip') : 'read-only detail'}`);
    console.log(`rows in scope: ${dbRows.length} ${JSON.stringify(byReasonSeen)}`);
    console.log(`names looked up: ${lookedUp} (lookup failures: ${failed})`);
    console.log(`promoted: ${promoted.length}${args.dryRun && promoted.length ? ' (dry-run; no writes)' : ''}`);
    console.log(`detail CSV: ${csvPath} (${csvRows} still-quarantined rows)`);
    console.log(`CANNABIS_NPI_REVIEW_${args.dryRun ? 'DRY_RUN_' : ''}OK rows=${csvRows} promoted=${promoted.length}`);
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('CANNABIS_NPI_REVIEW_FAILED:', e.message); process.exit(1); });
}
