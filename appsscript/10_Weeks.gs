// Week arithmetic shared by the wrapper and the capacity module.
// Weeks are integers offset from Monday 2025-12-01 (W0) — the convention the
// engine and the seeded tracker data both use. See engine/README.md.

const W0 = Date.UTC(2025, 11, 1), DAY = 86400000;

// Short month names. HANDOFF §7 specifies the tracker's own single-initial form
// ("A 3-9", "D 29 - J 4"), but Tara asked for month names instead (2026-08-13):
// the initials repeat — J/J/J for Jan/Jun/Jul, M/M, A/A — so they are ambiguous
// and hard to scan.
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function widx(iso) {
  return Math.floor((Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z') - W0) / (7 * DAY));
}
function weekStart(i) { return new Date(W0 + i * 7 * DAY).toISOString().slice(0, 10); }
function weekEnd(i)   { return new Date(W0 + (i * 7 + 6) * DAY).toISOString().slice(0, 10); }

// "Aug 3-9", or "Aug 31 - Sep 6" when the week straddles a month.
function weekLabel(i) {
  const a = new Date(W0 + i * 7 * DAY), b = new Date(W0 + (i * 7 + 6) * DAY);
  const am = MONTH_SHORT[a.getUTCMonth()], bm = MONTH_SHORT[b.getUTCMonth()];
  const ad = a.getUTCDate(), bd = b.getUTCDate();
  return am === bm ? `${am} ${ad}-${bd}` : `${am} ${ad} - ${bm} ${bd}`;
}

// Just the day range, for a grid that already shows the month in a band above.
function weekDayRange(i) {
  const a = new Date(W0 + i * 7 * DAY), b = new Date(W0 + (i * 7 + 6) * DAY);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}-${b.getUTCDate()}`
    : `${a.getUTCDate()} - ${MONTH_SHORT[b.getUTCMonth()]} ${b.getUTCDate()}`;
}

function monthLabel(i) {
  const a = new Date(W0 + i * 7 * DAY);
  return `${MONTH_SHORT[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
}

function quarterOf(i) {
  const d = new Date(W0 + i * 7 * DAY);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

// Every week index a booking row covers.
function weeksOf(row) {
  const out = [];
  const a = widx(row.start_date), z = widx(row.end_date);
  for (let w = a; w <= z; w++) out.push(w);
  return out;
}
