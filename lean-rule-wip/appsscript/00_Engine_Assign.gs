// Ported verbatim from the build handoff (HANDOFF §5: "port as-is, do not
// rewrite"). The ONLY change from the handed-over file is the removal of the
// trailing `module.exports` line, which §5 explicitly permits and Apps Script
// has no use for. test/engine_drift.test.js asserts that is still the only
// difference — do not edit the logic here.

function runAssign(proj, bookingRows, engineerRows) {
  const W0 = Date.UTC(2025, 11, 1), DAY = 86400000;
  const widx = s => Math.floor((Date.parse(s + 'T00:00:00Z') - W0) / (7 * DAY));
  const wstart = i => new Date(W0 + i * 7 * DAY).toISOString().slice(0, 10);
  const wend = i => new Date(W0 + (i * 7 + 6) * DAY).toISOString().slice(0, 10);
  const block = (endW, n) => { const s = new Set(); for (let w = endW - n + 1; w <= endW; w++) s.add(w); return n > 0 ? s : new Set(); };
  const yes = v => String(v).trim().toLowerCase() === 'yes';
  const mrank = v => { const s = String(v == null ? '' : v).trim().toLowerCase();
    if (s === 'yes') return 1;
    const n = parseInt(s, 10); return (Number.isFinite(n) && n > 0) ? n : 0; };
  const inter = (a, b) => [...a].filter(x => b.has(x));
  const warnings = [];

  const eng = {};
  for (const r of engineerRows) {
    if (!r.name) continue;
    eng[r.name] = { record: yes(r.can_record), edit: yes(r.can_edit), mix: yes(r.can_mix),
      lvl: (r.mix_level || '').trim(),
      // music_specialist carries an ORDER, not just a yes: 1 = first choice, 2 = second.
      // "Yes" still means rank 1, so an older roster keeps working.
      musicRank: mrank(r.music_specialist), music: mrank(r.music_specialist) > 0,
      overflow: yes(r.overflow_only), specials: yes(r.specials_only),
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
  // byRank puts music_specialist order ahead of load, so the first choice is taken
  // while free rather than only when they happen to be the cheapest that week. Opt-in:
  // every non-music call behaves exactly as before.
  const pick = (pool, ref, byRank) => {
    if (!pool.length) return null;
    if (byRank) {
      const best = Math.min(...pool.map(n => eng[n].musicRank));
      pool = pool.filter(n => eng[n].musicRank === best);
    }
    const min = Math.min(...pool.map(e => eng[e].load));
    return pool.filter(e => eng[e].load === min).sort((a, b) => (gap(b, ref) - gap(a, ref)) || a.localeCompare(b))[0];
  };
  // Every music specialist, so the ordinary ladder can divide the dub or split
  // dub-from-edit between them. Order is expressed by RANK inside pick and the week
  // allocator, not by narrowing the pool — narrowing meant that if the first choice
  // could not take the WHOLE block it dropped to the second choice wholesale, when a
  // share between them is usually the better answer.
  const musicPool = can => Object.keys(eng).filter(n => eng[n].musicRank && can(n));

  // LEAN SEASON (Tara, 2026-08-15). When there is slack, the priority stops being a
  // tidy calendar and becomes people having work — so EVERY phase divides, mixing
  // included. The usual objections do not apply here and Tara has ruled on them:
  // nobody can be overloaded in a week when most of the roster is free, and
  // continuity is worth less than someone having something to do.
  //
  // Slack is measured PER WEEK, not across the whole block. "Free for all three
  // weeks" is the wrong question — in a quiet month people are still busy on
  // scattered single weeks, so almost nobody clears a whole run. On the book that
  // prompted this, exactly one engineer did, and an earlier version of this rule
  // never fired once.
  const leanFor = wks => {
    if (!(typeof DIVIDE_WHEN_FREE === 'number') || DIVIDE_WHEN_FREE <= 0) return false;
    if (!wks || wks.size < 2) return false;                 // one week cannot be shared

    // proj.lean_weeks is the authoritative answer when the caller has one: the
    // wrapper computes it from TOTAL demand across every project, before anything is
    // assigned. Counting who is free right now cannot work inside a greedy pass —
    // the first project sees an empty book and reads as lean whatever month it is in.
    if (proj.lean_weeks) return [...wks].every(w => proj.lean_weeks[w]);

    // Single-project callers (the app's save path) hand us the WHOLE existing book,
    // so here the live count is the true picture.
    return Math.min(...[...wks].map(w =>
      Object.keys(eng).filter(n => !eng[n].busy.has(w)).length)) >= DIVIDE_WHEN_FREE;
  };

  // Hand out a phase's weeks one at a time, always to the eligible engineer
  // carrying the least work SO FAR — including what this loop has just given them.
  // Counting the running total is the whole trick: the pre-existing edit splitter
  // read eng[n].load, which does not move inside the loop, so the same lowest-load
  // engineer won every week and a "divided" phase landed whole on one person.
  const splitPhase = (cands, wks) => {
    if (!cands.length || !wks.size) return null;
    const by = {}, extra = {};
    for (const w of [...wks].sort((a, b) => a - b)) {
      const able = cands.filter(n => !eng[n].busy.has(w));
      if (!able.length) return null;
      const who = able.slice().sort((a, b) =>
        ((eng[a].load + (extra[a] || 0)) - (eng[b].load + (extra[b] || 0))) ||
        a.localeCompare(b))[0];
      (by[who] = by[who] || new Set()).add(w);
      extra[who] = (extra[who] || 0) + 1;
    }
    return Object.keys(by).length > 1 ? by : null;          // null = no real division
  };
  const applyPhase = (phase, by) => {
    for (const n of Object.keys(by)) {
      commit(n, by[n], by[n].size);
      for (const run of runsOf(by[n])) assignments.push([phase, n, run]);
    }
    return Object.keys(by).sort().join(' + ');
  };

  const forcePick = (pool, wks) => pool.slice().sort((a, b) =>
    (inter(eng[a].busy, wks).length - inter(eng[b].busy, wks).length) ||
    (eng[a].load - eng[b].load) ||
    (gap(b, Math.min(...wks)) - gap(a, Math.min(...wks))) || a.localeCompare(b))[0];

  // Distribute the DUB week by week while keeping the EDIT whole with one pair of
  // hands. Per Tara: dividing dubbing is the cheap split — each dub week is its
  // own recording block, so handing week 1 to one engineer and week 2 to another
  // costs little, whereas editing wants continuity within a title.
  //
  // This is the ONLY division mechanism. An earlier version had a second one
  // (tryShare) that ran only after a single engineer and a coarse phase-split had
  // both failed — almost never on real data — and it could divide the EDIT, which
  // this must not. Two mechanisms with different rules made behaviour
  // unpredictable; there is now one.
  //
  // Returns { editWho, dubBy } or null when some dub week has nobody free.
  // Contiguous runs of a week set, so every booking row is an unbroken block.
  // A set with a gap becomes two rows rather than one row spanning the gap.
  const runsOf = wks => {
    const ws = [...wks].sort((a, b) => a - b), out = [];
    for (const w of ws) {
      const last = out[out.length - 1];
      if (last && w === last[last.length - 1] + 1) last.push(w); else out.push([w]);
    }
    return out.map(r => new Set(r));
  };

  // Policy, read from 20_Config.gs. SHARE_CAP limits how many engineers touch the
  // DUB; the edit holder is a separate assignment and is not counted.
  const shareCap = (typeof SHARE_CAP === 'number') ? SHARE_CAP : 2;
  const preferWholeEdit = (typeof SHARE_PREFER_WHOLE_EDIT === 'boolean')
    ? SHARE_PREFER_WHOLE_EDIT : true;

  const spreadDub = (pool, dubWks, editWks, byRank) => {
    const rankOf = n => byRank ? eng[n].musicRank : 0;
    if (!dubWks.size) return null;
    const cap = shareCap > 0 ? shareCap : pool.length;

    // The edit normally stays whole with one engineer — continuity within a title
    // matters more than dubbing continuity. With SHARE_PREFER_WHOLE_EDIT false it
    // is distributed week by week like the dub.
    let editWho = null;
    let editBy = null;
    if (editWks.size) {
      const able = pool.filter(n => free(n, editWks));
      if (able.length) {
        editWho = pick(able, Math.min(...editWks), byRank);
      } else if (preferWholeEdit) {
        return null;                                 // edit cannot stay whole
      } else {
        editBy = {};
        for (const w of [...editWks].sort((a, b) => a - b)) {
          const canDo = pool.filter(n => !eng[n].busy.has(w));
          if (!canDo.length) return null;
          const who = canDo.slice().sort((a, b) =>
            (eng[a].load - eng[b].load) || a.localeCompare(b))[0];
          if (!editBy[who]) editBy[who] = new Set();
          editBy[who].add(w);
        }
      }
    }

    // SHARE_CAP is a limit on how many engineers touch the DUB. The edit holder
    // is a separate assignment and is deliberately NOT counted: including them
    // meant a cap of 2 left room for only one dubber, which silently prevented
    // the dub division this function exists to do.
    const dubBy = {};
    const used = () => Object.keys(dubBy).filter(n => dubBy[n].size);
    const projected = n => eng[n].load + (dubBy[n] ? dubBy[n].size : 0) +
      (n === editWho ? editWks.size : 0);

    for (const w of [...dubWks].sort((a, b) => a - b)) {
      let able = pool.filter(n => !eng[n].busy.has(w));
      if (!able.length) return null;
      // once the cap is reached, only people already on this project may continue
      if (used().length >= cap) {
        const inUse = used();
        able = able.filter(n => inUse.indexOf(n) !== -1);
        if (!able.length) return null;
      }
      const who = able.slice().sort((a, b) =>
        (rankOf(a) - rankOf(b)) || (projected(a) - projected(b)) || a.localeCompare(b))[0];
      if (!dubBy[who]) dubBy[who] = new Set();
      dubBy[who].add(w);
    }
    return { editWho, editBy, dubBy };
  };

  // Commits a spreadDub result and returns the label for the recordist field.
  const applySpread = (sp, editWks) => {
    const names = [];
    for (const n of Object.keys(sp.dubBy)) {
      commit(n, sp.dubBy[n], sp.dubBy[n].size);
      for (const r of runsOf(sp.dubBy[n])) assignments.push(['Dub', n, r]);
      if (names.indexOf(n) === -1) names.push(n);
    }
    if (sp.editWho && editWks.size) {
      commit(sp.editWho, editWks, editWks.size);
      for (const r of runsOf(editWks)) assignments.push(['Edit', sp.editWho, r]);
      if (names.indexOf(sp.editWho) === -1) names.push(sp.editWho);
    } else if (sp.editBy) {
      for (const n of Object.keys(sp.editBy)) {
        commit(n, sp.editBy[n], sp.editBy[n].size);
        for (const r of runsOf(sp.editBy[n])) assignments.push(['Edit', n, r]);
        if (names.indexOf(n) === -1) names.push(n);
      }
    }
    return names;
  };

  const spreadNote = (sp, editWks) => {
    const bits = Object.keys(sp.dubBy).sort().map(n => `${n}: ${sp.dubBy[n].size}wk dub`);
    if (sp.editWho && editWks.size) bits.push(`${sp.editWho}: ${editWks.size}wk edit (kept whole)`);
    else if (sp.editBy) Object.keys(sp.editBy).sort().forEach(n =>
      bits.push(`${n}: ${sp.editBy[n].size}wk edit`));
    // One dubber means nothing was divided — saying "divided across 1 engineer"
    // reads as a bug in the tool. This branch is reached when the dub goes to one
    // person and the edit to another, which is a phase split, not a divided dub.
    const dubbers = Object.keys(sp.dubBy).length;
    return (dubbers === 1
      ? 'Dub and edit split between engineers'
      : 'Dub divided week by week across ' + dubbers + ' engineers') +
      ' — ' + bits.join(' | ');
  };

  const isMusic = yes(proj.music_songs);
  const isSpecial = yes(proj.special_project);
  // Rule 7, restated: SPECIAL projects route to the specials engineer. It used to
  // key off client !== 'Netflix', which was the same set by coincidence of the
  // roster, not by intent — see E_HEADERS.
  const recOv = (proj.recordist_override || 'Auto').trim();
  const edOv  = (proj.editor_override || 'Auto').trim();
  const mixOv = (proj.mixer_override || 'Auto').trim();
  const manual = v => v && v !== 'Auto' && v !== '';

  let pool;
  if (isSpecial) pool = Object.keys(eng).filter(n => eng[n].specials);
  else {
    pool = Object.keys(eng).filter(n => eng[n].record && eng[n].edit && !eng[n].specials && !eng[n].overflow);
    // Music is a CAPABILITY with an ORDER, not a bonus. It used to be additive —
    // specialists were appended to the ordinary pool and ranked like anyone else, so a
    // music project could land on someone who cannot do the work. Tara, 2026-08-15:
    // nobody else can do music, and the first choice is fixed rather than whoever is
    // cheapest that week.
    //
    // This is why the bug only showed on re-plan: on an empty book the specialists win
    // on load anyway, so plotting looked correct by accident.
    //
    // Reserve status is deliberately ignored here — the tracker grants the reserve full
    // duty on music, so overflow_only does not apply to this pool.
    if (isMusic) pool = musicPool(n => eng[n].record && eng[n].edit);
  }

  let rec = null, recNote = '', assignments = [];

  // Rule 11, per role. The dub and the edit can go to different engineers now, so
  // there is a pick for each. A recordist pick with the editor left on Auto still
  // covers BOTH phases — that is rule 5's default and how this behaved before an
  // editor could be named, so existing rows keep their meaning. Naming an editor
  // is what separates the two.
  //
  // Vetting warns and proceeds; it never refuses. A hand-picked engineer is a
  // decision someone owns, and the tool's job is to say what it costs, not to
  // overrule it (HANDOFF rule 11).
  // noun is the whole phrase ("an editor") so the warning reads as English;
  // capable is what this particular role needs from the roster row.
  const vetPick = (name, weeks, role, noun, capable) => {
    if (!eng[name]) { warnings.push(`Unknown engineer "${name}" — ${role} left unassigned.`); return false; }
    const overlap = inter(eng[name].busy, weeks).length;
    if (overlap) warnings.push(`${name} was manually assigned to ${role} but is already booked ${overlap} of those weeks.`);
    if (isSpecial && !eng[name].specials) warnings.push(`Special projects normally route to the specials engineer; ${name} was chosen manually instead.`);
    if (!capable(eng[name])) warnings.push(`${name} is not normally ${noun} but was assigned manually.`);
    // Worth saying out loud: the reserve is the thing the whole objective spends
    // last, so choosing them by hand is a real cost the schedule cannot see.
    if (eng[name].overflow)
      warnings.push(`${name} is the overflow reserve, kept free for weeks nothing else covers — assigned to ${role} by hand.`);
    return true;
  };

  if (manual(recOv) && !manual(edOv)) {
    // one name, both phases
    if (!vetPick(recOv, recedit, 'record/edit', 'a recordist or editor', e => e.record && e.edit)) rec = 'UNRESOLVED';
    else {
      if (recedit.size) { commit(recOv, recedit, d + ed); assignments.push(['Dub', recOv, dubw], ['Edit', recOv, editw]); }
      rec = recOv; recNote = 'Manually assigned.';
    }
  } else if (manual(edOv)) {
    // the editor is named, so each phase resolves on its own
    const notes = [];
    let dubName = null, edName = null;

    if (manual(recOv)) {
      if (!vetPick(recOv, dubw, 'the dub', 'a recordist', e => e.record)) dubName = 'UNRESOLVED';
      else { dubName = recOv; notes.push('Recordist assigned by hand.'); }
    } else if (dubw.size) {
      // engine chooses the dub around the hand-picked editor
      const freeDub = pool.filter(n => free(n, dubw));
      if (freeDub.length) dubName = pick(freeDub, Math.min(...dubw));
      else if (pool.length) {
        dubName = forcePick(pool, dubw);
        notes.push(`FORCED OVERLAP on the dub — ${dubName} was already committed ` +
          `${inter(eng[dubName].busy, dubw).length} of those weeks elsewhere.`);
      }
    }

    if (!vetPick(edOv, editw, 'the edit', 'an editor', e => e.edit)) edName = 'UNRESOLVED';
    else { edName = edOv; notes.push('Editor assigned by hand.'); }

    if (dubName && dubName !== 'UNRESOLVED' && dubw.size) { commit(dubName, dubw, d); assignments.push(['Dub', dubName, dubw]); }
    if (edName !== 'UNRESOLVED' && editw.size) { commit(edName, editw, ed); assignments.push(['Edit', edName, editw]); }

    rec = !dubw.size ? `${edName} (edit)`
        : !editw.size ? `${dubName} (dub)`
        : dubName === edName ? dubName
        : `${dubName} (dub) / ${edName} (edit)`;
    recNote = notes.join(' ');
  } else if (!recedit.size) {
    rec = '—';
  } else {
    const samePool = pool.filter(n => free(n, recedit));
    const samePick = samePool.length ? pick(samePool, Math.min(...recedit), isMusic) : null;
    const dubPool = pool.filter(n => !dubw.size || free(n, dubw));
    const editPool = pool.filter(n => !editw.size || free(n, editw));
    const dubPick = dubw.size ? (dubPool.length ? pick(dubPool, Math.min(...dubw), isMusic) : null) : (pool[0] || null);
    const editPick = editw.size ? (editPool.length ? pick(editPool, Math.min(...editw), isMusic) : null) : (pool[0] || null);
    const splitOk = (!dubw.size || dubPick) && (!editw.size || editPick);
    // ---- the ladder, in order ------------------------------------------------
    // 1. divide the dub between engineers          (the cheap split — tried FIRST)
    // 2. one engineer for the whole block
    // 3. dub to one, edit to another               (same mechanism, one dubber)
    // 4. force an overlap
    //
    // Dividing the dub comes first per Tara: each dub week is its own recording
    // block, so handing week 1 to one engineer and week 2 to another costs
    // little, whereas editing wants continuity within a title. Previously this
    // was the LAST resort, which is why the dub was divided on 1 project in 24.
    // Per-project, and decided by outcome rather than by preference. The caller
    // may set proj.divide_dub to try this project both ways and keep whichever
    // scores better; otherwise the house default applies. Dividing is never done
    // "because we can" — only when the finished plan measures better for it.
    const divideFirst = (typeof proj.divide_dub === 'boolean') ? proj.divide_dub
      : ((typeof DUB_DIVISION_FIRST === 'boolean') ? DUB_DIVISION_FIRST : false);

    // Rung 0, above everything: in a lean stretch the dub and the edit are each
    // handed out week by week, independently. Ahead of proj.divide_dub on purpose,
    // so the wrapper's measure-it-both-ways tuner cannot undo it — in a quiet month
    // dividing never "measures better" (there is no overlap for it to relieve),
    // which is exactly why quiet months kept landing whole on one person.
    const leanRec = leanFor(dubw) || leanFor(editw);
    if (leanRec) {
      const dubBy = leanFor(dubw) ? splitPhase(pool, dubw) : null;
      const edBy = leanFor(editw) ? splitPhase(pool, editw) : null;
      if (dubBy || edBy) {
        const parts = [];
        if (dubBy) parts.push('dub across ' + Object.keys(dubBy).length);
        else if (dubw.size) { const n = pick(pool.filter(x => free(x, dubw)), Math.min(...dubw)) || forcePick(pool, dubw);
          commit(n, dubw, d); assignments.push(['Dub', n, dubw]); }
        if (edBy) parts.push('edit across ' + Object.keys(edBy).length);
        else if (editw.size) { const n = pick(pool.filter(x => free(x, editw)), Math.min(...editw)) || forcePick(pool, editw);
          commit(n, editw, ed); assignments.push(['Edit', n, editw]); }
        if (dubBy) applyPhase('Dub', dubBy);
        if (edBy) applyPhase('Edit', edBy);
        // namesFor() is declared further down and is in its temporal dead zone here,
        // so the summary is built from the assignments directly.
        const nameSet = [];
        for (const a of assignments) if (a[1] && nameSet.indexOf(a[1]) === -1) nameSet.push(a[1]);
        rec = nameSet.join(' + ');
        recNote = 'Lean stretch — ' + parts.join(' and ') +
          ' engineers so the work is shared rather than given to one person.';
      }
    }

    const spread = leanRec && assignments.length ? null : spreadDub(pool, dubw, editw, isMusic);
    const dividesDub = spread && divideFirst && Object.keys(spread.dubBy).length > 1;

    if (leanRec && assignments.length) {
      // already placed by the lean rung above
    } else if (dividesDub) {
      rec = applySpread(spread, editw).join(' + ');
      recNote = spreadNote(spread, editw);
    } else if (samePick) {
      commit(samePick, recedit, d + ed); rec = samePick;
      assignments.push(['Dub', samePick, dubw], ['Edit', samePick, editw]);
    } else if (spread) {
      // one dubber plus an editor — the coarse phase split, via the same code
      rec = applySpread(spread, editw).join(' + ');
      recNote = spreadNote(spread, editw) + ' — no one engineer was free for the whole block.';
    } else if (splitOk) {
      // shapes spreadDub cannot express: edit-only, or dub-only projects
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
      const f = forcePick(pool, recedit);
      const ov = inter(eng[f].busy, recedit).length;
      commit(f, recedit, d + ed); rec = f;
      recNote = `FORCED OVERLAP to hit the deadline — ${f} was already committed ${ov} of these weeks elsewhere; no single engineer and no division of the dub covered it.`;
      assignments.push(['Dub', f, dubw], ['Edit', f, editw]);
    }
  }

  let leanMixEmitted = false;
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
    const canMix = n => eng[n].mix && !eng[n].overflow;
    const developingMixers = Object.keys(eng).filter(n => canMix(n) && eng[n].lvl === 'Developing');
    const advancedMixers   = Object.keys(eng).filter(n => canMix(n) && eng[n].lvl === 'Advanced');

    // Rule 8 is one-directional: a Developing mixer never mixes a project that
    // requires Advanced. The reverse was never a rule — an Advanced mixer can
    // obviously handle a Developing-level job, and the workbook says the
    // Developing mixer gets "first refusal" on that work, which is a preference,
    // not a monopoly.
    //
    // The original pool implemented a monopoly: for a Developing project only
    // Developing mixers were considered, so with one Developing mixer on the
    // roster every such project became a single point of failure on one person's
    // calendar. When they were busy the engine spent the overflow reserve, or
    // forced an overlap, while senior mixers sat free. Corrected on Tara's
    // instruction (2026-08-13): prefer, then fall back.
    // A music mix never leaves the specialists, so it gets its own branch rather than
    // a filter on rungs that are allowed to fall back. Forcing an overlap onto a
    // specialist is the correct outcome when they are all busy — the alternative is
    // handing the work to someone who cannot do it.
    if (isMusic) {
      const tier = musicPool(n => eng[n].mix && (!needAdv || eng[n].lvl === 'Advanced'));
      const free_ = tier.filter(n => free(n, mixw));
      if (free_.length) { mixer = pick(free_, Math.min(...mixw), true); commit(mixer, mixw, m); }
      else if (tier.length) {
        const f = forcePick(tier, mixw);
        const ov = inter(eng[f].busy, mixw).length;
        commit(f, mixw, m); mixer = f;
        mixNote = `FORCED OVERLAP — music mixing is restricted to ${tier.join(', ')}, and every one was already booked ${ov} of these weeks.`;
      } else {
        mixer = 'UNRESOLVED';
        warnings.push('No music specialist can mix at this level — set music_specialist on the Engineers tab.');
      }
    } else {

    const regular = needAdv ? advancedMixers : developingMixers;
    const fallback = needAdv ? [] : advancedMixers;

    // Mixing is never split in a busy book — continuity within a title. In a lean
    // stretch Tara has ruled the other way: with the roster mostly free, someone
    // having work beats one person keeping the whole mix.
    const leanMixBy = leanFor(mixw)
      ? splitPhase(regular.concat(fallback).filter(n => !eng[n].overflow), mixw) : null;
    leanMixEmitted = !!leanMixBy;
    if (leanMixBy) {
      mixer = applyPhase('Mix', leanMixBy);
      mixNote = 'Lean stretch — mix shared across ' + Object.keys(leanMixBy).length +
        ' engineers rather than held by one.';
    }

    let mixPool = regular.filter(n => free(n, mixw));
    if (!mixPool.length) mixPool = fallback.filter(n => free(n, mixw));
    if (leanMixBy) { /* already placed, week by week, above */ }
    else if (mixPool.length) { mixer = pick(mixPool, Math.min(...mixw)); commit(mixer, mixw, m); }
    else {
      const overflow = Object.keys(eng).filter(n => eng[n].overflow && eng[n].mix && (!needAdv || eng[n].lvl === 'Advanced') && free(n, mixw));
      if (overflow.length) {
        mixer = pick(overflow, Math.min(...mixw)); commit(mixer, mixw, m);
        mixNote = `${mixer} — overflow; every eligible ${needAdv ? 'Advanced' : ''} mixer was busy those weeks.`;
      } else {
        const all = regular.concat(fallback)
          .concat(Object.keys(eng).filter(n => eng[n].overflow && eng[n].mix && (!needAdv || eng[n].lvl === 'Advanced')));
        const f = forcePick(all, mixw);
        const ov = inter(eng[f].busy, mixw).length;
        commit(f, mixw, m); mixer = f;
        mixNote = `FORCED OVERLAP to hit the deadline — ${f} was already committed ${ov} of these weeks elsewhere. Developing-level engineers stay barred from Advanced mixing unless assigned by hand.`;
      }
    }
    }
    // The lean branch pushed its own per-engineer runs; pushing again here would
    // duplicate the whole mix onto the joined name.
    if (leanMixEmitted) { /* already emitted, week by week */ } else
    assignments.push(['Mix', mixer, mixw]);
  }

  // Per-role names for the sheet's Recordist and Editor columns, derived from the
  // assignments rather than tracked alongside `rec`. Every branch above pushes its
  // assignments, so this reports exactly what the bookings say — including a
  // divided dub, where `rec` is a summary string and cannot be read as one name.
  const namesFor = ph => {
    const seen = [];
    for (const a of assignments) if (a[0] === ph && a[1] && seen.indexOf(a[1]) === -1) seen.push(a[1]);
    return seen.length ? seen.join(' + ') : '—';
  };
  const unresolved = rec === 'UNRESOLVED';

  const booking_rows = assignments.filter(([, n, w]) => n && w.size).map(([phase, n, w]) => ({
    project: proj.project_title, phase, engineer: n,
    start_date: wstart(Math.min(...w)), end_date: wend(Math.max(...w)),
    source: 'plot',
    note: [isSpecial ? 'special' : '', /FORCED/.test(phase === 'Mix' ? mixNote : recNote) ? 'FORCED OVERLAP' : '',
           // A hand-picked engineer pins only THEIR phase, so with a named editor
           // and an Auto recordist the Edit row is marked manual and the Dub row is
           // not — the schedule shows which half was a human decision.
           (phase === 'Mix' ? manual(mixOv)
             : phase === 'Edit' ? (manual(edOv) || manual(recOv))
             : manual(recOv)) ? 'manual' : ''].filter(Boolean).join(' / '),
  }));

  return { ...proj,
    recordist: rec, mixer: mixer || '—', record_note: recNote, mix_note: mixNote,
    dubber: unresolved ? 'UNRESOLVED' : namesFor('Dub'),
    editor: unresolved ? 'UNRESOLVED' : namesFor('Edit'),
    warnings: warnings.join(' | '),
    dub_start: dubw.size ? wstart(Math.min(...dubw)) : '', dub_end: dubw.size ? wend(Math.max(...dubw)) : '',
    edit_start: editw.size ? wstart(Math.min(...editw)) : '', edit_end: editw.size ? wend(Math.max(...editw)) : '',
    mix_start: mixw.size ? wstart(Math.min(...mixw)) : '', mix_end: mixw.size ? wend(Math.max(...mixw)) : '',
    forced: /FORCED/.test(recNote + mixNote), has_warnings: warnings.length > 0,
    booking_rows };
}
