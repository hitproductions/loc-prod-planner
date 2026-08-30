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

register('fixture', require('./sources/fixture.js'));
// register('sheets', require('./sources/sheets.js'));   // once credentials exist

const SOURCE = process.env.PLANNER_SOURCE || 'fixture';
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
  '/api/schedule':  b => api.schedule(b),
  '/api/analysis':  b => api.analysis(b),
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
  '/api/replan':        (b, p) => actions.replanPreview(b, p.today || TODAY()),
};

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
      const payload = route(book);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      res.setHeader('server-timing', `app;dur=${ms.toFixed(1)}`);
      return send(res, 200, JSON.stringify(payload));
    }

    const action = ACTIONS[url.pathname];
    if (action) {
      if (req.method !== 'POST') return send(res, 405, '{"error":"POST only"}');
      const body = await readBody(req);
      const book = await store.get();
      const result = action(book, body);
      // A change is written to the source before anything is reported as done, so a
      // failed write can never leave the app showing a state the sheet does not have.
      if (result.ok && result.change) {
        await store.write(result.change);
        const next = await store.get(true);
        result.boot = api.bootstrap(next);
        result.schedule = api.schedule(next);
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
    console.log(`Loc Prod Planner (new) on http://localhost:${PORT}  source=${SOURCE}`);
  });
}
module.exports = { server, store, api };
