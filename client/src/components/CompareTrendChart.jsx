import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import EmptyState from './EmptyState.jsx'

// One series per provider, keyed by NPI. Colors are DESIGN.md palette
// tokens: primary teal, then the greens/amber used by the dashboard chart.
const SERIES_COLORS = ['#0F6B5C', '#4C8055', '#B7791F']

// `series` is [{ npi, label, points: { [year]: finalScore } , warning }].
// Years with no score stay undefined so the line breaks rather than implying
// a value that was never reported.
export default function CompareTrendChart({ series }) {
  const years = new Set()
  for (const s of series) {
    for (const year of Object.keys(s.points)) years.add(Number(year))
  }
  const data = [...years].sort((a, b) => a - b).map((year) => {
    const row = { year }
    for (const s of series) row[s.npi] = s.points[year]
    return row
  })

  if (data.length === 0) {
    return (
      <div className="card chart-card">
        <EmptyState title="No score data for any provider on this list." />
      </div>
    )
  }

  return (
    <div className="card chart-card">
      <h2 className="card-title">Final MIPS score by performance year</h2>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          {series.map((s, i) => (
            <Line
              key={s.npi}
              type="monotone"
              dataKey={s.npi}
              name={s.label}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
