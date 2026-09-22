import { Link } from 'react-router-dom'
import ErrorBanner from './ErrorBanner.jsx'
import EmptyState from './EmptyState.jsx'

function providerName(p) {
  const full = [p.name?.first, p.name?.middle, p.name?.last]
    .filter(Boolean)
    .join(' ')
  return full || p.name?.full || 'Not available'
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} className="skeleton-row" aria-hidden="true">
          <td colSpan={5}>
            <span className="skeleton-line" style={{ width: `${85 - i * 15}%` }} />
          </td>
        </tr>
      ))}
    </>
  )
}

export default function ProviderResultsTable({
  results,
  total,
  loading,
  error,
  onRetry,
}) {
  if (error) {
    return <ErrorBanner message={error.message} onRetry={onRetry} />
  }

  if (!loading && (!results || results.length === 0)) {
    return (
      <EmptyState
        title="No providers matched."
        description="The NPI Registry only lists active registrations; try broadening the state filter."
      />
    )
  }

  return (
    <div className={`table-region ${loading ? 'table-dimmed' : ''}`}>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>NPI</th>
            <th>Taxonomy</th>
            <th>Location</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading && <SkeletonRows />}
          {!loading &&
            results.map((p) => (
              <tr key={p.npi}>
                <td>
                  <Link to={`/providers/${p.npi}`}>{providerName(p)}</Link>
                </td>
                <td className="mono">{p.npi}</td>
                <td>{p.taxonomy?.description || 'Not available'}</td>
                <td>
                  {[p.address?.city, p.address?.state]
                    .filter(Boolean)
                    .join(', ') || 'Not available'}
                </td>
                <td>
                  {p.cannabisCertified ? (
                    <span className="badge badge-accent">Cannabis-certified</span>
                  ) : null}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      <p className="results-count">
        {loading
          ? 'Searching the NPI Registry…'
          : total != null && total > results.length
            ? `${results.length} of ${total} matching providers · NIH NPI Registry, accessed ${new Date().toISOString().slice(0, 10)}`
            : `${results.length} providers · NIH NPI Registry, accessed ${new Date().toISOString().slice(0, 10)}`}
      </p>
    </div>
  )
}
