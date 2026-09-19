process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const { parseLicenses } = require('../tools/license-backfill');

describe('license-backfill parseLicenses', () => {
  it('parses the API envelope shape (array-in-array JSON string)', () => {
    const raw = JSON.stringify([[{
      taxonomy: { code: '2084N0400X', classification: 'Psychiatry & Neurology', specialization: 'Neurology' },
      lic_number: 'D0057847',
      lic_state: 'MD',
      is_primary_taxonomy: 'Y',
    }]]);
    expect(parseLicenses(raw)).toEqual([{
      number: 'D0057847',
      state: 'MD',
      isPrimaryTaxonomy: true,
      taxonomyCode: '2084N0400X',
      taxonomyClassification: 'Psychiatry & Neurology',
      taxonomySpecialization: 'Neurology',
    }]);
  });

  it('returns [] for null, missing, or malformed input', () => {
    expect(parseLicenses(null)).toEqual([]);
    expect(parseLicenses(undefined)).toEqual([]);
    expect(parseLicenses('not json')).toEqual([]);
    expect(parseLicenses(JSON.stringify({ foo: 1 }))).toEqual([]);
    expect(parseLicenses(JSON.stringify([[]]))).toEqual([]);
  });

  it('drops license entries without a number or state', () => {
    const raw = JSON.stringify([[{ lic_number: 'A1', lic_state: 'TX' }, { lic_number: null, lic_state: 'TX' }, { lic_number: 'B2' }]]);
    expect(parseLicenses(raw)).toHaveLength(1);
    expect(parseLicenses(raw)[0].number).toBe('A1');
  });
});
