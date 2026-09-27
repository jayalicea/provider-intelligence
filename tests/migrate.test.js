const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadMigrations, plan, up, baseline } = require('../src/config/migrate');

function tmpMigrations(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return loadMigrations(dir);
}

// Minimal fake pg client: tracks schema_migrations rows, existing tables,
// and every SQL statement run; `failOn` makes a statement throw.
function fakeClient({ applied = [], tables = [], failOn } = {}) {
  const rows = [...applied];
  const calls = [];
  return {
    calls,
    rows,
    async query(sql, params) {
      calls.push(sql);
      if (failOn && sql.includes(failOn)) throw new Error('boom');
      if (sql.startsWith('SELECT filename, checksum')) return { rows: [...rows] };
      if (sql.startsWith('SELECT to_regclass')) return { rows: [{ ok: tables.includes(params[0]) }] };
      if (sql.startsWith('INSERT INTO schema_migrations')) rows.push({ filename: params[0], checksum: params[1] });
      return { rows: [] };
    }
  };
}

const quiet = () => {};

describe('migrate runner', () => {
  test('loads .sql files in filename order and parses requires-table headers', () => {
    const ms = tmpMigrations({
      'b.sql': '-- requires-table: nppes_providers\nCREATE INDEX x ON nppes_providers (a);',
      'a.sql': 'CREATE TABLE a (id int);',
      'notes.txt': 'ignored'
    });
    expect(ms.map(m => m.filename)).toEqual(['a.sql', 'b.sql']);
    expect(ms[1].requiresTables).toEqual(['nppes_providers']);
    expect(ms[0].checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  test('plan separates pending, changed, and missing files', () => {
    const ms = tmpMigrations({ 'a.sql': 'A', 'b.sql': 'B', 'c.sql': 'C' });
    const p = plan(ms, [
      { filename: 'a.sql', checksum: ms[0].checksum },
      { filename: 'b.sql', checksum: 'stale' },
      { filename: 'gone.sql', checksum: 'x' }
    ]);
    expect(p.pending.map(m => m.filename)).toEqual(['c.sql']);
    expect(p.changed.map(m => m.filename)).toEqual(['b.sql']);
    expect(p.missing).toEqual(['gone.sql']);
  });

  test('up applies pending files in a transaction and records them', async () => {
    const ms = tmpMigrations({ 'a.sql': 'CREATE TABLE a (id int);', 'b.sql': 'CREATE TABLE b (id int);' });
    const client = fakeClient({ applied: [{ filename: 'a.sql', checksum: ms[0].checksum }] });
    const r = await up(client, ms, quiet);
    expect(r).toEqual({ applied: ['b.sql'], deferred: [] });
    const i = client.calls.indexOf('CREATE TABLE b (id int);');
    expect(client.calls[i - 1]).toBe('BEGIN');
    expect(client.calls[i + 2]).toBe('COMMIT');
    expect(client.calls).not.toContain('CREATE TABLE a (id int);');
  });

  test('up defers a migration whose required table is missing', async () => {
    const ms = tmpMigrations({ 'a.sql': '-- requires-table: nppes_providers\nCREATE INDEX i ON nppes_providers (x);' });
    const client = fakeClient();
    expect(await up(client, ms, quiet)).toEqual({ applied: [], deferred: ['a.sql'] });
    expect(client.rows).toHaveLength(0);

    const withTable = fakeClient({ tables: ['nppes_providers'] });
    expect((await up(withTable, ms, quiet)).applied).toEqual(['a.sql']);
  });

  test('up rolls back and rethrows with the filename on failure', async () => {
    const ms = tmpMigrations({ 'bad.sql': 'SELECT broken();' });
    const client = fakeClient({ failOn: 'broken' });
    await expect(up(client, ms, quiet)).rejects.toThrow('bad.sql: boom');
    expect(client.calls).toContain('ROLLBACK');
    expect(client.rows).toHaveLength(0);
  });

  test('up warns about edited files but does not re-run them', async () => {
    const ms = tmpMigrations({ 'a.sql': 'CREATE TABLE a (id int);' });
    const log = jest.fn();
    const client = fakeClient({ applied: [{ filename: 'a.sql', checksum: 'old' }] });
    expect((await up(client, ms, log)).applied).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('a.sql was edited'));
  });

  test('baseline records pending files without running their SQL', async () => {
    const ms = tmpMigrations({ 'a.sql': 'CREATE TABLE a (id int);' });
    const client = fakeClient();
    expect(await baseline(client, ms)).toEqual({ recorded: ['a.sql'], deferred: [] });
    expect(client.calls).not.toContain('CREATE TABLE a (id int);');
    expect(client.rows.map(r => r.filename)).toEqual(['a.sql']);
  });

  test('baseline leaves a migration pending when its required table is missing', async () => {
    const ms = tmpMigrations({
      'a.sql': 'CREATE TABLE a (id int);',
      'b.sql': '-- requires-table: nppes_providers\nCREATE INDEX i ON nppes_providers (x);'
    });
    const client = fakeClient();
    expect(await baseline(client, ms)).toEqual({ recorded: ['a.sql'], deferred: ['b.sql'] });
    expect(client.rows.map(r => r.filename)).toEqual(['a.sql']);

    // Once the table exists, up applies the file baseline skipped.
    const later = fakeClient({ applied: client.rows, tables: ['nppes_providers'] });
    expect((await up(later, ms, quiet)).applied).toEqual(['b.sql']);
  });

  test('checksum ignores CRLF vs LF line endings', () => {
    const [lf] = tmpMigrations({ 'a.sql': 'CREATE TABLE a (id int);\nSELECT 1;\n' });
    const [crlf] = tmpMigrations({ 'a.sql': 'CREATE TABLE a (id int);\r\nSELECT 1;\r\n' });
    expect(crlf.checksum).toBe(lf.checksum);
  });

  test('repository migrations tag the tool-created nppes_providers dependency', () => {
    const nppes = loadMigrations().filter(m => /\bON\s+nppes_providers\b/i.test(m.sql));
    expect(nppes.length).toBeGreaterThan(0);
    for (const m of nppes) expect(m.requiresTables).toContain('nppes_providers');
  });
});
