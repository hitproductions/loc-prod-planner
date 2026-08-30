// Renders Analysis.html outside Apps Script with real computed data, so the
// dashboard can actually be looked at. Mirrors getAnalysisData() in 26_Analysis.gs.
// Run: node tools/build_preview.js  -> writes preview/analysis_preview.html
const fs = require('fs');
const path = require('path');
const { loadAppsScript } = require('../test/loader.js');
const A = loadAppsScript();

const engineers = require('../validation/engineers.json');
const rawProjects = require('../validation/projects.json');
const today = '2026-08-12';

// build a book the way batch entry would
const batch = A.plotBatch(rawProjects, [], engineers);
const bookings = batch.new_rows.map((b, i) => ({ ...b, status: '', row_number: i + 2 }));

const projects = rawProjects.map(p => A.normalizeProject(p).project);
const live = A.activeRows(bookings);
const s = A.stats(bookings, engineers, today);
const cap = A.computeCapacity(live, engineers, projects, today);
const r = A.replanBook(projects, bookings, engineers, today);

const payload = {
  empty: false,
  today,
  problems: A.validateBook(bookings, engineers),
  horizon: s.horizon,
  totals: s.totals,
  engineers: s.engineers,
  by_quarter: s.by_quarter,
  forced_overlaps: s.forced_overlaps,
  manual_assignments: s.manual_assignments,
  pinned_count: live.filter(b => /manual/i.test(b.note || '')).length,
  capacity: cap,
  replan: {
    forced_before_rows: r.forced_before_rows,
    forced_after_rows: r.forced_after_rows,
    forced_locked_rows: r.forced_locked_rows,
    change_count: r.change_count,
    locked_rows: r.locked_rows,
    movable_rows: r.movable_rows,
  },
};

const src = fs.readFileSync(path.join(__dirname, '..', 'appsscript', 'Analysis.html'), 'utf8');

// swap the Apps Script bridge for the computed payload
const stub = `
var ANALYSIS_DATA = ${JSON.stringify(payload)};
window.google = { script: { run: {
  withSuccessHandler: function(fn){ this._ok = fn; return this; },
  withFailureHandler: function(fn){ this._err = fn; return this; },
  getAnalysisData: function(){ var f = this._ok; setTimeout(function(){ f(ANALYSIS_DATA); }, 0); }
} } };
window.addEventListener('error', function(e){
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#EF4123;color:#fff;padding:8px;font:12px monospace;z-index:99';
  d.textContent = 'JS ERROR: ' + e.message + ' @ ' + e.lineno;
  document.body.appendChild(d);
});
`;
const out = src.replace('<script>\nvar TIP', '<script>\n' + stub + '\nvar TIP');
if (out === src) throw new Error('Could not inject the stub — the <script> anchor moved.');

const dir = path.join(__dirname, '..', 'preview');
fs.mkdirSync(dir, { recursive: true });
const dest = path.join(dir, 'analysis_preview.html');
fs.writeFileSync(dest, out);
console.log('wrote', dest);
console.log('forced overlaps:', payload.forced_overlaps.length,
            '| engineers:', payload.engineers.length,
            '| weeks:', cap.weeks.length,
            '| replan changes:', payload.replan.change_count);
