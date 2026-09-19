// Offline tests for the taxonomy percentile materialization job and the
// percentile-trends read endpoint.

process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const { computeAggregates } = require('../tools/build-taxonomy-percentiles');
const app = new (require('../src/app'))().app;

afterEach(() => {
  mockDb._reset();
});

function seedMips(npi, year, finalScore, yearSource = 'archive') {
  mockDb._stores.mips.set(`${npi}:${year}`, {
    npi,
    performance_year: year,
    final_score: finalScore,
    overall_category_score: null,
    quality_score: null,
    improvement_activities_score: null,
    promoting_interoperability_score: null,
    cost_score: null,
    performance_status: 'MIPS',
    reporting_entity_type: 'Individual',
    group_size_category: null,
    year_source: yearSource,
    data_source: 'CMS_OPEN_DATA',
    sync_timestamp: new Date()
  });
}

function seedNppes(npi, taxonomyCode) {
  mockDb._stores.nppesProviders.set(String(npi), {
    npi: String(npi),
    primary_taxonomy_code: taxonomyCode
  });
}

function seedProvider(npi, taxonomyCode) {
  mockDb._stores.providers.set(String(npi), {
    npi: String(npi),
    primary_taxonomy_code: taxonomyCode,
    sync_timestamp: new Date()
  });
}

function seedPercentile(taxonomyCode, year, overrides = {}) {
  mockDb._stores.taxonomyPercentiles.push({
    taxonomy_code: taxonomyCode,
    performance_year: year,
    scored_count: overrides.scoredCount ?? 100,
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

describe('materialization aggregation (computeAggregates)', () => {
  const resolve = map => npi => (map[npi] === undefined ? null : map[npi]);

  test('groups by taxonomy and year with PERCENTILE_CONT semantics', () => {
    // Scores 10, 20, 30, 40: p25 = 17.5, p50 = 25, p75 = 32.5 (linear interpolation)
    const rows = [10, 20, 30, 40].map((s, i) =>
      ({ npi: `100000000${i}`, performance_year: 2023, final_score: s }));
    const { groups, matched, unmatched } = computeAggregates(
      rows,
      resolve({ 1000000000: '207Q00000X', 1000000001: '207Q00000X', 1000000002: '207Q00000X', 1000000003: '207Q00000X' })
    );
    expect(matched).toBe(4);
    expect(unmatched).toBe(0);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.taxonomy_code).toBe('207Q00000X');
    expect(g.performance_year).toBe(2023);
    expect(g.scored_count).toBe(4);
    expect(g.min_final_score).toBe(10);
    expect(g.max_final_score).toBe(40);
    expect(g.p25_final_score).toBe(17.5);
    expect(g.median_final_score).toBe(25);
    expect(g.p75_final_score).toBe(32.5);
    expect(g.mean_final_score).toBe(25);
  });

  test('skips null scores and accounts for unmatched npis', () => {
    const rows = [
      { npi: '1000000001', performance_year: 2023, final_score: 50 },
      { npi: '1000000002', performance_year: 2023, final_score: null },
      { npi: '1000000099', performance_year: 2023, final_score: 70 }
    ];
    const { groups, matched, unmatched } = computeAggregates(rows, resolve({ 1000000001: '207Q00000X' }));
    expect(matched).toBe(1);
    expect(unmatched).toBe(1);
    expect(groups[0].scored_count).toBe(1);
    expect(groups[0].median_final_score).toBe(50);
  });

  test('provider-fallback taxonomy resolves when nppes lacks the npi', () => {
    const rows = [{ npi: '1000000005', performance_year: 2022, final_score: 88 }];
    // resolveTaxonomy here models providers fallback (nppes miss -> providers hit)
    const { groups, matched } = computeAggregates(rows, resolve({ 1000000005: '208000000X' }));
    expect(matched).toBe(1);
    expect(groups[0].taxonomy_code).toBe('208000000X');
  });
});

describe('GET /api/v1/analytics/percentile-trends/:npi', () => {
  test('returns per-year rows with percentile, cohort band, and provenance', async () => {
    seedNppes('1000000001', '207Q00000X');
    seedMips('1000000001', 2023, 85, 'archive');
    seedMips('1000000001', 2024, 92, 'archive');
    // Peers in the same taxonomy for 2023 (4 scored: 2 at or below 85)
    seedNppes('1000000002', '207Q00000X');
    seedNppes('1000000003', '207Q00000X');
    seedNppes('1000000004', '207Q00000X');
    seedMips('1000000002', 2023, 80, 'archive');
    seedMips('1000000003', 2023, 85, 'archive');
    seedMips('1000000004', 2023, 95, 'archive');

    seedPercentile('207Q00000X', 2023, { scoredCount: 4, median: 85, p25: 82.5, p75: 90 });
    seedPercentile('207Q00000X', 2024, { scoredCount: 1, median: 92, p25: 92, p75: 92 });

    const res = await request(app).get('/api/v1/analytics/percentile-trends/1000000001');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { data } = res.body;
    expect(data.npi).toBe('1000000001');
    expect(data.taxonomy).toBe('207Q00000X');
    expect(data.years).toHaveLength(2);

    const y2023 = data.years.find(y => y.performance_year === 2023);
    expect(y2023.final_score).toBe(85);
    // 3 of 4 cohort scores (80, 85, 85) are at or below 85 -> 75
    expect(y2023.percentile).toBe(75);
    expect(y2023.median_final_score).toBe(85);
    expect(y2023.p25).toBe(82.5);
    expect(y2023.p75).toBe(90);
    expect(y2023.scored_count).toBe(4);
    expect(y2023.year_source).toBe('archive');
    expect(y2023.provenance).toEqual({
      source: 'mips_performance_scores',
      as_of: '2026-09-19'
    });

    const y2024 = data.years.find(y => y.performance_year === 2024);
    expect(y2024.final_score).toBe(92);
    expect(y2024.percentile).toBe(100); // sole cohort member
  });

  test('rolling-vintage mips rows are excluded from final_score and percentile', async () => {
    seedNppes('1000000001', '207Q00000X');
    seedMips('1000000001', 2023, 85, 'rolling'); // not an archive year row
    seedPercentile('207Q00000X', 2023, { scoredCount: 4 });

    const res = await request(app).get('/api/v1/analytics/percentile-trends/1000000001');
    expect(res.status).toBe(200);
    expect(res.body.data.years).toHaveLength(1);
    expect(res.body.data.years[0].final_score).toBeNull();
    expect(res.body.data.years[0].percentile).toBeNull();
    expect(res.body.data.years[0].year_source).toBe('archive');
  });

  test('providers-cache fallback supplies taxonomy when nppes has no row', async () => {
    seedProvider('1000000007', '208000000X');
    seedMips('1000000007', 2023, 70, 'archive');
    seedPercentile('208000000X', 2023, { scoredCount: 2, median: 65 });

    const res = await request(app).get('/api/v1/analytics/percentile-trends/1000000007');
    expect(res.status).toBe(200);
    expect(res.body.data.taxonomy).toBe('208000000X');
    expect(res.body.data.years[0].final_score).toBe(70);
  });

  test('npi with no taxonomy in either table returns 404', async () => {
    seedMips('1000000099', 2023, 70, 'archive');
    const res = await request(app).get('/api/v1/analytics/percentile-trends/1000000099');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/No primary taxonomy/);
  });

  test('rejects malformed npi', async () => {
    const res = await request(app).get('/api/v1/analytics/percentile-trends/abc');
    expect(res.status).toBe(400);
  });
});
