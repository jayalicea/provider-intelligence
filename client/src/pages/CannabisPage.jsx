import { useSearchParams } from 'react-router-dom'
import api from '../api/client.js'
import { useFetch } from '../hooks/useFetch.js'
import SearchBar from '../components/SearchBar.jsx'
import FilterPanel from '../components/FilterPanel.jsx'
import ProviderResultsTable from '../components/ProviderResultsTable.jsx'

const nf = new Intl.NumberFormat('en-US')

// First visit defaults to Florida so the page shows results immediately; any
// explicit params (even ?state=) are respected so links to WV/future states
// and cleared-state searches behave.
function useCriteria() {
  const [searchParams, setSearchParams] = useSearchParams()
  const hasAnyParams = [...searchParams.keys()].length > 0
  const terms = searchParams.get('query') || ''
  const state = searchParams.get('state') || (hasAnyParams ? '' : 'FL')
  const city = searchParams.get('city') || ''
  const taxonomy = searchParams.get('taxonomy') || ''

  const updateParams = (patch) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setSearchParams(next)
  }

  return { terms, state, city, taxonomy, updateParams }
}

export default function CannabisPage() {
  const { terms, state, city, taxonomy, updateParams } = useCriteria()
  const hasCriteria = Boolean(terms || state || city)

  // Stat cards from the summary endpoint; on failure the row is omitted.
  const { data: summary } = useFetch(() => api.getCannabisSummary(), [])

  const { data, loading, error, refetch } = useFetch(
    () =>
      api.searchProviders({
        terms: terms || undefined,
        state: state || undefined,
        city: city || undefined,
        taxonomy: taxonomy || undefined,
      }),
    [terms, state, city, taxonomy]
  )

  // The cannabis filter is inherent to this page: every row must carry the
  // certification flag, and the upstream total is hidden while filtering,
  // same convention as the MIPS filter on the search page.
  const results = (data?.results ?? []).filter((p) => p.cannabisCertified)

  return (
    <section>
      <h1 className="page-title">Cannabis-Certified Providers</h1>
      <p className="page-lede muted">
        State medical cannabis programs publish lists of physicians certified
        to recommend medical marijuana. This page searches those lists —
        starting with Florida&rsquo;s weekly OMMU Qualified Physician List and
        West Virginia&rsquo;s OMC physicians list.
      </p>

      {summary && summary.length > 0 && (
        <div className="cannabis-stats">
          {summary.map((s) => (
            <div className="card" key={`${s.state}-${s.sourceName}`}>
              <span className="stat-label">
                {s.state} · {s.programName}
              </span>
              <p style={{ margin: '8px 0' }}>
                <span className="badge badge-accent">
                  {nf.format(s.listedCount)} listed physicians
                </span>
              </p>
              <p className="muted" style={{ margin: '0 0 8px' }}>
                {nf.format(s.matchedCount)} linked to provider profiles
              </p>
              <p className="provenance" style={{ margin: 0 }}>
                {s.sourceName}, list as of {String(s.asOf).slice(0, 10)}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <SearchBar
          value={terms}
          placeholder="Physician name or NPI number"
          onSubmit={(value) => updateParams({ query: value })}
        />
        <FilterPanel
          state={state}
          city={city}
          taxonomy={taxonomy}
          onChange={(filters) => updateParams(filters)}
        />
      </div>

      {!hasCriteria && !loading ? (
        <p className="muted">
          Start with a name, an NPI number, or a location. Results are limited
          to physicians on a state cannabis-certification list.
        </p>
      ) : (
        <ProviderResultsTable
          results={results}
          loading={loading}
          error={error}
          onRetry={refetch}
        />
      )}

      <p className="provenance">
        &ldquo;Linked&rdquo; means matched by license number or name and city
        against the NPI Registry; absence of a link does not mean a physician
        is uncertified. West Virginia shows no links until WV providers are
        cached locally. Every listed value carries its list as-of date.
      </p>
    </section>
  )
}
