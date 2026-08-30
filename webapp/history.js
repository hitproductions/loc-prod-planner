// The change log, and rebuilding the book from it.
//
// Superseded rows already record WHAT stopped being true — nothing is ever deleted —
// but not when, and not which action did it. Forty-four rows superseded by one re-plan
// are indistinguishable from forty-four unrelated edits. An event ties them together:
// one row per thing you did, naming the rows it wrote and the rows it retired.
//
// The log starts empty and fills from here. Everything superseded before it existed
// stays undated, and is shown as "before the log began" rather than guessed at.
const { loadAppsScript } = require('../core/engine.js');
const A = loadAppsScript();

const nums = v => String(v == null ? '' : v).split(',')
  .map(x => Number(String(x).trim())).filter(n => Number.isFinite(n) && n > 0);

// The book as it stood immediately after event `upTo` (or before all of them, with
// upTo = -1). Replayed rather than stored: a row is live then if it existed by then
// and had not yet been retired.
function bookAt(bookings, events, upTo) {
  const appendedLater = new Set();
  const supersededBy = {};
  events.forEach((e, i) => {
    nums(e.appended).forEach(r => { if (i > upTo) appendedLater.add(r); });
    nums(e.superseded).forEach(r => { supersededBy[r] = Math.min(supersededBy[r] ?? i, i); });
  });
  return bookings.filter(b => {
    if (appendedLater.has(b.row_number)) return false;     // not written yet
    const gone = supersededBy[b.row_number];
    if (gone !== undefined && gone <= upTo) return false;  // already retired
    // Retired at some point, but by no event in the log — so it went before the log
    // began, and was never live at any moment the log can speak to.
    if (gone === undefined && /superseded/i.test(b.status || '')) return false;
    return true;
  });
}

// What one event did to the book, in the terms the schedule is read in.
function diffEvent(bookings, events, index) {
  const before = bookAt(bookings, events, index - 1);
  const after = bookAt(bookings, events, index);
  const key = b => `${b.project}|${b.phase}|${b.start_date}`;
  const beforeBy = {}; before.forEach(b => { beforeBy[key(b)] = b; });
  const afterBy = {}; after.forEach(b => { afterBy[key(b)] = b; });

  const moved = [], added = [], removed = [];
  Object.keys(afterBy).forEach(k => {
    const a = afterBy[k], b = beforeBy[k];
    if (!b) added.push(a);
    else if (b.engineer !== a.engineer) moved.push({ ...a, from: b.engineer });
  });
  Object.keys(beforeBy).forEach(k => { if (!afterBy[k]) removed.push(beforeBy[k]); });

  const over = rows => {
    const per = {};
    rows.forEach(b => { for (let w = A.widx(b.start_date); w <= A.widx(b.end_date); w++) {
      const k = b.engineer + '|' + w; per[k] = (per[k] || 0) + 1; } });
    return Object.values(per).filter(n => n > 1).length;
  };

  return {
    moved, added, removed,
    counts: { before: before.length, after: after.length },
    overlaps: { before: over(before), after: over(after) },
  };
}

module.exports = { bookAt, diffEvent, nums };
