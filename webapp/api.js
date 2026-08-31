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
      status: p.status || '', completed: p.completed || '',
      locked: p.locked === true || /^(yes|true)$/i.test(String(p.locked || '')),
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
    counts: { projects: book.projects.filter(p => !p.status).length,
              done: book.projects.filter(p => p.status === 'Complete').length,
              live_rows: rows.length,
              over2: d.two, over3: d.three },
  };
}

// The grid, in either orientation.
//
// Returns cells[labelIndex][weekIndex] for BOTH modes — Projects renders that directly
// (projects down, weeks across) and Engineers transposes it at render time. One shape,
// one set of rules about depth and hand-placement, so the two views cannot disagree.
function schedule(book, opts) {
  const o = opts || {};
  const byProject = o.mode !== 'engineer';
  const rows = live(book);
  if (!rows.length) return { empty: true, mode: byProject ? 'project' : 'engineer',
                             weeks: [], labels: [], cells: [], markers: [], quarters: [] };

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

  let weeks = [];
  for (let w = min; w <= max; w++) {
    weeks.push({ week: w, start: A.weekStart(w), label: A.weekLabel(w),
                 quarter: A.quarterOf(w),
                 // Projects mode groups columns under a month band and labels each week
                 // by day range; Engineers mode uses neither.
                 month: A.monthLabel(w), day_range: A.weekDayRange(w) });
  }
  // Every quarter present, so the picker can only offer ranges that exist.
  const quarters = [...new Set(weeks.map(w => w.quarter))].sort();

  // Quarter ids sort lexically ('2026-Q3'), so a string comparison is the whole test.
  const from = o.from || null, to = o.to || null;
  if (from || to) {
    weeks = weeks.filter(w => (!from || w.quarter >= from) && (!to || w.quarter <= to));
    if (!weeks.length) {
      return { empty: false, mode: byProject ? 'project' : 'engineer', weeks: [], labels: [],
               cells: [], markers: [], quarters, range: { from, to }, clipped: true };
    }
  }
  // By week NUMBER, not an offset from min: once the range can be clipped, w - min no
  // longer points at the right column.
  const col = {}; weeks.forEach((w, i) => { col[w.week] = i; });

  let labels;
  if (byProject) {
    // Ordered by WHEN THE WORK STARTS, which is what makes a schedule read diagonally.
    // Deadline is only a tiebreak, and the title breaks ties after that.
    const firstWeek = {}, deadlineOf = {};
    book.projects.forEach(p => { if (p.deadline) deadlineOf[p.project_title] = p.deadline; });
    rows.forEach(b => {
      const w = A.widx(b.start_date);
      if (firstWeek[b.project] === undefined || w < firstWeek[b.project]) firstWeek[b.project] = w;
    });
    labels = Object.keys(firstWeek).sort((a, b) =>
      (firstWeek[a] - firstWeek[b]) ||
      String(deadlineOf[a] || '9999-12-31').localeCompare(String(deadlineOf[b] || '9999-12-31')) ||
      a.localeCompare(b));
  } else {
    labels = book.engineers.map(e => e.name);
  }
  const idx = {}; labels.forEach((n, i) => { idx[n] = i; });
  let cells = labels.map(() => weeks.map(() => null));

  // An overlap is a WEEK one engineer holds two bookings in — a property of the
  // engineer's calendar, not of the project. In Projects mode the cell still reports
  // the depth of whoever is in it, so the same week reads the same in both views.
  const per = depths(rows).per;
  rows.forEach(b => {
    const key = byProject ? b.project : b.engineer;
    const ri = idx[key];
    if (ri === undefined) return;
    for (let w = A.widx(b.start_date); w <= A.widx(b.end_date); w++) {
      const ci = col[w];
      if (ci === undefined) continue;        // outside the range: skip the WEEK, not the booking
      const deep = per[b.engineer + '|' + w] || 1;
      const text = byProject ? b.engineer : b.project;
      const item = { p: b.project, ph: b.phase, hand: /moved by hand/i.test(b.note || '') };
      const cur = cells[ri][ci];
      if (!cur) cells[ri][ci] = { phase: b.phase, text, depth: deep, count: 1, items: [item] };
      else {
        cur.text += ' / ' + text; cur.count++;
        if (deep > cur.depth) cur.depth = deep;
        cur.items.push(item);
      }
    }
  });

  // Deadline markers belong to projects.
  let markers = [];
  if (byProject) {
    book.projects.forEach(p => {
      if (!p.deadline || idx[p.project_title] === undefined) return;
      const ci = col[A.widx(p.deadline)];
      if (ci !== undefined) markers.push({ row: idx[p.project_title], col: ci });
    });
  }

  // Clipping the columns is half the job: a project with no work in the chosen
  // quarters still rendered as an empty row. Dropped only in PROJECT mode — in
  // Engineers mode an empty row is information ("free all quarter").
  if ((from || to) && byProject) {
    const keep = [];
    cells.forEach((row, ri) => { if (row.some(c => c)) keep.push(ri); });
    const remap = {}; keep.forEach((ri, i) => { remap[ri] = i; });
    labels = keep.map(ri => labels[ri]);
    cells = keep.map(ri => cells[ri]);
    markers = markers.filter(m => remap[m.row] !== undefined)
      .map(m => ({ row: remap[m.row], col: m.col }));
  }

  return { empty: false, mode: byProject ? 'project' : 'engineer',
           weeks, labels, cells, markers, quarters, range: { from, to } };
}

function analysis(book, opts) {
  const rows = live(book);
  const from = (opts && opts.from) || todayLocal();
  // Projects are passed so the pipeline can name the client. Without them every
  // project lands under "(unknown)", which is what the first version of this did.
  const cap = A.computeCapacity(rows, book.engineers, book.projects, from);
  const st = A.stats(rows, book.engineers, from);

  // Everything starts at THIS WEEK. Past weeks cannot be acted on — you cannot hire
  // retroactively — and including them makes the series grow without limit as history
  // accumulates.
  const weeks = cap.weeks.filter(w => w.week_start >= from);
  const ahead = weeks.length ? weeks : cap.weeks;

  const overlaps = A.actualOverlaps_(rows);
  const weeksOf = list => {
    const seen = {};
    list.forEach(o => { seen[o.engineer + '|' + o.start] = 1; });
    return Object.keys(seen).length;
  };
  const deep = overlaps.filter(o => (o.depth || 2) > 2);
  const pair = overlaps.filter(o => (o.depth || 2) <= 2);

  // One row per overloaded engineer-week, naming what actually collides. A list of
  // booking rows says "4" where a person sees one problem.
  const byWeek = {};
  overlaps.forEach(o => {
    const k = o.engineer + '|' + o.start;
    (byWeek[k] = byWeek[k] || { engineer: o.engineer, start: o.start, work: [] })
      .work.push(`${o.project} (${o.phase})`);
  });
  const collisions = Object.values(byWeek)
    .map(c => ({ ...c, depth: c.work.length }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.engineer.localeCompare(b.engineer));

  return {
    today: from,
    horizon: cap.horizon,
    pools: cap.pools,
    weeks: ahead,
    score: A.scorePlan(rows, book.engineers),
    by_quarter: st.by_quarter,
    quarters: [...new Set(cap.weeks.map(w => w.quarter))].sort(),
    per_engineer: cap.weeks_per_engineer,
    pipeline: cap.pipeline,
    overlaps: {
      deep, pair,
      deep_weeks: weeksOf(deep), pair_weeks: weeksOf(pair),
      collisions,
      by_engineer: cap.bottleneck.forced_by_engineer,
    },
  };
}

// ---------------------------------------------------------------- the report
// What was delivered in a month, and by whom.
//
// Keyed on the COMPLETED date, not the deadline: a project can be delivered early or
// late, and the report is about the month the work was signed off in, not the month it
// was due. A project with no completed date has not been marked done and does not
// appear at all — the report never guesses.
function report(book, opts) {
  const month = (opts && opts.month) || todayLocal().slice(0, 7);
  const rows = live(book);

  // Every month that has something in it, so the picker only offers real answers.
  const months = [...new Set(book.projects
    .filter(p => p.status === 'Complete' && p.completed)
    .map(p => String(p.completed).slice(0, 7)))].sort().reverse();

  const done = book.projects.filter(p =>
    p.status === 'Complete' && String(p.completed || '').slice(0, 7) === month);

  const weeksOf = b => A.widx(b.end_date) - A.widx(b.start_date) + 1;
  const projects = done.map(p => {
    const mine = rows.filter(b => b.project === p.project_title);
    const who = phase => [...new Set(mine.filter(b => b.phase === phase)
      .map(b => b.engineer))].sort();
    const weeks = mine.reduce((n, b) => n + weeksOf(b), 0);
    return {
      title: p.project_title, client: p.client, deadline: p.deadline,
      completed: p.completed,
      // Delivered against the deadline, which is the number a producer actually wants.
      days_early: p.deadline
        ? Math.round((Date.parse(p.deadline + 'T00:00:00Z') -
                      Date.parse(p.completed + 'T00:00:00Z')) / 86400000) : null,
      phases: `${p.dub_weeks}/${p.edit_weeks}/${p.mix_weeks}`,
      dub: who('Dub'), edit: who('Edit'), mix: who('Mix'),
      weeks,
      music: /^yes$/i.test(String(p.music_songs || '')),
      special: /^yes$/i.test(String(p.special_project || '')),
      atmos: /^yes$/i.test(String(p.atmos_required || '')),
    };
  }).sort((a, b) => String(a.completed).localeCompare(String(b.completed)) ||
                    a.title.localeCompare(b.title));

  const tally = (key) => {
    const m = {};
    projects.forEach(p => {
      const names = Array.isArray(p[key]) ? p[key] : [p[key]];
      names.filter(Boolean).forEach(n => {
        m[n] = m[n] || { name: n, projects: 0, weeks: 0 };
        m[n].projects++;
      });
    });
    return Object.values(m).sort((a, b) => b.projects - a.projects || a.name.localeCompare(b.name));
  };

  // Engineer weeks are counted from the BOOKINGS, so a person who did two phases on
  // one project is credited for both — the tally above only counts projects touched.
  const byEngineer = {};
  done.forEach(p => {
    rows.filter(b => b.project === p.project_title).forEach(b => {
      const e = byEngineer[b.engineer] = byEngineer[b.engineer] ||
        { name: b.engineer, weeks: 0, projects: new Set(), phases: {} };
      e.weeks += weeksOf(b);
      e.projects.add(b.project);
      e.phases[b.phase] = (e.phases[b.phase] || 0) + weeksOf(b);
    });
  });

  const byClient = {};
  projects.forEach(p => {
    const c = byClient[p.client] = byClient[p.client] || { name: p.client, projects: 0, weeks: 0 };
    c.projects++; c.weeks += p.weeks;
  });

  return {
    month, months,
    projects,
    totals: {
      projects: projects.length,
      weeks: projects.reduce((n, p) => n + p.weeks, 0),
      on_or_before: projects.filter(p => p.days_early !== null && p.days_early >= 0).length,
      late: projects.filter(p => p.days_early !== null && p.days_early < 0).length,
    },
    by_client: Object.values(byClient).sort((a, b) => b.weeks - a.weeks),
    by_engineer: Object.values(byEngineer)
      .map(e => ({ ...e, projects: e.projects.size }))
      .sort((a, b) => b.weeks - a.weeks || a.name.localeCompare(b.name)),
  };
}

module.exports = { bootstrap, schedule, analysis, report, depths, projectDepth,
                   todayLocal, engine: A };
