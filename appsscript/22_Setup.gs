// Builds the four data tabs. Idempotent, and it RESETS the Projects tab rather
// than writing over it — an earlier version of this tool built a different
// layout (a Commit checkbox column, three generated view tabs), and writing new
// headers on top of that would leave orphaned checkboxes and shifted columns.
//
// The schedule and engineer view live in the web app now. The
// sheet is the data store: readable and repairable without a developer.

function setupSheets() {
  var book = ss();
  var ui = SpreadsheetApp.getUi();
  var pre = preflightSetup_();

  if (pre.blocking.length) {
    var resp = ui.alert('Existing data found — setup would overwrite it',
      pre.blocking.join('\n\n') +
      '\n\nSetup writes header rows and applies validation over these tabs. On a tab ' +
      'laid out differently, that damages data.\n\nProceed anyway?',
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) {
      ss().toast('Setup cancelled. Nothing was changed.', 'Cancelled', 8);
      return;
    }
  }

  [TAB.PROJECTS, TAB.BOOKINGS, TAB.ENGINEERS, TAB.CONFIG]
    .forEach(function (name) { if (!book.getSheetByName(name)) book.insertSheet(name); });

  // Name the tab in any failure — a bare Sheets exception gives no clue where it
  // came from, and setup touches four tabs.
  var steps = [
    ['Config',    setupConfigTab_],
    ['Engineers', setupEngineersTab_],
    ['Bookings',  setupBookingsTab_],
    ['Projects',  setupProjectsTab_],
  ];
  for (var i = 0; i < steps.length; i++) {
    try {
      steps[i][1]();
    } catch (err) {
      throw new Error('Set up sheets failed while building the "' + steps[i][0] + '" tab: ' +
        (err && err.message ? err.message : err) +
        '\n\nTabs before this one are already set up. Fix the cause and run it again — ' +
        'it is safe to re-run.');
    }
  }

  book.getSheetByName(TAB.CONFIG).hideSheet();
  offerToRemoveRetiredTabs_(ui);
  reorderTabs_();
  ss().toast('Four data tabs ready. Add the roster to Engineers, then use the web app.',
             'Ready', 8);
}

// Only checks the header rows of tabs that hold data. A tab whose header row
// already matches is safe to reformat.
function preflightSetup_() {
  var blocking = [];
  var expected = {};
  expected[TAB.BOOKINGS]  = { row: B_HEADER_ROW, headers: B_HEADERS };
  expected[TAB.ENGINEERS] = { row: E_HEADER_ROW, headers: E_HEADERS };

  Object.keys(expected).forEach(function (name) {
    var sh = ss().getSheetByName(name);
    if (!sh || sh.getLastRow() === 0) return;
    var spec = expected[name];
    var width = Math.max(sh.getLastColumn(), spec.headers.length);
    var found = sh.getRange(spec.row, 1, 1, width).getValues()[0]
      .map(function (v) { return String(v || '').trim(); });
    var matches = spec.headers.every(function (h, i) {
      return String(found[i] || '').toLowerCase() === String(h).toLowerCase();
    });
    if (!matches) {
      blocking.push('"' + name + '" already has ' + sh.getLastRow() + ' row(s) and its header row ' +
        'does not match.\n   expects: ' + spec.headers.join(' | ') +
        '\n   found:   ' + found.slice(0, spec.headers.length).join(' | '));
    }
  });

  // Projects is reset wholesale, so it only blocks when it holds real projects.
  var pj = ss().getSheetByName(TAB.PROJECTS);
  if (pj && pj.getLastRow() > P_HEADER_ROW) {
    var titles = pj.getRange(P_FIRST_DATA_ROW, 1, pj.getLastRow() - P_HEADER_ROW, 2)
      .getValues().filter(function (r) {
        return String(r[0] || '').trim() || String(r[1] || '').trim();
      });
    if (titles.length) {
      blocking.push('"' + TAB.PROJECTS + '" holds ' + titles.length + ' row(s) with content. ' +
        'Setup clears and rebuilds this tab, including its column layout.');
    }
  }
  return { blocking: blocking };
}

function offerToRemoveRetiredTabs_(ui) {
  var present = RETIRED_TABS.filter(function (n) { return ss().getSheetByName(n); });
  if (!present.length) return;
  var resp = ui.alert('Remove the old generated tabs?',
    present.join(', ') + '\n\nThese were rendered views from an earlier version. The web app ' +
    'draws the schedule and engineer view now, so a copy in the sheet would be ' +
    'stale most of the time.\n\nThey hold no data of their own — everything is derived from ' +
    'Bookings. Remove them?',
    ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;
  present.forEach(function (n) {
    var sh = ss().getSheetByName(n);
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
    ss().deleteSheet(sh);
  });
}

function reorderTabs_() {
  [TAB.PROJECTS, TAB.BOOKINGS, TAB.ENGINEERS].forEach(function (name, i) {
    var sh = ss().getSheetByName(name);
    if (sh) { ss().setActiveSheet(sh); ss().moveActiveSheet(i + 1); }
  });
  ss().setActiveSheet(ss().getSheetByName(TAB.PROJECTS));
}

// Does NOT merge. A merged row 1 spanning the full width straddles the frozen
// column boundary, and Sheets refuses to freeze columns containing only part of
// a merged cell. Painting the row and putting text in A1 looks the same, because
// unwrapped text overflows across the empty cells beside it.
function banner_(sh, text, widthCols) {
  var span = sh.getRange(1, 1, 1, Math.max(1, widthCols));
  span.breakApart();
  span.setBackground(COLOR.HEADER_BG);
  sh.getRange(1, 1)
    .setValue(text)
    .setFontColor(COLOR.HEADER_FG)
    .setFontSize(11).setFontWeight('bold').setWrap(false)
    .setVerticalAlignment('middle').setHorizontalAlignment('left');
  sh.setRowHeight(1, 28);
}

function clearBandings_(sh) {
  sh.getBandings().forEach(function (b) { b.remove(); });
}

// ---- Config -----------------------------------------------------------------

function setupConfigTab_() {
  var sh = ss().getSheetByName(TAB.CONFIG);
  var existing = clientList_();
  sh.clear();
  sh.getRange(1, 1).setValue('Clients').setFontWeight('bold');
  var clients = existing.length ? existing : DEFAULT_CLIENTS;
  sh.getRange(2, 1, clients.length, 1).setValues(clients.map(function (c) { return [c]; }));
  sh.getRange(1, 3).setValue('Scheduling rules are in HANDOFF.md §6 — not editable here.')
    .setFontColor(COLOR.MUTED);
}

function clientList_() {
  var sh = ss().getSheetByName(TAB.CONFIG);
  if (!sh || sh.getLastRow() < 2) return DEFAULT_CLIENTS;
  return sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
    .map(function (r) { return String(r[0] || '').trim(); }).filter(String);
}

// ---- Engineers --------------------------------------------------------------

function setupEngineersTab_() {
  var sh = ss().getSheetByName(TAB.ENGINEERS);
  sh.getRange(E_HEADER_ROW, 1, 1, E_HEADERS.length).setValues([E_HEADERS])
    .setBackground(COLOR.HEADER_BG).setFontColor(COLOR.HEADER_FG).setFontWeight('bold');
  sh.setFrozenRows(E_HEADER_ROW);
  sh.setColumnWidth(1, 120);
  for (var c = 2; c <= E_HEADERS.length; c++) sh.setColumnWidth(c, 108);

  var rows = 200;
  applyEngineerValidation_(sh, rows);

  clearBandings_(sh);
  sh.getRange(E_HEADER_ROW, 1, rows + 1, E_HEADERS.length)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  sh.setHiddenGridlines(true);
  sh.getRange(E_HEADER_ROW, 1).setNote(
    'The roster. Adding or removing an engineer is a data edit — the rules read these flags, never names.');
  sh.getRange(E_HEADER_ROW, 6).setNote(
    'Order of preference for Music/Songs titles, not a yes/no.\n\n' +
    '1 = first choice, 2 = second, and so on. No or blank = not a music specialist.\n' +
    '"Yes" still counts as 1, so an older roster keeps working.\n\n' +
    'Music work goes ONLY to the people ranked here. If nobody is ranked, it is ' +
    'assigned like ordinary work.');
  sh.getRange(E_HEADER_ROW, 9).setNote(
    'Yes if this engineer can mix in an Atmos room. Independent of mix_level: the room ' +
    'and the grade are different things, and an Advanced mixer without the room still ' +
    'cannot take an Atmos title.\n\n' +
    'Blank reads as No, so a roster from before this column behaves as it always did.');
}

// ---- Bookings ---------------------------------------------------------------

function setupBookingsTab_() {
  var sh = ss().getSheetByName(TAB.BOOKINGS);
  sh.getRange(B_HEADER_ROW, 1, 1, B_HEADERS.length).setValues([B_HEADERS])
    .setBackground(COLOR.HEADER_BG).setFontColor(COLOR.HEADER_FG).setFontWeight('bold');
  sh.setFrozenRows(B_HEADER_ROW);
  [200, 80, 110, 100, 100, 80, 320, 100].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setHiddenGridlines(true);

  // superseded rows must read as history at a glance, never as live
  var rng = sh.getRange(B_HEADER_ROW + 1, 1, 2000, B_HEADERS.length);
  rng.clearFormat();
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$H2="superseded"')
      .setFontColor(COLOR.MUTED).setStrikethrough(true).setRanges([rng]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=REGEXMATCH($G2,"FORCED")')
      .setBackground(COLOR.FORCED_BG).setBold(true).setRanges([rng]).build(),
  ]);
  protectWarn_(sh, 'Written by the engine. Edit only to repair data — the tool validates on read ' +
    'and refuses a corrupted book.');
  sh.getRange(B_HEADER_ROW, B_COL.STATUS).setNote(
    'blank/active or superseded. Superseded rows are history: never read as live, never deleted.');
}

// ---- Projects ---------------------------------------------------------------

function setupProjectsTab_() {
  var sh = ss().getSheetByName(TAB.PROJECTS);

  // Full reset. Clears the old Commit column, its 300 checkboxes, stale
  // validation and any merge left by an earlier layout.
  var maxR = sh.getMaxRows(), maxC = sh.getMaxColumns();
  var all = sh.getRange(1, 1, maxR, maxC);
  all.breakApart();
  all.clearContent().clearFormat().clearNote().clearDataValidations();
  sh.setConditionalFormatRules([]);
  clearBandings_(sh);
  sh.setFrozenRows(0);
  sh.setFrozenColumns(0);

  banner_(sh, 'Projects — the master list. Add and correct projects in the web app; ' +
    'this tab is the data behind it.', P_LAST);

  sh.getRange(P_HEADER_ROW, 1, 1, P_HEADERS.length).setValues([P_HEADERS])
    .setBackground(COLOR.HEADER_BG).setFontColor(COLOR.HEADER_FG)
    .setFontWeight('bold').setFontSize(9).setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeight(P_HEADER_ROW, 34);
  sh.setFrozenRows(P_HEADER_ROW);
  sh.setFrozenColumns(1);

  // One entry per column, named, because this list is positional and silently
  // mis-sizes everything downstream the moment a column is inserted — which is what
  // happened when Atmos and Recordist pick 2 went in.
  var widths = [
    210,  // Project
    104,  // Client
     92,  // Deadline
     96,  // Phases D/E/M
     92,  // Mix level
     62,  // Music
     62,  // Special
     62,  // Atmos
    108,  // Recordist pick
    122,  // Recordist pick 2 — wider, the header is the longest thing in it
    108,  // Editor pick
    108,  // Mixer pick
     62,  // Dub wks
     62,  // Edit wks
     62,  // Mix wks
    150,  // Recordist   (can hold "A + B" now)
    100,  // Editor
    100,  // Mixer
    300,  // Warnings
    300,  // Notes
     92,  // Plotted
     70,  // Locked
  ];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  var firstRow = P_FIRST_DATA_ROW;

  // Native validation, so a hand-edit in the sheet cannot enter something the
  // engine would reject.
  sh.getRange(firstRow, P_COL.CLIENT, P_ROWS, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(clientList_(), true)
      .setAllowInvalid(true).build());          // a new client can be typed
  sh.getRange(firstRow, P_COL.DEADLINE, P_ROWS, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build())
    .setNumberFormat('yyyy-mm-dd');
  sh.getRange(firstRow, P_COL.LEVEL, P_ROWS, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(LEVEL_OPTIONS, true).setAllowInvalid(false).build());
  [P_COL.MUSIC, P_COL.SPECIAL, P_COL.ATMOS].forEach(function (c) {
    sh.getRange(firstRow, c, P_ROWS, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(YESNO_OPTIONS, true).setAllowInvalid(false).build());
  });
  refreshEngineerDropdowns();

  sh.getRange(firstRow, P_COL.PHASES, P_ROWS, 1).setNumberFormat('@');   // keep "3/1/2" as text

  // The engine's columns read as not-yours-to-type. Starts BELOW the header row,
  // so it does not paint over the dark header.
  sh.getRange(firstRow, P_OUTPUT_FIRST, P_ROWS, P_OUTPUT_LAST - P_OUTPUT_FIRST + 1)
    .setBackground(COLOR.OUTPUT_BG);
  sh.getRange(firstRow, P_COL.WARNINGS, P_ROWS, 2).setWrap(true).setFontSize(9);
  sh.getRange(firstRow, 1, P_ROWS, P_LAST).setVerticalAlignment('middle');
  sh.getRange(firstRow, P_COL.DUB_W, P_ROWS, 3).setHorizontalAlignment('center');
  sh.setHiddenGridlines(true);

  // divider between what a person may type and what the engine writes
  sh.getRange(P_HEADER_ROW, P_INPUT_LAST, P_ROWS + 1, 1)
    .setBorder(null, null, null, true, null, null, COLOR.HEADER_BG,
      SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  protectRange_(sh.getRange(P_HEADER_ROW, P_OUTPUT_FIRST, P_ROWS + 1, P_OUTPUT_LAST - P_OUTPUT_FIRST + 1),
    'Written by the engine. Re-plot from the web app to recompute.');

  sh.getRange(P_HEADER_ROW, P_COL.PHASES).setNote(
    'Dub/Edit/Mix in whole weeks, e.g. 3/1/2. Zero is valid and means the phase does not exist.');
  sh.getRange(P_HEADER_ROW, P_COL.REC_PICK).setNote(
    'Auto lets the engine choose. A manual pick overrides every rule, is always flagged, and locks ' +
    'the row against automatic reassignment. With Editor pick on Auto, this name covers the edit too.');
  sh.getRange(P_FIRST_DATA_ROW, P_COL.LOCKED, P_ROWS, 1).insertCheckboxes();
  sh.getRange(P_HEADER_ROW, P_COL.LOCKED).setNote(
    'Tick to freeze this project. A re-plan will not move any of its bookings, and its ' +
    'rows are never superseded. Untick to let it be re-solved again. Manual picks and ' +
    'weeks that have already started are locked anyway, without this.');
  sh.getRange(P_HEADER_ROW, P_COL.ED_PICK).setNote(
    'Leave on Auto and the recordist edits as well, which is the studio default. Naming someone here ' +
    'is what splits the dub from the edit — the engine then fills whichever of the two is still Auto.');
  sh.getRange(P_HEADER_ROW, P_COL.REC_PICK2).setNote(
    'A second recordist, to divide a long dub between two people by hand. The dub weeks are ' +
    'split into two blocks — the first name takes the earlier one — and you can drag individual ' +
    'weeks afterwards to move the join. Only the dub divides: the edit stays with one engineer ' +
    'and the mix is never split. Leave on Auto unless you are splitting.');
  sh.getRange(P_HEADER_ROW, P_COL.ATMOS).setNote(
    'Tick when the mix needs an Atmos room. Separate from Special, which is about the work ' +
    'routing to the specials engineer — a title can need Atmos, be Special, both or neither. ' +
    'Only engineers with atmos = Yes on the Engineers tab will be given the mix.');
}

// Auto / roster names, refreshed when the roster changes.
// The Engineers tab's own column rules. Separated from setupEngineersTab_ so they
// can be reapplied on their own: a rule that changes shape — music_specialist going
// from yes/no to a rank — otherwise leaves valid entries flagged red, and the only
// way to clear that was a full setup, which CLEARS THE PROJECTS TAB. Nobody should
// have to wipe their projects to fix a dropdown.
function applyEngineerValidation_(sh, rows) {
  var yesNo = SpreadsheetApp.newDataValidation().requireValueInList(YESNO_OPTIONS, true)
    .setAllowInvalid(false).build();
  // Column 6 is music_specialist and is NOT a yes/no — it carries a rank.
  // Column 9 is atmos, appended 2026-08-30; blank reads as No on an older roster.
  [2, 3, 4, 7, 8, 9].forEach(function (c) {
    sh.getRange(E_HEADER_ROW + 1, c, rows, 1).setDataValidation(yesNo);
  });
  sh.getRange(E_HEADER_ROW + 1, 6, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(MUSIC_RANK_OPTIONS, true)
      .setAllowInvalid(true).build());   // see MUSIC_RANK_OPTIONS
  sh.getRange(E_HEADER_ROW + 1, 5, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(LEVEL_OPTIONS, true)
      .setAllowInvalid(true).build());   // blank is legal for non-mixers
}

function refreshEngineerDropdowns() {
  var sh = ss().getSheetByName(TAB.PROJECTS);
  if (sh) {
    var names;
    try { names = engineerNames(); } catch (e) { names = []; }
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Auto'].concat(names), true).setAllowInvalid(false).build();
    [P_COL.REC_PICK, P_COL.REC_PICK2, P_COL.ED_PICK, P_COL.MIX_PICK].forEach(function (c) {
      sh.getRange(P_FIRST_DATA_ROW, c, P_ROWS, 1).setDataValidation(rule);
    });
  }

  // Reapply the roster's own rules too. Reads and writes no cell VALUES, so it is
  // safe on a live sheet — validation only.
  var en = ss().getSheetByName(TAB.ENGINEERS);
  if (en) applyEngineerValidation_(en, 200);

  ss().toast('Dropdowns refreshed on the Projects and Engineers tabs. No data was changed.',
    'Done', 6);
}

// ---- helpers ----------------------------------------------------------------

// Warning-only: it stops an accidental paste without locking the two users out
// of repairing their own data (HANDOFF §8 point 3). The real guard against
// corruption is assertValidBook() on every read.
function protectWarn_(sh, description) {
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  sh.protect().setDescription(description).setWarningOnly(true);
}

function protectRange_(range, description) {
  var sh = range.getSheet();
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (p.getDescription() === description) p.remove();
  });
  range.protect().setDescription(description).setWarningOnly(true);
}
