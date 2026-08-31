# Loc Prod Planner — handoff

**Internal — Hit Productions / HAIST. Contains client project names. Do not share externally.**

Written 2026-08-13, revised 2026-08-15. This supersedes the original build brief,
kept as `HANDOFF_original.md`; where they disagree, this document is later. An
interim addendum existed and has been removed — everything load-bearing from it is
folded in here.

A scheduling tool for Hit Productions' Netflix localization work: you enter a
project's deadline and how many weeks of dub, edit and mix it needs, and it
decides who does each phase and when, without double-booking anyone.

---

## 1. What it is, physically

An **Apps Script web app** bound to a Google Sheet.

- The **sheet** is the database — four tabs, readable and repairable by hand.
- The **web app** (`doGet` → `Index.html`) is the interface. Four views:
  - **Projects** — the master list. Sort toggle: deadline (default) or A–Z, with
    numeric collation so "Eps 3-4" precedes "Eps 11-12". Per-row Lock button, and a
    left edge marker on locked rows.
  - **Schedule** — two orientations, deliberately. Projects mode runs weeks ACROSS.
    Engineers mode runs weeks DOWN with one column per person: its cells hold project
    names, so the week columns widened to fit them and the table reached **7,749px,
    5.2x the screen** — seeing one year meant five screens of sideways scrolling.
    Transposed it is ~1,266px and scrolls vertically, and a single row answers "who is
    free that week". The transpose happens in the client; `apiSchedule` still returns
    `cells[label][week]` for both modes, so its contract and tests are untouched.
    Optional quarter-to-quarter range; clipping also drops projects with no work in
    range (but keeps every engineer, since an empty row there means free all quarter).
  - **Analysis** — two sections: can we take work, who is overloaded. See §10.
  - **Re-plan** — §8.
- The **sheet menu** (`Engineer Assignment`) holds diagnostics and admin actions.

The distinction matters operationally: **menu code runs the latest pushed script
immediately**, while the **web app serves a published deployment version**. A
`clasp push` reaches the menu at once and the app not at all until someone does
Deploy → Manage deployments → New version. Several hours were lost to this;
if a fix seems not to have landed, check that first.

### Deploying

```
cd appsscript && clasp push --force
```

`--force` overwrites the whole manifest, which is why `appsscript.json` carries
its `webapp` block in source. It was once written only by the Deploy UI, and a
forced push silently stripped it — after which `doGet` was unreachable and the
menu's URL lookup returned null while insisting the app wasn't deployed.

A push updates what the **menu** runs immediately, but the web app serves a
**published version**. To ship a change without breaking anyone's bookmark:

```
clasp create-version "what changed"
clasp redeploy <deploymentId> --versionNumber <n>
```

The URL belongs to the **deployment**, not the version, so `redeploy` keeps it.
"New deployment" mints a new URL and orphans the bookmark — reach for it only when
you actually want a second, parallel app. `clasp list-deployments` shows which id is
which; the one pinned to a number is the live app, the `@HEAD` one is scratch.

---

## 2. The data model

### Projects tab — the master list

Columns 1–10 are yours, 11–19 the engine writes, 20 is yours again:

| | |
|---|---|
| 1–7 | Project, Client, Deadline, Phases D/E/M, Mix level, Music, Special |
| 8–10 | Recordist pick, Editor pick, Mixer pick — `Auto` or a name |
| 11–19 | Dub/Edit/Mix wks, Recordist, Editor, Mixer, Warnings, Notes, **Plotted** |
| 20 | **Locked** — a checkbox; re-plan skips this project entirely |

`Locked` sits *after* the engine block rather than beside the other inputs
specifically so adding it did not shift any existing column. Inserting one
mid-table costs a full re-paste of every row.

`Plotted` is the date a project was last plotted. Its code name is `P_COL.PLOTTED`;
it was called `COMMITTED` until 2026-08-13, a leftover from a Commit checkbox that
no longer exists.

### Bookings tab — the schedule itself

One row per contiguous block: `project, phase, engineer, start_date, end_date,
source, note, status`. Weeks run Monday–Sunday.

**Rows are never deleted.** Superseding sets `status = superseded`, and superseded
rows are never read as live. The one exception is the build-only wipe (§7).

**The Schedule view is drawn from this tab, not from Projects.** That has a
consequence worth internalising: deleting a project's row by hand leaves its
bookings behind, and it keeps rendering on the schedule with no way to select it.
See `Clear ghost projects` in §7.

**`project` is the join key — the title string itself. There is no ID.**
`orphanProjects_` matches `b.project` against the titles in Projects, so *renaming a
project in the sheet orphans every one of its bookings at once*. The symptom is
alarming and the data is fine: detection is read-only, and the cleanup only marks
rows superseded.

**Drag-to-reassign writes here, and that is the whole reason it behaves as it does.**
The Engineers view lets you drag one week of one phase to another engineer
(`apiReassignWeek`). The unit is the week because that is what the view shows; the
write is row surgery — supersede the run, write back up to three pieces — and never
touches the engine.

It has to live in Bookings because the Projects tab **cannot express it**: its three
pick columns are per-phase, so there is no cell that says "this person, this week".
That single fact decides the rest of the feature:

- A **re-plan** honors it — the moved row is noted `manual / moved by hand`, and
  `isLocked` skips anything matching `/manual/i`.
- A **re-plot** destroys it, because `apiSaveProject` rebuilds from the project row
  alone. Only that project, only when someone deliberately saves it. The form warns
  first and names the weeks at stake.
- Everything else is safe: `plotAllUnplotted` only takes rows with no Plotted stamp,
  and the lock toggle never re-plots.

That was measured against every supersede path rather than assumed. If the loss ever
becomes a real problem, the fix is to have `apiSaveProject` supersede only the
non-manual rows and reconcile the generated ones in the wrapper — the engine still
does not need to change.

**Renaming through the web app is safe and is the only supported way.**
`apiSaveProject` carries `original_title`, supersedes the bookings under both names,
rewrites the title cell and re-plots. A sheet-side rename bypasses all of that.

`Relink a renamed project` (§7) is the undo. It moves **live rows only** — superseded
rows are history and belong to the name they were booked under — in a single batched
write, and it is its own inverse. Do **not** reach for `Clear ghost projects`, which
supersedes exactly the rows worth keeping and forces a re-plot that will not
reproduce the same assignments. That is why relink sits *above* clear in the menu: a
renamed project and a deleted one present identically, and only one of the two fixes
is recoverable.

A stable `project_id` column is the real fix and was considered on 2026-08-15. It
was declined as too large a change this close to go-live: it touches the schema,
every read/write path, both engines and the whole test suite, and needs the existing
book migrated. If titles ever start changing routinely, that is the thing to build.

### Engineers tab — the roster

`name, can_record, can_edit, can_mix, mix_level, music_specialist, overflow_only,
does_specials`.

- **`does_specials`** (Kyle) — replaced `non_netflix_router` on 2026-08-13. Routing
  now keys off the project's own **Special** flag rather than the client name, since
  non-Netflix work *is* the special work. A non-Netflix project left unflagged goes
  to the regular pool.
- **`overflow_only`** (Daryl) — the reserve. Spent last, never balanced against the
  regular six. But he is also the **rank-1 music specialist**, and music projects are
  legitimately his first-choice work: most of his weeks are the two music titles, and
  that is correct. Do not "fix" it — excluding him was measured and made the schedule
  worse on two metrics.
- **`music_specialist`** is an **order, not a yes/no** (2026-08-15). `1` = first
  choice (Daryl), `2` = second (Josiah). `Yes` still parses as rank 1, so a roster
  nobody has migrated keeps working. Anything else — blank, `No`, `0` — means not a
  specialist. See §3.

  Its cell rule is a **convenience dropdown that allows anything**, deliberately: a
  strict list would reject a legacy `Yes` and would block a third specialist without
  a code change. The cost is that a typo cannot be caught at entry, so
  `rosterProblems()` catches it instead — including the case nobody would notice,
  **zero ranked specialists**, which silently routes music like ordinary work.

  This column was a Yes/No dropdown until the rank landed, so typing `1` was marked
  invalid. If red flags appear after a rules change, run **Admin → Refresh engineer
  dropdowns**, *not* Set up sheets — the latter clears the Projects tab.
- **`mix_level`** must read `Advanced` or `Developing`. It is canonicalised on read,
  because the engine compares it case-sensitively while every other flag is
  case-insensitive — `advanced` once took Kyle from 15 mix weeks to **zero** while
  he appeared completely free. Unrecognised values are reported, not guessed at.

---

## 3. How assignment works

Phases are plotted **backward from the deadline**, contiguous, no gaps: mix ends
the week before the deadline week, edit before mix, dub before edit. Dates are
never negotiable — only *who* is.

For record/edit, in order:

1. **Divide the dub** between engineers, week by week, keeping the edit whole.
2. One engineer takes the whole block.
3. Dub to one, edit to another.
4. **Force an overlap** — deliberately double-book, and say so.

Dividing the dub comes first because each dub week is its own recording block,
whereas editing wants continuity within a title. Whether a given project's dub is
actually divided is decided **per project, by measuring the finished plan** — the
solver tries it both ways and keeps whichever scores better. Dividing everywhere
was measured and is worse: more small pieces fragment every calendar.

Mixing is never split. Rule 8 is one-directional — a Developing mixer never takes
an Advanced project, but an Advanced mixer may take easier work, with the
Developing mixer getting first refusal.

### Music titles

A project flagged **Music/Songs = Yes** is assigned from the music specialists and
**only** from them, for every phase including the mix. If they cannot cover it the
engine forces an overlap *among them* rather than reaching outside.

This replaced a pool that was **widened** by the specialists rather than replaced by
them — they were concatenated onto the ordinary record/edit pool, so the engine
remained free to pick someone with no music expertise, and on a re-plan it did. That
was a reported bug, not a tuning question.

Rank is a **tiebreak inside the ladder, not a narrower pool**. Daryl is preferred
wherever he is free; Josiah takes what is left, and the dub and the edit may be split
between the two of them. An earlier attempt made rank a pool filter — take the whole
block from the first tier, else drop to the second — which meant that if Daryl could
not cover the *entire* block it went to Josiah wholesale. A share between them is
usually the better answer.

The rule costs something and the cost is accepted: overloaded weeks 2 → 3, spread
2 → 3, longest run 14 → 16. None of the overloads are music titles. The mechanism is
indirect — a reserve committed to music is a reserve that cannot absorb overflow.

### The order search

The engine is **greedy with no backtracking**: it assigns each project against
whatever is already booked and never revisits. So the order projects are processed
in changes the outcome — and since every project's dates come from its own
deadline, order changes *only who*, never a single date.

`plotBatch` therefore runs the same engine under **202 seeded orderings** and keeps
the best plan. Deadline order is always tried first and only replaced by something
strictly better, so it can never do worse. The seed is fixed: same inputs, same
plan, always.

This is why **the first solve must be a batch**. Plotting project-by-project is
plain greedy, and the early projects land on an empty book where every candidate
ties and the alphabetically-first name wins. That is how a mix ended up on Josiah
while Kyle sat free. Measured: incremental gives 9 overloaded weeks, one batch
solve gives 2.

---

## 4. The objective — this is the whole policy

**The engine can now tell two-at-once from three-at-once (2026-08-31).** Both apps have
shown them differently since the lead asked for it — two is a blue warning, three is red
and must be reassigned — but the ENGINE could not: `dbl()` counted any week with more
than one booking, so a week holding three scored exactly like a week holding two, and
the search would create a three to avoid two twos.

Four terms, ranked directly under the reserve rule:

| term | what it is |
|---|---|
| `three_deep_weeks` | how many weeks need a reassignment — each is a separate intervention |
| `deepest_week` | among equals, nobody stacked deeper |
| `three_deep` | total overflow ABOVE two, so a six-deep costs four |
| `max_three_deep` | don't concentrate what remains on one person |

**Her live book does not change: it has no three-deep weeks at all.** This is preventive.
Measured on stressed books — the real slate doubled and tripled on the same roster,
plotted 3-4 projects at a time:

| load | before | after |
|---|---|---|
| 2x, batch 3 | 17 weeks at 3+, deepest 5 | **12**, deepest 5 |
| 2x, batch 4 | 16, deepest 5 | **15**, deepest 6 |
| 3x, batch 3 | 33, deepest 10 | **29**, deepest 10 |
| 3x, batch 4 | 35, deepest 10 | **32**, deepest 11 |

Two-deep weeks go UP in every case — 29 to 39 in the first row. That is the trade the
lead asked for in words, and it is worth being explicit that it is a trade.

**The open question is `deepest`, which gets one worse in the batch-4 cases.** Ranking
the total overflow first instead caps depth (5 stays 5, 10 stays 10) but produces MORE
weeks at three-plus than doing nothing at all — 18 against a baseline of 16. So the
shipped ranking minimises the NUMBER of interventions and accepts that one week can go
a little deeper. If that is the wrong way round for a real busy quarter, swap
`three_deep` above `three_deep_weeks` in `SOLVE_OBJECTIVE`; both terms already exist and
the tests cover both orderings.

**Two test bugs came out of this, both found by sabotage.** `SOLVE_OBJECTIVE.indexOf(k) <
indexOf(other)` passes when the term is ABSENT, because indexOf returns -1 — so removing
the term from the objective entirely broke nothing. And a term named in the objective but
missing from `scorePlan` would rank `undefined` against `undefined` and do nothing
silently; a typo in the name is now caught for every term. There is also a check that
every objective term has a plain-English name, because `whyBetter` falls back to the raw
key and would otherwise show a person "three_deep_weeks" in the sentence explaining a
re-plan.

**`forced_projects` was fixed on 2026-08-31 and the fix barely changes the schedule.**
Worth recording, because the number looked alarming and the consequence did not.

It counted the FORCED note, which records what the engine decided at the moment it
decided it. A project placed cleanly and then overlapped by somebody else's later
placement never gets a note, so on the live book the term read **1** against a true
**4**. It now counts from the weeks, like every other overlap figure in both apps.

Judged on incremental use — 3-4 projects at a time, plotted on top of what is already
booked, which is how this tool is actually worked — across batch sizes 2 to 6:

| batch | before | after |
|---|---|---|
| 2 | 6 overlapped weeks, 5 projects, spread 5 | identical |
| 3 | 6 weeks, **6 projects**, spread **3** | 6 weeks, **5 projects**, spread **4** |
| 4 | 5 weeks, 8 projects, spread 5 | identical |
| 5 | 3 weeks, 6 projects, spread 2 | identical |
| 6 | 4 weeks, 3 projects, spread 1 | identical |

Four of five batch sizes produce the same plan. At batch 3 it trades one compromised
project for one week of spread — which is exactly what the ranked objective says to do,
since `forced_projects` sits above `regular_spread`.

**So this is a truth fix, not a quality fix, and the truth mattered somewhere specific:**
the re-plan preview reports this term to the user as "projects the engine had to
compromise on" (`TERM_NAMES` in `webapp/actions.js`). That sentence was under-reporting
by four times in the one place a person reads it to decide whether to accept a re-plan.

`scorePlan` lives in `11_Wrapper.gs`, which is NOT in the drift-compared set (only
`00`/`01`/`02` are), so this needed no `REWRITTEN` declaration. The term had no test
coverage at all before this.

```js
var SOLVE_OBJECTIVE = [
  'reserve_double_booked',   // never double-book the reserve
  'total_double_booked',     // then the fewest overloaded engineer-weeks anywhere
  'max_double_booked',       // then don't concentrate what remains on one person
  'forced_projects',         // then fewest projects compromised
  'regular_spread',          // then flattest load across the regular pool
  'max_consecutive',         // then prefer handing off, all else equal
  'reserve_weeks',           // then spend as little of the reserve as possible
  'regular_peak',            // then the lowest peak in the regular pool
];
```

Reorder this list to change the policy. Nothing else needs touching. The search
optimises whatever ranks highest, faithfully, and anything ranked low is traded
away without comment.

**Overlap ranks first, and the reason is the most important thing in this
document.** The list previously ranked `max_consecutive` second, presented as
burnout protection. That was wrong: `max_consecutive` counts weeks with *any*
work, so it penalised continuous employment, while an **overlap is the actual
overload** — two projects in one week. Tara's correction, 2026-08-13.

Measured on the seeded book:

| | overloaded weeks | spread across | longest run |
|---|---|---|---|
| burnout ranked 2nd | 6 | **four people** | 9 |
| overlap ranked 1st | **2** | **one person** | 14 |

And the 14-week runs contain **zero** overloaded weeks — fourteen weeks of one
project at a time, which is simply a job. The shorter runs in the old plan were
idle gaps, which bought nobody anything.

If a real strain metric is ever wanted it is **consecutive doubled weeks**, not
consecutive booked weeks.

**Nothing was added to this list on 2026-08-15. Three terms were tried and all three
withdrawn**, and the pattern behind that is worth more than any of them:

- **`idle_regular_months`** — fewest people with a whole month of nothing. Removed: it
  reads as harmless but the `divide_dub` tuner optimises against the whole objective,
  so it split projects to move the figure by one. More splitting in all five scenarios
  tried; its supposed benefit on overloads was noise.
- **`split_phases`** — fewest phases held by more than one engineer. Added to stop the
  solver breaking ties badly, and **removed the same day**: measured in the real
  workflow it cut divided dubs from 6 to 2 and pushed forced overlaps UP. Dividing a
  dub is the cheap alternative to double-booking someone; discouraging it drives the
  solver toward the expensive answer. Tara caught this from the grid.
- **`DIVIDE_WHEN_FREE`** — the lean-season rules, see below.

**The lesson, which cost most of a day: a single fixture scenario is not evidence.**
Every one of these was justified with figures from one book, and every figure
evaporated under a second and third scenario. Measure any change to `SOLVE_OBJECTIVE`
across several seed-and-chunk combinations, and against **incremental use**, before
believing it — the noise between runs is larger than most effects being chased.

**Discretionary splitting predates all of this and was NOT touched.** The tuner tries
each project divided and whole and keeps whichever measures better, so a dub can be
shared by two engineers with the edit going to a third. v46 and the current build
produce identical output here. If it is ever unwanted the lever is `tuneDivision`, not
the objective: turning it off cuts splits from 12 to 4 on the seeded book, costing one
overloaded week and one forced project. Measured, not done.

### Re-plan is allowed to decline

**Re-plan never proposes a schedule worse than the one you have** (fixed 2026-08-15).
Its `baseline` used to be its own first attempt in deadline order, not the live book,
so it picked the best of 202 tries and proposed it even when every one was worse than
doing nothing — a book plotted at 3 overloaded weeks came back at 4. It now scores the
current book and returns `no_improvement` when nothing beats it.

This matters more the longer the tool runs. Re-plan cannot move work already under
way, so its freedom shrinks as the year fills: with 12 rows started it had nothing to
offer, with none started it improved the same book from 3 to 2. **Wiping and
re-plotting is not an alternative** — projects arrive when they arrive — so re-plan
has to be safe to run at any moment, which means being allowed to say no.

**Known and unfixed: re-plan does not divide dubs.** The two engines use different
machinery — assign has the wrapper's `divide_dub` tuner plus `spreadDub`, which hands
out dub weeks one at a time; replan has neither, and its `tryShare` looks for the
smallest covering set, which is one dubber plus one editor by construction. So a
re-plan collapses divided dubs. It no longer makes the book worse overall, but it does
not find those splits. The fix is to port `spreadDub` into the second engine.

### Where the plan stands

3 overloaded engineer-weeks — one each on Kyle, Mat and Josiah; 2 forced projects;
spread 3; reserve 16 weeks; 73 booking rows across 24 projects.

None are misallocation. Kyle's is **structural**: he is the only `does_specials`
engineer *and* one of three Advanced mixers, so special work collides with his mix
work — a hiring or cross-training question. Mat's and Josiah's are the **price of the
music rule** (§3), which reserves two people for music and so leaves less slack
everywhere else. Before that rule the figure was 2, both Kyle.

---

## 5. Layers, and why the engine is fenced off

```
Sheet  ──▶  21_Io.gs      reads/writes, memoised, canonicalises input
       ──▶  11_Wrapper.gs validation, order search, scoring, replan fixes
       ──▶  00/01/02_Engine_*.gs   the assignment logic
```

`engine/*.js` holds the **original, untouched** engine as delivered.
`test/engine_drift.test.js` byte-compares the live `.gs` copies against it and
permits *only* declared changes — seven rewritten regions in assign.js, two in
replan.js, plus named one-line substitutions and two `||=` desugarings the V8
runtime demands.

Two kinds of declaration, and the difference matters. A **rewritten region** is cut
from both sides: use it where the logic was genuinely replaced. A **substitution**
transforms the reference into the live line and leaves everything else compared, so
it is the honest tool for a signature change or a rename. The music work is all
substitutions — the same people are eligible, only the tiebreak between them is new
— which is why it reads as a short list rather than another fenced-off block.

**That test is the authoritative record of what changed in the engine.** It fails
on any undeclared edit; verified by injecting one. Prose drifts, it doesn't.

Anything that can be fixed *outside* the engine is, on that principle: blank mix
levels, mis-cased mix levels, superseded-row filtering, the replan defects.

---

## 6. Tests — 453, all passing

| suite | count | what it protects |
|---|---|---|
| `wrapper.test.js` | 176 | acceptance criteria, sharing policy, order search, rule 11, the lock, music |
| `io_roundtrips.test.js` | 36 | Sheets round trips, ghosts, relink, roster validation |
| `webapp.test.js` | 199 | the web app: actions, replan, history replay, report, rollback, the read-only gate, lock, cancel, ghosts |
| `engine_drift.test.js` | 28 | the engine has not changed except where declared |
| `sheets_live.test.js` | 14 | the real spreadsheet, read-only — skips without credentials |

```bash
for t in test/*.test.js; do node "$t"; done
```

**118 tests were deleted with the Apps Script web app UI on 2026-08-31, and that is
not a coverage regression — they exercised code that no longer exists.** Every one of
them drove a deleted `api*` entry point: the grid payload, quarter clipping, drag
reassignment and undo, the lock toggle, re-plan preview/apply, the orphan sweep. The
equivalent behaviour in the Node app is covered by `webapp.test.js`, which has a
section for each. `views.test.js` went the same way: it existed to check that the three
deleted HTML files parsed.

What genuinely went with them is the round-trip ACCOUNTING — "nothing else scales with
row count", "superseding many rows is not one call per row". Those measured
`SpreadsheetApp` calls per operation, which was the dominant cost in Apps Script and is
not a cost the Node app has: it reads the whole book once over the Sheets API and
serves everything else from memory. If the Apps Script app is ever revived, that
harness is in git.

**`sheets_live.test.js` is the only suite that touches Google.** Everything else runs
on a fixture that has no tabs, no headers and no cell formats — which is why it could
not see any of the three Sheets bugs that hit in one day: dates arriving as serial
numbers, the log tab added to `TABS` so *every* read asked for a range that did not
exist, and a column missing from the sheet so writes to it vanished in silence. Each
was found by hand, none by the 502 tests that existed at the time.

It reads and never writes, so it is safe to point at the live book:

```bash
GOOGLE_APPLICATION_CREDENTIALS=~/.config/loc-prod-planner/key.json \
PLANNER_SHEET_ID=<id> node test/sheets_live.test.js
```

Without those two variables it skips and exits 0, so the suite still runs anywhere.

Two of its checks exist to keep the other twelve honest. **`the whole check wrote
nothing to the live sheet`** records the HTTP verb of every Google call and fails on
anything but `GET` — so if someone later makes `read()` repair a missing column, this
fails instead of quietly editing Tara's spreadsheet during a test run. **`the read
path was actually observed`** asserts the interception saw at least three calls: the
first version of that guard was installed after `sheets.js` had already destructured
`createAuth`, so it watched one call out of four and passed for the wrong reason.

**Every check was verified by sabotage** — the bug reintroduced, the check confirmed
to fail, the code restored. Worth doing literally: the first two sabotage attempts
silently failed to apply and the suite went green, which looks exactly like a test
doing its job. The patch script now asserts its own replacement landed.

One check is structural rather than behavioural. `reading the book does not ask for
the log tab` asserts `TABS` excludes `EVENTS_TAB` instead of proving a read succeeds
without one, because the `History` tab now exists on the live sheet — the failing
condition cannot be reproduced against it without deleting her data. It pins the shape
of the bug, not the symptom.

**The round-trip suite has earned its keep by being made more like Sheets, not more
convenient.** Three real bugs came from tightening its fakes:

- dates as `Date` objects, not ISO strings → found a timezone lookup running **once
  per date cell**, 167 server round trips on one page load. That was the "stuck
  reading the book" hang.
- counting every accessor, not just reads/writes → proved nothing else scales with
  row count.
- `deleteRows` and `clearContent` were stubs that did nothing → the wipe passed in
  Node and threw in the real sheet.

Any stub that returns `this` without doing anything is a place a bug can hide.

**A failing test is not automatically a stale test.** When the music rule landed, four
wrapper assertions failed and three were genuinely out of date. The fourth —
`cap 2 keeps every share to two engineers` — was reading `recordist`, which
concatenates the dubbers *and* the editor. A correctly capped project with two dubbers
plus a separate whole-edit holder reads as three names and looked like a breach.
SHARE_CAP has only ever limited the dub. It now counts the Dub rows. Check what an
assertion measures before you update it to whatever the code now does.

`views.test.js` exists for a different reason: the `.gs` files were syntax-checked by
the other suites and the `.html` files by nothing. Appending code past a closing
`</script>` killed the whole app twice in one day — both times caught only because
someone opened the preview. It now checks that every script block parses, that no
JavaScript sits outside one, that `</body>` follows the last `</script>`, and that
every `api()` the views call exists server-side. Verified against all four failures.

---

## 7. The sheet menu

| item | what it does |
|---|---|
| **Check bookings for problems** | roster errors, duplicate live rows, ghost projects, validation failures |
| **Relink a renamed project** | moves a stranded schedule onto its renamed project row. Live rows only, one batched write, reversible. Listed above *Clear* deliberately |
| **Clear ghost projects** | supersedes bookings whose project no longer exists in Projects |
| **Why this mixer?** | for one project: every engineer, ✓/✗, and the reason — wrong level, not a mixer, reserve, or busy which weeks |
| Admin → **Set up sheets** | builds/repairs tabs. **Wipes the Projects tab**; leaves Bookings alone |
| Admin → **Plot all unplotted rows** | one batch solve over everything without a Plotted date |
| Admin → **Refresh engineer dropdowns** | reapplies validation to the Projects pick columns *and* the Engineers tab. Validation only — no cell value is read or written |
| Admin → **Wipe the schedule (build only)** | **delete this before go-live** |

`Why this mixer?` exists because the tie-break is genuinely counterintuitive:
`pick` ranks on **total load across all phases**, so a heavy record/edit week makes
someone *less* likely to be handed a mix. An idle-looking mixer being passed over
is often correct.

There is no "Open the app" item. It read the URL from `ScriptApp.getService()
.getUrl()`, which returns null unless the manifest has a `webapp` block *and* a
matching deployment exists — state managed in the editor, not here. It reported
"Not deployed yet" while the app was running. Bookmark the URL instead.

---

## 8. Re-plan

Re-solves the **movable** part of the book against its current state, shows a diff,
and writes nothing until you apply. Old rows are superseded, never deleted.

Locked from moving:

1. anything starting **this week or earlier** — you don't reassign work underway
2. anything **hand-picked** (rule 11)
3. any project with **Locked** ticked, or the lock toggled in the Projects list

The lock is wired into `replan.js` itself, not just the wrapper. If only the wrapper
knew, the engine would classify those rows as movable, supersede them, and never
re-emit them — which is exactly fix D's failure mode.

**It was removed on 2026-08-13 and restored the same day.** The argument for removal
— manual picks cover it — was wrong: incremental plotting has no way to re-solve an
assignment that was right when made and is stale now, and manual picks only fix the
instance you happen to notice. The wrapper half was recovered from **script version
4** via `clasp clone-script <id> 4` rather than rewritten, because fix D is
data-losing and not something to reconstruct from a description.

Note that a full batch re-solve reaches the same plan. Re-plan's value is the
locking and the preview, which matter once assignments are out with people.

---

## 9. Known gaps

**Nothing is verified in a real Apps Script session.** Every check ran in Node or
the preview harness, which stubs `google.script.run` and `SpreadsheetApp`.

**`tools/build_app_preview.js` reimplements the read models, and they drift.**
The preview stubs the `api*` surface in the browser rather than running the real
`40_WebApp.gs`, so `listProjects_`, `apiBootstrap` and `apiSchedule` all exist
twice. By 2026-08-30 the copies had diverged badly: the stub still derived
`forced` from the FORCED note (the bug removed from the real code weeks earlier),
still returned the retired `counts.forced_rows`, and had never gained the
per-booking `items` — which meant drag-and-drop was silently dead in the preview
and nobody noticed, because the preview is the only place drag can be tried
outside a deployment. Patched to match, but the duplication is the real defect.
The fix is to drop the hand-written stub and run the genuine functions over an
in-memory sheet — `loadWithSheet` in `test/io_roundtrips.test.js` already does
exactly this in Node, and is now exported so it can be reused.

This is the same failure as the five stale-note surfaces: two implementations of
one fact, and no test comparing them. If the preview disagrees with the app, the
preview is the thing that gets trusted, because it is the thing you can see.

**No refresh in the app.** Views cache in `LOADED` and never refetch, so sheet-side
changes are invisible until a browser reload. A header refresh button is a few lines.

**Services required (Atmos) is now modelled** — `atmos` is its own capability column
on the Engineers tab and gates every mix path, so the engine no longer assigns a mixer
who cannot do the job. Kyle is currently the only name carrying it, which makes Atmos
a second single point of failure alongside specials.

**A project's title is its primary key** (§2). Renaming one in the sheet orphans its
whole schedule; renaming it in the app is safe. Declined a `project_id` column as too
big a change pre-launch — revisit if titles start changing routinely.

**Series vs feature.** Blue Box Season 2 is one recurring show with a fixed crew in
the real tracker, but six independent projects here — which is why its engineers
churn across the year.

**One specials engineer.** Kyle is a single point of failure and the source of one
remaining overlap.

**The project lock was missing from the new app for a week, and nobody noticed.** The
Apps Script app had `apiSetProjectLock`; the rewrite did not carry it, so the only way
to stop a re-plan moving something was to type `Yes` into the Locked column by hand.
It surfaced only because writing the how-to forced someone to say out loud where that
step happens. Restored 2026-08-31 with the old implementation's guarantees intact: one
cell written, no bookings touched, an unknown title refused.

The rule that matters is in `projectCells()` in `webapp/sources/sheets.js`. A lock
writes exactly ONE cell, and an ordinary project save writes every column EXCEPT
Locked — because a save built from a book up to a TTL old would otherwise overwrite a
lock somebody had just set in the spreadsheet. Both halves are asserted, and both were
verified by sabotage.

**That comparison has now been made.** Diffing the deleted `api*` surface against the
new app found two more gaps, both closed 2026-08-31:

- **Cancel a project.** `setStatus` accepted `Cancelled` and no caller ever sent it.
  Complete and Cancelled differ in exactly one way that matters — Complete keeps the
  bookings, because the record of who did the work is the point and the report is built
  from them; Cancelled supersedes them, so a dropped show stops occupying weeks nobody
  is spending.
- **Clear ghost projects.** The worst of the three, and self-inflicted. The Apps Script
  menu item was removed in v77 on the grounds that "the app both detects orphans AND
  offers the fix" — and then that app was deleted, so nothing anywhere could release the
  bookings of a project deleted from the sheet. `Relink` only covers the renamed case.
  Now a notice at the top of Projects, which explains both causes rather than offering
  one button: renamed wants relinking in the sheet, deleted wants clearing here.

`clearOrphans` re-checks every title against the CURRENT book before superseding
anything. The browser's list can be minutes old, and a title relinked since must not
have its bookings discarded on the strength of a stale screen. That guard is the first
thing to sabotage if these tests are ever rewritten.

**All three gaps were found by writing documentation, not by testing.** Saying out loud
where a step happens is what exposed them. Worth remembering the next time a rewrite is
declared at parity.

**The Sheets write path has no automated coverage.** `sheets_live.test.js` (§6) now
exercises the read path against the real book, which closes the gap that let three
bugs through in a day — but it is deliberately read-only, so `ensureProjectColumns`,
the managed-column writes and `appendEvent` are still only ever tested by hand
against the live sheet. That is the riskiest remaining blind spot, because those are
the paths that can damage data rather than merely misreport it. Covering them needs a
scratch spreadsheet the service account owns, not the production book.

**Two music specialists, and the roster must say so.** Music is confined to whoever
carries a `music_specialist` rank, so the pool is exactly as deep as that column. If
only one name is ranked, every music title in a week belongs to one person and the
engine will force overlaps onto them rather than reach outside — correctly, but
expensively. Adding a third would relieve it; the code needs no change, only the
column. Conversely, blanking the column makes music route like ordinary work again,
silently.

**Leave and availability are not modelled, by request.** The engine assumes everyone
is available every week. This is the loc lead's decision, not an oversight: who is on
leave, who is coming back mid-week, who should not be given a hard title right now —
that is human judgment, and the tool is not to guess at it.

The intended mechanism is the **manual pick**, which is why pins are expected rather
than regrettable. It is also why the Analysis page does not count them (§10): a pin is
often the correct answer to something the tool was never meant to know, so the number
cannot distinguish a wrong rule from a right decision.

Do not "fix" this by adding an availability calendar. If it is ever revisited it needs
the loc lead's agreement first, because it moves a judgment call out of a person's
hands and into a spreadsheet.

**No phase-length estimation, deliberately.** The human entering phase lengths has
already weighed word count, runtime and complexity. An LLM estimator was built and
removed the same day for failing to reproduce three of 24 known projects. A phase
length wrong by one week cascades through every later project; a confidently wrong
schedule is worse than an obviously wrong one.

---

## 10. The Analysis page

Two sections, deliberately. It was five, with ten stat tiles, four charts, a heatmap
and two "tightest weeks" lists — most of it different renderings of the same facts, and
one of them actively wrong.

| section | contents |
|---|---|
| Can we take work? | **forced overlaps**; demand-vs-supply chart per role; who is free week by week, by name; where the work comes from |
| Who is overloaded? | weeks booked per engineer per quarter; overloaded weeks, naming what collides |

Forced overlaps lead the page. They were rendered three times — a header pill for the
count, an 11px banner for the role split, and a table at the very bottom for the
detail — so the most actionable fact on the page ("Kyle is carrying both of these")
was in its smallest type.

A third section, "Is this working?", counted manual pins as a process-health metric.
Removed: see the leave decision in §9 for why that number could not mean what it
claimed.

Four things are worth not undoing:

**Overload is doubled weeks, not long runs.** The old Balance table flagged rows red
at eight-plus consecutive booked weeks and called it burnout. Since the objective now
deliberately produces 14-week runs (§4), that would paint the correct plan as a
failure.

**Free capacity is names and weeks, never a quarterly sum.** "Open record/edit: 12"
implied capacity is interchangeable across time. It is not — deadlines are fixed, so
a quarter can show twelve open weeks while every week you need is full. Same error the
page warns about for roles, one axis over.

**Busy and short-handed are different questions, and the page keeps them apart by
showing different things rather than different columns.** A week where nobody is free is
a scheduling problem — re-plan or move a date. A week where more projects need a role
than there are people who can do it is a hiring problem. The **charts** show the second
(bars above the supply line), and the **forced overlaps** card names the projects it
actually cost.

A "How full each quarter is" table used to count both per quarter. It was dropped on
2026-08-13 once the forced-overlaps card existed: its two columns were exact
aggregations of the red chart bars and the "nobody free" rows, so it restated two things
already on the page and added nothing but reach beyond the ten-week window.

**Labels carry their own meaning, so the page has almost no prose.** Two tests of
this held: the demand charts label their own supply line and their own over-capacity
bars, so they need no legend — the legend was removed as redundant. And the quarter
table's columns were renamed from "Full"/"Short-handed" to **"Weeks with nobody free"**
and **"Weeks needing more people"**, at which point its explanatory subtitle could go.
An explanation is usually a label that is not doing its job.

**The capacity charts start at the current week.** Past weeks cannot be acted on — you
cannot hire retroactively — and including them made the axis grow without limit as
history accumulated: five years of bookings would be ~260 bars in the same width, under
2px each. Rolling the start keeps the width at "how far ahead we plan", which is
constant year over year. `tools/capacity_report.js` prints the full series for a look
back. The axis is labelled by month boundary, not week range: week labels were long
enough ("Dec 28 - Jan 3") to collide with each other on a 57-week axis.

The page is one column, capped at 1180px and left aligned. That cap is not cosmetic:
the charts scale to their container via `viewBox`, so a full-width column magnified
every internal label — at 1900px by 1.5x, at 2500px by 2x. A fixed ceiling is the only
way the labels can be sized once and be right.

---

## 11. Before go-live

1. ~~Delete `resetSchedule()` and the dead `saveProject()`~~ — **done 2026-08-31,
   v77.** Both gone. The menu was trimmed at the same time: `Check bookings for
   problems` and `Clear ghost projects` were second, worse surfaces for things the
   web app already shows and fixes; `Fix the overlap notes` repaired a note no
   surface reads any more; `Why this mixer?` went unused. `refreshForcedNotes_`
   itself STAYS — three write paths call it.
2. Bump the deployment version so the app serves current code — `create-version`
   then `redeploy`, per §1, so the bookmark survives.
3. Open the web app on the real roster and read the red banner at the top of
   Projects — it runs the same check and will name any mis-cased `mix_level`, which
   silently disqualifies a mixer. (The menu item that used to do this is gone; the
   banner was always the better surface, since it appears without being asked.)
4. Build the initial book as a **seed batch plus small batches**, not one project at
   a time — a batch of four or five together beats four separate saves. The full
   24-at-once solve is a test-fixture scenario, not how this is worked; see §4.
