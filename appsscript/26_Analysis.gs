// Analysis data (HANDOFF §7). All arithmetic — stats.js and capacity.gs share the
// work, nothing here is inferred. The web app renders it; this only assembles it.

// Called from the page. One round trip, everything the view needs.
function getAnalysisData() {
  var engineers = readEngineers();
  var bookings = readBookings();
  var problems = validateBook(bookings, engineers);
  var live = activeRows(bookings);

  if (!live.length) {
    return { empty: true, problems: problems, today: todayISO() };
  }

  var today = todayISO();
  var s = stats(bookings, engineers, today);
  var projects = readCommittedProjects().map(function (p) { return normalizeProject(p).project; });
  var cap = computeCapacity(live, engineers, projects, today);

  // Two things this page deliberately no longer reports (2026-08-13):
  //
  // The re-plan preview cards — a preview of a preview, since the Re-plan tab shows
  // the same figures plus the actual change list, and filling them cost a FULL
  // 202-ordering solve on every Analysis load. HANDOFF §7 item 10 lives there now.
  //
  // The manual-pin count, presented as a process-health metric. Tara's point: a pin
  // is often the CORRECT answer to something the tool was never meant to know. Leave
  // and availability are deliberately not modelled — the loc lead asked for that to
  // stay human judgment (HANDOFF §9) — so the manual pick IS the intended mechanism,
  // and counting pins cannot distinguish a wrong rule from a right decision.
  // The header pill still shows the count; stats.js still computes
  // manual_assignments for anyone who wants the detail.

  return {
    empty: false,
    today: today,
    problems: problems,
    horizon: s.horizon,
    totals: s.totals,
    engineers: s.engineers,
    by_quarter: s.by_quarter,
    // NOT s.forced_overlaps. The engine builds that from rows carrying a FORCED note,
    // which records what it decided at the time it decided it. A later change — a
    // swap, a divided dub, another project moving — resolves the collision and the
    // note stays; and a project can BECOME doubled with no note at all, because the
    // clash came from someone else's placement. Both were happening at once after a
    // re-plan: Campioni flagged with nobody doubled, Blue Box and The Good Lawyer
    // doubled with no flag. Counted from the weeks, it cannot go stale.
    forced_overlaps: actualOverlaps_(live),
    capacity: cap,
  };
}
