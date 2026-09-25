process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');
const nock = require('nock');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const { isolateNet, resetNet } = require('./helpers/apiMocks');

const app = new (require('../src/app'))().app;

beforeAll(() => isolateNet());
afterEach(() => {
  resetNet();
  mockDb._reset();
});

function seedLabs() {
  mockDb._stores.clia.set('34D0001234', {
    clia_number: '34D0001234',
    lab_name: 'SHELBY BAPTIST MEDICAL CENTER',
    additional_lab_name: null,
    address: '1000 FIRST STREET NORTH',
    city: 'ALABASTER',
    state: 'AL',
    zip: '35007',
    phone: '2056208905',
    fax: null,
    certificate_type_cd: '3',
    certificate_effective_dt: '2025-02-09',
    certification_dt: '1993-02-23',
    compliance_status_cd: null,
    termination_cd: '00',
    termination_dt: null,
    clia_termination_cd: '00',
    lab_classification_cd: '00',
    lab_classification_cds: [],
    medicare_number: null,
    original_participation_dt: '1993-02-23',
    ownership_type_cd: '04',
    accreditation: { COLA: { matchDate: null } },
    npi: null,
    first_seen_at: '2026-04-01',
    last_confirmed_at: '2026-04-01',
    currently_registered: true,
    data_source: 'clia-q2-2026',
    sync_timestamp: new Date()
  });
  mockDb._stores.clia.set('42B0009999', {
    clia_number: '42B0009999',
    lab_name: 'CITY PATHOLOGY PARTNERS',
    additional_lab_name: null,
    address: '200 MAIN ST',
    city: 'PHILADELPHIA',
    state: 'PA',
    zip: '19103',
    phone: '2155551212',
    fax: null,
    certificate_type_cd: '4',
    certificate_effective_dt: '2024-06-01',
    certification_dt: '2010-01-15',
    compliance_status_cd: null,
    termination_cd: '00',
    termination_dt: null,
    clia_termination_cd: '00',
    lab_classification_cd: '03',
    lab_classification_cds: ['03'],
    medicare_number: 'CCN123',
    original_participation_dt: '2010-01-15',
    ownership_type_cd: '03',
    accreditation: {},
    npi: null,
    first_seen_at: '2026-04-01',
    last_confirmed_at: '2026-04-01',
    currently_registered: true,
    data_source: 'clia-q2-2026',
    sync_timestamp: new Date()
  });
}

describe('GET /api/v1/labs/search', () => {
  test('searches by name substring', async () => {
    seedLabs();
    const res = await request(app).get('/api/v1/labs/search').query({ name: 'pathology' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({
      cliaNumber: '42B0009999',
      labName: 'CITY PATHOLOGY PARTNERS',
      state: 'PA',
      certificateTypeCd: '4'
    });
  });

  test('filters by state', async () => {
    seedLabs();
    const res = await request(app).get('/api/v1/labs/search').query({ state: 'al' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].cliaNumber).toBe('34D0001234');
  });

  test('400 without criteria or with a bad state code', async () => {
    expect((await request(app).get('/api/v1/labs/search')).status).toBe(400);
    expect((await request(app).get('/api/v1/labs/search').query({ state: 'ALABAMA' })).status).toBe(400);
  });
});

describe('GET /api/v1/labs/:cliaNumber', () => {
  test('returns a lab with camelCase fields', async () => {
    seedLabs();
    const res = await request(app).get('/api/v1/labs/42B0009999');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      cliaNumber: '42B0009999',
      labName: 'CITY PATHOLOGY PARTNERS',
      city: 'PHILADELPHIA',
      certificateEffectiveDate: '2024-06-01',
      labClassificationCds: ['03'],
      medicareNumber: 'CCN123',
      currentlyRegistered: true,
      firstSeenAt: '2026-04-01'
    });
  });

  test('404 for unknown CLIA number', async () => {
    const res = await request(app).get('/api/v1/labs/99Z9999999');
    expect(res.status).toBe(404);
  });

  test('400 for malformed CLIA number', async () => {
    const res = await request(app).get('/api/v1/labs/notaclia');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid clia/i);
  });
});
