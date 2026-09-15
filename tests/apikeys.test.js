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
