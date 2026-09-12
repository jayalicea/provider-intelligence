import { useEffect, useState } from 'react'

export default function SearchBar({ value, onChange, onSubmit, placeholder }) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

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
