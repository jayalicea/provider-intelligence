const AnalyticsService = require('../services/analyticsService');
const { logger } = require('../utils/logger');

const NPI_RE = /^\d{10}$/;
const MIN_YEAR = 2015;
// Archived QPP vintages the platform holds; the only years the taxonomy
// percentile materializer writes (see tools/build-taxonomy-percentiles.js).
const ARCHIVE_YEARS = [2018, 2019, 2020, 2022, 2023, 2024];

function currentYear() {
  return new Date().getFullYear();
}

class AnalyticsController {
  constructor() {
    this.analyticsService = new AnalyticsService();
  }

  parseYear(raw, { required, name = 'year' } = {}) {
    if (raw === undefined || raw === null || raw === '') {
      return required ? { error: `${name} is required` } : { value: null };
    }
    const year = Number(raw);
    if (!Number.isInteger(year) || year < MIN_YEAR || year > currentYear()) {
      return { error: `Invalid ${name}. Must be an integer between ${MIN_YEAR} and ${currentYear()}` };
    }
    return { value: year };
  }

  /**
   * GET /group-performance?npis=<csv>&year=
   */
  async getGroupPerformance(req, res) {
    try {
      const { npis: npisRaw } = req.query;
      const yearParsed = this.parseYear(req.query.year, { required: true });
      if (yearParsed.error) {
        return res.status(400).json({ success: false, error: yearParsed.error });
      }

      if (!npisRaw || typeof npisRaw !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'npis is required (comma-separated list of 10-digit NPI numbers)'
        });
      }

      const npis = [...new Set(npisRaw.split(',').map(n => n.trim()).filter(Boolean))];
      if (npis.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'npis is required (comma-separated list of 10-digit NPI numbers)'
        });
      }
      if (npis.length > 100) {
        return res.status(400).json({
          success: false,
          error: 'npis supports at most 100 NPI numbers per request'
        });
      }
      const invalid = npis.find(n => !NPI_RE.test(n));
      if (invalid) {
        return res.status(400).json({
          success: false,
          error: `Invalid NPI number format: ${invalid}`
        });
      }

      const data = await this.analyticsService.getGroupPerformance(npis, yearParsed.value);
      res.json({ success: true, data });
    } catch (error) {
      logger.error('Error in getGroupPerformance:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate group performance analytics'
      });
    }
  }

  /**
   * GET /ranking/:npi?year=&taxonomy=
   */
  async getRanking(req, res) {
    try {
      const { npi } = req.params;
      if (!NPI_RE.test(npi)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid NPI number format'
        });
      }

      const yearParsed = this.parseYear(req.query.year, { required: true });
      if (yearParsed.error) {
        return res.status(400).json({ success: false, error: yearParsed.error });
      }

      const taxonomy = req.query.taxonomy
        ? String(req.query.taxonomy).trim().toUpperCase()
        : null;
      if (taxonomy && (taxonomy.length < 3 || taxonomy.length > 10)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid taxonomy code'
        });
      }

      const ranking = await this.analyticsService.getRanking(npi, yearParsed.value, taxonomy);
      if (!ranking) {
        return res.status(404).json({
          success: false,
          error: `No MIPS performance data found for NPI ${npi} in year ${yearParsed.value}`
        });
      }

      res.json({ success: true, data: ranking });
    } catch (error) {
      logger.error('Error in getRanking:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to calculate provider ranking'
      });
    }
  }

  /**
   * GET /trends/:npi?startYear=&endYear=
   */
  async getTrends(req, res) {
    try {
      const { npi } = req.params;
      if (!NPI_RE.test(npi)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid NPI number format'
        });
      }

      const startParsed = this.parseYear(req.query.startYear, { name: 'startYear' });
      if (startParsed.error) {
        return res.status(400).json({ success: false, error: startParsed.error });
      }
      const endParsed = this.parseYear(req.query.endYear, { name: 'endYear' });
      if (endParsed.error) {
        return res.status(400).json({ success: false, error: endParsed.error });
      }

      const startYear = startParsed.value ?? MIN_YEAR;
      const endYear = endParsed.value ?? currentYear() - 1;
      if (startYear > endYear) {
        return res.status(400).json({
          success: false,
          error: 'startYear must be less than or equal to endYear'
        });
      }

      const data = await this.analyticsService.getTrends(npi, startYear, endYear);
      res.json({ success: true, data });
    } catch (error) {
      logger.error('Error in getTrends:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate performance trend analysis'
      });
    }
  }

  /**
   * GET /percentile-trends/:npi
   * 404 when the npi's taxonomy cannot be resolved (documented in
   * docs/openapi.yaml); the service response carries an explicit reason.
   */
  async getPercentileTrends(req, res) {
    try {
      const { npi } = req.params;
      if (!NPI_RE.test(npi)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid NPI number format'
        });
      }

      const data = await this.analyticsService.getPercentileTrends(npi);
      if (!data.taxonomy) {
        return res.status(404).json({
          success: false,
          error: `No primary taxonomy on record for NPI ${npi}`
        });
      }

      res.json({ success: true, data });
    } catch (error) {
      logger.error('Error in getPercentileTrends:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate percentile trend analysis'
      });
    }
  }

  /**
   * GET /taxonomy-benchmark?taxonomy=&year=
   * Archive years only; 404 when the taxonomy-year pair is not
   * materialized in taxonomy_percentiles.
   */
  async getTaxonomyBenchmark(req, res) {
    try {
      const taxonomyRaw = req.query.taxonomy;
      if (!taxonomyRaw || typeof taxonomyRaw !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'taxonomy is required (an NPPES taxonomy code such as 207Q00000X)'
        });
      }
      const taxonomy = taxonomyRaw.trim().toUpperCase();
      if (!/^[0-9A-Z]{3,10}$/.test(taxonomy)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid taxonomy code. Must be 3-10 letters or digits'
        });
      }

      const yearParsed = this.parseYear(req.query.year, { required: true });
      if (yearParsed.error) {
        return res.status(400).json({ success: false, error: yearParsed.error });
      }
      if (!ARCHIVE_YEARS.includes(yearParsed.value)) {
        return res.status(400).json({
          success: false,
          error: `year must be one of the archive performance years: ${ARCHIVE_YEARS.join(', ')}`
        });
      }

      const data = await this.analyticsService.getTaxonomyBenchmark(taxonomy, yearParsed.value);
      if (!data) {
        return res.status(404).json({
          success: false,
          error: `No benchmark data is materialized for taxonomy ${taxonomy} in year ${yearParsed.value}`
        });
      }

      res.json({ success: true, data });
    } catch (error) {
      logger.error('Error in getTaxonomyBenchmark:', error);
      const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500;
      res.status(status).json({
        success: false,
        error: status === 500
          ? 'Failed to generate taxonomy benchmark report'
          : error.message
      });
    }
  }

  /**
   * GET /benchmark/:npi?year=
   */
  async getBenchmark(req, res) {
    try {
      const { npi } = req.params;
      if (!NPI_RE.test(npi)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid NPI number format'
        });
      }

      const yearParsed = this.parseYear(req.query.year, { required: true });
      if (yearParsed.error) {
        return res.status(400).json({ success: false, error: yearParsed.error });
      }

      const benchmark = await this.analyticsService.getBenchmark(npi, yearParsed.value);
      if (!benchmark) {
        return res.status(404).json({
          success: false,
          error: `No MIPS performance data found for NPI ${npi} in year ${yearParsed.value}`
        });
      }

      res.json({ success: true, data: benchmark });
    } catch (error) {
      logger.error('Error in getBenchmark:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate benchmark comparison'
      });
    }
  }
}

module.exports = AnalyticsController;
