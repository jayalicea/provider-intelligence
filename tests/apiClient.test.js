process.env.LOG_LEVEL = 'error';

const nock = require('nock');
const { ApiClient, ApiError } = require('../src/utils/apiClient');
const { isolateNet, resetNet } = require('./helpers/apiMocks');

const HOST = 'https://api.test';

beforeAll(() => isolateNet());
afterEach(() => resetNet());

function client() {
  return new ApiClient({ baseUrl: HOST, timeout: 5000 });
}

describe('ApiClient.get', () => {
  test('returns the response body', async () => {
    nock(HOST).get('/thing').query(true).reply(200, { ok: true });

    const data = await client().get('/thing', { a: 1 });

    expect(data).toEqual({ ok: true });
  });

  test('maps axios errors to ApiError with status and details', async () => {
    nock(HOST).get('/thing').query(true).reply(503, 'down');

    const err = await client().get('/thing').catch(e => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.message).toBe('API request failed: /thing');
    expect(err.details).toBeTruthy();
  });

  test('network failure maps to ApiError with status 500', async () => {
    nock(HOST).get('/thing').query(true).replyWithError(new Error('socket hang up'));

    const err = await client().get('/thing').catch(e => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });
});

describe('ApiClient.getWithPagination', () => {
  test('collects pages of a bare-array API until a short page', async () => {
    nock(HOST).get('/rows').query(q => q.offset === '0' && q.size === '2')
      .reply(200, [{ id: 1 }, { id: 2 }]);
    nock(HOST).get('/rows').query(q => q.offset === '2' && q.size === '2')
      .reply(200, [{ id: 3 }]);

    const rows = await client().getWithPagination('/rows', { size: 2 });

    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(nock.isDone()).toBe(true);
  });

  test('unwraps {data: [...]} envelopes', async () => {
    nock(HOST).get('/wrapped').query(true).reply(200, { data: [{ id: 'a' }] });

    const rows = await client().getWithPagination('/wrapped', { size: 5 });

    expect(rows).toEqual([{ id: 'a' }]);
  });

  test('stops on page error and returns what was collected', async () => {
    nock(HOST).get('/rows').query(q => q.offset === '0')
      .reply(200, Array(100).fill(0).map((_, i) => ({ id: i })));
    nock(HOST).get('/rows').query(q => q.offset === '100')
      .reply(500, 'boom');

    const rows = await client().getWithPagination('/rows', {});

    expect(rows).toHaveLength(100);
  });

  test('respects maxPages', async () => {
    for (let i = 0; i < 3; i++) {
      nock(HOST).get('/rows').query(q => q.offset === String(i * 100))
        .reply(200, Array(100).fill(0).map((_, j) => ({ id: i * 100 + j })));
    }

    const rows = await client().getWithPagination('/rows', {}, 2);

    expect(rows).toHaveLength(200);
  });
});
