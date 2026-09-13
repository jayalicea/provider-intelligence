process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const app = new (require('../src/app'))().app;

afterEach(() => {
  mockDb._reset();
});

function seedProvider(overrides = {}) {
  const npi = overrides.npi || '1366446619';
  mockDb._stores.providers.set(String(npi), {
    npi: String(npi),
    enumeration_type: 'Individual',
    name_first: 'KANWALJIT',
    name_middle: '',
    name_last: 'AHUJA',
    name_full: 'AHUJA, KANWALJIT, MD',
    name_credential: 'MD',
    provider_type: 'Internal Medicine',
    primary_taxonomy_code: '207R00000X',
    primary_taxonomy_description: 'Internal Medicine',
    taxonomy_grouping: '',
    practice_address_line1: '100 TEST WAY',
    practice_address_line2: '',
    practice_city: 'TESTVILLE',
    practice_state: 'CA',
    practice_zipcode: '90001',
    practice_phone: '5555555555',
    license_number: '',
    license_issuing_state: '',
    data_source: 'NPI_REGISTRY',
    sync_timestamp: new Date('2026-09-12T00:00:00Z'),
    is_active: true,
    ...overrides
  });
}

function seedMips(npi, year, finalScore) {
  mockDb._stores.mips.set(`${npi}:${year}`, {
    npi: String(npi),
    performance_year: year,
    final_score: finalScore,
    overall_category_score: null,
    quality_score: 80,
    improvement_activities_score: 40,
    promoting_interoperability_score: 90,
    cost_score: 70,
    performance_status: '',
    reporting_entity_type: 'individual',
    group_size_category: '',
    data_source: 'CMS_OPEN_DATA',
    sync_timestamp: new Date('2026-09-11T00:00:00Z')
  });
}

function seedExclusion(overrides = {}) {
  mockDb._stores.exclusions.push({
    lastname: 'ABAD-SANTOS',
    firstname: 'CRISELDA',
    midname: '',
    busname: '',
    npi: '1760461826',
    specialty: '',
    state: 'CA',
    excltype: '1128b4',
    excldate: '20250120',
    reindate: null,
    dob: null,
    source: 'UPDATED.csv',
    as_of: '2026-09-12',
    display_name: 'ABAD-SANTOS, CRISELDA',
    ...overrides
  });
}

describe('GET /api/v1/intelligence/cohort', () => {
  test('400 without a state', async () => {
    const res = await request(app).get('/api/v1/intelligence/cohort');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/state/i);
  });

  test('400 for a non-2-letter state', async () => {
    const res = await request(app).get('/api/v1/intelligence/cohort?state=CALI');
    expect(res.status).toBe(400);
  });

  test('400 for an out-of-range minScore', async () => {
    const res = await request(app).get('/api/v1/intelligence/cohort?state=CA&minScore=101');
    expect(res.status).toBe(400);
    const res2 = await request(app).get('/api/v1/intelligence/cohort?state=CA&minScore=abc');
    expect(res2.status).toBe(400);
  });

  test('returns empty cohort for an unseeded state', async () => {
    const res = await request(app).get('/api/v1/intelligence/cohort?state=WY');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  test('joins identity, latest MIPS, and exclusion verdict with provenance', async () => {
    seedProvider({ npi: '1366446619' });
    seedProvider({
      npi: '1760461826',
      name_first: 'CRISELDA',
      name_last: 'ABAD-SANTOS',
      name_full: 'ABAD-SANTOS, CRISELDA'
    });
    seedMips('1366446619', 2025, 87.5);
    seedExclusion();

    const res = await request(app).get('/api/v1/intelligence/cohort?state=CA');

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data).toHaveLength(2);

    const clear = data.find(r => r.npi === '1366446619');
    expect(clear.name).toBe('AHUJA, KANWALJIT, MD');
    expect(clear.taxonomy).toBe('Internal Medicine');
    expect(clear.city).toBe('TESTVILLE');
    expect(clear.finalScore).toBe(87.5);
    expect(clear.exclusion.verdict).toBe('CLEAR');
    expect(clear.provenance.identityAsOf).toBe('2026-09-12');
    expect(clear.provenance.mipsAsOf).toBe('2026-09-11');
    expect(clear.provenance.exclusionAsOf).toBe('2026-09-12');

    const excluded = data.find(r => r.npi === '1760461826');
    expect(excluded.exclusion.verdict).toBe('EXCLUDED');
    expect(excluded.exclusion.exclusion).toEqual({
      registry: 'LEIE',
      type: '1128b4',
      date: '2025-01-20',
      source: 'UPDATED.csv',
      asOf: '2026-09-12'
    });
    expect(excluded.finalScore).toBeNull();
    expect(excluded.provenance.mipsAsOf).toBeNull();
  });

  test('taxonomy substring filter narrows the cohort', async () => {
    seedProvider({ npi: '1366446619', primary_taxonomy_description: 'Internal Medicine' });
    seedProvider({
      npi: '1111111111',
      primary_taxonomy_description: 'Family Medicine'
    });

    const res = await request(app)
      .get('/api/v1/intelligence/cohort?state=CA&taxonomy=family');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].npi).toBe('1111111111');
  });

  test('minScore keeps only scored providers meeting the threshold', async () => {
    seedProvider({ npi: '1366446619' });
    seedProvider({ npi: '1111111111' });
    seedMips('1366446619', 2025, 90);
    seedMips('1111111111', 2025, 50);

    const res = await request(app)
      .get('/api/v1/intelligence/cohort?state=CA&minScore=75');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].npi).toBe('1366446619');
  });

  test('reinstated exclusion renders CLEAR with a reinstated note', async () => {
    seedProvider({ npi: '1234567890' });
    seedExclusion({ npi: '1234567890', reindate: '20260301' });

    const res = await request(app).get('/api/v1/intelligence/cohort?state=CA');

    const row = res.body.data.find(r => r.npi === '1234567890');
    expect(row.exclusion.verdict).toBe('CLEAR');
    expect(row.exclusion.reinstated).toEqual({
      date: '2026-03-01',
      source: 'UPDATED.csv',
      asOf: '2026-09-12'
    });
  });

  test('state filter is case-insensitive', async () => {
    seedProvider({ npi: '1366446619' });

    const res = await request(app).get('/api/v1/intelligence/cohort?state=ca');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/v1/providers/:npi/verification performance block', () => {
  test('includes cached MIPS scores with provenance when cached', async () => {
    seedProvider({ npi: '1366446619' });
    const year = new Date().getFullYear() - 1;
    seedMips('1366446619', year, 87.5);

    const res = await request(app).get('/api/v1/providers/1366446619/verification');

    expect(res.status).toBe(200);
    const { performance } = res.body.data;
    expect(performance).not.toBeNull();
    expect(performance.performanceYear.value).toBe(year);
    expect(performance.finalScore).toEqual({
      value: 87.5,
      source: 'CMS QPP Experience',
      asOf: '2026-09-11'
    });
    expect(performance.qualityScore.value).toBe(80);
    expect(performance.improvementActivitiesScore.value).toBe(40);
    expect(performance.promotingInteroperabilityScore.value).toBe(90);
    expect(performance.costScore.value).toBe(70);
  });

  test('performance is null when no MIPS data is cached', async () => {
    seedProvider({ npi: '1366446619' });

    const res = await request(app).get('/api/v1/providers/1366446619/verification');

    expect(res.status).toBe(200);
    expect(res.body.data.performance).toBeNull();
  });
});
