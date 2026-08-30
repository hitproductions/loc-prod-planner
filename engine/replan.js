function replan(projectRows, bookingRows, engineerRows, todayISO) {
  const W0 = Date.UTC(2025, 11, 1), DAY = 86400000;
  const widx = s => Math.floor((Date.parse(String(s).slice(0,10) + 'T00:00:00Z') - W0) / (7 * DAY));
  const wstart = i => new Date(W0 + i * 7 * DAY).toISOString().slice(0, 10);
  const wend = i => new Date(W0 + (i * 7 + 6) * DAY).toISOString().slice(0, 10);
  const block = (endW, n) => { const s = new Set(); for (let w = endW - n + 1; w <= endW; w++) s.add(w); return n > 0 ? s : new Set(); };
  const yes = v => String(v).trim().toLowerCase() === 'yes';
  const num = v => { const n = parseInt(String(v).trim(), 10); return Number.isFinite(n) && n > 0 ? n : 0; };
  const inter = (a, b) => [...a].filter(x => b.has(x));
  const nowW = widx(todayISO);

  // ---- roster ----
  const base = {};
  for (const r of engineerRows) if (r && r.name) base[r.name] = {
    record: yes(r.can_record), edit: yes(r.can_edit), mix: yes(r.can_mix),
    lvl: (r.mix_level || '').trim(), music: yes(r.music_specialist),
    overflow: yes(r.overflow_only), nonNetflix: yes(r.non_netflix_router) };

  // ---- split the book ----
  const active = bookingRows.filter(b => b && b.engineer && b.start_date &&
    String(b.status || '').trim().toLowerCase() !== 'superseded');
  const isLocked = b => widx(b.start_date) <= nowW || /manual/i.test(b.note || '');
  const locked = active.filter(isLocked);
  const movable = active.filter(b => !isLocked(b));

  const lockedKey = new Set(locked.map(b => `${b.project}||${b.phase}`));
  const currentBy = {};
  for (const b of active) (currentBy[`${b.project}||${b.phase}`] ||= []).push(b);

  // ---- engineer state, pre-blocked with locked work ----
  const eng = {};
  for (const n in base) eng[n] = { ...base[n], busy: new Set(), load: 0, last: null };
  for (const b of locked) {
    const e = eng[b.engineer]; if (!e) continue;
    for (let w = widx(b.start_date); w <= widx(b.end_date); w++) {
      e.busy.add(w); e.load++; if (e.last === null || w > e.last) e.last = w;
    }
  }

  const gap = (n, ref) => eng[n].last === null ? 1e9 : ref - eng[n].last;
  const free = (n, wks) => inter(eng[n].busy, wks).length === 0;
  const commit = (n, wks) => { for (const w of wks) { eng[n].busy.add(w); eng[n].load++;
    if (eng[n].last === null || w > eng[n].last) eng[n].last = w; } };
  const pick = (pool, ref) => { if (!pool.length) return null;
    const m = Math.min(...pool.map(e => eng[e].load));
    return pool.filter(e => eng[e].load === m).sort((a,b) => (gap(b,ref)-gap(a,ref)) || a.localeCompare(b))[0]; };
  const forcePick = (pool, wks) => pool.slice().sort((a,b) =>
    (inter(eng[a].busy,wks).length - inter(eng[b].busy,wks).length) ||
    (eng[a].load - eng[b].load) || a.localeCompare(b))[0];
  const tryShare = (pool, needed) => {
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j];
      const fa = new Set([...needed].filter(w => !eng[a].busy.has(w)));
      const fb = new Set([...needed].filter(w => !eng[b].busy.has(w)));
      if ([...needed].some(w => !fa.has(w) && !fb.has(w))) continue;
      const onlyA = [...needed].filter(w => !fb.has(w));
      const onlyB = [...needed].filter(w => !fa.has(w));
      const either = [...needed].filter(w => !onlyA.includes(w) && !onlyB.includes(w)).sort((x,y) => x - y);
      const wa = new Set(onlyA), wb = new Set(onlyB);
      for (const w of either) { if (eng[a].load + wa.size <= eng[b].load + wb.size) wa.add(w); else wb.add(w); }
      if (wa.size && wb.size) return [[a, wa], [b, wb]];
    }
    return null;
  };

  // ---- replay every project in deadline order ----
  const projects = projectRows.filter(p => p && p.project_title && p.deadline)
    .sort((a,b) => String(a.deadline).localeCompare(String(b.deadline)));
  const proposed = [];
  let forcedCount = 0, sharedCount = 0;

  for (const p of projects) {
    const title = p.project_title;
    const d = num(p.dub_weeks), ed = num(p.edit_weeks), m = num(p.mix_weeks);
    const dlW = widx(p.deadline);
    const mixw = block(dlW - 1, m);
    const editEnd = mixw.size ? Math.min(...mixw) - 1 : dlW - 1;
    const editw = block(editEnd, ed);
    const dubEnd = editw.size ? Math.min(...editw) - 1 : editEnd;
    const dubw = block(dubEnd, d);
    const isMusic = yes(p.music_songs);
    const isNetflix = String(p.client).trim() === 'Netflix';
    const needAdv = String(p.mix_level_required).trim() !== 'Developing';

    const keepPhase = ph => lockedKey.has(`${title}||${ph}`) || lockedKey.has(`${title}||Dub+Edit`);
    const emit = (phase, engName, wks, note) => {
      if (!engName || !wks.size) return;
      proposed.push({ project: title, phase, engineer: engName,
        start_date: wstart(Math.min(...wks)), end_date: wend(Math.max(...wks)),
        source: 'replan', note: note || '' });
    };

    // record/edit
    const reWks = new Set([...dubw, ...editw]);
    if (reWks.size) {
      if (keepPhase('Dub') || keepPhase('Edit')) {
        for (const ph of ['Dub','Edit','Dub+Edit']) for (const b of (currentBy[`${title}||${ph}`] || []))
          proposed.push({ ...b, source: b.source || 'kept', note: (b.note || '') });
      } else {
        let pool = isNetflix
          ? Object.keys(eng).filter(n => eng[n].record && eng[n].edit && !eng[n].nonNetflix && !eng[n].overflow)
          : Object.keys(eng).filter(n => eng[n].nonNetflix);
        if (isNetflix && isMusic) pool = pool.concat(Object.keys(eng).filter(n => eng[n].music));
        const samePool = pool.filter(n => free(n, reWks));
        if (samePool.length) {
          const who = pick(samePool, Math.min(...reWks));
          commit(who, reWks); emit('Dub', who, dubw); emit('Edit', who, editw);
        } else {
          const dp = pool.filter(n => !dubw.size || free(n, dubw));
          const ep = pool.filter(n => !editw.size || free(n, editw));
          const dPick = dubw.size ? (dp.length ? pick(dp, Math.min(...dubw)) : null) : null;
          const ePick = editw.size ? (ep.length ? pick(ep, Math.min(...editw)) : null) : null;
          if ((!dubw.size || dPick) && (!editw.size || ePick)) {
            if (dPick) { commit(dPick, dubw); emit('Dub', dPick, dubw); }
            if (ePick) { commit(ePick, editw); emit('Edit', ePick, editw); }
          } else {
            const shared = tryShare(pool, reWks);
            if (shared) {
              const [[a, wa], [b, wb]] = shared;
              commit(a, wa); commit(b, wb); sharedCount++;
              emit('Dub+Edit', a, wa, `shared phase (${wa.size}wk)`);
              emit('Dub+Edit', b, wb, `shared phase (${wb.size}wk)`);
            } else {
              const f = forcePick(pool, reWks); const ov = inter(eng[f].busy, reWks).length;
              commit(f, reWks); forcedCount += (dubw.size?1:0) + (editw.size?1:0);
              emit('Dub', f, dubw, `FORCED OVERLAP (${ov}wk)`); emit('Edit', f, editw, `FORCED OVERLAP (${ov}wk)`);
            }
          }
        }
      }
    }

    // mix
    if (mixw.size) {
      if (keepPhase('Mix')) {
        for (const b of (currentBy[`${title}||Mix`] || [])) proposed.push({ ...b, source: b.source || 'kept' });
      } else {
        const regular = Object.keys(eng).filter(n => eng[n].mix && !eng[n].overflow &&
          (needAdv ? eng[n].lvl === 'Advanced' : eng[n].lvl === 'Developing'));
        let mp = regular.filter(n => free(n, mixw));
        if (isMusic) mp = mp.concat(Object.keys(eng).filter(n => eng[n].music && eng[n].mix && free(n, mixw)));
        if (mp.length) { const who = pick(mp, Math.min(...mixw)); commit(who, mixw); emit('Mix', who, mixw); }
        else {
          const ofl = Object.keys(eng).filter(n => eng[n].overflow && eng[n].mix &&
            (!needAdv || eng[n].lvl === 'Advanced') && free(n, mixw));
          if (ofl.length) { const who = pick(ofl, Math.min(...mixw)); commit(who, mixw); emit('Mix', who, mixw, 'overflow'); }
          else {
            const all = regular.concat(Object.keys(eng).filter(n => eng[n].overflow && eng[n].mix && (!needAdv || eng[n].lvl === 'Advanced')));
            const f = forcePick(all, mixw); const ov = inter(eng[f].busy, mixw).length;
            commit(f, mixw); forcedCount += 1; emit('Mix', f, mixw, `FORCED OVERLAP (${ov}wk)`);
          }
        }
      }
    }
  }

  // ---- diff ----
  // normalise: a shared Dub+Edit row covers both phases, so it compares like two rows
  const expand = list => { const m = {};
    for (const b of list) for (const ph of (b.phase === 'Dub+Edit' ? ['Dub','Edit'] : [b.phase]))
      (m[`${b.project}||${ph}`] ||= []).push(b.engineer);
    return m; };
  const curMap = expand(active);
  const newMap = expand(proposed);
  const changes = [];
  for (const k of new Set([...Object.keys(curMap), ...Object.keys(newMap)])) {
    const from = (curMap[k] || []).sort().join(' + ') || '(none)';
    const to = (newMap[k] || []).sort().join(' + ') || '(none)';
    if (from !== to) { const [project, phase] = k.split('||'); changes.push({ project, phase, from, to }); }
  }
  const forcedNow = active.filter(b => /FORCED/i.test(b.note || '')).length;

  return {
    week_of: wstart(nowW),
    locked_rows: locked.length, movable_rows: movable.length,
    changes, change_count: changes.length,
    forced_before: forcedNow, forced_after: forcedCount, shared_phases: sharedCount,
    proposed_rows: proposed.filter(b => b.source === 'replan'),
    superseded_row_numbers: movable.map(b => b.row_number).filter(Boolean),
  };
}
module.exports = { replan };
