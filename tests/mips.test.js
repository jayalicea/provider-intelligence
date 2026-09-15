process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';
process.env.API_KEYS = 'ci-test:ci-secret';

const request = require('supertest');
const nock = require('nock');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const {
  isolateNet, resetNet, MIPS_ROW,
  mockMipsData
} = require('./helpers/apiMocks');

const app = new (require('../src/app'))().app;

beforeAll(() => {
  isolateNet();
});

afterEach(() => {
  resetNet();
  mockDb._reset();
});

describe('GET /api/v1/providers/:npi/mips-performance', () => {
  test('returns transformed MIPS scores and caches to DB', async () => {
    const scope = mockMipsData('1111111111', [MIPS_ROW]);

    const res = await request(app)
      .get('/api/v1/providers/1111111111/mips-performance')
      .query({ year: 2023 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      npi: '1111111111',
      performanceYear: 2023,
      finalScore: 87.5,
      qualityScore: 80,
      improvementActivitiesScore: 40,
      promotingInteroperabilityScore: 95,
      costScore: 60,
      performanceStatus: 'Individual',
      reportingEntityType: 'Traditional MIPS'
    });
    expect(scope.isDone()).toBe(true);

    const cached = mockDb._stores.mips.get('1111111111:2023');
    expect(cached).toBeDefined();
    expect(Number(cached.final_score)).toBe(87.5);
  });

  test('second request is served from cache without hitting the CMS API', async () => {
    mockMipsData('1111111111', [MIPS_ROW]);

    const first = await request(app)
      .get('/api/v1/providers/1111111111/mips-performance')
      .query({ year: 2023 });
    const second = await request(app)
      .get('/api/v1/providers/1111111111/mips-performance')
      .query({ year: 2023 });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.body.data.sync_timestamp).toBeUndefined();
  });

  test('404 when CMS has no data for the NPI', async () => {
    mockMipsData('1111111111', []);

    const res = await request(app)
      .get('/api/v1/providers/1111111111/mips-performance')
      .query({ year: 2023 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no mips performance data found/i);
  });

  test('400 for malformed NPI', async () => {
    const res = await request(app)
      .get('/api/v1/providers/notanpi/mips-performance')
      .query({ year: 2023 });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/providers/:npi/mips-trends', () => {
  test('aggregates scores across the requested years', async () => {
    // two years -> two getMipsPerformance calls -> two API hits (no cache yet)
    mockMipsData('1111111111', [MIPS_ROW]);
    mockMipsData('1111111111', [MIPS_ROW]);

    const res = await request(app)
      .get('/api/v1/providers/1111111111/mips-trends')
      .query({ startYear: 2022, endYear: 2023 });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      npi: '1111111111',
      performanceYears: [2022, 2023],
      finalScores: [87.5, 87.5],
      qualityScores: [80, 80],
      improvementActivitiesScores: [40, 40],
      promotingInteroperabilityScores: [95, 95],
      costScores: [60, 60]
    });
  });

  test('400 for malformed NPI', async () => {
    const res = await request(app)
      .get('/api/v1/providers/999/mips-trends')
      .query({ startYear: 2022, endYear: 2023 });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/providers/bulk-data', () => {
  test('returns MIPS data for all valid NPIs', async () => {
    mockMipsData('1111111111', [MIPS_ROW]);
    mockMipsData('2222222222', [{ ...MIPS_ROW, npi: '2222222222', 'final score': '55' }]);

    const res = await request(app)
      .post('/api/v1/providers/bulk-data').set('X-API-Key', 'ci-secret')
      .send({ npis: ['1111111111', '2222222222'], performanceYear: 2023 });

    expect(res.status).toBe(200);
    expect(res.body.data.totalRequested).toBe(2);
    expect(res.body.data.totalValid).toBe(2);
    expect(res.body.data.results).toHaveLength(2);
  });

  test('filters out malformed NPIs', async () => {
    mockMipsData('1111111111', [MIPS_ROW]);

    const res = await request(app)
      .post('/api/v1/providers/bulk-data').set('X-API-Key', 'ci-secret')
      .send({ npis: ['bad', '1111111111'], performanceYear: 2023 });

    expect(res.status).toBe(200);
    expect(res.body.data.totalRequested).toBe(2);
    expect(res.body.data.totalValid).toBe(1);
    expect(res.body.data.results).toHaveLength(1);
  });

  test('400 when npis is missing or not an array', async () => {
    const res = await request(app)
      .post('/api/v1/providers/bulk-data').set('X-API-Key', 'ci-secret')
      .send({ performanceYear: 2023 });

    expect(res.status).toBe(400);
  });

  test('400 when no NPIs are valid', async () => {
    const res = await request(app)
      .post('/api/v1/providers/bulk-data').set('X-API-Key', 'ci-secret')
      .send({ npis: ['bad1', 'bad2'], performanceYear: 2023 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no valid npi/i);
  });
});
