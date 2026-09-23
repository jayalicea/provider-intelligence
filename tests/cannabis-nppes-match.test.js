const { decideRow, freshNote } = require('../tools/cannabis-nppes-match');

const cand = (npi, first, city) => ({ npi, first, city });

describe('cannabis-nppes-match decideRow', () => {
  test('unique name+city match is accepted', () => {
    const d = decideRow({
      city: 'TALLAHASSEE',
      matches: [cand('1111111111', 'GREG', 'TALLAHASSEE'), cand('2222222222', 'GREG', 'MIAMI')],
      first: 'GREG',
    });
    expect(d).toEqual({ status: 'accept', npi: '1111111111', note: 'NPPES unique name+city match' });
  });

  test('multiple candidates in the source city are quarantined', () => {
    const d = decideRow({
      city: 'MIAMI',
      matches: [cand('1111111111', 'GREG', 'MIAMI'), cand('2222222222', 'GREGORY', 'MIAMI')],
      first: 'GREG',
    });
    expect(d.status).toBe('quarantine');
    expect(d.reason).toBe('multiple-city-matches');
  });

  test('single name match in a different city is quarantined (weak signal)', () => {
    const d = decideRow({
      city: 'TAMPA',
      matches: [cand('1111111111', 'GREG', 'ORLANDO')],
      first: 'GREG',
    });
    expect(d.status).toBe('quarantine');
    expect(d.reason).toBe('unique-name-no-city');
  });

  test('no city: unique exact-name match is accepted with the weaker note', () => {
    const d = decideRow({
      city: '',
      matches: [cand('1111111111', 'GREG', 'CHARLESTON'), cand('2222222222', 'GREGORY', 'HUNTINGTON')],
      first: 'GREG',
    });
    expect(d).toEqual({ status: 'accept', npi: '1111111111', note: 'NPPES unique name match (no city in source)' });
  });

  test('no city: multiple exact-name matches are quarantined', () => {
    const d = decideRow({
      city: '',
      matches: [cand('1111111111', 'GREG', 'A'), cand('2222222222', 'GREG', 'B')],
      first: 'GREG',
    });
    expect(d.status).toBe('quarantine');
    expect(d.reason).toBe('multiple-city-matches');
  });

  test('no city: zero exact-name matches are quarantined', () => {
    const d = decideRow({
      city: '',
      matches: [cand('1111111111', 'GREGORY', 'A')],
      first: 'GREG',
    });
    expect(d.status).toBe('quarantine');
    expect(d.reason).toBe('name-matches-no-city-confirmation');
  });

  test('city present but zero candidates is quarantined as no-candidates', () => {
    const d = decideRow({ city: 'TAMPA', matches: [], first: 'GREG' });
    expect(d.status).toBe('quarantine');
    expect(d.reason).toBe('no-candidates');
  });
});

describe('cannabis-nppes-match freshNote', () => {
  test('strips prior NPI-match and quarantine notes for idempotent re-runs', () => {
    const note = 'registered 2026-09-18 | expires 12/31/2026 | NPI matched 2026-09-20: NPPES unique name+city match';
    expect(freshNote(note)).toBe('registered 2026-09-18 | expires 12/31/2026');
    const q = 'base | NPI match quarantined 2026-09-20: multiple-city-matches';
    expect(freshNote(q)).toBe('base');
  });

  test('leaves unmatched notes untouched', () => {
    expect(freshNote('registered 2026-09-18')).toBe('registered 2026-09-18');
  });
});
