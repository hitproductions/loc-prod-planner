// Rule 10 audit: for EVERY forced overlap the engine produces, brute-force
// whether a single engineer, a split, or a shared pair was actually available
// at that moment. If any was, the engine forced when it shouldn't have.
//
// Run: node tools/verify_force_order.js
const { loadAppsScript } = require('../test/loader.js');
const A = loadAppsScript();
const runAssign = A.runAssign;
const engineers = require('../validation/engineers.json');
const projects  = require('../validation/projects.json');
const { widx } = A;

const yes = v => String(v).trim().toLowerCase() === 'yes';

// Rebuild engineer busy-state from a book exactly as assign.js does.
function busyState(book) {
  const st = {};
  for (const e of engineers) st[e.name] = new Set();
  for (const b of book) {
    if (!st[b.engineer]) continue;
    for (let w = widx(b.start_date); w <= widx(b.end_date); w++) st[b.engineer].add(w);
  }
  return st;
}

// The record/edit pool assign.js would use for this project.
function receditPool(p) {
  const isSpecial = String(p.special_project).trim() === 'Yes';
  if (isSpecial) return engineers.filter(e => yes(e.does_specials)).map(e => e.name);
  let pool = engineers.filter(e => yes(e.can_record) && yes(e.can_edit) &&
    !yes(e.does_specials) && !yes(e.overflow_only)).map(e => e.name);
  if (yes(p.music_songs)) pool = pool.concat(engineers.filter(e => yes(e.music_specialist)).map(e => e.name));
  return [...new Set(pool)];
}

// Phase windows, same backward plot as the engine.
function windows(p) {
  const dlW = widx(p.deadline);
  const blk = (endW, n) => { const s = new Set(); for (let w = endW - n + 1; w <= endW; w++) s.add(w); return n > 0 ? s : new Set(); };
  const mixw = blk(dlW - 1, p.mix_weeks);
  const editEnd = mixw.size ? Math.min(...mixw) - 1 : dlW - 1;
  const editw = blk(editEnd, p.edit_weeks);
  const dubEnd = editw.size ? Math.min(...editw) - 1 : editEnd;
  const dubw = blk(dubEnd, p.dub_weeks);
  return { dubw, editw, mixw, recedit: new Set([...dubw, ...editw]) };
}

const ordered = projects.slice().sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
let book = [];
let violations = 0, audited = 0;

for (const p of ordered) {
  const before = busyState(book);              // state the engine sees for this project
  const out = runAssign(p, book, engineers);
  book = book.concat(out.booking_rows);

  const forcedRE  = out.booking_rows.some(b => /FORCED/i.test(b.note || '') && b.phase !== 'Mix');
  const forcedMix = out.booking_rows.some(b => /FORCED/i.test(b.note || '') && b.phase === 'Mix');
  if (!forcedRE && !forcedMix) continue;

  const { dubw, editw, mixw, recedit } = windows(p);

  if (forcedRE) {
    audited++;
    const pool = receditPool(p);
    const freeFor = (n, wks) => [...wks].every(w => !before[n].has(w));

    // 1. single engineer for the whole block
    const singles = pool.filter(n => freeFor(n, recedit));

    // 2. split: one free for all of dub, a DIFFERENT one free for all of edit
    const splits = [];
    if (dubw.size && editw.size) {
      for (const a of pool) for (const b of pool) {
        if (a === b) continue;
        if (freeFor(a, dubw) && freeFor(b, editw)) splits.push(`${a}(dub)/${b}(edit)`);
      }
    }

    // 3. share: some pair covers every needed week between them, both doing >=1
    const shares = [];
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j];
      const covered = [...recedit].every(w => !before[a].has(w) || !before[b].has(w));
      if (!covered) continue;
      const onlyA = [...recedit].filter(w => before[b].has(w));   // only a can take
      const onlyB = [...recedit].filter(w => before[a].has(w));   // only b can take
      // both must end up with at least one week for tryShare to accept the pair
      const flexible = [...recedit].filter(w => !onlyA.includes(w) && !onlyB.includes(w));
      const canBothWork = (onlyA.length + flexible.length > 0) && (onlyB.length + flexible.length > 0)
        && (onlyA.length > 0 || onlyB.length > 0 || flexible.length >= 2);
      if (canBothWork) shares.push(`${a}+${b}`);
    }

    const engineerForced = out.booking_rows.find(b => /FORCED/i.test(b.note || '') && b.phase !== 'Mix').engineer;
    const bad = singles.length || splits.length || shares.length;
    if (bad) violations++;
    console.log(`\n${bad ? 'VIOLATION' : 'OK'}  ${p.project_title}  (record/edit forced onto ${engineerForced})`);
    console.log(`   needs weeks ${[...recedit].sort((a,b)=>a-b).join(',')}  dub=${p.dub_weeks} edit=${p.edit_weeks}`);
    console.log(`   pool (${pool.length}): ${pool.join(', ')}`);
    console.log(`   free-for-whole-block : ${singles.length ? singles.join(', ') : 'none'}`);
    console.log(`   valid splits         : ${splits.length ? splits.slice(0,4).join(', ') : 'none'}`);
    console.log(`   viable shared pairs  : ${shares.length ? shares.slice(0,4).join(', ') : 'none'}`);
    if (!bad) {
      // explain WHY nothing worked
      const allBusy = [...recedit].filter(w => pool.every(n => before[n].has(w)));
      console.log(`   reason: ${allBusy.length
        ? `week(s) ${allBusy.join(',')} busy for every engineer in the pool — no pair can cover them`
        : 'no pair covers the block between them'}`);
    }
  }

  if (forcedMix) {
    audited++;
    const needAdv = String(p.mix_level_required).trim() === 'Advanced';
    const regular = engineers.filter(e => yes(e.can_mix) && !yes(e.overflow_only) &&
      (needAdv ? String(e.mix_level).trim() === 'Advanced' : String(e.mix_level).trim() === 'Developing')).map(e => e.name);
    const overflow = engineers.filter(e => yes(e.overflow_only) && yes(e.can_mix) &&
      (!needAdv || String(e.mix_level).trim() === 'Advanced')).map(e => e.name);
    const freeReg = regular.filter(n => [...mixw].every(w => !before[n].has(w)));
    const freeOfl = overflow.filter(n => [...mixw].every(w => !before[n].has(w)));
    const bad = freeReg.length || freeOfl.length;
    if (bad) violations++;
    console.log(`\n${bad ? 'VIOLATION' : 'OK'}  ${p.project_title}  (MIX forced)`);
    console.log(`   free regular mixers: ${freeReg.join(', ') || 'none'}   free overflow: ${freeOfl.join(', ') || 'none'}`);
    console.log(`   note: mixing is never split (rule 5), so share does not apply`);
  }
}

console.log(`\n${audited} forced assignment(s) audited, ${violations} rule-10 violation(s).`);
process.exit(violations ? 1 : 0);
