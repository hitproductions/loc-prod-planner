# IT handoff: update the local planner (29 Oct 2026)

Requested by Tara. Repository: https://github.com/hitproductions/loc-prod-planner

Update the server copy to the latest **`main`**. It must include the merge titled
**"Merge pull request #12 from hitproductions/rudolf-limits"** (`70358bf`), which also brings
in everything after the last handoff (`deploy/SCHEDULE-READABILITY-UPDATE.md`): Google sign-in,
the new sign-in page, one link for engineers, and the 3-projects-at-once rule. The local copy
should also switch to the Google sign-in page: see **Turn on the new Google sign-in page**.
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

## Turn on the new Google sign-in page (requested by Tara)

The local copy should use the same sign-in as the Cloud Run copy: everyone signs in with their
own **@hitproductions.net** Google account, engineers get the read-only view on the same link,
and History records who made each change. It is off until the settings below are set.

**Before you start**

- The local copy must be reached at an **https** web address (for example through your reverse
  proxy). Google refuses sign-ins to plain addresses such as `http://192.168.x.x:8127`.
- If the local copy currently uses the Lokal WordPress sign-in (`PLANNER_SSO_SECRET` is set),
  tell Tara before turning Google on, so people are not asked to sign in twice.

**Steps**

1. **Send Tara the https address** of each service (editing, and read-only if you keep it).
   She adds `https://<address>/auth/google/callback` for each one to the Google sign-in client
   in the Google Cloud console. Sign-in fails with *redirect_uri_mismatch* until she has.
2. **Get the client secret from Tara** privately, through a password manager. Never by email,
   chat, or in the repository.
3. **Set these on both services** (editing and read-only), in the same place as the other
   `PLANNER_*` settings, e.g. the `environment:` block of `deploy/docker-compose.planner.yml`
   or an `.env` file it reads:

   | Setting | Value |
   |---|---|
   | `PLANNER_GOOGLE_CLIENT_ID` | `63803252709-9m03lkbc51eslcgu1vjs7lr5qk1ves12.apps.googleusercontent.com` |
   | `PLANNER_GOOGLE_CLIENT_SECRET` | the secret from step 2 |
   | `PLANNER_PUBLIC_URL` | the service's own https address, e.g. `https://planner.example.com` (no trailing slash) |

   `PLANNER_PUBLIC_URL` makes the callback address exact behind a proxy. If `PLANNER_PASSWORD`
   is set, remove it: Google sign-in replaces the shared password.
4. **Rebuild and restart** both services.

If the client ID is set without the secret, the app refuses everyone rather than opening up,
so set both together.

**Check**

- Open the address in a private window: only the camera-style **Sign in with Google** page shows.
- Your Hit account opens the full planner, with your name top right and **Logout**.
- An engineer's account (any address in the Engineers tab's `email` column) opens the
  read-only view on the same link.
- A personal Gmail is refused.
- Make a change, then open **History**: your name is in the **By** column.

## What to expect on the sheet

- **History tab:** a `by` column is added automatically on the first change after the update.
  It holds the signed-in person's email. Do not add or delete it by hand.
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

Check out the commit you noted before pulling and restart. The `by` column on the History tab
can stay; the older version ignores it.
