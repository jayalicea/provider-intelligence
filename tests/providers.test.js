process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');
const nock = require('nock');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const {
  isolateNet, resetNet,
  npiEnvelope, PROVIDER_ROW,
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
});
