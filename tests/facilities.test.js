process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');
require('nock');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const { isolateNet, resetNet } = require('./helpers/apiMocks');

const app = new (require('../src/app'))().app;

beforeAll(() => isolateNet());
afterEach(() => {
  resetNet();
  mockDb._reset();
});

function seedFacilities() {
  mockDb._stores.facilities.set('687123', {
    ccn: '687123', facility_name: 'Priority Senior Care, Inc.', provider_type_id: '3',
    provider_subtype: 'Not Applicable', address: '2101 Vista Parkway', city: 'West Palm Beach',
    state: 'FL', zip: '33411', phone: '5612286164', certification_dt: '2021-09-14',
    termination_dt: null, compliance_status: 'Yes', accreditation_type_cd: '1',
    original_participation_dt: '2021-07-21', npi: null,
    first_seen_at: '2026-01-02', last_confirmed_at: '2026-01-02',
    currently_registered: true, data_source: 'iqies-q1-2026', sync_timestamp: new Date()
  });
  mockDb._stores.facilities.set('456789', {
    ccn: '456789', facility_name: 'Des Peres Square Surgery Center', provider_type_id: '11',
    provider_subtype: null, address: '1 Main St', city: 'St. Louis', state: 'MO',
    zip: '63131', phone: null, certification_dt: '2019-05-01', termination_dt: null,
    compliance_status: 'Yes', accreditation_type_cd: '7', original_participation_dt: '2018-01-01',
    npi: null, first_seen_at: '2026-01-02', last_confirmed_at: '2026-01-02',
    currently_registered: true, data_source: 'iqies-q1-2026', sync_timestamp: new Date()
  });
}

describe('GET /api/v1/facilities/search', () => {
  test('searches by name with a provider type label', async () => {
    seedFacilities();
    const res = await request(app).get('/api/v1/facilities/search').query({ name: 'surgery' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({
      ccn: '456789',
      facilityName: 'Des Peres Square Surgery Center',
      providerTypeId: '11',
      providerTypeLabel: 'Ambulatory Surgical Center',
      state: 'MO'
    });
  });

  test('filters by type and state', async () => {
    seedFacilities();
    const res = await request(app).get('/api/v1/facilities/search').query({ type: '3', state: 'FL' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].providerTypeLabel).toBe('Home Health Agency');
  });

  test('400 without criteria', async () => {
    expect((await request(app).get('/api/v1/facilities/search')).status).toBe(400);
  });
});

describe('GET /api/v1/facilities/:ccn', () => {
  test('returns a facility with camelCase fields', async () => {
    seedFacilities();
    const res = await request(app).get('/api/v1/facilities/687123');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      ccn: '687123',
      facilityName: 'Priority Senior Care, Inc.',
      providerTypeLabel: 'Home Health Agency',
      certificationDate: '2021-09-14',
      currentlyRegistered: true,
      firstSeenAt: '2026-01-02'
    });
  });

  test('404 for unknown CCN; 400 for malformed', async () => {
    expect((await request(app).get('/api/v1/facilities/999999')).status).toBe(404);
    expect((await request(app).get('/api/v1/facilities/xx')).status).toBe(400);
  });
});
