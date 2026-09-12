import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <section>
      <h1 className="page-title">Page not found</h1>
      <p className="muted">The page you are looking for does not exist.</p>
      <p>
        <Link to="/providers">Go to provider search</Link>
      </p>
    </section>
  )
}
