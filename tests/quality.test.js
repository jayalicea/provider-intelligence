process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');
const nock = require('nock');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const {
  isolateNet, resetNet, QM_ROWS,
  mockDatastore
} = require('./helpers/apiMocks');

const app = new (require('../src/app'))().app;

beforeAll(() => {
  isolateNet();
});

afterEach(() => {
  resetNet();
  mockDb._reset();
});

describe('GET /api/v1/providers/quality-measures/:facilityId', () => {
  test('returns transformed measures for the default (complications) family', async () => {
    const scope = mockDatastore('ynj2-r877', { results: QM_ROWS, count: QM_ROWS.length });

    const res = await request(app)
      .get('/api/v1/providers/quality-measures/140010');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.data[0]).toEqual({
      facilityId: '140010',
      measureId: 'COMP_HIP_KNEE',
      measureName: 'Rate of complications for hip/knee replacement patients',
      score: 3.8,
      denominator: 850,
      lowerEstimate: 2.4,
      higherEstimate: 6.0,
      comparedToNational: 'No Different Than the National Rate',
      startDate: '2023-04-01',
      endDate: '2025-03-31'
    });
    expect(scope.isDone()).toBe(true);
  });

  test('non-numeric scores (footnote codes) become null', async () => {
    mockDatastore('ynj2-r877', { results: QM_ROWS, count: QM_ROWS.length });

    const res = await request(app)
      .get('/api/v1/providers/quality-measures/140010');

    expect(res.body.data[1].score).toBeNull();
    expect(res.body.data[1].denominator).toBeNull();
  });

  test.each([
    ['readmissions', '632h-zaca'],
    ['infections', '77hc-ibv8'],
    ['hcahps', 'dgck-syfz']
  ])('type=%s queries dataset %s', async (type, datasetId) => {
    const scope = mockDatastore(datasetId, { results: QM_ROWS, count: QM_ROWS.length });

    const res = await request(app)
      .get(`/api/v1/providers/quality-measures/140010`)
      .query({ type });

    expect(res.status).toBe(200);
    expect(scope.isDone()).toBe(true);
  });

  test('unknown type falls back to the complications dataset', async () => {
    const scope = mockDatastore('ynj2-r877', { results: QM_ROWS, count: QM_ROWS.length });

    const res = await request(app)
      .get('/api/v1/providers/quality-measures/140010')
      .query({ type: 'nonsense' });

    expect(res.status).toBe(200);
    expect(scope.isDone()).toBe(true);
  });

  test('results are cached to the quality_measures table', async () => {
    mockDatastore('ynj2-r877', { results: QM_ROWS, count: QM_ROWS.length });

    await request(app).get('/api/v1/providers/quality-measures/140010');

    const rows = mockDb._stores.quality.filter(
      r => r.facility_id === '140010' && r.data_source === 'CARE_COMPARE_COMPLICATIONS'
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].measure_id).toBe('COMP_HIP_KNEE');
    expect(rows[0].reporting_period_start).toBe('2023-04-01');
  });

  test('second request is served from cache without hitting the datastore API', async () => {
    mockDatastore('ynj2-r877', { results: QM_ROWS, count: QM_ROWS.length });

    const first = await request(app).get('/api/v1/providers/quality-measures/140010');
    const second = await request(app).get('/api/v1/providers/quality-measures/140010');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });
});
