import { Component } from 'react'

// Catches render errors under the routes, most importantly a lazy page chunk
// that fails to download (network blip, or an open tab asking for hashed
// files a newer deploy removed). Without it React unmounts the whole app and
// leaves a blank screen. App keys this component by pathname, so navigating
// to another page clears the error.
export default class RouteErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('Page failed to render', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-banner" role="alert">
        <span>
          This page failed to load. If the app was just updated, reloading
          fetches the current version.
          <span className="muted"> ({this.state.error.message})</span>
        </span>
        <button type="button" className="btn btn-link" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
