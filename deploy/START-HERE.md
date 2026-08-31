# Loc Prod Planner — hosting request

Hi Genzo. Tara asked me to write this up so you have everything in one place.

**The ask:** run a small Node web app on the same box as n8n, behind Cloudflare, and set
it up so Tara can deploy her own changes afterwards without going through you.

Rough size of the job: **20–30 minutes**, mostly waiting for a container to build.

---

## What it is, in one paragraph

An internal scheduling tool for localization work — who records, edits and mixes which
project, in which week. It reads and writes a Google Sheet through a service account, and
**the spreadsheet is the database**. The app keeps a copy in memory for speed. It has
**zero npm dependencies**, no build step, no database, and writes nothing to disk.

It replaces a Google Apps Script version that was too slow. That version is still in the
repo (`appsscript/`) but is not what you are deploying.

---

## What you need from Tara

| | |
|---|---|
| **Repo access** | `github.com/hitproductions/loc-prod-planner` (private). She needs to add you. |
| **`planner-key.json`** | The Google service-account key. **She is sending this separately, not in this zip** — it is a credential, and this document may get forwarded. |
| **The sheet id** | `1_9A1gzFlr8xOkmmzRdH75JBS5KmkqEoS0lLO3GWOGiQ` |

---

## The five steps

**1. Clone it where the containers will live**

```bash
git clone https://github.com/hitproductions/loc-prod-planner.git /srv/planner
cd /srv/planner
```

**2. Put the key beside the compose file** — `deploy/planner-key.json`, mode 600. It is
already in `.gitignore`, so it cannot be committed by accident.

**3. Bring up two containers**

```bash
PLANNER_SHEET_ID=1_9A1gzFlr8xOkmmzRdH75JBS5KmkqEoS0lLO3GWOGiQ \
  docker compose -f deploy/docker-compose.planner.yml up -d --build
```

- `planner` on **8127** — the app. Reads and writes the sheet.
- `planner-view` on **8128** — the same app with writes disabled. Every write route
  answers 403.

Two things that matter, both explained in `deploy/DEPLOY.md`:

- **Run exactly one `planner`.** It holds re-plan state in memory; a second copy would
  hand out tokens the first does not recognise.
- **Never serve `/view.html` from 8127.** That gives a page that looks read-only in front
  of an API that is not.

**4. Two hostnames through Cloudflare**

| hostname | to | for |
|---|---|---|
| `planner.hitpromanila.net` | `planner:8127` | the production team |
| `schedule.hitpromanila.net` | `planner-view:8128` | engineers |

**The app has no login. It authenticates nobody.** Whatever reaches it is trusted, so both
hostnames need Cloudflare Access in front before they are reachable. If Access can pass
`Cf-Access-Authenticated-User-Email`, please turn that on — it is what will later let each
engineer see only their own row instead of the whole board.

**5. One cron line, so Tara can deploy herself**

```bash
*/5 * * * * cd /srv/planner && ./deploy/redeploy.sh --pull >> /var/log/planner-deploy.log 2>&1
```

`deploy/redeploy.sh` pulls, **runs the test suites and refuses to deploy if any fail**,
rebuilds, then polls `/api/health` and reports whether it came back. It exits silently
when nothing has changed, so it will not spam you. A broken push leaves the running app
untouched.

---

## Checking it worked

```bash
curl -s localhost:8127/api/health                                        # {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8128/api/reassign   # 403
```

`/api/health` only answers `ok` once the instance has actually read the spreadsheet, so it
is a real readiness probe — use it for the healthcheck.

Expected once warm: first read of the sheet ~0.5s, every read after that **under 2ms**, a
write ~300ms, a re-plan **about 5 seconds** (it holds the connection open that long, so
proxy timeouts need to clear it).

---

## Two things to size correctly

- **Do not cap memory below 256 MB.** Measured: 51 MB at startup, 82 MB serving, **184 MB
  peak during a re-plan** — it runs a 1,000-restart search on a worker thread.
- **Outbound HTTPS to `sheets.googleapis.com` and `oauth2.googleapis.com`.** Nothing else.

---

## Please don't

- **Commit anything on the server.** `redeploy.sh` uses `git pull --ff-only`, so a commit
  made there will stop future deploys. If you need to change something to make it run,
  tell Tara so it goes in the repo.
- **Set `PLANNER_READONLY` on the 8127 service.** Everything will 403.

---

## Nothing to back up

The data is the Google Sheet, which has its own version history, and the app keeps an
append-only change log on the sheet's `History` tab. The server holds no state.

---

## When you're done, tell Tara

1. the two URLs
2. whether Cloudflare Access is on, and whether it passes the user-email header
3. whether the cron is in place

**Fuller detail is in `deploy/DEPLOY.md` in the repo** — environment variables, failure
messages and what they mean, and how to rotate the key. This page is the short version.

## One thing for later, if you're willing

Tara would rather the repo lived on your server than on GitHub. If you can put a
Cloudflare Tunnel in front of SSH, we can move it and drop the GitHub copy — the switch is
one command on her side, and `deploy/post-receive` is already written so a push would
deploy instantly instead of waiting for the cron. Not urgent.
