const IntelligenceService = require('../services/intelligenceService');
const { logger } = require('../utils/logger');

class IntelligenceController {
  constructor() {
    this.intelligenceService = new IntelligenceService();
  }

  /**
   * GET /api/v1/intelligence/cohort?state=&taxonomy=&minScore=
   * Joined providers + latest MIPS + LEIE verdicts for one state.
   */
  async getCohort(req, res) {
    try {
      const { state, taxonomy, minScore } = req.query;

      if (!state || !/^[A-Za-z]{2}$/.test(state)) {
        return res.status(400).json({
          success: false,
          error: 'state is required and must be a 2-letter code'
        });
      }

      let min = null;
      if (minScore !== undefined && minScore !== '') {
        min = Number(minScore);
        if (!Number.isFinite(min) || min < 0 || min > 100) {
          return res.status(400).json({
            success: false,
            error: 'minScore must be a number between 0 and 100'
          });
        }
      }

      const data = await this.intelligenceService.getCohort({
        state: state.toUpperCase(),
        taxonomy: taxonomy || null,
        minScore: min
      });

      res.json({
        success: true,
        data,
        count: data.length
      });
    } catch (error) {
      logger.error('Error in getCohort:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to build cohort intelligence'
      });
    }
  }
}

module.exports = IntelligenceController;
