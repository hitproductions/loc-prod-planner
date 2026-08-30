// Everything is fetched once and rendered from memory. The measured round trip is
// shown in the header on purpose: the reason this app exists is speed, so the number
// that justifies it should be visible rather than claimed.
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

let BOOT = null, SCHED = null, VIEW = 'schedule', LAST_MS = null;
let MODE = 'engineer', RANGE = { from: null, to: null };

function scheduleUrl() {
  const q = new URLSearchParams({ mode: MODE });
  if (RANGE.from) q.set('from', RANGE.from);
  if (RANGE.to) q.set('to', RANGE.to);
  return '/api/schedule?' + q;
}

async function loadSchedule() {
  SCHED = await get(scheduleUrl());
  paint();
}

async function get(path) {
  const t0 = performance.now();
  const r = await fetch(path);
  const body = await r.json();
  LAST_MS = performance.now() - t0;
  return body;
}

function topRight() {
  const c = BOOT.counts;
  const wk = n => n + (n === 1 ? ' week' : ' weeks');
  const bits = [`<span class="pill">${c.projects} projects` +
    (c.done ? ` · ${c.done} done` : '') + ` · ${c.live_rows} bookings</span>`];
  if (c.over2) bits.push(`<span class="pill warn">${wk(c.over2)} with 2 overlaps</span>`);
  if (c.over3) bits.push(`<span class="pill bad">${wk(c.over3)} with 3+ overlaps</span>`);
  if (LAST_MS != null) bits.push(`<span class="pill timing">${LAST_MS.toFixed(0)} ms</span>`);
  $('topright').innerHTML = bits.join('');
}

function numLabel(w) {
  const d = new Date(w.start + 'T00:00:00Z');
  const e = new Date(d); e.setUTCDate(e.getUTCDate() + 6);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth()+1)}/${p(d.getUTCDate())} - ${p(e.getUTCMonth()+1)}/${p(e.getUTCDate())}`;
}

const PHASE_BG = { Dub:'var(--dub)', Edit:'var(--edit)', Mix:'var(--mix)' };

// A cell holding two bookings is one square on screen but two different things. It
// used to be filled solid blue with both names crammed into it and truncated, so the
// colour told you THAT something was doubled and hid WHAT — which is the part you need
// in order to fix it. Now each booking is its own band in its own phase colour, and
// the outline carries the depth. It also makes the drag honest: you grab the band you
// meant rather than a blob that happened to pick one.
//
// `label` differs by orientation: the Engineers grid shows project names, the Projects
// grid shows engineer names.
function cellBands(c, label, dragAttrs) {
  return '<div class="stack">' + c.items.map((it, i) => {
    const text = label(it, i);
    return `<span class="bk" style="background:${PHASE_BG[it.ph] || 'transparent'}"` +
      (dragAttrs ? dragAttrs(it) : '') +
      (it.hand ? ' data-hand="1" title="Moved by hand — click to give it back"' : '') +
      `>${esc(text)}</span>`;
  }).join('') + '</div>';
}

function scheduleBar() {
  const d = SCHED;
  const qs = d.quarters || [];
  const sel = (id, val) => `<select id="${id}"><option value="">any</option>` +
    qs.map(q => `<option${q === val ? ' selected' : ''}>${esc(q)}</option>`).join('') + '</select>';
  return '<div class="bar-row">' +
    `<button class="btn small${MODE === 'project' ? ' primary' : ''}" data-mode="project">Projects</button>` +
    `<button class="btn small${MODE === 'engineer' ? ' primary' : ''}" data-mode="engineer">Engineers</button>` +
    '<div class="spacer"></div>' +
    `<label class="inline">From</label>${sel('qFrom', RANGE.from)}` +
    `<label class="inline">To</label>${sel('qTo', RANGE.to)}` +
    '<button class="btn small" id="qAll">All</button>' +
    `<span class="hint" style="margin:0 0 0 12px">${d.weeks.length} weeks</span></div>`;
}

function wireScheduleBar() {
  document.querySelectorAll('[data-mode]').forEach(b =>
    b.addEventListener('click', () => { MODE = b.dataset.mode; loadSchedule(); }));
  const from = $('qFrom'), to = $('qTo');
  const apply = function () {
    let f = from.value || null, t = to.value || null;
    // Keep the ends the right way round rather than returning nothing at all.
    if (f && t && f > t) { if (this === to) from.value = t; else to.value = f;
      f = from.value || null; t = to.value || null; }
    RANGE = { from: f, to: t };
    loadSchedule();
  };
  if (from) from.addEventListener('change', apply);
  if (to) to.addEventListener('change', apply);
  const all = $('qAll');
  if (all) all.addEventListener('click', () => { RANGE = { from: null, to: null }; loadSchedule(); });
}

// Weeks DOWN, engineers ACROSS. Only ~8 columns, so each is wide enough for a project
// name — which is what the cells hold, and the whole reason this axis exists.
function renderEngineerGrid() {
  const d = SCHED;
  // A floor of 150 per engineer plus the week column. Above it the columns stretch to
  // fill the window; below it the wrapper scrolls instead of squashing them.
  const floor = 128 + d.labels.length * 150;
  let h = `<div class="gridwrap"><table class="sched byeng" style="min-width:${floor}px">` +
    '<thead><tr><th class="corner">Week</th>';
  d.labels.forEach((n, i) => { h += `<th data-c="${i}">${esc(n)}</th>`; });
  h += '</tr></thead><tbody>';
  let lastQ = null;
  d.weeks.forEach((w, ci) => {
    const starts = w.quarter !== lastQ; lastQ = w.quarter;
    const cls = [starts ? 'qstart' : '', w.start === BOOT.today_week ? 'nowrow' : '']
      .filter(Boolean).join(' ');
    h += `<tr${cls ? ` class="${cls}"` : ''}><th>${numLabel(w)}</th>`;
    d.labels.forEach((n, ri) => {
      const c = d.cells[ri][ci];
      const cls = [];
      let body = '';
      if (c) {
        const deep = c.depth || c.count || 1;
        cls.push('cell');
        if (deep > 1) cls.push(deep > 2 ? 'over3' : 'over2');
        if (c.items.some(i => i.hand)) cls.push('pinned');
        body = cellBands(c, it => it.p, it =>
          ` draggable="true" data-p="${esc(it.p)}" data-ph="${esc(it.ph)}"` +
          ` data-from="${esc(n)}" data-wk="${w.start}"`);
      }
      h += `<td class="${cls.join(' ')}" data-c="${ri}" data-eng="${esc(n)}"` +
           ` data-wk="${w.start}" title="${esc(c ? c.text : '')}">${body}</td>`;
    });
    h += '</tr>';
  });
  return h + '</tbody></table></div>';
}

// Projects DOWN, weeks ACROSS — a project is a bar you read left to right, and the
// deadline is a marker in its own row. Two header rows: a month band, and the day
// range under it. Fifty-eight columns of "06/22 06/28" is unreadable; grouped under
// JUN 2026 the eye finds a month without reading a single date.
function renderProjectGrid() {
  const d = SCHED;
  const mark = {};
  (d.markers || []).forEach(m => { mark[m.row + '|' + m.col] = true; });

  const months = [];
  let last = null;
  d.weeks.forEach(w => {
    if (w.month !== last) { months.push({ m: w.month, n: 1 }); last = w.month; }
    else months[months.length - 1].n++;
  });

  let h = '<div class="gridwrap"><table class="sched"><thead>';
  h += '<tr class="monthband"><th class="corner">Project</th>' +
    months.map(m => `<th colspan="${m.n}">${esc(m.m)}</th>`).join('') + '</tr>';
  h += '<tr><th class="corner"></th>' +
    d.weeks.map((w, ci) => `<th data-c="${ci}">${esc(w.day_range)}</th>`).join('') + '</tr>';
  h += '</thead><tbody>';

  d.labels.forEach((name, ri) => {
    h += `<tr><th title="${esc(name)}">${esc(name)}</th>`;
    d.weeks.forEach((w, ci) => {
      const c = d.cells[ri][ci];
      const cls = [];
      let body = '', text = '';
      if (c) {
        const deep = c.depth || c.count || 1;
        text = c.text;
        cls.push('cell');
        if (deep > 1) cls.push(deep > 2 ? 'over3' : 'over2');
        if (c.items.some(i => i.hand)) cls.push('pinned');
        // Not draggable here: a Projects row has no engineer column to drop into.
        body = cellBands(c, (it, i) => c.text.split(' / ')[i] || it.ph, null);
      } else if (mark[ri + '|' + ci]) {
        cls.push('marker'); body = '\u25B2';
      }
      h += `<td data-c="${ci}" class="${cls.join(' ')}"` +
           ` title="${esc(text ? text + ' \u00b7 ' + w.label : w.label + ' \u00b7 deadline')}">` +
           `${body}</td>`;
    });
    h += '</tr>';
  });
  return h + '</tbody></table></div>';
}

function renderSchedule() {
  const d = SCHED;
  if (d.empty) return '<div class="loading">No bookings yet.</div>';
  if (d.clipped) return scheduleBar() +
    '<div class="loading">No weeks in that range. Widen it or press All.</div>';
  let h = scheduleBar();
  h += d.mode === 'project' ? renderProjectGrid() : renderEngineerGrid();
  h += '<div class="legend">' +
    '<span><span class="sw" style="background:var(--dub)"></span>Dub</span>' +
    '<span><span class="sw" style="background:var(--edit)"></span>Edit</span>' +
    '<span><span class="sw" style="background:var(--mix)"></span>Mix</span>' +
    '<span><span class="sw split"></span>two bookings, one week</span>' +
    '<span><span class="sw" style="border:2px solid var(--warn);background:transparent"></span>2 overlaps this week</span>' +
    '<span><span class="sw" style="border:2px solid var(--red);background:transparent"></span>3 overlaps — reassign</span>' +
    '<span><span class="sw" style="border:2px dotted var(--fg1);background:transparent"></span>moved by hand — click to undo</span>' +
    (d.mode === 'project'
      ? '<span><span class="sw" style="background:var(--red)"></span>Deadline week</span>' : '') +
    '</div>';
  return h;
}

let SORT = 'deadline', SHOW_DONE = false;

function renderProjects() {
  const byTitle = (a, b) =>
    String(a.title).localeCompare(String(b.title), undefined, { numeric: true });
  const all = BOOT.projects.slice().sort(SORT === 'title' ? byTitle : (a, b) =>
    String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')) || byTitle(a, b));
  // Finished work is hidden, not deleted. The point of marking a project complete is
  // that it stops asking for your attention; the record stays one click away.
  const done = all.filter(p => p.status === 'Complete');
  const ps = SHOW_DONE ? all : all.filter(p => p.status !== 'Complete');

  let h = '<div class="bar-row"><button class="btn primary" id="addBtn">+ Add project</button>' +
    (done.length
      ? `<button class="btn small${SHOW_DONE ? ' primary' : ''}" id="toggleDone">` +
        `${SHOW_DONE ? 'Hide' : 'Show'} ${done.length} completed</button>`
      : '') +
    '<div class="spacer"></div>' +
    `<button class="btn small${SORT === 'deadline' ? ' primary' : ''}" data-sort="deadline">Deadline</button>` +
    `<button class="btn small${SORT === 'title' ? ' primary' : ''}" data-sort="title">A\u2013Z</button>` +
    '<span class="hint" style="margin:0 0 0 12px">Click a row to edit it.</span></div>' +
    '<div id="formHost"></div>';

  h += '<table class="projects"><thead><tr><th>Deadline</th><th>Project</th><th>Client</th>' +
    '<th>D/E/M</th><th>Recordist</th><th>Mixer</th><th>Flags</th></tr></thead><tbody>';
  ps.forEach(p => {
    let flags = '';
    if (p.overlap > 2) flags += '<span class="chip red">3 overlaps</span>';
    else if (p.overlap) flags += '<span class="chip warn">2 overlaps</span>';
    if (p.music) flags += '<span class="chip">music</span>';
    if (p.special) flags += '<span class="chip">special</span>';
    if (p.atmos) flags += '<span class="chip">atmos</span>';
    const who = ph => [...new Set(p.rows.filter(r => r.phase === ph).map(r => r.engineer))]
      .join(' + ') || '\u2014';
    if (p.status === 'Complete') {
      flags += `<span class="chip">completed ${esc(p.completed || '')}</span>`;
    }
    h += `<tr data-title="${esc(p.title)}"${p.status === 'Complete' ? ' class="dim"' : ''}>` +
      `<td>${esc(p.deadline)}</td>` +
      `<td><b>${esc(p.title)}</b></td><td>${esc(p.client)}</td>` +
      `<td>${p.dub}/${p.edit}/${p.mix}</td><td>${esc(who('Dub'))}</td><td>${esc(who('Mix'))}</td>` +
      `<td>${flags}</td></tr>`;
  });
  return h + '</tbody></table>';
}

function wireProjects() {
  const add = $('addBtn');
  if (add) add.addEventListener('click', () => openForm(null));
  const td = $('toggleDone');
  if (td) td.addEventListener('click', () => { SHOW_DONE = !SHOW_DONE; paint(); });
  document.querySelectorAll('[data-sort]').forEach(b =>
    b.addEventListener('click', () => { SORT = b.dataset.sort; paint(); }));
  document.querySelectorAll('table.projects tbody tr').forEach(tr =>
    tr.addEventListener('click', () => openForm(tr.dataset.title)));
}

// ---------------------------------------------------------------- the report
// What was delivered in a month. Keyed on when a project was marked done, not on its
// deadline — a job can land early or late, and this is about the month it was signed
// off in. Built to be printed: it is the thing that gets handed to someone.
async function loadReport(month) {
  $('view').innerHTML = '<div class="loading">Counting\u2026</div>';
  REPORT = await get('/api/report' + (month ? '?month=' + encodeURIComponent(month) : ''));
  MONTH = REPORT.month;
  paint();
}

const MONTH_NAME = m => {
  const [y, mm] = String(m).split('-');
  return ['January','February','March','April','May','June','July','August',
          'September','October','November','December'][Number(mm) - 1] + ' ' + y;
};

function renderReport() {
  if (!REPORT) return '<div class="loading">Counting\u2026</div>';
  const r = REPORT;

  let h = '<div class="bar-row noprint">' +
    '<label class="inline">Month</label><select id="rMonth">' +
    (r.months.length ? r.months.map(m =>
        `<option value="${esc(m)}"${m === r.month ? ' selected' : ''}>${esc(MONTH_NAME(m))}</option>`).join('')
      : `<option>${esc(MONTH_NAME(r.month))}</option>`) +
    '</select><div class="spacer"></div>' +
    '<button class="btn small" id="rPrint">Print</button></div>';

  h += `<div class="sheetdoc"><h1>Completed work \u2014 ${esc(MONTH_NAME(r.month))}</h1>`;

  if (!r.projects.length) {
    h += '<p class="muted">Nothing was marked complete in this month.</p>' +
      '<p class="hint">A project appears here once you mark it complete on its row in ' +
      'Projects. Nothing is inferred from deadlines — a job can be delivered early or ' +
      'late, and guessing would put work in the wrong month.</p></div>';
    return h;
  }

  const t = r.totals;
  h += `<p class="lede"><b>${t.projects} project${t.projects === 1 ? '' : 's'}</b> delivered, ` +
    `<b>${t.weeks} booked week${t.weeks === 1 ? '' : 's'}</b> of work` +
    (t.late ? ` \u00b7 ${t.on_or_before} on or before the deadline, <b>${t.late} late</b>`
            : ' \u00b7 all on or before the deadline') + '.</p>';

  h += '<table class="projects"><thead><tr><th>Delivered</th><th>Project</th><th>Client</th>' +
    '<th>D/E/M</th><th>Recordist</th><th>Editor</th><th>Mixer</th>' +
    '<th class="n">Weeks</th><th>Against deadline</th></tr></thead><tbody>' +
    r.projects.map(p => {
      const d = p.days_early;
      const vs = d === null ? '\u2014'
        : d === 0 ? 'on the day'
        : d > 0 ? `${d} day${d === 1 ? '' : 's'} early`
        : `<b style="color:var(--red)">${-d} day${d === -1 ? '' : 's'} late</b>`;
      let flags = '';
      if (p.music) flags += '<span class="chip">music</span>';
      if (p.special) flags += '<span class="chip">special</span>';
      if (p.atmos) flags += '<span class="chip">atmos</span>';
      return `<tr><td>${esc(p.completed)}</td><td><b>${esc(p.title)}</b> ${flags}</td>` +
        `<td>${esc(p.client)}</td><td>${esc(p.phases)}</td>` +
        `<td>${esc(p.dub.join(' + ') || '\u2014')}</td>` +
        `<td>${esc(p.edit.join(' + ') || '\u2014')}</td>` +
        `<td>${esc(p.mix.join(' + ') || '\u2014')}</td>` +
        `<td class="n">${p.weeks}</td><td>${vs}</td></tr>`;
    }).join('') + '</tbody></table>';

  h += '<div class="grid2" style="margin-top:22px">' +
    '<div><h2>By client</h2><table class="projects"><thead><tr><th>Client</th>' +
    '<th class="n">Projects</th><th class="n">Weeks</th></tr></thead><tbody>' +
    r.by_client.map(c => `<tr><td>${esc(c.name)}</td><td class="n">${c.projects}</td>` +
      `<td class="n">${c.weeks}</td></tr>`).join('') + '</tbody></table></div>' +
    '<div><h2>By engineer</h2><table class="projects"><thead><tr><th>Engineer</th>' +
    '<th class="n">Projects</th><th class="n">Weeks</th><th>Doing what</th>' +
    '</tr></thead><tbody>' +
    r.by_engineer.map(e => `<tr><td>${esc(e.name)}</td><td class="n">${e.projects}</td>` +
      `<td class="n">${e.weeks}</td><td class="muted-inline">` +
      esc(Object.keys(e.phases).sort().map(k => `${k} ${e.phases[k]}`).join(' \u00b7 ')) +
      '</td></tr>').join('') + '</tbody></table></div></div>';

  h += '<p class="hint" style="margin-top:20px">Weeks are booked-row weeks, the same ' +
    'unit the schedule and Analysis use. An engineer who did two phases on one project ' +
    'is counted once under Projects and for both phases under Weeks.</p></div>';
  return h;
}

function wireReport() {
  const m = $('rMonth');
  if (m) m.addEventListener('change', () => loadReport(m.value));
  const p = $('rPrint');
  if (p) p.addEventListener('click', () => window.print());
}

// ---------------------------------------------------------------- history
// Nothing is ever deleted — a row that stops being true is marked superseded and stays
// — but the rows alone say WHAT changed, not when or as part of what. The log ties
// them into events: one entry per thing you did.
async function loadHistory(index) {
  $('view').innerHTML = '<div class="loading">Reading the log\u2026</div>';
  HISTORY = await get('/api/history');
  OPENED = null;
  if (index != null) OPENED = await get('/api/history?event=' + index);
  paint();
}

function renderHistory() {
  if (!HISTORY) return '<div class="loading">Reading the log\u2026</div>';
  const evs = HISTORY.events || [];
  if (!evs.length) {
    return '<div class="card"><div class="t">History</div><div class="s">Nothing yet.</div>' +
      '<div class="hint">The log starts from the first change made through this app. ' +
      'Rows superseded before it existed are still in the Bookings tab \u2014 nothing has ' +
      'been lost \u2014 but they carry no date, so they cannot be placed on a timeline.</div></div>';
  }

  let h = '<div class="card"><div class="t">What has changed</div>' +
    `<div class="s">${evs.length} entr${evs.length === 1 ? 'y' : 'ies'} \u00b7 newest first ` +
    '\u00b7 click one to see what it did</div>' +
    '<table class="projects"><thead><tr><th>When</th><th>What</th><th></th>' +
    '</tr></thead><tbody>' +
    evs.map(e => `<tr data-ev="${e.index}"${OPENED && OPENED.event &&
        OPENED.event.index === e.index ? ' class="on"' : ''}>` +
      `<td class="mono">${esc(e.at)}</td><td>${esc(e.summary || e.action)}</td>` +
      `<td>${e.index === HISTORY.latest
        ? '<span class="chip">most recent</span>' : ''}</td></tr>`).join('') +
    '</tbody></table></div>';

  if (OPENED && OPENED.diff) {
    const d = OPENED.diff;
    h += '<div class="card"><div class="t">' + esc(OPENED.event.summary || OPENED.event.action) +
      `</div><div class="s">${esc(OPENED.event.at)} \u00b7 ` +
      `${d.counts.before} bookings \u2192 ${d.counts.after} \u00b7 ` +
      `overlapped weeks ${d.overlaps.before} \u2192 ${d.overlaps.after}</div>`;

    const rows = [];
    d.moved.forEach(m => rows.push([m.project, m.phase, m.start_date,
      `${m.from} \u2192 <b>${esc(m.engineer)}</b>`]));
    d.added.forEach(a => rows.push([a.project, a.phase, a.start_date,
      `<span class="chip">added</span> ${esc(a.engineer)}`]));
    d.removed.forEach(r => rows.push([r.project, r.phase, r.start_date,
      `<span class="chip">removed</span> ${esc(r.engineer)}`]));

    h += rows.length
      ? '<table class="projects"><thead><tr><th>Project</th><th>Phase</th><th>Week of</th>' +
        '<th>Change</th></tr></thead><tbody>' +
        rows.map(r => `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td>` +
          `<td>${esc(r[2])}</td><td>${r[3]}</td></tr>`).join('') + '</tbody></table>'
      : '<div class="hint">No booking changed \u2014 this touched the project row only.</div>';

    // Only the latest, and the button says why rather than being mysteriously absent.
    h += OPENED.event.index === HISTORY.latest
      ? '<div class="formactions"><button class="btn danger" id="hRoll">Roll this back</button>' +
        '<span class="hint" style="margin:0">Puts the rows back the way they were. ' +
        'Reversible \u2014 it is logged as a change of its own.</span></div>'
      : '<div class="hint" style="margin-top:14px">Only the most recent change can be ' +
        'rolled back. Undoing an earlier one would revive rows that later changes have ' +
        'moved past, giving you a schedule that never existed.</div>';
    h += '</div>';
  }
  return h;
}

function wireHistory() {
  document.querySelectorAll('[data-ev]').forEach(tr =>
    tr.addEventListener('click', () => loadHistory(tr.dataset.ev)));
  const b = $('hRoll');
  if (b) b.addEventListener('click', async () => {
    if (!confirm('Roll this back?\n\n' + (OPENED.event.summary || OPENED.event.action) +
                 '\n\nThe rows it wrote are retired and the ones it replaced come back. ' +
                 'Nothing is deleted.')) return;
    b.disabled = true;
    const r = await post('/api/rollback', { index: OPENED.event.index });
    if (!r.ok) { alert(r.error); b.disabled = false; return; }
    absorb(r);
    HISTORY = null; OPENED = null;
    loadHistory();
  });
}

// ---------------------------------------------------------------- analysis
// Ordered by the decision each figure answers, not by what is easy to compute.
// Overlaps first because they are the only thing here with an action attached; then
// whether there is room to take more work; then who is carrying it.
async function loadAnalysis() {
  $('view').innerHTML = '<div class="loading">Counting\u2026</div>';
  ANALYSIS = await get('/api/analysis');
  paint();
}

function renderAnalysis() {
  if (!ANALYSIS) return '<div class="loading">Counting\u2026</div>';
  const a = ANALYSIS;
  const o = a.overlaps;

  let h = '<div class="bar-row"><button class="btn small" id="anRefresh">Refresh</button>' +
    `<span class="hint" style="margin:0 0 0 12px">Week of ${esc(a.today)} \u00b7 horizon ` +
    `${esc(a.horizon.from)} \u2192 ${esc(a.horizon.to)} \u00b7 ${a.horizon.weeks} weeks</span></div>`;

  // ---------------------------------------------------- can we take work?
  h += section('Can we take work?');

  h += '<div class="card"><div class="t">Overlaps</div>' +
    `<div class="s">${wk(o.pair_weeks)} with two at once, ${wk(o.deep_weeks)} with three or more` +
    (o.by_engineer.length ? ' \u00b7 carried by ' +
      o.by_engineer.map(e => `${esc(e.engineer)} (${e.forced_rows})`).join(', ') : '') + '</div>';
  if (!o.collisions.length) {
    h += '<div class="hint">None \u2014 nobody holds two projects in the same week.</div>';
  } else {
    h += '<table class="projects"><thead><tr><th>Engineer</th><th>Week of</th>' +
      '<th>Colliding work</th></tr></thead><tbody>' +
      o.collisions.map(c => `<tr${c.depth > 2 ? ' class="rowbad"' : ''}>` +
        `<td><b>${esc(c.engineer)}</b>${c.depth > 2 ? ` <span class="chip red">${c.depth} at once</span>` : ''}</td>` +
        `<td>${esc(c.start)}</td><td>${esc(c.work.join('  +  '))}</td></tr>`).join('') +
      '</tbody></table>';
  }
  h += '</div>';

  h += '<div class="grid2">' +
    demandCard(a, 'recedit', 'Dub or edit \u2014 projects per week', a.pools.recedit,
               a.pools.recedit.length) +
    demandCard(a, 'adv_mix', 'Advanced mix \u2014 projects per week', a.pools.adv_mix,
               a.pools.adv_mix.length,
               a.pools.adv_mix_incl_overflow.length - a.pools.adv_mix.length) + '</div>';

  h += freeCard(a);
  h += clientCard(a);

  // ---------------------------------------------------- who is overloaded?
  h += section('Who is overloaded?');
  h += heatmapCard(a);

  h += '<div class="banner">Every figure here counts booking-row weeks, so it reconciles ' +
    'with the schedule grid. If the heatmap says an engineer has 16 weeks, counting their ' +
    'cells in the grid gives 16. Superseded rows are never included.</div>';
  return h;
}

const wk = n => n + (n === 1 ? ' week' : ' weeks');
const section = t => `<div class="head"><span class="bar"></span><h2>${esc(t)}</h2></div>`;

// Demand against the people who can actually do it. Never a total across roles: a dub
// week and an Advanced-mix week are different currencies, and summing them would claim
// capacity the studio does not have.
function demandCard(a, role, title, pool, supply, reserve) {
  const dKey = role === 'recedit' ? 'recedit_demand_projects' : 'mix_demand_projects';
  const oKey = role === 'recedit' ? 'recedit_over' : 'adv_mix_over';
  const fKey = role === 'recedit' ? 'recedit_free_names' : 'adv_mix_free_names';
  const weeks = a.weeks;
  const max = Math.max(supply + 1, ...weeks.map(w => w[dKey]), 1);

  const W = 620, H = 200, PL = 26, PR = 8, PT = 14, PB = 30;
  const iw = W - PL - PR, ih = H - PT - PB;
  const slot = iw / weeks.length;
  const bw = Math.max(2, slot - 2);
  const x = i => PL + i * slot;
  const y = v => PT + ih - (v / max) * ih;

  let g = '';
  // horizontal rules and their labels, so a bar can be read as a number
  for (let t = 0; t <= max; t++) {
    if (max > 6 && t % 2) continue;
    g += `<line x1="${PL}" x2="${W - PR}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" ` +
      'stroke-width="1" opacity=".5"></line>' +
      `<text x="${PL - 6}" y="${(y(t) + 4).toFixed(1)}" font-size="11" text-anchor="end" ` +
      `fill="var(--fg2)">${t}</text>`;
  }
  // month ticks along the bottom — 47 week labels will not fit, and the month is what
  // you actually navigate by
  let lastMonth = null;
  weeks.forEach((w, i) => {
    const m = (w.label || '').split(' ')[0];
    if (m === lastMonth) return;
    lastMonth = m;
    g += `<text x="${x(i).toFixed(1)}" y="${H - 10}" font-size="11" fill="var(--fg2)">` +
      `${esc(m)}</text>`;
  });
  weeks.forEach((w, i) => {
    const v = w[dKey], over = w[oKey] > 0;
    if (v <= 0) return;
    g += `<rect x="${x(i).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" ` +
      `height="${Math.max(1, ih - (y(v) - PT)).toFixed(1)}" ` +
      `fill="${over ? 'var(--red)' : 'var(--fg2)'}" fill-opacity="${over ? 1 : 0.55}">` +
      `<title>${esc(w.label)}: ${v} needed, ${supply} can do it` +
      `${over ? ` — over by ${w[oKey]}` : ''}\nfree: ${(w[fKey] || []).join(', ') || 'nobody'}` +
      '</title></rect>';
    // over-capacity weeks are labelled, because that is the one thing on the chart
    // with a decision attached
    if (over) {
      g += `<text x="${(x(i) + bw / 2).toFixed(1)}" y="${(y(v) - 5).toFixed(1)}" font-size="11" ` +
        `font-weight="700" text-anchor="middle" fill="var(--red)">+${w[oKey]}</text>`;
    }
  });
  // the supply threshold, labelled at the right so it never sits on top of the bars
  g += `<line x1="${PL}" x2="${W - PR}" y1="${y(supply)}" y2="${y(supply)}" ` +
    'stroke="var(--fg1)" stroke-width="2" stroke-dasharray="4 3"></line>' +
    `<text x="${W - PR}" y="${(y(supply) - 6).toFixed(1)}" font-size="11" text-anchor="end" ` +
    `font-weight="700" fill="var(--fg1)">eligible supply ${supply}</text>`;

  const over = weeks.filter(w => w[oKey] > 0);
  const full = weeks.filter(w => w[oKey] === 0 && (w[fKey] || []).length === 0);

  return '<div class="card"><div class="t">' + esc(title) + '</div>' +
    `<div class="s">Can do it: ${pool.map(esc).join(', ')}` +
    (reserve ? ` \u00b7 plus ${reserve} in reserve` : '') + '</div>' +
    `<svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg>` +
    `<div class="sub">${over.length
      ? `<b>${wk(over.length)} short-handed</b> \u2014 more projects need this role than there ` +
        'are people who can do it. No arrangement fixes that; only hiring or a later deadline.'
      : 'Never short-handed in this horizon.'}` +
    (full.length ? ` ${wk(full.length)} with everyone busy \u2014 a re-plan may still help there.`
                 : '') + '</div></div>';
}

// The question a producer actually asks: can we start something next week, and who on.
function freeCard(a) {
  const rows = a.weeks.slice(0, 10).map(w => {
    const rec = w.recedit_free_names || [], mix = w.adv_mix_free_names || [];
    const cell = list => list.length
      ? esc(list.join(', ')) : '<b style="color:var(--red)">nobody free</b>';
    return `<tr><td>${esc(w.label)}</td><td>${cell(rec)}</td><td>${cell(mix)}</td></tr>`;
  }).join('');
  return '<div class="card"><div class="t">Who is free, week by week</div>' +
    '<div class="s">Next 10 weeks</div>' +
    '<table class="projects"><thead><tr><th>Week</th><th>Free for dub or edit</th>' +
    `<th>Free for Advanced mix</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function clientCard(a) {
  const by = (a.pipeline && a.pipeline.by_client) || [];
  return '<div class="card"><div class="t">Where the work comes from</div>' +
    '<table class="projects"><thead><tr><th>Client</th><th class="n">Weeks</th>' +
    '<th class="n">Projects</th></tr></thead><tbody>' +
    by.map(c => `<tr><td>${esc(c.client)}</td><td class="n">${c.weeks}</td>` +
      `<td class="n">${c.projects}</td></tr>`).join('') + '</tbody></table></div>';
}

// Booked weeks per engineer per quarter. A year of per-week bars for eight people is
// unreadable; per quarter it is a shape you can take in at once.
function heatmapCard(a) {
  const qs = a.quarters;
  const names = Object.keys(a.per_engineer)
    .sort((x, y) => a.per_engineer[y] - a.per_engineer[x]);
  let peak = 1;
  qs.forEach(q => names.forEach(n => {
    const v = (a.by_quarter[q] || {})[n] || 0;
    if (v > peak) peak = v;
  }));
  const shade = v => v === 0 ? 'var(--bg2)'
    : `var(--r${Math.min(5, Math.max(0, Math.round((v / peak) * 5)))})`;

  return '<div class="card"><div class="t">Weeks booked per engineer, per quarter</div>' +
    `<div class="s">Darker = busier \u00b7 spread ${a.score.regular_spread}, ` +
    `peak ${a.score.regular_peak}</div>` +
    '<table class="hm"><thead><tr><th></th>' +
    qs.map(q => `<th>${esc(q.replace('20', "'"))}</th>`).join('') +
    '<th class="n">Total</th></tr></thead><tbody>' +
    names.map(n => {
      const load = a.score.loads.find(l => l.engineer === n) || {};
      return `<tr><th>${esc(n)}</th>` +
        qs.map(q => {
          const v = (a.by_quarter[q] || {})[n] || 0;
          return `<td class="cell" style="background:${shade(v)}` +
            `${v / peak > 0.6 ? ';color:#fff' : ''}">${v || ''}</td>`;
        }).join('') +
        `<td class="n"><b>${a.per_engineer[n]}</b>` +
        (load.double_booked ? ` <span class="chip warn">${load.double_booked} doubled</span>` : '') +
        '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

// ---------------------------------------------------------------- re-plan
// Two steps on purpose. The preview writes nothing and is held server-side with the
// version of the book it was computed against; apply sends back only a token. If
// anything moved the book in between, the server refuses rather than writing a plan
// nobody was shown.
let REPLAN = null;

function renderReplan() {
  let h = '<div class="bar-row"><button class="btn primary" id="rpRun">Preview re-plan</button>' +
    '<span class="hint" style="margin:0 0 0 12px">Writes nothing until you apply.</span></div>' +
    '<p class="muted" style="margin-top:0">Re-planning never moves dates — deadlines are fixed, ' +
    'so a re-solve only ever changes who. Anything already under way is left alone, and so is ' +
    'anything you set by hand.</p><div id="rpOut"></div>';
  return h;
}

function wireReplan() {
  $('rpRun').addEventListener('click', runReplan);
  if (REPLAN) $('rpOut').innerHTML = replanBody(REPLAN);
  if ($('rpApply')) $('rpApply').addEventListener('click', applyReplan);
}

async function runReplan() {
  $('rpRun').disabled = true;
  $('rpOut').innerHTML = '<div class="muted">Trying other arrangements\u2026</div>';
  REPLAN = await post('/api/replan', {});
  $('rpRun').disabled = false;
  $('rpOut').innerHTML = replanBody(REPLAN);
  if ($('rpApply')) $('rpApply').addEventListener('click', applyReplan);
}

function replanBody(r) {
  if (!r.ok) return `<div class="errs">${esc(r.error || 'Re-plan failed.')}</div>`;
  if (r.no_improvement) {
    return '<div class="msg soft">Nothing to change. The schedule you have is already the ' +
      'best arrangement available — every alternative tried was the same or worse.</div>' +
      '<p class="muted">Re-plan cannot move work that has already started, so the further ' +
      'into the year you are the less room it has. This is a normal answer, not a failure.</p>';
  }

  const after = r.overlaps_after || [], resolved = r.overlaps_resolved || [];
  const deep = after.filter(o => o.projects.length > 2).length;
  const made = after.filter(o => o.isNew).length;

  // What IMPROVED, not just what moved. A plan that shifts 27 assignments and resolves
  // no overlaps reads as pointless until you can see it closed the gap between the
  // busiest and quietest engineer from three weeks to one. The objective is ranked, so
  // the first term that differs is the whole reason one plan beat the other.
  let h = `<div class="msg${deep ? '' : ' soft'}">` +
    `<b>${r.change_count} assignment${r.change_count === 1 ? '' : 's'} would move.</b> ` +
    (r.why
      ? `${esc(r.why.label)}: <b>${r.why.from} \u2192 ${r.why.to}</b>.`
      : 'The arrangement is equivalent on every measure.') +
    (resolved.length || made
      ? ` ${resolved.length} overlap${resolved.length === 1 ? '' : 's'} resolved, ${made} new` +
        (deep ? ` \u2014 ${deep} at three or more` : '') + '.'
      : ' Overlaps are unchanged.') +
    '</div>';

  if (after.length || resolved.length) {
    h += '<h3 style="margin-top:22px;font-size:13px;text-transform:uppercase;' +
      'letter-spacing:.07em">Who would be holding more than one, week by week</h3>' +
      '<table class="projects"><thead><tr><th>Week</th><th>Engineer</th>' +
      '<th>Projects colliding</th><th></th></tr></thead><tbody>' +
      resolved.map(o => `<tr class="dim"><td>${esc(o.label)}</td><td>${esc(o.engineer)}</td>` +
        `<td>${esc(o.projects.join('  +  '))}</td><td><span class="chip">resolved</span></td></tr>`).join('') +
      after.map(o => `<tr><td>${esc(o.label)}</td><td>${esc(o.engineer)}</td>` +
        `<td>${esc(o.projects.join('  +  '))}</td><td>` +
        (o.isNew ? '<span class="chip red">new</span>' : '<span class="chip">stays</span>') +
        (o.projects.length > 2 ? `<span class="chip red">${o.projects.length} at once</span>`
                               : '<span class="chip warn">2 at once</span>') +
        '</td></tr>').join('') + '</tbody></table>';
  }

  h += '<table class="projects" style="margin-top:18px"><thead><tr><th>Project</th>' +
    '<th>Phase</th><th>From</th><th>To</th></tr></thead><tbody>' +
    (r.changes || []).map(c => `<tr><td><b>${esc(c.project)}</b></td><td>${esc(c.phase)}</td>` +
      `<td>${esc(c.from)}</td><td>${esc(c.to)}</td></tr>`).join('') + '</tbody></table>';

  h += '<div class="formactions"><button class="btn primary" id="rpApply">Apply re-plan</button>' +
    '<span class="hint" style="margin:0">Reversible \u2014 old rows become superseded, ' +
    'never deleted.</span></div>';
  return h;
}

async function applyReplan() {
  $('rpApply').disabled = true;
  const r = await post('/api/replan-apply', { token: REPLAN.token });
  if (!r.ok) {
    $('rpOut').innerHTML = `<div class="errs">${esc(r.error)}</div>` + replanBody(REPLAN);
    if ($('rpApply')) $('rpApply').addEventListener('click', applyReplan);
    return;
  }
  REPLAN = null;
  absorb(r);
  $('rpOut').innerHTML = '<div class="msg soft">Applied. ' + r.appended + ' row(s) added, ' +
    r.superseded + ' superseded. Nothing was deleted.</div>';
}

// ---------------------------------------------------------------- the form
// Check availability writes nothing and answers "can we take this job". Plot & save
// commits. Both go through the same engine call, so the answer you were shown is the
// answer you get.
function openForm(title) {
  const p = title ? BOOT.projects.find(x => x.title === title) : null;
  const opts = sel => ['Auto', ...BOOT.engineers]
    .map(n => `<option${n === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');

  $('formHost').innerHTML = `<div class="form${p ? ' editing' : ''}">
    <h3>${p ? 'Edit ' + esc(p.title) : 'Add project'}</h3>
    <div class="note">Check availability first if you are deciding whether to take the job.</div>
    <div class="fields">
      <div class="f"><label for="f_title">Project</label>
        <input type="text" id="f_title" value="${p ? esc(p.title) : ''}"></div>
      <div class="f"><label for="f_client">Client</label>
        <input type="text" id="f_client" list="clientList" value="${esc(p ? p.client : 'Netflix')}">
        <datalist id="clientList">${(BOOT.clients || []).map(c => `<option>${esc(c)}</option>`).join('')}</datalist></div>
      <div class="f"><label for="f_deadline">Deadline</label>
        <input type="date" id="f_deadline" value="${p ? esc(p.deadline) : ''}"></div>
      <div class="f"><label for="f_level">Mix level</label><select id="f_level">
        <option${p && p.mix_level === 'Developing' ? '' : ' selected'}>Advanced</option>
        <option${p && p.mix_level === 'Developing' ? ' selected' : ''}>Developing</option></select></div>
    </div>

    <div class="fields row2">
      <div class="f span2"><label>Weeks per phase</label><div class="phases">
        <div class="p"><input type="number" id="f_dub" min="0" max="52" value="${p ? p.dub : 0}">
          <div class="hint"><span class="sw" style="background:var(--dub)"></span>Dub</div></div>
        <div class="p"><input type="number" id="f_edit" min="0" max="52" value="${p ? p.edit : 0}">
          <div class="hint"><span class="sw" style="background:var(--edit)"></span>Edit</div></div>
        <div class="p"><input type="number" id="f_mix" min="0" max="52" value="${p ? p.mix : 0}">
          <div class="hint"><span class="sw" style="background:var(--mix)"></span>Mix</div></div>
      </div><div class="hint">Zero is valid \u2014 the phase does not exist. Phases plot backward from the deadline.</div></div>
      <div class="f span2"><label>Flags</label><div class="checks">
        <label><input type="checkbox" id="f_music"${p && p.music ? ' checked' : ''}> Music</label>
        <label><input type="checkbox" id="f_special"${p && p.special ? ' checked' : ''}> Special</label>
        <label><input type="checkbox" id="f_atmos"${p && p.atmos ? ' checked' : ''}> Atmos</label>
      </div><div class="hint">Atmos is separate from Special: Special routes the work to the
        specials engineer, Atmos means the mix needs the room.</div></div>
    </div>

    <div class="picks">
      <div class="pickhead">Who does it \u2014 leave on Auto and the engine decides</div>
      <div class="fields">
        <div class="f"><label for="f_rec">Recordist</label><select id="f_rec">${opts(p && p.recordist_pick)}</select></div>
        <div class="f"><label for="f_rec2">Second recordist</label><select id="f_rec2">${opts(p && p.recordist_pick_2)}</select>
          <div class="hint">Splits the dub between the two, first name taking the earlier weeks.</div></div>
        <div class="f"><label for="f_ed">Editor</label><select id="f_ed">${opts(p && p.editor_pick)}</select>
          <div class="hint">Auto keeps the edit with the recordist.</div></div>
        <div class="f"><label for="f_mixer">Mixer</label><select id="f_mixer">${opts(p && p.mixer_pick)}</select>
          <div class="hint">A manual pick overrides every rule and is flagged.</div></div>
      </div>
    </div>
    <div class="formactions">
      <button class="btn" id="f_check">Check availability</button>
      <button class="btn primary" id="f_save">${p ? 'Save &amp; re-plot' : 'Plot &amp; save'}</button>
      ${p ? `<button class="btn" id="f_done">${p.status === 'Complete'
        ? 'Reopen' : 'Mark complete'}</button>` : ''}
      <button class="btn" id="f_close">Close</button>
    </div>
    <div id="f_out"></div></div>`;

  $('formHost').scrollIntoView({ block: 'nearest' });
  $('f_check').addEventListener('click', () => submitForm(p, true));
  $('f_save').addEventListener('click', () => submitForm(p, false));
  $('f_close').addEventListener('click', () => { $('formHost').innerHTML = ''; });
  if ($('f_done')) $('f_done').addEventListener('click', async () => {
    const to = p.status === 'Complete' ? '' : 'Complete';
    if (!confirm(to
      ? `Mark ${p.title} complete?\n\nIt drops out of the list and re-plan leaves it ` +
        'alone. Its bookings stay on the schedule \u2014 the work happened.'
      : `Reopen ${p.title}?\n\nIt goes back in the list and re-plan can move it again.`)) return;
    const r = await post('/api/set-status', { title: p.title, status: to });
    if (!r.ok) return alert(r.error);
    absorb(r);
    $('formHost').innerHTML = '';
  });
}

function formValues(p, dryRun) {
  return {
    title: $('f_title').value.trim(),
    original_title: p ? p.title : '',
    client: $('f_client').value.trim(),
    deadline: $('f_deadline').value,
    dub: +$('f_dub').value, edit: +$('f_edit').value, mix: +$('f_mix').value,
    mix_level: $('f_level').value,
    music: $('f_music').checked, special: $('f_special').checked, atmos: $('f_atmos').checked,
    recordist: $('f_rec').value, recordist2: $('f_rec2').value,
    editor: $('f_ed').value, mixer: $('f_mixer').value,
    dry_run: dryRun,
  };
}

async function submitForm(p, dryRun) {
  $('f_check').disabled = $('f_save').disabled = true;
  $('f_out').innerHTML = '<div class="muted">' + (dryRun ? 'Checking' : 'Plotting') + '\u2026</div>';
  const r = await post('/api/save-project', formValues(p, dryRun));
  $('f_check').disabled = $('f_save').disabled = false;

  if (!r.ok) {
    $('f_out').innerHTML = '<div class="errs"><b>Not plotted.</b><ul>' +
      (r.errors || []).map(e => `<li>${esc(e)}</li>`).join('') + '</ul></div>';
    return;
  }

  // Depth comes from the freshly returned book, so the banner and the row you see a
  // moment later cannot tell you different things.
  const deep = !dryRun && r.boot
    ? (r.boot.projects.find(x => x.title === r.title) || {}).overlap || 0 : 0;
  let h = `<div class="result ${deep > 2 ? 'alarm' : dryRun ? 'dry' : 'saved'}">` +
    `<h4>${dryRun ? 'Availability check \u2014 nothing was written' : 'Saved'}</h4>` +
    `<div class="kv"><b>Recordist</b><span>${esc(r.dubber || r.recordist)}</span></div>` +
    `<div class="kv"><b>Editor</b><span>${esc(r.editor || r.recordist)}</span></div>` +
    `<div class="kv"><b>Mixer</b><span>${esc(r.mixer)}</span></div>`;
  if (r.rows && r.rows.length) {
    h += '<table class="projects" style="margin-top:10px"><thead><tr><th>Phase</th>' +
      '<th>Engineer</th><th>From</th><th>To</th></tr></thead><tbody>' +
      r.rows.map(x => `<tr><td><span class="sw" style="background:${PHASE_BG[x.phase] || 'transparent'}"></span>` +
        `${esc(x.phase)}</td><td>${esc(x.engineer)}</td><td>${esc(x.start)}</td>` +
        `<td>${esc(x.end)}</td></tr>`).join('') + '</tbody></table>';
  }
  if (deep > 2) h += '<div class="msg">THREE AT ONCE \u2014 someone now holds three bookings in ' +
    'the same week. Reassign one of them.</div>';
  else if (deep) h += '<div class="msg soft">Two at once \u2014 someone doubles up for part of ' +
    'this run. Normal where a shoot is still recording while its edit starts.</div>';
  if (r.warnings) h += `<div class="msg">${esc(r.warnings)}</div>`;
  const note = [r.record_note, r.mix_note].filter(Boolean).join(' \u00b7 ');
  if (note) h += `<div class="muted">${esc(note)}</div>`;
  if (dryRun) h += '<div class="muted">Nothing saved yet. Press Plot &amp; save to commit.</div>';
  h += '</div>';

  if (!dryRun && r.boot) {
    BOOT = r.boot;
    if (r.schedule) SCHED = r.schedule;
    paint();
    // paint() rebuilt the page, so the result has to be re-hung on the new form host
    openForm(r.title);
  }
  $('f_out').innerHTML = h;
}

const VIEWS = { schedule: renderSchedule, projects: renderProjects,
                analysis: renderAnalysis, replan: renderReplan,
                report: renderReport, history: renderHistory };
let ANALYSIS = null, HISTORY = null, OPENED = null, REPORT = null, MONTH = null;

function paint() {
  $('view').innerHTML = (VIEWS[VIEW] || renderSchedule)();
  topRight();
  if (VIEW === 'analysis') {
    if (!ANALYSIS) loadAnalysis();
    else if ($('anRefresh')) $('anRefresh').addEventListener('click',
      () => { ANALYSIS = null; loadAnalysis(); });
    return;
  }
  if (VIEW === 'report') { if (!REPORT) loadReport(); else wireReport(); return; }
  if (VIEW === 'history') { if (!HISTORY) loadHistory(); else wireHistory(); return; }
  if (VIEW === 'replan') { wireReplan(); return; }
  if (VIEW === 'schedule') {
    wireScheduleBar();
    wireColumnHover();
    // Dragging is an Engineers-mode action: you move a week between engineers, and a
    // Projects row has no engineer column to drop into.
    if (SCHED.mode === 'engineer') wireDrag();
  }
  else wireProjects();
}

// Delegated, and it only ever touches the column being left and the one being
// entered — eight class toggles per move rather than several hundred.
function wireColumnHover() {
  const wrap = document.querySelector('.gridwrap');
  if (!wrap) return;
  let current = null;
  const mark = (ci, on) => {
    if (ci === null) return;
    wrap.querySelectorAll(`[data-c="${ci}"]`).forEach(el => el.classList.toggle('colhi', on));
  };
  wrap.addEventListener('mouseover', e => {
    const cell = e.target.closest('[data-c]');
    const ci = cell ? cell.getAttribute('data-c') : null;
    if (ci === current) return;
    mark(current, false);
    current = ci;
    mark(current, true);
  });
  wrap.addEventListener('mouseleave', () => { mark(current, false); current = null; });
}

// ---------------------------------------------------------------- drag a week
// Weeks never move — only who does them — so a booking may only be dropped in its own
// row. Anything else is refused while the drag is in flight rather than explained
// afterwards.
let DRAG = null;

function wireDrag() {
  const wrap = document.querySelector('.gridwrap');
  if (!wrap) return;
  const clear = () => wrap.querySelectorAll('.dropok,.dropno,.dragging')
    .forEach(el => el.classList.remove('dropok', 'dropno', 'dragging'));

  wrap.querySelectorAll('.bk').forEach(el => {
    el.addEventListener('dragstart', ev => {
      DRAG = { p: el.dataset.p, ph: el.dataset.ph, from: el.dataset.from,
               wk: el.dataset.wk, row: el.closest('tr') };
      el.classList.add('dragging');
      try { ev.dataTransfer.setData('text/plain', DRAG.p); } catch (e) {}
      ev.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => { DRAG = null; clear(); });
  });

  wrap.querySelectorAll('.bk[data-hand]').forEach(el => {
    el.addEventListener('click', async ev => {
      ev.stopPropagation();
      if (!confirm(`Give this week back to the tool?\n\n${el.dataset.p} · ${el.dataset.ph}` +
                   `\nweek of ${el.dataset.wk}\n\nYour other manual changes stay.`)) return;
      const r = await post('/api/undo', { project: el.dataset.p, phase: el.dataset.ph,
                                          week_start: el.dataset.wk });
      if (!r.ok) return alert(r.error || 'Could not undo that.');
      absorb(r);
    });
  });

  wrap.querySelectorAll('td[data-eng]').forEach(td => {
    td.addEventListener('dragover', ev => {
      if (!DRAG) return;
      const sameWeek = td.closest('tr') === DRAG.row;
      const sameEng = td.dataset.eng === DRAG.from;
      if (sameWeek && !sameEng) {
        ev.preventDefault();                 // preventDefault IS "yes, drop here"
        ev.dataTransfer.dropEffect = 'move';
        td.classList.add('dropok');
      } else if (!sameWeek) td.classList.add('dropno');
    });
    td.addEventListener('dragleave', () => td.classList.remove('dropok', 'dropno'));
    td.addEventListener('drop', async ev => {
      ev.preventDefault();
      if (!DRAG || td.closest('tr') !== DRAG.row) { clear(); return; }
      const move = { project: DRAG.p, phase: DRAG.ph, week_start: DRAG.wk,
                     to_engineer: td.dataset.eng };
      DRAG = null; clear();
      await confirmMove(move);
    });
  });
}

// Two calls on purpose: the first asks what the move would cost and writes nothing,
// the second commits. Warning from data the client already holds would put the
// eligibility rules in two places and let them drift.
async function confirmMove(move) {
  const pre = await post('/api/reassign', move);
  if (!pre.ok) return alert(pre.error || 'Could not move that.');
  const lines = [`${move.project} · ${move.phase}`,
                 `week of ${move.week_start}`,
                 `${pre.from}  →  ${move.to_engineer}`];
  // What it costs, measured against the same ranked objective the planner uses. The
  // move is still yours to make — a hand pick beats every rule — but you get to make
  // it knowing rather than guessing.
  if (pre.effect) {
    lines.push('', (pre.effect.better ? '✓ ' : '✗ ') +
      `${pre.effect.label}: ${pre.effect.from} → ${pre.effect.to}`);
  } else {
    lines.push('', 'No measurable change to the book.');
  }
  if (pre.warnings.length) lines.push('', ...pre.warnings.map(w => '• ' + w.text));
  lines.push('', 'Weeks never move — only who does them.');
  if (!confirm(lines.join('\n'))) return;
  const done = await post('/api/reassign', { ...move, confirmed: true });
  if (!done.ok) return alert(done.error || 'Could not move that.');
  absorb(done);
}

// A write hands back fresh state in the same response, so there is nothing to re-ask
// for. Re-asking is what made the old app feel slow, and a second read is also how it
// managed to keep showing the previous plan.
function absorb(r) {
  if (r.boot) BOOT = r.boot;
  if (r.schedule) SCHED = r.schedule;
  paint();
}

async function post(path, body) {
  const t0 = performance.now();
  // The view is sent with the write so the fresh schedule comes back in the
  // orientation and range the user is looking at, not a default one.
  const r = await fetch(path, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, mode: MODE, from: RANGE.from, to: RANGE.to }) });
  const out = await r.json();
  LAST_MS = performance.now() - t0;
  return out;
}

document.querySelectorAll('.nav button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.nav button').forEach(x => x.classList.toggle('on', x === b));
    VIEW = b.dataset.view;
    paint();               // no fetch — both views come from what we already hold
  });
});

(async () => {
  BOOT = await get('/api/bootstrap');
  SCHED = await get(scheduleUrl());
  paint();
})();
