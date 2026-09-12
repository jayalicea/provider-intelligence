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
      <h1 className="page-title">MIPS Performance Dashboard</h1>
      <p className="muted">NPI {npi}</p>

      <div className="stack-top">
        <CategoryBarChart
          performance={performance.data}
          year={performance.data?.performanceYear}
        />
      </div>
      <div className="stack-top">
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
