// The scheduling engine, loadable outside Apps Script.
//
// It reads the real .gs sources and evaluates them — no build step, and above all no
// second copy that can drift. That matters more now than it did as a test helper: two
// apps consume this, and if each carried its own copy of the scheduler they would give
// different answers within weeks. Every drift bug in this project's history came from
// exactly that shape, most recently the preview tool's hand-written stub of the read
// models (HANDOFF §9).
//
// The .gs files have no module syntax — Apps Script shares one global scope — so they
// are concatenated in load order and evaluated together. The engine files touch no
// SpreadsheetApp; the four Sheets helpers that live in 20_Config are defined here but
// never reached, since nothing on the engine path calls tz_() or sheetOrThrow().
const fs = require('fs');
const path = require('path');

// Same order Apps Script evaluates them in (filenames are numbered for this).
const GS_ORDER = [
  '00_Engine_Assign.gs',
  '01_Engine_Replan.gs',
  '02_Engine_Stats.gs',
  '20_Config.gs',
  '10_Weeks.gs',
  '11_Wrapper.gs',
  '12_Capacity.gs',
];

// Everything the tests reach for. Anything not listed simply isn't exposed.
const EXPORTS = [
  'improveBySwaps_', 'actualOverlaps_', 'SOLVE_OBJECTIVE',
  // engine (ported as-is)
  'runAssign', 'replan', 'computeStats',
  // weeks
  'widx', 'weekStart', 'weekEnd', 'weekLabel', 'weekDayRange', 'monthLabel', 'quarterOf', 'weeksOf',
  // wrapper
  'activeRows', 'normalizeProject', 'parsePhases', 'validateBook',
  'assertValidBook', 'plot', 'plotBatch', 'replanBook', 'stats', 'PHASES', 'LEVELS',
  // capacity
  'SHARE_CAP', 'SHARE_PREFER_WHOLE_EDIT', 'SOLVE_RESTARTS', 'SOLVE_OBJECTIVE',
  'solveOrder', 'scorePlan', 'engineerRoles', 'planIsBetter', 'replayOrder',
  'computeCapacity', 'weekSeries', 'freeCapacityByQuarter', 'bottleneck',
  'streaks', 'pipeline', 'weeksPerEngineer',
  'receditPool', 'advMixPool', 'advMixPoolWithOverflow',
  // the sheet's column contract, so the web app can check it manages nothing the
  // setup does not create
  'P_HEADERS', 'P_COL', 'E_HEADERS',
];

function appsScriptDir() { return path.join(__dirname, '..', 'appsscript'); }

// opts: { cap, wholeEdit } override the sharing policy, so a test can exercise
// the mechanism independently of whatever the studio's current default is.
function loadAppsScript(dir, opts) {
  if (dir && typeof dir === 'object') { opts = dir; dir = null; }
  dir = dir || appsScriptDir();
  let src = GS_ORDER
    .map(f => `// ===== ${f} =====\n` + fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n;\n');
  if (opts && opts.cap !== undefined)
    src = src.replace(/var SHARE_CAP = \d+;/, `var SHARE_CAP = ${opts.cap};`);
  if (opts && opts.wholeEdit !== undefined)
    src = src.replace(/var SHARE_PREFER_WHOLE_EDIT = (true|false);/,
                      `var SHARE_PREFER_WHOLE_EDIT = ${!!opts.wholeEdit};`);
  if (opts && opts.restarts !== undefined)
    src = src.replace(/var SOLVE_RESTARTS = \d+;/, `var SOLVE_RESTARTS = ${opts.restarts};`);
  const body = `"use strict";\n${src}\n;return { ${EXPORTS.join(', ')} };`;
  try {
    return new Function(body)();
  } catch (e) {
    throw new Error(`Failed to evaluate the .gs sources — this is a real syntax\n` +
                    `or scope error that would also break in Apps Script:\n  ${e.message}`);
  }
}

module.exports = { loadAppsScript, GS_ORDER, EXPORTS, appsScriptDir };
