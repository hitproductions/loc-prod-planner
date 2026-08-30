// Does the service account actually work? Run this before wiring anything up.
//
//   GOOGLE_APPLICATION_CREDENTIALS=~/path/key.json \
//   PLANNER_SHEET_ID=<the long id from the sheet URL> \
//   node tools/check_sheets_access.js
//
// It reads only. Nothing is written, so it is safe to point at the live sheet.
const { createAuth } = require('../webapp/sources/google-auth.js');

const WANT = ['Projects', 'Bookings', 'Engineers'];

(async () => {
  const sheetId = process.env.PLANNER_SHEET_ID;
  if (!sheetId) {
    console.error('Set PLANNER_SHEET_ID to the id from the spreadsheet URL:\n' +
      '  https://docs.google.com/spreadsheets/d/THIS_PART/edit');
    process.exit(1);
  }

  let auth;
  try { auth = createAuth(); }
  catch (e) { console.error('\n✗ ' + e.message + '\n'); process.exit(1); }

  console.log('\nservice account : ' + auth.email);
  console.log('cloud project   : ' + (auth.projectId || '(not in the key)'));
  console.log('spreadsheet     : ' + sheetId + '\n');

  let meta;
  try {
    meta = await auth.api(`spreadsheets/${encodeURIComponent(sheetId)}?fields=properties.title,sheets.properties`);
  } catch (e) {
    console.error('✗ ' + e.message + '\n');
    process.exit(1);
  }

  console.log('✓ reached the spreadsheet: "' + meta.properties.title + '"');
  const tabs = (meta.sheets || []).map(s => s.properties.title);
  console.log('  tabs: ' + tabs.join(', ') + '\n');

  let missing = WANT.filter(t => !tabs.includes(t));
  if (missing.length) {
    console.log('! expected tabs not found: ' + missing.join(', '));
    console.log('  The new app reads the same three tabs as the Apps Script one.\n');
  }

  // Read a corner of each tab, which is what proves the grant is real rather than
  // just the file being visible.
  for (const tab of WANT.filter(t => tabs.includes(t))) {
    const r = await auth.api(`spreadsheets/${encodeURIComponent(sheetId)}/values/` +
      encodeURIComponent(`${tab}!A1:D3`));
    const rows = r.values || [];
    console.log(`✓ ${tab}: ${rows.length} row(s) read`);
    rows.slice(0, 2).forEach(row => console.log('    ' + row.slice(0, 4).join(' | ')));
  }

  console.log('\nAll good. The app can read this spreadsheet.');
  console.log('Writing needs Editor access — if you shared it as Viewer, change that now.\n');
})().catch(e => { console.error('\n✗ ' + (e && e.message || e) + '\n'); process.exit(1); });
