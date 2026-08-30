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
      // Each booking in the cell is separately draggable: a cell holding two is one
      // square on screen but two different things you might mean, and dragging "the
      // cell" would silently pick one of them.
      let body = '';
      if (c) {
        body = c.items.map(it => {
          const label = c.items.length > 1 ? it.p : text;
          const shortL = label.length > 15 ? label.slice(0, 14) + '…' : label;
          return `<span class="bk" draggable="true" data-p="${esc(it.p)}" data-ph="${esc(it.ph)}"` +
                 ` data-from="${esc(n)}" data-wk="${w.start}"` +
                 (it.hand ? ' data-hand="1" title="Moved by hand — click to give it back"' : '') +
                 `>${esc(shortL)}</span>`;
        }).join('<span class="bksep"> / </span>');
      }
      h += `<td class="${cls}"${style} data-eng="${esc(n)}" data-wk="${w.start}"` +
           ` title="${esc(text)}">${body}</td>`;
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
  if (VIEW === 'schedule') wireDrag();
}

// ---------------------------------------------------------------- drag a week
// Weeks never move — only who does them — so a booking may only be dropped in its own
// row. Anything else is refused while the drag is in flight rather than explained
// afterwards.
let DRAG = null;

function wireDrag() {
  const wrap = document.querySelector('.gridwrap');
  if (!wrap) return;
  const clear = () => wrap.querySelectorAll('.dropok,.dropno,.dragging')
    .forEach(el => el.classList.remove('dropok', 'dropno', 'dragging'));

  wrap.querySelectorAll('.bk').forEach(el => {
    el.addEventListener('dragstart', ev => {
      DRAG = { p: el.dataset.p, ph: el.dataset.ph, from: el.dataset.from,
               wk: el.dataset.wk, row: el.closest('tr') };
      el.classList.add('dragging');
      try { ev.dataTransfer.setData('text/plain', DRAG.p); } catch (e) {}
      ev.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => { DRAG = null; clear(); });
  });

  wrap.querySelectorAll('.bk[data-hand]').forEach(el => {
    el.addEventListener('click', async ev => {
      ev.stopPropagation();
      if (!confirm(`Give this week back to the tool?\n\n${el.dataset.p} · ${el.dataset.ph}` +
                   `\nweek of ${el.dataset.wk}\n\nYour other manual changes stay.`)) return;
      const r = await post('/api/undo', { project: el.dataset.p, phase: el.dataset.ph,
                                          week_start: el.dataset.wk });
      if (!r.ok) return alert(r.error || 'Could not undo that.');
      absorb(r);
    });
  });

  wrap.querySelectorAll('td[data-eng]').forEach(td => {
    td.addEventListener('dragover', ev => {
      if (!DRAG) return;
      const sameWeek = td.closest('tr') === DRAG.row;
      const sameEng = td.dataset.eng === DRAG.from;
      if (sameWeek && !sameEng) {
        ev.preventDefault();                 // preventDefault IS "yes, drop here"
        ev.dataTransfer.dropEffect = 'move';
        td.classList.add('dropok');
      } else if (!sameWeek) td.classList.add('dropno');
    });
    td.addEventListener('dragleave', () => td.classList.remove('dropok', 'dropno'));
    td.addEventListener('drop', async ev => {
      ev.preventDefault();
      if (!DRAG || td.closest('tr') !== DRAG.row) { clear(); return; }
      const move = { project: DRAG.p, phase: DRAG.ph, week_start: DRAG.wk,
                     to_engineer: td.dataset.eng };
      DRAG = null; clear();
      await confirmMove(move);
    });
  });
}

// Two calls on purpose: the first asks what the move would cost and writes nothing,
// the second commits. Warning from data the client already holds would put the
// eligibility rules in two places and let them drift.
async function confirmMove(move) {
  const pre = await post('/api/reassign', move);
  if (!pre.ok) return alert(pre.error || 'Could not move that.');
  const lines = [`${move.project} · ${move.phase}`,
                 `week of ${move.week_start}`,
                 `${pre.from}  →  ${move.to_engineer}`];
  if (pre.warnings.length) lines.push('', ...pre.warnings.map(w => '• ' + w.text));
  lines.push('', 'Weeks never move — only who does them.');
  if (!confirm(lines.join('\n'))) return;
  const done = await post('/api/reassign', { ...move, confirmed: true });
  if (!done.ok) return alert(done.error || 'Could not move that.');
  absorb(done);
}

// A write hands back fresh state in the same response, so there is nothing to re-ask
// for. Re-asking is what made the old app feel slow, and a second read is also how it
// managed to keep showing the previous plan.
function absorb(r) {
  if (r.boot) BOOT = r.boot;
  if (r.schedule) SCHED = r.schedule;
  paint();
}

async function post(path, body) {
  const t0 = performance.now();
  const r = await fetch(path, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const out = await r.json();
  LAST_MS = performance.now() - t0;
  return out;
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
