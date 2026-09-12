import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import EmptyState from './EmptyState.jsx'
import LoadingSpinner from './LoadingSpinner.jsx'
import ErrorBanner from './ErrorBanner.jsx'

export default function ScoreTrendChart({ trends, loading, error, onRetry }) {
  if (loading) {
    return (
      <div className="card chart-card">
        <LoadingSpinner size="lg" label="Loading trends" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card chart-card">
        <ErrorBanner message={error.message} onRetry={onRetry} />
      </div>
    )
  }

  const data = [...(trends || [])]
    .filter((t) => t.year !== null && t.year !== undefined)
    .sort((a, b) => a.year - b.year)

  if (data.length === 0) {
    return (
      <div className="card chart-card">
        <EmptyState title="No multi-year MIPS trend data available." />
      </div>
    )
  }

  const note =
    data.length === 1 ? 'Only one year of data is available.' : null

  return (
    <div className="card chart-card">
      <h2 className="card-title">Score Trends by Performance Year</h2>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="finalScore"
            name="Final score"
            stroke="#3B5B7E"
            strokeWidth={2}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="qualityScore"
            name="Quality"
            stroke="#4C8055"
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="promotingInteroperabilityScore"
            name="Promoting Interoperability"
            stroke="#B7791F"
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="improvementActivitiesScore"
            name="Improvement Activities"
            stroke="#52606D"
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="costScore"
            name="Cost"
            stroke="#B0433C"
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
      {note && <p className="muted chart-note">{note}</p>}
    </div>
  )
}
