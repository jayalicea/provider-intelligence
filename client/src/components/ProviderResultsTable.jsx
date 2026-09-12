import { Link } from 'react-router-dom'
import LoadingSpinner from './LoadingSpinner.jsx'
import ErrorBanner from './ErrorBanner.jsx'
import EmptyState from './EmptyState.jsx'

function providerName(p) {
  const full = [p.name?.first, p.name?.middle, p.name?.last]
    .filter(Boolean)
    .join(' ')
  return full || p.name?.full || 'Not available'
}

export default function ProviderResultsTable({
  results,
  loading,
  error,
  onRetry,
}) {
  if (loading && !results) {
    return (
      <div className="table-region">
        <LoadingSpinner size="lg" label="Loading providers" />
      </div>
    )
  }

  if (error) {
    return <ErrorBanner message={error.message} onRetry={onRetry} />
  }

  if (!results || results.length === 0) {
    return (
      <EmptyState
        title="No providers match the current search."
        description="Try broadening filters or entering a name, city, or state."
      />
    )
  }

  return (
    <div className={`table-region ${loading ? 'table-dimmed' : ''}`}>
      <p className="results-count">{results.length} providers found</p>
      <table className="table">
        <thead>
          <tr>
            <th>NPI</th>
            <th>Name</th>
            <th>Taxonomy</th>
            <th>City</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {results.map((p) => (
            <tr key={p.npi}>
              <td className="numeric">
                <Link to={`/providers/${p.npi}`}>{p.npi}</Link>
              </td>
              <td>{providerName(p)}</td>
              <td>{p.taxonomy?.description || 'Not available'}</td>
              <td>{p.address?.city || 'Not available'}</td>
              <td>{p.address?.state || 'Not available'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
