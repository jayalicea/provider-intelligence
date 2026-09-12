process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');
const nock = require('nock');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const {
  isolateNet, resetNet,
  npiEnvelope, MIPS_ROW, QM_ROWS,
  mockNpiSearch, mockMipsData, mockDatastore
} = require('./helpers/apiMocks');

const app = new (require('../src/app'))().app;

beforeAll(() => {
  isolateNet();
});

afterEach(() => {
  resetNet();
  mockDb._reset();
});

describe('error handling', () => {
  test('NPI API failure -> 500 with generic message', async () => {
    mockNpiSearch('Smith', 'upstream exploded', 500);

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to search for providers' });
  });

  test('CMS MIPS API failure -> 500', async () => {
    mockMipsData('1111111111', 'boom', 500);

    const res = await request(app)
      .get('/api/v1/providers/1111111111/mips-performance')
      .query({ year: 2023 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to retrieve MIPS performance data' });
  });

  test('datastore API failure -> 500', async () => {
    mockDatastore('ynj2-r877', 'boom', 500);

    const res = await request(app)
      .get('/api/v1/providers/quality-measures/140010');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to retrieve quality measure data' });
  });

  test('NPI not found upstream -> 500 (provider lookup failure path)', async () => {
    mockNpiSearch('9999999999', npiEnvelope([]));

    const res = await request(app).get('/api/v1/providers/9999999999');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to retrieve provider information' });
  });

  test('unknown route -> 404 JSON from the app-level handler', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Endpoint not found' });
  });

  test('health endpoint stays available', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });
});
