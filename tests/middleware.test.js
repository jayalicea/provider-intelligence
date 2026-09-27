process.env.LOG_LEVEL = 'error';

const errorHandler = require('../src/middleware/errorHandler');
const rateLimiter = require('../src/middleware/rateLimiter');

function mockRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
}

describe('middleware/errorHandler', () => {
  const req = { method: 'GET', originalUrl: '/api/v1/x' };

  test('client error (status < 500) returns the error message', () => {
    const res = mockRes();
    const err = Object.assign(new Error('bad request'), { status: 400 });

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'bad request' });
  });

  test('server error (status >= 500) returns a generic message', () => {
    const res = mockRes();
    const err = Object.assign(new Error('db exploded'), { status: 500 });

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Internal server error' });
  });

  test('missing status defaults to 500 generic', () => {
    const res = mockRes();

    errorHandler(new Error('mystery'), req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Internal server error' });
  });
});

describe('middleware/rateLimiter', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  function fakeReq(ip = '10.0.0.1') {
    return { ip, socket: { remoteAddress: ip } };
  }

  test('allows requests up to max, then 429s', () => {
    const limiter = rateLimiter({ windowMs: 60_000, max: 3 });

    for (let i = 0; i < 3; i++) {
      const res = mockRes();
      limiter(fakeReq(), res, jest.fn());
      expect(res.status).not.toHaveBeenCalled();
    }

    const blocked = mockRes();
    limiter(fakeReq(), blocked, jest.fn());
    expect(blocked.status).toHaveBeenCalledWith(429);
    expect(blocked.json).toHaveBeenCalledWith({ error: 'Rate limit exceeded. Please try again later.' });
  });

  test('counts are per-IP', () => {
    const limiter = rateLimiter({ windowMs: 60_000, max: 1 });

    limiter(fakeReq('10.0.0.1'), mockRes(), jest.fn());
    limiter(fakeReq('10.0.0.2'), mockRes(), jest.fn());

    const blocked = mockRes();
    limiter(fakeReq('10.0.0.1'), blocked, jest.fn());
    expect(blocked.status).toHaveBeenCalledWith(429);
  });

  test('window resets after windowMs elapses', () => {
    jest.useFakeTimers({ now: new Date('2026-09-22T00:00:00Z') });
    const limiter = rateLimiter({ windowMs: 60_000, max: 1 });

    limiter(fakeReq(), mockRes(), jest.fn());

    let blocked = mockRes();
    limiter(fakeReq(), blocked, jest.fn());
    expect(blocked.status).toHaveBeenCalledWith(429);

    jest.setSystemTime(new Date('2026-09-22T00:01:01Z'));

    const allowed = mockRes();
    limiter(fakeReq(), allowed, jest.fn());
    expect(allowed.status).not.toHaveBeenCalled();
  });
});

describe('app trust proxy (TRUST_PROXY)', () => {
  const App = require('../src/app');
  const original = process.env.TRUST_PROXY;
  afterEach(() => {
    if (original === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = original;
  });

  test('is off by default so X-Forwarded-For cannot be spoofed', () => {
    delete process.env.TRUST_PROXY;
    expect(new App().app.get('trust proxy')).toBe(false);
  });

  test('numeric value sets the hop count', () => {
    process.env.TRUST_PROXY = '1';
    expect(new App().app.get('trust proxy')).toBe(1);
  });

  test('non-numeric value passes through as an Express trust string', () => {
    process.env.TRUST_PROXY = 'loopback';
    expect(new App().app.get('trust proxy')).toBe('loopback');
  });
});

describe('middleware/cacheControl', () => {
  const express = require('express');
  const request = require('supertest');
  const cacheControl = require('../src/middleware/cacheControl');

  function app(opts) {
    const a = express();
    a.use(cacheControl(opts));
    a.get('/data', (req, res) => res.json({ ok: true }));
    a.get('/missing', (req, res) => res.status(404).json({ error: 'nope' }));
    a.get('/boom', () => { throw new Error('x'); });
    a.get('/admin/usage', (req, res) => res.json({ ok: true }));
    a.post('/data', (req, res) => res.json({ ok: true }));
    a.use((err, req, res, next) => res.status(500).json({ error: 'fail' })); // eslint-disable-line no-unused-vars
    return a;
  }

  test('successful anonymous GET is publicly cacheable', async () => {
    const res = await request(app({ maxAge: 300, staleWhileRevalidate: 3600 })).get('/data');
    expect(res.headers['cache-control']).toBe('public, max-age=300, stale-while-revalidate=3600');
  });

  test('GET with an API key is private', async () => {
    const res = await request(app({ maxAge: 300 })).get('/data').set('X-API-Key', 'k');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
  });

  test.each(['/missing', '/boom', '/admin/usage'])('%s is no-store', async (path) => {
    const res = await request(app({ maxAge: 300 })).get(path);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('non-GET is no-store', async () => {
    const res = await request(app({ maxAge: 300 })).post('/data');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('maxAge 0 disables caching', async () => {
    const res = await request(app({ maxAge: 0 })).get('/data');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('304 revalidation keeps the cache policy', async () => {
    const a = app({ maxAge: 300, staleWhileRevalidate: 60 });
    const first = await request(a).get('/data');
    const again = await request(a).get('/data').set('If-None-Match', first.headers.etag);
    expect(again.status).toBe(304);
    expect(again.headers['cache-control']).toBe('public, max-age=300, stale-while-revalidate=60');
  });

  test('is mounted on /api/v1 in the app (unknown endpoint 404 is no-store)', async () => {
    const App = require('../src/app');
    const res = await request(new App().app).get('/api/v1/providers/not-a-route/x/y');
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
