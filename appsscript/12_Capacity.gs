// Capacity / bottleneck arithmetic for the analysis view.
//
// stats.js covers HANDOFF §7 analysis items 1, 6, 8 and 9. Item 10 — "how much
// would a re-plan improve things" — went out with re-plan itself (2026-08-13) and
// is deliberately unmet: with nothing to apply, the number had no action attached.
// This module adds the rest — 2, 3, 4, 5, 7 and 11 — including the two the
// handoff flags as "the ones with money attached":
//
//   item 3 — free capacity BY ROLE
//   item 4 — demand vs eligible supply per week, split by role
//
// Acceptance criterion 12: record/edit weeks and Advanced-mix weeks are
// different currencies. Nothing here ever sums them, and no total is exposed
// that would let a caller do it by accident.
//
// Acceptance criterion 11: every figure is a count of booking-row weeks, so it
// reconciles with the schedule grid cell-for-cell.


const yes = v => String(v).trim().toLowerCase() === 'yes';
const RECEDIT_PHASES = ['Dub', 'Edit', 'Dub+Edit'];

// ------------------------------------------------------------- role eligibility

// Who can take regular record/edit work: everyone who records and edits, less the
// overflow reserve. The specials engineer is included — does_specials routes special
// projects TO them, it does not hold them back from ordinary work. This has to match
// the engine's own pool or the Analysis supply line reports a capacity the scheduler
// does not believe it has.
function receditPool(engineerRows) {
  return engineerRows
    .filter(e => e && e.name && yes(e.can_record) && yes(e.can_edit) &&
                 !yes(e.overflow_only))
    .map(e => e.name);
}

// Baseline Advanced mix capacity — the reliable pool, excluding overflow.
function advMixPool(engineerRows) {
  return engineerRows
    .filter(e => e && e.name && yes(e.can_mix) &&
                 String(e.mix_level || '').trim() === 'Advanced' && !yes(e.overflow_only))
    .map(e => e.name);
}

// Advanced mixers including situational overflow cover.
function advMixPoolWithOverflow(engineerRows) {
  return engineerRows
    .filter(e => e && e.name && yes(e.can_mix) &&
                 String(e.mix_level || '').trim() === 'Advanced')
    .map(e => e.name);
}

function developingMixPool(engineerRows) {
  return engineerRows
    .filter(e => e && e.name && yes(e.can_mix) &&
                 String(e.mix_level || '').trim() === 'Developing')
    .map(e => e.name);
}

// ---------------------------------------------------------------- week series

// Per-week demand and eligible supply, split by role (items 2, 3, 4).
function weekSeries(bookingRows, engineerRows, opts) {
  const o = opts || {};
  const rows = bookingRows.filter(b => b && b.engineer && b.start_date && b.end_date);
  if (!rows.length) return { weeks: [], horizon: null };

  const recedit = receditPool(engineerRows);
  const advMix  = advMixPool(engineerRows);
  const advMixO = advMixPoolWithOverflow(engineerRows);
  const recSet = new Set(recedit), advSet = new Set(advMix);

  let minW = Infinity, maxW = -Infinity;
  // week -> { recProjects:Set, mixProjects:Set, busy:Set(engineer) }
  const byWeek = new Map();
  for (const b of rows) {
    for (const w of weeksOf(b)) {
      if (w < minW) minW = w;
      if (w > maxW) maxW = w;
      if (!byWeek.has(w)) byWeek.set(w, { recProjects: new Set(), mixProjects: new Set(), busy: new Set() });
      const cell = byWeek.get(w);
      cell.busy.add(b.engineer);
      if (RECEDIT_PHASES.includes(b.phase)) cell.recProjects.add(b.project);
      else if (b.phase === 'Mix') cell.mixProjects.add(b.project);
    }
  }

  const from = o.fromWeek != null ? o.fromWeek : minW;
  const to   = o.toWeek   != null ? o.toWeek   : maxW;

  const weeks = [];
  for (let w = from; w <= to; w++) {
    const cell = byWeek.get(w) || { recProjects: new Set(), mixProjects: new Set(), busy: new Set() };

    // engineers from each role pool who are already committed this week
    const recBooked = recedit.filter(n => cell.busy.has(n));
    const advBooked = advMix.filter(n => cell.busy.has(n));

    weeks.push({
      week: w,
      week_start: weekStart(w),
      label: weekLabel(w),
      quarter: quarterOf(w),

      // --- record/edit currency (never combined with mix) ---
      recedit_demand_projects: cell.recProjects.size,
      recedit_supply: recedit.length,
      recedit_booked: recBooked.length,
      recedit_free: recedit.length - recBooked.length,
      recedit_free_names: recedit.filter(n => !cell.busy.has(n)),
      recedit_over: Math.max(0, cell.recProjects.size - recedit.length),

      // --- Advanced-mix currency (never combined with record/edit) ---
      mix_demand_projects: cell.mixProjects.size,
      adv_mix_supply: advMix.length,
      adv_mix_supply_incl_overflow: advMixO.length,
      adv_mix_booked: advBooked.length,
      adv_mix_free: advMix.length - advBooked.length,
      adv_mix_free_names: advMix.filter(n => !cell.busy.has(n)),
      adv_mix_over: Math.max(0, cell.mixProjects.size - advMix.length),

      // --- roster-wide occupancy (item 2) ---
      roster_size: engineerRows.filter(e => e && e.name).length,
      roster_booked: cell.busy.size,
    });
  }
  return {
    weeks,
    horizon: { from: weekStart(from), to: weekStart(to), weeks: weeks.length },
    pools: {
      recedit, adv_mix: advMix, adv_mix_incl_overflow: advMixO,
      developing_mix: developingMixPool(engineerRows),
    },
  };
}

// ------------------------------------------------------------ free by quarter

// Item 3 as a per-quarter roll-up. Two separate currencies, never a total.
function freeCapacityByQuarter(series) {
  const q = {};
  for (const w of series.weeks) {
    if (!q[w.quarter]) q[w.quarter] = {
      quarter: w.quarter, weeks: 0,
      open_recedit_weeks: 0, open_adv_mix_weeks: 0,
      saturated_recedit_weeks: 0, saturated_adv_mix_weeks: 0,
      short_recedit_weeks: 0, short_adv_mix_weeks: 0,
    };
    const c = q[w.quarter];
    c.weeks++;
    c.open_recedit_weeks += w.recedit_free;      // engineer-weeks of record/edit
    c.open_adv_mix_weeks += w.adv_mix_free;      // engineer-weeks of Advanced mix
    if (w.recedit_free === 0) c.saturated_recedit_weeks++;
    if (w.adv_mix_free === 0) c.saturated_adv_mix_weeks++;
    // Distinct from the two above, and the distinction decides an action: FULL means
    // everyone able to do it was busy, which re-planning can fix. SHORT-HANDED means
    // more projects needed the role than there are people who can do it at all —
    // no arrangement covers that, only hiring or a later deadline. Measured on the
    // seeded book: 7 weeks full for record/edit but only 2 short-handed.
    if (w.recedit_over > 0) c.short_recedit_weeks++;
    if (w.adv_mix_over > 0) c.short_adv_mix_weeks++;
  }
  return Object.values(q).sort((a, b) => a.quarter.localeCompare(b.quarter));
}

// ------------------------------------------------------------ the bottleneck

// Every (project, phase, engineer, week) where that engineer holds two bookings at
// once — the real thing the FORCED note only claims to describe. One entry per
// colliding booking per week, so the Analysis list names both sides of a clash.
function actualOverlaps_(bookingRows) {
  var per = {};
  (bookingRows || []).forEach(function (b) {
    if (!b || !b.engineer || !b.start_date || !b.end_date) return;
    weeksOf(b).forEach(function (w) {
      var k = b.engineer + '|' + w;
      (per[k] = per[k] || []).push(b);
    });
  });
  var out = [];
  Object.keys(per).forEach(function (k) {
    if (per[k].length < 2) return;
    var w = Number(k.split('|')[1]);
    var depth = per[k].length;
    per[k].forEach(function (b) {
      out.push({ project: b.project, phase: b.phase, engineer: b.engineer,
                 start: weekStart(w), depth: depth });
    });
  });
  return out.sort(function (x, y) {
    return String(x.start).localeCompare(String(y.start)) ||
           String(x.project).localeCompare(String(y.project));
  });
}

// Item 4/5. Two directly countable answers, no inference:
//   forced_by_engineer      — who actually absorbs the forced overlaps
//   constrained_by_engineer — who is booked during weeks their role is saturated
function bottleneck(bookingRows, engineerRows, series) {
  const rows = bookingRows.filter(b => b && b.engineer);
  // who actually carries a doubled week, not who carries a stale note
  const forcedBy = {};
  for (const o of actualOverlaps_(rows)) {
    forcedBy[o.engineer] = (forcedBy[o.engineer] || 0) + 1;
  }

  const recedit = new Set(series.pools.recedit);
  const advMix  = new Set(series.pools.adv_mix);
  const busyByWeek = new Map();
  for (const b of rows) for (const w of weeksOf(b)) {
    if (!busyByWeek.has(w)) busyByWeek.set(w, new Set());
    busyByWeek.get(w).add(b.engineer);
  }

  const constrained = {};
  const bump = (n, role) => {
    if (!constrained[n]) constrained[n] = { engineer: n, recedit_weeks: 0, adv_mix_weeks: 0 };
    constrained[n][role]++;
  };
  for (const w of series.weeks) {
    const busy = busyByWeek.get(w.week) || new Set();
    if (w.recedit_free === 0) for (const n of recedit) if (busy.has(n)) bump(n, 'recedit_weeks');
    if (w.adv_mix_free === 0) for (const n of advMix)  if (busy.has(n)) bump(n, 'adv_mix_weeks');
  }

  // which role the saturation actually lands on — the hire/no-hire signal
  const recSaturated = series.weeks.filter(w => w.recedit_free === 0).length;
  const mixSaturated = series.weeks.filter(w => w.adv_mix_free === 0).length;
  const recOver = series.weeks.filter(w => w.recedit_over > 0);
  const mixOver = series.weeks.filter(w => w.adv_mix_over > 0);

  return {
    forced_by_engineer: Object.entries(forcedBy)
      .map(([engineer, rows]) => ({ engineer, forced_rows: rows }))
      .sort((a, b) => b.forced_rows - a.forced_rows),
    constrained_by_engineer: Object.values(constrained)
      .sort((a, b) => (b.recedit_weeks + b.adv_mix_weeks) - (a.recedit_weeks + a.adv_mix_weeks)),
    saturated_weeks: { recedit: recSaturated, adv_mix: mixSaturated },
    oversubscribed_weeks: {
      recedit: recOver.map(w => ({ label: w.label, over_by: w.recedit_over })),
      adv_mix: mixOver.map(w => ({ label: w.label, over_by: w.adv_mix_over })),
    },
  };
}

// ------------------------------------------------------- consecutive / streaks

// Item 7. Longest unbroken run of booked weeks, plus the run in progress today.
function streaks(bookingRows, engineerRows, todayISO) {
  const nowW = todayISO ? widx(todayISO) : null;
  const byEng = {};
  for (const e of engineerRows) if (e && e.name) byEng[e.name] = new Set();
  for (const b of bookingRows) {
    if (!b || !b.engineer || !byEng[b.engineer]) continue;
    for (const w of weeksOf(b)) byEng[b.engineer].add(w);
  }
  return Object.keys(byEng).map(n => {
    const ws = [...byEng[n]].sort((a, b) => a - b);
    let best = 0, run = 0, prev = null, bestEnd = null;
    for (const w of ws) {
      run = (prev !== null && w === prev + 1) ? run + 1 : 1;
      if (run > best) { best = run; bestEnd = w; }
      prev = w;
    }
    let current = 0;
    if (nowW !== null) {
      let w = nowW;
      while (byEng[n].has(w)) { current++; w--; }
    }
    return {
      engineer: n,
      weeks_booked: ws.length,
      longest_consecutive_weeks: best,
      longest_run_ended: bestEnd === null ? null : weekStart(bestEnd),
      current_consecutive_weeks: current,
    };
  }).sort((a, b) => b.longest_consecutive_weeks - a.longest_consecutive_weeks);
}

// --------------------------------------------------------------- pipeline

// Item 11. Bookings carry no client column, so this joins through Projects.
// Booked weeks per client — the one commercial view on the Analysis page.
//
// This also computed a median "how far ahead work is entered" from a submitted_at
// field. The card is gone, and submitted_at was never a column the tool writes, so
// the figure was almost always empty anyway (2026-08-13).
function pipeline(bookingRows, projectRows) {
  const clientOf = {};
  for (const p of projectRows || []) {
    if (!p || !p.project_title) continue;
    clientOf[p.project_title] = String(p.client || '').trim() || '(unknown)';
  }
  const byClient = {};
  for (const b of bookingRows) {
    if (!b || !b.engineer) continue;
    const c = clientOf[b.project] || '(unknown)';
    if (!byClient[c]) byClient[c] = { client: c, weeks: 0, projects: new Set() };
    byClient[c].weeks += weeksOf(b).length;
    byClient[c].projects.add(b.project);
  }

  return {
    by_client: Object.values(byClient)
      .map(c => ({ client: c.client, weeks: c.weeks, projects: c.projects.size }))
      .sort((a, b) => b.weeks - a.weeks),
  };
}

// ------------------------------------------------------------------ per engineer

// Reconciliation handle for criterion 11: distinct booked weeks per engineer,
// which must equal the engineer's cell count in the schedule grid.
function weeksPerEngineer(bookingRows, engineerRows) {
  const byEng = {};
  for (const e of engineerRows) if (e && e.name) byEng[e.name] = new Set();
  for (const b of bookingRows) {
    if (!b || !b.engineer) continue;
    if (!byEng[b.engineer]) byEng[b.engineer] = new Set();
    for (const w of weeksOf(b)) byEng[b.engineer].add(w);
  }
  const out = {};
  for (const n of Object.keys(byEng)) out[n] = byEng[n].size;
  return out;
}

// ------------------------------------------------------------------- assemble

function computeCapacity(bookingRows, engineerRows, projectRows, todayISO) {
  const rows = (bookingRows || []).filter(b => b && b.engineer && b.start_date && b.end_date);
  const series = weekSeries(rows, engineerRows);
  if (!series.weeks.length) return { horizon: null, note: 'No bookings recorded yet.' };
  return {
    horizon: series.horizon,
    pools: series.pools,
    weeks: series.weeks,
    free_by_quarter: freeCapacityByQuarter(series),
    bottleneck: bottleneck(rows, engineerRows, series),
    streaks: streaks(rows, engineerRows, todayISO),
    pipeline: pipeline(rows, projectRows),
    weeks_per_engineer: weeksPerEngineer(rows, engineerRows),
  };
}
