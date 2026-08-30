// Project read/write helpers, shared by the web app's api* layer.
//
//   checkProject()      — runs the engine and writes NOTHING. Answers "can we
//                         take this job" before committing to it.
//   saveProject()       — writes the row and plots it.
//   getProjectForEdit() — loads a project back so a mistake can be corrected.
//   removeProject()     — cancels one: bookings superseded, row kept and marked.

function getFormOptions() {
  var names;
  try { names = engineerNames(); } catch (e) { names = []; }
  var existing = [];
  try {
    existing = readProjectRows()
      .filter(function (p) { return p.project_title; })
      .map(function (p) { return { title: p.project_title, deadline: p.deadline }; })
      .sort(function (a, b) { return String(a.deadline).localeCompare(String(b.deadline)); });
  } catch (e) { existing = []; }
  return {
    clients: clientList_(),
    engineers: names,
    projects: existing,
    today: todayISO(),
    roster_ok: names.length > 0,
  };
}

// Loads an existing project back into the form so a mistake can be corrected
// without retyping it. Returns the entry values, not the engine's output.
function getProjectForEdit(title) {
  var p = readProjectRows().filter(function (r) {
    return r.project_title === String(title || '').trim();
  })[0];
  if (!p) return { found: false };

  var phases = String(p.phases || '').split('/');
  var live = activeRows(readBookings()).filter(function (b) { return b.project === p.project_title; });
  return {
    found: true,
    title: p.project_title,
    client: p.client,
    deadline: p.deadline,
    dub: phases.length === 3 ? phases[0] : p.dub_weeks,
    edit: phases.length === 3 ? phases[1] : p.edit_weeks,
    mix: phases.length === 3 ? phases[2] : p.mix_weeks,
    mix_level: p.mix_level_required || 'Advanced',
    music: /^yes$/i.test(p.music_songs),
    special: /^yes$/i.test(p.special_project),
    atmos: /^yes$/i.test(p.atmos_required),
    recordist: p.recordist_override || 'Auto',
    recordist2: p.recordist_override_2 || 'Auto',
    editor: p.editor_override || 'Auto',
    mixer: p.mixer_override || 'Auto',
    live_rows: live.length,
    plotted: p.plotted,
  };
}

// Cancels a project: its bookings are superseded so it leaves the schedule, and
// the Projects row is kept and marked. Nothing is deleted (rule 15).
function removeProject(title) {
  var name = String(title || '').trim();
  if (!name) return { ok: false, errors: ['No project named.'] };
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return { ok: false, errors: ['Another change is in progress.'] };
  try {
    var superseded = supersedeProjectBookings([name]);
    var p = readProjectRows().filter(function (r) { return r.project_title === name; })[0];
    if (p) {
      var sh = sheetOrThrow(TAB.PROJECTS);
      clearProjectOutputs(p._row);
      sh.getRange(p._row, P_COL.NOTES).setValue('Cancelled ' + todayISO())
        .setFontColor(COLOR.MUTED).setFontWeight('bold');
      sh.getRange(p._row, P_COL.PLOTTED).setValue('');
    }
    return { ok: true, removed: name, superseded: superseded };
  } finally {
    lock.releaseLock();
  }
}

// Form fields -> the shape normalizeProject expects.
function formPayloadToRaw_(p) {
  return {
    project_title: String(p.title || '').trim(),
    client: String(p.client || '').trim(),
    deadline: String(p.deadline || '').trim(),
    dub_weeks: p.dub,
    edit_weeks: p.edit,
    mix_weeks: p.mix,
    mix_level_required: String(p.mix_level || '').trim(),
    music_songs: p.music ? 'Yes' : 'No',
    special_project: p.special ? 'Yes' : 'No',
    atmos_required: p.atmos ? 'Yes' : 'No',
    recordist_override: String(p.recordist || 'Auto').trim() || 'Auto',
    recordist_override_2: String(p.recordist2 || 'Auto').trim() || 'Auto',
    editor_override: String(p.editor || 'Auto').trim() || 'Auto',
    mixer_override: String(p.mixer || 'Auto').trim() || 'Auto',
  };
}

function describeResult_(project, out) {
  var rows = (out.booking_rows || []).map(function (b) {
    return { phase: b.phase, engineer: b.engineer, start: b.start_date, end: b.end_date,
             note: b.note || '' };
  });
  return {
    ok: true,
    errors: [],
    title: project.project_title,
    deadline: project.deadline,
    weeks: { dub: project.dub_weeks, edit: project.edit_weeks, mix: project.mix_weeks },
    recordist: out.recordist,
    dubber: out.dubber || out.recordist,
    editor: out.editor || out.recordist,
    mixer: out.mixer,
    warnings: out.warnings || '',
    record_note: out.record_note || '',
    mix_note: out.mix_note || '',
    forced: !!out.forced,
    rows: rows,
  };
}

// Dry run. Nothing is written.
function checkProject(p) {
  var engineers = readEngineers();
  var bookings = readBookings();
  assertValidBook(bookings, engineers);

  var raw = formPayloadToRaw_(p);
  var norm = normalizeProject(raw);
  if (norm.errors.length) return { ok: false, errors: norm.errors };

  // If this title already exists, ignore its own live rows — a check should
  // show what a fresh plot would do, not collide with the version being replaced.
  var book = activeRows(bookings).filter(function (b) {
    return b.project !== norm.project.project_title;
  });
  var out = runAssign(norm.project, book, engineers);
  var res = describeResult_(norm.project, out);
  res.dry_run = true;
  res.replaces = activeRows(bookings).filter(function (b) {
    return b.project === norm.project.project_title;
  }).length;
  return res;
}

// Writes: appends (or updates) the Projects row and plots it.
function saveProject(p) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return { ok: false, errors: ['Another change is in progress. Try again in a moment.'] };
  try {
    var engineers = readEngineers();
    var bookings = readBookings();
    assertValidBook(bookings, engineers);

    var raw = formPayloadToRaw_(p);
    var norm = normalizeProject(raw);
    if (norm.errors.length) return { ok: false, errors: norm.errors };
    var project = norm.project;

    // re-plotting an existing title supersedes its rows rather than overwriting
    var superseded = supersedeProjectBookings([project.project_title]);

    var book = activeRows(readBookings());
    var out = runAssign(project, book, engineers);
    appendBookings(out.booking_rows);

    var row = upsertProjectRow_(project);
    var notes = [out.record_note, out.mix_note].filter(String).join(' | ');
    clearProjectOutputs(row);
    writeProjectOutputs(row, {
      dub_weeks: project.dub_weeks, edit_weeks: project.edit_weeks, mix_weeks: project.mix_weeks,
      recordist: out.dubber || out.recordist, editor: out.editor || out.recordist, mixer: out.mixer,
      warnings: out.warnings, notes: notes,
      plotted: todayISO(), forced: out.forced,
    });

    var res = describeResult_(project, out);
    res.dry_run = false;
    res.row = row;
    res.superseded = superseded;
    res.booking_rows = out.booking_rows.length;
    return res;
  } finally {
    lock.releaseLock();
  }
}

// The first row with no project title. Deliberately not getLastRow() + 1 —
// anything that leaves values down a column (an earlier version filled 300
// checkbox cells with FALSE) makes getLastRow report the bottom of that range,
// and new projects would land far below the last real one.
function firstEmptyProjectRow_(sh) {
  var last = sh.getLastRow();
  var span = last - P_FIRST_DATA_ROW + 1;
  if (span < 1) return P_FIRST_DATA_ROW;
  var titles = sh.getRange(P_FIRST_DATA_ROW, P_COL.TITLE, span, 1).getValues();
  for (var i = 0; i < titles.length; i++) {
    if (!String(titles[i][0] || '').trim()) return P_FIRST_DATA_ROW + i;
  }
  return P_FIRST_DATA_ROW + span;
}

// Writes the entry columns for a project, reusing its row if the title exists —
// Projects is the master list, one row per project (HANDOFF §4).
function upsertProjectRow_(project) {
  var sh = sheetOrThrow(TAB.PROJECTS);
  var existing = readProjectRows().filter(function (r) {
    return r.project_title === project.project_title;
  })[0];
  var row = existing ? existing._row : firstEmptyProjectRow_(sh);

  sh.getRange(row, P_COL.TITLE, 1, P_INPUT_LAST - P_COL.TITLE + 1).setValues([[
    project.project_title,
    project.client,
    project.deadline,
    project.dub_weeks + '/' + project.edit_weeks + '/' + project.mix_weeks,
    project.mix_level_required,
    project.music_songs,
    project.special_project,
    project.recordist_override,
    project.editor_override || 'Auto',
    project.mixer_override,
  ]]);
  sh.getRange(row, P_COL.DEADLINE).setNumberFormat('yyyy-mm-dd');
  sh.getRange(row, P_COL.PHASES).setNumberFormat('@');
  return row;
}
