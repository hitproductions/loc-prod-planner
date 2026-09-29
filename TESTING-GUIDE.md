# Loc Prod Planner

**Internal — Hit Productions.**

---

## Opening it

**https://planner-63803252709.asia-southeast1.run.app** — password sent separately. It
remembers you for 30 days.

The schedule starts empty; nothing in it is real work yet. The first click after a quiet
spell takes a couple of seconds while it wakes, then it's instant.

---

## Your requests

| # | Request | Status |
|---|---|---|
| 1 | Two engineers on one phase, picked by hand | **Applied** — Recordist pick + Recordist pick 2 on the project form |
| 2 | "Project Complete" / archive status | **Applied** — Mark complete, keeps the record |
| 3 | Monthly report of completed projects | **Applied** — Report tab, printable |
| 4 | View-only access for engineers | **Applied** — read-only link at the end |
| 5 | Sort the schedule by deadline or project | **Applied** — Deadline / A–Z buttons on Projects |
| 6 | Atmos as its own flag, separate from Special | **Applied** — own column and own tickbox; only engineers marked for Atmos get Atmos mixes |
| 7 | 2 overlaps = warning, 3 = overflow that must be reassigned; replaces FORCED | **Applied** — blue at two, red at three. FORCED colouring is gone |
| 8 | Recognise a new order as a continuation of an existing series | **Pending** — needs coordination with Tel moving forward |
| 9 | Drag-and-drop rescheduling, without a manual refresh | **Applied** — the drag saves and redraws immediately |
| 10 | Toggle a hand-picked booking back to Auto | **Applied** — click the dotted cell |
| 11 | Clearer instructions than the old ones | **Applied** — this document |

---

## Adding a project

**Projects → Add.**

Title, client, deadline, and how many weeks each phase needs — dub, edit, mix.

Tick **Music**, **Special** or **Atmos** if they apply. Those decide who is eligible.

**Engineer picks.** Leave blank and it chooses. Fill them and it uses your choice:

- **Recordist pick** and **Recordist pick 2** — name both to split one dub across two
  engineers by hand
- **Editor pick**, **Mixer pick** — one each

**Check availability** shows what would happen without saving. **Plot & save** schedules
it, and only it — nothing already on the board moves.

---

## The Projects list

**Deadline** and **A–Z** re-sort it.

**Lock** on any row freezes that project: re-plan won't move it, though you can still drag
its weeks. Press again to unlock.

**Show closed** brings back completed and cancelled projects.

Click a row to edit it.

---

## Reading the schedule

Weeks run down the page; the bold row is this week.

**Yellow** dub, **blue** edit, **pink** mix.

**Projects / Engineers** switches what the columns are. **From** and **To** narrow it to a
few quarters; **All** puts it back.

The outline is the part to watch:

- **Blue — two at once.** Ordinary. A series still recording while its edit starts.
- **Red — three at once.** Overflow. Move one.
- **Dotted — set by hand.** The planner leaves it alone.

---

## Moving work

In the **Engineers** view, drag a week onto someone else. It can only move sideways —
same week, same phase — because you're changing who does it, not when. Problems are
flagged before it saves.

**Click a dotted cell** to hand it back to automatic.

---

## Finishing vs cancelling

**Mark complete** — it happened. Leaves the list, but **its weeks stay on the schedule**,
because who did the work is the record. This is what feeds the monthly report.

**Cancel project** — it isn't happening. **Its weeks go back to the engineers.**

Both leave the list; **Show closed** brings them back; either can be undone.

---

## Re-plan

Proposes a better arrangement of everything and shows what would change before saving.

It moves **everything not locked** — not only the newest project. To add one title without
disturbing the rest, use the form. It takes a few seconds to think.

---

## Analysis

Where the pressure is: who is carrying most, which weeks are tightest, who is free. Useful
before promising a deadline.

---

## History and undo

Every change, newest first. **The most recent can be undone** — a cancel, a lock, a
completion, a rename, a dragged week — and it restores the project's details too.

Only the most recent: undoing an older one would clash with what came after.

---

## Report

Pick a month, print it. A project appears once somebody marks it complete — nothing is
guessed from deadlines, since a job can land early or late.

---

## Refresh

Top right. The planner holds the schedule in memory for speed; Refresh re-reads it.

---

## The engineer view

**https://planner-view-63803252709.asia-southeast1.run.app/view.html**

The same schedule, read-only — nothing to press, nothing to break. Same password.

---

## The spreadsheet behind it

**https://docs.google.com/spreadsheets/d/1_9A1gzFlr8xOkmmzRdH75JBS5KmkqEoS0lLO3GWOGiQ/edit**

The planner reads and writes this sheet. It is the record; the app is the way in. You
rarely need to open it, but it is there, and nothing is hidden from you.

**Worth opening it for:**

- **The engineer roster** — who can record, edit or mix, who is Advanced or Developing,
  who does Music, Specials or Atmos. The app reads this and never edits it. Changing who
  is eligible for what happens here.
- **Checking history** — a `History` tab logs every change with a timestamp: what was
  moved, cancelled, re-planned, and by which action.
- **Reading the raw rows** — `Projects` is one row per project, `Bookings` one row per
  engineer-week.

**Worth knowing:**

- Cancelled bookings are **marked**, not deleted. Nothing is thrown away, so the record
  of what was planned survives.
- The app holds the sheet in memory for speed. Edit the sheet directly and the app won't
  see it until somebody presses **Refresh**.
- Editing the sheet while people are working in the app is the one way to confuse it.
  Prefer the app; use the sheet to look.
