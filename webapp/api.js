// The read models and actions, as plain functions of a book.
//
// Deliberately free of HTTP and of Google: every one of these takes a book and returns
// a value, so they can be tested directly the way the Apps Script api* functions are.
// The engine itself is never reimplemented here — that is core/engine.js, the same
// source the Apps Script app runs.
const { loadAppsScript } = require('../core/engine.js');
const A = loadAppsScript();

const yes = v => /^yes$/i.test(String(v == null ? '' : v).trim());
const live = book => A.activeRows(book.bookings);
const todayLocal = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Overlapped engineer-weeks by DEPTH. Two at once is ordinary — a series still
// recording while its edit starts — and three is overflow that wants reassigning.
// Counted from the weeks, never from a FORCED note: the note records what the engine
// decided at the time, and misses any overlap a later project created on top of it.
function depths(rows) {
  const per = {};
  rows.forEach(b => {
    if (!b.engineer || !b.start_date || !b.end_date) return;
    for (let w = A.widx(b.start_date); w <= A.widx(b.end_date); w++) {
      const k = b.engineer + '|' + w;
      per[k] = (per[k] || 0) + 1;
    }
  });
  let two = 0, three = 0;
  Object.keys(per).forEach(k => { if (per[k] === 2) two++; else if (per[k] > 2) three++; });
  return { two, three, per };
}

function projectDepth(rows) {
  const per = {};
  rows.forEach(b => {
    if (!b.engineer || !b.start_date || !b.end_date) return;
    for (let w = A.widx(b.start_date); w <= A.widx(b.end_date); w++) {
      const k = b.engineer + '|' + w; (per[k] = per[k] || []).push(b);
    }
  });
  const out = {};
  Object.keys(per).forEach(k => {
    const n = per[k].length;
    if (n > 1) per[k].forEach(b => { if (n > (out[b.project] || 0)) out[b.project] = n; });
  });
  return out;
}

function bootstrap(book) {
  const rows = live(book);
  const d = depths(rows);
  const deep = projectDepth(rows);
  return {
    engineers: book.engineers.map(e => e.name),
    roster: book.engineers,
    // Offered as suggestions on the form, not a closed list — a new client should not
    // need a code change to be typed in.
    clients: [...new Set(book.projects.map(p => String(p.client || '').trim())
      .filter(Boolean))].sort(),
    projects: book.projects.map(p => ({
      title: p.project_title, client: p.client, deadline: p.deadline,
      dub: p.dub_weeks, edit: p.edit_weeks, mix: p.mix_weeks,
      mix_level: p.mix_level_required,
      music: yes(p.music_songs), special: yes(p.special_project), atmos: yes(p.atmos_required),
      overlap: deep[p.project_title] || 0,
      rows: rows.filter(b => b.project === p.project_title).map(b => ({
        phase: b.phase, engineer: b.engineer, start: b.start_date, end: b.end_date, note: b.note || '',
      })),
    })),
    // The Monday of the current week, so the grid can bold today's row.
    // LOCAL date, not UTC. toISOString() is UTC, and Manila is UTC+8, so between
    // midnight and 8am it returns yesterday — which put the bold on last week's row
    // for the whole of every early morning. The Apps Script app reads the
    // spreadsheet's own timezone for the same reason.
    today_week: A.weekStart(A.widx(todayLocal())),
    counts: { projects: book.projects.length, live_rows: rows.length,
              over2: d.two, over3: d.three },
  };
}

// weeks DOWN, one column per engineer — the orientation the grid actually uses
function schedule(book) {
  const rows = live(book);
  if (!rows.length) return { empty: true, weeks: [], labels: [], cells: [] };
  let min = Infinity, max = -Infinity;
  rows.forEach(b => {
    const a = A.widx(b.start_date), z = A.widx(b.end_date);
    if (a < min) min = a; if (z > max) max = z;
  });
  book.projects.forEach(p => {
    if (!p.deadline) return;
    const w = A.widx(p.deadline);
    if (w > max) max = w; if (w < min) min = w;
  });

  const weeks = [];
  for (let w = min; w <= max; w++) {
    weeks.push({ week: w, start: A.weekStart(w), label: A.weekLabel(w), quarter: A.quarterOf(w) });
  }
  const col = {}; weeks.forEach((w, i) => { col[w.week] = i; });
  const labels = book.engineers.map(e => e.name);
  const idx = {}; labels.forEach((n, i) => { idx[n] = i; });
  const cells = labels.map(() => weeks.map(() => null));

  const per = depths(rows).per;
  rows.forEach(b => {
    const ri = idx[b.engineer];
    if (ri === undefined) return;
    for (let w = A.widx(b.start_date); w <= A.widx(b.end_date); w++) {
      const ci = col[w];
      if (ci === undefined) continue;
      const deep = per[b.engineer + '|' + w] || 1;
      const item = { p: b.project, ph: b.phase, hand: /moved by hand/i.test(b.note || '') };
      const cur = cells[ri][ci];
      if (!cur) cells[ri][ci] = { phase: b.phase, text: b.project, depth: deep, count: 1, items: [item] };
      else {
        cur.text += ' / ' + b.project; cur.count++;
        if (deep > cur.depth) cur.depth = deep;
        cur.items.push(item);
      }
    }
  });
  return { empty: false, weeks, labels, cells };
}

function analysis(book) {
  const rows = live(book);
  return {
    capacity: A.computeCapacity(rows, book.engineers),
    score: A.scorePlan(rows, book.engineers),
    overlaps: A.actualOverlaps_(rows),
  };
}

module.exports = { bootstrap, schedule, analysis, depths, projectDepth, engine: A };
