// Measures the sharing policy options against the seeded book, so the choice is
// made on numbers rather than intuition.
//
//   SHARE_CAP                max engineers on one project's dub+edit block
//   SHARE_PREFER_WHOLE_EDIT  divide dubbing before dividing editing
//
// Run: node tools/policy_sweep.js
const fs = require('fs');
const path = require('path');
const engineers = require('../validation/engineers.json');
const projects = require('../validation/projects.json');

const AS = path.join(__dirname, '..', 'appsscript');
const FILES = ['00_Engine_Assign.gs', '01_Engine_Replan.gs', '02_Engine_Stats.gs',
               '20_Config.gs', '10_Weeks.gs', '11_Wrapper.gs', '12_Capacity.gs'];
const EXPORTS = ['runAssign', 'computeStats', 'widx', 'weekLabel', 'quarterOf',
                 'activeRows', 'normalizeProject', 'plotBatch', 'stats',
                 'computeCapacity'];

// Load the real sources with the two knobs overridden.
function loadWith(cap, wholeEdit) {
  let src = FILES.map(f => fs.readFileSync(path.join(AS, f), 'utf8')).join('\n;\n');
  src = src.replace(/var SHARE_CAP = \d+;/, `var SHARE_CAP = ${cap};`);
  src = src.replace(/var SHARE_PREFER_WHOLE_EDIT = (true|false);/,
                    `var SHARE_PREFER_WHOLE_EDIT = ${wholeEdit};`);
  return new Function(`"use strict";\n${src}\n;return { ${EXPORTS.join(', ')} };`)();
}

function measure(cap, wholeEdit) {
  const A = loadWith(cap, wholeEdit);
  const batch = A.plotBatch(projects, [], engineers);
  const book = batch.new_rows.map((b, i) => ({ ...b, status: '', row_number: i + 2 }));
  const live = A.activeRows(book);
  const s = A.stats(book, engineers, '2026-08-12');
  const cap2 = A.computeCapacity(live, engineers, projects, '2026-08-12');

  const forcedRows = live.filter(b => /FORCED/i.test(b.note || ''));
  const forcedProjects = [...new Set(forcedRows.map(b => b.project))];

  // how many engineers hold each project's dub weeks / edit weeks
  const dubHolders = {}, editHolders = {};
  live.forEach(b => {
    if (b.phase === 'Dub') (dubHolders[b.project] = dubHolders[b.project] || new Set()).add(b.engineer);
    if (b.phase === 'Edit') (editHolders[b.project] = editHolders[b.project] || new Set()).add(b.engineer);
  });
  const splitDub = Object.keys(dubHolders).filter(k => dubHolders[k].size > 1);
  const splitEdit = Object.keys(editHolders).filter(k => editHolders[k].size > 1);

  // "frees up people": open record/edit engineer-weeks, and weeks with nobody free
  const q3 = cap2.free_by_quarter.filter(q => q.quarter === '2026-Q3')[0] || {};
  const noneFree = cap2.weeks.filter(w => w.recedit_free === 0).length;
  const totalOpen = cap2.weeks.reduce((a, w) => a + w.recedit_free, 0);

  return {
    cap: cap === 0 ? '∞' : String(cap),
    wholeEdit: wholeEdit ? 'yes' : 'no',
    rows: book.length,
    forcedRows: forcedRows.length,
    forcedProjects: forcedProjects.length,
    forcedNames: forcedProjects.join(', ') || '—',
    splitDub: splitDub.length,
    splitEdit: splitEdit.length,
    spread: s.totals.load_spread_weeks,
    busiest: s.totals.busiest + ' ' + s.engineers[0].weeks_booked,
    openRE: totalOpen,
    q3open: q3.open_recedit_weeks === undefined ? '-' : q3.open_recedit_weeks,
    noneFree,
  };
}

const rows = [];
for (const wholeEdit of [true, false]) {
  for (const cap of [2, 3, 4, 0]) rows.push(measure(cap, wholeEdit));
}

const H = ['cap', 'wholeEdit', 'rows', 'forcedRows', 'forcedProjects', 'splitDub', 'splitEdit',
           'spread', 'openRE', 'q3open', 'noneFree'];
const LABEL = { cap:'cap', wholeEdit:'edit whole', rows:'rows', forcedRows:'forced rows',
  forcedProjects:'forced projs', splitDub:'dub split', splitEdit:'edit split',
  spread:'spread', openRE:'open r/e wks', q3open:'Q3 open', noneFree:'wks nobody free' };
const w = {};
H.forEach(h => { w[h] = Math.max(LABEL[h].length, ...rows.map(r => String(r[h]).length)); });
console.log(H.map(h => LABEL[h].padStart(w[h])).join('  '));
console.log(H.map(h => '-'.repeat(w[h])).join('  '));
rows.forEach(r => console.log(H.map(h => String(r[h]).padStart(w[h])).join('  ')));

console.log('\nforced projects per setting:');
rows.forEach(r => console.log(`  cap ${r.cap}, edit whole ${r.wholeEdit}: ${r.forcedNames}`));
console.log('\n"open r/e wks" = total engineer-weeks of record/edit capacity still free across the horizon.');
console.log('"wks nobody free" = weeks where every eligible record/edit engineer is booked.');
