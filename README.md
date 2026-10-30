# Loc Prod Planner — how to use it

*Internal — Hit Productions.*

You work in the **app**. Bookmark its link — that's the tool. The Google Sheet
behind it is storage; you should rarely need to open it, and there's a short list
at the end of when you do.

You tell it a deadline and how many weeks of dub, edit and mix a title needs. It
works out who does each phase and when, without double-booking anyone.

---

## Adding a project

**Projects → + Add project.**

Fill in the title, the deadline, and **when each phase runs** (see below). Everything
else has a sensible default — client is Netflix, mix level is Advanced, Music and
Special are off.

Two buttons:

- **Check availability** — shows you who would get it and flags any problem.
  Nothing is saved.
- **Plot & save** — commits it.

Use Check first when you're unsure. It costs nothing and tells you the same thing
saving would. Both stay dimmed until the dates are valid, and a note beside them says
what is missing.

### Titles are unique

A project's title is its identity — its bookings, History and lock all find it by title — so
two projects can't share one. A title that is already taken (case and spacing ignored) is
saved with a number instead: **Harbor Lights (2)**. The form says so as you type, and
Check availability and the saved result say it again. The existing project is never touched.
Closed and removed projects keep their titles too.

### Series: keeping the same people on a show

A **series** connects the seasons and episode batches of one show ("Harbor Lights S1",
"Harbor Lights S2", "Eps 1-2", "Eps 3-4"). Put the show's name in the **Series** box when
adding a project — it suggests the series already in use, and "harbor lights" and "Harbor
Lights" are the same series. It can also be typed straight into the **Series** column on the
Projects tab.

Under the box, the other projects in that series are listed with **who did each phase**
(Dub Kyle · Edit Kyle · Mix Via). The planner **prefers** those people: whoever did a phase on
an earlier project is preferred for the same phase on the next. It is a preference, nothing
more — it never costs an overlap, uses the reserve, or overrides a hand-picked name, and if
the person is busy the work goes elsewhere. After **Check availability**, each engineer is
tagged *continues* or *new to series*. Re-plan keeps the same preference.

To put an already-scheduled project in a series without re-planning it, type the series and
press **Save series only**.

The history is only what's in the sheet. A season done before the sheet began has no record;
add it as a past project and mark it complete if you want it counted.

### When each phase runs

One line per phase: a start, an end, and the weeks that works out to ("3 wks · 2 Nov –
22 Nov"). Type dates the way they come — `2 Nov`, `Nov 2`, `11/2`, `2026-11-02` — or use
the small calendar button beside each box. Whatever was understood is shown back as a full
date, and as the Monday–Sunday week it falls in. A phase left blank is simply not used.

Beside the boxes, a **week-by-week strip** draws the phases as bars on one axis, with the
deadline marked. Phases that share weeks are outlined and listed under the strip. Mistakes
appear next to the box that caused them.

Get these right. Everything else follows from them, and a week's error moves every
window on that title.

---

## Reading the schedule

**Schedule.** It opens on **this week**, with two weeks of the past above it; earlier weeks are
shown in faded phase colours, so the past reads as done but Dub, Edit and Mix stay distinct. The overlap warnings at the top count **from this week on** — a week
that has already gone can't be reassigned, so it is shown quietly as "N earlier" instead.
Colours are the tracker's:

| | |
|---|---|
| amber | Dub |
| blue | Edit |
| pink | Mix |
| solid red | the deadline week |
| **red outline** | that engineer is over the limit: more than 3 projects that week |
| dotted outline | someone you picked by hand |

A red outline marks the **specific week** where someone is over the limit — not the whole
project. If a project has one outlined cell and five clean ones, only that one week
is a problem.

Toggle **Projects / Engineers** to flip the grid. The two are laid out differently on
purpose:

- **Projects** — one row per title, weeks across. Read a project left to right.
- **Engineers** — one **column** per person, weeks **down**. Everyone fits on screen,
  so a single row tells you who is free that week. Cells show the project name, and
  weeks read as `11/02 - 11/08`, with a rule at each quarter.

Each booking is a taller box that says what it is: the project, the phase and which week
of the booking it is (**Dub · wk 2/3**). A key above the grid explains the colours,
"4 at once" (over the limit) and "By hand".

Hovering a cell highlights its row *and* marks its column — the week header turns red
and a hairline runs down it. Useful when you're twenty rows down and need to know which
week you're looking at.

### Moving a week to someone else

In **Engineers** mode, drag a booking sideways onto another person. That week becomes
theirs; the rest of the project doesn't move.

**Only sideways.** A row is a week, and weeks never move — dates come from the
deadline. Drag up or down and nothing happens, on purpose.

You're dragging one **week of one phase**, not the whole job. Move a single week of
Heartland's dub and the other three weeks stay where they are. If a cell holds two
projects, each is dragged separately, so you always move the one you meant.

Before anything is written you get a summary: who it's going to, whether it
double-books them, whether they're eligible, and whether you're spending the reserve.
None of it blocks you — a hand decision wins, same as the dropdowns on the form — but
you'll know what it costs. Nothing happens until you confirm.

Weeks you place by hand are marked with a dotted outline, and **a re-plan leaves them
alone**. The one thing that undoes them is re-plotting that project from the Projects
page — and if it would, the save asks first and lists exactly what you'd lose.

**To narrow it down**, set **From** and **To** to a quarter — the grid shows only
those weeks, and only the projects with work in them. **Clear** goes back to the
whole picture.

---

## Finding a project

Projects are listed by deadline, **soonest first**. Those whose deadline has passed come
after, under a *Deadline passed* heading, most recent first. The **A–Z** button sorts by
title instead; **Deadline** switches back.

The **search box** narrows the list as you type. Every word has to appear somewhere in the
row, in any order: `kyle nov` finds Kyle's November work. It looks at the title, client,
engineers, deadline and flags.

The **Dates** column shows when a project's work happens, first day to last ("2 Nov – 6 Dec"
and the weeks that spans). Hover for each phase's own dates.

**History** can be narrowed the same way: a box for any word (a project, an engineer) and a
menu for the kind of change.

## Changing something

Click any row in Projects to reopen it. Change what you need and **Save & re-plot**.
The old bookings are replaced; nothing is duplicated.

**Retitle a project here, never in the sheet.** The app knows the old name and moves
the schedule across with it. Editing the title cell in the sheet doesn't — the
bookings keep pointing at the old name and the whole project drops off as a ghost.

### Choosing someone yourself

Three dropdowns on the form: **Recordist pick**, **Editor pick**, **Mixer pick**.
Leave them on `Auto` and the tool decides.

- Naming a **recordist** alone gives them the dub *and* the edit — the usual case.
- Naming an **editor** too splits them: recordist does the dub, editor does the edit.

A manual pick always wins, even if it double-books that person or breaks a rule.
You'll get a warning saying exactly what it costs, and the booking is marked
**pinned** so nothing moves it later.

Automatic mixing prefers available **Advanced** mixers for ordinary work at either
level. **Developing** mixers are the fallback for Developing-level projects, ahead
of the overflow reserve; Advanced projects still require an Advanced mixer. Music
specialist ranking and Atmos room requirements still apply. Re-plan follows the
same preference, with avoiding overlaps and reserve use ahead of level preference,
and level preference ahead of balancing total workload.

### Phase dates (since 15 Oct 2026)

Every project saved from the form states **when each phase runs**: a start and end date
for Dub, Edit and Mix. Leave a phase blank if the project doesn't have it. Dates snap to
their Monday–Sunday week. Any phase may overlap any other (dub, edit and mix); a phase just can't start before the
one it follows has started (edit not before the dub, mix not before the edit), and
everything ends by the deadline. The planner never moves these dates — plotting and
re-plan only choose **who**. Older projects saved before dates existed have none, and
still plot backward from their deadline.

The dates live in six columns at the end of the Projects tab (**Dub start** … **Mix
end**). The app creates them on its first save to a sheet that lacks them.

### How many projects at once (Rudolf, 29 Oct 2026)

**Anyone may carry up to 3 projects in the same week.** Projects are counted **by title**:
recording, editing and mixing one show with the same person is one project. Only a 4th
project at once is an overlap — that is what gets a red outline, a warning, and a place in
Analysis. The phase dates say when work happens; the count of titles is the limit.

The planner still **spreads work evenly**: a new project goes to whoever has the least on
those weeks, so a third project at once is allowed but never the first choice while
someone has less. The limit is `PROJECT_LIMIT` in `appsscript/20_Config.gs`.

**Mat is a reserve for recording and editing.** Set `overflow_only` to `Yes` on Mat's row
in the Engineers tab. Mat then gets dub/edit work only when every regular recordist/editor
already has 3 projects those weeks, and still before anyone is pushed to a 4th. (Daryl,
also a reserve, is in the same position for recording and editing.) A hand pick always
wins, as before.

Keeping a project's dub and edit
with the same person is **preferred, never required**: it ranks below every overlap and
reserve rule, and above balancing total workload, so they are split only when keeping
them together would cost an overlap or the reserve.

Dates are checked when typed into the form **and** when read from the sheet. A project
whose dates don't check out (a lone start date, text in a date cell, a day that doesn't
exist) is **left exactly as it is** by a re-plan and listed on the preview, rather than
planned from guesses. Dates more than three years from today are refused on the form.

### Freezing a project

The **Lock** button on each Projects row. A locked project is left completely alone
by a re-plan — use it once you've told people their dates. Locked rows carry a black
line down their left edge, so you can see at a glance what is settled.

### Cancelling

Open the project → **Cancel project**. It comes off the schedule but the row stays,
marked cancelled, and its history is kept.

---

## Re-plan

**Re-plan → Preview re-plan.**

Over time the schedule drifts: a booking that was right when it was made isn't the
best answer once the surrounding weeks fill in. Re-plan works out a better
arrangement and shows you the diff before writing anything.

It will never touch:

- work starting **this week or earlier** — you don't move something underway
- anything you **picked by hand**
- anything you've **locked**

The result opens with a one-line summary (how many projects change, whether overlaps
clear), then the change list: each project, each phase, who it moves from and to. A fold
at the bottom, **Left alone**, lists every project the re-plan did not touch and why
(*under way*, *locked*, *complete*, *moved by hand*), so a project that did not move is
explained rather than missing.

Read the change list, then **Apply re-plan** if it looks right. Old rows are
superseded, not deleted, so nothing is lost, and the change can be rolled back from
**History**.

If it proposes a lot of changes, that's normal after adding several projects at
once. Lock anything already promised to people first.

---

## Analysis

Worth a look monthly rather than daily. It reads top to bottom:

**Can we take work?** A one-line verdict (*OK*, *Tight* or *Short*) with the reason, for
example "room for about 4 more dub/edit projects through February; Advanced mixing is
tight in the week of 26 Oct". Beside it, two cards show how many more dub/edit and
Advanced mix projects fit.

**Taking a new job.** Type the start and end of any phase (and a deadline if you have
one); each box can stay empty. It answers *OK* or *Check* per phase and names the week and
role that runs short. It only reads, it never books anything.

**Who is free, week by week.** Every engineer against the next 16 weeks, shaded by how
many projects they have on (1 to 3 in greys, red over 3); a show's phases with one person
count once. The last two rows total the **room** for dub/edit and for Advanced mix: each
person can take up to 3, so someone on one project still has room for two more. Dub/edit and Advanced mix are
always counted separately: a free dub week can't cover a mix, so adding them would invent
capacity you don't have. Reserve engineers are marked and left out of "free".

**Who is carrying the most.** Booked weeks per person over the same 16 weeks.

**Overlaps.** Weeks from now on where someone holds more than 3 projects at once, naming which
projects collide. A long run of weeks is *not* flagged, that is just steady work. Earlier
weeks are counted quietly as "N earlier".

Three folds at the bottom hold the older detail: demand against people, work by client,
and weeks per quarter.

---

## Signing in

On the Cloud Run copies, everyone signs in with their own @hitproductions.net Google account, and History shows who made each change (the **By** column). Engineers (anyone whose address is in the Engineers tab's `email` column) get the read-only engineer view on the same link. With an **Access** tab on the sheet (an `email` column), only the people listed there get the full planner and everyone else is refused; without it, everyone else gets the full planner. Setup is in `deploy/GOOGLE-LOGIN.md`. Local runs ask for nothing.

---

## When something looks wrong

**The app is showing old information.** Reload the page. It fetches once when it
opens and doesn't notice changes made elsewhere.

**A project is on the schedule but not in the Projects list.** Two different causes,
and they need opposite fixes — check which one before doing anything.

- **You renamed it in the sheet.** The schedule links to a project by its *title*, so
  changing the title leaves every booking pointing at the old name. Sheet → *Engineer
  Assignment → **Relink a renamed project***. It shows you the stranded schedules,
  asks which project each belongs to, and moves them across — same people, same
  weeks. **Don't clear ghost projects for this**: that retires the bookings you're
  trying to keep, and re-plotting won't give you the same engineers back.
- **Its row was deleted by hand.** Nothing to recover. Sheet → *Engineer Assignment
  → Clear ghost projects*.

Nothing is ever deleted either way, and relinking is its own undo — run it again in
the opposite direction. But clearing a renamed project does cost you the assignments,
so check which of the two you're looking at first.

**Someone idle wasn't given work you expected.** Sheet → *Engineer Assignment →
Why this mixer?* and type the project title. It lists every engineer and the reason
each was or wasn't eligible. For ordinary mixing, the tool prefers available
Advanced mixers first and then balances **total** workload within the eligible tier.
Developing mixers remain a fallback; a busy recordist may also be passed over
because of their existing bookings.

**Anything else odd.** Sheet → *Engineer Assignment → Check bookings for problems*.
It reports roster mistakes, duplicated rows and bad data in one go. Worth running
after anyone edits the Engineers tab.

---

## When you actually need the Sheet

Only these:

1. **Changing the roster** — who can record, edit or mix, and at what level.
   Engineers tab. Run *Refresh engineer dropdowns* afterwards.
2. **The three diagnostics above.**
3. **Loading a batch of projects at once** — paste rows into the Projects tab, then
   *Admin → Plot all unplotted rows*. This solves them together and gives a better
   schedule than adding them one at a time.

That last point is worth remembering: **when you have several projects to add, add
them all and plot once.** Adding them one by one gives each an arbitrary choice
made before the others existed. On our test book that's the difference between two
overloaded weeks and nine.

---

## What the tool deliberately leaves to you

It doesn't track leave, who's better with a given client, or that a title is harder
than its week count suggests. That's by design — those are judgment calls, and the
tool is not meant to guess at them.

So a manual pick isn't a workaround, it's the intended way to say *"not that week, not
that person."* Pin it, lock it, and the schedule works around you.

Treat it as a strong first draft you correct.
