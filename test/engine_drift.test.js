// HANDOFF §5: "Port them. Do not rewrite them." This asserts the live Apps
// Script engine files are still byte-identical to the handed-over originals
// apart from the removed `module.exports` line and the added header comment.
// If someone "improves" the engine, this fails loudly.
//
// Run: node test/engine_drift.test.js
const fs = require('fs');
const path = require('path');
const { loadAppsScript } = require('./loader.js');

const root = path.join(__dirname, '..');
const PAIRS = [
  ['engine/assign.js', 'appsscript/00_Engine_Assign.gs'],
  ['engine/replan.js', 'appsscript/01_Engine_Replan.gs'],
  ['engine/stats.js',  'appsscript/02_Engine_Stats.gs'],
];

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

// strip leading // comment block and blank lines
const stripHeader = s => s.replace(/^(?:\/\/.*\r?\n|[ \t]*\r?\n)+/, '');
// strip the trailing module.exports line
const stripExports = s => s.replace(/^module\.exports\s*=.*\r?\n?/m, '');
const norm = s => s.replace(/\r\n/g, '\n').trim();
// The Apps Script V8 runtime rejects logical assignment (`||=`) with a ParseError,
// so those lines are desugared. Applied to the REFERENCE before comparing, which
// means any OTHER difference still fails, and a change to the upstream line's
// shape fails too.
const V8_DESUGAR = {
  'engine/replan.js': [
    ['  for (const b of active) (currentBy[`${b.project}||${b.phase}`] ||= []).push(b);',
     '  for (const b of active) { const k = `${b.project}||${b.phase}`; if (!currentBy[k]) currentBy[k] = []; currentBy[k].push(b); }'],
    ['      (m[`${b.project}||${ph}`] ||= []).push(b.engineer);',
     '      { const k = `${b.project}||${ph}`; if (!m[k]) m[k] = []; m[k].push(b.engineer); }'],
  ],
};

// APPROVED BEHAVIOUR CHANGES — logic that intentionally differs from the handoff.
//
// Authorised by Tara, 2026-08-12: "you can split dubbing also if needed."
// Rule 10 as written shares a phase between TWO engineers and rule 9 forces an
// overlap when "no shared pair works", which force-overlapped blocks that three
// or four people could have covered between them. tryShare now searches for the
// smallest covering set of any size. Recorded in HANDOFF_ADDENDUM §9.
//
// These hunks are cut out of BOTH sides before comparing, so any other change to
// the engine still fails, and if one of these regions is edited again the hunk
// stops matching and the test says so.
const APPROVED_HUNKS = {
};

// REWRITTEN REGIONS — parts of the engine that are now deliberately ours.
//
// assign.js's record/edit assignment has been rebuilt on Tara's instructions
// (2026-08-12/13): dubbing may be divided week by week, editing stays whole, and
// the division is chosen by measuring the finished plan rather than by rule
// order. That is no longer a patch to the handoff's logic — it is a replacement
// for it, and pretending otherwise with a growing list of hunks would obscure
// what actually changed.
//
// The manual-override path joined them on 2026-08-13: rule 11 had one pick for
// record-and-edit together, which stopped making sense once the dub and the edit
// can go to different engineers. There are now three picks, one per role.
//
// Everything OUTSIDE these regions is still byte-compared, which is what matters:
// the week arithmetic, the roster build, the backward phase plotting (rule 2 —
// verified 0/72 against real data), the eligibility pools (rule 7 client
// routing), and the entire mix pool-and-force ladder below the fallback fix
// (rules 5 and 8).
const REWRITTEN = {
  // replan.js is a SECOND implementation of the same rules, so the two sharing
  // changes have to land here as well or a re-plan silently undoes what the plot
  // decided: leaving pair-only search here reverted N-way shares straight back
  // into forced overlaps.
  'engine/replan.js': [
    {
      what: 'the share emitter — real phase per week, N engineers instead of two',
      refStart:  '            const shared = tryShare(pool, reWks);',
      liveStart: '            const shared = tryShare(pool, reWks, editw);',
      end:       '            } else {',
    },
    {
      what: 'the share search — pair-only replaced by smallest covering set',
      refStart:  '  const tryShare = (pool, needed) => {',
      liveStart: '  // Mirrors assign.js exactly — smallest covering set, any size.',
      end:       '  const projects = projectRows.filter(p => p && p.project_title && p.deadline)',
    },
  ],
  'engine/assign.js': [
    {
      what: 'the mix assignment — Developing work may fall back to a senior mixer',
      refStart:  "    const needAdv = String(proj.mix_level_required).trim() === 'Advanced';",
      liveStart: "    const needAdv = String(proj.mix_level_required).trim() === 'Advanced';",
      end:       "    assignments.push(['Mix', mixer, mixw]);",
    },
    {
      what: 'the sharing helper — tryShare replaced by spreadDub and friends',
      refStart:  '  const tryShare = (pool, needed) => {',
      liveStart: '  // Distribute the DUB week by week',
      end:       '  const isMusic = yes(proj.music_songs);',
    },
    {
      what: 'the record/edit ladder — dub division first, decided by measurement',
      refStart:  '    if (samePick) {',
      liveStart: '    // ---- the ladder, in order',
      end:       "  let mixer = null, mixNote = '';",
    },
    {
      what: 'rule 11 — three manual picks, one per role, since dub and edit can differ',
      refStart:  "  const mixOv = (proj.mixer_override || 'Auto').trim();",
      liveStart: "  const edOv  = (proj.editor_override || 'Auto').trim();",
      end:       '  } else if (!recedit.size) {',
    },
    // The two below are pure INSERTIONS: the reference anchor and end anchor are
    // the same line, so nothing is cut from the original and only the added block
    // is cut from ours. Additive output fields, no original logic touched.
    {
      what: 'ADDED: per-role names derived from the assignments (dubber / editor)',
      refStart:  '  const booking_rows = assignments.filter(',
      liveStart: "  // Per-role names for the sheet's Recordist and Editor columns",
      end:       '  const booking_rows = assignments.filter(',
    },
    {
      what: 'ADDED: dubber and editor on the returned result',
      refStart:  "    warnings: warnings.join(' | '),",
      liveStart: "    dubber: unresolved ? 'UNRESOLVED' : namesFor('Dub'),",
      end:       "    warnings: warnings.join(' | '),",
    },
    {
      what: "the booking row's manual tag — a pick pins only its own phase",
      refStart:  "           (phase === 'Mix' ? manual(mixOv) : manual(recOv)) ? 'manual' : ''",
      liveStart: '           // A hand-picked engineer pins only THEIR phase, so with a named editor',
      end:       '  }));',
    },
  ],
};

// Cuts each rewritten region from both sides, so the remainder compares exactly.
function cutRewritten(refRel, refSrc, liveSrc) {
  const regions = REWRITTEN[refRel] || [];
  const notes = [];
  regions.forEach((r, i) => {
    const mark = '@@REWRITTEN' + i + '@@';
    const cut = (src, startAnchor) => {
      const a = src.indexOf(startAnchor);
      const b = a === -1 ? -1 : src.indexOf(r.end, a);
      if (a === -1 || b === -1) return { src, ok: false };
      // trim the seam so an incidental blank line either side is not a difference
      return { src: src.slice(0, a).replace(/\s*$/, '\n') + mark + '\n' + src.slice(b), ok: true };
    };
    const ref = cut(refSrc, r.refStart);
    const live = cut(liveSrc, r.liveStart);
    refSrc = ref.src; liveSrc = live.src;
    notes.push({ what: r.what, refOk: ref.ok, liveOk: live.ok });
  });
  return { refSrc, liveSrc, notes, expected: regions.length };
}

// Approved one-line changes. Applied to the REFERENCE, same mechanism as the V8
// desugaring — a block cut is the wrong tool when only a signature changed.
// The non_netflix_router column became does_specials, and the record/edit routing
// moved from `client !== 'Netflix'` to the project's own Special flag (2026-08-13).
// It is a rename plus a changed predicate, not new logic, so it belongs here rather
// than as another rewritten block — the pool SHAPE is byte-identical either side.
const APPROVED_SUBS = {
  'engine/replan.js': [
    // the project-level freeze (Tara, 2026-08-13). A locked project joins the set
    // that already could not move — started weeks and hand-pinned rows — so the
    // engine skips it wholesale instead of superseding rows it will never re-emit.
    ["  const isLocked = b => widx(b.start_date) <= nowW || /manual/i.test(b.note || '');",
     "  // A project the user has frozen. Ticking Locked on its row means every one of\n" +
     "  // its bookings is treated exactly like work that has already started: never\n" +
     "  // superseded, never re-proposed, and its weeks pre-block the engineers holding\n" +
     "  // them so nothing else is planned on top. Without this the rows would count as\n" +
     "  // movable, get superseded, and \u2014 since a frozen project is not re-solved \u2014 go\n" +
     "  // missing entirely, which is fix D's failure mode.\n" +
     "  const frozen = new Set((projectRows || [])\n" +
     "    .filter(p => p && (p.locked === true || /^(yes|true)$/i.test(String(p.locked || ''))))\n" +
     "    .map(p => p.project_title));\n" +
     "  const isLocked = b => frozen.has(b.project) ||\n" +
     "    widx(b.start_date) <= nowW || /manual/i.test(b.note || '');"],
    // gains an optional opts arg so the caller can search project orderings.
    // Omitting opts reproduces the original behaviour exactly — the deadline sort
    // still runs, in the same order, comparing the same fields.
    ['function replan(projectRows, bookingRows, engineerRows, todayISO) {',
     'function replan(projectRows, bookingRows, engineerRows, todayISO, opts) {'],
    ['  const projects = projectRows.filter(p => p && p.project_title && p.deadline)\n' +
     '    .sort((a,b) => String(a.deadline).localeCompare(String(b.deadline)));',
     '  const projects = projectRows.filter(p => p && p.project_title && p.deadline);\n' +
     '  if (!(opts && opts.keepOrder)) {\n' +
     '    projects.sort((a,b) => String(a.deadline).localeCompare(String(b.deadline)));\n' +
     '  }'],
    // ATMOS — mirrors assign.js. See the note there. The predicate has to exist in BOTH
    // engines or a re-plan silently undoes the constraint the plot honoured, which is
    // exactly how pair-only sharing here reverted N-way shares into forced overlaps.
    ["    const needAdv = String(p.mix_level_required).trim() !== 'Developing';",
     "    const needAdv = String(p.mix_level_required).trim() !== 'Developing';\n" +
     "    // Mirrors the assign engine. A re-plan that could ignore the Atmos room would\n" +
     "    // quietly undo the constraint the plot honoured \u2014 the same way pair-only sharing\n" +
     "    // here used to revert N-way shares back into forced overlaps.\n" +
     "    const needAtmos = yes(p.atmos_required);\n" +
     "    const hasAtmos = n => !needAtmos || eng[n].atmos;"],
    ["        const regular = Object.keys(eng).filter(n => eng[n].mix && !eng[n].overflow &&\n" +
     "          (needAdv ? eng[n].lvl === 'Advanced' : eng[n].lvl === 'Developing'));",
     "        const regular = Object.keys(eng).filter(n => eng[n].mix && !eng[n].overflow &&\n" +
     "          hasAtmos(n) &&\n" +
     "          (needAdv ? eng[n].lvl === 'Advanced' : eng[n].lvl === 'Developing'));"],
    ["            (!needAdv || eng[n].lvl === 'Advanced') && free(n, mixw));",
     "            (!needAdv || eng[n].lvl === 'Advanced') && hasAtmos(n) && free(n, mixw));"],
    ["            const all = regular.concat(Object.keys(eng).filter(n => eng[n].overflow && eng[n].mix && (!needAdv || eng[n].lvl === 'Advanced')));",
     "            const all = regular.concat(Object.keys(eng).filter(n => eng[n].overflow && eng[n].mix && (!needAdv || eng[n].lvl === 'Advanced') && hasAtmos(n)));"],
    ['overflow: yes(r.overflow_only), nonNetflix: yes(r.non_netflix_router) };',
     'overflow: yes(r.overflow_only), specials: yes(r.does_specials),\n' +
     '    atmos: yes(r.atmos) };'],
    ["    const isNetflix = String(p.client).trim() === 'Netflix';",
     "    const isSpecial = yes(p.special_project);"],
    ['        let pool = isNetflix\n' +
     '          ? Object.keys(eng).filter(n => eng[n].record && eng[n].edit && !eng[n].nonNetflix && !eng[n].overflow)\n' +
     '          : Object.keys(eng).filter(n => eng[n].nonNetflix);\n' +
     '        if (isNetflix && isMusic) pool = pool.concat(Object.keys(eng).filter(n => eng[n].music));',
     '        let pool = isSpecial\n' +
     '          ? Object.keys(eng).filter(n => eng[n].specials)\n' +
     '          : Object.keys(eng).filter(n => eng[n].record && eng[n].edit && !eng[n].overflow);\n' +
     '        if (!isSpecial && isMusic) pool = pool.concat(Object.keys(eng).filter(n => eng[n].music));'],
    // MUSIC RANKING (Tara, 2026-08-15) — mirrors assign.js. See the note there.
    ["  const yes = v => String(v).trim().toLowerCase() === 'yes';\n",
     "  const yes = v => String(v).trim().toLowerCase() === 'yes';\n" +
     "  const mrank = v => { const s = String(v == null ? '' : v).trim().toLowerCase();\n" +
     "    if (s === 'yes') return 1;\n" +
     "    const n = parseInt(s, 10); return (Number.isFinite(n) && n > 0) ? n : 0; };\n"],
    ["    lvl: (r.mix_level || '').trim(), music: yes(r.music_specialist),",
     "    lvl: (r.mix_level || '').trim(),\n" +
     "    musicRank: mrank(r.music_specialist), music: mrank(r.music_specialist) > 0,"],
    ["  const pick = (pool, ref) => { if (!pool.length) return null;\n",
     "  const pick = (pool, ref, byRank) => { if (!pool.length) return null;\n" +
     "    if (byRank) { const best = Math.min(...pool.map(n => eng[n].musicRank));\n" +
     "      pool = pool.filter(n => eng[n].musicRank === best); }\n"],
    ["  const forcePick = (pool, wks) => pool.slice().sort((a,b) =>",
     "  // Music specialists in rank order \u2014 mirrors assign.js. Reserve status ignored:\n" +
     "  // the tracker grants the reserve full duty on music.\n" +
     "  const musicPool = can => Object.keys(eng).filter(n => eng[n].musicRank && can(n));\n" +
     "\n" +
     "  const forcePick = (pool, wks) => pool.slice().sort((a,b) =>"],
    // Music routing: the pool becomes the specialists themselves rather than the
    // ordinary pool WIDENED by them. That is the bug Tara reported — music landing on
    // someone with no music expertise because the specialists were merely added to a
    // pool the engine could still pick outside of.
    ["        if (!isSpecial && isMusic) pool = pool.concat(Object.keys(eng).filter(n => eng[n].music));",
     "        if (!isSpecial && isMusic) pool = musicPool(n => eng[n].record && eng[n].edit);"],
    // A music mix never leaves the specialists — the FALLBACKS are restricted too, not
    // just the free pool. Restricting only the free pool meant that when no specialist
    // was free a re-plan fell through to overflow and then to every mixer, handing a
    // Music/Songs title to someone with no music expertise (found 2026-08-15 on a
    // 48-project book; the plot engine never had this hole).
    ["        if (isMusic) mp = mp.concat(Object.keys(eng).filter(n => eng[n].music && eng[n].mix && free(n, mixw)));\n" +
     "        if (mp.length) { const who = pick(mp, Math.min(...mixw)); commit(who, mixw); emit('Mix', who, mixw); }\n",
     "        // A music mix NEVER leaves the specialists \u2014 mirrors the assign engine, which\n" +
     "        // gives music its own branch precisely so the fallbacks below cannot be reached.\n" +
     "        // This used to restrict only the FREE pool: when no specialist was free it fell\n" +
     "        // through to overflow and then to every mixer on the roster, so a re-plan under\n" +
     "        // load handed a Music/Songs title to someone with no music expertise. That is the\n" +
     "        // bug Tara reported on 2026-08-15; the free path was fixed then and the fallbacks\n" +
     "        // were not. Forcing an overlap onto a specialist is the correct outcome here \u2014 the\n" +
     "        // alternative is giving the work to someone who cannot do it.\n" +
     "        if (isMusic) {\n" +
     "          const tier = musicPool(n => eng[n].mix && (!needAdv || eng[n].lvl === 'Advanced') && hasAtmos(n));\n" +
     "          const free_ = tier.filter(n => free(n, mixw));\n" +
     "          if (free_.length) {\n" +
     "            const who = pick(free_, Math.min(...mixw), true); commit(who, mixw); emit('Mix', who, mixw);\n" +
     "          } else if (tier.length) {\n" +
     "            const f = forcePick(tier, mixw); const ov = inter(eng[f].busy, mixw).length;\n" +
     "            commit(f, mixw); forcedCount += 1;\n" +
     "            emit('Mix', f, mixw, `FORCED OVERLAP (${ov}wk) \u2014 music mixing is restricted to ${tier.join(', ')}`);\n" +
     "          }\n" +
     "          // no specialist can mix at this level: fall through, and the warning stands\n" +
     "        } else if (mp.length) { const who = pick(mp, Math.min(...mixw)); commit(who, mixw); emit('Mix', who, mixw); }\n"],

  ],
  'engine/assign.js': [
    // MUSIC RANKING (Tara, 2026-08-15). music_specialist stopped being a yes/no and
    // became an ORDER: 1 = first choice, 2 = second. "Yes" still reads as rank 1, so an
    // un-migrated roster behaves exactly as before. The pool SHAPE is unchanged — the
    // same people are eligible; only the tiebreak between them is new, which is why
    // this is a substitution and not another rewritten region.
    ["  const yes = v => String(v).trim().toLowerCase() === 'yes';\n",
     "  const yes = v => String(v).trim().toLowerCase() === 'yes';\n" +
     "  const mrank = v => { const s = String(v == null ? '' : v).trim().toLowerCase();\n" +
     "    if (s === 'yes') return 1;\n" +
     "    const n = parseInt(s, 10); return (Number.isFinite(n) && n > 0) ? n : 0; };\n"],
    ["      lvl: (r.mix_level || '').trim(), music: yes(r.music_specialist),",
     "      lvl: (r.mix_level || '').trim(),\n" +
     "      // music_specialist carries an ORDER, not just a yes: 1 = first choice, 2 = second.\n" +
     "      // \"Yes\" still means rank 1, so an older roster keeps working.\n" +
     "      musicRank: mrank(r.music_specialist), music: mrank(r.music_specialist) > 0,"],
    // pick gains an opt-in rank tiebreak; musicPool is added beside it. Every non-music
    // call passes byRank falsy and takes the identical branch as before.
    ["  const pick = (pool, ref) => {\n    if (!pool.length) return null;\n",
     "  // byRank puts music_specialist order ahead of load, so the first choice is taken\n" +
     "  // while free rather than only when they happen to be the cheapest that week. Opt-in:\n" +
     "  // every non-music call behaves exactly as before.\n" +
     "  const pick = (pool, ref, byRank) => {\n" +
     "    if (!pool.length) return null;\n" +
     "    if (byRank) {\n" +
     "      const best = Math.min(...pool.map(n => eng[n].musicRank));\n" +
     "      pool = pool.filter(n => eng[n].musicRank === best);\n" +
     "    }\n"],
    // The music-specialist pool, inserted above forcePick. Pure insertion.
    ["  const forcePick = (pool, wks) => pool.slice().sort((a, b) =>",
     "  // Every music specialist, so the ordinary ladder can divide the dub or split\n" +
     "  // dub-from-edit between them. Order is expressed by RANK inside pick and the week\n" +
     "  // allocator, not by narrowing the pool \u2014 narrowing meant that if the first choice\n" +
     "  // could not take the WHOLE block it dropped to the second choice wholesale, when a\n" +
     "  // share between them is usually the better answer.\n" +
     "  const musicPool = can => Object.keys(eng).filter(n => eng[n].musicRank && can(n));\n" +
     "\n" +
     "  const forcePick = (pool, wks) => pool.slice().sort((a, b) =>"],
    // The three whole-block picks opt into the rank tiebreak when the project is
    // music, so the first choice is taken while free. Non-music passes isMusic false
    // and the call is byte-equivalent to before.
    ["    const samePick = samePool.length ? pick(samePool, Math.min(...recedit)) : null;",
     "    const samePick = samePool.length ? pick(samePool, Math.min(...recedit), isMusic) : null;"],
    ["? pick(dubPool, Math.min(...dubw))", "? pick(dubPool, Math.min(...dubw), isMusic)"],
    ["? pick(editPool, Math.min(...editw))", "? pick(editPool, Math.min(...editw), isMusic)"],
    // ATMOS (Tara, 2026-08-30). A capability flag on the roster, independent of
    // mix_level: the room and the skill are different things, and an Advanced mixer
    // without the room still cannot take the job. Pure addition to the map.
    ['overflow: yes(r.overflow_only), nonNetflix: yes(r.non_netflix_router),',
     'overflow: yes(r.overflow_only), specials: yes(r.does_specials),\n' +
     '      // Atmos is a ROOM, not a skill level. It is separate from mix_level because the\n' +
     '      // two are independent: an Advanced mixer without the room still cannot do it.\n' +
     '      atmos: yes(r.atmos),'],
    // A hand-picked mixer without the room is allowed but flagged — same shape as the
    // existing mix_level warning right above it. The manual choice still wins: the tool
    // records that it was overridden rather than refusing the instruction.
    ["      commit(mixOv, mixw, m); mixer = mixOv; mixNote = 'Manually assigned.';",
     "      if (needAtmos && !eng[mixOv].atmos)\n" +
     "        warnings.push(`${mixOv} has no Atmos room and this project needs one \u2014 the manual choice was applied anyway.`);\n" +
     "      commit(mixOv, mixw, m); mixer = mixOv; mixNote = 'Manually assigned.';"],
    // The second half of a hand-picked dub. Read here, used by the record/edit ladder,
    // which is already a rewritten region.
    ["  const recOv = (proj.recordist_override || 'Auto').trim();",
     "  const recOv = (proj.recordist_override || 'Auto').trim();\n" +
     "  const recOv2 = (proj.recordist_override_2 || 'Auto').trim();"],
    ["  const isNetflix = String(proj.client).trim() === 'Netflix';",
     '  // Rule 7, restated: SPECIAL projects route to the specials engineer. It used to\n' +
     "  // key off client !== 'Netflix', which was the same set by coincidence of the\n" +
     '  // roster, not by intent — see E_HEADERS.'],
    ['  if (!isNetflix) pool = Object.keys(eng).filter(n => eng[n].nonNetflix);',
     '  if (isSpecial) pool = Object.keys(eng).filter(n => eng[n].specials);'],
    // The specials engineer is no longer excluded from ordinary work (Tara, 2026-08-30).
    // does_specials routes special projects TO them; the handoff's non_netflix_router
    // also held them back from everything else, and that half was never intended.
    ['pool = Object.keys(eng).filter(n => eng[n].record && eng[n].edit && !eng[n].nonNetflix && !eng[n].overflow);',
     'pool = Object.keys(eng).filter(n => eng[n].record && eng[n].edit && !eng[n].overflow);'],
  ],
  'engine/stats.js': [
    ['overflow_only: yes(e.overflow_only), non_netflix_router: yes(e.non_netflix_router) };',
     'overflow_only: yes(e.overflow_only), does_specials: yes(e.does_specials) };'],
    ["roster[n]?.non_netflix_router ? 'non-Netflix router' : ''",
     "roster[n]?.does_specials ? 'specials' : ''"],
  ],
};

// Removes an approved hunk from the reference, and its replacement from the live
// file, so the remainder can be compared byte for byte.
function cutApprovedHunks(refRel, refSrc, liveSrc) {
  const hunks = APPROVED_HUNKS[refRel] || [];
  const notes = [];
  for (const h of hunks) {
    const refHit = refSrc.indexOf(h.original) !== -1;
    if (refHit) refSrc = refSrc.replace(h.original, '@@APPROVED@@');
    const s = liveSrc.indexOf(h.startsWith);
    const e = s === -1 ? -1 : liveSrc.indexOf(h.endsWith, s);
    const liveHit = s !== -1 && e !== -1;
    if (liveHit) liveSrc = liveSrc.slice(0, s) + '@@APPROVED@@' + liveSrc.slice(e + h.endsWith.length);
    notes.push({ what: h.what, refHit, liveHit });
  }
  return { refSrc, liveSrc, notes, expected: hunks.length };
}

function applyDesugar(refRel, src) {
  const subs = V8_DESUGAR[refRel] || [];
  let out = src, applied = 0;
  for (const [from, to] of subs) {
    if (out.indexOf(from) === -1) continue;
    out = out.split(from).join(to);
    applied++;
  }
  return { out, applied, expected: subs.length };
}

console.log('Engine drift — live .gs vs handoff original');
for (const [refRel, liveRel] of PAIRS) {
  const rawRef = stripExports(fs.readFileSync(path.join(root, refRel), 'utf8'));
  let des = applyDesugar(refRel, rawRef);
  const subs = APPROVED_SUBS[refRel] || [];
  let subsApplied = 0;
  for (const [from, to] of subs) {
    if (des.out.indexOf(from) === -1) continue;
    des.out = des.out.split(from).join(to);
    subsApplied++;
  }
  if (subs.length) {
    ok(`${refRel}: all ${subs.length} approved one-line change(s) still apply`,
       subsApplied === subs.length,
       `applied ${subsApplied} of ${subs.length} — the upstream line changed shape`);
  }
  if (des.expected) {
    ok(`${refRel}: all ${des.expected} V8 desugar substitution(s) still apply`,
       des.applied === des.expected,
       `applied ${des.applied} of ${des.expected} — the upstream line changed shape, re-check the substitution`);
  }

  const rawLive = stripHeader(fs.readFileSync(path.join(root, liveRel), 'utf8'));
  const rw = cutRewritten(refRel, des.out, rawLive);
  rw.notes.forEach(n => {
    ok(`${refRel}: rewritten region still located — ${n.what}`, n.refOk && n.liveOk,
       `reference ${n.refOk ? 'found' : 'NOT FOUND'}, live ${n.liveOk ? 'found' : 'NOT FOUND'}`);
  });
  const cut = cutApprovedHunks(refRel, rw.refSrc, rw.liveSrc);
  cut.notes.forEach(n => {
    ok(`${refRel}: approved change still isolated — ${n.what}`, n.refHit && n.liveHit,
       `reference hunk ${n.refHit ? 'found' : 'NOT FOUND'}, live replacement ${n.liveHit ? 'found' : 'NOT FOUND'}`);
  });

  const ref  = norm(cut.refSrc);
  const live = norm(cut.liveSrc);
  const modulo = [des.expected ? 'V8 desugaring' : null,
                  rw.expected ? `${rw.expected} rewritten region(s)` : null,
                  cut.expected ? `${cut.expected} approved change(s)` : null].filter(Boolean).join(' + ');
  if (ref === live) {
    ok(`${liveRel} matches ${refRel}` + (modulo ? ` (modulo ${modulo})` : ''), true);
  } else {
    // report the first differing line to make the drift obvious
    const a = ref.split('\n'), b = live.split('\n');
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++;
    ok(`${liveRel} matches ${refRel}`, false,
       `first difference at line ${i + 1}:\n            original: ${JSON.stringify(a[i])}\n            live    : ${JSON.stringify(b[i])}`);
  }
}

console.log('\nThe .gs sources evaluate and export what the sheet needs');
{
  let api = null, err = null;
  try { api = loadAppsScript(); } catch (e) { err = e; }
  ok('all .gs files evaluate together without error', !!api, err && err.message);
  if (api) {
    for (const fn of ['runAssign', 'computeStats', 'plot', 'plotBatch',
                      'stats', 'computeCapacity', 'weekLabel']) {
      ok(`${fn} is callable`, typeof api[fn] === 'function');
    }
    // Month names rather than the tracker's single initials, per Tara
    // (2026-08-13) — J/J/J and M/M and A/A are ambiguous and hard to scan.
    ok('week labels use readable month names (W0 = Dec 1-7)',
       api.weekLabel(0) === 'Dec 1-7', api.weekLabel(0));
    ok('a week spanning two months reads "Dec 29 - Jan 4"',
       api.weekLabel(4) === 'Dec 29 - Jan 4', api.weekLabel(4));
    ok('the day-range form drops the month for a banded grid',
       api.weekDayRange(0) === '1-7' && api.weekDayRange(4) === '29 - Jan 4',
       api.weekDayRange(0) + ' / ' + api.weekDayRange(4));
    ok('monthLabel names the month for the band', api.monthLabel(0) === 'Dec 2025', api.monthLabel(0));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
