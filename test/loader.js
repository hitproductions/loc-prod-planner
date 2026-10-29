// Moved to core/engine.js — the engine is no longer a test-only concern, it is the
// module the new web app consumes too. Re-exported here so the suites keep working
// without a churn of require paths.
//
// One difference: the suites load the engine with PROJECT_LIMIT 1 unless they ask otherwise.
// They test the overlap MECHANICS -- forcing, dividing, swaps, scoring -- against the small
// sample book, which only contends under the rule they were written for (any second project
// is an overlap). The studio's limit of 3 (Rudolf, 2026-10-29) has its own tests, which pass
// { limit: 3 } or read PROJECT_LIMIT from a default load.
const engine = require('../core/engine.js');
const loadAppsScript = (dir, opts) => {
  if (dir && typeof dir === 'object') { opts = dir; dir = null; }
  return engine.loadAppsScript(dir, { limit: 1, ...(opts || {}) });
};
module.exports = { ...engine, loadAppsScript };
