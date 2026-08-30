// For every forced overlap: what is the SMALLEST number of engineers whose free
// weeks would cover the block? assign.js's tryShare only ever tries pairs, so if
// a trio or a quartet could have covered it, the engine forces instead.
//
// Rule 10 says "share a phase between two engineers", and rule 9 says force when
// "no shared pair works" — so pair-only is what the spec asks for. This tool
// measures what that costs.
//
// Run: node tools/min_cover.js
const { loadAppsScript } = require('../test/loader.js');
const A = loadAppsScript();
const runAssign = A.runAssign, widx = A.widx, weekLabel = A.weekLabel;
const engineers = require('../validation/engineers.json');
const projects = require('../validation/projects.json');

const yes = v => String(v).trim().toLowerCase() === 'yes';

function busyState(book) {
  const st = {};
  for (const e of engineers) st[e.name] = new Set();
  for (const b of book) {
    if (!st[b.engineer]) continue;
    for (let w = widx(b.start_date); w <= widx(b.end_date); w++) st[b.engineer].add(w);
  }
  return st;
}
function receditPool(p) {
  if (String(p.client).trim() !== 'Netflix')
    return engineers.filter(e => yes(e.does_specials)).map(e => e.name);
  let pool = engineers.filter(e => yes(e.can_record) && yes(e.can_edit) &&
    !yes(e.does_specials) && !yes(e.overflow_only)).map(e => e.name);
  if (yes(p.music_songs)) pool = pool.concat(engineers.filter(e => yes(e.music_specialist)).map(e => e.name));
  return [...new Set(pool)];
}
function windows(p) {
  const dlW = widx(p.deadline);
  const blk = (endW, n) => { const s = new Set(); for (let w = endW-n+1; w <= endW; w++) s.add(w); return n > 0 ? s : new Set(); };
  const mixw = blk(dlW - 1, p.mix_weeks);
  const editEnd = mixw.size ? Math.min(...mixw) - 1 : dlW - 1;
  const editw = blk(editEnd, p.edit_weeks);
  const dubEnd = editw.size ? Math.min(...editw) - 1 : editEnd;
  return { recedit: new Set([...blk(dubEnd, p.dub_weeks), ...editw]) };
}

// Smallest subset of pool whose free-weeks cover `needed`. Brute force over
// subsets — the pool is 6 people, so 64 combinations.
function minCover(pool, needed, busy) {
  const weeks = [...needed].sort((a,b)=>a-b);
  const freeOf = {};
  pool.forEach(n => { freeOf[n] = new Set(weeks.filter(w => !busy[n].has(w))); });
  for (let size = 1; size <= pool.length; size++) {
    const combos = [];
    (function pick(start, acc) {
      if (acc.length === size) { combos.push(acc.slice()); return; }
      for (let i = start; i < pool.length; i++) { acc.push(pool[i]); pick(i+1, acc); acc.pop(); }
    })(0, []);
    for (const combo of combos) {
      if (weeks.every(w => combo.some(n => freeOf[n].has(w)))) {
        // turn the cover into a concrete week-by-week allocation
        const alloc = {};
        combo.forEach(n => alloc[n] = []);
        weeks.forEach(w => {
          const who = combo.filter(n => freeOf[n].has(w))
            .sort((a,b) => alloc[a].length - alloc[b].length)[0];
          alloc[who].push(w);
        });
        // drop anyone who ended up with nothing
        Object.keys(alloc).forEach(n => { if (!alloc[n].length) delete alloc[n]; });
        return { size: Object.keys(alloc).length, alloc };
      }
    }
  }
  return null;
}

const ordered = projects.slice().sort((a,b)=>String(a.deadline).localeCompare(String(b.deadline)));
let book = [];
const findings = [];

for (const p of ordered) {
  const before = busyState(book);
  const out = runAssign(p, book, engineers);
  book = book.concat(out.booking_rows);
  const forcedRE = out.booking_rows.some(b => /FORCED/i.test(b.note||'') && b.phase !== 'Mix');
  if (!forcedRE) continue;

  const { recedit } = windows(p);
  const pool = receditPool(p);
  const cover = minCover(pool, recedit, before);
  const forcedOnto = out.booking_rows.find(b => /FORCED/i.test(b.note||'') && b.phase !== 'Mix').engineer;

  findings.push({ project: p.project_title, forcedOnto, weeks: [...recedit].sort((a,b)=>a-b), cover });

  console.log(`\n${p.project_title}  — engine forced onto ${forcedOnto}`);
  console.log(`  block: ${[...recedit].sort((a,b)=>a-b).map(w=>weekLabel(w)).join(' | ')}`);
  if (!cover) {
    console.log('  NO cover exists at any size — every week is busy for everyone. Force is unavoidable.');
  } else {
    console.log(`  smallest covering set: ${cover.size} engineer(s) — ${
      Object.keys(cover.alloc).map(n => `${n}:${cover.alloc[n].length}wk`).join(', ')}`);
    Object.keys(cover.alloc).forEach(n => {
      const ws = cover.alloc[n];
      const contiguous = ws.every((w,i) => i === 0 || w === ws[i-1] + 1);
      console.log(`     ${n.padEnd(8)} ${ws.map(w=>weekLabel(w)).join(', ')}${contiguous ? '' : '   (non-contiguous)'}`);
    });
    if (cover.size === 2) console.log('  >>> A PAIR covers this. tryShare should have found it — real bug.');
    else if (cover.size >= 3) console.log(`  >>> Needs ${cover.size} people. tryShare only tries pairs, so it forces instead.`);
  }
}

console.log('\n' + '='.repeat(72));
const avoidableByPair = findings.filter(f => f.cover && f.cover.size === 2);
const avoidableByMore = findings.filter(f => f.cover && f.cover.size >= 3);
const trulyImpossible = findings.filter(f => !f.cover);
console.log(`forced record/edit projects: ${findings.length}`);
console.log(`  a PAIR could have covered:        ${avoidableByPair.length}  <- would be an engine bug`);
console.log(`  only 3+ engineers could cover:    ${avoidableByMore.length}  <- spec limit (rule 10 says pairs)`);
console.log(`  no set of any size could cover:   ${trulyImpossible.length}  <- genuinely impossible`);
