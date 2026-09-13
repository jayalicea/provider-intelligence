// Exclusion verdict chip. One shape across every surface -- the dot is
// decorative (see .badge::before), the label always carries the meaning, per
// DESIGN.md §5: colour is never the only encoding.
const TONE = {
  EXCLUDED: 'badge-error',
  CLEAR: 'badge-success',
  UNVERIFIED: 'badge-na',
}

export default function VerdictBadge({ verdict, size }) {
  const tone = TONE[verdict] ?? 'badge-na'
  const label = TONE[verdict] ? verdict : 'UNVERIFIED'
  return (
    <span className={`badge ${tone}${size === 'lg' ? ' badge-lg' : ''}`} role="status">
      {label}
    </span>
  )
}
