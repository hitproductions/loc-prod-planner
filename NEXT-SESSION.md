# Context for the next session (written 28 Oct 2026)

Read this first. It carries over a long session that had to be restarted because screenshots
stopped coming through ("media omitted: invalid or exceeds size limit"), for the user's
images and for the assistant's own.

## Where things stand

- Repo `main` is at `412b040` (plus this file, uncommitted). Everything below is committed and pushed.
- Live on Cloud Run (project `loc-prod-planner`, region `asia-southeast1`):
  - editing site `planner` → revision `planner-00021-t7q`
  - read-only engineer site `planner-view` → revision `planner-view-00014-vjb`
- All test suites pass: wrapper 285, webapp 389, engine_drift 30, io_roundtrips 36, sheets_grid 7.

## Deploying: do it this way or Tara gets locked out

Both services run **public behind the app's shared-password gate**. Always deploy with:

```bash
PLANNER_PASSWORD=<same password as now> ./deploy/cloudrun.sh --public          # editing site
PLANNER_PASSWORD=<same password as now> ./deploy/cloudrun.sh --public --view   # engineer site
```

A plain `./deploy/cloudrun.sh` makes the site private (IAM) and locks Tara out; that happened
once on 27 Oct. Ask Tara for the password, or read it from the current revision's env with
`gcloud run revisions describe planner-00021-t7q ... --format=json`. Never commit it.
After deploying, the site should answer HTTP 401 ("Not signed in") when signed out.

## The open request (not started)

Tara, about the **Projects view** of the Schedule:
1. "Still too cramped."
2. "Engineer boxes in projects views need to be flashed. Floating is weird." Probably means
   **flush**: bars fill their week cells edge to edge, with no white gap around them. Not confirmed.
3. Then deploy both sites, then update the IT note.

Before changing anything, confirm with Tara:
- does "flashed" mean flush?
- which part is cramped: row height, column width, or text too close to bar edges?

Current Projects-grid geometry (`webapp/public/app.css`, the "Projects grid: lanes" block):
`--colw:104px; --laneh:32px; --lpad:6px`. Bars are inset 3px on each side
(`.lbar{left:calc(var(--c0) * var(--colw) + 3px); width:calc(var(--n) * var(--colw) - 6px)}`),
are 26px tall (`--laneh - 6px`), and rows are `lanes * 32 + 6` px.

## Also outstanding

- The IT note `deploy/SCHEDULE-READABILITY-UPDATE.md` still names commit `a1e78f1`. It needs
  the latest commit and today's later changes added (project names layered above scrolling bars and
  Due; week columns 104px; whatever the next change is).
- `mockups/` is untracked (mockup HTML/PNG files and the scripts that make them). Tara hasn't
  decided whether to commit it.

## Decisions Tara has made (keep them)

- Brand: flat, radius 0, black/white/red `#EF4123`; phase colours Dub `#FFC000`, Edit `#BDD7EE`, Mix `#EA9999`.
- Font: Inter, served locally from `webapp/public/fonts/`.
- One bold role per view: engineer names on Projects bars; show names in the Engineers view.
- Overlaps are counted in JOBS: one person's dub + edit on the same project in the same week is
  ONE job. The "2 at once" tag lists the jobs on hover; she chose to keep this rule (27–28 Oct).
- Projects view: each booking in its own lane; "3 at once" is a tag only (no tint); "Due" is
  centred in its week, or inside the bar when a bar runs into the deadline week.
- Engineers view: only 3 at once is tinted; 2 at once is a tag only; no overlap entries in the legend.
- Drag-to-reassign stays in the Engineers view only (it never existed in the Projects view).

## Working notes

- `test/webapp.test.js` (~90s) and `test/wrapper.test.js` (~60s) outlast the 30s command
  limit. Start them with `nohup node test/X.test.js > /tmp/X.log 2>&1 < /dev/null &` and poll
  the log for the `N passed, M failed` line.
- To see the real layout without screenshots: start Chrome headless with
  `--remote-debugging-port=9333` and measure positions over the DevTools protocol (Node's
  built-in `WebSocket`). For overlaps, check every text element against every other, at several
  scroll positions, including the sticky project-name column. Missing that column is how the
  first Due fix failed.
- Live data, read-only: POST the password to `/login` for a cookie, then GET `/api/schedule?mode=project`.
