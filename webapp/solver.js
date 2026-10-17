// The scheduling search, on a worker thread.
//
// Apps Script capped execution at six minutes and every solve blocked the user, so the
// engine settled for 200 shuffled orderings. Measured on an incrementally built book:
//
//     restarts   time    overlapped   spread   peak
//        202     1.4s        2           5      19
//       1000     7.0s        2           1      17
//       5000    34.5s        2           1      17
//
// A thousand is worth having and five thousand is not — the same plan, five times the
// wait. So the default is 1000, and it runs OFF the main thread: seven seconds of
// solving must not stop the grid from loading for whoever else is looking at it.
//
// The worker reloads the engine from the same .gs sources with SOLVE_RESTARTS
// substituted. Still one copy of the scheduler; only the search depth differs.
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DEFAULT_RESTARTS = Number(process.env.PLANNER_SEARCH || 1000);

if (!isMainThread) {
  const { loadAppsScript } = require('../core/engine.js');
  const { projects, bookings, engineers, todayISO, restarts } = workerData;
  const A = loadAppsScript({ restarts });
  try {
    parentPort.postMessage({ ok: true, result: A.replanBook(projects, bookings, engineers, todayISO) });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String((e && e.message) || e) });
  }
}

// What the worker is handed. Pulled out so a test can look at it: re-plan declines to
// change anything when it cannot improve the book, so judging this path by its OUTPUT
// passes whether or not the projects were prepared correctly.
//
// Closed projects are prepared exactly as actions.forReplan does for the in-thread path:
// a cancelled one (no rows) is left out, a completed one is kept but frozen so its weeks
// stay put. Handing the worker every project planned a cancelled one from scratch and
// Apply would have put it back; dropping a completed one superseded its future weeks
// with nothing to replace them (found 2026-10-15 and 2026-10-17).
function inputFor(book, todayISO, restarts) {
  const actions = require('./actions.js');
  return {
    projects: actions.forReplan(book.projects, actions.live(book)),
    bookings: book.bookings,
    engineers: book.engineers,
    todayISO, restarts,
  };
}

// Resolves with replanBook's result. Rejects if the worker dies, so a caller never
// waits forever on a thread that has gone.
function solveReplan(book, todayISO, opts) {
  const restarts = (opts && opts.restarts) || DEFAULT_RESTARTS;
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'solver.js'), {
      workerData: inputFor(book, todayISO, restarts),
    });
    let settled = false;
    const done = fn => (...a) => { if (!settled) { settled = true; fn(...a); } };
    const ok = done(resolve), fail = done(reject);
    w.on('message', m => { m.ok ? ok(m.result) : fail(new Error(m.error)); w.terminate(); });
    w.on('error', fail);
    w.on('exit', code => { if (code !== 0) fail(new Error(`Solver exited with ${code}`)); });
  });
}

module.exports = { solveReplan, inputFor, DEFAULT_RESTARTS };
