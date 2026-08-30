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

const TABS = { projects: 'Projects', bookings: 'Bookings', engineers: 'Engineers' };
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

function createSheetsSource(opts) {
  const o = opts || {};
  const sheetId = o.sheetId || process.env.PLANNER_SHEET_ID;
  if (!sheetId) throw new Error('Set PLANNER_SHEET_ID to the id in the spreadsheet URL.');
  const auth = createAuth(o.keyPath);
  const id = encodeURIComponent(sheetId);

  // Where each booking actually lives, so a supersede writes to the right cell.
  let bookingsMeta = null;

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
      let s = '';
      for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
      return s;
    };

    const supersede = change.supersede || [];
    if (supersede.length) {
      await auth.api(`spreadsheets/${id}/values:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: supersede.map(rowNumber => ({
            range: `${TABS.bookings}!${colLetter(statusCol)}${rowNumber}`,
            values: [['superseded']],
          })),
        }),
      });
    }

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
      await auth.api(`spreadsheets/${id}/values/${encodeURIComponent(TABS.bookings + '!A:A')}` +
        ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {
        method: 'POST',
        body: JSON.stringify({ values: rows }),
      });
    }

    bookingsMeta = null;   // row numbers have moved
    return { superseded: supersede.length, appended: append.length };
  }

  return { read, write, email: auth.email };
}

module.exports = { createSheetsSource, isoFrom, mapper };
