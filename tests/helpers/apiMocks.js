// Shared fixtures + nock helpers for offline API tests.

const nock = require('nock');

const NPI_HOST = 'https://clinicaltables.nlm.nih.gov';
const CMS_HOST = 'https://data.cms.gov';
const MIPS_DATASET_PATH = '/data-api/v1/dataset/7adb8b1b-b85c-4ed3-b314-064776e50180/data';
const DATASTORE_PATH = datasetId => `/provider-data/api/1/datastore/query/${datasetId}/0`;

// Block all real HTTP; supertest's loopback listener stays reachable.
//
// A jest worker runs several test files in one process. Each file gets a fresh
// module registry, so each requires its own `nock` instance, but http/https are
// core modules that are never re-instantiated -- the overrides installed by an
// earlier file's instance survive into the next file. The stale override
// consults its own (now empty) interceptor registry, matches nothing, and
// rejects the request as a disallowed net connect. That is why every suite
// passed alone and whichever suite ran second in a worker failed.
//
// Activating on setup and restoring the real http methods when the file ends
// keeps exactly one instance patched at a time, so suites pass in any order.
function isolateNet() {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
  nock.enableNetConnect(host =>
    /^(127\.0\.0\.1|localhost|::1|\[::1\])/.test(host)
  );
}

function resetNet() {
  nock.cleanAll();
}

// Teardown belongs to the file, not the test: nock.restore() deactivates the
// instance outright, so calling it per test would leave every test after the
// first one unintercepted. Registered here rather than in each test file so
// the suites themselves stay unchanged.
if (typeof afterAll === 'function') {
  afterAll(() => {
    nock.cleanAll();
    nock.restore();
  });
}

/**
 * Build a Clinical Tables envelope:
 * [count, [NPIs], {extraField: [values...]}, [[display fields]]]
 * row objects use dotted keys matching the service's EXTRA_FIELDS.
 */
function npiEnvelope(rows) {
  const extraKeys = [
    'name.full', 'name.first', 'name.middle', 'name.last', 'name.credential',
    'addr_practice.line1', 'addr_practice.line2', 'addr_practice.city',
    'addr_practice.state', 'addr_practice.zip', 'addr_practice.phone',
    'licenses.taxonomy.code', 'licenses.taxonomy.grouping',
    'licenses.lic_number', 'licenses.issuing_state'
  ];
  const extra = {};
  extraKeys.forEach(k => { extra[k] = rows.map(r => (k in r ? r[k] : null)); });
  return [
    rows.length,
    rows.map(r => r.npi),
    extra,
    rows.map(r => [r['name.full'], r.npi, r.providerType, r.addressFull || ''])
  ];
}

const PROVIDER_ROW = {
  npi: '1234567890',
  'name.full': 'DOE, JOHN A, MD',
  'name.first': 'JOHN',
  'name.middle': 'A',
  'name.last': 'DOE',
  'name.credential': 'MD',
  providerType: 'Physician/Internal Medicine',
  addressFull: '100 MAIN ST, BALTIMORE, MD 21201',
  'addr_practice.line1': '100 MAIN ST',
  'addr_practice.line2': '',
  'addr_practice.city': 'BALTIMORE',
  'addr_practice.state': 'MD',
  'addr_practice.zip': '21201',
  'addr_practice.phone': '(410) 555-1212',
  'licenses.taxonomy.code': '207R00000X',
  'licenses.taxonomy.grouping': 'Allopathic & Osteopathic Physicians',
  'licenses.lic_number': 'MD12345',
  'licenses.issuing_state': 'MD'
};

const MIPS_ROW = {
  npi: '1111111111',
  'final score': '87.5',
  'quality category score': '80',
  'improvement activities (ia) category score': '40',
  'promoting interoperability (pi) category score': '95',
  'cost category score': '60',
  'participation option': 'Individual',
  'reporting option': 'Traditional MIPS'
};

const QM_ROWS = [
  {
    facility_id: '140010',
    facility_name: 'TEST HOSPITAL',
    measure_id: 'COMP_HIP_KNEE',
    measure_name: 'Rate of complications for hip/knee replacement patients',
    compared_to_national: 'No Different Than the National Rate',
    denominator: '850',
    score: '3.8',
    lower_estimate: '2.4',
    higher_estimate: '6.0',
    footnote: '',
    start_date: '04/01/2023',
    end_date: '03/31/2025'
  },
  {
    facility_id: '140010',
    facility_name: 'TEST HOSPITAL',
    measure_id: 'MORT_30_AMI',
    measure_name: 'Death rate for heart attack patients',
    compared_to_national: '',
    denominator: '',
    score: 'Not Available',
    lower_estimate: '',
    higher_estimate: '',
    footnote: '2',
    start_date: '07/01/2022',
    end_date: '06/30/2025'
  }
];

function mockNpiSearch(matchTerms, body, status = 200) {
  return nock(NPI_HOST)
    .get('/api/npi_idv/v3/search')
    .query(q => (matchTerms ? q.terms === matchTerms : true))
    .reply(status, body);
}

function mockMipsData(matchNpi, body, status = 200) {
  return nock(CMS_HOST)
    .get(MIPS_DATASET_PATH)
    .query(q => (matchNpi ? q['filter[npi]'] === matchNpi : true))
    .reply(status, body);
}

function mockDatastore(datasetId, body, status = 200) {
  return nock(CMS_HOST)
    .get(DATASTORE_PATH(datasetId))
    .query(true)
    .reply(status, body);
}

module.exports = {
  isolateNet,
  resetNet,
  npiEnvelope,
  PROVIDER_ROW,
  MIPS_ROW,
  QM_ROWS,
  mockNpiSearch,
  mockMipsData,
  mockDatastore
};
