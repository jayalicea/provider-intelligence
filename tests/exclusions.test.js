process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const ExclusionService = require('../src/services/exclusionService');
const app = new (require('../src/app'))().app;

const service = new ExclusionService();

afterEach(() => {
  mockDb._reset();
});

// Row shape mirrors the live oig_exclusions table (text columns, YYYYMMDD
// dates, source/as_of provenance).
function seedExclusion(overrides = {}) {
  const row = {
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
    source: 'UPDATED.csv',
    as_of: '2026-09-12',
    display_name: 'ABAD-SANTOS, CRISELDA',
    ...overrides
  };
  mockDb._stores.exclusions.push(row);
  return row;
}

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
    practice_state: 'CA',
    practice_zipcode: '90001',
    practice_phone: '',
    license_number: '',
    license_issuing_state: '',
    data_source: 'NPI_REGISTRY',
    sync_timestamp: new Date('2026-09-12T00:00:00Z'),
    is_active: true
  });
}

describe('ExclusionService.resolveExclusion', () => {
  test('flags the real excluded NPI 1760461826 as EXCLUDED by npi match', async () => {
    seedExclusion();

    const result = await service.resolveExclusion({ npi: '1760461826' });

    expect(result.verdict).toBe('EXCLUDED');
    expect(result.match).toBe('npi');
    expect(result.exclusion).toEqual({
      type: '1128b4',
      date: '2025-01-20',
      source: 'UPDATED.csv',
      asOf: '2026-09-12'
    });
    expect(result.reinstated).toBeNull();
  });

  test('known-clean NPI 1366446619 with no LEIE row is CLEAR', async () => {
    const result = await service.resolveExclusion({ npi: '1366446619' });

    expect(result.verdict).toBe('CLEAR');
    expect(result.match).toBe('npi');
    expect(result.exclusion).toBeNull();
    expect(result.reinstated).toBeNull();
  });

  test('garbage input (invalid NPI, no name) is UNVERIFIED, never CLEAR', async () => {
    const result = await service.resolveExclusion({ npi: 'XYZ123' });

    expect(result.verdict).toBe('UNVERIFIED');
    expect(result.match).toBeNull();
    expect(result.exclusion).toBeNull();
    expect(result.reinstated).toBeNull();
    expect(result.notes.join(' ')).toMatch(/not a usable 10-digit npi/i);
  });

  test('reinstated row is CLEAR with reinstated details populated', async () => {
    seedExclusion({ npi: '1234567890', reindate: '20260301' });

    const result = await service.resolveExclusion({ npi: '1234567890' });

    expect(result.verdict).toBe('CLEAR');
    expect(result.match).toBe('npi');
    expect(result.exclusion).toBeNull();
    expect(result.reinstated).toEqual({
      date: '2026-03-01',
      source: 'UPDATED.csv',
      asOf: '2026-09-12'
    });
    expect(result.notes.join(' ')).toMatch(/reinstated/i);
  });

  test('falls back to normalized name+state and notes the unconfirmed DOB', async () => {
    seedExclusion({ npi: '0000000000' });

    const result = await service.resolveExclusion({
      lastname: 'abad-santos',
      firstname: 'criselda',
      state: 'ca',
      dob: '1970-01-01'
    });

    expect(result.verdict).toBe('EXCLUDED');
    expect(result.match).toBe('name_state');
    expect(result.exclusion.type).toBe('1128b4');
    expect(result.notes.join(' ')).toMatch(/date of birth/i);
  });

  test('only reinstated name matches are CLEAR with reinstated noted', async () => {
    seedExclusion({ npi: '0000000000', reindate: '20260301' });

    const result = await service.resolveExclusion({
      lastname: 'ABAD-SANTOS',
      firstname: 'CRISELDA',
      state: 'CA'
    });

    expect(result.verdict).toBe('CLEAR');
    expect(result.match).toBe('name_state');
    expect(result.reinstated.date).toBe('2026-03-01');
  });
});

describe('GET /api/v1/providers/:npi/verification', () => {
  test('returns dossier for known-clean cached provider with provenance', async () => {
    seedProvider('1366446619');

    const res = await request(app).get('/api/v1/providers/1366446619/verification');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { data } = res.body;

    expect(data.npi).toBe('1366446619');
    expect(data.identity.npi).toEqual({
      value: '1366446619',
      source: 'NPI Registry',
      asOf: '2026-09-12'
    });
    expect(data.identity.name.last.value).toBe('AHUJA');
    expect(data.exclusion.verdict).toBe('CLEAR');
    expect(data.flagsSummary).toBe('no flags found');
    expect(data.terms).toBe(
      'This report states what public sources published as of the dates shown. ' +
      "It does not certify any provider's status."
    );
  });

  test('404 when the provider is not cached', async () => {
    const res = await request(app).get('/api/v1/providers/9999999999/verification');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  test('400 for a malformed NPI', async () => {
    const res = await request(app).get('/api/v1/providers/123/verification');
    expect(res.status).toBe(400);
  });
});
