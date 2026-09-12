import { Link, useParams } from 'react-router-dom'
import api from '../api/client.js'
import { useFetch } from '../hooks/useFetch.js'
import ProviderProfileCard from '../components/ProviderProfileCard.jsx'
import MipsSummaryCard from '../components/MipsSummaryCard.jsx'

export default function ProviderDetailPage() {
  const { npi } = useParams()

  const provider = useFetch(() => api.getProvider(npi), [npi])
  const performance = useFetch(() => api.getMipsPerformance(npi), [npi])

  return (
    <section>
      <h1 className="page-title">Provider Detail</h1>
      <ProviderProfileCard
        provider={provider.data}
        loading={provider.loading}
        error={provider.error}
      />
      <div className="stack-top">
        <MipsSummaryCard
          performance={performance.data}
          loading={performance.loading}
          error={performance.error}
        />
      </div>
      {performance.data && (
        <p className="stack-top">
          <Link className="btn btn-primary" to={`/providers/${npi}/mips`}>
            Open full MIPS dashboard
          </Link>
        </p>
      )}
    </section>
  )
}
