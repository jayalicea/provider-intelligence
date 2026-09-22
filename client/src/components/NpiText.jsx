import { useState } from 'react'
import { Link } from 'react-router-dom'

// The NPI is the platform's canonical identifier: always render it with a
// copy action so it can move into EHR/claims systems by click. When `link`
// is set, the number itself is also the fastest path to the provider
// profile. Falls back to an em-dash for absent values.
export default function NpiText({ npi, link = false }) {
  const [copied, setCopied] = useState(false)

  if (!npi) return <span className="muted">&mdash;</span>

  const copy = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(npi)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (permissions, non-secure context): the number
      // remains visible for manual selection.
    }
  }

  return (
    <span className="npi-text">
      {link ? (
        <Link className="mono" to={`/providers/${npi}`} title="Open provider profile">
          {npi}
        </Link>
      ) : (
        <span className="mono">{npi}</span>
      )}
      <button
        type="button"
        className="btn btn-link npi-copy"
        onClick={copy}
        title="Copy NPI"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  )
}
