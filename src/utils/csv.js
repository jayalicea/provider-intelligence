// Minimal RFC 4180-ish CSV serializer. No external dependency.
//
// Field rules: null/undefined become the empty string; any field containing
// a comma, double quote, CR, or LF is wrapped in double quotes with inner
// quotes doubled. Rows are joined with CRLF and the output ends with a
// trailing CRLF so Excel treats the last line as complete.

function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build a CSV document. `headers` is an array of column names (emitted
 * verbatim as the first line); `rows` is an array of arrays of cell values
 * in header order.
 */
function toCsv(headers, rows) {
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Send a CSV payload as a downloadable attachment.
 */
function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`
  );
  res.send(csv);
}

module.exports = { escapeCsvField, toCsv, sendCsv };
