const {
  parseLine,
  parseDate,
  pickPrimaryTaxonomy,
  mapRow
} = require('../tools/nppes-ingest');

// Minimal fixture with the header columns the mapper touches, in file order.
const HEADER = [
  'NPI',
  'Entity Type Code',
  'Replacement NPI',
  'Provider Organization Name (Legal Business Name)',
  'Provider Last Name (Legal Name)',
  'Provider First Name',
  'Provider Middle Name',
  'Provider Name Prefix Text',
  'Provider Name Suffix Text',
  'Provider Credential Text',
  'Provider First Line Business Mailing Address',
  'Provider Business Mailing Address City Name',
  'Provider Business Mailing Address State Name',
  'Provider Business Mailing Address Postal Code',
  'Provider Business Mailing Address Country Code (If outside U.S.)',
  'Provider Business Mailing Address Telephone Number',
  'Provider Business Mailing Address Fax Number',
  'Provider First Line Business Practice Location Address',
  'Provider Business Practice Location Address City Name',
  'Provider Business Practice Location Address State Name',
  'Provider Business Practice Location Address Postal Code',
  'Provider Business Practice Location Address Country Code (If outside U.S.)',
  'Provider Business Practice Location Address Telephone Number',
  'Provider Business Practice Location Address Fax Number',
  'Provider Enumeration Date',
  'Last Update Date',
  'Provider Credential Text_2', // filler to prove name-based lookup
  'Parent Organization LBN',
  'Healthcare Provider Taxonomy Code_1',
  'Provider License Number_1',
  'Provider License Number State Code_1',
  'Healthcare Provider Primary Taxonomy Switch_1',
  'Healthcare Provider Taxonomy Code_2',
  'Provider License Number_2',
  'Provider License Number State Code_2',
  'Healthcare Provider Primary Taxonomy Switch_2',
  'Healthcare Provider Taxonomy Code_3',
  'Provider License Number_3',
  'Provider License Number State Code_3',
  'Healthcare Provider Primary Taxonomy Switch_3'
];

function buildIndex() {
  const idx = {};
  HEADER.forEach((h, i) => { idx[h] = i; });
  return idx;
}

function baseFields() {
  return HEADER.map(() => '');
}

describe('nppes-ingest parser', () => {
  it('parses plain fields', () => {
    expect(parseLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted fields with embedded commas', () => {
    expect(parseLine('"a,b","c","d,e,f"')).toEqual(['a,b', 'c', 'd,e,f']);
  });

  it('handles escaped double quotes', () => {
    expect(parseLine('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
  });

  it('handles empty quoted fields', () => {
    expect(parseLine('"","b",""')).toEqual(['', 'b', '']);
  });
});

describe('parseDate', () => {
  it('converts MM/DD/YYYY to ISO', () => {
    expect(parseDate('05/23/2005')).toBe('2005-05-23');
    expect(parseDate('12/31/2026')).toBe('2026-12-31');
  });

  it('returns null on empty or malformed input', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate('not-a-date')).toBeNull();
  });
});

describe('pickPrimaryTaxonomy', () => {
  const idx = buildIndex();

  it('picks the slot flagged X', () => {
    const f = baseFields();
    f[idx['Healthcare Provider Taxonomy Code_1']] = '111A00000X';
    f[idx['Healthcare Provider Primary Taxonomy Switch_1']] = 'N';
    f[idx['Healthcare Provider Taxonomy Code_2']] = '222B00000X';
    f[idx['Healthcare Provider Primary Taxonomy Switch_2']] = 'X';
    expect(pickPrimaryTaxonomy(f, idx)).toEqual({ code: '222B00000X', switchValue: 'X' });
  });

  it('accepts Y as a flag value (live file uses Y, not X)', () => {
    const f = baseFields();
    f[idx['Healthcare Provider Taxonomy Code_1']] = '111A00000X';
    f[idx['Healthcare Provider Primary Taxonomy Switch_1']] = 'Y';
    expect(pickPrimaryTaxonomy(f, idx)).toEqual({ code: '111A00000X', switchValue: 'Y' });
  });

  it('falls back to slot 1 when no slot is flagged', () => {
    const f = baseFields();
    f[idx['Healthcare Provider Taxonomy Code_1']] = '111A00000X';
    f[idx['Healthcare Provider Primary Taxonomy Switch_1']] = 'N';
    f[idx['Healthcare Provider Taxonomy Code_2']] = '222B00000X';
    f[idx['Healthcare Provider Primary Taxonomy Switch_2']] = 'N';
    expect(pickPrimaryTaxonomy(f, idx)).toEqual({ code: '111A00000X', switchValue: 'fallback_1' });
  });

  it('returns null when all taxonomy slots are empty', () => {
    expect(pickPrimaryTaxonomy(baseFields(), idx)).toEqual({ code: null, switchValue: null });
  });
});

describe('mapRow', () => {
  const idx = buildIndex();

  it('maps by header name and coerces empties to null', () => {
    const f = baseFields();
    f[idx.NPI] = '1234567890';
    f[idx['Entity Type Code']] = '1';
    f[idx['Provider Last Name (Legal Name)']] = 'DOE';
    f[idx['Provider First Name']] = 'JANE';
    f[idx['Provider Enumeration Date']] = '05/23/2005';
    f[idx['Provider Business Practice Location Address City Name']] = 'KEARNEY';
    f[idx['Healthcare Provider Taxonomy Code_1']] = '207X00000X';
    f[idx['Healthcare Provider Primary Taxonomy Switch_1']] = 'Y';

    const row = mapRow(f, idx, 'src.csv', '2026-09-12');
    expect(row.npi).toBe('1234567890');
    expect(row.entity_type_code).toBe('1');
    expect(row.last_name).toBe('DOE');
    expect(row.first_name).toBe('JANE');
    expect(row.middle_name).toBeNull();
    expect(row.practice_city).toBe('KEARNEY');
    expect(row.mailing_city).toBeNull();
    expect(row.enumeration_date).toBe('2005-05-23');
    expect(row.last_update_date).toBeNull();
    expect(row.primary_taxonomy_code).toBe('207X00000X');
    expect(row.primary_taxonomy_description).toBeNull();
    expect(row.taxonomy_switch).toBe('Y');
    expect(row.source).toBe('src.csv');
    expect(row.as_of).toBe('2026-09-12');
  });

  it('maps organization name fields', () => {
    const f = baseFields();
    f[idx.NPI] = '1098765432';
    f[idx['Entity Type Code']] = '2';
    f[idx['Provider Organization Name (Legal Business Name)']] = 'ACME HEALTH';
    f[idx['Parent Organization LBN']] = 'ACME PARENT';

    const row = mapRow(f, idx, 'src.csv', '2026-09-12');
    expect(row.legal_business_name).toBe('ACME HEALTH');
    expect(row.parent_organization_lbn).toBe('ACME PARENT');
    expect(row.last_name).toBeNull();
  });
});
