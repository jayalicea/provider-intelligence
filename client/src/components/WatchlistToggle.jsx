import { useWatchlist } from '../hooks/useWatchlist.js'

// Add-to-watchlist toggle, used on the provider detail page. Shows "Watching"
// (primary) when the NPI is on the list, "Add to watchlist" otherwise.
export default function WatchlistToggle({ npi }) {
  const { has, toggle } = useWatchlist()
  const watching = has(npi)

  return (
    <button
      type="button"
      className={watching ? 'btn btn-primary' : 'btn'}
      aria-pressed={watching}
      onClick={() => toggle(npi)}
    >
      {watching ? 'Watching' : 'Add to watchlist'}
    </button>
  )
}
