// Keeping project titles unique.
//
// The title IS a project's identity: bookings, the Projects row, History, lock and status
// all find a project by it. Two projects sharing one title are indistinguishable, and adding
// one used to silently take over the existing project's schedule and row.
//
// So a title that is already taken is numbered instead: "Harbor Lights" -> "Harbor Lights (2)".
// Pure, and loaded by the page (to say it as you type) and by the server (the rule itself),
// so the two cannot disagree.
(function (root) {
  const clean = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  // Compared without regard to case or spacing: "harbor  lights" is "Harbor Lights".
  const key = s => clean(s).toLowerCase();

  // `existing` is every title already in use, closed and cancelled projects included, since
  // each still has a row. Returns `wanted` (tidied) if free, else the next free "(n)".
  function uniqueTitle(wanted, existing) {
    const w = clean(wanted);
    if (!w) return w;
    const taken = new Set((existing || []).map(key));
    if (!taken.has(key(w))) return w;
    // "Harbor Lights (2)" typed when it exists becomes "(3)", not "(2) (2)".
    const base = w.replace(/\s*\(\d+\)$/, '') || w;
    for (let n = 2; n < 1000; n++) {
      const t = `${base} (${n})`;
      if (!taken.has(key(t))) return t;
    }
    return w;
  }

  // A series is matched without regard to case or spacing too, so "harbor lights" joins
  // "Harbor Lights" rather than starting a second series that would split its history. The
  // first spelling in use wins.
  function canonSeries(typed, existing) {
    const t = clean(typed);
    if (!t) return '';
    const hit = (existing || []).map(clean).find(e => e && key(e) === key(t));
    return hit || t;
  }

  const api = { clean, key, uniqueTitle, canonSeries };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PlannerTitles = api;
})(typeof window !== 'undefined' ? window : globalThis);
