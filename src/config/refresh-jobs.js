// Scheduled refresh jobs and how old their last successful run may get
// before GET /health/data reports them stale. maxAgeHours is the schedule
// interval plus slack, so one late run does not alert but a missed one does.
// Job names must match the -Job argument given to tools/run-tracked.ps1.
module.exports = {
  'clia-director': { description: 'Daily QCOR lab-director backfill', maxAgeHours: 2 * 24 },
  'cannabis':      { description: 'Weekly cannabis certification refresh (all states)', maxAgeHours: 8 * 24 },
  'leie':          { description: 'Monthly OIG LEIE exclusion refresh', maxAgeHours: 35 * 24 },
  'clia':          { description: 'Quarterly CLIA laboratory refresh', maxAgeHours: 100 * 24 }
};
