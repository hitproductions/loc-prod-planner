# Engineer Assignment — build handoff

**Internal — Hit Productions / HAIST. Contains client project names. Do not share externally.**

Prepared 2026-08-12 for whoever builds this in Claude Code.
Everything here has been validated against real 2026 tracker data in a working
n8n prototype. The prototype is being retired; the engine is not.

---

## 1. What this is

A scheduling tool for localization projects. Given a project's deadline and how
many weeks each phase needs, it plots the phases backward from the deadline and
assigns engineers to them, respecting a fixed set of studio rules.

**It replaces a manual process** where a director works out who is free and
writes assignments into a tracker by hand.

**It is not AI.** Every decision is deterministic. Same inputs always produce the
same plan, and any assignment can be traced to the rule that caused it. An
earlier version had an LLM narration layer; it was removed as not worth the cost.
Do not reintroduce one.

---

## 2. Users

Two people, both experts: the scheduling director, plus one dev/ops backup.
They know the projects, the engineers, and the process. Optimize for density and
speed, not onboarding. No tutorials, no wizards, no progressive disclosure.

---

## 3. Scope

**In scope for v1 — this is the whole thing, do not expand it:**

1. **Fast project entry** — the top priority. See §7.
2. A visual schedule view, colour-coded, covering all projects and engineers
3. Re-plan: recompute the unlocked book, show a diff, apply on confirmation
4. **Analysis view** — capacity, bottlenecks, balance, pipeline. See §7.

**Deferred, wanted later, do not build now:**

- **Drag-to-reassign.** Genuinely wanted, deprioritised behind entry and
  analysis. If built, it must reject an invalid drop rather than flag it
  afterwards, which means an HTML surface rather than native cell drag. Note
  that every dragged assignment becomes a manual pin (rules 11 and 14) and
  therefore locked against re-planning — so the UI must show how many
  assignments are pinned, or re-plan quietly stops being able to help.

**Explicitly out of scope:**

- Any AI, LLM, or natural-language input
- Slack integration of any kind
- Talent/actor scheduling — an external per-project director handles that
- QC scheduling — assumed to fit between mix-end and deadline
- Room or studio booking — that belongs to a different tool (Jessie)
- Multi-user concurrency handling — two people editing at once is not solved,
  and with two users it does not need to be yet

---

## 4. Data model

Three tables. Currently Google Sheets tabs; a real database is fine and probably
better, but keep the shape.

### Bookings — one row per phase assignment. The schedule itself.

| Column | Type | Notes |
|---|---|---|
| `project` | text | matches `Projects.project_title` |
| `phase` | text | `Dub` · `Edit` · `Mix` · `Dub+Edit` (shared) |
| `engineer` | text | matches `Engineers.name` |
| `start_date` | date | Monday of the first week |
| `end_date` | date | Sunday of the last week |
| `source` | text | `tracker` (historical) · `plot` (created) · `replan` |
| `note` | text | free text; may contain `FORCED OVERLAP`, `manual`, `special`, `shared phase` |
| `status` | text | blank/`active` or `superseded`. Superseded rows are history — never read them as live, never delete them |

### Engineers — the roster. Editable by the user, never hardcoded.

| Column | Values | Meaning |
|---|---|---|
| `name` | text | |
| `can_record` | Yes/No | |
| `can_edit` | Yes/No | |
| `can_mix` | Yes/No | |
| `mix_level` | `Advanced` · `Developing` · blank | |
| `music_specialist` | Yes/No | eligible for full duty on music projects |
| `overflow_only` | Yes/No | only used as a mixer when regular mixers are all busy |
| `non_netflix_router` | Yes/No | all non-Netflix work routes to this person |

Current roster is 8 engineers. The rules must read these flags, not names.
Adding or removing an engineer is a data edit, not a code change.

### Projects — one row per project, plus the assignment outcome.

`project_title`, `deadline`, `client`, `dub_weeks`, `edit_weeks`, `mix_weeks`,
`total_weeks`, `music_songs`, `mix_level_required`, `special_project`,
`recordist`, `mixer`, `warnings`, `source`, `submitted_by`, `submitted_at`

---

## 5. The engine — port as-is

`engine/assign.js`, `engine/replan.js`, `engine/stats.js` are plain JavaScript
with no framework and no n8n APIs. Pure functions in, plain objects out. They run
unchanged in a browser, in Node, or in a serverless function.

**Port them. Do not rewrite them.** They encode rules worked out against a year
of real scheduling data and validated against a known-good manual run. A rewrite
will silently lose edge cases — the shared-phase logic and the lock handling in
particular.

- `runAssign(project, bookingRows, engineerRows)` → assignment for one project
- `replan(projectRows, bookingRows, engineerRows, todayISO)` → full re-solve + diff
- `computeStats(bookingRows, engineerRows, todayISO)` → workload figures

They are currently CommonJS. Convert to ES modules if you like; change nothing else.

---

## 6. Rules the engine applies

In firing order. These came from the studio, not from us.

### Input
1. **Phase lengths are entered by hand.** No estimation. Zero is valid and means
   the phase doesn't exist for that project — no weeks plotted, nobody assigned.

### Plotting
2. Phases plot **backward from the deadline**. Mixing ends the week before the
   deadline's week; editing ends before mixing starts; dubbing ends before
   editing starts. Each phase is a contiguous block.
3. Projects are processed in **deadline order**, earliest first.

### Availability
4. Same week on two projects = unavailable, unless rule 9 or 11 applies.
5. **Same engineer records and edits by default.** May split across two people if
   that lowers the higher of the two resulting workloads. **Mixing is never split.**
6. Load = cumulative weeks assigned. Ties broken by who has gone longest since
   their last assignment; never-assigned outranks everyone.

### Hard rules
7. **Client routing:** non-Netflix work goes to the `non_netflix_router`
   engineer for record and edit. Nobody else is considered.
8. **Mix level:** a `Developing` mixer never mixes a project requiring
   `Advanced`. No exception in automatic assignment.
9. **Deadlines are never reported impossible.** If no single engineer, no split,
   and no shared pair works, force-assign the least disruptive already-busy
   person — smallest overlap, then lowest load, then longest gap — and flag the
   row `FORCED OVERLAP` naming who was double-booked and by how much.
   **Never do this silently.**
10. **Order of attempts matters and is not negotiable:** one engineer for both
    phases → split dub from edit → share a phase between two engineers → force an
    overlap. Sharing before forcing. Getting this order wrong produces overlaps
    that were avoidable.

### Manual control
11. **A manual engineer pick overrides every rule above, and is always flagged.**
    The engine still checks and reports: already booked those weeks, not normally
    in that role, client routing says otherwise, wrong mix level. The assignment
    goes through; the warning is displayed prominently. Silent double-booking is
    the one thing this tool must never do.
12. `special_project` is a flag for identification only. It does not change
    assignment behaviour.

### Re-planning
13. Re-planning **never moves dates** — deadlines are fixed by the client, so a
    re-solve only ever changes *who*.
14. **Locked and untouchable:** anything starting this week or earlier, and
    anything noted `manual` regardless of date. A human's choice is not undone by
    a re-solve.
15. Re-plan **shows a diff and does nothing until confirmed.** On confirm, old
    rows are marked `superseded` and new rows appended. Nothing is ever deleted.

---

## 7. UX requirements

The reason this is becoming an app rather than staying in chat is that the
output is a grid, and prose is a bad way to read a grid. Build accordingly.

### Entry speed is the first priority

Faster than any form: **the user types a row.** Two experts who already live in
spreadsheets do not want a wizard.

- Native data validation carries the load — dropdowns on Client, Mix level,
  Music and Special; the built-in date picker on Deadline. Nothing custom to
  build, and it is keyboard-native by default.
- **A checkbox column commits the row.** Without an explicit commit signal the
  engine fires while someone is still halfway through typing.
- Results write back into the same row — recordist, mixer, warnings. No dialog,
  nothing to dismiss.
- **Defaults do most of the typing:** Client `Netflix`, Mix level `Advanced`,
  Music `No`, Special `No`. Minimum real input is title, deadline, three numbers.
- Accept phases in one cell as `3/1/2` and split it. Three fewer columns to tab
  through, and it matches how the team says it aloud.
- **Errors go in a cell in that row**, never a popup. Fix, re-tick.
- **Batch entry must work** — paste twenty rows, tick them all, process in
  deadline order. This is how the historical book gets loaded, and how a quarter
  gets planned in one sitting.
- Re-ticking an existing row re-plots it. Supersede the old booking rows rather
  than overwriting, so a mis-tick is recoverable.

### The schedule view is the product

- **Rows are projects, columns are week ranges**, matching the existing 2026
  tracker so nobody learns a new format. Week headers in that tracker read
  `D 1-7`, `D 8-14`, `D 15-21`, `D 22-28`, `D 29 - J 4` — month initial plus day
  range. Match it.
- **Use the tracker's existing colours.** These are what the team already reads:

  | Phase | Hex |
  |---|---|
  | Dubbing | `#FFC000` amber |
  | Editing | `#BDD7EE` light blue |
  | Mixing | `#EA9999` pink |
  | Pre-prod kick off | `#92D050` green |
  | Final delivery / urgent | `#FF0000` red |

- A second view with the **same colours but engineers as rows** answers "who's
  free in November", which is the question actually asked most. Both views, one
  toggle.
- The engineer's name belongs in the cell on the project view, and the project
  name in the cell on the engineer view.

### Conflicts must be impossible to miss

- Forced overlaps, manual-override warnings and double-booked weeks get visual
  treatment that survives a glance — not a footnote, not a tooltip, not grey text.
- A plan with a forced overlap should look wrong before anyone reads a word.

### Density over decoration

- Two expert users. Show the whole quarter without scrolling if it fits. Small
  type is fine. Whitespace that costs a visible week is not.
- No modal dialogs for things that could be inline. No confirmation step on
  anything reversible.
- Keyboard entry for the project form: tab order, enter to submit, no mouse round trips.

### Naming and labels

- Label everything in the studio's own words — Dub, Edit, Mix, deadline,
  Advanced/Developing. No invented vocabulary, no abbreviations the team doesn't
  already use.
- Every screen should be self-explanatory to someone who knows the work and has
  never seen the tool.

### The analysis view

All of this is arithmetic — no AI, no inference. `stats.js` already produces most
of it. Group by the decision each answers, not by data type.

**Capacity — "can we take this job?"**

1. Weeks booked per engineer per quarter, as a heatmap. On the seeded data the
   Q3 2026 crush is immediately visible: all eight engineers at 8–9 weeks, then
   Q4 falling to between 1 and 8.
2. Booked versus available weeks across the roster, week by week. Saturated
   windows read as solid bands.
3. Free capacity **by role** — open record/edit weeks and open Advanced-mix
   weeks are different currencies and must not be added together.

**Bottleneck — "do we need to hire?"** *(highest value on this page)*

4. Demand versus eligible supply per week, split by role. Every unsolvable
   conflict in the validated data is a **mix** conflict, because mixing cannot be
   split between two people and only four engineers can do it at Advanced level.
   That is a staffing signal and it is fully computable.
5. Which engineer is most often the binding constraint.

**Balance — fairness and burnout**

6. Load spread across the roster, and whether it is widening.
7. Consecutive booked weeks per engineer — who has had no gap in three months.
8. Idle gaps.

**Plan quality — is the process working**

9. Forced overlaps and manual pins over time. Rising manual pins mean people are
   routing around the engine, which means a rule is wrong somewhere.
10. Standing answer to "how much would re-planning improve things right now."

**Pipeline — commercial planning**

11. Weeks by client, and how far ahead work is being entered.

Items 3 and 4 are the ones with money attached. "Can we take this Netflix job in
October" and "do we need a fifth Advanced mixer" are unanswered today. Everything
else on this page is supporting detail.

### Re-plan presentation

- Show the trade before anything changes: conflicts before and after, and how
  many assignments would move. Both numbers, always, in the same units.
- Diff as a table — project, phase, from, to. One row per change.
- Apply is one deliberate click, clearly labelled, and reversible via the
  superseded rows.

---

## 8. Stack — Google Sheets + Apps Script

**Preferred direction.** Not a hosted web app. The reasoning:

1. **No hosting, no domain, no certificates, no deploy pipeline, nothing to
   renew.** Nobody at Hit has volunteered to be on call for a deployed app, and
   that is the thing most likely to fail six months out.
2. **Auth is solved by Drive sharing.** Whoever can open the sheet can use the
   tool, restricted to Hit accounts. No login to build.
3. **The data lives where the team can read and repair it** without a developer.
4. **Colour-coded grids are native** — `setBackground()` gives real cell fills in
   the tracker's existing colours, not a CSS approximation.
5. **Version history and undo come free.** A regretted re-plan is a sheet restore.

Two surfaces, each doing what it is good at:

- **The sheet** — entry, the data, and the schedule grid. Style it properly:
  merged and frozen headers, banded rows, borders, hidden gridlines, spacer
  columns, conditional formatting. The existing tracker proves this can look
  designed.
- **An HTML view** via `showModalDialog` / `showSidebar` — the analysis page, and
  any reading view where layout matters. Full CSS control, still no hosting.
  A Hit Productions design guide exists; use it for this surface. Keep the
  sheet-side grid on the tracker's phase colours, which the team already reads.

Porting notes:

- Apps Script runs V8. Spread syntax, `Map`, `Set` and optional chaining all
  work. Strip `module.exports`, concatenate the three engine files, done.
- Use an **installable** `onEdit` trigger, not a simple one — simple triggers
  cannot call authorised services.
- Write engine output to **protected ranges** and validate on read. A sheet
  invites tampering: someone will sort a column or paste over a formula, and the
  tool must fail loudly rather than silently schedule from corrupted data.
- Use `clasp` if the devs want local files and git. The in-browser editor is
  workable but poor for review.
- Execution limits (6 minutes) are irrelevant at this data size — 24 projects
  across 60 weeks is roughly 1,400 cells.

If this later outgrows Sheets, the engine moves unchanged. Only the surface is
being chosen here, not the logic.

---

## 9. Acceptance criteria

Test against the seeded 24-project 2026 tracker data. These figures are verified.

1. **A dub-only project** — client not Netflix, 1/0/0 weeks — produces exactly
   one booking row (Dub), assigned to the `non_netflix_router` engineer, with no
   edit or mix row and no mixer named.
2. **Uneven phases** — 3/1/2 — plot correctly backward from the deadline with no
   gaps between phases.
3. **A manual pick of a Developing-level mixer on an Advanced project** goes
   through, and surfaces a warning naming the mix-level breach.
4. **A manual pick of someone already booked** goes through, and the warning
   states how many of those weeks they were already committed.
5. **Workload on the seeded data:** 8 engineers, 70 booking rows, 24 projects,
   load spread 7 weeks, busiest 18 weeks, quietest 11, mean 15.9.
6. **Re-plan on the seeded data as of 2026-08-12:** 12 rows locked, 58 movable,
   forced-overlap rows 4 → 2, 28 assignments changed.
7. **Re-plan late in the year (2026-11-20):** 56 locked, 14 movable, forced rows
   4 → 2, 11 changes.
8. **Both forced-overlap figures must count the same unit.** An earlier version
   compared rows against projects and overstated the improvement. If the before
   and after numbers are not directly comparable, the feature is wrong.
9. **Superseded rows are never read as live** and never deleted.
10. **Batch entry:** pasting the 24 historical projects and committing them all
    processes in deadline order and reproduces a book consistent with the
    validated run — 70 booking rows, 4 of them flagged as forced overlaps across
    2 projects.
11. **Analysis figures reconcile with the schedule view.** If the heatmap says
    Kyle has 16 weeks, counting his cells in the grid gives 16. Any figure that
    cannot be reproduced by counting is a bug, not a summary.
12. **Role capacity is never aggregated across roles.** Open record/edit weeks
    and open Advanced-mix weeks must be reported separately; summing them
    produces a number that is always wrong and always reassuring.

---

## 10. Known limitations, carried forward deliberately

1. **Fool Night cannot be scheduled without a forced overlap** by any version of
   the engine. It needs 4 dub + 3 edit — seven consecutive weeks on one person —
   in the busiest window of the year. No single engineer and no pair can cover
   it. This is a capacity fact, not a bug. Do not "fix" it.
2. **The re-planner is greedy, not optimal.** It replays in deadline order from a
   clean slate. It usually beats append-only but will not find the best possible
   allocation. A real optimizer is a different project and needs evidence that
   greedy is costing something.
3. **Order of entry changes the outcome.** Because projects are processed by
   deadline, adding a project can produce a different plan than the same set
   entered in a different sequence. Re-planning is the answer to this.
4. **No concurrency control.** Two people applying a re-plan simultaneously will
   corrupt the book. Fine for two users; solve it before a third.

---

## 11. History worth knowing

- An LLM-based phase-length estimator was built and removed the same day. It
  could not reproduce two of the 24 known projects, and needed a demonstrably
  wrong talent count to reproduce a third. Human judgment replaced it. Do not
  rebuild it without real script-derived data.
- A Slack-based version exists and works. It is being retired because a grid
  beats prose for this audience, and because the AI layer was not earning its
  cost.
- This tool deliberately sits outside Project Jessie. Jessie's scope is booking
  only, and adding tools to her agent degrades her accuracy on that job.
