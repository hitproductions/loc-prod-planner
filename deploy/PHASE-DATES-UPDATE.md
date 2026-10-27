# IT handoff: update the local planner (27 Oct 2026)

Requested by Tara. Repository: https://github.com/hitproductions/loc-prod-planner

Update the server copy to the latest **`main`**. It must include the pull request titled
**"Page improvements: this-week view, new Add project form, search and History filter"**
and the two after it, **"Series: keep the same people on a show"** and **"Layout fixes: Re-plan, Analysis, taller schedule boxes"**, which also bring in everything before them (per-phase dates, review fixes, overlapping
phases). `git log --oneline -8` should list it. All of it is tested.

**Take the latest, not an older step.** The first version has a bug that can erase a completed
project's bookings on a re-plan, and an older copy refuses date entries the new one accepts.

## What to do

1. On the server checkout, check for local changes, then pull:

   ```bash
   git status --short
   git fetch origin
   git merge --ff-only origin/main
   ```

   If the server has local commits, merge `origin/main` and resolve as usual.

2. **Rebuild and restart** both services (editing and read-only), the same way you
   deploy now. With the Docker setup, rebuild the image — the Dockerfile changed.

3. **Time zone.** The Dockerfile now sets `TZ=Asia/Manila`. If the server runs Node
   outside Docker, add `TZ=Asia/Manila` to its environment. Without it, "today", the
   current-week row and History timestamps follow the server clock.

4. **Update every running copy together** (editing and read-only, and the Cloud Run
   copy if it is still pointed at the same sheet). An old-version copy that saves a
   dated project leaves the dates stale.

Nothing else changes: no new settings, no new credentials, same sheet, same
sign-in, same ports and paths. Two new static files, `webapp/public/dates.js` and `titles.js`, are served
alongside `app.js`; if a reverse proxy lists files explicitly, add it.

## What to expect on the sheet

On the first project saved after the update, the app adds columns to the end of the
**Projects** tab: `Dub start`, `Dub end`, `Edit start`, `Edit end`, `Mix start`, `Mix end`
and `Series`. This is automatic. Do not add them by hand. People may type into `Series`
directly.

## Check after the update

- The **Add project** form shows a start and end date for Dub, Edit and Mix, instead
  of weeks per phase, and accepts overlapping phases (for example a mix that starts while the
  edit or dub is still running).
- The schedule opens on this week, with the weeks before it dimmed.
- The Projects list has a search box and a *Dates* column, and shows soonest deadlines first.
- The Add project form has a **Series** box; typing a show that exists lists its earlier
  projects and who did each phase.
- Saving a project adds the new columns to the Projects tab (first save only).
- Schedule boxes are taller and read like "Dub · wk 1/3"; a colour key sits above the grid.
- **Re-plan → Preview** shows a summary, the change list and a **Left alone** fold.
- **Analysis** opens with an OK/Tight/Short verdict and a week-by-week free grid.
- A new **History** entry shows the correct Manila time.

## If something goes wrong

Note the commit the server is on before pulling (`git rev-parse HEAD`). To roll back,
check that commit out again and restart. The six columns can stay on the sheet; the
older version ignores them.
