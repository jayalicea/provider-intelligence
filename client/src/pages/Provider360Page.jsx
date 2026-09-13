import { useParams } from 'react-router-dom'
import api from '../api/client.js'
import { useFetch } from '../hooks/useFetch.js'
import VerdictBadge from '../components/VerdictBadge.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorBanner from '../components/ErrorBanner.jsx'

function Provenance({ source, asOf }) {
  if (!source && !asOf) return null
  return (
    <div className="provenance">
      {source}
      {asOf ? `, accessed ${asOf}` : ''}
    </div>
  )
}

const DOB_STATUS_COPY = {
  confirmed: {
    tone: 'success',
    text: 'Date of birth confirmed against the LEIE record.',
  },
  mismatch: {
    tone: 'error',
    text: 'Date of birth disagreed with the LEIE record; treat this match as unverified.',
  },
  not_provided: {
    tone: 'muted',
    text: 'No date of birth supplied, so identity could not be confirmed by DOB.',
  },
  unavailable: {
    tone: 'muted',
    text: 'The LEIE record carries no date of birth to confirm against.',
  },
}

function categoryLabel(field) {
  return field?.value !== null && field?.value !== undefined ? field.value : null
}

// A hit can come from the federal LEIE or a state Medicaid list; label it by
// the registry that produced it rather than assuming LEIE.
function registryLabel(hit) {
  if (!hit) return null
  if (hit.registry === 'STATE') {
    return `${hit.state ? `${hit.state} ` : ''}state Medicaid list${hit.sourceName ? ` (${hit.sourceName})` : ''}`
  }
  return `OIG LEIE (${hit.source})`
}

export default function Provider360Page() {
  const { npi } = useParams()
  const { data, loading, error, refetch } = useFetch(() => api.getVerification(npi), [npi])

  if (loading) {
    return (
      <section aria-busy="true">
        <h1 className="page-title">Provider 360</h1>
        <div className="card">
          <span className="skeleton-line" style={{ width: '40%' }} />
          <span className="skeleton-line" style={{ width: '60%', marginTop: 8 }} />
          <span className="skeleton-line" style={{ width: '50%', marginTop: 8 }} />
        </div>
        <div className="card">
          <span className="skeleton-line" style={{ width: '30%' }} />
          <span className="skeleton-line" style={{ width: '70%', marginTop: 8 }} />
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section>
        <h1 className="page-title">Provider 360</h1>
        <ErrorBanner
          message={
            error.status === 404
              ? 'Provider not found in the local cache'
              : error.message
          }
          onRetry={refetch}
        />
        <EmptyState title="No verification dossier available" />
      </section>
    )
  }

  const { identity, exclusion, performance, terms, flagsSummary } = data
  const dob = exclusion.dobStatus ? DOB_STATUS_COPY[exclusion.dobStatus] : null
  const categories = performance
    ? [
        ['Quality', categoryLabel(performance.qualityScore)],
        ['Improvement Activities', categoryLabel(performance.improvementActivitiesScore)],
        ['Promoting Interoperability', categoryLabel(performance.promotingInteroperabilityScore)],
        ['Cost', categoryLabel(performance.costScore)],
      ]
    : []

  return (
    <section>
      <h1 className="page-title">Provider 360</h1>

      <div className="dossier">
        <aside className="dossier-rail">
          <div className="identity-card">
            <div className="identity-head">
              <h2 className="passport-name">{identity.name.full.value}</h2>
              <p className="passport-sub mono">NPI {identity.npi.value}</p>
              <Provenance
                source={identity.npi.source}
                asOf={identity.npi.asOf}
              />
            </div>
            <div className="identity-verdict">
              <VerdictBadge verdict={exclusion.verdict} size="lg" />
              <div className="provenance">Flags summary: {flagsSummary}</div>
            </div>
            <div className="identity-body">
              <dl className="detail-list">
                <div>
                  <dt>Taxonomy</dt>
                  <dd>
                    {identity.taxonomy.description.value || (
                      <span className="muted">Not reported</span>
                    )}
                    {identity.taxonomy.code.value && (
                      <div className="provenance mono">{identity.taxonomy.code.value}</div>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Practice address</dt>
                  <dd>
                    {[identity.address.line1.value, identity.address.city.value, identity.address.state.value, identity.address.zipcode.value]
                      .filter(Boolean)
                      .join(', ') || <span className="muted">Not reported</span>}
                  </dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>
                    {identity.address.phone.value || (
                      <span className="muted">Not reported</span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </aside>

        <div className="dossier-main">
        <section className="passport-section">
          <h3 className="card-title">Integrity</h3>
          <dl className="detail-list">
            <div>
              <dt>Exclusion verdict</dt>
              <dd>
                <VerdictBadge verdict={exclusion.verdict} />
                {exclusion.match && (
                  <span className="muted"> matched by {exclusion.match.replace('_', ' ')}</span>
                )}
              </dd>
              {exclusion.exclusion && (
                <Provenance
                  source={registryLabel(exclusion.exclusion)}
                  asOf={exclusion.exclusion.asOf}
                />
              )}
            </div>
            {dob && (
              <div>
                <dt>Date of birth confirmation</dt>
                <dd className={dob.tone === 'error' ? 'dob-mismatch' : undefined}>
                  {dob.text}
                </dd>
              </div>
            )}
            {!exclusion.dobStatus && exclusion.match === 'npi' && (
              <div>
                <dt>Date of birth confirmation</dt>
                <dd>Not applicable — the NPI match is definitive, no DOB check required.</dd>
              </div>
            )}
            {exclusion.exclusion && (
              <div>
                <dt>Exclusion details</dt>
                <dd>
                  Type {exclusion.exclusion.type}, effective {exclusion.exclusion.date}
                </dd>
                <Provenance
                  source={registryLabel(exclusion.exclusion)}
                  asOf={exclusion.exclusion.asOf}
                />
              </div>
            )}
            {exclusion.stateExclusion && (
              <div>
                <dt>State exclusion list</dt>
                <dd>
                  <span className="badge badge-error">STATE HIT</span>
                  {' '}
                  {exclusion.stateExclusion.state} —{' '}
                  {exclusion.stateExclusion.type || 'exclusion'}
                  {exclusion.stateExclusion.date
                    ? `, effective ${exclusion.stateExclusion.date}`
                    : ''}
                </dd>
                <Provenance
                  source={registryLabel(exclusion.stateExclusion)}
                  asOf={exclusion.stateExclusion.asOf}
                />
              </div>
            )}
            {exclusion.reinstated && (
              <div>
                <dt>Reinstatement</dt>
                <dd>
                  Prior exclusion, reinstated {exclusion.reinstated.date}. Treated
                  as clear as of that date.
                </dd>
                <Provenance
                  source={registryLabel(exclusion.reinstated)}
                  asOf={exclusion.reinstated.asOf}
                />
              </div>
            )}
          </dl>
          {exclusion.notes?.length > 0 && (
            <ul className="passport-notes muted">
              {exclusion.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </section>

        {performance && (
          <section className="passport-section">
            <h3 className="card-title">MIPS performance</h3>
            <div className="final-score">
              <span className="final-score-value numeric">
                {performance.finalScore.value ?? '—'}
              </span>
              <span className="muted">
                Final score{performance.performanceYear.value ? `, ${performance.performanceYear.value}` : ''}
              </span>
            </div>
            <Provenance
              source={performance.finalScore.source}
              asOf={performance.finalScore.asOf}
            />
            <ul className="score-bars">
              {categories.map(([label, value]) => (
                <li key={label}>
                  <span>{label}</span>
                  <span className="score-track">
                    {value !== null && (
                      <span
                        className="score-fill"
                        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                      />
                    )}
                  </span>
                  <span className="numeric">
                    {value !== null ? value : <span className="score-null">Not reported</span>}
                  </span>
                </li>
              ))}
            </ul>
            <Provenance
              source={performance.qualityScore.source}
              asOf={performance.qualityScore.asOf}
            />
          </section>
        )}

        </div>
      </div>

      <footer className="passport-terms muted">{terms}</footer>
    </section>
  )
}
