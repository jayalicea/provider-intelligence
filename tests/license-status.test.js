process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');
const nock = require('nock');

const { isolateNet, resetNet } = require('./helpers/apiMocks');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const app = new (require('../src/app'))().app;
const {
  normalizeTxRow, normalizeCoRow, fetchSocrataRows, SOURCES, PAGE_SIZE
} = require('../tools/license-status-ingest');

isolateNet();

afterEach(() => {
  mockDb._reset();
  resetNet();
});

const AS_OF = '2026-09-18';

// --- normalization (unit level) ----------------------------------------------

describe('normalizeTxRow', () => {
  test('maps Texas Medical Board columns to the common shape', () => {
    const row = normalizeTxRow({
      license_type: 'Physician License',
      first_name: 'JOHN',
      last_name: 'DOE',
      license_number: '12345',
      license_issue_date: '2010-01-01T00:00:00.000',
      license_expiration_date: '2028-02-29T00:00:00.000',
      registration_status: 'Active',
      registration_status_date: '2026-01-15T00:00:00.000',
      disciplinary_status: 'NONE',
      currently_licensed: 'Y'
    }, AS_OF);

    expect(row).toEqual({
      license_number: '12345',
      issuing_state: 'TX',
      license_type: 'Physician License',
      status: 'Active',
      status_date: '2026-01-15',
      expiration_date: '2028-02-29',
      disciplinary_status: 'NONE',
      raw_name: 'JOHN DOE',
      source: 'Texas Medical Board (data.texas.gov tm3v-pfq9)',
      as_of: AS_OF
    });
  });

  test('drops rows without a license number and tolerates missing fields', () => {
    expect(normalizeTxRow({ license_type: 'X' }, AS_OF)).toBeNull();
    const row = normalizeTxRow({ license_number: '77' }, AS_OF);
    expect(row.license_number).toBe('77');
    expect(row.status).toBeNull();
    expect(row.raw_name).toBeNull();
  });
});

describe('normalizeCoRow', () => {
  test('maps Colorado DORA columns to the common shape', () => {
    const row = normalizeCoRow({
      lastname: 'Lucido',
      firstname: 'Hilliary',
      licensetype: 'COS',
      licensenumber: '711991',
      licensefirstissuedate: '2018-09-21T00:00:00.000',
      licenselastreneweddate: '2026-05-01T00:00:00.000',
      licenseexpirationdate: '2028-04-30T00:00:00.000',
      licensestatusdescription: 'Active'
    }, AS_OF);

    expect(row).toEqual({
      license_number: '711991',
      issuing_state: 'CO',
      license_type: 'COS',
      status: 'Active',
      status_date: '2026-05-01',
      expiration_date: '2028-04-30',
      disciplinary_status: null,
      raw_name: 'Hilliary Lucido',
      source: 'Colorado DORA (data.colorado.gov 7s5z-vewr)',
      as_of: AS_OF
    });
  });

  test('drops rows without a license number', () => {
    expect(normalizeCoRow({ licensetype: 'COS' }, AS_OF)).toBeNull();
  });
});

// --- pagination fetcher (nocked Socrata) -------------------------------------

describe('fetchSocrataRows', () => {
  test('walks pages past 1000 rows and concatenates in order', async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      license_number: `A${i}`
    }));
    const page2 = [{ license_number: 'B0' }];
    const scope = nock('https://data.texas.gov')
      .get('/resource/tm3v-pfq9.json')
      .query({ $limit: String(PAGE_SIZE), $offset: '0' })
      .reply(200, page1)
      .get('/resource/tm3v-pfq9.json')
      .query({ $limit: String(PAGE_SIZE), $offset: '1000' })
      .reply(200, page2)
      .get('/resource/tm3v-pfq9.json')
      .query({ $limit: String(PAGE_SIZE), $offset: '2000' })
      .reply(200, [])
      .get('/resource/tm3v-pfq9.json')
      .query({ $limit: String(PAGE_SIZE), $offset: '3000' })
      .reply(200, []);

    const rows = await fetchSocrataRows(SOURCES.tx.url);
    expect(rows).toHaveLength(PAGE_SIZE + 1);
    expect(rows[0].license_number).toBe('A0');
    expect(rows[PAGE_SIZE].license_number).toBe('B0');
    expect(scope.isDone()).toBe(true);
  });

  test('sends a browser-like User-Agent', async () => {
    const scope = nock('https://data.colorado.gov', {
      reqheaders: { 'user-agent': /Mozilla/ }
    })
      .get('/resource/7s5z-vewr.json')
      .query(true)
      .times(4)
      .reply(200, []);

    await fetchSocrataRows(SOURCES.co.url);
    expect(scope.isDone()).toBe(true);
  });
});

// --- verification dossier ----------------------------------------------------

function seedProvider(npi) {
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
    practice_state: 'TX',
    practice_zipcode: '90001',
    practice_phone: '',
    license_number: '',
    license_issuing_state: '',
    data_source: 'NPI_REGISTRY',
    sync_timestamp: new Date('2026-09-12T00:00:00Z'),
    is_active: true
  });
}

function seedLicense(npi, overrides = {}) {
  mockDb._stores.providerLicenses.push({
    npi: String(npi),
    license_number: 'D0057847',
    issuing_state: 'TX',
    is_primary_taxonomy: true,
    taxonomy_code: '2084N0400X',
    taxonomy_classification: 'Psychiatry & Neurology',
    taxonomy_specialization: 'Neurology',
    source: 'NPI Registry',
    as_of: new Date('2026-09-12T00:00:00Z'),
    ...overrides
  });
}

describe('GET /api/v1/providers/:npi/verification license status', () => {
  test('attaches a verified block with provenance when a board row matches', async () => {
    seedProvider('1366446619');
    seedLicense('1366446619');
    mockDb._stores.licenseStatus.push({
      license_number: 'D0057847',
      issuing_state: 'TX',
      license_type: 'Physician License',
      status: 'Active',
      status_date: new Date('2026-01-15T00:00:00Z'),
      expiration_date: new Date('2028-02-29T00:00:00Z'),
      disciplinary_status: 'NONE',
      source: 'Texas Medical Board (data.texas.gov tm3v-pfq9)',
      as_of: new Date('2026-09-18T00:00:00Z')
    });

    const res = await request(app).get('/api/v1/providers/1366446619/verification');

    expect(res.status).toBe(200);
    const lic = res.body.data.licenses.values[0];
    expect(lic.verified).toEqual({
      status: {
        value: 'Active',
        source: 'Texas Medical Board (data.texas.gov tm3v-pfq9)',
        asOf: '2026-09-18'
      },
      expirationDate: {
        value: '2028-02-29',
        source: 'Texas Medical Board (data.texas.gov tm3v-pfq9)',
        asOf: '2026-09-18'
      },
      disciplinaryStatus: {
        value: 'NONE',
        source: 'Texas Medical Board (data.texas.gov tm3v-pfq9)',
        asOf: '2026-09-18'
      },
      source: 'Texas Medical Board (data.texas.gov tm3v-pfq9)',
      asOf: '2026-09-18'
    });
    // Baseline values keep their self-reported provenance.
    expect(lic.number.source).toBe('NPI Registry');
    expect(res.body.data.licenses.note).toMatch(/self-reported/);
  });

  test('license stays baseline-only when no board row matches', async () => {
    seedProvider('1366446619');
    seedLicense('1366446619', { issuing_state: 'MD' });

    const res = await request(app).get('/api/v1/providers/1366446619/verification');

    expect(res.status).toBe(200);
    const lic = res.body.data.licenses.values[0];
    expect(lic.verified).toBeUndefined();
    expect(lic.number.value).toBe('D0057847');
  });

  test('picks the most recently status-dated row for duplicate numbers', async () => {
    seedProvider('1366446619');
    seedLicense('1366446619');
    mockDb._stores.licenseStatus.push(
      {
        license_number: 'D0057847',
        issuing_state: 'TX',
        license_type: 'Physician License',
        status: 'Active',
        status_date: new Date('2020-01-01T00:00:00Z'),
        expiration_date: null,
        disciplinary_status: null,
        source: 'Texas Medical Board (data.texas.gov tm3v-pfq9)',
        as_of: new Date('2026-09-18T00:00:00Z')
      },
      {
        license_number: 'D0057847',
        issuing_state: 'TX',
        license_type: 'Temporary License',
        status: 'Expired',
        status_date: new Date('2026-06-01T00:00:00Z'),
        expiration_date: new Date('2026-06-01T00:00:00Z'),
        disciplinary_status: null,
        source: 'Texas Medical Board (data.texas.gov tm3v-pfq9)',
        as_of: new Date('2026-09-18T00:00:00Z')
      }
    );

    const res = await request(app).get('/api/v1/providers/1366446619/verification');

    expect(res.status).toBe(200);
    expect(res.body.data.licenses.values[0].verified.status.value).toBe('Expired');
  });
});
