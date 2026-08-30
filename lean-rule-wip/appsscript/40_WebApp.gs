// The web app. Apps Script serves the whole UI from doGet, so there is no
// hosting, no domain and no auth to build — Google handles all three — while the
// interface gets real buttons, real edit flows and full CSS control.
//
// Sheets stays the backend: the team can still open the spreadsheet and read or
// repair the data (HANDOFF §8), and the engine runs unchanged (§5).
//
// Every function prefixed api* is callable from the client via google.script.run.

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Loc Prod Planner')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// Booking rows whose project no longer exists in the Projects tab.
//
// The Schedule is built from BOOKINGS, not from Projects — labels come from
// whatever has a live row. So deleting a project's row by hand in the sheet does
// not remove it from the schedule: the bookings survive and keep rendering, while
// the project vanishes from the Projects list. That is the worst pairing, because
// the thing you can see is the thing you can no longer select to cancel.
//
// Cancel project (in the app) supersedes the bookings properly. Hand-deleting the
// row bypasses that, which is what this catches (2026-08-13).
function orphanProjects_(live, projectRows) {
  var known = {};
  projectRows.forEach(function (p) { if (p.project_title) known[p.project_title] = true; });
  var counts = {};
  live.forEach(function (b) {
    if (b.project && !known[b.project]) counts[b.project] = (counts[b.project] || 0) + 1;
  });
  return Object.keys(counts).sort().map(function (t) {
    return { project: t, rows: counts[t] };
  });
}

// ---------------------------------------------------------------- read models

function projectForced_(title, live) {
  return live.some(function (b) {
    return b.project === title && /FORCED/i.test(b.note || '');
  });
}

function projectPinned_(title, live) {
  return live.some(function (b) {
    return b.project === title && /manual/i.test(b.note || '');
  });
}

// One row per project, with the engine's outcome and how it currently sits.
function listProjects_(live) {
  return readProjectRows().map(function (p) {
    var rows = live.filter(function (b) { return b.project === p.project_title; });
    return {
      title: p.project_title,
      client: p.client,
      deadline: p.deadline,
      phases: p.phases,
      mix_level: p.mix_level_required,
      music: /^yes$/i.test(p.music_songs),
      special: /^yes$/i.test(p.special_project),
      recordist_pick: p.recordist_override || 'Auto',
      editor_pick: p.editor_override || 'Auto',
      mixer_pick: p.mixer_override || 'Auto',
      plotted: p.plotted,
      locked: p.locked === true,
      cancelled: /^cancelled/i.test(String(p.notes || '')) && rows.length === 0,
      live_rows: rows.length,
      forced: projectForced_(p.project_title, live),
      pinned: projectPinned_(p.project_title, live),
      rows: rows.map(function (b) {
        return { phase: b.phase, engineer: b.engineer, start: b.start_date,
                 end: b.end_date, note: b.note || '' };
      }),
      row: p._row,
    };
  }).sort(function (a, b) {
    return String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')) ||
           String(a.title).localeCompare(String(b.title));
  });
}

// Everything the app needs on first paint, in one round trip.
function apiBootstrap() {
  var engineers = readEngineers();
  var bookings = readBookings();
  var live = activeRows(bookings);
  return {
    today: todayISO(),
    clients: clientList_(),
    engineers: engineers.map(function (e) { return e.name; }),
    roster: engineers,
    projects: listProjects_(live),
    problems: validateBook(bookings, engineers),
    orphans: orphanProjects_(live, readProjectRows()),
    counts: {
      projects: readProjectRows().filter(function (p) { return p.project_title; }).length,
      live_rows: live.length,
      superseded_rows: bookings.length - live.length,
      forced_rows: live.filter(function (b) { return /FORCED/i.test(b.note || ''); }).length,
      pinned_rows: live.filter(function (b) { return /manual/i.test(b.note || ''); }).length,
    },
  };
}

function apiGetProject(title) {
  return getProjectForEdit(title);
}

// ---------------------------------------------------------------- write models

// Dry run — writes nothing. Answers "can we take this job".
function apiCheckProject(payload) {
  return checkProject(payload);
}

// Save, including a rename. When the title itself was the mistake, the old
// title's bookings are superseded and the row is renamed in place, so a typo
// never leaves a duplicate project behind.
function apiSaveProject(payload) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return { ok: false, errors: ['Another change is in progress. Try again in a moment.'] };
  try {
    var engineers = readEngineers();
    var bookings = readBookings();
    assertValidBook(bookings, engineers);

    var norm = normalizeProject(formPayloadToRaw_(payload));
    if (norm.errors.length) return { ok: false, errors: norm.errors };
    var project = norm.project;

    var original = String(payload.original_title || '').trim();
    var renamed = original && original !== project.project_title;

    // retire whatever this project currently holds, under either name
    var titles = renamed ? [original, project.project_title] : [project.project_title];
    var superseded = supersedeProjectBookings(titles);

    if (renamed) {
      var old = readProjectRows().filter(function (r) { return r.project_title === original; })[0];
      if (old) sheetOrThrow(TAB.PROJECTS).getRange(old._row, P_COL.TITLE).setValue(project.project_title);
    }

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
    res.renamed = renamed ? original : null;
    res.superseded = superseded;
    res.projects = listProjects_(activeRows(readBookings()));
    return res;
  } finally {
    lock.releaseLock();
  }
}

// Supersedes the bookings of projects the caller NAMED. Nothing is deleted and
// nothing is inferred: the UI passes the exact titles the user confirmed, and a
// title that has reappeared in the Projects tab since the page loaded is skipped
// rather than cleared.
// ---------------------------------------------------------- drag reassignment
//
// Move ONE WEEK of one phase to a different engineer. Deliberately not the whole
// phase: the Engineers view shows who is free week by week, so the week is the unit
// the user is actually looking at, and grouping the run would move things they did
// not touch.
//
// This writes BOOKING rows, not a project pick, because the Projects tab has no way
// to say "this person, this week" — its three pick columns are per-phase. The
// consequence is documented and warned about rather than hidden: a re-plot of that
// project rebuilds from the project row and loses these. See HANDOFF §2.
//
// Nothing here touches the engine. It is row surgery: supersede the run, write back
// up to three pieces.
function apiReassignWeek(payload) {
  payload = payload || {};
  var project = String(payload.project || '').trim();
  var phase = String(payload.phase || '').trim();
  var week = String(payload.week_start || '').trim();
  var to = String(payload.to_engineer || '').trim();
  if (!project || !phase || !week || !to) return { ok: false, error: 'Incomplete move.' };

  var engineers = readEngineers();
  if (!engineers.some(function (e) { return e.name === to; })) {
    return { ok: false, error: '"' + to + '" is not on the roster.' };
  }

  var live = activeRows(readBookings());
  var wi = widx(week);
  var row = live.filter(function (b) {
    return b.project === project && b.phase === phase &&
           widx(b.start_date) <= wi && wi <= widx(b.end_date);
  })[0];
  if (!row) return { ok: false, error: 'That week is no longer booked — reload and try again.' };
  if (row.engineer === to) return { ok: false, error: to + ' already has that week.' };

  var warnings = reassignWarnings_(row, wi, to, live, engineers);
  if (!payload.confirmed) {
    return { ok: true, preview: true, from: row.engineer, to: to,
             project: project, phase: phase, week_start: week, warnings: warnings };
  }

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return { ok: false, error: 'Another change is in progress.' };
  try {
    // Re-read under the lock. The warnings above were computed from a snapshot the
    // user has been looking at while a dialog was open; the write must not be.
    var fresh = activeRows(readBookings()).filter(function (b) {
      return b.row_number === row.row_number;
    })[0];
    if (!fresh) return { ok: false, error: 'That booking changed while you were deciding. Reload.' };

    // Split the run around the moved week. A booking row is a contiguous block, so
    // taking one week out of the middle leaves two remainders — up to three rows
    // where there was one. Rows are cheap; a wrong date is not.
    var s = widx(fresh.start_date), e = widx(fresh.end_date);
    var out = [];
    var piece = function (a, b, who, note) {
      if (a > b) return;
      out.push({ project: project, phase: phase, engineer: who,
                 start_date: weekStart(a), end_date: weekEnd(b),
                 source: 'manual', note: note, status: '' });
    };
    piece(s, wi - 1, fresh.engineer, fresh.note || '');
    piece(wi, wi, to, 'manual / moved by hand');
    piece(wi + 1, e, fresh.engineer, fresh.note || '');

    supersedeBookingRowNumbers([fresh.row_number]);
    appendBookings(out);

    return { ok: true, moved: true, from: fresh.engineer, to: to,
             project: project, phase: phase, week_start: week,
             rows_written: out.length, warnings: warnings };
  } finally {
    lock.releaseLock();
  }
}

// Everything a hand move is allowed to do but probably should not. A manual pick
// wins over every rule — that is the existing contract for the three pick columns
// and a drag must not be stricter — so these are warnings, never refusals.
function reassignWarnings_(row, wi, to, live, engineers) {
  var w = [];
  var eng = {};
  engineers.forEach(function (e) { eng[e.name] = e; });
  var t = eng[to] || {};
  var yes = function (v) { return String(v).trim().toLowerCase() === 'yes'; };

  var clash = live.filter(function (b) {
    return b.engineer === to && b !== row &&
           widx(b.start_date) <= wi && wi <= widx(b.end_date);
  });
  if (clash.length) {
    w.push({ kind: 'double', text: to + ' already has ' +
      clash.map(function (b) { return b.project + ' / ' + b.phase; }).join(' and ') +
      ' that week. This double-books them.' });
  }

  // Reserve first: the objective protects reserve double-booking above everything
  // else, so spending the reserve by hand is a different kind of decision.
  if (yes(t.overflow_only)) {
    w.push({ kind: 'reserve', text: to + ' is the reserve — kept free to absorb ' +
      'overflow. Every week spent here is a week not available for that.' });
  }

  var proj = readProjectRows().filter(function (p) {
    return p.project_title === row.project;
  })[0] || {};
  var needAdv = String(proj.mix_level_required || '').trim() === 'Advanced';
  var isSpecial = yes(proj.special_project);
  var isMusic = yes(proj.music_songs);

  if (row.phase === 'Mix') {
    if (!yes(t.can_mix)) w.push({ kind: 'eligibility', text: to + ' is not a mixer.' });
    else if (needAdv && canonMixLevel_(t.mix_level) !== 'Advanced') {
      w.push({ kind: 'eligibility', text: to + ' mixes at Developing level and this is an ' +
        'Advanced title.' });
    }
    if (widx(row.end_date) > widx(row.start_date)) {
      w.push({ kind: 'split', text: 'Mixing is normally kept with one person for continuity. ' +
        'Moving a single week splits it.' });
    }
  } else {
    var need = row.phase === 'Edit' ? 'can_edit' : 'can_record';
    if (!yes(t[need])) {
      w.push({ kind: 'eligibility', text: to + ' is not marked ' +
        (row.phase === 'Edit' ? 'an editor' : 'a recordist') + '.' });
    }
    if (!isSpecial && yes(t.specials_only)) {
      w.push({ kind: 'eligibility', text: to + ' takes special projects only, and this is not ' +
        'flagged Special.' });
    }
  }

  if (isMusic && !(String(t.music_specialist || '').trim().toLowerCase() === 'yes' ||
                   parseInt(t.music_specialist, 10) > 0)) {
    w.push({ kind: 'eligibility', text: to + ' is not a music specialist and this is a ' +
      'Music/Songs title.' });
  }
  return w;
}

function apiSupersedeOrphans(titles) {
  if (!titles || !titles.length) return { ok: false, error: 'Nothing selected.' };
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return { ok: false, error: 'Another change is in progress.' };
  try {
    var live = activeRows(readBookings());
    var stillOrphan = {};
    orphanProjects_(live, readProjectRows()).forEach(function (o) { stillOrphan[o.project] = true; });
    var doing = titles.filter(function (t) { return stillOrphan[t]; });
    var skipped = titles.filter(function (t) { return !stillOrphan[t]; });
    var n = doing.length ? supersedeProjectBookings(doing) : 0;
    return { ok: true, superseded: n, projects: doing, skipped: skipped,
             orphans: orphanProjects_(activeRows(readBookings()), readProjectRows()) };
  } finally {
    lock.releaseLock();
  }
}

function apiCancelProject(title) {
  var res = removeProject(title);
  if (res.ok) res.projects = listProjects_(activeRows(readBookings()));
  return res;
}

// ---------------------------------------------------------------- other views

function apiSchedule(mode, range) {
  var engineers = readEngineers();
  var live = activeRows(readBookings());
  var projects = readProjectRows();
  if (!live.length) return { empty: true, weeks: [], rows: [] };

  var minW = Infinity, maxW = -Infinity;
  live.forEach(function (b) {
    var a = widx(b.start_date), z = widx(b.end_date);
    if (a < minW) minW = a;
    if (z > maxW) maxW = z;
  });
  projects.forEach(function (p) {
    if (!p.deadline) return;
    var d = widx(p.deadline);
    if (d > maxW) maxW = d;
    if (d < minW) minW = d;
  });

  var weeks = [];
  for (var w = minW; w <= maxW; w++) {
    weeks.push({ week: w, start: weekStart(w), label: weekLabel(w),
                 day_range: weekDayRange(w), month: monthLabel(w), quarter: quarterOf(w) });
  }

  // Every quarter present, so the UI can offer only ranges that exist.
  var allQuarters = [];
  weeks.forEach(function (w) {
    if (allQuarters.indexOf(w.quarter) === -1) allQuarters.push(w.quarter);
  });
  allQuarters.sort();

  // Optional quarter-to-quarter clip. Quarter ids sort lexically ('2026-Q3'), so a
  // string comparison is the whole test. Bounded by construction: the caller names
  // both ends, so no amount of history can widen the grid.
  var from = range && range.from, to = range && range.to;
  if (from || to) {
    weeks = weeks.filter(function (w) {
      return (!from || w.quarter >= from) && (!to || w.quarter <= to);
    });
    if (!weeks.length) {
      return { empty: false, mode: mode === 'engineer' ? 'engineer' : 'project',
               weeks: [], labels: [], cells: [], markers: [], today_week: -1,
               quarters: allQuarters, range: { from: from || null, to: to || null },
               clipped: true };
    }
  }

  // Column index BY WEEK NUMBER rather than an offset from minW: once the range can
  // be clipped, `w - minW` no longer points at the right column.
  var colOf = {};
  weeks.forEach(function (w, i) { colOf[w.week] = i; });

  var byProject = (mode !== 'engineer');
  var labels;
  if (byProject) {
    // Order by WHEN THE WORK STARTS, which is what makes a schedule read
    // diagonally. Deadline is only a tiebreak now, and the title only breaks
    // ties after that.
    //
    // This used to sort on deadline alone, looked up from the PROJECTS tab — but
    // the grid is built from BOOKINGS. Any project with no matching Projects row
    // got no deadline, tied with every other such project at '9999', and fell
    // through to the alphabetical tiebreak. So a book full of orphaned bookings
    // (see orphanProjects_) rendered in alphabetical order, on a screen whose
    // entire purpose is chronological. Sorting on the bookings themselves cannot
    // drift from the thing being drawn (2026-08-13).
    var firstWeekOf = {}, deadlineOf = {};
    projects.forEach(function (p) { if (p.deadline) deadlineOf[p.project_title] = p.deadline; });
    live.forEach(function (b) {
      var w = widx(b.start_date);
      if (firstWeekOf[b.project] === undefined || w < firstWeekOf[b.project]) firstWeekOf[b.project] = w;
    });
    labels = Object.keys(firstWeekOf).sort(function (a, b) {
      return (firstWeekOf[a] - firstWeekOf[b]) ||
             String(deadlineOf[a] || '9999-12-31').localeCompare(String(deadlineOf[b] || '9999-12-31')) ||
             a.localeCompare(b);
    });
  } else {
    labels = engineers.map(function (e) { return e.name; });
  }

  var index = {};
  labels.forEach(function (l, i) { index[l] = i; });
  var cells = labels.map(function () { return weeks.map(function () { return null; }); });

  // An overlap is a WEEK in which one engineer holds two bookings — not a
  // property of the whole project. Marking every cell of a forced project was
  // wrong: it outlined weeks the engineer was perfectly free for.
  var perEngineerWeek = {};
  live.forEach(function (b) {
    for (var w = widx(b.start_date); w <= widx(b.end_date); w++) {
      var k = b.engineer + '|' + w;
      perEngineerWeek[k] = (perEngineerWeek[k] || 0) + 1;
    }
  });

  live.forEach(function (b) {
    var key = byProject ? b.project : b.engineer;
    var ri = index[key];
    if (ri === undefined) return;
    for (var w = widx(b.start_date); w <= widx(b.end_date); w++) {
      var ci = colOf[w];
      if (ci === undefined) continue;      // outside the range: skip the WEEK, not the booking
      var cur = cells[ri][ci];
      var text = byProject ? b.engineer : b.project;
      var overlapped = (perEngineerWeek[b.engineer + '|' + w] || 0) > 1;
      // items carries what the cell is MADE OF, one entry per booking. A cell can
      // hold two (that is what count > 1 means), and a drag has to know which one
      // it picked up — "the cell" is not a thing you can reassign.
      var item = { p: b.project, ph: b.phase, hand: /moved by hand/i.test(b.note || '') };
      if (!cur) {
        cells[ri][ci] = { phase: b.phase, text: text,
          overlap: overlapped,
          manual: /manual/i.test(b.note || ''), count: 1,
          items: byProject ? undefined : [item] };
      } else {
        cur.text += ' / ' + text;
        cur.count++;
        if (overlapped) cur.overlap = true;
        if (/manual/i.test(b.note || '')) cur.manual = true;
        if (cur.items) cur.items.push(item);
      }
    }
  });

  // deadline markers belong to projects
  var markers = [];
  if (byProject) {
    projects.forEach(function (p) {
      if (!p.deadline || index[p.project_title] === undefined) return;
      var ci = colOf[widx(p.deadline)];
      if (ci !== undefined) markers.push({ row: index[p.project_title], col: ci });
    });
  }

  // Clipping the columns is only half the job: a project with no work in the chosen
  // quarters was still rendering as an empty row, so a 13-week view still had 24 rows
  // to scroll past. Dropped only in PROJECT mode — in engineer mode an empty row is
  // information ("free all quarter"), whereas an absent project is just noise.
  if ((from || to) && byProject) {
    var keep = [];
    cells.forEach(function (row, ri) { if (row.some(function (c) { return c; })) keep.push(ri); });
    var remap = {};
    keep.forEach(function (ri, i) { remap[ri] = i; });
    labels = keep.map(function (ri) { return labels[ri]; });
    cells  = keep.map(function (ri) { return cells[ri]; });
    markers = markers.filter(function (m) { return remap[m.row] !== undefined; })
      .map(function (m) { return { row: remap[m.row], col: m.col }; });
  }

  var tw = colOf[widx(todayISO())];
  return { empty: false, mode: byProject ? 'project' : 'engineer',
           weeks: weeks, labels: labels, cells: cells, markers: markers,
           today_week: tw === undefined ? -1 : tw,
           quarters: allQuarters,
           range: { from: from || null, to: to || null } };
}

function apiAnalysis() {
  return getAnalysisData();
}

function apiReplanPreview() {
  var engineers = readEngineers();
  var bookings = readBookings();
  assertValidBook(bookings, engineers);
  var raw = readCommittedProjects();
  var projects = raw.map(function (p) { return normalizeProject(p).project; });
  if (!projects.length) return { empty: true };
  var frozen = raw.filter(function (p) { return p.locked; }).map(function (p) { return p.project_title; });

  var r = replanBook(projects, bookings, engineers, todayISO());
  PropertiesService.getDocumentProperties().setProperty(REPLAN_STASH_KEY, JSON.stringify({
    fingerprint: bookFingerprint_(bookings),
    rows_to_append: r.rows_to_append,
    rows_to_supersede: r.rows_to_supersede,
  }));
  return {
    empty: false,
    week_of: r.week_of,
    locked_rows: r.locked_rows,
    movable_rows: r.movable_rows,
    locked_started: r.locked_started,
    locked_frozen: r.locked_frozen,
    locked_pinned: r.locked_pinned,
    pinned_rows: activeRows(bookings).filter(function (b) { return /manual/i.test(b.note || ''); }).length,
    forced_before_rows: r.forced_before_rows,
    forced_after_rows: r.forced_after_rows,
    forced_locked_rows: r.forced_locked_rows,
    change_count: r.change_count,
    changes: r.changes,
    locked_projects: frozen,
  };
}

function apiReplanApply() {
  var raw = PropertiesService.getDocumentProperties().getProperty(REPLAN_STASH_KEY);
  if (!raw) return { ok: false, error: 'Run the preview first.' };
  var payload = JSON.parse(raw);

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return { ok: false, error: 'Another change is in progress.' };
  try {
    var engineers = readEngineers();
    var bookings = readBookings();
    assertValidBook(bookings, engineers);
    if (bookFingerprint_(bookings) !== payload.fingerprint) {
      return { ok: false, error: 'The bookings changed since the preview. Run the preview again.' };
    }
    var superseded = supersedeBookingRowNumbers(payload.rows_to_supersede);
    var appended = appendBookings((payload.rows_to_append || []).map(function (b) {
      return { project: b.project, phase: b.phase, engineer: b.engineer,
               start_date: b.start_date, end_date: b.end_date,
               source: 'replan', note: b.note || '', status: '' };
    }));
    PropertiesService.getDocumentProperties().deleteProperty(REPLAN_STASH_KEY);
    return { ok: true, appended: appended, superseded: superseded };
  } finally {
    lock.releaseLock();
  }
}

// Freeze or unfreeze one project. Locked projects are skipped entirely by a
// re-plan: their bookings are never superseded and never re-proposed. The toggle
// writes the Locked cell and nothing else, so it can never disturb the book.
function apiSetProjectLock(title, locked) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return { ok: false, error: 'Another change is in progress.' };
  try {
    var rows = readProjectRows().filter(function (p) { return p.project_title === title; });
    if (!rows.length) return { ok: false, error: 'No project called "' + title + '".' };
    var sh = sheetOrThrow(TAB.PROJECTS);
    sh.getRange(rows[0]._row, P_COL.LOCKED).setValue(locked === true);
    ioInvalidate();
    return { ok: true, title: title, locked: locked === true,
             projects: listProjects_(activeRows(readBookings())) };
  } finally {
    lock.releaseLock();
  }
}

