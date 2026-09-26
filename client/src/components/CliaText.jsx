import { useState } from 'react'
import { Link } from 'react-router-dom'

// The CLIA number is the laboratory's canonical identifier (the lab analog
// of the physician NPI): always render it copyable, and optionally link it
// to the lab's own detail page.
export default function CliaText({ cliaNumber, link = false }) {
  const [copied, setCopied] = useState(false)

  if (!cliaNumber) return <span className="muted">&mdash;</span>

  const copy = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(cliaNumber)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable: the number remains visible for manual copy.
    }
  }

  return (
    <span className="npi-text">
      {link ? (
        <Link className="mono" to={`/labs/${cliaNumber}`} title="Open laboratory detail">
          {cliaNumber}
        </Link>
      ) : (
        <span className="mono">{cliaNumber}</span>
      )}
      <button type="button" className="btn btn-link npi-copy" onClick={copy} title="Copy CLIA number">
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  )
}
