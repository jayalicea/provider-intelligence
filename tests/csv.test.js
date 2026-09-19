process.env.LOG_LEVEL = 'error';

const { escapeCsvField, toCsv } = require('../src/utils/csv');

describe('csv serializer', () => {
  test('passes plain fields through unquoted', () => {
    expect(escapeCsvField('DOE, JOHN')).toBe('"DOE, JOHN"');
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField(123)).toBe('123');
  });

  test('maps null and undefined to the empty string', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  test('quotes fields containing commas, quotes, or newlines', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('carriage\rreturn')).toBe('"carriage\rreturn"');
  });

  test('toCsv emits a header row and CRLF line endings with trailing CRLF', () => {
    const csv = toCsv(['a', 'b'], [[1, 2], [3, 4]]);
    expect(csv).toBe('a,b\r\n1,2\r\n3,4\r\n');
  });

  test('toCsv emits the header row even with no data rows', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b\r\n');
  });

  test('toCsv leaves formula-like plain fields unquoted (no special chars)', () => {
    const csv = toCsv(['name'], [['=cmd|\' /c calc\'!A1']]);
    expect(csv).toBe('name\r\n=cmd|\' /c calc\'!A1\r\n');
  });
});
