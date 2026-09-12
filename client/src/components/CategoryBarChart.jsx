import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import EmptyState from './EmptyState.jsx'

const CATEGORIES = [
  ['Quality', 'qualityScore'],
  ['Promoting Interoperability', 'promotingInteroperabilityScore'],
  ['Improvement Activities', 'improvementActivitiesScore'],
  ['Cost', 'costScore'],
]

export default function CategoryBarChart({ performance, year }) {
  const data = CATEGORIES.map(([name, key]) => ({
    name,
    score: performance && performance[key] !== null && performance[key] !== undefined
      ? performance[key]
      : null,
  }))

  if (data.every((d) => d.score === null)) {
    return <EmptyState title="No MIPS performance data available for this provider." />
  }

  return (
    <div className="card chart-card">
      <h2 className="card-title">Category Scores {year ? `(${year})` : ''}</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="score" fill="#3B5B7E" name="Category score" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="muted chart-note">
        Missing categories render as zero-height bars (score not reported).
      </p>
    </div>
  )
}
