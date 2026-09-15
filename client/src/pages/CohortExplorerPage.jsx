import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client.js'
import EmptyState from '../components/EmptyState.jsx'
import ErrorBanner from '../components/ErrorBanner.jsx'
import VerdictBadge from '../components/VerdictBadge.jsx'

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI',
  'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN',
  'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
]

function CohortSkeleton({ columns = 6 }) {
  const widths = ['70%', '80%', '50%', '40%', '40%', '40%']
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr className="skeleton-row" key={i} aria-hidden="true">
          <td><span className="skeleton-line" /></td>
          {Array.from({ length: columns - 1 }, (_, j) => (
            <td key={j}>
              <span className="skeleton-line" style={{ width: widths[j % widths.length] }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

function ScreeningCell({ row, onScreen, screenState }) {
  const { loading, error } = screenState ?? {}
  const hit = row.exclusion?.exclusion
  const title = hit ? `${hit.registry ?? 'registry'} as of ${hit.asOf ?? 'unknown date'}` : undefined

  let badge
  if (row.verdict === 'EXCLUDED') {
    badge = <span title={title}><VerdictBadge verdict="EXCLUDED" /></span>
  } else if (row.verdict === 'CLEAR') {
    badge = <VerdictBadge verdict="CLEAR" />
  } else {
    badge = <span className="badge badge-na badge-plain">Unscreened</span>
  }

  return (
    <span className="screen-cell" onClick={(e) => e.stopPropagation()}>
      {badge}{' '}
      {row.enrichable ? (
        <button
          type="button"
          className="btn btn-link"
          disabled={loading}
          onClick={() => onScreen(row.npi)}
          title={error || undefined}
        >
          {loading ? 'Screening…' : error ? 'Screen failed' : 'Screen'}
        </button>
      ) : null}
    </span>
  )
}

export default function CohortExplorerPage() {
  const navigate = useNavigate()
  const [source, setSource] = useState('cached')
  const [state, setState] = useState('')
  const [taxonomy, setTaxonomy] = useState('')
  const [name, setName] = useState('')
  const [useMinScore, setUseMinScore] = useState(false)
  const [minScore, setMinScore] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [request, setRequest] = useState({ loading: false, error: null, results: [], count: 0 })
  const [screening, setScreening] = useState({})

  const national = source === 'national'

  function switchSource(next) {
    if (next === source) return
    setSource(next)
    setSubmitted(false)
    setRequest({ loading: false, error: null, results: [], count: 0 })
    setScreening({})
  }

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
    const filters = { state: state.toUpperCase(), source }
    if (taxonomy.trim()) filters.taxonomy = taxonomy.trim()
    if (national) {
      if (name.trim()) filters.name = name.trim()
    } else if (useMinScore && minScore !== '') {
      filters.minScore = Number(minScore)
    }
    setSubmitted(true)
    runSearch(filters)
  }

  async function screenRow(npi) {
    setScreening((prev) => ({ ...prev, [npi]: { loading: true, error: null } }))
    try {
      const verification = await api.getVerification(npi)
      setRequest((prev) => ({
        ...prev,
        results: prev.results.map((row) => {
          if (row.npi !== npi) return row
          return {
            ...row,
            verdict: verification.exclusion?.verdict ?? 'UNVERIFIED',
            exclusion: verification.exclusion ?? row.exclusion,
            finalScore: verification.performance?.finalScore ?? row.finalScore,
            enrichable: false,
          }
        }),
      }))
      setScreening((prev) => ({ ...prev, [npi]: { loading: false, error: null } }))
    } catch (error) {
      setScreening((prev) => ({ ...prev, [npi]: { loading: false, error } }))
    }
  }

  const stateInvalid = state !== '' && !/^[A-Za-z]{2}$/.test(state)

  const emptyCopy = national
    ? {
        title: 'No providers matched',
        description:
          'No providers matched. The national registry covers active NPPES registrations — try broadening the state filter or shortening the taxonomy prefix.',
      }
    : {
        title: 'No providers in this cohort',
        description:
          'No cached providers matched these filters for the selected state. Try broadening the taxonomy filter or choose another state.',
      }

  return (
    <section>
      <h1 className="page-title">Cohort explorer</h1>
      <p className="muted">
        {national
          ? 'Query the national NPI Registry directly, then screen rows against the OIG LEIE on demand.'
          : 'Screen every cached provider in a state against the OIG LEIE, with latest MIPS scores where reported.'}
      </p>

      <form className="card" onSubmit={handleSubmit}>
        <div className="filter-panel">
          <div className="field">
            <span className="field-label" id="source-label">Source</span>
            <div className="source-toggle" role="group" aria-labelledby="source-label">
              <button
                type="button"
                className={`source-toggle-option${!national ? ' is-active' : ''}`}
                aria-pressed={!national}
                onClick={() => switchSource('cached')}
              >
                Cached
              </button>
              <button
                type="button"
                className={`source-toggle-option${national ? ' is-active' : ''}`}
                aria-pressed={national}
                onClick={() => switchSource('national')}
              >
                National
              </button>
            </div>
          </div>
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
            <span className="field-label">
              {national ? 'Taxonomy code prefix' : 'Taxonomy'}
            </span>
            <input
              className="input"
              value={taxonomy}
              onChange={(e) => setTaxonomy(e.target.value)}
              placeholder={national ? 'e.g. 207' : 'e.g. Internal Medicine'}
            />
            {national && (
              <span className="field-hint">207 matches 207RC0005X</span>
            )}
          </label>
          {national && (
            <label className="field">
              <span className="field-label">Name terms (optional)</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Smith Jane"
              />
            </label>
          )}
          {!national && (
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
          )}
        </div>
        {stateInvalid && (
          <p className="dob-mismatch" role="alert">State must be a 2-letter code.</p>
        )}
        <p style={{ marginTop: 12 }}>
          <button type="submit" className="btn btn-primary" disabled={!state || stateInvalid}>
            {national ? 'Search national registry' : 'Run cohort screen'}
          </button>
        </p>
      </form>

      {request.error && <ErrorBanner message={request.error.message} onRetry={() => handleSubmit({ preventDefault: () => {} })} />}

      {request.loading && (
        <div className="table-region" aria-busy="true">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>NPI</th><th>Taxonomy</th><th>City</th><th className="num">MIPS</th>
                {national && <th>Screening</th>}<th>Integrity</th>
              </tr>
            </thead>
            <tbody><CohortSkeleton columns={national ? 7 : 6} /></tbody>
          </table>
        </div>
      )}

      {!request.loading && !request.error && submitted && request.results.length === 0 && (
        <EmptyState title={emptyCopy.title} description={emptyCopy.description} />
      )}

      {!request.loading && !request.error && request.results.length > 0 && (
        <div className="table-region">
          <p className="results-count">
            {request.count} provider{request.count === 1 ? '' : 's'}
            {national && request.count === 500
              ? ' (capped at 500 — narrow the filters to see fewer)'
              : national
                ? ' (capped at 500 per search)'
                : ' (capped at 500 per screen)'}
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>NPI</th><th>Taxonomy</th><th>City</th><th className="num">MIPS</th>
                {national && <th>Screening</th>}<th>Integrity</th>
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
                  <td className="num">
                    {row.finalScore !== null
                      ? row.finalScore
                      : <span className="score-null">Not reported</span>}
                  </td>
                  {national && (
                    <td>
                      <ScreeningCell
                        row={row}
                        onScreen={screenRow}
                        screenState={screening[row.npi]}
                      />
                    </td>
                  )}
                  <td><VerdictBadge verdict={row.exclusion?.verdict ?? 'UNVERIFIED'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!submitted && !request.loading && (
        <EmptyState
          title="Start with a state"
          description={
            national
              ? 'Pick a state and search the national NPI Registry. Screening verdicts are added per row on demand.'
              : 'Pick a state and run the screen. Results are drawn from the local cache of public NPI Registry and OIG LEIE data.'
          }
        />
      )}
    </section>
  )
}
