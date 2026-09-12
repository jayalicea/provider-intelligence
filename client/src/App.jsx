import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProviderSearchPage from './pages/ProviderSearchPage.jsx'
import ProviderDetailPage from './pages/ProviderDetailPage.jsx'
import MipsDashboardPage from './pages/MipsDashboardPage.jsx'
import HospitalQualityPage from './pages/HospitalQualityPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="app-header">
          <span className="app-brand">Provider Intelligence</span>
          <nav className="app-nav">
            <a href="/providers">Provider Search</a>
          </nav>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Navigate to="/providers" replace />} />
            <Route path="/providers" element={<ProviderSearchPage />} />
            <Route path="/providers/:npi" element={<ProviderDetailPage />} />
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
    </BrowserRouter>
  )
}
