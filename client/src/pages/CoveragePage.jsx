import coverage from '../data/coverage.json'

// Committed registry, not a live query: every figure is stated as of the
// vintage it was measured at, per DESIGN.md section 3.
const nf = new Intl.NumberFormat('en-US')

function AsOf({ value, children }) {
  if (!value && !children) return null
  return (
    <div className="provenance">
      {children}
      {value ? (value === 'per value' ? 'As of: per value' : `As of ${value}`) : null}
    </div>
  )
}

function DatasetRow({ dataset }) {
  return (
    <tr>
      <td>
        {dataset.name}
        <div className="provenance">{dataset.publisher}</div>
      </td>
      <td>
        {dataset.scope}
        {dataset.vintage && <div className="provenance">{dataset.vintage}</div>}
      </td>
      <td className="num">
        {nf.format(dataset.records)}
        <div className="provenance">{dataset.recordLabel}</div>
      </td>
      <td>
        {dataset.asOf === 'per value' ? 'Per value' : dataset.asOf}
        <div className="provenance">{dataset.cadence}</div>
      </td>
      <td>
        {dataset.sourceUrl ? (
          <a href={dataset.sourceUrl} target="_blank" rel="noreferrer noopener">
            Source
          </a>
        ) : '—'}
        <div className="provenance">{dataset.provenance}</div>
      </td>
    </tr>
  )
}

export default function CoveragePage() {
  const { datasets, jurisdictions, generatedAt } = coverage
  const ingested = jurisdictions.filter((j) => j.records > 0)

  return (
    <section>
      <h1 className="page-title">Coverage</h1>
      <p className="muted">
        What this platform holds, where each dataset came from, and the vintage
        of every figure. Counts are measured at load time, not estimated.
      </p>
      <AsOf>Registry compiled {generatedAt}. </AsOf>

      <h2 className="card-title">Datasets</h2>
      <div className="table-region">
        <table className="table">
          <thead>
            <tr>
              <th>Dataset</th>
              <th>Scope</th>
              <th className="num">Records</th>
              <th>As of</th>
              <th>Provenance</th>
            </tr>
          </thead>
          <tbody>
            {datasets.map((d) => <DatasetRow dataset={d} key={d.id} />)}
          </tbody>
        </table>
      </div>

      {datasets.some((d) => d.notes?.length > 0) && (
        <div className="card">
          <h3 className="card-title">Notes</h3>
          <ul className="passport-notes muted">
            {datasets.flatMap((d) =>
              (d.notes ?? []).map((note, i) => (
                <li key={`${d.id}-${i}`}>
                  <strong>{d.name}:</strong> {note}
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      <h2 className="card-title">State exclusion jurisdictions</h2>
      {jurisdictions.length === 0 ? (
        <div className="card">
          <p className="muted">
            The jurisdiction table is not populated in this checkout. It is
            generated rather than written by hand, because the per-state status
            and official source URL come from the state exclusion survey and the
            record counts come from the loaded <span className="mono">state_exclusions</span>{' '}
            table — neither of which is committed.
          </p>
          <p className="provenance">
            Generate it with: node tools/coverage-jurisdictions.js
          </p>
        </div>
      ) : (
        <div className="table-region">
          <p className="results-count">
            {ingested.length} of {jurisdictions.length} jurisdictions ingested
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Jurisdiction</th>
                <th>Status</th>
                <th className="num">Records</th>
                <th>Official source</th>
                <th>As of</th>
              </tr>
            </thead>
            <tbody>
              {jurisdictions.map((j) => (
                <tr key={j.code}>
                  <td>
                    {j.name}
                    <div className="provenance mono">{j.code}</div>
                  </td>
                  <td>{j.status}</td>
                  <td className="num">{j.records > 0 ? nf.format(j.records) : '—'}</td>
                  <td>
                    {j.sourceUrl ? (
                      <a href={j.sourceUrl} target="_blank" rel="noreferrer noopener">
                        Official list
                      </a>
                    ) : '—'}
                    {j.sourceName && <div className="provenance">{j.sourceName}</div>}
                  </td>
                  <td className="muted">{j.asOf || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
