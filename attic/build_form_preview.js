// Renders ProjectForm.html outside Apps Script, with checkProject/saveProject
// wired to the REAL engine over the seeded book, so the form can be exercised.
// Run: node tools/build_form_preview.js
const fs = require('fs');
const path = require('path');
const { loadAppsScript } = require('../test/loader.js');
const A = loadAppsScript();

const engineers = require('../validation/engineers.json');
const rawProjects = require('../validation/projects.json');

// a realistic existing book to plot against
const batch = A.plotBatch(rawProjects, [], engineers);
const bookings = batch.new_rows.map((b, i) => ({ ...b, status: '', row_number: i + 2 }));

const src = fs.readFileSync(path.join(__dirname, '..', 'appsscript', 'ProjectForm.html'), 'utf8');

const stub = `
var STUB = {
  engineers: ${JSON.stringify(engineers)},
  bookings: ${JSON.stringify(bookings)},
  options: ${JSON.stringify({
    clients: ['Netflix', 'Disney', 'Liquid Violet'],
    engineers: engineers.map(e => e.name),
    today: '2026-08-12',
    roster_ok: true,
  })}
};
// the wrapper + engine, inlined so the preview computes for real
${A.__source || ''}
window.google = { script: { run: (function(){
  var ok=null, err=null;
  var api = {
    withSuccessHandler: function(f){ ok=f; return api; },
    withFailureHandler: function(f){ err=f; return api; },
    getFormOptions: function(){ setTimeout(function(){ ok(STUB.options); },0); },
    checkProject: function(p){ setTimeout(function(){ try { ok(ENGINE.check(p)); } catch(e){ err(e); } },0); },
    saveProject:  function(p){ setTimeout(function(){ try { ok(ENGINE.save(p)); } catch(e){ err(e); } },0); }
  };
  return api;
})() } };
window.addEventListener('error', function(e){
  var d=document.createElement('div');
  d.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#EF4123;color:#fff;padding:8px;font:12px monospace;z-index:99';
  d.textContent='JS ERROR: '+e.message+' @ '+e.lineno; document.body.appendChild(d);
});
`;

// Inline the .gs logic the form depends on, then expose a tiny ENGINE shim.
const GS = ['00_Engine_Assign.gs','10_Weeks.gs','11_Wrapper.gs']
  .map(f => fs.readFileSync(path.join(__dirname, '..', 'appsscript', f), 'utf8')).join('\n;\n');

const engineShim = `
<script>
${GS}
var ENGINE = (function(){
  function raw(p){
    return { project_title:String(p.title||'').trim(), client:String(p.client||'').trim(),
      deadline:String(p.deadline||'').trim(), dub_weeks:p.dub, edit_weeks:p.edit, mix_weeks:p.mix,
      mix_level_required:String(p.mix_level||'').trim(),
      music_songs:p.music?'Yes':'No', special_project:p.special?'Yes':'No',
      recordist_override:String(p.recordist||'Auto'), mixer_override:String(p.mixer||'Auto') };
  }
  function describe(project, out){
    return { ok:true, errors:[], title:project.project_title, deadline:project.deadline,
      weeks:{dub:project.dub_weeks, edit:project.edit_weeks, mix:project.mix_weeks},
      recordist:out.recordist, mixer:out.mixer, warnings:out.warnings||'',
      record_note:out.record_note||'', mix_note:out.mix_note||'', forced:!!out.forced,
      rows:(out.booking_rows||[]).map(function(b){
        return {phase:b.phase, engineer:b.engineer, start:b.start_date, end:b.end_date, note:b.note||''}; }) };
  }
  return {
    check: function(p){
      var n = normalizeProject(raw(p));
      if (n.errors.length) return {ok:false, errors:n.errors};
      var book = activeRows(STUB.bookings).filter(function(b){ return b.project !== n.project.project_title; });
      var r = describe(n.project, runAssign(n.project, book, STUB.engineers));
      r.dry_run = true;
      r.replaces = activeRows(STUB.bookings).filter(function(b){ return b.project === n.project.project_title; }).length;
      return r;
    },
    save: function(p){
      var n = normalizeProject(raw(p));
      if (n.errors.length) return {ok:false, errors:n.errors};
      var r = describe(n.project, runAssign(n.project, activeRows(STUB.bookings), STUB.engineers));
      r.dry_run = false; r.superseded = 0;
      return r;
    }
  };
})();
</script>
`;

let out = src.replace('<script>\nvar $ = function', engineShim + '<script>\n' + stub + '\nvar $ = function');
if (out === src) throw new Error('Could not inject the stub — the <script> anchor moved.');

const dir = path.join(__dirname, '..', 'preview');
fs.mkdirSync(dir, { recursive: true });
const dest = path.join(dir, 'form_preview.html');
fs.writeFileSync(dest, out);
console.log('wrote', dest, '| book rows:', bookings.length);
