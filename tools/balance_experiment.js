// Which assignment strategy divides work most equally?
//
// The engine plots each project's phase windows from its deadline, so the ORDER
// in which projects are assigned changes only WHO gets picked — never any date.
// That makes processing order a free variable, and HANDOFF §10 limitation 3
// already flags it as affecting the outcome.
//
// Run: node tools/balance_experiment.js
const { loadAppsScript } = require('../test/loader.js');
const engineers = require('../validation/engineers.json');
const projects = require('../validation/projects.json');

const A = loadAppsScript({ cap: 0, wholeEdit: true });
const NAMES = engineers.map(e => e.name);

function weeksOfProject(p) {
  const n = v => { const x = parseInt(v, 10); return Number.isFinite(x) && x > 0 ? x : 0; };
  return n(p.dub_weeks) + n(p.edit_weeks) + n(p.mix_weeks);
}

// Assign every project in the given order; windows come from each deadline.
function runOrder(order) {
  let book = [];
  for (const p of order) {
    const out = A.runAssign(A.normalizeProject(p).project, book, engineers);
    book = book.concat(out.booking_rows);
  }
  return book;
}

function score(book) {
  const weeks = {};
  NAMES.forEach(n => { weeks[n] = new Set(); });
  book.forEach(b => {
    if (!weeks[b.engineer]) weeks[b.engineer] = new Set();
    for (let w = A.widx(b.start_date); w <= A.widx(b.end_date); w++) weeks[b.engineer].add(w);
  });
  const loads = NAMES.map(n => weeks[n].size);
  const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
  const sd = Math.sqrt(loads.reduce((a, b) => a + (b - mean) ** 2, 0) / loads.length);
  const forced = book.filter(b => /FORCED/i.test(b.note || '')).length;
  const forcedProjects = new Set(book.filter(b => /FORCED/i.test(b.note || '')).map(b => b.project)).size;
  return {
    loads, max: Math.max(...loads), min: Math.min(...loads),
    spread: Math.max(...loads) - Math.min(...loads),
    sd: Math.round(sd * 100) / 100,
    mean: Math.round(mean * 10) / 10,
    forced, forcedProjects, rows: book.length,
  };
}

// deterministic shuffle so the experiment is reproducible
function lcg(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }
function shuffled(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const byDeadline = projects.slice().sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
const byBiggest  = projects.slice().sort((a, b) => weeksOfProject(b) - weeksOfProject(a) ||
                                                   String(a.deadline).localeCompare(String(b.deadline)));
const bySmallest = byBiggest.slice().reverse();

const strategies = [
  ['deadline order (current)', byDeadline],
  ['largest project first (LPT)', byBiggest],
  ['smallest project first', bySmallest],
];

// random restarts: many orders, keep the best. Fixed seed => deterministic.
const RESTARTS = 400;
let best = null, bestScore = null;
const rnd = lcg(20260813);
for (let i = 0; i < RESTARTS; i++) {
  const order = shuffled(projects, rnd);
  const s = score(runOrder(order));
  const key = [s.forcedProjects, s.max, s.sd];
  if (!bestScore || key[0] < bestScore[0] ||
      (key[0] === bestScore[0] && (key[1] < bestScore[1] ||
      (key[1] === bestScore[1] && key[2] < bestScore[2])))) { bestScore = key; best = order; }
}
strategies.push([`best of ${RESTARTS} random orders`, best]);

console.log('objective: fewest forced overlaps, then lowest peak load, then flattest spread\n');
const rows = strategies.map(([label, order]) => [label, score(runOrder(order))]);
const H = ['strategy', 'forced', 'projs', 'peak', 'min', 'spread', 'std dev', 'rows'];
const line = r => [r[0], r[1].forced, r[1].forcedProjects, r[1].max, r[1].min, r[1].spread, r[1].sd, r[1].rows];
const w = H.map((h, i) => Math.max(String(h).length, ...rows.map(r => String(line(r)[i]).length)));
console.log(H.map((h, i) => h.padEnd(w[i])).join('  '));
console.log(w.map(x => '-'.repeat(x)).join('  '));
rows.forEach(r => console.log(line(r).map((v, i) => String(v).padEnd(w[i])).join('  ')));

console.log('\nper-engineer weeks:');
rows.forEach(r => {
  const s = r[1];
  console.log('  ' + r[0].padEnd(28) + NAMES.map((n, i) => `${n} ${String(s.loads[i]).padStart(2)}`).join('  '));
});

// how much spread is there across ALL the random orders? shows what order alone costs
const all = [];
const rnd2 = lcg(20260813);
for (let i = 0; i < RESTARTS; i++) all.push(score(runOrder(shuffled(projects, rnd2))));
const peaks = all.map(s => s.max).sort((a, b) => a - b);
const fps = all.map(s => s.forcedProjects).sort((a, b) => a - b);
console.log(`\nacross ${RESTARTS} random orders:`);
console.log(`  peak load ranged ${peaks[0]} .. ${peaks[peaks.length-1]} weeks`);
console.log(`  forced projects ranged ${fps[0]} .. ${fps[fps.length-1]}`);
console.log('  => order alone accounts for that much of the difference.');
