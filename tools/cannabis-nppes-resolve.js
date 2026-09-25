#!/usr/bin/env node
// Algorithmic resolver for the quarantine left behind by
// tools/cannabis-nppes-match.js. Where the gate demanded a unique
// name+city match, this tool SCORES every candidate on multiple
// independent signals and auto-accepts only decisive winners:
//
//   signal                    points
//   practice or mailing ZIP    +4   (source list ZIP; strongest — moves
//                                      with the person far less than city)
//   city                       +3
//   first name exact           +2   /  prefix +1
//   middle initial agreement   +1   /  conflict -1
//   last name exact            +1   (cleaned-variant match scores 0)
//
//   accept: best >= 5  AND  best - second >= 3
//   accept: best >= 4 with margin >= 3 AND a middle-initial agreement
//           (the WV case: no city/ZIP signal available)
//
// Everything accepted carries its winning signals in provenance_note;
// everything still ambiguous gets a richer review CSV (candidates with
// scores). No human required, but every decision is auditable after the
// fact, and the conservative floor keeps false-positive NPI links rare —
// a wrong link is worse than no link.
//
// Usage: node tools/cannabis-nppes-resolve.js [--state FL] [--dry-run] [--limit N]

const fs = require('fs');
const path = require('path');
const { normalizeName, stripMiddleInitials } = require('./cannabis-npi-enrich');
const { parseQpList } = require('./cannabis-ingest');
const { parseWvList } = require('./cannabis-ingest-wv');
const { parseAlList } = require('./cannabis-ingest-al');
const { parsePaList } = require('./cannabis-ingest-pa');

const SOURCE = {
  FL: { file: 'tmp/qplist.txt', parse: parseQpList, key: 'license', city: true, zip: true },
  AL: { file: 'tmp/al-physicians.txt', parse: parseAlList, key: 'name', city: true, zip: false },
  WV: { file: 'tmp/wv-physicians.txt', parse: parseWvList, key: 'license', city: false, zip: false },
  PA: { file: 'tmp/pa-practitioners.txt', parse: parsePaList, key: 'name', city: true, zip: true },
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
  if (args.state && !SOURCE[args.state]) {
    console.error(`Unsupported --state ${args.state} (known: ${Object.keys(SOURCE).join(', ')})`);
    process.exit(1);
  }
  return args;
}

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

const clean = s => normalizeName(s).replace(/[^A-Z0-9]/g, '');
const firstToken = s => normalizeName(s).split(' ')[0];
const zip5 = z => String(z || '').replace(/\D/g, '').slice(0, 5);

// --- pure scoring core (unit-tested) ---------------------------------------

// Score one candidate against the source row's signals.
function scoreCandidate(src, cd) {
  let score = 0;
  const signals = [];
  if (src.zip && (cd.zip === src.zip || cd.mailingZip === src.zip)) {
    score += 4; signals.push('zip');
  }
  if (src.city && cd.city === src.city) {
    score += 3; signals.push('city');
  }
  if (cd.first === src.first) { score += 2; signals.push('first-exact'); }
  else if (src.first.length >= 4 && cd.first.startsWith(src.first)) { score += 1; signals.push('first-prefix'); }
  if (src.middle && cd.middle) {
    if (src.middle === cd.middle) { score += 1; signals.push('middle'); }
    else { score -= 1; signals.push('middle-conflict'); }
  }
  if (cd.last === src.last) { score += 1; signals.push('last-exact'); }
  return { score, signals };
}

// Decide from scored candidates: accept only a decisive winner.
function decideScored(scored) {
  if (scored.length === 0) return { status: 'quarantine', reason: 'no-candidates' };
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const second = sorted[1] || { score: 0 };
  const margin = best.score - second.score;
  const middleAgrees = best.signals.includes('middle');
  if (best.score >= 5 && margin >= 3) {
    return { status: 'accept', npi: best.npi, note: best.signals.join('+'), score: best.score, margin };
  }
  if (best.score >= 4 && margin >= 3 && middleAgrees) {
    return { status: 'accept', npi: best.npi, note: `${best.signals.join('+')} (no-city tier)`, score: best.score, margin };
  }
  return {
    status: 'quarantine',
    reason: sorted.length === 1 ? 'single-candidate-below-threshold' : 'no-decisive-winner',
    best: { npi: best.npi, score: best.score, signals: best.signals.join('+'), margin },
  };
}

// --- in-memory NPPES pool with lookup indexes -------------------------------

async function loadPool(client, state) {
  const { rows } = await client.query(
    `SELECT npi, first_name, last_name, middle_name, credential,
            practice_city, practice_zip, mailing_zip
       FROM nppes_providers
      WHERE entity_type_code = '1' AND practice_state = $1`,
    [state]
  );
  const byLast = new Map();
  const byCleanLast = new Map();
  for (const r of rows) {
    const cd = {
      npi: String(r.npi),
      first: normalizeName(r.first_name),
      last: normalizeName(r.last_name),
      middle: normalizeName(r.middle_name).replace(/[^A-Z]/g, '').slice(0, 1),
      credential: normalizeName(r.credential),
      city: normalizeName(r.practice_city),
      zip: zip5(r.practice_zip),
      mailingZip: zip5(r.mailing_zip),
    };
    if (!byLast.has(cd.last)) byLast.set(cd.last, []);
    byLast.get(cd.last).push(cd);
    const cl = clean(cd.last);
    if (cl !== cd.last) {
      if (!byCleanLast.has(cl)) byCleanLast.set(cl, []);
      byCleanLast.get(cl).push(cd);
    }
  }
  return {
    size: rows.length,
    // All name-plausible candidates for a source name: exact last,
    // cleaned-last variant, same first initial (superset the scorer filters).
    candidatesFor(src) {
      const seen = new Map();
      const initial = src.first[0];
      const pools = [byLast.get(src.last), byCleanLast.get(clean(src.last))];
      for (const pool of pools) {
        if (!pool) continue;
        for (const cd of pool) {
          if (cd.first[0] !== initial) continue;
          if (!seen.has(cd.npi)) seen.set(cd.npi, cd);
        }
      }
      return [...seen.values()];
    },
  };
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
    const states = args.state ? [args.state] : Object.keys(SOURCE);

    for (const state of states) {
      const limitClause = args.limit ? `LIMIT ${parseInt(args.limit, 10)}` : '';
      const { rows: dbRows } = await c.query(
        `SELECT license_number, practitioner_last_name, practitioner_first_name,
                provenance_note
           FROM cannabis_certifications
          WHERE npi IS NULL AND state = $1
          ORDER BY practitioner_last_name, practitioner_first_name
          ${limitClause}`,
        [state]
      );

      const spec = SOURCE[state];
      const { rows: parsedRows } = spec.parse(fs.readFileSync(spec.file, 'utf8'));
      const signalsByKey = new Map();
      for (const r of parsedRows) {
        if (spec.key === 'license') {
          signalsByKey.set(r.license, {
            city: spec.city ? normalizeName(r.city) : '',
            zip: spec.zip ? zip5(r.zip) : '',
          });
        } else {
          const last = normalizeName(r.last);
          const first = normalizeName(stripMiddleInitials(r.first));
          signalsByKey.set(`${last}|${first}`, {
            city: spec.city ? normalizeName(r.city) : '',
            zip: spec.zip ? zip5(r.zip) : '',
          });
        }
      }

      console.log(`${state}: loading NPPES pool...`);
      const pool = await loadPool(c, state);
      console.log(`${state}: ${pool.size} individuals in pool; ${dbRows.length} unmatched rows`);

      const groups = new Map();
      for (const r of dbRows) {
        const firstFull = normalizeName(r.practitioner_first_name);
        const first = normalizeName(stripMiddleInitials(r.practitioner_first_name));
        const last = normalizeName(r.practitioner_last_name);
        const key = `${last}|${first}`;
        const sigKey = r.license_number ? r.license_number : key;
        const sig = signalsByKey.get(sigKey) || { city: '', zip: '' };
        if (!groups.has(key)) {
          groups.set(key, {
            last, first,
            middle: firstFull.split(' ').slice(1).join(' ').replace(/[^A-Z]/g, '').slice(0, 1),
            rows: [],
          });
        }
        groups.get(key).rows.push({
          license: r.license_number,
          lastName: r.practitioner_last_name,
          firstName: r.practitioner_first_name,
          city: sig.city,
          zip: sig.zip,
          provenance: r.provenance_note,
        });
      }

      const accepted = [];
      const quarantined = [];
      let done = 0;

      for (const g of groups.values()) {
        done++;
        if (done % 200 === 0) console.log(`  ${state}: ${done}/${groups.size} names`);
        const candidates = pool.candidatesFor(g);
        // Group-level preview scores (city/zip are per-row; detail is only a
        // review aid, so score without them).
        const scored = candidates.map(cd => ({
          npi: cd.npi,
          ...scoreCandidate({ last: g.last, first: g.first, middle: g.middle, city: '', zip: '' }, cd),
        }));
        // Score per source row (city/zip differ per row within a name group).
        const detail = scored
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map(s => `${s.npi}:${s.score}(${s.signals.join('+')})`)
          .join('; ');

        for (const r of g.rows) {
          const src = { ...g, city: r.city, zip: r.zip };
          const rowScored = candidates.map(cd => ({ npi: cd.npi, ...scoreCandidate(src, cd) }));
          const decision = decideScored(rowScored);
          if (decision.status === 'accept') {
            accepted.push({
              license: r.license,
              lastName: r.lastName,
              firstName: r.firstName,
              npi: decision.npi,
              provenance: `${freshNote(r.provenance)} | NPI matched ${today}: NPPES auto-resolve ${decision.note} [score ${decision.score}, margin ${decision.margin}]`,
            });
          } else {
            quarantined.push({
              license: r.license,
              lastName: r.lastName,
              firstName: r.firstName,
              last: g.last,
              first: g.first,
              city: r.city,
              zip: r.zip,
              reason: decision.reason,
              best: decision.best || null,
              detail,
              provenance: r.provenance,
            });
          }
        }
      }

      fs.mkdirSync(path.join('data', 'cannabis'), { recursive: true });
      const csvPath = path.join('data', 'cannabis', `${state.toLowerCase()}-nppes-resolve-review-${today}.csv`);
      const csvLines = ['license_number,last,first,city,zip,reason,best_npi,best_score,best_signals,margin,top_candidates'];
      for (const q of quarantined) {
        csvLines.push([
          q.license, q.last, q.first, q.city, q.zip, q.reason,
          q.best?.npi || '', q.best?.score ?? '', q.best?.signals || '', q.best?.margin ?? '',
          q.detail || '',
        ].map(csvField).join(','));
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
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      }

      console.log(`state: ${state}${args.dryRun ? ' (dry-run)' : ''}`);
      console.log(`resolved automatically: ${accepted.length} rows`);
      console.log(`still quarantined by reason: ${JSON.stringify(byReason)}`);
      console.log(`review CSV: ${csvPath} (${quarantined.length} rows)`);
      console.log(`CANNABIS_NPPES_RESOLVE_${args.dryRun ? 'DRY_RUN_' : 'OK_'}${state} accepted=${accepted.length} quarantined=${quarantined.length}`);
    }
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('CANNABIS_NPPES_RESOLVE_FAILED:', e.message); process.exit(1); });
}

module.exports = { scoreCandidate, decideScored };
