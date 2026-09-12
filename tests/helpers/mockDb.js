// In-memory stand-in for src/config/database (pg Pool).
// Supports the exact statements the services issue. Rows carry real
// Date sync_timestamps, matching pg driver behavior, so cache-expiry
// logic under test behaves as it does against Postgres.

const providers = new Map(); // npi -> row
const mips = new Map();      // `${npi}:${year}` -> row
let quality = [];            // quality_measures rows

function reset() {
  providers.clear();
  mips.clear();
  quality = [];
}

const norm = sql => sql.replace(/\s+/g, ' ').trim();

async function query(text, params = []) {
  const sql = norm(text);

  if (/^SELECT \* FROM providers WHERE npi = \$1$/.test(sql)) {
    const row = providers.get(String(params[0]));
    return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
  }

  if (/^INSERT INTO providers /.test(sql)) {
    const [
      npi, enumerationType, first, middle, last, full, credential,
      providerType, taxCode, taxDescription, taxGrouping,
      line1, line2, city, state, zip, phone, licNumber, licState
    ] = params;
    providers.set(String(npi), {
      npi: String(npi),
      enumeration_type: enumerationType,
      name_first: first,
      name_middle: middle,
      name_last: last,
      name_full: full,
      name_credential: credential,
      provider_type: providerType,
      primary_taxonomy_code: taxCode,
      primary_taxonomy_description: taxDescription,
      taxonomy_grouping: taxGrouping,
      practice_address_line1: line1,
      practice_address_line2: line2,
      practice_city: city,
      practice_state: state,
      practice_zipcode: zip,
      practice_phone: phone,
      license_number: licNumber,
      license_issuing_state: licState,
      data_source: 'NPI_REGISTRY',
      sync_timestamp: new Date(),
      is_active: true
    });
    return { rows: [], rowCount: 1 };
  }

  if (/^SELECT \* FROM mips_performance_scores WHERE npi = \$1 AND performance_year = \$2$/.test(sql)) {
    const row = mips.get(`${params[0]}:${params[1]}`);
    return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
  }

  if (/^INSERT INTO mips_performance_scores /.test(sql)) {
    const [
      npi, year, finalScore, overallScore, qualityScore, iaScore, piScore,
      costScore, status, entityType, groupSize
    ] = params;
    mips.set(`${npi}:${year}`, {
      npi,
      performance_year: year,
      final_score: finalScore,
      overall_category_score: overallScore,
      quality_score: qualityScore,
      improvement_activities_score: iaScore,
      promoting_interoperability_score: piScore,
      cost_score: costScore,
      performance_status: status,
      reporting_entity_type: entityType,
      group_size_category: groupSize,
      data_source: 'CMS_OPEN_DATA',
      sync_timestamp: new Date()
    });
    return { rows: [], rowCount: 1 };
  }

  if (/^SELECT .* FROM quality_measures WHERE facility_id = \$1 AND data_source = \$2$/.test(sql)) {
    const rows = quality
      .filter(r => r.facility_id === params[0] && r.data_source === params[1])
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  if (/^DELETE FROM quality_measures WHERE facility_id = \$1 AND data_source = \$2$/.test(sql)) {
    const before = quality.length;
    quality = quality.filter(
      r => !(r.facility_id === params[0] && r.data_source === params[1])
    );
    return { rows: [], rowCount: before - quality.length };
  }

  if (/^INSERT INTO quality_measures /.test(sql)) {
    const [
      facilityId, measureId, measureName, score, denominator,
      lowerEstimate, higherEstimate, comparedToNational,
      startDate, endDate, dataSource
    ] = params;
    quality.push({
      facility_id: facilityId,
      measure_id: measureId,
      measure_name: measureName,
      score,
      denominator,
      lower_estimate: lowerEstimate,
      higher_estimate: higherEstimate,
      compared_to_national: comparedToNational,
      reporting_period_start: startDate,
      reporting_period_end: endDate,
      data_source: dataSource,
      sync_timestamp: new Date()
    });
    return { rows: [], rowCount: 1 };
  }

  throw new Error(`mockDb: unsupported SQL: ${sql}`);
}

module.exports = {
  query,
  getClient: async () => { throw new Error('mockDb: getClient not supported'); },
  pool: {},
  _stores: { providers, mips, get quality() { return quality; } },
  _reset: reset
};
