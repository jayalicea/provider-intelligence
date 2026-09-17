process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const request = require('supertest');

jest.mock('../src/config/database', () => require('./helpers/mockDb'));

const mockDb = require('./helpers/mockDb');
const app = new (require('../src/app'))().app;

const {
  parseNuccCsv,
  parseNihEnvelope,
  describe: describeCode,
  loadRows,
  NUCC_URLS
} = require('../tools/taxonomy-ingest');

afterEach(() => {
  mockDb._reset();
});

// NUCC ships a BOM on the header and quotes fields containing commas.
const NUCC_CSV = [
  '﻿"Code","Grouping","Classification","Specialization","Definition","Notes","Display Name","Section"',
  '"207R00000X","Allopathic & Osteopathic Physicians","Internal Medicine","","A physician...","","Internal Medicine Physician","Individual"',
  '"261QP2300X","Ambulatory Health Care Facilities","Clinic/Center","Primary Care","defn","","","Non-Individual"',
  '"1223G0001X","Dental Providers","Dentist","General Practice","defn","","General Practice Dentist","Individual"',
  ''
].join('\r\n');

describe('taxonomy code set parsing', () => {
  it('parses the NUCC CSV, stripping the BOM and locating columns by name', () => {
    const rows = parseNuccCsv(NUCC_CSV);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      code: '207R00000X',
      grouping: 'Allopathic & Osteopathic Physicians',
      classification: 'Internal Medicine',
      specialization: null,
      description: 'Internal Medicine Physician'
    });
  });

  it('builds a description from classification and specialization when Display Name is blank', () => {
    const rows = parseNuccCsv(NUCC_CSV);
    const clinic = rows.find(r => r.code === '261QP2300X');
    expect(clinic.description).toBe('Clinic/Center, Primary Care');
  });

  it('tolerates a column order change', () => {
    const reordered = [
      '"Display Name","Code","Specialization","Classification","Grouping"',
      '"Internal Medicine Physician","207R00000X","","Internal Medicine","Allopathic & Osteopathic Physicians"'
    ].join('\n');
    expect(parseNuccCsv(reordered)[0]).toMatchObject({
      code: '207R00000X',
      description: 'Internal Medicine Physician',
      grouping: 'Allopathic & Osteopathic Physicians'
    });
  });

  it('rejects a CSV with no Code column rather than loading empty rows', () => {
    expect(() => parseNuccCsv('"Grouping","Classification"\n"a","b"'))
      .toThrow(/no Code column/);
  });

  it('parses the NIH Clinical Tables positional envelope', () => {
    const body = [
      2,
      ['207R00000X', '1223G0001X'],
      {
        grouping: ['Allopathic & Osteopathic Physicians', 'Dental Providers'],
        classification: ['Internal Medicine', 'Dentist'],
        specialization: [null, 'General Practice']
      },
      [['Internal Medicine Physician'], ['General Practice Dentist']]
    ];
    const rows = parseNihEnvelope(body);
    expect(rows).toHaveLength(2);
    expect(rows[0].description).toBe('Internal Medicine Physician');
    expect(rows[1]).toMatchObject({
      code: '1223G0001X',
      specialization: 'General Practice',
      description: 'General Practice Dentist'
    });
  });

  it('rejects a NIH body that is not the expected envelope', () => {
    expect(() => parseNihEnvelope({ results: [] })).toThrow(/envelope/);
  });

  it('describe() prefers Display Name, then classification plus specialization', () => {
    expect(describeCode({ display_name: 'X', classification: 'C', specialization: 'S' })).toBe('X');
    expect(describeCode({ classification: 'C', specialization: 'S' })).toBe('C, S');
    expect(describeCode({ classification: 'C' })).toBe('C');
    expect(describeCode({})).toBeNull();
  });
});

describe('taxonomy source priority', () => {
  it('uses NUCC when it answers, and records it as the source', async () => {
    const calls = [];
    const fetcher = async (url) => { calls.push(url); return NUCC_CSV; };
    const { rows, sourceLabel } = await loadRows({ source: 'auto', file: null }, fetcher);
    expect(sourceLabel).toBe('NUCC_CSV');
    expect(rows).toHaveLength(3);
    expect(calls).toHaveLength(1);
  });

  it('falls back to NIH when NUCC is unreachable', async () => {
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      if (url.includes('nucc.org')) throw new Error('HTTP 403');
      return JSON.stringify([1, ['207R00000X'], { classification: ['Internal Medicine'] }, [[]]]);
    };
    const { rows, sourceLabel } = await loadRows({ source: 'auto', file: null }, fetcher);
    expect(sourceLabel).toBe('NIH_CLINICAL_TABLES');
    expect(rows[0].description).toBe('Internal Medicine');
    // one attempt per NUCC candidate URL, then NIH
    expect(calls).toHaveLength(NUCC_URLS.length + 1);
    expect(calls[calls.length - 1]).toContain('clinicaltables');
  });

  it('reports both failures and the offline option when neither source answers', async () => {
    const fetcher = async () => { throw new Error('HTTP 403'); };
    await expect(loadRows({ source: 'auto', file: null }, fetcher))
      .rejects.toThrow(/no taxonomy source reachable[\s\S]*--file/);
  });

  it('does not try NUCC when a source is pinned to nih', async () => {
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      return JSON.stringify([1, ['207R00000X'], { classification: ['Internal Medicine'] }, [[]]]);
    };
    const { sourceLabel } = await loadRows({ source: 'nih', file: null }, fetcher);
    expect(sourceLabel).toBe('NIH_CLINICAL_TABLES');
    expect(calls.every(u => u.includes('clinicaltables'))).toBe(true);
  });
});

describe('taxonomy labels in the API', () => {
  function seedCode(code, description, grouping) {
    mockDb._stores.taxonomyCodes.set(code, { code, description, grouping });
  }

  function seedProvider(overrides = {}) {
    const npi = overrides.npi || '1366446619';
    mockDb._stores.providers.set(npi, {
      npi,
      enumeration_type: 'Individual',
      name_first: 'JANE', name_middle: '', name_last: 'DOE',
      name_full: 'DOE, JANE', name_credential: 'MD',
      provider_type: 'Internal Medicine',
      primary_taxonomy_code: '207R00000X',
      primary_taxonomy_description: null,
      taxonomy_grouping: '',
      practice_address_line1: '1 WAY', practice_city: 'FRESNO',
      practice_state: 'CA', practice_zipcode: '93720', practice_phone: '5595551212',
      sync_timestamp: new Date(),
      ...overrides
    });
    return npi;
  }

  it('labels a code-only cached provider from the crosswalk', async () => {
    seedCode('207R00000X', 'Internal Medicine Physician', 'Allopathic & Osteopathic Physicians');
    const npi = seedProvider();

    const res = await request(app).get(`/api/v1/providers/${npi}`);

    expect(res.status).toBe(200);
    expect(res.body.data.taxonomy.description).toBe('Internal Medicine Physician');
    expect(res.body.data.taxonomy.grouping).toBe('Allopathic & Osteopathic Physicians');
  });

  it('a stored description still wins over the crosswalk', async () => {
    seedCode('207R00000X', 'Internal Medicine Physician');
    const npi = seedProvider({ primary_taxonomy_description: 'Internal Medicine (stored)' });

    const res = await request(app).get(`/api/v1/providers/${npi}`);

    expect(res.body.data.taxonomy.description).toBe('Internal Medicine (stored)');
  });

  it('an unknown code falls back to provider_type, never to an empty label', async () => {
    const npi = seedProvider({ primary_taxonomy_code: '999X99999X' });

    const res = await request(app).get(`/api/v1/providers/${npi}`);

    expect(res.body.data.taxonomy.description).toBe('Internal Medicine');
  });

  it('the cohort labels rows from the crosswalk and filters on the same value', async () => {
    seedCode('207R00000X', 'Internal Medicine Physician');
    seedProvider();

    const labelled = await request(app).get('/api/v1/intelligence/cohort').query({ state: 'CA' });
    expect(labelled.body.data[0].taxonomy).toBe('Internal Medicine Physician');

    // The filter must search the label the row displays, not the empty stored value.
    const filtered = await request(app)
      .get('/api/v1/intelligence/cohort')
      .query({ state: 'CA', taxonomy: 'Internal Medicine Physician' });
    expect(filtered.body.count).toBe(1);
  });
});
