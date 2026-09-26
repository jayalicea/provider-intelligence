// In-memory stand-in for src/config/database (pg Pool).
// Supports the exact statements the services issue. Rows carry real
// Date sync_timestamps, matching pg driver behavior, so cache-expiry
// logic under test behaves as it does against Postgres.

const providers = new Map(); // npi -> row
const providerLicenses = []; // provider_licenses rows
const licenseStatus = [];    // license_status rows (ingested board statuses)
const nppesProviders = new Map(); // npi -> row (national v2 table)
const mips = new Map();      // `${npi}:${year}` -> row
const exclusions = [];       // oig_exclusions rows
const taxonomyCodes = new Map(); // taxonomy_codes rows, keyed by code
const taxonomyPercentiles = [];  // taxonomy_percentiles materialized rows
const stateExclusions = []; // state_exclusions rows
const cannabis = new Map(); // cannabis_certifications rows, keyed `${state}:${license_number}`
const apiUsage = [];        // api_usage metering rows
const apiKeys = new Map();  // label -> api_keys row
const clia = new Map();     // clia_labs rows, keyed by clia_number
let quality = [];            // quality_measures rows

function reset() {
  providers.clear();
  providerLicenses.length = 0;
  licenseStatus.length = 0;
  nppesProviders.clear();
  mips.clear();
  exclusions.length = 0;
  taxonomyCodes.clear();
  taxonomyPercentiles.length = 0;
  stateExclusions.length = 0;
  cannabis.clear();
  apiUsage.length = 0;
  apiKeys.clear();
  clia.clear();
  quality = [];
  failCacheWrite = false;
  queryLog.length = 0;
}

const norm = sql => sql.replace(/\s+/g, ' ').trim();

// --- helpers for the analytics queries below -------------------------------
// Mirror Postgres semantics: STDDEV is the sample standard deviation
// (n-1 denominator); PERCENTILE_CONT linearly interpolates over sorted
// values; ROUND(x, 2) is applied by the service, not here.
function percentileCont(sorted, p) {
  if (!sorted.length) return null;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function sampleStddev(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1));
}

const ANALYTIC_METRICS = {
  final: 'final_score',
  quality: 'quality_score',
  ia: 'improvement_activities_score',
  pi: 'promoting_interoperability_score',
  cost: 'cost_score'
};

function groupStats(rows) {
  const out = {
    provider_count: rows.length,
    scored_count: rows.filter(r => r.final_score !== null && r.final_score !== undefined).length
  };
  for (const [prefix, col] of Object.entries(ANALYTIC_METRICS)) {
    const values = rows
      .map(r => (r[col] === null || r[col] === undefined ? null : Number(r[col])))
      .filter(v => v !== null && !Number.isNaN(v))
      .sort((a, b) => a - b);
    if (values.length === 0) {
      for (const suffix of ['avg', 'min', 'max', 'stddev', 'p25', 'p50', 'p75']) {
        out[`${prefix}_${suffix}`] = null;
      }
      continue;
    }
    out[`${prefix}_avg`] = values.reduce((a, b) => a + b, 0) / values.length;
    out[`${prefix}_min`] = values[0];
    out[`${prefix}_max`] = values[values.length - 1];
    out[`${prefix}_stddev`] = sampleStddev(values);
    out[`${prefix}_p25`] = percentileCont(values, 0.25);
    out[`${prefix}_p50`] = percentileCont(values, 0.5);
    out[`${prefix}_p75`] = percentileCont(values, 0.75);
  }
  return out;
}

const queryLog = [];

// --- taxonomy benchmark (Story 4.1) -----------------------------------------
// Cohort rows for one taxonomy-year: scored archive mips rows whose resolved
// taxonomy (nppes_providers first, providers fallback, same coalesce order
// as the materializer) matches.
function taxonomyCohort(year, taxonomy) {
  const resolveTaxonomy = n => {
    const nppes = nppesProviders.get(String(n));
    if (nppes && nppes.primary_taxonomy_code) return nppes.primary_taxonomy_code;
    const prov = providers.get(String(n));
    return (prov && prov.primary_taxonomy_code) || null;
  };
  return [...mips.values()].filter(r =>
    Number(r.performance_year) === Number(year) &&
    r.year_source === 'archive' &&
    r.final_score !== null && r.final_score !== undefined &&
    resolveTaxonomy(r.npi) === taxonomy);
}

async function query(text, params = []) {
  const sql = norm(text);
  queryLog.push(sql);

  if (/^SELECT \* FROM providers WHERE npi = \$1$/.test(sql)) {
    const row = providers.get(String(params[0]));
    return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
  }

  // Cached provider joined to the taxonomy crosswalk.
  if (/^SELECT p\.\*, t\.description AS taxonomy_crosswalk_description/.test(sql)) {
    const row = providers.get(String(params[0]));
    if (!row) return { rows: [], rowCount: 0 };
    const tax = taxonomyCodes.get(String(row.primary_taxonomy_code || ''));
    return {
      rows: [{
        ...row,
        taxonomy_crosswalk_description: tax ? tax.description : null,
        taxonomy_crosswalk_grouping: tax ? tax.grouping : null
      }],
      rowCount: 1
    };
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
      year_source: 'rolling',
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

  // Stale-row sweep issued by cacheQualityMeasures after its upserts.
  if (/^DELETE FROM quality_measures WHERE facility_id = \$1 AND data_source = \$2 AND measure_id <> ALL\(\$3\)$/.test(sql)) {
    const keep = new Set(params[2]);
    const before = quality.length;
    quality = quality.filter(
      r => !(r.facility_id === params[0] && r.data_source === params[1] && !keep.has(r.measure_id))
    );
    return { rows: [], rowCount: before - quality.length };
  }

  if (/^INSERT INTO quality_measures /.test(sql)) {
    const [
      facilityId, measureId, measureName, score, denominator,
      lowerEstimate, higherEstimate, comparedToNational,
      startDate, endDate, dataSource
    ] = params;
    const row = {
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
    };
    // Mirror the unique index on (facility_id, measure_id, data_source): the
    // statement upserts, so a second write to the same key replaces the row
    // rather than adding one.
    const at = quality.findIndex(
      r => r.facility_id === facilityId && r.measure_id === measureId && r.data_source === dataSource
    );
    if (at === -1) quality.push(row); else quality[at] = row;
    return { rows: [], rowCount: 1 };
  }

  if (/^SELECT DISTINCT npi FROM mips_performance_scores WHERE npi = ANY\(\$1\)$/.test(sql)) {
    const wanted = new Set((params[0] || []).map(String));
    const rows = [...mips.values()]
      .filter(r => wanted.has(String(r.npi)))
      .map(r => ({ npi: r.npi }));
    return { rows, rowCount: rows.length };
  }

  // --- cannabis_certifications (license-number-keyed certification) ----------

  // Single-NPI certification lookup: an NPI enriched directly onto a
  // cannabis row, or cached license joins for that NPI.
  if (/^SELECT cc\.program_name, cc\.state, cc\.as_of, cc\.source_name, cc\.source_url, cc\.certification_status[\s\S]*FROM cannabis_certifications cc WHERE cc\.npi = \$1/.test(sql)) {
    const npi = String(params[0]);
    let row = [...cannabis.values()].find(r => r.npi && String(r.npi) === npi);
    if (!row) {
      const keys = new Set();
      for (const pl of providerLicenses) {
        if (String(pl.npi) === npi) keys.add(`${pl.issuing_state}:${pl.license_number}`);
      }
      const prov = providers.get(npi);
      if (prov && prov.license_number) {
        keys.add(`${prov.license_issuing_state}:${prov.license_number}`);
      }
      for (const k of keys) {
        if (cannabis.has(k)) { row = cannabis.get(k); break; }
      }
    }
    if (!row) return { rows: [], rowCount: 0 };
    return {
      rows: [{
        program_name: row.program_name || 'Florida Medical Marijuana Program',
        state: row.state,
        as_of: row.as_of || '2026-09-11',
        source_name: row.source_name || 'FL OMMU Qualified Physician List',
        source_url: row.source_url || 'https://knowthefactsmmj.com/physicians/list/',
        certification_status: row.certification_status || 'qualified',
        first_listed_at: row.first_listed_at ?? null,
        last_confirmed_at: row.last_confirmed_at ?? null,
        currently_listed: row.currently_listed ?? true
      }],
      rowCount: 1
    };
  }

  // Cannabis registry directory: one row per listed physician, optional
  // state filter, name-ordered.
  if (/^SELECT state, program_name, source_name, source_url, as_of, practitioner_first_name/.test(sql)) {
    const state = params[0] ?? null;
    let rows = [...cannabis.values()];
    if (state) rows = rows.filter(r => r.state === state);
    rows = rows
      .sort((a, b) =>
        `${a.state}|${a.practitioner_last_name || ''}|${a.practitioner_first_name || ''}`
          .localeCompare(`${b.state}|${b.practitioner_last_name || ''}|${b.practitioner_first_name || ''}`))
      .slice(0, 500)
      .map(r => ({
        state: r.state,
        program_name: r.program_name,
        source_name: r.source_name,
        source_url: r.source_url,
        as_of: r.as_of,
        practitioner_first_name: r.practitioner_first_name ?? null,
        practitioner_last_name: r.practitioner_last_name ?? null,
        credential: r.credential ?? null,
        npi: r.npi ?? null,
        license_number: r.license_number ?? null,
        certification_status: r.certification_status,
        first_listed_at: r.first_listed_at ?? null,
        last_confirmed_at: r.last_confirmed_at ?? null,
        currently_listed: r.currently_listed ?? true
      }));
    return { rows, rowCount: rows.length };
  }

  // Cannabis hub summary: listed counts per (state, program, source) plus
  // per-state distinct matched NPIs under the same three-arm semantics.
  if (/COUNT\(m\.npi\) AS matched_count/.test(sql)) {
    const groups = new Map();
    for (const r of cannabis.values()) {
      const key = [r.state, r.program_name || '', r.source_name || '', r.source_url || ''].join('|');
      if (!groups.has(key)) {
        groups.set(key, { state: r.state, program_name: r.program_name, source_name: r.source_name, source_url: r.source_url, as_of: null, listed_count: 0 });
      }
      const g = groups.get(key);
      g.listed_count++;
      const a = r.as_of ? String(r.as_of).slice(0, 10) : null;
      if (a && (!g.as_of || a > g.as_of)) g.as_of = a;
    }
    const matchedByState = new Map();
    const addMatch = (state, npi) => {
      if (!matchedByState.has(state)) matchedByState.set(state, new Set());
      matchedByState.get(state).add(String(npi));
    };
    for (const pl of providerLicenses) {
      const cc = cannabis.get(`${pl.issuing_state}:${pl.license_number}`);
      if (cc) addMatch(cc.state, pl.npi);
    }
    for (const p of providers.values()) {
      if (!p.license_number) continue;
      const cc = cannabis.get(`${p.license_issuing_state}:${p.license_number}`);
      if (cc) addMatch(cc.state, p.npi);
    }
    for (const r of cannabis.values()) {
      if (r.npi) addMatch(r.state, r.npi);
    }
    const rows = [...groups.values()]
      .sort((a, b) => String(a.state).localeCompare(String(b.state)))
      .map(g => ({ ...g, matched_count: matchedByState.get(g.state) ? matchedByState.get(g.state).size : 0 }));
    return { rows, rowCount: rows.length };
  }

  // UNION of NPIs whose cached licenses (provider_licenses baseline or the
  // providers row) match a certification on (license_number, state), plus
  // NPIs enriched directly onto cannabis_certifications rows.
  if (/FROM provider_licenses pl JOIN cannabis_certifications cc/.test(sql)) {
    const npis = new Set();
    for (const r of providerLicenses) {
      if (cannabis.has(`${r.issuing_state}:${r.license_number}`)) npis.add(String(r.npi));
    }
    for (const r of providers.values()) {
      if (r.license_number && cannabis.has(`${r.license_issuing_state}:${r.license_number}`)) {
        npis.add(String(r.npi));
      }
    }
    for (const r of cannabis.values()) {
      if (r.npi) npis.add(String(r.npi));
    }
    const rows = [...npis].map(npi => ({ npi }));
    return { rows, rowCount: rows.length };
  }

  // --- provider_licenses (license baseline) ----------------------------------

  if (/^SELECT license_number, issuing_state, is_primary_taxonomy, taxonomy_code, taxonomy_classification, taxonomy_specialization, source, as_of FROM provider_licenses WHERE npi = \$1 ORDER BY is_primary_taxonomy DESC, license_number ASC, issuing_state ASC$/.test(sql)) {
    const rows = providerLicenses
      .filter(r => String(r.npi) === String(params[0]))
      .sort((a, b) =>
        Number(b.is_primary_taxonomy === true) - Number(a.is_primary_taxonomy === true) ||
        String(a.license_number).localeCompare(String(b.license_number)) ||
        String(a.issuing_state).localeCompare(String(b.issuing_state)))
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  if (/^DELETE FROM provider_licenses WHERE npi = \$1$/.test(sql)) {
    const before = providerLicenses.length;
    for (let i = providerLicenses.length - 1; i >= 0; i--) {
      if (String(providerLicenses[i].npi) === String(params[0])) {
        providerLicenses.splice(i, 1);
      }
    }
    return { rows: [], rowCount: before - providerLicenses.length };
  }

  if (/^INSERT INTO provider_licenses /.test(sql)) {
    const [
      npi, licenseNumber, issuingState, isPrimaryTaxonomy,
      taxonomyCode, taxonomyClassification, taxonomySpecialization
    ] = params;
    // Source and as_of are literals in the statement (CURRENT_DATE), so
    // they are not bound params; mirror that here.
    providerLicenses.push({
      npi: String(npi),
      license_number: licenseNumber,
      issuing_state: issuingState,
      is_primary_taxonomy: isPrimaryTaxonomy,
      taxonomy_code: taxonomyCode,
      taxonomy_classification: taxonomyClassification,
      taxonomy_specialization: taxonomySpecialization,
      source: 'NPI Registry',
      as_of: new Date()
    });
    return { rows: [], rowCount: 1 };
  }

  // --- license_status (verified board statuses) ------------------------------

  if (/^SELECT license_number, issuing_state, license_type, status, status_date, expiration_date, disciplinary_status, source, as_of FROM license_status WHERE issuing_state = \$1 AND license_number = \$2 ORDER BY status_date DESC NULLS LAST LIMIT 1$/.test(sql)) {
    const rows = licenseStatus
      .filter(r =>
        String(r.issuing_state) === String(params[0]) &&
        String(r.license_number) === String(params[1]))
      .sort((a, b) => {
        const ad = a.status_date ? new Date(a.status_date).getTime() : -Infinity;
        const bd = b.status_date ? new Date(b.status_date).getTime() : -Infinity;
        return bd - ad;
      })
      .slice(0, 1)
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  // --- analytics queries (tests/analytics.test.js) -------------------------

  // Trends: per-year rows across a year range
  if (/^SELECT performance_year, final_score, quality_score, improvement_activities_score, promoting_interoperability_score, cost_score, year_source FROM mips_performance_scores WHERE npi = \$1 AND performance_year BETWEEN \$2 AND \$3 ORDER BY performance_year ASC$/.test(sql)) {
    const rows = [...mips.values()]
      .filter(r =>
        String(r.npi) === String(params[0]) &&
        Number(r.performance_year) >= Number(params[1]) &&
        Number(r.performance_year) <= Number(params[2]))
      .sort((a, b) => Number(a.performance_year) - Number(b.performance_year))
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  // MIPS CSV export history: per-year rows with provenance columns
  if (/^SELECT performance_year, final_score, quality_score, improvement_activities_score, promoting_interoperability_score, cost_score, performance_status, data_source, year_source FROM mips_performance_scores WHERE npi = \$1 AND performance_year BETWEEN \$2 AND \$3 ORDER BY performance_year ASC$/.test(sql)) {
    const rows = [...mips.values()]
      .filter(r =>
        String(r.npi) === String(params[0]) &&
        Number(r.performance_year) >= Number(params[1]) &&
        Number(r.performance_year) <= Number(params[2]))
      .sort((a, b) => Number(a.performance_year) - Number(b.performance_year))
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  // Ranking: window-function style, overall or within a taxonomy peer group.
  // Only scored peers enter the partition (matches the service's
  // final_score IS NOT NULL filter); an unscored target still returns a row
  // with null rank. Percentile = share of scored peers scoring at or below
  // the target (100 = best).
  if (sql.includes('RANK() OVER') && sql.includes('AS total_count')) {
    const withinTaxonomy = sql.includes('primary_taxonomy_code');
    const [npi, year, taxonomy] = params;
    let peers = [...mips.values()]
      .filter(r => Number(r.performance_year) === Number(year));
    if (withinTaxonomy) {
      const peerNpis = new Set(
        [...providers.values()]
          .filter(p => p.primary_taxonomy_code === taxonomy)
          .map(p => String(p.npi))
      );
      peers = peers.filter(r => peerNpis.has(String(r.npi)));
    }
    const target = peers.find(r => String(r.npi) === String(npi));
    if (!target) return { rows: [], rowCount: 0 };
    const scored = peers.filter(r => r.final_score !== null && r.final_score !== undefined);
    const targetScore = Number(target.final_score);
    if (Number.isNaN(targetScore)) {
      return {
        rows: [{
          npi: target.npi,
          final_score: target.final_score,
          rank: null,
          total_count: scored.length,
          percentile: null
        }],
        rowCount: 1
      };
    }
    const rank = 1 + scored.filter(r => Number(r.final_score) > targetScore).length;
    const percentile = Math.round(
      10000 * scored.filter(r => Number(r.final_score) <= targetScore).length / scored.length
    ) / 100;
    return {
      rows: [{
        npi: target.npi,
        final_score: target.final_score,
        rank,
        total_count: scored.length,
        percentile
      }],
      rowCount: 1
    };
  }

  // Benchmark: provider score cross-joined with national distribution stats
  if (sql.includes('AS national_average')) {
    const [npi, year] = params;
    const peers = [...mips.values()]
      .filter(r => Number(r.performance_year) === Number(year));
    const target = peers.find(r => String(r.npi) === String(npi));
    if (!target) return { rows: [], rowCount: 0 };
    const scores = peers
      .map(r => (r.final_score === null || r.final_score === undefined ? null : Number(r.final_score)))
      .filter(v => v !== null && !Number.isNaN(v))
      .sort((a, b) => a - b);
    return {
      rows: [{
        provider_score: target.final_score,
        national_average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
        min_score: scores[0],
        max_score: scores[scores.length - 1],
        q1: percentileCont(scores, 0.25),
        median: percentileCont(scores, 0.5),
        q3: percentileCont(scores, 0.75),
        peer_count: scores.length
      }],
      rowCount: 1
    };
  }

  // Group performance: aggregates over an NPI list for one year
  if (sql.includes('AS final_avg')) {
    const [npis, year] = params;
    const wanted = new Set((npis || []).map(String));
    const rows = [...mips.values()]
      .filter(r =>
        wanted.has(String(r.npi)) &&
        Number(r.performance_year) === Number(year));
    return { rows: [groupStats(rows)], rowCount: 1 };
  }

  // --- percentile trends (tests/analytics.test.js) ---------------------------

  // Taxonomy resolution, same coalesce order as the loader:
  // nppes_providers first, providers as fallback.
  if (/COALESCE\(n\.primary_taxonomy_code, p\.primary_taxonomy_code\) AS taxonomy_code FROM \(SELECT \$1 AS npi\) s/.test(sql)) {
    const npi = String(params[0]);
    const nppes = nppesProviders.get(npi);
    const prov = providers.get(npi);
    const code = (nppes && nppes.primary_taxonomy_code) ||
                 (prov && prov.primary_taxonomy_code) || null;
    return { rows: [{ taxonomy_code: code }], rowCount: 1 };
  }

  if (/^SELECT performance_year, scored_count, min_final_score, max_final_score, median_final_score, p25_final_score, p75_final_score, mean_final_score, source, as_of FROM taxonomy_percentiles WHERE taxonomy_code = \$1 ORDER BY performance_year ASC$/.test(sql)) {
    const rows = taxonomyPercentiles
      .filter(r => r.taxonomy_code === params[0])
      .sort((a, b) => Number(a.performance_year) - Number(b.performance_year))
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  // Exact per-year percentile within the taxonomy cohort (archive rows,
  // scored peers only). Percentile = share of cohort scoring at or below
  // the provider, 100 = best (matches getRanking).
  if (/AS at_or_below/.test(sql)) {
    const [npi, year, taxonomy] = params;
    const target = [...mips.values()].find(r =>
      String(r.npi) === String(npi) &&
      Number(r.performance_year) === Number(year) &&
      r.year_source === 'archive');
    if (!target) return { rows: [], rowCount: 0 };
    const resolveTaxonomy = n => {
      const nppes = nppesProviders.get(String(n));
      if (nppes && nppes.primary_taxonomy_code) return nppes.primary_taxonomy_code;
      const prov = providers.get(String(n));
      return (prov && prov.primary_taxonomy_code) || null;
    };
    const cohort = [...mips.values()].filter(r =>
      Number(r.performance_year) === Number(year) &&
      r.year_source === 'archive' &&
      r.final_score !== null && r.final_score !== undefined &&
      resolveTaxonomy(r.npi) === taxonomy);
    const targetScore = Number(target.final_score);
    if (Number.isNaN(targetScore)) {
      return {
        rows: [{
          provider_score: target.final_score,
          cohort_scored: cohort.length,
          at_or_below: null
        }],
        rowCount: 1
      };
    }
    return {
      rows: [{
        provider_score: target.final_score,
        cohort_scored: cohort.length,
        at_or_below: cohort.filter(r => Number(r.final_score) <= targetScore).length
      }],
      rowCount: 1
    };
  }

  // --- taxonomy benchmark (tests/taxonomy-benchmark.test.js) -----------------

  // Materialized row lookup for one taxonomy-year; empty result = 404.
  if (/^SELECT scored_count, min_final_score, max_final_score, median_final_score, p25_final_score, p75_final_score, mean_final_score, source, as_of FROM taxonomy_percentiles WHERE taxonomy_code = \$1 AND performance_year = \$2$/.test(sql)) {
    const row = taxonomyPercentiles.find(r =>
      r.taxonomy_code === params[0] && Number(r.performance_year) === Number(params[1]));
    return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
  }

  // Single GROUPING SETS pass: one row with overall=1 carries the cohort
  // decile ladder; rows with overall=0 carry the per-state breakdown.
  if (/GROUP BY GROUPING SETS/.test(sql) && sql.includes('COALESCE(n.primary_taxonomy_code')) {
    const [year, taxonomy] = params;
    const cohort = taxonomyCohort(year, taxonomy);
    const byState = new Map();
    for (const r of cohort) {
      const nppes = nppesProviders.get(String(r.npi));
      const prov = providers.get(String(r.npi));
      const state = (nppes && nppes.practice_state) || (prov && prov.practice_state) || null;
      if (!byState.has(state)) byState.set(state, []);
      byState.get(state).push(Number(r.final_score));
    }
    const rows = [];
    const overall = { overall: 1, state: null, scored_count: cohort.length };
    const sortedAll = cohort.map(r => Number(r.final_score)).sort((a, b) => a - b);
    for (let i = 1; i <= 9; i++) {
      overall[`d${i * 10}`] = percentileCont(sortedAll, i / 10);
    }
    overall.median_final_score = percentileCont(sortedAll, 0.5);
    rows.push(overall);
    for (const [state, scores] of byState) {
      const sorted = scores.sort((a, b) => a - b);
      const row = {
        overall: 0,
        state,
        scored_count: sorted.length,
        median_final_score: percentileCont(sorted, 0.5)
      };
      for (let i = 1; i <= 9; i++) row[`d${i * 10}`] = null;
      rows.push(row);
    }
    return { rows, rowCount: rows.length };
  }

  // --- national cohort query (national_screening, materialized) --------------

  // The service builds the WHERE clause dynamically. Params are
  // [state, taxonomyPrefix?, ...nameTermPatterns?, minScore?] where taxonomy
  // params look like '207%' and name terms like '%smith%'.
  if (/FROM national_screening s/.test(sql)) {
    const state = String(params[0]).toUpperCase();
    let rows = [...nppesProviders.values()]
      .filter(p => String(p.practice_state || '').toUpperCase() === state);

    for (let pi = 1; pi < params.length; pi++) {
      const p = params[pi];
      if (typeof p === 'number') {
        const min = p;
        rows = rows.filter(r =>
          r.mips_available &&
          r.final_score !== null && r.final_score !== undefined &&
          Number(r.final_score) >= min);
      } else if (String(p).startsWith('%')) {
        const term = String(p).replace(/%/g, '').toLowerCase();
        rows = rows.filter(r =>
          String(r.entity_name || '').toLowerCase().includes(term));
      } else {
        const prefix = String(p).replace(/%$/, '');
        rows = rows.filter(p2 =>
          String(p2.primary_taxonomy_code || '').startsWith(prefix));
      }
    }

    rows = rows
      .sort((a, b) => String(a.npi).localeCompare(String(b.npi)))
      .slice(0, 500)
      .map(p => ({ ...p }));
    return { rows, rowCount: rows.length };
  }

  // --- legacy nppes_providers national cohort query (pre-materialization) ----

  // Kept so the schema-drift guard's query-source extraction and any older
  // tooling still resolve; the service no longer issues this shape.

  // --- intelligence cohort query (tests/intelligence.test.js) --------------

  // Joined providers + latest-year MIPS scan. The service builds the WHERE
  // clause dynamically; params are [state, taxonomyPattern?, minScore?].
  if (/FROM providers p/.test(sql) && /LEFT JOIN mips_performance_scores m/.test(sql)) {
    const state = String(params[0]).toUpperCase();
    let rows = [...providers.values()]
      .filter(p => String(p.practice_state || '').toUpperCase() === state);

    // Mirror the COALESCE(t.description, p.primary_taxonomy_description) the
    // real query uses, so filtering and display agree here as they do there.
    const label = p => {
      const tax = taxonomyCodes.get(String(p.primary_taxonomy_code || ''));
      return (tax && tax.description) || p.primary_taxonomy_description || null;
    };

    let pi = 1;
    if (pi < params.length && typeof params[pi] === 'string' && params[pi].includes('%')) {
      const pat = String(params[pi]).replace(/%/g, '').toLowerCase();
      rows = rows.filter(p => String(label(p) || '').toLowerCase().includes(pat));
      pi += 1;
    }

    const latestMips = npi => {
      const years = [...mips.values()]
        .filter(r => String(r.npi) === String(npi))
        .map(r => Number(r.performance_year));
      if (!years.length) return null;
      const maxYear = Math.max(...years);
      return mips.get(`${npi}:${maxYear}`);
    };

    if (pi < params.length && params[pi] !== null && params[pi] !== undefined) {
      const min = Number(params[pi]);
      rows = rows.filter(p => {
        const m = latestMips(p.npi);
        return m && m.final_score !== null && m.final_score !== undefined &&
          Number(m.final_score) >= min;
      });
      pi += 1;
    }

    rows = rows
      .sort((a, b) =>
        String(a.name_last).localeCompare(String(b.name_last)) ||
        String(a.name_first).localeCompare(String(b.name_first)) ||
        String(a.npi).localeCompare(String(b.npi)))
      .slice(0, 500)
      .map(p => {
        const m = latestMips(p.npi);
        return {
          ...p,
          primary_taxonomy_description: label(p),
          performance_year: m ? m.performance_year : null,
          final_score: m ? m.final_score : null,
          mips_sync_timestamp: m ? m.sync_timestamp : null
        };
      });
    return { rows, rowCount: rows.length };
  }

  // --- exclusion queries (tests/exclusions.test.js) ------------------------

  // NPI exact match against oig_exclusions
  if (/^SELECT \* FROM oig_exclusions WHERE npi = \$1$/.test(sql)) {
    const rows = exclusions
      .filter(r => String(r.npi) === String(params[0]))
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  // Batched NPI scan for the intelligence cohort endpoint
  if (/^SELECT \* FROM oig_exclusions WHERE npi = ANY\(\$1\)$/.test(sql)) {
    const wanted = new Set((params[0] || []).map(String));
    const rows = exclusions
      .filter(r => wanted.has(String(r.npi)))
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  // Table-wide as_of used as the provenance default for CLEAR-by-scan rows
  // Exclusion watchlist: active rows inside the excldate window, newest first.
  if (/^SELECT display_name, lastname, firstname, busname, npi, city, state, zip, excltype, general, specialty, excldate, source, as_of FROM oig_exclusions WHERE /.test(sql)) {
    const cutoff = params[0];
    const stateFilter = params.length > 2 ? params[1] : null;
    const limit = params[params.length - 1];
    const rows = exclusions
      .filter(r => r.reindate === null || r.reindate === undefined)
      .filter(r => /^[0-9]{8}$/.test(String(r.excldate || '')))
      .filter(r => String(r.excldate) >= cutoff)
      .filter(r => !stateFilter || String(r.state || '').toUpperCase() === stateFilter)
      .sort((a, b) => (
        String(b.excldate).localeCompare(String(a.excldate)) ||
        String(a.display_name || '').localeCompare(String(b.display_name || ''))
      ))
      .slice(0, limit)
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  // Batched cohort passes: NPI against each registry, then one name-keyed pass.
  if (/^SELECT \* FROM state_exclusions WHERE npi = ANY\(\$1\)$/.test(sql)) {
    const wanted = new Set((params[0] || []).map(String));
    const rows = stateExclusions.filter(r => wanted.has(String(r.npi))).map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  if (/^SELECT \* FROM oig_exclusions WHERE upper\(regexp_replace\(lastname, .* = ANY\(\$1\) AND upper\(state\) = ANY\(\$2\)$/.test(sql)) {
    const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const names = new Set(params[0] || []);
    const states = new Set(params[1] || []);
    const rows = exclusions
      .filter(r => names.has(norm(r.lastname)) && states.has(norm(r.state)))
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  if (/^SELECT \* FROM state_exclusions WHERE upper\(regexp_replace\(entity_name, .* = ANY\(\$1\) AND upper\(state\) = ANY\(\$2\)$/.test(sql)) {
    const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9 ,]/g, '').replace(/\s+/g, ' ').trim();
    const names = new Set(params[0] || []);
    const states = new Set(params[1] || []);
    const rows = stateExclusions
      .filter(r => names.has(norm(r.entity_name)) && states.has(String(r.state || '').toUpperCase()))
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  // state_exclusions: NPI exact match
  if (/^SELECT \* FROM state_exclusions WHERE npi = \$1$/.test(sql)) {
    const rows = stateExclusions.filter(r => r.npi === params[0]).map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  // state_exclusions: batched NPI scan for the national cohort endpoint
  if (/^SELECT \* FROM state_exclusions WHERE npi = ANY\(\$1\)$/.test(sql)) {
    const wanted = new Set((params[0] || []).map(String));
    const rows = stateExclusions
      .filter(r => wanted.has(String(r.npi)))
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  // state_exclusions: entity_name (any published variant) + state
  if (/^SELECT \* FROM state_exclusions WHERE upper\(regexp_replace\(entity_name/.test(sql)) {
    const variants = params[0];
    const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9 ,]/g, '').replace(/\s+/g, ' ').trim();
    const rows = stateExclusions
      .filter(r => variants.includes(norm(r.entity_name)))
      .filter(r => String(r.state || '').toUpperCase() === params[1])
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  if (/^SELECT max\(as_of\) AS as_of FROM oig_exclusions$/.test(sql)) {
    const asOfs = exclusions.map(r => r.as_of).filter(Boolean).sort();
    return {
      rows: [{ as_of: asOfs.length ? asOfs[asOfs.length - 1] : null }],
      rowCount: 1
    };
  }

  // Name + state match. The real query strips punctuation in SQL; the mock
  // applies the same normalization to both sides.
  if (sql.includes('FROM oig_exclusions WHERE upper(regexp_replace')) {
    const strip = v =>
      String(v || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
    const [nLast, nState, nFirst] = params;
    const rows = exclusions
      .filter(r =>
        strip(r.lastname) === strip(nLast) &&
        strip(r.state) === strip(nState) &&
        strip(r.firstname) === strip(nFirst))
      .map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  // --- api_keys (tests/apikeys.test.js) --------------------------------------

  // Startup load: active keys only, revoked rows excluded.
  if (/^SELECT key_hash, label FROM api_keys WHERE revoked_at IS NULL$/.test(sql)) {
    const rows = [...apiKeys.values()]
      .filter(r => r.revoked_at === null || r.revoked_at === undefined)
      .map(r => ({ key_hash: r.key_hash, label: r.label }));
    return { rows, rowCount: rows.length };
  }

  if (/^INSERT INTO api_keys \(key_hash, label\) VALUES \(\$1, \$2\)$/.test(sql)) {
    const [keyHash, label] = params;
    for (const row of apiKeys.values()) {
      if (row.key_hash === keyHash) throw new Error('mockDb: duplicate key_hash');
    }
    apiKeys.set(String(label), {
      key_hash: keyHash,
      label: String(label),
      created_at: new Date(),
      revoked_at: null
    });
    return { rows: [], rowCount: 1 };
  }

  if (/^UPDATE api_keys SET revoked_at = now\(\) WHERE label = \$1/.test(sql)) {
    const row = apiKeys.get(String(params[0]));
    if (!row || row.revoked_at !== null) return { rows: [], rowCount: 0 };
    row.revoked_at = new Date();
    return { rows: [], rowCount: 1 };
  }

  if (/^SELECT label, created_at, revoked_at FROM api_keys ORDER BY created_at ASC$/.test(sql)) {
    const rows = [...apiKeys.values()].map(r => ({ ...r }));
    return { rows, rowCount: rows.length };
  }

  // --- api_usage metering (tests/apikeys.test.js) ----------------------------

  if (/^INSERT INTO api_usage \(key_label, endpoint, method, status\) VALUES \(\$1, \$2, \$3, \$4\)$/.test(sql)) {
    apiUsage.push({
      key_label: params[0],
      endpoint: params[1],
      method: params[2],
      status: params[3],
      created_at: new Date()
    });
    return { rows: [], rowCount: 1 };
  }

  // Per-key totals over the window. The window param is an interval string
  // like '30 days'; the mock keeps every row (tests never backdate).
  if (/FROM api_usage WHERE created_at >= now\(\) - \$1::interval/.test(sql) && /AS errors/.test(sql)) {
    const groups = new Map();
    for (const row of apiUsage) {
      if (!groups.has(row.key_label)) {
        groups.set(row.key_label, {
          key_label: row.key_label, requests: 0, errors: 0,
          first_used: row.created_at, last_used: row.created_at
        });
      }
      const g = groups.get(row.key_label);
      g.requests += 1;
      if (Number(row.status) >= 400) g.errors += 1;
      if (row.created_at < g.first_used) g.first_used = row.created_at;
      if (row.created_at > g.last_used) g.last_used = row.created_at;
    }
    const rows = [...groups.values()].sort((a, b) => b.requests - a.requests).slice(0, 100);
    return { rows, rowCount: rows.length };
  }

  // Per-endpoint breakdown over the same window
  if (/FROM api_usage WHERE created_at >= now\(\) - \$1::interval/.test(sql)) {
    const groups = new Map();
    for (const row of apiUsage) {
      const key = `${row.key_label}|${row.endpoint}|${row.method}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key_label: row.key_label, endpoint: row.endpoint,
          method: row.method, requests: 0
        });
      }
      groups.get(key).requests += 1;
    }
    const rows = [...groups.values()].sort((a, b) => b.requests - a.requests).slice(0, 500);
    return { rows, rowCount: rows.length };
  }

  // --- clia_labs (directory + detail reads) ---------------------------------

  if (/FROM clia_labs/.test(sql)) {
    const condVal = re => {
      const m = sql.match(re);
      return m ? params[parseInt(m[1], 10) - 1] : undefined;
    };
    const nameF = condVal(/lab_name ILIKE \$(\d+)/);
    const stateF = condVal(/state = \$(\d+)/);
    const cityF = condVal(/city ILIKE \$(\d+)/);
    const delistedOnly = /currently_registered = false/.test(sql);

    let rows = [...clia.values()].filter(r => delistedOnly
      ? r.currently_registered === false
      : r.currently_registered !== false);
    if (nameF) rows = rows.filter(r => String(r.lab_name || '').toUpperCase().includes(nameF.slice(1, -1).toUpperCase()));
    if (stateF) rows = rows.filter(r => r.state === stateF);
    if (cityF) rows = rows.filter(r => String(r.city || '').toUpperCase().includes(cityF.slice(1, -1).toUpperCase()));

    if (/^SELECT COUNT\(\*\)/.test(sql)) {
      return { rows: [{ n: rows.length }], rowCount: 1 };
    }
    if (/^SELECT \* FROM clia_labs WHERE clia_number = \$1$/.test(sql)) {
      const row = clia.get(String(params[0]));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    rows = rows.sort((a, b) => String(a.lab_name).localeCompare(String(b.lab_name)));
    return {
      rows: rows.map(r => ({ ...r })),
      rowCount: rows.length
    };
  }

  // Delisted certifiers (currently_listed = false) for the alerts endpoint.
  if (/^SELECT state, practitioner_last_name, practitioner_first_name, source_name, program_name, last_confirmed_at FROM cannabis_certifications WHERE currently_listed = false/.test(sql)) {
    const rows = [...cannabis.values()]
      .filter(r => r.currently_listed === false)
      .map(r => ({
        state: r.state,
        practitioner_last_name: r.practitioner_last_name,
        practitioner_first_name: r.practitioner_first_name,
        source_name: r.source_name,
        program_name: r.program_name,
        last_confirmed_at: r.last_confirmed_at
      }));
    return { rows, rowCount: rows.length };
  }

  throw new Error(`mockDb: unsupported SQL: ${sql}`);
}

// Transaction verbs are accepted and the statements simply apply to the shared
// store: these tests exercise statement semantics, not rollback isolation.
// failNextCacheWrite() makes the next quality_measures write throw, so the
// error path of cacheQualityMeasures can be covered.
let failCacheWrite = false;

async function clientQuery(sql, params) {
  const text = norm(sql);
  if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
    return { rows: [], rowCount: 0 };
  }
  if (failCacheWrite && /quality_measures/.test(text)) {
    failCacheWrite = false;
    throw new Error('mockDb: simulated write failure');
  }
  return query(sql, params);
}

module.exports = {
  query,
  getClient: async () => ({ query: clientQuery, release: () => {} }),
  _failNextCacheWrite: () => { failCacheWrite = true; },
  pool: {},
  _stores: {
    providers,
    providerLicenses,
    licenseStatus,
    nppesProviders,
    mips,
    clia,
    get quality() { return quality; },
    taxonomyCodes,
    taxonomyPercentiles,
    exclusions,
    stateExclusions,
    cannabis,
    queryLog,
    apiUsage,
    apiKeys
  },
  _reset: reset
};
