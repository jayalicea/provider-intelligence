import NationalComparisonBadge from './NationalComparisonBadge.jsx'
import ErrorBanner from './ErrorBanner.jsx'
import EmptyState from './EmptyState.jsx'

// DESIGN.md: loading renders skeleton rows (3 per table), never spinners on
// data surfaces.
function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} className="skeleton-row" aria-hidden="true">
          <td colSpan={4}>
            <span className="skeleton-line" style={{ width: `${85 - i * 15}%` }} />
          </td>
        </tr>
      ))}
    </>
  )
}

function formatAsOf(endDate) {
  if (!endDate) return 'Not available'
  const d = new Date(endDate)
  if (Number.isNaN(d.getTime())) return String(endDate)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function isHcahpsRow(measure) {
  return (
    !measure.comparedToNational &&
    (measure.measureId || '').startsWith('H_')
  )
}

export default function QualityMeasuresTable({ measures, loading, error, onRetry }) {
  if (error) {
    return <ErrorBanner message={error.message} onRetry={onRetry} />
  }

  if (!loading && (!measures || measures.length === 0)) {
    return (
      <EmptyState title="No quality measures reported for this facility." />
    )
  }

  // HCAHPS rows carry no national comparison; list them last so their
  // neutral badges render consistently as a group.
  const sorted = [...(measures || [])].sort((a, b) =>
    Number(isHcahpsRow(a)) - Number(isHcahpsRow(b))
  )

  return (
    <div className={`table-region ${loading ? 'table-dimmed' : ''}`}>
      <table className="table">
        <thead>
          <tr>
            <th>Measure</th>
            <th className="num">Score</th>
            <th>National comparison</th>
            <th>As of</th>
          </tr>
        </thead>
        <tbody>
          {loading && <SkeletonRows />}
          {!loading &&
            sorted.map((m) => {
              const reported = m.score !== null && m.score !== undefined
              return (
                <tr key={`${m.measureId}-${m.startDate || ''}`}>
                  <td>
                    {m.measureName || m.measureId || 'Not available'}
                    <div className="provenance mono">{m.measureId}</div>
                  </td>
                  <td className="num">
                    {reported ? (
                      m.score
                    ) : (
                      <span className="score-null">Not reported</span>
                    )}
                  </td>
                  <td>
                    <NationalComparisonBadge comparedToNational={m.comparedToNational} />
                  </td>
                  <td className="mono">{formatAsOf(m.endDate)}</td>
                </tr>
              )
            })}
        </tbody>
      </table>
      <p className="results-count">
        {loading
          ? 'Loading measures…'
          : `${sorted.length} measures · CMS Care Compare`}
      </p>
    </div>
  )
}
