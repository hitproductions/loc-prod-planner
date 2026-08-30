// Everything is fetched once and rendered from memory. The measured round trip is
// shown in the header on purpose: the reason this app exists is speed, so the number
// that justifies it should be visible rather than claimed.
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

let BOOT = null, SCHED = null, VIEW = 'schedule', LAST_MS = null;

async function get(path) {
  const t0 = performance.now();
  const r = await fetch(path);
  const body = await r.json();
  LAST_MS = performance.now() - t0;
  return body;
}

function topRight() {
  const c = BOOT.counts;
  const wk = n => n + (n === 1 ? ' week' : ' weeks');
  const bits = [`<span class="pill">${c.projects} projects · ${c.live_rows} bookings</span>`];
  if (c.over2) bits.push(`<span class="pill warn">${wk(c.over2)} with 2 overlaps</span>`);
  if (c.over3) bits.push(`<span class="pill bad">${wk(c.over3)} with 3+ overlaps</span>`);
  if (LAST_MS != null) bits.push(`<span class="pill timing">${LAST_MS.toFixed(0)} ms</span>`);
  $('topright').innerHTML = bits.join('');
}

function numLabel(w) {
  const d = new Date(w.start + 'T00:00:00Z');
  const e = new Date(d); e.setUTCDate(e.getUTCDate() + 6);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth()+1)}/${p(d.getUTCDate())} - ${p(e.getUTCMonth()+1)}/${p(e.getUTCDate())}`;
}

const PHASE_BG = { Dub:'var(--dub)', Edit:'var(--edit)', Mix:'var(--mix)' };

function renderSchedule() {
  const d = SCHED;
  if (d.empty) return '<div class="loading">No bookings yet.</div>';
  let h = '<div class="gridwrap"><table class="sched"><thead><tr><th class="corner">Week</th>';
  d.labels.forEach(n => { h += `<th>${esc(n)}</th>`; });
  h += '</tr></thead><tbody>';
  let lastQ = null;
  d.weeks.forEach((w, ci) => {
    const starts = w.quarter !== lastQ; lastQ = w.quarter;
    h += `<tr${starts ? ' class="qstart"' : ''}><th>${numLabel(w)}</th>`;
    d.labels.forEach((n, ri) => {
      const c = d.cells[ri][ci];
      let cls = '', style = '', text = '';
      if (c) {
        const deep = c.depth || c.count || 1;
        text = c.text;
        if (c.count > 1) cls = deep > 2 ? 'dbl3' : 'dbl2';
        else style = ` style="background:${PHASE_BG[c.phase] || 'transparent'}"`;
        if (deep > 1) cls += (cls ? ' ' : '') + (deep > 2 ? 'over3' : 'over2');
      }
      const short = text.length > 15 ? text.slice(0, 14) + '…' : text;
      h += `<td class="${cls}"${style} title="${esc(text)}">${esc(short)}</td>`;
    });
    h += '</tr>';
  });
  h += '</tbody></table></div><div class="legend">' +
    '<span><span class="sw" style="background:var(--dub)"></span>Dub</span>' +
    '<span><span class="sw" style="background:var(--edit)"></span>Edit</span>' +
    '<span><span class="sw" style="background:var(--mix)"></span>Mix</span>' +
    '<span><span class="sw" style="border:2px solid var(--warn);background:transparent"></span>2 overlaps this week</span>' +
    '<span><span class="sw" style="border:2px solid var(--red);background:transparent"></span>3 overlaps — reassign</span>' +
    '</div>';
  return h;
}

function renderProjects() {
  const ps = BOOT.projects.slice().sort((a, b) =>
    String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
  let h = '<table class="projects"><thead><tr><th>Deadline</th><th>Project</th><th>Client</th>' +
    '<th>D/E/M</th><th>Flags</th></tr></thead><tbody>';
  ps.forEach(p => {
    let flags = '';
    if (p.overlap > 2) flags += '<span class="chip red">3 overlaps</span>';
    else if (p.overlap) flags += '<span class="chip warn">2 overlaps</span>';
    if (p.music) flags += '<span class="chip">music</span>';
    if (p.special) flags += '<span class="chip">special</span>';
    if (p.atmos) flags += '<span class="chip">atmos</span>';
    h += `<tr><td>${esc(p.deadline)}</td><td><b>${esc(p.title)}</b></td><td>${esc(p.client)}</td>` +
      `<td>${p.dub}/${p.edit}/${p.mix}</td><td>${flags}</td></tr>`;
  });
  return h + '</tbody></table>';
}

function paint() {
  $('view').innerHTML = VIEW === 'schedule' ? renderSchedule() : renderProjects();
  topRight();
}

document.querySelectorAll('.nav button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.nav button').forEach(x => x.classList.toggle('on', x === b));
    VIEW = b.dataset.view;
    paint();               // no fetch — both views come from what we already hold
  });
});

(async () => {
  BOOT = await get('/api/bootstrap');
  SCHED = await get('/api/schedule');
  paint();
})();
