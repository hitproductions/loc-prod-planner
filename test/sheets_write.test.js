// The Sheets WRITE path, against a real spreadsheet.
//
// This is the gap that kept biting. `sheets_live.test.js` reads the production book and
// is deliberately read-only; everything else runs on a fixture with no tabs, headers or
// cell formats. So nothing exercised the code that can actually damage data:
// ensureProjectColumns, the one-range-per-column write, the `fields` restriction,
// appendEvent, and the rollback that puts a project row back.
//
// Every bug found by hand today lived in here:
//   * a column missing from the sheet, so the value vanished and the screen said saved
//   * writing the whole row, which would have blanked Locked
//   * the log tab widened without its header, so the new column read back blank
//   * rollback restoring rows but not the project row
//
// It needs its OWN spreadsheet and refuses to run against the production one.
//
//   PLANNER_TEST_SHEET_ID=<id> GOOGLE_APPLICATION_CREDENTIALS=<key> \
//   node test/sheets_write.test.js
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};
const section = t => console.log('\n' + t);

const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const TEST_ID = process.env.PLANNER_TEST_SHEET_ID;
const LIVE_ID = '1_9A1gzFlr8xOkmmzRdH75JBS5KmkqEoS0lLO3GWOGiQ';

if (!KEY || !TEST_ID || !fs.existsSync(KEY.replace(/^~/, process.env.HOME))) {
  console.log('Sheets WRITE check — SKIPPED');
  console.log('  Needs GOOGLE_APPLICATION_CREDENTIALS and PLANNER_TEST_SHEET_ID.');
  console.log('  It WRITES, so it needs a throwaway sheet of its own.\n');
  console.log('0 passed, 0 failed (skipped)');
  process.exit(0);
}
// The one guard that matters. Everything below writes and clears.
if (TEST_ID === LIVE_ID) {
  console.error('REFUSING: PLANNER_TEST_SHEET_ID is the production book.');
  process.exit(1);
}

(async () => {
  // Point the source at the TEST sheet for the whole run.
  process.env.PLANNER_SHEET_ID = TEST_ID;
  const sheets = require('../webapp/sources/sheets.js');
  const actions = require('../webapp/actions.js');
  const api = require('../webapp/api.js');
  const { createAuth } = require('../webapp/sources/google-auth.js');
  const auth = createAuth();
  const enc = encodeURIComponent(TEST_ID);

  const reseed = () => execFileSync(process.execPath,
    [path.join(__dirname, '..', 'tools', 'seed_test_sheet.js')],
    { env: { ...process.env, PLANNER_TEST_SHEET_ID: TEST_ID }, stdio: 'pipe' });

  const raw = async range => {
    const r = await auth.api(`spreadsheets/${enc}/values/` + encodeURIComponent(range));
    return r.values || [];
  };
  const src = () => sheets.createSheetsSource({ sheetId: TEST_ID });

  reseed();

  // ---------------------------------------------------------------- save
  section('Saving a project writes the row AND its bookings');
  {
    let book = await src().read();
    const before = book.bookings.length;
    const r = actions.saveProject(book, { title: 'Test Delta', client: 'Netflix',
      deadline: '2026-12-11', dub: 2, edit: 1, mix: 1, mix_level: 'Advanced' });
    ok('the save is accepted', r.ok === true, JSON.stringify(r).slice(0, 120));

    const res = await src().write(r.change);
    ok('nothing was reported as skipped', (res.skipped_columns || []).length === 0,
       JSON.stringify(res.skipped_columns));

    book = await src().read();
    const rows = book.bookings.filter(b => b.project === 'Test Delta');
    ok('its bookings are on the Bookings tab', rows.length > 0, rows.length + '');
    ok('the book grew by exactly those rows', book.bookings.length === before + rows.length);
    // The orphan bug: bookings written, project row never was.
    ok('AND the project has a row on the Projects tab',
       book.projects.some(p => p.project_title === 'Test Delta'));

    const p = book.projects.find(x => x.project_title === 'Test Delta');
    ok('its phase lengths round-tripped',
       `${p.dub_weeks}/${p.edit_weeks}/${p.mix_weeks}` === '2/1/1',
       `${p.dub_weeks}/${p.edit_weeks}/${p.mix_weeks}`);
    ok('and its deadline came back as an ISO date, not a serial',
       p.deadline === '2026-12-11', String(p.deadline));
    ok('the engine can place every booking it wrote',
       rows.every(b => api.engine.widx(b.start_date) <= api.engine.widx(b.end_date)));
  }

  // ---------------------------------------------------------------- lock
  section('A lock writes ONE cell and leaves the rest of the row alone');
  {
    let book = await src().read();
    const title = 'Test Alpha';
    const row = book.projects.find(p => p.project_title === title)._row;
    const wholeBefore = (await raw(`Projects!A${row}:AZ${row}`))[0];

    const r = actions.setLock(book, { title, locked: true });
    await src().write(r.change);

    const wholeAfter = (await raw(`Projects!A${row}:AZ${row}`))[0];
    book = await src().read();
    ok('it reads back as locked from the sheet',
       book.projects.find(p => p.project_title === title).locked === true);

    // Every other cell in the row must be byte-identical.
    const heads = (await raw('Projects!A2:AZ2'))[0].map(h => String(h).toLowerCase());
    const lockCol = heads.indexOf('locked');
    const changed = [];
    for (let i = 0; i < Math.max(wholeBefore.length, wholeAfter.length); i++) {
      if (i === lockCol) continue;
      if (String(wholeBefore[i] || '') !== String(wholeAfter[i] || '')) {
        changed.push(heads[i] || `col${i}`);
      }
    }
    ok('and NO other cell in the row moved', changed.length === 0,
       'also changed: ' + changed.join(', '));

    // A stale book must not push old values back over the row.
    const stale = { ...book.projects.find(p => p.project_title === title),
                    client: 'STALE', locked: false };
    await src().write({ supersede: [], append: [], fields: ['locked'],
                        project: stale, original_title: title });
    book = await src().read();
    const after = book.projects.find(p => p.project_title === title);
    ok('a fields-restricted write ignores everything outside it',
       after.client !== 'STALE', String(after.client));
    ok('while still applying the field it named', after.locked === false);
  }

  // ---------------------------------------------------------------- cancel
  section('Cancelling supersedes its bookings on the real tab');
  {
    let book = await src().read();
    const title = 'Test Delta';
    const mine = actions.live(book).filter(b => b.project === title).length;
    ok('it has live bookings to free', mine > 0, mine + '');

    const r = actions.setStatus(book, { title, status: 'Cancelled' });
    await src().write(r.change);
    book = await src().read();
    ok('none of its bookings are live any more',
       actions.live(book).filter(b => b.project === title).length === 0);
    ok('but the rows are still THERE, marked superseded — not deleted',
       book.bookings.filter(b => b.project === title).length === mine,
       book.bookings.filter(b => b.project === title).length + ' of ' + mine);
    ok('and the project row says Cancelled',
       book.projects.find(p => p.project_title === title).status === 'Cancelled');
  }

  // ---------------------------------------------------------------- missing column
  section('A column the app writes but the sheet lacks is created, not skipped');
  {
    // Delete Status and Completed the way a hand-edited sheet loses them.
    const heads = (await raw('Projects!A2:AZ2'))[0];
    const keep = heads.filter(h => !/^(status|completed)$/i.test(String(h).trim()));
    await auth.api(`spreadsheets/${enc}/values/` +
      encodeURIComponent('Projects!A2:AZ2') + ':clear', { method: 'POST', body: '{}' });
    await auth.api(`spreadsheets/${enc}/values/` +
      encodeURIComponent('Projects!A2') + '?valueInputOption=RAW',
      { method: 'PUT', body: JSON.stringify({ values: [keep] }) });

    const now = (await raw('Projects!A2:AZ2'))[0].map(h => String(h).toLowerCase());
    ok('the sheet really is missing them now',
       !now.includes('status') && !now.includes('completed'), now.join(','));

    const s = src();
    let book = await s.read();
    const title = 'Test Bravo';
    const r = actions.setStatus(book, { title, status: 'Complete' });
    const res = await s.write(r.change);
    ok('the write reports nothing silently skipped',
       (res.skipped_columns || []).length === 0, JSON.stringify(res.skipped_columns));

    book = await src().read();
    ok('the columns were created', (await raw('Projects!A2:AZ2'))[0]
       .map(h => String(h).toLowerCase()).includes('status'));
    // The bug this exists for: it LOOKED saved and reverted on the next read.
    ok('and the status actually persisted',
       book.projects.find(p => p.project_title === title).status === 'Complete',
       JSON.stringify(book.projects.find(p => p.project_title === title).status));
  }

  // ---------------------------------------------------------------- the log
  section('The change log round-trips, revert column included');
  {
    const s = src();
    await s.ensureEventsTab();
    const head = (await raw('History!A1:Z1'))[0].map(h => String(h).toLowerCase());
    ok('the log has every header the reader maps by',
       ['at', 'action', 'summary', 'superseded', 'appended', 'revert']
         .every(h => head.includes(h)), head.join(','));

    const before = (await s.readEvents()).length;
    await s.appendEvent({ at: '2026-01-01 00:00:00', action: 'test',
      summary: 'a write-path test entry', superseded: '1,2', appended: '3',
      revert: JSON.stringify({ title: 'X', fields: ['status'], values: { status: '' } }) });
    const events = await s.readEvents();
    ok('the entry comes back', events.length === before + 1);
    const last = events[events.length - 1];
    ok('with its row numbers intact', last.superseded === '1,2' && last.appended === '3',
       `${last.superseded} / ${last.appended}`);
    ok('and its revert blob parses', (() => {
      try { return JSON.parse(last.revert).title === 'X'; } catch (e) { return false; }
    })(), last.revert);
  }

  // ---------------------------------------------------------------- no log tab
  section('A book with no log tab reads as an empty log, not an error');
  {
    // readEvents used to ask for the spreadsheet's metadata purely to find out whether
    // the tab existed, then read it — 290ms of overhead on every History load. It now
    // just reads, and treats a 400 "Unable to parse range" as "no log yet". That makes
    // this the important test: an empty log and a broken connection must not look the
    // same, and a missing tab must not throw the way `History!A:Z` in TABS once did.
    const s = src();
    const meta = await auth.api(`spreadsheets/${enc}?fields=sheets.properties`);
    const tab = (meta.sheets || []).find(x => x.properties.title === 'History');
    if (tab) {
      await auth.api(`spreadsheets/${enc}:batchUpdate`, { method: 'POST',
        body: JSON.stringify({ requests: [{ deleteSheet:
          { sheetId: tab.properties.sheetId } }] }) });
    }
    let got, threw = null;
    try { got = await s.readEvents(); } catch (e) { threw = e; }
    ok('it does not throw', threw === null, threw && threw.message);
    ok('and returns an empty log', Array.isArray(got) && got.length === 0,
       JSON.stringify(got));

    // and the book itself must still read — this is what broke when the log tab was
    // added to TABS
    const bk = await src().read();
    ok('the book still reads with no log tab at all', bk.projects.length > 0);

    await s.ensureEventsTab();
    const head = (await raw('History!A1:Z1'))[0] || [];
    ok('ensureEventsTab recreates it with every header',
       ['at', 'action', 'summary', 'superseded', 'appended', 'revert']
         .every(h => head.map(x => String(x).toLowerCase()).includes(h)),
       head.join(','));
    ok('and it reads back empty', (await s.readEvents()).length === 0);

    // The other half, and sabotage is why it is here: widening that catch to swallow
    // EVERY error passed every test above, because "no log yet" and "cannot reach
    // Google" both came back as an empty array. A real failure has to propagate.
    let realFailure = null;
    try {
      await sheets.createSheetsSource({ sheetId: '1ThisSheetDoesNotExistAAAAAAAAAAAAAAAAAAAAAA' })
        .readEvents();
    } catch (e) { realFailure = e; }
    ok('a genuine failure is NOT reported as an empty log',
       realFailure !== null && !/unable to parse range/i.test(realFailure.message),
       realFailure ? realFailure.message.slice(0, 80) : 'it returned normally');
  }

  // ---------------------------------------------------------------- ghosts
  section('Clearing a ghost supersedes only its rows');
  {
    reseed();
    let book = await src().read();
    // A NEIGHBOUR with bookings of its own, first. Without one, "every other booking is
    // untouched" compares 0 against 0 and passes however destructive the code is --
    // sabotage caught exactly that: superseding EVERY row in the book went unnoticed.
    const keep = actions.saveProject(book, { title: 'Test Neighbour', client: 'Netflix',
      deadline: '2026-12-25', dub: 1, edit: 1, mix: 1, mix_level: 'Advanced' });
    await src().write(keep.change);
    book = await src().read();

    const r = actions.saveProject(book, { title: 'Test Ghost', client: 'Netflix',
      deadline: '2026-12-18', dub: 1, edit: 1, mix: 1, mix_level: 'Advanced' });
    await src().write(r.change);
    book = await src().read();
    const ghostRows = actions.live(book).filter(b => b.project === 'Test Ghost').length;
    const otherLive = actions.live(book).filter(b => b.project !== 'Test Ghost').length;
    ok('the project is on the sheet with bookings', ghostRows > 0);
    ok('and there ARE other live bookings for the next check to protect',
       otherLive > 0, otherLive + '');

    // Delete its Projects row by hand, exactly the cause of a ghost.
    const row = book.projects.find(p => p.project_title === 'Test Ghost')._row;
    await auth.api(`spreadsheets/${enc}/values/` +
      encodeURIComponent(`Projects!A${row}:AZ${row}`) + ':clear',
      { method: 'POST', body: '{}' });

    book = await src().read();
    const found = api.orphans(book);
    ok('it is detected as a ghost', found.some(g => g.project === 'Test Ghost'),
       JSON.stringify(found));

    const c = actions.clearOrphans(book, { projects: ['Test Ghost'] });
    ok('clearing is accepted', c.ok === true, JSON.stringify(c).slice(0, 100));
    await src().write(c.change);
    book = await src().read();
    ok('its rows are no longer live',
       actions.live(book).filter(b => b.project === 'Test Ghost').length === 0);
    ok('and every other booking is untouched',
       actions.live(book).filter(b => b.project !== 'Test Ghost').length === otherLive,
       `${actions.live(book).filter(b => b.project !== 'Test Ghost').length} vs ${otherLive}`);
    ok('no ghosts remain', api.orphans(book).length === 0,
       JSON.stringify(api.orphans(book)));
  }

  reseed();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\nCRASHED: ' + (e && e.stack || e));
  process.exit(1);
});
