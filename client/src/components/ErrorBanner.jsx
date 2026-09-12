export default function ErrorBanner({ message, onRetry }) {
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-link" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
