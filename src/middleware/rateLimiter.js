// Simple in-memory fixed-window rate limiter.
// Section 10.2 of phynpi.md implements this with express-rate-limit, but that
// package is not among the dependencies in package.json, so this module
// provides the same factory interface used by src/routes/providerRoutes.js:
//   rateLimiter({ windowMs, max })
function rateLimiter({ windowMs = 60 * 1000, max = 100 } = {}) {
  const hits = new Map();

  // Periodically drop stale entries so the map does not grow unbounded
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now >= entry.resetTime) {
        hits.delete(key);
      }
    }
  }, windowMs);
  sweeper.unref();

  return function limiter(req, res, next) {
    const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || now >= entry.resetTime) {
      entry = { count: 0, resetTime: now + windowMs };
      hits.set(key, entry);
    }

    if (entry.count >= max) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Please try again later.'
      });
    }

    entry.count += 1;
    next();
  };
}

module.exports = rateLimiter;
