// Everything is fetched once and rendered from memory. The measured round trip is
// shown in the header on purpose: the reason this app exists is speed, so the number
// that justifies it should be visible rather than claimed.
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

// Set by view.html. It turns the editing off in the UI; the REFUSAL lives on the
// server (PLANNER_READONLY=1), because a flag in the browser stops the page offering
// an edit but stops nobody from calling the endpoint directly.
const READONLY = !!window.READONLY;

const requestUrl = path =>
  new URL(String(path).replace(/^\/+/, ''), document.baseURI).toString();

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
  const r = await fetch(requestUrl(path));
  const body = await r.json();
  LAST_MS = performance.now() - t0;
  return body;
}

function topRight() {
  const c = BOOT.counts;
  const wk = n => n + (n === 1 ? ' week' : ' weeks');
  const bits = [`<span class="pill">${c.projects} projects` +
    (c.done ? ` · ${c.done} done` : '') + ` · ${c.live_rows} bookings</span>`];
  // From THIS WEEK on. A week that has gone cannot be reassigned, and counting it kept
  // the warning above zero for good; the earlier ones are said quietly instead.
  const earlier = (c.over2_past || 0) + (c.over3_past || 0);
  if (c.over2) bits.push(`<span class="pill warn">${wk(c.over2)} with 2 overlaps</span>`);
  if (c.over3) bits.push(`<span class="pill bad">${wk(c.over3)} with 3+ overlaps</span>`);
  if (earlier) bits.push(`<span class="pill" title="Weeks that have already passed — nothing can be ` +
    `reassigned in them. They stay visible in the schedule.">${earlier} earlier</span>`);
  if (LAST_MS != null) bits.push(`<span class="pill timing">${LAST_MS.toFixed(0)} ms</span>`);
  // Anything typed straight into the spreadsheet -- a pasted batch of projects above
  // all -- is invisible until the book is re-read. The store re-reads after every
  // write and on its TTL, but the client holds BOOT and SCHED in memory, so without
  // this the only way to see a sheet-side edit was to reload the browser.
  bits.push('<button class="btn small" id="reload" title="Re-read the spreadsheet">' +
    'Refresh</button>');
if (
  BOOT.session &&
  BOOT.session.logout_path
) {
  bits.push(
    '<button class="btn small" id="logout" title="Sign out of Production Planner">' +
    'Logout</button>'
  );
}
  $('topright').innerHTML = bits.join('');
  const logout = $('logout');

if (logout) {
  logout.addEventListener('click', () => {
    logout.disabled = true;
    logout.textContent = 'Signing out\u2026';
    window.location.assign(BOOT.session.logout_path);
  });
}
  const rl = $('reload');
  if (rl) rl.addEventListener('click', async () => {
    rl.disabled = true;
    rl.textContent = 'Reading\u2026';
    // fresh=1 skips the TTL, so this is a real re-read and not a cache hit.
    BOOT = await get('/api/bootstrap?fresh=1');
    SCHED = await get(scheduleUrl());
    ANALYSIS = null; REPORT = null; HISTORY = null; OPENED = null;
    paint();
  });
}

function numLabel(w) {
  const d = new Date(w.start + 'T00:00:00Z');
  const e = new Date(d); e.setUTCDate(e.getUTCDate() + 6);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth()+1)}/${p(d.getUTCDate())} - ${p(e.getUTCMonth()+1)}/${p(e.getUTCDate())}`;
}

const PHASE_BG = { Dub:'var(--dub)', Edit:'var(--edit)', Mix:'var(--mix)' };
const PHASE_PALE = { Dub:'var(--dub-pale)', Edit:'var(--edit-pale)', Mix:'var(--mix-pale)' };

// A cell holding two bookings is one square on screen but two different things. It
// used to be filled solid blue with both names crammed into it and truncated, so the
// colour told you THAT something was doubled and hid WHAT — which is the part you need
// in order to fix it. Now each booking is its own band in its own phase colour, and
// the outline carries the depth. It also makes the drag honest: you grab the band you
// meant rather than a blob that happened to pick one.
//
// `label` differs by orientation: the Engineers grid shows project names, the Projects
// grid shows engineer names.
function cellBands(c, label, dragAttrs, rich, deep) {
  // Engineers grid: a project's bookings sit together (Dub, Edit, Mix), so a dub and its edit
  // are always adjacent and can be drawn as the one job they are. Labels are matched by index
  // in the Projects grid, so its order is left alone.
  if (rich) {
    const ord = { Dub: 0, Edit: 1, Mix: 2 }, first = {};
    c.items.forEach((x, i) => { if (first[x.p] === undefined) first[x.p] = i; });
    c = { ...c, items: c.items.slice().sort((a, b) =>
      first[a.p] - first[b.p] || (ord[a.ph] || 0) - (ord[b.ph] || 0)) };
  }
  return '<div class="stack">' + c.items.map((it, i) => {
    const text = label(it, i);
    // Engineers grid: the cell is tall enough to say more than the name. The phase and where
    // the week falls in it ("Dub \u00b7 wk 2/3") are what you otherwise have to hover to learn.
    const meta = rich && it.of ? (it.of > 1 ? `wk ${it.at}/${it.of}` : '1 wk') : '';
    // The phase word is not printed (Tara, 2026-10-28): the rail colour says it. Hover still does.
    const metaFull = meta ? `${it.ph} \u00b7 ${meta}` : '';
    // One row per booking, the phase as a rail down its left edge (Tara, 2026-10-27). An
    // overlapped week says so in words on its first row, so the depth never rests on the
    // frame colour alone.
    // The count is of JOBS: a project's dub and its edit with one person are one job (Tara,
    // 2026-10-15). Three bookings can therefore read "2 at once", so the tag names the jobs on
    // hover, e.g. "The Take: Dub + Edit \u00b7 Single's Inferno: Edit".
    const jobs = () => {
      const by = {};
      c.items.forEach(x => { const k = x.p + (x.ph === 'Mix' ? '|M' : '|R');
        (by[k] = by[k] || { p: x.p, ph: [] }).ph.push(x.ph); });
      return Object.values(by).map(j => `${j.p}: ${j.ph.join(' + ')}`).join(' \u00b7 ');
    };
    const tag = rich && i === 0 && deep > 1
      ? `<span class="otag${deep > 2 ? ' t3' : ''}" title="${esc(`${deep} jobs this week \u2014 ${jobs()}`)}">${deep} at once</span>` : '';
    // Same job as the booking above it (same project, dub or edit): drawn as one, no divider.
    const prev = c.items[i - 1];
    const sameJob = rich && prev && prev.p === it.p && prev.ph !== 'Mix' && it.ph !== 'Mix';
    const body = rich
      ? `<span class="bk-n">${esc(text)}</span>` +
        (meta || tag ? `<span class="bk-m">${esc(meta)}${tag}</span>` : '')
      : `<span class="bk-l">${esc(text)}</span>`;
    const paint = rich ? `--ph:${PHASE_BG[it.ph] || 'var(--line)'};--ph-pale:${PHASE_PALE[it.ph] || 'var(--line)'}`
      : `background:${PHASE_BG[it.ph] || 'transparent'}`;
    return `<span class="bk${rich ? ' rich ' + String(it.ph || '').toLowerCase() : ''}${sameJob ? ' samejob' : ''}" style="${paint}"` +
      (dragAttrs ? dragAttrs(it) : '') +
      (it.hand ? ' data-hand="1" title="Moved by hand — click to give it back"'
        : (rich && meta ? ` title="${esc(text + ' \u00b7 ' + metaFull)}"` : '')) +
      `>${body}</span>`;
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
    scheduleKey() +
    '<div class="spacer"></div>' +
    `<label class="inline">From</label>${sel('qFrom', RANGE.from)}` +
    `<label class="inline">To</label>${sel('qTo', RANGE.to)}` +
    '<button class="btn small" id="qAll">All</button>' +
    `<span class="hint" style="margin:0 0 0 12px">${d.weeks.length} weeks</span></div>`;
}

// The key, in the toolbar where it is seen, and in one word each. It used to be a row of
// swatches and phrases below the whole grid, off screen on most windows.
function scheduleKey() {
  const sw = (css, t, tip) => `<span class="k"${tip ? ` title="${esc(tip)}"` : ''}><i class="sw" style="${css}"></i>${t}</span>`;
  return '<div class="legend key">' +
    sw('background:var(--dub)', 'Dub') + sw('background:var(--edit);border-color:var(--edit-edge)', 'Edit') +
    sw('background:var(--mix)', 'Mix') +

    sw('border:2px dotted var(--fg1);background:transparent', 'By hand',
       READONLY ? 'Moved by hand' : 'Moved by hand \u2014 click the cell to give it back') +
    (MODE === 'project' ? '<span class="k"><span class="duemark">Due</span> Deadline week</span>' : '') + '</div>';
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
    const cls = [starts ? 'qstart' : '', w.start === BOOT.today_week ? 'nowrow' : '',
      w.start < BOOT.today_week ? 'past' : ''].filter(Boolean).join(' ');
    h += `<tr${cls ? ` class="${cls}"` : ''}><th>${numLabel(w)}` +
      (w.start === BOOT.today_week ? '<span class="nowlbl">This week</span>' : '') + '</th>';
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
          (READONLY ? '' : ' draggable="true"') +
          ` data-p="${esc(it.p)}" data-ph="${esc(it.ph)}"` +
          ` data-from="${esc(n)}" data-wk="${w.start}"`, true, deep);
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
    d.weeks.map((w, ci) => `<th data-c="${ci}"${w.start === BOOT.today_week ? ' class="nowcol"' : ''}>` +
      `${esc(w.day_range)}</th>`).join('') + '</tr>';
  h += '</thead><tbody>';

  // Rows whose work is all behind this week go in a fold at the bottom. They used to fill the
  // top of the grid as empty rows (the view opens on this week), pushing live work off screen.
  const nowCi = d.weeks.findIndex(w => w.start >= BOOT.today_week);
  const bars = d.bars || [];
  const finished = ri => nowCi !== -1 && bars.every(b => b.row !== ri || b.c1 < nowCi) &&
    !Object.keys(mark).some(k => k.startsWith(ri + '|') && Number(k.split('|')[1]) >= nowCi);
  const live = [], done = [];
  d.labels.forEach((n, ri) => (finished(ri) ? done : live).push(ri));
  const span = d.weeks.length + 1;

  // LANES (Tara, 2026-10-28). Each booking is one bar in its own lane for its whole run, so
  // two or three bookings in a week sit one above the other at full height instead of
  // splitting the week into slivers. A row is as tall as the most lanes it ever needs.
  const PH_ORDER = { Dub: 0, Edit: 1, Mix: 2 };
  const laneRows = {};
  bars.slice().sort((a, b) => a.c0 - b.c0 || (PH_ORDER[a.phase] || 0) - (PH_ORDER[b.phase] || 0))
    .forEach(b => {
      const r = laneRows[b.row] = laneRows[b.row] || [];
      let l = r.findIndex(end => end < b.c0);
      if (l === -1) { l = r.length; r.push(0); }
      r[l] = b.c1; b.lane = l;
    });

  const row = ri => {
    const name = d.labels[ri];
    const lanes = Math.max(1, (laneRows[ri] || []).length);
    const dueCols = Object.keys(mark).filter(k => k.startsWith(ri + '|')).map(k => Number(k.split('|')[1]));
    let r = `<tr class="lanes" style="--lanes:${lanes}"><th title="${esc(name)}">${esc(name)}</th>`;
    for (let ci = 0; ci < d.weeks.length; ci++) {
      const w = d.weeks[ci], cls = [];
      if (w.start < BOOT.today_week) cls.push('past');
      if (w.start === BOOT.today_week) cls.push('now');
      const due = mark[ri + '|' + ci];
      let inner = '';
      if (ci === 0) {
        // Every bar of the row is drawn inside the first cell and positioned in column units,
        // so a bar spans its weeks without colspan surgery and the week lines stay intact.
        bars.filter(b => b.row === ri).forEach(b => {
          const past = d.weeks[b.c1].start < BOOT.today_week;
          const firstDeep = b.deep3.includes(b.c0);
          const when = b.c1 > b.c0 ? `${d.weeks[b.c0].label} \u2013 ${d.weeks[b.c1].label}` : d.weeks[b.c0].label;
          // A deadline inside this bar: "Due" goes in the bar, after the name, instead of on top of it.
          const dueIn = dueCols.some(c => c >= b.c0 && c <= b.c1);
          inner += `<span class="lbar ${(b.phase || '').toLowerCase()}${past ? ' gone' : ''}${b.hand ? ' hand' : ''}${dueIn ? ' hasdue' : ''}"` +
            ` style="--c0:${b.c0};--n:${b.c1 - b.c0 + 1};--ln:${b.lane}"` +
            ` title="${esc(`${b.engineer} \u00b7 ${b.phase} \u00b7 ${when}` +
              (b.deep > 2 ? ' \u00b7 3 at once' : b.deep > 1 ? ' \u00b7 2 at once' : '') +
              (b.hand ? ' \u00b7 moved by hand' : '') + (dueIn ? ' \u00b7 runs into the deadline week' : ''))}">` +
            `<span class="bk-l">${esc(b.engineer)}</span>${firstDeep ? '<span class="otag t3">3 at once</span>' : ''}` +
            (dueIn ? '<span class="duemark inbar">Due</span>' : '') + '</span>';
          // The tag is the only 3-at-once marker here, so it appears in every later 3-deep week too.
          b.deep3.filter(c => c > b.c0).forEach(c => {
            inner += `<span class="lflag" style="--c0:${c};--ln:${b.lane}"><span class="otag t3">3 at once</span></span>`;
          });
        });
      }
      if (due) cls.push('duewk');
      // The free-standing tag only where no bar runs through the deadline week.
      const covered = due && bars.some(b => b.row === ri && ci >= b.c0 && ci <= b.c1);
      r += `<td data-c="${ci}" class="${cls.join(' ')}"` +
           (due ? ` title="${esc('Due ' + w.label)}"` : '') + '>' +
           (ci === 0 ? `<div class="lanebox">${inner}</div>` : '') +
           (due && !covered ? '<span class="duemark">Due</span>' : '') + '</td>';
    }
    return r + '</tr>';
  };

  live.forEach(ri => { h += row(ri); });
  if (done.length) {
    h += `<tr class="donehead"><td colspan="${span}"><button type="button" id="doneFold" aria-expanded="${SHOW_FINISHED}">` +
      `${SHOW_FINISHED ? 'Hide' : 'Show'} ${done.length} finished project${done.length === 1 ? '' : 's'}` +
      '</button></td></tr>';
    if (SHOW_FINISHED) done.forEach(ri => { h += row(ri); });
  }
  return h + '</tbody></table></div>';
}
let SHOW_FINISHED = false;

function renderSchedule() {
  const d = SCHED;
  if (d.empty) return '<div class="loading">No bookings yet.</div>';
  if (d.clipped) return scheduleBar() +
    '<div class="loading">No weeks in that range. Widen it or press All.</div>';
  let h = scheduleBar();
  h += d.mode === 'project' ? renderProjectGrid() : renderEngineerGrid();
  return h;
}

let SORT = 'deadline', SHOW_DONE = false, SEARCH = '';

// "3 Nov", or "3 Nov 2027" when the year is not this one, from an ISO date.
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function shortDate(iso, withYear) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return String(iso);
  const thisYear = BOOT && BOOT.today_week ? Number(BOOT.today_week.slice(0, 4)) : null;
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] +
    (withYear || (thisYear && d.getUTCFullYear() !== thisYear) ? ' ' + d.getUTCFullYear() : '');
}

// The project's dates, in place of the old 2/1/1: its first day to its last, the weeks that
// is, and each phase's own dates on hover. Since phases have dates, week counts said less
// than the dates they came from.
function runsCell(p) {
  const ds = ['dub', 'edit', 'mix'].map(k => [k, p.dates && p.dates[k]]).filter(([, d]) => d && d.from && d.to);
  if (!ds.length) return '<span class="muted-inline">\u2014</span>';
  const from = ds.map(([, d]) => d.from).sort()[0], to = ds.map(([, d]) => d.to).sort().pop();
  const weeks = Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000 + 1) / 7;
  const tip = ds.map(([k, d]) => k[0].toUpperCase() + k.slice(1) + ' ' + shortDate(d.from) + ' \u2013 ' + shortDate(d.to)).join(' \u00b7 ');
  return `<span class="runs" title="${esc(tip)}">` +
    `${esc(shortDate(from))} \u2013 ${esc(shortDate(to))}</span>` +
    `<span class="muted-inline"> \u00b7 ${Math.round(weeks)} wk${Math.round(weeks) === 1 ? '' : 's'}</span>`;
}

function renderProjects() {
  const byTitle = (a, b) =>
    String(a.title).localeCompare(String(b.title), undefined, { numeric: true });
  // By deadline, what still has a deadline ahead comes FIRST. Oldest-first put fourteen
  // finished-looking projects above the ones that need attention. Past deadlines follow,
  // most recent first, under their own heading.
  const passed = p => !!p.deadline && p.deadline < BOOT.today_week;
  const all = BOOT.projects.slice().sort(SORT === 'title' ? byTitle : (a, b) =>
    (passed(a) - passed(b)) ||
    (passed(a) ? String(b.deadline).localeCompare(String(a.deadline))
               : String(a.deadline || '9999').localeCompare(String(b.deadline || '9999'))) ||
    byTitle(a, b));
  // Finished work is hidden, not deleted. The point of marking a project complete is
  // that it stops asking for your attention; the record stays one click away.
  const done = all.filter(p => p.status === 'Complete' || p.status === 'Cancelled');
  // Cancelled work leaves the list for the same reason completed work does: it is not
  // asking for anything. Both come back with the toggle.
  const ps = SHOW_DONE ? all : all.filter(p => !p.status);

  // Ghosts have to be surfaced here without being asked: they are missing from the
  // Projects list by definition, so nothing below would ever mention them. The two
  // causes have opposite fixes, so this explains both rather than offering one button
  // and hoping.
  let h = '';
  const ghosts = BOOT.orphans || [];
  if (ghosts.length) {
    h += '<div class="msg"><b>' + ghosts.length + ' ghost project' +
      (ghosts.length === 1 ? '' : 's') + ' on the schedule.</b> ' +
      'These have bookings but no row on the Projects tab, so they take up engineer ' +
      'weeks and cannot be edited.<br>' +
      'If the title was <b>renamed</b> in the spreadsheet, relink it there instead: ' +
      '<b>Engineer Assignment \u2192 Relink a renamed project</b>. Clearing is for a ' +
      'project that is really gone \u2014 it frees the weeks and can be undone from ' +
      'History.' +
      '<table class="projects" style="margin-top:10px"><tbody>' +
      ghosts.map(g => `<tr><td><b>${esc(g.project)}</b></td>` +
        `<td>${g.rows} booking${g.rows === 1 ? '' : 's'}</td>` +
        `<td class="lockcell"><button class="btn small" data-ghost="${esc(g.project)}">` +
        'Clear</button></td></tr>').join('') +
      '</tbody></table></div>';
  }

  h += '<div class="bar-row"><button class="btn primary" id="addBtn">+ Add project</button>' +
    (done.length
      ? `<button class="btn small${SHOW_DONE ? ' primary' : ''}" id="toggleDone">` +
        `${SHOW_DONE ? 'Hide' : 'Show'} ${done.length} closed</button>`
      : '') +
    '<div class="spacer"></div>' +
    `<input type="search" id="pSearch" class="search" placeholder="Search projects, clients, engineers" ` +
      `aria-label="Search projects" value="${esc(SEARCH)}" autocomplete="off">` +
    `<button class="btn small${SORT === 'deadline' ? ' primary' : ''}" data-sort="deadline">Deadline</button>` +
    `<button class="btn small${SORT === 'title' ? ' primary' : ''}" data-sort="title">A\u2013Z</button>` +
    '</div><div id="formHost"></div>';

  h += '<table class="projects"><thead><tr><th>Deadline</th><th>Project</th><th>Client</th>' +
    '<th>Dates</th><th>Recordist</th><th>Mixer</th><th>Flags</th><th></th><th></th></tr></thead><tbody>';
  let divided = false;
  ps.forEach(p => {
    if (SORT === 'deadline' && !divided && passed(p)) {
      divided = true;
      h += `<tr class="grp" data-grp="1"><td colspan="9">Deadline passed \u00b7 ` +
        `${ps.filter(passed).length}</td></tr>`;
    }
    let flags = '';
    if (p.overlap > 2) flags += '<span class="chip red">3 overlaps</span>';
    else if (p.overlap) flags += '<span class="chip warn">2 overlaps</span>';
    // Visible in the list, not only inside the form. A locked project is one re-plan
    // will refuse to move, and having to open each project in turn to find that out is
    // how the Locked column came to be ignored.
    if (p.status === 'Cancelled') flags += '<span class="chip red">cancelled</span>';

    if (p.music) flags += '<span class="chip">music</span>';
    if (p.special) flags += '<span class="chip">special</span>';
    if (p.atmos) flags += '<span class="chip">atmos</span>';
    const who = ph => [...new Set(p.rows.filter(r => r.phase === ph).map(r => r.engineer))]
      .join(' + ') || '\u2014';
    if (p.status === 'Complete') {
      flags += `<span class="chip">completed ${esc(p.completed || '')}</span>`;
    }
    const cls = [p.status ? 'dim' : '', p.locked ? 'locked' : ''].filter(Boolean).join(' ');
    const q = [p.title, p.series, p.client, who('Dub'), who('Edit'), who('Mix'), p.deadline,
      p.status, p.music ? 'music' : '', p.special ? 'special' : '', p.atmos ? 'atmos' : '',
      p.locked ? 'locked' : ''].join(' ').toLowerCase();
    const hide = SEARCH.trim() && !matchesAll(q, SEARCH);
    h += `<tr data-title="${esc(p.title)}" data-q="${esc(q)}"${hide ? ' hidden' : ''}` +
      `${cls ? ` class="${cls}"` : ''}>` +
      `<td>${esc(p.deadline)}</td>` +
      `<td><b>${esc(p.title)}</b>${p.series ? `<div class="muted-inline">${esc(p.series)}</div>` : ''}</td><td>${esc(p.client)}</td>` +
      `<td>${runsCell(p)}</td><td>${esc(who('Dub'))}</td><td>${esc(who('Mix'))}</td>` +
      `<td>${flags}</td>` +
      // A frozen project has to be obvious while scanning a long list, which a chip
      // among six other chips is not. Same shape as the Apps Script app's column.
      `<td class="lockcell"><button class="lockbtn${p.locked ? ' on' : ''}" ` +
        `data-lock="${esc(p.title)}" data-now="${p.locked ? '1' : '0'}" title="${p.locked
          ? 'Frozen — a re-plan will not move this project. Click to unfreeze.'
          : 'Click to freeze: a re-plan will leave this project alone.'}">` +
        `${p.locked ? 'LOCKED' : 'Lock'}</button></td>` +
      // A row that opens says so by looking like it does: it lights on hover and ends in an
      // arrow, rather than a line of grey text off to the right telling you to click it.
      '<td class="go" aria-hidden="true"><svg width="9" height="14" viewBox="0 0 9 14"><path d="M1.5 1.5l5.5 5.5-5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></td></tr>';
  });
  return h + '</tbody></table><div class="hint" id="pNone" hidden>No project matches that.</div>';
}

// Every word typed has to appear somewhere in the row, in any order: "kyle nov" finds
// Kyle's November work. Anything fuzzier would hide the project you meant.
function matchesAll(text, query) {
  return String(query).toLowerCase().split(/\s+/).filter(Boolean).every(w => text.indexOf(w) !== -1);
}

// Filters the rows already on the page. It does not repaint: a repaint rebuilds the
// input and drops the cursor after every keystroke.
function applySearch() {
  const rows = [...document.querySelectorAll('table.projects tbody tr[data-title]')];
  let shown = 0;
  rows.forEach(tr => {
    const hide = !!SEARCH.trim() && !matchesAll(tr.dataset.q || '', SEARCH);
    tr.hidden = hide; if (!hide) shown++;
  });
  // A heading with nothing under it is noise.
  document.querySelectorAll('table.projects tr.grp').forEach(g => {
    let n = g.nextElementSibling, any = false;
    while (n && !n.classList.contains('grp')) { if (n.hidden === false) any = true; n = n.nextElementSibling; }
    g.hidden = !any;
  });
  const none = $('pNone'); if (none) none.hidden = shown > 0 || !SEARCH.trim();
}

function wireProjects() {
  const sb = $('pSearch');
  if (sb) { sb.addEventListener('input', () => { SEARCH = sb.value; applySearch(); }); applySearch(); }
  const add = $('addBtn');
  if (add) add.addEventListener('click', () => openForm(null));
  const td = $('toggleDone');
  if (td) td.addEventListener('click', () => { SHOW_DONE = !SHOW_DONE; paint(); });
  document.querySelectorAll('[data-sort]').forEach(b =>
    b.addEventListener('click', () => { SORT = b.dataset.sort; paint(); }));
  document.querySelectorAll('table.projects tbody tr').forEach(tr =>
    tr.addEventListener('click', () => openForm(tr.dataset.title)));

  // Wired AFTER the row handler and stopping propagation, or locking a project would
  // also open its form.
  document.querySelectorAll('[data-ghost]').forEach(btn =>
    btn.addEventListener('click', async () => {
      const title = btn.dataset.ghost;
      if (!confirm(`Clear ${title}?\n\nIts bookings come off the schedule and those ` +
        'weeks go back to the engineers. Do this only if the project is really gone \u2014 ' +
        'if it was renamed, relink it in the spreadsheet instead.')) return;
      btn.disabled = true;
      const r = await post('/api/clear-ghosts', { projects: [title] });
      if (!r.ok) { btn.disabled = false; alert(r.error); return; }
      BOOT = r.boot; SCHED = r.schedule || SCHED;
      paint();
    }));

  document.querySelectorAll('.lockbtn').forEach(btn =>
    btn.addEventListener('click', async ev => {
      ev.stopPropagation();
      const title = btn.dataset.lock;
      const to = btn.dataset.now !== '1';
      btn.disabled = true;
      const r = await post('/api/set-lock', { title, locked: to });
      if (!r.ok) { btn.disabled = false; alert(r.error); return; }
      BOOT = r.boot; SCHED = r.schedule || SCHED;
      paint();
    }));
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

// Work done in every month (Tara, 2026-10-28), under the selected month's report.
function monthlyTable(r) {
  let h = '';
  if (r.worked && r.worked.length) {
    h += '<h2 style="margin-top:26px">Work done by month</h2>' +
      '<p class="muted">Booked weeks in the month they actually happened, finished or not. Weeks still to come are not counted.</p>' +
      '<table class="projects"><thead><tr><th>Month</th><th class="n">Weeks worked</th>' +
      '<th class="n">Projects</th><th>Weeks by engineer</th></tr></thead><tbody>' +
      r.worked.map(m => `<tr><td><b>${esc(MONTH_NAME(m.month))}</b></td><td class="n">${m.weeks}</td>` +
        `<td class="n">${m.projects}</td><td class="muted-inline">` +
        esc(m.engineers.map(e => `${e.name} ${e.weeks}`).join(' \u00b7 ')) + '</td></tr>').join('') +
      '</tbody></table>';
  }
  if (r.monthly && r.monthly.length) {
    h += '<h2 style="margin-top:26px">Completed by month</h2>' +
      '<p class="muted">Projects counted in the month they were marked complete, with all of their booked weeks.</p>' +
      '<table class="projects"><thead><tr><th>Month</th>' +
      '<th class="n">Projects completed</th><th class="n">Weeks booked</th><th class="n">Late</th><th>Weeks by engineer</th></tr></thead><tbody>' +
      r.monthly.map(m => `<tr><td><b>${esc(MONTH_NAME(m.month))}</b></td><td class="n">${m.projects}</td>` +
        `<td class="n">${m.weeks}</td><td class="n">${m.late || '\u2014'}</td><td class="muted-inline">` +
        esc(m.engineers.map(e => `${e.name} ${e.weeks}`).join(' \u00b7 ')) + '</td></tr>').join('') +
      '</tbody></table>';
  }
  return h;
}

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
    h += '<p class="muted">Nothing completed in ' + esc(MONTH_NAME(r.month)) + '.</p>';
    // This month's report is built from projects marked complete, so the way to fill it is
    // here: this month's open projects, each with the button that does it. (Only for the
    // current month: marking complete stamps today, so it could not add to another month.)
    const open = BOOT.projects.filter(p => !p.status && String(p.deadline || '').slice(0, 7) === r.month &&
      r.month === String(BOOT.today_week).slice(0, 7));
    if (open.length) {
      h += '<table class="projects"><thead><tr><th>Due</th><th>Project</th><th>Client</th><th></th></tr></thead><tbody>' +
        open.map(p => `<tr><td>${esc(p.deadline)}</td><td><b>${esc(p.title)}</b></td><td>${esc(p.client)}</td>` +
          `<td class="lockcell"><button class="btn small" data-done="${esc(p.title)}">Mark complete</button></td></tr>`).join('') +
        '</tbody></table>';
    }
    return h + monthlyTable(r) + '</div>';
  }

  const t = r.totals;
  h += `<p class="lede"><b>${t.projects} project${t.projects === 1 ? '' : 's'}</b> delivered, ` +
    `<b>${t.weeks} booked week${t.weeks === 1 ? '' : 's'}</b> of work` +
    (t.late ? ` \u00b7 ${t.on_or_before} on or before the deadline, <b>${t.late} late</b>`
            : ' \u00b7 all on or before the deadline') + '.</p>';

  h += '<table class="projects"><thead><tr><th>Delivered</th><th>Project</th><th>Client</th>' +
    '<th>Dates</th><th>Recordist</th><th>Editor</th><th>Mixer</th>' +
    '<th class="n">Weeks booked</th><th>Against deadline</th></tr></thead><tbody>' +
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
        `<td>${esc(p.client)}</td><td>${runsCell({ dates: p.dates })}</td>` +
        `<td>${esc(p.dub.join(' + ') || '\u2014')}</td>` +
        `<td>${esc(p.edit.join(' + ') || '\u2014')}</td>` +
        `<td>${esc(p.mix.join(' + ') || '\u2014')}</td>` +
        `<td class="n">${p.weeks}</td><td>${vs}</td></tr>`;
    }).join('') + '</tbody></table>';

  h += '<div class="grid2" style="margin-top:22px">' +
    '<div><h2>By client</h2><table class="projects"><thead><tr><th>Client</th>' +
    '<th class="n">Projects</th><th class="n">Weeks booked</th></tr></thead><tbody>' +
    r.by_client.map(c => `<tr><td>${esc(c.name)}</td><td class="n">${c.projects}</td>` +
      `<td class="n">${c.weeks}</td></tr>`).join('') + '</tbody></table></div>' +
    '<div><h2>By engineer</h2><table class="projects"><thead><tr><th>Engineer</th>' +
    '<th class="n">Projects</th><th class="n">Weeks booked</th><th>Doing what</th>' +
    '</tr></thead><tbody>' +
    r.by_engineer.map(e => `<tr><td>${esc(e.name)}</td><td class="n">${e.projects}</td>` +
      `<td class="n">${e.weeks}</td><td class="muted-inline">` +
      esc(Object.keys(e.phases).sort().map(k => `${k} ${e.phases[k]}`).join(' \u00b7 ')) +
      '</td></tr>').join('') + '</tbody></table></div></div>';

  h += monthlyTable(r) + '</div>';
  return h;
}

function wireReport() {
  document.querySelectorAll('[data-done]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm(`Mark ${btn.dataset.done} complete?\n\nIt drops out of the list and re-plan leaves it alone. Its bookings stay on the schedule.`)) return;
    btn.disabled = true;
    const r = await post('/api/set-status', { title: btn.dataset.done, status: 'Complete' });
    if (!r.ok) { alert(r.error); btn.disabled = false; return; }
    absorb(r); REPORT = null; loadReport(MONTH);
  }));
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

// The log grows with every change, so it can be narrowed by what was done and by any
// words in it (a project name, an engineer). Kept across repaints: opening an entry
// repaints the page, and losing your filter each time would defeat it.
let HF = { q: '', kind: '' };
const KIND = {
  'save-project': 'Saved a project', 'reassign': 'Moved a week', 'undo': 'Undid a move',
  'set-status': 'Completed, cancelled or reopened', 'set-lock': 'Locked or unlocked', 'set-series': 'Series set',
  'replan-apply': 'Re-plan applied', 'rollback': 'Rolled back', 'clear-ghosts': 'Cleared ghosts',
};
const kindLabel = a => KIND[a] || a;
const histText = e => (String(e.summary || e.action) + ' ' + e.at).toLowerCase();
const histShown = e => (!HF.kind || e.action === HF.kind) && (!HF.q.trim() || matchesAll(histText(e), HF.q));

function renderHistory() {
  if (!HISTORY) return '<div class="loading">Reading the log\u2026</div>';
  const evs = HISTORY.events || [];
  if (!evs.length) {
    return '<div class="card"><div class="t">History</div><div class="s">No changes yet.</div></div>';
  }

  const kinds = [...new Set(evs.map(e => e.action))];
  let h = '<div class="card"><div class="t">What has changed</div>' +
    `<div class="s"><span id="hCount">${evs.length} entr${evs.length === 1 ? 'y' : 'ies'}</span> \u00b7 newest first ` +
    '\u00b7 click one to see what it did</div>' +
    '<div class="bar-row">' +
    `<input type="search" id="hQ" class="search" placeholder="Filter by project, engineer or word" ` +
      `aria-label="Filter the history" value="${esc(HF.q)}" autocomplete="off">` +
    '<select id="hK" aria-label="Kind of change"><option value="">All changes</option>' +
    kinds.map(k => `<option value="${esc(k)}"${HF.kind === k ? ' selected' : ''}>${esc(kindLabel(k))}</option>`).join('') +
    '</select><button class="btn small" id="hClear"' + (HF.q || HF.kind ? '' : ' hidden') + '>Clear</button></div>' +
    '<table class="projects"><thead><tr><th>When</th><th>What</th><th></th>' +
    '</tr></thead><tbody>' +
    evs.map(e => `<tr data-ev="${e.index}" data-k="${esc(e.action)}" data-q="${esc(histText(e))}"` +
        `${histShown(e) ? '' : ' hidden'}${OPENED && OPENED.event &&
        OPENED.event.index === e.index ? ' class="on"' : ''}>` +
      `<td class="mono">${esc(e.at)}</td><td>${esc(e.summary || e.action)}</td>` +
      `<td>${e.index === HISTORY.latest
        ? '<span class="chip">most recent</span>' : ''}</td></tr>`).join('') +
    '</tbody></table><div class="hint" id="hNone" hidden>Nothing in the log matches that.</div></div>';

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

    // Every entry shows the button; only the newest can use it. An older one is dimmed with a
    // few words on it, instead of a paragraph explaining the rule under a missing button.
    const latest = OPENED.event.index === HISTORY.latest;
    h += '<div class="formactions"><button class="btn danger" id="hRoll"' + (latest ? '' : ' disabled') +
      '>Roll this back</button>' + (latest ? '' : '<span class="hint">Newer changes exist</span>') + '</div>';
    h += '</div>';
  }
  return h;
}

function applyHistoryFilter() {
  const rows = [...document.querySelectorAll('table.projects tbody tr[data-ev]')];
  let n = 0;
  rows.forEach(tr => {
    const show = (!HF.kind || tr.dataset.k === HF.kind) && (!HF.q.trim() || matchesAll(tr.dataset.q || '', HF.q));
    tr.hidden = !show; if (show) n++;
  });
  const c = $('hCount');
  if (c) c.textContent = (HF.q.trim() || HF.kind) ? `${n} of ${rows.length}` : `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`;
  const none = $('hNone'); if (none) none.hidden = n > 0;
  const clr = $('hClear'); if (clr) clr.hidden = !(HF.q || HF.kind);
}

function wireHistory() {
  const hq = $('hQ'), hk = $('hK'), hc = $('hClear');
  if (hq) hq.addEventListener('input', () => { HF.q = hq.value; applyHistoryFilter(); });
  if (hk) hk.addEventListener('change', () => { HF.kind = hk.value; applyHistoryFilter(); });
  if (hc) hc.addEventListener('click', () => { HF = { q: '', kind: '' }; if (hq) hq.value = ''; if (hk) hk.value = ''; applyHistoryFilter(); });
  applyHistoryFilter();
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

// The page answers its own title first. Order follows the decision each part serves: can we
// take work (the verdict, then a way to try a real job), who is free when (the grid), who is
// carrying the most, and last the overlaps, which are the only part with something to fix.
// The older cards (demand per week, clients, weeks per quarter) are kept, folded below.
function renderAnalysis() {
  if (!ANALYSIS) return '<div class="loading">Counting…</div>';
  const a = ANALYSIS, g = a.grid, m = anModel(a);

  let h = '<div class="bar-row"><button class="btn small" id="anRefresh">Refresh</button>' +
    `<span class="hint" style="margin:0 0 0 12px">Week of ${esc(shortDate(g.weeks[0]))} · the next ${g.weeks.length} weeks</span></div>`;

  h += section('Can we take work?') + anVerdict(m, a);

  h += `<div class="head"><span class="bar"></span><h2>Taking a new job</h2><span class="n">Any box can stay empty</span></div>` +
    '<div class="job" id="anJob">' +
    [['dub', 'Dub'], ['edit', 'Edit'], ['mix', 'Mix']].map(([k, n]) =>
      `<div class="jrow"><div class="nm"><i class="sw" style="background:var(--${k})"></i>${n}</div>` +
      `<input type="text" id="aj_${k}_a" placeholder="optional" aria-label="${n} start" autocomplete="off"><span class="ar">→</span>` +
      `<input type="text" id="aj_${k}_b" placeholder="optional" aria-label="${n} end" autocomplete="off">` +
      `<div class="res empty" id="aj_${k}_r">not used</div></div>`).join('') +
    '<div class="dlrow"><span class="lab">Deadline</span>' +
    '<input type="text" id="aj_dl" placeholder="optional" aria-label="Deadline" autocomplete="off"><div class="all" id="aj_all"></div></div></div>';

  h += `<div class="head"><span class="bar"></span><h2>Who is free, week by week</h2></div>` + anHeat(m);

  h += `<div class="head"><span class="bar"></span><h2>Who is carrying the most</h2>` +
    `<span class="n">Weeks with work, of the next ${g.weeks.length}</span></div>` + anCarry(m);

  const o = a.overlaps;
  h += `<div class="head"><span class="bar"></span><h2>Overlaps</h2><span class="n">From this week on</span></div>`;
  if (!o.collisions.length) h += '<div class="calmbox">None — nobody holds two projects in the same week.</div>';
  else h += '<div class="orow hd"><span>Week of</span><span>Engineer</span><span>Colliding work</span><span></span></div>' +
    o.collisions.map(c => `<div class="orow"><span>${esc(shortDate(c.start))}</span><span><b>${esc(c.engineer)}</b></span>` +
      `<span>${esc(c.work.join('  +  '))}</span><span class="tags">` +
      (c.depth > 2 ? `<span class="tag red">${c.depth} at once</span>` : '<span class="tag two">2 at once</span>') + '</span></div>').join('');
  if (o.earlier_weeks) h += `<div class="quiet">${plural(o.earlier_weeks, 'earlier overlap')} not shown — past weeks</div>`;

  // Kept, not removed: the per-week demand charts, the client pipeline, and weeks per quarter.
  h += fold('Demand against supply, week by week', 'projects per week against the people who can do them',
    '<div class="grid2">' +
    demandCard(a, 'recedit', 'Dub or edit — projects per week', a.pools.recedit, a.pools.recedit.length) +
    demandCard(a, 'adv_mix', 'Advanced mix — projects per week', a.pools.adv_mix, a.pools.adv_mix.length,
               a.pools.adv_mix_incl_overflow.length - a.pools.adv_mix.length) + '</div>' + freeCard(a), false);
  h += fold('Where the work comes from', 'by client', clientCard(a), false);
  h += fold('Weeks booked per engineer, per quarter', 'all weeks in the book', heatmapCard(a), false);
  return h;
}

// ---------------------------------------------------------------- analysis: the model
// Everything on the page is worked out from one grid (engineer x week), so the verdict, the
// job check, the table and the bars cannot disagree.
const AN_STATUS = { ok: 'OK', tight: 'Tight', short: 'Short' };
const AN_RANK = { ok: 0, tight: 1, short: 2 };
const AN_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function anModel(a) {
  const g = a.grid, n = g.weeks.length;
  const pool = k => g.engineers.filter(e => k === 'de' ? e.recedit : e.adv_mix).map(e => e.name);
  const by = {}; g.engineers.forEach(e => { by[e.name] = e; });
  const free = (name, w) => by[name].cells[w].depth === 0;
  const stOf = c => c === 0 ? 'short' : c <= 1 ? 'tight' : 'ok';
  const m = { a, g, n, by, pool, free, pools: { de: pool('de'), am: pool('am') } };
  m.freeCount = (k, w) => m.pools[k].filter(e => free(e, w)).length;
  m.stOf = stOf;
  m.cap = k => {
    const ws = [...Array(n).keys()], counts = ws.map(w => m.freeCount(k, w));
    const status = ws.reduce((st, w, i) => AN_RANK[stOf(counts[i])] > AN_RANK[st] ? stOf(counts[i]) : st, 'ok');
    const min = Math.min(...counts);
    return { k, status, min, minW: counts.indexOf(min), tight: ws.filter((w, i) => stOf(counts[i]) === 'tight'),
      none: ws.filter((w, i) => stOf(counts[i]) === 'short'), size: m.pools[k].length };
  };
  return m;
}

// "the week of 2 Nov", "the weeks of 2 and 9 Nov", "6 weeks from the week of 2 Nov"
function anWeeks(m, ix) {
  const day = i => { const d = new Date(m.g.weeks[i] + 'T00:00:00Z'); return { d: d.getUTCDate(), m: d.getUTCMonth() }; };
  if (ix.length > 5) return `${ix.length} weeks from the week of ${shortDate(m.g.weeks[ix[0]])}`;
  const groups = [];
  ix.forEach(i => { const x = day(i), last = groups[groups.length - 1];
    if (last && last.m === x.m) last.d.push(x.d); else groups.push({ m: x.m, d: [x.d] }); });
  const text = groups.map(x => (x.d.length > 1 ? x.d.slice(0, -1).join(', ') + ' and ' + x.d[x.d.length - 1] : x.d[0]) + ' ' + MONTHS[x.m]);
  const body = text.length > 2 ? text.slice(0, -1).join(', ') + ' and ' + text[text.length - 1] : text.join(' and ');
  return (ix.length === 1 ? 'the week of ' : 'the weeks of ') + body;
}

function anVerdict(m, a) {
  const S = { de: m.cap('de'), am: m.cap('am') };
  const last = AN_MONTHS[new Date(m.g.weeks[m.n - 1] + 'T00:00:00Z').getUTCMonth()];
  const sentence = s => {
    if (s.status === 'ok') return s.k === 'de' ? `room for about ${plural(s.min, 'more dub/edit project')} through ${last}`
      : `Advanced mixing has at least ${s.min} free every week`;
    if (s.status === 'tight') return `${s.k === 'de' ? 'dub and edit are' : 'Advanced mixing is'} tight in ${anWeeks(m, s.tight)}`;
    return `nobody is free for ${s.k === 'de' ? 'dub or edit' : 'Advanced mixing'} in ${anWeeks(m, s.none)}`;
  };
  const worst = AN_RANK[S.de.status] >= AN_RANK[S.am.status] ? S.de.status : S.am.status;
  const cap1 = x => x.charAt(0).toUpperCase() + x.slice(1);
  const txt = `${worst === 'short' ? 'Not in every week' : 'Yes'} — ${sentence(S.de)}. ${cap1(sentence(S.am))}.`;
  const future = (a.overlaps.pair_weeks || 0) + (a.overlaps.deep_weeks || 0);
  return `<section class="verdict"><p class="a"><span class="st ${worst}">${AN_STATUS[worst]}</span> ${esc(txt)}` +
    `<small>${future ? plural(future, 'overlap') + ' planned from this week on, listed at the bottom.' : 'Nobody is double-booked from this week on.'}</small></p>` +
    '<div class="caps">' + ['de', 'am'].map(k => { const s = S[k];
      const sub = s.status === 'ok' ? `Always at least ${s.min} free`
        : s.status === 'tight' ? `Only 1 free in ${plural(s.tight.length, 'week')}` : `Nobody free in ${plural(s.none.length, 'week')}`;
      return `<div class="cap"><div class="row1"><span class="lab">${k === 'de' ? 'Dub or edit' : 'Advanced mix'}</span>` +
        `<span class="st ${s.status}">${AN_STATUS[s.status]}</span></div><div class="big">${s.size} can do it</div>` +
        `<div class="sub">${sub}</div><div class="sub">Fewest free: ${s.min} in the week of ${esc(shortDate(m.g.weeks[s.minW]))}</div></div>`; }).join('') +
    '</div></section>';
}

function anHeat(m) {
  const { g, n } = m;
  const dt = i => new Date(g.weeks[i] + 'T00:00:00Z');
  let months = '', i = 0;
  while (i < n) { const mo = dt(i).getUTCMonth(); let j = i; while (j < n && dt(j).getUTCMonth() === mo) j++;
    months += `<th class="mo" colspan="${j - i}">${MONTHS[mo]}</th>`; i = j; }
  let h = '<div class="hmkey"><span><i class="c0"></i>free</span><span class="k"><i style="background:var(--fg3)"></i>one project</span>' +
    '<span class="k"><i style="background:var(--warn)"></i>two at once</span><span class="k"><i style="background:var(--black)"></i>three or more</span>' +
    '<span class="k"><i class="nowkey"></i>this week</span></div>';
  h += `<table class="hm2"><colgroup><col class="l"></colgroup><thead><tr><th></th>${months}</tr><tr><th></th>` +
    g.weeks.map((w, k) => `<th class="${k === 0 ? 'now' : ''}">${dt(k).getUTCDate()}</th>`).join('') + '</tr></thead><tbody>';
  g.engineers.forEach(e => {
    const tags = [e.recedit ? 'D/E' : '', e.adv_mix ? 'Mix' : '', e.reserve ? 'Reserve' : ''].filter(Boolean).join(' · ');
    h += `<tr><th class="who">${esc(e.name)}<em>${tags}</em></th>` + e.cells.map((c, k) => {
      const d = Math.min(3, c.depth);
      return `<td class="c${d}${k === 0 ? ' nowc' : ''}" title="${esc(e.name + ', week of ' + shortDate(g.weeks[k]) + ': ' + (c.work.join(' + ') || 'free'))}">${c.depth > 1 ? c.depth : ''}</td>`; }).join('') + '</tr>';
  });
  [['de', 'dub/edit'], ['am', 'Adv. mix']].forEach(([k, label], ix) => {
    h += `<tr class="sumrow${ix === 0 ? ' first' : ''}"><th class="who">Free for ${label}</th>` +
      g.weeks.map((w, kk) => { const c = m.freeCount(k, kk), st = m.stOf(c);
        return `<td class="f-${st}${kk === 0 ? ' nowc' : ''}" title="${c} free in the week of ${esc(shortDate(w))}: ${AN_STATUS[st]}">${c}</td>`; }).join('') + '</tr>';
  });
  return h + '</tbody></table>';
}

function anCarry(m) {
  const { g, n } = m;
  const rows = g.engineers.map(e => ({ name: e.name, busy: e.cells.filter(c => c.depth > 0).length, dbl: e.cells.filter(c => c.depth > 1).length }))
    .sort((x, y) => y.busy - x.busy || y.dbl - x.dbl || x.name.localeCompare(y.name));
  return rows.map(r => `<div class="carry"><span class="nm">${esc(r.name)}</span><div class="track"><div class="busy" style="width:${r.busy / n * 100}%"></div>` +
    `<div class="dbl" style="width:${r.dbl / n * 100}%"></div></div><span class="v"><b>${r.busy}</b> of ${n} weeks${r.dbl ? ` · ${r.dbl} doubled` : ''}</span></div>`).join('');
}

// "Taking a new job": three phases and a deadline, checked against the grid. A rough answer, not
// a booking -- nothing here can write anything.
function wireAnalysis() {
  const rf = $('anRefresh'); if (rf) rf.addEventListener('click', () => { ANALYSIS = null; loadAnalysis(); });
  const job = $('anJob'); if (!job || !ANALYSIS) return;
  const m = anModel(ANALYSIS), D = window.PlannerDates, today = BOOT.today_week;
  const t0 = Date.parse(m.g.weeks[0] + 'T00:00:00Z');
  const wIdx = t => Math.floor((t - t0) / (7 * 86400000));
  const wl = i => shortDate(m.g.weeks[i]);
  const PH = [['dub', 'Dub', 'de'], ['edit', 'Edit', 'de'], ['mix', 'Mix', 'am']];

  const checkPhase = (pk, a, b) => {
    if (a === null && b === null) return null;
    if (a === null) a = b; if (b === null) b = a;
    if (b < a) return { err: 'ends before it starts' };
    const all = []; for (let w = wIdx(a); w <= wIdx(b); w++) all.push(w);
    const ws = all.filter(w => w >= 0 && w < m.n);
    if (!ws.length) return { none: all[all.length - 1] < 0 ? 'These weeks are in the past.' : `Beyond the weeks shown (to ${wl(m.n - 1)}).` };
    const note = ws.length < all.length ? ' (part of it is outside the weeks shown)' : '';
    const gap = ws.find(w => m.pools[pk].every(e => !m.free(e, w)));
    if (gap !== undefined) return { status: 'short', msg: `Nobody free in the week of ${wl(gap)}.${note}` };
    const full = m.pools[pk].filter(e => ws.every(w => m.free(e, w)));
    const names = full.length > 3 ? full.slice(0, 3).join(', ') + ` +${full.length - 3}` : full.join(', ');
    if (full.length >= 2) return { status: 'ok', msg: `${names} free throughout.${note}` };
    if (full.length === 1) return { status: 'tight', msg: `Only ${full[0]} is free throughout.${note}` };
    const seg = []; let i = 0;            // nobody is free for all of it: hand over, longest runs first
    while (i < ws.length) {
      let best = null;
      m.pools[pk].forEach(e => { let j = i; while (j < ws.length && m.free(e, ws[j])) j++; if (j > i && (!best || j - i > best.n)) best = { e, n: j - i }; });
      seg.push(`${best.e} from ${wl(ws[i])}`); i += best.n;
    }
    return { status: 'tight', msg: `No one person is free throughout — hand over: ${seg.join(', then ')}.${note}` };
  };

  const check = () => {
    let worst = null; const parts = []; let any = false, checked = 0; const ends = [];
    PH.forEach(([k, n, pk]) => {
      const A = D.parseDay($('aj_' + k + '_a').value, today), B = D.parseDay($('aj_' + k + '_b').value, today), r = $('aj_' + k + '_r');
      $('aj_' + k + '_a').classList.toggle('bad', Number.isNaN(A)); $('aj_' + k + '_b').classList.toggle('bad', Number.isNaN(B));
      if (Number.isNaN(A) || Number.isNaN(B)) { r.className = 'res'; r.innerHTML = '<span class="t">Cannot read that date.</span>'; return; }
      const c = checkPhase(pk, A, B);
      if (!c) { r.className = 'res empty'; r.textContent = 'not used'; return; }
      any = true; r.className = 'res';
      if (c.err) { r.innerHTML = `<span class="st short">Check</span><span>${n} ${c.err}.</span>`; worst = 'short'; parts.push(n + ' dates'); return; }
      if (c.none) { r.innerHTML = `<span class="t">${esc(c.none)}</span>`; return; }
      r.innerHTML = `<span class="st ${c.status}">${AN_STATUS[c.status]}</span><span>${esc(c.msg)}</span>`; checked++;
      if (!worst || AN_RANK[c.status] > AN_RANK[worst]) worst = c.status;
      if (c.status !== 'ok') parts.push(n);
      ends.push([n, B === null ? A : B]);
    });
    const DL = D.parseDay($('aj_dl').value, today); $('aj_dl').classList.toggle('bad', Number.isNaN(DL));
    let late = '';
    if (DL !== null && !Number.isNaN(DL)) { const l = ends.filter(([, e]) => e > DL); if (l.length) late = `${l[0][0]} ends after the deadline. `; }
    const ar = $('aj_all');
    const cover = !parts.length ? 'Every phase you typed has someone free.' : worst === 'short' ? `Not covered: ${parts.join(', ')}.`
      : `Covered, but ${parts.join(' and ')} ${parts.length > 1 ? 'are' : 'is'} tight.`;
    if (!any) ar.innerHTML = '';
    else if (!checked && !late) ar.innerHTML = '<span class="hint">None of the weeks typed fall inside the weeks shown.</span>';
    else { const w = late ? 'short' : (worst || 'ok');
      ar.innerHTML = `<span class="st ${w}">${late ? 'Check' : AN_STATUS[w]}</span><span>${esc(late)}${late && !parts.length ? 'Otherwise every phase you typed has someone free.' : esc(cover)}</span>`; }
  };
  job.querySelectorAll('input').forEach(i => i.addEventListener('input', check));
  check();
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
let REPLAN = null, RP_DONE = null;

// The page says as little as it can in words. The button says it is a preview; the bar that
// carries the verdict also carries Apply and "reversible"; the people who change are chips in
// the phase's own colour (so it is plain that only WHO moves, never when); and why some
// projects did not move is a list, not a paragraph.
function renderReplan() {
  return '<div class="bar-row"><button class="btn primary" id="rpRun">Preview re-plan</button></div>' +
    '<div id="rpOut"></div>';
}

function wireReplan() {
  $('rpRun').addEventListener('click', runReplan);
  if (REPLAN) paintReplan();
}

async function runReplan() {
  $('rpRun').disabled = true;
  RP_DONE = null;
  $('rpOut').innerHTML = '<div class="muted">Trying other arrangements…</div>';
  REPLAN = await post('/api/replan', {});
  $('rpRun').disabled = false;
  paintReplan();
}

function paintReplan() {
  $('rpOut').innerHTML = replanBody(REPLAN);
  const ap = $('rpApply'); if (ap) ap.addEventListener('click', applyReplan);
  const rb = $('rpRoll'); if (rb) rb.addEventListener('click', rollReplanBack);
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
const PH_LABEL = { Dub: 'Dub', Edit: 'Edit', Mix: 'Mix' };

function leftAloneRow(l) {
  const kind = { complete: ['Complete', 'Finished work stays as it is.'],
    locked: ['Locked', 'Locked in the Projects tab.'],
    under_way: ['Under way', `${PH_LABEL[l.phase] || l.phase} started ${shortDate(l.since)}.`],
    by_hand: ['Set by hand', `${(l.phases || []).join(' and ')} chosen by hand.`] }[l.reason];
  return { project: l.project, reason: kind[0], why: kind[1] };
}

// A fold that needs no script: the browser's own details/summary.
const fold = (title, count, body, open) =>
  `<details class="fold"${open ? ' open' : ''}><summary><h3>${title}</h3><span class="n">${count}</span></summary>` +
  `<div class="body">${body}</div></details>`;

function replanBody(r) {
  if (!r.ok) return `<div class="errs">${esc(r.error || 'Re-plan failed.')}</div>`;

  // Everything left alone, with its reason: pinned projects first, then those whose typed
  // dates did not check out.
  const left = (r.left_alone || []).map(leftAloneRow)
    .concat((r.skipped || []).map(x => ({ project: x.project, reason: 'Dates do not check out', why: x.errors.join(' ') })));
  const byReason = {};
  left.forEach(l => { byReason[l.reason] = (byReason[l.reason] || 0) + 1; });
  const leftFold = left.length
    ? fold('Left alone', plural(left.length, 'project') + ' — ' +
        Object.keys(byReason).map(k => `${byReason[k]} ${k.toLowerCase()}`).join(', '),
        left.map(l => `<div class="lrow"><span><b>${esc(l.project)}</b></span><span>${esc(l.reason)}</span>` +
          `<span class="why">${esc(l.why)}</span></div>`).join(''), !!r.no_improvement) : '';

  if (r.no_improvement) {
    return '<div class="sum calm"><div class="v"><div class="s">Nothing better found — the schedule stays as it is.</div>' +
      '<div class="w">Every other arrangement tried was the same or worse.</div></div></div>' + leftFold;
  }

  const after = r.overlaps_after || [], resolved = r.overlaps_resolved || [];
  const made = after.filter(o => o.isNew).length;
  const was = resolved.length + after.filter(o => !o.isNew).length;
  const groups = {};
  (r.changes || []).forEach(c => { (groups[c.project] = groups[c.project] || []).push(c); });
  const names = Object.keys(groups);
  const due = t => { const q = BOOT.projects.find(x => x.title === t); return q && q.deadline ? shortDate(q.deadline) : ''; };

  let bar;
  if (RP_DONE) {
    bar = `<div class="sum done"><div class="v"><div class="s">Applied. ${RP_DONE.appended} rows added, ${RP_DONE.superseded} superseded. ` +
      'Nothing was deleted.</div></div><div class="act"><button class="link" id="rpRoll">Roll this back</button></div></div>';
  } else {
    const wLine = r.why && r.why.term !== 'total_double_booked'
      ? `<div class="w">${esc(r.why.label)}: ${r.why.from} → ${r.why.to}</div>` : '';
    // The overlap clause only when overlaps are involved; "0 → 0, 0 cleared, 0 new" says nothing.
    const ovLine = was || after.length || resolved.length
      ? ` · overlapped weeks ${was} → ${after.length} · ${plural(resolved.length, 'overlap')} cleared, ${made} new` : '';
    bar = `<div class="sum"><div class="v"><div class="s">${plural(names.length, 'project changes', 'projects change')} hands${ovLine}</div>${wLine}</div>` +
      '<div class="act"><button class="btn primary" id="rpApply">Apply re-plan</button>' +
      '<span class="hint">Reversible — old rows are kept</span></div></div>';
  }

  let h = bar;
  h += `<div class="head"><span class="bar"></span><h2>${RP_DONE ? 'Changed' : 'Would change'}</h2>` +
    `<span class="n">${plural(names.length, 'project')}, ${plural((r.changes || []).length, 'assignment')}</span></div>`;
  h += `<div class="rows${RP_DONE ? ' applied' : ''}"><div class="prow hd"><span>Project</span><span>Due</span><span>Who changes</span><span></span></div>`;
  const clears = {};
  resolved.forEach(o => o.projects.forEach(t => { clears[t] = (clears[t] || 0) + 1; }));
  names.forEach(t => {
    h += `<div class="prow"><span class="nm">${esc(t)}</span><span class="due">${esc(due(t))}</span><span class="chips">` +
      groups[t].map(c => `<span class="ch ${esc(String(c.phase).toLowerCase())}"><b>${esc(PH_LABEL[c.phase] || c.phase)}</b>` +
        `${esc(c.from)} <span class="ar">→</span> ${esc(c.to)}</span>`).join('') +
      `</span><span class="note">${clears[t] ? 'clears ' + plural(clears[t], 'overlap') : ''}</span></div>`;
  });
  h += '</div>';

  if (after.length || resolved.length) {
    const rows = resolved.map(o => ({ o, st: 'cleared' })).concat(after.map(o => ({ o, st: o.isNew ? 'new' : 'stays' })))
      .sort((x, y) => String(x.o.week).localeCompare(String(y.o.week)) || x.o.engineer.localeCompare(y.o.engineer));
    h += fold('Overlaps this fixes and leaves',
      `${resolved.length} cleared · ${after.length - made} stay · ${made} new`,
      '<div class="orow hd"><span>Week of</span><span>Engineer</span><span>Projects colliding</span><span></span></div>' +
      rows.map(({ o, st }) => `<div class="orow ${st}"><span>${esc(o.label)}</span><span><b>${esc(o.engineer)}</b></span>` +
        `<span class="pj">${esc(o.projects.join('  +  '))}</span><span class="tags">` +
        (st === 'cleared' ? '<span class="tag solid">Cleared</span>'
          : (st === 'new' ? '<span class="tag red">New</span>' : '<span class="tag">Stays</span>') +
            (o.projects.length > 2 ? `<span class="tag red">${o.projects.length} at once</span>` : '<span class="tag two">2 at once</span>')) +
        '</span></div>').join(''), true);
  }
  return h + leftFold;
}

async function applyReplan() {
  $('rpApply').disabled = true;
  const r = await post('/api/replan-apply', { token: REPLAN.token });
  if (!r.ok) {
    $('rpOut').innerHTML = `<div class="errs">${esc(r.error)}</div>` + replanBody(REPLAN);
    paintReplan();
    return;
  }
  RP_DONE = { appended: r.appended, superseded: r.superseded };
  absorb(r);
  paintReplan();
}

// "Roll this back" under an applied re-plan: the apply is the most recent change, so it is the
// one the log will undo. Asks first, like every other rollback.
async function rollReplanBack() {
  if (!confirm('Roll this re-plan back?\n\nThe rows it wrote are retired and the ones it replaced come back. Nothing is deleted.')) return;
  $('rpRoll').disabled = true;
  const h = await get('/api/history');
  const r = await post('/api/rollback', { index: h.latest });
  if (!r.ok) { alert(r.error); $('rpRoll').disabled = false; return; }
  absorb(r);
  HISTORY = null; RP_DONE = null; REPLAN = null;
  $('rpOut').innerHTML = '<div class="sum calm"><div class="v"><div class="s">Rolled back. The old rows are active again.</div></div></div>';
}

// ---------------------------------------------------------------- the form
// Check availability writes nothing and answers "can we take this job". Plot & save
// commits. Both go through the same engine call, so the answer you were shown is the
// answer you get.
// ---------------------------------------------------------------- dates on the form
// Dates are typed, in whatever form comes naturally (2 Nov, 11/2, 2026-11-02), because a
// row of calendar widgets made six empty-looking boxes that all read as today's date.
// A small calendar button beside each box still opens the picker. What was understood is
// always echoed back as "2 Nov 2026" and as the week it falls in, so a misreading shows.
// The reading and the rules live in dates.js, which the tests load too.
const DATES = window.PlannerDates;
const DAYMS = DATES.DAYMS, isoOf = DATES.isoOf, mondayOf = DATES.mondayOf;
const parseDay = raw => DATES.parseDay(raw, BOOT.today_week);
const dayLabel = t => shortDate(isoOf(t), true);
const dayShort = t => new Date(t).getUTCDate() + ' ' + MONTHS[new Date(t).getUTCMonth()];

// A date box: the typed text plus a calendar button that fills it from the picker.
function dateBox(id, label, iso, placeholder) {
  const t = iso ? Date.parse(iso + 'T00:00:00Z') : NaN;
  return `<span class="dbox"><input type="text" id="${id}" aria-label="${esc(label)}" placeholder="${esc(placeholder || 'optional')}" ` +
    `value="${Number.isNaN(t) ? '' : esc(dayLabel(t))}" autocomplete="off">` +
    `<button type="button" class="cal" data-for="${id}" tabindex="-1" aria-label="Pick ${esc(label)} from a calendar" title="Pick from a calendar">` +
    '<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><path d="M1.5 3h10v8.5h-10zM1.5 5.5h10M4 1.5v3M9 1.5v3" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></button>' +
    '</span>';
}

const PHASES = [['dub', 'Dub'], ['edit', 'Edit'], ['mix', 'Mix']];

// What the boxes say, run through the shared rules (dates.js).
function readDates() {
  const phases = {};
  PHASES.forEach(([k]) => { phases[k] = { a: parseDay($('f_' + k + '_from').value), b: parseDay($('f_' + k + '_to').value) }; });
  const deadline = parseDay($('f_deadline').value);
  const r = DATES.checkPhases({ deadline, phases });
  r.deadline = deadline;
  r.used = PHASES.filter(([k]) => r.phases[k].snapped);
  return r;
}

function drawDates() {
  const d = readDates(), tick = [];
  PHASES.forEach(([k, label]) => {
    const ph = d.phases[k], e = d.errors[k];
    ['from', 'to'].forEach(w => $('f_' + k + '_' + w).classList.remove('bad'));
    if (e.length) {
      const bad = (x, w) => { if (x === null || Number.isNaN(x)) $('f_' + k + '_' + w).classList.add('bad'); };
      if (ph.a === null || ph.b === null || Number.isNaN(ph.a) || Number.isNaN(ph.b)) { bad(ph.a, 'from'); bad(ph.b, 'to'); }
      else if (/ends before|Ends after/.test(e.join(' '))) $('f_' + k + '_to').classList.add('bad');
      else $('f_' + k + '_from').classList.add('bad');
    }
    const snap = $('s_' + k);
    if (ph.snapped) {
      const n = (ph.snapped[1] - ph.snapped[0]) / (7 * DAYMS) + 1;
      snap.className = 'snap';
      snap.innerHTML = `<b>${n} wk${n > 1 ? 's' : ''}</b> · ${esc(dayShort(ph.snapped[0]))} – ${esc(dayShort(ph.snapped[1] + 6 * DAYMS))}`;
    } else { snap.className = 'snap none'; snap.textContent = ph.none ? 'not used' : ''; }
    const el = $('e_' + k); el.hidden = !e.length; el.textContent = e.join(' ');
  });
  const dlBad = $('f_deadline').value.trim() && Number.isNaN(d.deadline);
  $('f_deadline').classList.toggle('bad', !!dlBad);

  // the strip: the phases as bars on one week axis, the deadline as a marker
  const used = d.used, strip = $('phStrip'), ov = $('phOv');
  if (!used.length) {
    strip.innerHTML = '<div class="empty">Add dates and the phases appear here, week by week.</div>';
    ov.className = 'ov none'; ov.textContent = '';
  } else {
    const dl = d.deadline != null && !Number.isNaN(d.deadline) ? mondayOf(d.deadline) : null;
    const sn = k => d.phases[k].snapped;
    const first = Math.min(...used.map(([k]) => sn(k)[0])) - 7 * DAYMS;
    let last = Math.max(...used.map(([k]) => sn(k)[1]));
    if (dl != null) last = Math.max(last, dl);
    last += 7 * DAYMS;
    const n = Math.round((last - first) / (7 * DAYMS)) + 1;
    const col = t => Math.round((t - first) / (7 * DAYMS)) + 1;
    const cover = {};
    used.forEach(([k]) => { for (let t = sn(k)[0]; t <= sn(k)[1]; t += 7 * DAYMS) (cover[t] = cover[t] || []).push(k); });
    let html = '<div class="grid">';
    PHASES.forEach(([k, label]) => {
      html += `<div class="row" style="grid-template-columns:repeat(${n},1fr)">`;
      if (sn(k)) {
        const [a, b] = sn(k), weeks = (b - a) / (7 * DAYMS) + 1;
        const shared = Object.keys(cover).some(t => +t >= a && +t <= b && cover[t].length > 1);
        html += `<div class="bk ${k}${shared ? ' under' : ''}" style="grid-column:${col(a)} / ${col(b) + 1}" ` +
          `title="${label} ${dayShort(a)} – ${dayShort(b + 6 * DAYMS)}">${weeks >= 2 ? label : ''}</div>`;
      }
      html += '</div>';
    });
    if (dl != null) html += `<div class="dl" style="left:${(((dl - first) / (7 * DAYMS) + 0.5) / n * 100).toFixed(3)}%"><em>Due</em></div>`;
    html += '</div><div class="axis" style="grid-template-columns:repeat(' + n + ',1fr)">';
    for (let i = 0; i < n; i++) html += `<span>${n <= 14 || i % 2 === 0 ? dayShort(first + i * 7 * DAYMS) : ''}</span>`;
    strip.innerHTML = html + '</div>';
    const parts = [];
    [['dub', 'edit'], ['edit', 'mix'], ['dub', 'mix']].forEach(([x, y]) => {
      if (!sn(x) || !sn(y)) return;
      const w = Object.keys(cover).filter(t => cover[t].includes(x) && cover[t].includes(y)).length;
      if (w) parts.push(`${x[0].toUpperCase() + x.slice(1)} + ${y} share ${w} wk${w > 1 ? 's' : ''}`);
    });
    ov.className = parts.length ? 'ov' : 'ov none';
    ov.textContent = parts.length ? parts.join('  ·  ') : 'No phases overlap';
  }

  const bad = Object.values(d.errors).some(e => e.length) || !!dlBad;
  let note = '';
  if (bad) note = 'Fix the highlighted dates to continue.';
  else if (!d.used.length) note = 'Add at least one phase.';
  else if (d.deadline === null) note = 'Add the deadline.';
  $('f_save').disabled = $('f_check').disabled = !!note;
  $('f_note').textContent = note;
}

function wireDates() {
  const ids = ['f_deadline', ...PHASES.flatMap(([k]) => ['f_' + k + '_from', 'f_' + k + '_to'])];
  ids.forEach(id => {
    const el = $(id);
    el.addEventListener('input', drawDates);
    // Say back what was understood once the box is left.
    el.addEventListener('blur', () => {
      const t = parseDay(el.value);
      if (t != null && !Number.isNaN(t)) el.value = dayLabel(t);
      drawDates();
    });
  });
  document.querySelectorAll('#formHost .cal').forEach(btn => btn.addEventListener('click', ev => {
    ev.stopPropagation();
    const box = $(btn.dataset.for);
    if (CAL && CAL.box === box) return closeCal();
    openCal(box, btn.parentNode);
  }));
  drawDates();
}

// ---------------------------------------------------------------- the calendar popup
// Drawn by the app, not the browser. The calendar button used to open Safari's native
// date picker on a hidden 1px input; with nothing visible to anchor to, Safari never
// dismissed it and it stayed on screen over the form (Tara, 2026-10-27). This one closes
// on a pick, on Escape, and on any click outside it.
let CAL = null;

function closeCal() {
  if (!CAL) return;
  CAL.el.remove();
  document.removeEventListener('mousedown', CAL.outside, true);
  document.removeEventListener('keydown', CAL.key, true);
  CAL = null;
}

function openCal(box, anchor) {
  closeCal();
  const t = parseDay(box.value);
  const seed = new Date(t != null && !Number.isNaN(t) ? t : Date.parse(BOOT.today_week + 'T00:00:00Z'));
  const el = document.createElement('div');
  el.className = 'calpop';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Pick a date');
  anchor.appendChild(el);
  CAL = { el, box, y: seed.getUTCFullYear(), m: seed.getUTCMonth(),
    outside: e => { if (!el.contains(e.target) && !e.target.closest('.cal')) closeCal(); },
    key: e => { if (e.key === 'Escape') { e.preventDefault(); closeCal(); box.focus(); } } };
  document.addEventListener('mousedown', CAL.outside, true);
  document.addEventListener('keydown', CAL.key, true);
  drawCal();
}

function drawCal() {
  const { el, box, y, m } = CAL;
  const chosen = parseDay(box.value);
  const today = Date.parse(BOOT.today_week + 'T00:00:00Z') + ((new Date().getDay() + 6) % 7) * DAYMS;
  // Monday-first, as the app's weeks are.
  const first = Date.UTC(y, m, 1);
  const start = first - ((new Date(first).getUTCDay() + 6) % 7) * DAYMS;
  let h = `<div class="calhd"><button type="button" class="calnav" data-step="-1" aria-label="Previous month">\u2039</button>` +
    `<b>${MONTHS[m]} ${y}</b><button type="button" class="calnav" data-step="1" aria-label="Next month">\u203A</button></div>` +
    '<div class="calgrid">' + ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => `<span class="calwd">${d}</span>`).join('');
  for (let i = 0; i < 42; i++) {
    const day = start + i * DAYMS, d = new Date(day);
    const cls = ['calday', d.getUTCMonth() !== m ? 'out' : '', day === chosen ? 'on' : '',
      day === today ? 'now' : ''].filter(Boolean).join(' ');
    h += `<button type="button" class="${cls}" data-t="${day}">${d.getUTCDate()}</button>`;
  }
  el.innerHTML = h + '</div>';
  el.querySelectorAll('.calnav').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    const n = new Date(Date.UTC(CAL.y, CAL.m + Number(b.dataset.step), 1));
    CAL.y = n.getUTCFullYear(); CAL.m = n.getUTCMonth(); drawCal();
  }));
  el.querySelectorAll('.calday').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    box.value = dayLabel(Number(b.dataset.t));
    closeCal(); box.focus(); drawDates();
  }));
}

// ---------------------------------------------------------------- series
// A series connects the seasons and episode batches of one show, so the planner can keep the
// same people on it: whoever did a phase on an earlier project is preferred for that phase on
// the next. Everything below shows that history; the preference itself is in the planner.
const SERIES_KEY = x => String(x == null ? '' : x).trim().replace(/\s+/g, ' ').toLowerCase();
const PHASE_NAMES = ['Dub', 'Edit', 'Mix'];

// The other projects in a series, earliest deadline first, each with who did which phase.
// Cancelled/removed ones are skipped: they have no bookings and never happened.
function seriesMembers(series, selfTitle) {
  const k = SERIES_KEY(series);
  if (!k) return [];
  return BOOT.projects.filter(q => q.title !== selfTitle && SERIES_KEY(q.series) === k && q.status !== 'Cancelled')
    .map(q => ({ title: q.title, deadline: q.deadline, status: q.status,
      who: PHASE_NAMES.map(ph => [ph, [...new Set(q.rows.filter(r => r.phase === ph).map(r => r.engineer))]]) }))
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)) || a.title.localeCompare(b.title));
}

// Who did each phase on the projects that came BEFORE this one (by deadline).
function seriesHistory(series, selfTitle, deadlineIso) {
  const out = { Dub: new Set(), Edit: new Set(), Mix: new Set() };
  seriesMembers(series, selfTitle).filter(m => !deadlineIso || String(m.deadline) < deadlineIso)
    .forEach(m => m.who.forEach(([ph, names]) => names.forEach(n => out[ph].add(n))));
  return out;
}

function wireSeries(p) {
  const box = $('f_series'), area = $('serArea');
  const draw = () => {
    const members = seriesMembers(box.value, p && p.title);
    const typed = box.value.trim();
    let h = '';
    if (typed && !members.length) h = '<span class="sertag">New series</span>';
    else if (members.length) {
      const shown = members.slice(-4);
      h = (members.length > shown.length ? `<div class="sermore">+ ${members.length - shown.length} earlier</div>` : '') +
        shown.map(m => `<div class="serline"><span class="sername" title="${esc(m.title)}">${esc(m.title)}</span>` +
          `<span class="serdue">due ${esc(shortDate(m.deadline))}</span>` +
          m.who.map(([ph, names]) => names.length
            ? `<span class="serchip ${ph.toLowerCase()}">${ph} ${esc(names.join(' + '))}</span>` : '').join('') + '</div>').join('');
    }
    // Editing a scheduled project: the series can be saved on its own. Saving the form would
    // re-plot it, which could move people just to record which show it belongs to.
    if (p && typed !== (p.series || '')) h += '<button type="button" class="btn small" id="f_serset">Save series only</button>';
    area.innerHTML = h;
    const set = $('f_serset');
    if (set) set.addEventListener('click', async () => {
      set.disabled = true;
      const r = await post('/api/set-series', { title: p.title, series: typed });
      if (!r.ok) { set.disabled = false; $('f_out').innerHTML = `<div class="msg">${esc(r.error)}</div>`; return; }
      BOOT = r.boot; SCHED = r.schedule || SCHED;
      $('formHost').innerHTML = '';
      paint();
    });
  };
  box.addEventListener('input', draw);
  draw();
}

// A title that is already taken is numbered by the server ("Harbor Lights (2)"). Said here as
// it is typed, with the same rule (titles.js), so the result is never a surprise.
function wireTitle(p) {
  const T = window.PlannerTitles, box = $('f_title'), note = $('f_titlenote');
  const others = BOOT.projects.map(x => x.title).filter(t => !p || T.key(t) !== T.key(p.title));
  const show = () => {
    const wanted = T.clean(box.value);
    const final = p && T.key(wanted) === T.key(p.title) ? wanted : T.uniqueTitle(wanted, others);
    const clash = !!wanted && final !== wanted;
    note.hidden = !clash;
    if (clash) note.textContent = `Already used \u2014 saved as \u201c${final}\u201d`;
  };
  box.addEventListener('input', show);
  show();
}

function openForm(title) {
  const p = title ? BOOT.projects.find(x => x.title === title) : null;
  const opts = sel => ['Auto', ...BOOT.engineers]
    .map(n => `<option${n === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');

  $('formHost').innerHTML = `<div class="form${p ? ' editing' : ''}">
    <h3>${p ? 'Edit ' + esc(p.title) : 'Add project'}</h3>
    <div class="top5">
      <div class="f titlef"><label for="f_title">Project</label>
        <input type="text" id="f_title" value="${p ? esc(p.title) : ''}">
        <div class="titletag" id="f_titlenote" hidden></div></div>
      <div class="f"><label for="f_client">Client</label>
        <input type="text" id="f_client" list="clientList" value="${esc(p ? p.client : 'Netflix')}">
        <datalist id="clientList">${(BOOT.clients || []).map(c => `<option>${esc(c)}</option>`).join('')}</datalist></div>
      <div class="f"><label for="f_deadline">Deadline</label>${dateBox('f_deadline', 'Deadline', p ? p.deadline : '', 'e.g. 20 Dec')}</div>
      <div class="f"><label for="f_level">Mix level</label><select id="f_level">
        <option${p && p.mix_level === 'Developing' ? '' : ' selected'}>Advanced</option>
        <option${p && p.mix_level === 'Developing' ? ' selected' : ''}>Developing</option></select></div>
      <div class="f"><span class="lab">Flags</span><div class="checks">
        <label><input type="checkbox" id="f_music"${p && p.music ? ' checked' : ''}> Music</label>
        <label title="Special work routes to the specials engineer"><input type="checkbox" id="f_special"${p && p.special ? ' checked' : ''}> Special</label>
        <label title="The mix needs the Atmos room"><input type="checkbox" id="f_atmos"${p && p.atmos ? ' checked' : ''}> Atmos</label>
      </div></div>
    </div>

    <div class="seriesrow">
      <div class="f"><label for="f_series">Series</label>
        <input type="text" id="f_series" list="seriesList" placeholder="optional" autocomplete="off"
          value="${p ? esc(p.series || '') : ''}">
        <datalist id="seriesList">${(BOOT.series || []).map(x => `<option>${esc(x)}</option>`).join('')}</datalist></div>
      <div id="serArea" class="serarea"></div>
    </div>

    <div class="phases2">
      <div>
        <span class="lab">When each phase runs</span>
        ${[['dub', 'Dub'], ['edit', 'Edit'], ['mix', 'Mix']].map(([k, label]) => {
          const d = (p && p.dates && p.dates[k]) || { from: '', to: '' };
          return `<div class="ph" id="ph_${k}"><div class="name"><i class="sw" style="background:var(--${k})"></i>${label}</div>` +
            dateBox(`f_${k}_from`, label + ' start', d.from) + '<span class="arrow">\u2192</span>' +
            dateBox(`f_${k}_to`, label + ' end', d.to) +
            `<span class="snap none" id="s_${k}">not used</span><div class="err" id="e_${k}" hidden></div></div>`;
        }).join('')}
      </div>
      <div class="tl">
        <div class="hd"><span class="lab">The weeks, side by side</span></div>
        <div id="phStrip"></div><div class="ov" id="phOv"></div>
      </div>
    </div>

    <div class="picks">
      <div class="pickhead">Who does it \u2014 leave on Auto and the engine decides</div>
      <div class="fields">
        <div class="f"><label for="f_rec">Recordist</label><select id="f_rec">${opts(p && p.recordist_pick)}</select></div>
        <div class="f" title="Splits the dub between the two, the first name taking the earlier weeks">
          <label for="f_rec2">Second recordist \u00b7 later weeks</label><select id="f_rec2">${opts(p && p.recordist_pick_2)}</select></div>
        <div class="f" title="Auto prefers the recordist, and hands the edit to someone else only when that avoids an overlap">
          <label for="f_ed">Editor</label><select id="f_ed">${opts(p && p.editor_pick)}</select></div>
        <div class="f" title="A manual pick overrides every rule and is flagged">
          <label for="f_mixer">Mixer</label><select id="f_mixer">${opts(p && p.mixer_pick)}</select></div>
      </div>
    </div>
    <div class="formactions">
      <button class="btn" id="f_check" title="Shows who would do it and when \u2014 saves nothing">Check availability</button>
      <button class="btn primary" id="f_save">${p ? 'Save &amp; re-plot' : 'Plot &amp; save'}</button>
      ${p ? `<button class="btn" id="f_done">${p.status === 'Complete'
        ? 'Reopen' : 'Mark complete'}</button>` : ''}
      ${p ? `<button class="btn" id="f_lock">${p.locked
        ? 'Unlock' : 'Lock'}</button>` : ''}
      ${p && p.status !== 'Complete' ? `<button class="btn" id="f_cancel">${
        p.status === 'Cancelled' ? 'Reinstate' : 'Cancel project'}</button>` : ''}
      <button class="btn" id="f_close">Close</button>
      <span class="formnote" id="f_note"></span>
    </div>
    <div id="f_out"></div></div>`;
  wireDates();
  wireTitle(p);
  wireSeries(p);

  $('formHost').scrollIntoView({ block: 'nearest' });
  $('f_check').addEventListener('click', () => submitForm(p, true));
  $('f_save').addEventListener('click', () => submitForm(p, false));
  $('f_close').addEventListener('click', () => { closeCal(); $('formHost').innerHTML = ''; });
  if ($('f_cancel')) $('f_cancel').addEventListener('click', async () => {
    const to = p.status === 'Cancelled' ? '' : 'Cancelled';
    // Cancelling frees the weeks, so it is the one status change that alters the
    // schedule. Say so before doing it.
    if (!confirm(to
      ? `Cancel ${p.title}?\n\nIts weeks go back to the engineers holding them and it ` +
        'drops out of the list. The project row stays.'
      : `Reinstate ${p.title}?\n\nIt has no schedule any more — use Save & re-plot, or ` +
        'a re-plan, to give it one.')) return;
    const r = await post('/api/set-status', { title: p.title, status: to });
    if (!r.ok) { $('f_out').innerHTML = `<div class="msg">${esc(r.error)}</div>`; return; }
    BOOT = r.boot; SCHED = r.schedule || SCHED;
    $('formHost').innerHTML = '';
    paint();
  });

  if ($('f_lock')) $('f_lock').addEventListener('click', async () => {
    const to = !p.locked;
    if (!confirm(to
      ? `Lock ${p.title}?\n\nRe-plan will leave its schedule exactly where it is. ` +
        'You can still move a week by hand.'
      : `Unlock ${p.title}?\n\nRe-plan can move it again.`)) return;
    const r = await post('/api/set-lock', { title: p.title, locked: to });
    if (!r.ok) { $('f_out').innerHTML = `<div class="msg">${esc(r.error)}</div>`; return; }
    BOOT = r.boot; SCHED = r.schedule || SCHED;
    $('formHost').innerHTML = '';
    paint();
  });

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
  // The typed text, as the ISO date the server wants; blank or unreadable goes as blank.
  const iso = id => { const t = parseDay($(id).value); return t == null || Number.isNaN(t) ? '' : isoOf(t); };
  return {
    title: $('f_title').value.trim(),
    original_title: p ? p.title : '',
    client: $('f_client').value.trim(),
    deadline: iso('f_deadline'),
    dub_from: iso('f_dub_from'), dub_to: iso('f_dub_to'),
    edit_from: iso('f_edit_from'), edit_to: iso('f_edit_to'),
    mix_from: iso('f_mix_from'), mix_to: iso('f_mix_to'),
    mix_level: $('f_level').value,
    series: $('f_series').value.trim(),
    music: $('f_music').checked, special: $('f_special').checked, atmos: $('f_atmos').checked,
    recordist: $('f_rec').value, recordist2: $('f_rec2').value,
    editor: $('f_ed').value, mixer: $('f_mixer').value,
    dry_run: dryRun,
  };
}

// "Continues" / "new to series" beside an engineer, when the project has a series with history
// for that phase. Judged on the projects that come before this one.
function continuesTag(r, x) {
  if (!r.series) return '';
  const hist = seriesHistory(r.series, (r.renamed && r.renamed.from) || r.title, r.project && r.project.deadline);
  const past = hist[x.phase === 'Edit' ? 'Edit' : x.phase === 'Mix' ? 'Mix' : 'Dub'];
  if (!past || !past.size) return '';
  return past.has(x.engineer) ? ' <span class="chip ok">continues</span>' : ' <span class="chip">new to series</span>';
}

async function submitForm(p, dryRun) {
  $('f_check').disabled = $('f_save').disabled = true;
  $('f_out').innerHTML = '<div class="muted">' + (dryRun ? 'Checking' : 'Plotting') + '\u2026</div>';
  const r = await post('/api/save-project', formValues(p, dryRun));
  drawDates();      // back to whatever the dates allow, not blindly enabled

  if (!r.ok) {
    $('f_out').innerHTML = '<div class="errs"><b>Not plotted.</b><ul>' +
      (r.errors || []).map(e => `<li>${esc(e)}</li>`).join('') + '</ul></div>';
    return;
  }

  // Depth comes from the freshly returned book, so the banner and the row you see a
  // moment later cannot tell you different things.
  const deep = !dryRun && r.boot
    ? (r.boot.projects.find(x => x.title === r.title) || {}).overlap || 0 : 0;
  // The state is a tag beside the heading, not a sentence under it: "Not saved" says what
  // the old "nothing was written ... press Plot & save to commit" took two lines to say, and
  // the overlap depth is the same blue/red as the schedule's outlines.
  let h = `<div class="result ${deep > 2 ? 'alarm' : dryRun ? 'dry' : 'saved'}">` +
    `<h4>${dryRun ? 'Availability check <span class="tag">Not saved</span>' : 'Saved'}` +
    (deep > 2 ? ' <span class="tag red">3 at once</span>' : deep ? ' <span class="tag two">2 at once</span>' : '') + '</h4>' +
    (r.renamed ? `<div class="kv"><b>${dryRun ? 'Would be' : 'Saved'} as</b><span><b>${esc(r.renamed.to)}</b> ` +
      `<span class="muted-inline">\u2014 \u201c${esc(r.renamed.from)}\u201d was already a project</span></span></div>` : '') +
    `<div class="kv"><b>Recordist</b><span>${esc(r.dubber || r.recordist)}</span></div>` +
    `<div class="kv"><b>Editor</b><span>${esc(r.editor || r.recordist)}</span></div>` +
    `<div class="kv"><b>Mixer</b><span>${esc(r.mixer)}</span></div>`;
  if (r.rows && r.rows.length) {
    h += '<table class="projects" style="margin-top:10px"><thead><tr><th>Phase</th>' +
      '<th>Engineer</th><th>From</th><th>To</th></tr></thead><tbody>' +
      r.rows.map(x => `<tr><td><span class="sw" style="background:${PHASE_BG[x.phase] || 'transparent'}"></span>` +
        `${esc(x.phase)}</td><td>${esc(x.engineer)}${continuesTag(r, x)}</td><td>${esc(x.start)}</td>` +
        `<td>${esc(x.end)}</td></tr>`).join('') + '</tbody></table>';
  }
  if (r.warnings) h += `<div class="msg">${esc(r.warnings)}</div>`;
  const note = [r.record_note, r.mix_note].filter(Boolean).join(' \u00b7 ');
  if (note) h += `<div class="muted">${esc(note)}</div>`;
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

// The schedule opens on THIS WEEK, not on the first week of the book: most of what a
// first screen held was finished work. The position is remembered across repaints (a
// drag redraws the grid) and only re-aimed when the grid itself changes (mode, range).
let SCROLL = { key: null, top: 0, left: 0 };
// Sticky bars on a page sit just under the top bar, whose height changes when it wraps.
function syncTop() {
  const t = document.querySelector('.top');
  if (t) document.documentElement.style.setProperty('--toph', t.offsetHeight + 'px');
}
addEventListener('resize', syncTop);
function placeSchedule() {
  const wrap = document.querySelector('.gridwrap');
  if (!wrap) return;
  const key = SCHED.mode + '|' + (RANGE.from || '') + '|' + (RANGE.to || '');
  wrap.addEventListener('scroll', () => { SCROLL.top = wrap.scrollTop; SCROLL.left = wrap.scrollLeft; });
  if (SCROLL.key === key) { wrap.scrollTop = SCROLL.top; wrap.scrollLeft = SCROLL.left; return; }
  SCROLL = { key, top: 0, left: 0 };
  const w0 = wrap.getBoundingClientRect();
  if (SCHED.mode === 'project') {
    const th = wrap.querySelector('th.nowcol');
    if (th) wrap.scrollLeft = Math.max(0, th.getBoundingClientRect().left - w0.left + wrap.scrollLeft - 250 - th.offsetWidth * 2);
  } else {
    const row = wrap.querySelector('tr.nowrow'), head = wrap.querySelector('thead');
    // two weeks of the past stay above it, for context
    if (row) wrap.scrollTop = Math.max(0, row.getBoundingClientRect().top - w0.top + wrap.scrollTop -
      (head ? head.getBoundingClientRect().height : 0) - row.getBoundingClientRect().height * 2);
  }
  SCROLL.top = wrap.scrollTop; SCROLL.left = wrap.scrollLeft;
}

function paint() {
  syncTop();
  closeCal();          // its listeners live on document; a repaint must not orphan them
  $('view').innerHTML = (VIEWS[VIEW] || renderSchedule)();
  topRight();
  if (VIEW === 'analysis') {
    if (!ANALYSIS) loadAnalysis();
    else wireAnalysis();
    return;
  }
  if (VIEW === 'report') { if (!REPORT) loadReport(); else wireReport(); return; }
  if (VIEW === 'history') { if (!HISTORY) loadHistory(); else wireHistory(); return; }
  if (VIEW === 'replan') { wireReplan(); return; }
  if (VIEW === 'schedule') {
    wireScheduleBar();
    placeSchedule();
    wireColumnHover();
    // Dragging is an Engineers-mode action: you move a week between engineers, and a
    // Projects row has no engineer column to drop into.
    if (SCHED.mode === 'engineer' && !READONLY) wireDrag();
    const fold = $('doneFold');
    if (fold) fold.addEventListener('click', () => { SHOW_FINISHED = !SHOW_FINISHED; paint(); });
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
  if (READONLY) return { ok: false, readonly: true,
    error: 'This is a read-only copy of the planner.' };
  const t0 = performance.now();
  // The view is sent with the write so the fresh schedule comes back in the
  // orientation and range the user is looking at, not a default one.
  const r = await fetch(requestUrl(path), { method: 'POST',
    headers: { 'content-type': 'application/json',
               'x-planner-csrf':
    (BOOT && BOOT.session && BOOT.session.csrf_token) || ''
 },
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
