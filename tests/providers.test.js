process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');
const nock = require('nock');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const {
  isolateNet, resetNet,
  npiEnvelope, PROVIDER_ROW, LICENSES_PARSED,
  mockNpiSearch
} = require('./helpers/apiMocks');

const app = new (require('../src/app'))().app;

beforeAll(() => {
  isolateNet();
});

afterEach(() => {
  resetNet();
  mockDb._reset();
});

describe('GET /api/v1/providers/search', () => {
  test('returns transformed providers for a name search', async () => {
    mockNpiSearch('Smith', npiEnvelope([PROVIDER_ROW]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.total).toBe(1);
    expect(res.body.offset).toBe(0);
    expect(res.body.limit).toBe(50);
    expect(res.body.data[0]).toMatchObject({
      npi: '1234567890',
      enumerationType: 'Individual',
      name: { first: 'JOHN', last: 'DOE', credential: 'MD' },
      address: { city: 'BALTIMORE', state: 'MD', zipcode: '21201' },
      taxonomy: { code: '207R00000X', description: 'Physician/Internal Medicine' },
      license: { number: 'MD12345', state: 'MD' }
    });
    expect(nock.isDone()).toBe(true);
  });

  test('accepts state/city criteria without terms', async () => {
    mockNpiSearch(undefined, npiEnvelope([PROVIDER_ROW]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ state: 'MD', city: 'Baltimore' });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(nock.isDone()).toBe(true);
  });

  test('400 when no search criterion is given', async () => {
    const res = await request(app).get('/api/v1/providers/search');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one search criterion/i);
  });

  test('400 for invalid maxResults (non-numeric, zero, over 500)', async () => {
    for (const maxResults of ['abc', '0', '501', '10.5']) {
      const res = await request(app)
        .get('/api/v1/providers/search')
        .query({ terms: 'Smith', maxResults });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/maxresults/i);
    }
  });

  test('400 for invalid offset (non-numeric, negative)', async () => {
    for (const offset of ['abc', '-1']) {
      const res = await request(app)
        .get('/api/v1/providers/search')
        .query({ terms: 'Smith', offset });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/offset/i);
    }
  });

  test('400 when offset + maxResults exceeds the upstream 7500 cap', async () => {
    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith', maxResults: 500, offset: 7100 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/7500/i);
  });

  test('echoes requested offset and limit with the upstream total', async () => {
    mockNpiSearch('Smith', npiEnvelope([PROVIDER_ROW]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith', maxResults: 10, offset: 20 });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.offset).toBe(20);
    expect(res.body.limit).toBe(10);
    expect(res.body.count).toBe(1);
    expect(nock.isDone()).toBe(true);
  });

  test('results include hasMipsData; a scored NPI reports true', async () => {
    mockDb._stores.mips.set('1234567890:2025', {
      npi: '1234567890',
      performance_year: 2025,
      final_score: 87.5
    });
    const unscoredRow = { ...PROVIDER_ROW, npi: '9876543210' };
    mockNpiSearch('Smith', npiEnvelope([PROVIDER_ROW, unscoredRow]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith' });

    expect(res.status).toBe(200);
    const byNpi = Object.fromEntries(res.body.data.map(p => [p.npi, p]));
    expect(byNpi['1234567890'].hasMipsData).toBe(true);
    expect(byNpi['9876543210'].hasMipsData).toBe(false);
  });

  test('results include cannabisCertified; a certified NPI reports true', async () => {
    // 1234567890 matches via its cached provider_licenses baseline
    // (MD12345/MD); 5555555555 matches via the providers row (ME126815/FL);
    // 9876543210 has no cached license and matches nothing.
    mockDb._stores.providerLicenses.push({
      npi: '1234567890',
      license_number: 'MD12345',
      issuing_state: 'MD'
    });
    mockDb._stores.providers.set('5555555555', {
      npi: '5555555555',
      license_number: 'ME126815',
      license_issuing_state: 'FL'
    });
    mockDb._stores.cannabis.set('MD:MD12345', { state: 'MD', license_number: 'MD12345' });
    mockDb._stores.cannabis.set('FL:ME126815', { state: 'FL', license_number: 'ME126815' });
    const certifiedViaProvidersRow = { ...PROVIDER_ROW, npi: '5555555555' };
    const uncertifiedRow = { ...PROVIDER_ROW, npi: '9876543210' };
    mockNpiSearch('Smith', npiEnvelope([PROVIDER_ROW, certifiedViaProvidersRow, uncertifiedRow]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith' });

    expect(res.status).toBe(200);
    const byNpi = Object.fromEntries(res.body.data.map(p => [p.npi, p]));
    expect(byNpi['1234567890'].cannabisCertified).toBe(true);
    expect(byNpi['5555555555'].cannabisCertified).toBe(true);
    expect(byNpi['9876543210'].cannabisCertified).toBe(false);
  });

  test('results include cannabisCertified true for an NPI enriched directly on cannabis_certifications', async () => {
    // No cached license for this NPI; it flags purely because the row was
    // NPI-enriched (third UNION arm).
    mockDb._stores.cannabis.set('FL:ME900000', {
      state: 'FL',
      license_number: 'ME900000',
      npi: '9876543210'
    });
    const enrichedRow = { ...PROVIDER_ROW, npi: '9876543210' };
    mockNpiSearch('Smith', npiEnvelope([enrichedRow]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith' });

    expect(res.status).toBe(200);
    expect(res.body.data[0].cannabisCertified).toBe(true);
  });

  test('format=csv returns text/csv with attachment header and header row', async () => {
    mockNpiSearch('Smith', npiEnvelope([PROVIDER_ROW]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith', format: 'csv' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="provider-search.csv"'
    );
    const lines = res.text.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'npi,name,credential,taxonomy_code,taxonomy_description,city,state,zip,phone'
    );
    expect(lines[1]).toBe(
      '1234567890,"DOE, JOHN A, MD",MD,207R00000X,Physician/Internal Medicine,BALTIMORE,MD,21201,(410) 555-1212'
    );
    expect(nock.isDone()).toBe(true);
  });

  test('format=csv escapes a malicious comma/quote field', async () => {
    const evil = {
      ...PROVIDER_ROW,
      npi: '2222222222',
      'name.full': 'EVIL, MAL "DOCTOR"',
      'addr_practice.city': 'SPRINGFIELD, "MIDWEST"'
    };
    mockNpiSearch('Smith', npiEnvelope([evil]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith', format: 'csv' });

    expect(res.status).toBe(200);
    const lines = res.text.trimEnd().split('\r\n');
    expect(lines[1]).toBe(
      '2222222222,"EVIL, MAL ""DOCTOR""",MD,207R00000X,Physician/Internal Medicine,"SPRINGFIELD, ""MIDWEST""",MD,21201,(410) 555-1212'
    );
  });

  test('format=csv emits the header row even when there are no results', async () => {
    mockNpiSearch('Smith', npiEnvelope([]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith', format: 'csv' });

    expect(res.status).toBe(200);
    expect(res.text).toBe(
      'npi,name,credential,taxonomy_code,taxonomy_description,city,state,zip,phone\r\n'
    );
    expect(nock.isDone()).toBe(true);
  });

  test('JSON format is unaffected when format is absent', async () => {
    mockNpiSearch('Smith', npiEnvelope([PROVIDER_ROW]));

    const res = await request(app)
      .get('/api/v1/providers/search')
      .query({ terms: 'Smith' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].npi).toBe('1234567890');
  });
});

describe('GET /api/v1/providers/:npi', () => {
  test('fetches provider from NPI API, transforms, and caches to DB', async () => {
    const scope = mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));

    const res = await request(app).get('/api/v1/providers/1234567890');

    expect(res.status).toBe(200);
    expect(res.body.data.npi).toBe('1234567890');
    expect(res.body.data.mipsPerformance).toBeNull();

    // cached row exists with non-enumerable sync_timestamp intact
    const cached = mockDb._stores.providers.get('1234567890');
    expect(cached).toBeDefined();
    expect(cached.name_last).toBe('DOE');
    expect(scope.isDone()).toBe(true);
  });

  test('detail includes cannabisCertification when the NPI is on a cannabis row', async () => {
    mockDb._stores.cannabis.set('FL:ME900000', {
      state: 'FL',
      license_number: 'ME900000',
      npi: '1234567890',
      program_name: 'Florida Medical Marijuana Program',
      as_of: '2026-09-11',
      source_name: 'FL OMMU Qualified Physician List',
      source_url: 'https://knowthefactsmmj.com/physicians/list/',
      certification_status: 'qualified'
    });
    mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));

    const res = await request(app).get('/api/v1/providers/1234567890');

    expect(res.status).toBe(200);
    expect(res.body.data.cannabisCertification).toMatchObject({
      certified: true,
      programName: 'Florida Medical Marijuana Program',
      state: 'FL',
      asOf: '2026-09-11',
      certificationStatus: 'qualified'
    });
  });

  test('detail reports cannabisCertification null when not certified', async () => {
    mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));

    const res = await request(app).get('/api/v1/providers/1234567890');

    expect(res.status).toBe(200);
    expect(res.body.data.cannabisCertification).toBeNull();
  });

  test('concurrent identical detail requests produce exactly one upstream call', async () => {
    let upstreamCalls = 0;
    const scope = require('nock')('https://clinicaltables.nlm.nih.gov')
      .get('/api/npi_idv/v3/search')
      .query(q => q.terms === '1234567890')
      .reply(200, () => {
        upstreamCalls += 1;
        return npiEnvelope([PROVIDER_ROW]);
      });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).get('/api/v1/providers/1234567890'))
    );

    expect(responses.every(r => r.status === 200)).toBe(true);
    expect(upstreamCalls).toBe(1);
    expect(scope.isDone()).toBe(true);
    // every caller gets an equal response
    const bodies = responses.map(r => r.body);
    for (const body of bodies) {
      expect(body).toEqual(bodies[0]);
    }
    expect(bodies[0].data.npi).toBe('1234567890');
  });

  test('second request is served from cache without hitting the NPI API', async () => {
    mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));

    const first = await request(app).get('/api/v1/providers/1234567890');
    // no nock interceptor defined for the second call — disableNetConnect
    // fails the test if it reaches for the network
    const second = await request(app).get('/api/v1/providers/1234567890');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  test('cache-hit response matches fresh-API response shape exactly', async () => {
    mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));

    const first = await request(app).get('/api/v1/providers/1234567890');
    const second = await request(app).get('/api/v1/providers/1234567890');

    // sync_timestamp must not leak into the JSON body
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
    expect(second.body.data.sync_timestamp).toBeUndefined();
  });

  test('includeMips=true attaches MIPS performance data', async () => {
    mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));
    require('./helpers/apiMocks').mockMipsData('1234567890', [{
      npi: '1234567890',
      'final score': '87.5',
      'quality category score': '80',
      'improvement activities (ia) category score': '40',
      'promoting interoperability (pi) category score': '95',
      'cost category score': '60',
      'participation option': 'Individual',
      'reporting option': 'Traditional MIPS'
    }]);

    const res = await request(app)
      .get('/api/v1/providers/1234567890')
      .query({ includeMips: 'true' });

    expect(res.status).toBe(200);
    expect(res.body.data.mipsPerformance.finalScore).toBe(87.5);
  });

  test('400 for malformed NPI', async () => {
    const res = await request(app).get('/api/v1/providers/123');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid npi/i);
  });

  test('parses the JSON-stringified licenses array from ef=licenses', async () => {
    mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));

    const res = await request(app).get('/api/v1/providers/1234567890');

    expect(res.status).toBe(200);
    expect(res.body.data.licenses).toEqual(LICENSES_PARSED);
  });

  test('malformed or missing licenses values transform to an empty array', async () => {
    for (const licenses of ['not json', '', null]) {
      resetNet();
      mockNpiSearch('1234567890', npiEnvelope([{ ...PROVIDER_ROW, licenses }]));

      const res = await request(app).get('/api/v1/providers/1234567890');

      expect(res.status).toBe(200);
      expect(res.body.data.licenses).toEqual([]);
    }
  });

  test('cache write stores the license baseline in provider_licenses', async () => {
    mockNpiSearch('1234567890', npiEnvelope([PROVIDER_ROW]));

    await request(app).get('/api/v1/providers/1234567890');

    const rows = mockDb._stores.providerLicenses
      .filter(r => r.npi === '1234567890');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      license_number: 'MD12345',
      issuing_state: 'MD',
      is_primary_taxonomy: true,
      taxonomy_code: '207R00000X',
      source: 'NPI Registry'
    });
    expect(rows.every(r => r.as_of instanceof Date)).toBe(true);
  });
});


describe('GET /api/v1/cannabis/summary', () => {
  test('reports listed and matched counts per state', async () => {
    // FL: two listed rows — one NPI-enriched directly, one matched through a
    // cached provider_licenses row. WV: one listed row, no matches.
    mockDb._stores.cannabis.set('FL:ME100001', {
      state: 'FL',
      license_number: 'ME100001',
      npi: '1111111111',
      program_name: 'Florida Medical Marijuana Program',
      as_of: '2026-09-11',
      source_name: 'FL OMMU Qualified Physician List',
      source_url: 'https://knowthefactsmmj.com/physicians/list/',
      certification_status: 'qualified'
    });
    mockDb._stores.cannabis.set('FL:ME100002', {
      state: 'FL',
      license_number: 'ME100002',
      program_name: 'Florida Medical Marijuana Program',
      as_of: '2026-09-11',
      source_name: 'FL OMMU Qualified Physician List',
      source_url: 'https://knowthefactsmmj.com/physicians/list/',
      certification_status: 'qualified'
    });
    mockDb._stores.providerLicenses.push({
      npi: '2222222222',
      license_number: 'ME100002',
      issuing_state: 'FL'
    });
    mockDb._stores.cannabis.set('WV:PHY000001', {
      state: 'WV',
      license_number: 'PHY000001',
      program_name: 'West Virginia Medical Cannabis Program',
      as_of: '2026-09-20',
      source_name: 'WV OMC Physicians List',
      source_url: 'https://omc.wv.gov/patients/schedule-an-appointment/Documents/PHYSICIANS%20LIST%20-%20UPDATED.pdf',
      certification_status: 'registered'
    });

    const res = await request(app).get('/api/v1/cannabis/summary');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    const byState = Object.fromEntries(res.body.data.map(r => [r.state, r]));
    expect(byState.FL).toMatchObject({
      state: 'FL',
      programName: 'Florida Medical Marijuana Program',
      sourceName: 'FL OMMU Qualified Physician List',
      sourceUrl: 'https://knowthefactsmmj.com/physicians/list/',
      asOf: '2026-09-11',
      listedCount: 2,
      matchedCount: 2
    });
    expect(byState.WV).toMatchObject({
      state: 'WV',
      programName: 'West Virginia Medical Cannabis Program',
      listedCount: 1,
      matchedCount: 0
    });
  });

  test('returns an empty list when no certifications are loaded', async () => {
    const res = await request(app).get('/api/v1/cannabis/summary');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.count).toBe(0);
  });
});
