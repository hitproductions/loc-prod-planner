// Wrapper layer. Sits between the sheet and engine/*.js.
//
// HANDOFF §5 says port the engine as-is, so the defects recorded in
// HANDOFF_ADDENDUM §1 are corrected HERE, not in the engine files:
//
//   Fix A — a second re-plan re-emits already-locked rows, duplicating the book.
//   Fix B — blank mix_level_required sends the two engines to opposite mixer pools.
//   Fix C — forced_before / forced_after are not the same unit.
//   Fix D — a project kept by re-plan but still movable loses its rows entirely.
//
// Re-plan was removed on 2026-08-13 and restored the same day: incremental
// plotting has no way to re-solve an assignment that was right when it was made
// and is stale now, and manual picks only fix the instance you happen to spot.
// Recovered from script version 4 rather than rewritten, so fixes A, C and D are
// the originals — D is data-losing and was not something to reconstruct from a
// description.
//
// It also enforces two things the engine leaves to the caller:
//   - superseded rows are never read as live (acceptance criterion 9)
//   - the book is validated on read, and fails loudly (HANDOFF §8)


const PHASES  = ['Dub', 'Edit', 'Mix', 'Dub+Edit'];
const LEVELS  = ['Advanced', 'Developing'];

// ---------------------------------------------------------------- active rows

// Acceptance criterion 9: superseded rows are history. Never live, never deleted.
function activeRows(bookingRows) {
  return (bookingRows || []).filter(b =>
    b && String(b.status || '').trim().toLowerCase() !== 'superseded');
}

// ------------------------------------------------------------ normalise entry

// Accepts phases in one cell as "3/1/2" (HANDOFF §7) or as three columns.
function parsePhases(raw) {
  const parts = String(raw).split('/').map(s => s.trim());
  if (parts.length !== 3) return null;
  const nums = parts.map(s => (/^\d+$/.test(s) ? parseInt(s, 10) : NaN));
  return nums.some(n => !Number.isFinite(n)) ? null : nums;
}

function intOrNull(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return 0;                       // blank phase = 0 weeks (rule 1)
  if (!/^\d+$/.test(s)) return null;            // anything else is an error
  return parseInt(s, 10);
}

// Returns { project, errors[] }. Errors are strings destined for the row's
// error cell — never a popup (HANDOFF §7).
function normalizeProject(raw) {
  const errors = [];
  const p = { ...raw };

  p.project_title = String(p.project_title || '').trim();
  if (!p.project_title) errors.push('Project title is required.');

  // deadline
  const dl = String(p.deadline || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dl) || Number.isNaN(Date.parse(dl + 'T00:00:00Z'))) {
    errors.push('Deadline must be a valid date.');
  } else {
    p.deadline = dl;
  }

  // phases: single "3/1/2" cell wins if present
  let phasesParsed = false;
  if (p.phases != null && String(p.phases).trim() !== '') {
    const parsed = parsePhases(p.phases);
    if (!parsed) errors.push('Phases must read like 3/1/2 (dub/edit/mix, whole weeks).');
    else { [p.dub_weeks, p.edit_weeks, p.mix_weeks] = parsed; phasesParsed = true; }
  } else {
    const d = intOrNull(p.dub_weeks), e = intOrNull(p.edit_weeks), m = intOrNull(p.mix_weeks);
    if (d === null || e === null || m === null) {
      errors.push('Dub, Edit and Mix weeks must be whole numbers (0 is valid).');
    } else { p.dub_weeks = d; p.edit_weeks = e; p.mix_weeks = m; phasesParsed = true; }
  }
  // Reported independently of the checks above, so every problem with the row
  // surfaces on the first attempt rather than one per round trip.
  if (phasesParsed && !(p.dub_weeks + p.edit_weeks + p.mix_weeks > 0)) {
    errors.push('At least one phase must have weeks.');
  }

  // defaults that do most of the typing (HANDOFF §7)
  p.client = String(p.client || '').trim() || 'Netflix';
  p.music_songs = /^yes$/i.test(String(p.music_songs || '').trim()) ? 'Yes' : 'No';
  p.special_project = /^yes$/i.test(String(p.special_project || '').trim()) ? 'Yes' : 'No';
  // Atmos is its own flag, not a shade of Special. Special means the work routes to the
  // specials engineer; Atmos means the mix needs the room. A title can be either, both
  // or neither, which one checkbox could not express.
  p.atmos_required = /^yes$/i.test(String(p.atmos_required || '').trim()) ? 'Yes' : 'No';

  // FIX B — never let a blank mix level reach the engine. assign.js tests
  // `=== 'Advanced'` on a blank value, which is not the documented default and
  // silently routes the project to the wrong mixer pool.
  const lvl = String(p.mix_level_required || '').trim();
  if (lvl === '') {
    p.mix_level_required = 'Advanced';          // the documented default
  } else if (!LEVELS.includes(lvl)) {
    errors.push(`Mix level must be ${LEVELS.join(' or ')}.`);
  } else {
    p.mix_level_required = lvl;
  }

  // manual picks (rule 11). Columns missing from HANDOFF §4 — see addendum §3.
  p.recordist_override = String(p.recordist_override || '').trim() || 'Auto';
  p.recordist_override_2 = String(p.recordist_override_2 || '').trim() || 'Auto';
  p.editor_override    = String(p.editor_override || '').trim() || 'Auto';
  p.mixer_override     = String(p.mixer_override || '').trim() || 'Auto';

  return { project: p, errors };
}

// ------------------------------------------------------------------ validate

// HANDOFF §8: a sheet invites tampering. Fail loudly rather than schedule from
// a corrupted book.
function validateBook(bookingRows, engineerRows) {
  const problems = [];
  const roster = new Set((engineerRows || []).filter(e => e && e.name).map(e => e.name));
  activeRows(bookingRows).forEach((b, i) => {
    const at = `booking row ${b.row_number || i + 1}`;
    if (!b.project)  problems.push(`${at}: missing project.`);
    if (!b.engineer) problems.push(`${at}: missing engineer.`);
    else if (roster.size && !roster.has(b.engineer))
      problems.push(`${at}: engineer "${b.engineer}" is not on the roster.`);
    if (!PHASES.includes(b.phase)) problems.push(`${at}: phase "${b.phase}" is not one of ${PHASES.join('/')}.`);
    const s = String(b.start_date || '').slice(0, 10), e = String(b.end_date || '').slice(0, 10);
    if (Number.isNaN(Date.parse(s + 'T00:00:00Z'))) problems.push(`${at}: bad start_date "${b.start_date}".`);
    else if (Number.isNaN(Date.parse(e + 'T00:00:00Z'))) problems.push(`${at}: bad end_date "${b.end_date}".`);
    else {
      if (widx(s) > widx(e)) problems.push(`${at}: start_date is after end_date.`);
      if (weekStart(widx(s)) !== s) problems.push(`${at}: start_date ${s} is not a Monday week boundary.`);
      if (weekEnd(widx(e)) !== e)   problems.push(`${at}: end_date ${e} is not a Sunday week boundary.`);
    }
  });
  return problems;
}

function assertValidBook(bookingRows, engineerRows) {
  const problems = validateBook(bookingRows, engineerRows);
  if (problems.length) {
    throw new Error('Bookings sheet failed validation — refusing to schedule:\n  ' +
      problems.slice(0, 20).join('\n  ') +
      (problems.length > 20 ? `\n  ...and ${problems.length - 20} more.` : ''));
  }
}

// ---------------------------------------------------------------------- plot

// One project. Returns { ok, errors, result }.
function plot(rawProject, bookingRows, engineerRows) {
  const { project, errors } = normalizeProject(rawProject);
  if (errors.length) return { ok: false, errors, result: null };
  const active = activeRows(bookingRows);
  return { ok: true, errors: [], result: runAssign(project, active, engineerRows) };
}

// ------------------------------------------------------------- order search

// Who actually competes for regular record/edit work, and who is the reserve.
// The reserve exists to absorb overflow; loading it to parity with everyone else
// spends the thing it is for. See SOLVE_OBJECTIVE.
function engineerRoles(engineerRows) {
  const yes = v => String(v).trim().toLowerCase() === 'yes';
  const regular = [], reserve = [];
  for (const e of (engineerRows || [])) {
    if (!e || !e.name) continue;
    if (yes(e.overflow_only)) reserve.push(e.name);
    else if (!yes(e.does_specials) && yes(e.can_record) && yes(e.can_edit)) regular.push(e.name);
  }
  return { regular, reserve };
}

// Every figure here counts distinct booked weeks, so it reconciles with the grid.
function scorePlan(book, engineerRows) {
  const { regular, reserve } = engineerRoles(engineerRows);
  const weeks = {};
  for (const b of book) {
    if (!b || !b.engineer || !b.start_date || !b.end_date) continue;
    if (!weeks[b.engineer]) weeks[b.engineer] = {};
    for (const w of weeksOf(b)) weeks[b.engineer][w] = (weeks[b.engineer][w] || 0) + 1;
  }
  const load = n => Object.keys(weeks[n] || {}).length;
  const dbl  = n => Object.keys(weeks[n] || {}).filter(w => weeks[n][w] > 1).length;

  // Projects with at least one booking sitting in an overlapped engineer-week.
  //
  // This used to count the FORCED note instead, and the note records what the engine
  // decided AT THE MOMENT IT DECIDED IT. A project placed cleanly and then overlapped
  // by somebody else's later placement never gets a note, so the term under-reported
  // badly: on the live book it read 1 when four projects were genuinely compromised.
  // A term that wrong is not a tiebreaker, it is noise.
  //
  // Counted from the weeks, like every other overlap figure in both apps. The intent
  // is unchanged and worth keeping: four messy projects are worse than one messy
  // project, which is a preference neither total_double_booked nor max_double_booked
  // can express.
  const compromised = {};
  for (const b of book) {
    if (!b || !b.engineer || !b.project || !b.start_date || !b.end_date) continue;
    for (const w of weeksOf(b)) {
      if ((weeks[b.engineer] || {})[w] > 1) { compromised[b.project] = 1; break; }
    }
  }

  const regLoads = regular.map(load);
  const mean = regLoads.length ? regLoads.reduce((a, b) => a + b, 0) / regLoads.length : 0;
  const sd = regLoads.length
    ? Math.sqrt(regLoads.reduce((a, b) => a + (b - mean) * (b - mean), 0) / regLoads.length) : 0;

  // Longest unbroken run of booked weeks — the burnout signal (HANDOFF §7 item 7).
  const longestRun = n => {
    const ws = Object.keys(weeks[n] || {}).map(Number).sort((a, b) => a - b);
    let best = 0, cur = 0, prev = null;
    for (const w of ws) { cur = (prev !== null && w === prev + 1) ? cur + 1 : 1;
      if (cur > best) best = cur; prev = w; }
    return best;
  };

  const everyone = Object.keys(weeks);
  const dblEach = everyone.map(dbl);

  return {
    reserve_double_booked: reserve.reduce((a, n) => a + dbl(n), 0),
    forced_projects: Object.keys(compromised).length,

    // How unevenly the overlap burden lands. Without this the search happily
    // halves total double-booking by piling all of it onto one person.
    max_double_booked: dblEach.length ? Math.max.apply(null, dblEach) : 0,
    total_double_booked: dblEach.reduce((a, b) => a + b, 0),

    regular_spread: regLoads.length ? Math.max.apply(null, regLoads) - Math.min.apply(null, regLoads) : 0,
    reserve_weeks: reserve.reduce((a, n) => a + load(n), 0),
    regular_peak: regLoads.length ? Math.max.apply(null, regLoads) : 0,
    regular_sd: Math.round(sd * 100) / 100,

    // Nobody should be on an unbroken run forever, whatever the totals say.
    max_consecutive: everyone.length ? Math.max.apply(null, everyone.map(longestRun)) : 0,

    loads: everyone.sort().map(n => ({
      engineer: n, weeks: load(n), double_booked: dbl(n), longest_run: longestRun(n),
    })),
  };
}

function planIsBetter(a, b, objective) {
  if (!b) return true;
  const keys = objective && objective.length ? objective : ['forced_projects', 'regular_spread'];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (a[k] !== b[k]) return a[k] < b[k];
  }
  return false;
}

// Deterministic PRNG — a fixed seed means the same inputs give the same plan.
function seededRandom(seed) {
  let s = seed % 2147483648;
  return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

function totalWeeksOf(p) {
  const n = v => { const x = parseInt(v, 10); return Number.isFinite(x) && x > 0 ? x : 0; };
  return n(p.dub_weeks) + n(p.edit_weeks) + n(p.mix_weeks);
}

// Replays one ordering against the existing book. Returns just the new rows.
function replayOrder(order, baseBook, engineerRows) {
  let book = baseBook.slice();
  const outs = [];
  for (const p of order) {
    const out = runAssign(p, book, engineerRows);
    book = book.concat(out.booking_rows);
    outs.push(out);
  }
  return { outs, new_rows: book.slice(baseBook.length) };
}

// Tries deadline order, largest-first, then seeded shuffles; keeps the best plan
// by SOLVE_OBJECTIVE. Deadline order is the baseline and is only replaced by
// something strictly better, so this can never produce a worse plan than before.
function solveOrder(projects, baseBook, engineerRows, opts) {
  const o = opts || {};
  const restarts = o.restarts !== undefined ? o.restarts
    : ((typeof SOLVE_RESTARTS === 'number') ? SOLVE_RESTARTS : 0);
  const objective = o.objective || ((typeof SOLVE_OBJECTIVE !== 'undefined') ? SOLVE_OBJECTIVE : null);
  const seed = o.seed !== undefined ? o.seed
    : ((typeof SOLVE_SEED === 'number') ? SOLVE_SEED : 1);

  const byDeadline = projects.slice()
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
  const candidates = [byDeadline];
  if (restarts > 0 && projects.length > 1) {
    candidates.push(projects.slice().sort((a, b) =>
      totalWeeksOf(b) - totalWeeksOf(a) || String(a.deadline).localeCompare(String(b.deadline))));
    const rnd = seededRandom(seed);
    for (let i = 0; i < restarts; i++) {
      const a = projects.slice();
      for (let j = a.length - 1; j > 0; j--) {
        const k = Math.floor(rnd() * (j + 1));
        const t = a[j]; a[j] = a[k]; a[k] = t;
      }
      candidates.push(a);
    }
  }

  let best = null, baseline = null, tried = 0;
  for (const order of candidates) {
    const played = replayOrder(order, baseBook, engineerRows);
    const score = scorePlan(baseBook.concat(played.new_rows), engineerRows);
    tried++;
    if (!baseline) baseline = score;
    if (planIsBetter(score, best ? best.score : null, objective)) {
      best = { order, score, played };
    }
  }

  // ---- decide dub division per project, by outcome -------------------------
  // Dividing a project's dub is never done because it is possible. Each project
  // is tried both ways against the FINISHED plan, and division is kept only where
  // it measures better on SOLVE_OBJECTIVE. Dividing everywhere is worse — more
  // small pieces fragment each engineer's calendar and lengthen unbroken runs —
  // so which projects benefit is a question only measurement answers.
  //
  // Deterministic: projects are visited in the winning order, one pass, and a flip
  // is kept only on a strict improvement.
  const divided = [];
  let flips = 0;
  if (o.tuneDivision !== false) {
    let order = best.order.map(p => Object.assign({}, p));
    for (let i = 0; i < order.length; i++) {
      const trial = order.map((p, j) => (j === i
        ? Object.assign({}, p, { divide_dub: !p.divide_dub })
        : p));
      const played = replayOrder(trial, baseBook, engineerRows);
      const score = scorePlan(baseBook.concat(played.new_rows), engineerRows);
      tried++;
      if (planIsBetter(score, best.score, objective)) {
        order = trial;
        best = { order: trial, score, played };
        flips++;
      }
    }
    order.forEach(p => { if (p.divide_dub) divided.push(p.project_title); });
  }

  // The improvement passes deliberately do NOT run here — see replanOnce. Measured
  // across seven incremental sequences: gains found while plotting one batch were
  // reshuffled by the next and the net came out worse. Restricting them to a
  // from-scratch plot did not help either, because the FIRST batch of a sequence is
  // also from scratch and its changes cascade into every batch after it. Only a
  // re-plan is genuinely terminal.
  return {
    order: best.order, score: best.score, played: best.played,
    baseline, candidates_tried: tried,
    improved: planIsBetter(best.score, baseline, objective),
    division_flips: flips,
    divided_projects: divided,
  };
}


// ---------------------------------------------------------------- swap pass

// Can this engineer take this booking at all? These are the ENGINE's hard rules,
// restated here because the swap pass proposes reassignments the engine never
// considered and must not propose an illegal one. Kept deliberately strict: where
// the engine has a fallback ladder (overflow, forced), this returns false, so a swap
// can only ever move work to someone plainly entitled to it.
function swapEligible_(e, phase, proj) {
  if (!e) return false;
  const yes = v => String(v).trim().toLowerCase() === 'yes';
  const rank = v => yes(v) ? 1 : (parseInt(v, 10) > 0 ? parseInt(v, 10) : 0);
  const isSpecial = yes(proj.special_project);
  const isMusic = yes(proj.music_songs);

  if (isMusic && !rank(e.music_specialist)) return false;   // music never leaves the pool
  if (yes(e.overflow_only) && !isMusic) return false;       // the reserve is a cost, not a target

  if (phase === 'Mix') {
    if (!yes(e.can_mix)) return false;
    if (String(proj.mix_level_required).trim() === 'Advanced' &&
        String(e.mix_level).trim() !== 'Advanced') return false;
    return true;
  }
  if (phase === 'Dub'  && !yes(e.can_record)) return false;
  if (phase === 'Edit' && !yes(e.can_edit)) return false;
  // record/edit routing: special work to the specials engineer, everything else away
  return isSpecial ? yes(e.does_specials) : !yes(e.does_specials);
}

// What the greedy pass cannot see.
//
// The engine assigns one project at a time and never revisits, so it cannot reason
// "if I had given that other mix to Kyle, Josiah would be free for this dub now."
// The ordering search only permutes the ORDER projects are considered; it never
// tries a targeted exchange. Tara kept finding arrangements by eye that scored the
// same or better and the solver had no way to reach — Animals against Ray Gunn was
// one, a three-project chain around Fight for '84 was another.
//
// So: after a plan is chosen, try moving each booking to another eligible engineer,
// and try exchanging pairs of bookings. Keep a change only when the finished plan
// measures STRICTLY better on SOLVE_OBJECTIVE. It can therefore never make the plan
// worse — the worst case is that it finds nothing and costs a little time.
//
// Only rows from THIS solve are touched. Anything already on the books, locked, or
// hand-placed is read as fixed and simply constrains what is possible.
function improveBySwaps_(rows, baseBook, engineerRows, projectRows, objective, opts) {
  const passes = (opts && opts.swapPasses !== undefined) ? opts.swapPasses : 2;
  if (passes <= 0 || !rows.length) return { rows, swaps: 0 };

  const eng = {}; (engineerRows || []).forEach(e => { if (e && e.name) eng[e.name] = e; });
  const names = Object.keys(eng);
  const P = {}; (projectRows || []).forEach(p => { if (p && p.project_title) P[p.project_title] = p; });

  let best = rows.map(r => ({ ...r }));
  let bestScore = scorePlan(baseBook.concat(best), engineerRows);
  let swaps = 0;

  // weeks each engineer holds, counting the fixed base book plus the current trial
  const occupancy = trial => {
    const occ = {};
    baseBook.concat(trial).forEach(b => {
      if (!b || !b.engineer || !b.start_date || !b.end_date) return;
      for (const w of weeksOf(b)) (occ[b.engineer] = occ[b.engineer] || {})[w] = (occ[b.engineer][w] || 0) + 1;
    });
    return occ;
  };
  const freeFor = (occ, name, row, ignore) => {
    const o = occ[name] || {};
    for (const w of weeksOf(row)) {
      let n = o[w] || 0;
      if (ignore && ignore.engineer === name && weeksOf(ignore).indexOf(w) !== -1) n--;
      if (n > 0) return false;
    }
    return true;
  };
  const take = trial => {
    const sc = scorePlan(baseBook.concat(trial), engineerRows);
    if (!planIsBetter(sc, bestScore, objective)) return false;
    best = trial; bestScore = sc; swaps++; return true;
  };

  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < best.length; i++) {
      const a = best[i], pa = P[a.project];
      if (!pa || /manual/i.test(a.note || '')) continue;
      const occ = occupancy(best);

      // 1. plain move — someone eligible and completely free for the run
      for (const n of names) {
        if (n === a.engineer || !swapEligible_(eng[n], a.phase, pa)) continue;
        if (!freeFor(occ, n, a)) continue;
        const trial = best.map((r, k) => k === i ? { ...r, engineer: n } : r);
        if (take(trial)) { moved = true; break; }
      }
      if (moved) break;

      // 2. exchange — each takes the other's run. This is the case the greedy pass
      // structurally cannot reach: it needs two projects to change at once.
      for (let j = i + 1; j < best.length; j++) {
        const b = best[j], pb = P[b.project];
        if (!pb || b.engineer === a.engineer || /manual/i.test(b.note || '')) continue;
        if (!swapEligible_(eng[b.engineer], a.phase, pa)) continue;
        if (!swapEligible_(eng[a.engineer], b.phase, pb)) continue;
        if (!freeFor(occ, b.engineer, a, b) || !freeFor(occ, a.engineer, b, a)) continue;
        const trial = best.map((r, k) =>
          k === i ? { ...r, engineer: b.engineer } : (k === j ? { ...r, engineer: a.engineer } : r));
        if (take(trial)) { moved = true; break; }
      }
      if (moved) break;
    }
    if (!moved) break;                       // settled
  }
  return { rows: best, swaps };
}



// Contiguous runs of a week set, so every booking row stays an unbroken block.
function runsOfWeeks_(wks) {
  const ws = wks.slice().sort((a, b) => a - b), out = [];
  for (const w of ws) {
    const last = out[out.length - 1];
    if (last && w === last[last.length - 1] + 1) last.push(w); else out.push([w]);
  }
  return out;
}

// DIVIDE A DUB ON RE-PLAN, WHERE IT MEASURES BETTER.
//
// The plot engine divides dubs; re-plan never did. Its tryShare looks for the
// SMALLEST covering set, which is one dubber plus one editor by construction, so a
// re-plan quietly collapsed every divided dub the plot had found — and dividing a
// dub is the cheap alternative to double-booking someone, so collapsing them pushed
// the book toward forced overlaps.
//
// Rather than port spreadDub into the second engine, this works on re-plan's OUTPUT:
// take each dub sitting on one pair of hands, try handing part of it to someone else,
// and keep the change only when the finished book measures strictly better. That is
// exactly "split it if it makes the book better", and it cannot make anything worse.
//
// Only the DUB is ever divided — editing stays whole and mixing is never split.
// SHARE_CAP still bounds how many engineers may touch one dub.
function divideDubsIfBetter_(rows, fixedBook, engineerRows, projectRows, objective) {
  if (!rows.length) return { rows, divided: 0 };
  const cap = (typeof SHARE_CAP === 'number' && SHARE_CAP > 0) ? SHARE_CAP : 99;
  if (cap < 2) return { rows, divided: 0 };

  const eng = {}; (engineerRows || []).forEach(e => { if (e && e.name) eng[e.name] = e; });
  const names = Object.keys(eng).sort();
  const P = {}; (projectRows || []).forEach(x => { if (x && x.project_title) P[x.project_title] = x; });

  let best = rows.map(r => ({ ...r }));
  let bestScore = scorePlan(fixedBook.concat(best), engineerRows);
  let divided = 0;

  const occupancy = trial => {
    const occ = {};
    fixedBook.concat(trial).forEach(b => {
      if (!b || !b.engineer || !b.start_date || !b.end_date) return;
      for (const w of weeksOf(b)) (occ[b.engineer] = occ[b.engineer] || {})[w] = 1;
    });
    return occ;
  };

  for (let guard = 0; guard < 12; guard++) {
    // every project whose dub is currently held by exactly one engineer
    const byProject = {};
    best.forEach((b, i) => {
      if (b.phase !== 'Dub' || /manual/i.test(b.note || '')) return;
      (byProject[b.project] = byProject[b.project] || []).push(i);
    });
    let improved = false;

    for (const title of Object.keys(byProject).sort()) {
      const idxs = byProject[title];
      const holders = {}; idxs.forEach(i => { holders[best[i].engineer] = 1; });
      if (Object.keys(holders).length !== 1) continue;      // already shared
      const owner = Object.keys(holders)[0];
      const proj = P[title];
      if (!proj) continue;
      const weeks = [];
      idxs.forEach(i => weeksOf(best[i]).forEach(w => weeks.push(w)));
      if (weeks.length < 2) continue;                       // nothing to divide
      weeks.sort((a, b) => a - b);
      const occ = occupancy(best);

      for (const y of names) {
        if (y === owner || !swapEligible_(eng[y], 'Dub', proj)) continue;
        const yFree = weeks.filter(w => !((occ[y] || {})[w]));
        if (!yFree.length || yFree.length === weeks.length) continue;  // nothing, or a whole move

        for (const run of runsOfWeeks_(yFree)) {
          const away = {}; run.forEach(w => { away[w] = 1; });
          const keep = weeks.filter(w => !away[w]);
          if (!keep.length) continue;
          const trial = best.filter((b, i) => idxs.indexOf(i) === -1);
          const shape = w => ({ project: title, phase: 'Dub', source: 'replan', note: '', status: '' , ...w});
          runsOfWeeks_(keep).forEach(r2 => trial.push(shape({ engineer: owner,
            start_date: weekStart(r2[0]), end_date: weekEnd(r2[r2.length - 1]) })));
          runsOfWeeks_(run).forEach(r2 => trial.push(shape({ engineer: y,
            start_date: weekStart(r2[0]), end_date: weekEnd(r2[r2.length - 1]) })));
          const sc = scorePlan(fixedBook.concat(trial), engineerRows);
          if (planIsBetter(sc, bestScore, objective)) {
            best = trial; bestScore = sc; divided++; improved = true; break;
          }
        }
        if (improved) break;
      }
      if (improved) break;
    }
    if (!improved) break;
  }
  return { rows: best, divided };
}

// Batch entry (HANDOFF §7, acceptance criterion 10). Projects are assigned in
// whichever order solves best; the phase windows themselves always come from
// each project's own deadline, so no date depends on the ordering.
function plotBatch(rawProjects, bookingRows, engineerRows, opts) {
  const normalized = (rawProjects || []).map(r => ({ raw: r, ...normalizeProject(r) }));
  const ok  = normalized.filter(n => !n.errors.length);
  const bad = normalized.filter(n => n.errors.length);

  const baseBook = activeRows(bookingRows).slice();
  const solved = solveOrder(ok.map(n => n.project), baseBook, engineerRows, opts);

  const results = solved.order.map((project, i) => ({
    project, result: solved.played.outs[i], errors: [],
  }));
  for (const n of bad) results.push({ project: n.project, result: null, errors: n.errors });

  return {
    results,
    new_rows: solved.played.new_rows,
    solve: {
      candidates_tried: solved.candidates_tried,
      improved: solved.improved,
      score: solved.score,
      baseline: solved.baseline,
      division_flips: solved.division_flips,
      divided_projects: solved.divided_projects || [],
    },
  };
}

// -------------------------------------------------------------------- replan

const isForced = b => /FORCED/i.test((b && b.note) || '');

// One re-plan pass in a given project order. All four fixes are applied here.
function replanOnce(projectRows, bookingRows, engineerRows, todayISO, keepOrder) {
  const active = activeRows(bookingRows);
  const r = replan(projectRows, active, engineerRows, todayISO,
                   keepOrder ? { keepOrder: true } : undefined);

  // Recompute the lock split exactly as replan.js does, so the fixes below key
  // off the same set of rows the engine used.
  const nowW = widx(todayISO);
  const frozen = new Set((projectRows || [])
    .filter(p => p && (p.locked === true || /^(yes|true)$/i.test(String(p.locked || ''))))
    .map(p => p.project_title));
  const isLocked = b => frozen.has(b.project) ||
    widx(b.start_date) <= nowW || /manual/i.test(b.note || '');
  const locked = active.filter(isLocked);
  const movable = active.filter(b => !isLocked(b));
  const lockedKeys = new Set(locked.map(b => `${b.project}||${b.phase}`));

  // Only LOCKED rows survive an apply. Movable rows are all superseded, so a
  // proposed row that merely matches a movable row must still be appended —
  // otherwise superseding the original with no replacement deletes it from the
  // live book. Signature matching therefore keys off locked rows only.
  const lockedSig = new Set(locked.map(b =>
    `${b.project}||${b.phase}||${b.engineer}||${b.start_date}||${b.end_date}`));

  // FIX A — replan re-emits a locked row carrying source 'replan' (which is
  // what a previously-applied re-plan wrote). Such a row is locked, so it is
  // never superseded, yet it comes back in proposed_rows to be appended. Apply
  // twice and the project has double the rows.
  const dropped = [];
  let rows_to_append = (r.proposed_rows || []).filter(b => {
    const key = `${b.project}||${b.phase}`;
    const sig = `${b.project}||${b.phase}||${b.engineer}||${b.start_date}||${b.end_date}`;
    if (lockedKeys.has(key) || lockedSig.has(sig)) { dropped.push(b); return false; }
    return true;
  });

  // FIX D — replan keeps a project's ENTIRE record/edit block when either phase
  // is locked, re-emitting those rows with their original `source`. But
  // proposed_rows only returns source==='replan' rows while
  // superseded_row_numbers returns every movable row — so a kept row that is
  // also movable gets superseded with nothing appended to replace it, and
  // disappears from the live book. On the seeded data at 2026-08-12 that silently
  // dropped 7 rows across 5 projects.
  //
  // Recompute which rows replan decided to keep, using the same rule it uses,
  // and leave them alone.
  const lockedPhases = {};
  locked.forEach(b => {
    if (!lockedPhases[b.project]) lockedPhases[b.project] = {};
    lockedPhases[b.project][b.phase] = true;
  });
  const keepsRecedit = t => {
    const s = lockedPhases[t];
    return !!s && (s['Dub'] || s['Edit'] || s['Dub+Edit']);
  };
  const keepsMix = t => !!(lockedPhases[t] && lockedPhases[t]['Mix']);
  const isReceditPhase = ph => ph === 'Dub' || ph === 'Edit' || ph === 'Dub+Edit';

  const kept = [];
  const rows_to_supersede = movable.filter(b => {
    if (isReceditPhase(b.phase) && keepsRecedit(b.project)) { kept.push(b); return false; }
    if (b.phase === 'Mix' && keepsMix(b.project)) { kept.push(b); return false; }
    return true;
  }).map(b => b.row_number).filter(Boolean);

  // FIX C — count both sides in the same unit: booking rows in the book.
  // THE SWAP PASS BELONGS HERE, and only here.
  //
  // It looks for exchanges the greedy engine structurally cannot reach — it assigns
  // one project at a time and never revisits, so it cannot see "if that other mix had
  // gone to Kyle, Josiah would be free for this dub now". Tara kept finding those by
  // eye; this finds them by trying.
  //
  // Applied to every PLOT batch it was worthless: each batch's gain got reshuffled by
  // the next, and across six incremental sequences it came out a wash. A re-plan is
  // TERMINAL — nothing runs after it to disturb what it found — and there it improved
  // all eight configurations tried and worsened none. Same mechanism, and the whole
  // difference is whether anything happens next.
  //
  // Strictly-better only, scored on the book an apply would actually produce.
  let swapCount = 0, dubSplits = 0;
  if (rows_to_append.length) {
    const obj = (typeof SOLVE_OBJECTIVE !== 'undefined') ? SOLVE_OBJECTIVE : null;
    const fixedBook = kept.concat(locked);
    const imp = improveBySwaps_(rows_to_append, fixedBook, engineerRows, projectRows, obj, {});
    if (imp.swaps) { rows_to_append = imp.rows; swapCount = imp.swaps; }
    const dv = divideDubsIfBetter_(rows_to_append, fixedBook, engineerRows, projectRows, obj);
    if (dv.divided) { rows_to_append = dv.rows; dubSplits = dv.divided; }
  }

  // The engine's forced_after counts only NEW overlaps, so a forced row that is
  // also locked silently vanishes from the "after" figure and the feature
  // reports conflicts eliminated when nothing moved.
  const forced_before_rows = active.filter(isForced).length;
  const forced_locked_rows = locked.filter(isForced).length;
  const forced_new_rows    = rows_to_append.filter(isForced).length;

  // Count what an apply ACTUALLY leaves behind: every row that is not superseded,
  // plus everything appended. It used to be locked + new, which silently dropped the
  // KEPT rows — movable rows re-proposed unchanged and therefore never superseded.
  // On a full book two forced Grown Ups rows sat in that gap, so the preview promised
  // 3 forced rows and an apply produced 4. A preview that flatters the outcome is
  // worse than no preview.
  const supersededSet = {};
  rows_to_supersede.forEach(n => { supersededSet[n] = true; });
  const survives = active.filter(b => !supersededSet[b.row_number]);
  const forced_after_rows = survives.filter(isForced).length + forced_new_rows;
  const forced_kept_rows = survives.filter(isForced).length - forced_locked_rows;

  // "N rows locked" was true and useless: it read as "you have pinned a lot" when
  // in fact every one of them was locked by the calendar. The three reasons are
  // different decisions — one is time passing, one is a choice you made on a
  // project, one is a week you moved by hand — so they are counted separately.
  // Checked in the same order isLocked applies them, so the totals reconcile.
  let locked_started = 0, locked_frozen = 0, locked_pinned = 0;
  locked.forEach(b => {
    if (frozen.has(b.project)) locked_frozen++;
    else if (widx(b.start_date) <= nowW) locked_started++;
    else locked_pinned++;
  });

  return {
    ...r,
    rows_to_append,
    rows_to_supersede,
    duplicates_suppressed: dropped.length,
    kept_rows: kept.length,          // movable rows replan chose to keep as-is
    locked_started,                  // already under way — the calendar, not a choice
    locked_frozen,                   // on a project someone ticked Locked
    locked_pinned,                   // a hand pick or a week moved by hand

    // same-unit figures — show these, not the engine's raw pair
    forced_before_rows,
    forced_after_rows,
    forced_locked_rows,   // conflicts that persist because a human pinned them
    forced_kept_rows,     // conflicts on rows re-proposed unchanged
    forced_new_rows,
    swaps: swapCount,
    dubs_divided: dubSplits,

    engine_forced_before: r.forced_before,
    engine_forced_after: r.forced_after,
  };
}

// Re-plans under several project orderings and keeps the best-balanced result.
// Deadline order is always tried first and only replaced by something strictly
// better on SOLVE_OBJECTIVE, so this can never return a worse plan than before.
//
// Scored on the book an apply would actually produce: the rows that survive
// (locked plus kept) plus the rows that would be appended.
function replanBook(projectRows, bookingRows, engineerRows, todayISO, opts) {
  const o = opts || {};
  const restarts = o.restarts !== undefined ? o.restarts
    : ((typeof SOLVE_RESTARTS === 'number') ? SOLVE_RESTARTS : 0);
  const objective = o.objective || ((typeof SOLVE_OBJECTIVE !== 'undefined') ? SOLVE_OBJECTIVE : null);
  const seed = o.seed !== undefined ? o.seed
    : ((typeof SOLVE_SEED === 'number') ? SOLVE_SEED : 1);

  const usable = (projectRows || []).filter(p => p && p.project_title && p.deadline);
  const active = activeRows(bookingRows);

  // What the live book looks like after applying a given result.
  const resultingBook = res => {
    const gone = {};
    (res.rows_to_supersede || []).forEach(n => { gone[n] = 1; });
    return active.filter(b => !gone[b.row_number]).concat(res.rows_to_append || []);
  };

  const baselineRes = replanOnce(usable, bookingRows, engineerRows, todayISO, false);
  const baseline = scorePlan(resultingBook(baselineRes), engineerRows);
  let best = baselineRes, bestScore = baseline, tried = 1;

  if (restarts > 0 && usable.length > 1) {
    const orders = [usable.slice().sort((a, b) =>
      totalWeeksOf(b) - totalWeeksOf(a) || String(a.deadline).localeCompare(String(b.deadline)))];
    const rnd = seededRandom(seed);
    for (let i = 0; i < restarts; i++) {
      const a = usable.slice();
      for (let j = a.length - 1; j > 0; j--) {
        const k = Math.floor(rnd() * (j + 1));
        const t = a[j]; a[j] = a[k]; a[k] = t;
      }
      orders.push(a);
    }
    for (const order of orders) {
      const res = replanOnce(order, bookingRows, engineerRows, todayISO, true);
      const sc = scorePlan(resultingBook(res), engineerRows);
      tried++;
      if (planIsBetter(sc, bestScore, objective)) { best = res; bestScore = sc; }
    }
  }

  // NEVER PROPOSE A SCHEDULE WORSE THAN THE ONE YOU HAVE.
  //
  // `baseline` above is re-plan's own first attempt, not the live book, so the search
  // picked the best of its 202 tries and proposed it even when every one of them was
  // worse than doing nothing. Measured: a book plotted at 3 overloaded weeks came back
  // from a re-plan at 4. Re-plan cannot move work already under way, so as the year
  // fills up its freedom shrinks and it will often have nothing to offer — and when
  // that is true the honest answer is to say so, not to shuffle the book sideways.
  //
  // Wiping and re-plotting is not an alternative in real use: projects arrive when
  // they arrive. So re-plan has to be safe to run at any time, and that means it must
  // be allowed to decline.
  const currentScore = scorePlan(active, engineerRows);
  const worthDoing = planIsBetter(bestScore, currentScore, objective);
  if (!worthDoing) {
    return Object.assign({}, best, {
      rows_to_supersede: [], rows_to_append: [], changes: [], change_count: 0,
      forced_after_rows: forcedRowsIn_(active), forced_new_rows: 0,
      no_improvement: true,
      solve: { candidates_tried: tried, improved: false, score: currentScore, baseline },
    });
  }

  return Object.assign({}, best, {
    no_improvement: false,
    solve: {
      candidates_tried: tried,
      improved: planIsBetter(bestScore, baseline, objective),
      score: bestScore,
      baseline: baseline,
    },
  });
}

function forcedRowsIn_(rows) {
  return (rows || []).filter(b => /FORCED/i.test(b.note || '')).length;
}

// --------------------------------------------------------------------- stats

function stats(bookingRows, engineerRows, todayISO) {
  return computeStats(activeRows(bookingRows), engineerRows, todayISO);
}
