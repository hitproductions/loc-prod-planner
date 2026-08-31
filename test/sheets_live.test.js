// The Sheets source, against a REAL spreadsheet.
//
// Everything else in the suite runs on the fixture, which has no notion of tabs,
// headers or cell formats — so it cannot see the whole class of bug that has actually
// bitten this app. Three times in one day:
//
//   * dates read back as Sheets serial numbers and were used as if they were ISO
//   * the log tab was added to TABS, so read() asked Google for a range that does not
//     exist and EVERY read of the book failed
//   * a column the app writes was missing from the sheet, so the value was silently
//     dropped and the next read said the change had never happened
//
// Each was found by hand. This runs READ-ONLY — it is safe to point at the live book —
// and skips with a clear message when there are no credentials, so the rest of the
// suite still runs anywhere.
//
//   GOOGLE_APPLICATION_CREDENTIALS=~/.config/loc-prod-planner/key.json \
//   PLANNER_SHEET_ID=<id> node test/sheets_live.test.js
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const sheetId = process.env.PLANNER_SHEET_ID;

if (!keyPath || !sheetId || !fs.existsSync(keyPath.replace(/^~/, process.env.HOME))) {
  console.log('Live Sheets check — SKIPPED');
  console.log('  Set GOOGLE_APPLICATION_CREDENTIALS and PLANNER_SHEET_ID to run it.');
  console.log('  It reads only; it is safe against the live book.\n');
  console.log('0 passed, 0 failed (skipped)');
  process.exit(0);
}

(async () => {
  console.log('Live Sheets check — reading ' + sheetId);
  // This test points at the LIVE book, so it must never write to it. Rather than trust
  // that the read path stays read-only, every HTTP verb is recorded and checked below --
  // if someone later makes read() repair a column, this fails instead of quietly
  // editing Tara's sheet during a test run.
  const verbs = [];
  const gauth = require('../webapp/sources/google-auth.js');
  const realCreate = gauth.createAuth;
  gauth.createAuth = function (...a) {
    const auth = realCreate.apply(this, a);
    const realApi = auth.api.bind(auth);
    auth.api = (path, opts) => {
      verbs.push(((opts && opts.method) || 'GET').toUpperCase() + ' ' + String(path).split('?')[0]);
      return realApi(path, opts);
    };
    return auth;
  };

  const sheets = require('../webapp/sources/sheets.js');
  const { loadAppsScript } = require('../core/engine.js');
  const A = loadAppsScript();


  let src, book;
  try {
    src = sheets.createSheetsSource();
    book = await src.read();
  } catch (e) {
    ok('the book reads at all', false, e.message);
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  ok('the book reads at all', true);

  // ---- shape
  ok('there are engineers', book.engineers.length > 0);
  ok('there are projects', book.projects.length > 0);
  ok('there are bookings', book.bookings.length > 0);

  // ---- dates. Sheets hands these back as serial numbers unless asked otherwise, and
  // a serial used as a date silently plots work in 1899.
  const isISO = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d));
  const badBooking = book.bookings.filter(b => !isISO(b.start_date) || !isISO(b.end_date));
  ok('every booking date is an ISO date, not a serial number',
     badBooking.length === 0,
     badBooking.slice(0, 3).map(b => `${b.project}: ${b.start_date}..${b.end_date}`).join(' | '));
  const badDeadline = book.projects.filter(p => p.deadline && !isISO(p.deadline));
  ok('every project deadline is an ISO date',
     badDeadline.length === 0,
     badDeadline.slice(0, 3).map(p => `${p.project_title}: ${p.deadline}`).join(' | '));

  // and they must be dates the engine can actually place
  const unplaceable = book.bookings.filter(b => {
    const a = A.widx(b.start_date), z = A.widx(b.end_date);
    return !Number.isFinite(a) || !Number.isFinite(z) || z < a;
  });
  ok('and every booking runs forwards in time', unplaceable.length === 0,
     unplaceable.slice(0, 3).map(b => `${b.project} ${b.start_date}..${b.end_date}`).join(' | '));

  // ---- reading the book must not depend on the log tab existing.
  // Adding it to TABS put `History!A:Z` into the batchGet, and on a sheet that had no
  // such tab yet Google rejected the WHOLE request -- so every read of every page died.
  // This is asserted structurally rather than by behaviour, because the tab now exists
  // on the live sheet: the failing condition cannot be reproduced against it without
  // deleting her data, so the shape of the bug is what gets pinned.
  ok('reading the book does not ask for the log tab',
     !Object.values(sheets.TABS).includes(sheets.EVENTS_TAB),
     'TABS = ' + JSON.stringify(sheets.TABS) + ' -- a sheet without a "' +
     sheets.EVENTS_TAB + '" tab would fail EVERY read');

  // ---- the columns this app writes must EXIST, or a write is silently dropped
  const raw = await rawRow(keyPath, sheetId, 'Projects!A2:AZ2');
  const heads = raw.map(h => String(h || '').trim().toLowerCase());
  const missing = sheets.MANAGED_COLUMNS.filter(c => !heads.includes(c.toLowerCase()));
  ok('every column the app writes exists on the sheet', missing.length === 0,
     'missing: ' + missing.join(', ') + ' — writes to these are dropped in silence');

  // ---- the engine can consume what came back
  try {
    const live = A.activeRows(book.bookings);
    const score = A.scorePlan(live, book.engineers);
    ok('the engine can score the book as read', typeof score.total_double_booked === 'number',
       JSON.stringify(score.total_double_booked));
    ok('and every booking names someone on the roster',
       live.every(b => book.engineers.some(e => e.name === b.engineer)),
       [...new Set(live.filter(b => !book.engineers.some(e => e.name === b.engineer))
         .map(b => b.engineer))].join(', '));
  } catch (e) {
    ok('the engine can score the book as read', false, e.message);
  }

  // ---- the log tab must be readable whether or not it exists yet
  try {
    const events = await src.readEvents();
    ok('the change log is readable', Array.isArray(events), typeof events);
  } catch (e) {
    ok('the change log is readable', false, e.message);
  }

  // The guard is only meaningful if it actually saw the traffic -- a monkeypatch
  // installed after sheets.js had already destructured createAuth would observe
  // nothing and pass for the wrong reason. That happened; hence this.
  ok('the read path was actually observed', verbs.length >= 3,
     'only ' + verbs.length + ' call(s) intercepted: ' + JSON.stringify(verbs));
  const wrote = verbs.filter(v => !v.startsWith('GET'));
  ok('the whole check wrote nothing to the live sheet', wrote.length === 0,
     wrote.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

// A bare values.get, so the header check does not depend on the parsing being right —
// that is the thing under test.
async function rawRow(key, id, range) {
  const { createAuth } = require('../webapp/sources/google-auth.js');
  const auth = createAuth();
  const r = await auth.api(`spreadsheets/${encodeURIComponent(id)}/values/` +
    encodeURIComponent(range));
  return (r.values && r.values[0]) || [];
}
