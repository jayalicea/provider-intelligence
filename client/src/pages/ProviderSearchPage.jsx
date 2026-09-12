import { useSearchParams } from 'react-router-dom'
import api from '../api/client.js'
import { useFetch } from '../hooks/useFetch.js'
import SearchBar from '../components/SearchBar.jsx'
import FilterPanel from '../components/FilterPanel.jsx'
import ProviderResultsTable from '../components/ProviderResultsTable.jsx'

export default function ProviderSearchPage() {
  // Search state is mirrored into URL search params so results are shareable.
  const [searchParams, setSearchParams] = useSearchParams()
  const terms = searchParams.get('query') || ''
  const state = searchParams.get('state') || ''
  const city = searchParams.get('city') || ''
  const taxonomy = searchParams.get('taxonomy') || ''

  const hasCriteria = Boolean(terms || state || city)

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
      <h1 className="page-title">Provider Search</h1>
      <div className="card">
        <SearchBar
          value={terms}
          placeholder="Provider name or NPI number"
          onChange={(value) => updateParams({ query: value })}
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
          Enter a provider name or NPI, or pick at least a state or city, to
          search the NPI registry.
        </p>
      ) : (
        <ProviderResultsTable
          results={data?.results}
          loading={loading}
          error={error}
          onRetry={refetch}
        />
      )}
    </section>
  )
}
