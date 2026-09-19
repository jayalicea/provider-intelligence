import { useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import ProviderSearchPage from './pages/ProviderSearchPage.jsx'
import ProviderDetailPage from './pages/ProviderDetailPage.jsx'
import Provider360Page from './pages/Provider360Page.jsx'
import CohortExplorerPage from './pages/CohortExplorerPage.jsx'
import WatchlistPage from './pages/WatchlistPage.jsx'
import MyProvidersPage from './pages/MyProvidersPage.jsx'
import UploadRosterPage from './pages/UploadRosterPage.jsx'
import CoveragePage from './pages/CoveragePage.jsx'
import MipsDashboardPage from './pages/MipsDashboardPage.jsx'
import HospitalQualityPage from './pages/HospitalQualityPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'
import coverage from './data/coverage.json'

// Verbatim from docs/DESIGN.md §7.
const DISCLAIMER = `ProviderLens reports what public US government sources publish, as of the access date
shown with each value. Sources: NIH NPI Registry, CMS Quality Payment Program Experience,
CMS Care Compare. Scores are as published by CMS, including risk adjustment applied by CMS.
This tool is not medical advice, is not a credentialing decision, and certifies nothing.
Values may be stale or incorrect at the source; always verify against the source directly.`

const NAV = [
  { to: '/providers', label: 'Search' },
  { to: '/cohort', label: 'Cohort' },
  { to: '/watchlist', label: 'Watchlist' },
  { to: '/my-providers', label: 'My Providers' },
  { to: '/upload-roster', label: 'Upload Roster' },
  { to: '/coverage', label: 'Coverage' },
]

// The footer's global as-of is the oldest dataset vintage in the coverage
// registry: the platform as a whole is only as current as its stalest source.
function globalAsOf() {
  const dates = coverage.datasets
    .map((d) => d.asOf)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || ''))
    .sort()
  return dates[0] ?? null
}

export default function App() {
  const [showDisclaimer, setShowDisclaimer] = useState(false)
  const asOf = globalAsOf()

  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="app-header">
          <div className="app-header-inner">
            <span className="app-brand">ProviderLens</span>
            <nav className="app-nav" aria-label="Primary">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    isActive ? 'nav-link is-active' : 'nav-link'
                  }
                >
                  {item.label}
                </NavLink>
              ))}
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
          </div>
        </header>

        <main className="app-main">
          <Routes>
            <Route path="/" element={<Navigate to="/providers" replace />} />
            <Route path="/providers" element={<ProviderSearchPage />} />
            <Route path="/providers/:npi" element={<ProviderDetailPage />} />
            <Route path="/providers/:npi/360" element={<Provider360Page />} />
            <Route path="/cohort" element={<CohortExplorerPage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/my-providers" element={<MyProvidersPage />} />
            <Route path="/upload-roster" element={<UploadRosterPage />} />
            <Route path="/coverage" element={<CoveragePage />} />
            <Route path="/providers/:npi/mips" element={<MipsDashboardPage />} />
            <Route path="/facilities/:facilityId/quality" element={<HospitalQualityPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>

        <footer className="app-footer">
          <div className="app-footer-inner">
            <span>
              Data: NLM Clinical Tables NPI API, CMS QPP Experience dataset, CMS
              Care Compare provider-data API, HHS OIG LEIE, state Medicaid
              exclusion lists.
            </span>
            {asOf && (
              <span className="app-footer-asof">
                Platform as of {asOf} — oldest source vintage
              </span>
            )}
          </div>
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
              className="btn"
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
