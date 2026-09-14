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
    return { results: data.data ?? [], count: data.count ?? 0 }
  },

  getProvider: async (npi) => {
    const { data } = await http.get(`/providers/${npi}`)
    return data.data
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

export default api
