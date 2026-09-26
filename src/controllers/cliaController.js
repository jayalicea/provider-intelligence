const CliaService = require('../services/cliaService');
const { logger } = require('../utils/logger');

class CliaController {
  constructor() {
    this.cliaService = new CliaService();
  }

  /**
   * GET /api/v1/labs/search?name=&state=&city=
   */
  async searchLabs(req, res) {
    try {
      const { name, state, city } = req.query;
      if (state !== undefined && !/^[A-Za-z]{2}$/.test(state)) {
        return res.status(400).json({ success: false, error: 'state must be a two-letter code' });
      }
      if (!name && !state && !city) {
        return res.status(400).json({
          success: false,
          error: 'At least one search criterion is required (name, state, or city)'
        });
      }

      const { rows, total } = await this.cliaService.searchLabs({ name, state, city, limit: req.query.limit, offset: req.query.offset });

      res.json({ success: true, data: rows, count: rows.length, total });
    } catch (error) {
      logger.error('Error in searchLabs:', error);
      res.status(500).json({ success: false, error: 'Failed to search laboratories' });
    }
  }

  /**
   * GET /api/v1/labs/alerts - delisted labs and certifiers
   */
  async getAlerts(req, res) {
    try {
      const alerts = await this.cliaService.getDelistedAlerts();
      res.json({
        success: true,
        data: alerts,
        count: alerts.labs.length + alerts.certifiers.length
      });
    } catch (error) {
      logger.error('Error in getAlerts:', error);
      res.status(500).json({ success: false, error: 'Failed to retrieve alerts' });
    }
  }

  /**
   * GET /api/v1/labs/:cliaNumber
   */
  async getLab(req, res) {
    try {
      const { cliaNumber } = req.params;
      if (!this.cliaService.validateCliaFormat(cliaNumber)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid CLIA number format (10 characters: 2-digit state prefix plus 8 alphanumeric)'
        });
      }

      const lab = await this.cliaService.getLabByCliaNumber(cliaNumber.toUpperCase());
      if (!lab) {
        return res.status(404).json({ success: false, error: 'Laboratory not found' });
      }

      res.json({ success: true, data: lab });
    } catch (error) {
      logger.error('Error in getLab:', error);
      res.status(500).json({ success: false, error: 'Failed to retrieve laboratory' });
    }
  }
}

module.exports = CliaController;
