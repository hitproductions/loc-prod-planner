# IT handoff: update the local planner (21 Oct 2026)

Requested by Tara. Repository: https://github.com/hitproductions/loc-prod-planner

Update the server copy to the latest **`main`**, which must include **pull request #5**
("Allow all phases to overlap"; it includes #2, #3 and #4). `git log --oneline -5` should
list it. All are tested.

**Take the latest, not just #2.** #2 alone has bugs that can erase a completed project's
bookings on a re-plan (fixed in #3). The Add project form's date rules changed in #4 and
#5: any phase may overlap any other, so an older copy refuses entries the new one accepts.

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
sign-in, same ports and paths.

## What to expect on the sheet

On the first project saved after the update, the app adds six columns to the end of
the **Projects** tab: `Dub start`, `Dub end`, `Edit start`, `Edit end`, `Mix start`,
`Mix end`. This is automatic. Do not add them by hand.

## Check after the update

- The **Add project** form shows a start and end date for Dub, Edit and Mix, instead
  of weeks per phase, and accepts overlapping phases (for example a mix that starts while the
  edit or dub is still running).
- Saving a project adds the six columns to the Projects tab (first save only).
- A new **History** entry shows the correct Manila time.

## If something goes wrong

Note the commit the server is on before pulling (`git rev-parse HEAD`). To roll back,
check that commit out again and restart. The six columns can stay on the sheet; the
older version ignores them.
