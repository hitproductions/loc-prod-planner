# IT handoff: update the local planner (29 Oct 2026)

Requested by Tara. Repository: https://github.com/hitproductions/loc-prod-planner

Update the server copy to the latest **`main`**. It must include the merge titled
**"Merge pull request #12 from hitproductions/rudolf-limits"** (`70358bf`), which also brings
in everything after the last handoff (`deploy/SCHEDULE-READABILITY-UPDATE.md`): Google sign-in,
the new sign-in page, one link for engineers, and the 3-projects-at-once rule. The local copy
**keeps the Lokal sign-in**: see **Sign-in on the local copy**. Pull the latest `main`, not
`70358bf` itself: later merges make the engineer read-only view work with the Lokal sign-in.
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

## Sign-in on the local copy (updated 30 Oct 2026)

The local copy **keeps the Lokal WordPress sign-in**. The Google sign-in is for the Cloud Run
copy only.

- **Do not set any `PLANNER_GOOGLE_*` setting on the local copy.** Lokal and Google sign-in
  cannot both be on: with both set, every save fails with *"Invalid CSRF token"*.
- **Leave the Lokal settings as they are** (`PLANNER_SSO_SECRET`, `PLANNER_SSO_LOGIN_URL`,
  `PLANNER_REQUIRE_SSO`) and any `PLANNER_PASSWORD`. Nothing about sign-in changes.

**One question for IT (please answer Tara):** when someone signs in through Lokal, is the
`login` in the planner's sign-in token their **@hitproductions.net email**?

- **If yes**, nothing more to do. Engineers (anyone whose email is in the Engineers tab's
  `email` column) get the read-only view on the main local link, and the server refuses any
  change they send.
- **If not**, add the person's email to the token as an `email` field, next to `login`, signed
  the same way. The planner uses `email` when it is there.
- Until one of those is true, engineers get full editing on the main link, exactly as today.
  Keep giving them the read-only service's link until then.

**Check**

- Sign in through Lokal as a planner: the full planner opens and saving works.
- Sign in as an engineer whose email is in the Engineers tab: the read-only view opens on the
  main link (once the question above is settled).
- Make a change, then open **History**: the **By** column shows who made it (their Lokal login).

## What to expect on the sheet

- **History tab:** a `by` column is added automatically on the first change after the update.
  It holds who made the change (the Lokal login locally, the email on Cloud Run). Do not add or
  delete it by hand.
- **Engineers tab:** Tara has already added an `email` column and set Mat's `overflow_only` to
  `Yes`. Leave both as they are. The `email` column decides who gets the read-only view.

## Check after the update

- **3 projects at once is normal.** Someone on 2 or 3 projects in the same week has no red
  outline and no overlap warning. Only a 4th project at once is flagged, and the tag says
  "4 at once". A show's dub, edit and mix with the same person count as one project.
- **Past weeks** on the schedule show faded phase colours: clearly past, but Dub, Edit and Mix
  still distinguishable. Projects whose deadline has passed are grey in the Projects list.
- **Analysis → Who is free, week by week:** the key reads "free / 1 project / 2 projects /
  3 projects / over 3", and the bottom rows are **Room for dub/edit** and **Room for Adv. mix**.
- **Mat** is listed as a reserve in Analysis, not as a regular dub/edit engineer.
- Adding or saving a project still works.

## If something goes wrong

Check out the commit you noted before pulling and restart. Sign-in settings were not changed,
so nothing else needs putting back. The `by` column on the History tab can stay; the older
version ignores it.
