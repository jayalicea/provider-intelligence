const { ApiClient } = require('../utils/apiClient');
const apiConfig = require('../config/api-config');
const { logger } = require('../utils/logger');
const db = require('../config/database');

class CmsDataService {
  constructor() {
    this.cmsClient = new ApiClient(apiConfig.cmsOpenData);
    this.catalogClient = new ApiClient(apiConfig.providerDataCatalog);
  }

  /**
   * Get MIPS performance data for a specific provider
   */
  async getMipsPerformance(npi, performanceYear) {
    try {
      // Check cache first
      const cached = await this.getCachedMipsData(npi, performanceYear);
      if (cached && !this.isCacheExpired(cached)) {
        return cached;
      }

      const datasetId = apiConfig.mipsDataset;

      // Build filter for specific NPI
      const params = {
        'filter[npi]': npi,
        size: 10
      };

      const response = await this.cmsClient.get(
        `/dataset/${datasetId}/data`,
        params
      );

      // The data API returns a bare JSON array (not an envelope)
      const rows = Array.isArray(response) ? response : (response.data || []);
      if (rows.length === 0) {
        return null;
      }

      const mipsData = this.transformMipsResponse(rows[0]);
      // The dataset has no year column (single rolling vintage); label the
      // row with the year the caller requested.
      mipsData.performanceYear = performanceYear;

      // Cache the result
      await this.cacheMipsData(npi, performanceYear, mipsData);

      return mipsData;
    } catch (error) {
      logger.error(`Error fetching MIPS data for NPI ${npi}:`, error);
      throw new Error('Failed to retrieve MIPS performance data');
    }
  }

  /**
   * Get MIPS performance data for multiple providers
   */
  async getBulkMipsPerformance(npis, performanceYear) {
    try {
      const results = [];

      // Process in batches to avoid rate limiting
      const batchSize = 10;
      const batches = this.chunkArray(npis, batchSize);

      for (const batch of batches) {
        const batchPromises = batch.map(async (npi) => {
          try {
            const data = await this.getMipsPerformance(npi, performanceYear);
            if (data) {
              results.push(data);
            }
          } catch (error) {
            logger.warn(`Failed to fetch MIPS data for NPI ${npi}:`, error.message);
          }
        });

        await Promise.all(batchPromises);

        // Rate limiting delay between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      return results;
    } catch (error) {
      logger.error('Error in bulk MIPS data fetch:', error);
      throw new Error('Failed to retrieve bulk MIPS performance data');
    }
  }

  /**
   * Get quality measures for a facility/provider
   */
  async getQualityMeasures(facilityId, measureType = 'all') {
    try {
      const type = measureType === 'all' ? 'complications' : measureType;
      const datasetId = this.getQualityDatasetId(type);

      // Check cache first (returns [] when missing or expired)
      const cached = await this.getCachedQualityMeasures(facilityId, type);
      if (cached.length > 0) {
        return cached;
      }

      // Query the provider-data datastore API
      const params = {
        'conditions[0][property]': 'facility_id',
        'conditions[0][value]': facilityId,
        'conditions[0][operator]': '=',
        limit: 500
      };

      const response = await this.catalogClient.get(
        `/datastore/query/${datasetId}/0`,
        params
      );

      const rows = response && Array.isArray(response.results) ? response.results : [];
      const measures = this.transformQualityMeasuresResponse(rows);

      // Cache the result
      if (measures.length > 0) {
        await this.cacheQualityMeasures(facilityId, type, measures);
      }

      return measures;
    } catch (error) {
      logger.error(`Error fetching quality measures for ${facilityId}:`, error);
      throw new Error('Failed to retrieve quality measure data');
    }
  }

  /**
   * Get MIPS performance trends for a provider over multiple years
   */
  async getMipsPerformanceTrends(npi, startYear, endYear) {
    try {
      const years = Array.from({ length: endYear - startYear + 1 }, (_, i) =>
        startYear + i
      );

      const trends = await Promise.all(
        years.map(year => this.getMipsPerformance(npi, year))
      );

      return trends.filter(trend => trend !== null);
    } catch (error) {
      logger.error(`Error fetching MIPS trends for NPI ${npi}:`, error);
      throw new Error('Failed to retrieve MIPS performance trends');
    }
  }

  /**
   * Transform MIPS API response to standard format.
   * Column names are those of the live "Quality Payment Program Experience"
   * dataset (lowercase with spaces); several doc-era fields have no
   * equivalent and map to null.
   */
  transformMipsResponse(apiData) {
    return {
      npi: apiData['npi'],

      // Overall score
      finalScore: this.parseDecimal(apiData['final score']),
      overallCategoryScore: null,

      // Category-specific scores
      qualityScore: this.parseDecimal(apiData['quality category score']),
      improvementActivitiesScore: this.parseDecimal(
        apiData['improvement activities (ia) category score']
      ),
      promotingInteroperabilityScore: this.parseDecimal(
        apiData['promoting interoperability (pi) category score']
      ),
      costScore: this.parseDecimal(apiData['cost category score']),

      // Participation context (closest equivalents to the doc's fields)
      performanceStatus: apiData['participation option'],
      reportingEntityType: apiData['reporting option'],
      groupSizeCategory: null
    };
  }

  /**
   * Transform quality measures response.
   * Column names are the datastore API's lowercase machine names, which
   * differ from the human-readable names the doc assumed.
   */
  transformQualityMeasuresResponse(apiData) {
    return (apiData || []).map(item => ({
      facilityId: item['facility_id'],
      measureId: item['measure_id'],
      measureName: item['measure_name'],
      score: this.parseDecimal(item['score']),
      denominator: parseInt(item['denominator']) || null,
      lowerEstimate: this.parseDecimal(item['lower_estimate']),
      higherEstimate: this.parseDecimal(item['higher_estimate']),
      comparedToNational: item['compared_to_national'],
      startDate: this.toIsoDate(item['start_date']),
      endDate: this.toIsoDate(item['end_date'])
    }));
  }

  /**
   * Normalize a date value to ISO YYYY-MM-DD. Accepts the datastore's
   * MM/DD/YYYY strings and ISO strings (as returned by the DATE column).
   */
  toIsoDate(value) {
    if (!value || typeof value !== 'string') return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
  }

  /**
   * Parse decimal value from string (handles footnote codes)
   */
  parseDecimal(value) {
    if (!value || typeof value !== 'string') return null;

    // Check for non-numeric values (footnote codes)
    const numericValue = parseFloat(value);
    return isNaN(numericValue) ? null : numericValue;
  }

  /**
   * Get dataset ID based on measure type
   */
  getQualityDatasetId(measureType) {
    const datasets = apiConfig.qualityDatasets;
    return datasets[measureType] || datasets.complications; // Default to complications
  }

  /**
   * Cache MIPS data in database
   */
  async cacheMipsData(npi, performanceYear, mipsData) {
    try {
      const query = `
        INSERT INTO mips_performance_scores (
          npi, performance_year, final_score, overall_category_score,
          quality_score, improvement_activities_score,
          promoting_interoperability_score, cost_score,
          performance_status, reporting_entity_type, group_size_category
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (npi, performance_year) DO UPDATE SET
          final_score = EXCLUDED.final_score,
          overall_category_score = EXCLUDED.overall_category_score,
          quality_score = EXCLUDED.quality_score,
          improvement_activities_score = EXCLUDED.improvement_activities_score,
          promoting_interoperability_score = EXCLUDED.promoting_interoperability_score,
          cost_score = EXCLUDED.cost_score,
          performance_status = EXCLUDED.performance_status,
          sync_timestamp = CURRENT_TIMESTAMP
      `;

      await db.query(query, [
        npi,
        performanceYear,
        mipsData.finalScore,
        mipsData.overallCategoryScore,
        mipsData.qualityScore,
        mipsData.improvementActivitiesScore,
        mipsData.promotingInteroperabilityScore,
        mipsData.costScore,
        mipsData.performanceStatus,
        mipsData.reportingEntityType,
        mipsData.groupSizeCategory
      ]);
    } catch (error) {
      logger.error('Error caching MIPS data:', error);
    }
  }

  /**
   * Get cached MIPS data from database
   */
  async getCachedMipsData(npi, performanceYear) {
    try {
      const result = await db.query(
        'SELECT * FROM mips_performance_scores WHERE npi = $1 AND performance_year = $2',
        [npi, performanceYear]
      );

      return this.normalizeMipsRow(result.rows[0]);
    } catch (error) {
      logger.error('Error fetching cached MIPS data:', error);
      return null;
    }
  }

  /**
   * Map a mips_performance_scores row back to the API response shape so
   * cache hits return the same camelCase structure as fresh API transforms.
   */
  normalizeMipsRow(row) {
    if (!row) return null;
    const num = v => (v === null || v === undefined ? null : Number(v));
    return {
      npi: row.npi,
      performanceYear: row.performance_year,
      finalScore: num(row.final_score),
      overallCategoryScore: num(row.overall_category_score),
      qualityScore: num(row.quality_score),
      improvementActivitiesScore: num(row.improvement_activities_score),
      promotingInteroperabilityScore: num(row.promoting_interoperability_score),
      costScore: num(row.cost_score),
      performanceStatus: row.performance_status,
      reportingEntityType: row.reporting_entity_type,
      groupSizeCategory: row.group_size_category
    };
  }

  /**
   * Check if cache is expired (1 hour for performance data)
   */
  isCacheExpired(data) {
    if (!data || !data.sync_timestamp) return true;

    const lastSync = new Date(data.sync_timestamp);
    const now = new Date();
    const hoursSinceSync = (now - lastSync) / (1000 * 60 * 60);

    return hoursSinceSync > 1;
  }

  /**
   * Data source tag for cached quality rows (one per measure family)
   */
  qualityDataSource(measureType) {
    return `CARE_COMPARE_${String(measureType).toUpperCase()}`;
  }

  /**
   * Get cached quality measures from database.
   * Returns [] when there are no rows or the newest row is older than 1 hour.
   */
  async getCachedQualityMeasures(facilityId, measureType) {
    try {
      const result = await db.query(
        `SELECT facility_id, measure_id, measure_name, score, denominator,
                lower_estimate, higher_estimate, compared_to_national,
                reporting_period_start, reporting_period_end, sync_timestamp
         FROM quality_measures
         WHERE facility_id = $1 AND data_source = $2`,
        [facilityId, this.qualityDataSource(measureType)]
      );

      if (result.rows.length === 0) return [];

      const newestSync = Math.max(
        ...result.rows.map(r => new Date(r.sync_timestamp).getTime())
      );
      if ((Date.now() - newestSync) / (1000 * 60 * 60) > 1) return [];

      return result.rows.map(row => this.normalizeQualityRow(row));
    } catch (error) {
      logger.error('Error fetching cached quality measures:', error);
      return [];
    }
  }

  /**
   * Map a quality_measures table row back to the API response shape
   */
  normalizeQualityRow(row) {
    const num = v => (v === null || v === undefined ? null : Number(v));
    return {
      facilityId: row.facility_id,
      measureId: row.measure_id,
      measureName: row.measure_name,
      score: num(row.score),
      denominator: row.denominator,
      lowerEstimate: num(row.lower_estimate),
      higherEstimate: num(row.higher_estimate),
      comparedToNational: row.compared_to_national,
      startDate: this.toIsoDate(row.reporting_period_start),
      endDate: this.toIsoDate(row.reporting_period_end)
    };
  }

  /**
   * Cache quality measures in database (replaces the facility/family rows)
   */
  async cacheQualityMeasures(facilityId, measureType, measures) {
    try {
      await db.query(
        'DELETE FROM quality_measures WHERE facility_id = $1 AND data_source = $2',
        [facilityId, this.qualityDataSource(measureType)]
      );

      const query = `
        INSERT INTO quality_measures (
          facility_id, measure_id, measure_name, score, denominator,
          lower_estimate, higher_estimate, compared_to_national,
          reporting_period_start, reporting_period_end, data_source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `;

      for (const m of measures) {
        await db.query(query, [
          facilityId,
          m.measureId,
          m.measureName,
          m.score,
          m.denominator,
          m.lowerEstimate,
          m.higherEstimate,
          m.comparedToNational,
          m.startDate,
          m.endDate,
          this.qualityDataSource(measureType)
        ]);
      }
    } catch (error) {
      logger.error('Error caching quality measures:', error);
    }
  }

  /**
   * Chunk array into smaller batches
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

module.exports = CmsDataService;
