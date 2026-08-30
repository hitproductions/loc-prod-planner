// Reading and writing the sheet. Everything the engine sees passes through here,
// so dates are normalised to ISO strings in exactly one place.
//
// Every Sheets call is a round trip costing tens of milliseconds, so reads are
// memoised for the life of one execution and every write invalidates the memo.
// Apps Script starts each request in a fresh global, so this cache never
// outlives a single call — there is no cross-request staleness to worry about.

var _ioCache = {};

function ioInvalidate() { _ioCache = {}; }

function ioCached_(key, produce) {
  if (!Object.prototype.hasOwnProperty.call(_ioCache, key)) _ioCache[key] = produce();
  return _ioCache[key];
}

function isoFromCell(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  // already ISO, or a sheet that stored the date as text
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
  return s;
}

function trimmedRows_(sh, headerRow) {
  var last = sh.getLastRow();
  if (last <= headerRow) return [];
  var width = sh.getLastColumn();
  return sh.getRange(headerRow + 1, 1, last - headerRow, width).getValues();
}

// ---- Engineers --------------------------------------------------------------

function readEngineers() {
  return ioCached_('engineers', readEngineersUncached_);
}

// mix_level reaches the engine as an EXACT, case-sensitive comparison
// (`lvl === 'Advanced'`), while every capability flag goes through a
// case-insensitive yes(). So "advanced" in the sheet silently removes that person
// from every Advanced mix pool while they look perfectly free — the same class of
// defect as Fix B, and invisible because the column's validation allows invalid
// entries by design (blank is legal for non-mixers).
//
// Canonicalised here rather than in the engine, per HANDOFF §5. An unrecognised
// value is returned UNCHANGED rather than coerced, so rosterProblems() can name it
// instead of the tool quietly guessing (2026-08-13).
function canonMixLevel_(v) {
  var s = String(v == null ? '' : v).trim();
  var l = s.toLowerCase();
  if (l === 'advanced') return 'Advanced';
  if (l === 'developing') return 'Developing';
  return s;
}

// Roster entries that will behave in ways nobody asked for.
function rosterProblems(engineerRows) {
  var yes = function (v) { return String(v).trim().toLowerCase() === 'yes'; };
  var out = [];
  (engineerRows || []).forEach(function (e) {
    if (!e || !e.name) return;
    var raw = String(e.mix_level == null ? '' : e.mix_level).trim();
    var canon = canonMixLevel_(raw);
    if (raw && canon !== 'Advanced' && canon !== 'Developing') {
      out.push(e.name + ': mix_level is "' + raw + '", which is neither Advanced nor ' +
        'Developing — they are excluded from every Advanced mix.');
    }
    if (yes(e.can_mix) && !raw) {
      out.push(e.name + ': can_mix is Yes but mix_level is blank — they can never take an ' +
        'Advanced mix, so that work goes to someone else.');
    }
    if (!yes(e.can_mix) && raw) {
      out.push(e.name + ': has mix_level "' + raw + '" but can_mix is not Yes — the level is ignored.');
    }

    // music_specialist is a rank and its cell allows anything, so this is the only
    // thing standing between a typo and music quietly routing like ordinary work.
    var ms = String(e.music_specialist == null ? '' : e.music_specialist).trim();
    var msLower = ms.toLowerCase();
    var rank = parseInt(ms, 10);
    var ranked = msLower === 'yes' || (isFinite(rank) && rank > 0 && String(rank) === ms);
    if (ms && msLower !== 'no' && !ranked) {
      out.push(e.name + ': music_specialist is "' + ms + '", which is not a rank — ' +
        'use 1 for first choice, 2 for second, or No. They are being treated as NOT a ' +
        'music specialist, so music work can go to someone else.');
    }
  });

  // Zero ranked specialists is legal but almost never intended, and it fails silently.
  var ranks = (engineerRows || []).filter(function (e) {
    if (!e || !e.name) return false;
    var v = String(e.music_specialist == null ? '' : e.music_specialist).trim();
    return v.toLowerCase() === 'yes' || parseInt(v, 10) > 0;
  });
  if (!ranks.length) {
    out.push('Nobody has a music_specialist rank — projects flagged Music/Songs will be ' +
      'assigned like ordinary work, to anyone.');
  }
  return out;
}

function readEngineersUncached_() {
  var sh = sheetOrThrow(TAB.ENGINEERS);
  var out = [];
  trimmedRows_(sh, E_HEADER_ROW).forEach(function (r) {
    if (!String(r[0] || '').trim()) return;
    out.push({
      name: String(r[0]).trim(),
      can_record: r[1], can_edit: r[2], can_mix: r[3],
      mix_level: canonMixLevel_(r[4]),
      music_specialist: r[5], overflow_only: r[6], specials_only: r[7],
    });
  });
  if (!out.length) throw new Error('The Engineers tab is empty — add the roster before scheduling.');
  return out;
}

function engineerNames() {
  return readEngineers().map(function (e) { return e.name; });
}

// ---- Bookings ---------------------------------------------------------------

// row_number is the real sheet row, which is what the supersede path needs.
function readBookings() {
  return ioCached_('bookings', readBookingsUncached_);
}

function readBookingsUncached_() {
  var sh = sheetOrThrow(TAB.BOOKINGS);
  var out = [];
  trimmedRows_(sh, B_HEADER_ROW).forEach(function (r, i) {
    if (!String(r[0] || '').trim()) return;
    out.push({
      project: String(r[0]).trim(),
      phase: String(r[1] || '').trim(),
      engineer: String(r[2] || '').trim(),
      start_date: isoFromCell(r[3]),
      end_date: isoFromCell(r[4]),
      source: String(r[5] || '').trim(),
      note: String(r[6] || '').trim(),
      status: String(r[7] || '').trim(),
      row_number: B_HEADER_ROW + 1 + i,
    });
  });
  return out;
}

function appendBookings(rows) {
  ioInvalidate();
  if (!rows || !rows.length) return 0;
  var sh = sheetOrThrow(TAB.BOOKINGS);
  var values = rows.map(function (b) {
    return [b.project, b.phase, b.engineer, b.start_date, b.end_date,
            b.source || 'plot', b.note || '', b.status || ''];
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, B_HEADERS.length).setValues(values);
  return values.length;
}

// Never deletes. Marks status = superseded (HANDOFF rule 15, criterion 9).
//
// One column read plus ONE write, whatever the row count. The obvious version —
// setValue per row — cost 55 round trips on a re-plot of the seeded book, which
// is most of a second of latency for no reason.
function supersedeBookingRowNumbers(rowNumbers) {
  if (!rowNumbers || !rowNumbers.length) return 0;
  var sh = sheetOrThrow(TAB.BOOKINGS);
  var last = sh.getLastRow();
  if (last <= B_HEADER_ROW) return 0;
  var first = B_HEADER_ROW + 1;
  var height = last - B_HEADER_ROW;
  var col = sh.getRange(first, B_COL.STATUS, height, 1);
  var cur = col.getValues();
  var n = 0;
  rowNumbers.forEach(function (r) {
    var i = r - first;
    if (i < 0 || i >= height) return;
    if (String(cur[i][0]).toLowerCase() === 'superseded') return;
    cur[i][0] = 'superseded';
    n++;
  });
  if (n) { col.setValues(cur); ioInvalidate('bookings'); }
  return n;
}

// Repoint bookings from one project title to another. The title IS the join key
// (there is no ID), so renaming a project in the sheet orphans its whole schedule;
// this is the undo. Only LIVE rows move: superseded rows are history and belong to
// the name they were booked under.
//
// Batched like supersedeBookingRowNumbers — one getValues, one setValues over the
// project column — because io_roundtrips.test.js counts Sheets calls and a per-row
// write would scale with the book.
function relinkProjectBookings(fromTitle, toTitle) {
  var from = String(fromTitle || '').trim();
  var to = String(toTitle || '').trim();
  if (!from || !to || from === to) return 0;

  var sh = sheetOrThrow(TAB.BOOKINGS);
  var last = sh.getLastRow();
  if (last <= B_HEADER_ROW) return 0;
  var first = B_HEADER_ROW + 1;
  var height = last - B_HEADER_ROW;

  var live = {};
  readBookings().forEach(function (b) {
    if (b.project === from && String(b.status).toLowerCase() !== 'superseded') {
      live[b.row_number] = true;
    }
  });

  var col = sh.getRange(first, B_COL.PROJECT, height, 1);
  var cur = col.getValues();
  var n = 0;
  for (var i = 0; i < height; i++) {
    if (!live[first + i]) continue;
    cur[i][0] = to;
    n++;
  }
  if (n) { col.setValues(cur); ioInvalidate('bookings'); }
  return n;
}

function supersedeProjectBookings(projectTitles) {
  var wanted = {};
  projectTitles.forEach(function (t) { wanted[t] = true; });
  var rows = readBookings().filter(function (b) {
    return wanted[b.project] && String(b.status).toLowerCase() !== 'superseded';
  });
  return supersedeBookingRowNumbers(rows.map(function (b) { return b.row_number; }));
}

// ---- Projects ---------------------------------------------------------------

// Raw entry values plus the sheet row, ready for the wrapper to normalise.
function readProjectRows() {
  return ioCached_('projects', readProjectRowsUncached_);
}

function readProjectRowsUncached_() {
  var sh = sheetOrThrow(TAB.PROJECTS);
  var out = [];
  trimmedRows_(sh, P_HEADER_ROW).forEach(function (r, i) {
    var title = String(r[P_COL.TITLE - 1] || '').trim();
    if (!title) return;
    out.push({
      project_title: title,
      client: String(r[P_COL.CLIENT - 1] || '').trim(),
      deadline: isoFromCell(r[P_COL.DEADLINE - 1]),
      phases: String(r[P_COL.PHASES - 1] || '').trim(),
      mix_level_required: String(r[P_COL.LEVEL - 1] || '').trim(),
      music_songs: String(r[P_COL.MUSIC - 1] || '').trim(),
      special_project: String(r[P_COL.SPECIAL - 1] || '').trim(),
      recordist_override: String(r[P_COL.REC_PICK - 1] || '').trim(),
      editor_override: String(r[P_COL.ED_PICK - 1] || '').trim(),
      mixer_override: String(r[P_COL.MIX_PICK - 1] || '').trim(),
      dub_weeks: r[P_COL.DUB_W - 1],
      edit_weeks: r[P_COL.EDIT_W - 1],
      mix_weeks: r[P_COL.MIX_W - 1],
      plotted: String(r[P_COL.PLOTTED - 1] || '').trim(),
      locked: /^(yes|true)$/i.test(String(r[P_COL.LOCKED - 1] || '').trim()),
      notes: String(r[P_COL.NOTES - 1] || '').trim(),
      _row: P_HEADER_ROW + 1 + i,
    });
  });
  return out;
}

// Projects plotted at least once.
function readCommittedProjects() {
  return readProjectRows().filter(function (p) { return p.plotted; });
}

function writeProjectOutputs(row, o) {
  ioInvalidate();
  var sh = sheetOrThrow(TAB.PROJECTS);
  sh.getRange(row, P_OUTPUT_FIRST, 1, P_OUTPUT_LAST - P_OUTPUT_FIRST + 1).setValues([[
    o.dub_weeks, o.edit_weeks, o.mix_weeks,
    o.recordist, o.editor, o.mixer, o.warnings, o.notes, o.plotted,
  ]]);
  // A row with warnings must not read as clean (HANDOFF §7).
  var bg = o.forced ? COLOR.FORCED_BG : (o.warnings ? COLOR.WARN_BG : COLOR.OUTPUT_BG);
  sh.getRange(row, P_OUTPUT_FIRST, 1, P_OUTPUT_LAST - P_OUTPUT_FIRST + 1).setBackground(bg);
  sh.getRange(row, P_COL.WARNINGS).setFontColor(o.forced ? COLOR.URGENT : '#000000')
    .setFontWeight(o.warnings ? 'bold' : 'normal');
}

// Errors live in the row, never a popup (HANDOFF §7).
function writeProjectError(row, message) {
  ioInvalidate();
  var sh = sheetOrThrow(TAB.PROJECTS);
  sh.getRange(row, P_COL.NOTES).setValue(message)
    .setFontColor(COLOR.URGENT).setFontWeight('bold');
  sh.getRange(row, P_OUTPUT_FIRST, 1, P_OUTPUT_LAST - P_OUTPUT_FIRST + 1).setBackground(COLOR.WARN_BG);
}

function clearProjectOutputs(row) {
  ioInvalidate();
  var sh = sheetOrThrow(TAB.PROJECTS);
  var rng = sh.getRange(row, P_OUTPUT_FIRST, 1, P_OUTPUT_LAST - P_OUTPUT_FIRST + 1);
  rng.clearContent().setBackground(COLOR.OUTPUT_BG);
  sh.getRange(row, P_COL.NOTES).setFontColor('#000000').setFontWeight('normal');
}
