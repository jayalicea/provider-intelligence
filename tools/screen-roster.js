#!/usr/bin/env node
// Screen a provider roster CSV against the OIG LEIE table.
// Usage: node tools/screen-roster.js <input.csv> <output.csv>
//
// Input header must contain npi OR (lastname, firstname, state); dob is
// optional. Output is the input columns plus exclusion_verdict,
// exclusion_match, exclusion_type, exclusion_date, exclusion_source,
// exclusion_as_of, reinstated_date, provenance_note. Bad rows never crash
// the batch: they come back UNVERIFIED with the reason in provenance_note.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');
const ExclusionService = require('../src/services/exclusionService');

// --- minimal CSV parsing (quoted fields, escaped quotes) -------------------

function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  // Drop trailing fully-empty rows
  while (rows.length && rows[rows.length - 1].every(v => v === '')) rows.pop();
  return rows;
}

const csvEscape = v => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// --- main -------------------------------------------------------------------

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error('Usage: node tools/screen-roster.js <input.csv> <output.csv>');
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(inputPath, 'utf8'));
  if (rows.length === 0) {
    console.error('Input CSV is empty');
    process.exit(1);
  }
  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = name => header.indexOf(name);

  const hasNpi = col('npi') !== -1;
  const hasName = col('lastname') !== -1 && col('firstname') !== -1 && col('state') !== -1;
  if (!hasNpi && !hasName) {
    console.error('Input header must contain npi or (lastname, firstname, state)');
    process.exit(1);
  }
  const dobIdx = col('dob');

  const service = new ExclusionService();
  const outHeader = rows[0].concat([
    'exclusion_verdict', 'exclusion_match', 'exclusion_type',
    'exclusion_date', 'exclusion_source', 'exclusion_as_of',
    'reinstated_date', 'provenance_note'
  ]);

  const counts = { EXCLUDED: 0, CLEAR: 0, UNVERIFIED: 0 };
  const lines = [outHeader.map(csvEscape).join(',')];

  for (const row of rows.slice(1)) {
    const get = i => (i === -1 ? null : row[i]);
    let result;
    try {
      result = await service.resolveExclusion({
        npi: get(col('npi')),
        lastname: get(col('lastname')),
        firstname: get(col('firstname')),
        state: get(col('state')),
        dob: get(dobIdx)
      });
    } catch (err) {
      result = {
        verdict: 'UNVERIFIED', match: null, exclusion: null, reinstated: null,
        notes: [`Resolver error: ${err.message}`]
      };
    }
    counts[result.verdict] = (counts[result.verdict] || 0) + 1;
    lines.push(row.concat([
      result.verdict,
      result.match || '',
      result.exclusion ? result.exclusion.type : '',
      result.exclusion ? result.exclusion.date : '',
      result.exclusion ? result.exclusion.source : '',
      result.exclusion ? result.exclusion.asOf : '',
      result.reinstated ? result.reinstated.date : '',
      (result.notes || []).join(' ')
    ]).map(csvEscape).join(','));
  }

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n') + '\n');

  const total = rows.length - 1;
  console.log(`Screened ${total} row(s) -> ${outputPath}`);
  console.log(`EXCLUDED: ${counts.EXCLUDED}, CLEAR: ${counts.CLEAR}, UNVERIFIED: ${counts.UNVERIFIED}`);

  await db.pool.end();
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
