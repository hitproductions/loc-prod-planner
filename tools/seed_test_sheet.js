// Seed the throwaway spreadsheet the write-path suite runs against.
//
// It mirrors the LIVE book's layout exactly, including the two things that are easy to
// get wrong and have both caused bugs: the Projects banner on row 1 with headers on
// row 2, and the Engineers tab's legacy `specials_only` header. Testing against a
// tidier sheet than production would defeat the purpose.
//
//   PLANNER_TEST_SHEET_ID=<id> GOOGLE_APPLICATION_CREDENTIALS=<key> \
//   node tools/seed_test_sheet.js
const fs = require('fs');
const path = require('path');
const { createAuth } = require('../webapp/sources/google-auth.js');
const { loadAppsScript } = require('../core/engine.js');
const A = loadAppsScript();

const BANNER = 'TEST SHEET — seeded by tools/seed_test_sheet.js. Safe to wipe.';
const E_LIVE = ['name', 'can_record', 'can_edit', 'can_mix', 'mix_level',
                'music_specialist', 'overflow_only', 'specials_only', 'atmos'];
const B_HEADERS = ['project', 'phase', 'engineer', 'start_date', 'end_date',
                   'source', 'note', 'status'];

// A small slate, deliberately not 24 projects: these tests are about whether a write
// lands in the right cell, not about scheduling quality.
const PROJECTS = [
  ['Test Alpha',  'Netflix', '2026-10-16', '2/1/1', 'Advanced', 'No', 'No', 'No'],
  ['Test Bravo',  'Netflix', '2026-10-30', '1/1/1', 'Advanced', 'No', 'No', 'No'],
  ['Test Charlie', 'Disney', '2026-11-13', '3/1/2', 'Developing', 'No', 'No', 'No'],
];

(async () => {
  const id = process.env.PLANNER_TEST_SHEET_ID;
  if (!id) throw new Error('Set PLANNER_TEST_SHEET_ID.');
  const auth = createAuth();
  const enc = encodeURIComponent(id);

  const meta = await auth.api(`spreadsheets/${enc}?fields=sheets.properties`);
  const have = {};
  (meta.sheets || []).forEach(s => { have[s.properties.title] = s.properties.sheetId; });

  const requests = [];
  const first = (meta.sheets || [])[0];
  // A fresh spreadsheet has one sheet called Sheet1; reuse it as Projects.
  if (!have.Projects && first) {
    requests.push({ updateSheetProperties: {
      properties: { sheetId: first.properties.sheetId, title: 'Projects' },
      fields: 'title' } });
    have.Projects = first.properties.sheetId;
  }
  for (const t of ['Bookings', 'Engineers']) {
    if (!have[t]) requests.push({ addSheet: { properties: { title: t } } });
  }
  if (requests.length) {
    await auth.api(`spreadsheets/${enc}:batchUpdate`,
      { method: 'POST', body: JSON.stringify({ requests }) });
  }

  // Engineers, from the same TSV the live roster came from.
  const tsv = path.join(__dirname, '..', 'deploy', 'engineers.tsv');
  const roster = fs.readFileSync(tsv, 'utf8').trim().split('\n')
    .map(l => l.split('\t'));

  const data = [
    { range: 'Projects!A1', values: [[BANNER]] },
    { range: 'Projects!A2', values: [A.P_HEADERS] },
    { range: 'Projects!A3', values: PROJECTS.map(p =>
        p.concat(Array(A.P_HEADERS.length - p.length).fill(''))) },
    { range: 'Bookings!A1', values: [B_HEADERS] },
    { range: 'Engineers!A1', values: [E_LIVE] },
    { range: 'Engineers!A2', values: roster },
  ];
  await auth.api(`spreadsheets/${enc}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });

  // Anything below the seeded rows is left over from a previous run.
  await auth.api(`spreadsheets/${enc}/values/` +
    encodeURIComponent(`Projects!A${3 + PROJECTS.length}:AZ1000`) + ':clear',
    { method: 'POST', body: '{}' });
  await auth.api(`spreadsheets/${enc}/values/` +
    encodeURIComponent('Bookings!A2:Z5000') + ':clear', { method: 'POST', body: '{}' });

  console.log(`Seeded: ${PROJECTS.length} projects, ${roster.length} engineers, 0 bookings.`);
})();
