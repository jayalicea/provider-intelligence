process.env.LOG_LEVEL = 'error';
const request = require('supertest');
const db = require('../src/config/database');
const { getRefreshStatus } = require('../src/services/refreshStatusService');
const { start, finish } = require('../tools/refresh-run');
const App = require('../src/app');

const NOW = new Date('2026-09-27T12:00:00Z');
const hoursAgo = h => new Date(NOW - h * 36e5);
const JOBS = {
  daily: { description: 'd', maxAgeHours: 48 },
  weekly: { description: 'w', maxAgeHours: 192 }
};

describe('getRefreshStatus', () => {
  let spy;
  afterEach(() => spy && spy.mockRestore());
  const rows = r => { spy = jest.spyOn(db, 'query').mockResolvedValue({ rows: r }); };

  test('healthy when every job succeeded within its max age', async () => {
    rows([
      { job: 'daily', last_success_at: hoursAgo(10), last_status: 'success' },
      { job: 'weekly', last_success_at: hoursAgo(100), last_status: 'success' }
    ]);
    const s = await getRefreshStatus({ jobs: JOBS, now: NOW });
    expect(s.healthy).toBe(true);
    expect(s.jobs.map(j => j.stale)).toEqual([false, false]);
  });

  test('stale when the last success is older than max age (missed runs)', async () => {
    rows([
      { job: 'daily', last_success_at: hoursAgo(49), last_status: 'success' },
      { job: 'weekly', last_success_at: hoursAgo(1), last_status: 'success' }
    ]);
    const s = await getRefreshStatus({ jobs: JOBS, now: NOW });
    expect(s.healthy).toBe(false);
    expect(s.jobs[0]).toMatchObject({ job: 'daily', stale: true, healthy: false });
  });

  test('unhealthy when the latest run failed, even if a recent success exists', async () => {
    rows([
      { job: 'daily', last_success_at: hoursAgo(5), last_status: 'failed' },
      { job: 'weekly', last_success_at: hoursAgo(1), last_status: 'success' }
    ]);
    const s = await getRefreshStatus({ jobs: JOBS, now: NOW });
    expect(s.jobs[0]).toMatchObject({ stale: false, lastStatus: 'failed', healthy: false });
  });

  test('a job with no recorded runs is reported as never and unhealthy', async () => {
    rows([{ job: 'weekly', last_success_at: hoursAgo(1), last_status: 'success' }]);
    const s = await getRefreshStatus({ jobs: JOBS, now: NOW });
    expect(s.jobs[0]).toMatchObject({ job: 'daily', lastStatus: 'never', lastSuccessAt: null, healthy: false });
  });
});

describe('GET /health/data', () => {
  let spy;
  afterEach(() => spy.mockRestore());

  test('503 and no-store when a job is unhealthy', async () => {
    spy = jest.spyOn(db, 'query').mockResolvedValue({ rows: [] });
    const res = await request(new App().app).get('/health/data');
    expect(res.status).toBe(503);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.healthy).toBe(false);
  });

  test('200 when all configured jobs are healthy', async () => {
    const jobs = Object.keys(require('../src/config/refresh-jobs'));
    spy = jest.spyOn(db, 'query').mockResolvedValue({
      rows: jobs.map(job => ({ job, last_success_at: new Date(), last_status: 'success' }))
    });
    const res = await request(new App().app).get('/health/data');
    expect(res.status).toBe(200);
    expect(res.body.healthy).toBe(true);
  });

  test('503 with a generic error when the database query fails', async () => {
    spy = jest.spyOn(db, 'query').mockRejectedValue(new Error('connection refused'));
    const res = await request(new App().app).get('/health/data');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ healthy: false, error: 'Refresh status unavailable' });
  });
});

describe('tools/refresh-run', () => {
  const fakeDb = () => ({ query: jest.fn().mockResolvedValue({ rows: [{ id: 42 }] }) });

  test('start inserts a run for a known job and returns its id', async () => {
    const d = fakeDb();
    expect(await start(d, 'leie')).toBe(42);
    expect(d.query.mock.calls[0][1]).toEqual(['leie']);
  });

  test('start rejects an unknown job', async () => {
    await expect(start(fakeDb(), 'nope')).rejects.toThrow('unknown job "nope"');
  });

  test.each([['0', 'success', 0], ['3', 'failed', 3]])('finish exit %s records %s', async (code, status, n) => {
    const d = fakeDb();
    await finish(d, '42', code, 'detail');
    expect(d.query.mock.calls[0][1]).toEqual(['42', status, n, 'detail']);
  });

  test('finish rejects a non-numeric id or exit code', async () => {
    await expect(finish(fakeDb(), 'x', '0')).rejects.toThrow('usage');
    await expect(finish(fakeDb(), '1', 'abc')).rejects.toThrow('usage');
  });
});
