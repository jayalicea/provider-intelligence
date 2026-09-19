import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import api from '../api/client.js'
import EmptyState from '../components/EmptyState.jsx'
import ErrorBanner from '../components/ErrorBanner.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'

// Archived QPP vintages the backend holds (see docs/V2_ROADMAP.md Phase A0).
const ARCHIVE_YEARS = [2018, 2019, 2020, 2022, 2023, 2024]

// Largest cohorts in the materialized taxonomy_percentiles table; a
// datalist convenience only, free text is always allowed.
const SUGGESTIONS = [
  { code: '207Q00000X', label: 'Family Medicine' },
  { code: '207R00000X', label: 'Internal Medicine' },
  { code: '363A00000X', label: 'Nurse Practitioner' },
  { code: '363LF0000X', label: 'Nurse Practitioner, Family' },
]

const DECILE_LABELS = ['d10', 'd20', 'd30', 'd40', 'd50', 'd60', 'd70', 'd80', 'd90']

export default function BenchmarkPage() {
  const [searchParams] = useSearchParams()
  const [taxonomy, setTaxonomy] = useState(searchParams.get('taxonomy') ?? '')
  const [year, setYear] = useState(String(ARCHIVE_YEARS[ARCHIVE_YEARS.length - 1]))
  const [request, setRequest] = useState({ loading: false, error: null, data: null })
  const [submitted, setSubmitted] = useState(false)

  const taxonomyInvalid = taxonomy !== '' && !/^[0-9A-Za-z]{3,10}$/.test(taxonomy)

  async function runFetch(code, py) {
    setRequest({ loading: true, error: null, data: null })
    try {
      const data = await api.getTaxonomyBenchmark(code, Number(py))
      setRequest({ loading: false, error: null, data })
    } catch (error) {
      setRequest({ loading: false, error, data: null })
    }
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (taxonomyInvalid || !taxonomy.trim()) return
    setSubmitted(true)
    runFetch(taxonomy.trim().toUpperCase(), year)
  }

  // Decile ladder as bars of the threshold score. This is a ladder of
  // cut points, not a histogram: every bar is one PERCENTILE_CONT value
  // and no smooth distribution is implied.
  const decileRows = request.data
    ? DECILE_LABELS.map((label) => ({
        decile: label,
        score: request.data.deciles?.[label] ?? null,
      }))
    : []

  // Band table: each decile threshold with the band it closes above the
  // previous threshold (or the cohort minimum, for d10).
  const rangeRows = request.data
    ? DECILE_LABELS.map((label, i) => {
        const value = request.data.deciles?.[label]
        const floor = i === 0 ? request.data.min : request.data.deciles?.[DECILE_LABELS[i - 1]]
        return { label, value, floor }
      })
    : []

  return (
    <section>
      <h1 className="page-title">Peer benchmark by taxonomy</h1>
      <p className="muted">
        How MIPS final scores distributed within one provider taxonomy for an
        archived performance year: deciles, quartiles, and per-state medians.
      </p>

      <form className="card" onSubmit={handleSubmit}>
        <div className="filter-panel">
          <label className="field">
            <span className="field-label">Taxonomy code (required)</span>
            <input
              className="input"
              value={taxonomy}
              onChange={(e) => setTaxonomy(e.target.value)}
              placeholder="e.g. 207Q00000X"
              list="taxonomy-suggestions"
              aria-invalid={taxonomyInvalid}
            />
            <datalist id="taxonomy-suggestions">
              {SUGGESTIONS.map((s) => (
                <option key={s.code} value={s.code}>{s.label}</option>
              ))}
            </datalist>
          </label>
          <label className="field">
            <span className="field-label">Performance year (required)</span>
            <select
              className="input"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              {ARCHIVE_YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <span className="field-hint">Archived CMS vintages only</span>
          </label>
        </div>
        {taxonomyInvalid && (
          <p className="dob-mismatch" role="alert">
            Taxonomy code must be 3-10 letters or digits.
          </p>
        )}
        <p style={{ marginTop: 12 }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!taxonomy.trim() || taxonomyInvalid}
          >
            Run benchmark
          </button>
        </p>
      </form>

      {request.loading && (
        <div className="card chart-card">
          <LoadingSpinner size="lg" label="Loading taxonomy benchmark" />
        </div>
      )}

      {!request.loading && request.error && submitted && (
        request.error.status === 404 ? (
          <EmptyState
            title={`No benchmark data for ${taxonomy.trim().toUpperCase()} in ${year}`}
            description={
              'This taxonomy and performance year pair is not materialized. ' +
              'Only taxonomy-year cohorts with archived MIPS scores are available; ' +
              'check the code and pick one of the archived years.'
            }
          />
        ) : (
          <ErrorBanner
            message={request.error.message}
            onRetry={() => runFetch(taxonomy.trim().toUpperCase(), year)}
          />
        )
      )}

      {!request.loading && !request.error && request.data && (
        <>
          <div className="stat-band" style={{ marginTop: 'var(--space-5)' }}>
            <div className="stat">
              <span className="stat-label">Scored providers</span>
              <span className="stat-value">{request.data.scoredCount?.toLocaleString()}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Mean final score</span>
              <span className="stat-value">{request.data.mean ?? 'Not reported'}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Median (p50)</span>
              <span className="stat-value">{request.data.quartiles?.p50 ?? 'Not reported'}</span>
            </div>
            <div className="stat">
              <span className="stat-label">p25 to p75</span>
              <span className="stat-value">
                {request.data.quartiles?.p25 ?? '—'} to {request.data.quartiles?.p75 ?? '—'}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Min to max</span>
              <span className="stat-value">
                {request.data.min ?? '—'} to {request.data.max ?? '—'}
              </span>
            </div>
          </div>

          <div className="card chart-card stack-top">
            <h2 className="card-title">Decile ladder</h2>
            <p className="muted">
              The final-score threshold at each decile of the{' '}
              {request.data.scoredCount?.toLocaleString()} scored{' '}
              {request.data.taxonomy} providers in {request.data.performance_year}.
              Each bar is one computed threshold, not a binned count.
            </p>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={decileRows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="decile" tick={{ fontSize: 12 }} />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 12 }}
                  label={{ value: 'Final score threshold', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip />
                {request.data.mean !== null && request.data.mean !== undefined && (
                  <ReferenceLine
                    y={request.data.mean}
                    stroke="#52606D"
                    strokeDasharray="6 4"
                    label="Mean"
                  />
                )}
                <Bar dataKey="score" name="Decile threshold" fill="#0F6B5C" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="table-region stack-top">
            <table className="table">
              <thead>
                <tr>
                  <th>Decile</th>
                  <th className="num">Final score at or below</th>
                  <th className="num">Band above previous threshold</th>
                </tr>
              </thead>
              <tbody>
                {rangeRows.map((row) => (
                  <tr key={row.label}>
                    <td className="mono">{row.label}</td>
                    <td className="num">{row.value ?? 'Not reported'}</td>
                    <td className="num">
                      {row.floor !== null && row.floor !== undefined && row.value !== null && row.value !== undefined
                        ? `${row.floor} to ${row.value}`
                        : 'Not reported'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {request.data.states?.length > 0 && (
            <div className="table-region stack-top">
              <h2 className="card-title">State breakdown</h2>
              <p className="muted">
                Top {Math.min(10, request.data.states.length)} of{' '}
                {request.data.states.length} states/territories by scored
                provider count.
              </p>
              <table className="table">
                <thead>
                  <tr>
                    <th>State</th>
                    <th className="num">Scored providers</th>
                    <th className="num">Median final score</th>
                  </tr>
                </thead>
                <tbody>
                  {request.data.states.slice(0, 10).map((row) => (
                    <tr key={row.state}>
                      <td className="mono">{row.state}</td>
                      <td className="num">{row.scoredCount.toLocaleString()}</td>
                      <td className="num">{row.median ?? 'Not reported'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="muted chart-note">
            Source: {request.data.provenance?.source}
            {request.data.provenance?.as_of ? `, as of ${request.data.provenance.as_of}` : ''}.
            Deciles and state medians are computed at read time over archived
            MIPS scores (PERCENTILE_CONT, linear interpolation); quartiles,
            mean, min, and max come from the materialized aggregate.
          </p>
        </>
      )}

      {!submitted && !request.loading && (
        <EmptyState
          title="Start with a taxonomy code"
          description="Enter an NPPES taxonomy code and an archived performance year to see the peer distribution."
        />
      )}

      <p className="muted stack-top">
        Looking for one provider&apos;s rank instead?{' '}
        <Link to="/providers">Search for a provider</Link> and open their MIPS
        dashboard.
      </p>
    </section>
  )
}
