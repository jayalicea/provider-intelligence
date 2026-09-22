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
