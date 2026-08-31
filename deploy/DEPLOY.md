# Loc Prod Planner — deployment notes

For whoever administers `signal.hitpromanila.net`. Internal — contains client project
names in the sample data under `validation/`.

## What you were sent

| | |
|---|---|
| this repo | the app, its tests, and the Apps Script version it replaced |
| `deploy/Dockerfile` | image definition — no build step, no dependencies |
| `deploy/docker-compose.planner.yml` | two services to add beside the n8n stack |
| `planner-key.json` | **sent separately.** A credential. |

Start here, then `webapp/README.md` if you want to know how the app is put together.
`HANDOFF.md` is the full engineering record and is not needed to run it.

## What it is

A small Node web app that schedules localization work across the engineers. It reads and
writes a Google Sheet through a service account; **the spreadsheet is the database.** The
app holds a copy in memory for speed and re-reads it on a timer and after every change.

- **No npm dependencies.** None. Plain Node — no `npm install`, no lockfile, no build.
- **No database, no volumes, no writable disk.** The only file it needs is the
  service-account key, mounted read-only.
- **Outbound HTTPS to `sheets.googleapis.com` and `oauth2.googleapis.com`.** Nothing else.
Measured on the real book (24 projects, 74 bookings), per instance:

| | RSS |
|---|---|
| started, before it has read the sheet | 51 MB |
| book loaded, every page served | 82 MB |
| **peak, during a re-plan** | **184 MB** |

**Do not cap a container below 256 MB.** A re-plan runs a 1,000-restart search on a
worker thread — one extra core for a few seconds, and that is where the memory goes. The
read-only instance never re-plans, so it stays near 82 MB.

A re-plan takes about **5 seconds** on the live book. It is a POST that holds the
connection open for that long, so any proxy timeout must be above it (nginx's 60s default
is fine; so is Cloudflare's). Nothing else takes more than a few hundred ms.

Node **20 or newer** (it uses built-in `fetch` and `worker_threads`). The image pins 22.

## Two instances, on purpose

| service | port | what it is |
|---|---|---|
| `planner` | 8127 | the app. Reads and writes the sheet. |
| `planner-view` | 8128 | the same app with `PLANNER_READONLY=1`. Every write route answers **403**. |

`planner-view` is what engineers get. Serve `/view.html` from it — the ordinary schedule
page with nothing to press.

**Run exactly one `planner`.** It holds the re-plan preview and the book's version number
in memory, so a second copy would issue preview tokens the first does not recognise.
`planner-view` never writes and is safe to run more than once.

Do **not** serve `/view.html` from the editing instance. That gives you a page that looks
read-only in front of an API that is not.

## Environment

| variable | required | meaning |
|---|---|---|
| `PLANNER_SHEET_ID` | yes | the long id from the spreadsheet URL |
| `GOOGLE_APPLICATION_CREDENTIALS` | yes | path to the service-account JSON key |
| `PLANNER_SOURCE` | yes | `sheets` (the default, `fixture`, is sample data) |
| `PORT` | no | default 8127 |
| `PLANNER_READONLY` | no | `1` makes the instance refuse every write |
| `PLANNER_TTL_MS` | no | how long the in-memory copy is trusted; default 30000 |
| `PLANNER_SEARCH` | no | re-plan search depth; default 1000 restarts |

## The key

Tara sends `planner-key.json` **separately** — it is a credential that can edit the
planning spreadsheet. Do not commit it, and mount it read-only. The app never logs it.

If it needs replacing: Google Cloud console → project `loc-prod-planner` → service account
`planner-app@loc-prod-planner.iam.gserviceaccount.com` → new key. The spreadsheet must be
shared with that address as **Editor**.

## Running it

```bash
# from the repo root, with planner-key.json beside the compose file
PLANNER_SHEET_ID=<the id> docker compose -f deploy/docker-compose.planner.yml up -d --build
```

Or without Docker:

```bash
PLANNER_SOURCE=sheets PLANNER_SHEET_ID=<the id> \
GOOGLE_APPLICATION_CREDENTIALS=/etc/planner/key.json \
node webapp/server.js
```

**Not tested in Docker.** The app has been run only directly under Node (v26 on macOS).
The Dockerfile is straightforward — copy source, run `node webapp/server.js` — but the
image has not been built, so treat the first build as unverified.

## Reverse proxy

Two hostnames, both already covered by the existing Cloudflare setup:

| hostname | to | who |
|---|---|---|
| `planner.hitpromanila.net` | `planner:8127` | production team |
| `schedule.hitpromanila.net` | `planner-view:8128` | engineers |

The app serves its own static files and expects to be at the root of its hostname. It
sets no cookies and keeps no session, so no sticky sessions or affinity are needed.

## Access control — this is the part the app does not do itself

**The app has no login.** It authenticates nobody. Whatever reaches it is trusted, which
is why it must sit behind Cloudflare Access (or equivalent) on both hostnames.

Once Access is in front, it passes the signed-in email in
`Cf-Access-Authenticated-User-Email`. The app does not read that header **yet** — with it
in place, `schedule.hitpromanila.net` can be narrowed so each engineer sees only their own
row instead of the whole board. That needs an `email` column on the Engineers tab and a
small change in the app; ask Tara.

Until Access is configured, keep both hostnames off the public internet.

## Checking it works

```bash
curl -s localhost:8127/api/health          # {"ok":true,"store":{...}}
curl -s localhost:8127/api/bootstrap | head -c 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8128/api/reassign   # must be 403
```

`/api/health` reports the store's state — it is only `ok` once the spreadsheet has been
read at least once, so it is a genuine readiness probe.

Expected timings once warm: the first read of the sheet takes about half a second; every
read after that is **under 2 ms**, because it is served from memory. A write is one round
trip to Google (~300 ms) for a lock or a status change, two for saving a project. A
re-plan is about 5 seconds — see above.

## If something is wrong

- **`Set PLANNER_SHEET_ID`** — the variable is missing or empty.
- **`Spreadsheet not found (404)`** — wrong id, or the sheet is not shared with the
  service account.
- **`The spreadsheet has no "Projects" tab`** — pointed at the wrong spreadsheet.
- **`No service-account key`** — `GOOGLE_APPLICATION_CREDENTIALS` does not point at a
  readable file inside the container.
- **Everything 403 on the editing instance** — `PLANNER_READONLY` is set where it should
  not be.

Logs go to stdout. There is no log file and nothing to rotate.

## Backups

Nothing to back up on the server. The data is the Google Sheet, which has its own version
history, and the app keeps an append-only change log on the sheet's `History` tab.
