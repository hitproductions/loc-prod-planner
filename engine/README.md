# Engine modules

Plain JavaScript. No framework, no n8n APIs, no external dependencies.
Pure functions: data in, plain objects out. Port as-is — see HANDOFF.md §5.

| File | Export | Purpose |
|---|---|---|
| `assign.js` | `runAssign(project, bookingRows, engineerRows)` | Assign one project: plots phases backward from the deadline, applies the rule order, returns assignments plus warnings and the booking rows to write. |
| `replan.js` | `replan(projectRows, bookingRows, engineerRows, todayISO)` | Re-solve the whole unlocked book. Returns proposed rows, the rows to mark superseded, and a diff of every change. Writes nothing. |
| `stats.js`  | `computeStats(bookingRows, engineerRows, todayISO)` | Workload figures: weeks booked, utilization, idle gaps, double-bookings, per-quarter load, flagged rows. |

All three treat weeks as integers offset from Monday 2025-12-01 (`W0`) and
convert to ISO dates at the boundary. Keep that convention — the seeded tracker
data depends on it.

`replan.js` reads `status` and ignores rows marked `superseded`.
`assign.js` and `stats.js` currently do not filter status; the caller should
pass active rows only.
