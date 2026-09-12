const FOOTNOTES = {
  1: 'Too few cases to report',
  2: 'Based on a sample',
  3: 'Shorter time period than required',
}

export function footnoteLabel(code) {
  if (code === null || code === undefined || code === '') return null
  const text = FOOTNOTES[Number(code)]
  return text || 'See CMS Footnote Crosswalk'
}

export default function NationalComparisonBadge({ comparedToNational }) {
  let tone = 'neutral'
  let text = 'Not compared'
  const value = comparedToNational || ''

  if (/better/i.test(value)) {
    tone = 'success'
    text = 'Better than national'
  } else if (/no different/i.test(value)) {
    tone = 'neutral'
    text = 'No different than national'
  } else if (/worse/i.test(value)) {
    tone = 'error'
    text = 'Worse than national'
  } else if (value) {
    text = value
  }

  return (
    <span className={`badge badge-${tone}`} role="status">
      {text}
    </span>
  )
}
