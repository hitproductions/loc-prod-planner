# IT handoff: update the local planner (28 Oct 2026)

Requested by Tara. Repository: https://github.com/hitproductions/loc-prod-planner

Update the server copy to the latest **`main`**. It must include the commit titled
**"Engineers cells: filled with the phase colour again, taller, names wrap to three lines"** (`10a95d5`), which also brings in everything after
the last handoff (`deploy/PHASE-DATES-UPDATE.md`): the schedule redesign (project names layered above scrolling bars and Due, 104px week columns, flush 36px Projects bars with a thin seam between lanes, roomier Engineers cells, dashed dividers between bookings, no Dub/Edit/Mix word on Engineers cells since the rail colour shows it), the Inter font, the
new calendar popup and a fix that let projects with a series be saved. `git log --oneline -10`
should list it. All of it is tested.

**Take the latest, not an older step.** Before `ea88165`, saving any project failed with
*"Sheets API 400: Range (Projects!AE2) exceeds grid limits"* once the Projects tab was 30
columns wide, which the live sheet is. An older copy will keep failing that way.

## What to do

1. On the server checkout, check for local changes, then pull:

   ```bash
   git status --short
   git fetch origin
   git merge --ff-only origin/main
   ```

   If the server has local commits, merge `origin/main` and resolve as usual.

2. **Rebuild and restart** both services (editing and read-only), the same way you
   deploy now. The Dockerfile did not change this time, but the app files did, so rebuild the
   image rather than only restarting the old one.

3. **Update every running copy together** (editing and read-only, and the Cloud Run
   copy if it is still pointed at the same sheet). The Cloud Run editing copy is already on
   this version.

4. If the server deploys with `deploy/redeploy.sh`, it now also runs
   `test/sheets_grid.test.js` before rebuilding. It needs no credentials and no network.

Nothing else changes: no new settings, no new credentials, same sheet, same
sign-in, same ports and paths. New static files are served alongside `app.js`: the font
folder `webapp/public/fonts/` (Inter, three `.woff2` files, served as `font/woff2`, plus its
licence). If a reverse proxy lists files explicitly, add them.

## What to expect on the sheet

The first save after the update may add more columns to the right edge of the **Projects**
tab, so the `Series` column fits. This is automatic. Do not add or delete columns by hand.
No existing column moves and no data changes.

## Check after the update

- The whole app uses the **Inter** font, on Mac and Windows alike.
- **Add project → the calendar button** opens a small calendar under the date box. It closes
  when a day is picked, on Escape, or on a click outside it. It no longer stays stuck open.
- Saving a project with a **Series** works (it used to fail with the grid-limits error).
- **Schedule → Projects**: each booking is its own bar. When a project has bookings side by
  side, the row grows and the bars stack instead of sharing one box. Bars fill their week cells edge to edge. Project names are regular
  weight; engineer names on bars are bold. A **3 at once** tag marks the busy week on that
  person's bar. **Due** sits in its deadline week, or inside the bar if a bar runs into it.
  Finished projects are folded under **Show N finished projects** at the bottom.
- **Schedule → Engineers**: week dates are black and readable; this week has a red bar and
  the words "This week"; show names wrap to two lines instead of being cut off; a 2 or 3 at
  once tag names the jobs when you hover over it. Only 3 at once is tinted.
- **Report**: below the selected month are two separate tables. **Work done by month** counts booked weeks in the month they actually happened (finished or not, future weeks excluded) with weeks per engineer. **Completed by month** counts projects in the month they were marked complete, with their booked weeks and late ones.
- Hovering darkens only the header (the engineer name in Projects, the week label in Engineers); cells are not tinted. Engineers cells are filled edge to edge with the phase colour, at least 64px tall, names wrap to three lines, no week count (hover for the full name, phase and week). Dub, Edit and Mix bars all carry the same thin edge in a darker shade of their own colour.
- **History** shows 25 entries a page, with Newer / Older buttons under the list. The filter searches the whole log, not just the page.
- The colour key above the schedule shows Dub, Edit, Mix, By hand and (in Projects) Due.
- Dragging a week to another engineer still works, in the Engineers view.

## If something goes wrong

Note the commit the server is on before pulling (`git rev-parse HEAD`). To roll back,
check that commit out again and restart. Columns the update added to the Projects tab can
stay; the older version ignores them, but an older version will fail to save projects with a
series (see above).
