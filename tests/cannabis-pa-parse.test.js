const { parsePaList } = require('../tools/cannabis-ingest-pa');

const SAMPLE = `Department of Health Medical Marijuana Approved Practitioners
listing of physicians approved to certify patients as of August 31, 2026.

    ADAMS ................................................................ 3
    ALLEGHENY .............................................................. 3

County     Practitioner              Location
Adams      Annie Harberger, D.O.     105 4th St.
           Nora Olson, M.D.          East Berlin, PA 17316
Allegheny  Talbot Smith, M.D.        1311 Biglerville Rd.    Family Medicine
           Nora Sudarsan, DO         Gettysburg, PA 17325    Family Medicine
                                     1311 Biglerville Rd.    Family Medicine
           Adam Wasserman, M.D.      Gettysburg, Pa 17325    Hematology/ Oncology
OUT-OF-STATE LOCATIONS
           Jane Q Public, M.D., PhD  Pittsburgh, PA 15205    General and Addiction
`;

describe('parsePaList', () => {
  const { asOf, rows, stats } = parsePaList(SAMPLE);

  test('parses the as-of date from the cover text', () => {
    expect(asOf).toBe('2026-08-31');
  });

  test('parses county-organized entries with credentials', () => {
    const sudarsan = rows.find(r => r.last === 'Sudarsan');
    expect(sudarsan).toMatchObject({
      first: 'Nora', credential: 'DO', county: 'Allegheny',
      city: 'GETTYSBURG', state: 'PA', zip: '17325', specialty: 'Family Medicine'
    });
  });

  test('absorbs locations from continuation lines (wrapped addresses)', () => {
    const harberger = rows.find(r => r.last === 'Harberger');
    expect(harberger.county).toBe('Adams');
    expect(harberger.city).toBe(''); // street-only location: honestly absent
  });

  test('lowercase state abbreviation in source is normalized', () => {
    const wasserman = rows.find(r => r.last === 'Wasserman');
    expect(wasserman).toMatchObject({ city: 'GETTYSBURG', state: 'PA', zip: '17325' });
  });

  test('handles PhD suffix on the credential', () => {
    const pub = rows.find(r => r.last === 'Q Public');
    expect(pub.credential).toBe('MD, PHD');
    expect(pub.city).toBe('PITTSBURGH');
    expect(pub.county).toBe('OUT-OF-STATE LOCATIONS');
  });

  test('stats reflect entries and distinct counties', () => {
    expect(rows).toHaveLength(6);
    expect(stats.counties).toBe(3);
  });
});
