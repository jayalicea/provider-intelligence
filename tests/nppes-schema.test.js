/**
 * Schema-drift guard for the national cohort query.
 *
 * The national cohort query is tested against mockDb, whose column names
 * once diverged from the real nppes_providers schema and the bug shipped
 * (column p.provider_first_name does not exist). This test reads the actual
 * query out of intelligenceService.js and asserts every table-qualified
 * column it references exists in information_schema, so schema drift fails
 * the suite loudly instead of at runtime.
 *
 * Skips gracefully when no database is configured/reachable.
 */
process.env.LOG_LEVEL = 'error';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');

const serviceSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'intelligenceService.js'),
  'utf8'
);

// Pull the national SQL template out of getNationalCohort: the template
// literal (backtick-to-backtick, no nested backticks inside) that contains
// the nppes_providers FROM clause.
const templates = [...serviceSource.matchAll(/`([^`]*FROM nppes_providers[^`]*)`/g)];
if (!templates.length) throw new Error('could not locate getNationalCohort query in service source');
const nationalSql = templates[0][1];

const referencedColumns = (alias, table) => ({
  table,
  columns: [...new Set(
    [...nationalSql.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))].map(m => m[1])
  )]
});

const REFERENCES = [
  referencedColumns('p', 'nppes_providers'),
  referencedColumns('m', 'mips_performance_scores')
];

describe('national cohort query vs live schema', () => {
  let tables = null;

  beforeAll(async () => {
    try {
      const result = await db.query(
        'SELECT table_name, column_name FROM information_schema.columns WHERE table_name = ANY($1)',
        [REFERENCES.map(r => r.table)]
      );
      tables = new Map();
      for (const row of result.rows) {
        if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
        tables.get(row.table_name).add(row.column_name);
      }
    } catch (error) {
      tables = null; // no database configured: suite skips, mocks still cover logic
    } finally {
      await db.pool.end().catch(() => {});
    }
  }, 15000);

  if (!process.env.DB_HOST && !process.env.DATABASE_URL) {
    it.skip('no database configured; schema-drift check skipped', () => {});
    return;
  }

  for (const ref of REFERENCES) {
    test(`every ${ref.table} column referenced by getNationalCohort exists`, () => {
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

  test('query references the expected identity columns', () => {
    const npiCols = REFERENCES.find(r => r.table === 'nppes_providers').columns;
    for (const expected of ['npi', 'entity_type_code', 'first_name', 'middle_name',
      'last_name', 'legal_business_name', 'practice_city', 'practice_state',
      'primary_taxonomy_code', 'as_of']) {
      expect(npiCols).toContain(expected);
    }
  });
});
