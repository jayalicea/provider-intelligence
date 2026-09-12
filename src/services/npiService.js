const { ApiClient } = require('../utils/apiClient');
const apiConfig = require('../config/api-config');
const { logger } = require('../utils/logger');
const db = require('../config/database');

// Leaf fields requested via `ef`. The API returns them as parallel arrays
// keyed by dotted path; non-leaf objects (e.g. `licenses`) come back as
// JSON strings and are not usable, so we request leaf paths instead.
const EXTRA_FIELDS = [
  'name.full', 'name.first', 'name.middle', 'name.last', 'name.credential',
  'addr_practice.line1', 'addr_practice.line2', 'addr_practice.city',
  'addr_practice.state', 'addr_practice.zip', 'addr_practice.phone',
  'licenses.taxonomy.code', 'licenses.taxonomy.grouping',
  'licenses.lic_number', 'licenses.issuing_state'
].join(',');

class NpiService {
  constructor() {
    this.npiClient = new ApiClient(apiConfig.npiRegistry);
  }

  /**
   * Search for providers by various criteria
   */
  async searchProviders(criteria) {
    try {
      const params = {
        terms: criteria.terms || '',
        maxList: criteria.maxResults || 50,
        df: 'NPI,name.full,provider_type,addr_practice.full',
        ef: EXTRA_FIELDS
      };

      // Add additional filters based on criteria
      if (criteria.state) {
        params.q = `addr_practice.state:${criteria.state}`;
      }

      if (criteria.city) {
        params.q = `${params.q || ''} addr_practice.city:${criteria.city}`;
      }

      if (criteria.taxonomy) {
        params.q = `${params.q || ''} licenses.taxonomy.code:${criteria.taxonomy}`;
      }

      const response = await this.npiClient.get(
        apiConfig.npiRegistry.endpoints.individual,
        params
      );

      return this.transformNpiResponse(response);
    } catch (error) {
      logger.error('Error searching NPI registry:', error);
      throw new Error('Failed to search provider registry');
    }
  }

  /**
   * Get detailed provider information by NPI number
   */
  async getProviderByNpi(npiNumber) {
    try {
      // First, check cache/database
      const cached = await this.getCachedProvider(npiNumber);
      if (cached && !this.isCacheExpired(cached)) {
        return cached;
      }

      // Fetch from NPI Registry API
      const params = {
        terms: npiNumber,
        maxList: 1,
        df: 'NPI,name.full,provider_type,addr_practice.full',
        ef: EXTRA_FIELDS
      };

      const response = await this.npiClient.get(
        apiConfig.npiRegistry.endpoints.individual,
        params
      );

      const providers = this.transformNpiResponse(response);
      if (providers.length === 0) {
        throw new Error(`Provider with NPI ${npiNumber} not found`);
      }

      const providerData = providers[0];

      // Cache the result
      await this.cacheProvider(npiNumber, providerData);

      return providerData;
    } catch (error) {
      logger.error(`Error fetching provider ${npiNumber}:`, error);
      throw new Error('Failed to retrieve provider information');
    }
  }

  /**
   * Validate NPI number format
   */
  validateNpiFormat(npiNumber) {
    // Basic NPI validation - must be 10 digits
    const npiRegex = /^\d{10}$/;
    return npiRegex.test(npiNumber);
  }

  /**
   * Transform NPI API response to standard format.
   * The Clinical Tables API returns a 4-element envelope:
   *   [totalCount, [NPI, ...], {extraField: [values...]}, [[display fields]]]
   * `df` only controls which display fields appear; field values we rely on
   * come from `ef` (parallel arrays) or npis, except provider_type, which is
   * a computed display field at row index 2 in both observed row orders
   * ([name, NPI, provider_type, addr] and [NPI, name, provider_type, addr]).
   */
  transformNpiResponse(apiResponse) {
    if (!Array.isArray(apiResponse) || apiResponse.length < 4 || !Array.isArray(apiResponse[3])) {
      return [];
    }

    const npis = apiResponse[1] || [];
    const extra = apiResponse[2] || {};
    const rows = apiResponse[3];

    const fieldAt = (field, i) =>
      Array.isArray(extra[field]) ? extra[field][i] : undefined;

    return rows.map((row, i) => ({
      npi: npis[i] || '',
      enumerationType: 'Individual',
      name: {
        first: fieldAt('name.first', i) || '',
        middle: fieldAt('name.middle', i) || '',
        last: fieldAt('name.last', i) || '',
        credential: fieldAt('name.credential', i) || '',
        full: fieldAt('name.full', i) || ''
      },
      address: {
        line1: fieldAt('addr_practice.line1', i) || '',
        line2: fieldAt('addr_practice.line2', i) || '',
        city: fieldAt('addr_practice.city', i) || '',
        state: fieldAt('addr_practice.state', i) || '',
        zipcode: fieldAt('addr_practice.zip', i) || '',
        phone: fieldAt('addr_practice.phone', i) || ''
      },
      taxonomy: {
        code: fieldAt('licenses.taxonomy.code', i) || '',
        description: row[2] || '',
        grouping: fieldAt('licenses.taxonomy.grouping', i) || ''
      },
      license: {
        number: fieldAt('licenses.lic_number', i) || '',
        state: fieldAt('licenses.issuing_state', i) || ''
      }
    }));
  }

  /**
   * Cache provider data in database. Caches every field the schema holds so
   * cache hits return the same data as fresh API transforms.
   */
  async cacheProvider(npi, providerData) {
    try {
      const query = `
        INSERT INTO providers (
          npi, enumeration_type, name_first, name_middle, name_last, name_full,
          name_credential, provider_type, primary_taxonomy_code,
          primary_taxonomy_description, taxonomy_grouping,
          practice_address_line1, practice_address_line2, practice_city,
          practice_state, practice_zipcode, practice_phone,
          license_number, license_issuing_state, created_date, last_updated_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT (npi) DO UPDATE SET
          name_first = EXCLUDED.name_first,
          name_middle = EXCLUDED.name_middle,
          name_last = EXCLUDED.name_last,
          name_full = EXCLUDED.name_full,
          name_credential = EXCLUDED.name_credential,
          provider_type = EXCLUDED.provider_type,
          primary_taxonomy_code = EXCLUDED.primary_taxonomy_code,
          primary_taxonomy_description = EXCLUDED.primary_taxonomy_description,
          taxonomy_grouping = EXCLUDED.taxonomy_grouping,
          practice_address_line1 = EXCLUDED.practice_address_line1,
          practice_address_line2 = EXCLUDED.practice_address_line2,
          practice_city = EXCLUDED.practice_city,
          practice_state = EXCLUDED.practice_state,
          practice_zipcode = EXCLUDED.practice_zipcode,
          practice_phone = EXCLUDED.practice_phone,
          license_number = EXCLUDED.license_number,
          license_issuing_state = EXCLUDED.license_issuing_state,
          last_updated_date = EXCLUDED.last_updated_date,
          sync_timestamp = CURRENT_TIMESTAMP
      `;

      await db.query(query, [
        npi,
        providerData.enumerationType,
        providerData.name.first,
        providerData.name.middle,
        providerData.name.last,
        providerData.name.full,
        providerData.name.credential,
        providerData.taxonomy.description,
        providerData.taxonomy.code,
        providerData.taxonomy.description,
        providerData.taxonomy.grouping,
        providerData.address.line1,
        providerData.address.line2,
        providerData.address.city,
        providerData.address.state,
        providerData.address.zipcode,
        providerData.address.phone,
        providerData.license.number,
        providerData.license.state,
        new Date(),
        new Date()
      ]);
    } catch (error) {
      logger.error('Error caching provider data:', error);
    }
  }

  /**
   * Get cached provider from database
   */
  async getCachedProvider(npi) {
    try {
      const result = await db.query(
        'SELECT * FROM providers WHERE npi = $1',
        [npi]
      );

      return this.normalizeProviderRow(result.rows[0]);
    } catch (error) {
      logger.error('Error fetching cached provider:', error);
      return null;
    }
  }

  /**
   * Map a providers table row back to the API response shape so cache hits
   * return the same structure as fresh API transforms.
   */
  normalizeProviderRow(row) {
    if (!row) return null;
    const normalized = {
      npi: row.npi,
      enumerationType: row.enumeration_type,
      name: {
        first: row.name_first || '',
        middle: row.name_middle || '',
        last: row.name_last || '',
        credential: row.name_credential || '',
        full: row.name_full ||
          [row.name_first, row.name_middle, row.name_last].filter(Boolean).join(' ')
      },
      address: {
        line1: row.practice_address_line1 || '',
        line2: row.practice_address_line2 || '',
        city: row.practice_city || '',
        state: row.practice_state || '',
        zipcode: row.practice_zipcode || '',
        phone: row.practice_phone || ''
      },
      taxonomy: {
        code: row.primary_taxonomy_code || '',
        description: row.primary_taxonomy_description || row.provider_type || '',
        grouping: row.taxonomy_grouping || ''
      },
      license: {
        number: row.license_number || '',
        state: row.license_issuing_state || ''
      }
    };
    // Carry sync_timestamp for isCacheExpiry checks without exposing it in
    // JSON responses.
    Object.defineProperty(normalized, 'sync_timestamp', {
      value: row.sync_timestamp,
      enumerable: false
    });
    return normalized;
  }

  /**
   * Check if cache is expired (24 hours)
   */
  isCacheExpired(data) {
    if (!data || !data.sync_timestamp) return true;

    const lastSync = new Date(data.sync_timestamp);
    const now = new Date();
    const hoursSinceSync = (now - lastSync) / (1000 * 60 * 60);

    return hoursSinceSync > 24;
  }
}

module.exports = NpiService;
