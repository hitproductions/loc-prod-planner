const { loadAppsScript } = require('../test/loader.js');
const A = loadAppsScript();
const W = A, C = A;
const engineers = require('../validation/engineers.json');
const projects  = require('../validation/projects.json');

const batch = W.plotBatch(projects, [], engineers);
const book = batch.new_rows.map((b,i)=>({...b, status:'', row_number:i+2}));
const cap = C.computeCapacity(book, engineers, projects, '2026-08-12');

console.log('POOLS (item 4 / criterion 12):');
console.log('  record+edit eligible     :', cap.pools.recedit.length, cap.pools.recedit.join(', '));
console.log('  Advanced mix (baseline)  :', cap.pools.adv_mix.length, cap.pools.adv_mix.join(', '));
console.log('  Advanced mix (+overflow) :', cap.pools.adv_mix_incl_overflow.length, cap.pools.adv_mix_incl_overflow.join(', '));
console.log('  Developing mix           :', cap.pools.developing_mix.length, cap.pools.developing_mix.join(', '));

console.log('\nSATURATION (weeks with zero free in that role):');
console.log('  record/edit :', cap.bottleneck.saturated_weeks.recedit, 'weeks');
console.log('  Advanced mix:', cap.bottleneck.saturated_weeks.adv_mix, 'weeks');

console.log('\nOVERSUBSCRIBED weeks (demand > eligible supply):');
console.log('  record/edit :', JSON.stringify(cap.bottleneck.oversubscribed_weeks.recedit));
console.log('  Advanced mix:', JSON.stringify(cap.bottleneck.oversubscribed_weeks.adv_mix));

console.log('\nWHERE FORCED OVERLAPS ACTUALLY LAND:');
const forced = book.filter(b=>/FORCED/i.test(b.note||''));
for (const b of forced) console.log('  ', b.project.padEnd(14), b.phase.padEnd(9), b.engineer, b.start_date, '->', b.end_date);
const byRole = { recedit:0, mix:0 };
for (const b of forced) (b.phase === 'Mix' ? byRole.mix++ : byRole.recedit++);
console.log('  => record/edit forced rows:', byRole.recedit, ' mix forced rows:', byRole.mix);

console.log('\nFREE CAPACITY BY QUARTER (never summed across roles):');
for (const q of cap.free_by_quarter)
  console.log(`  ${q.quarter}  weeks ${String(q.weeks).padStart(2)}   open record/edit ${String(q.open_recedit_weeks).padStart(3)} eng-wks   open Adv-mix ${String(q.open_adv_mix_weeks).padStart(3)} eng-wks   (sat: r/e ${q.saturated_recedit_weeks}, mix ${q.saturated_adv_mix_weeks})`);

console.log('\nTIGHTEST WEEKS, record/edit (free engineers):');
cap.weeks.slice().sort((a,b)=>a.recedit_free-b.recedit_free).slice(0,6)
  .forEach(w=>console.log(`  ${w.label.padEnd(12)} demand ${w.recedit_demand_projects}/${w.recedit_supply}  free ${w.recedit_free}  [${w.recedit_free_names.join(', ')||'nobody'}]`));
console.log('\nTIGHTEST WEEKS, Advanced mix (free mixers):');
cap.weeks.slice().sort((a,b)=>a.adv_mix_free-b.adv_mix_free).slice(0,6)
  .forEach(w=>console.log(`  ${w.label.padEnd(12)} demand ${w.mix_demand_projects}/${w.adv_mix_supply}  free ${w.adv_mix_free}  [${w.adv_mix_free_names.join(', ')||'nobody'}]`));

console.log('\nPIPELINE by client:');
for (const c of cap.pipeline.by_client) console.log(`  ${c.client.padEnd(16)} ${String(c.weeks).padStart(3)} wks  ${c.projects} projects`);
