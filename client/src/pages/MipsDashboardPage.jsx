import { Link, useParams } from 'react-router-dom'
import api from '../api/client.js'
import { useFetch } from '../hooks/useFetch.js'
import CategoryBarChart from '../components/CategoryBarChart.jsx'
import ScoreTrendChart from '../components/ScoreTrendChart.jsx'

const END_YEAR = new Date().getFullYear() - 1

export default function MipsDashboardPage() {
  const { npi } = useParams()

  const performance = useFetch(() => api.getMipsPerformance(npi), [npi])
  const trends = useFetch(
    () => api.getMipsTrends(npi, 2018, END_YEAR),
    [npi]
  )

  return (
    <section>
      <p>
        <Link to={`/providers/${npi}`}>&larr; Back to provider detail</Link>
      </p>
      <h1 className="page-title">MIPS performance</h1>
      <p className="muted">NPI {npi}</p>

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
    </section>
  )
}
