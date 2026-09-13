const IntelligenceService = require('../services/intelligenceService');
const {
  WATCHLIST_DEFAULT_DAYS,
  WATCHLIST_MAX_DAYS,
  ROSTER_MAX_ROWS
} = IntelligenceService;
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

  /**
   * GET /api/v1/intelligence/exclusion-watchlist?state=&days=
   * Recently added, still-active LEIE exclusions, newest first.
   */
  async getExclusionWatchlist(req, res) {
    try {
      const { state, days } = req.query;

      if (state !== undefined && state !== '' && !/^[A-Za-z]{2}$/.test(state)) {
        return res.status(400).json({
          success: false,
          error: 'state must be a 2-letter code'
        });
      }

      let window = WATCHLIST_DEFAULT_DAYS;
      if (days !== undefined && days !== '') {
        window = Number(days);
        if (!Number.isInteger(window) || window < 1 || window > WATCHLIST_MAX_DAYS) {
          return res.status(400).json({
            success: false,
            error: `days must be an integer between 1 and ${WATCHLIST_MAX_DAYS}`
          });
        }
      }

      const data = await this.intelligenceService.getExclusionWatchlist({
        state: state ? state.toUpperCase() : null,
        days: window
      });

      res.json({
        success: true,
        data: data.rows,
        count: data.rows.length,
        windowDays: data.windowDays,
        state: data.state,
        capped: data.capped
      });
    } catch (error) {
      logger.error('Error in getExclusionWatchlist:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to build exclusion watchlist'
      });
    }
  }

  /**
   * POST /api/v1/intelligence/screen-roster
   * Body: { rows: [{ npi, lastname, firstname, state, dob, organizationName }] }
   *
   * The client parses the CSV and posts rows, so no file is uploaded and none
   * is retained. Rows are screened in memory and returned; nothing is stored.
   */
  async screenRoster(req, res) {
    try {
      const rows = req.body && req.body.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'rows must be a non-empty array'
        });
      }
      if (rows.length > ROSTER_MAX_ROWS) {
        return res.status(400).json({
          success: false,
          error: `rows exceeds the ${ROSTER_MAX_ROWS} row limit for one screen`
        });
      }
      if (rows.some(r => r === null || typeof r !== 'object' || Array.isArray(r))) {
        return res.status(400).json({
          success: false,
          error: 'every row must be an object'
        });
      }

      const data = await this.intelligenceService.screenRoster(rows);

      res.json({
        success: true,
        data: data.results,
        count: data.screened,
        counts: data.counts,
        submitted: data.submitted,
        truncated: data.truncated
      });
    } catch (error) {
      logger.error('Error in screenRoster:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to screen roster'
      });
    }
  }
}

module.exports = IntelligenceController;
