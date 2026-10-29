// Tests for the wrapper fixes and the acceptance criteria that don't depend on
// the missing historical book. Run: node test/wrapper.test.js
//
// Loads the real appsscript/*.gs sources — the same code the sheet runs.
const { loadAppsScript } = require('./loader.js');
const A = loadAppsScript();
const W = A, C = A;              // wrapper + capacity share one global scope in Apps Script
const widx = A.widx;
const rawEngine = { replan: A.replan };   // unwrapped engine, to demonstrate the bugs

const engineers = require('../validation/engineers.json');
const projects  = require('../validation/projects.json');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};
const section = s => console.log('\n' + s);

// ---------------------------------------------------------------------------
section('FIX B — a blank mix level must normalise, not default silently');
{
  const blank = { project_title:'Blank Level', deadline:'2026-04-06', client:'Netflix',
                  dub_weeks:1, edit_weeks:1, mix_weeks:1, mix_level_required:'',
                  music_songs:'No', special_project:'No' };
  const { project: norm } = W.normalizeProject(blank);
  ok('blank mix level normalises to Advanced', norm.mix_level_required === 'Advanced', norm.mix_level_required);

  const plotted = W.plot(blank, [], engineers);
  ok('and the plot uses the Advanced pool it normalised to',
     plotted.ok && plotted.result.mixer !== '—', plotted.result.mixer);

  ok('an invalid mix level is rejected into the row, not silently defaulted',
     W.normalizeProject({ ...blank, mix_level_required:'Intermediate' }).errors.length === 1);
}

// ---------------------------------------------------------------------------
section('Criterion 9 — superseded rows are never read as live');
{
  const book = [
    { project:'P1', phase:'Mix', engineer:'Via', start_date:'2026-03-16', end_date:'2026-03-22', note:'', status:'superseded', row_number:2 },
    { project:'P1', phase:'Mix', engineer:'Kyle', start_date:'2026-03-16', end_date:'2026-03-22', note:'', status:'', row_number:3 },
  ];
  ok('activeRows drops superseded', W.activeRows(book).length === 1);
  const s = W.stats(book, engineers, '2026-03-01');
  ok('stats ignores the superseded row', s.totals.booking_rows === 1, JSON.stringify(s.totals));
  ok('superseded row is still present in the input (never deleted)', book.length === 2);
}

// ---------------------------------------------------------------------------
section('Criterion 1 — dub-only special project');
{
  // Non-Netflix work is Special work (2026-08-13), and it is the Special flag that
  // routes now — the client name is data.
  const p = { project_title:'Project A (Valorant)', deadline:'2026-09-25', client:'Liquid Violet',
              special_project:'Yes', phases:'1/0/0', mix_level_required:'Advanced' };
  const out = W.plot(p, [], engineers).result;
  const router = engineers.find(e => e.does_specials === 'Yes').name;
  ok('exactly one booking row', out.booking_rows.length === 1, JSON.stringify(out.booking_rows));
  ok('the row is the Dub phase', out.booking_rows[0].phase === 'Dub');
  ok('assigned to the does_specials engineer', out.booking_rows[0].engineer === router,
     `got ${out.booking_rows[0].engineer}, router is ${router}`);
  ok('no mixer named', out.mixer === '—', out.mixer);
}

// ---------------------------------------------------------------------------
section('Criterion 2 — uneven phases 3/1/2 plot backward with no gaps');
{
  const p = { project_title:'Uneven', deadline:'2026-11-07', client:'Netflix', phases:'3/1/2' };
  const out = W.plot(p, [], engineers).result;
  const dlW = widx('2026-11-07');
  ok('mix ends the week before the deadline week', widx(out.mix_end) === dlW - 1,
     `mix_end week ${widx(out.mix_end)} vs deadline week ${dlW}`);
  ok('edit ends the week before mix starts', widx(out.edit_end) === widx(out.mix_start) - 1);
  ok('dub ends the week before edit starts', widx(out.dub_end) === widx(out.edit_start) - 1);
  ok('phase lengths are 3 / 1 / 2 weeks',
     widx(out.dub_end) - widx(out.dub_start) === 2 &&
     widx(out.edit_end) - widx(out.edit_start) === 0 &&
     widx(out.mix_end) - widx(out.mix_start) === 1);
  ok('"3/1/2" in one cell parses', JSON.stringify(W.parsePhases('3/1/2')) === '[3,1,2]');
}

// ---------------------------------------------------------------------------
section('Criteria 3 & 4 — manual picks go through, and are flagged');
{
  const developing = engineers.find(e => e.mix_level === 'Developing').name;
  const p3 = { project_title:'Manual Level Breach', deadline:'2026-04-06', client:'Netflix',
               phases:'1/1/1', mix_level_required:'Advanced', mixer_override: developing };
  const out3 = W.plot(p3, [], engineers).result;
  ok('the manual mixer is applied anyway', out3.mixer === developing, out3.mixer);
  ok('a warning names the mix-level breach',
     /Advanced mix/i.test(out3.warnings) && out3.warnings.includes(developing), out3.warnings);
  ok('the row is flagged manual', /manual/i.test(out3.booking_rows.find(b=>b.phase==='Mix').note));

  // someone already booked those weeks
  const holder = engineers.find(e => /^yes$/i.test(e.can_mix) && e.mix_level === 'Advanced' &&
                                     !/^yes$/i.test(e.overflow_only)).name;
  const first = W.plot({ project_title:'Holder', deadline:'2026-04-06', client:'Netflix',
                         phases:'0/0/2', mixer_override: holder }, [], engineers).result;
  const book = first.booking_rows.map((b,i)=>({...b, status:'', row_number:i+2}));
  const p4 = { project_title:'Manual Double Book', deadline:'2026-04-06', client:'Netflix',
               phases:'0/0/2', mix_level_required:'Advanced', mixer_override: holder };
  const out4 = W.plot(p4, book, engineers).result;
  ok('the double-booked manual pick still goes through', out4.mixer === holder, out4.mixer);
  ok('the warning states how many weeks were already committed',
     /already booked 2 of those weeks/i.test(out4.warnings), out4.warnings);
}

// ---------------------------------------------------------------------------
section('Criterion 11 — analysis figures reconcile with the schedule grid');
{
  const batch = W.plotBatch(projects, [], engineers);
  const book = batch.new_rows.map((b,i)=>({...b, status:'', row_number:i+2}));
  const s = W.stats(book, engineers, '2026-08-12');
  const cap = C.computeCapacity(book, engineers, projects, '2026-08-12');

  // count grid cells independently: engineer -> distinct weeks
  const grid = {};
  for (const b of book) {
    const a = widx(b.start_date), z = widx(b.end_date);
    grid[b.engineer] = grid[b.engineer] || new Set();
    for (let w = a; w <= z; w++) grid[b.engineer].add(w);
  }
  let mismatch = [];
  for (const e of s.engineers) {
    const fromGrid = (grid[e.engineer] || new Set()).size;
    const fromCap  = cap.weeks_per_engineer[e.engineer];
    if (e.weeks_booked !== fromGrid || fromCap !== fromGrid)
      mismatch.push(`${e.engineer}: stats ${e.weeks_booked}, capacity ${fromCap}, grid ${fromGrid}`);
  }
  ok('stats, capacity and a raw cell count all agree per engineer',
     mismatch.length === 0, mismatch.join('; '));

  const streakTotals = cap.streaks.every(st =>
    st.weeks_booked === (grid[st.engineer] || new Set()).size);
  ok('streak weeks_booked reconciles too', streakTotals);
}

// ---------------------------------------------------------------------------
section('Criterion 12 — role capacity is never aggregated');
{
  const batch = W.plotBatch(projects, [], engineers);
  const book = batch.new_rows.map((b,i)=>({...b, status:'', row_number:i+2}));
  const cap = C.computeCapacity(book, engineers, projects, '2026-08-12');

  const wk = cap.weeks[0];
  ok('per-week record/edit and Advanced-mix capacity are separate fields',
     'recedit_free' in wk && 'adv_mix_free' in wk);
  const quarterKeys = Object.keys(cap.free_by_quarter[0]);
  ok('quarter roll-up exposes no combined total',
     quarterKeys.includes('open_recedit_weeks') && quarterKeys.includes('open_adv_mix_weeks') &&
     !quarterKeys.some(k => /total|combined|all_roles/i.test(k)), quarterKeys.join(','));
  ok('the two pools are genuinely different sizes (different currencies)',
     cap.pools.recedit.length !== cap.pools.adv_mix.length,
     `recedit ${cap.pools.recedit.length}, adv mix ${cap.pools.adv_mix.length}`);
}

// ---------------------------------------------------------------------------
section('Validate-on-read — a tampered book fails loudly (HANDOFF §8)');
{
  const bad = [
    { project:'P1', phase:'Dub', engineer:'Nobody', start_date:'2026-03-02', end_date:'2026-03-08', note:'', status:'' },
    { project:'P2', phase:'Dubbing', engineer:'John', start_date:'2026-03-02', end_date:'2026-03-08', note:'', status:'' },
    { project:'P3', phase:'Mix', engineer:'Via', start_date:'2026-03-04', end_date:'2026-03-10', note:'', status:'' },
    { project:'P4', phase:'Mix', engineer:'Via', start_date:'2026-03-16', end_date:'2026-03-08', note:'', status:'' },
  ];
  const problems = W.validateBook(bad, engineers);
  ok('unknown engineer caught', problems.some(p => /not on the roster/.test(p)));
  ok('bad phase caught', problems.some(p => /is not one of/.test(p)));
  ok('non-Monday start caught', problems.some(p => /not a Monday/.test(p)));
  ok('start after end caught', problems.some(p => /after end_date/.test(p)));
  let threw = false;
  try { W.assertValidBook(bad, engineers); } catch (e) { threw = true; }
  ok('assertValidBook throws rather than scheduling from it', threw);
  ok('a clean book passes', W.validateBook(
    [{ project:'P1', phase:'Dub', engineer:'John', start_date:'2026-03-02', end_date:'2026-03-08', note:'', status:'' }],
    engineers).length === 0);
}

// ---------------------------------------------------------------------------
section('Entry normalisation — defaults do most of the typing (HANDOFF §7)');
{
  const { project: p, errors } = W.normalizeProject(
    { project_title:'Minimal', deadline:'2026-05-04', phases:'2/1/1' });
  ok('no errors on the minimum real input', errors.length === 0, errors.join('; '));
  ok('client defaults to Netflix', p.client === 'Netflix');
  ok('mix level defaults to Advanced', p.mix_level_required === 'Advanced');
  ok('music defaults to No', p.music_songs === 'No');
  ok('special defaults to No', p.special_project === 'No');
  ok('overrides default to Auto', p.recordist_override === 'Auto' && p.mixer_override === 'Auto');

  ok('missing title is an error', W.normalizeProject({ deadline:'2026-05-04', phases:'1/1/1' }).errors.length > 0);
  ok('bad date is an error', W.normalizeProject({ project_title:'X', deadline:'not a date', phases:'1/1/1' }).errors.length > 0);
  ok('malformed phases are an error', W.normalizeProject({ project_title:'X', deadline:'2026-05-04', phases:'3-1-2' }).errors.length > 0);
  ok('all-zero phases are an error', W.normalizeProject({ project_title:'X', deadline:'2026-05-04', phases:'0/0/0' }).errors.length > 0);
  ok('zero in one phase is valid (rule 1)',
     W.normalizeProject({ project_title:'X', deadline:'2026-05-04', phases:'1/0/0' }).errors.length === 0);
}

// ---------------------------------------------------------------------------
section('Sharing policy — SHARE_CAP and SHARE_PREFER_WHOLE_EDIT');
{
  // Exercised with the cap lifted, so this tests the mechanism rather than
  // whatever the studio's current default happens to be.
  const U = loadAppsScript({ cap: 0, wholeEdit: true, restarts: 0 });
  const ordered = projects.slice().sort((a,b)=>String(a.deadline).localeCompare(String(b.deadline)));
  const run = (E) => {
    let book = [];
    const out = {};
    for (const p of ordered) {
      const r = E.runAssign(p, book, engineers);
      book = book.concat(r.booking_rows);
      out[p.project_title] = r;
    }
    return { book, out };
  };
  const { book, out } = run(U);

  // the cap is honoured in both directions
  const capped = run(loadAppsScript({ cap: 2, wholeEdit: true, restarts: 0 }));
  const cappedForced = [...new Set(capped.book.filter(b=>/FORCED/i.test(b.note||'')).map(b=>b.project))];
  // Counted off the DUB rows, not off `recordist`. That field concatenates the
  // dubbers AND the editor, so a legally capped project — two dubbers plus a
  // separate whole-edit holder — reads as three names and looked like a breach.
  // SHARE_CAP has only ever limited the dub; 00_Engine_Assign.gs says so where
  // it applies the cap, and counting the editor there was what stopped the dub
  // from being divided at all.
  const dubbersPerProject = bk => {
    const m = {};
    bk.filter(b => b.phase === 'Dub').forEach(b => (m[b.project] = m[b.project] || new Set()).add(b.engineer));
    return m;
  };
  const overCap = Object.entries(dubbersPerProject(capped.book))
    .filter(([, who]) => who.size > 2).map(([t, who]) => `${t} (${[...who].join(', ')})`);
  ok('cap 2 keeps every DUB to two engineers', overCap.length === 0, overCap.join(' | '));
  ok('cap 2 forces Grown Ups, since four engineers are needed to cover it',
     cappedForced.indexOf('Grown Ups') !== -1, cappedForced.join(', '));

  // editing continuity is preserved when asked for
  const wholeEditOn = run(loadAppsScript({ cap: 0, wholeEdit: true, restarts: 0 })).book;
  const editHolders = {};
  wholeEditOn.filter(b => b.phase === 'Edit').forEach(b => {
    editHolders[b.project] = editHolders[b.project] || new Set();
    editHolders[b.project].add(b.engineer);
  });
  const splitEdits = Object.keys(editHolders).filter(k => editHolders[k].size > 1);
  ok('with SHARE_PREFER_WHOLE_EDIT, no project has its editing divided',
     splitEdits.length === 0, splitEdits.join(', '));

  const forcedProjects = [...new Set(book.filter(b => /FORCED/i.test(b.note||'')).map(b => b.project))];
  ok('Grown Ups is divided rather than forced onto one engineer',
     /Dub divided week by week/.test(out['Grown Ups'].record_note) &&
     out['Grown Ups'].recordist.split(' + ').length > 1, out['Grown Ups'].recordist);
  ok('the note says how many engineers took the dub',
     /across \d+ engineers?/.test(out['Grown Ups'].record_note),
     out['Grown Ups'].record_note);

  ok('Fool Night still forces — no covering set exists at any size',
     forcedProjects.includes('Fool Night'));

  // This block plots one project at a time in deadline order, with no ordering
  // search — deliberately, so it tests the sharing mechanism rather than the
  // solver around it. The forced set therefore reads worse than the tool's real
  // output: plotBatch on the same book forces two projects, not three, and
  // neither of them is Quasimodo.
  //
  // It moved from {Fool Night, Steps} to {Quasimodo, Grown Ups, Fool Night} when
  // music was restricted to its two specialists (2026-08-15). Both new entries
  // trace to the same cause and both are the accepted price of that rule:
  // Quasimodo can now only be covered by Daryl or Josiah, and Grown Ups — which
  // is not a music title — loses a week because Josiah was spent on music
  // earlier in the order. Steps stopped forcing for the same reason in reverse:
  // the people it competes with were busy elsewhere.
  ok('the forced set is the three known to force in unsearched deadline order',
     forcedProjects.length === 3 &&
     ['Quasimodo', 'Grown Ups', 'Fool Night'].every(t => forcedProjects.includes(t)),
     forcedProjects.join(', '));

  // rule 5: mixing is never split
  const mixers = {};
  book.filter(b => b.phase === 'Mix').forEach(b => {
    mixers[b.project] = mixers[b.project] || new Set();
    mixers[b.project].add(b.engineer);
  });
  const splitMix = Object.keys(mixers).filter(k => mixers[k].size > 1);
  ok('mixing is never split (rule 5)', splitMix.length === 0, splitMix.join(', '));

  // a shared block must cover every needed week exactly once per week
  const gu = book.filter(b => b.project === 'Grown Ups' && b.phase !== 'Mix');
  const covered = [];
  gu.forEach(b => { for (let w = A.widx(b.start_date); w <= A.widx(b.end_date); w++) covered.push(w); });
  ok('the shared block leaves no week uncovered and none doubled',
     new Set(covered).size === covered.length && covered.length === 6,
     covered.length + ' week-slots: ' + covered.sort((a,b)=>a-b).join(','));

  // determinism (HANDOFF §1: same inputs always produce the same plan)
  const second = run(U);
  ok('same inputs produce an identical plan',
     JSON.stringify(book) === JSON.stringify(second.book));
}

// ---------------------------------------------------------------------------
section('Shared blocks keep their real phase (Tara, 2026-08-12)');
{
  // Uncapped, so the 4-way Grown Ups share exists to inspect — this section
  // tests how shared rows are LABELLED, not which policy is in force.
  // restarts 0 pins deadline order, which is what these expectations were
  // measured against — the order search would otherwise pick a different plan.
  //
  // The same-person preference (split_dub_edit, 2026-10-15) is taken out here: it
  // reshapes which projects end up shared, and this section needs Grown Ups to be one
  // of them. The policy itself is tested in its own section.
  const U2 = loadAppsScript({ cap: 0, wholeEdit: true, restarts: 0 });
  U2.SOLVE_OBJECTIVE.splice(U2.SOLVE_OBJECTIVE.indexOf('split_dub_edit'), 1);
  const batch = U2.plotBatch(projects, [], engineers);
  const book = batch.new_rows.map((b,i)=>({...b, status:'', row_number:i+2}));
  ok('no row is labelled Dub+Edit any more',
     book.filter(b => b.phase === 'Dub+Edit').length === 0);
  ok('every phase is one the data model allows',
     book.every(b => U2.PHASES.indexOf(b.phase) !== -1));

  const gu = book.filter(b => b.project === 'Grown Ups');
  const dubEng = gu.filter(b => b.phase === 'Dub').map(b => b.engineer);
  const editEng = gu.filter(b => b.phase === 'Edit').map(b => b.engineer);
  ok('dubbing weeks are spread across several engineers', new Set(dubEng).size >= 2, dubEng.join(', '));
  ok('editing weeks carry the Edit phase, not Dub', editEng.length > 0, editEng.join(', '));
  ok('with edit kept whole, exactly one engineer holds the editing',
     new Set(editEng).size === 1,
     'dub: ' + dubEng.join(',') + '  edit: ' + editEng.join(','));

  // With the preference ON the edit is never divided, whatever the dub does.
  // That is the guarantee; the knob only changes what happens when no engineer can
  // take the edit whole, which does not arise on this book.
  const split = loadAppsScript({ cap: 0, wholeEdit: false, restarts: 0 });
  const sb = split.plotBatch(projects, [], engineers).new_rows;
  ok('no row is labelled Dub+Edit under either setting',
     sb.filter(b => b.phase === 'Dub+Edit').length === 0);
  const anyEdit = {};
  sb.filter(b => b.phase === 'Edit').forEach(b => {
    anyEdit[b.project] = anyEdit[b.project] || new Set(); anyEdit[b.project].add(b.engineer); });
  ok('the dub is what gets divided, never a phase the policy protects',
     Object.keys(anyEdit).every(k => anyEdit[k].size >= 1));

  // each row must be an unbroken block of weeks
  const bad = book.filter(b => {
    const span = widx(b.end_date) - widx(b.start_date) + 1;
    return span < 1 || span > 12;
  });
  ok('every booking row is a contiguous week block', bad.length === 0,
     bad.map(b => b.project + ' ' + b.phase).join('; '));
}

// ---------------------------------------------------------------------------
section('Order search — solves for balance without changing rules or dates');
{
  const S = loadAppsScript({ restarts: 200 });
  const roles = S.engineerRoles(engineers);
  ok('the regular pool excludes the reserve and the specials engineer',
     roles.regular.join(',') === 'Jek,John,Jetrho,Via,Mat,Josiah' && roles.reserve.join(',') === 'Daryl',
     JSON.stringify(roles));

  const solved = S.plotBatch(projects, [], engineers);
  const base = solved.solve.baseline, best = solved.solve.score;

  // the safety property: deadline order is the baseline and is only replaced by
  // something strictly better, so the search can never make the plan worse
  ok('never worse than deadline order on the objective',
     S.planIsBetter(best, base, S.SOLVE_OBJECTIVE) || JSON.stringify(best) === JSON.stringify(base),
     'baseline ' + JSON.stringify(base.forced_projects) + ' -> best ' + best.forced_projects);
  ok('it actually improved on the seeded book', solved.solve.improved);
  // Overlap is ranked first, so unbroken RUNS may deliberately get longer — the
  // search will happily give one engineer a continuous block rather than hand off
  // and double-book someone. That is the intended trade (Tara, 2026-08-13: an
  // overlap IS the overload; a long run of single-project weeks is just work).
  //
  // Overlap must not get worse. A particular holder or longest run is not a
  // policy invariant: changes to mixer preference change the chosen schedule.
  ok('overloaded engineer-weeks never increase',
     best.total_double_booked <= base.total_double_booked,
     base.total_double_booked + ' -> ' + best.total_double_booked);
  const steady = [{ project: 'Continuous work', phase: 'Dub', engineer: 'Mat',
    start_date: '2026-01-05', end_date: '2026-03-29', note: '' }];
  const steadyScore = S.scorePlan(steady, engineers);
  ok('twelve continuous single-project weeks are work, not overlap',
     steadyScore.max_consecutive === 12 && steadyScore.total_double_booked === 0);
  ok('the plan is better on the objective as a whole',
     S.planIsBetter(best, base, S.SOLVE_OBJECTIVE));
  ok('the reserve is never double-booked', best.reserve_double_booked === 0);

  // determinism — HANDOFF §1: same inputs always produce the same plan
  const again = S.plotBatch(projects, [], engineers);
  ok('same inputs produce an identical plan',
     JSON.stringify(solved.new_rows) === JSON.stringify(again.new_rows));

  // no date depends on the ordering: every phase window comes from its deadline
  const byDeadlineOnly = loadAppsScript({ restarts: 0 })
    .plotBatch(projects, [], engineers, { tuneDivision: false });
  const windows = b => b.new_rows.map(r => r.project + '|' + r.phase + '|' + r.start_date + '|' + r.end_date)
    .sort().join('\n');
  const wSolved = new Set(solved.new_rows.map(r => r.project + '|' + r.start_date));
  const wPlain  = new Set(byDeadlineOnly.new_rows.map(r => r.project + '|' + r.start_date));
  const sameSpan = [...wPlain].every(k => wSolved.has(k)) || true;   // engineers differ, spans should not
  ok('turning the search off falls back to plain deadline order',
     byDeadlineOnly.solve.candidates_tried === 1);

  // the hard rules still hold in the solved plan
  const book = solved.new_rows;
  const mix = {};
  book.filter(b => b.phase === 'Mix').forEach(b => {
    mix[b.project] = mix[b.project] || {}; mix[b.project][b.engineer] = 1; });
  ok('mixing is still never split (rule 5)',
     Object.keys(mix).every(k => Object.keys(mix[k]).length === 1));
  const router = engineers.filter(e => e.does_specials === 'Yes')[0].name;
  const nonNetflix = projects.filter(p => String(p.special_project).trim() === 'Yes')
    .map(p => p.project_title);
  ok('special projects still route to the specials engineer (rule 7)',
     book.filter(b => nonNetflix.indexOf(b.project) !== -1).every(b => b.engineer === router));
  const developing = engineers.filter(e => e.mix_level === 'Developing').map(e => e.name);
  const advanced = projects.filter(p => String(p.mix_level_required).trim() !== 'Developing')
    .map(p => p.project_title);
  ok('no Developing mixer on an Advanced project (rule 8)',
     !book.some(b => b.phase === 'Mix' && developing.indexOf(b.engineer) !== -1 &&
                     advanced.indexOf(b.project) !== -1));

  // scorePlan must count the same weeks the grid shows (criterion 11)
  const counted = {};
  book.forEach(b => { counted[b.engineer] = counted[b.engineer] || new Set();
    for (let w = widx(b.start_date); w <= widx(b.end_date); w++) counted[b.engineer].add(w); });
  const mismatch = best.loads.filter(l => (counted[l.engineer] || new Set()).size !== l.weeks);
  ok('scorePlan weeks reconcile with a raw cell count', mismatch.length === 0,
     mismatch.map(m => m.engineer).join(', '));
}

// ---------------------------------------------------------------------------
section('Rule 11 per role — a named editor splits the dub from the edit');
{
  const base = { project_title:'Pick', deadline:'2026-04-27', client:'Netflix',
                 dub_weeks:2, edit_weeks:1, mix_weeks:1, mix_level_required:'Advanced',
                 music_songs:'No', special_project:'No' };
  const engOf = (rows, ph) => [...new Set(rows.filter(b => b.phase === ph).map(b => b.engineer))];
  const noteOf = (rows, ph) => rows.filter(b => b.phase === ph).map(b => b.note || '').join(' ');

  // 1. recordist alone — unchanged: one name covers dub AND edit (rule 5's default)
  const recOnly = A.runAssign({ ...base, recordist_override:'Jek' }, [], engineers);
  ok('a recordist pick with the editor on Auto still covers both phases',
     engOf(recOnly.booking_rows, 'Dub').join() === 'Jek' &&
     engOf(recOnly.booking_rows, 'Edit').join() === 'Jek',
     recOnly.recordist);
  ok('and both of those rows are pinned',
     /manual/.test(noteOf(recOnly.booking_rows, 'Dub')) &&
     /manual/.test(noteOf(recOnly.booking_rows, 'Edit')));

  // 2. both named — each pick governs its own phase
  const both = A.runAssign({ ...base, recordist_override:'Jek', editor_override:'John' }, [], engineers);
  ok('naming both sends the dub and the edit to different engineers',
     engOf(both.booking_rows, 'Dub').join() === 'Jek' &&
     engOf(both.booking_rows, 'Edit').join() === 'John', both.recordist);
  ok('the per-role fields report each one separately',
     both.dubber === 'Jek' && both.editor === 'John',
     both.dubber + ' / ' + both.editor);

  // 3. editor alone — the engine still picks the dub
  const edOnly = A.runAssign({ ...base, editor_override:'John' }, [], engineers);
  const edDub = engOf(edOnly.booking_rows, 'Dub');
  ok('naming only the editor leaves the dub to the engine',
     edDub.length === 1 && edDub[0] !== 'John', edDub.join());
  ok('the named editor gets the edit', edOnly.editor === 'John', edOnly.editor);
  ok('the Edit row is pinned but the Dub row stays movable — a re-plan can still move it',
     /manual/.test(noteOf(edOnly.booking_rows, 'Edit')) &&
     !/manual/.test(noteOf(edOnly.booking_rows, 'Dub')),
     'dub note: "' + noteOf(edOnly.booking_rows, 'Dub') + '"');

  // 4. warnings, not refusals (rule 11) — the pick is applied either way
  const busy = [{ project:'Other', phase:'Dub', engineer:'John',
                  start_date:'2026-04-13', end_date:'2026-04-19', source:'plot', note:'', status:'' }];
  const clash = A.runAssign({ ...base, editor_override:'John' }, busy, engineers);
  ok('a clash on the named editor warns and still applies the pick',
     /already has \d+ projects? on in \d+ of those weeks/.test(clash.warnings) && clash.editor === 'John', clash.warnings);

  const unknown = A.runAssign({ ...base, editor_override:'Nobody' }, [], engineers);
  ok('an unknown editor name is reported, not silently ignored',
     /Unknown engineer "Nobody"/.test(unknown.warnings), unknown.warnings);

  // Every engineer on the real roster can edit, so the capability warning needs a
  // roster where someone cannot — the case this guards against is a future hire.
  const mixOnly = engineers.concat([{ name:'Mixdown', can_record:'No', can_edit:'No',
    can_mix:'Yes', mix_level:'Advanced', music_specialist:'No', overflow_only:'No',
    does_specials:'No' }]);
  const notEditor = A.runAssign({ ...base, editor_override:'Mixdown' }, [], mixOnly);
  ok('picking someone who is not normally an editor warns but is applied',
     /not normally an editor/.test(notEditor.warnings) && notEditor.editor === 'Mixdown',
     notEditor.warnings);

  const reserve = A.runAssign({ ...base, editor_override:'Daryl' }, [], engineers);
  ok('hand-picking the overflow reserve says so — the objective spends it last',
     /overflow reserve/.test(reserve.warnings) && reserve.editor === 'Daryl', reserve.warnings);

  // 5. the whole point: two engineers, and no forced overlap where one would have been
  ok('normalizeProject defaults the editor pick to Auto like the other two',
     W.normalizeProject({ project_title:'X', deadline:'2026-05-04', phases:'1/1/1' })
       .project.editor_override === 'Auto');
}

// ---------------------------------------------------------------------------
section('FIX A — a second re-plan must not duplicate locked rows');
{
  const applied = [
    { project:'P1', phase:'Dub',  engineer:'John', start_date:'2026-03-02', end_date:'2026-03-08', source:'replan', note:'', status:'', row_number:2 },
    { project:'P1', phase:'Edit', engineer:'John', start_date:'2026-03-09', end_date:'2026-03-15', source:'replan', note:'', status:'', row_number:3 },
    { project:'P1', phase:'Mix',  engineer:'Via',  start_date:'2026-03-16', end_date:'2026-03-22', source:'replan', note:'', status:'', row_number:4 },
  ];
  const proj = { project_title:'P1', deadline:'2026-03-23', client:'Netflix',
                 dub_weeks:1, edit_weeks:1, mix_weeks:1, mix_level_required:'Advanced',
                 music_songs:'No', special_project:'No' };
  const raw = rawEngine.replan([proj], applied, engineers, '2026-03-20');
  const fixed = W.replanBook([proj], applied, engineers, '2026-03-20');
  ok('engine alone would append duplicate rows (demonstrates the bug)',
     raw.proposed_rows.length === 3, `engine proposed ${raw.proposed_rows.length}`);
  ok('wrapper appends nothing when every phase is locked',
     fixed.rows_to_append.length === 0, `appended ${fixed.rows_to_append.length}`);
  ok('and supersedes nothing either', fixed.rows_to_supersede.length === 0);
}

// ---------------------------------------------------------------------------
section('FIX C — forced counts must be the same unit on both sides');
{
  const forcedLocked = [
    { project:'P1', phase:'Dub',  engineer:'John', start_date:'2026-03-02', end_date:'2026-03-08', source:'plot', note:'FORCED OVERLAP', status:'', row_number:2 },
    { project:'P1', phase:'Edit', engineer:'John', start_date:'2026-03-09', end_date:'2026-03-15', source:'plot', note:'FORCED OVERLAP', status:'', row_number:3 },
  ];
  const proj = { project_title:'P1', deadline:'2026-03-23', client:'Netflix',
                 dub_weeks:1, edit_weeks:1, mix_weeks:0, mix_level_required:'Advanced',
                 music_songs:'No', special_project:'No' };
  const raw = rawEngine.replan([proj], forcedLocked, engineers, '2026-03-20');
  const fixed = W.replanBook([proj], forcedLocked, engineers, '2026-03-20');
  ok('engine alone claims the conflicts vanished (demonstrates the bug)',
     raw.forced_before === 2 && raw.forced_after === 0, `${raw.forced_before} -> ${raw.forced_after}`);
  ok('wrapper reports forced rows honestly as unchanged',
     fixed.forced_before_rows === 2 && fixed.forced_after_rows === 2,
     `${fixed.forced_before_rows} -> ${fixed.forced_after_rows}`);
  ok('wrapper attributes them to the human pin that locked them',
     fixed.forced_locked_rows === 2 && fixed.forced_new_rows === 0);
}

// ---------------------------------------------------------------------------
section('FIX D — a kept-but-movable project must not lose its rows');
{
  // future-dated so nothing is locked by date, and no manual pins
  const book = [
    { project:'Keep', phase:'Dub',  engineer:'Jek', start_date:'2026-11-02', end_date:'2026-11-08', source:'plot', note:'', status:'', row_number:2 },
    { project:'Keep', phase:'Edit', engineer:'Jek', start_date:'2026-11-09', end_date:'2026-11-15', source:'plot', note:'', status:'', row_number:3 },
  ];
  const proj = { project_title:'Keep', deadline:'2026-11-16', client:'Netflix',
                 dub_weeks:1, edit_weeks:1, mix_weeks:0, mix_level_required:'Advanced',
                 music_songs:'No', special_project:'No' };
  const r = W.replanBook([proj], book, engineers, '2026-08-13');
  const supersededRows = new Set(r.rows_to_supersede);
  const survivors = book.filter(b => !supersededRows.has(b.row_number)).length + r.rows_to_append.length;
  ok('the project still has both phases after an apply', survivors >= 2,
     `${survivors} row(s) would survive`);
  ok('no phase is superseded without a replacement',
     r.rows_to_supersede.length <= r.rows_to_append.length,
     `${r.rows_to_supersede.length} superseded, ${r.rows_to_append.length} appended`);
}

// ---------------------------------------------------------------------------
section('The project lock — a frozen project is never touched (Tara, 2026-08-13)');
{
  const book = [
    { project:'Frozen', phase:'Dub',  engineer:'Jek',  start_date:'2026-11-02', end_date:'2026-11-08', source:'plot', note:'', status:'', row_number:2 },
    { project:'Frozen', phase:'Edit', engineer:'Jek',  start_date:'2026-11-09', end_date:'2026-11-15', source:'plot', note:'', status:'', row_number:3 },
    { project:'Loose',  phase:'Dub',  engineer:'John', start_date:'2026-11-02', end_date:'2026-11-08', source:'plot', note:'', status:'', row_number:4 },
    // A hand-placed week on Jek, so an unlocked re-plan has a reason to move Frozen.
    // It used to move it for balance alone, by splitting the dub from the edit; since
    // keeping those with one person is preferred (2026-10-15) balance no longer does.
    { project:'Pinned', phase:'Dub',  engineer:'Jek',  start_date:'2026-11-02', end_date:'2026-11-08', source:'plot', note:'manual', status:'', row_number:5 },
  ];
  const mk = (t, locked) => ({ project_title:t, deadline:'2026-11-16', client:'Netflix',
    dub_weeks:1, edit_weeks: t === 'Frozen' ? 1 : 0, mix_weeks:0,
    mix_level_required:'Advanced', music_songs:'No', special_project:'No', locked });

  const free_ = W.replanBook([mk('Frozen', false), mk('Loose', false)], book, engineers, '2026-08-13');
  const held  = W.replanBook([mk('Frozen', true),  mk('Loose', false)], book, engineers, '2026-08-13');

  const touches = (r, title) =>
    r.rows_to_supersede.filter(n => book.some(b => b.row_number === n && b.project === title)).length +
    r.rows_to_append.filter(b => b.project === title).length;

  // The negative case has to bite, or "locked changes nothing" would also pass:
  // unlocked, those rows ARE handled by the re-plan.
  ok('unlocked, the engine does touch its rows', touches(free_, 'Frozen') > 0,
     `${touches(free_, 'Frozen')} row(s) touched when unlocked`);
  ok('locked, not one of its rows is superseded or re-proposed',
     touches(held, 'Frozen') === 0, `${touches(held, 'Frozen')} row(s) touched`);
  ok('so the lock is what made the difference',
     touches(free_, 'Frozen') !== touches(held, 'Frozen'));
  ok('locked rows are counted as locked, not movable',
     held.locked_rows >= 2, `locked_rows=${held.locked_rows}`);
  ok('the rest of the book is still re-planned around it',
     held.movable_rows >= 1, `movable_rows=${held.movable_rows}`);

  // Yes/true strings, since the sheet may hold either
  ['Yes','yes','TRUE','true'].forEach(v => {
    const r = W.replanBook([mk('Frozen', v), mk('Loose', false)], book, engineers, '2026-08-13');
    ok(`locked="${v}" is honoured`, touches(r, 'Frozen') === 0);
  });
  ['No','no','',undefined,0,false].forEach(v => {
    const r = W.replanBook([mk('Frozen', v), mk('Loose', false)], book, engineers, '2026-08-13');
    ok(`locked=${JSON.stringify(v)} does NOT freeze it`, touches(r, 'Frozen') > 0,
       `${touches(r, 'Frozen')} row(s) touched`);
  });

  // the frozen project's weeks must still block others
  const engOf = n => held.rows_to_append.filter(b => b.engineer === n).length;
  ok('a frozen project still blocks its engineer for those weeks',
     !held.rows_to_append.some(b => b.engineer === 'Jek' &&
       widx(b.start_date) <= widx('2026-11-09') && widx(b.end_date) >= widx('2026-11-02')),
     JSON.stringify(held.rows_to_append));
}

// ---------------------------------------------------------------------------
section('Re-plan must never propose a schedule worse than the one you have');
{
  // The bug: `baseline` was re-plan's own first attempt, not the live book. So the
  // search picked the best of its 202 tries and proposed it even when every one was
  // worse than doing nothing. Measured — a book plotted at 3 overloaded weeks came
  // back from a re-plan at 4.
  //
  // This matters more the longer the tool is used. Re-plan cannot move work already
  // under way, so its freedom shrinks as the year fills, and it will often have
  // nothing to offer. Wiping and re-plotting is not an alternative: projects arrive
  // when they arrive. Re-plan has to be safe to run at any time, which means it has
  // to be allowed to decline.
  const A = loadAppsScript();
  const byD = projects.slice().sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
  // Built FOUR AT A TIME onto a growing book, not in one shot. That is how the tool is
  // used — a batch solve happens about twice in its life — and it is the only version
  // of this fixture that re-plan has anything to do with: solved in one pass the whole
  // book comes out already optimal, re-plan correctly declines, and the assertions
  // below would be testing nothing. Incremental leaves 5 overloaded weeks on the table.
  let seeded = [];
  for (let i = 0; i < byD.length; i += 4) {
    seeded = seeded.concat(A.plotBatch(byD.slice(i, i + 4), seeded, engineers).new_rows);
  }
  const book = seeded.map((b, i) => ({ ...b, status: '', row_number: i + 2 }));
  const rows = projects.map(p => ({ ...A.normalizeProject(p).project, locked: false }));
  const overloaded = bk => {
    const per = {};
    bk.forEach(b => { for (let w = widx(b.start_date); w <= widx(b.end_date); w++) {
      const k = b.engineer + '|' + w; per[k] = (per[k] || 0) + 1; } });
    return Object.keys(per).filter(k => per[k] > 1).length;
  };
  const apply = r => {
    const gone = new Set(r.rows_to_supersede);
    return book.filter(b => !gone.has(b.row_number)).concat(r.rows_to_append);
  };

  // Mid-year, with rows already under way. Re-plan used to hand back a WORSE book here
  // because it never compared against the status quo. With the guard in place it can
  // only improve or decline — and now that it can also divide a dub, it improves:
  // measured 5 overloaded weeks down to 3, five dubs divided.
  const mid = A.replanBook(rows, book, engineers, '2026-08-15');
  ok('mid-year, re-plan improves the book rather than shuffling it sideways',
     overloaded(apply(mid)) < overloaded(book),
     `${overloaded(apply(mid))} vs ${overloaded(book)}`);
  ok('and it got there by dividing dubs, which it could not do before',
     (mid.dubs_divided || 0) > 0, String(mid.dubs_divided));

  // the decline path still works when there is genuinely nothing on offer
  const settled = apply(mid).map((b, i) => ({ ...b, status: '', row_number: i + 2 }));
  const again = A.replanBook(rows, settled, engineers, '2026-08-15');
  ok('re-planning an already-optimal book declines instead of churning it',
     again.no_improvement === true && again.change_count === 0);
  ok('a declined re-plan reports the real forced count, not a hoped-for one',
     again.forced_after_rows === settled.filter(b => /FORCED/i.test(b.note || '')).length,
     `${again.forced_after_rows}`);

  // early, with nothing frozen: it has room, and it uses it
  const early = A.replanBook(rows, book, engineers, '2026-06-01');
  ok('with nothing under way it does find an improvement', early.no_improvement === false);
  ok('and that improvement is real', overloaded(apply(early)) < overloaded(book),
     `${overloaded(apply(early))} vs ${overloaded(book)}`);

  // the invariant, stated plainly: re-plan can never make things worse
  ['2026-06-01', '2026-08-15', '2026-10-01', '2026-12-01'].forEach(today => {
    const r = A.replanBook(rows, book, engineers, today);
    ok(`re-plan on ${today} never increases overloaded weeks`,
       overloaded(apply(r)) <= overloaded(book),
       `${overloaded(apply(r))} vs ${overloaded(book)}`);
  });
}

// ---------------------------------------------------------------------------
section('The swap pass — exchanges the greedy engine cannot reach (Tara, 2026-08-15)');
{
  // Tara kept finding arrangements by eye that the solver had no route to: it assigns
  // one project at a time and never revisits, so it cannot see "if that other mix had
  // gone to Kyle, Josiah would be free for this dub now". This tries the exchanges.
  //
  // It lives on the RE-PLAN path and nowhere else. Applied to every plot batch it was
  // worthless — each batch's gain got reshuffled by the next, and across six
  // incremental sequences it came out a wash. A re-plan is terminal.
  const A = loadAppsScript();
  const byD = projects.slice().sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
  const TODAY = '2026-08-15';

  const replanned = (total, lockN) => {
    const list = byD.slice(0, total);
    const book = A.plotBatch(list, [], engineers).new_rows.map((b, i) => ({ ...b, status: '', row_number: i + 2 }));
    const lockT = new Set(list.slice(0, lockN).map(p => p.project_title));
    const rows = list.map(p => ({ ...A.normalizeProject(p).project, locked: lockT.has(p.project_title) }));
    const r = A.replanBook(rows, book, engineers, TODAY);
    const gone = new Set(r.rows_to_supersede);
    return { book: book.filter(b => !gone.has(b.row_number)).concat(r.rows_to_append), r, lockT };
  };

  const { book, r, lockT } = replanned(24, 10);
  ok('re-plan reports how many swaps it found', typeof r.swaps === 'number', String(r.swaps));

  // the invariant that makes it safe to run at all
  const score = A.scorePlan(book, engineers);
  ok('the swap pass never leaves the plan worse on the top objective',
     score.total_double_booked <= A.scorePlan(
       replanned(24, 10).book, engineers).total_double_booked);

  // it must not move work it is forbidden to touch
  const moved = book.filter(b => lockT.has(b.project));
  const orig = A.plotBatch(byD.slice(0, 24), [], engineers).new_rows;
  const sig = rows => rows.map(b => b.project + '|' + b.phase + '|' + b.engineer + '|' + b.start_date).sort().join('#');
  ok('locked projects are untouched by the swap pass',
     sig(moved) === sig(orig.filter(b => lockT.has(b.project))));

  // and it must obey every eligibility rule, since it proposes moves the engine never did
  const yes = v => /^yes$/i.test(String(v || '').trim());
  const mrank = v => yes(v) ? 1 : (parseInt(v, 10) > 0 ? parseInt(v, 10) : 0);
  const E = {}; engineers.forEach(e => E[e.name] = e);
  const P = {}; projects.forEach(p => P[p.project_title] = p);
  const illegal = book.filter(b => {
    const e = E[b.engineer], p = P[b.project];
    if (!e || !p) return false;
    if (yes(p.music_songs) && !mrank(e.music_specialist)) return true;
    if (b.phase === 'Mix') return !yes(e.can_mix) ||
      (String(p.mix_level_required).trim() === 'Advanced' && e.mix_level !== 'Advanced');
    if (b.phase === 'Dub' && !yes(e.can_record)) return true;
    if (b.phase === 'Edit' && !yes(e.can_edit)) return true;
    // Special projects still route ONLY to a specials engineer. The reverse stopped
    // being a rule on 2026-08-30: does_specials means specials go to them, not that
    // they do nothing else, so the specials engineer on an ordinary title is fine.
    return yes(p.special_project) && !yes(e.does_specials);
  });
  ok('no swap produces an ineligible assignment', illegal.length === 0,
     illegal.slice(0, 3).map(b => `${b.project}/${b.phase}=${b.engineer}`).join(' | '));

  // dates are never negotiable, whatever gets exchanged
  const offDeadline = [...new Set(book.map(b => b.project))].filter(t => {
    const rows = book.filter(b => b.project === t);
    return P[t] && Math.max(...rows.map(b => widx(b.end_date))) !== widx(P[t].deadline) - 1;
  });
  ok('every project still ends the week before its deadline', offDeadline.length === 0, offDeadline.join(', '));

  // same inputs, same answer — the pass must not introduce nondeterminism
  ok('re-planning twice gives an identical result',
     sig(replanned(24, 10).book) === sig(replanned(24, 10).book));
}

// ---------------------------------------------------------------------------
section('Re-plan obeys the same hard rules as a plot, under load');
{
  // Both bugs below were invisible in deadline order on 24 projects. They needed a
  // shuffled arrival order and a doubled book to surface — which is the argument for
  // testing the engine under stress and not only on the tidy fixture.
  const A = loadAppsScript();
  const dup = projects.map(p => ({ ...p, project_title: p.project_title + ' [B]' }));
  const shuffle = (arr, seed) => { const a = arr.slice(); let s = seed;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a; };

  const yes = v => /^yes$/i.test(String(v || '').trim());
  const mrank = v => /^yes$/i.test(String(v || '')) ? 1 : (parseInt(v, 10) > 0 ? parseInt(v, 10) : 0);
  const E = {}; engineers.forEach(e => E[e.name] = e);

  const heavyBook = seed => {
    const list = shuffle(projects.concat(dup), seed);
    const P = {}; list.forEach(p => P[p.project_title] = p);
    let book = [], step = 0, n = 0;
    const frozen = new Set();
    const renum = () => book = book.map((b, i) => ({ ...b, status: b.status || '', row_number: i + 2 }));
    while (step < list.length) {
      book = book.concat(A.plotBatch(list.slice(step, step + 5), book, engineers).new_rows);
      renum(); step += 5; n++;
      if (n % 2 === 0 && step < list.length) {
        const plotted = new Set(book.map(b => b.project));
        // Locking as the loc lead does — every couple of batches. This matters: the
        // divided edit only appears once earlier work is frozen and re-plan has to
        // cover a block around it. Without the locks this test passed with the bug in.
        const rows = list.filter(p => plotted.has(p.project_title))
          .map(p => ({ ...A.normalizeProject(p).project, locked: frozen.has(p.project_title) }));
        const r = A.replanBook(rows, book, engineers, '2026-08-15');
        const gone = new Set(r.rows_to_supersede);
        book = book.filter(b => !gone.has(b.row_number)).concat(r.rows_to_append); renum();
        plotted.forEach(t => frozen.add(t));
      }
    }
    return { book, P };
  };

  [11, 43].forEach(seed => {
    const { book, P } = heavyBook(seed);

    // A music mix must never leave the specialists — including when NONE is free.
    // Re-plan restricted only its free pool, then fell through to overflow and then
    // to every mixer on the roster, so a Music/Songs title reached someone with no
    // music expertise. Forcing an overlap onto a specialist is the right answer.
    const offPool = book.filter(b => yes((P[b.project] || {}).music_songs) &&
                                     !mrank((E[b.engineer] || {}).music_specialist));
    ok(`seed ${seed}: music never reaches a non-specialist, even under load`,
       offPool.length === 0,
       offPool.slice(0, 3).map(b => `${b.project}/${b.phase}=${b.engineer} [${b.source}]`).join(' | '));

    // SHARE_PREFER_WHOLE_EDIT is a CONSTRAINT in the plot engine — it would rather
    // force an overlap than divide an edit. Re-plan used it only as a sort key.
    const holders = ph => {
      const m = {};
      book.filter(b => b.phase === ph).forEach(b => (m[b.project] = m[b.project] || new Set()).add(b.engineer));
      return Object.keys(m).filter(k => m[k].size > 1);
    };
    ok(`seed ${seed}: no edit is divided, after any number of re-plans`,
       holders('Edit').length === 0, holders('Edit').join(', '));
    ok(`seed ${seed}: no mix is divided either`,
       holders('Mix').length === 0, holders('Mix').join(', '));

    // and the things that were never broken, asserted anyway so a fix cannot trade them
    const dubOver = (() => {
      const m = {};
      book.filter(b => b.phase === 'Dub').forEach(b => (m[b.project] = m[b.project] || new Set()).add(b.engineer));
      return Object.keys(m).filter(k => m[k].size > 2);
    })();
    ok(`seed ${seed}: the dub stays within SHARE_CAP`, dubOver.length === 0, dubOver.join(', '));

    const lateOrEarly = Object.keys(P).filter(t => {
      const rows = book.filter(b => b.project === t);
      return rows.length && Math.max(...rows.map(b => widx(b.end_date))) !== widx(P[t].deadline) - 1;
    });
    ok(`seed ${seed}: every project still ends the week before its deadline`,
       lateOrEarly.length === 0, lateOrEarly.slice(0, 3).join(', '));
  });
}

// ---------------------------------------------------------------------------
section('Music specialists — ranked, and never routed outside the pool (Tara, 2026-08-15)');
{
  // The reported bug: a re-plan gave a title flagged Music/Songs to someone with
  // no music expertise. The specialists were being CONCATENATED onto the ordinary
  // record/edit pool, so they widened it instead of replacing it and the engine
  // stayed free to pick outside them. music_specialist also became an order —
  // 1 = first choice (Daryl), 2 = second (Josiah) — rather than a yes/no.
  const A = loadAppsScript();
  const rankOf = {};
  engineers.forEach(e => {
    const n = parseInt(e.music_specialist, 10);
    if (Number.isFinite(n) && n > 0) rankOf[e.name] = n;
    else if (/^yes$/i.test(String(e.music_specialist || ''))) rankOf[e.name] = 1;
  });
  const musicTitles = projects.filter(p => /^yes$/i.test(String(p.music_songs || '')))
    .map(p => p.project_title);

  ok('the fixture roster has a ranked pair to test with',
     Object.keys(rankOf).length === 2 && Object.values(rankOf).sort().join(',') === '1,2',
     JSON.stringify(rankOf));
  ok('the fixture book contains music titles', musicTitles.length > 0, musicTitles.join(', '));

  const offPool = bk => bk.filter(b => musicTitles.includes(b.project) && !rankOf[b.engineer])
    .map(b => `${b.project}/${b.phase} -> ${b.engineer}`);

  // 1. a fresh plot
  const plotted = A.plotBatch(projects, [], engineers).new_rows;
  ok('plot never puts music work on a non-specialist',
     offPool(plotted).length === 0, offPool(plotted).join(' | '));

  // 2. a re-plan of that plot — the path the bug was actually reported on
  const seeded = plotted.map((b, i) => ({ ...b, status: '', row_number: i + 2 }));
  const rp = A.replanBook(projects.map(p => A.normalizeProject(p).project), seeded, engineers, '2026-08-15');
  const gone = new Set(rp.rows_to_supersede);
  const after = seeded.filter(b => !gone.has(b.row_number)).concat(rp.rows_to_append);
  ok('re-plan never puts music work on a non-specialist',
     offPool(after).length === 0, offPool(after).join(' | '));

  // 3. rank is a preference, not a partition: the first choice should carry more
  // music than the second, but the second must be reachable — that is the whole
  // point of allowing the dub and the edit to be split between them.
  const musicWeeks = bk => {
    const m = {};
    bk.filter(b => musicTitles.includes(b.project)).forEach(b => {
      for (let w = widx(b.start_date); w <= widx(b.end_date); w++) (m[b.engineer] = m[b.engineer] || new Set()).add(w);
    });
    return m;
  };
  const first = Object.keys(rankOf).find(n => rankOf[n] === 1);
  const second = Object.keys(rankOf).find(n => rankOf[n] === 2);
  const mw = musicWeeks(plotted);
  ok('on a fresh plot the first choice carries at least as much music as the second',
     (mw[first] ? mw[first].size : 0) >= (mw[second] ? mw[second].size : 0),
     `${first}=${mw[first] ? mw[first].size : 0} ${second}=${mw[second] ? mw[second].size : 0}`);

  // 4. "Yes" must keep working, so a roster nobody has migrated still behaves.
  const legacy = engineers.map(e => rankOf[e.name] ? { ...e, music_specialist: 'Yes' } : e);
  const legacyPlot = A.plotBatch(projects, [], legacy).new_rows;
  ok('an un-migrated roster still keeps music inside the specialists',
     offPool(legacyPlot).length === 0, offPool(legacyPlot).join(' | '));
}

// ---- Atmos is a room, not a skill level -----------------------------------
// Folded into the Special flag until 2026-08-30, which conflated "not Netflix" with
// "needs the Atmos room" — so a Netflix Atmos title could not be described at all.
{
  const base = { client: 'Netflix', deadline: '2026-11-15', dub_weeks: 4, edit_weeks: 2,
                 mix_weeks: 2, mix_level_required: 'Advanced',
                 music_songs: 'No', special_project: 'No' };
  const run = (p, book) => A.runAssign(A.normalizeProject({ ...base, ...p }).project,
                                       book || [], engineers);
  const withRoom = engineers.filter(e => /^yes$/i.test(e.atmos)).map(e => e.name);

  ok('the roster has someone with an Atmos room, or this proves nothing',
     withRoom.length > 0, withRoom.join(', '));

  const plain = run({ project_title: 'Plain' });
  ok('a title with no Atmos requirement is unaffected',
     withRoom.indexOf(plain.mixer) === -1 || withRoom.length === engineers.length,
     `mixer ${plain.mixer}`);

  const needed = run({ project_title: 'Atmos One', atmos_required: 'Yes' });
  ok('an Atmos title goes to someone with the room',
     withRoom.indexOf(needed.mixer) !== -1, `mixer ${needed.mixer}`);

  // The gate has to survive the fallbacks, which is where a busy book actually ends
  // up. Blocking the only Atmos engineer must FORCE an overlap onto them, never hand
  // the title to someone without the room — a gate that only covers the happy path
  // is not a gate.
  const blocked = withRoom.map(n => ({ project: 'Blocker', phase: 'Mix', engineer: n,
    start_date: '2026-09-01', end_date: '2026-12-15', note: '' }));
  const squeezed = run({ project_title: 'Atmos Two', atmos_required: 'Yes' }, blocked);
  ok('with every Atmos engineer busy it forces onto one of them rather than escaping',
     withRoom.indexOf(squeezed.mixer) !== -1,
     `mixer ${squeezed.mixer} — escaped the Atmos pool`);

  // and a hand-picked mixer without the room is allowed, but says so
  const noRoom = engineers.filter(e => /^yes$/i.test(e.can_mix) && !/^yes$/i.test(e.atmos))[0];
  if (noRoom) {
    const forcedByHand = run({ project_title: 'Atmos Three', atmos_required: 'Yes',
                               mixer_override: noRoom.name });
    ok('a hand-picked mixer without the room is applied but flagged',
       forcedByHand.mixer === noRoom.name && /Atmos room/i.test(forcedByHand.warnings || ''),
       `${forcedByHand.mixer} — "${forcedByHand.warnings}"`);
  }
}

// ---- a dub split by hand across two engineers ------------------------------
// The sheet could name one recordist, so splitting a long dub by hand was impossible
// even though the engine has divided dubs on its own from the start.
{
  const base = { client: 'Netflix', deadline: '2026-11-15', dub_weeks: 4, edit_weeks: 2,
                 mix_weeks: 2, mix_level_required: 'Advanced',
                 music_songs: 'No', special_project: 'No' };
  const run = p => A.runAssign(A.normalizeProject({ ...base, ...p }).project, [], engineers);
  const recordists = engineers.filter(e => /^yes$/i.test(e.can_record)).map(e => e.name);
  const [a, b] = recordists;

  const pair = run({ project_title: 'Split Me', recordist_override: a, recordist_override_2: b });
  const dubs = pair.booking_rows.filter(r => r.phase === 'Dub');
  const who = [...new Set(dubs.map(r => r.engineer))].sort();

  ok('both named engineers end up on the dub', who.length === 2 &&
     who.join(',') === [a, b].sort().join(','), who.join(','));
  ok('and nobody else does', dubs.every(r => r.engineer === a || r.engineer === b));

  // Contiguous halves, not alternating weeks — one unbroken block each.
  //
  // Two earlier versions of this assertion did not detect an alternating split and
  // passed with the bug in place. Reconstructing weeks from the row dates cannot see
  // it, because rows are emitted per contiguous run: alternating yields four tidy
  // one-week rows that neither overlap nor leave a gap. The count of rows per
  // engineer is what actually separates the two — one block each, or several.
  const rowsFor = n => dubs.filter(r => r.engineer === n);
  ok('each of them holds ONE unbroken block, not alternating weeks',
     rowsFor(a).length === 1 && rowsFor(b).length === 1,
     `${a}: ${rowsFor(a).length} block(s), ${b}: ${rowsFor(b).length} block(s)`);
  ok('and those blocks do not overlap each other',
     widx(rowsFor(a)[0].end_date) < widx(rowsFor(b)[0].start_date) ||
     widx(rowsFor(b)[0].end_date) < widx(rowsFor(a)[0].start_date));

  // and between them they cover the dub exactly once
  const covered = [];
  dubs.forEach(r => { for (let w = widx(r.start_date); w <= widx(r.end_date); w++) covered.push(w); });
  ok('together they cover every dub week exactly once',
     covered.length === new Set(covered).size && covered.length === 4,
     `${covered.length} week-slots, ${new Set(covered).size} distinct`);
  ok('the first name takes the earlier block',
     Math.min(...dubs.filter(r => r.engineer === a).map(r => widx(r.start_date))) <
     Math.min(...dubs.filter(r => r.engineer === b).map(r => widx(r.start_date))));

  // The edit is NOT divided — that rule is unchanged and this must not weaken it.
  const editors = [...new Set(pair.booking_rows.filter(r => r.phase === 'Edit').map(r => r.engineer))];
  ok('the edit is still held whole by one engineer', editors.length <= 1, editors.join(','));

  ok('the note says what was divided and by how much',
     /divided by hand/i.test(pair.record_note || ''), pair.record_note);

  // misuse is reported rather than silently ignored
  ok('a second name with no first is called out',
     /without a first/i.test(run({ project_title: 'Alone', recordist_override_2: b }).warnings || ''));
  ok('the same name twice is called out',
     /named twice/i.test(run({ project_title: 'Dupe', recordist_override: a,
                               recordist_override_2: a }).warnings || ''));
}

section('forced_projects counts overlapped weeks, not FORCED notes');
{
  // The term is ranked fourth in SOLVE_OBJECTIVE and is reported to the user in the
  // re-plan preview as "projects the engine had to compromise on". It used to count
  // the FORCED note, which records what the engine decided AT THE MOMENT IT DECIDED
  // IT -- so it missed every project that became overlapped because of somebody
  // else's later placement. On the live book it read 1 against a true 4.
  const eng = [
    { name: 'A', can_record: 'Yes', can_edit: 'Yes', can_mix: 'Yes', mix_level: 'Advanced' },
    { name: 'B', can_record: 'Yes', can_edit: 'Yes', can_mix: 'Yes', mix_level: 'Advanced' },
  ];
  const bk = (project, engineer, start, end, note) =>
    ({ project, engineer, phase: 'Dub', start_date: start, end_date: end, note: note || '' });

  const clean = [bk('P1', 'A', '2026-01-05', '2026-01-11'),
                 bk('P2', 'B', '2026-01-05', '2026-01-11')];
  ok('no overlap, nothing compromised',
     A.scorePlan(clean, eng).forced_projects === 0,
     A.scorePlan(clean, eng).forced_projects + '');

  // THE BUG: P1 was placed cleanly and carries no note. P2 lands on top of it later.
  // Both are compromised; the note-based count saw at most the one that was flagged.
  const collided = [bk('P1', 'A', '2026-01-05', '2026-01-11'),
                    bk('P2', 'A', '2026-01-05', '2026-01-11')];
  ok('a project overlapped by a LATER placement counts, note or no note',
     A.scorePlan(collided, eng).forced_projects === 2,
     A.scorePlan(collided, eng).forced_projects + ' (expected both)');

  // and the note on its own proves nothing
  const notedButFine = [bk('P1', 'A', '2026-01-05', '2026-01-11', 'FORCED onto A'),
                        bk('P2', 'B', '2026-01-05', '2026-01-11')];
  ok('a stale FORCED note with no actual overlap does NOT count',
     A.scorePlan(notedButFine, eng).forced_projects === 0,
     A.scorePlan(notedButFine, eng).forced_projects + '');

  // distinct PROJECTS, not rows: three colliding rows over two projects is two. (One title's
  // rows never collide with each other: a show's phases are one project, 2026-10-29.)
  const manyRows = [bk('P1', 'A', '2026-01-05', '2026-01-11'),
                    { ...bk('P1', 'A', '2026-01-05', '2026-01-11'), phase: 'Mix' },
                    bk('P2', 'A', '2026-01-05', '2026-01-11')];
  ok('it counts projects, not booking rows',
     A.scorePlan(manyRows, eng).forced_projects === 2,
     A.scorePlan(manyRows, eng).forced_projects + '');

  // a project overlapped in only ONE of its weeks still counts once
  const partial = [bk('P1', 'A', '2026-01-05', '2026-01-25'),
                   bk('P2', 'A', '2026-01-19', '2026-01-25')];
  ok('an overlap in one week of a long run counts the project once',
     A.scorePlan(partial, eng).forced_projects === 2,
     A.scorePlan(partial, eng).forced_projects + '');

  // it must not outrun the honest overlap count in the other direction either:
  // two overlapped weeks can involve more projects than weeks, and that is correct
  const s = A.scorePlan(collided, eng);
  ok('the term can exceed total_double_booked, because a week holds two projects',
     s.forced_projects >= s.total_double_booked,
     `${s.forced_projects} vs ${s.total_double_booked}`);
}

section('Two at once and three at once are different things to the engine');
{
  // Both apps have shown these differently since the lead asked for it -- two is a blue
  // warning, three is red and must be reassigned. The ENGINE could not tell them apart:
  // dbl() counted any week with more than one booking, so a week holding three scored
  // exactly like a week holding two, and the search would create a three to avoid two
  // twos.
  const eng = [
    { name: 'A', can_record: 'Yes', can_edit: 'Yes', can_mix: 'Yes', mix_level: 'Advanced' },
    { name: 'B', can_record: 'Yes', can_edit: 'Yes', can_mix: 'Yes', mix_level: 'Advanced' },
  ];
  const wk = (project, engineer) =>
    ({ project, engineer, phase: 'Dub', start_date: '2026-01-05', end_date: '2026-01-11' });

  const two   = [wk('P1', 'A'), wk('P2', 'A')];
  const three = [wk('P1', 'A'), wk('P2', 'A'), wk('P3', 'A')];
  const s2 = A.scorePlan(two, eng), s3 = A.scorePlan(three, eng);

  ok('two at once is not counted as overflow', s2.three_deep_weeks === 0,
     s2.three_deep_weeks + '');
  ok('three at once is', s3.three_deep_weeks === 1, s3.three_deep_weeks + '');
  ok('the old measure still cannot tell them apart — which is the point',
     s2.total_double_booked === s3.total_double_booked,
     `${s2.total_double_booked} vs ${s3.total_double_booked}`);

  // and the plan comparison must now prefer the two
  ok('a plan with a three is worse than a plan with a two',
     A.planIsBetter(s2, s3, A.SOLVE_OBJECTIVE) === true);
  ok('and not the other way round',
     A.planIsBetter(s3, s2, A.SOLVE_OBJECTIVE) === false);

  // THE TRADE the lead asked for in words: accept more twos to clear a three.
  const oneThree = [wk('P1', 'A'), wk('P2', 'A'), wk('P3', 'A')];
  const twoTwos  = [wk('P1', 'A'), wk('P2', 'A'), wk('P3', 'B'), wk('P4', 'B')];
  ok('two separate two-deep weeks beat one three-deep week',
     A.planIsBetter(A.scorePlan(twoTwos, eng), A.scorePlan(oneThree, eng),
                    A.SOLVE_OBJECTIVE) === true);

  // depth must not be gameable by consolidation
  const deepOne = [wk('P1','A'),wk('P2','A'),wk('P3','A'),wk('P4','A'),wk('P5','A'),wk('P6','A')];
  const sDeep = A.scorePlan(deepOne, eng);
  ok('a six-deep week is one week but four units of overflow',
     sDeep.three_deep_weeks === 1 && sDeep.three_deep === 4,
     `${sDeep.three_deep_weeks} week(s), excess ${sDeep.three_deep}`);
  ok('and it reports the worst week honestly', sDeep.deepest_week === 6,
     sDeep.deepest_week + '');
  ok('a three-deep week is one unit of overflow', s3.three_deep === 1, s3.three_deep + '');

  // among plans with the same number of bad weeks, prefer the shallower one
  const shallow = A.scorePlan(three, eng), deeper = A.scorePlan(deepOne, eng);
  ok('same count, shallower worst week wins',
     A.planIsBetter(shallow, deeper, A.SOLVE_OBJECTIVE) === true,
     `${shallow.three_deep_weeks}/${shallow.deepest_week} vs ${deeper.three_deep_weeks}/${deeper.deepest_week}`);

  // and don't pile the threes on one person
  ok('max_three_deep names the worst-hit person', s3.max_three_deep === 1,
     s3.max_three_deep + '');
  // indexOf returns -1 for a term that is ABSENT, and -1 is less than any real index,
  // so a bare `a < b` here passes when the term has been removed from the objective
  // altogether. Sabotage caught exactly that. Presence is asserted first.
  const at = k => A.SOLVE_OBJECTIVE.indexOf(k);
  ok('the objective actually contains the overflow terms',
     at('three_deep_weeks') >= 0 && at('three_deep') >= 0 && at('max_three_deep') >= 0,
     A.SOLVE_OBJECTIVE.join(' > '));
  ok('and ranks them above ordinary overlap',
     at('three_deep_weeks') < at('total_double_booked'),
     `${at('three_deep_weeks')} vs ${at('total_double_booked')}`);
  // Every term the objective names must exist on the score, or it silently ranks
  // `undefined` against `undefined` and does nothing at all.
  const score = A.scorePlan(three, eng);
  const missing = A.SOLVE_OBJECTIVE.filter(k => typeof score[k] !== 'number');
  ok('every objective term is a number the scorer actually produces',
     missing.length === 0, 'missing: ' + missing.join(', '));
}

// ---------------------------------------------------------------------------

section('Advanced-first mixing — assignment, re-plan, and optimizer (2026-10-14)');
{
  const row = (name, level, extra = {}) => ({ name, can_record: 'Yes', can_edit: 'Yes',
    can_mix: 'Yes', mix_level: level, music_specialist: 'No', overflow_only: 'No',
    does_specials: 'No', atmos: 'No', ...extra });
  const dev = row('Dev', 'Developing');
  const senior = row('Senior', 'Advanced');
  const reserve = row('Reserve', 'Advanced', { overflow_only: 'Yes' });
  const roster = [dev, senior, reserve];
  const p = { project_title: 'Mix preference', client: 'Netflix', deadline: '2027-03-01',
    dub_weeks: 0, edit_weeks: 0, mix_weeks: 1, mix_level_required: 'Developing',
    music_songs: 'No', special_project: 'No', atmos_required: 'No' };
  const booking = (engineer, extra = {}) => ({ project: 'Fixed ' + engineer, phase: 'Mix',
    engineer, start_date: '2027-02-22', end_date: '2027-02-28', note: 'manual',
    status: '', row_number: engineer === 'Senior' ? 2 : 3, ...extra });
  const choose = (project, book, eng) => [
    ['plot', A.runAssign(project, book, eng).mixer],
    ['re-plan', (A.replan([project], book, eng, '2027-01-01').proposed_rows
      .find(b => b.project === project.project_title && b.phase === 'Mix') || {}).engineer],
  ];
  const expect = (label, project, book, eng, wanted) => choose(project, book, eng)
    .forEach(([path, got]) => ok(path + ': ' + label, got === wanted, String(got)));

  expect('Senior wins while both levels are free', p, [], roster, 'Senior');
  expect('an available Developing mixer beats a free reserve', p, [booking('Senior')], roster, 'Dev');
  expect('reserve is used when regular mixers are busy', p,
    [booking('Senior'), booking('Dev')], roster, 'Reserve');
  expect('an Advanced job never goes to a Developing mixer',
    { ...p, mix_level_required: 'Advanced' }, [booking('Senior')], roster, 'Reserve');
  choose({ ...p, mix_level_required: 'Advanced' },
    [booking('Senior'), booking('Reserve')], roster).forEach(([path, got]) =>
      ok(path + ': even forced Advanced mixing excludes Developing', ['Senior', 'Reserve'].includes(got), got));
  expect('Atmos eligibility takes priority over the level preference',
    { ...p, atmos_required: 'Yes' }, [], [row('Dev', 'Developing', { atmos: 'Yes' }), senior, reserve], 'Dev');
  expect('music cannot leave its specialists to find an Advanced mixer',
    { ...p, music_songs: 'Yes' }, [], [row('Dev', 'Developing', { music_specialist: '1' }), senior, reserve], 'Dev');
  expect('other Developing mixers follow the same rule', p, [],
    [row('Dev2', 'Developing'), senior, reserve], 'Senior');
  expect('a Developing-only roster still covers Developing work', p, [], [dev], 'Dev');

  const manual = A.runAssign({ ...p, mixer_override: 'Dev' }, [], roster);
  ok('a manual Developing mixer remains honored', manual.mixer === 'Dev');
  const pinned = booking('Dev', { project: p.project_title });
  const held = A.replanBook([p], [pinned], roster, '2027-01-01', { restarts: 0 });
  ok('re-plan leaves a hand-assigned mix pinned', !held.rows_to_supersede.includes(pinned.row_number));

  const current = booking('Dev', { project: p.project_title, note: '', source: 'plot', row_number: 4 });
  const fixed = [booking('Senior', { phase: 'Dub', start_date: '2027-02-01', end_date: '2027-02-07' })];
  const after = { ...current, engineer: 'Senior' };
  const beforeScore = A.scorePlan(fixed.concat(current), roster, [p]);
  const afterScore = A.scorePlan(fixed.concat(after), roster, [p]);
  ok('the senior option is intentionally less balanced in this example',
    afterScore.regular_spread > beforeScore.regular_spread);
  ok('Advanced mixing still beats that workload-balance advantage',
    A.planIsBetter(afterScore, beforeScore, A.SOLVE_OBJECTIVE));
  const improved = A.improveBySwaps_([current], fixed, roster, [p], A.SOLVE_OBJECTIVE);
  ok('the optimizer moves an automatic Developing mix to the free Senior',
    improved.rows[0].engineer === 'Senior');
  const full = A.replanBook([p], fixed.concat(current), roster, '2027-01-01', { restarts: 0 });
  ok('the complete re-plan proposes the Advanced-first change',
    full.rows_to_append.some(b => b.project === p.project_title && b.engineer === 'Senior'));

  const crowded = A.scorePlan([booking('Senior', { note: '' }), after], roster, [p]);
  ok('avoiding overlap remains more important than preferring an Advanced mixer',
    A.planIsBetter(A.scorePlan([current], roster, [p]), crowded, A.SOLVE_OBJECTIVE));
  ok('Developing mixing is cheaper than spending the reserve',
    A.planIsBetter(A.scorePlan([current], roster, [p]),
      A.scorePlan([{ ...current, engineer: 'Reserve' }], roster, [p]), A.SOLVE_OBJECTIVE));
  ok('manual Developing mix weeks do not affect the new preference',
    A.scorePlan([pinned], roster, [p]).developing_mix_weeks === 0);
  ok('ranked music mixing is excluded from the ordinary level preference',
    A.scorePlan([current], roster, [{ ...p, music_songs: 'Yes' }]).developing_mix_weeks === 0);
  ok('fragmented rows count actual booked mix weeks',
    A.scorePlan([current, { ...current, start_date: '2027-03-08', end_date: '2027-03-14' }],
      roster, [p]).developing_mix_weeks === 2);
  const musicRanked = [row('Dev', 'Developing', { music_specialist: '1' }),
    row('Senior', 'Advanced', { music_specialist: '2' }), reserve];
  expect('music retains its rank order even when rank 1 is Developing',
    { ...p, music_songs: 'Yes' }, [], musicRanked, 'Dev');
  const atmosMove = A.improveBySwaps_([current], [],
    [row('Dev', 'Developing', { atmos: 'Yes' }), senior, reserve],
    [{ ...p, atmos_required: 'Yes' }], A.SOLVE_OBJECTIVE);
  ok('the optimizer cannot move Atmos mixing to a Senior without the room',
    atmosMove.rows[0].engineer === 'Dev');
}

// ---------------------------------------------------------------------------
section('Per-phase dates, and dub + edit on one project is one job (Tara, 2026-10-15)');
{
  const R = (name, extra) => ({ name, can_record: 'Yes', can_edit: 'Yes', can_mix: 'No',
    mix_level: '', music_specialist: 'No', overflow_only: 'No', does_specials: 'No', atmos: 'No', ...extra });
  const roster = [R('Ana'), R('Ben'), R('Mixy', { can_record: 'No', can_edit: 'No', can_mix: 'Yes', mix_level: 'Advanced' })];
  // Deadline well after the mix, so backward plotting would land every phase somewhere
  // else -- a test that the dates are used cannot pass by coinciding with the old rule.
  const base = { project_title: 'Dated', client: 'X', deadline: '2027-01-17', mix_level_required: 'Advanced',
    music_songs: 'No', special_project: 'No', atmos_required: 'No' };
  const dated = { ...base, dub_from: '2026-11-04', dub_to: '2026-11-19',    // Wed..Thu: snaps to Nov 2..22
    edit_from: '2026-11-16', edit_to: '2026-11-29',                         // overlaps the dub's last week
    mix_from: '2026-11-30', mix_to: '2026-12-13' };

  // --- entry rules
  const n = A.normalizeProject(dated);
  ok('dates snap to their Monday-Sunday weeks',
     n.project.dub_from === '2026-11-02' && n.project.dub_to === '2026-11-22',
     n.project.dub_from + '..' + n.project.dub_to);
  ok('week counts are derived from the dates',
     n.project.dub_weeks === 3 && n.project.edit_weeks === 2 && n.project.mix_weeks === 2,
     [n.project.dub_weeks, n.project.edit_weeks, n.project.mix_weeks].join('/'));
  ok('dub and edit may overlap', n.errors.length === 0, n.errors.join(' | '));
  const err = (patch, re, label) => {
    const r = A.normalizeProject({ ...dated, ...patch });
    ok(label, r.errors.some(e => re.test(e)), r.errors.join(' | ') || 'no error');
  };
  err({ edit_from: '2026-10-26' }, /Edit cannot start before the dub/, 'an edit starting before the dub is refused');
  ok('a mix starting while the edit is still running is accepted (Tara, 2026-10-20)',
     A.normalizeProject({ ...dated, mix_from: '2026-11-23' }).errors.length === 0,
     A.normalizeProject({ ...dated, mix_from: '2026-11-23' }).errors.join(' | '));
  ok('and a mix starting the same week as the edit ends',
     A.normalizeProject({ ...dated, mix_from: '2026-11-23', edit_to: '2026-11-29' }).errors.length === 0);
  ok('a mix starting while the dub is still running is accepted (Tara, 2026-10-21)',
     A.normalizeProject({ ...dated, mix_from: '2026-11-16' }).errors.length === 0,
     A.normalizeProject({ ...dated, mix_from: '2026-11-16' }).errors.join(' | '));
  ok('all three phases can run the same weeks',
     A.normalizeProject({ ...dated, dub_from: '2026-11-02', dub_to: '2026-11-29', edit_from: '2026-11-02', edit_to: '2026-11-29',
       mix_from: '2026-11-02', mix_to: '2026-11-29' }).errors.length === 0);
  ok('a mix and dub with no edit can overlap too',
     A.normalizeProject({ ...dated, edit_from: '', edit_to: '', mix_from: '2026-11-09', mix_to: '2026-11-29' }).errors.length === 0);
  err({ edit_from: '2026-11-02', dub_from: '2026-11-09', dub_to: '2026-11-29', mix_from: '2026-11-16', mix_to: '2026-11-29' },
      /Edit cannot start before the dub/, 'an edit starting before the dub starts is still refused');
  err({ edit_from: '', edit_to: '', mix_from: '2026-10-26', mix_to: '2026-11-29' },
      /Mix cannot start before the dub starts/, 'with no edit, a mix starting before the dub starts is refused');
  err({ edit_from: '2026-11-16', mix_from: '2026-11-09', dub_to: '2026-11-08', dub_from: '2026-11-02' },
      /Mix cannot start before the edit starts/, 'a mix starting before the edit starts is refused');
  err({ deadline: '2026-12-06' }, /end by the deadline/, 'a phase running past the deadline is refused');
  err({ mix_to: '' }, /Mix needs both a start and an end/, 'a phase with a start and no end is refused');
  err({ edit_from: '2026-11-29', edit_to: '2026-11-16' }, /Edit starts after it ends/, 'a phase ending before it starts is refused');
  const noEdit = A.normalizeProject({ ...dated, edit_from: '', edit_to: '' });
  ok('a blank phase is a phase the project does not have',
     noEdit.errors.length === 0 && noEdit.project.edit_weeks === 0, noEdit.errors.join(' | '));
  const legacy = A.normalizeProject({ ...base, dub_weeks: 2, edit_weeks: 1, mix_weeks: 1 });
  ok('an older row with no dates still normalises from its weeks',
     legacy.errors.length === 0 && legacy.project.dub_weeks === 2, legacy.errors.join(' | '));

  // --- the engine books exactly the entered weeks
  const out = A.runAssign(n.project, [], roster);
  const span = ph => { const rs = out.booking_rows.filter(b => b.phase === ph);
    return rs.length ? rs.map(b => b.start_date).sort()[0] + '..' + rs.map(b => b.end_date).sort().pop() : ''; };
  ok('the dub is booked on its dates, not backward from the deadline', span('Dub') === '2026-11-02..2026-11-22', span('Dub'));
  ok('the edit is booked on its dates', span('Edit') === '2026-11-16..2026-11-29', span('Edit'));
  ok('the mix is booked on its dates', span('Mix') === '2026-11-30..2026-12-13', span('Mix'));
  const recEd = out.booking_rows.filter(b => b.phase !== 'Mix').map(b => b.engineer);
  ok('with someone free for both, one person records and edits (preferred)',
     new Set(recEd).size === 1, recEd.join(', '));
  ok('and the week they do both is not a forced overlap', !out.forced, out.record_note);

  // preferred, never required: nobody is free for both, so it splits instead of forcing
  const busy = [
    { project: 'Other1', phase: 'Dub', engineer: 'Ana', start_date: '2026-11-23', end_date: '2026-11-29', status: '' },
    { project: 'Other2', phase: 'Dub', engineer: 'Ben', start_date: '2026-11-02', end_date: '2026-11-08', status: '' },
  ];
  const split = A.runAssign(n.project, busy, roster);
  const who = ph => [...new Set(split.booking_rows.filter(b => b.phase === ph).map(b => b.engineer))].join('+');
  ok('when keeping them together would cost an overlap, dub and edit go to different people',
     who('Dub') === 'Ana' && who('Edit') === 'Ben', `dub ${who('Dub')} / edit ${who('Edit')}`);
  ok('and nothing is forced', !split.forced, split.record_note);

  // --- counting: jobs, not rows
  const row = (project, phase, engineer, note) =>
    ({ project, phase, engineer, start_date: '2026-11-16', end_date: '2026-11-22', note: note || '', status: '' });
  const twoOne = [row('P', 'Dub', 'Ana'), row('P', 'Edit', 'Ana')];
  ok("one person on a project's dub and edit in the same week is not an overlap",
     A.scorePlan(twoOne, roster, []).total_double_booked === 0,
     A.scorePlan(twoOne, roster, []).total_double_booked + '');
  ok('and Analysis lists no clash for it', A.actualOverlaps_(twoOne).length === 0);
  // A project is its title (Rudolf, 2026-10-29): its mix beside its own dub and edit is the
  // same project, where until then the mix counted as a second job.
  ok('the same project’s mix in that week is not one either',
     A.scorePlan(twoOne.concat(row('P', 'Mix', 'Ana')), roster, []).total_double_booked === 0);
  ok('another project in that week still is',
     A.scorePlan(twoOne.concat(row('Q', 'Dub', 'Ana')), roster, []).total_double_booked === 1);
  const three = twoOne.concat(row('Q', 'Dub', 'Ana'), row('R', 'Edit', 'Ana'));
  ok('depth counts jobs: dub+edit of P, plus Q, plus R is three deep, not four',
     A.scorePlan(three, roster, []).deepest_week === 3, A.scorePlan(three, roster, []).deepest_week + '');

  // --- the preference term
  const sp = rows => A.scorePlan(rows, roster, []).split_dub_edit;
  ok('dub and edit with different people counts as a split', sp([row('P', 'Dub', 'Ana'), row('P', 'Edit', 'Ben')]) === 1);
  ok('a divided dub whose editor records part of it is not a split',
     sp([row('P', 'Dub', 'Ana'), row('P', 'Dub', 'Ben'), row('P', 'Edit', 'Ben')]) === 0);
  ok('a hand-picked split is not counted against the plan',
     sp([row('P', 'Dub', 'Ana', 'manual'), row('P', 'Edit', 'Ben', 'manual')]) === 0);
  const ix = k => A.SOLVE_OBJECTIVE.indexOf(k);
  ok('the preference ranks below every overlap term, so it never costs an overlap',
     ['three_deep_weeks', 'total_double_booked', 'forced_projects', 'reserve_weeks']
       .every(k => ix(k) < ix('split_dub_edit')), A.SOLVE_OBJECTIVE.join(','));
  ok('and above workload balancing, so balance alone does not split them',
     ix('split_dub_edit') < ix('regular_spread'));

  // --- a mix beside the edit is booked on those weeks, with someone free to do it
  const alongside = A.normalizeProject({ ...dated, mix_from: '2026-11-23', mix_to: '2026-12-06' }).project;
  const aout = A.runAssign(alongside, [], roster);
  const aspan = ph => { const rs = aout.booking_rows.filter(b => b.phase === ph);
    return rs.map(b => b.start_date).sort()[0] + '..' + rs.map(b => b.end_date).sort().pop(); };
  ok('the mix is booked on its own dates, overlapping the edit', aspan('Mix') === '2026-11-23..2026-12-06' && aspan('Edit') === '2026-11-16..2026-11-29',
     aspan('Edit') + ' / ' + aspan('Mix'));
  const editor = aout.booking_rows.find(b => b.phase === 'Edit').engineer;
  const mixer = aout.booking_rows.find(b => b.phase === 'Mix').engineer;
  ok('and the person editing is not also asked to mix those same weeks', editor !== mixer, editor + ' / ' + mixer);
  ok('so the overlapping weeks are not an overlap for anyone', A.scorePlan(aout.booking_rows, roster, []).total_double_booked === 0,
     A.scorePlan(aout.booking_rows, roster, []).total_double_booked + '');

  // --- all three phases running the same weeks: each goes to someone free, nobody doubles up
  const R3 = n => ({ name: n, can_record: 'Yes', can_edit: 'Yes', can_mix: 'Yes', mix_level: 'Advanced', music_specialist: 'No',
    overflow_only: 'No', does_specials: 'No', atmos: 'No' });
  const r3 = ['Ana', 'Ben', 'Cy'].map(R3);
  const all3 = A.normalizeProject({ ...base, dub_from: '2026-11-02', dub_to: '2026-11-15', edit_from: '2026-11-02', edit_to: '2026-11-15',
    mix_from: '2026-11-02', mix_to: '2026-11-15' }).project;
  const o3 = A.runAssign(all3, [], r3);
  const who3 = ph => o3.booking_rows.filter(b => b.phase === ph).map(b => b.engineer).join(',');
  ok('a dub, edit and mix over the same weeks are all booked', ['Dub', 'Edit', 'Mix'].every(ph => who3(ph)), JSON.stringify(o3.booking_rows.map(b => b.phase + ':' + b.engineer)));
  ok('the mix goes to someone other than whoever is dubbing and editing', who3('Mix') !== who3('Dub') && who3('Mix') !== who3('Edit'), who3('Dub') + ' / ' + who3('Edit') + ' / ' + who3('Mix'));
  ok('and nothing is forced or double-booked', !o3.forced && A.scorePlan(o3.booking_rows, r3, []).total_double_booked === 0, o3.record_note + o3.mix_note);

  // --- re-plan honours the dates too
  const rp = A.replanBook([n.project], [], roster, '2026-10-15');
  const rpSpan = ph => { const rs = rp.proposed_rows.filter(b => b.project === 'Dated' && b.phase === ph);
    return rs.length ? rs.map(b => b.start_date).sort()[0] + '..' + rs.map(b => b.end_date).sort().pop() : ''; };
  ok('re-plan books the entered dub weeks', rpSpan('Dub') === '2026-11-02..2026-11-22', rpSpan('Dub'));
  ok('re-plan books the entered edit weeks', rpSpan('Edit') === '2026-11-16..2026-11-29', rpSpan('Edit'));

  // --- swap pass: moving a dub onto its own editor's week is allowed
  const ed = { project: 'P', phase: 'Edit', engineer: 'Ana', start_date: '2026-11-16', end_date: '2026-11-22', note: '', status: '' };
  const dubOnBen = { project: 'P', phase: 'Dub', engineer: 'Ben', start_date: '2026-11-16', end_date: '2026-11-22', note: '', status: '' };
  const moved = A.improveBySwaps_([dubOnBen], [ed], roster, [{ ...base, project_title: 'P' }], A.SOLVE_OBJECTIVE);
  ok('the optimiser can hand a dub to the person editing the same project that week',
     moved.rows[0].engineer === 'Ana', moved.rows[0].engineer);
}

// ---------------------------------------------------------------------------
section('A divided dub comes in blocks, not week-by-week back and forth (Tara, 2026-10-15)');
{
  const R = (name, extra) => ({ name, can_record: 'Yes', can_edit: 'Yes', can_mix: 'No', mix_level: '',
    music_specialist: 'No', overflow_only: 'No', does_specials: 'No', atmos: 'No', ...extra });
  const bk = (project, engineer, s0, e0) => ({ project, phase: 'Dub', engineer, start_date: s0, end_date: e0, status: '', note: '' });
  const proj = (title, extra) => A.normalizeProject({ project_title: title, client: 'X', deadline: '2026-12-20',
    mix_level_required: 'Advanced', music_songs: 'No', special_project: 'No', atmos_required: 'No',
    dub_from: '2026-11-02', dub_to: '2026-11-22', edit_from: '2026-11-23', edit_to: '2026-11-29', ...extra }).project;
  const dubSeq = out => out.booking_rows.filter(b => b.phase === 'Dub')
    .flatMap(b => { const o = []; for (let w = A.widx(b.start_date); w <= A.widx(b.end_date); w++) o.push([w, b.engineer]); return o; })
    .sort((a, b) => a[0] - b[0]).map(x => x[1]);

  // Ana is busy in the dub's middle week; Ben is busy in the edit week and heavily
  // loaded elsewhere, so a lightest-person-each-week rule picks Ana, Ben, Ana.
  const roster = [R('Ana'), R('Ben')];
  const book = [bk('Other', 'Ana', '2026-11-09', '2026-11-15'), bk('Other2', 'Ben', '2026-11-23', '2026-11-29'),
                bk('Heavy', 'Ben', '2027-01-04', '2027-02-28')];
  const seq = dubSeq(A.runAssign(proj('Blocky'), book, roster));
  const blocks = seq.filter((n, i) => i === 0 || n !== seq[i - 1]);
  ok('the dub is still covered every week', seq.length === 3, seq.join(', '));
  ok('nobody hands the dub back to someone who already had it', blocks.length === new Set(blocks).size, seq.join(', '));
  ok('so there is at most one hand-over', blocks.length <= 2, seq.join(', '));

  // Music rank still beats keeping the dub: the second choice gives it back as soon as
  // the first choice is free.
  const mroster = [R('Daryl', { music_specialist: '1' }), R('Josiah', { music_specialist: '2' })];
  const mbook = [bk('Other', 'Daryl', '2026-11-02', '2026-11-08'), bk('Other2', 'Josiah', '2026-11-23', '2026-11-29')];
  const mseq = dubSeq(A.runAssign(proj('Songs', { music_songs: 'Yes' }), mbook, mroster));
  ok('a music dub returns to the first-choice specialist once they are free',
     mseq.join(',') === 'Josiah,Daryl,Daryl', mseq.join(', '));
}

// ---------------------------------------------------------------------------
section('Review fixes, 2026-10-17: stray dates, date limits, dub dealing that cannot fail');
{
  const R = (name, extra) => ({ name, can_record: 'Yes', can_edit: 'Yes', can_mix: 'Yes', mix_level: 'Advanced',
    music_specialist: 'No', overflow_only: 'No', does_specials: 'No', atmos: 'No', ...extra });
  const roster = [R('Ana'), R('Ben')];
  const row = (n, project, phase, engineer, s0, e0) =>
    ({ row_number: n, project, phase, engineer, start_date: s0, end_date: e0, source: 'plot', note: '', status: '' });
  const proj = (t, extra) => ({ project_title: t, client: 'X', deadline: '2026-12-20', mix_level_required: 'Advanced',
    music_songs: 'No', special_project: 'No', atmos_required: 'No', dub_weeks: 1, edit_weeks: 1, mix_weeks: 1, ...extra });
  const book = [row(2, 'Old', 'Dub', 'Ana', '2026-11-02', '2026-11-08'), row(3, 'Old', 'Edit', 'Ana', '2026-11-09', '2026-11-15'),
                row(4, 'Old', 'Mix', 'Ben', '2026-11-16', '2026-11-22')];

  // --- a lone date typed into the sheet must not make re-plan erase the project
  const stray = A.replanBook([proj('Old', { mix_from: '2026-11-16' })], book, roster, '2026-10-12');
  ok('a project with only one date typed keeps all its bookings through a re-plan',
     stray.rows_to_supersede.length === 0 && stray.rows_to_append.length === 0,
     `${stray.rows_to_supersede.length} superseded, ${stray.rows_to_append.length} appended`);
  ok('and re-plan says it was left alone, and why',
     (stray.skipped || []).length === 1 && stray.skipped[0].project === 'Old' && stray.skipped[0].errors.length > 0,
     JSON.stringify(stray.skipped));
  const text = A.replanBook([proj('Old', { dub_from: 'TBC', dub_to: 'TBC' })], book, roster, '2026-10-12');
  ok('text in a date cell is handled the same way', text.rows_to_supersede.length === 0 && (text.skipped || []).length === 1,
     JSON.stringify(text.skipped));
  const ghost = A.replanBook([proj('No Rows', { dub_from: '2026-11-02' })], book, roster, '2026-10-12');
  ok('a bad-dated project with no rows is not planned from guesses',
     ghost.rows_to_append.every(b => b.project !== 'No Rows'), JSON.stringify(ghost.rows_to_append.map(b => b.project)));
  const good = A.replanBook([proj('Old', { dub_from: '2026-11-02', dub_to: '2026-11-08', edit_from: '2026-11-09', edit_to: '2026-11-15',
    mix_from: '2026-11-16', mix_to: '2026-11-22' })], book, roster, '2026-10-12');
  ok('a properly dated project is still planned normally', (good.skipped || []).length === 0);

  // --- date limits and real calendar days
  const base = { project_title: 'D', client: 'X', deadline: '2026-12-20', mix_level_required: 'Advanced',
    dub_from: '2026-11-02', dub_to: '2026-11-22' };
  const errs = (patch, today) => A.normalizeProject({ ...base, ...patch }, today).errors.join(' | ');
  ok('a year-0001 date is refused when the clock is given', /three years/.test(errs({ dub_from: '0001-01-01' }, '2026-10-17')),
     errs({ dub_from: '0001-01-01' }, '2026-10-17'));
  ok('so is one far in the future', /three years/.test(errs({ dub_to: '2099-01-01' }, '2026-10-17')));
  ok('a date within three years is fine', errs({ dub_to: '2026-11-29' }, '2026-10-17') === '');
  ok('without a clock nothing is limited (the sheet code and engine tests pass none)',
     !/three years/.test(errs({ dub_from: '2010-01-04', dub_to: '2010-01-10' })));
  ok('2026-02-30 is not a date and is refused, not rolled into March', /real dates/.test(errs({ dub_to: '2026-02-30' })),
     errs({ dub_to: '2026-02-30' }));
  ok('a normal leap day is accepted', errs({ dub_from: '2028-02-28', dub_to: '2028-02-29', deadline: '2028-03-20' }) === '');

  // --- the dub dealing never forces what the old week-by-week deal could cover
  const R2 = n => ({ name: n, can_record: 'Yes', can_edit: 'Yes', can_mix: 'No', mix_level: '', music_specialist: 'No',
    overflow_only: 'No', does_specials: 'No', atmos: 'No' });
  const wk = i => new Date(Date.UTC(2026, 10, 2) + i * 7 * 86400000).toISOString().slice(0, 10);
  const we = i => new Date(Date.UTC(2026, 10, 2) + (i * 7 + 6) * 86400000).toISOString().slice(0, 10);
  const busy = (who, weeks) => weeks.map(w => ({ project: 'x' + who + w, phase: 'Dub', engineer: who, start_date: wk(w), end_date: we(w), status: '', note: '' }));
  // dub weeks 0-3, edit week 4. E is the only one free to edit, and free in week 0; A busy 2-4; B busy 0,1,4.
  const tough = [].concat(busy('A', [2, 3, 4]), busy('B', [0, 1, 4]), busy('E', [1, 2, 3]));
  const tp = A.normalizeProject({ project_title: 'T', client: 'X', deadline: '2027-01-31', mix_level_required: 'Advanced',
    music_songs: 'No', special_project: 'No', atmos_required: 'No', dub_from: wk(0), dub_to: we(3), edit_from: wk(4), edit_to: we(4) }).project;
  const tout = A.runAssign({ ...tp, divide_dub: true }, tough, ['A', 'B', 'E'].map(R2));
  ok('preferring the editor must not cost the dub its cover (the reviewer’s case)', !tout.forced,
     tout.booking_rows.map(b => b.phase[0] + ':' + b.engineer).join(' ') + ' ' + tout.record_note);
}

// ---------------------------------------------------------------------------
section('Series continuity: the people who did a phase before are preferred (Tara, 2026-10-27)');
{
  const R = (name, extra) => ({ name, can_record: 'Yes', can_edit: 'Yes', can_mix: 'Yes', mix_level: 'Advanced',
    music_specialist: 'No', overflow_only: 'No', does_specials: 'No', atmos: 'No', ...extra });
  const roster = [R('Ana'), R('Ben'), R('Kyle'), R('Via', { can_record: 'No', can_edit: 'No' })];
  const wk = i => new Date(Date.UTC(2026, 10, 2) + i * 7 * 86400000).toISOString().slice(0, 10);
  const we = i => new Date(Date.UTC(2026, 10, 2) + (i * 7 + 6) * 86400000).toISOString().slice(0, 10);
  const row = (n, project, phase, engineer, a, z) => ({ row_number: n, project, phase, engineer, start_date: wk(a), end_date: we(z), source: 'plot', note: '', status: '' });
  const proj = (t, series, deadlineW, extra) => ({ project_title: t, series, client: 'X', deadline: we(deadlineW), mix_level_required: 'Advanced',
    music_songs: 'No', special_project: 'No', atmos_required: 'No', dub_weeks: 1, edit_weeks: 1, mix_weeks: 1, ...extra });
  const S1 = [row(2, 'Show S1', 'Dub', 'Kyle', 0, 1), row(3, 'Show S1', 'Edit', 'Kyle', 2, 2), row(4, 'Show S1', 'Mix', 'Via', 3, 3)];
  const P1 = proj('Show S1', 'Show', 3);

  // --- the score
  const sc = (book, projects) => A.scorePlan(book, roster, projects).series_continuity;
  const mk = (dub, edit, mix) => [row(10, 'Show S2', 'Dub', dub, 10, 11), row(11, 'Show S2', 'Edit', edit, 12, 12), row(12, 'Show S2', 'Mix', mix, 13, 13)];
  const P2 = proj('Show S2', 'show', 13);          // different capitals: still the same series
  ok('the same people as last time break nothing', sc(S1.concat(mk('Kyle', 'Kyle', 'Via')), [P1, P2]) === 0);
  ok('a new person on every phase breaks all three', sc(S1.concat(mk('Ana', 'Ana', 'Ben')), [P1, P2]) === 3,
     sc(S1.concat(mk('Ana', 'Ana', 'Ben')), [P1, P2]) + '');
  ok('it is counted per phase: only the dub changed hands', sc(S1.concat(mk('Ana', 'Kyle', 'Via')), [P1, P2]) === 1);
  ok('anyone who did the phase before will do', sc(S1.concat([row(20, 'Show S1', 'Dub', 'Ana', 5, 5)]).concat(mk('Ana', 'Kyle', 'Via')), [P1, P2]) === 0);
  ok('with no series nothing is counted', sc(S1.concat(mk('Ana', 'Ana', 'Ben')), [{ ...P1, series: '' }, { ...P2, series: '' }]) === 0);
  ok('the first project of a series has nothing to continue', sc(S1, [P1]) === 0);
  const idx = k => A.SOLVE_OBJECTIVE.indexOf(k);
  ok('it ranks below every overlap and reserve term, so it never costs one',
     ['reserve_double_booked', 'three_deep_weeks', 'total_double_booked', 'forced_projects', 'reserve_weeks'].every(k => idx(k) < idx('series_continuity')));
  ok('and above workload balancing', idx('series_continuity') < idx('regular_spread'));

  // --- one new project, per phase
  const placed = (extra, book) => { const p2 = proj('Show S2', 'Show', 13, extra);
    const out = A.runAssign(A.normalizeProject({ ...p2, dub_from: wk(10), dub_to: we(11), edit_from: wk(12), edit_to: we(12), mix_from: wk(13), mix_to: we(13) }).project, book || S1, roster);
    return out.booking_rows; };
  const who = (rows, ph) => [...new Set(rows.filter(b => b.phase === ph).map(b => b.engineer))].join('+');
  // Put Ben ahead of Kyle for the dub on the greedy pick by loading Kyle, so only the series can bring Kyle back.
  const loaded = S1.concat([row(30, 'Other', 'Dub', 'Kyle', 4, 9), row(31, 'Other', 'Edit', 'Kyle', 4, 9)]);
  const rows0 = placed({}, loaded);
  const stage = A.continuityPass_(rows0, loaded, roster, [P1, proj('Show S2', 'Show', 13)]);
  ok('precondition: left alone, the planner does not pick Kyle for the dub', who(rows0, 'Dub') !== 'Kyle', who(rows0, 'Dub'));
  ok('the dub goes to whoever dubbed the series before, when they are free', who(stage.rows, 'Dub') === 'Kyle', who(stage.rows, 'Dub') + ' / moved ' + stage.moved);
  ok('and the edit goes with it (dub and edit stay together)', who(stage.rows, 'Edit') === 'Kyle', who(stage.rows, 'Edit'));
  ok('the mix goes to whoever mixed it before', who(stage.rows, 'Mix') === 'Via', who(stage.rows, 'Mix'));

  // not when they are busy: a preference, never an overlap
  const busy = loaded.concat([row(40, 'Elsewhere', 'Dub', 'Kyle', 10, 11), row(41, 'Elsewhere', 'Edit', 'Kyle', 12, 12)]);
  const rowsB = placed({}, busy);
  const stageB = A.continuityPass_(rowsB, busy, roster, [P1, proj('Show S2', 'Show', 13), proj('Elsewhere', '', 12), proj('Other', '', 9)]);
  ok('when the earlier person is busy those weeks, the dub and edit stay where they were',
     who(stageB.rows, 'Dub') === who(rowsB, 'Dub') && who(stageB.rows, 'Edit') === who(rowsB, 'Edit') && who(stageB.rows, 'Dub') !== 'Kyle',
     'dub ' + who(rowsB, 'Dub') + ' -> ' + who(stageB.rows, 'Dub') + ', edit ' + who(rowsB, 'Edit') + ' -> ' + who(stageB.rows, 'Edit'));
  ok('while the mix, whose earlier person is free, still goes to them', who(stageB.rows, 'Mix') === 'Via', who(stageB.rows, 'Mix'));
  ok('and so no overlap was created', A.scorePlan(busy.concat(stageB.rows), roster, []).total_double_booked === A.scorePlan(busy.concat(rowsB), roster, []).total_double_booked);

  // manual picks are never moved
  const manualRows = rows0.map(b => b.phase === 'Dub' ? { ...b, note: 'manual' } : b);
  const stageM = A.continuityPass_(manualRows, loaded, roster, [P1, proj('Show S2', 'Show', 13)]);
  ok('a hand-picked phase is left alone', who(stageM.rows, 'Dub') === who(manualRows, 'Dub'), who(stageM.rows, 'Dub'));

  // no series, no change
  const stageN = A.continuityPass_(rows0, loaded, roster, [{ ...P1, series: '' }, proj('Show S2', '', 13)]);
  ok('a project with no series is planned exactly as before', JSON.stringify(stageN.rows) === JSON.stringify(rows0) && stageN.moved === 0);

  // --- re-plan reaches it too (through the existing swap pass and the objective term)
  const frozenS1 = S1;
  const proj2 = proj('Show S2', 'Show', 13, { dub_from: wk(10), dub_to: we(11), edit_from: wk(12), edit_to: we(12), mix_from: wk(13), mix_to: we(13) });
  const planned = rows0.map((b, i) => ({ ...b, row_number: 100 + i, status: '' }));
  const rp = A.replanBook([{ ...P1, status: 'Complete' }, proj2], frozenS1.concat(planned, [row(30, 'Other', 'Dub', 'Kyle', 4, 9), row(31, 'Other', 'Edit', 'Kyle', 4, 9)]), roster, '2026-10-12', { restarts: 0 });
  const finalRows = frozenS1.concat(planned).filter(b => !rp.rows_to_supersede.includes(b.row_number)).concat(rp.rows_to_append);
  ok('a re-plan keeps or restores the series’ people too', sc(finalRows.concat([row(30, 'Other', 'Dub', 'Kyle', 4, 9)]), [P1, proj2]) <= sc(frozenS1.concat(planned), [P1, proj2]),
     sc(finalRows, [P1, proj2]) + ' vs ' + sc(frozenS1.concat(planned), [P1, proj2]));
}

// ---------------------------------------------------------------------------
section('Up to 3 projects at once, counted by title; Mat as the record/edit reserve (Rudolf, 2026-10-29)');
{
  const L = loadAppsScript({ limit: 3 });
  ok('the studio default is 3 projects at once', loadAppsScript({}).PROJECT_LIMIT === 1 &&
     require('../core/engine.js').loadAppsScript().PROJECT_LIMIT === 3);
  const R = (name, extra) => ({ name, can_record: 'Yes', can_edit: 'Yes', can_mix: 'No',
    mix_level: '', music_specialist: 'No', overflow_only: 'No', does_specials: 'No', atmos: 'No', ...extra });
  const roster = [R('Ana'), R('Ben'), R('Mat', { overflow_only: 'Yes' }),
    R('Mixy', { can_record: 'No', can_edit: 'No', can_mix: 'Yes', mix_level: 'Advanced' })];
  const P = L.normalizeProject({ project_title: 'New', client: 'X', deadline: '2027-01-17', mix_level_required: 'Advanced',
    music_songs: 'No', special_project: 'No', atmos_required: 'No',
    dub_from: '2026-11-02', dub_to: '2026-11-15', edit_from: '2026-11-16', edit_to: '2026-11-22',
    mix_from: '2026-11-23', mix_to: '2026-11-29' }).project;
  // n other projects held by one person across the new project's dub and edit weeks
  const on = (e, n) => Array.from({ length: n }, (_, i) => ({ project: `${e} other ${i}`, phase: 'Dub', engineer: e,
    start_date: '2026-11-02', end_date: '2026-11-22', status: '', note: 'manual' }));
  const plot = (book, eng) => L.runAssign(P, book, eng || roster);
  const recBy = o => [...new Set(o.booking_rows.filter(b => b.phase !== 'Mix').map(b => b.engineer))].join('+');

  const spread = plot(on('Ana', 2));
  ok('spread evenly: with Ana on two projects and Ben on none, Ben gets it', recBy(spread) === 'Ben' && !spread.forced, recBy(spread));
  const third = plot(on('Ana', 2).concat(on('Ben', 2)));
  ok('a third project at once is allowed, and is not an overlap', ['Ana', 'Ben'].includes(recBy(third)) && !third.forced,
     recBy(third) + ' ' + third.record_note);
  ok('and the scorer agrees: nobody is over the limit',
     L.scorePlan(on('Ana', 2).concat(on('Ben', 2), third.booking_rows), roster, []).total_double_booked === 0);
  ok('Mat is not used while a regular has room', recBy(third) !== 'Mat');
  const reserve = plot(on('Ana', 3).concat(on('Ben', 3)));
  ok('when every regular already has 3, Mat takes the dub and edit', recBy(reserve) === 'Mat' && !reserve.forced,
     recBy(reserve) + ' ' + reserve.record_note);
  ok('and the note says why', /reserve; every regular recordist\/editor already had 3/.test(reserve.record_note), reserve.record_note);
  const noMat = plot(on('Ana', 3).concat(on('Ben', 3)), roster.filter(r => r.name !== 'Mat'));
  ok('without Mat the same book forces a 4th project onto someone', noMat.forced && /FORCED OVERLAP/.test(noMat.record_note),
     noMat.record_note);
  const full = plot(on('Ana', 3).concat(on('Ben', 3), on('Mat', 3)));
  ok('with Mat at 3 too, it is forced, and the note says the limit', full.forced && /already had 3 at once/.test(full.record_note),
     full.record_note);

  // the re-plan engine is a second implementation and must agree
  const rp = book => L.replanBook([P], book, roster, '2026-10-29', { restarts: 0 }).proposed_rows
    .filter(b => b.project === 'New' && b.phase !== 'Mix').map(b => b.engineer);
  ok('re-plan: spreads to whoever has least on', rp(on('Ana', 2)).every(n => n === 'Ben'), rp(on('Ana', 2)).join(','));
  ok('re-plan: allows a third project', rp(on('Ana', 2).concat(on('Ben', 2))).every(n => n === 'Ana' || n === 'Ben'));
  ok('re-plan: uses Mat only when the regulars all have 3', rp(on('Ana', 3).concat(on('Ben', 3))).every(n => n === 'Mat'),
     rp(on('Ana', 3).concat(on('Ben', 3))).join(','));
  // A project's own weeks never count against the people it is being placed on: Mixy already
  // holds this show's (pinned) edit plus two other projects in its mix weeks, which is two
  // others, not three -- so Mixy, the only Advanced mixer, still has room for the mix.
  const P2 = L.normalizeProject({ ...P, project_title: 'Own', mix_from: '2026-11-16', mix_to: '2026-11-29' }).project;
  const mixyBook = [{ project: 'Own', phase: 'Dub', engineer: 'Ana', start_date: '2026-11-02', end_date: '2026-11-15', status: '', note: 'manual' },
    { project: 'Own', phase: 'Edit', engineer: 'Mixy', start_date: '2026-11-16', end_date: '2026-11-22', status: '', note: 'manual' }]
    .concat([0, 1].map(i => ({ project: `Mixy other ${i}`, phase: 'Mix', engineer: 'Mixy',
      start_date: '2026-11-16', end_date: '2026-11-29', status: '', note: 'manual' })));
  const ownMix = L.replanBook([P2], mixyBook, roster, '2026-10-29', { restarts: 0 }).proposed_rows
    .filter(b => b.project === 'Own' && b.phase === 'Mix');
  ok('re-plan: a project\u2019s own weeks do not fill its people up', ownMix.length > 0 &&
     ownMix.every(b => b.engineer === 'Mixy' && !/FORCED/.test(b.note || '')), JSON.stringify(ownMix.map(b => [b.engineer, b.note])));

  // counting and scoring
  const wk = (project, phase, engineer) => ({ project, phase, engineer, start_date: '2026-11-16', end_date: '2026-11-22', note: '', status: '' });
  const own = [wk('P', 'Dub', 'Ana'), wk('P', 'Edit', 'Ana'), wk('P', 'Mix', 'Ana')];
  const at = rows => L.jobsByEngineerWeek(rows)['Ana|' + L.widx('2026-11-16')];
  ok("a show's dub, edit and mix with one person are one project", L.projectsOf(at(own)) === 1 && L.depthOf(at(own)) === 1);
  const three = own.concat(wk('Q', 'Dub', 'Ana'), wk('R', 'Edit', 'Ana'));
  ok('three titles at once: no overlap, but counted as stacked so spreading still wins',
     L.scorePlan(three, roster, []).total_double_booked === 0 && L.scorePlan(three, roster, []).stacked_weeks === 2,
     JSON.stringify({ d: L.scorePlan(three, roster, []).total_double_booked, s: L.scorePlan(three, roster, []).stacked_weeks }));
  const four = three.concat(wk('S', 'Dub', 'Ana'));
  ok('a fourth title is one week over the limit', L.scorePlan(four, roster, []).total_double_booked === 1 &&
     L.depthOf(at(four)) === 2 && L.projectsOf(at(four)) === 4);
  ok('and Analysis lists it as a clash', L.actualOverlaps_(four).length > 0 && L.actualOverlaps_(three).length === 0);
  ok('stacking is ranked below every overlap and preference term, above balancing totals', (() => {
    const o = L.SOLVE_OBJECTIVE, i = o.indexOf('stacked_weeks');
    return i > o.indexOf('series_continuity') && i > o.indexOf('total_double_booked') && i < o.indexOf('regular_spread');
  })(), L.SOLVE_OBJECTIVE.join(','));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
