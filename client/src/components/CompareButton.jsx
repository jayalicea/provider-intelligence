import { useNavigate } from 'react-router-dom'
import { useCompare } from '../hooks/useCompare.js'

// Add-to-comparison button, used next to the watchlist toggle on the
// provider detail page. Adding the NPI writes to localStorage first, then
// navigates to /compare so the user lands on the chart with the provider
// already on the list. If the list is full or the NPI is already present,
// navigation still happens and the page's inline notice explains the state.
export default function CompareButton({ npi }) {
  const navigate = useNavigate()
  const { add, has } = useCompare()

  return (
    <button
      type="button"
      className={has(npi) ? 'btn btn-primary' : 'btn'}
      onClick={() => {
        add(npi)
        navigate('/compare')
      }}
    >
      {has(npi) ? 'On comparison list' : 'Compare'}
    </button>
  )
}
