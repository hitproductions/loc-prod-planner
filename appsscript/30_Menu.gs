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
  ui.createMenu('Engineer Assignment')
    .addItem('Check bookings for problems', 'checkBookings')
    .addItem('Relink a renamed project', 'relinkRenamedProject')
    .addItem('Fix the overlap notes', 'fixForcedNotes')
    .addItem('Clear ghost projects', 'clearGhostProjects')
    .addItem('Why this mixer?', 'whyThisMixer')
    .addSubMenu(ui.createMenu('Admin')
      .addItem('Set up sheets', 'setupSheets')
      .addItem('Plot all unplotted rows', 'plotAllUnplotted')
      .addItem('Refresh engineer dropdowns', 'refreshEngineerDropdowns')
      .addSeparator()
      .addItem('Wipe the schedule (build only)', 'resetSchedule'))
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

// Surfaces exactly what assertValidBook would refuse to schedule from, plus the
// two conditions that make a clean plan look broken: ghosts and duplicates.
function checkBookings() {
  var ui = SpreadsheetApp.getUi();
  var problems, live, ghosts, dupes, roster;
  try {
    var bookings = readBookings();
    live = activeRows(bookings);
    problems = validateBook(bookings, readEngineers());
    ghosts = orphanProjects_(live, readProjectRows());
    dupes = duplicateLiveRows_(live);
    roster = rosterProblems(readEngineers());
  } catch (e) {
    ui.alert('Could not read the sheet: ' + e.message);
    return;
  }

  var report = [];
  if (roster.length) {
    report.push('ROSTER: ' + roster.length + ' problem(s). These change WHO is eligible,');
    report.push('so the schedule looks wrong while the engine is behaving correctly.');
    roster.forEach(function (r) { report.push('  \u2022 ' + r); });
    report.push('');
  }
  if (dupes.length) {
    report.push('DUPLICATE LIVE ROWS: ' + dupes.length + '.');
    report.push('The same booking exists twice, so every one of those weeks counts as');
    report.push('an overlap even though the schedule itself is fine. Cause: a project was');
    report.push('plotted twice and the first pass was never superseded.');
    dupes.slice(0, 8).forEach(function (d) {
      report.push('  \u2022 ' + d.project + ' \u2014 ' + d.phase + ' \u2014 ' + d.engineer +
        ' \u2014 rows ' + d.rows.join(' and '));
    });
    if (dupes.length > 8) report.push('  \u2026and ' + (dupes.length - 8) + ' more.');
    report.push('');
  }
  if (ghosts.length) {
    report.push('GHOST PROJECTS: ' + ghosts.length + ' (' +
      ghosts.reduce(function (n, o) { return n + o.rows; }, 0) + ' rows).');
    report.push('On the schedule with no row in the Projects tab. They inflate overlap too.');
    report.push('Fix with Engineer Assignment > Clear ghost projects.');
    report.push('');
  }
  if (problems.length) {
    report.push('DATA PROBLEMS: ' + problems.length + '. Scheduling refuses to run with these.');
    problems.slice(0, 20).forEach(function (p) { report.push('  \u2022 ' + p); });
    if (problems.length > 20) report.push('  \u2026and ' + (problems.length - 20) + ' more.');
  }

  if (!report.length) {
    ss().toast(live.length + ' live rows, no duplicates, no ghosts.', 'Bookings look clean', 6);
    return;
  }
  ui.alert('Bookings: ' + live.length + ' live rows', report.join('\n'), ui.ButtonSet.OK);
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

// The FORCED note on a live booking row records a decision, not a fact, so it drifts
// as soon as anything else moves. Every read path now counts weeks instead — but the
// Bookings tab still holds whatever was written last, and it is the record people
// open. This brings it into line without waiting for the next apply.
function fixForcedNotes() {
  var ui = SpreadsheetApp.getUi();
  var n;
  try { n = refreshForcedNotes_(); }
  catch (e) { ui.alert('Could not read the sheet: ' + e.message); return; }
  if (!n) {
    ss().toast('Every live booking row already says the right thing.', 'Nothing to fix', 5);
    return;
  }
  ui.alert('Fixed ' + n + ' note(s)',
    'Rows that are not actually double-booked no longer claim to be, and rows that ARE ' +
    'now say so.\n\nOnly live rows changed. Superseded rows are history and were left ' +
    'alone.', ui.ButtonSet.OK);
}

function clearGhostProjects() {
  var ui = SpreadsheetApp.getUi();
  var orphans;
  try {
    orphans = orphanProjects_(activeRows(readBookings()), readProjectRows());
  } catch (e) {
    ui.alert('Could not read the sheet: ' + e.message);
    return;
  }
  if (!orphans.length) {
    ss().toast('Every project on the schedule has a row in the Projects tab.',
      'Nothing to clear', 5);
    return;
  }
  var rows = orphans.reduce(function (n, o) { return n + o.rows; }, 0);
  var list = orphans.slice(0, 25).map(function (o) {
    return '  \u2022 ' + o.project + ' \u2014 ' + o.rows + ' row(s)';
  }).join('\n') + (orphans.length > 25 ? '\n  \u2026and ' + (orphans.length - 25) + ' more.' : '');

  var answer = ui.alert('Clear ' + orphans.length + ' ghost project(s)?',
    'These are on the schedule but have no row in the Projects tab:\n\n' + list +
    '\n\n' + rows + ' booking row(s) will be marked "superseded" so they stop showing.\n' +
    'NOTHING IS DELETED \u2014 the rows stay in the Bookings tab as history, and clearing ' +
    'the status cell puts one back.',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) { ss().toast('Left alone.', 'Cancelled', 4); return; }

  var n = supersedeProjectBookings(orphans.map(function (o) { return o.project; }));
  ui.alert('Cleared', n + ' booking row(s) marked superseded across ' + orphans.length +
    ' project(s). Reload the app to see the schedule without them.', ui.ButtonSet.OK);
}

// Why a given project's mixer is who it is. Answers the question directly instead
// of leaving it to be inferred from the grid: who was eligible, who was free, and
// what the tie-break was.
//
// pick() ranks on TOTAL load across all phases, not mix load — so a heavy
// record/edit week makes someone LESS likely to be handed a mix, which is easy to
// misread as the engine ignoring an idle mixer.
function whyThisMixer() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Which project?', 'Type the project title exactly as it appears in the Projects tab.',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var title = String(resp.getResponseText() || '').trim();
  if (!title) return;

  var engineers = readEngineers();
  var rows = readProjectRows().filter(function (p) { return p.project_title === title; });
  if (!rows.length) { ui.alert('No project called "' + title + '".'); return; }
  var proj = normalizeProject(rows[0]).project;

  var live = activeRows(readBookings());
  var mine = live.filter(function (b) { return b.project === title && b.phase === 'Mix'; });
  if (!mine.length) { ui.alert(title + ' has no live Mix booking.'); return; }

  var a = widx(mine[0].start_date), z = widx(mine[mine.length - 1].end_date);
  var needAdv = String(proj.mix_level_required).trim() === 'Advanced';
  var yes = function (v) { return String(v).trim().toLowerCase() === 'yes'; };

  // occupancy over the mix block, EXCLUDING this project's own rows
  var busy = {};
  live.forEach(function (b) {
    if (b.project === title && b.phase === 'Mix') return;
    for (var w = widx(b.start_date); w <= widx(b.end_date); w++) busy[b.engineer + '|' + w] = b;
  });
  var loadOf = {};
  live.forEach(function (b) {
    var n = widx(b.end_date) - widx(b.start_date) + 1;
    loadOf[b.engineer] = (loadOf[b.engineer] || 0) + n;
  });

  var lines = [title + ' \u2014 Mix, ' + mine[0].start_date + ' to ' + mine[mine.length - 1].end_date +
    ' (' + (z - a + 1) + 'wk)', 'Needs: ' + (needAdv ? 'Advanced' : 'Developing') + ' level',
    'Currently: ' + mine.map(function (b) { return b.engineer; }).join(', '), ''];

  engineers.forEach(function (e) {
    var why = [];
    if (!yes(e.can_mix)) why.push('can_mix is not Yes');
    else {
      if (needAdv && e.mix_level !== 'Advanced')
        why.push('level is "' + (e.mix_level || 'blank') + '", not Advanced');
      if (yes(e.overflow_only)) why.push('overflow reserve \u2014 only used when everyone else is busy');
    }
    var clash = [];
    for (var w = a; w <= z; w++) if (busy[e.name + '|' + w]) clash.push(busy[e.name + '|' + w].project);
    if (clash.length) why.push('busy ' + clash.length + 'wk (' + clash.filter(function (v, i, s2) {
      return s2.indexOf(v) === i; }).join(', ') + ')');
    lines.push((why.length ? '  \u2717 ' : '  \u2713 ') + e.name +
      '  [load ' + (loadOf[e.name] || 0) + 'wk]' + (why.length ? ' \u2014 ' + why.join('; ') : ' \u2014 ELIGIBLE AND FREE'));
  });

  lines.push('');
  lines.push('Among eligible-and-free, the pick is: lowest TOTAL load across all phases,');
  lines.push('then longest gap since their last booking, then alphabetical. Total load is');
  lines.push('why a busy recordist is passed over for a mix.');
  ui.alert('Why this mixer', lines.join('\n'), ui.ButtonSet.OK);
}
