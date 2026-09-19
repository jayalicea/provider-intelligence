// Pure helper for Story 1.1 score drop alerts. `years` must be sorted
// ascending by year. Returns the largest consecutive-year drop as
// { drop, fromYear, toYear }, or null when no scored pair drops at all.
export function findLargestDrop(years) {
  let worst = null
  for (let i = 1; i < years.length; i += 1) {
    const prev = years[i - 1]
    const cur = years[i]
    if (prev.finalScore === null || cur.finalScore === null) continue
    const drop = prev.finalScore - cur.finalScore
    if (drop > 0 && (!worst || drop > worst.drop)) {
      worst = { drop, fromYear: prev.year, toYear: cur.year }
    }
  }
  return worst
}
