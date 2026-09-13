import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client.js'
import EmptyState from '../components/EmptyState.jsx'
import ErrorBanner from '../components/ErrorBanner.jsx'

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI',
  'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN',
  'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
]

function IntegrityBadge({ verdict }) {
  if (verdict === 'EXCLUDED') {
    return <span className="badge badge-error">EXCLUDED</span>
  }
  if (verdict === 'CLEAR') {
    return <span className="badge badge-success">CLEAR</span>
  }
  return <span className="badge badge-na">UNVERIFIED</span>
}

function CohortSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr className="skeleton-row" key={i} aria-hidden="true">
          <td><span className="skeleton-line" /></td>
          <td><span className="skeleton-line" style={{ width: '70%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '80%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '50%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '40%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '40%' }} /></td>
        </tr>
      ))}
    </>
  )
}

export default function CohortExplorerPage() {
  const navigate = useNavigate()
  const [state, setState] = useState('')
  const [taxonomy, setTaxonomy] = useState('')
  const [useMinScore, setUseMinScore] = useState(false)
  const [minScore, setMinScore] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [request, setRequest] = useState({ loading: false, error: null, results: [], count: 0 })

  async function runSearch(filters) {
    setRequest({ loading: true, error: null, results: [], count: 0 })
    try {
      const { results, count } = await api.getCohort(filters)
      setRequest({ loading: false, error: null, results, count })
    } catch (error) {
      setRequest({ loading: false, error, results: [], count: 0 })
    }
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (!/^[A-Za-z]{2}$/.test(state)) return
    const filters = { state: state.toUpperCase() }
    if (taxonomy.trim()) filters.taxonomy = taxonomy.trim()
    if (useMinScore && minScore !== '') filters.minScore = Number(minScore)
    setSubmitted(true)
    runSearch(filters)
  }

  const stateInvalid = state !== '' && !/^[A-Za-z]{2}$/.test(state)

  return (
    <section>
      <h1 className="page-title">Cohort explorer</h1>
      <p className="muted">
        Screen every cached provider in a state against the OIG LEIE, with
        latest MIPS scores where reported.
      </p>

      <form className="card" onSubmit={handleSubmit}>
        <div className="filter-panel">
          <label className="field">
            <span className="field-label">State (required)</span>
            <select
              className="input"
              value={state}
              onChange={(e) => setState(e.target.value)}
              aria-invalid={stateInvalid}
            >
              <option value="">Select a state</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Taxonomy</span>
            <input
              className="input"
              value={taxonomy}
              onChange={(e) => setTaxonomy(e.target.value)}
              placeholder="e.g. Internal Medicine"
            />
          </label>
          <label className="field">
            <span className="field-label">Minimum MIPS score (optional)</span>
            <span className="mips-filter">
              <input
                type="checkbox"
                checked={useMinScore}
                onChange={(e) => setUseMinScore(e.target.checked)}
                aria-label="Enable minimum MIPS score filter"
              />
              <input
                className="input"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
                disabled={!useMinScore}
                placeholder="0–100"
                style={{ width: 100 }}
              />
            </span>
          </label>
        </div>
        {stateInvalid && (
          <p className="dob-mismatch" role="alert">State must be a 2-letter code.</p>
        )}
        <p style={{ marginTop: 12 }}>
          <button type="submit" className="btn btn-primary" disabled={!state || stateInvalid}>
            Run cohort screen
          </button>
        </p>
      </form>

      {request.error && <ErrorBanner message={request.error.message} onRetry={() => handleSubmit({ preventDefault: () => {} })} />}

      {request.loading && (
        <div className="table-region" aria-busy="true">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>NPI</th><th>Taxonomy</th><th>City</th><th>MIPS</th><th>Integrity</th>
              </tr>
            </thead>
            <tbody><CohortSkeleton /></tbody>
          </table>
        </div>
      )}

      {!request.loading && !request.error && submitted && request.results.length === 0 && (
        <EmptyState
          title="No providers in this cohort"
          description="No cached providers matched these filters for the selected state. Try broadening the taxonomy filter or choose another state."
        />
      )}

      {!request.loading && !request.error && request.results.length > 0 && (
        <div className="table-region">
          <p className="results-count">
            {request.count} provider{request.count === 1 ? '' : 's'} (capped at 500 per screen)
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>NPI</th><th>Taxonomy</th><th>City</th><th>MIPS</th><th>Integrity</th>
              </tr>
            </thead>
            <tbody>
              {request.results.map((row) => (
                <tr
                  key={row.npi}
                  className="row-clickable"
                  onClick={() => navigate(`/providers/${row.npi}/360`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/providers/${row.npi}/360`)
                  }}
                  tabIndex={0}
                >
                  <td>{row.name ?? 'Not reported'}</td>
                  <td className="mono">{row.npi}</td>
                  <td>{row.taxonomy ?? <span className="score-null">Not reported</span>}</td>
                  <td>{row.city ?? <span className="score-null">Not reported</span>}</td>
                  <td className="numeric">
                    {row.finalScore !== null
                      ? row.finalScore
                      : <span className="score-null">Not reported</span>}
                  </td>
                  <td><IntegrityBadge verdict={row.exclusion?.verdict ?? 'UNVERIFIED'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!submitted && !request.loading && (
        <EmptyState
          title="Start with a state"
          description="Pick a state and run the screen. Results are drawn from the local cache of public NPI Registry and OIG LEIE data."
        />
      )}
    </section>
  )
}
