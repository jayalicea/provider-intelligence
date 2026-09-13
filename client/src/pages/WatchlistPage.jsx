import { useState } from 'react'
import api from '../api/client.js'
import { useFetch } from '../hooks/useFetch.js'
import EmptyState from '../components/EmptyState.jsx'
import ErrorBanner from '../components/ErrorBanner.jsx'

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI',
  'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN',
  'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
]

const WINDOWS = [
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 180, label: 'Last 180 days' },
  { value: 365, label: 'Last 365 days' },
]

// Skeleton rows rather than a spinner, per DESIGN.md section 4.
function WatchlistSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr className="skeleton-row" key={i} aria-hidden="true">
          <td><span className="skeleton-line" /></td>
          <td><span className="skeleton-line" style={{ width: '50%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '30%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '60%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '60%' }} /></td>
        </tr>
      ))}
    </>
  )
}

export default function WatchlistPage() {
  const [state, setState] = useState('')
  const [days, setDays] = useState(90)

  const { data, loading, error, refetch } = useFetch(
    () => api.getExclusionWatchlist({ state: state || undefined, days }),
    [state, days]
  )

  const results = data?.results ?? []
  const count = data?.count ?? 0
  const windowDays = data?.windowDays ?? days
  const capped = data?.capped ?? false

  return (
    <section>
      <h1 className="page-title">Exclusion watchlist</h1>
      <p className="muted">
        Exclusions the OIG has added recently and has not lifted. Newest first,
        from the LEIE file recorded with each row.
      </p>

      <div className="card">
        <div className="filter-panel">
          <label className="field">
            <span className="field-label">State</span>
            <select
              className="input"
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <option value="">All states</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Window</span>
            <select
              className="input"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {WINDOWS.map((w) => (
                <option key={w.value} value={w.value}>{w.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && (
        <ErrorBanner
          message={error.message}
          onRetry={refetch}
        />
      )}

      {loading && (
        <div className="table-region" aria-busy="true">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>Type</th><th>State</th><th>Exclusion date</th><th>As of</th>
              </tr>
            </thead>
            <tbody><WatchlistSkeleton /></tbody>
          </table>
        </div>
      )}

      {!loading && !error && results.length === 0 && (
        <EmptyState
          title="No exclusions in this window"
          description="No LEIE exclusions were added in the selected window for this filter. Try a longer window or clear the state filter."
        />
      )}

      {!loading && !error && results.length > 0 && (
        <div className="table-region">
          <p className="results-count">
            {count} exclusion{count === 1 ? '' : 's'} in the last{' '}
            {windowDays} days
            {capped ? ' (capped at 500)' : ''}
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>Type</th><th>State</th><th>Exclusion date</th><th>As of</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row, i) => (
                <tr key={`${row.npi || row.name}-${row.exclusionDate}-${i}`}>
                  <td>
                    {row.name || '—'}
                    {row.npi && <div className="provenance mono">NPI {row.npi}</div>}
                  </td>
                  <td>
                    {row.entityType === 'ORGANIZATION' ? 'Organization' : 'Individual'}
                    {row.exclusionType && (
                      <div className="provenance">{row.exclusionType}</div>
                    )}
                  </td>
                  <td>
                    {row.state || '—'}
                    {row.city && <div className="provenance">{row.city}</div>}
                  </td>
                  <td>{row.exclusionDate || '—'}</td>
                  {/* Provenance travels with the row: which file, which vintage. */}
                  <td className="muted">
                    {row.asOf || '—'}
                    {row.source && <div className="provenance">{row.source}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
