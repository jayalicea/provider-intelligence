import { useState } from 'react'

// Local draft so the parent (and its URL params / API call) only updates on
// submit, not per keystroke. Syncs to external value changes by adjusting
// state during render (React's recommended alternative to setState-in-effect).
export default function SearchBar({ value, onSubmit, placeholder }) {
  const [draft, setDraft] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  if (lastValue !== value) {
    setLastValue(value)
    setDraft(value)
  }

  const submit = () => onSubmit(draft.trim())

  return (
    <div className="search-bar">
      <input
        type="search"
        className="input"
        value={draft}
        placeholder={placeholder || 'Provider name or NPI'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        aria-label="Search terms"
      />
      <button type="button" className="btn btn-primary" onClick={submit}>
        Search
      </button>
    </div>
  )
}
