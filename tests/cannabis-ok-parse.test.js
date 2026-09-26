const { parseOkList } = require('../tools/cannabis-ingest-ok');

const SAMPLE = `OKLAHOMA MEDICAL MARIJUANA AUTHORITY

This list of physicians is registered with OMMA following SB 1066.

First Name      Last Name             Type  Practice                             Address                                                                     Phone Number

Abdallah        Dawod                 MD    Altus Premier Helth clinic           304 S Park Ln, Ste B,                                                       (580) 649-9956
                                                                                 Altus, OK 73521 (United States)

Akram           Abraham               MD Akram R Abraham, MD PC Known as 920 N 8th St,                                                                       (580) 688-2200
                                            Abraham Medical clinic               Hollis, OK 73550 (United States)

An              Chen                  MD                                         139 Centre St, Suite 216,                                                   (718) 683-7685
                                                                                 New York, NY 10013 (United States)
`;

describe('parseOkList', () => {
  const { asOf, rows } = parseOkList(SAMPLE, '2026-09-26');

  test('uses the access date as as_of (PDF is undated)', () => {
    expect(asOf).toBe('2026-09-26');
  });

  test('parses entries with practice, wrapped locations, and phones', () => {
    const dawod = rows.find(r => r.last === 'Dawod');
    expect(dawod).toMatchObject({
      first: 'Abdallah', credential: 'MD',
      practice: 'Altus Premier Helth clinic',
      city: 'ALTUS', state: 'OK', zip: '73521',
      phone: '(580) 649-9956'
    });
  });

  test('backfills a wrapped practice name from continuation lines', () => {
    const abraham = rows.find(r => r.last === 'Abraham');
    expect(abraham.city).toBe('HOLLIS');
    expect(abraham.practice).toMatch(/Abraham/);
  });

  test('keeps out-of-state physicians with their location', () => {
    const chen = rows.find(r => r.last === 'Chen');
    expect(chen).toMatchObject({ city: 'NEW YORK', state: 'NY', zip: '10013' });
  });

  test('parses all entries', () => {
    expect(rows).toHaveLength(3);
  });
});
