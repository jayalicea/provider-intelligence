const { ApiClient } = require('../utils/apiClient');
const apiConfig = require('../config/api-config');
const { logger } = require('../utils/logger');
const db = require('../config/database');

// Leaf fields requested via `ef`. The API returns them as parallel arrays
// keyed by dotted path. Verified live (2026-09-17): leaf paths under
// `licenses` (e.g. `licenses.lic_number`) come back null; the non-leaf
// `licenses` object returns a JSON-stringified array per provider, which is
// the only way to get the full per-license baseline. Both are requested:
// the leaf fields keep the existing primary-license transform working, and
// `licenses` feeds the full license list.
const EXTRA_FIELDS = [
  'name.full', 'name.first', 'name.middle', 'name.last', 'name.credential',
  'addr_practice.line1', 'addr_practice.line2', 'addr_practice.city',
  'addr_practice.state', 'addr_practice.zip', 'addr_practice.phone',
  'licenses.taxonomy.code', 'licenses.taxonomy.grouping',
  'licenses.lic_number', 'licenses.issuing_state',
  'licenses'
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

      if (criteria.offset) {
        params.offset = criteria.offset;
        // The Clinical Tables API paginates on `count` (default 7), not
        // maxList, once offset is present.
        params.count = criteria.maxResults || 500;
      }

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

      // Envelope element 0 is the upstream total match count; thread it
      // through so callers can render "Page X of Y".
      const total = Array.isArray(response) && Number.isFinite(response[0])
        ? response[0]
        : 0;

      const providers = this.transformNpiResponse(response);
      await this.annotateMipsAvailability(providers);
      return { total, providers };
    } catch (error) {
      logger.error('Error searching NPI registry:', error);
      throw new Error('Failed to search provider registry');
    }
  }

  /**
   * Flag each search result with whether any MIPS performance row is cached
   * for its NPI (any year). One indexed query per search; failures degrade
   * to hasMipsData false rather than failing the search.
   */
  async annotateMipsAvailability(providers) {
    for (const p of providers) p.hasMipsData = false;
    if (providers.length === 0) return;

    try {
      const npis = providers.map(p => p.npi);
      const result = await db.query(
        'SELECT DISTINCT npi FROM mips_performance_scores WHERE npi = ANY($1)',
        [npis]
      );
      const scored = new Set(result.rows.map(r => String(r.npi)));
      for (const p of providers) {
        p.hasMipsData = scored.has(String(p.npi));
      }
    } catch (error) {
      logger.error('Error annotating MIPS availability:', error);
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
      },
      licenses: this.parseLicenses(fieldAt('licenses', i))
    }));
  }

  /**
   * The non-leaf `ef=licenses` value is a JSON-stringified array of
   * per-license objects: {taxonomy: {...}, lic_number, lic_state,
   * is_primary_taxonomy, medicare: [...]}. Parse defensively: missing,
   * null, or malformed values yield an empty array.
   */
  parseLicenses(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(entry => entry && typeof entry === 'object')
      .map(entry => ({
        number: entry.lic_number || '',
        state: entry.lic_state || entry.issuing_state || '',
        isPrimaryTaxonomy: entry.is_primary_taxonomy === 'Y' ||
          entry.is_primary_taxonomy === true,
        taxonomyCode: (entry.taxonomy && entry.taxonomy.code) || '',
        taxonomyClassification: (entry.taxonomy && entry.taxonomy.classification) || '',
        taxonomySpecialization: (entry.taxonomy && entry.taxonomy.specialization) || ''
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

      // Replace the license baseline for this NPI: delete + insert keeps the
      // provider_licenses rows exactly in sync with the latest fetch. Every
      // row is stamped as self-reported NPI Registry data as of the fetch.
      await db.query('DELETE FROM provider_licenses WHERE npi = $1', [npi]);
      for (const lic of providerData.licenses || []) {
        await db.query(
          `INSERT INTO provider_licenses (
             npi, license_number, issuing_state, is_primary_taxonomy,
             taxonomy_code, taxonomy_classification, taxonomy_specialization,
             source, as_of
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'NPI Registry', CURRENT_DATE)`,
          [
            npi,
            lic.number,
            lic.state,
            lic.isPrimaryTaxonomy,
            lic.taxonomyCode,
            lic.taxonomyClassification,
            lic.taxonomySpecialization
          ]
        );
      }
    } catch (error) {
      logger.error('Error caching provider data:', error);
    }
  }

  /**
   * Get cached provider from database
   */
  async getCachedProvider(npi) {
    try {
      // The taxonomy crosswalk supplies a label when the cached row has none:
      // NPPES stores codes without descriptions, so a provider cached from a
      // bulk load carries a bare code until taxonomy-ingest backfills it.
      const result = await db.query(
        `SELECT p.*,
                t.description AS taxonomy_crosswalk_description,
                t.grouping AS taxonomy_crosswalk_grouping
           FROM providers p
           LEFT JOIN taxonomy_codes t ON t.code = p.primary_taxonomy_code
          WHERE p.npi = $1`,
        [npi]
      );

      const licenseRows = await this.getCachedProviderLicenses(npi);

      return this.normalizeProviderRow(result.rows[0], licenseRows);
    } catch (error) {
      logger.error('Error fetching cached provider:', error);
      return null;
    }
  }

  /**
   * License baseline rows for one NPI, in a stable order. Row-level source
   * and as_of are kept here (not on the normalized provider) so the
   * verification dossier can cite per-value provenance.
   */
  async getCachedProviderLicenses(npi) {
    try {
      const result = await db.query(
        `SELECT license_number, issuing_state, is_primary_taxonomy,
                taxonomy_code, taxonomy_classification, taxonomy_specialization,
                source, as_of
           FROM provider_licenses
          WHERE npi = $1
          ORDER BY is_primary_taxonomy DESC, license_number ASC, issuing_state ASC`,
        [npi]
      );
      return result.rows || [];
    } catch (error) {
      logger.error('Error fetching cached provider licenses:', error);
      return [];
    }
  }

  /**
   * Verified board status for one (state, license number) pair from the
   * license_status table ingested by tools/license-status-ingest.js. Multiple
   * license types can share a number; the most recently status-dated row wins.
   * Returns null when no board row exists (coverage is state by state).
   */
  async getCachedLicenseStatus(issuingState, licenseNumber) {
    try {
      const result = await db.query(
        `SELECT license_number, issuing_state, license_type, status,
                status_date, expiration_date, disciplinary_status,
                source, as_of
           FROM license_status
          WHERE issuing_state = $1 AND license_number = $2
          ORDER BY status_date DESC NULLS LAST
          LIMIT 1`,
        [issuingState, licenseNumber]
      );
      return result.rows && result.rows.length ? result.rows[0] : null;
    } catch (error) {
      logger.error('Error fetching cached license status:', error);
      return null;
    }
  }

  /**
   * Map a providers table row back to the API response shape so cache hits
   * return the same structure as fresh API transforms.
   */
  normalizeProviderRow(row, licenseRows = []) {
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
        description: row.primary_taxonomy_description ||
          row.taxonomy_crosswalk_description || row.provider_type || '',
        grouping: row.taxonomy_grouping || row.taxonomy_crosswalk_grouping || ''
      },
      license: {
        number: row.license_number || '',
        state: row.license_issuing_state || ''
      },
      licenses: licenseRows.map(r => ({
        number: r.license_number || '',
        state: r.issuing_state || '',
        isPrimaryTaxonomy: r.is_primary_taxonomy === true,
        taxonomyCode: r.taxonomy_code || '',
        taxonomyClassification: r.taxonomy_classification || '',
        taxonomySpecialization: r.taxonomy_specialization || ''
      }))
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
