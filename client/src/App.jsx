import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProviderSearchPage from './pages/ProviderSearchPage.jsx'
import ProviderDetailPage from './pages/ProviderDetailPage.jsx'
import Provider360Page from './pages/Provider360Page.jsx'
import CohortExplorerPage from './pages/CohortExplorerPage.jsx'
import CoveragePage from './pages/CoveragePage.jsx'
import MipsDashboardPage from './pages/MipsDashboardPage.jsx'
import HospitalQualityPage from './pages/HospitalQualityPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'

// Verbatim from docs/DESIGN.md §7.
const DISCLAIMER = `ProviderLens reports what public US government sources publish, as of the access date
shown with each value. Sources: NIH NPI Registry, CMS Quality Payment Program Experience,
CMS Care Compare. Scores are as published by CMS, including risk adjustment applied by CMS.
This tool is not medical advice, is not a credentialing decision, and certifies nothing.
Values may be stale or incorrect at the source; always verify against the source directly.`

export default function App() {
  const [showDisclaimer, setShowDisclaimer] = useState(false)

  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="app-header">
          <span className="app-brand">ProviderLens</span>
          <nav className="app-nav">
            <a href="/providers">Provider Search</a>
            <a href="/cohort">Cohort Explorer</a>
            <a href="/coverage">Coverage</a>
          </nav>
          <span className="app-header-right">
            <span className="env-tag">Public data only</span>
            <button
              type="button"
              className="header-link"
              onClick={() => setShowDisclaimer(true)}
            >
              About this data
            </button>
          </span>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Navigate to="/providers" replace />} />
            <Route path="/providers" element={<ProviderSearchPage />} />
            <Route path="/providers/:npi" element={<ProviderDetailPage />} />
            <Route path="/providers/:npi/360" element={<Provider360Page />} />
            <Route path="/cohort" element={<CohortExplorerPage />} />
            <Route path="/coverage" element={<CoveragePage />} />
            <Route path="/providers/:npi/mips" element={<MipsDashboardPage />} />
            <Route path="/facilities/:facilityId/quality" element={<HospitalQualityPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
        <footer className="app-footer muted">
          Data: NLM Clinical Tables NPI API, CMS QPP Experience dataset, CMS
          Care Compare provider-data API.
        </footer>
      </div>

      {showDisclaimer && (
        <div
          className="disclaimer-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="About this data"
          onClick={() => setShowDisclaimer(false)}
        >
          <div className="disclaimer-panel" onClick={(e) => e.stopPropagation()}>
            <h2>About this data</h2>
            <p>{DISCLAIMER}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowDisclaimer(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </BrowserRouter>
  )
}
