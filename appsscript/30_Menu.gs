// The sheet's menu is thin: the web app is the interface, so this exists to load a
// batch and to check the data. There is no trigger to install.
//
// There was an "Open the app" item. It is gone (2026-08-13): it read the URL from
// ScriptApp.getService().getUrl(), which returns null unless the manifest carries a
// webapp block AND a matching deployment exists — state managed in the Apps Script
// editor, not here. It reported "Not deployed yet" while the app was in fact
// running, which is worse than not offering it. The URL is a bookmark.

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  // Trimmed 2026-08-31. What went, and why:
  //
  //   Check bookings for problems  the app shows the same validateBook result as a
  //                                banner on every load, so this was a second, worse
  //                                surface for something already in front of you
  //   Clear ghost projects         the app both detects orphans AND offers the fix,
  //                                with an explanation this dialog never had
  //   Fix the overlap notes        it repaired a note that five surfaces used to read.
  //                                They all count the weeks now, so nothing in either
  //                                app displays it
  //   Why this mixer?              an explainer nobody reached for
  //   Wipe the schedule            a build-time tool, two clicks from Set up sheets,
  //                                that deletes the whole schedule (HANDOFF §11)
  //
  // What is left is what has no equivalent anywhere else: setup, the dropdown refresh
  // that fixes validation WITHOUT wiping Projects, plotting rows typed straight into
  // the sheet, and repairing a project renamed in the sheet by hand.
  ui.createMenu('Engineer Assignment')
    .addItem('Relink a renamed project', 'relinkRenamedProject')
    .addSubMenu(ui.createMenu('Admin')
      .addItem('Set up sheets', 'setupSheets')
      .addItem('Plot all unplotted rows', 'plotAllUnplotted')
      .addItem('Refresh engineer dropdowns', 'refreshEngineerDropdowns'))
    .addToUi();
}

// Two live rows identical in project, phase, engineer AND dates.
//
// The engine cannot produce these: a divided dub emits one row per engineer, and
// runsOf() emits one row per contiguous run, so no two rows ever match on all
// four. An exact pair therefore means the same project was plotted twice without
// the first pass being superseded — a stale book.
//
// Worth its own check because of how it LOOKS: overlap is counted per
// engineer-week across every live row, so a duplicated book reports the whole
// schedule as double-booked while the engine's own plan is untouched. That reads
// as "the scheduler got worse" when nothing about it changed (2026-08-13).
function duplicateLiveRows_(live) {
  var seen = {}, dupes = [];
  live.forEach(function (b) {
    var k = [b.project, b.phase, b.engineer, b.start_date, b.end_date].join('||');
    if (seen[k]) dupes.push({ project: b.project, phase: b.phase, engineer: b.engineer,
                              start: b.start_date, rows: [seen[k], b.row_number] });
    else seen[k] = b.row_number;
  });
  return dupes;
}


// Projects still on the schedule with no row in the Projects tab.
//
// This lives on the MENU, not only in the web app, for a specific reason: the app
// is served from a published deployment version, so app-side fixes are invisible
// until someone bumps that version. Menu code runs the latest pushed script the
// moment the sheet is opened. When the book needs repairing, the repair has to be
// reachable — HANDOFF §8 is explicit that the sheet exists so the data can be
// fixed without a developer.
//
// How the ghosts happen: "Set up sheets" resets the PROJECTS tab and deliberately
// leaves BOOKINGS alone, because bookings are the history and rule 15 says never
// delete them. So rebuilding the sheet clears the project list and keeps every
// booking row ever written — and the schedule is drawn from bookings, so those
// projects keep rendering with nothing left to select (2026-08-13).
// Sits ABOVE "Clear ghost projects" in the menu on purpose. A renamed project and a
// deleted one look identical — both show as ghosts — but the fixes are opposite, and
// clearing is the one that costs you the assignments. The recoverable action should
// be the one people reach first.
function relinkRenamedProject() {
  var ui = SpreadsheetApp.getUi();
  var live, projectRows;
  try {
    live = activeRows(readBookings());
    projectRows = readProjectRows();
  } catch (e) {
    ui.alert('Could not read the sheet: ' + e.message);
    return;
  }

  var orphans = orphanProjects_(live, projectRows);
  if (!orphans.length) {
    ss().toast('Every project on the schedule has a row in the Projects tab.',
      'Nothing to relink', 5);
    return;
  }

  // Titles that already hold live bookings. A project with none is the likely
  // rename target — it exists in Projects but nothing on the schedule points at it,
  // which is exactly what a sheet-side retitle leaves behind.
  var booked = {};
  live.forEach(function (b) { booked[b.project] = true; });
  var unbooked = projectRows.filter(function (p) {
    return p.project_title && !booked[p.project_title];
  }).map(function (p) { return p.project_title; });

  if (!unbooked.length) {
    ui.alert('Nothing to relink to',
      'Every project in the Projects tab already has bookings, so none of them looks ' +
      'like a renamed one.\n\nIf a project really was deleted rather than renamed, use ' +
      '"Clear ghost projects" instead.', ui.ButtonSet.OK);
    return;
  }

  var pickFrom = promptForChoice_(ui, 'Relink a renamed project (1 of 2)',
    'Which schedule is stranded? These are on the schedule with no matching row in ' +
    'Projects:',
    orphans.map(function (o) { return o.project + ' — ' + o.rows + ' row(s)'; }));
  if (pickFrom === null) return;
  var from = orphans[pickFrom].project;

  var pickTo = promptForChoice_(ui, 'Relink a renamed project (2 of 2)',
    'Move "' + from + '" onto which project?\n\nThese are in the Projects tab with no ' +
    'bookings of their own — one of them is probably the new name:',
    unbooked);
  if (pickTo === null) return;
  var to = unbooked[pickTo];

  var moving = live.filter(function (b) { return b.project === from; }).length;
  var answer = ui.alert('Relink ' + moving + ' booking row(s)?',
    '"' + from + '"  →  "' + to + '"\n\n' +
    'The engineers and dates do not change — only the name the rows are filed under. ' +
    'Superseded rows are left alone, since they are history under the old name.\n\n' +
    'This is reversible: relink back the same way.',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) {
    ss().toast('Nothing was changed.', 'Cancelled', 5);
    return;
  }

  var n = relinkProjectBookings(from, to);
  ui.alert('Relinked',
    n + ' booking row(s) now belong to "' + to + '".\n\n' +
    'Reload the web app to see it — the views fetch once when they open.',
    ui.ButtonSet.OK);
}

// A numbered-list prompt. Apps Script has no list picker in a menu dialog, so this
// is the honest version: show the options, take an index. Returns a 0-based index,
// or null if the user cancelled or typed something unusable.
function promptForChoice_(ui, title, intro, options) {
  var shown = options.slice(0, 30);
  var list = shown.map(function (o, i) { return '  ' + (i + 1) + '.  ' + o; }).join('\n');
  var more = options.length > shown.length
    ? '\n  …and ' + (options.length - shown.length) + ' more, not listed.' : '';

  var resp = ui.prompt(title,
    intro + '\n\n' + list + more + '\n\nType a number (1–' + shown.length + '):',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return null;

  var raw = String(resp.getResponseText() || '').trim();
  var i = parseInt(raw, 10);
  if (!isFinite(i) || String(i) !== raw || i < 1 || i > shown.length) {
    ui.alert('Not a valid choice',
      '"' + raw + '" is not a number between 1 and ' + shown.length +
      '.\n\nNothing was changed. Run it again.', ui.ButtonSet.OK);
    return null;
  }
  return i - 1;
}



