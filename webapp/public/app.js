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
  let h = '<div class="gridwrap"><table class="sched byeng"><thead><tr><th class="corner">Week</th>';
  d.labels.forEach((n, i) => { h += `<th data-c="${i}">${esc(n)}</th>`; });
  h += '</tr></thead><tbody>';
  let lastQ = null;
  d.weeks.forEach((w, ci) => {
    const starts = w.quarter !== lastQ; lastQ = w.quarter;
    const cls = [starts ? 'qstart' : '', w.start === BOOT.today_week ? 'nowrow' : '']
      .filter(Boolean).join(' ');
    h += `<tr${cls ? ` class="${cls}"` : ''}><th>${numLabel(w)}</th>`;
    d.labels.forEach((n, ri) => {
      const c = d.cells[ri][ci];
      let cls = '', style = '', text = '';
      if (c) {
        const deep = c.depth || c.count || 1;
        text = c.text;
        if (c.count > 1) cls = deep > 2 ? 'dbl3' : 'dbl2';
        else style = ` style="background:${PHASE_BG[c.phase] || 'transparent'}"`;
        if (deep > 1) cls += (cls ? ' ' : '') + (deep > 2 ? 'over3' : 'over2');
        if (c.items.some(i => i.hand)) cls += (cls ? ' ' : '') + 'pinned';
      }
      // Each booking in the cell is separately draggable: a cell holding two is one
      // square on screen but two different things you might mean, and dragging "the
      // cell" would silently pick one of them.
      let body = '';
      if (c) {
        body = c.items.map(it => {
          const label = c.items.length > 1 ? it.p : text;
          return `<span class="bk" draggable="true" data-p="${esc(it.p)}" data-ph="${esc(it.ph)}"` +
                 ` data-from="${esc(n)}" data-wk="${w.start}"` +
                 (it.hand ? ' data-hand="1" title="Moved by hand — click to give it back"' : '') +
                 `>${esc(label)}</span>`;
        }).join('<span class="bksep"> / </span>');
      }
      h += `<td class="${cls}"${style} data-c="${ri}" data-eng="${esc(n)}"` +
           ` data-wk="${w.start}" title="${esc(text)}">${body}</td>`;
    });
    h += '</tr>';
  });
  h += '</tbody></table></div><div class="legend">' +
    '<span><span class="sw" style="background:var(--dub)"></span>Dub</span>' +
    '<span><span class="sw" style="background:var(--edit)"></span>Edit</span>' +
    '<span><span class="sw" style="background:var(--mix)"></span>Mix</span>' +
    '<span><span class="sw" style="background:var(--warn)"></span>2 at once</span>' +
    '<span><span class="sw" style="background:var(--red)"></span>3 at once</span>' +
    '<span><span class="sw" style="border:2px solid var(--warn);background:transparent"></span>2 overlaps this week</span>' +
    '<span><span class="sw" style="border:2px solid var(--red);background:transparent"></span>3 overlaps — reassign</span>' +
    '<span><span class="sw" style="border:2px dotted var(--fg1);background:transparent"></span>moved by hand — click to undo</span>' +
    '</div>';
  return h;
}

let SORT = 'deadline';

function renderProjects() {
  const byTitle = (a, b) =>
    String(a.title).localeCompare(String(b.title), undefined, { numeric: true });
  const ps = BOOT.projects.slice().sort(SORT === 'title' ? byTitle : (a, b) =>
    String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')) || byTitle(a, b));

  let h = '<div class="bar-row"><button class="btn primary" id="addBtn">+ Add project</button>' +
    '<div class="spacer"></div>' +
    `<button class="btn small${SORT === 'deadline' ? ' primary' : ''}" data-sort="deadline">Deadline</button>` +
    `<button class="btn small${SORT === 'title' ? ' primary' : ''}" data-sort="title">A\u2013Z</button>` +
    '<span class="hint" style="margin:0 0 0 12px">Click a row to edit it.</span></div>' +
    '<div id="formHost"></div>';

  h += '<table class="projects"><thead><tr><th>Deadline</th><th>Project</th><th>Client</th>' +
    '<th>D/E/M</th><th>Recordist</th><th>Mixer</th><th>Flags</th></tr></thead><tbody>';
  ps.forEach(p => {
    let flags = '';
    if (p.overlap > 2) flags += '<span class="chip red">3 overlaps</span>';
    else if (p.overlap) flags += '<span class="chip warn">2 overlaps</span>';
    if (p.music) flags += '<span class="chip">music</span>';
    if (p.special) flags += '<span class="chip">special</span>';
    if (p.atmos) flags += '<span class="chip">atmos</span>';
    const who = ph => [...new Set(p.rows.filter(r => r.phase === ph).map(r => r.engineer))]
      .join(' + ') || '\u2014';
    h += `<tr data-title="${esc(p.title)}"><td>${esc(p.deadline)}</td>` +
      `<td><b>${esc(p.title)}</b></td><td>${esc(p.client)}</td>` +
      `<td>${p.dub}/${p.edit}/${p.mix}</td><td>${esc(who('Dub'))}</td><td>${esc(who('Mix'))}</td>` +
      `<td>${flags}</td></tr>`;
  });
  return h + '</tbody></table>';
}

function wireProjects() {
  const add = $('addBtn');
  if (add) add.addEventListener('click', () => openForm(null));
  document.querySelectorAll('[data-sort]').forEach(b =>
    b.addEventListener('click', () => { SORT = b.dataset.sort; paint(); }));
  document.querySelectorAll('table.projects tbody tr').forEach(tr =>
    tr.addEventListener('click', () => openForm(tr.dataset.title)));
}

// ---------------------------------------------------------------- the form
// Check availability writes nothing and answers "can we take this job". Plot & save
// commits. Both go through the same engine call, so the answer you were shown is the
// answer you get.
function openForm(title) {
  const p = title ? BOOT.projects.find(x => x.title === title) : null;
  const opts = sel => ['Auto', ...BOOT.engineers]
    .map(n => `<option${n === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');

  $('formHost').innerHTML = `<div class="form${p ? ' editing' : ''}">
    <h3>${p ? 'Edit ' + esc(p.title) : 'Add project'}</h3>
    <div class="note">Check availability first if you are deciding whether to take the job.</div>
    <div class="fields">
      <div class="f"><label for="f_title">Project</label>
        <input type="text" id="f_title" value="${p ? esc(p.title) : ''}"></div>
      <div class="f"><label for="f_client">Client</label>
        <input type="text" id="f_client" list="clientList" value="${esc(p ? p.client : 'Netflix')}">
        <datalist id="clientList">${(BOOT.clients || []).map(c => `<option>${esc(c)}</option>`).join('')}</datalist></div>
      <div class="f"><label for="f_deadline">Deadline</label>
        <input type="date" id="f_deadline" value="${p ? esc(p.deadline) : ''}"></div>
      <div class="f"><label for="f_level">Mix level</label><select id="f_level">
        <option${p && p.mix_level === 'Developing' ? '' : ' selected'}>Advanced</option>
        <option${p && p.mix_level === 'Developing' ? ' selected' : ''}>Developing</option></select></div>
    </div>

    <div class="fields row2">
      <div class="f span2"><label>Weeks per phase</label><div class="phases">
        <div class="p"><input type="number" id="f_dub" min="0" max="52" value="${p ? p.dub : 0}">
          <div class="hint"><span class="sw" style="background:var(--dub)"></span>Dub</div></div>
        <div class="p"><input type="number" id="f_edit" min="0" max="52" value="${p ? p.edit : 0}">
          <div class="hint"><span class="sw" style="background:var(--edit)"></span>Edit</div></div>
        <div class="p"><input type="number" id="f_mix" min="0" max="52" value="${p ? p.mix : 0}">
          <div class="hint"><span class="sw" style="background:var(--mix)"></span>Mix</div></div>
      </div><div class="hint">Zero is valid \u2014 the phase does not exist. Phases plot backward from the deadline.</div></div>
      <div class="f span2"><label>Flags</label><div class="checks">
        <label><input type="checkbox" id="f_music"${p && p.music ? ' checked' : ''}> Music</label>
        <label><input type="checkbox" id="f_special"${p && p.special ? ' checked' : ''}> Special</label>
        <label><input type="checkbox" id="f_atmos"${p && p.atmos ? ' checked' : ''}> Atmos</label>
      </div><div class="hint">Atmos is separate from Special: Special routes the work to the
        specials engineer, Atmos means the mix needs the room.</div></div>
    </div>

    <div class="picks">
      <div class="pickhead">Who does it \u2014 leave on Auto and the engine decides</div>
      <div class="fields">
        <div class="f"><label for="f_rec">Recordist</label><select id="f_rec">${opts(p && p.recordist_pick)}</select></div>
        <div class="f"><label for="f_rec2">Second recordist</label><select id="f_rec2">${opts(p && p.recordist_pick_2)}</select>
          <div class="hint">Splits the dub between the two, first name taking the earlier weeks.</div></div>
        <div class="f"><label for="f_ed">Editor</label><select id="f_ed">${opts(p && p.editor_pick)}</select>
          <div class="hint">Auto keeps the edit with the recordist.</div></div>
        <div class="f"><label for="f_mixer">Mixer</label><select id="f_mixer">${opts(p && p.mixer_pick)}</select>
          <div class="hint">A manual pick overrides every rule and is flagged.</div></div>
      </div>
    </div>
    <div class="formactions">
      <button class="btn" id="f_check">Check availability</button>
      <button class="btn primary" id="f_save">${p ? 'Save &amp; re-plot' : 'Plot &amp; save'}</button>
      <button class="btn" id="f_close">Close</button>
    </div>
    <div id="f_out"></div></div>`;

  $('formHost').scrollIntoView({ block: 'nearest' });
  $('f_check').addEventListener('click', () => submitForm(p, true));
  $('f_save').addEventListener('click', () => submitForm(p, false));
  $('f_close').addEventListener('click', () => { $('formHost').innerHTML = ''; });
}

function formValues(p, dryRun) {
  return {
    title: $('f_title').value.trim(),
    original_title: p ? p.title : '',
    client: $('f_client').value.trim(),
    deadline: $('f_deadline').value,
    dub: +$('f_dub').value, edit: +$('f_edit').value, mix: +$('f_mix').value,
    mix_level: $('f_level').value,
    music: $('f_music').checked, special: $('f_special').checked, atmos: $('f_atmos').checked,
    recordist: $('f_rec').value, recordist2: $('f_rec2').value,
    editor: $('f_ed').value, mixer: $('f_mixer').value,
    dry_run: dryRun,
  };
}

async function submitForm(p, dryRun) {
  $('f_check').disabled = $('f_save').disabled = true;
  $('f_out').innerHTML = '<div class="muted">' + (dryRun ? 'Checking' : 'Plotting') + '\u2026</div>';
  const r = await post('/api/save-project', formValues(p, dryRun));
  $('f_check').disabled = $('f_save').disabled = false;

  if (!r.ok) {
    $('f_out').innerHTML = '<div class="errs"><b>Not plotted.</b><ul>' +
      (r.errors || []).map(e => `<li>${esc(e)}</li>`).join('') + '</ul></div>';
    return;
  }

  // Depth comes from the freshly returned book, so the banner and the row you see a
  // moment later cannot tell you different things.
  const deep = !dryRun && r.boot
    ? (r.boot.projects.find(x => x.title === r.title) || {}).overlap || 0 : 0;
  let h = `<div class="result ${deep > 2 ? 'alarm' : dryRun ? 'dry' : 'saved'}">` +
    `<h4>${dryRun ? 'Availability check \u2014 nothing was written' : 'Saved'}</h4>` +
    `<div class="kv"><b>Recordist</b><span>${esc(r.dubber || r.recordist)}</span></div>` +
    `<div class="kv"><b>Editor</b><span>${esc(r.editor || r.recordist)}</span></div>` +
    `<div class="kv"><b>Mixer</b><span>${esc(r.mixer)}</span></div>`;
  if (r.rows && r.rows.length) {
    h += '<table class="projects" style="margin-top:10px"><thead><tr><th>Phase</th>' +
      '<th>Engineer</th><th>From</th><th>To</th></tr></thead><tbody>' +
      r.rows.map(x => `<tr><td><span class="sw" style="background:${PHASE_BG[x.phase] || 'transparent'}"></span>` +
        `${esc(x.phase)}</td><td>${esc(x.engineer)}</td><td>${esc(x.start)}</td>` +
        `<td>${esc(x.end)}</td></tr>`).join('') + '</tbody></table>';
  }
  if (deep > 2) h += '<div class="msg">THREE AT ONCE \u2014 someone now holds three bookings in ' +
    'the same week. Reassign one of them.</div>';
  else if (deep) h += '<div class="msg soft">Two at once \u2014 someone doubles up for part of ' +
    'this run. Normal where a shoot is still recording while its edit starts.</div>';
  if (r.warnings) h += `<div class="msg">${esc(r.warnings)}</div>`;
  const note = [r.record_note, r.mix_note].filter(Boolean).join(' \u00b7 ');
  if (note) h += `<div class="muted">${esc(note)}</div>`;
  if (dryRun) h += '<div class="muted">Nothing saved yet. Press Plot &amp; save to commit.</div>';
  h += '</div>';

  if (!dryRun && r.boot) {
    BOOT = r.boot;
    if (r.schedule) SCHED = r.schedule;
    paint();
    // paint() rebuilt the page, so the result has to be re-hung on the new form host
    openForm(r.title);
  }
  $('f_out').innerHTML = h;
}

function paint() {
  $('view').innerHTML = VIEW === 'schedule' ? renderSchedule() : renderProjects();
  topRight();
  if (VIEW === 'schedule') { wireDrag(); wireColumnHover(); }
  else wireProjects();
}

// Delegated, and it only ever touches the column being left and the one being
// entered — eight class toggles per move rather than several hundred.
function wireColumnHover() {
  const wrap = document.querySelector('.gridwrap');
  if (!wrap) return;
  let current = null;
  const mark = (ci, on) => {
    if (ci === null) return;
    wrap.querySelectorAll(`[data-c="${ci}"]`).forEach(el => el.classList.toggle('colhi', on));
  };
  wrap.addEventListener('mouseover', e => {
    const cell = e.target.closest('[data-c]');
    const ci = cell ? cell.getAttribute('data-c') : null;
    if (ci === current) return;
    mark(current, false);
    current = ci;
    mark(current, true);
  });
  wrap.addEventListener('mouseleave', () => { mark(current, false); current = null; });
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
