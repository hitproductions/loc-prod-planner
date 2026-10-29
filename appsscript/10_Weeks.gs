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

// ---------------------------------------------------------------- jobs per week

// What one engineer is doing in one week, counted as PROJECTS rather than booking rows.
//
// A project is its title (Rudolf, 2026-10-29): recording, editing and mixing one show in the
// same week is one project, not an overlap. (Since 2026-10-15 a dub and its edit were one job
// and the mix a second; the title is now the whole unit.) Anything on another title is another.
function jobKey(row) {
  return String(row.project || '');
}

// { 'engineer|week': { jobs: {jobKey: true}, rows: [...] } } for every week a row covers.
function jobsByEngineerWeek(rows) {
  const per = {};
  (rows || []).forEach(b => {
    if (!b || !b.engineer || !b.start_date || !b.end_date) return;
    const k = jobKey(b);
    weeksOf(b).forEach(w => {
      const at = per[b.engineer + '|' + w] = per[b.engineer + '|' + w] || { jobs: {}, rows: [] };
      at.jobs[k] = true; at.rows.push(b);
    });
  });
  return per;
}

// How many projects one engineer has on in a week.
function projectsOf(entry) { return entry ? Object.keys(entry.jobs).length : 0; }

// The number every OVERLAP figure reads: 0 for a free week, 1 for a week within the limit,
// 2 for one project over it, 3 for two over, and so on. Up to PROJECT_LIMIT projects at once
// is normal work (Rudolf, 2026-10-29), so the overlap rules, scores and flags -- written when
// any second job was an overlap -- keep their meaning: "doubled" is now "one over the limit".
// With a limit of 1 this is exactly the project count, as before.
function depthOf(entry) {
  const n = projectsOf(entry);
  const limit = (typeof PROJECT_LIMIT === 'number' && PROJECT_LIMIT >= 1) ? PROJECT_LIMIT : 1;
  return n <= limit ? (n > 0 ? 1 : 0) : n - limit + 1;
}
