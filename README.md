# Loc Prod Planner — how to use it

*Internal — Hit Productions. Contains client project names.*

You work in the **app**. Bookmark its link — that's the tool. The Google Sheet
behind it is storage; you should rarely need to open it, and there's a short list
at the end of when you do.

You tell it a deadline and how many weeks of dub, edit and mix a title needs. It
works out who does each phase and when, without double-booking anyone.

---

## Adding a project

**Projects → + Add project.**

Fill in the title, deadline, and the three phase lengths in whole weeks. Everything
else has a sensible default — client is Netflix, mix level is Advanced, Music and
Special are off.

Two buttons:

- **Check availability** — shows you who would get it and flags any problem.
  Nothing is saved.
- **Plot & save** — commits it.

Use Check first when you're unsure. It costs nothing and tells you the same thing
saving would.

### The three phase lengths

Whole weeks only. **Zero is valid** — a mix-only job is `0/0/2`. Phases run
back-to-back ending the week before the deadline, so a 2/1/1 job occupies the four
weeks leading up to delivery.

Get these right. Everything else follows from them, and a week's error moves every
window on that title.

---

## Reading the schedule

**Schedule.** Colours are the tracker's:

| | |
|---|---|
| amber | Dub |
| blue | Edit |
| pink | Mix |
| solid red | the deadline week |
| **red outline** | that engineer is on two projects that week |
| dotted outline | someone you picked by hand |

A red outline marks the **specific week** where someone is doubled — not the whole
project. If a project has one outlined cell and five clean ones, only that one week
is a problem.

Toggle **Projects / Engineers** to flip the grid. The two are laid out differently on
purpose:

- **Projects** — one row per title, weeks across. Read a project left to right.
- **Engineers** — one **column** per person, weeks **down**. Everyone fits on screen,
  so a single row tells you who is free that week. Cells show the project name, and
  weeks read as `11/02 - 11/08`, with a rule at each quarter.

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

Projects are listed by deadline. The **A–Z** button beside *Add project* sorts by
title instead, which is faster when you know the name but not the date. **Deadline**
switches back.

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

Read the change list, then **Apply re-plan** if it looks right. Old rows are
superseded, not deleted, so nothing is lost.

If it proposes a lot of changes, that's normal after adding several projects at
once. Lock anything already promised to people first.

---

## Analysis

Worth a look monthly rather than daily. Two sections:

**Can we take work?** starts with **forced overlaps** — the projects that couldn't be
scheduled without doubling someone up, naming who is carrying them. Those are the ones
to renegotiate.

The two charts then show, week by week from now on, how many projects need a role
against how many people can do it. Bars above the dashed line are weeks where more
projects need that role than there are people who can do it at all — a hiring
question, not a scheduling one.

**Who is free** names the available engineers for the next ten weeks. Dub/edit and
Advanced mix are always counted separately: a free dub week can't cover a mix, so
adding them would invent capacity you don't have.

**Who is overloaded?** Weeks where someone holds two projects at once, naming which
projects collide. A long run of weeks is *not* flagged — that's just steady work.

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
each was or wasn't eligible. The usual answer is that the tool balances **total**
workload across all phases, so a busy recordist gets passed over for a mix.

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
