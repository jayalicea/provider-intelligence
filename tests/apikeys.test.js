process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';
process.env.API_KEYS = 'billing:test-secret-1,partner:test-secret-2';

const crypto = require('crypto');
const request = require('supertest');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const ApiKeyService = require('../src/services/apiKeyService');
const app = new (require('../src/app'))().app;

afterEach(() => {
  mockDb._reset();
  ApiKeyService.shared.useEnvKeys();
  jest.restoreAllMocks();
});

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

  test('roster screening succeeds with a valid key (second key in the set)', async () => {
    const res = await request(app)
      .post('/api/v1/intelligence/screen-roster')
      .set('X-API-Key', 'test-secret-2')
      .send({ rows: [{ npi: '1366446619', lastname: 'DOE', firstname: 'JANE', state: 'CA' }] });
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

describe('database-backed keys (api_keys table)', () => {
  const digest = key => crypto.createHash('sha256').update(key).digest('hex');

  test('key present in api_keys is accepted', async () => {
    mockDb._stores.apiKeys.set('pilot', {
      key_hash: digest('pilot-secret'), label: 'pilot',
      created_at: new Date(), revoked_at: null
    });
    await ApiKeyService.shared.loadFromDatabase();

    const res = await request(app)
      .post('/api/v1/intelligence/screen-roster')
      .set('X-API-Key', 'pilot-secret')
      .send({ rows: [{ npi: '1366446619', lastname: 'DOE', firstname: 'JANE', state: 'CA' }] });
    expect(res.status).toBe(200);
  });

  test('revoked key is rejected even though its row still exists', async () => {
    mockDb._stores.apiKeys.set('old-pilot', {
      key_hash: digest('old-pilot-secret'), label: 'old-pilot',
      created_at: new Date(), revoked_at: new Date()
    });
    await ApiKeyService.shared.loadFromDatabase();

    const res = await request(app)
      .post('/api/v1/intelligence/screen-roster')
      .set('X-API-Key', 'old-pilot-secret')
      .send({ rows: [{ npi: '1366446619', lastname: 'DOE', firstname: 'JANE', state: 'CA' }] });
    expect(res.status).toBe(401);
  });

  test('falls back to API_KEYS env keys when the table is unreadable', async () => {
    jest.spyOn(mockDb, 'query')
      .mockRejectedValue(new Error('relation "api_keys" does not exist'));

    await ApiKeyService.shared.loadFromDatabase();
    expect(ApiKeyService.shared.source).toBe('env');

    const res = await request(app)
      .post('/api/v1/intelligence/screen-roster')
      .set('X-API-Key', 'test-secret-1')
      .send({ rows: [{ npi: '1366446619', lastname: 'DOE', firstname: 'JANE', state: 'CA' }] });
    expect(res.status).toBe(200);
  });
});

describe('tools/api-keys.js', () => {
  const { issueKey, listKeys, revokeKey, generateKey } = require('../tools/api-keys');

  test('issueKey generates a >=128-bit key and stores only its digest', async () => {
    const { label, key } = await issueKey(mockDb, 'pilot');
    expect(label).toBe('pilot');
    expect(key.length).toBeGreaterThanOrEqual(22); // 192 bits, base64url

    const stored = mockDb._stores.apiKeys.get('pilot');
    expect(stored.key_hash).toBe(digestOf(key));
    expect(stored.key_hash).not.toBe(key);
    expect(stored.revoked_at).toBeNull();
  });

  test('revokeKey sets revoked_at and refuses to revoke twice', async () => {
    await issueKey(mockDb, 'pilot');
    await expect(revokeKey(mockDb, 'pilot')).resolves.toBe(1);
    await expect(revokeKey(mockDb, 'pilot'))
      .rejects.toThrow('no active key with label "pilot"');
    await expect(revokeKey(mockDb, 'missing'))
      .rejects.toThrow('no active key with label "missing"');
  });

  test('listKeys reports label, created_at and revoked_at', async () => {
    await issueKey(mockDb, 'one');
    await issueKey(mockDb, 'two');
    await revokeKey(mockDb, 'two');

    const rows = await listKeys(mockDb);
    expect(rows).toHaveLength(2);
    const one = rows.find(r => r.label === 'one');
    const two = rows.find(r => r.label === 'two');
    expect(one.created_at).toBeInstanceOf(Date);
    expect(one.revoked_at).toBeNull();
    expect(two.revoked_at).toBeInstanceOf(Date);
  });

  test('generateKey produces distinct keys', () => {
    expect(generateKey()).not.toBe(generateKey());
  });

  const digestOf = key => crypto.createHash('sha256').update(key).digest('hex');
});
