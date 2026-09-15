// In-memory stand-in for src/config/database (pg Pool).
// Supports the exact statements the services issue. Rows carry real
// Date sync_timestamps, matching pg driver behavior, so cache-expiry
// logic under test behaves as it does against Postgres.

const providers = new Map(); // npi -> row
const nppesProviders = new Map(); // npi -> row (national v2 table)
const mips = new Map();      // `${npi}:${year}` -> row
const exclusions = [];       // oig_exclusions rows
const stateExclusions = []; // state_exclusions rows
const apiUsage = [];        // api_usage metering rows
let quality = [];            // quality_measures rows

function reset() {
  providers.clear();
  nppesProviders.clear();
  mips.clear();
  exclusions.length = 0;
  stateExclusions.length = 0;
  apiUsage.length = 0;
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

async function query(text, params = []) {
  const sql = norm(text);
  queryLog.push(sql);

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

  // --- analytics queries (tests/analytics.test.js) -------------------------

  // Trends: per-year rows across a year range
  if (/^SELECT performance_year, final_score, quality_score, improvement_activities_score, promoting_interoperability_score, cost_score FROM mips_performance_scores WHERE npi = \$1 AND performance_year BETWEEN \$2 AND \$3 ORDER BY performance_year ASC$/.test(sql)) {
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

  // --- national cohort query (nppes_providers) ------------------------------

  // The service builds the WHERE clause dynamically. Params are
  // [state, taxonomyPrefix?, ...nameTermPatterns?, minScore?] where taxonomy
  // params look like '207%' and name terms like '%smith%'.
  if (/FROM nppes_providers p/.test(sql) && /LEFT JOIN mips_performance_scores m/.test(sql)) {
    const state = String(params[0]).toUpperCase();
    let rows = [...nppesProviders.values()]
      .filter(p => String(p.practice_state || '').toUpperCase() === state);

    const latestMips = npi => {
      const years = [...mips.values()]
        .filter(r => String(r.npi) === String(npi))
        .map(r => Number(r.performance_year));
      if (!years.length) return null;
      const maxYear = Math.max(...years);
      return mips.get(`${npi}:${maxYear}`);
    };

    for (let pi = 1; pi < params.length; pi++) {
      const p = params[pi];
      if (typeof p === 'number') {
        const min = p;
        rows = rows.filter(r => {
          const m = latestMips(r.npi);
          return m && m.final_score !== null && m.final_score !== undefined &&
            Number(m.final_score) >= min;
        });
      } else if (String(p).startsWith('%')) {
        const term = String(p).replace(/%/g, '').toLowerCase();
        rows = rows.filter(r =>
          String(r.last_name || '').toLowerCase().includes(term) ||
          String(r.first_name || '').toLowerCase().includes(term) ||
          String(r.legal_business_name || '').toLowerCase().includes(term));
      } else {
        const prefix = String(p).replace(/%$/, '');
        rows = rows.filter(p2 =>
          String(p2.primary_taxonomy_code || '').startsWith(prefix));
      }
    }

    rows = rows
      .sort((a, b) => String(a.npi).localeCompare(String(b.npi)))
      .slice(0, 500)
      .map(p => {
        const m = latestMips(p.npi);
        return {
          ...p,
          performance_year: m ? m.performance_year : null,
          final_score: m ? m.final_score : null,
          mips_sync_timestamp: m ? m.sync_timestamp : null
        };
      });
    return { rows, rowCount: rows.length };
  }

  // --- intelligence cohort query (tests/intelligence.test.js) --------------

  // Joined providers + latest-year MIPS scan. The service builds the WHERE
  // clause dynamically; params are [state, taxonomyPattern?, minScore?].
  if (/FROM providers p/.test(sql) && /LEFT JOIN mips_performance_scores m/.test(sql)) {
    const state = String(params[0]).toUpperCase();
    let rows = [...providers.values()]
      .filter(p => String(p.practice_state || '').toUpperCase() === state);

    let pi = 1;
    if (pi < params.length && typeof params[pi] === 'string' && params[pi].includes('%')) {
      const pat = String(params[pi]).replace(/%/g, '').toLowerCase();
      rows = rows.filter(p =>
        String(p.primary_taxonomy_description || '').toLowerCase().includes(pat));
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
    nppesProviders,
    mips,
    get quality() { return quality; },
    exclusions,
    stateExclusions,
    queryLog,
    apiUsage
  },
  _reset: reset
};
