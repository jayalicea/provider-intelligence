import { Link, useParams } from 'react-router-dom'
import api, { exportUrls } from '../api/client.js'
import { useFetch } from '../hooks/useFetch.js'
import CategoryBarChart from '../components/CategoryBarChart.jsx'
import ScoreTrendChart from '../components/ScoreTrendChart.jsx'
import PercentileTrendChart from '../components/PercentileTrendChart.jsx'

const END_YEAR = new Date().getFullYear() - 1

export default function MipsDashboardPage() {
  const { npi } = useParams()

  const performance = useFetch(() => api.getMipsPerformance(npi), [npi])
  const trends = useFetch(
    () => api.getMipsTrends(npi, 2018, END_YEAR),
    [npi]
  )
  const percentileTrends = useFetch(
    () => api.getPercentileTrends(npi),
    [npi]
  )

  return (
    <section>
      <p>
        <Link to={`/providers/${npi}`}>&larr; Back to provider detail</Link>
      </p>
      <h1 className="page-title">MIPS performance</h1>
      <p className="muted">NPI {npi}</p>
      <p>
        <a
          className="btn export-csv"
          href={exportUrls.mipsPerformance(npi, 2018, END_YEAR)}
          download
        >
          Export CSV
        </a>
      </p>

      <div className="stack-top">
        <CategoryBarChart
          performance={performance.data}
          year={performance.data?.performanceYear}
        />
      </div>
      <div className="stack-top">
        {/* DESIGN.md §4: persistent vintage banner above the trends chart.
            The provider mips-trends endpoint returns no API warning field,
            so this is the fixed copy. */}
        <div className="info-banner">
          Year labels are request vintages on CMS&apos;s rolling dataset.
          Year-over-year movement may reflect re-based scores, not true
          performance change.
        </div>
        <ScoreTrendChart
          trends={trends.data}
          loading={trends.loading}
          error={trends.error}
          onRetry={trends.refetch}
        />
      </div>
      <div className="stack-top">
        {/* Story 5.1: percentile rank over time vs taxonomy cohort.
            Least invasive fit for this page: a headed section directly
            below the raw-score trend chart it contextualizes, no new
            route or tabs. */}
        <PercentileTrendChart
          result={percentileTrends.data}
          loading={percentileTrends.loading}
          error={percentileTrends.error}
          onRetry={percentileTrends.refetch}
        />
      </div>
    </section>
  )
}
