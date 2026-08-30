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

// Which projects actually have someone double-booked, computed from the weeks —
// never from the FORCED note.
//
// That note records what the engine decided AT THE MOMENT IT DECIDED IT. A later
// change — a swap, a divided dub, another project moving — can resolve the collision
// and the note stays behind, and a project can BECOME doubled with no note at all
// because the clash came from someone else's placement. Measured after one re-plan:
// Campioni was flagged forced with nobody on it doubled, while Blue Box S2 (Eps 3-4)
// and The Good Lawyer were genuinely doubled and carried no flag.
//
// Tara reported this three times as the Projects view "not updating". It was not
// stale — it was wrong, and no amount of refreshing could have fixed it.
function doubledProjects_(live) {
  var per = {};
  (live || []).forEach(function (b) {
    if (!b || !b.engineer || !b.start_date || !b.end_date) return;
    for (var w = widx(b.start_date); w <= widx(b.end_date); w++) {
      var k = b.engineer + '|' + w;
      (per[k] = per[k] || []).push(b);
    }
  });
  // Maps a project to the WORST depth any of its weeks reaches, so the list can show
  // two-at-once and three-at-once differently rather than flattening both to "forced".
  var out = {};
  Object.keys(per).forEach(function (k) {
    var n = per[k].length;
    if (n > 1) per[k].forEach(function (b) {
      if (n > (out[b.project] || 0)) out[b.project] = n;
    });
  });
  return out;
}

function projectForced_(title, live) {
  return !!doubledProjects_(live)[title];
}

// One engineer-week, one entry. `two` counts weeks where somebody holds exactly two
// bookings — ordinary, and shown as a blue warning. `three` counts weeks of three or
// more, which is overflow and has to be reassigned. `deep` maps engineer|week to its
// depth so a caller can colour a single cell without recounting the book.
//
// Depth is what the display is now built on. The engine's own scoring still cannot
// tell two from three — scorePlan counts weeks where the tally exceeds one and stops
// there — so it has no lever to avoid a three-way in particular. Left alone for now
// on Tara's call (2026-08-29): colours first, engine unchanged until the new reading
// has been used in anger.
function overlapDepths_(live) {
  var per = {};
  (live || []).forEach(function (b) {
    if (!b || !b.engineer || !b.start_date || !b.end_date) return;
    for (var w = widx(b.start_date); w <= widx(b.end_date); w++) {
      var k = b.engineer + '|' + w;
      per[k] = (per[k] || 0) + 1;
    }
  });
  var two = 0, three = 0;
  Object.keys(per).forEach(function (k) {
    if (per[k] === 2) two++;
    else if (per[k] > 2) three++;
  });
  return { two: two, three: three, deep: per };
}

function projectPinned_(title, live) {
  return live.some(function (b) {
    return b.project === title && /manual/i.test(b.note || '');
  });
}

// One row per project, with the engine's outcome and how it currently sits.
function listProjects_(live) {
  var doubled = doubledProjects_(live);
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
      atmos: /^yes$/i.test(p.atmos_required),
      recordist_pick: p.recordist_override || 'Auto',
      recordist_pick_2: p.recordist_override_2 || 'Auto',
      editor_pick: p.editor_override || 'Auto',
      mixer_pick: p.mixer_override || 'Auto',
      plotted: p.plotted,
      locked: p.locked === true,
      cancelled: /^cancelled/i.test(String(p.notes || '')) && rows.length === 0,
      live_rows: rows.length,
      forced: !!doubled[p.project_title],
      // worst overlap depth on this project: 0 clean, 2 a warning, 3+ overflow
      overlap: doubled[p.project_title] || 0,
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
  var depths = overlapDepths_(live);
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
      // Overlapped engineer-weeks BY DEPTH, counted from the book itself rather than
      // from rows carrying a FORCED note. Two at once is ordinary — a series still
      // recording while its edit starts — and is reported as a warning. Three at once
      // is overflow and has to be reassigned. The old single `forced_rows` count could
      // not tell those apart, and the note it used to read under-reports badly: an
      // overlap created by a LATER project landing on top never gets a note written.
      over2: depths.two,
      over3: depths.three,
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
    // Worst overlap depth this project now sits in: 0 clean, 2 a warning, 3+ overflow.
    // Read from the same list the Projects view renders, so the banner you get on save
    // and the row you see a second later cannot tell you different things.
    var mine = res.projects.filter(function (p) { return p.title === project.project_title; })[0];
    res.overlap = mine ? mine.overlap : 0;
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
    piece(wi, wi, to, 'manual / moved by hand (was ' + fresh.engineer + ')');
    piece(wi + 1, e, fresh.engineer, fresh.note || '');

    supersedeBookingRowNumbers([fresh.row_number]);
    appendBookings(out);
    refreshForcedNotes_();
    refreshProjectOutputsFromBook_([project]);

    ioInvalidate();
    return { ok: true, moved: true, from: fresh.engineer, to: to,
             project: project, phase: phase, week_start: week,
             rows_written: out.length, warnings: warnings, boot: apiBootstrap() };
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
      ' that week.' });
  }

  // Reserve first: the objective protects reserve double-booking above everything
  // else, so spending the reserve by hand is a different kind of decision.
  if (yes(t.overflow_only)) {
    w.push({ kind: 'reserve', text: to + ' is the reserve, kept free for overflow.' });
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
      w.push({ kind: 'eligibility', text: to + ' mixes at Developing level; this is Advanced.' });
    }
    if (widx(row.end_date) > widx(row.start_date)) {
      w.push({ kind: 'split', text: 'This splits the mix between two people.' });
    }
  } else {
    var need = row.phase === 'Edit' ? 'can_edit' : 'can_record';
    if (!yes(t[need])) {
      w.push({ kind: 'eligibility', text: to + ' is not marked ' +
        (row.phase === 'Edit' ? 'an editor' : 'a recordist') + '.' });
    }
    if (!isSpecial && yes(t.does_specials)) {
      w.push({ kind: 'eligibility', text: to + ' only takes Special projects.' });
    }
  }

  if (isMusic && !(String(t.music_specialist || '').trim().toLowerCase() === 'yes' ||
                   parseInt(t.music_specialist, 10) > 0)) {
    w.push({ kind: 'eligibility', text: to + ' is not a music specialist.' });
  }
  return w;
}

// Put a hand-moved week back under the engine's control.
//
// A drag carves one week out of a run and gives it to someone else, leaving up to
// three rows where there was one. Undoing it means the reverse: hand the week back to
// whoever holds the neighbouring weeks of that phase and re-merge the pieces into
// unbroken runs.
//
// Until now the only route back was Save & re-plot on the project, which discards
// EVERY hand-placed week on it — far too blunt when you regret one drag out of four,
// and invisible from the Schedule view where the dragging happened.
//
// Where there is no neighbour to merge into — the phase is a single week, or every
// week of it was moved by hand — there is nothing to restore it to, and the honest
// answer is to say so and point at the re-plot.
function apiUndoWeekMove(payload) {
  payload = payload || {};
  var project = String(payload.project || '').trim();
  var phase = String(payload.phase || '').trim();
  var week = String(payload.week_start || '').trim();
  if (!project || !phase || !week) return { ok: false, error: 'Incomplete.' };

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return { ok: false, error: 'Another change is in progress.' };
  try {
    var live = activeRows(readBookings());
    var wi = widx(week);
    var rows = live.filter(function (b) { return b.project === project && b.phase === phase; });
    var target = rows.filter(function (b) {
      return widx(b.start_date) <= wi && wi <= widx(b.end_date) && /moved by hand/i.test(b.note || '');
    })[0];
    if (!target) return { ok: false, error: 'That week was not moved by hand.' };

    // The row records who it came from. The first version of this inferred the answer
    // from whoever held the neighbouring weeks, which cannot work for a one-week phase
    // or when every week of a phase was moved — it just reported that there was
    // nothing to hand back to. Writing the name down at drag time removes the guess.
    var was = /\(was ([^)]+)\)/.exec(target.note || '');
    var to = was ? was[1].trim() : null;

    if (!to) {
      // rows dragged before the name was recorded: fall back to the neighbour
      var weight = {};
      rows.forEach(function (b) {
        if (b === target) return;
        var a = widx(b.start_date), z = widx(b.end_date);
        if (z === wi - 1 || a === wi + 1) {
          weight[b.engineer] = (weight[b.engineer] || 0) + (z - a + 1);
        }
      });
      to = Object.keys(weight).sort(function (a, b) {
        return weight[b] - weight[a] || a.localeCompare(b);
      })[0];
    }
    if (!to) {
      return { ok: false,
        error: 'This week was moved before the tool started recording where from, and ' +
               'there is no neighbouring week to infer it. Drag it where you want it, or ' +
               'open the project and Save & re-plot to return the whole thing to automatic.' };
    }
    if (!readEngineers().some(function (e) { return e.name === to; })) {
      return { ok: false, error: '"' + to + '" is no longer on the roster.' };
    }

    // merge the reclaimed week into that engineer's other weeks of this phase
    var mine = rows.filter(function (b) { return b.engineer === to; });
    var weeks = {};
    mine.forEach(function (b) { for (var w = widx(b.start_date); w <= widx(b.end_date); w++) weeks[w] = 1; });
    weeks[wi] = 1;
    var ws = Object.keys(weeks).map(Number).sort(function (a, b) { return a - b; });
    var runs = [], cur = [ws[0]];
    for (var i = 1; i < ws.length; i++) {
      if (ws[i] === ws[i - 1] + 1) cur.push(ws[i]); else { runs.push(cur); cur = [ws[i]]; }
    }
    runs.push(cur);

    // if someone else has since taken that week, say so rather than silently doubling
    var clash = live.filter(function (b) {
      return b !== target && b.engineer === to &&
             widx(b.start_date) <= wi && wi <= widx(b.end_date);
    }).map(function (b) { return b.project + ' / ' + b.phase; });

    var note = mine.length ? (mine[0].note || '') : '';
    supersedeBookingRowNumbers(mine.map(function (b) { return b.row_number; })
      .concat([target.row_number]));
    appendBookings(runs.map(function (r) {
      return { project: project, phase: phase, engineer: to,
               start_date: weekStart(r[0]), end_date: weekEnd(r[r.length - 1]),
               source: 'plot', note: note, status: '' };
    }));
    refreshForcedNotes_();
    refreshProjectOutputsFromBook_([project]);
    ioInvalidate();
    return { ok: true, to: to, from: target.engineer, week_start: week,
             project: project, phase: phase, clash: clash, boot: apiBootstrap() };
  } finally {
    lock.releaseLock();
  }
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
      // How many things this engineer holds in this week: 1 clean, 2 a warning,
      // 3+ overflow. In Projects mode the cell belongs to a project rather than an
      // engineer, so it takes the worst depth among the engineers appearing in it.
      var deep = perEngineerWeek[b.engineer + '|' + w] || 1;
      var overlapped = deep > 1;
      // items carries what the cell is MADE OF, one entry per booking. A cell can
      // hold two (that is what count > 1 means), and a drag has to know which one
      // it picked up — "the cell" is not a thing you can reassign.
      var item = { p: b.project, ph: b.phase, hand: /moved by hand/i.test(b.note || '') };
      if (!cur) {
        cells[ri][ci] = { phase: b.phase, text: text,
          overlap: overlapped, depth: deep,
          manual: /manual/i.test(b.note || ''), count: 1,
          items: byProject ? undefined : [item] };
      } else {
        cur.text += ' / ' + text;
        cur.count++;
        if (deep > (cur.depth || 1)) cur.depth = deep;
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


// Who is doubled, which week, on which two projects — for the book as it stands and
// for the book a re-plan would produce.
//
// "4 forced-overlap booking rows" is a true number and a useless one: it does not say
// who, when, or which titles collide, so there is no way to judge whether the trade a
// re-plan is offering is a good one. A row per (engineer, week) with the colliding
// projects named is the same fact in a form you can act on.
function overlapDetail_(book) {
  var per = {};
  (book || []).forEach(function (b) {
    if (!b || !b.engineer || !b.start_date || !b.end_date) return;
    for (var w = widx(b.start_date); w <= widx(b.end_date); w++) {
      var k = b.engineer + '|' + w;
      (per[k] = per[k] || []).push(b);
    }
  });
  return Object.keys(per).filter(function (k) { return per[k].length > 1; })
    .map(function (k) {
      var parts = k.split('|'), wk = Number(parts[1]);
      return {
        key: k,
        engineer: parts[0],
        week: wk,
        label: weekLabel(wk),
        projects: per[k].map(function (b) { return b.project + ' / ' + b.phase; }).sort(),
        forced: per[k].some(function (b) { return /FORCED/i.test(b.note || ''); }),
      };
    })
    .sort(function (a, b) { return a.week - b.week || a.engineer.localeCompare(b.engineer); });
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

  // the same book an apply would leave behind, so the overlap list is what you get
  var goneSet = {};
  (r.rows_to_supersede || []).forEach(function (n) { goneSet[n] = true; });
  var live = activeRows(bookings);
  var afterBook = live.filter(function (b) { return !goneSet[b.row_number]; })
    .concat(r.rows_to_append || []);
  var beforeOv = overlapDetail_(live), afterOv = overlapDetail_(afterBook);
  var wasKey = {}; beforeOv.forEach(function (o) { wasKey[o.key] = true; });
  var nowKey = {}; afterOv.forEach(function (o) { nowKey[o.key] = true; });
  afterOv.forEach(function (o) { o.isNew = !wasKey[o.key]; });
  var resolved = beforeOv.filter(function (o) { return !nowKey[o.key]; });
  PropertiesService.getDocumentProperties().setProperty(REPLAN_STASH_KEY, JSON.stringify({
    fingerprint: bookFingerprint_(bookings),
    rows_to_append: r.rows_to_append,
    rows_to_supersede: r.rows_to_supersede,
  }));
  return {
    empty: false,
    no_improvement: !!r.no_improvement,
    overlaps_before: beforeOv,
    overlaps_after: afterOv,
    overlaps_resolved: resolved,
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

    // The Projects tab has to follow, or it keeps showing the plot's answer — the
    // engineers, the warnings, and the red highlight on a forced row.
    var touched = {};
    (payload.rows_to_append || []).forEach(function (b) { touched[b.project] = true; });
    activeRows(readBookings()).forEach(function (b) { touched[b.project] = true; });
    refreshForcedNotes_();
    var refreshed = refreshProjectOutputsFromBook_(Object.keys(touched));

    // Hand back the new state rather than making the client ask for it. A follow-up
    // apiBootstrap is a separate execution that can start before this one's writes
    // are visible — which is exactly how the Projects view kept showing the old plan
    // while the Schedule, fetched a moment later still, showed the new one.
    ioInvalidate();
    return { ok: true, appended: appended, superseded: superseded,
             projects_refreshed: refreshed, boot: apiBootstrap() };
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

