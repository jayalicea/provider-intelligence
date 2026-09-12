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
      <h1 className="page-title">Hospital Quality Measures</h1>
      <p className="muted">Facility ID: {facilityId}</p>
      <QualityMeasuresTable
        measures={data}
        loading={loading}
        error={error}
        onRetry={refetch}
      />
    </section>
  )
}
