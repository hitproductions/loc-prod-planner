function computeStats(bookingRows, engineerRows, todayISO) {
  const W0 = Date.UTC(2025, 11, 1), DAY = 86400000;
  const widx = s => Math.floor((Date.parse(s + 'T00:00:00Z') - W0) / (7 * DAY));
  const wstart = i => new Date(W0 + i * 7 * DAY).toISOString().slice(0, 10);
  const wend = i => new Date(W0 + (i * 7 + 6) * DAY).toISOString().slice(0, 10);
  const qOf = i => { const d = new Date(W0 + i * 7 * DAY);
    return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };
  const yes = v => String(v).trim().toLowerCase() === 'yes';

  const rows = bookingRows.filter(b => b && b.engineer && b.start_date && b.end_date);
  const names = engineerRows.filter(e => e && e.name).map(e => e.name);
  const roster = {};
  for (const e of engineerRows) if (e && e.name) roster[e.name] = {
    mix_level: e.mix_level || '', can_mix: yes(e.can_mix),
    overflow_only: yes(e.overflow_only), non_netflix_router: yes(e.non_netflix_router) };

  const byEng = {};
  for (const n of names) byEng[n] = { weeks: new Map(), projects: new Set() };
  let minW = Infinity, maxW = -Infinity;
  for (const b of rows) {
    const a = widx(b.start_date), z = widx(b.end_date);
    if (!byEng[b.engineer]) byEng[b.engineer] = { weeks: new Map(), projects: new Set() };
    for (let w = a; w <= z; w++) {
      if (!byEng[b.engineer].weeks.has(w)) byEng[b.engineer].weeks.set(w, []);
      byEng[b.engineer].weeks.get(w).push(`${b.project} (${b.phase})`);
      if (w < minW) minW = w; if (w > maxW) maxW = w;
    }
    byEng[b.engineer].projects.add(b.project);
  }
  if (!rows.length) return { horizon: null, engineers: [], note: 'No bookings recorded yet.' };

  const horizonWeeks = maxW - minW + 1;
  const nowW = todayISO ? widx(todayISO) : null;

  const engineers = Object.keys(byEng).map(n => {
    const ws = [...byEng[n].weeks.keys()].sort((a, b) => a - b);
    let longestGap = 0, gapFrom = null, gapTo = null;
    for (let i = 1; i < ws.length; i++) {
      const g = ws[i] - ws[i - 1] - 1;
      if (g > longestGap) { longestGap = g; gapFrom = ws[i - 1] + 1; gapTo = ws[i] - 1; }
    }
    const doubles = ws.filter(w => byEng[n].weeks.get(w).length > 1)
      .map(w => ({ week_of: wstart(w), projects: byEng[n].weeks.get(w) }));
    const future = nowW === null ? ws : ws.filter(w => w >= nowW);
    return {
      engineer: n,
      role: [roster[n]?.can_mix ? `mixer (${roster[n].mix_level || 'unrated'})` : 'record/edit only',
             roster[n]?.overflow_only ? 'overflow only' : '',
             roster[n]?.non_netflix_router ? 'non-Netflix router' : ''].filter(Boolean).join(', '),
      weeks_booked: ws.length,
      weeks_booked_from_today: future.length,
      utilization_pct: Math.round((ws.length / horizonWeeks) * 1000) / 10,
      projects: byEng[n].projects.size,
      first_week: ws.length ? wstart(ws[0]) : null,
      last_week: ws.length ? wend(ws[ws.length - 1]) : null,
      longest_idle_weeks: longestGap,
      longest_idle_window: longestGap ? `${wstart(gapFrom)} to ${wend(gapTo)}` : null,
      double_booked_weeks: doubles,
    };
  }).sort((a, b) => b.weeks_booked - a.weeks_booked);

  const quarters = {};
  for (const n of Object.keys(byEng)) for (const w of byEng[n].weeks.keys()) {
    const q = qOf(w); quarters[q] = quarters[q] || {};
    quarters[q][n] = (quarters[q][n] || 0) + 1;
  }

  const loads = engineers.map(e => e.weeks_booked);
  const flagged = rows.filter(b => /FORCED/i.test(b.note || ''));
  const manual = rows.filter(b => /manual/i.test(b.note || ''));
  const special = rows.filter(b => /special/i.test(b.note || ''));

  return {
    horizon: { from: wstart(minW), to: wend(maxW), weeks: horizonWeeks },
    generated_for_week_of: nowW === null ? null : wstart(nowW),
    totals: {
      engineers: engineers.length, booking_rows: rows.length,
      projects: new Set(rows.map(b => b.project)).size,
      busiest: engineers[0]?.engineer, quietest: engineers[engineers.length - 1]?.engineer,
      load_spread_weeks: Math.max(...loads) - Math.min(...loads),
      mean_weeks: Math.round((loads.reduce((a, b) => a + b, 0) / loads.length) * 10) / 10,
    },
    engineers,
    by_quarter: quarters,
    forced_overlaps: flagged.map(b => ({ project: b.project, phase: b.phase, engineer: b.engineer, start: b.start_date })),
    manual_assignments: manual.map(b => ({ project: b.project, phase: b.phase, engineer: b.engineer })),
    special_projects: [...new Set(special.map(b => b.project))],
  };
}
module.exports = { computeStats };
