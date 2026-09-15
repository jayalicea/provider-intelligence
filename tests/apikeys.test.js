process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';
process.env.API_KEYS = 'billing:test-secret-1,partner:test-secret-2';

const request = require('supertest');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const app = new (require('../src/app'))().app;

afterEach(() => mockDb._reset());

describe('X-API-Key write protection', () => {
  test('POST without a key returns 401', async () => {
    const res = await request(app)
      .post('/api/v1/intelligence/screen-roster')
      .send({ rows: [{ npi: '1366446619', lastname: 'DOE', firstname: 'JANE', state: 'CA' }] });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or missing API key/i);
  });

  test('POST with a bad key returns 401', async () => {
    const res = await request(app)
      .post('/api/v1/intelligence/screen-roster')
      .set('X-API-Key', 'not-a-real-key')
      .send({ rows: [{ npi: '1366446619', lastname: 'DOE', firstname: 'JANE', state: 'CA' }] });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or missing API key/i);
  });

  test('roster screening succeeds with a valid key', async () => {
    const res = await request(app)
      .post('/api/v1/intelligence/screen-roster')
      .set('X-API-Key', 'test-secret-1')
      .send({ rows: [{ npi: '1366446619', lastname: 'DOE', firstname: 'JANE', state: 'CA' }] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('bulk data succeeds with a valid key (second key in the set)', async () => {
    const res = await request(app)
      .post('/api/v1/providers/bulk-data')
      .set('X-API-Key', 'test-secret-2')
      .send({ npis: ['1366446619'], includeMips: false });
    expect(res.status).toBe(200);
  });

  test('GET endpoints stay open without a key', async () => {
    const res = await request(app).get('/api/v1/intelligence/exclusion-watchlist');
    expect(res.status).toBe(200);
  });
});

describe('usage metering', () => {
  test('an authenticated write records one api_usage row', async () => {
    await request(app)
      .post('/api/v1/intelligence/screen-roster')
      .set('X-API-Key', 'test-secret-1')
      .send({ rows: [{ npi: '1366446619', lastname: 'DOE', firstname: 'JANE', state: 'CA' }] })
      .expect(200);

    await new Promise(resolve => setImmediate(resolve));

    const usage = mockDb._stores.apiUsage;
    expect(usage).toHaveLength(1);
    expect(usage[0].key_label).toBe('billing');
    expect(usage[0].endpoint).toBe('/api/v1/intelligence/screen-roster');
    expect(usage[0].method).toBe('POST');
    expect(usage[0].status).toBe(200);
  });

  test('failed writes are metered with their error status', async () => {
    await request(app)
      .post('/api/v1/intelligence/screen-roster')
      .set('X-API-Key', 'test-secret-1')
      .send({ rows: [] })
      .expect(400);

    await new Promise(resolve => setImmediate(resolve));
    expect(mockDb._stores.apiUsage[0].status).toBe(400);
  });

  test('admin usage endpoint requires a key and reports per-key totals', async () => {
    const denied = await request(app).get('/api/v1/admin/usage');
    expect(denied.status).toBe(401);

    await request(app)
      .post('/api/v1/intelligence/screen-roster')
      .set('X-API-Key', 'test-secret-2')
      .send({ rows: [{ npi: '1366446619', lastname: 'DOE', firstname: 'JANE', state: 'CA' }] })
      .expect(200);
    await new Promise(resolve => setImmediate(resolve));

    const res = await request(app)
      .get('/api/v1/admin/usage?days=30')
      .set('X-API-Key', 'test-secret-1');
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(30);
    const partner = res.body.byKey.find(r => r.key_label === 'partner');
    expect(partner.requests).toBe(1);
    expect(res.body.byEndpoint.some(r =>
      r.endpoint === '/api/v1/intelligence/screen-roster' && r.requests === 1)).toBe(true);
  });

  test('admin usage validates days', async () => {
    const res = await request(app)
      .get('/api/v1/admin/usage?days=0')
      .set('X-API-Key', 'test-secret-1');
    expect(res.status).toBe(400);
  });
});
