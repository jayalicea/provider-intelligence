import LoadingSpinner from './LoadingSpinner.jsx'
import ErrorBanner from './ErrorBanner.jsx'
import EmptyState from './EmptyState.jsx'

export default function MipsSummaryCard({ performance, loading, error }) {
  if (loading) {
    return (
      <div className="card">
        <LoadingSpinner label="Loading MIPS performance" />
      </div>
    )
  }

  if (error) {
    if (error.status === 404) {
      return (
        <div className="card">
          <EmptyState title="No MIPS performance data available for this provider." />
        </div>
      )
    }
    return (
      <div className="card">
        <ErrorBanner message={error.message} />
      </div>
    )
  }

  const hasData =
    performance &&
    [performance.finalScore, performance.qualityScore,
     performance.improvementActivitiesScore,
     performance.promotingInteroperabilityScore, performance.costScore]
      .some((v) => v !== null && v !== undefined)

  if (!hasData) {
    return (
      <div className="card">
        <EmptyState title="No MIPS performance data available for this provider." />
      </div>
    )
  }

  const rows = [
    ['Quality', performance.qualityScore],
    ['Promoting Interoperability', performance.promotingInteroperabilityScore],
    ['Improvement Activities', performance.improvementActivitiesScore],
    ['Cost', performance.costScore],
  ]

  return (
    <div className="card">
      <h2 className="card-title">
        MIPS Performance {performance.performanceYear ? `(${performance.performanceYear})` : ''}
      </h2>
      <div className="final-score">
        <span className="final-score-value numeric">{performance.finalScore ?? '—'}</span>
        <span className="muted">Final score</span>
      </div>
      {performance.performanceStatus && (
        <p className="muted">Status: {performance.performanceStatus}</p>
      )}
      <ul className="score-bars">
        {rows.map(([label, value]) => (
          <li key={label}>
            <span className="score-label">{label}</span>
            <span className="score-track">
              <span
                className="score-fill"
                style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
              />
            </span>
            <span className="numeric">{value ?? '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
