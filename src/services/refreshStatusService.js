const db = require('../config/database');
const REFRESH_JOBS = require('../config/refresh-jobs');

// Per-job health of the scheduled data refreshes. A job is healthy when its
// latest finished run succeeded and its last success is within maxAgeHours.
// A job that has never recorded a run is unhealthy: either it never ran or
// its scheduled task is not wrapped with tools/run-tracked.ps1.
async function getRefreshStatus({ jobs = REFRESH_JOBS, now = new Date() } = {}) {
  const result = await db.query(
    `SELECT job,
            MAX(finished_at) FILTER (WHERE status = 'success') AS last_success_at,
            (ARRAY_AGG(status ORDER BY started_at DESC, id DESC) FILTER (WHERE status <> 'running'))[1] AS last_status,
            MAX(finished_at) AS last_finished_at
       FROM data_refresh_runs
      WHERE job = ANY($1)
      GROUP BY job`,
    [Object.keys(jobs)]
  );
  const byJob = new Map(result.rows.map(r => [r.job, r]));

  const report = Object.entries(jobs).map(([job, cfg]) => {
    const row = byJob.get(job);
    const lastSuccessAt = row && row.last_success_at ? new Date(row.last_success_at) : null;
    const ageHours = lastSuccessAt ? (now - lastSuccessAt) / 36e5 : null;
    const stale = ageHours === null || ageHours > cfg.maxAgeHours;
    const lastRunFailed = Boolean(row && row.last_status === 'failed');
    return {
      job,
      description: cfg.description,
      lastSuccessAt: lastSuccessAt ? lastSuccessAt.toISOString() : null,
      lastStatus: row ? row.last_status || 'running' : 'never',
      maxAgeHours: cfg.maxAgeHours,
      stale,
      healthy: !stale && !lastRunFailed
    };
  });

  return { healthy: report.every(j => j.healthy), jobs: report };
}

module.exports = { getRefreshStatus };
