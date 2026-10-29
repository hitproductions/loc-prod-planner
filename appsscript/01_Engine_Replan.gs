// Based on the build handoff. Intentional policy changes are recorded in
// test/engine_drift.test.js; all other engine logic remains drift-checked.

// opts.keepOrder — assign projects in the order given instead of sorting by
// deadline. Ordering changes only WHO is picked; every phase window is still
// plotted from its own deadline, so no date depends on it. Added so the caller
// can search orderings for a better-balanced book (see solveReplan in the
// wrapper). Omitting opts reproduces the original behaviour exactly.
function replan(projectRows, bookingRows, engineerRows, todayISO, opts) {
  const W0 = Date.UTC(2025, 11, 1), DAY = 86400000;
  const widx = s => Math.floor((Date.parse(String(s).slice(0,10) + 'T00:00:00Z') - W0) / (7 * DAY));
  const wstart = i => new Date(W0 + i * 7 * DAY).toISOString().slice(0, 10);
  const wend = i => new Date(W0 + (i * 7 + 6) * DAY).toISOString().slice(0, 10);
  const block = (endW, n) => { const s = new Set(); for (let w = endW - n + 1; w <= endW; w++) s.add(w); return n > 0 ? s : new Set(); };
  const yes = v => String(v).trim().toLowerCase() === 'yes';
  const mrank = v => { const s = String(v == null ? '' : v).trim().toLowerCase();
    if (s === 'yes') return 1;
    const n = parseInt(s, 10); return (Number.isFinite(n) && n > 0) ? n : 0; };
  const num = v => { const n = parseInt(String(v).trim(), 10); return Number.isFinite(n) && n > 0 ? n : 0; };
  const inter = (a, b) => [...a].filter(x => b.has(x));
  const nowW = widx(todayISO);

  // ---- roster ----
  const base = {};
  for (const r of engineerRows) if (r && r.name) base[r.name] = {
    record: yes(r.can_record), edit: yes(r.can_edit), mix: yes(r.can_mix),
    lvl: (r.mix_level || '').trim(),
    musicRank: mrank(r.music_specialist), music: mrank(r.music_specialist) > 0,
    overflow: yes(r.overflow_only), specials: yes(r.does_specials),
    atmos: yes(r.atmos) };

  // ---- split the book ----
  const active = bookingRows.filter(b => b && b.engineer && b.start_date &&
    String(b.status || '').trim().toLowerCase() !== 'superseded');
  // A project the user has frozen. Ticking Locked on its row means every one of
  // its bookings is treated exactly like work that has already started: never
  // superseded, never re-proposed, and its weeks pre-block the engineers holding
  // them so nothing else is planned on top. Without this the rows would count as
  // movable, get superseded, and — since a frozen project is not re-solved — go
  // missing entirely, which is fix D's failure mode.
  const frozen = new Set((projectRows || [])
    .filter(p => p && (p.locked === true || /^(yes|true)$/i.test(String(p.locked || ''))))
    .map(p => p.project_title));
  const isLocked = b => frozen.has(b.project) ||
    widx(b.start_date) <= nowW || /manual/i.test(b.note || '');
  const locked = active.filter(isLocked);
  const movable = active.filter(b => !isLocked(b));

  const lockedKey = new Set(locked.map(b => `${b.project}||${b.phase}`));
  const currentBy = {};
  for (const b of active) { const k = `${b.project}||${b.phase}`; if (!currentBy[k]) currentBy[k] = []; currentBy[k].push(b); }

  // ---- engineer state, pre-blocked with locked work ----
  const eng = {};
  // Projects at once, counted by title, up to PROJECT_LIMIT -- mirrors the assign engine.
  // `at` holds each week's titles; `cur` is the project being placed, whose own weeks never
  // fill anyone up for it. "free" means has room; an overlap is a week over the limit.
  const LIMIT = (typeof PROJECT_LIMIT === 'number' && PROJECT_LIMIT >= 1) ? PROJECT_LIMIT : 1;
  let cur = '';
  for (const n in base) eng[n] = { ...base[n], at: {}, load: 0, last: null };
  for (const b of locked) {
    const e = eng[b.engineer]; if (!e) continue;
    for (let w = widx(b.start_date); w <= widx(b.end_date); w++) {
      (e.at[w] = e.at[w] || new Set()).add(String(b.project || ''));
      e.load++; if (e.last === null || w > e.last) e.last = w;
    }
  }
  const others = (n, w) => { const t = eng[n].at[w]; return t ? t.size - (t.has(cur) ? 1 : 0) : 0; };
  const full = (n, w) => others(n, w) >= LIMIT;
  const fullIn = (n, wks) => { let k = 0; for (const w of wks) if (full(n, w)) k++; return k; };
  const stack = (n, wks) => { let k = 0; for (const w of wks) k += others(n, w); return k; };

  const gap = (n, ref) => eng[n].last === null ? 1e9 : ref - eng[n].last;
  const free = (n, wks) => fullIn(n, wks) === 0;
  const commit = (n, wks) => { for (const w of wks) { (eng[n].at[w] = eng[n].at[w] || new Set()).add(cur);
    eng[n].load++; if (eng[n].last === null || w > eng[n].last) eng[n].last = w; } };
  const pick = (pool, ref, byRank, wks) => { if (!pool.length) return null;
    if (wks && wks.size) { const least = Math.min(...pool.map(n => stack(n, wks)));
      pool = pool.filter(n => stack(n, wks) === least); }
    if (byRank) { const best = Math.min(...pool.map(n => eng[n].musicRank));
      pool = pool.filter(n => eng[n].musicRank === best); }
    const m = Math.min(...pool.map(e => eng[e].load));
    return pool.filter(e => eng[e].load === m).sort((a,b) => (gap(b,ref)-gap(a,ref)) || a.localeCompare(b))[0]; };
  // Music specialists in rank order — mirrors assign.js. Reserve status ignored:
  // the tracker grants the reserve full duty on music.
  const musicPool = can => Object.keys(eng).filter(n => eng[n].musicRank && can(n));

  const forcePick = (pool, wks) => pool.slice().sort((a,b) =>
    (fullIn(a, wks) - fullIn(b, wks)) || (stack(a, wks) - stack(b, wks)) ||
    (eng[a].load - eng[b].load) || a.localeCompare(b))[0];
  // Mirrors assign.js exactly — smallest covering set, any size. It has to: this
  // file is a second implementation of the same rules, and when the two disagree
  // a re-plan silently undoes what the plot decided. Pair-only here meant a
  // re-plan reverted N-way shares back into forced overlaps.
  
  const runsOf = wks => {
    const ws = [...wks].sort((a, b) => a - b), out = [];
    for (const w of ws) {
      const last = out[out.length - 1];
      if (last && w === last[last.length - 1] + 1) last.push(w); else out.push([w]);
    }
    return out.map(r => new Set(r));
  };
  const shareCap = (typeof SHARE_CAP === 'number') ? SHARE_CAP : 2;
  const preferWholeEdit = (typeof SHARE_PREFER_WHOLE_EDIT === 'boolean')
    ? SHARE_PREFER_WHOLE_EDIT : true;
  const tryShare = (pool, needed, editSet) => {
    const weeks = [...needed].sort((x, y) => x - y);
    if (!weeks.length || pool.length < 2) return null;
    const freeOf = {};
    for (const n of pool) freeOf[n] = new Set(weeks.filter(w => !full(n, w)));

    const allocate = combo => {
      const got = {};
      combo.forEach(n => { got[n] = []; });
      let prev = null;
      for (const w of weeks) {
        const able = combo.filter(n => freeOf[n].has(w));
        if (!able.length) return null;
        let who = (prev && able.indexOf(prev) !== -1) ? prev
          : able.slice().sort((a, b) => (others(a, w) - others(b, w)) ||
              (eng[a].load + got[a].length) - (eng[b].load + got[b].length) || a.localeCompare(b))[0];
        got[who].push(w);
        prev = who;
      }
      const used = combo.filter(n => got[n].length);
      if (used.length < 2) return null;            // that is a single engineer, not a share
      let maxLoad = 0, runs = 0;
      for (const n of used) {
        maxLoad = Math.max(maxLoad, eng[n].load + got[n].length);
        got[n].forEach((w, i) => { if (i === 0 || w !== got[n][i - 1] + 1) runs++; });
      }
      // How many different people end up holding this project's EDITING weeks.
      // With SHARE_PREFER_WHOLE_EDIT the scorer drives this to 1, so the dubbing
      // gets divided and the edit stays with one pair of hands.
      const editHolders = editSet
        ? used.filter(n => got[n].some(w => editSet.has(w))).length : 0;
      return { used, got, maxLoad, runs, editHolders, key: used.slice().sort().join('|') };
    };

    const cap = shareCap > 0 ? Math.min(shareCap, pool.length) : pool.length;
    for (let size = 2; size <= cap; size++) {
      let candidates = [];
      const combo = [];
      (function search(start) {
        if (combo.length === size) {
          if (weeks.every(w => combo.some(n => freeOf[n].has(w)))) {
            const a = allocate(combo);
            if (a) candidates.push(a);
          }
          return;
        }
        for (let i = start; i < pool.length; i++) { combo.push(pool[i]); search(i + 1); combo.pop(); }
      })(0);
      // SHARE_PREFER_WHOLE_EDIT is a CONSTRAINT, not a preference. assign.js treats it
      // that way — if the edit cannot stay with one pair of hands the whole share
      // attempt fails and the ladder falls through, forcing an overlap rather than
      // dividing an edit. Here it was only a sort key, so a split edit still won when
      // nothing better existed, and a re-plan produced something the plot never would.
      // Measured on a 48-project book: this is what split Heartland's edit.
      if (preferWholeEdit) candidates = candidates.filter(c => c.editHolders <= 1);
      if (!candidates.length) continue;
      candidates.sort((a, b) =>
        (preferWholeEdit ? (a.editHolders - b.editHolders) : 0) ||
        (a.maxLoad - b.maxLoad) || (a.runs - b.runs) || a.key.localeCompare(b.key));
      const best = candidates[0];
      return best.used.map(n => [n, new Set(best.got[n])]);
    }
    return null;
  };

  // ---- replay every project in deadline order ----
  const projects = projectRows.filter(p => p && p.project_title && p.deadline);
  if (!(opts && opts.keepOrder)) {
    projects.sort((a,b) => String(a.deadline).localeCompare(String(b.deadline)));
  }
  const proposed = [];
  let forcedCount = 0, sharedCount = 0;

  for (const p of projects) {
    const title = p.project_title;
    cur = String(title || '');
    // Phase windows -- mirrors assign.js. Per-phase dates win when the project has
    // them (Tara, 2026-10-15); an older row without dates plots backward as before.
    const span = (a, z) => { const s = new Set();
      if (a && z) for (let w = widx(a); w <= widx(z); w++) s.add(w); return s; };
    let dubw, editw, mixw;
    if (p.dub_from || p.edit_from || p.mix_from) {
      dubw = span(p.dub_from, p.dub_to);
      editw = span(p.edit_from, p.edit_to);
      mixw = span(p.mix_from, p.mix_to);
    } else {
      const dlW = widx(p.deadline);
      mixw = block(dlW - 1, num(p.mix_weeks));
      const editEnd = mixw.size ? Math.min(...mixw) - 1 : dlW - 1;
      editw = block(editEnd, num(p.edit_weeks));
      const dubEnd = editw.size ? Math.min(...editw) - 1 : editEnd;
      dubw = block(dubEnd, num(p.dub_weeks));
    }
    const isMusic = yes(p.music_songs);
    const isSpecial = yes(p.special_project);
    const needAdv = String(p.mix_level_required).trim() !== 'Developing';
    // Mirrors the assign engine. A re-plan that could ignore the Atmos room would
    // quietly undo the constraint the plot honoured — the same way pair-only sharing
    // here used to revert N-way shares back into forced overlaps.
    const needAtmos = yes(p.atmos_required);
    const hasAtmos = n => !needAtmos || eng[n].atmos;

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
        let pool = isSpecial
          ? Object.keys(eng).filter(n => eng[n].specials)
          : Object.keys(eng).filter(n => eng[n].record && eng[n].edit && !eng[n].overflow);
        if (!isSpecial && isMusic) pool = musicPool(n => eng[n].record && eng[n].edit);
        const samePool = pool.filter(n => free(n, reWks));
        if (samePool.length) {
          const who = pick(samePool, Math.min(...reWks), false, reWks);
          commit(who, reWks); emit('Dub', who, dubw); emit('Edit', who, editw);
        } else {
          const dp = pool.filter(n => !dubw.size || free(n, dubw));
          const ep = pool.filter(n => !editw.size || free(n, editw));
          const dPick = dubw.size ? (dp.length ? pick(dp, Math.min(...dubw), false, dubw) : null) : null;
          const ePick = editw.size ? (ep.length ? pick(ep, Math.min(...editw), false, editw) : null) : null;
          if ((!dubw.size || dPick) && (!editw.size || ePick)) {
            if (dPick) { commit(dPick, dubw); emit('Dub', dPick, dubw); }
            if (ePick) { commit(ePick, editw); emit('Edit', ePick, editw); }
          } else {
            const shared = tryShare(pool, reWks, editw);
            if (shared) {
              // Real phase per week, matching assign.js. A run crossing the
              // dub/edit boundary becomes one Dub row and one Edit row.
              for (const [n, wks] of shared) commit(n, wks);
              sharedCount++;
              for (const [n, wks] of shared) {
                for (const r of runsOf(new Set([...wks].filter(w => dubw.has(w)))))
                  emit('Dub', n, r, `shared phase (${r.size}wk of ${shared.length}-way split)`);
                for (const r of runsOf(new Set([...wks].filter(w => editw.has(w)))))
                  emit('Edit', n, r, `shared phase (${r.size}wk of ${shared.length}-way split)`);
              }
            } else if (!isSpecial && !isMusic && Object.keys(eng).some(n => eng[n].overflow && eng[n].record && eng[n].edit && free(n, reWks))) {
              // The reserve for recording and editing (Mat, Rudolf 2026-10-29): only when
              // every regular is at the limit, and still before anyone goes over it.
              const res = Object.keys(eng).filter(n => eng[n].overflow && eng[n].record && eng[n].edit && free(n, reWks));
              const r = pick(res, Math.min(...reWks), false, reWks);
              commit(r, reWks); emit('Dub', r, dubw, 'reserve'); emit('Edit', r, editw, 'reserve');
            } else {
              const f = forcePick(pool, reWks); const ov = fullIn(f, reWks);
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
        // Tara, 2026-10-14: the same Advanced-first ladder as the plot engine.
        const canMix = n => eng[n].mix && !eng[n].overflow && hasAtmos(n);
        const regular = Object.keys(eng).filter(n => canMix(n) && eng[n].lvl === 'Advanced');
        const fallback = needAdv ? []
          : Object.keys(eng).filter(n => canMix(n) && eng[n].lvl === 'Developing');
        let mp = regular.filter(n => free(n, mixw));
        if (!mp.length) mp = fallback.filter(n => free(n, mixw));
        // A music mix NEVER leaves the specialists — mirrors the assign engine, which
        // gives music its own branch precisely so the fallbacks below cannot be reached.
        // This used to restrict only the FREE pool: when no specialist was free it fell
        // through to overflow and then to every mixer on the roster, so a re-plan under
        // load handed a Music/Songs title to someone with no music expertise. That is the
        // bug Tara reported on 2026-08-15; the free path was fixed then and the fallbacks
        // were not. Forcing an overlap onto a specialist is the correct outcome here — the
        // alternative is giving the work to someone who cannot do it.
        if (isMusic) {
          const tier = musicPool(n => eng[n].mix && (!needAdv || eng[n].lvl === 'Advanced') && hasAtmos(n));
          const free_ = tier.filter(n => free(n, mixw));
          if (free_.length) {
            const who = pick(free_, Math.min(...mixw), true, mixw); commit(who, mixw); emit('Mix', who, mixw);
          } else if (tier.length) {
            const f = forcePick(tier, mixw); const ov = fullIn(f, mixw);
            commit(f, mixw); forcedCount += 1;
            emit('Mix', f, mixw, `FORCED OVERLAP (${ov}wk) — music mixing is restricted to ${tier.join(', ')}`);
          }
          // no specialist can mix at this level: fall through, and the warning stands
        } else if (mp.length) { const who = pick(mp, Math.min(...mixw), false, mixw); commit(who, mixw); emit('Mix', who, mixw); }
        else {
          const ofl = Object.keys(eng).filter(n => eng[n].overflow && eng[n].mix &&
            (!needAdv || eng[n].lvl === 'Advanced') && hasAtmos(n) && free(n, mixw));
          if (ofl.length) { const who = pick(ofl, Math.min(...mixw), false, mixw); commit(who, mixw); emit('Mix', who, mixw, 'overflow'); }
          else {
            const all = regular.concat(fallback).concat(Object.keys(eng).filter(n => eng[n].overflow && eng[n].mix && (!needAdv || eng[n].lvl === 'Advanced') && hasAtmos(n)));
            const f = forcePick(all, mixw); const ov = fullIn(f, mixw);
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
      { const k = `${b.project}||${ph}`; if (!m[k]) m[k] = []; m[k].push(b.engineer); }
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
