export default function LoadingSpinner({ label = 'Loading', size = 'md' }) {
  return (
    <span className={`spinner spinner-${size}`} role="status" aria-live="polite">
      <span className="spinner-wheel" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  )
}
