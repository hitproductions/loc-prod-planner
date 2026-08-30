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

  const sch = api.schedule(book);
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

console.log(`\n${pass} passed, ${fail} failed`);
if (require.main === module) process.exit(fail ? 1 : 0);
})();
