// Sheet layout, colours and column contracts. One place to change names.

// Four data tabs. The schedule and engineer view live in the web app now — a
// second renderer inside the sheet would be stale most of the time, and a stale
// grid in a scheduling tool reads as authoritative.
var TAB = {
  PROJECTS:  'Projects',
  BOOKINGS:  'Bookings',
  ENGINEERS: 'Engineers',
  CONFIG:    'Config',
};

// Tabs earlier versions generated. Setup offers to remove them.
var RETIRED_TABS = ['Schedule', 'Engineer view', 'Re-plan'];   // Re-plan tab AND feature

// Colours the SHEET uses. The phase colours (amber/blue/pink) used to live here too,
// for a Schedule tab this tool no longer draws — the web app owns them now, in
// Styles.html, with identical values. Keeping a second copy meant two places to
// change and one of them silently unread (2026-08-13).
var COLOR = {
  URGENT:      '#FF0000',   // red — final delivery / conflict
  HEADER_BG:   '#1F2A37',
  HEADER_FG:   '#FFFFFF',
  OUTPUT_BG:   '#F7F7F5',   // engine-written columns read as not-yours-to-type
  MUTED:       '#667085',
  WARN_BG:     '#FFF4E5',
  FORCED_BG:   '#FFE0E0',
};

// ---- Projects tab -----------------------------------------------------------
// The master list, one row per project. The app reads and writes it; the tab
// exists so the data stays readable and repairable without a developer
// (HANDOFF §8). There is no Commit column — the app has buttons, so nothing
// here needs to pretend a checkbox is one.
// Three manual picks, one per role, because the three phases can go to three
// different engineers. A recordist pick alone still covers dub AND edit (rule 5's
// default); picking an editor is what separates them.
// LOCKED sits AFTER the engine's block rather than beside the other inputs on
// purpose: inserting a column mid-table means re-pasting every row, and that had
// just been paid for once. So the layout is inputs 1..10, engine 11..19, and one
// more input at 20.
// ATMOS (2026-08-30) is its own flag. It had been folded into Special, which meant
// "not Netflix" and "needs an Atmos room" were the same checkbox — two unrelated
// facts, so a Netflix Atmos title could not be expressed at all.
//
// REC_PICK2 is the second half of a hand-picked dub. One name was the only thing the
// sheet could say, so splitting a long dub across two people by hand was impossible
// even though the engine has divided dubs on its own since the start.
var P_COL = {
  TITLE: 1, CLIENT: 2, DEADLINE: 3, PHASES: 4, LEVEL: 5,
  MUSIC: 6, SPECIAL: 7, ATMOS: 8,
  REC_PICK: 9, REC_PICK2: 10, ED_PICK: 11, MIX_PICK: 12,
  DUB_W: 13, EDIT_W: 14, MIX_W: 15,
  RECORDIST: 16, EDITOR: 17, MIXER: 18, WARNINGS: 19, NOTES: 20, PLOTTED: 21,
  LOCKED: 22,
  // Appended, deliberately AFTER Locked. The web app marks a project complete and
  // reads these; this app only needs to create them, so that Set up sheets does not
  // wipe a column it has never heard of. Nothing here reads STATUS or COMPLETED.
  STATUS: 23, COMPLETED: 24,
};
var P_INPUT_LAST  = P_COL.MIX_PICK;      // columns 1..12 are the user's
var P_OUTPUT_FIRST = P_COL.DUB_W;        // 13..21 belong to the engine
var P_OUTPUT_LAST  = P_COL.PLOTTED;
var P_LAST = P_COL.COMPLETED;
var P_HEADER_ROW = 2;                    // row 1 is the banner
var P_FIRST_DATA_ROW = 3;
var P_ROWS = 300;                        // validated/formatted depth

var P_HEADERS = [
  'Project', 'Client', 'Deadline', 'Phases D/E/M', 'Mix level',
  'Music', 'Special', 'Atmos',
  'Recordist pick', 'Recordist pick 2', 'Editor pick', 'Mixer pick',
  'Dub wks', 'Edit wks', 'Mix wks',
  'Recordist', 'Editor', 'Mixer', 'Warnings', 'Notes', 'Plotted', 'Locked',
  'Status', 'Completed',
];

// ---- Bookings tab -----------------------------------------------------------
var B_HEADERS = ['project', 'phase', 'engineer', 'start_date', 'end_date', 'source', 'note', 'status'];
var B_COL = { PROJECT:1, PHASE:2, ENGINEER:3, START:4, END:5, SOURCE:6, NOTE:7, STATUS:8 };
var B_HEADER_ROW = 1;

// ---- Engineers tab ----------------------------------------------------------
// does_specials replaced non_netflix_router on 2026-08-13. They were the same
// person doing the same thing: non-Netflix work IS the special work, so routing
// off the client name was an indirection. The gate is now the project's own
// Special flag, and the client field is data rather than logic — which also means
// a Netflix project marked Special routes here too, where before it could not.
// atmos is APPENDED, not inserted. readEngineersUncached_ maps this tab by hard-coded
// position (r[0]..r[7]), so slotting a column in beside mix_level where it belongs
// logically would silently re-point every flag after it on any sheet not yet migrated.
var E_HEADERS = ['name', 'can_record', 'can_edit', 'can_mix', 'mix_level',
                 'music_specialist', 'overflow_only', 'does_specials', 'atmos'];
var E_HEADER_ROW = 1;

// ---- Sharing policy ---------------------------------------------------------
// How a project's dub+edit block may be divided when no single engineer can take
// it. Studio rules, tunable here rather than in the engine.
//
//   SHARE_CAP                 max engineers on the DUB of one project. The edit
//                             holder is a SEPARATE assignment and is not counted
//                             here — only dubbing is being divided. 2 = two
//                             dubbers max. 0 = as many as it takes.
//   SHARE_PREFER_WHOLE_EDIT   true keeps a project's editing with ONE engineer
//                             and divides the dubbing instead. Editing continuity
//                             within a title matters more than dubbing continuity.
var SHARE_CAP = 2;
var SHARE_PREFER_WHOLE_EDIT = true;

//   DUB_DIVISION_FIRST  the STARTING POINT only. The solver decides per project
//                       whether dividing that project's dub improves the finished
//                       plan, and keeps it only where it does — so this is not a
//                       policy to get right, just where the search begins.
//                       Measured: dividing everywhere makes things worse, because
//                       more small pieces fragment each calendar and unbroken runs
//                       lengthen. Dividing selectively is what pays.
var DUB_DIVISION_FIRST = false;

// ---- Order search -----------------------------------------------------------
// The engine plots each project's phase windows from its own deadline, so the
// ORDER in which projects are assigned changes only WHO gets picked — never a
// single date. That makes ordering a free variable, and HANDOFF §10 limitation 3
// already notes it changes the outcome. Measured on the seeded book: order alone
// swung peak load between 17 and 23 weeks.
//
// So a batch is solved by running the same greedy engine under several orderings
// and keeping the best plan. Deadline order is always tried first and only
// replaced by something strictly better, so this can never do worse than before.
//
//   SOLVE_RESTARTS  extra shuffled orders to try. 0 disables the search.
//                   Returns flatten past ~200; 200 costs about 150ms.
//   SOLVE_SEED      fixed, so the same inputs always produce the same plan (§1).
var SOLVE_RESTARTS = 200;
var SOLVE_SEED = 20260813;

// What "better" means, applied in this order. Reorder this list to change the
// policy; nothing else needs touching. THE ORDERING IS THE POLICY — the search
// optimises whatever you rank highest, faithfully, and a metric ranked low is
// traded away without comment.
//
// Balance is measured over the engineers who actually compete for regular
// record/edit work. The overflow reserve is a cost to minimise, never a load to
// equalise; measuring spread across everyone reads its deliberately low
// utilisation as imbalance.
//
// OVERLAP IS RANKED FIRST, and the reason is worth keeping, because this list
// previously ranked max_consecutive second and that was a mistake of mine.
//
// I had presented "unbroken weeks" as a burnout guard and traded overlaps against
// it. Tara's correction (2026-08-13): *an overlap IS the burnout* — a double-booked
// week means two projects at once, the most punishing week there is. Whereas
// max_consecutive counts weeks with ANY work, so a long run is just continuous
// employment. The two were never in tension; I had invented the tension by naming
// a weak proxy "burnout".
//
// Measured on the seeded book, and this is the whole argument:
//
//   burnout 2nd    6 doubled engineer-weeks, spread across FOUR people.
//                  Runs capped at 9 — but those shorter runs are idle gaps
//                  between blocks, which buys nobody anything.
//   overlap 1st    2 doubled weeks, on ONE person. Seven of eight engineers are
//                  never double-booked at all. Longest runs reach 13 weeks and
//                  contain ZERO doubled weeks — thirteen weeks of one project at
//                  a time, which is simply a job.
//
// If a genuine strain metric is ever wanted, it is CONSECUTIVE DOUBLED weeks, not
// consecutive booked weeks. max_consecutive stays in the list, ranked low, as a
// mild preference for handing off rather than as a welfare measure.
var SOLVE_OBJECTIVE = [
  'reserve_double_booked',   // never double-book the reserve
  'total_double_booked',     // then the fewest overloaded engineer-weeks anywhere
  'max_double_booked',       // then don't concentrate what remains on one person
  'forced_projects',         // then fewest projects compromised
  'regular_spread',          // then flattest load across the regular pool
  'max_consecutive',         // then prefer handing off, all else equal
  'reserve_weeks',           // then spend as little of the reserve as possible
  'regular_peak',            // then the lowest peak in the regular pool
];

// Dropdown sources
var LEVEL_OPTIONS   = ['Advanced', 'Developing'];
var YESNO_OPTIONS   = ['No', 'Yes'];
// music_specialist is a RANK, not a flag: 1 = first choice, 2 = second. The list is
// a convenience dropdown only — the rule that uses it allows anything, so a legacy
// "Yes" (read as rank 1) is not marked invalid and a third specialist can be added
// by typing 3 without touching the code. Genuine typos are caught by
// rosterProblems() instead, which can explain the mistake; validation cannot.
var MUSIC_RANK_OPTIONS = ['No', '1', '2'];
var DEFAULT_CLIENTS = ['Netflix', 'Disney', 'Liquid Violet'];

function ss() { return SpreadsheetApp.getActive(); }

// getSpreadsheetTimeZone() is a round trip to the server, and isoFromCell needs it
// for EVERY date cell — two per booking row plus one per project. On the seeded
// book that was 167 calls on a single page load, which is what "stuck reading the
// book" was (2026-08-13). It cannot change mid-execution, so read it once.
// Same lifetime as _ioCache: Apps Script starts each request in a fresh global.
var _tz = null;

function tz_() {
  if (_tz === null) _tz = ss().getSpreadsheetTimeZone();
  return _tz;
}

function sheetOrThrow(name) {
  var sh = ss().getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '". Run Engineer Assignment > Set up sheets.');
  return sh;
}

function todayISO() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}
