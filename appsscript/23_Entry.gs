// Bulk plotting, for loading a batch of projects pasted straight into the sheet.
//
// This replaces the old Commit-checkbox + installable onEdit trigger. There is
// no trigger in this tool any more: the web app has buttons, so nothing needs a
// checkbox pretending to be one, and nothing mutates a cell behind you.
//
// Everyday entry is the web app. This exists for the one-off case — pasting the
// historical book, or a batch someone prepared in a spreadsheet.

function plotAllUnplotted() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    ss().toast('Another change is already running. Try again in a moment.', 'Busy', 5);
    return;
  }
  try {
    var engineers = readEngineers();
    var bookings = readBookings();
    assertValidBook(bookings, engineers);

    // A row counts as unplotted when it has a title but no Plotted stamp.
    var candidates = readProjectRows().filter(function (p) {
      return p.project_title && !p.plotted;
    });
    if (!candidates.length) {
      ss().toast('Every project row already has a Plotted date. Nothing to do.', 'Nothing to plot', 6);
      return;
    }

    var resp = ui.alert('Plot ' + candidates.length + ' project(s)?',
      candidates.slice(0, 12).map(function (p) {
        return '• ' + p.project_title + '  ' + (p.deadline || '(no deadline)') + '  ' + (p.phases || '');
      }).join('\n') +
      (candidates.length > 12 ? '\n…and ' + (candidates.length - 12) + ' more.' : '') +
      '\n\nThey are processed in deadline order, earliest first. Rows with a problem are ' +
      'skipped and the reason is written into their Notes cell.',
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;

    // Validate everything first, so one bad row never half-commits the batch.
    var good = [], bad = [];
    candidates.forEach(function (p) {
      var res = normalizeProject(p);
      if (res.errors.length) bad.push({ row: p._row, errors: res.errors });
      else good.push({ row: p._row, project: res.project });
    });
    bad.forEach(function (b) { writeProjectError(b.row, b.errors.join(' ')); });

    if (!good.length) {
      ui.alert('Nothing plotted', 'All ' + bad.length + ' row(s) had problems — see the Notes ' +
        'column on each.', ui.ButtonSet.OK);
      return;
    }

    var titles = good.map(function (g) { return g.project.project_title; });
    var retired = supersedeProjectBookings(titles);

    // Solved rather than simply sorted: the same greedy engine is run under
    // several orderings and the best plan kept. Ordering changes only WHO is
    // picked — every phase window still comes from its own deadline.
    var rowOf = {};
    good.forEach(function (g) { rowOf[g.project.project_title] = g.row; });

    var batch = plotBatch(good.map(function (g) { return g.project; }),
                          readBookings(), engineers);
    appendBookings(batch.new_rows);

    var newRows = batch.new_rows, forcedCount = 0;
    good = batch.results.filter(function (r) { return r.result; }).map(function (r) {
      if (r.result.forced) forcedCount++;
      return { row: rowOf[r.project.project_title], project: r.project, out: r.result };
    });

    var stamp = todayISO();
    good.forEach(function (g) {
      var out = g.out;
      clearProjectOutputs(g.row);
      writeProjectOutputs(g.row, {
        dub_weeks: g.project.dub_weeks,
        edit_weeks: g.project.edit_weeks,
        mix_weeks: g.project.mix_weeks,
        recordist: out.dubber || out.recordist,
        editor: out.editor || out.recordist,
        mixer: out.mixer,
        warnings: out.warnings,
        notes: [out.record_note, out.mix_note].filter(String).join(' | '),
        plotted: stamp,
        forced: out.forced,
      });
    });

    var s = batch.solve, b0 = s.baseline;
    ui.alert('Plotted',
      good.length + ' project(s) plotted.\n' +
      newRows.length + ' booking rows written' + (retired ? ', ' + retired + ' superseded' : '') + '.\n' +
      (forcedCount ? forcedCount + ' project(s) needed a FORCED OVERLAP — someone is double-booked.\n' : '') +
      (bad.length ? bad.length + ' row(s) skipped, see their Notes cell.\n' : '') +
      '\nTried ' + s.candidates_tried + ' orderings' +
      (s.improved
        ? ' and found a better one than plain deadline order:\n' +
          '   forced projects ' + b0.forced_projects + ' → ' + s.score.forced_projects + '\n' +
          '   load spread across the regular pool ' + b0.regular_spread + ' → ' + s.score.regular_spread + ' weeks\n' +
          '   double-booked weeks ' + b0.total_double_booked + ' → ' + s.score.total_double_booked
        : '; deadline order was already the best of them.') +
      '\n\nOpen the web app to see the schedule.',
      ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}
