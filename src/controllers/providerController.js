const NpiService = require('../services/npiService');
const CmsDataService = require('../services/cmsDataService');
const ExclusionService = require('../services/exclusionService');
const { formatAsOf } = require('../services/exclusionService');
const { logger } = require('../utils/logger');
const { toCsv, sendCsv } = require('../utils/csv');

const TERMS = 'This report states what public sources published as of the ' +
  "dates shown. It does not certify any provider's status.";

const SOURCE_LABELS = {
  NPI_REGISTRY: 'NPI Registry'
};

class ProviderController {
  constructor() {
    this.npiService = new NpiService();
    this.cmsDataService = new CmsDataService();
    this.exclusionService = new ExclusionService();
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
        maxResults = 50,
        offset = 0
      } = req.query;

      if (!terms && !state && !city) {
        return res.status(400).json({
          error: 'At least one search criterion is required (terms, state, or city)'
        });
      }

      const limit = Number(maxResults);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return res.status(400).json({
          error: 'maxResults must be an integer between 1 and 500'
        });
      }

      const start = Number(offset);
      if (!Number.isInteger(start) || start < 0) {
        return res.status(400).json({
          error: 'Offset must be a non-negative integer'
        });
      }

      // Upstream hard limit: offset + count must not exceed 7500.
      if (start + limit > 7500) {
        return res.status(400).json({
          error: 'offset + maxResults must not exceed 7500'
        });
      }

      const criteria = {
        terms,
        state,
        city,
        taxonomy,
        maxResults: limit,
        offset: start
      };

      const { total, providers } = await this.npiService.searchProviders(criteria);

      // CSV export reuses the same search; only the serialization differs.
      if (req.query.format === 'csv') {
        const headers = [
          'npi', 'name', 'credential', 'taxonomy_code', 'taxonomy_description',
          'city', 'state', 'zip', 'phone'
        ];
        const csv = toCsv(headers, providers.map(p => [
          p.npi,
          p.name && p.name.full,
          p.name && p.name.credential,
          p.taxonomy && p.taxonomy.code,
          p.taxonomy && p.taxonomy.description,
          p.address && p.address.city,
          p.address && p.address.state,
          p.address && p.address.zipcode,
          p.address && p.address.phone
        ]));
        return sendCsv(res, 'provider-search.csv', csv);
      }

      res.json({
        success: true,
        data: providers,
        count: providers.length,
        total,
        offset: start,
        limit
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

      // Medical-cannabis certification when the NPI matches a certification
      // row (enriched NPI or cached license join); null when not certified.
      const cannabisCertification = await this.npiService.getCannabisCertification(npi);

      res.json({
        success: true,
        data: {
          ...provider,
          mipsPerformance: mipsData,
          cannabisCertification
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
   * Verification dossier: cached identity plus self-reported license
   * baseline plus LEIE exclusion resolution, every field carrying source
   * and as-of provenance.
   */
  async getVerification(req, res) {
    try {
      const { npi } = req.params;

      if (!this.npiService.validateNpiFormat(npi)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid NPI number format. Must be 10 digits.'
        });
      }

      // Cache-only lookup: the dossier reports what the cache holds and
      // never fans out to the NPI Registry at request time.
      const provider = await this.npiService.getCachedProvider(npi);

      if (!provider) {
        return res.status(404).json({
          success: false,
          error: 'Provider not found'
        });
      }

      const source = SOURCE_LABELS[provider.dataSource] || provider.dataSource || 'NPI Registry';
      const asOf = provider.sync_timestamp
        ? new Date(provider.sync_timestamp).toISOString().slice(0, 10)
        : null;
      const wrap = value => ({ value, source, asOf });

      // Identity mirrors the provider detail shape, each leaf wrapped with
      // provenance. The cache carries no DOB, so dob is null below.
      const identity = {
        npi: wrap(provider.npi),
        enumerationType: wrap(provider.enumerationType),
        name: {
          first: wrap(provider.name.first),
          middle: wrap(provider.name.middle),
          last: wrap(provider.name.last),
          credential: wrap(provider.name.credential),
          full: wrap(provider.name.full)
        },
        address: {
          line1: wrap(provider.address.line1),
          line2: wrap(provider.address.line2),
          city: wrap(provider.address.city),
          state: wrap(provider.address.state),
          zipcode: wrap(provider.address.zipcode),
          phone: wrap(provider.address.phone)
        },
        taxonomy: {
          code: wrap(provider.taxonomy.code),
          description: wrap(provider.taxonomy.description),
          grouping: wrap(provider.taxonomy.grouping)
        },
        license: {
          number: wrap(provider.license.number),
          state: wrap(provider.license.state)
        }
      };

      // License block: every license the provider self-reported to NPPES,
      // each value carrying its own source and as-of. These are self-reported
      // values, never a verified board status, so the note says exactly that.
      let licenseRows = [];
      try {
        licenseRows = await this.npiService.getCachedProviderLicenses(npi);
      } catch (licenseError) {
        logger.warn('Failed to load cached licenses for verification dossier:', licenseError.message);
      }
      const licenses = {
        note: 'Licenses are self-reported NPPES data, not verified board statuses.',
        values: (await Promise.all(licenseRows.map(async row => {
          const lSource = row.source || 'NPI Registry';
          const lAsOf = formatAsOf(row.as_of);
          const wrapL = value => ({ value, source: lSource, asOf: lAsOf });
          const entry = {
            number: wrapL(row.license_number),
            state: wrapL(row.issuing_state),
            isPrimaryTaxonomy: wrapL(row.is_primary_taxonomy === true),
            taxonomyCode: wrapL(row.taxonomy_code),
            taxonomyClassification: wrapL(row.taxonomy_classification),
            taxonomySpecialization: wrapL(row.taxonomy_specialization)
          };
          // Board-published status when an ingested state board row matches
          // this (state, license number); otherwise the license stays
          // baseline-only. No status is ever invented.
          try {
            const statusRow = await this.npiService.getCachedLicenseStatus(
              row.issuing_state, row.license_number
            );
            if (statusRow) {
              const vSource = statusRow.source;
              const vAsOf = formatAsOf(statusRow.as_of);
              const wrapV = value => ({ value, source: vSource, asOf: vAsOf });
              entry.verified = {
                status: wrapV(statusRow.status),
                expirationDate: wrapV(formatAsOf(statusRow.expiration_date)),
                disciplinaryStatus: wrapV(statusRow.disciplinary_status),
                source: vSource,
                asOf: vAsOf
              };
            }
          } catch (statusError) {
            logger.warn('Failed to load license status for verification dossier:', statusError.message);
          }
          return entry;
        })))
      };

      // The cache carries no DOB, so name-fallback checks from this endpoint
      // can never confirm a DOB; surface the status explicitly (null on the
      // NPI path) so consumers can rely on the field always being present.
      const exclusion = await this.exclusionService.resolveExclusion({
        npi: provider.npi,
        lastname: provider.name.last,
        firstname: provider.name.first,
        state: provider.address.state,
        dob: null
      });
      exclusion.dobStatus = exclusion.dobStatus || null;

      // Performance block: cache-only MIPS lookup, never a request-time
      // fan-out to CMS. Null when the provider has no cached score; the
      // dossier then simply omits the section.
      let performance = null;
      try {
        const year = new Date().getFullYear() - 1;
        const cached = await this.cmsDataService.getCachedMipsData(provider.npi, year);
        if (cached) {
          const mAsOf = cached.sync_timestamp
            ? new Date(cached.sync_timestamp).toISOString().slice(0, 10)
            : null;
          const mSource = 'CMS QPP Experience';
          const wrapM = value => ({ value, source: mSource, asOf: mAsOf });
          performance = {
            performanceYear: wrapM(cached.performanceYear),
            finalScore: wrapM(cached.finalScore),
            qualityScore: wrapM(cached.qualityScore),
            improvementActivitiesScore: wrapM(cached.improvementActivitiesScore),
            promotingInteroperabilityScore: wrapM(cached.promotingInteroperabilityScore),
            costScore: wrapM(cached.costScore)
          };
        }
      } catch (mipsError) {
        logger.warn('Failed to load cached MIPS data for verification dossier:', mipsError.message);
      }

      // Cannabis certification block: state-program certification when a
      // cannabis_certifications row matches (enriched NPI or cached license
      // join). Every value carries the certification row's own source and
      // as-of; null when the provider has no certification.
      let cannabisCertification = null;
      try {
        const cert = await this.npiService.getCannabisCertification(provider.npi);
        if (cert) {
          const cSource = cert.sourceName;
          const cAsOf = formatAsOf(cert.asOf);
          const wrapC = value => ({ value, source: cSource, asOf: cAsOf });
          cannabisCertification = {
            programName: wrapC(cert.programName),
            state: wrapC(cert.state),
            certificationStatus: wrapC(cert.certificationStatus),
            sourceUrl: wrapC(cert.sourceUrl)
          };
        }
      } catch (cannabisError) {
        logger.warn('Failed to load cannabis certification for verification dossier:', cannabisError.message);
      }

      const flagsSummary = exclusion.verdict === 'EXCLUDED'
        ? 'flags found'
        : exclusion.verdict === 'CLEAR'
          ? 'no flags found'
          : 'insufficient data';

      res.json({
        success: true,
        data: {
          npi,
          identity,
          licenses,
          exclusion,
          performance,
          cannabisCertification,
          flagsSummary,
          terms: TERMS
        }
      });
    } catch (error) {
      logger.error('Error in getVerification:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve provider verification'
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

      // CSV export: one row per cached year in the requested range, sourced
      // from the cache so archived per-year vintages and request-labeled
      // rolling rows are both represented.
      if (req.query.format === 'csv') {
        const startYear = parseInt(req.query.startYear) || 2018;
        const endYear = parseInt(req.query.endYear) || new Date().getFullYear() - 1;
        const rows = await this.cmsDataService.getMipsPerformanceHistory(
          npi,
          startYear,
          endYear
        );
        const headers = [
          'performance_year', 'final_score', 'quality_score',
          'improvement_activities_score', 'promoting_interoperability_score',
          'cost_score', 'performance_status', 'data_source', 'year_source'
        ];
        const csv = toCsv(headers, rows.map(r => [
          r.performanceYear,
          r.finalScore,
          r.qualityScore,
          r.improvementActivitiesScore,
          r.promotingInteroperabilityScore,
          r.costScore,
          r.performanceStatus,
          r.dataSource,
          r.yearSource
        ]));
        return sendCsv(res, `mips-performance-${npi}.csv`, csv);
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
   * Cannabis hub summary: per-state certification counts (listed vs matched
   * to provider profiles) from cannabis_certifications.
   */
  async getCannabisSummary(req, res) {
    try {
      const summary = await this.npiService.getCannabisSummary();

      res.json({
        success: true,
        data: summary,
        count: summary.length
      });
    } catch (error) {
      logger.error('Error in getCannabisSummary:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve cannabis summary'
      });
    }
  }
}

module.exports = ProviderController;
