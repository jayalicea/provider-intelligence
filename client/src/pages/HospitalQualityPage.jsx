import { useParams } from 'react-router-dom'
import api from '../api/client.js'
import { useFetch } from '../hooks/useFetch.js'
import QualityMeasuresTable from '../components/QualityMeasuresTable.jsx'

export default function HospitalQualityPage() {
  const { facilityId } = useParams()
  const { data, loading, error, refetch } = useFetch(
    () => api.getQualityMeasures(facilityId),
    [facilityId]
  )

  return (
    <section>
      <h1 className="page-title">Hospital quality measures</h1>
      <p className="muted">
        Facility {facilityId} · measures as published by CMS Care Compare
      </p>
      <div className="stack-top">
        <QualityMeasuresTable
          measures={data}
          loading={loading}
          error={error}
          onRetry={refetch}
        />
        {!loading && !error && data && data.length > 0 && (
          <p className="provenance">
            CMS Care Compare, accessed {new Date().toISOString().slice(0, 10)}
          </p>
        )}
      </div>
    </section>
  )
}
