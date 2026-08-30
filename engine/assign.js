function runAssign(proj, bookingRows, engineerRows) {
  const W0 = Date.UTC(2025, 11, 1), DAY = 86400000;
  const widx = s => Math.floor((Date.parse(s + 'T00:00:00Z') - W0) / (7 * DAY));
  const wstart = i => new Date(W0 + i * 7 * DAY).toISOString().slice(0, 10);
  const wend = i => new Date(W0 + (i * 7 + 6) * DAY).toISOString().slice(0, 10);
  const block = (endW, n) => { const s = new Set(); for (let w = endW - n + 1; w <= endW; w++) s.add(w); return n > 0 ? s : new Set(); };
  const yes = v => String(v).trim().toLowerCase() === 'yes';
  const inter = (a, b) => [...a].filter(x => b.has(x));
  const warnings = [];

  const eng = {};
  for (const r of engineerRows) {
    if (!r.name) continue;
    eng[r.name] = { record: yes(r.can_record), edit: yes(r.can_edit), mix: yes(r.can_mix),
      lvl: (r.mix_level || '').trim(), music: yes(r.music_specialist),
      overflow: yes(r.overflow_only), nonNetflix: yes(r.non_netflix_router),
      busy: new Set(), load: 0, last: null };
  }
  for (const b of bookingRows) {
    const e = eng[b.engineer]; if (!e || !b.start_date || !b.end_date) continue;
    for (let w = widx(b.start_date); w <= widx(b.end_date); w++) {
      e.busy.add(w); if (e.last === null || w > e.last) e.last = w;
    }
  }
  for (const n in eng) eng[n].load = eng[n].busy.size;

  const dlW = widx(proj.deadline);
  const d = proj.dub_weeks, ed = proj.edit_weeks, m = proj.mix_weeks;
  const mixw = block(dlW - 1, m);
  const editEnd = mixw.size ? Math.min(...mixw) - 1 : dlW - 1;
  const editw = block(editEnd, ed);
  const dubEnd = editw.size ? Math.min(...editw) - 1 : editEnd;
  const dubw = block(dubEnd, d);
  const recedit = new Set([...dubw, ...editw]);

  const gap = (n, ref) => eng[n].last === null ? 1e9 : ref - eng[n].last;
  const free = (n, wks) => inter(eng[n].busy, wks).length === 0;
  const commit = (n, wks, weeks) => {
    for (const w of wks) { eng[n].busy.add(w); if (eng[n].last === null || w > eng[n].last) eng[n].last = w; }
    eng[n].load += weeks;
  };
  const pick = (pool, ref) => {
    if (!pool.length) return null;
    const min = Math.min(...pool.map(e => eng[e].load));
    return pool.filter(e => eng[e].load === min).sort((a, b) => (gap(b, ref) - gap(a, ref)) || a.localeCompare(b))[0];
  };
  const forcePick = (pool, wks) => pool.slice().sort((a, b) =>
    (inter(eng[a].busy, wks).length - inter(eng[b].busy, wks).length) ||
    (eng[a].load - eng[b].load) ||
    (gap(b, Math.min(...wks)) - gap(a, Math.min(...wks))) || a.localeCompare(b))[0];
  const tryShare = (pool, needed) => {
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j];
      const fa = new Set([...needed].filter(w => !eng[a].busy.has(w)));
      const fb = new Set([...needed].filter(w => !eng[b].busy.has(w)));
      if ([...needed].some(w => !fa.has(w) && !fb.has(w))) continue;
      const onlyA = [...needed].filter(w => !fb.has(w));
      const onlyB = [...needed].filter(w => !fa.has(w));
      const either = [...needed].filter(w => !onlyA.includes(w) && !onlyB.includes(w)).sort((x, y) => x - y);
      const wa = new Set(onlyA), wb = new Set(onlyB);
      for (const w of either) { if (eng[a].load + wa.size <= eng[b].load + wb.size) wa.add(w); else wb.add(w); }
      if (wa.size && wb.size) return [[a, wa], [b, wb]];
    }
    return null;
  };

  const isMusic = yes(proj.music_songs);
  const isSpecial = yes(proj.special_project);
  const isNetflix = String(proj.client).trim() === 'Netflix';
  const recOv = (proj.recordist_override || 'Auto').trim();
  const mixOv = (proj.mixer_override || 'Auto').trim();
  const manual = v => v && v !== 'Auto' && v !== '';

  let pool;
  if (!isNetflix) pool = Object.keys(eng).filter(n => eng[n].nonNetflix);
  else {
    pool = Object.keys(eng).filter(n => eng[n].record && eng[n].edit && !eng[n].nonNetflix && !eng[n].overflow);
    if (isMusic) pool = pool.concat(Object.keys(eng).filter(n => eng[n].music));
  }

  let rec = null, recNote = '', assignments = [];

  if (manual(recOv)) {
    if (!eng[recOv]) { warnings.push(`Unknown engineer "${recOv}" — record/edit left unassigned.`); rec = 'UNRESOLVED'; }
    else {
      const overlap = inter(eng[recOv].busy, recedit).length;
      if (overlap) warnings.push(`${recOv} was manually assigned to record/edit but is already booked ${overlap} of those weeks.`);
      if (!isNetflix && !eng[recOv].nonNetflix) warnings.push(`${proj.client} normally routes to the non-Netflix engineer; ${recOv} was chosen manually instead.`);
      if (!eng[recOv].record || !eng[recOv].edit) warnings.push(`${recOv} is not normally a recordist/editor but was assigned manually.`);
      if (recedit.size) { commit(recOv, recedit, d + ed); assignments.push(['Dub', recOv, dubw], ['Edit', recOv, editw]); }
      rec = recOv; recNote = 'Manually assigned.';
    }
  } else if (!recedit.size) {
    rec = '—';
  } else {
    const samePool = pool.filter(n => free(n, recedit));
    const samePick = samePool.length ? pick(samePool, Math.min(...recedit)) : null;
    const dubPool = pool.filter(n => !dubw.size || free(n, dubw));
    const editPool = pool.filter(n => !editw.size || free(n, editw));
    const dubPick = dubw.size ? (dubPool.length ? pick(dubPool, Math.min(...dubw)) : null) : (pool[0] || null);
    const editPick = editw.size ? (editPool.length ? pick(editPool, Math.min(...editw)) : null) : (pool[0] || null);
    const splitOk = (!dubw.size || dubPick) && (!editw.size || editPick);
    if (samePick) {
      let useSplit = false;
      if (splitOk && dubPick !== editPick && dubw.size && editw.size) {
        const sameLoad = eng[samePick].load + d + ed;
        const splitLoad = Math.max(eng[dubPick].load + d, eng[editPick].load + ed);
        if (splitLoad < sameLoad) useSplit = true;
      }
      if (useSplit) {
        commit(dubPick, dubw, d); commit(editPick, editw, ed);
        rec = `${dubPick} (dub) / ${editPick} (edit)`;
        recNote = 'Split by choice to balance load — both were free; splitting kept the higher workload lower.';
        assignments.push(['Dub', dubPick, dubw], ['Edit', editPick, editw]);
      } else {
        commit(samePick, recedit, d + ed); rec = samePick;
        assignments.push(['Dub', samePick, dubw], ['Edit', samePick, editw]);
      }
    } else if (splitOk) {
      if (dubPick === editPick) {
        commit(dubPick, recedit, d + ed); rec = dubPick;
        assignments.push(['Dub', dubPick, dubw], ['Edit', dubPick, editw]);
      } else {
        commit(dubPick, dubw, d); commit(editPick, editw, ed);
        rec = `${dubPick} (dub) / ${editPick} (edit)`;
        recNote = 'No one free for the whole block — split by necessity.';
        assignments.push(['Dub', dubPick, dubw], ['Edit', editPick, editw]);
      }
    } else {
      const shared = tryShare(pool, recedit);
      if (shared) {
        const [[a, wa], [b, wb]] = shared;
        commit(a, wa, wa.size); commit(b, wb, wb.size);
        rec = `${a} + ${b}`;
        recNote = `Shared within a phase — ${a}: ${wa.size}wk | ${b}: ${wb.size}wk`;
        assignments.push(['Dub+Edit', a, wa], ['Dub+Edit', b, wb]);
      } else {
        const f = forcePick(pool, recedit);
        const ov = inter(eng[f].busy, recedit).length;
        commit(f, recedit, d + ed); rec = f;
        recNote = `FORCED OVERLAP to hit the deadline — ${f} was already committed ${ov} of these weeks elsewhere; no free single engineer, split, or pair existed.`;
        assignments.push(['Dub', f, dubw], ['Edit', f, editw]);
      }
    }
  }

  let mixer = null, mixNote = '';
  if (!mixw.size) {
    mixer = '—';
  } else if (manual(mixOv)) {
    if (!eng[mixOv]) { warnings.push(`Unknown engineer "${mixOv}" — mix left unassigned.`); mixer = 'UNRESOLVED'; }
    else {
      const overlap = inter(eng[mixOv].busy, mixw).length;
      if (overlap) warnings.push(`${mixOv} was manually assigned to mix but is already booked ${overlap} of those weeks.`);
      if (!eng[mixOv].mix) warnings.push(`${mixOv} is not normally a mixer but was assigned manually.`);
      if (String(proj.mix_level_required).trim() === 'Advanced' && eng[mixOv].lvl !== 'Advanced')
        warnings.push(`${mixOv} is ${eng[mixOv].lvl || 'unrated'}-level and this project needs an Advanced mix — the manual choice was applied anyway.`);
      commit(mixOv, mixw, m); mixer = mixOv; mixNote = 'Manually assigned.';
      assignments.push(['Mix', mixOv, mixw]);
    }
  } else {
    const needAdv = String(proj.mix_level_required).trim() === 'Advanced';
    const regular = Object.keys(eng).filter(n => eng[n].mix && !eng[n].overflow &&
      (needAdv ? eng[n].lvl === 'Advanced' : eng[n].lvl === 'Developing'));
    let mixPool = regular.filter(n => free(n, mixw));
    if (isMusic) mixPool = mixPool.concat(Object.keys(eng).filter(n => eng[n].music && eng[n].mix && free(n, mixw)));
    if (mixPool.length) { mixer = pick(mixPool, Math.min(...mixw)); commit(mixer, mixw, m); }
    else {
      const overflow = Object.keys(eng).filter(n => eng[n].overflow && eng[n].mix && (!needAdv || eng[n].lvl === 'Advanced') && free(n, mixw));
      if (overflow.length) {
        mixer = pick(overflow, Math.min(...mixw)); commit(mixer, mixw, m);
        mixNote = `${mixer} — overflow; the regular ${needAdv ? 'Advanced' : 'Developing'} mixers were all busy those weeks.`;
      } else {
        const all = regular.concat(Object.keys(eng).filter(n => eng[n].overflow && eng[n].mix && (!needAdv || eng[n].lvl === 'Advanced')));
        const f = forcePick(all, mixw);
        const ov = inter(eng[f].busy, mixw).length;
        commit(f, mixw, m); mixer = f;
        mixNote = `FORCED OVERLAP to hit the deadline — ${f} was already committed ${ov} of these weeks elsewhere. Developing-level engineers stay barred from Advanced mixing unless assigned by hand.`;
      }
    }
    assignments.push(['Mix', mixer, mixw]);
  }

  const booking_rows = assignments.filter(([, n, w]) => n && w.size).map(([phase, n, w]) => ({
    project: proj.project_title, phase, engineer: n,
    start_date: wstart(Math.min(...w)), end_date: wend(Math.max(...w)),
    source: 'plot',
    note: [isSpecial ? 'special' : '', /FORCED/.test(phase === 'Mix' ? mixNote : recNote) ? 'FORCED OVERLAP' : '',
           (phase === 'Mix' ? manual(mixOv) : manual(recOv)) ? 'manual' : ''].filter(Boolean).join(' / '),
  }));

  return { ...proj,
    recordist: rec, mixer: mixer || '—', record_note: recNote, mix_note: mixNote,
    warnings: warnings.join(' | '),
    dub_start: dubw.size ? wstart(Math.min(...dubw)) : '', dub_end: dubw.size ? wend(Math.max(...dubw)) : '',
    edit_start: editw.size ? wstart(Math.min(...editw)) : '', edit_end: editw.size ? wend(Math.max(...editw)) : '',
    mix_start: mixw.size ? wstart(Math.min(...mixw)) : '', mix_end: mixw.size ? wend(Math.max(...mixw)) : '',
    forced: /FORCED/.test(recNote + mixNote), has_warnings: warnings.length > 0,
    booking_rows };
}
module.exports = { runAssign };
