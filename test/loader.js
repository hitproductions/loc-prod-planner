// Moved to core/engine.js — the engine is no longer a test-only concern, it is the
// module the new web app consumes too. Re-exported here so the suites keep working
// without a churn of require paths.
module.exports = require('../core/engine.js');
