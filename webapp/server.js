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
const history = require('./history.js');

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

// A read-only instance. This is the actual boundary for the view-only page: a flag in
// the browser stops the UI offering an edit, but anyone can POST to /api/reassign with
// curl, so the refusal has to live here. Start a second process with PLANNER_READONLY=1
// on another port and give engineers THAT link.
//
// Two instances against one sheet is safe in this direction only: the read-only one
// holds no re-plan stash and never writes, so the single-instance rule (§ store.js)
// still holds for the editing instance. Its cached book can trail the editor's by up
// to the TTL, which is why the page says how old the read is.
const READONLY = process.env.PLANNER_READONLY === '1';
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
  '/api/history':   async (b, q) => {
    const events = await store.events();
    const at = q.get('event');
    if (at === null || at === '') {
      return { events: events.map((e, i) => ({ ...e, index: i })).reverse(),
               latest: events.length - 1 };
    }
    const i = Number(at);
    if (!Number.isInteger(i) || i < 0 || i >= events.length) return { error: 'No such event.' };
    return { event: { ...events[i], index: i },
             latest: events.length - 1,
             diff: history.diffEvent(b.bookings, events, i) };
  },
  '/api/bootstrap': b => Object.assign(api.bootstrap(b), { readonly: READONLY }),
  '/api/schedule':  (b, q) => api.schedule(b, { mode: q.get('mode'), from: q.get('from'), to: q.get('to') }),
  '/api/analysis':  (b, q) => api.analysis(b, { from: q.get('from') }),
  '/api/report':    (b, q) => api.report(b, { month: q.get('month') }),
};

// Actions are pure too: book + payload -> a change set. The route applies it and hands
// back fresh state in the same response, so the client never has to ask again — the
// second round trip is exactly what made the Apps Script version feel slow, and a
// separate re-read is also how that version kept showing the previous plan.
// The LOCAL date. toISOString() is UTC and Manila is UTC+8, so between midnight and
// 8am it returns yesterday -- a re-plan run early in the morning would treat the
// current week as already past. Same bug that once bolded last week's row in the grid;
// there is now one implementation of "today" and both callers use it.
const TODAY = api.todayLocal;
const ACTIONS = {
  '/api/reassign':      (b, p) => actions.reassignWeek(b, p),
  '/api/undo':          (b, p) => actions.undoWeekMove(b, p),
  '/api/save-project':  (b, p) => actions.saveProject(b, p),
  '/api/set-status':    (b, p) => actions.setStatus(b, p),
  '/api/set-lock':      (b, p) => actions.setLock(b, p),
  '/api/clear-ghosts':  (b, p) => actions.clearOrphans(b, p),
  '/api/replan':        (b, p) => previewReplan(b, p),      // async
  '/api/replan-apply':  (b, p) => applyReplan(b, p),
  '/api/rollback':      (b, p) => rollback(b, p),
};

// Undo one event by putting its rows back the way they were: retire what it wrote,
// revive what it retired.
//
// The MOST RECENT event only. Rolling back an earlier one would revive rows that later
// changes have since moved on from, producing a book that never existed — and no
// warning could make that safe. Roll back in order or not at all.
async function rollback(book, p) {
  const events = await store.events();
  if (!events.length) return { ok: false, error: 'Nothing in the log yet.' };
  const i = Number(p.index);
  if (i !== events.length - 1) {
    return { ok: false, error: 'Only the most recent change can be rolled back. ' +
      'Undoing an earlier one would revive rows that later changes have moved past.' };
  }
  const e = events[i];
  const undoAppended = history.nums(e.appended);
  const revive = history.nums(e.superseded);

  // A change may have altered the PROJECT ROW as well as the rows — cancelling does
  // both. Reviving the bookings without restoring the status left the project marked
  // Cancelled while holding the weeks back, which is the exact state cancelling exists
  // to prevent. `revert` is written into the log for precisely this.
  let restore = null;
  if (e.revert) {
    try { restore = JSON.parse(e.revert); } catch (err) { restore = null; }
  }
  if (!undoAppended.length && !revive.length && !restore) {
    return { ok: false, error: 'That change wrote nothing to undo.' };
  }

  const change = { supersede: undoAppended, revive };
  if (restore && restore.title) {
    if (restore.project) {
      // A whole row, including its title — this is how undoing a rename puts the name
      // back. No `fields`, because every column is being restored to what it was.
      change.project = restore.project;
      change.original_title = restore.title;
    } else if (restore.fields && restore.values) {
      const project = book.projects.find(x => x.project_title === restore.title);
      if (project) {
        change.project = { ...project, ...restore.values };
        change.fields = restore.fields;
        change.original_title = restore.title;
      }
    }
  }
  return { ok: true, rolled_back: true, index: i,
           summary: `Rolled back: ${e.summary || e.action}`, change };
}

// One line naming what happened, written into the log. Composed here rather than in
// the client so the record says what the server actually did, not what a screen said.
function describe(path, r) {
  if (path === '/api/reassign') {
    return `${r.project} · ${r.phase}, week of ${r.week_start}: ${r.from} → ${r.to}`;
  }
  if (path === '/api/undo') {
    return `${r.project} · ${r.phase}, week of ${r.week_start}: back to ${r.to}, automatic again`;
  }
  if (path === '/api/save-project') return `Saved ${r.title}`;
  if (path === '/api/clear-ghosts') {
    return `Cleared ${r.superseded} booking(s) from ${r.projects.join(', ')}`;
  }
  if (path === '/api/set-lock') {
    return `${r.locked ? 'Locked' : 'Unlocked'} ${r.title}`;
  }
  if (path === '/api/set-status') {
    return r.status ? `${r.title} marked ${r.status.toLowerCase()}`
                    : `${r.title} reopened`;
  }
  if (path === '/api/replan-apply') {
    return `Re-plan applied: ${r.appended} row(s) added, ${r.superseded} superseded`;
  }
  if (path === '/api/rollback') return r.summary || 'Rolled back';
  return 'Change';
}

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
      // A real readiness probe, not a liveness ping. It loads the book if that has not
      // happened yet, so `ok` means "this instance can reach the spreadsheet and parse
      // it" — which is what a container healthcheck needs to know. Returning ok:true
      // unconditionally would have reported healthy before the app could serve anything.
      try {
        await store.get();
        return send(res, 200, JSON.stringify({ ok: true, store: store.stats() }));
      } catch (e) {
        return send(res, 503, JSON.stringify({ ok: false,
          error: String((e && e.message) || e) }));
      }
    }
    const route = ROUTES[url.pathname];
    if (route) {
      const book = await store.get(url.searchParams.get('fresh') === '1');
      // await, because a read route may be async too — /api/history reads the log.
      // Without this the handler's Promise was JSON.stringify'd, which is "{}".
      const payload = await route(book, url.searchParams);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      res.setHeader('server-timing', `app;dur=${ms.toFixed(1)}`);
      return send(res, 200, JSON.stringify(payload));
    }

    const action = ACTIONS[url.pathname];
    if (action) {
      if (req.method !== 'POST') return send(res, 405, '{"error":"POST only"}');
      if (READONLY) {
        return send(res, 403, JSON.stringify({ ok: false, readonly: true,
          error: 'This is a read-only copy of the planner. Changes are made in the ' +
                 'editing app.' }));
      }
      const body = await readBody(req);
      const book = await store.get();
      const result = await action(book, body);
      // A change is written to the source before anything is reported as done, so a
      // failed write can never leave the app showing a state the sheet does not have.
      if (result.ok && result.change) {
        await store.write(result.change, { action: url.pathname.replace('/api/', ''),
                                           summary: describe(url.pathname, result),
                                           revert: result.revert });
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
      `  search=${DEFAULT_RESTARTS}` + (READONLY ? '  READ-ONLY' : ''));
  });
}
module.exports = { server, store, api };
