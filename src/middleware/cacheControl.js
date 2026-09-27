// Cache-Control for /api/v1 responses.
//
// Express already emits weak ETags, so an unchanged response can return 304,
// but that still re-runs the handler (and its DB queries). A short max-age
// lets browsers and shared caches reuse GET responses without a round trip;
// the underlying data changes on ingest schedules (daily to quarterly), so
// a few minutes of staleness is acceptable.
//
//   successful GET/HEAD         public, max-age=N, stale-while-revalidate=M
//   ... sent with X-API-Key      private, max-age=N (never in shared caches)
//   /admin/*, errors, non-GET    no-store
//
// Tunable via CACHE_MAX_AGE / CACHE_STALE_WHILE_REVALIDATE (seconds);
// CACHE_MAX_AGE=0 disables caching (no-store everywhere).
function cacheControl({
  maxAge = parseInt(process.env.CACHE_MAX_AGE ?? '300', 10),
  staleWhileRevalidate = parseInt(process.env.CACHE_STALE_WHILE_REVALIDATE ?? '3600', 10)
} = {}) {
  return function setCacheControl(req, res, next) {
    let policy = 'no-store';
    const cacheable = (req.method === 'GET' || req.method === 'HEAD')
      && !req.path.startsWith('/admin') && maxAge > 0;
    if (cacheable) {
      policy = req.get('X-API-Key')
        ? `private, max-age=${maxAge}`
        : `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
    }

    // Decide at header-write time, when the final status is known, so 4xx/5xx
    // responses from any controller or the error handler are never cached.
    const writeHead = res.writeHead;
    res.writeHead = function (statusCode, ...rest) {
      const status = typeof statusCode === 'number' ? statusCode : this.statusCode;
      if (!this.getHeader('Cache-Control')) {
        const ok = (status >= 200 && status < 300) || status === 304;
        this.setHeader('Cache-Control', ok ? policy : 'no-store');
      }
      return writeHead.call(this, statusCode, ...rest);
    };
    next();
  };
}

module.exports = cacheControl;
