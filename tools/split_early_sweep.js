// Does dividing long blocks EARLIER beat letting one engineer carry them?
// Run: node tools/split_early_sweep.js
const fs=require('fs'), path=require('path');
const AS=path.join(__dirname,'..','appsscript');
const F=['00_Engine_Assign.gs','01_Engine_Replan.gs','02_Engine_Stats.gs','20_Config.gs',
         '10_Weeks.gs','11_Wrapper.gs','12_Capacity.gs'];
const E=['plotBatch','scorePlan'];
const engineers=require('../validation/engineers.json');
const projects=require('../validation/projects.json');

function load(o){
  let src=F.map(f=>fs.readFileSync(path.join(AS,f),'utf8')).join('\n;\n');
  for (const [k,v] of Object.entries(o))
    src=src.replace(new RegExp('var '+k+' = [^;]+;'), `var ${k} = ${JSON.stringify(v)};`);
  return new Function(`"use strict";\n${src}\n;return { ${E.join(', ')} };`)();
}

const rows=[];
for (const cap of [2,0]) {
  for (const early of [0,4,5,6]) {
    const A=load({SHARE_CAP:cap, SPLIT_EARLY_ABOVE_WEEKS:early, SOLVE_RESTARTS:200});
    const b=A.plotBatch(projects,[],engineers);
    const s=A.scorePlan(b.new_rows, engineers);
    const worst=s.loads.slice().sort((x,y)=>y.double_booked-x.double_booked)[0];
    rows.push([ (cap===0?'∞':cap), early||'off', s.forced_projects, s.max_double_booked,
                s.total_double_booked, s.max_consecutive, s.regular_spread, s.regular_peak,
                worst.double_booked? worst.engineer : '-' ]);
  }
}
const H=['cap','split early >','forced','worst dbl','total dbl','max run','spread','peak','who carries it'];
const w=H.map((h,i)=>Math.max(h.length,...rows.map(r=>String(r[i]).length)));
console.log('dividing a long block earlier, instead of one engineer carrying all of it\n');
console.log(H.map((h,i)=>h.padEnd(w[i])).join('  '));
console.log(w.map(x=>'-'.repeat(x)).join('  '));
rows.forEach(r=>console.log(r.map((v,i)=>String(v).padEnd(w[i])).join('  ')));
