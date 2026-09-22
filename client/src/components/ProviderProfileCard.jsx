import ErrorBanner from './ErrorBanner.jsx'
import NpiText from './NpiText.jsx'

export default function ProviderProfileCard({ provider, loading, error }) {
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

  if (loading || !provider) {
    return (
      <div className="card" aria-busy="true">
        <span className="skeleton-line" style={{ width: '40%' }} />
        <div style={{ marginTop: 12 }}>
          <span className="skeleton-line" style={{ width: '70%' }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <span className="skeleton-line" style={{ width: '55%' }} />
        </div>
      </div>
    )
  }

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
          <dd>
            <NpiText npi={provider.npi} />
          </dd>
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
        {provider.cannabisCertification ? (
          <div>
            <dt>Cannabis certification</dt>
            <dd>
              <span className="badge badge-accent">Cannabis-certified</span>{' '}
              <span className="muted">
                {provider.cannabisCertification.programName} (list as of{' '}
                {String(provider.cannabisCertification.asOf).slice(0, 10)})
              </span>
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="provenance">
        NIH NPI Registry, accessed {new Date().toISOString().slice(0, 10)}
      </p>
    </div>
  )
}
