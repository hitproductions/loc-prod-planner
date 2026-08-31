// The real spreadsheet as a data source.
//
// Columns are mapped BY HEADER NAME, never by position. The Apps Script app addresses
// them through P_COL constants and that is fine there, because it owns the layout —
// here we are a guest in someone else's sheet, and a column inserted by hand would
// silently re-point every field after it. Header mapping also means this works on a
// sheet that predates the Atmos and Recordist-pick-2 columns.
//
// Dates come back as SERIAL NUMBERS and are converted here, so the sheet's display
// format cannot change what the engine sees. Reading them as formatted strings made
// the Apps Script version's date handling depend on a cell's number format.
const { createAuth } = require('./google-auth.js');

// The three tabs the book is read from. The log tab is deliberately NOT in here: it
// is created on first write, so requiring it made read() ask Google for a range that
// does not exist yet and the whole read failed with "Unable to parse range".
const TABS = { projects: 'Projects', bookings: 'Bookings', engineers: 'Engineers' };
const EVENTS_TAB = 'History';
const EVENT_HEADERS = ['at', 'action', 'summary', 'superseded', 'appended'];
// Columns this app writes that an older sheet may not have. Created on demand.
const MANAGED_COLUMNS = ['Status', 'Completed'];
// Row 1 of Projects is a banner, not headers. The other two start at row 1.
const HEADER_ROW = { Projects: 2, Bookings: 1, Engineers: 1 };

const EPOCH = Date.UTC(1899, 11, 30);
function isoFrom(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') return new Date(EPOCH + v * 86400000).toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

const norm = h => String(h == null ? '' : h).trim().toLowerCase();
const colName = n => {
  let out = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out;
  return out;
};

// Returns a getter: pick(row, 'Deadline') — and null for a header that is not there,
// so a caller can decide whether absence is fatal or just an older sheet.
function mapper(headers) {
  const at = {};
  headers.forEach((h, i) => { if (norm(h)) at[norm(h)] = i; });
  const get = (row, name) => {
    const i = at[norm(name)];
    return i === undefined ? undefined : row[i];
  };
  get.has = name => at[norm(name)] !== undefined;
  // Tolerates either name, for a sheet migrated at a different time from the code.
  get.either = (row, ...names) => {
    for (const n of names) if (get.has(n)) return get(row, n);
    return undefined;
  };
  get.eitherHas = (...names) => names.some(n => get.has(n));
  return get;
}

// Which Projects columns a change writes, by header name.
//
// Pulled out of the writer so it can be tested: the two rules here are the ones that
// can quietly corrupt a row. A LOCK writes exactly one cell -- writing the usual map
// would rewrite every column from a book that may be a TTL old. An ordinary save
// writes everything EXCEPT Locked, because that is a human decision this code has no
// business round-tripping, and a save based on a stale read would overwrite a lock
// somebody set in the spreadsheet meanwhile.
function projectCells(change) {
  const p = change.project;
  const o = change.outputs || {};
  if (change.lock) return { 'locked': p.locked };
  return {
    'project': p.project_title, 'client': p.client, 'deadline': p.deadline,
    'phases d/e/m': `${p.dub_weeks}/${p.edit_weeks}/${p.mix_weeks}`,
    'mix level': p.mix_level_required,
    'music': p.music_songs, 'special': p.special_project, 'atmos': p.atmos_required,
    'recordist pick': p.recordist_override, 'recordist pick 2': p.recordist_override_2,
    'editor pick': p.editor_override, 'mixer pick': p.mixer_override,
    'dub wks': p.dub_weeks, 'edit wks': p.edit_weeks, 'mix wks': p.mix_weeks,
    'recordist': o.recordist, 'editor': o.editor, 'mixer': o.mixer,
    'warnings': o.warnings, 'notes': o.notes,
    'status': p.status, 'completed': p.completed,
    'plotted': new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString().slice(0, 10),
  };
}

function createSheetsSource(opts) {
  const o = opts || {};
  const sheetId = o.sheetId || process.env.PLANNER_SHEET_ID;
  if (!sheetId) throw new Error('Set PLANNER_SHEET_ID to the id in the spreadsheet URL.');
  const auth = createAuth(o.keyPath);
  const id = encodeURIComponent(sheetId);

  // Where each booking actually lives, so a supersede writes to the right cell.
  let bookingsMeta = null;
  let projectsMeta = null;

  async function read() {
    const ranges = Object.values(TABS).map(t => `ranges=${encodeURIComponent(t + '!A:Z')}`).join('&');
    const res = await auth.api(`spreadsheets/${id}/values:batchGet?${ranges}` +
      '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');

    const byTab = {};
    (res.valueRanges || []).forEach(vr => {
      const tab = String(vr.range || '').split('!')[0].replace(/^'|'$/g, '');
      byTab[tab] = vr.values || [];
    });

    for (const t of Object.values(TABS)) {
      if (!byTab[t]) throw new Error(`The spreadsheet has no "${t}" tab.`);
    }

    // ---- Engineers
    const eRows = byTab[TABS.engineers];
    const e = mapper(eRows[HEADER_ROW.Engineers - 1] || []);
    if (!e.has('name')) throw new Error('The Engineers tab has no "name" column.');
    const engineers = eRows.slice(HEADER_ROW.Engineers)
      .filter(r => String(r[0] || '').trim())
      .map(r => ({
        name: String(e(r, 'name')).trim(),
        can_record: e(r, 'can_record'), can_edit: e(r, 'can_edit'), can_mix: e(r, 'can_mix'),
        mix_level: e(r, 'mix_level'),
        music_specialist: e(r, 'music_specialist'),
        overflow_only: e(r, 'overflow_only'),
        // renamed 2026-08-30; a sheet set up before that still says specials_only
        does_specials: e.either(r, 'does_specials', 'specials_only'),
        atmos: e(r, 'atmos'),          // undefined on a sheet without the column = No
      }));
    if (!engineers.length) throw new Error('The Engineers tab is empty.');

    // ---- Projects
    const pRows = byTab[TABS.projects];
    const p = mapper(pRows[HEADER_ROW.Projects - 1] || []);
    if (!p.has('Project')) {
      throw new Error('The Projects tab has no "Project" column in row 2. Row 1 is the ' +
        'banner; the headers belong on row 2.');
    }
    const projects = pRows.slice(HEADER_ROW.Projects)
      .filter(r => String(r[0] || '').trim())
      .map((r, i) => {
        const phases = String(p(r, 'Phases D/E/M') || '').split('/');
        return {
          project_title: String(p(r, 'Project')).trim(),
          client: String(p(r, 'Client') || '').trim(),
          deadline: isoFrom(p(r, 'Deadline')),
          dub_weeks: Number(phases[0] || p(r, 'Dub wks') || 0),
          edit_weeks: Number(phases[1] || p(r, 'Edit wks') || 0),
          mix_weeks: Number(phases[2] || p(r, 'Mix wks') || 0),
          mix_level_required: String(p(r, 'Mix level') || 'Advanced').trim(),
          music_songs: p(r, 'Music'),
          special_project: p(r, 'Special'),
          atmos_required: p(r, 'Atmos'),
          recordist_override: p(r, 'Recordist pick') || 'Auto',
          recordist_override_2: p(r, 'Recordist pick 2') || 'Auto',
          editor_override: p(r, 'Editor pick') || 'Auto',
          mixer_override: p(r, 'Mixer pick') || 'Auto',
          notes: String(p(r, 'Notes') || '').trim(),
          // Complete is a LABEL, not a supersede. The bookings stay live, because the
          // work genuinely happened and still occupies those weeks — what changes is
          // that the project stops asking for attention and stops being re-planned.
          status: String(p(r, 'Status') || '').trim(),
          completed: isoFrom(p(r, 'Completed')),
          locked: /^(yes|true)$/i.test(String(p(r, 'Locked') || '').trim()) || p(r, 'Locked') === true,
          _row: HEADER_ROW.Projects + 1 + i,
        };
      });

    // ---- Bookings
    const bRows = byTab[TABS.bookings];
    const bHead = bRows[HEADER_ROW.Bookings - 1] || [];
    const b = mapper(bHead);
    ['project', 'phase', 'engineer', 'start_date', 'end_date', 'status'].forEach(c => {
      if (!b.has(c)) throw new Error(`The Bookings tab has no "${c}" column.`);
    });
    const statusCol = bHead.findIndex(h => norm(h) === 'status');
    const bookings = bRows.slice(HEADER_ROW.Bookings)
      .map((r, i) => ({
        project: String(b(r, 'project') || '').trim(),
        phase: String(b(r, 'phase') || '').trim(),
        engineer: String(b(r, 'engineer') || '').trim(),
        start_date: isoFrom(b(r, 'start_date')),
        end_date: isoFrom(b(r, 'end_date')),
        source: String(b(r, 'source') || '').trim(),
        note: String(b(r, 'note') || '').trim(),
        status: String(b(r, 'status') || '').trim(),
        row_number: HEADER_ROW.Bookings + 1 + i,
      }))
      .filter(x => x.project && x.start_date && x.end_date);

    bookingsMeta = { header: bHead, statusCol, width: Math.max(bHead.length, 8) };
    projectsMeta = {
      header: pRows[HEADER_ROW.Projects - 1] || [],
      rowOf: projects.reduce((m, p) => { m[p.project_title] = p._row; return m; }, {}),
      nextRow: HEADER_ROW.Projects + 1 + projects.length,
    };
    return { engineers, projects, bookings };
  }

  // Nothing is ever deleted. A row that stops being true has its status set to
  // "superseded" and stays in the tab as history — the property that has made every
  // mistake in the Apps Script version recoverable.
  async function write(change) {
    if (!bookingsMeta) await read();
    const { statusCol, header, width } = bookingsMeta;
    if (statusCol < 0) throw new Error('The Bookings tab has no "status" column to mark.');
    const colLetter = n => {
      let out = '';
      for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out;
      return out;
    };
    // Retiring and reviving are the same write with a different value, so they go in
    // one batch — a rollback that retired its new rows but failed to revive the old
    // ones would leave the schedule with a hole in it.
    const supersede = change.supersede || [];
    const revive = change.revive || [];
    if (supersede.length || revive.length) {
      await auth.api(`spreadsheets/${id}/values:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: supersede.map(rowNumber => ({
            range: `${TABS.bookings}!${colLetter(statusCol)}${rowNumber}`,
            values: [['superseded']],
          })).concat(revive.map(rowNumber => ({
            range: `${TABS.bookings}!${colLetter(statusCol)}${rowNumber}`,
            values: [['']],
          }))),
        }),
      });
    }

    const appendedRows = [];
    let skipped = [];
    const append = change.append || [];
    if (append.length) {
      // Built against the header, so a tab with columns in a different order still
      // gets each value in the right place.
      const order = header.map(norm);
      const rows = append.map(r => {
        const src = { project: r.project, phase: r.phase, engineer: r.engineer,
                      start_date: r.start_date, end_date: r.end_date,
                      source: r.source || 'plot', note: r.note || '', status: '' };
        const out = new Array(width).fill('');
        order.forEach((h, i) => { if (h in src) out[i] = src[h]; });
        return out;
      });
      const res = await auth.api(`spreadsheets/${id}/values/${encodeURIComponent(TABS.bookings + '!A:A')}` +
        ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {
        method: 'POST',
        body: JSON.stringify({ values: rows }),
      });
      // Google reports where it put them; the log needs those row numbers to be able
      // to undo the write later.
      const m = /![A-Z]+(\d+):/.exec((res.updates && res.updates.updatedRange) || '');
      if (m) {
        const first = Number(m[1]);
        for (let i = 0; i < rows.length; i++) appendedRows.push(first + i);
      }
    }

    // The Projects row, not just the bookings. A project whose bookings exist but whose
    // row does not is an orphan: it renders on the schedule and cannot be selected to
    // cancel, because the schedule is built from bookings and the list from Projects.
    if (change.project) {
      const added = await ensureProjectColumns();
      if (added.length) console.log('Added missing Projects column(s): ' + added.join(', '));
      const p = change.project;
      const o = change.outputs || {};
      const was = String(change.original_title || '').trim() || p.project_title;
      const rowNumber = projectsMeta.rowOf[was] || projectsMeta.nextRow;
      const cell = projectCells(change);
      // ONE RANGE PER COLUMN, not one write of the whole row. Writing the row would
      // blank every column we have no value for — Locked above all, which is a user
      // decision this code knows nothing about. It also leaves a sheet without the
      // Atmos column untouched instead of writing past its last header.
      const data = [];
      const have = projectsMeta.header.map(norm);
      projectsMeta.header.forEach((h, i) => {
        const v = cell[norm(h)];
        if (v === undefined) return;
        data.push({ range: `${TABS.projects}!${colLetter(i)}${rowNumber}`, values: [[v]] });
      });
      // Loud, not silent. A value with nowhere to go means the sheet is missing a
      // column, and the caller should hear about it rather than discover it later.
      skipped = Object.keys(cell).filter(k => cell[k] !== undefined && !have.includes(k));
      if (data.length) {
        await auth.api(`spreadsheets/${id}/values:batchUpdate`, {
          method: 'POST',
          body: JSON.stringify({ valueInputOption: 'RAW', data }),
        });
      }
    }

    bookingsMeta = null;   // row numbers have moved
    projectsMeta = null;
    return { superseded: supersede.length, appended: append.length,
             appended_rows: appendedRows, skipped_columns: skipped,
             project: change.project ? change.project.project_title : null };
  }

  // Columns this app writes that a sheet may not have yet. Set up sheets creates them,
  // but a book built before they existed will not, and the write maps by header name —
  // so a missing column is silently skipped and the value never lands. That is the
  // worst kind of failure: the screen says saved and the next read says otherwise.
  // Appending to the header row moves nothing.
  const MANAGED = MANAGED_COLUMNS;
  async function ensureProjectColumns() {
    if (!projectsMeta) await read();
    const have = projectsMeta.header.map(norm);
    const missing = MANAGED.filter(h => !have.includes(norm(h)));
    if (!missing.length) return [];
    const at = projectsMeta.header.length;
    await auth.api(`spreadsheets/${id}/values/` +
      encodeURIComponent(`${TABS.projects}!${colName(at)}${HEADER_ROW.Projects}`) +
      '?valueInputOption=RAW', {
      method: 'PUT', body: JSON.stringify({ values: [missing] }),
    });
    await formatProjectColumns(at, missing);
    // The header changed, so the cached map of it is wrong. Re-read straight away
    // rather than just invalidating: the caller writes on the very next line, and
    // clearing the map without refilling it left it reading rowOf off null.
    projectsMeta = null;
    bookingsMeta = null;
    await read();
    return missing;
  }

  // A column written as bare text sits outside everything the setup formatted — no
  // header band, no banding, no width — and reads as bolted on, because it is. These
  // match what setupProjectsTab does, so a created column is indistinguishable from
  // one that was always there.
  const BANNER_ROW = 1, DATA_ROW = HEADER_ROW.Projects;   // header row 2, data from 3
  const HEADER_BG = { red: 0x1F / 255, green: 0x2A / 255, blue: 0x37 / 255 };
  const WHITE = { red: 1, green: 1, blue: 1 };
  const OUTPUT_BG = { red: 0xF7 / 255, green: 0xF7 / 255, blue: 0xF5 / 255 };
  const P_ROWS = 300;

  async function formatProjectColumns(startIndex, names) {
    const count = names.length;
    const meta = await auth.api(`spreadsheets/${id}?fields=sheets.properties`);
    const sheet = (meta.sheets || []).find(x => x.properties.title === TABS.projects);
    if (!sheet) return;
    const sheetId = sheet.properties.sheetId;
    const span = { sheetId, startColumnIndex: startIndex, endColumnIndex: startIndex + count };

    await auth.api(`spreadsheets/${id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [
        // the banner strip, so row 1 does not stop short of the new columns
        { repeatCell: {
          range: { ...span, startRowIndex: 0, endRowIndex: BANNER_ROW },
          cell: { userEnteredFormat: { backgroundColor: HEADER_BG } },
          fields: 'userEnteredFormat.backgroundColor' } },
        // the dark header band
        { repeatCell: {
          range: { ...span, startRowIndex: DATA_ROW - 1, endRowIndex: DATA_ROW },
          cell: { userEnteredFormat: {
            backgroundColor: HEADER_BG,
            textFormat: { foregroundColor: WHITE, bold: true, fontSize: 9 },
            wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' } },
          fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment)' } },
        // Set by the app, not typed — so they read like the engine's own columns.
        { repeatCell: {
          range: { ...span, startRowIndex: DATA_ROW, endRowIndex: DATA_ROW + P_ROWS },
          cell: { userEnteredFormat: {
            backgroundColor: OUTPUT_BG, verticalAlignment: 'MIDDLE' } },
          fields: 'userEnteredFormat(backgroundColor,verticalAlignment)' } },
        { updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS',
                   startIndex, endIndex: startIndex + count },
          properties: { pixelSize: 96 }, fields: 'pixelSize' } },
      ].concat(
        // Every other choice column on this tab has a dropdown; a free-text Status
        // would accept "complete", "done", "COMPLETE" and mean none of them to the
        // code, which matches on the exact word.
        names.indexOf('Status') === -1 ? [] : [{ setDataValidation: {
          range: { sheetId, startColumnIndex: startIndex + names.indexOf('Status'),
                   endColumnIndex: startIndex + names.indexOf('Status') + 1,
                   startRowIndex: DATA_ROW, endRowIndex: DATA_ROW + P_ROWS },
          rule: { condition: { type: 'ONE_OF_LIST',
                    values: [{ userEnteredValue: 'Complete' },
                             { userEnteredValue: 'Cancelled' }] },
                  showCustomUi: true, strict: false } } }],
      ).concat(
        // Dates as dates, so sorting and the report do not depend on how they look.
        names.indexOf('Completed') === -1 ? [] : [{ repeatCell: {
          range: { sheetId, startColumnIndex: startIndex + names.indexOf('Completed'),
                   endColumnIndex: startIndex + names.indexOf('Completed') + 1,
                   startRowIndex: DATA_ROW, endRowIndex: DATA_ROW + P_ROWS },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
                                       horizontalAlignment: 'CENTER' } },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } }],
      ) }),
    });
  }

  // The log lives in its own tab, created the first time something is written. Not
  // part of setup: a sheet that predates this must keep working, and an empty log is
  // the correct state for one.
  let eventsTabReady = false;
  async function ensureEventsTab() {
    if (eventsTabReady) return;
    const meta = await auth.api(`spreadsheets/${id}?fields=sheets.properties.title`);
    const has = (meta.sheets || []).some(x => x.properties.title === EVENTS_TAB);
    if (!has) {
      await auth.api(`spreadsheets/${id}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: EVENTS_TAB } } }] }),
      });
      await auth.api(`spreadsheets/${id}/values/` +
        encodeURIComponent(`${EVENTS_TAB}!A1`) + '?valueInputOption=RAW', {
        method: 'PUT', body: JSON.stringify({ values: [EVENT_HEADERS] }),
      });
    }
    eventsTabReady = true;
  }

  async function readEvents() {
    const meta = await auth.api(`spreadsheets/${id}?fields=sheets.properties.title`);
    if (!(meta.sheets || []).some(x => x.properties.title === EVENTS_TAB)) return [];
    const res = await auth.api(`spreadsheets/${id}/values/` +
      encodeURIComponent(`${EVENTS_TAB}!A:E`));
    const vals = res.values || [];
    const head = (vals[0] || []).map(norm);
    return vals.slice(1).filter(r => r.length).map((r, i) => {
      const o = { id: i + 1 };
      EVENT_HEADERS.forEach(h => { o[h] = String(r[head.indexOf(h)] || ''); });
      return o;
    });
  }

  async function appendEvent(e) {
    await ensureEventsTab();
    await auth.api(`spreadsheets/${id}/values/` + encodeURIComponent(`${EVENTS_TAB}!A:A`) +
      ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {
      method: 'POST',
      body: JSON.stringify({ values: [EVENT_HEADERS.map(h => e[h] == null ? '' : String(e[h]))] }),
    });
    return e;
  }

  return { read, write, readEvents, appendEvent, email: auth.email };
}

module.exports = { createSheetsSource, isoFrom, mapper, projectCells,
                   TABS, EVENTS_TAB, MANAGED_COLUMNS };
