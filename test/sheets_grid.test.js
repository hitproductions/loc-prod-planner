// Google refuses any write past a tab's last column. The live Projects tab was exactly 30
// wide after the six phase-date columns, so creating Series (the 31st, AE) failed every
// save: "Range (Projects!AE2) exceeds grid limits ... max columns: 30" (Tara, 2026-10-27).
// This runs the real Sheets source against a stand-in API that enforces that limit.
//
// Run: node test/sheets_grid.test.js
const Module = require('module');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
const colIndex = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
const HEADER = ['Project', 'Client', 'Deadline', 'Phases D/E/M', 'Mix level', 'Music/Songs',
  'Special', 'Atmos', 'Recordist pick', 'Recordist pick 2', 'Editor pick', 'Mixer pick',
  'Dub wks', 'Edit wks', 'Mix wks', 'Recordist', 'Editor', 'Mixer', 'Warnings', 'Notes',
  'Plotted', 'Locked', 'Status', 'Completed', 'Dub start', 'Dub end', 'Edit start',
  'Edit end', 'Mix start', 'Mix end'];

function fakeSheet(width) {
  const tabs = {
    Projects: { sheetId: 1, cols: width, grid: [['banner'], HEADER.slice(), ['Existing', 'Netflix', 46300]] },
    Bookings: { sheetId: 2, cols: 26, grid: [['project', 'phase', 'engineer', 'start_date', 'end_date', 'source', 'note', 'status']] },
    Engineers: { sheetId: 3, cols: 26, grid: [['name'], ['Kyle']] },
  };
  const calls = [];
  const byId = sid => Object.values(tabs).find(t => t.sheetId === sid);
  const limit = (t, end) => { if (end > t.cols) throw Object.assign(new Error('exceeds grid limits'), { status: 400 }); };
  async function api(path, init) {
    const method = (init && init.method) || 'GET', body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: decodeURIComponent(path), body });
    const u = new URL('https://x/' + path);
    if (u.pathname.endsWith('values:batchGet'))
      return { valueRanges: u.searchParams.getAll('ranges').map(r => ({ range: r, values: tabs[r.split('!')[0]].grid })) };
    if (u.pathname.endsWith('values:batchUpdate')) {
      body.data.forEach(d => { const [tab, a1] = d.range.split('!'); const m = /^([A-Z]+)(\d+)$/.exec(a1);
        limit(tabs[tab], colIndex(m[1]) + 1);
        (tabs[tab].grid[m[2] - 1] = tabs[tab].grid[m[2] - 1] || [])[colIndex(m[1])] = d.values[0][0]; });
      return {};
    }
    if (u.pathname.endsWith(':batchUpdate')) {
      for (const rq of body.requests) {
        if (rq.appendDimension) byId(rq.appendDimension.sheetId).cols += rq.appendDimension.length;
        const r = (rq.repeatCell || rq.setDataValidation || {}).range;
        if (r) limit(byId(r.sheetId), r.endColumnIndex);
        if (rq.updateDimensionProperties) { const d = rq.updateDimensionProperties.range; limit(byId(d.sheetId), d.endIndex); }
      }
      return {};
    }
    if (u.pathname.includes('/values/') && method === 'PUT') {
      const [tab, a1] = decodeURIComponent(u.pathname.split('/values/')[1]).split('!');
      const m = /^([A-Z]+)(\d+)$/.exec(a1), c0 = colIndex(m[1]), t = tabs[tab];
      body.values[0].forEach((v, i) => {
        if (c0 + i >= t.cols) throw Object.assign(new Error(`Range (${tab}!${a1}) exceeds grid limits. Max rows: 1001, max columns: ${t.cols}`), { status: 400 });
        t.grid[m[2] - 1][c0 + i] = v;
      });
      return {};
    }
    return { sheets: Object.entries(tabs).map(([title, t]) => ({ properties: { title, sheetId: t.sheetId,
      gridProperties: { columnCount: t.cols, rowCount: 1001 } } })) };
  }
  return { tabs, calls, api };
}

function sourceOn(sheet) {
  const real = Module._load;
  Module._load = function (req) {
    if (/google-auth\.js$/.test(req)) return { createAuth: () => ({ api: sheet.api, email: 't@x' }) };
    return real.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../webapp/sources/sheets.js')];
    return require('../webapp/sources/sheets.js').createSheetsSource({ sheetId: 'S' });
  } finally { Module._load = real; }
}

(async () => {
  console.log('\nSaving a project when the Projects tab is exactly 30 columns wide');
  const s = fakeSheet(30), src = sourceOn(s);
  const b = await src.read();
  let err = null;
  try { await src.write({ supersede: [], append: [], project: { ...b.projects[0], series: 'Blue Box' },
                          original_title: 'Existing' }); } catch (e) { err = e; }
  ok('the save does not fail with a grid-limit error', !err, err && err.message);
  ok('the tab is widened to hold Series', s.tabs.Projects.cols >= 31, 'cols ' + s.tabs.Projects.cols);
  const widen = s.calls.findIndex(c => c.body && c.body.requests && c.body.requests.some(r => r.appendDimension));
  const head = s.calls.findIndex(c => c.method === 'PUT' && /Projects!AE2/.test(c.path));
  ok('columns are added BEFORE the header is written', widen !== -1 && head !== -1 && widen < head, `widen ${widen}, header ${head}`);
  ok('Series is a header now', s.tabs.Projects.grid[1].includes('Series'));
  ok('and the series value is read back', (await src.read()).projects[0].series === 'Blue Box');

  console.log('\nA tab that already has room is left as it is');
  const r = fakeSheet(40), src2 = sourceOn(r);
  const b2 = await src2.read();
  await src2.write({ supersede: [], append: [], project: { ...b2.projects[0], series: 'X' }, original_title: 'Existing' });
  ok('no columns are appended', !r.calls.some(c => c.body && c.body.requests && c.body.requests.some(q => q.appendDimension)));
  ok('its width is unchanged', r.tabs.Projects.cols === 40, String(r.tabs.Projects.cols));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
