process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');
const nock = require('nock');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const {
  isolateNet, resetNet,
  npiEnvelope, PROVIDER_ROW, LICENSES_PARSED,
  mockNpiSearch
} = require('./helpers/apiMocks');

const app = new (require('../src/app'))().app;

beforeAll(() => {
  isolateNet();
});

afterEach(() => {
  resetNet();
  mockDb._reset();
});

describe('GET /api/v1/providers/search', () => {
  test('returns transformed providers for a name search', async () => {
    mockNpiSearch('Smith', npiEnvelope([PROVIDER_ROW]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.total).toBe(1);
    expect(res.body.offset).toBe(0);
    expect(res.body.limit).toBe(50);
    expect(res.body.data[0]).toMatchObject({
      npi: '1234567890',
      enumerationType: 'Individual',
      name: { first: 'JOHN', last: 'DOE', credential: 'MD' },
      address: { city: 'BALTIMORE', state: 'MD', zipcode: '21201' },
      taxonomy: { code: '207R00000X', description: 'Physician/Internal Medicine' },
      license: { number: 'MD12345', state: 'MD' }
    });
    expect(nock.isDone()).toBe(true);
  });

  test('accepts state/city criteria without terms', async () => {
    mockNpiSearch(undefined, npiEnvelope([PROVIDER_ROW]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ state: 'MD', city: 'Baltimore' });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(nock.isDone()).toBe(true);
  });

  test('400 when no search criterion is given', async () => {
    const res = await request(app).get('/api/v1/providers/search');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one search criterion/i);
  });

  test('400 for invalid maxResults (non-numeric, zero, over 500)', async () => {
    for (const maxResults of ['abc', '0', '501', '10.5']) {
      const res = await request(app)
        .get('/api/v1/providers/search')
        .query({ terms: 'Smith', maxResults });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/maxresults/i);
    }
  });

  test('400 for invalid offset (non-numeric, negative)', async () => {
    for (const offset of ['abc', '-1']) {
      const res = await request(app)
        .get('/api/v1/providers/search')
        .query({ terms: 'Smith', offset });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/offset/i);
    }
  });

  test('400 when offset + maxResults exceeds the upstream 7500 cap', async () => {
    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith', maxResults: 500, offset: 7100 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/7500/i);
  });

  test('echoes requested offset and limit with the upstream total', async () => {
    mockNpiSearch('Smith', npiEnvelope([PROVIDER_ROW]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith', maxResults: 10, offset: 20 });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.offset).toBe(20);
    expect(res.body.limit).toBe(10);
    expect(res.body.count).toBe(1);
    expect(nock.isDone()).toBe(true);
  });

  test('results include hasMipsData; a scored NPI reports true', async () => {
    mockDb._stores.mips.set('1234567890:2025', {
      npi: '1234567890',
      performance_year: 2025,
      final_score: 87.5
    });
    const unscoredRow = { ...PROVIDER_ROW, npi: '9876543210' };
    mockNpiSearch('Smith', npiEnvelope([PROVIDER_ROW, unscoredRow]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith' });

    expect(res.status).toBe(200);
    const byNpi = Object.fromEntries(res.body.data.map(p => [p.npi, p]));
    expect(byNpi['1234567890'].hasMipsData).toBe(true);
    expect(byNpi['9876543210'].hasMipsData).toBe(false);
  });
});

describe('GET /api/v1/providers/:npi', () => {
  test('fetches provider from NPI API, transforms, and caches to DB', async () => {
    const scope = mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));

    const res = await request(app).get('/api/v1/providers/1234567890');

    expect(res.status).toBe(200);
    expect(res.body.data.npi).toBe('1234567890');
    expect(res.body.data.mipsPerformance).toBeNull();

    // cached row exists with non-enumerable sync_timestamp intact
    const cached = mockDb._stores.providers.get('1234567890');
    expect(cached).toBeDefined();
    expect(cached.name_last).toBe('DOE');
    expect(scope.isDone()).toBe(true);
  });

  test('second request is served from cache without hitting the NPI API', async () => {
    mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));

    const first = await request(app).get('/api/v1/providers/1234567890');
    // no nock interceptor defined for the second call — disableNetConnect
    // fails the test if it reaches for the network
    const second = await request(app).get('/api/v1/providers/1234567890');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  test('cache-hit response matches fresh-API response shape exactly', async () => {
    mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));

    const first = await request(app).get('/api/v1/providers/1234567890');
    const second = await request(app).get('/api/v1/providers/1234567890');

    // sync_timestamp must not leak into the JSON body
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
    expect(second.body.data.sync_timestamp).toBeUndefined();
  });

  test('includeMips=true attaches MIPS performance data', async () => {
    mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));
    require('./helpers/apiMocks').mockMipsData('1234567890', [{
      npi: '1234567890',
      'final score': '87.5',
      'quality category score': '80',
      'improvement activities (ia) category score': '40',
      'promoting interoperability (pi) category score': '95',
      'cost category score': '60',
      'participation option': 'Individual',
      'reporting option': 'Traditional MIPS'
    }]);

    const res = await request(app)
      .get('/api/v1/providers/1234567890')
      .query({ includeMips: 'true' });

    expect(res.status).toBe(200);
    expect(res.body.data.mipsPerformance.finalScore).toBe(87.5);
  });

  test('400 for malformed NPI', async () => {
    const res = await request(app).get('/api/v1/providers/123');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid npi/i);
  });

  test('parses the JSON-stringified licenses array from ef=licenses', async () => {
    mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));

    const res = await request(app).get('/api/v1/providers/1234567890');

    expect(res.status).toBe(200);
    expect(res.body.data.licenses).toEqual(LICENSES_PARSED);
  });

  test('malformed or missing licenses values transform to an empty array', async () => {
    for (const licenses of ['not json', '', null]) {
      resetNet();
      mockNpiSearch('1234567890', npiEnvelope([{ ...PROVIDER_ROW, licenses }]));

      const res = await request(app).get('/api/v1/providers/1234567890');

      expect(res.status).toBe(200);
      expect(res.body.data.licenses).toEqual([]);
    }
  });

  test('cache write stores the license baseline in provider_licenses', async () => {
    mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));

    await request(app).get('/api/v1/providers/1234567890');

    const rows = mockDb._stores.providerLicenses
      .filter(r => r.npi === '1234567890');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      license_number: 'MD12345',
      issuing_state: 'MD',
      is_primary_taxonomy: true,
      taxonomy_code: '207R00000X',
      source: 'NPI Registry'
    });
    expect(rows.every(r => r.as_of instanceof Date)).toBe(true);
  });
});
