// Counts Sheets round trips for the operations that matter.
//
// Every getValues/setValues/getRange-write is a call across the Apps Script
// boundary costing tens of milliseconds, and the engine itself is microseconds.
// So the round-trip count IS the performance story, and it is worth asserting
// rather than eyeballing.
//
// Run: node test/io_roundtrips.test.js
const fs = require('fs');
const path = require('path');

const AS = path.join(__dirname, '..', 'appsscript');
// The Apps Script web app UI (40_WebApp.gs, the three HTML views, and the Replan/
// Analysis/Form dialog wrappers) was deleted on 2026-08-31: no web app deployment
// existed, so none of it could be reached, and the Node app replaced that interface.
// The Apps Script project is now the sheet menu and the engine, nothing else.
const FILES = ['00_Engine_Assign.gs', '01_Engine_Replan.gs', '02_Engine_Stats.gs', '30_Menu.gs',
               '20_Config.gs', '10_Weeks.gs', '11_Wrapper.gs', '12_Capacity.gs',
               '21_Io.gs', '22_Setup.gs', '23_Entry.gs'];

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

// ---- a fake spreadsheet that records every call -----------------------------
function makeBook(tabs) {
  const frozen = { Bookings: 1, Projects: 2, Engineers: 1 };   // as setup leaves them
  const stats = { reads: 0, writes: 0, tz: 0, misc: 0, byTab: {} };
  const bump = (tab, kind) => {
    stats[kind]++;
    stats.byTab[tab] = stats.byTab[tab] || { reads: 0, writes: 0 };
    stats.byTab[tab][kind]++;
  };
  function sheet(name) {
    const grid = tabs[name];
    return {
      getName: () => name,
      getLastRow: () => { stats.misc++; return grid.length; },
      getLastColumn: () => { stats.misc++; return grid.reduce((m, r) => Math.max(m, r.length), 0); },
      getMaxRows: () => Math.max(grid.length, 400),
      getMaxColumns: () => 30,
      getRange(r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        return {
          getValues() {
            bump(name, 'reads');
            const out = [];
            for (let i = 0; i < nr; i++) {
              const row = grid[r - 1 + i] || [];
              const cells = [];
              for (let j = 0; j < nc; j++) cells.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
              out.push(cells);
            }
            return out;
          },
          getValue() { return this.getValues()[0][0]; },
          setValues(vals) {
            bump(name, 'writes');
            vals.forEach((row, i) => {
              while (grid.length < r + i) grid.push([]);
              const target = grid[r - 1 + i] || (grid[r - 1 + i] = []);
              row.forEach((v, j) => { target[c - 1 + j] = v; });
            });
            return this;
          },
          setValue(v) { return this.setValues([[v]]); },
          // formatting is a round trip too, but not what we are measuring here
          setBackground() { return this; }, setFontColor() { return this; },
          setFontWeight() { return this; }, setNumberFormat() { return this; },
          setNote() { return this; }, setWrap() { return this; },
          setFontSize() { return this; }, setHorizontalAlignment() { return this; },
          setVerticalAlignment() { return this; }, setBorder() { return this; },
          insertCheckboxes() { return this; },
          clearContent() {
            bump(name, 'writes');
            for (let i = 0; i < nr; i++) {
              const row = grid[r - 1 + i];
              if (!row) continue;
              for (let j = 0; j < nc; j++) row[c - 1 + j] = '';
            }
            return this;
          },
          clearFormat() { return this; }, clearNote() { return this; },
          clearDataValidations() { return this; }, setDataValidation() { return this; },
          breakApart() { return this; }, merge() { return this; },
          protect: () => ({ setDescription: () => ({ setWarningOnly: () => {} }) }),
          applyRowBanding() { return this; },
        };
      },
      deleteRows(start, howMany) {
        // Sheets itself refuses this, and the harness has to as well or the wipe
        // "passes" here and throws in the real sheet (2026-08-13).
        if (frozen[name] && start <= frozen[name] + 0 && false) {}
        const remaining = grid.length - howMany;
        if (remaining < (frozen[name] || 0) + 1) {
          throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
        }
        bump(name, 'writes'); grid.splice(start - 1, howMany);
      },
      setFrozenRows(n) { frozen[name] = n; }, setFrozenColumns() {}, setColumnWidth() {},
      setRowHeight() {}, setHiddenGridlines() {}, setConditionalFormatRules() {},
      getBandings: () => [], getProtections: () => [], hideSheet() {},
    };
  }
  return {
    stats,
    api: {
      getActive: () => ({
        getSheetByName: n => { stats.misc++; return tabs[n] ? sheet(n) : null; },
        getSpreadsheetTimeZone: () => { stats.tz++; return 'Asia/Manila'; },
        toast() {}, setActiveSheet() {}, moveActiveSheet() {},
        insertSheet(n) { tabs[n] = []; return sheet(n); },
        deleteSheet() {},
      }),
      getUi: () => ({ alert: () => (stats.uiAnswer === undefined ? 'ok' : stats.uiAnswer),
                      ButtonSet: { OK: 1, YES_NO: 2 }, Button: { YES: 1 },
                      createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; },
                                           addSubMenu() { return this; }, addToUi() {} }) }),
      flush() { stats.flushes = (stats.flushes || 0) + 1; },
      ProtectionType: { SHEET: 1, RANGE: 2 },
      newDataValidation: () => ({ requireValueInList() { return this; }, requireDate() { return this; },
                                  setAllowInvalid() { return this; }, build: () => ({}) }),
      newConditionalFormatRule: () => ({ whenFormulaSatisfied() { return this; }, setFontColor() { return this; },
        setStrikethrough() { return this; }, setBackground() { return this; }, setBold() { return this; },
        setRanges() { return this; }, build: () => ({}) }),
      BandingTheme: { LIGHT_GREY: 1 }, BorderStyle: { SOLID: 1, SOLID_MEDIUM: 2, SOLID_THICK: 3 },
    },
  };
}

function loadWithSheet(tabs) {
  const { stats, api } = makeBook(tabs);
  const src = FILES.map(f => fs.readFileSync(path.join(AS, f), 'utf8')).join('\n;\n');
  const ctx = {
    SpreadsheetApp: api,
    Utilities: {
      formatDate: (d) => new Date(d).toISOString().slice(0, 10),
      computeDigest: () => [1, 2, 3], base64Encode: () => 'abc123',
      DigestAlgorithm: { MD5: 1 },
    },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    // a real store, so the preview→apply round trip can actually be tested. It was
    // a black hole, which is why apply had never once run in a test.
    PropertiesService: (function () {
      const store = {};
      return { getDocumentProperties: () => ({
        getProperty: k => (k in store ? store[k] : null),
        setProperty(k, v) { store[k] = v; },
        deleteProperty(k) { delete store[k]; },
      }) };
    })(),
    ScriptApp: { getService: () => ({ getUrl: () => 'https://example' }), getProjectTriggers: () => [] },
    HtmlService: { createTemplateFromFile: () => ({ evaluate: () => ({ setTitle: () => ({ addMetaTag() {} }) }) }) },
    console,
  };
  const names = Object.keys(ctx);
  const fn = new Function(...names, `${src}\n;return { plotBatch,
    readBookings, readProjectRows, readEngineers, supersedeBookingRowNumbers, ioInvalidate,
    normalizeProject, activeRows, readBookings,
    readProjectRows, rosterProblems, canonMixLevel_,
    plotAllUnplotted, relinkProjectBookings, orphanProjects_, refreshForcedNotes_,
    widx,
    P_COL, P_HEADERS, E_HEADERS, P_OUTPUT_FIRST, P_OUTPUT_LAST, P_LAST };`);
  return { api: fn(...names.map(n => ctx[n])), stats };
}

// ---- a realistic seeded sheet ----------------------------------------------
const engineers = require('../validation/engineers.json');
const projects = require('../validation/projects.json');
const { loadAppsScript } = require('./loader.js');
const PURE = loadAppsScript();

function buildTabs() {
  const book = PURE.plotBatch(projects, [], engineers).new_rows;
  return {
    Engineers: [['name','can_record','can_edit','can_mix','mix_level','music_specialist','overflow_only','does_specials','atmos']]
      .concat(engineers.map(e => [e.name, e.can_record, e.can_edit, e.can_mix, e.mix_level,
                                  e.music_specialist, e.overflow_only, e.does_specials,
                                  e.atmos || 'No'])),
    // Dates as Date OBJECTS, which is what a real sheet hands back once the column
    // carries a date format — the old string fixture took isoFromCell's regex fast
    // path and so never exercised the timezone lookup at all.
    Bookings: [['project','phase','engineer','start_date','end_date','source','note','status']]
      .concat(book.map(b => [b.project, b.phase, b.engineer,
                             new Date(b.start_date + 'T00:00:00Z'), new Date(b.end_date + 'T00:00:00Z'),
                             b.source, b.note, ''])),
    Projects: [['Projects — master list'],
               ['Project','Client','Deadline','Phases D/E/M','Mix level','Music','Special','Atmos',
                'Recordist pick','Recordist pick 2','Editor pick','Mixer pick',
                'Dub wks','Edit wks','Mix wks',
                'Recordist','Editor','Mixer','Warnings','Notes','Plotted','Locked']]
      .concat(projects.map(p => [p.project_title, p.client, new Date(p.deadline + 'T00:00:00Z'),
        `${p.dub_weeks}/${p.edit_weeks}/${p.mix_weeks}`, p.mix_level_required,
        p.music_songs, p.special_project, p.atmos_required || 'No',
        'Auto', 'Auto', 'Auto', 'Auto',
        '', '', '', '', '', '', '', '', '2026-08-12', false])),
    Config: [['Clients'], ['Netflix'], ['Disney'], ['Liquid Violet']],
  };
}

console.log('Sheets round trips per operation');

// ---- reads are memoised within one execution -------------------------------
{
  const { api, stats } = loadWithSheet(buildTabs());
  api.readBookings(); api.readBookings(); api.readBookings();
  ok('three readBookings() calls cost one read', stats.byTab.Bookings.reads === 1,
     `${stats.byTab.Bookings.reads} reads`);
  api.ioInvalidate();
  api.readBookings();
  ok('invalidating forces a fresh read', stats.byTab.Bookings.reads === 2,
     `${stats.byTab.Bookings.reads} reads`);
}

// ---- superseding many rows is not one call per row --------------------------
{
  const tabs = buildTabs();
  const { api, stats } = loadWithSheet(tabs);
  const live = api.activeRows(api.readBookings());
  const rows = live.slice(0, 55).map(b => b.row_number);
  const before = stats.writes;
  const n = api.supersedeBookingRowNumbers(rows);
  const writes = stats.writes - before;
  ok(`superseding ${n} rows costs one write, not ${n}`, writes === 1, `${writes} writes`);
  ok('it actually marked them', n === 55, `marked ${n}`);
  const after = api.readBookings().filter(b => String(b.status) === 'superseded').length;
  ok('and the rows read back as superseded', after === 55, `${after} superseded`);
}

// ---- a mis-cased mix_level must not silently disqualify a mixer -------------
// mix_level reaches the engine as `lvl === 'Advanced'`, exact and case-sensitive,
// while every capability flag is case-insensitive. Measured on the seeded book:
// writing "advanced" instead of "Advanced" took Kyle from 15 mix weeks to ZERO and
// pushed Josiah from 7 to 17, with Kyle appearing completely free (2026-08-13).
{
  ['advanced','ADVANCED','Advanced ',' advanced'].forEach(v => {
    const tabs = buildTabs();
    tabs.Engineers.forEach(r => { if (r[0] === 'Kyle') r[4] = v; });
    const { api } = loadWithSheet(tabs);
    const kyle = api.readEngineers().filter(e => e.name === 'Kyle')[0];
    ok(`mix_level ${JSON.stringify(v)} normalises to Advanced`, kyle.mix_level === 'Advanced',
       `got ${JSON.stringify(kyle.mix_level)}`);
  });

  // an unrecognised value is NOT coerced — it is reported, so nobody is left
  // guessing why a mixer never gets work
  const bad = buildTabs();
  bad.Engineers.forEach(r => { if (r[0] === 'Kyle') r[4] = 'Adv'; });
  const b = loadWithSheet(bad);
  const probs = b.api.rosterProblems(b.api.readEngineers());
  ok('an unrecognised mix_level is reported by name',
     probs.some(t => /Kyle/.test(t) && /Adv/.test(t)), JSON.stringify(probs));
  ok('and it is left as-is rather than guessed at',
     b.api.readEngineers().filter(e => e.name === 'Kyle')[0].mix_level === 'Adv');

  // can_mix Yes with a blank level is the silent version of the same trap
  const blank = buildTabs();
  blank.Engineers.forEach(r => { if (r[0] === 'Kyle') r[4] = ''; });
  const bl = loadWithSheet(blank);
  ok('can_mix Yes with a blank level is reported too',
     bl.api.rosterProblems(bl.api.readEngineers()).some(t => /Kyle/.test(t) && /blank/.test(t)));

  // and a clean roster stays quiet
  const clean = loadWithSheet(buildTabs());
  ok('a correct roster reports nothing',
     clean.api.rosterProblems(clean.api.readEngineers()).length === 0,
     JSON.stringify(clean.api.rosterProblems(clean.api.readEngineers())));

  // music_specialist column (index 5) is a RANK whose cell deliberately accepts
  // anything, so the diagnostic is the only thing catching a bad value. Without
  // it a typo reads as "not a specialist" and music quietly routes to anyone.
  const msProbs = v => {
    const t = buildTabs();
    t.Engineers.forEach(r => { if (r[0] === 'Daryl') r[5] = v; });
    const s = loadWithSheet(t);
    return s.api.rosterProblems(s.api.readEngineers());
  };
  ok('a junk music_specialist is reported by name',
     msProbs('1st').some(t => /Daryl/.test(t) && /1st/.test(t)), JSON.stringify(msProbs('1st')));
  ok('a decimal rank is reported rather than silently truncated',
     msProbs('1.5').some(t => /Daryl/.test(t)), JSON.stringify(msProbs('1.5')));
  ok('rank 1 is accepted', !msProbs('1').some(t => /music_specialist/.test(t)),
     JSON.stringify(msProbs('1')));
  ok('rank 3 is accepted, so a third specialist needs no code change',
     !msProbs('3').some(t => /music_specialist/.test(t)), JSON.stringify(msProbs('3')));
  ok('legacy "Yes" is accepted and not reported',
     !msProbs('Yes').some(t => /music_specialist/.test(t)), JSON.stringify(msProbs('Yes')));
  ok('"No" is accepted', !msProbs('No').some(t => /Daryl/.test(t)), JSON.stringify(msProbs('No')));

  // the silent failure the rank rule introduced: nobody ranked at all
  const noneRanked = buildTabs();
  noneRanked.Engineers.forEach(r => { r[5] = 'No'; });
  const nr = loadWithSheet(noneRanked);
  ok('a roster with no music specialist at all is reported',
     nr.api.rosterProblems(nr.api.readEngineers()).some(t => /Music\/Songs/.test(t)),
     JSON.stringify(nr.api.rosterProblems(nr.api.readEngineers())));
}

// ---- relinking a renamed project -------------------------------------------
// The title is the join key, so retitling a project in the sheet orphans its whole
// schedule. This is the undo, and it has to be non-destructive: the point is to keep
// the engineers and dates that a re-plot would not reproduce.
{
  const { api, stats } = loadWithSheet(buildTabs());
  const title = api.readBookings()[0].project;

  // supersede one row first, so we can prove history is left where it belongs
  const someRow = api.readBookings().filter(b => b.project === title)[0].row_number;
  api.supersedeBookingRowNumbers([someRow]);

  const liveBefore = api.activeRows(api.readBookings()).filter(b => b.project === title);
  const deadBefore = api.readBookings()
    .filter(b => b.project === title && String(b.status).toLowerCase() === 'superseded');
  const fingerprint = b => `${b.phase}|${b.engineer}|${b.start_date}|${b.end_date}`;
  const wantSet = liveBefore.map(fingerprint).sort().join(' ~ ');

  ok('the fixture gives us both live and superseded rows to reason about',
     liveBefore.length > 0 && deadBefore.length === 1,
     `${liveBefore.length} live, ${deadBefore.length} superseded`);

  const w0 = stats.writes;
  const moved = api.relinkProjectBookings(title, 'Renamed Show');
  ok('it reports how many rows moved', moved === liveBefore.length,
     `${moved} vs ${liveBefore.length}`);
  ok('it costs one write, not one per row', stats.writes - w0 === 1,
     `${stats.writes - w0} writes for ${moved} rows`);

  const after = api.readBookings();
  const liveAfter = api.activeRows(after).filter(b => b.project === 'Renamed Show');
  ok('every live row now carries the new title', liveAfter.length === liveBefore.length);
  ok('engineers and dates are untouched',
     liveAfter.map(fingerprint).sort().join(' ~ ') === wantSet);
  ok('no live row is left under the old title',
     api.activeRows(after).filter(b => b.project === title).length === 0);

  // history stays under the name it was booked as
  ok('superseded rows are NOT moved',
     after.filter(b => b.project === title &&
                  String(b.status).toLowerCase() === 'superseded').length === 1,
     JSON.stringify(after.filter(b => b.project === title).map(b => b.status)));

  // it is its own undo
  const back = api.relinkProjectBookings('Renamed Show', title);
  ok('relinking back restores the original title', back === moved &&
     api.activeRows(api.readBookings()).filter(b => b.project === title).length === liveBefore.length);

  // no-ops must not write
  const w1 = stats.writes;
  ok('same-title relink is a no-op', api.relinkProjectBookings(title, title) === 0);
  ok('a blank title is a no-op', api.relinkProjectBookings('', title) === 0);
  ok('an unknown source title moves nothing', api.relinkProjectBookings('No Such Show', title) === 0);
  ok('and none of those wrote anything', stats.writes - w1 === 0, `${stats.writes - w1} writes`);
}

// ---- relink actually clears the ghost it was built for ----------------------
// End to end, in the shape the bug was reported: retitle in Projects, watch the
// schedule strand itself, relink, watch it come back.
{
  const tabs = buildTabs();
  const { api } = loadWithSheet(tabs);
  const before = api.readProjectRows()[0];
  const oldTitle = before.project_title;

  ok('no ghosts to begin with',
     api.orphanProjects_(api.activeRows(api.readBookings()), api.readProjectRows()).length === 0);

  // the exact user action: edit the title cell in Projects, nothing else
  tabs.Projects[before._row - 1][0] = 'Rebranded Title';
  api.ioInvalidate();

  const ghosts = api.orphanProjects_(api.activeRows(api.readBookings()), api.readProjectRows());
  ok('renaming in the sheet strands the whole schedule as a ghost',
     ghosts.length === 1 && ghosts[0].project === oldTitle, JSON.stringify(ghosts));

  const n = api.relinkProjectBookings(oldTitle, 'Rebranded Title');
  ok('relinking moves every stranded row', n === ghosts[0].rows, `${n} vs ${ghosts[0].rows}`);
  ok('and the ghost is gone',
     api.orphanProjects_(api.activeRows(api.readBookings()), api.readProjectRows()).length === 0,
     JSON.stringify(api.orphanProjects_(api.activeRows(api.readBookings()), api.readProjectRows())));
}

console.log(`\n${pass} passed, ${fail} failed`);

// Guarded: this file is also required for its harness, and an unguarded exit would
// kill the process that required it.
if (require.main === module) process.exit(fail ? 1 : 0);

// Exported so a rendering harness can stand the real API up against a real sheet.
module.exports = { loadWithSheet, buildTabs };
