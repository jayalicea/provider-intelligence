const db = require('../src/config/database');
const { nameOrder } = require('../src/utils/searchOrder');
const CliaService = require('../src/services/cliaService');
const FacilityService = require('../src/services/facilityService');

describe('nameOrder', () => {
  test('3+ character name sorts on an expression (steers to the trigram index)', () => {
    expect(nameOrder('quest', 'lab_name')).toBe("(lab_name || '')");
  });

  test.each([[undefined], [''], ['st']])('name %p keeps the plain column (b-tree order)', (name) => {
    expect(nameOrder(name, 'lab_name')).toBe('lab_name');
  });
});

describe('search services', () => {
  let spy;
  beforeEach(() => {
    spy = jest.spyOn(db, 'query').mockImplementation(async (sql) =>
      sql.includes('COUNT') ? { rows: [{ n: 0 }] } : { rows: [] });
  });
  afterEach(() => spy.mockRestore());

  const rowsSql = () => spy.mock.calls.map(c => c[0]).find(s => !s.includes('COUNT'));

  test('lab name search orders by the expression with a clia_number tie-breaker', async () => {
    await new CliaService().searchLabs({ name: 'quest' });
    expect(rowsSql()).toMatch(/ORDER BY \(lab_name \|\| ''\), clia_number/);
  });

  test('lab state-only search keeps b-tree order with a tie-breaker', async () => {
    await new CliaService().searchLabs({ state: 'ca' });
    expect(rowsSql()).toMatch(/ORDER BY lab_name, clia_number/);
  });

  test('facility name search orders by the expression with a ccn tie-breaker', async () => {
    await new FacilityService().searchFacilities({ name: 'hospice' });
    expect(rowsSql()).toMatch(/ORDER BY \(facility_name \|\| ''\), ccn/);
  });

  test('rows and count queries are issued together, not sequentially', async () => {
    let resolveFirst;
    spy.mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }));
    const pending = new CliaService().searchLabs({ name: 'quest' });
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(2); // count started while rows still pending
    resolveFirst({ rows: [] });
    await expect(pending).resolves.toEqual({ rows: [], total: 0 });
  });
});

describe('tools/verify-search-plan indexesUsed', () => {
  const { indexesUsed } = require('../tools/verify-search-plan');

  test('collects index names from nested plan nodes', () => {
    const plan = {
      'Node Type': 'Limit',
      Plans: [{ 'Node Type': 'Sort', Plans: [{ 'Node Type': 'Bitmap Heap Scan', Plans: [
        { 'Node Type': 'Bitmap Index Scan', 'Index Name': 'idx_clia_labs_name_trgm' }
      ] }] }]
    };
    expect([...indexesUsed(plan)]).toEqual(['idx_clia_labs_name_trgm']);
  });

  test('a sequential scan uses no index', () => {
    expect([...indexesUsed({ 'Node Type': 'Seq Scan' })]).toEqual([]);
  });
});
