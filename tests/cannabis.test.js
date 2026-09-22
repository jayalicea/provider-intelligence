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

function seedCannabis() {
  mockDb._stores.cannabis.set('FL:ME126815', {
    state: 'FL',
    license_number: 'ME126815',
    npi: '1234567890',
    practitioner_first_name: 'GREG',
    practitioner_last_name: 'WESTWOOD',
    credential: 'MD',
    program_name: 'Florida Medical Marijuana Program',
    source_name: 'FL OMMU Qualified Physician List',
    source_url: 'https://example.test/fl',
    as_of: '2026-09-11',
    certification_status: 'qualified'
  });
  // AL rows carry no license or NPI (license-less source).
  mockDb._stores.cannabis.set('AL:ROW-1', {
    state: 'AL',
    license_number: null,
    npi: null,
    practitioner_first_name: 'OSEMELU',
    practitioner_last_name: 'ABURIME',
    credential: 'MD',
    program_name: 'Alabama Medical Cannabis Commission',
    source_name: 'AMCC Registered Certifying Physicians',
    source_url: 'https://example.test/al',
    as_of: '2026-09-18',
    certification_status: 'registered'
  });
}

describe('GET /api/v1/cannabis/physicians', () => {
  test('lists all physicians across states, NPI null when unknown', async () => {
    seedCannabis();

    const res = await request(app).get('/api/v1/cannabis/physicians');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.data[0]).toMatchObject({
      state: 'AL',
      practitionerLastName: 'ABURIME',
      npi: null,
      licenseNumber: null,
      certificationStatus: 'registered'
    });
    expect(res.body.data[1]).toMatchObject({
      state: 'FL',
      practitionerLastName: 'WESTWOOD',
      npi: '1234567890',
      licenseNumber: 'ME126815'
    });
  });

  test('state filter returns only that state', async () => {
    seedCannabis();

    const res = await request(app)
      .get('/api/v1/cannabis/physicians')
      .query({ state: 'FL' });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].state).toBe('FL');
  });

  test('state filter is case-insensitive', async () => {
    seedCannabis();

    const res = await request(app)
      .get('/api/v1/cannabis/physicians')
      .query({ state: 'fl' });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  test('400 for a malformed state code', async () => {
    const res = await request(app)
      .get('/api/v1/cannabis/physicians')
      .query({ state: 'FLORIDA' });

    expect(res.status).toBe(400);
  });
});
