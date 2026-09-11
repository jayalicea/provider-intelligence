const NpiService = require('../services/npiService');
const CmsDataService = require('../services/cmsDataService');
const { logger } = require('../utils/logger');

class ProviderController {
  constructor() {
    this.npiService = new NpiService();
    this.cmsDataService = new CmsDataService();
  }

  /**
   * Search for providers
   */
  async searchProviders(req, res) {
    try {
      const {
        terms,
        state,
        city,
        taxonomy,
        maxResults = 50
      } = req.query;

      if (!terms && !state && !city) {
        return res.status(400).json({
          error: 'At least one search criterion is required (terms, state, or city)'
        });
      }

      const criteria = {
        terms,
        state,
        city,
        taxonomy,
        maxResults: parseInt(maxResults) || 50
      };

      const providers = await this.npiService.searchProviders(criteria);

      res.json({
        success: true,
        data: providers,
        count: providers.length
      });
    } catch (error) {
      logger.error('Error in searchProviders:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to search for providers'
      });
    }
  }

  /**
   * Get provider details by NPI
   */
  async getProvider(req, res) {
    try {
      const { npi } = req.params;

      if (!this.npiService.validateNpiFormat(npi)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid NPI number format. Must be 10 digits.'
        });
      }

      const provider = await this.npiService.getProviderByNpi(npi);

      if (!provider) {
        return res.status(404).json({
          success: false,
          error: 'Provider not found'
        });
      }

      // Get MIPS performance data if requested
      let mipsData = null;
      if (req.query.includeMips === 'true') {
        try {
          const currentYear = new Date().getFullYear();
          mipsData = await this.cmsDataService.getMipsPerformance(
            npi,
            currentYear - 1 // Previous year's data is typically available
          );
        } catch (mipsError) {
          logger.warn('Failed to fetch MIPS data:', mipsError.message);
        }
      }

      res.json({
        success: true,
        data: {
          ...provider,
          mipsPerformance: mipsData
        }
      });
    } catch (error) {
      logger.error('Error in getProvider:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve provider information'
      });
    }
  }

  /**
   * Get MIPS performance data for a provider
   */
  async getMipsPerformance(req, res) {
    try {
      const { npi } = req.params;
      const year = parseInt(req.query.year) || new Date().getFullYear() - 1;

      if (!this.npiService.validateNpiFormat(npi)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid NPI number format'
        });
      }

      const mipsData = await this.cmsDataService.getMipsPerformance(npi, year);

      if (!mipsData) {
        return res.status(404).json({
          success: false,
          error: `No MIPS performance data found for NPI ${npi} in year ${year}`
        });
      }

      res.json({
        success: true,
        data: mipsData
      });
    } catch (error) {
      logger.error('Error in getMipsPerformance:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve MIPS performance data'
      });
    }
  }

  /**
   * Get MIPS performance trends for a provider
   */
  async getMipsTrends(req, res) {
    try {
      const { npi } = req.params;
      const startYear = parseInt(req.query.startYear) || 2018;
      const endYear = parseInt(req.query.endYear) || new Date().getFullYear() - 1;

      if (!this.npiService.validateNpiFormat(npi)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid NPI number format'
        });
      }

      const trends = await this.cmsDataService.getMipsPerformanceTrends(
        npi,
        startYear,
        endYear
      );

      res.json({
        success: true,
        data: {
          npi,
          performanceYears: trends.map(t => t.performanceYear),
          finalScores: trends.map(t => t.finalScore),
          qualityScores: trends.map(t => t.qualityScore),
          improvementActivitiesScores: trends.map(t => t.improvementActivitiesScore),
          promotingInteroperabilityScores: trends.map(t => t.promotingInteroperabilityScore),
          costScores: trends.map(t => t.costScore)
        }
      });
    } catch (error) {
      logger.error('Error in getMipsTrends:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve MIPS performance trends'
      });
    }
  }

  /**
   * Get quality measures for a facility
   */
  async getQualityMeasures(req, res) {
    try {
      const { facilityId } = req.params;
      const measureType = req.query.type || 'all';

      if (!facilityId) {
        return res.status(400).json({
          success: false,
          error: 'Facility ID is required'
        });
      }

      const measures = await this.cmsDataService.getQualityMeasures(
        facilityId,
        measureType
      );

      res.json({
        success: true,
        data: measures,
        count: measures.length
      });
    } catch (error) {
      logger.error('Error in getQualityMeasures:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve quality measure data'
      });
    }
  }

  /**
   * Bulk provider search and MIPS data retrieval
   */
  async bulkProviderData(req, res) {
    try {
      const { npis, performanceYear } = req.body;

      if (!npis || !Array.isArray(npis)) {
        return res.status(400).json({
          success: false,
          error: 'NPI array is required'
        });
      }

      // Validate NPI formats
      const validNpis = npis.filter(npi => this.npiService.validateNpiFormat(npi));

      if (validNpis.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid NPI numbers provided'
        });
      }

      const year = performanceYear || new Date().getFullYear() - 1;

      // Fetch MIPS data for all providers
      const mipsData = await this.cmsDataService.getBulkMipsPerformance(
        validNpis,
        year
      );

      res.json({
        success: true,
        data: {
          totalRequested: npis.length,
          totalValid: validNpis.length,
          performanceYear: year,
          results: mipsData
        }
      });
    } catch (error) {
      logger.error('Error in bulkProviderData:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve bulk provider data'
      });
    }
  }
}

module.exports = ProviderController;
