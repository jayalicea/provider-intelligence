const apiConfig = {
  // NPI Registry API (NIH Clinical Tables)
  npiRegistry: {
    baseUrl: 'https://clinicaltables.nlm.nih.gov/api',
    endpoints: {
      individual: '/npi_idv/v3/search',
      organization: '/npi_org/v3/search'
    },
    maxResultsPerPage: 500,
    timeout: 10000
  },

  // CMS Open Data API
  cmsOpenData: {
    baseUrl: 'https://data.cms.gov/data-api/v1',
    endpoints: {
      dataset: '/dataset/{datasetId}/data'
    },
    maxResultsPerPage: 5000,
    timeout: 15000
  },

  // MIPS Performance Data — "Quality Payment Program Experience" dataset
  // (data-api UUID; CMS refreshes it periodically as a single rolling
  // vintage). The per-year dataset IDs from the original doc (e.g.
  // py2023: 'a174-a962') no longer resolve via the data API — those
  // provider-data catalog datasets are CSV-download only now.
  mipsDataset: '7adb8b1b-b85c-4ed3-b314-064776e50180',

  // Care Compare / Provider Data Catalog (datastore query API)
  providerDataCatalog: {
    baseUrl: 'https://data.cms.gov/provider-data/api/1',
    maxResultsPerPage: 500,
    timeout: 15000
  },

  // Care Compare hospital measure-family dataset IDs (verified live
  // against the provider-data metastore, refreshed 2026-07)
  qualityDatasets: {
    complications: 'ynj2-r877',   // Complications and Deaths - Hospital
    readmissions: '632h-zaca',    // Unplanned Hospital Visits - Hospital
    infections: '77hc-ibv8',      // Healthcare Associated Infections - Hospital
    hcahps: 'dgck-syfz',          // Patient survey (HCAHPS) - Hospital
    timelyEffectiveCare: 'yv7e-xc69' // Timely and Effective Care - Hospital
  },

  // Rate Limiting (per minute)
  rateLimits: {
    npiRegistry: 60,      // 60 requests per minute
    cmsOpenData: 120      // 120 requests per minute
  }
};

module.exports = apiConfig;
