import LoadingSpinner from './LoadingSpinner.jsx'
import ErrorBanner from './ErrorBanner.jsx'

export default function ProviderProfileCard({ provider, loading, error }) {
  if (loading) {
    return (
      <div className="card">
        <LoadingSpinner label="Loading provider" />
      </div>
    )
  }

  if (error) {
    if (error.status === 404) {
      return (
        <div className="card">
          <p className="muted">Provider not found.</p>
        </div>
      )
    }
    return <ErrorBanner message={error.message} />
  }

  if (!provider) return null

  const name =
    [provider.name?.first, provider.name?.middle, provider.name?.last]
      .filter(Boolean)
      .join(' ') || provider.name?.full || 'Not available'
  const addr = provider.address || {}

  return (
    <div className="card">
      <h2 className="card-title">{name}</h2>
      <dl className="detail-list">
        <div>
          <dt>NPI</dt>
          <dd className="numeric">{provider.npi || 'Not available'}</dd>
        </div>
        <div>
          <dt>Taxonomy</dt>
          <dd>
            {provider.taxonomy?.description || 'Not available'}
            {provider.taxonomy?.code ? ` (${provider.taxonomy.code})` : ''}
          </dd>
        </div>
        <div>
          <dt>Practice address</dt>
          <dd>
            {[addr.line1, addr.line2].filter(Boolean).join(', ') || 'Not available'}
            <br />
            {[addr.city, addr.state, addr.zipcode].filter(Boolean).join(', ') ||
              'Not available'}
          </dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd className="numeric">{addr.phone || 'Not available'}</dd>
        </div>
        <div>
          <dt>Enumeration type</dt>
          <dd>{provider.enumerationType || 'Not available'}</dd>
        </div>
      </dl>
    </div>
  )
}
