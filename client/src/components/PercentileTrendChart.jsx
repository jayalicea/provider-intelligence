import {
  LineChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import EmptyState from './EmptyState.jsx'
import LoadingSpinner from './LoadingSpinner.jsx'
import ErrorBanner from './ErrorBanner.jsx'

// Story 5.1: the provider percentile is a 0-100 rank (share of scored
// same-taxonomy peers at or below the provider), but the cohort's
// median/p25/p75 arrive as final-score values from the endpoint. Mixing
// both on one axis would be dishonest, so the chart uses two y axes:
// percentile rank on the left, cohort final score on the right.
export default function PercentileTrendChart({ result, loading, error, onRetry }) {
  if (loading) {
    return (
      <div className="card chart-card">
        <LoadingSpinner size="lg" label="Loading percentile trends" />
      </div>
    )
  }

  if (error) {
    // 404 means the provider has no resolvable primary taxonomy, so there
    // is no peer cohort to rank against. Say so explicitly, not as a
    // generic failure.
    if (error.status === 404) {
      return (
        <div className="card chart-card">
          <h2 className="card-title">Percentile Rank vs Peer Cohort</h2>
          <p className="muted">
            Percentile context is unavailable for this provider: no primary
            taxonomy is on record, so there is no peer cohort to compare
            against. Scores on this page are shown without a cohort ranking.
          </p>
        </div>
      )
    }
    return (
      <div className="card chart-card">
        <ErrorBanner message={error.message} onRetry={onRetry} />
      </div>
    )
  }

  const rows = [...(result?.years || [])]
    .filter((y) => y.performance_year !== null && y.performance_year !== undefined)
    .sort((a, b) => a.performance_year - b.performance_year)
    .map((y) => ({
      year: y.performance_year,
      // null stays null so the line breaks rather than interpolating a
      // year the provider was not scored.
      percentile: y.percentile ?? null,
      median: y.median_final_score ?? null,
      p25: y.p25 ?? null,
      iqr: y.p25 != null && y.p75 != null ? y.p75 - y.p25 : null,
    }))

  if (rows.length === 0) {
    return (
      <div className="card chart-card">
        <h2 className="card-title">Percentile Rank vs Peer Cohort</h2>
        <EmptyState title="No archived cohort data is available for this provider's taxonomy." />
      </div>
    )
  }

  const provenance = result.years[result.years.length - 1]?.provenance
  const note =
    rows.length === 1 ? 'Only one year of archived cohort data is available.' : null

  return (
    <div className="card chart-card">
      <h2 className="card-title">Percentile Rank vs Peer Cohort</h2>
      <p className="muted">
        How this provider&apos;s MIPS final score ranked among peers with the
        same primary taxonomy, per archived performance year.
      </p>
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 12 }}
            label={{ value: 'Performance year', position: 'insideBottom', offset: -2 }}
          />
          <YAxis
            yAxisId="pct"
            domain={[0, 100]}
            tick={{ fontSize: 12 }}
            label={{ value: 'Percentile rank', angle: -90, position: 'insideLeft' }}
          />
          <YAxis
            yAxisId="score"
            orientation="right"
            tick={{ fontSize: 12 }}
            label={{ value: 'Cohort final score', angle: 90, position: 'insideRight' }}
          />
          <Tooltip />
          <Legend />
          {/* Middle 50% of cohort scores (p25 to p75). The first, invisible
              stacked area offsets the band up to p25. */}
          <Area
            yAxisId="score"
            dataKey="p25"
            stackId="band"
            stroke="none"
            fill="none"
            legendType="none"
            isAnimationActive={false}
          />
          <Area
            yAxisId="score"
            dataKey="iqr"
            stackId="band"
            name="Cohort middle 50% of scores (25th to 75th percentile)"
            stroke="none"
            fill="#4C8055"
            fillOpacity={0.2}
            isAnimationActive={false}
          />
          <Line
            yAxisId="score"
            type="monotone"
            dataKey="median"
            name="Cohort median score (dashed)"
            stroke="#52606D"
            strokeDasharray="6 4"
            dot={{ r: 3 }}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="percentile"
            name="Provider percentile rank"
            stroke="#0F6B5C"
            strokeWidth={2.5}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
      {note && <p className="muted chart-note">{note}</p>}
      <p className="muted chart-note">
        A higher percentile means a larger share of peers scored at or below
        this provider. Years where the provider has no archived score leave a
        gap in the percentile line.
      </p>
      {provenance && (
        <p className="muted chart-note">
          Source: {provenance.source}
          {provenance.as_of ? `, as of ${provenance.as_of}` : ''}.
        </p>
      )}
    </div>
  )
}
