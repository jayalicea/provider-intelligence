const ApiKeyService = require('../services/apiKeyService');

const apiKeyService = ApiKeyService.shared;

class AdminController {
  /**
   * GET /api/v1/admin/usage?days=30
   * Per-key totals and per-endpoint breakdowns from api_usage.
   * Key-protected by the apiKeyAuth middleware on every method.
   */
  async getUsage(req, res) {
    try {
      const { days } = req.query;
      if (days !== undefined && days !== '') {
        const n = Number(days);
        if (!Number.isInteger(n) || n < 1 || n > 90) {
          return res.status(400).json({ error: 'days must be an integer between 1 and 90' });
        }
      }

      const data = await apiKeyService.getUsage({ days: days ? Number(days) : 30 });
      res.json({ success: true, ...data });
    } catch (error) {
      console.error("USAGE_ERR", error); res.status(500).json({ error: "Failed to load usage data" });
    }
  }
}

module.exports = AdminController;
