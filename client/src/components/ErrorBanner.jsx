// Error copy per docs/DESIGN.md §4; the technical message is secondary.
export default function ErrorBanner({ message, onRetry }) {
  return (
    <div className="error-banner" role="alert">
      <span>
        This source did not respond. Cached data, if any, is shown with its
        access date.
        {message ? <span className="muted"> ({message})</span> : null}
      </span>
      {onRetry && (
        <button type="button" className="btn btn-link" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
