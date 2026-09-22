import { useRef, useState } from 'react'
import api from '../api/client.js'
import EmptyState from '../components/EmptyState.jsx'
import ErrorBanner from '../components/ErrorBanner.jsx'
import VerdictBadge from '../components/VerdictBadge.jsx'
import NpiText from '../components/NpiText.jsx'

const MAX_ROWS = 1000

// Quote-aware CSV parse, matching tools/screen-roster.js. The file is read in
// the browser and only the parsed rows are posted, so nothing is uploaded and
// nothing is stored server-side.
function parseCsv(text) {
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') { inQuotes = true }
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* skip */ }
    else field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  while (rows.length && rows[rows.length - 1].every((v) => v === '')) rows.pop()
  return rows
}

function toRows(text) {
  const raw = parseCsv(text)
  if (!raw.length) throw new Error('That file is empty.')
  const header = raw[0].map((h) => h.trim().toLowerCase().replace(/^\uFEFF/, ''))
  const col = (name) => header.indexOf(name)
  const hasNpi = col('npi') !== -1
  const hasName = col('lastname') !== -1 && col('firstname') !== -1 && col('state') !== -1
  const hasOrg = col('organizationname') !== -1 || col('organization') !== -1
  if (!hasNpi && !hasName && !hasOrg) {
    throw new Error(
      'The header must contain npi, or lastname plus firstname plus state, or organizationname.'
    )
  }
  const get = (row, name) => {
    const i = col(name)
    return i === -1 ? null : (row[i] ?? '').trim() || null
  }
  return raw.slice(1).map((row) => ({
    npi: get(row, 'npi'),
    lastname: get(row, 'lastname'),
    firstname: get(row, 'firstname'),
    state: get(row, 'state'),
    dob: get(row, 'dob'),
    organizationName: get(row, 'organizationname') || get(row, 'organization'),
  }))
}

function ResultSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr className="skeleton-row" key={i} aria-hidden="true">
          <td><span className="skeleton-line" /></td>
          <td><span className="skeleton-line" style={{ width: '40%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '55%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '70%' }} /></td>
        </tr>
      ))}
    </>
  )
}

export default function UploadRosterPage() {
  const inputRef = useRef(null)
  const [fileName, setFileName] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [state, setState] = useState({ loading: false, error: null, data: null })

  async function screen(file) {
    setFileName(file.name)
    setState({ loading: true, error: null, data: null })
    try {
      const text = await file.text()
      const rows = toRows(text)
      if (!rows.length) throw new Error('That file has a header but no rows.')
      if (rows.length > MAX_ROWS) {
        throw new Error(`That file has ${rows.length} rows; one screen takes up to ${MAX_ROWS}.`)
      }
      const data = await api.screenRoster(rows)
      setState({ loading: false, error: null, data })
    } catch (error) {
      setState({ loading: false, error, data: null })
    }
  }

  function onDrop(event) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) screen(file)
  }

  const { loading, error, data } = state
  const counts = data?.counts ?? {}

  return (
    <section>
      <h1 className="page-title">Upload roster</h1>
      <p className="page-lede muted">
        Screen a roster against the federal LEIE and the state Medicaid
        exclusion lists. The file is read in your browser and only the parsed
        rows are sent; nothing is uploaded or stored.
      </p>

      <div
        className={dragging ? 'dropzone is-active' : 'dropzone'}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
        >
          {loading ? 'Screening…' : 'Choose a CSV file'}
        </button>
        <p className="dropzone-hint">
          or drop it here. Header needs <span className="mono">npi</span>, or{' '}
          <span className="mono">lastname</span> +{' '}
          <span className="mono">firstname</span> +{' '}
          <span className="mono">state</span>, or{' '}
          <span className="mono">organizationname</span>.{' '}
          <span className="mono">dob</span> is optional and sharpens name matches.
          Up to {MAX_ROWS} rows.
        </p>
        {fileName && <p className="provenance">{fileName}</p>}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="visually-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) screen(file)
            e.target.value = ''
          }}
        />
      </div>

      {error && <ErrorBanner message={error.message} />}

      {loading && (
        <div className="table-region stack-top" aria-busy="true">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>NPI</th><th>Verdict</th><th>Finding</th>
              </tr>
            </thead>
            <tbody><ResultSkeleton /></tbody>
          </table>
        </div>
      )}

      {!loading && !error && data && data.results.length === 0 && (
        <EmptyState
          title="No rows screened"
          description="That file parsed, but carried no data rows below the header."
        />
      )}

      {!loading && !error && data && data.results.length > 0 && (
        <>
          <div className="summary-row stack-top">
            <span className="badge badge-error">{counts.EXCLUDED ?? 0} excluded</span>
            <span className="badge badge-success">{counts.CLEAR ?? 0} clear</span>
            <span className="badge badge-na">{counts.UNVERIFIED ?? 0} unverified</span>
          </div>
          {data.truncated && (
            <div className="info-banner">
              Showing the first {data.count} of {data.submitted} rows submitted.
            </div>
          )}
          <div className="table-region">
            <p className="results-count">
              {data.count} row{data.count === 1 ? '' : 's'} screened against the
              LEIE and the state Medicaid lists
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>NPI</th>
                  <th>Verdict</th>
                  <th>Finding</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((row, i) => (
                  <tr key={`${row.input.npi || row.input.name}-${i}`}>
                    <td>
                      {row.input.name || '—'}
                      {row.input.state && (
                        <div className="provenance">{row.input.state}</div>
                      )}
                    </td>
                    <td>
                      <NpiText npi={row.input.npi} link={Boolean(row.input.npi)} />
                    </td>
                    <td>
                      <VerdictBadge verdict={row.verdict} />
                      {row.match && (
                        <div className="provenance">
                          matched by {row.match.replace('_', ' ')}
                        </div>
                      )}
                    </td>
                    <td>
                      {row.exclusion ? (
                        <>
                          <div>
                            {row.exclusion.type || 'Exclusion'}
                            {row.exclusion.date ? `, effective ${row.exclusion.date}` : ''}
                          </div>
                          <div className="provenance">
                            {row.exclusion.registry === 'STATE'
                              ? `${row.exclusion.state || ''} state Medicaid list${row.exclusion.sourceName ? ` (${row.exclusion.sourceName})` : ''}`
                              : `OIG LEIE (${row.exclusion.source})`}
                            {row.exclusion.asOf ? ` — as of ${row.exclusion.asOf}` : ''}
                          </div>
                        </>
                      ) : (
                        <span className="muted">
                          {row.notes[0] || 'No exclusion record found.'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
