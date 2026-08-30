// Everything that changes the book.
//
// Each action is a pure function: it takes the book and a payload and returns a
// CHANGE SET — rows to supersede, rows to append — plus whatever the caller needs to
// explain itself. It never touches the store, HTTP, or Google. The store applies the
// change to whichever source is configured.
//
// Nothing is ever deleted. A row that stops being true is marked superseded and stays
// in the book as history, which is how the Apps Script version works and why a
// mistake there has always been recoverable.
const { loadAppsScript } = require('../core/engine.js');
const A = loadAppsScript();

const live = book => A.activeRows(book.bookings);
const yes = v => /^yes$/i.test(String(v == null ? '' : v).trim());
const nextRow = book => book.bookings.reduce((n, b) => Math.max(n, b.row_number || 0), 1) + 1;

// ---------------------------------------------------------------- drag a week

// Everything a hand move is allowed to do but probably should not. A manual pick beats
// every rule — that is the contract for the pick columns, and a drag must not be
// stricter — so these are warnings, never refusals.
function reassignWarnings(row, wi, to, rows, engineers) {
  const out = [];
  const t = engineers.find(e => e.name === to) || {};
  const clash = rows.filter(b => b.engineer === to && b !== row &&
    A.widx(b.start_date) <= wi && wi <= A.widx(b.end_date));
  if (clash.length) {
    out.push({ kind: 'double', text: `${to} already has ` +
      clash.map(b => `${b.project} / ${b.phase}`).join(' and ') + ' that week.' });
  }
  // Reserve first: the objective protects reserve double-booking above everything
  // else, so spending it by hand is a different kind of decision.
  if (yes(t.overflow_only)) {
    out.push({ kind: 'reserve', text: `${to} is the reserve, kept free for overflow.` });
  }
  if (row.phase === 'Dub' && !yes(t.can_record)) out.push({ kind: 'skill', text: `${to} does not normally record.` });
  if (row.phase === 'Edit' && !yes(t.can_edit)) out.push({ kind: 'skill', text: `${to} does not normally edit.` });
  if (row.phase === 'Mix' && !yes(t.can_mix)) out.push({ kind: 'skill', text: `${to} does not normally mix.` });
  return out;
}

function reassignWeek(book, payload) {
  const p = payload || {};
  const project = String(p.project || '').trim();
  const phase = String(p.phase || '').trim();
  const week = String(p.week_start || '').trim();
  const to = String(p.to_engineer || '').trim();
  if (!project || !phase || !week || !to) return { ok: false, error: 'Incomplete move.' };
  if (!book.engineers.some(e => e.name === to)) return { ok: false, error: `"${to}" is not on the roster.` };

  const rows = live(book);
  const wi = A.widx(week);
  const row = rows.find(b => b.project === project && b.phase === phase &&
    A.widx(b.start_date) <= wi && wi <= A.widx(b.end_date));
  if (!row) return { ok: false, error: 'That week is no longer booked — reload and try again.' };
  if (row.engineer === to) return { ok: false, error: `${to} already has that week.` };

  const warnings = reassignWarnings(row, wi, to, rows, book.engineers);
  if (!p.confirmed) {
    return { ok: true, preview: true, from: row.engineer, to, project, phase,
             week_start: week, warnings };
  }

  // A booking row is a contiguous block, so taking one week out of the middle leaves
  // two remainders — up to three rows where there was one. Rows are cheap; a wrong
  // date is not.
  const s = A.widx(row.start_date), e = A.widx(row.end_date);
  const append = [];
  const piece = (a, b, who, note) => {
    if (a > b) return;
    append.push({ project, phase, engineer: who,
                  start_date: A.weekStart(a), end_date: A.weekEnd(b),
                  source: 'manual', note });
  };
  piece(s, wi - 1, row.engineer, row.note || '');
  // The previous engineer is recorded in the note so the undo needs no guessing —
  // inferring it from neighbouring rows failed on a one-week phase, which has none.
  piece(wi, wi, to, `manual / moved by hand (was ${row.engineer})`);
  piece(wi + 1, e, row.engineer, row.note || '');

  return { ok: true, moved: true, from: row.engineer, to, project, phase,
           week_start: week, warnings,
           change: { supersede: [row.row_number], append } };
}

// ---------------------------------------------------------------- undo a drag

function undoWeekMove(book, payload) {
  const p = payload || {};
  const project = String(p.project || '').trim();
  const phase = String(p.phase || '').trim();
  const week = String(p.week_start || '').trim();
  const wi = A.widx(week);
  const rows = live(book);
  const row = rows.find(b => b.project === project && b.phase === phase &&
    A.widx(b.start_date) <= wi && wi <= A.widx(b.end_date) && /moved by hand/i.test(b.note || ''));
  if (!row) return { ok: false, error: 'That week was not moved by hand.' };

  const was = (/\(was ([^)]+)\)/.exec(row.note || '') || [])[1];
  if (!was) return { ok: false, error: 'This row does not record who it came from.' };
  if (!book.engineers.some(e => e.name === was)) {
    return { ok: false, error: `${was} is no longer on the roster — move it by hand instead.` };
  }

  const clash = rows.filter(b => b.engineer === was && b !== row &&
    A.widx(b.start_date) <= wi && wi <= A.widx(b.end_date))
    .map(b => `${b.project} / ${b.phase}`);

  return { ok: true, to: was, project, phase, week_start: week, clash,
           change: { supersede: [row.row_number],
                     append: [{ project, phase, engineer: was,
                                start_date: A.weekStart(wi), end_date: A.weekEnd(wi),
                                source: 'plot', note: '' }] } };
}

// ------------------------------------------------------------- add / edit a project

function saveProject(book, payload) {
  const p = payload || {};
  const raw = {
    project_title: p.title, client: p.client, deadline: p.deadline,
    dub_weeks: p.dub, edit_weeks: p.edit, mix_weeks: p.mix,
    mix_level_required: p.mix_level,
    music_songs: p.music ? 'Yes' : 'No',
    special_project: p.special ? 'Yes' : 'No',
    atmos_required: p.atmos ? 'Yes' : 'No',
    recordist_override: p.recordist || 'Auto',
    recordist_override_2: p.recordist2 || 'Auto',
    editor_override: p.editor || 'Auto',
    mixer_override: p.mixer || 'Auto',
  };
  const norm = A.normalizeProject(raw);
  if (norm.errors.length) return { ok: false, errors: norm.errors };
  const project = norm.project;

  const original = String(p.original_title || '').trim();
  const titles = original && original !== project.project_title
    ? [original, project.project_title] : [project.project_title];

  const rows = live(book);
  const supersede = rows.filter(b => titles.includes(b.project)).map(b => b.row_number);
  const rest = rows.filter(b => !titles.includes(b.project));
  const out = A.runAssign(project, rest, book.engineers);

  return {
    ok: true, errors: [], dry_run: !!p.dry_run,
    title: project.project_title,
    recordist: out.recordist, dubber: out.dubber || out.recordist,
    editor: out.editor || out.recordist, mixer: out.mixer,
    warnings: out.warnings || '',
    record_note: out.record_note || '', mix_note: out.mix_note || '',
    rows: (out.booking_rows || []).map(b => ({ phase: b.phase, engineer: b.engineer,
      start: b.start_date, end: b.end_date })),
    project,
    change: p.dry_run ? null : { supersede, append: out.booking_rows, project },
  };
}

// ---------------------------------------------------------------- re-plan

function replanPreview(book, todayISO) {
  const rows = live(book);
  const r = A.replanBook(book.projects, rows, book.engineers, todayISO);
  return {
    ok: true,
    no_improvement: !!r.no_improvement,
    change_count: r.change_count || 0,
    changes: r.changes || [],
    dubs_divided: r.dubs_divided || 0,
    overlaps_after: r.overlaps_after || [],
    overlaps_resolved: r.overlaps_resolved || [],
    change: r.no_improvement ? null
      : { supersede: r.rows_to_supersede || [], append: r.rows_to_append || [] },
  };
}

module.exports = { reassignWeek, undoWeekMove, saveProject, replanPreview, reassignWarnings };
