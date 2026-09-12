process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');
const nock = require('nock');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const { isolateNet, resetNet, npiEnvelope } = require('./helpers/apiMocks');

const app = new (require('../src/app'))().app;

const NPI_HOST = 'https://clinicaltables.nlm.nih.gov';

function makeRows(start, count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const n = String(start + i).padStart(10, '0');
    rows.push({
      npi: n,
      'name.full': `PROVIDER, ${n}`,
      'name.first': `FIRST${n}`,
      'name.last': `LAST${n}`,
      'name.credential': 'MD',
      providerType: 'Physician/Internal Medicine',
      addressFull: `100 MAIN ST, BALTIMORE, MD 2120${i % 10}`,
      'addr_practice.line1': '100 MAIN ST',
      'addr_practice.line2': '',
      'addr_practice.city': 'BALTIMORE',
      'addr_practice.state': 'MD',
      'addr_practice.zip': '21201',
      'addr_practice.phone': '(410) 555-1212',
      'licenses.taxonomy.code': '207R00000X',
      'licenses.taxonomy.grouping': 'Allopathic & Osteopathic Physicians',
      'licenses.lic_number': 'MD12345',
      'licenses.issuing_state': 'MD'
    });
  }
  return rows;
}

beforeAll(() => {
  isolateNet();
});

afterEach(() => {
  resetNet();
});

describe('search pagination (offset)', () => {
  test('offset=0 and offset=500 return disjoint, non-empty pages', async () => {
    const page1 = makeRows(1_000_000_000, 500);
    const page2 = makeRows(2_000_000_000, 500);

    nock(NPI_HOST)
      .get('/api/npi_idv/v3/search')
      .query(q => q.offset === '0' || q.offset === undefined)
      .reply(200, npiEnvelope(page1));

    nock(NPI_HOST)
      .get('/api/npi_idv/v3/search')
      .query(q => q.offset === '500' && q.count === '500')
      .reply(200, npiEnvelope(page2));

    const res1 = await request(app)
      .get('/api/v1/providers/search')
      .query({ state: 'MD', maxResults: 500, offset: 0 });
    const res2 = await request(app)
      .get('/api/v1/providers/search')
      .query({ state: 'MD', maxResults: 500, offset: 500 });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.data).toHaveLength(500);
    expect(res2.body.data).toHaveLength(500);

    const npis1 = new Set(res1.body.data.map(p => p.npi));
    const npis2 = new Set(res2.body.data.map(p => p.npi));
    expect(npis2.size).toBe(500);
    for (const npi of npis2) {
      expect(npis1.has(npi)).toBe(false);
    }

    expect(nock.isDone()).toBe(true);
  });

  test('rejects a negative offset', async () => {
    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ state: 'MD', offset: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/offset/i);
  });
});
