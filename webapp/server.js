// The new app's server. No dependencies — Node's own http, and the shared engine.
//
// Every route answers from the in-memory book, so a request costs single-digit
// milliseconds instead of the ~1s the Apps Script version spends on RPC plus three or
// four SpreadsheetApp reads before any of our code runs.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { register, createStore } = require('./store.js');
const api = require('./api.js');
const actions = require('./actions.js');
const { solveReplan, DEFAULT_RESTARTS } = require('./solver.js');

register('fixture', require('./sources/fixture.js'));

// Registered only when asked for, so the app still starts with no credentials on the
// machine — which is what keeps the fixture path usable for development and tests.
const SOURCE = process.env.PLANNER_SOURCE || 'fixture';
if (SOURCE === 'sheets') {
  try {
    const { createSheetsSource } = require('./sources/sheets.js');
    const src = createSheetsSource();
    register('sheets', src);
    console.log(`Sheets source : ${process.env.PLANNER_SHEET_ID}`);
    console.log(`  acting as   : ${src.email}`);
  } catch (e) {
    // A missing env var is a setup mistake, not a crash. A stack trace here buries the
    // one line that says what to do.
    console.error('\nCannot use the spreadsheet:\n  ' + e.message +
      '\n\nCheck it first with:\n' +
      '  GOOGLE_APPLICATION_CREDENTIALS=<key.json> PLANNER_SHEET_ID=<id> \\\n' +
      '    node tools/check_sheets_access.js\n');
    process.exit(1);
  }
}

const PORT = Number(process.env.PORT || 8127);
const store = createStore(SOURCE, { ttlMs: Number(process.env.PLANNER_TTL_MS || 30000) });

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

function send(res, code, body, type) {
  res.writeHead(code, { 'content-type': type || 'application/json; charset=utf-8',
                        'cache-control': 'no-store' });
  res.end(body);
}

// Read models are pure functions of the book, so a route is: get the book, call one.
const ROUTES = {
  '/api/bootstrap': b => api.bootstrap(b),
  '/api/schedule':  (b, q) => api.schedule(b, { mode: q.get('mode'), from: q.get('from'), to: q.get('to') }),
  '/api/analysis':  (b, q) => api.analysis(b, { from: q.get('from') }),
};

// Actions are pure too: book + payload -> a change set. The route applies it and hands
// back fresh state in the same response, so the client never has to ask again — the
// second round trip is exactly what made the Apps Script version feel slow, and a
// separate re-read is also how that version kept showing the previous plan.
const TODAY = () => new Date().toISOString().slice(0, 10);
const ACTIONS = {
  '/api/reassign':      (b, p) => actions.reassignWeek(b, p),
  '/api/undo':          (b, p) => actions.undoWeekMove(b, p),
  '/api/save-project':  (b, p) => actions.saveProject(b, p),
  '/api/replan':        (b, p) => previewReplan(b, p),      // async
  '/api/replan-apply':  (b, p) => applyReplan(b, p),
};

// A re-plan is agreed to in two steps, and the book can move between them — someone
// else drags a week, or a project is saved. The preview is held server-side with the
// store version it was computed against; apply refuses if that has changed rather than
// writing a plan nobody was shown. The client never sends the change set back: it
// holds the token only.
let STASH = null;

async function previewReplan(book, p) {
  // Off the main thread: a deep search takes seconds, and the grid must still load for
  // anyone else looking at it while this one is thinking.
  const rows = actions.live(book);
  const raw = await solveReplan(book, p.today || TODAY());
  const r = actions.shapeReplan(book, rows, raw);
  if (r.change) {
    STASH = { version: store.version(), change: r.change, at: Date.now() };
    r.token = String(STASH.version);
  }
  delete r.change;          // the plan is the server's to hold, not the client's to keep
  return r;
}

function applyReplan(book, p) {
  if (!STASH) return { ok: false, error: 'Nothing to apply — run the preview first.' };
  if (String(p.token) !== String(STASH.version)) {
    return { ok: false, error: 'That preview is out of date.' };
  }
  if (store.version() !== STASH.version) {
    STASH = null;
    return { ok: false, error: 'The book changed since the preview. Run it again to see ' +
      'what a re-plan would do now.' };
  }
  const change = STASH.change;
  STASH = null;
  return { ok: true, applied: true,
           superseded: (change.supersede || []).length,
           appended: (change.append || []).length,
           change };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', c => {
      n += c.length;
      if (n > 1e6) { reject(new Error('Payload too large')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => {
      try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); }
      catch (e) { reject(new Error('Body is not JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const started = process.hrtime.bigint();
  try {
    if (url.pathname === '/api/health') {
      return send(res, 200, JSON.stringify({ ok: true, store: store.stats() }));
    }
    const route = ROUTES[url.pathname];
    if (route) {
      const book = await store.get(url.searchParams.get('fresh') === '1');
      const payload = route(book, url.searchParams);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      res.setHeader('server-timing', `app;dur=${ms.toFixed(1)}`);
      return send(res, 200, JSON.stringify(payload));
    }

    const action = ACTIONS[url.pathname];
    if (action) {
      if (req.method !== 'POST') return send(res, 405, '{"error":"POST only"}');
      const body = await readBody(req);
      const book = await store.get();
      const result = await action(book, body);
      // A change is written to the source before anything is reported as done, so a
      // failed write can never leave the app showing a state the sheet does not have.
      if (result.ok && result.change) {
        await store.write(result.change);
        const next = await store.get(true);
        result.boot = api.bootstrap(next);
        result.schedule = api.schedule(next, { mode: body.mode, from: body.from, to: body.to });
      }
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      res.setHeader('server-timing', `app;dur=${ms.toFixed(1)}`);
      return send(res, 200, JSON.stringify(result));
    }
    // static client
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    if (p.includes('..')) return send(res, 400, '{"error":"bad path"}');
    const file = path.join(__dirname, 'public', p);
    if (!fs.existsSync(file)) return send(res, 404, '{"error":"not found"}');
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    send(res, 500, JSON.stringify({ error: String((e && e.message) || e) }));
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Loc Prod Planner (new) on http://localhost:${PORT}  source=${SOURCE}` +
      `  search=${DEFAULT_RESTARTS}`);
  });
}
module.exports = { server, store, api };
