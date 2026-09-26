#!/usr/bin/env node
// Enrich a WATCHLIST SUBSET of clia_labs with director and certificate
// data from CMS QCOR (Quality, Certification and Oversight Reports) -
// the only public source of CLIA lab-director identities (the POS file
// carries no director fields). Two QCOR requests per lab: the search
// response page, then its active_popup.jsp detail. Rate-limited and
// subset-only by design: QCOR is a government operational system, not a
// bulk API.
//
// Parsed per lab: Lab Director, Certificate Type, Accrediting
// Organizations, Certificate Effective/Expiration dates, Facility Type.
// The director name is matched against the local NPPES individuals pool
// (name + state, unique-candidate gate - same audit discipline as the
// cannabis tools); non-unique or absent matches leave director_npi NULL.
//
// Usage: node tools/clia-director-qcor.js (--clia 01D0026356,34D... | --limit N) [--dry-run] [--delay-ms 1500]

const { Client } = require('pg');
const fs = require('fs');
const { normalizeName, stripMiddleInitials } = require('./cannabis-npi-enrich');

const SEARCH_URL = 'https://qcor.cms.gov/advanced_find_provider_response.jsp?which=4&provider=22&backReport=active_CLIA.jsp';
const UA = 'provider-intelligence-clia-director-enrich/1.0 (public QCOR data; watchlist subset; contact: local admin)';

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
  const args = { clia: null, limit: null, backfill: null, dryRun: false, delayMs: 1500 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--clia') args.clia = String(argv[++i] || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--backfill') args.backfill = parseInt(argv[++i], 10);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--delay-ms') args.delayMs = parseInt(argv[++i], 10);
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  if (!args.clia && !args.limit && !args.backfill) {
    console.error('Provide a watchlist subset: --clia 01D...,34D..., --limit N, or --backfill N');
    process.exit(1);
  }
  return args;
}

function fetchText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.request(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', ...(options.headers || {}) },
      method: options.method || 'GET',
      timeout: 45000
    }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchText(new URL(res.headers.location, url).href, options));
        }
        resolve(body);
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout: ${url}`)));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const entity = s => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;/g, "'");

function stripTags(html) {
  return entity(html.replace(/<[^>]*>/g, '\n')).split('\n').map(l => l.trim()).filter(Boolean);
}

function fieldAfter(lines, label) {
  const i = lines.findIndex(l => l === label || l.startsWith(label));
  if (i === -1) return null;
  const rest = lines[i].slice(label.length).trim();
  if (rest) return rest || null;
  return lines[i + 1] || null;
}

function parsePopup(html) {
  const lines = stripTags(html);
  return {
    labDirector: fieldAfter(lines, 'Lab Director:'),
    certificateType: fieldAfter(lines, 'Certificate Type:'),
    accreditingOrgs: fieldAfter(lines, 'Accrediting Organizations:'),
    certificateEffective: fieldAfter(lines, 'Certificate Effective Date:'),
    certificateExpiration: fieldAfter(lines, 'Certificate Expiration Date:'),
    facilityType: fieldAfter(lines, 'Facility Type:')
  };
}

function toIsoDate(v) {
  const m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

async function main() {
  const args = parseArgs(process.argv);
  const env = readEnvFile();
  const c = new Client({
    host: env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || '5432', 10),
    database: env.DB_NAME || 'provider_intelligence',
    user: env.DB_USER || 'admin',
    password: env.DB_PASSWORD || '',
  });
  await c.connect();

  try {
    let labs;
    if (args.clia) {
      ({ rows: labs } = await c.query('SELECT clia_number, lab_name, state FROM clia_labs WHERE clia_number = ANY($1::text[])', [args.clia]));
    } else if (args.backfill != null) {
      // Scheduled-incremental mode: registered labs not yet enriched,
      // stalest sync first, bounded per run.
      ({ rows: labs } = await c.query(
        `SELECT clia_number, lab_name, state FROM clia_labs
          WHERE currently_registered AND director_name IS NULL
          ORDER BY sync_timestamp ASC, clia_number ASC LIMIT $1`, [args.backfill]));
    } else {
      ({ rows: labs } = await c.query('SELECT clia_number, lab_name, state FROM clia_labs WHERE currently_registered ORDER BY clia_number LIMIT $1', [args.limit]));
    }

    console.log(`watchlist subset: ${labs.length} labs`);

    let done = 0, enriched = 0, matched = 0, failed = 0;
    for (const lab of labs) {
      done++;
      try {
        // 1) search by exact CLIA number
        const body = `name=&prvdr=${encodeURIComponent(lab.clia_number)}&director=&state=XX&city=&zip=&report=${encodeURIComponent('active_CLIA.jsp')}&apptype=`;
        const resHtml = await fetchText(SEARCH_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        const popupMatch = resHtml.match(/active_popup\.jsp\?[^'"]*prvdr_intrnl_num=([A-Z0-9]+)[^'"]*'/i);
        if (!popupMatch || !resHtml.includes(lab.clia_number)) {
          console.log(`  ${lab.clia_number}: no QCOR result (delisted or unmatched)`);
          // Touch so scheduled backfill rotates past this lab instead of
          // re-picking it every run; QCOR may republish it later.
          if (!args.dryRun) {
            await c.query('UPDATE clia_labs SET sync_timestamp = CURRENT_TIMESTAMP WHERE clia_number = $1', [lab.clia_number]);
          }
          continue;
        }
        await sleep(args.delayMs);

        // 2) detail popup
        const popupUrl = 'https://qcor.cms.gov/' + resHtml.match(/createPopUp\('([^']*active_popup\.jsp[^']*)'\)/)[1].replace(/&amp;/g, '&');
        const info = parsePopup(await fetchText(popupUrl));
        if (!info.labDirector) {
          console.log(`  ${lab.clia_number}: popup parsed but no director field`);
          continue;
        }

        // 3) director NPI: unique name+state match against NPPES individuals
        // (QCOR renders titles/credentials inside the name - strip them)
        let directorNpi = null;
        const cleaned = normalizeName(info.labDirector)
          .replace(/^(DR|DOCTOR)\.? /, '')
          .replace(/,.*$/, '')
          .replace(/ (MD|DO|M\.D\.|D\.O\.|PHD|PH\.D\.)$/, '');
        const nameParts = cleaned.split(' ').filter(Boolean);
        if (nameParts.length >= 2) {
          const last = nameParts[nameParts.length - 1];
          const first = nameParts[0];
          const { rows: cands } = await c.query(
            `SELECT npi FROM nppes_providers
              WHERE entity_type_code = '1' AND last_name = $1 AND first_name LIKE $2 || '%' AND practice_state = $3`,
            [last, first, lab.state]
          );
          if (cands.length === 1) directorNpi = String(cands[0].npi);
        }

        if (args.dryRun) {
          console.log(`  DRY ${lab.clia_number} ${lab.lab_name}: director=${info.labDirector} npi=${directorNpi || 'unmatched'} exp=${info.certificateExpiration || 'n/a'} orgs=${info.accreditingOrgs || 'n/a'}`);
          enriched++;
          if (directorNpi) matched++;
          continue;
        }

        await c.query(
          `UPDATE clia_labs
              SET director_name = $1, director_npi = $2, certificate_expiration_dt = $3,
                  qcor_facility_type = $4, qcor_accrediting_orgs = $5, sync_timestamp = CURRENT_TIMESTAMP
            WHERE clia_number = $6`,
          [info.labDirector, directorNpi, toIsoDate(info.certificateExpiration),
           info.facilityType, info.accreditingOrgs, lab.clia_number]
        );
        enriched++;
        if (directorNpi) matched++;
        console.log(`  ${lab.clia_number} ${lab.lab_name}: director=${info.labDirector} npi=${directorNpi || 'unmatched'} exp=${info.certificateExpiration || 'n/a'}`);
      } catch (e) {
        failed++;
        console.warn(`  warn: ${lab.clia_number}: ${e.message}`);
      }
      await sleep(args.delayMs);
    }

    console.log(`CLIA_DIRECTOR_QCOR_${args.dryRun ? 'DRY_RUN_' : 'OK'} subset=${labs.length} enriched=${enriched} directorNpiMatched=${matched} failed=${failed}`);
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('CLIA_DIRECTOR_QCOR_FAILED:', e.message); process.exit(1); });
}

module.exports = { parsePopup };
