import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client.js'
import { useCompare } from '../hooks/useCompare.js'
import { isValidNpi } from '../lib/watchlist.js'
import CompareTrendChart from '../components/CompareTrendChart.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorBanner from '../components/ErrorBanner.jsx'

const START_YEAR = 2018
const END_YEAR = new Date().getFullYear() - 1

function providerName(p) {
  return (
    [p?.name?.first, p?.name?.middle, p?.name?.last].filter(Boolean).join(' ') ||
    p?.name?.full ||
    null
  )
}

// Skeleton rows rather than a spinner, per DESIGN.md section 4.
function CompareSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <tr className="skeleton-row" key={i} aria-hidden="true">
          <td><span className="skeleton-line" /></td>
          <td><span className="skeleton-line" style={{ width: '60%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '40%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '30%' }} /></td>
        </tr>
      ))}
    </>
  )
}

export default function ComparePage() {
  const compare = useCompare()
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState(null)

  // Per-NPI fetches: provider summary + analytics trends. Both settle
  // independently; a failed NPI keeps an explicit row state, never a blank.
  const [entries, setEntries] = useState({})
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(null)

  const npisKey = compare.npis.join(',')
  useEffect(() => {
    const npis = npisKey ? npisKey.split(',') : []
    if (npis.length === 0) return undefined
    let cancelled = false
    Promise.resolve()
      .then(() => {
        if (cancelled) return
        setLoading(true)
        setFetchError(null)
      })
      .then(() =>
        Promise.allSettled(
          npis.map((npi) =>
            Promise.allSettled([
              api.getProvider(npi),
              api.getAnalyticsTrends(npi, START_YEAR, END_YEAR),
            ])
          )
        )
      )
      .then((results) => {
        if (cancelled) return
        const next = {}
        results.forEach((r, i) => {
          if (r.status !== 'fulfilled') return
          const [providerRes, trendsRes] = r.value
          next[npis[i]] = {
            provider: providerRes.status === 'fulfilled' ? providerRes.value : null,
            trends: trendsRes.status === 'fulfilled' ? trendsRes.value : null,
          }
        })
        setEntries(next)
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [npisKey])

  const ordered = useMemo(
    () =>
      compare.npis.map((npi) => ({
        npi,
        provider: entries[npi]?.provider ?? null,
        trends: entries[npi]?.trends ?? null,
      })),
    [compare.npis, entries]
  )

  const years = useMemo(() => {
    const set = new Set()
    for (const e of ordered) {
      for (const row of e.trends?.years ?? []) set.add(row.year)
    }
    return [...set].sort((a, b) => a - b)
  }, [ordered])

  const chartSeries = useMemo(
    () =>
      ordered
        .filter((e) => (e.trends?.years ?? []).length > 0)
        .map((e) => {
          const points = {}
          for (const row of e.trends.years) points[row.year] = row.finalScore
          return {
            npi: e.npi,
            label: providerName(e.provider) || `NPI ${e.npi}`,
            points,
            warning: e.trends?.warning ?? null,
          }
        }),
    [ordered]
  )

  const vintageNpis = chartSeries
    .filter((s) => s.warning)
    .map((s) => s.npi)

  const submitAdd = (event) => {
    event.preventDefault()
    const npi = input.trim()
    setInputError(null)
    if (!isValidNpi(npi)) {
      setInputError('Enter a valid 10-digit NPI number.')
      return
    }
    compare.add(npi)
    setInput('')
  }

  return (
    <section>
      <h1 className="page-title">Compare providers</h1>
      <p className="page-lede muted">
        Put two or three providers side by side on one MIPS score chart. The
        list is saved in this browser, separate from your watchlist.
      </p>

      <div className="card">
        <form className="filter-panel" onSubmit={submitAdd}>
          <label className="field">
            <span className="field-label">NPI to compare</span>
            <input
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="10-digit NPI"
              inputMode="numeric"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
            Add to comparison
          </button>
        </form>
        {(compare.message || inputError) && (
          <p className="notice-banner" role="status">
            {compare.message || inputError}
          </p>
        )}
      </div>

      {compare.npis.length === 0 ? (
        <EmptyState
          title="Nothing to compare yet"
          description="Add one or two NPIs above, or open a provider page and choose Compare. Up to 3 providers can be compared at once."
        />
      ) : (
        <>
          {fetchError && <ErrorBanner message={fetchError.message} />}

          <div className="stack-top">
            <CompareTrendChart series={chartSeries} />
            {vintageNpis.length > 0 && (
              <p className="provenance">
                Note: for NPI {vintageNpis.join(', ')}, performance_year values
                are request labels on a rolling CMS vintage, not distinct
                measurement years. Year-over-year movement may reflect re-based
                scores rather than true performance change.
              </p>
            )}
          </div>

          <div className="table-region stack-top">
            <table className="table">
              <thead>
                <tr>
                  <th>NPI</th>
                  <th>Name</th>
                  <th>Taxonomy</th>
                  {years.map((y) => (
                    <th key={y}>{y}</th>
                  ))}
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {loading && <CompareSkeleton />}
                {!loading &&
                  ordered.map((e) => {
                    const failed = e.provider === null && e.trends === null
                    const byYear = {}
                    for (const row of e.trends?.years ?? []) byYear[row.year] = row.finalScore
                    return (
                      <tr key={e.npi}>
                        <td className="mono">{e.npi}</td>
                        <td>
                          {failed ? (
                            'Could not be loaded'
                          ) : e.provider ? (
                            <Link to={`/providers/${e.npi}`}>
                              {providerName(e.provider) || 'Not available'}
                            </Link>
                          ) : (
                            'Not available'
                          )}
                          {failed && (
                            <div className="provenance">
                              This NPI did not resolve. It may not be in the
                              current cached data.
                            </div>
                          )}
                        </td>
                        <td>
                          {e.provider?.taxonomy?.description || (
                            <span className="score-null">Not reported</span>
                          )}
                        </td>
                        {years.map((y) => (
                          <td key={y}>
                            {byYear[y] === undefined || byYear[y] === null ? (
                              <span className="score-null">Not reported</span>
                            ) : (
                              byYear[y]
                            )}
                          </td>
                        ))}
                        <td>
                          <button
                            type="button"
                            className="btn btn-link"
                            onClick={() => compare.remove(e.npi)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>

          <p className="provenance">
            Scores from the CMS QPP Experience dataset via the ProviderLens
            cache, per performance year. A gray cell means CMS published no
            score for that provider and year; no value is estimated.
          </p>
        </>
      )}
    </section>
  )
}
