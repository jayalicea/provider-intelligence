const ApiKeyService = require('../services/apiKeyService');

const apiKeyService = ApiKeyService.shared;

/**
 * Package C write protection.
 *
 * All non-GET requests under /api/v1 require a valid X-API-Key header.
 * GET endpoints stay open: every upstream source is a free public
 * government API and public read aligns with the product posture. The
 * exception is /api/v1/admin/*, which is key-protected on every method
 * (usage reports are operator-only).
 *
 * On success, req.apiKeyLabel carries the key's label for metering.
 */
module.exports = function apiKeyAuth(req, res, next) {
  const isAdmin = req.path.startsWith('/admin');
  if (req.method === 'GET' && !isAdmin) return next();

  if (!apiKeyService.configured()) {
    return res.status(401).json({ error: 'invalid or missing API key' });
  }

  const label = apiKeyService.authenticate(req.get('X-API-Key'));
  if (!label) {
    return res.status(401).json({ error: 'invalid or missing API key' });
  }

  req.apiKeyLabel = label;
  res.on('finish', () => {
    const route = req.route ? req.baseUrl + req.route.path : req.baseUrl + req.path;
    apiKeyService.recordUsage({
      keyLabel: label,
      endpoint: route,
      method: req.method,
      status: res.statusCode
    });
  });
  next();
};
