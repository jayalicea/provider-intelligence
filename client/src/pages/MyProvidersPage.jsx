import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../api/client.js'
import { useWatchlist } from '../hooks/useWatchlist.js'
import { WATCHLIST_MAX, decodeShareToken, encodeShareToken } from '../lib/watchlist.js'
import EmptyState from '../components/EmptyState.jsx'
import ErrorBanner from '../components/ErrorBanner.jsx'

function providerName(p) {
  return (
    [p?.name?.first, p?.name?.middle, p?.name?.last].filter(Boolean).join(' ') ||
    p?.name?.full ||
    'Not available'
  )
}

// Skeleton rows rather than a spinner, per DESIGN.md section 4.
function WatchlistSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr className="skeleton-row" key={i} aria-hidden="true">
          <td><span className="skeleton-line" /></td>
          <td><span className="skeleton-line" style={{ width: '40%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '30%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '60%' }} /></td>
          <td><span className="skeleton-line" style={{ width: '40%' }} /></td>
        </tr>
      ))}
    </>
  )
}

export default function MyProvidersPage() {
  const watchlist = useWatchlist()
  const [searchParams, setSearchParams] = useSearchParams()
  const [shareNotice, setShareNotice] = useState(null)
  const [copied, setCopied] = useState(false)

  // Share load: ?list=<token> merges into the local watchlist, then the query
  // param is removed so the URL no longer carries the token. Deferred to a
  // microtask so state updates happen outside the effect body.
  useEffect(() => {
    const token = searchParams.get('list')
    if (!token) return undefined
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      const decoded = decodeShareToken(token)
      if (decoded) {
        const { added, skipped } = watchlist.merge(decoded)
        if (added > 0) {
          setShareNotice(
            `Added ${added} provider${added === 1 ? '' : 's'} from the shared link` +
              (skipped > 0 ? `; ${skipped} already on your list or invalid` : '') +
              '.'
          )
        } else {
          setShareNotice('All providers from the link were already on your list.')
        }
      } else {
        setShareNotice('That share link could not be read. It may be truncated or malformed.')
      }
      const next = new URLSearchParams(window.location.search)
      next.delete('list')
      setSearchParams(next, { replace: true })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch summaries per NPI (the list is capped at 200, and typically far
  // smaller). Per-row failures degrade to the raw NPI with a remove action.
  const [rows, setRows] = useState({})
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(null)

  const npisKey = watchlist.npis.join(',')
  useEffect(() => {
    const npis = npisKey ? npisKey.split(',') : []
    if (npis.length === 0) return undefined
    let cancelled = false
    Promise.resolve()
      .then(() => {
        if (cancelled) return
        setLoading(true)
        setFetchError(null)
      })
      .then(() => Promise.allSettled(npis.map((npi) => api.getProvider(npi))))
      .then((results) => {
        if (cancelled) return
        const next = {}
        results.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value) next[npis[i]] = r.value
        })
        setRows(next)
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [npisKey])

  const ordered = useMemo(
    () =>
      watchlist.npis.map((npi) => ({
        npi,
        provider: rows[npi] ?? null,
      })),
    [watchlist.npis, rows]
  )

  const shareLink = useMemo(() => {
    if (watchlist.npis.length === 0) return null
    const token = encodeShareToken(watchlist.npis)
    return `${window.location.origin}/my-providers?list=${token}`
  }, [watchlist.npis])

  const copyShareLink = async () => {
    if (!shareLink) return
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable (permissions, non-secure context): fall back to
      // selecting nothing, just leave the link visible via the notice.
      setShareNotice(`Share link: ${shareLink}`)
    }
  }

  return (
    <section>
      <h1 className="page-title">My providers</h1>
      <p className="page-lede muted">
        Your personal watchlist of NPIs, saved in this browser. Open the list
        each review cycle without re-searching, or share it as a link.
      </p>

      {(shareNotice || watchlist.capMessage) && (
        <p className="notice-banner" role="status">
          {shareNotice || watchlist.capMessage}
        </p>
      )}

      {watchlist.npis.length === 0 && !shareNotice ? (
        <EmptyState
          title="No providers on your watchlist yet"
          description="Open any provider page and choose Add to watchlist. The NPI is saved in this browser only, up to 200 providers, and you can share the list as a link from here."
        />
      ) : (
        <>
          <div className="card">
            <p className="results-count">
              {watchlist.count} provider{watchlist.count === 1 ? '' : 's'} saved
              (max {WATCHLIST_MAX}), stored in this browser
            </p>
            <div className="watchlist-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!shareLink}
                onClick={copyShareLink}
              >
                {copied ? 'Link copied' : 'Copy share link'}
              </button>
              {copied && (
                <span className="provenance">
                  Anyone opening the link gets this provider set merged into
                  their own list.
                </span>
              )}
            </div>
          </div>

          {fetchError && <ErrorBanner message={fetchError.message} />}

          <div className="table-region">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>NPI</th>
                  <th>State</th>
                  <th>Taxonomy</th>
                  <th>Added</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {loading && <WatchlistSkeleton />}
                {!loading &&
                  ordered.map(({ npi, provider }) => (
                    <tr key={npi}>
                      <td>
                        {provider ? (
                          <Link to={`/providers/${npi}`}>
                            {providerName(provider)}
                          </Link>
                        ) : (
                          'Not available'
                        )}
                        {provider === null && !loading && (
                          <div className="provenance">
                            Not found in the current cached data
                          </div>
                        )}
                      </td>
                      <td className="mono">{npi}</td>
                      <td>{provider?.address?.state || 'Not available'}</td>
                      <td>{provider?.taxonomy?.description || 'Not available'}</td>
                      <td className="muted">
                        {(watchlist.addedAt[npi] || '').slice(0, 10) || 'Not available'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-link"
                          onClick={() => watchlist.remove(npi)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <p className="provenance">
            Names and specialties from the NIH NPI Registry via the ProviderLens
            cache. A provider that no longer resolves stays listed until you
            remove it.
          </p>
        </>
      )}
    </section>
  )
}
