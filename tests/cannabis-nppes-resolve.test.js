const { scoreCandidate, decideScored } = require('../tools/cannabis-nppes-resolve');

const cd = (over) => ({
  npi: '1111111111',
  first: 'GREG',
  last: 'WESTWOOD',
  middle: 'A',
  credential: 'MD',
  city: 'TALLAHASSEE',
  zip: '32301',
  mailingZip: '32301',
  ...over,
});
const src = { last: 'WESTWOOD', first: 'GREG', middle: 'A', city: 'TALLAHASSEE', zip: '32301' };

describe('scoreCandidate', () => {
  test('zip match scores 4 plus name agreement', () => {
    const { score, signals } = scoreCandidate(src, cd());
    expect(score).toBe(4 + 3 + 2 + 1 + 1); // zip + city + first-exact + middle + last-exact
    expect(signals).toContain('zip');
  });

  test('mailing zip counts the same as practice zip', () => {
    const { score, signals } = scoreCandidate(src, cd({ zip: '99999' }));
    expect(signals).toContain('zip');
    expect(score).toBeGreaterThanOrEqual(4);
  });

  test('city scores 3 when zip absent', () => {
    const { score, signals } = scoreCandidate({ ...src, zip: '' }, cd({ zip: '99999', mailingZip: '99999' }));
    expect(signals).toContain('city');
    expect(signals).not.toContain('zip');
    expect(score).toBe(3 + 2 + 1 + 1);
  });

  test('middle initial conflict subtracts 1', () => {
    const { score, signals } = scoreCandidate(src, cd({ middle: 'Q' }));
    expect(signals).toContain('middle-conflict');
    expect(score).toBe(4 + 3 + 2 - 1 + 1);
  });

  test('cleaned-variant last name scores no last-exact point', () => {
    const { score, signals } = scoreCandidate({ ...src, last: 'EL HADDAD' }, cd({ last: 'ELHADDAD' }));
    expect(signals).not.toContain('last-exact');
    expect(score).toBe(4 + 3 + 2 + 1);
  });
});

describe('decideScored', () => {
  test('decisive winner at 5+ with margin 3+ is accepted', () => {
    const d = decideScored([
      { npi: '1', score: 8, signals: ['zip', 'first-exact'] },
      { npi: '2', score: 3, signals: ['first-exact'] },
    ]);
    expect(d).toMatchObject({ status: 'accept', npi: '1' });
    expect(d.margin).toBe(5);
  });

  test('score 4 accepted only via the middle-initial no-city tier', () => {
    const d = decideScored([
      { npi: '1', score: 4, signals: ['first-exact', 'middle', 'last-exact'] },
      { npi: '2', score: 1, signals: ['first-prefix'] },
    ]);
    expect(d.status).toBe('accept');
    expect(d.note).toContain('no-city tier');
  });

  test('score 4 without middle agreement stays quarantined', () => {
    const d = decideScored([
      { npi: '1', score: 4, signals: ['first-exact', 'last-exact'] },
      { npi: '2', score: 1, signals: [] },
    ]);
    expect(d.status).toBe('quarantine');
  });

  test('close scores stay quarantined even above threshold', () => {
    const d = decideScored([
      { npi: '1', score: 6, signals: ['zip'] },
      { npi: '2', score: 5, signals: ['city'] },
    ]);
    expect(d.status).toBe('quarantine');
    expect(d.reason).toBe('no-decisive-winner');
  });

  test('empty pool is no-candidates', () => {
    expect(decideScored([])).toEqual({ status: 'quarantine', reason: 'no-candidates' });
  });

  test('single weak candidate is below threshold', () => {
    const d = decideScored([{ npi: '1', score: 3, signals: ['first-exact', 'last-exact'] }]);
    expect(d.status).toBe('quarantine');
    expect(d.reason).toBe('single-candidate-below-threshold');
  });
});
