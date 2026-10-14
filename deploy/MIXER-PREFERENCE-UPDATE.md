# IT handoff: Advanced-first mixing

Requested by Tara on 2026-10-14. Repository: https://github.com/hitproductions/loc-prod-planner

Change branch: `codex/advanced-first-mixing` (based on `73f07bb`).

## Behavior

For ordinary automatic mixing, choose a free eligible Advanced mixer first, then a
free eligible Developing mixer if the project permits Developing-level work, then
the overflow reserve. Force overlap only when no eligible free option covers the
mix. Developing mixers remain barred from Advanced-required work unless selected
manually. This applies to new assignments and re-planning.

The optimizer now prefers fewer automatic ordinary Developing mix weeks, after
overlap protection and reserve use, before workload balancing. Reserve usage was
moved ahead of workload balancing so the solver cannot spend the reserve merely
to avoid assigning a Developing mixer. This is a soft preference: preventing
overlap is still more important.

Music keeps its specialist eligibility and rank rules. Atmos keeps its room
requirement; the optimizer's move/swap eligibility now checks the room as well.
Manual picks, locked projects, and work already underway retain their existing
protection. There is no named Jek rule and no new recording priority. Jek should
be more available to record because ordinary mixing prefers Advanced engineers.

## Files to bring into the server copy

| File | Change |
|---|---|
| `appsscript/00_Engine_Assign.gs` | Advanced-first assignment ladder |
| `appsscript/01_Engine_Replan.gs` | Matching re-plan ladder, including regular Developing fallback |
| `appsscript/11_Wrapper.gs` | Mix preference score, project context for music exclusion, Atmos check for optimizer moves |
| `appsscript/20_Config.gs` | Ranked objective: overlaps, reserve use, mixer preference, then balancing |
| `webapp/actions.js` | Matching preview scores and readable explanation for the new objective |
| `test/engine_drift.test.js` | Records the approved engine policy change |
| `test/wrapper.test.js` | Assignment, re-plan, fallback, optimizer, manual, music and Atmos regression checks |
| `test/webapp.test.js` | Stable explicit drag fixtures independent of the scheduling policy |
| `README.md` | Updated mixing policy |
| `deploy/MIXER-PREFERENCE-UPDATE.md` | This handoff |

The Node app evaluates the `.gs` files through `core/engine.js`. The files under
`engine/` are historical handoff references and are not the running Node scheduler.
No Google Apps Script deployment is needed to update the Node server.

## Apply on the local server

Review the pull request and the server checkout's local changes first. Use the
existing Git workflow to bring in this branch or the merged pull request. For a
clean checkout on the same history, from the repository root:

```bash
git status --short
git fetch origin
git merge --ff-only origin/codex/advanced-first-mixing
```

If the server has local commits, use the implementation commit from the pull
request with `git cherry-pick` and resolve any conflicts before deployment. Keep
the existing server configuration, credentials, environment and deployment paths.

Run the four offline suites:

```bash
node test/engine_drift.test.js
node test/wrapper.test.js
node test/webapp.test.js
node test/io_roundtrips.test.js
```

Verified locally: 28 + 208 + 248 + 36 = **520 passing checks, zero failures**.
The new policy tests cover both initial assignment and raw/complete re-plan,
Advanced preference despite workload balance, Developing fallback before reserve,
Advanced-level exclusion, forced overlap eligibility, manual and pinned choices,
music ranks, and Atmos restrictions in the optimizer. No production spreadsheet
was modified, and no server or Docker deployment was performed here.

If the server uses the supplied Docker Compose file, rebuild/recreate both copies
(a plain restart would keep the old source in the Docker image):

```bash
docker compose -f deploy/docker-compose.planner.yml up -d --build planner planner-view
docker compose -f deploy/docker-compose.planner.yml logs --tail=50 planner planner-view
```

If the deployment uses a different Compose file or service names, run the same
rebuild using its existing configuration. If Node runs directly under a process
manager, restart both the editing and view-only processes using their current
environment. There are no new dependencies or environment variables.

Check `/api/health` on each running instance, then use **Check availability** on a
Developing-level project where an Advanced mixer is free. It should choose the
Advanced mixer. Test a case with all eligible Advanced mixers busy: an available
Developing mixer should be chosen before the reserve.

## Existing schedule

Deployment alone does not rewrite bookings. To apply the new preference to
existing future assignments, Tara should open **Re-plan**, preview the proposed
changes, and apply only after reviewing them. Work already underway, manual rows
and locked projects remain protected. The Engineers sheet needs no changes:
Jek keeps `can_mix = Yes` and `mix_level = Developing`.
