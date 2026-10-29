# IT handoff: update the local planner (29 Oct 2026)

Requested by Tara. Repository: https://github.com/hitproductions/loc-prod-planner

Update the server copy to the latest **`main`**. It must include the merge titled
**"Merge pull request #12 from hitproductions/rudolf-limits"** (`70358bf`), which also brings
in everything after the last handoff (`deploy/SCHEDULE-READABILITY-UPDATE.md`): Google sign-in,
the new sign-in page, one link for engineers, and the 3-projects-at-once rule.
`git log --oneline -10` should list it. All of it is tested.

## What to do

1. On the server checkout, check for local changes, then pull:

   ```bash
   git status --short
   git rev-parse HEAD
   git fetch origin
   git merge --ff-only origin/main
   ```

   Keep the `git rev-parse HEAD` output for a rollback. If the server has local commits, merge
   `origin/main` and resolve as usual.

2. **Rebuild and restart** both services (editing and read-only), the same way you deploy now.
   App files changed, so rebuild the image rather than only restarting the old one.

3. **Update every running copy together.** The Cloud Run editing copy is already on this
   version.

## What does NOT change on the local copy

- **No sign-in is added.** Google sign-in only switches on when `PLANNER_GOOGLE_CLIENT_ID` is
  set, and the local copy does not set it. Do not add it. A local copy that uses
  `PLANNER_PASSWORD` keeps working exactly as before.
- No new settings, no new credentials, same sheet, same ports and paths.
- The local read-only service (`PLANNER_READONLY=1`) works as before.

New files: `webapp/google.js` (the sign-in code, unused locally) and
`webapp/public/login/` (the sign-in page's logo and artwork). If a reverse proxy lists files
explicitly, add the folder. Nothing else needs it locally.

## What to expect on the sheet

- **History tab:** a `by` column is added automatically on the first change after the update.
  On the Cloud Run copy it holds the person's email. On the local copy it stays blank,
  because nobody signs in there. Do not add or delete it by hand.
- **Engineers tab:** Tara has already added an `email` column and set Mat's `overflow_only` to
  `Yes`. Leave both as they are. The `email` column only matters on the Cloud Run copy.

## Check after the update

- **3 projects at once is normal.** Someone on 2 or 3 projects in the same week has no red
  outline and no overlap warning. Only a 4th project at once is flagged, and the tag says
  "4 at once". A show's dub, edit and mix with the same person count as one project.
- **Past weeks** on the schedule show faded phase colours: clearly past, but Dub, Edit and Mix
  still distinguishable. Projects whose deadline has passed are grey in the Projects list.
- **Analysis → Who is free, week by week:** the key reads "free / 1 project / 2 projects /
  3 projects / over 3", and the bottom rows are **Room for dub/edit** and **Room for Adv. mix**.
- **Mat** is listed as a reserve in Analysis, not as a regular dub/edit engineer.
- Adding or saving a project still works, and the app opens without a sign-in page.

## If something goes wrong

Check out the commit you noted before pulling and restart. The `by` column on the History tab
can stay; the older version ignores it.
