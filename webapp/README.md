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

Against the real spreadsheet:

    GOOGLE_APPLICATION_CREDENTIALS=~/.config/loc-prod-planner/key.json \
    PLANNER_SHEET_ID=<the long id in the sheet URL> \
    PLANNER_SOURCE=sheets \
    node webapp/server.js

Check the credentials first — this reads only, so it is safe on a live sheet:

    GOOGLE_APPLICATION_CREDENTIALS=... PLANNER_SHEET_ID=... \
    node tools/check_sheets_access.js

The service account needs Editor on the spreadsheet to write. Point it at a COPY
while the Apps Script app is still in use: two apps writing one sheet will fight.

Columns are mapped by HEADER NAME, not position, so a sheet that predates the Atmos
and Recordist-pick-2 columns still reads, and a column inserted by hand does not
silently re-point every field after it.

## Actions

Each is a pure function of the book returning a CHANGE SET — rows to supersede, rows
to append. The store applies it to whichever source is configured, so they test
without HTTP or Google (`test/webapp.test.js`).

    POST /api/reassign      drag a week; omit `confirmed` for a preview + warnings
    POST /api/undo          give a hand-placed week back to the tool
    POST /api/save-project  add or edit; `dry_run` for availability only
    POST /api/replan        preview a re-solve

Nothing is deleted. A row that stops being true is superseded and stays as history.

A write returns fresh `boot` and `schedule` in the SAME response. Re-asking after a
write is what made the old app feel slow, and a separate re-read is also how it kept
showing the previous plan three times over.

## Not done yet

- `sources/sheets.js` — read and write the real spreadsheet. Needs a service account
  with access to the sheet. Everything else is built to sit behind it unchanged.
- Applying a re-plan (preview works; apply needs the stash).
- Analysis view.
- The Projects/Engineers grid toggle and the quarter range picker.
- Auth. Right now anyone who can reach the port can read and change the book.
