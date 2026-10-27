// Reading and checking the dates typed into the Add project form.
//
// Pure on purpose: no page, no clock of its own (the caller says what day it is). It is
// loaded by the page and by the tests, so the forgiving date reading -- the part most
// likely to quietly misread -- is tested rather than trusted.
(function (root) {
  const DAYMS = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PHASES = ['dub', 'edit', 'mix'];
  const monthIndex = x => MONTHS.findIndex(n => n.toLowerCase() === String(x).slice(0, 3).toLowerCase());

  // Dates are typed in whatever form comes naturally: 2 Nov, Nov 2, 11/2, 2026-11-02.
  // Returns epoch milliseconds (UTC midnight), null for blank, NaN for "cannot read that".
  // A slash date is month/day, as the rest of the app shows it. With no year typed it is
  // THIS year, unless that lands well in the past ("2 Jan" typed in December).
  function parseDay(raw, todayISO) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    const thisYear = Number(String(todayISO).slice(0, 4));
    const todayMs = Date.parse(todayISO + 'T00:00:00Z');
    // Date.UTC is forgiving: 30 Feb becomes 2 March, and month 30 becomes a year and a half
    // on. A typed day has to be a real day, so everything goes through here.
    const real = (y, m, d) => {
      const t = Date.UTC(y, m, d), x = new Date(t);
      return x.getUTCFullYear() === y && x.getUTCMonth() === m && x.getUTCDate() === d ? t : NaN;
    };
    const guess = (m, d) => {
      const t = real(thisYear, m, d);
      return !Number.isNaN(t) && t < todayMs - 183 * DAYMS ? real(thisYear + 1, m, d) : t;
    };
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return real(+m[1], m[2] - 1, +m[3]);
    if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s)))
      return m[3] ? real(+m[3] < 100 ? 2000 + +m[3] : +m[3], m[1] - 1, +m[2]) : guess(m[1] - 1, +m[2]);
    if ((m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?(?:\s+(\d{4}))?$/.exec(s)) && monthIndex(m[2]) >= 0)
      return m[3] ? real(+m[3], monthIndex(m[2]), +m[1]) : guess(monthIndex(m[2]), +m[1]);
    if ((m = /^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(s)) && monthIndex(m[1]) >= 0)
      return m[3] ? real(+m[3], monthIndex(m[1]), +m[2]) : guess(monthIndex(m[1]), +m[2]);
    return NaN;
  }

  const isoOf = t => new Date(t).toISOString().slice(0, 10);
  const mondayOf = t => { const dow = (new Date(t).getUTCDay() + 6) % 7; return t - dow * DAYMS; };

  // The form's own reading of the phases, mirroring the server's rules so a mistake shows
  // next to the box that caused it. The server is still the authority.
  //   input: { deadline, phases: { dub: {a, b}, edit: {a, b}, mix: {a, b} } }
  //   a/b are what parseDay returned. Returns { phases, errors, used } where each phase is
  //   { a, b, none, snapped: [mondayOfStart, mondayOfEnd] | null } and errors is a list per phase.
  function checkPhases(input) {
    const labels = { dub: 'Dub', edit: 'Edit', mix: 'Mix' };
    const out = { phases: {}, errors: {}, used: [] };
    PHASES.forEach(k => {
      const a = input.phases[k].a, b = input.phases[k].b, e = [];
      const none = a === null && b === null;
      const ph = { a, b, none, snapped: null };
      if (!none) {
        if (a === null || b === null) e.push(`${labels[k]} needs both a start and an end.`);
        else if (Number.isNaN(a) || Number.isNaN(b)) e.push('That is not a date I can read.');
        else if (mondayOf(a) > mondayOf(b)) e.push(`${labels[k]} ends before it starts.`);
        else ph.snapped = [mondayOf(a), mondayOf(b)];
      }
      out.phases[k] = ph; out.errors[k] = e;
    });
    const sn = k => out.phases[k].snapped;
    // Any phase may overlap any other. The only order kept: a phase cannot BEGIN before the
    // one it works on has begun.
    if (sn('dub') && sn('edit') && sn('edit')[0] < sn('dub')[0]) out.errors.edit.push('Edit cannot start before the dub starts.');
    if (sn('edit') && sn('mix') && sn('mix')[0] < sn('edit')[0]) out.errors.mix.push('Mix cannot start before the edit starts.');
    if (sn('dub') && sn('mix') && !sn('edit') && sn('mix')[0] < sn('dub')[0]) out.errors.mix.push('Mix cannot start before the dub starts.');
    const dl = input.deadline;
    if (dl != null && !Number.isNaN(dl))
      PHASES.forEach(k => { if (sn(k) && sn(k)[1] > mondayOf(dl)) out.errors[k].push('Ends after the deadline.'); });
    out.used = PHASES.filter(k => sn(k));
    return out;
  }

  const api = { DAYMS, MONTHS, PHASES, parseDay, isoOf, mondayOf, checkPhases };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PlannerDates = api;
})(typeof window !== 'undefined' ? window : globalThis);
