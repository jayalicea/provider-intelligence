/**
 * Schema-drift guard for the national screening pipeline.
 *
 * These queries are tested against mockDb, whose column names once diverged
 * from the real schema and the bug shipped ("column p.provider_first_name
 * does not exist"). This test extracts the actual SQL out of the service and
 * the overnight populate tool and asserts every table-qualified column
 * referenced exists in information_schema, so schema drift fails the suite
 * loudly instead of at runtime.
 *
 * Skips gracefully when no database is configured/reachable.
 */
process.env.LOG_LEVEL = 'error';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');

const serviceSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'intelligenceService.js'), 'utf8');
const populateSource = fs.readFileSync(
  path.join(__dirname, '..', 'tools', 'overnight-national-screening.js'), 'utf8');

function extractTemplate(source, marker) {
  const templates = [...source.matchAll(/`([^`]*)`/g)].map(m => m[1]);
  const hit = templates.find(t => t.includes(marker));
  if (!hit) throw new Error(`could not locate SQL containing "${marker}"`);
  return hit;
}

const SOURCES = [
  {
    name: 'getNationalCohort (national_screening)',
    sql: extractTemplate(serviceSource, 'FROM national_screening'),
    refs: [{ alias: 's', table: 'national_screening' }]
  },
  {
    name: 'overnight populate (nppes_providers + registries + mips)',
    sql: extractTemplate(populateSource, 'FROM nppes_providers'),
    refs: [
      { alias: 'p', table: 'nppes_providers' },
      { alias: 'leie', table: 'oig_exclusions' },
      { alias: 'se', table: 'state_exclusions' },
      { alias: 'ms', table: 'mips_performance_scores' }
    ]
  }
];

for (const src of SOURCES) {
  src.columnsByTable = src.refs.map(({ alias, table }) => ({
    table,
    columns: [...new Set(
      [...src.sql.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))].map(m => m[1])
    )]
  }));
}

describe('national screening SQL vs live schema', () => {
  let tables = null;

  beforeAll(async () => {
    try {
      const names = [...new Set(SOURCES.flatMap(s => s.columnsByTable.map(r => r.table)))];
      const result = await db.query(
        'SELECT table_name, column_name FROM information_schema.columns WHERE table_name = ANY($1)',
        [names]
      );
      tables = new Map();
      for (const row of result.rows) {
        if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
        tables.get(row.table_name).add(row.column_name);
      }
    } catch (error) {
      tables = null;
    } finally {
      await db.pool.end().catch(() => {});
    }
  }, 15000);

  if (!process.env.DB_HOST && !process.env.DATABASE_URL) {
    it.skip('no database configured; schema-drift check skipped', () => {});
    return;
  }

  for (const src of SOURCES) {
    for (const ref of src.columnsByTable) {
      test(`${src.name}: every ${ref.table} column referenced exists`, () => {
        if (!tables) {
          console.warn('database unreachable; skipping schema assertions');
          return;
        }
        const actual = tables.get(ref.table);
        if (!actual) throw new Error(`table ${ref.table} not found in information_schema`);
        const missing = ref.columns.filter(c => !actual.has(c));
        expect(missing).toEqual([]);
      });
    }
  }

  test('service query selects the materialized identity and verdict columns', () => {
    const screeningCols = SOURCES[0].columnsByTable[0].columns;
    for (const expected of ['npi', 'entity_name', 'entity_type', 'practice_city',
      'practice_state', 'primary_taxonomy_code', 'leie_verdict', 'leie_detail',
      'state_verdict', 'state_detail', 'mips_available', 'final_score', 'computed_at']) {
      expect(screeningCols).toContain(expected);
    }
  });
});
