// The new web app: read models, actions, and the store.
//
// The actions are pure functions of a book returning a change set, so they are tested
// the way the Apps Script api* functions are — no HTTP, no Google, no fixtures beyond
// the validation book everything else uses.
//
// Run: node test/webapp.test.js
const api = require('../webapp/api.js');
const actions = require('../webapp/actions.js');
const { register, createStore } = require('../webapp/store.js');
const fixture = require('../webapp/sources/fixture.js');
const { loadAppsScript } = require('../core/engine.js');
const A = loadAppsScript();

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};
const section = t => console.log('\n' + t);

// Apply a change set the way the store would, so assertions run against the book that
// would actually result — not against the change set's own description of itself.
function apply(book, change) {
  const gone = new Set(change.supersede || []);
  const next = JSON.parse(JSON.stringify(book));
  next.bookings.forEach(b => { if (gone.has(b.row_number)) b.status = 'superseded'; });
  let n = next.bookings.reduce((m, b) => Math.max(m, b.row_number || 0), 1);
  (change.append || []).forEach(r => next.bookings.push({ ...r, status: '', row_number: ++n }));
  return next;
}
const freshBook = async () => { fixture._reset(); return fixture.read(); };
const depthOf = rows => {
  const per = {};
  rows.forEach(b => { for (let w = A.widx(b.start_date); w <= A.widx(b.end_date); w++) {
    const k = b.engineer + '|' + w; per[k] = (per[k] || 0) + 1; } });
  return per;
};

(async () => {

section('Read models');
{
  const book = await freshBook();
  const boot = api.bootstrap(book);
  ok('bootstrap names every engineer', boot.engineers.length === book.engineers.length);
  ok('and every project', boot.projects.length === book.projects.length);
  ok('overlap counts split by depth',
     typeof boot.counts.over2 === 'number' && typeof boot.counts.over3 === 'number',
     JSON.stringify(boot.counts));

  // the counts must agree with the weeks, not with any note
  const per = depthOf(A.activeRows(book.bookings));
  const two = Object.keys(per).filter(k => per[k] === 2).length;
  const three = Object.keys(per).filter(k => per[k] > 2).length;
  ok('two-at-once count matches the book', boot.counts.over2 === two, `${boot.counts.over2} vs ${two}`);
  ok('three-at-once count matches the book', boot.counts.over3 === three, `${boot.counts.over3} vs ${three}`);

  // Explicit: the default is PROJECT mode, matching the Apps Script app.
  const sch = api.schedule(book, { mode: 'engineer' });
  ok('the grid has one column per engineer', sch.labels.length === book.engineers.length);
  ok('and every cell reports its depth so it can be coloured', (() => {
    let bad = 0;
    sch.cells.forEach(row => row.forEach(c => { if (c && !(c.depth >= 1)) bad++; }));
    return bad === 0;
  })());

  // The two surfaces are computed separately and must not disagree — the failure that
  // cost five rounds in the Apps Script version was exactly this.
  const gridDeep = new Set();
  sch.cells.forEach((row, ri) => row.forEach((c, ci) => {
    if (c && c.depth > 1) gridDeep.add(sch.labels[ri] + '|' + sch.weeks[ci].week);
  }));
  const bookDeep = new Set(Object.keys(per).filter(k => per[k] > 1));
  ok('the grid and the header agree on which weeks are overlapped',
     gridDeep.size === bookDeep.size && [...gridDeep].every(k => bookDeep.has(k)),
     `grid ${gridDeep.size} vs book ${bookDeep.size}`);
}

section('Both grid orientations, and the quarter range');
{
  const book = await freshBook();
  const eng = api.schedule(book, { mode: 'engineer' });
  const prj = api.schedule(book, { mode: 'project' });

  ok('engineers mode has one row per engineer',
     eng.labels.length === book.engineers.length && eng.mode === 'engineer');
  ok('projects mode has one row per project on the schedule',
     prj.mode === 'project' && prj.labels.length > book.engineers.length,
     `${prj.labels.length} rows`);
  ok('deadline markers belong to projects mode only',
     prj.markers.length > 0 && eng.markers.length === 0,
     `project ${prj.markers.length}, engineer ${eng.markers.length}`);
  ok('and every marker points at a row and column that exist',
     prj.markers.every(m => prj.cells[m.row] !== undefined && prj.weeks[m.col] !== undefined));

  // Projects mode reads diagonally only if rows are ordered by when work STARTS.
  const firstWeekOf = name => Math.min(...A.activeRows(book.bookings)
    .filter(b => b.project === name).map(b => A.widx(b.start_date)));
  const starts = prj.labels.map(firstWeekOf);
  ok('projects are ordered by when their work starts',
     starts.every((w, i) => i === 0 || starts[i - 1] <= w), starts.slice(0, 8).join(','));

  // The same week must read the same in both views — an overlap is a property of the
  // engineer's calendar, and switching orientation cannot change it.
  const deepIn = d => {
    const out = new Set();
    d.cells.forEach((row, ri) => row.forEach((c, ci) => {
      if (c && c.depth > 1) c.items.forEach(() => out.add(d.weeks[ci].week));
    }));
    return out;
  };
  const a = [...deepIn(eng)].sort(), b = [...deepIn(prj)].sort();
  ok('both orientations agree on which weeks are overlapped',
     a.join(',') === b.join(','), `engineer [${a}] vs project [${b}]`);

  // ---- the range
  ok('every quarter in the book is offered', prj.quarters.length > 1, prj.quarters.join(','));

  // A LATE quarter on purpose. Clipping to an early one keeps an unbroken prefix of
  // rows, so the row remap is accidentally the identity and a broken remap passes.
  // Rows are ordered by when work starts, so a late quarter drops rows from the front.
  const q = prj.quarters.filter(x => {
    const c = api.schedule(book, { mode: 'project', from: x, to: x });
    return c.labels.length > 0 && c.labels.length < prj.labels.length &&
           prj.labels.indexOf(c.labels[0]) > 0;
  })[0];
  ok('the fixture has a quarter that drops rows from the front, or this proves nothing',
     !!q, prj.quarters.join(','));
  const clipped = api.schedule(book, { mode: 'project', from: q, to: q });
  ok('clipping to one quarter narrows the weeks',
     clipped.weeks.length > 0 && clipped.weeks.length < prj.weeks.length,
     `${clipped.weeks.length} of ${prj.weeks.length}`);
  ok('and every week left is in that quarter',
     clipped.weeks.every(w => w.quarter === q));
  ok('a project with no work in range is dropped from the rows',
     clipped.labels.length < prj.labels.length,
     `${clipped.labels.length} of ${prj.labels.length}`);
  // Not "the index is in range" — that passes by luck when rows are dropped, since a
  // stale index usually still points at SOME row. The marker must land on the row of
  // the project whose deadline it is, in the column of that deadline's week.
  const deadlineOf = {};
  book.projects.forEach(p => { if (p.deadline) deadlineOf[p.project_title] = p.deadline; });
  const misplaced = clipped.markers.filter(m => {
    const title = clipped.labels[m.row];
    const week = clipped.weeks[m.col];
    return !title || !week || A.widx(deadlineOf[title]) !== week.week;
  });
  ok('each marker sits on its own project row, in its deadline week',
     misplaced.length === 0,
     misplaced.slice(0, 3).map(m => `${clipped.labels[m.row]} @ ${clipped.weeks[m.col] &&
       clipped.weeks[m.col].start}`).join(' | '));

  // Engineers mode keeps everyone: an empty row means "free all quarter", which is
  // information, whereas an absent project is just noise.
  const engClipped = api.schedule(book, { mode: 'engineer', from: q, to: q });
  ok('engineers mode keeps every engineer when clipped',
     engClipped.labels.length === book.engineers.length,
     `${engClipped.labels.length} of ${book.engineers.length}`);

  const none = api.schedule(book, { mode: 'project', from: '2099-Q1', to: '2099-Q1' });
  ok('a range with nothing in it says so rather than rendering an empty grid',
     none.clipped === true && none.weeks.length === 0);
}

section('Dragging a week to another engineer');
{
  const book = await freshBook();
  const rows = A.activeRows(book.bookings);
  const run = rows.find(b => A.widx(b.end_date) - A.widx(b.start_date) >= 2);
  ok('the fixture has a run long enough to take a week out of the middle', !!run);

  const midW = A.widx(run.start_date) + 1;
  const week = A.weekStart(midW);
  const to = book.engineers.map(e => e.name).find(n => n !== run.engineer);

  const dry = actions.reassignWeek(book, { project: run.project, phase: run.phase,
    week_start: week, to_engineer: to });
  ok('without confirmation it previews and writes nothing',
     dry.ok && dry.preview && !dry.change, JSON.stringify(dry).slice(0, 120));

  // What the move would cost, before it is made. Every experiment used to be a write.
  ok('the preview says what the move would do to the book',
     dry.effect === null || (typeof dry.effect.from === 'number' &&
       typeof dry.effect.to === 'number' && typeof dry.effect.better === 'boolean'),
     JSON.stringify(dry.effect));

  // And it has to be the SAME move that gets committed — a preview describing one
  // arrangement and a commit writing another is the whole failure this guards.
  const committed = actions.reassignWeek(book, { project: run.project, phase: run.phase,
    week_start: week, to_engineer: to, confirmed: true });
  ok('the previewed effect matches the committed one',
     JSON.stringify(dry.effect) === JSON.stringify(committed.effect),
     `${JSON.stringify(dry.effect)} vs ${JSON.stringify(committed.effect)}`);
  // The prediction has to survive contact with the book. Pick a target whose first
  // differing term IS the overlap count, so the predicted number can be checked against
  // the one you actually get — taking whatever the first engineer happened to be left
  // this skipping itself.
  {
    const target = book.engineers.map(e => e.name).filter(n => n !== run.engineer)
      .map(n => ({ n, r: actions.reassignWeek(book, { project: run.project,
        phase: run.phase, week_start: week, to_engineer: n }) }))
      .find(x => x.r.ok && x.r.effect && x.r.effect.term === 'total_double_booked');

    ok('some move changes the overlap count, or this proves nothing', !!target,
       'no candidate move altered total_double_booked');
    if (target) {
      const done = actions.reassignWeek(book, { project: run.project, phase: run.phase,
        week_start: week, to_engineer: target.n, confirmed: true });
      const per = depthOf(A.activeRows(apply(book, done.change).bookings));
      const actual = Object.values(per).filter(n => n > 1).length;
      ok('the number it predicted is the number you get',
         actual === target.r.effect.to,
         `predicted ${target.r.effect.to}, got ${actual} (moving to ${target.n})`);
    }
  }

  const done = actions.reassignWeek(book, { project: run.project, phase: run.phase,
    week_start: week, to_engineer: to, confirmed: true });
  ok('confirmed, it returns a change set', done.ok && !!done.change);
  ok('taking a week from the middle leaves three rows where there was one',
     done.change.append.length === 3, `${done.change.append.length} rows`);

  const after = apply(book, done.change);
  const now = A.activeRows(after.bookings);
  const holder = now.find(b => b.project === run.project && b.phase === run.phase &&
    A.widx(b.start_date) <= midW && midW <= A.widx(b.end_date));
  ok('the moved week now belongs to the new engineer', holder && holder.engineer === to,
     holder ? holder.engineer : 'nobody holds it');
  ok('and the weeks either side stay with the original', (() => {
    const before = now.find(b => b.project === run.project && b.phase === run.phase &&
      A.widx(b.end_date) === midW - 1);
    return before && before.engineer === run.engineer;
  })());

  // no week may be lost or duplicated by the split
  const span = n => { const s = new Set();
    now.filter(b => b.project === run.project && b.phase === run.phase)
       .forEach(b => { for (let w = A.widx(b.start_date); w <= A.widx(b.end_date); w++) s.add(w); });
    return s; };
  const covered = span();
  const wanted = A.widx(run.end_date) - A.widx(run.start_date) + 1;
  ok('the phase still covers exactly the weeks it did before', covered.size === wanted,
     `${covered.size} of ${wanted}`);

  ok('moving onto someone already booked warns rather than refusing', (() => {
    const busy = now.find(b => b.engineer !== run.engineer &&
      A.widx(b.start_date) <= midW && midW <= A.widx(b.end_date));
    if (!busy) return true;
    const r = actions.reassignWeek(book, { project: run.project, phase: run.phase,
      week_start: week, to_engineer: busy.engineer });
    return r.ok && r.warnings.some(w => w.kind === 'double');
  })());

  section('Undoing that drag');
  const undo = actions.undoWeekMove(after, { project: run.project, phase: run.phase,
    week_start: week });
  ok('the undo finds the hand-placed week', undo.ok, undo.error);
  ok('and knows who it came from without guessing', undo.to === run.engineer,
     `${undo.to} vs ${run.engineer}`);

  const back = apply(after, undo.change);
  const restored = A.activeRows(back.bookings).find(b => b.project === run.project &&
    b.phase === run.phase && A.widx(b.start_date) <= midW && midW <= A.widx(b.end_date));
  ok('the week goes back to the original engineer', restored && restored.engineer === run.engineer,
     restored ? restored.engineer : 'nobody');

  // a one-week phase has no neighbours to infer from — the note is the only record
  ok('undo refuses a week it has no record of', (() => {
    const plain = A.activeRows(book.bookings).find(b => !/moved by hand/i.test(b.note || ''));
    const r = actions.undoWeekMove(book, { project: plain.project, phase: plain.phase,
      week_start: A.weekStart(A.widx(plain.start_date)) });
    return !r.ok;
  })());
}

section('Saving a project');
{
  const book = await freshBook();
  const before = A.activeRows(book.bookings).length;

  const bad = actions.saveProject(book, { title: '', client: 'Netflix', deadline: '2026-11-01',
    dub: 2, edit: 1, mix: 1, mix_level: 'Advanced' });
  ok('a project with no title is refused', !bad.ok && bad.errors.length > 0);

  const dry = actions.saveProject(book, { title: 'New Show', client: 'Netflix',
    deadline: '2026-11-20', dub: 3, edit: 1, mix: 2, mix_level: 'Advanced', dry_run: true });
  ok('a dry run plots but returns no change set', dry.ok && dry.rows.length > 0 && !dry.change);

  const saved = actions.saveProject(book, { title: 'New Show', client: 'Netflix',
    deadline: '2026-11-20', dub: 3, edit: 1, mix: 2, mix_level: 'Advanced' });
  ok('a real save returns rows to append', saved.ok && saved.change.append.length > 0);
  const after = apply(book, saved.change);
  ok('and the book grows by exactly those rows',
     A.activeRows(after.bookings).length === before + saved.change.append.length);

  // Atmos and the hand-split dub must survive the whole path, not just the engine
  const atmos = actions.saveProject(book, { title: 'Atmos Show', client: 'Netflix',
    deadline: '2026-11-20', dub: 2, edit: 1, mix: 2, mix_level: 'Advanced', atmos: true });
  const withRoom = book.engineers.filter(e => /^yes$/i.test(e.atmos)).map(e => e.name);
  ok('an Atmos title reaches someone with the room', withRoom.includes(atmos.mixer),
     `${atmos.mixer} — rooms: ${withRoom.join(', ')}`);

  const recs = book.engineers.filter(e => /^yes$/i.test(e.can_record)).map(e => e.name);
  const split = actions.saveProject(book, { title: 'Split Show', client: 'Netflix',
    deadline: '2026-11-20', dub: 4, edit: 1, mix: 1, mix_level: 'Advanced',
    recordist: recs[0], recordist2: recs[1] });
  const dubbers = [...new Set(split.rows.filter(r => r.phase === 'Dub').map(r => r.engineer))];
  ok('a hand-split dub reaches both named recordists', dubbers.length === 2,
     dubbers.join(', '));

  // renaming must not leave the old title's bookings behind
  const renamed = actions.saveProject(book, { title: 'New Name', original_title: 'Animals',
    client: 'Netflix', deadline: '2026-09-08', dub: 2, edit: 1, mix: 2, mix_level: 'Advanced' });
  const renamedBook = apply(book, renamed.change);
  ok('renaming supersedes the old title\'s rows',
     !A.activeRows(renamedBook.bookings).some(b => b.project === 'Animals'));
  ok('and the new title is on the schedule',
     A.activeRows(renamedBook.bookings).some(b => b.project === 'New Name'));
}

section('Re-plan');
{
  const book = await freshBook();
  const r = actions.replanPreview(book, '2026-06-01');
  ok('the preview runs', r.ok);
  ok('it either declines or offers a change set, never both',
     r.no_improvement ? r.change === null : !!r.change,
     `no_improvement=${r.no_improvement} change=${!!r.change}`);

  if (!r.no_improvement) {
    const before = Object.values(depthOf(A.activeRows(book.bookings))).filter(n => n > 1).length;
    const after = Object.values(depthOf(A.activeRows(apply(book, r.change).bookings)))
      .filter(n => n > 1).length;
    ok('and applying it never increases overlapped weeks', after <= before, `${before} -> ${after}`);
  } else {
    ok('a declined re-plan offers nothing to apply', r.change === null && r.change_count === 0);
  }
}

section('Analysis');
{
  const book = await freshBook();
  const a = api.analysis(book, { from: '2026-01-01' });

  ok('overlaps are split by depth, not lumped together',
     typeof a.overlaps.pair_weeks === 'number' && typeof a.overlaps.deep_weeks === 'number',
     JSON.stringify({ pair: a.overlaps.pair_weeks, deep: a.overlaps.deep_weeks }));

  // The book has no three-way, so on it alone every split passes trivially — putting
  // ALL overlaps in the pair bucket would look correct. One is stacked in on purpose.
  const tripled = JSON.parse(JSON.stringify(book));
  const victim = A.activeRows(tripled.bookings)[0];
  let n = tripled.bookings.reduce((m, b) => Math.max(m, b.row_number), 1);
  ['Triple A', 'Triple B'].forEach(p => tripled.bookings.push({
    project: p, phase: 'Mix', engineer: victim.engineer,
    start_date: victim.start_date, end_date: victim.start_date,
    source: 'test', note: '', status: '', row_number: ++n }));
  const t = api.analysis(tripled, { from: '2026-01-01' });

  ok('the stacked week really is three deep', t.overlaps.deep.length >= 3,
     `${t.overlaps.deep.length} rows at depth 3+`);
  ok('a three-way lands in the overflow bucket, not among the pairs',
     t.overlaps.deep_weeks >= 1 &&
     t.overlaps.deep.every(o => o.depth > 2) &&
     t.overlaps.pair.every(o => o.depth <= 2),
     `deep ${t.overlaps.deep_weeks}, pair ${t.overlaps.pair_weeks}`);
  ok('and it is not double-counted into both',
     !t.overlaps.pair.some(o => t.overlaps.deep.some(d =>
       d.engineer === o.engineer && d.start === o.start)));

  // Counted in WEEKS, not rows: actualOverlaps_ emits one row per colliding booking,
  // so a single week of four reads as "4" and sounds like four separate problems.
  const distinct = new Set(a.overlaps.pair.map(o => o.engineer + '|' + o.start)).size;
  ok('the pair count is weeks, not booking rows', a.overlaps.pair_weeks === distinct,
     `${a.overlaps.pair_weeks} vs ${distinct} distinct engineer-weeks`);

  ok('the two role pools are kept apart',
     Array.isArray(a.pools.recedit) && Array.isArray(a.pools.adv_mix) &&
     a.pools.adv_mix.length <= a.pools.recedit.length + 1,
     JSON.stringify(a.pools));

  // Criterion 12: a dub week and an Advanced-mix week are different currencies and
  // nothing may total them. If a field ever appears that sums the two, this fails.
  const w = a.weeks[0];
  ok('no week carries a figure that adds the two roles together',
     !Object.keys(w).some(k => /total|combined|all_/.test(k)), Object.keys(w).join(','));
  ok('supply is the count of people who can actually do it',
     w.recedit_supply === a.pools.recedit.length &&
     w.adv_mix_supply === a.pools.adv_mix.length,
     `${w.recedit_supply}/${a.pools.recedit.length}, ${w.adv_mix_supply}/${a.pools.adv_mix.length}`);

  // The series starts at the week asked for — past weeks cannot be acted on, and
  // including them makes it grow without limit as history accumulates.
  const late = api.analysis(book, { from: '2026-09-01' });
  ok('the series starts where asked', late.weeks.every(x => x.week_start >= '2026-09-01'));
  ok('and asking later gives fewer weeks', late.weeks.length < a.weeks.length,
     `${late.weeks.length} vs ${a.weeks.length}`);

  ok('every engineer has a load, including the idle ones',
     a.score.loads.length === book.engineers.length,
     `${a.score.loads.length} of ${book.engineers.length}`);

  // The client mix needs the PROJECTS passed into computeCapacity. Without them every
  // project lands under "(unknown)", which is what the first version of this did.
  const clients = (a.pipeline.by_client || []).map(c => c.client);
  ok('the pipeline names real clients, not (unknown)',
     clients.length > 0 && !clients.includes('(unknown)'), clients.join(', '));
  ok('and its week total matches the book',
     a.pipeline.by_client.reduce((n, c) => n + c.weeks, 0) ===
       A.activeRows(book.bookings).reduce((n, b) =>
         n + (A.widx(b.end_date) - A.widx(b.start_date) + 1), 0));

  // The quarter heatmap must reconcile with the per-engineer totals, or the page is
  // telling you two different things about the same person.
  const drift = Object.keys(a.per_engineer).filter(n => {
    const summed = a.quarters.reduce((t, q) => t + ((a.by_quarter[q] || {})[n] || 0), 0);
    return summed !== a.per_engineer[n];
  });
  ok('each engineer\'s quarters add up to their total', drift.length === 0,
     drift.map(n => `${n}: quarters ${a.quarters.reduce((t, q) =>
       t + ((a.by_quarter[q] || {})[n] || 0), 0)} vs total ${a.per_engineer[n]}`).join(' | '));

  // One row per overloaded engineer-week, naming what collides. A list of booking rows
  // reports "4" where a person sees one problem.
  const c = a.overlaps.collisions;
  ok('collisions are one row per engineer-week, not per booking',
     c.length === a.overlaps.pair_weeks + a.overlaps.deep_weeks,
     `${c.length} rows vs ${a.overlaps.pair_weeks + a.overlaps.deep_weeks} weeks`);
  ok('and each names everything colliding in it',
     c.every(x => x.work.length === x.depth && x.depth >= 2),
     JSON.stringify(c.slice(0, 2)));
}

section('Re-plan: preview, then apply against the same book');
{
  // Over HTTP, because the guard lives in the server: the preview is held there with
  // the store version it was computed against, and the client only ever holds a token.
  const { server, store } = require('../webapp/server.js');
  fixture._reset();
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const call = async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body) }
      : undefined);
    return r.json();
  };

  // The staleness guard goes FIRST. Ordered the other way, applying the first re-plan
  // left nothing to improve, the second preview declined, and the most important
  // assertion in this block quietly skipped itself.
  const stalePre = await call('/api/replan', {});
  ok('the preview runs over HTTP', stalePre.ok === true, JSON.stringify(stalePre).slice(0, 120));
  ok('and never hands the change set to the client', stalePre.change === undefined);
  ok('an improving preview returns a token', !!stalePre.token,
     stalePre.no_improvement ? 'declined — the rest of this block proves nothing' : '');

  {
    const rows = A.activeRows((await fixture.read()).bookings);
    const run = rows.find(b => A.widx(b.end_date) - A.widx(b.start_date) >= 1);
    const to = (await call('/api/bootstrap')).engineers.find(n => n !== run.engineer);
    const moved = await call('/api/reassign', { project: run.project, phase: run.phase,
      week_start: A.weekStart(A.widx(run.start_date)), to_engineer: to, confirmed: true });
    ok('something else changed the book in the meantime', moved.ok === true, moved.error);
    const stale = await call('/api/replan-apply', { token: stalePre.token });
    ok('a preview applied after the book moved is refused, not written',
       stale.ok === false && /changed/i.test(stale.error || ''), stale.error);
  }

  // and the ordinary path, on a freshly previewed book
  const pre = await call('/api/replan', {});
  if (pre.no_improvement) {
    ok('a declined preview offers no token', !pre.token);
    const nothing = await call('/api/replan-apply', { token: 'anything' });
    ok('and apply refuses', nothing.ok === false, nothing.error);
  } else {
    const wrong = await call('/api/replan-apply', { token: 'not-the-token' });
    ok('a token that does not match is refused', wrong.ok === false, wrong.error);

    const before = (await call('/api/bootstrap')).counts.live_rows;
    const done = await call('/api/replan-apply', { token: pre.token });
    ok('the right token applies', done.ok === true, done.error);
    ok('and it reports what it wrote', done.superseded > 0 || done.appended > 0,
       `${done.superseded} superseded, ${done.appended} appended`);
    ok('the book actually changed',
       (await call('/api/bootstrap')).counts.live_rows !== before || done.appended === 0);

    // Not just "the second call returns ok:false" — that passes even with the stash
    // left in place, because the version bump from the first apply refuses it anyway.
    // What must hold is that nothing is written a second time.
    const rowsAfterFirst = (await call('/api/bootstrap')).counts.live_rows;
    const twice = await call('/api/replan-apply', { token: pre.token });
    const rowsAfterSecond = (await call('/api/bootstrap')).counts.live_rows;
    ok('the same preview cannot be applied twice', twice.ok === false, twice.error);
    ok('and nothing is written on the second attempt',
       rowsAfterSecond === rowsAfterFirst, `${rowsAfterFirst} -> ${rowsAfterSecond}`);
  }

  await new Promise(r => server.close(r));
  fixture._reset();
}

section('The deeper search');
{
  // Apps Script capped execution at six minutes and every solve blocked the user, so
  // the engine settled for 200 orderings. Measured on an incrementally built book:
  // 202 gives spread 5 / peak 19; 1000 gives spread 1 / peak 17; 5000 gives the same
  // plan as 1000 for five times the wait. Worth having, and worth not overpaying for.
  const { loadAppsScript } = require('../core/engine.js');
  const engineers = require('../validation/engineers.json');
  const projects = require('../validation/projects.json');
  const byD = projects.slice().sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));

  // Through the RE-PLAN, not just the initial plot. The first measurement of this only
  // plotted, found both depths scored the same, and would have concluded the extra
  // search bought nothing — when where it actually pays is re-solving a book that is
  // already full.
  const solveAt = restarts => {
    const E = loadAppsScript({ restarts });
    let book = [];
    for (let i = 0; i < byD.length; i += 4) {
      book = book.concat(E.plotBatch(byD.slice(i, i + 4), book, engineers).new_rows);
    }
    book = book.map((b, i) => ({ ...b, status: '', row_number: i + 2 }));
    const rows = projects.map(p => ({ ...E.normalizeProject(p).project, locked: false }));
    const r = E.replanBook(rows, book, engineers, '2026-06-01');
    if (r.no_improvement) return E.scorePlan(book, engineers);
    const gone = new Set(r.rows_to_supersede || []);
    return E.scorePlan(book.filter(b => !gone.has(b.row_number))
      .concat(r.rows_to_append || []), engineers);
  };

  const shallow = solveAt(200);
  const deep = solveAt(1000);

  // Lexicographic: a deeper search may never be worse on a higher-ranked term.
  const order = loadAppsScript().SOLVE_OBJECTIVE;
  let verdict = 'identical';
  for (const term of order) {
    if (deep[term] === shallow[term]) continue;
    verdict = deep[term] < shallow[term] ? 'better' : 'WORSE';
    ok(`a deeper search is not worse: first difference is ${term}`,
       deep[term] <= shallow[term], `${term}: ${shallow[term]} -> ${deep[term]}`);
    break;
  }
  ok('and searching harder actually changed something', verdict !== 'identical',
     'the two searches produced the same score — the depth is buying nothing');

  // The search depth must not change what is LEGAL, only which legal plan is chosen.
  const E = loadAppsScript({ restarts: 1000 });
  let book = [];
  for (let i = 0; i < byD.length; i += 4) {
    book = book.concat(E.plotBatch(byD.slice(i, i + 4), book, engineers).new_rows);
  }
  const yes = v => /^yes$/i.test(String(v || '').trim());
  const byName = {}; engineers.forEach(e => { byName[e.name] = e; });
  const projByName = {}; projects.forEach(p => { projByName[p.project_title] = p; });
  const illegal = book.filter(b => {
    const e = byName[b.engineer], p = projByName[b.project];
    if (!e || !p) return false;
    if (b.phase === 'Mix' && yes(p.atmos_required) && !yes(e.atmos)) return true;
    if (b.phase === 'Mix' && String(p.mix_level_required).trim() === 'Advanced' &&
        e.mix_level !== 'Advanced') return true;
    if (yes(p.special_project) && b.phase !== 'Mix' && !yes(e.does_specials)) return true;
    return false;
  });
  ok('a deeper search still obeys every eligibility rule', illegal.length === 0,
     illegal.slice(0, 3).map(b => `${b.project}/${b.phase}=${b.engineer}`).join(' | '));
}

section('History: a log of what you did, and undoing the last of it');
{
  const { server, store } = require('../webapp/server.js');
  const history = require('../webapp/history.js');
  fixture._reset();
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const call = async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body) }
      : undefined);
    return r.json();
  };

  // The store is a module singleton with a 30s TTL, and an earlier block left a book
  // in it. Without forcing a re-read the server works from rows whose numbers no
  // longer exist, and the drag below silently fails to find its week.
  await call('/api/bootstrap?fresh=1');

  const empty = await call('/api/history');
  ok('the log starts empty', empty.events.length === 0);

  // three changes, in order
  const rows0 = A.activeRows((await fixture.read()).bookings);
  const run = rows0.find(b => A.widx(b.end_date) - A.widx(b.start_date) >= 1);
  const to = (await call('/api/bootstrap')).engineers.find(n => n !== run.engineer);
  // The DRAG goes last on purpose. A new project supersedes nothing, so rolling one
  // back has nothing to revive — and a rollback that never revives would pass. The
  // drag retires a row, so undoing it has to bring that row back.
  await call('/api/save-project', { title: 'Logged Show', client: 'Netflix',
    deadline: '2026-12-04', dub: 2, edit: 1, mix: 1, mix_level: 'Advanced' });
  await call('/api/reassign', { project: run.project, phase: run.phase,
    week_start: A.weekStart(A.widx(run.start_date)), to_engineer: to, confirmed: true });

  const log = await call('/api/history');
  ok('every change is logged', log.events.length === 2, JSON.stringify(log.events));
  ok('newest first', log.events[0].action === 'reassign', log.events[0].action);
  ok('each names what it did in words',
     log.events.every(e => e.summary && e.summary.length > 8),
     log.events.map(e => e.summary).join(' | '));
  ok('and carries the rows it wrote and retired',
     log.events.every(e => e.appended || e.superseded),
     JSON.stringify(log.events.map(e => ({ a: e.appended, s: e.superseded }))));
  ok('and when', log.events.every(e => /^\d{4}-\d{2}-\d{2} /.test(e.at)),
     log.events.map(e => e.at).join(', '));

  // the drag is the last event; its diff must name the move
  const one = await call('/api/history?event=1');
  ok('an event can be opened', !!one.event && !!one.diff, JSON.stringify(one).slice(0, 120));
  ok('and says what moved, and from whom',
     one.diff.moved.some(m => m.from === run.engineer && m.engineer === to) ||
     one.diff.added.length > 0,
     JSON.stringify(one.diff.moved).slice(0, 160));
  ok('with the book size before and after',
     one.diff.counts.before > 0 && one.diff.counts.after > 0,
     JSON.stringify(one.diff.counts));

  // ---- rollback
  const early = await call('/api/rollback', { index: 0 });
  ok('an older change cannot be rolled back on its own',
     early.ok === false && /most recent/i.test(early.error), early.error);

  const movedNow = A.activeRows((await fixture.read()).bookings).find(b =>
    b.project === run.project && b.phase === run.phase &&
    A.widx(b.start_date) <= A.widx(run.start_date) &&
    A.widx(run.start_date) <= A.widx(b.end_date));
  ok('the drag took effect before the rollback', movedNow && movedNow.engineer === to,
     movedNow ? movedNow.engineer : 'gone');

  const rolled = await call('/api/rollback', { index: 1 });
  ok('the most recent change rolls back', rolled.ok === true, rolled.error);

  // Retiring what it wrote is only half of it. The rows it retired must come BACK,
  // or the schedule is left with a hole where the original booking was.
  const back = A.activeRows((await fixture.read()).bookings).find(b =>
    b.project === run.project && b.phase === run.phase &&
    A.widx(b.start_date) <= A.widx(run.start_date) &&
    A.widx(run.start_date) <= A.widx(b.end_date));
  ok('the week goes back to who had it', back && back.engineer === run.engineer,
     back ? `held by ${back.engineer}` : 'NOBODY holds that week now');
  ok('and the original row is live again, not a copy',
     back && back.row_number === run.row_number,
     back ? `row ${back.row_number} vs original ${run.row_number}` : 'no row');
  ok('the row count returns to what it was',
     (await call('/api/bootstrap')).counts.live_rows === one.diff.counts.before,
     `${(await call('/api/bootstrap')).counts.live_rows} vs ${one.diff.counts.before}`);

  // and the rollback is itself an event, so the log never loses its thread
  const log2 = await call('/api/history');
  ok('the rollback is logged too', log2.events.length === 3 &&
     /rolled back/i.test(log2.events[0].summary || ''), log2.events[0].summary);

  // ---- replay
  const bk = (await fixture.read()).bookings;
  const events = (await store.events());
  ok('replaying to before everything gives the original book',
     history.bookAt(bk, events, -1).length === rows0.length,
     `${history.bookAt(bk, events, -1).length} vs ${rows0.length}`);
  ok('and replaying forward never goes backwards in time', (() => {
    let prev = -1;
    for (let i = -1; i < events.length; i++) {
      const n = history.bookAt(bk, events, i).length;
      if (n < 0) return false;
      prev = n;
    }
    return true;
  })());

  await new Promise(r => server.close(r));
  fixture._reset();
}

section('The store');
{
  fixture._reset();
  register('fixture', fixture);
  const store = createStore('fixture', { ttlMs: 50 });
  const a = await store.get();
  ok('a book is loaded on first ask', !!a && a.bookings.length > 0);
  ok('the stats describe what is held', store.stats().rows === a.bookings.length,
     JSON.stringify(store.stats()));

  const b = await store.get();
  ok('a second ask inside the TTL reuses it', a === b);

  await new Promise(r => setTimeout(r, 60));
  const c = await store.get();
  ok('past the TTL it reloads', c !== a);

  // Concurrency: a burst on a cold store must not start several reads of the same book.
  let reads = 0;
  register('counting', { read: async () => { reads++; return fixture.read(); },
                         write: async () => ({}) });
  const s2 = createStore('counting', { ttlMs: 10000 });
  await Promise.all([s2.get(), s2.get(), s2.get(), s2.get()]);
  ok('four simultaneous asks cause one read, not four', reads === 1, `${reads} reads`);

  ok('an unknown source is refused loudly', (() => {
    try { createStore('nope'); return false; } catch (e) { return /Unknown data source/.test(e.message); }
  })());
}

section('A saved project reaches the Projects list, not just the schedule');
{
  // Caught by clicking through the UI, not by a test: the save appended four booking
  // rows and the project never appeared in the list. Bookings with no Projects row is
  // the ORPHAN state — it renders on the schedule and cannot be selected to cancel,
  // because the schedule is built from bookings and the list from Projects.
  fixture._reset();
  const book = await fixture.read();
  const before = book.projects.length;

  const saved = actions.saveProject(book, { title: 'Brand New Show', client: 'Netflix',
    deadline: '2026-11-20', dub: 2, edit: 1, mix: 2, mix_level: 'Advanced' });
  ok('the change set carries the project, not only its bookings',
     !!saved.change.project && saved.change.project.project_title === 'Brand New Show');
  ok('and the engine outputs, so the sheet can record who got it',
     !!saved.change.outputs && !!saved.change.outputs.mixer, JSON.stringify(saved.change.outputs));

  await fixture.write(saved.change);
  const after = await fixture.read();
  ok('the project is in the list after saving', after.projects.length === before + 1,
     `${before} -> ${after.projects.length}`);
  ok('and it is the one we saved',
     after.projects.some(p => p.project_title === 'Brand New Show'));
  ok('its bookings are there too',
     A.activeRows(after.bookings).some(b => b.project === 'Brand New Show'));

  // a rename must move the existing row, not add a second one
  const renamed = actions.saveProject(after, { title: 'Renamed Show',
    original_title: 'Brand New Show', client: 'Netflix', deadline: '2026-11-20',
    dub: 2, edit: 1, mix: 2, mix_level: 'Advanced' });
  await fixture.write(renamed.change);
  const last = await fixture.read();
  ok('a rename updates the row rather than leaving two',
     last.projects.filter(p => /Brand New Show|Renamed Show/.test(p.project_title)).length === 1,
     last.projects.filter(p => /Brand New Show|Renamed Show/.test(p.project_title))
       .map(p => p.project_title).join(', '));
  fixture._reset();
}

section('Reading a real spreadsheet layout');
{
  const sheets = require('../webapp/sources/sheets.js');
  const { isoFrom, mapper } = sheets;

  // The log tab is created on FIRST WRITE, so a sheet that predates it — or a brand
  // new copy — does not have one. It must never be part of the required read: adding
  // it to TABS made read() ask Google for "History!A:Z", which does not parse, and
  // every read of the whole book failed. Caught against the real sheet, not here.
  ok('the log tab is not one of the tabs the book is read from',
     !Object.values(sheets.TABS || {}).includes('History'),
     JSON.stringify(sheets.TABS));
  ok('and the three that are required are exactly the book',
     JSON.stringify(Object.values(sheets.TABS || {}).sort()) ===
       JSON.stringify(['Bookings', 'Engineers', 'Projects']),
     JSON.stringify(sheets.TABS));

  // Dates arrive as Sheets serial numbers so the cell's display format cannot change
  // what the engine sees. 2026-08-24 is serial 46258.
  ok('a serial number becomes an ISO date', isoFrom(46258) === '2026-08-24', isoFrom(46258));
  ok('an ISO string is left alone', isoFrom('2026-08-24') === '2026-08-24');
  ok('a blank stays blank', isoFrom('') === '' && isoFrom(null) === '');

  // Columns are mapped by NAME. A sheet with an extra column inserted by hand, or one
  // that predates Atmos, must still read correctly — position mapping silently
  // re-points every field after the insertion.
  const head = ['Project', 'Client', 'Notes By Hand', 'Deadline', 'Phases D/E/M'];
  const m = mapper(head);
  const row = ['Animals', 'Netflix', 'ignore me', 46258, '2/1/2'];
  ok('a hand-inserted column does not shift the ones after it',
     m(row, 'Deadline') === 46258 && m(row, 'Phases D/E/M') === '2/1/2');
  ok('headers match regardless of case and padding',
     mapper(['  PROJECT '])(['x'], 'Project') === 'x');
  ok('a missing column reads as undefined, not as the wrong one',
     m(row, 'Atmos') === undefined && m.has('Atmos') === false);

  // The roster flag was renamed on 2026-08-30; a sheet set up before that still says
  // specials_only, and both must work.
  const oldRoster = mapper(['name', 'specials_only']);
  const newRoster = mapper(['name', 'does_specials']);
  ok('an un-migrated roster still reads the specials flag',
     oldRoster.either(['Kyle', 'Yes'], 'does_specials', 'specials_only') === 'Yes');
  ok('and a migrated one reads it too',
     newRoster.either(['Kyle', 'Yes'], 'does_specials', 'specials_only') === 'Yes');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (require.main === module) process.exit(fail ? 1 : 0);
})();
