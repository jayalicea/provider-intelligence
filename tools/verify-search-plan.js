#!/usr/bin/env node
// Confirms, against the real database, that name search no longer walks the
// name b-tree in order (the slow plan fixed in
// jayalicea/provider-intelligence#24).
//
//   node tools/verify-search-plan.js [labTerm] [facilityTerm]
//
// Runs the exact query the services build (their db.query calls are captured
// and re-run as EXPLAIN ANALYZE), prints each plan's indexes and timing:
//   FAIL  the plan walks the name b-tree (idx_*_name): the slow plan; exit 1
//   PASS  the plan uses the trigram index (idx_*_name_trgm)
//   OK    another plan, e.g. a sequential scan, which the planner picks when
//         many rows match; fine as long as the time is acceptable
// Read-only.
require('dotenv').config();
const db = require('../src/config/database');
const CliaService = require('../src/services/cliaService');
const FacilityService = require('../src/services/facilityService');

async function explainSearch(run) {
  const realQuery = db.query;
  let plan = null;
  db.query = async (sql, params) => {
    if (!/ORDER BY/.test(sql)) return { rows: [{ n: 0 }] };  // skip the COUNT
    const { rows } = await realQuery(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params);
    plan = rows[0]['QUERY PLAN'][0];
    return { rows: [] };
  };
  try { await run(); } finally { db.query = realQuery; }
  return plan;
}

function indexesUsed(node, out = new Set()) {
  if (node['Index Name']) out.add(node['Index Name']);
  for (const child of node.Plans || []) indexesUsed(child, out);
  return out;
}

async function main([labTerm = 'quest', facilityTerm = 'hospice']) {
  const checks = [
    { label: `labs name="${labTerm}"`, trigram: 'idx_clia_labs_name_trgm', btree: 'idx_clia_labs_name',
      run: () => new CliaService().searchLabs({ name: labTerm }) },
    { label: `facilities name="${facilityTerm}"`, trigram: 'idx_facilities_name_trgm', btree: 'idx_facilities_name',
      run: () => new FacilityService().searchFacilities({ name: facilityTerm }) }
  ];
  let ok = true;
  for (const c of checks) {
    const plan = await explainSearch(c.run);
    const used = [...indexesUsed(plan.Plan)];
    const verdict = used.includes(c.btree) ? 'FAIL' : used.includes(c.trigram) ? 'PASS' : 'OK  ';
    if (verdict === 'FAIL') ok = false;
    console.log(`${verdict}  ${c.label}: ${plan['Execution Time'].toFixed(1)} ms, indexes: ${used.join(', ') || 'none (sequential scan)'}`);
  }
  if (!ok) console.log('\nFAIL: the search walks the name b-tree. Confirm the deployed code includes #24 and run ANALYZE on the table.');
  return ok;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(ok => db.pool.end().then(() => process.exit(ok ? 0 : 1)))
    .catch(err => { console.error(`verify-search-plan: ${err.message}`); process.exit(1); });
}

module.exports = { indexesUsed };
