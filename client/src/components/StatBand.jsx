import coverage from '../data/coverage.json'

// Real platform figures, read from the committed coverage registry rather than
// retyped here, so the landing page and the Coverage page can never disagree.
// Each stat carries its own as-of on hover, per the DESIGN.md provenance rule.
const nf = new Intl.NumberFormat('en-US')

function compact(n) {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${m >= 10 ? Math.round(m) : m.toFixed(1)}M`
  }
  return nf.format(n)
}

const byId = (id) => coverage.datasets.find((d) => d.id === id)

function asOfTitle(dataset, extra) {
  if (!dataset) return ''
  const vintage = dataset.vintage || (dataset.asOf === 'per value'
    ? 'access date recorded per value'
    : `as of ${dataset.asOf}`)
  return [`${dataset.name} — ${vintage}`, dataset.cadence, extra]
    .filter(Boolean)
    .join('. ')
}

function buildStats() {
  const nppes = byId('nppes')
  const leie = byId('oig-leie')
  const stateLists = byId('state-medicaid-exclusions')
  const quality = byId('cms-care-compare')

  return [
    {
      key: 'providers',
      label: 'Providers indexed',
      value: compact(nppes?.records ?? 0),
      title: asOfTitle(nppes),
    },
    {
      key: 'federal',
      label: 'Federal exclusions',
      value: nf.format(leie?.records ?? 0),
      title: asOfTitle(leie),
    },
    {
      key: 'state',
      label: 'State exclusions',
      value: nf.format(stateLists?.records ?? 0),
      unit: `${stateLists?.jurisdictions ?? 0} jurisdictions`,
      title: asOfTitle(stateLists),
    },
    {
      key: 'quality',
      label: 'Hospitals with quality data',
      value: nf.format(quality?.records ?? 0),
      title: asOfTitle(quality, 'Coverage grows as facilities are requested'),
    },
  ]
}

export default function StatBand() {
  const stats = buildStats()
  return (
    <div className="stat-band">
      {stats.map((stat) => (
        <div className="stat" key={stat.key}>
          <span className="stat-label">{stat.label}</span>
          <span className="stat-value has-tooltip" title={stat.title}>
            {stat.value}
          </span>
          {stat.unit && <span className="provenance">{stat.unit}</span>}
        </div>
      ))}
    </div>
  )
}

// The cadence line the landing page carries under the band.
export function StatBandCaption() {
  return (
    <p className="provenance" style={{ marginTop: 'calc(-1 * var(--space-3))', marginBottom: 'var(--space-5)' }}>
      Federal exclusions and the provider registry are refreshed monthly; state
      lists follow each publisher&apos;s own schedule. Hover any figure for its
      source and vintage.
    </p>
  )
}
