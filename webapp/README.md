# Loc Prod Planner — web app (new)

The second app. The Apps Script version stays live and untouched; this exists so the
lead can compare, and because Apps Script has a floor of about a second per
interaction that no amount of tuning gets under.

## Why it is fast

Measured on the validation book, warm:

| | Apps Script | here |
|---|---|---|
| bootstrap | ~1 s | 0.2 ms server, 0.6 ms round trip |
| schedule | ~1 s | 0.9 ms |
| analysis | ~1 s | 1.6 ms |
| switching views | a round trip | no request at all |

Not because the code is cleverer — it is the same engine. The Apps Script version
spends ~300 ms on the sandboxed-iframe RPC and 150-250 ms on each of three or four
`SpreadsheetApp` reads before any of our code runs. Here the book is already in memory.

## Shape

    core/engine.js        the scheduler — ONE copy, shared with the Apps Script app
    webapp/store.js       in-memory book, TTL refresh, invalidated on write
    webapp/sources/       where the book comes from: fixture today, sheets next
    webapp/api.js         read models — pure functions of a book, no HTTP, no Google
    webapp/server.js      routes + static files, no npm dependencies
    webapp/public/        the client

Sheets stays the system of record. It is not our cache — it is the thing the team can
open and repair by hand, which has rescued this project more than once (HANDOFF §8).
We read it, write back to it, and never become the only place the truth lives.

The engine is NOT copied. `core/engine.js` evaluates the same `.gs` sources the Apps
Script app runs, so the two cannot give different answers. Every drift bug in this
project came from a second copy of something.

## Running it

    node webapp/server.js            # http://localhost:8127, fixture data

    PLANNER_SOURCE=sheets \
    PLANNER_TTL_MS=15000 \
    node webapp/server.js            # once sources/sheets.js exists

## Not done yet

- `sources/sheets.js` — read and write the real spreadsheet. Needs a service account
  with access to the sheet. Everything else is built to sit behind it unchanged.
- Writes: add/edit project, drag to reassign, re-plan preview/apply.
- Auth. Right now anyone who can reach the port can read the book.
