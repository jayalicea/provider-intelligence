process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';
process.env.API_KEYS = 'ci-test:ci-secret';

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

function seedNationalScreening(overrides = {}) {
  const npi = String(overrides.npi || '1366446619');
  mockDb._stores.nppesProviders.set(npi, {
    npi,
    entity_name: 'KANWALJIT SINGH AHUJA',
    entity_type: 'Individual',
    practice_state: 'CA',
    practice_city: 'TESTVILLE',
    primary_taxonomy_code: '207RC0005X',
    leie_verdict: 'CLEAR',
    leie_detail: null,
    state_verdict: 'CLEAR',
    state_detail: null,
    mips_available: false,
    final_score: null,
    computed_at: new Date('2026-09-13T00:00:00Z'),
    ...overrides
  });
}

function leieDetail(overrides = {}) {
  return {
    npi: '1366446619',
    excltype: '1128b4',
    excldate: '20250120',
    reindate: null,
    source: 'UPDATED.csv',
    as_of: '2026-09-12',
    ...overrides
  };
}

function stateDetail(overrides = {}) {
  return {
    state: 'CA',
    source_name: 'California Medicaid Exclusion List',
    source_url: 'https://example.test/ca-excl',
    entity_name: 'DOE, JANE',
    npi: '1366446619',
    exclusion_type: 'fraud',
    exclusion_date: '2025-06-01',
    reinstatement_date: null,
    as_of: '2026-09-10',
    ...overrides
  };
}

describe('GET /api/v1/intelligence/cohort?source=national', () => {
  test('400 for an unsupported source', async () => {
    const res = await request(app).get('/api/v1/intelligence/cohort?state=CA&source=bogus');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/source/i);
  });

  test('400 for missing or bad state in national mode', async () => {
    const missing = await request(app)
      .get('/api/v1/intelligence/cohort?source=national');
    expect(missing.status).toBe(400);

    const bad = await request(app)
      .get('/api/v1/intelligence/cohort?source=national&state=CALI');
    expect(bad.status).toBe(400);
  });

  test('400 for a bad minScore in national mode', async () => {
    const res = await request(app)
      .get('/api/v1/intelligence/cohort?source=national&state=CA&minScore=101');
    expect(res.status).toBe(400);
  });

  test('filters by state and taxonomy prefix; names individual vs org', async () => {
    seedNationalScreening({ npi: '1000000001' });
    seedNationalScreening({
      npi: '1000000002',
      primary_taxonomy_code: '390200000X'
    });
    seedNationalScreening({
      npi: '1000000003',
      entity_name: 'ACME HEALTH SYSTEM',
      entity_type: 'Organization',
      primary_taxonomy_code: '207RC0005X'
    });

    const res = await request(app)
      .get('/api/v1/intelligence/cohort?source=national&state=CA&taxonomy=207');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    const byNpi = Object.fromEntries(res.body.data.map(r => [r.npi, r]));
    expect(byNpi['1000000001'].name).toBe('KANWALJIT SINGH AHUJA');
    expect(byNpi['1000000001'].taxonomy).toBe('207RC0005X');
    expect(byNpi['1000000003'].name).toBe('ACME HEALTH SYSTEM');
    expect(byNpi['1000000002']).toBeUndefined();
  });

  test('name terms filter matches against the materialized entity_name', async () => {
    seedNationalScreening({ npi: '1000000001' });
    seedNationalScreening({ npi: '1000000002', entity_name: 'JANE DOE' });

    const res = await request(app)
      .get('/api/v1/intelligence/cohort?source=national&state=CA&name=doe');

    expect(res.status).toBe(200);
    expect(res.body.data.map(r => r.npi)).toEqual(['1000000002']);
  });

  test('LEIE exclusion attaches with registry payload and LEIE wins over state', async () => {
    seedNationalScreening({
      npi: '1760461826',
      leie_verdict: 'EXCLUDED',
      leie_detail: leieDetail({ npi: '1760461826' }),
      state_verdict: 'EXCLUDED',
      state_detail: stateDetail({ npi: '1760461826' })
    });

    const res = await request(app)
      .get('/api/v1/intelligence/cohort?source=national&state=CA');

    const row = res.body.data.find(r => r.npi === '1760461826');
    expect(row.verdict).toBe('EXCLUDED');
    expect(row.enrichable).toBe(false);
    expect(row.exclusion.verdict).toBe('EXCLUDED');
    expect(row.exclusion.exclusion).toEqual({
      registry: 'LEIE',
      type: '1128b4',
      date: '2025-01-20',
      source: 'UPDATED.csv',
      asOf: '2026-09-12'
    });
    expect(row.provenance.exclusionAsOf).toBe('2026-09-12');
  });

  test('state exclusion attaches when not in the LEIE', async () => {
    seedNationalScreening({
      npi: '1366446619',
      state_verdict: 'EXCLUDED',
      state_detail: stateDetail()
    });

    const res = await request(app)
      .get('/api/v1/intelligence/cohort?source=national&state=CA');

    const row = res.body.data.find(r => r.npi === '1366446619');
    expect(row.verdict).toBe('EXCLUDED');
    expect(row.enrichable).toBe(false);
    expect(row.exclusion.exclusion).toEqual({
      registry: 'STATE',
      type: 'fraud',
      date: '2025-06-01',
      state: 'CA',
      sourceName: 'California Medicaid Exclusion List',
      sourceUrl: 'https://example.test/ca-excl',
      source: 'California Medicaid Exclusion List',
      asOf: '2026-09-10'
    });
    expect(row.provenance.exclusionAsOf).toBe('2026-09-10');
  });

  test('no exclusion and no MIPS -> unscreened and enrichable; MIPS fills finalScore', async () => {
    seedNationalScreening({ npi: '1000000001' });
    seedNationalScreening({
      npi: '1000000002',
      mips_available: true,
      final_score: 91.25
    });

    const res = await request(app)
      .get('/api/v1/intelligence/cohort?source=national&state=CA');

    const plain = res.body.data.find(r => r.npi === '1000000001');
    expect(plain.verdict).toBe('unscreened');
    expect(plain.enrichable).toBe(true);
    expect(plain.finalScore).toBeNull();
    expect(plain.exclusion.verdict).toBe('CLEAR');
    expect(plain.provenance.identityAsOf).toBe('2026-09-13');
    expect(plain.provenance.mipsAsOf).toBeNull();

    const scored = res.body.data.find(r => r.npi === '1000000002');
    expect(scored.finalScore).toBe(91.25);
    expect(scored.verdict).toBe('unscreened');
    expect(scored.enrichable).toBe(true);
    expect(scored.provenance.mipsAsOf).toBe('2026-09-13');
  });

  test('reinstated LEIE row is CLEAR and not enrichable', async () => {
    seedNationalScreening({
      npi: '1234567890',
      leie_verdict: 'REINSTATED',
      leie_detail: leieDetail({ npi: '1234567890', reindate: '20260301' })
    });

    const res = await request(app)
      .get('/api/v1/intelligence/cohort?source=national&state=CA');

    const row = res.body.data.find(r => r.npi === '1234567890');
    expect(row.verdict).toBe('CLEAR');
    expect(row.enrichable).toBe(false);
    expect(row.exclusion.verdict).toBe('CLEAR');
    expect(row.exclusion.reinstated.date).toBe('2026-03-01');
  });

  test('minScore filters to MIPS-scored rows', async () => {
    seedNationalScreening({ npi: '1000000001' });
    seedNationalScreening({
      npi: '1000000002',
      mips_available: true,
      final_score: 91.25
    });

    const res = await request(app)
      .get('/api/v1/intelligence/cohort?source=national&state=CA&minScore=80');

    expect(res.body.data.map(r => r.npi)).toEqual(['1000000002']);
  });

  test('result is capped at 500 rows', async () => {
    for (let i = 0; i < 600; i++) {
      seedNationalScreening({ npi: String(2000000000 + i) });
    }

    const res = await request(app)
      .get('/api/v1/intelligence/cohort?source=national&state=CA');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(500);
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

// --- exclusion watchlist ---------------------------------------------------

// Row shape mirrors the live oig_exclusions table: text columns, YYYYMMDD
// dates, null reindate for an exclusion that has not been lifted.
function seedWatchlistRow(overrides = {}) {
  const daysAgo = overrides.daysAgo ?? 10;
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const row = {
    lastname: 'DOE',
    firstname: 'JANE',
    midname: '',
    busname: '',
    npi: '1760461826',
    general: '',
    specialty: '',
    city: 'FRESNO',
    state: 'CA',
    zip: '93720',
    excltype: '1128b4',
    excldate: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`,
    reindate: null,
    source: 'UPDATED.csv',
    as_of: '2026-09-12',
    display_name: 'DOE, JANE',
    ...overrides
  };
  delete row.daysAgo;
  mockDb._stores.exclusions.push(row);
  return row;
}

describe('GET /api/v1/intelligence/exclusion-watchlist', () => {
  test('returns active exclusions inside the default 90 day window', async () => {
    seedWatchlistRow({ daysAgo: 5, display_name: 'RECENT, ONE' });
    seedWatchlistRow({ daysAgo: 200, display_name: 'OLD, TWO' });

    const res = await request(app).get('/api/v1/intelligence/exclusion-watchlist');

    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(90);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].name).toBe('RECENT, ONE');
  });

  test('reinstated rows are excluded', async () => {
    seedWatchlistRow({ daysAgo: 5, display_name: 'ACTIVE, ONE' });
    seedWatchlistRow({ daysAgo: 5, display_name: 'LIFTED, TWO', reindate: '20260401' });

    const res = await request(app).get('/api/v1/intelligence/exclusion-watchlist');

    expect(res.body.count).toBe(1);
    expect(res.body.data[0].name).toBe('ACTIVE, ONE');
  });

  test('days widens the window and is honoured', async () => {
    seedWatchlistRow({ daysAgo: 200, display_name: 'OLD, TWO' });

    const res = await request(app)
      .get('/api/v1/intelligence/exclusion-watchlist')
      .query({ days: 365 });

    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(365);
    expect(res.body.count).toBe(1);
  });

  test('days above the 365 cap is rejected', async () => {
    const res = await request(app)
      .get('/api/v1/intelligence/exclusion-watchlist')
      .query({ days: 400 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/between 1 and 365/);
  });

  test('state filters and is case-insensitive', async () => {
    seedWatchlistRow({ daysAgo: 5, state: 'CA', display_name: 'CALI, ONE' });
    seedWatchlistRow({ daysAgo: 5, state: 'NY', display_name: 'YORK, TWO' });

    const res = await request(app)
      .get('/api/v1/intelligence/exclusion-watchlist')
      .query({ state: 'ny' });

    expect(res.body.count).toBe(1);
    expect(res.body.data[0].name).toBe('YORK, TWO');
    expect(res.body.state).toBe('NY');
  });

  test('a malformed state is rejected', async () => {
    const res = await request(app)
      .get('/api/v1/intelligence/exclusion-watchlist')
      .query({ state: 'California' });

    expect(res.status).toBe(400);
  });

  test('rows are newest first and carry source and as-of provenance', async () => {
    seedWatchlistRow({ daysAgo: 30, display_name: 'OLDER, ONE' });
    seedWatchlistRow({ daysAgo: 2, display_name: 'NEWER, TWO' });

    const res = await request(app).get('/api/v1/intelligence/exclusion-watchlist');

    expect(res.body.data.map(r => r.name)).toEqual(['NEWER, TWO', 'OLDER, ONE']);
    expect(res.body.data[0].source).toBe('UPDATED.csv');
    expect(res.body.data[0].asOf).toBe('2026-09-12');
    expect(res.body.data[0].exclusionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('organization rows are labelled and a placeholder NPI is dropped', async () => {
    seedWatchlistRow({
      daysAgo: 3,
      busname: 'ACME HOME HEALTH',
      lastname: '',
      firstname: '',
      npi: '0000000000',
      display_name: 'ACME HOME HEALTH'
    });

    const res = await request(app).get('/api/v1/intelligence/exclusion-watchlist');

    expect(res.body.data[0].entityType).toBe('ORGANIZATION');
    expect(res.body.data[0].npi).toBeNull();
  });

  test('an empty watchlist returns an empty list, not an error', async () => {
    const res = await request(app).get('/api/v1/intelligence/exclusion-watchlist');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.data).toEqual([]);
  });
});

// --- roster screening ------------------------------------------------------

describe('POST /api/v1/intelligence/screen-roster', () => {
  test('screens rows and returns per-verdict counts', async () => {
    seedWatchlistRow({ daysAgo: 5, npi: '1760461826', display_name: 'DOE, JANE' });

    const res = await request(app)
      .post('/api/v1/intelligence/screen-roster').set('X-API-Key', 'ci-secret')
      .send({ rows: [{ npi: '1760461826' }, { npi: '1366446619' }] });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.counts.EXCLUDED).toBe(1);
    expect(res.body.counts.CLEAR).toBe(1);
    expect(res.body.data[0].verdict).toBe('EXCLUDED');
    expect(res.body.data[0].exclusion.registry).toBe('LEIE');
  });

  test('an unusable row is UNVERIFIED, never CLEAR', async () => {
    const res = await request(app)
      .post('/api/v1/intelligence/screen-roster').set('X-API-Key', 'ci-secret')
      .send({ rows: [{ npi: 'not-an-npi' }] });

    expect(res.status).toBe(200);
    expect(res.body.data[0].verdict).toBe('UNVERIFIED');
    expect(res.body.counts.UNVERIFIED).toBe(1);
  });

  test('rows carry the input identity back for reconciliation', async () => {
    const res = await request(app)
      .post('/api/v1/intelligence/screen-roster').set('X-API-Key', 'ci-secret')
      .send({ rows: [{ lastname: 'Doe', firstname: 'Jane', state: 'CA' }] });

    expect(res.body.data[0].input).toEqual({
      npi: null, name: 'Doe, Jane', state: 'CA'
    });
  });

  test('an empty or missing rows array is rejected', async () => {
    const empty = await request(app)
      .post('/api/v1/intelligence/screen-roster').set('X-API-Key', 'ci-secret')
      .send({ rows: [] });
    expect(empty.status).toBe(400);

    const missing = await request(app)
      .post('/api/v1/intelligence/screen-roster').set('X-API-Key', 'ci-secret')
      .send({});
    expect(missing.status).toBe(400);
  });

  test('a non-object row is rejected rather than silently skipped', async () => {
    const res = await request(app)
      .post('/api/v1/intelligence/screen-roster').set('X-API-Key', 'ci-secret')
      .send({ rows: [{ npi: '1366446619' }, 'garbage'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/every row must be an object/);
  });

  test('a roster over the row cap is rejected with the limit named', async () => {
    const rows = Array.from({ length: 1001 }, () => ({ npi: '1366446619' }));

    const res = await request(app)
      .post('/api/v1/intelligence/screen-roster').set('X-API-Key', 'ci-secret')
      .send({ rows });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1000 row limit/);
  });
});
