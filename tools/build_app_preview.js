// Assembles the web app the way HtmlService would (resolving <?!= include() ?>)
// and stubs google.script.run against the real engine over the seeded book, so
// the whole app can be driven outside Apps Script.
// Run: node tools/build_app_preview.js
const fs = require('fs');
const path = require('path');
const { loadAppsScript } = require('../test/loader.js');
const A = loadAppsScript();

const AS = path.join(__dirname, '..', 'appsscript');
const read = f => fs.readFileSync(path.join(AS, f), 'utf8');

const engineers = require('../validation/engineers.json');
const rawProjects = require('../validation/projects.json');
const today = '2026-08-12';

// Build a realistic book, then keep it in memory as the fake backend.
const batch = A.plotBatch(rawProjects, [], engineers);
let bookings = batch.new_rows.map((b, i) => ({ ...b, status: '', row_number: i + 2 }));
let projects = rawProjects.map(p => {
  const n = A.normalizeProject(p).project;
  return { ...n, phases: `${n.dub_weeks}/${n.edit_weeks}/${n.mix_weeks}`, committed: today };
});

// ---- resolve the includes exactly as HtmlService does ----------------------
let html = read('Index.html');
html = html.replace(/<\?!=\s*include\('([^']+)'\);?\s*\?>/g, (_, name) => read(name + '.html'));
if (/<\?/.test(html)) throw new Error('Unresolved Apps Script template tag remains.');

// ---- the stub backend -----------------------------------------------------
const stub = `
<script>
var FAKE = {
  engineers: ${JSON.stringify(engineers)},
  bookings: ${JSON.stringify(bookings)},
  projects: ${JSON.stringify(projects)},
  today: ${JSON.stringify(today)},
  clients: ["Netflix","Disney","Liquid Violet"]
};
</script>
<script>
${['00_Engine_Assign.gs','01_Engine_Replan.gs','02_Engine_Stats.gs',
   '10_Weeks.gs','11_Wrapper.gs','12_Capacity.gs'].map(read).join('\n;\n')}

// --- the api* surface, reimplemented over FAKE instead of SpreadsheetApp ---
function liveRows(){ return activeRows(FAKE.bookings); }
// Mirrors doubledProjects_/overlapDepths_ in 40_WebApp.gs. This whole stub is a
// second implementation of the read models and drifts from the real ones — it had
// already lost the per-booking items (so drag was dead here) and still counted the
// forced flag off the note. The fix is to run the real functions over a fake sheet.
function perEngineerWeek_(live){
  var per = {};
  live.forEach(function(b){
    if (!b || !b.engineer || !b.start_date || !b.end_date) return;
    for (var w = widx(b.start_date); w <= widx(b.end_date); w++) {
      var k = b.engineer+'|'+w; (per[k] = per[k] || []).push(b); }
  });
  return per;
}
function projectDepth_(live){
  var per = perEngineerWeek_(live), out = {};
  Object.keys(per).forEach(function(k){
    var n = per[k].length;
    if (n > 1) per[k].forEach(function(b){ if (n > (out[b.project]||0)) out[b.project] = n; });
  });
  return out;
}
function depthCounts_(live){
  var per = perEngineerWeek_(live), two = 0, three = 0;
  Object.keys(per).forEach(function(k){
    if (per[k].length === 2) two++; else if (per[k].length > 2) three++; });
  return { two: two, three: three };
}
function listProjects_(live){
  return FAKE.projects.map(function(p){
    var rows = live.filter(function(b){ return b.project === p.project_title; });
    return { title:p.project_title, client:p.client, deadline:p.deadline,
      phases:p.phases, mix_level:p.mix_level_required,
      music:/^yes$/i.test(p.music_songs), special:/^yes$/i.test(p.special_project),
      atmos:/^yes$/i.test(p.atmos_required),
      recordist_pick:p.recordist_override||'Auto',
      recordist_pick_2:p.recordist_override_2||'Auto',
      editor_pick:p.editor_override||'Auto', mixer_pick:p.mixer_override||'Auto',
      locked:p.locked===true,
      committed:p.committed, cancelled:false, live_rows:rows.length,
      notes: String(p.notes||''),
      // measured from the weeks, never from the note — same rule as 40_WebApp.gs
      overlap: projectDepth_(live)[p.project_title] || 0,
      forced: !!projectDepth_(live)[p.project_title],
      pinned: rows.some(function(b){ return /manual/i.test(b.note||''); }),
      rows: rows.map(function(b){ return {phase:b.phase, engineer:b.engineer,
        start:b.start_date, end:b.end_date, note:b.note||''}; }) };
  }).sort(function(a,b){ return String(a.deadline).localeCompare(String(b.deadline)); });
}
var API = {
  apiBootstrap: function(){
    var live = liveRows();
    return { today:FAKE.today, clients:FAKE.clients, orphans:[],
      engineers:FAKE.engineers.map(function(e){ return e.name; }), roster:FAKE.engineers,
      projects:listProjects_(live), problems:validateBook(FAKE.bookings, FAKE.engineers),
      counts:{ projects:FAKE.projects.length, live_rows:live.length,
        superseded_rows:FAKE.bookings.length-live.length,
        over2: depthCounts_(live).two, over3: depthCounts_(live).three,
        pinned_rows:live.filter(function(b){ return /manual/i.test(b.note||''); }).length } };
  },
  apiGetProject: function(title){
    var p = FAKE.projects.filter(function(x){ return x.project_title === title; })[0];
    if (!p) return {found:false};
    var ph = String(p.phases||'').split('/');
    return { found:true, title:p.project_title, client:p.client, deadline:p.deadline,
      dub:ph[0], edit:ph[1], mix:ph[2], mix_level:p.mix_level_required||'Advanced',
      music:/^yes$/i.test(p.music_songs), special:/^yes$/i.test(p.special_project),
      atmos:/^yes$/i.test(p.atmos_required),
      recordist:p.recordist_override||'Auto', recordist2:p.recordist_override_2||'Auto',
      editor:p.editor_override||'Auto', mixer:p.mixer_override||'Auto',
      live_rows:liveRows().filter(function(b){ return b.project===title; }).length };
  },
  apiCheckProject: function(p){
    var raw = { project_title:p.title, client:p.client, deadline:p.deadline,
      dub_weeks:p.dub, edit_weeks:p.edit, mix_weeks:p.mix,
      mix_level_required:p.mix_level, music_songs:p.music?'Yes':'No',
      special_project:p.special?'Yes':'No', atmos_required:p.atmos?'Yes':'No',
      recordist_override:p.recordist||'Auto', recordist_override_2:p.recordist2||'Auto',
      editor_override:p.editor||'Auto', mixer_override:p.mixer||'Auto' };
    var n = normalizeProject(raw);
    if (n.errors.length) return {ok:false, errors:n.errors};
    var book = liveRows().filter(function(b){ return b.project !== n.project.project_title; });
    var out = runAssign(n.project, book, FAKE.engineers);
    return { ok:true, errors:[], dry_run:true, title:n.project.project_title,
      recordist:out.recordist, dubber:out.dubber||out.recordist, editor:out.editor||out.recordist, mixer:out.mixer, warnings:out.warnings||'',
      record_note:out.record_note||'', mix_note:out.mix_note||'', forced:!!out.forced,
      replaces: liveRows().filter(function(b){ return b.project===n.project.project_title; }).length,
      rows:(out.booking_rows||[]).map(function(b){ return {phase:b.phase, engineer:b.engineer,
        start:b.start_date, end:b.end_date, note:b.note||''}; }) };
  },
  apiSaveProject: function(p){
    var res = API.apiCheckProject(p);
    if (!res.ok) return res;
    // supersede + append in the fake book so the UI reflects a real save
    var original = String(p.original_title||'').trim();
    var titles = [p.title].concat(original && original !== p.title ? [original] : []);
    var superseded = 0;
    FAKE.bookings.forEach(function(b){
      if (titles.indexOf(b.project) !== -1 && String(b.status||'').toLowerCase() !== 'superseded') {
        b.status = 'superseded'; superseded++;
      }
    });
    res.rows.forEach(function(r){
      FAKE.bookings.push({ project:p.title, phase:r.phase, engineer:r.engineer,
        start_date:r.start, end_date:r.end, source:'plot', note:r.note||'', status:'',
        row_number: FAKE.bookings.length + 2 });
    });
    var existing = FAKE.projects.filter(function(x){ return x.project_title === (original || p.title); })[0];
    var rec = { project_title:p.title, client:p.client, deadline:p.deadline,
      phases:[p.dub,p.edit,p.mix].join('/'), mix_level_required:p.mix_level,
      music_songs:p.music?'Yes':'No', special_project:p.special?'Yes':'No',
      atmos_required:p.atmos?'Yes':'No',
      recordist_override:p.recordist||'Auto', recordist_override_2:p.recordist2||'Auto',
      editor_override:p.editor||'Auto', mixer_override:p.mixer||'Auto',
      committed:FAKE.today, dub_weeks:+p.dub, edit_weeks:+p.edit, mix_weeks:+p.mix };
    if (existing) Object.keys(rec).forEach(function(k){ existing[k] = rec[k]; });
    else FAKE.projects.push(rec);
    res.dry_run = false;
    res.renamed = (original && original !== p.title) ? original : null;
    res.superseded = superseded;
    res.projects = listProjects_(liveRows());
    return res;
  },
  apiCancelProject: function(title){
    var superseded = 0;
    FAKE.bookings.forEach(function(b){
      if (b.project === title && String(b.status||'').toLowerCase() !== 'superseded') {
        b.status = 'superseded'; superseded++; } });
    return { ok:true, removed:title, superseded:superseded, projects:listProjects_(liveRows()) };
  },
  apiSchedule: function(mode, range){
    var live = liveRows();
    if (!live.length) return {empty:true, weeks:[], rows:[]};
    var minW = Infinity, maxW = -Infinity;
    live.forEach(function(b){ var a=widx(b.start_date), z=widx(b.end_date);
      if (a<minW) minW=a; if (z>maxW) maxW=z; });
    FAKE.projects.forEach(function(p){ if(!p.deadline) return; var d=widx(p.deadline);
      if (d>maxW) maxW=d; if (d<minW) minW=d; });
    var weeks=[]; for (var w=minW; w<=maxW; w++)
      weeks.push({week:w, start:weekStart(w), label:weekLabel(w),
                  day_range:weekDayRange(w), month:monthLabel(w), quarter:quarterOf(w)});
    var allQuarters = [];
    weeks.forEach(function(w){ if (allQuarters.indexOf(w.quarter) === -1) allQuarters.push(w.quarter); });
    allQuarters.sort();
    var qFrom = range && range.from, qTo = range && range.to;
    if (qFrom || qTo) weeks = weeks.filter(function(w){
      return (!qFrom || w.quarter >= qFrom) && (!qTo || w.quarter <= qTo); });
    var colOf = {}; weeks.forEach(function(w,i){ colOf[w.week] = i; });
    var byProject = mode !== 'engineer';
    var labels;
    if (byProject) {
      var dl={}; FAKE.projects.forEach(function(p){ dl[p.project_title]=p.deadline||'9999'; });
      var seen={}; live.forEach(function(b){ seen[b.project]=true; });
      labels = Object.keys(seen).sort(function(a,b){
        return String(dl[a]||'9999').localeCompare(String(dl[b]||'9999')) || a.localeCompare(b); });
    } else labels = FAKE.engineers.map(function(e){ return e.name; });
    var index={}; labels.forEach(function(l,i){ index[l]=i; });
    var cells = labels.map(function(){ return weeks.map(function(){ return null; }); });
    // an overlap is a WEEK one engineer is double-booked in, not a whole project
    var perEngWeek = {};
    live.forEach(function(b){
      for (var w=widx(b.start_date); w<=widx(b.end_date); w++) {
        var k = b.engineer+'|'+w; perEngWeek[k] = (perEngWeek[k]||0)+1; }
    });
    live.forEach(function(b){
      var key = byProject ? b.project : b.engineer;
      var ri = index[key]; if (ri === undefined) return;
      for (var w=widx(b.start_date); w<=widx(b.end_date); w++) {
        var ci = colOf[w]; if (ci === undefined) continue;
        var cur = cells[ri][ci], text = byProject ? b.engineer : b.project;
        var deep = perEngWeek[b.engineer+'|'+w] || 1;
        var over = deep > 1;
        var item = {p:b.project, ph:b.phase, hand:/moved by hand/i.test(b.note||''),
                    s:b.start_date, e:b.end_date, r:b.row_number,
                    was:(/\(was ([^)]+)\)/.exec(b.note||'')||[])[1]||''};
        if (!cur) cells[ri][ci] = {phase:b.phase, text:text,
          overlap:over, depth:deep, manual:/manual/i.test(b.note||''), count:1,
          items: byProject ? undefined : [item]};
        else { cur.text += ' / '+text; cur.count++;
          if (deep > (cur.depth||1)) cur.depth = deep;
          if (over) cur.overlap=true;
          if (cur.items) cur.items.push(item);
          if (/manual/i.test(b.note||'')) cur.manual=true; }
      }
    });
    var markers=[];
    if (byProject) FAKE.projects.forEach(function(p){
      if (!p.deadline || index[p.project_title]===undefined) return;
      var ci = colOf[widx(p.deadline)];
      if (ci !== undefined) markers.push({row:index[p.project_title], col:ci}); });
    if ((qFrom || qTo) && byProject) {
      var keep=[]; cells.forEach(function(row,ri){ if (row.some(function(c){return c;})) keep.push(ri); });
      var remap={}; keep.forEach(function(ri,i){ remap[ri]=i; });
      labels = keep.map(function(ri){ return labels[ri]; });
      cells  = keep.map(function(ri){ return cells[ri]; });
      markers = markers.filter(function(m){ return remap[m.row]!==undefined; })
        .map(function(m){ return {row:remap[m.row], col:m.col}; });
    }
    return {empty:false, mode:byProject?'project':'engineer', weeks:weeks, labels:labels,
      cells:cells, markers:markers,
      today_week: (colOf[widx(FAKE.today)] === undefined ? -1 : colOf[widx(FAKE.today)]),
      quarters: allQuarters, range: { from: qFrom || null, to: qTo || null }};
  },
  apiAnalysis: function(){
    var live = liveRows();
    var s = stats(FAKE.bookings, FAKE.engineers, FAKE.today);
    var cap = computeCapacity(live, FAKE.engineers, FAKE.projects, FAKE.today);
    return { empty:false, today:FAKE.today, problems:validateBook(FAKE.bookings, FAKE.engineers),
      horizon:s.horizon, totals:s.totals, engineers:s.engineers, by_quarter:s.by_quarter,
      forced_overlaps:s.forced_overlaps, manual_assignments:s.manual_assignments,
      pinned_count: live.filter(function(b){ return /manual/i.test(b.note||''); }).length,
      capacity:cap,
      replan:(function(){ var r = replanBook(FAKE.projects, FAKE.bookings, FAKE.engineers, FAKE.today);
        return { forced_before_rows:r.forced_before_rows, forced_after_rows:r.forced_after_rows,
          forced_locked_rows:r.forced_locked_rows, change_count:r.change_count,
          locked_rows:r.locked_rows, movable_rows:r.movable_rows }; })() };
  },
  apiSetProjectLock: function(title, locked){
    FAKE.projects.forEach(function(p){ if (p.project_title === title) p.locked = locked === true; });
    return { ok:true, title:title, locked:locked===true, projects:listProjects_(liveRows()) };
  },
  apiReplanPreview: function(){
    var r = replanBook(FAKE.projects, FAKE.bookings, FAKE.engineers, FAKE.today);
    return { empty:false, week_of:r.week_of, locked_rows:r.locked_rows, movable_rows:r.movable_rows,
      pinned_rows: liveRows().filter(function(b){ return /manual/i.test(b.note||''); }).length,
      forced_before_rows:r.forced_before_rows, forced_after_rows:r.forced_after_rows,
      forced_locked_rows:r.forced_locked_rows, change_count:r.change_count, changes:r.changes,
      locked_projects: FAKE.projects.filter(function(p){ return p.locked; }).map(function(p){ return p.project_title; }) };
  },
  apiReplanApply: function(){ return {ok:true, appended:0, superseded:0}; }
};

window.google = { script: { run: (function(){
  var ok=null, err=null;
  function make(name){
    return function(){
      var args = [].slice.call(arguments), f = ok, g = err;
      setTimeout(function(){
        try { f(API[name].apply(null, args)); }
        catch(e){ if (g) g(e); else console.error(name, e); }
      }, 30);
    };
  }
  var api = { withSuccessHandler:function(f){ ok=f; return api; },
              withFailureHandler:function(f){ err=f; return api; } };
  Object.keys(API).forEach(function(n){ api[n] = make(n); });
  return api;
})() } };

window.addEventListener('error', function(e){
  var d=document.createElement('div');
  d.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#EF4123;color:#fff;'+
    'padding:8px;font:12px monospace;z-index:999';
  d.textContent='JS ERROR: '+e.message+' @ line '+e.lineno;
  document.body.appendChild(d);
});
</script>
`;

html = html.replace('</head>', stub + '</head>');

const dir = path.join(__dirname, '..', 'preview');
fs.mkdirSync(dir, { recursive: true });
const dest = path.join(dir, 'app_preview.html');
fs.writeFileSync(dest, html);
console.log('wrote', dest);
console.log('projects:', projects.length, '| bookings:', bookings.length);
