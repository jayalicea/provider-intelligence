// Offline tests for the per-taxonomy benchmark report endpoint
// (Story 4.1): GET /api/v1/analytics/taxonomy-benchmark.

process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const { computeDeciles } = require('../src/services/analyticsService');
const app = new (require('../src/app'))().app;

afterEach(() => {
  mockDb._reset();
});

function seedMips(npi, year, finalScore, yearSource = 'archive') {
  mockDb._stores.mips.set(`${npi}:${year}`, {
    npi,
    performance_year: year,
    final_score: finalScore,
    year_source: yearSource,
    sync_timestamp: new Date()
  });
}

function seedNppes(npi, taxonomyCode, practiceState = null) {
  mockDb._stores.nppesProviders.set(String(npi), {
    npi: String(npi),
    primary_taxonomy_code: taxonomyCode,
    practice_state: practiceState
  });
}

function seedProvider(npi, taxonomyCode, practiceState = null) {
  mockDb._stores.providers.set(String(npi), {
    npi: String(npi),
    primary_taxonomy_code: taxonomyCode,
    practice_state: practiceState,
    sync_timestamp: new Date()
  });
}

function seedPercentile(taxonomyCode, year, overrides = {}) {
  mockDb._stores.taxonomyPercentiles.push({
    taxonomy_code: taxonomyCode,
    performance_year: year,
    scored_count: overrides.scoredCount ?? 10,
    min_final_score: overrides.min ?? 10,
    max_final_score: overrides.max ?? 99,
    median_final_score: overrides.median ?? 80,
    p25_final_score: overrides.p25 ?? 70,
    p75_final_score: overrides.p75 ?? 90,
    mean_final_score: overrides.mean ?? 78.5,
    source: 'mips_performance_scores',
    as_of: overrides.asOf ?? '2026-09-19'
  });
}

describe('computeDeciles (reference PERCENTILE_CONT implementation)', () => {
  test('interpolates deciles over sorted scores', () => {
    // Scores 10..100 step 10: d10 = 19, d50 = 55, d90 = 91 (linear interpolation)
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const deciles = computeDeciles(sorted);
    expect(deciles.d10).toBe(19);
    expect(deciles.d50).toBe(55);
    expect(deciles.d90).toBe(91);
  });

  test('returns null deciles for an empty cohort', () => {
    const deciles = computeDeciles([]);
    expect(Object.values(deciles).every(v => v === null)).toBe(true);
  });
});

describe('GET /api/v1/analytics/taxonomy-benchmark', () => {
  test('returns distribution, deciles, state breakdown, and provenance', async () => {
    // Cohort of 10 scored peers, scores 10..100, taxonomy via nppes.
    for (let i = 1; i <= 10; i++) {
      seedNppes(`10000000${String(i).padStart(2, '0')}`, '207Q00000X', i <= 5 ? 'CA' : 'TX');
      seedMips(`10000000${String(i).padStart(2, '0')}`, 2023, i * 10);
    }
    // A rolling-vintage row and an unscored row must not enter the cohort.
    seedMips('1000000099', 2023, 5, 'rolling');
    seedMips('1000000098', 2023, null);
    seedNppes('1000000099', '207Q00000X');
    seedNppes('1000000098', '207Q00000X');
    // A same-year row in a different taxonomy must not enter the cohort.
    seedNppes('1000000097', '207R00000X');
    seedMips('1000000097', 2023, 3);

    seedPercentile('207Q00000X', 2023, {
      scoredCount: 10, min: 10, max: 100, median: 55, p25: 32.5, p75: 77.5, mean: 55
    });

    const res = await request(app).get('/api/v1/analytics/taxonomy-benchmark?taxonomy=207q00000x&year=2023');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { data } = res.body;
    expect(data.taxonomy).toBe('207Q00000X'); // uppercased
    expect(data.performance_year).toBe(2023);
    expect(data.scoredCount).toBe(10);
    expect(data.mean).toBe(55);
    expect(data.min).toBe(10);
    expect(data.max).toBe(100);
    expect(data.quartiles).toEqual({ p25: 32.5, p50: 55, p75: 77.5 });
    expect(data.deciles.d10).toBe(19);
    expect(data.deciles.d50).toBe(55);
    expect(data.deciles.d90).toBe(91);
    // 9 deciles present
    expect(Object.keys(data.deciles).sort()).toEqual(
      ['d10', 'd20', 'd30', 'd40', 'd50', 'd60', 'd70', 'd80', 'd90']
    );

    expect(data.states).toHaveLength(2);
    expect(data.states[0]).toEqual({ state: 'CA', scoredCount: 5, median: 30 });
    expect(data.states[1]).toEqual({ state: 'TX', scoredCount: 5, median: 80 });

    expect(data.provenance).toEqual({
      source: 'mips_performance_scores',
      as_of: '2026-09-19'
    });
  });

  test('providers cache supplies taxonomy when nppes has no row', async () => {
    seedProvider('1000000001', '208000000X', 'NY');
    seedMips('1000000001', 2022, 42);
    seedPercentile('208000000X', 2022, { scoredCount: 1, min: 42, max: 42, median: 42, p25: 42, p75: 42, mean: 42 });

    const res = await request(app).get('/api/v1/analytics/taxonomy-benchmark?taxonomy=208000000X&year=2022');
    expect(res.status).toBe(200);
    expect(res.body.data.scoredCount).toBe(1);
    expect(res.body.data.deciles.d50).toBe(42);
    expect(res.body.data.states).toEqual([{ state: 'NY', scoredCount: 1, median: 42 }]);
  });

  test('404 when the taxonomy-year is not materialized', async () => {
    const res = await request(app).get('/api/v1/analytics/taxonomy-benchmark?taxonomy=207Q00000X&year=2023');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/is materialized/);
  });

  test('400 when taxonomy is missing or malformed', async () => {
    const missing = await request(app).get('/api/v1/analytics/taxonomy-benchmark?year=2023');
    expect(missing.status).toBe(400);

    const malformed = await request(app).get('/api/v1/analytics/taxonomy-benchmark?taxonomy=!!&year=2023');
    expect(malformed.status).toBe(400);
  });

  test('400 when year is missing, not an archive year, or out of range', async () => {
    const missing = await request(app).get('/api/v1/analytics/taxonomy-benchmark?taxonomy=207Q00000X');
    expect(missing.status).toBe(400);

    // 2021 has no archived QPP vintage on this platform
    const notArchive = await request(app).get('/api/v1/analytics/taxonomy-benchmark?taxonomy=207Q00000X&year=2021');
    expect(notArchive.status).toBe(400);
    expect(notArchive.body.error).toMatch(/archive/);

    const outOfRange = await request(app).get('/api/v1/analytics/taxonomy-benchmark?taxonomy=207Q00000X&year=2030');
    expect(outOfRange.status).toBe(400);
  });

  test('400 when the stored cohort exceeds the live-decile guard', async () => {
    seedPercentile('207Q00000X', 2023, { scoredCount: 300000 });
    const res = await request(app).get('/api/v1/analytics/taxonomy-benchmark?taxonomy=207Q00000X&year=2023');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/);
  });
});
