import axios from 'axios'

// Base URL defaults to the Vite dev proxy (see vite.config.js); override
// with VITE_API_BASE_URL for other environments.
const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  headers: { Accept: 'application/json' },
  timeout: 20000,
})

function toApiError(error) {
  if (error.response) {
    const message =
      error.response.data?.error ||
      error.response.statusText ||
      `Request failed (${error.response.status})`
    const err = new Error(message)
    err.status = error.response.status
    return err
  }
  const err = new Error('Network error')
  err.status = 0
  return err
}

http.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(toApiError(error))
)

// The backend wraps payloads as { success, data, count }. Helpers unwrap
// `data` and normalize the occasional envelope difference.
export const api = {
  searchProviders: async ({ terms, state, city, taxonomy, maxResults = 50 }) => {
    const { data } = await http.get('/providers/search', {
      params: { terms, state, city, taxonomy, maxResults },
    })
    return {
      results: data.data ?? [],
      count: data.count ?? 0,
      total: data.total ?? null,
      offset: data.offset ?? 0,
      limit: data.limit ?? maxResults,
    }
  },

  getProvider: async (npi) => {
    const { data } = await http.get(`/providers/${npi}`)
    return data.data
  },

  getCannabisSummary: async () => {
    const { data } = await http.get('/cannabis/summary')
    return data.data ?? []
  },

  getMipsPerformance: async (npi, year) => {
    const { data } = await http.get(`/providers/${npi}/mips-performance`, {
      params: { year },
    })
    return data.data
  },

  getMipsTrends: async (npi, startYear, endYear) => {
    const { data } = await http.get(`/providers/${npi}/mips-trends`, {
      params: { startYear, endYear },
    })
    // Backend returns parallel arrays; reshape into per-year records.
    const d = data.data
    const count = d?.performanceYears?.length ?? 0
    const records = []
    for (let i = 0; i < count; i += 1) {
      records.push({
        year: d.performanceYears[i],
        finalScore: d.finalScores[i],
        qualityScore: d.qualityScores[i],
        improvementActivitiesScore: d.improvementActivitiesScores[i],
        promotingInteroperabilityScore: d.promotingInteroperabilityScores[i],
        costScore: d.costScores[i],
      })
    }
    return records
  },

  // Multi-year trend analysis from the analytics service. Unlike
  // getMipsTrends (parallel arrays), data here is already per-year records
  // under `years`, plus a `warning` string when any row is a request label
  // on CMS's rolling vintage (null when all years are archived vintages).
  getAnalyticsTrends: async (npi, startYear, endYear) => {
    const { data } = await http.get(`/analytics/trends/${npi}`, {
      params: { startYear, endYear },
    })
    return data.data
  },

  // Percentile rank over time vs the provider's taxonomy cohort. Archive
  // years only; each row carries the provider percentile (0-100, null when
  // not scored that year), cohort score-space quartiles (p25/median/p75),
  // and provenance. The endpoint 404s when the npi has no resolvable
  // primary taxonomy; the error carries status 404 for the chart to render
  // an explicit "no cohort context" note instead of an error banner.
  getPercentileTrends: async (npi) => {
    const { data } = await http.get(`/analytics/percentile-trends/${npi}`)
    return data.data
  },

  getTaxonomyBenchmark: async (taxonomy, year) => {
    const { data } = await http.get('/analytics/taxonomy-benchmark', {
      params: { taxonomy, year },
    })
    return data.data
  },

  getVerification: async (npi) => {
    const { data } = await http.get(`/providers/${npi}/verification`)
    return data.data
  },

  getCohort: async ({ state, taxonomy, minScore, source, name }) => {
    const { data } = await http.get('/intelligence/cohort', {
      params: { state, taxonomy, minScore, source, name },
    })
    return { results: data.data ?? [], count: data.count ?? 0 }
  },

  getExclusionWatchlist: async ({ state, days } = {}) => {
    const { data } = await http.get('/intelligence/exclusion-watchlist', {
      params: { state: state || undefined, days: days || undefined },
    })
    return {
      results: data.data ?? [],
      count: data.count ?? 0,
      windowDays: data.windowDays ?? null,
      capped: data.capped ?? false,
    }
  },

  screenRoster: async (rows) => {
    const { data } = await http.post('/intelligence/screen-roster', { rows })
    return {
      results: data.data ?? [],
      count: data.count ?? 0,
      counts: data.counts ?? {},
      submitted: data.submitted ?? 0,
      truncated: data.truncated ?? false,
    }
  },

  getQualityMeasures: async (facilityId) => {
    // The backend mounts quality measures under the providers router
    // (/api/v1/providers/quality-measures/:facilityId), not at the API root.
    const { data } = await http.get(`/providers/quality-measures/${facilityId}`)
    return data.data ?? []
  },
}

// CSV exports are plain browser downloads (anchor href), not axios calls, so
// the helpers return URLs rather than fetching. `format=csv` on the search
// endpoint and on mips-performance; both set Content-Disposition attachment.
function buildUrl(path, params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value)
  }
  const qs = search.toString()
  return `${http.defaults.baseURL}${path}${qs ? `?${qs}` : ''}`
}

export const exportUrls = {
  providerSearch: ({ terms, state, city, taxonomy, maxResults = 50 }) =>
    buildUrl('/providers/search', { terms, state, city, taxonomy, maxResults, format: 'csv' }),
  mipsPerformance: (npi, startYear, endYear) =>
    buildUrl(`/providers/${npi}/mips-performance`, { startYear, endYear, format: 'csv' }),
}

export default api
