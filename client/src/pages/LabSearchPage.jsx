import { useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import api from '../api/client.js'
import { useFetch } from '../hooks/useFetch.js'
import SearchBar from '../components/SearchBar.jsx'
import CliaText from '../components/CliaText.jsx'
import { certTypeLabel } from '../lib/clia.js'

// Search state lives in the URL so results are shareable.
export default function LabSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const name = searchParams.get('name') || ''
  const state = searchParams.get('state') || ''
  const city = searchParams.get('city') || ''
  const hasCriteria = Boolean(name || state || city)

  const { data, loading, error, refetch } = useFetch(
    () =>
      api.searchLabs({
        name: name || undefined,
        state: state || undefined,
        city: city || undefined,
      }),
    [name, state, city]
  )

  const updateParams = (patch) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setSearchParams(next)
  }

  return (
    <section>
      <h1 className="page-title">Find a laboratory</h1>
      <p className="page-lede muted">
        Search CLIA-registered laboratories by name, state, or city. The CLIA
        number is the lab&rsquo;s canonical identifier &mdash; click it to open
        the lab&rsquo;s detail page, or copy it for claims and requisitions.
      </p>

      <div className="card">
        <SearchBar
          value={name}
          placeholder="Lab name, e.g. Baptist Medical Center"
          onSubmit={(value) => updateParams({ name: value })}
        />
        <p className="stack-top">
          <input
            className="input"
            style={{ width: '7em' }}
            placeholder="State"
            value={state}
            maxLength={2}
            onChange={(e) => updateParams({ state: e.target.value.toUpperCase() })}
          />{' '}
          <input
            className="input"
            style={{ width: '12em' }}
            placeholder="City"
            value={city}
            onChange={(e) => updateParams({ city: e.target.value })}
          />
        </p>
      </div>

      {!hasCriteria && !loading ? (
        <p className="muted">
          Start with a lab name, a state, or a city. Results come from the CMS
          Provider of Services Clinical Laboratories file.
        </p>
      ) : (
        <div className={`table-region stack-top ${loading ? 'table-dimmed' : ''}`}>
          {error && (
            <p className="info-banner" role="alert">
              {error.message}{' '}
              <button type="button" className="btn btn-link" onClick={refetch}>
                Retry
              </button>
            </p>
          )}
          {data && (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>CLIA number</th>
                    <th>Laboratory</th>
                    <th>Location</th>
                    <th>Certificate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((lab) => (
                    <tr key={lab.cliaNumber}>
                      <td>
                        <CliaText cliaNumber={lab.cliaNumber} link />
                      </td>
                      <td>
                        <Link to={`/labs/${lab.cliaNumber}`}>{lab.labName}</Link>
                      </td>
                      <td>
                        {[lab.city, lab.state].filter(Boolean).join(', ') || 'Not available'}
                      </td>
                      <td>{certTypeLabel(lab.certificateTypeCd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="results-count">
                {data.total > data.results.length
                  ? `${data.results.length} of ${data.total} matching laboratories · `
                  : `${data.results.length} laboratories · `}
                CMS POS Clinical Laboratories, vintage {data.results[0]?.lastConfirmedAt?.slice(0, 10) || 'unknown'}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
