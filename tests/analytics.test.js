process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const app = new (require('../src/app'))().app;

afterEach(() => {
  mockDb._reset();
});

function seedMips(npi, year, finalScore, overrides = {}) {
  mockDb._stores.mips.set(`${npi}:${year}`, {
    npi,
    performance_year: year,
    final_score: finalScore,
    overall_category_score: null,
    quality_score: overrides.qualityScore ?? 80,
    improvement_activities_score: overrides.iaScore ?? 40,
    promoting_interoperability_score: overrides.piScore ?? 90,
    cost_score: overrides.costScore ?? 60,
    performance_status: 'MIPS',
    reporting_entity_type: 'Individual',
    group_size_category: null,
    year_source: overrides.yearSource ?? 'rolling',
    data_source: 'CMS_OPEN_DATA',
    sync_timestamp: new Date()
  });
}

function seedProvider(npi, taxonomyCode) {
  mockDb._stores.providers.set(String(npi), {
    npi: String(npi),
    primary_taxonomy_code: taxonomyCode,
    sync_timestamp: new Date()
  });
}

describe('GET /api/v1/analytics/group-performance', () => {
  test('aggregates final and category scores for a group', async () => {
    seedMips('1000000001', 2023, 80);
    seedMips('1000000002', 2023, 90);
    seedMips('1000000003', 2023, 100);

    const res = await request(app)
      .get('/api/v1/analytics/group-performance')
      .query({ npis: '1000000001,1000000002,1000000003', year: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { data } = res.body;
    expect(data.year).toBe(2023);
    expect(data.providerCount).toBe(3);
    expect(data.metrics.finalScore.avg).toBe(90);
    expect(data.metrics.finalScore.min).toBe(80);
    expect(data.metrics.finalScore.max).toBe(100);
    expect(data.metrics.finalScore.percentiles.p50).toBe(90);
    expect(data.metrics.quality.avg).toBe(80);
    expect(data.metrics.improvementActivities.avg).toBe(40);
    expect(data.metrics.promotingInteroperability.avg).toBe(90);
    expect(data.metrics.cost.avg).toBe(60);
  });

  test('deduplicates repeated NPIs in the list', async () => {
    seedMips('1000000001', 2023, 80);
    seedMips('1000000002', 2023, 90);

    const res = await request(app)
      .get('/api/v1/analytics/group-performance')
      .query({ npis: '1000000001,1000000002,1000000001', year: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.providerCount).toBe(2);
    expect(res.body.data.metrics.finalScore.avg).toBe(85);
  });

  test('returns null metrics when no seeded rows match', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/group-performance')
      .query({ npis: '9999999998,9999999999', year: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.providerCount).toBe(0);
    expect(res.body.data.metrics).toBeNull();
  });

  test('400 when npis or year is missing or malformed', async () => {
    const missingNpis = await request(app)
      .get('/api/v1/analytics/group-performance')
      .query({ year: '2023' });
    expect(missingNpis.status).toBe(400);

    const missingYear = await request(app)
      .get('/api/v1/analytics/group-performance')
      .query({ npis: '1000000001' });
    expect(missingYear.status).toBe(400);

    const badYear = await request(app)
      .get('/api/v1/analytics/group-performance')
      .query({ npis: '1000000001', year: 'abc' });
    expect(badYear.status).toBe(400);

    const outOfRangeYear = await request(app)
      .get('/api/v1/analytics/group-performance')
      .query({ npis: '1000000001', year: '1999' });
    expect(outOfRangeYear.status).toBe(400);

    const badNpi = await request(app)
      .get('/api/v1/analytics/group-performance')
      .query({ npis: '1000000001,123', year: '2023' });
    expect(badNpi.status).toBe(400);
    expect(badNpi.body.error).toMatch(/invalid npi/i);
  });
});

describe('GET /api/v1/analytics/ranking/:npi', () => {
  test('ranks against all peers for the year', async () => {
    seedMips('1000000001', 2023, 100);
    seedMips('1000000002', 2023, 90);
    seedMips('1000000003', 2023, 90);
    seedMips('1000000004', 2023, 80);

    const res = await request(app)
      .get('/api/v1/analytics/ranking/1000000001')
      .query({ year: '2023' });

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.rank).toBe(1);
    expect(data.totalCount).toBe(4);
    expect(data.percentile).toBe(100);
    expect(data.scope).toBe('overall');
    expect(data.finalScore).toBe(100);
  });

  test('tied peers share a rank', async () => {
    seedMips('1000000001', 2023, 100);
    seedMips('1000000002', 2023, 90);
    seedMips('1000000003', 2023, 90);
    seedMips('1000000004', 2023, 80);

    const res = await request(app)
      .get('/api/v1/analytics/ranking/1000000002')
      .query({ year: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.rank).toBe(2);
    expect(res.body.data.percentile).toBe(75);
  });

  test('restricts peers to the same taxonomy when taxonomy is given', async () => {
    seedMips('1000000001', 2023, 80);
    seedMips('1000000002', 2023, 100);
    seedMips('1000000003', 2023, 100);
    seedProvider('1000000001', '207R00000X');
    seedProvider('1000000002', '207R00000X');
    seedProvider('1000000003', '207Q00000X');

    const res = await request(app)
      .get('/api/v1/analytics/ranking/1000000001')
      .query({ year: '2023', taxonomy: '207r00000x' });

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.scope).toBe('taxonomy');
    expect(data.taxonomy).toBe('207R00000X');
    expect(data.totalCount).toBe(2);
    expect(data.rank).toBe(2);
    expect(data.percentile).toBe(50);
  });

  test('404 when the provider has no score for the year', async () => {
    seedMips('1000000001', 2023, 100);

    const res = await request(app)
      .get('/api/v1/analytics/ranking/1000000099')
      .query({ year: '2023' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no mips performance data/i);
  });

  test('400 for malformed npi or missing year', async () => {
    const badNpi = await request(app)
      .get('/api/v1/analytics/ranking/123')
      .query({ year: '2023' });
    expect(badNpi.status).toBe(400);

    const missingYear = await request(app)
      .get('/api/v1/analytics/ranking/1000000001');
    expect(missingYear.status).toBe(400);
  });
});

describe('GET /api/v1/analytics/trends/:npi', () => {
  test('returns per-year scores and improving trend analysis', async () => {
    seedMips('1000000001', 2021, 70);
    seedMips('1000000001', 2022, 80);
    seedMips('1000000001', 2023, 95);

    const res = await request(app)
      .get('/api/v1/analytics/trends/1000000001')
      .query({ startYear: '2021', endYear: '2023' });

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.years).toHaveLength(3);
    expect(data.years.map(y => y.year)).toEqual([2021, 2022, 2023]);
    expect(data.years[0].finalScore).toBe(70);
    expect(data.years[0].qualityScore).toBe(80);
    expect(data.analysis.direction).toBe('improving');
    expect(data.analysis.totalChange).toBe(25);
    expect(data.analysis.yearlyDeltas).toEqual([
      { fromYear: 2021, toYear: 2022, change: 10 },
      { fromYear: 2022, toYear: 2023, change: 15 }
    ]);
    expect(data.analysis.bestYear).toBe(2023);
    expect(data.analysis.worstYear).toBe(2021);
  });

  test('flags declining trends', async () => {
    seedMips('1000000001', 2022, 90);
    seedMips('1000000001', 2023, 70);

    const res = await request(app)
      .get('/api/v1/analytics/trends/1000000001')
      .query({ startYear: '2022', endYear: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.analysis.direction).toBe('declining');
    expect(res.body.data.analysis.totalChange).toBe(-20);
  });

  test('returns empty years and null analysis when no rows match', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/trends/1000000099')
      .query({ startYear: '2021', endYear: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.years).toEqual([]);
    expect(res.body.data.analysis).toBeNull();
  });

  test('400 when startYear is after endYear or malformed', async () => {
    const inverted = await request(app)
      .get('/api/v1/analytics/trends/1000000001')
      .query({ startYear: '2023', endYear: '2021' });
    expect(inverted.status).toBe(400);

    const badStart = await request(app)
      .get('/api/v1/analytics/trends/1000000001')
      .query({ startYear: 'abc' });
    expect(badStart.status).toBe(400);

    const badNpi = await request(app)
      .get('/api/v1/analytics/trends/123')
      .query({ startYear: '2021', endYear: '2023' });
    expect(badNpi.status).toBe(400);
  });
});

describe('Phase 2B analytics hardening', () => {
  test('null-scored provider gets rank null with reason, and null peers do not take rank 1', async () => {
    seedMips('1000000001', 2023, null);
    seedMips('1000000002', 2023, 90);
    seedMips('1000000003', 2023, 80);

    const unscored = await request(app)
      .get('/api/v1/analytics/ranking/1000000001')
      .query({ year: '2023' });
    expect(unscored.status).toBe(200);
    expect(unscored.body.data.rank).toBeNull();
    expect(unscored.body.data.percentile).toBeNull();
    expect(unscored.body.data.finalScore).toBeNull();
    expect(unscored.body.data.reason).toMatch(/no mips final score/i);

    const top = await request(app)
      .get('/api/v1/analytics/ranking/1000000002')
      .query({ year: '2023' });
    expect(top.body.data.rank).toBe(1);
    expect(top.body.data.totalCount).toBe(2);
    expect(top.body.data.percentile).toBe(100);
  });

  test('ranking percentile denominator excludes null-scored peers', async () => {
    seedMips('1000000001', 2023, 50);
    seedMips('1000000002', 2023, 100);
    seedMips('1000000003', 2023, null);
    seedMips('1000000004', 2023, null);

    const res = await request(app)
      .get('/api/v1/analytics/ranking/1000000001')
      .query({ year: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.rank).toBe(2);
    expect(res.body.data.totalCount).toBe(2);
    expect(res.body.data.percentile).toBe(50);
  });

  test('benchmark returns explicit unscored status for a null-scored provider', async () => {
    seedMips('1000000001', 2023, null);
    seedMips('1000000002', 2023, 90);
    seedMips('1000000003', 2023, 80);

    const res = await request(app)
      .get('/api/v1/analytics/benchmark/1000000001')
      .query({ year: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('unscored');
    expect(res.body.data.quartile).toBeUndefined();
    expect(res.body.data.peerCount).toBe(0);
  });

  test('benchmark peerCount excludes unscored peers', async () => {
    seedMips('1000000001', 2023, 40);
    seedMips('1000000002', 2023, 30);
    seedMips('1000000003', 2023, null);

    const res = await request(app)
      .get('/api/v1/analytics/benchmark/1000000001')
      .query({ year: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.peerCount).toBe(2);
  });

  test('group-performance reports scoredCount alongside providerCount', async () => {
    seedMips('1000000001', 2023, 80);
    seedMips('1000000002', 2023, null);
    seedMips('1000000003', 2023, 90);

    const res = await request(app)
      .get('/api/v1/analytics/group-performance')
      .query({ npis: '1000000001,1000000002,1000000003', year: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.providerCount).toBe(3);
    expect(res.body.data.scoredCount).toBe(2);
  });

  test('group-performance single-row group has null stddev, not NaN', async () => {
    seedMips('1000000001', 2023, 80);

    const res = await request(app)
      .get('/api/v1/analytics/group-performance')
      .query({ npis: '1000000001', year: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.metrics.finalScore.stddev).toBeNull();
    expect(res.body.data.metrics.finalScore.avg).toBe(80);
    expect(JSON.stringify(res.body)).not.toContain('NaN');
  });

  test('trends response carries the rolling-vintage warning', async () => {
    seedMips('1000000001', 2022, 80);
    seedMips('1000000001', 2023, 90);

    const res = await request(app)
      .get('/api/v1/analytics/trends/1000000001')
      .query({ startYear: '2022', endYear: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.warning).toMatch(/rolling cms vintage/i);
  });

  test('trends warning drops when every year is archive-sourced', async () => {
    seedMips('1000000001', 2022, 80, { yearSource: 'archive' });
    seedMips('1000000001', 2023, 90, { yearSource: 'archive' });

    const res = await request(app)
      .get('/api/v1/analytics/trends/1000000001')
      .query({ startYear: '2022', endYear: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.warning).toBeNull();
    expect(res.body.data.years.map(y => y.year)).toEqual([2022, 2023]);
  });

  test('trends warning stays when one archive year mixes with a rolling year', async () => {
    seedMips('1000000001', 2022, 80, { yearSource: 'archive' });
    seedMips('1000000001', 2023, 90);

    const res = await request(app)
      .get('/api/v1/analytics/trends/1000000001')
      .query({ startYear: '2022', endYear: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.warning).toMatch(/rolling cms vintage/i);
  });

  test('group-performance rejects an empty npis list with 400', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/group-performance')
      .query({ npis: '', year: '2023' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/analytics/benchmark/:npi', () => {
  test('compares provider score to the national distribution', async () => {
    seedMips('1000000001', 2023, 40);
    seedMips('1000000002', 2023, 30);
    seedMips('1000000003', 2023, 20);
    seedMips('1000000004', 2023, 10);

    const res = await request(app)
      .get('/api/v1/analytics/benchmark/1000000001')
      .query({ year: '2023' });

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.providerScore).toBe(40);
    expect(data.nationalAverage).toBe(25);
    expect(data.differenceFromNational).toBe(15);
    expect(data.quartiles).toEqual({ q1: 17.5, median: 25, q3: 32.5 });
    expect(data.quartile).toBe(4);
    expect(data.position).toBe('top_25');
    expect(data.peerCount).toBe(4);
    expect(data.min).toBe(10);
    expect(data.max).toBe(40);
  });

  test('places below-average providers in lower quartiles', async () => {
    seedMips('1000000001', 2023, 20);
    seedMips('1000000002', 2023, 30);
    seedMips('1000000003', 2023, 40);
    seedMips('1000000004', 2023, 10);

    const res = await request(app)
      .get('/api/v1/analytics/benchmark/1000000001')
      .query({ year: '2023' });

    expect(res.status).toBe(200);
    expect(res.body.data.quartile).toBe(2);
    expect(res.body.data.position).toBe('below_average');
    expect(res.body.data.differenceFromNational).toBe(-5);
  });

  test('404 when the provider has no score for the year', async () => {
    seedMips('1000000001', 2023, 40);

    const res = await request(app)
      .get('/api/v1/analytics/benchmark/1000000099')
      .query({ year: '2023' });

    expect(res.status).toBe(404);
  });

  test('400 for malformed npi or missing year', async () => {
    const badNpi = await request(app)
      .get('/api/v1/analytics/benchmark/123')
      .query({ year: '2023' });
    expect(badNpi.status).toBe(400);

    const missingYear = await request(app)
      .get('/api/v1/analytics/benchmark/1000000001');
    expect(missingYear.status).toBe(400);
  });
});
