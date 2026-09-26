import { useParams } from 'react-router-dom'
import api from '../api/client.js'
import { useFetch } from '../hooks/useFetch.js'
import CliaText from '../components/CliaText.jsx'
import NpiText from '../components/NpiText.jsx'
import ErrorBanner from '../components/ErrorBanner.jsx'
import { certTypeLabel } from '../lib/clia.js'

export default function LabDetailPage() {
  const { cliaNumber } = useParams()
  const { data: lab, loading, error, refetch } = useFetch(() => api.getLab(cliaNumber), [cliaNumber])

  if (error) {
    return (
      <section>
        <h1 className="page-title">Laboratory</h1>
        {error.status === 404 ? (
          <div className="card">
            <p className="muted">Laboratory not found.</p>
          </div>
        ) : (
          <ErrorBanner message={error.message} onRetry={refetch} />
        )}
      </section>
    )
  }

  if (loading || !lab) {
    return (
      <section>
        <h1 className="page-title">Laboratory</h1>
        <div className="card" aria-busy="true">
          <span className="skeleton-line" style={{ width: '40%' }} />
          <div style={{ marginTop: 12 }}>
            <span className="skeleton-line" style={{ width: '70%' }} />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section>
      <h1 className="page-title">{lab.labName}</h1>
      <div className="card">
        <dl className="detail-list">
          <div>
            <dt>CLIA number</dt>
            <dd>
              <CliaText cliaNumber={lab.cliaNumber} />
            </dd>
          </div>
          {lab.additionalLabName ? (
            <div>
              <dt>Also known as</dt>
              <dd>{lab.additionalLabName}</dd>
            </div>
          ) : null}
          <div>
            <dt>Certificate</dt>
            <dd>
              {certTypeLabel(lab.certificateTypeCd)}
              {lab.certificateEffectiveDate
                ? ` (effective ${String(lab.certificateEffectiveDate).slice(0, 10)})`
                : ''}
            </dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>
              {lab.address || 'Not available'}
              <br />
              {[lab.city, lab.state, lab.zip].filter(Boolean).join(', ') || 'Not available'}
            </dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd className="numeric">{lab.phone || 'Not available'}</dd>
          </div>
          {lab.medicareNumber ? (
            <div>
              <dt>Medicare number</dt>
              <dd className="mono">{lab.medicareNumber}</dd>
            </div>
          ) : null}
          {lab.npi ? (
            <div>
              <dt>Organization NPI</dt>
              <dd>
                <NpiText npi={lab.npi} />
                <span className="muted"> matched by legal name, city, and state</span>
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Registry status</dt>
            <dd>
              {lab.currentlyRegistered
                ? `Registered (confirmed ${String(lab.lastConfirmedAt).slice(0, 10)})`
                : `Not on the current vintage (last confirmed ${String(lab.lastConfirmedAt).slice(0, 10)})`}
              {lab.firstSeenAt ? ` · first seen ${String(lab.firstSeenAt).slice(0, 10)}` : ''}
            </dd>
          </div>
        </dl>
        <p className="provenance">
          CMS Provider of Services Clinical Laboratories ({lab.dataSource || 'unknown vintage'})
        </p>
      </div>
    </section>
  )
}
