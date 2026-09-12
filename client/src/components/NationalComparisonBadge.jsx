// Copy per docs/DESIGN.md §4 (Quality measures tab): exact badge text.
export default function NationalComparisonBadge({ comparedToNational }) {
  let tone = 'na'
  let text = 'Not reported'
  const value = comparedToNational || ''

  if (/better/i.test(value)) {
    tone = 'success'
    text = 'Better than national'
  } else if (/no different/i.test(value)) {
    tone = 'neutral'
    text = 'Same as national'
  } else if (/worse/i.test(value)) {
    tone = 'error'
    text = 'Worse than national'
  }

  return (
    <span className={`badge badge-${tone}`} role="status">
      {text}
    </span>
  )
}
