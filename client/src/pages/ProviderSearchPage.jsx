import { useSearchParams } from 'react-router-dom'
import { useState } from 'react'
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
  const [mipsOnly, setMipsOnly] = useState(false)

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

  const results = mipsOnly
    ? (data?.results ?? []).filter((p) => p.hasMipsData)
    : data?.results

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
      <h1 className="page-title">Find a provider</h1>
      <p className="muted">
        Search the NPI Registry, MIPS quality scores, and hospital quality measures.
      </p>
      <div className="card">
        <SearchBar
          value={terms}
          placeholder="Dr. Smith or 1234567890"
          onSubmit={(value) => updateParams({ query: value })}
        />
        <FilterPanel
          state={state}
          city={city}
          taxonomy={taxonomy}
          onChange={(filters) => updateParams(filters)}
        />
        <label className="mips-filter">
          <input
            type="checkbox"
            checked={mipsOnly}
            onChange={(e) => setMipsOnly(e.target.checked)}
          />
          Only show providers with MIPS scores
        </label>
        {mipsOnly && (
          <p className="muted mips-filter-note">
            MIPS coverage reflects cached CMS data. CMS publishes one rolling
            vintage rather than per-year data, and as-of dates are shown per
            value. Absence here does not mean a provider has no MIPS history.
          </p>
        )}
      </div>

      {!hasCriteria && !loading ? (
        <p className="muted">
          Start with a name, an NPI number, or a state. Results come from the
          public NPI Registry.
        </p>
      ) : (
        <ProviderResultsTable
          results={results}
          loading={loading}
          error={error}
          onRetry={refetch}
        />
      )}
    </section>
  )
}
