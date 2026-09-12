import NationalComparisonBadge, { footnoteLabel } from './NationalComparisonBadge.jsx'
import LoadingSpinner from './LoadingSpinner.jsx'
import ErrorBanner from './ErrorBanner.jsx'
import EmptyState from './EmptyState.jsx'

function formatPeriod(startDate, endDate) {
  const fmt = (iso) => {
    if (!iso) return null
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  }
  const s = fmt(startDate)
  const e = fmt(endDate)
  if (s && e) return `${s} – ${e}`
  return s || e || 'Not available'
}

function isHcahpsRow(measure) {
  return (
    !measure.comparedToNational &&
    (measure.measureId || '').startsWith('H_')
  )
}

export default function QualityMeasuresTable({ measures, loading, error, onRetry }) {
  if (loading) {
    return (
      <div className="table-region">
        <LoadingSpinner size="lg" label="Loading quality measures" />
      </div>
    )
  }

  if (error) {
    return <ErrorBanner message={error.message} onRetry={onRetry} />
  }

  if (!measures || measures.length === 0) {
    return (
      <EmptyState title="No quality measures reported for this facility." />
    )
  }

  // HCAHPS rows carry no national comparison; list them last so their
  // neutral badges render consistently as a group.
  const sorted = [...measures].sort((a, b) =>
    Number(isHcahpsRow(a)) - Number(isHcahpsRow(b))
  )

  return (
    <div className="table-region">
      <table className="table">
        <thead>
          <tr>
            <th>Measure ID</th>
            <th>Measure Name</th>
            <th>Score</th>
            <th>National Comparison</th>
            <th>Footnote</th>
            <th>Period</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => {
            const footnote = footnoteLabel(m.footnote)
            return (
              <tr key={`${m.measureId}-${m.startDate || ''}`}>
                <td className="numeric">{m.measureId || 'Not available'}</td>
                <td>{m.measureName || 'Not available'}</td>
                <td className="numeric">
                  {m.score === null || m.score === undefined ? 'Not available' : m.score}
                </td>
                <td>
                  <NationalComparisonBadge comparedToNational={m.comparedToNational} />
                </td>
                <td>
                  {m.footnote
                    ? `${m.footnote} — ${footnote}`
                    : '—'}
                </td>
                <td className="numeric">{formatPeriod(m.startDate, m.endDate)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
