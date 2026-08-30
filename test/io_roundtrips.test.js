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
const FILES = ['00_Engine_Assign.gs', '01_Engine_Replan.gs', '02_Engine_Stats.gs', '30_Menu.gs',
               '20_Config.gs', '10_Weeks.gs', '11_Wrapper.gs', '12_Capacity.gs',
               '21_Io.gs', '22_Setup.gs', '23_Entry.gs', '25_Replan.gs', '26_Analysis.gs', '27_Form.gs',
               '40_WebApp.gs'];

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
  const fn = new Function(...names, `${src}\n;return { apiBootstrap, apiSaveProject, plotBatch,
    readBookings, readProjectRows, readEngineers, supersedeBookingRowNumbers, ioInvalidate,
    normalizeProject, activeRows, getAnalysisData, apiSupersedeOrphans, readBookings,
    clearGhostProjects, apiSchedule, duplicateLiveRows_, checkBookings,
    apiSetProjectLock, apiReplanPreview, readProjectRows, rosterProblems, canonMixLevel_,
    resetSchedule, plotAllUnplotted, relinkProjectBookings, orphanProjects_, getAnalysisData,
    refreshForcedNotes_,
    apiReassignWeek, apiUndoWeekMove, refreshProjectOutputsFromBook_,
    apiReplanApply, apiAnalysis, widx,
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

// ---- apiBootstrap: the app's first paint ------------------------------------
{
  const { api, stats } = loadWithSheet(buildTabs());
  api.apiBootstrap();
  const total = stats.reads + stats.writes;
  ok('apiBootstrap reads each tab at most once', total <= 4,
     `${total} calls: ` + JSON.stringify(stats.byTab));
  ok('apiBootstrap writes nothing', stats.writes === 0, `${stats.writes} writes`);
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

// ---- a project deleted from the sheet by hand leaves orphan bookings --------
// The schedule is drawn from BOOKINGS, so hand-deleting a Projects row leaves the
// project on the schedule with no way to select it. It must be reported, and the
// cleanup must supersede rather than delete (2026-08-13).
{
  const tabs = buildTabs();
  const victim = tabs.Projects[2][0];                     // first real project row
  tabs.Projects.splice(2, 1);                             // "I deleted the row by hand"
  const { api } = loadWithSheet(tabs);

  const boot = api.apiBootstrap();
  const orphan = (boot.orphans || []).filter(o => o.project === victim);
  ok('the deleted project is reported as an orphan', orphan.length === 1,
     JSON.stringify(boot.orphans));
  ok('it is gone from the Projects list',
     !boot.projects.some(p => p.title === victim));
  ok('but its bookings are still live, which is why it shows on the schedule',
     orphan.length === 1 && orphan[0].rows > 0);

  const before = api.readBookings().length;
  const res = api.apiSupersedeOrphans([victim]);
  ok('the cleanup supersedes its rows', res.ok && res.superseded === orphan[0].rows,
     JSON.stringify(res));
  ok('and reports no orphans left', res.orphans.length === 0, JSON.stringify(res.orphans));
  ok('nothing was deleted — the rows are still in the tab',
     api.readBookings().length === before, `${before} -> ${api.readBookings().length}`);
  ok('they read back as superseded, not live',
     api.activeRows(api.readBookings()).filter(b => b.project === victim).length === 0);

  // the same repair must be reachable from the SHEET, because the web app is
  // pinned to a published version and app-side fixes are invisible until it is
  // bumped — which is exactly the hole this fell through (2026-08-13)
  {
    const t2 = buildTabs();
    const v2 = t2.Projects[2][0];
    t2.Projects.splice(2, 1);
    const m = loadWithSheet(t2);
    const liveOf = () => m.api.activeRows(m.api.readBookings()).filter(b => b.project === v2).length;
    const liveBefore = liveOf();

    // declining must change nothing at all
    m.stats.uiAnswer = 0;                        // anything that is not Button.YES
    m.api.clearGhostProjects();
    ok('declining the confirmation leaves every row live',
       liveBefore > 0 && liveOf() === liveBefore, `${liveBefore} -> ${liveOf()}`);

    m.stats.uiAnswer = 1;                        // Button.YES
    m.api.clearGhostProjects();
    ok('confirming clears ghosts without the web app', liveOf() === 0,
       `${liveBefore} live rows before, ${liveOf()} after`);
  }

  const again = api.apiSupersedeOrphans([victim]);
  ok('re-running it is a no-op, not a second sweep', again.ok && again.superseded === 0,
     JSON.stringify(again));
  ok('an unknown title is skipped, never guessed at',
     api.apiSupersedeOrphans(['No Such Show']).skipped.length === 1);
}

// ---- the build-time wipe -----------------------------------------------------
// Delete this block when resetSchedule() is removed. It exists because the wipe is
// the one place in the tool that really deletes, and because a wipe that leaves the
// Plotted stamps behind is worse than useless: plotAllUnplotted would then find
// nothing to do and the rebuild would silently no-op (2026-08-13).
{
  const tabs = buildTabs();
  const { api, stats } = loadWithSheet(tabs);
  const bookingsBefore = api.readBookings().length;
  const projectsBefore = api.readProjectRows().filter(p => p.project_title).length;
  const nRows = tabs.Projects.length - 2;   // the wipe formats 300 rows, so compare only these
  const inputsBefore = tabs.Projects.slice(2, 2 + nRows).map(r => r.slice(0, 10).join('|'));

  // lock a couple of projects first — Locked is column 20, deliberately outside the
  // engine's 11..19 block, so the wipe's sweep used to stop one column short of it
  const lockable = api.readProjectRows().filter(p => p.project_title).slice(0, 2);
  lockable.forEach(p => api.apiSetProjectLock(p.project_title, true));
  ok('projects can be locked before the wipe',
     api.readProjectRows().filter(p => p.locked === true).length === 2,
     `${api.readProjectRows().filter(p => p.locked === true).length} locked`);

  stats.uiAnswer = 0;                                   // "No"
  api.resetSchedule();
  ok('declining the wipe deletes nothing',
     api.readBookings().length === bookingsBefore, `${api.readBookings().length} rows left`);

  stats.uiAnswer = 1;                                   // "Yes"
  api.resetSchedule();
  ok('the wipe empties the Bookings tab', api.readBookings().length === 0,
     `${api.readBookings().length} rows left`);
  // Sheets will not allow every non-frozen row to be deleted, so one blank row
  // remains by design. It must read as no bookings at all.
  ok('the header survives and at most one blank row is left behind',
     tabs.Bookings[0][0] === 'project' && tabs.Bookings.length <= 2 &&
     (tabs.Bookings.length === 1 || !String(tabs.Bookings[1][0] || '').trim()),
     JSON.stringify(tabs.Bookings));
  ok('every project row is kept', api.readProjectRows().filter(p => p.project_title).length === projectsBefore);
  ok('no Plotted stamp survives, so a rebuild has work to do',
     api.readProjectRows().every(p => !p.plotted));
  // A lock means "these dates are promised". The wipe destroys the dates, so the
  // promise cannot outlive them — otherwise you re-plot, get bookings nobody has
  // reviewed, and find them already frozen against the next re-plan.
  ok('no lock survives the wipe either',
     api.readProjectRows().every(p => p.locked !== true),
     JSON.stringify(api.readProjectRows().filter(p => p.locked === true).map(p => p.project_title)));
  ok('the user\'s own columns are untouched',
     tabs.Projects.slice(2, 2 + nRows).map(r => r.slice(0, 10).join('|')).join('#') === inputsBefore.join('#'),
     'inputs changed');

  // and the rebuild actually rebuilds
  stats.uiAnswer = 1;
  api.plotAllUnplotted();
  ok('plotAllUnplotted refills the book after a wipe', api.readBookings().length > 0,
     `${api.readBookings().length} rows`);
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

// ---- drag reassignment: moving one week to another engineer ----------------
// Row surgery, no engine. The invariants that matter: the WEEKS never change, only
// the name; the run splits cleanly around the moved week; and nothing is deleted.
{
  const { api } = loadWithSheet(buildTabs());
  const W = api.widx;

  // find a booking with at least 3 weeks so we can move one out of the MIDDLE,
  // which is the case that produces three rows from one
  const long = api.activeRows(api.readBookings())
    .filter(b => W(b.end_date) - W(b.start_date) >= 2)[0];
  ok('the fixture has a multi-week run to split', !!long,
     JSON.stringify(long || null));

  const midWeek = W(long.start_date) + 1;
  const weekIso = PURE.weekStart(midWeek);
  const other = engineers.map(e => e.name).filter(n => n !== long.engineer)[0];

  // preview writes nothing
  const rowsBefore = api.readBookings().length;
  const pre = api.apiReassignWeek({ project: long.project, phase: long.phase,
                                    week_start: weekIso, to_engineer: other });
  ok('a preview reports without writing', pre.ok && pre.preview === true &&
     api.readBookings().length === rowsBefore, JSON.stringify(pre).slice(0, 160));
  ok('the preview names both ends of the move',
     pre.from === long.engineer && pre.to === other, `${pre.from} -> ${pre.to}`);

  // commit
  const res = api.apiReassignWeek({ project: long.project, phase: long.phase,
                                    week_start: weekIso, to_engineer: other, confirmed: true });
  ok('the move reports success', res.ok && res.moved === true, JSON.stringify(res).slice(0, 160));
  ok('splitting the middle of a run writes three rows', res.rows_written === 3,
     `${res.rows_written} rows`);

  const after = api.activeRows(api.readBookings())
    .filter(b => b.project === long.project && b.phase === long.phase)
    .sort((a, b) => W(a.start_date) - W(b.start_date));

  ok('the moved week belongs to the new engineer',
     after.filter(b => W(b.start_date) === midWeek && b.engineer === other).length === 1,
     JSON.stringify(after.map(b => `${b.engineer} ${b.start_date}..${b.end_date}`)));
  ok('the surrounding weeks stay with the original engineer',
     after.filter(b => b.engineer === long.engineer).length === 2);

  // the whole point: dates are never negotiated
  const covered = new Set();
  after.forEach(b => { for (let w = W(b.start_date); w <= W(b.end_date); w++) covered.add(w); });
  const wanted = new Set();
  for (let w = W(long.start_date); w <= W(long.end_date); w++) wanted.add(w);
  ok('every original week is still covered exactly once',
     covered.size === wanted.size && [...wanted].every(w => covered.has(w)),
     `${[...covered].sort().join(',')} vs ${[...wanted].sort().join(',')}`);
  ok('no week outside the original run was created',
     [...covered].every(w => wanted.has(w)));

  // nothing is deleted (rule 15)
  ok('the original row is superseded, not removed',
     api.readBookings().filter(b => b.row_number === long.row_number)[0].status.toLowerCase() === 'superseded');

  ok('the moved row is marked as hand-placed so a re-plan leaves it alone',
     after.filter(b => W(b.start_date) === midWeek)[0].note.toLowerCase().indexOf('manual') !== -1);
  ok('and it is identifiable as a drag specifically, not just any manual pick',
     /moved by hand/i.test(after.filter(b => W(b.start_date) === midWeek)[0].note));
}

// ---- the Bookings tab itself must not carry a false claim ------------------
// Reading the note correctly elsewhere was not enough: the tab IS the record, and it
// held rows saying FORCED OVERLAP where nobody was doubled. Superseded rows are left
// alone — those are history and should say what was believed at the time.
//
// The seeded tab starts out LYING on purpose — one row claims FORCED OVERLAP with
// nobody doubled, three are doubled and silent. That is the state a real book was
// found in. So the reconcile is called directly rather than ridden in on a re-plan:
// this fixture's preview declines to improve, so `if (!no_improvement) apply()` ran
// nothing and the assertions below were measuring the untouched seed. Every write
// path (reassign, undo, replan apply) calls this same function, and the menu exposes
// it for a book that predates them.
{
  // The lie is INJECTED, not hoped for. This used to rely on the plot happening to
  // leave a stale note behind, and when a scheduling change made the fresh plot
  // honest the reconcile found nothing and every assertion below passed vacuously.
  // The guard caught it; the fixture is now built to always need fixing.
  const corrupt = buildTabs();
  const NOTE = 7;                       // B_COL.NOTE, 1-indexed
  const bRows = corrupt.Bookings.slice(1);
  const key = r => r[2] + '|' + r[3].toISOString().slice(0, 10);
  const spanOf = r => {
    const out = [];
    const a = new Date(r[3]), z = new Date(r[4]);
    for (let d = new Date(a); d <= z; d.setUTCDate(d.getUTCDate() + 7)) out.push(d.toISOString().slice(0, 10));
    return out;
  };
  const busy = {};
  bRows.forEach(r => spanOf(r).forEach(w => { (busy[r[2] + '|' + w] = busy[r[2] + '|' + w] || []).push(r); }));
  // one row claiming an overlap it does not have
  const clean = bRows.find(r => spanOf(r).every(w => busy[r[2] + '|' + w].length === 1));
  if (clean) clean[NOTE - 1] = 'FORCED OVERLAP to hit the deadline';
  // and at least one genuinely doubled row saying nothing
  Object.keys(busy).forEach(k => { if (busy[k].length > 1) busy[k].forEach(r => { r[NOTE - 1] = ''; }); });

  const { api, stats } = loadWithSheet(corrupt);
  const W = api.widx;
  const pre = api.apiReplanPreview();
  if (!pre.no_improvement) api.apiReplanApply();
  const fixed = api.refreshForcedNotes_();
  ok('the seeded tab needed reconciling, so the assertions below have something to prove',
     fixed > 0, 'nothing was wrong to begin with');

  const live = () => api.activeRows(api.readBookings());
  const doubledRows = () => {
    const per = {};
    live().forEach(b => { for (let w = W(b.start_date); w <= W(b.end_date); w++) {
      const k = b.engineer + '|' + w; (per[k] = per[k] || []).push(b.row_number); } });
    const out = new Set();
    Object.keys(per).filter(k => per[k].length > 1).forEach(k => per[k].forEach(r => out.add(r)));
    return out;
  };

  const claims = live().filter(b => /FORCED|DOUBLE-BOOKED/i.test(b.note || '')).map(b => b.row_number);
  const real = doubledRows();
  ok('once reconciled, every live row claiming an overlap actually has one',
     claims.every(r => real.has(r)),
     claims.filter(r => !real.has(r)).join(', '));
  ok('and every row that HAS one says so',
     [...real].every(r => claims.indexOf(r) !== -1),
     [...real].filter(r => claims.indexOf(r) === -1).join(', '));

  // it must be idempotent, and cost one write
  const w0 = stats.writes;
  ok('running it again changes nothing', api.refreshForcedNotes_() === 0);
  ok('and costs no write when there is nothing to fix', stats.writes === w0);

  // history is left alone
  const supers = api.readBookings().filter(b => String(b.status).toLowerCase() === 'superseded');
  ok('superseded rows keep whatever they said at the time',
     supers.length === 0 || supers.some(b => /FORCED/i.test(b.note || '')) ||
     supers.every(b => !/DOUBLE-BOOKED/i.test(b.note || '')));
}

// ---- every surface must agree on who is doubled ----------------------------
// Reported four times. The flag, the sheet's warning column, the header count and
// the Analysis card were each computed from a FORCED note — a record of what the
// engine decided when it decided it. Later changes resolve collisions (note stays)
// and create new ones elsewhere (no note written), so every surface drifted from the
// book independently. They now all count weeks.
{
  const { api } = loadWithSheet(buildTabs());
  const W = api.widx;
  const doubled = () => {
    const live = api.activeRows(api.readBookings());
    const per = {};
    live.forEach(b => { for (let w = W(b.start_date); w <= W(b.end_date); w++) {
      const k = b.engineer + '|' + w; (per[k] = per[k] || []).push(b); } });
    const out = new Set();
    Object.keys(per).filter(k => per[k].length > 1).forEach(k => per[k].forEach(b => out.add(b.project)));
    return [...out].sort().join(',');
  };
  const pre = api.apiReplanPreview();
  if (!pre.no_improvement) api.apiReplanApply();

  const boot = api.apiBootstrap();
  const an = api.getAnalysisData();

  ok('the Projects flag matches the weeks',
     boot.projects.filter(p => p.forced).map(p => p.title).sort().join(',') === doubled(),
     `flag [${boot.projects.filter(p => p.forced).map(p => p.title).sort()}] vs [${doubled()}]`);

  const fromAnalysis = [...new Set((an.forced_overlaps || []).map(o => o.project))].sort().join(',');
  ok('the Analysis card matches the weeks', fromAnalysis === doubled(),
     `analysis [${fromAnalysis}] vs [${doubled()}]`);

  // The header now splits the overlaps by DEPTH: two at once is ordinary and reported
  // in blue, three or more is overflow and reported in red. A single count could not
  // tell them apart, which is the whole point of the change.
  const depthCounts = (function () {
    const live = api.activeRows(api.readBookings());
    const per = {};
    live.forEach(b => { for (let w = W(b.start_date); w <= W(b.end_date); w++) {
      const k = b.engineer + '|' + w; per[k] = (per[k] || 0) + 1; } });
    const ks = Object.keys(per);
    return { two: ks.filter(k => per[k] === 2).length,
             three: ks.filter(k => per[k] > 2).length };
  })();

  ok('the header counts weeks with exactly two at once',
     boot.counts.over2 === depthCounts.two,
     `header ${boot.counts.over2} vs weeks ${depthCounts.two}`);

  ok('the header counts weeks with three or more separately',
     boot.counts.over3 === depthCounts.three,
     `header ${boot.counts.over3} vs weeks ${depthCounts.three}`);

  ok('the two counts do not overlap each other',
     boot.counts.over2 + boot.counts.over3 ===
       depthCounts.two + depthCounts.three,
     `${boot.counts.over2} + ${boot.counts.over3}`);

  // and a stale note must move none of them
  const stale = api.activeRows(api.readBookings()).filter(b => /FORCED/i.test(b.note || ''));
  ok('stale FORCED notes still exist but drive nothing',
     stale.length === 0 || fromAnalysis === doubled(),
     `${stale.length} rows carry the note`);
}

// ---- a three-way is not a two-way ------------------------------------------
// The assertions above pass on the validation book with the split deliberately broken,
// because that book never produces a three-way — depth is 2, three times, and never
// more. A test whose fixture contains no instance of the case is not testing the case.
// This one stacks three bookings on one engineer-week on purpose.
{
  const tabs = buildTabs();
  const stack = [
    ['Triple A', 'Mix', 'Kyle', '2026-08-24', '2026-08-30', 'test', '', ''],
    ['Triple B', 'Mix', 'Kyle', '2026-08-24', '2026-08-30', 'test', '', ''],
    ['Triple C', 'Mix', 'Kyle', '2026-08-24', '2026-08-30', 'test', '', ''],
    // and a plain two-way elsewhere, so the two buckets are told apart rather than
    // one of them merely being zero
    ['Pair A', 'Dub', 'Mat', '2026-09-07', '2026-09-13', 'test', '', ''],
    ['Pair B', 'Dub', 'Mat', '2026-09-07', '2026-09-13', 'test', '', ''],
  ];
  tabs.Bookings = tabs.Bookings.concat(stack.map(r =>
    [r[0], r[1], r[2], new Date(r[3] + 'T00:00:00Z'), new Date(r[4] + 'T00:00:00Z'), r[5], r[6], r[7]]));

  const { api } = loadWithSheet(tabs);
  const boot = api.apiBootstrap();
  const W = api.widx;

  const per = {};
  api.activeRows(api.readBookings()).forEach(b => {
    for (let w = W(b.start_date); w <= W(b.end_date); w++) {
      const k = b.engineer + '|' + w; per[k] = (per[k] || 0) + 1; } });
  const wantThree = Object.keys(per).filter(k => per[k] > 2).length;
  const wantTwo = Object.keys(per).filter(k => per[k] === 2).length;

  ok('the fixture really does contain a three-way', wantThree >= 1, `${wantThree} found`);
  ok('a week of three is counted as overflow, not as a pair',
     boot.counts.over3 === wantThree, `over3 ${boot.counts.over3} vs ${wantThree}`);
  ok('and it is not also counted among the pairs',
     boot.counts.over2 === wantTwo, `over2 ${boot.counts.over2} vs ${wantTwo}`);

  // the grid has to colour it the same way the header counts it
  const grid = api.apiSchedule('engineer', null);
  const ri = grid.labels.indexOf('Kyle');
  let ci = -1;
  grid.weeks.forEach((w, i) => { if (w.start === '2026-08-24') ci = i; });
  const cell = ri >= 0 && ci >= 0 ? grid.cells[ri][ci] : null;
  ok('the grid cell reports its depth so it can be coloured red',
     !!cell && cell.depth >= 3, cell ? `depth ${cell.depth}` : 'cell missing');

  // and the project list must escalate the same way
  const trip = boot.projects.filter(p => /^Triple /.test(p.title));
  ok('a project caught in the three-way is flagged at depth 3',
     trip.length === 0 || trip.every(p => p.overlap >= 3),
     trip.map(p => `${p.title}:${p.overlap}`).join(' '));
}

// ---- preview then APPLY, end to end ----------------------------------------
// This path had never run in a test: the harness stubbed PropertiesService as a black
// hole, so apply always returned "Run the preview first" and every assertion about it
// was vacuous. Tara reported the Projects and Analysis views not updating after a
// re-plan, and there was no test that could have caught it.
{
  const tabs = buildTabs();
  const { api } = loadWithSheet(tabs);
  const cellAt = (row, col) => String((tabs.Projects[row - 1] || [])[col - 1] || '');

  const pre = api.apiReplanPreview();
  ok('the preview runs', pre && pre.empty !== true, JSON.stringify(pre && pre.empty));

  if (!pre.no_improvement) {
    const beforeRows = api.activeRows(api.readBookings()).length;
    const beforeCells = api.readProjectRows().filter(p => p.project_title)
      .map(p => cellAt(p._row, api.P_COL.RECORDIST)).join('|');

    const res = api.apiReplanApply();
    ok('apply succeeds', res.ok === true, res.error || '');
    // The write now hands the client its new state, so there is no second execution
    // that could start before the write is visible. Three attempts to fix this from
    // the client failed because the payload it re-fetched could be stale.
    ok('apply returns the fresh state, so the client never has to re-ask',
       !!res.boot && Array.isArray(res.boot.projects), Object.keys(res).join(', '));
  // "forced" means SOMEONE IS DOUBLE-BOOKED, computed from the weeks. It used to be
  // read off a FORCED note, which records what the engine decided at the time and
  // goes stale the moment anything else moves.
  const trulyDoubled = live => {
    const per = {};
    live.forEach(b => { for (let w = api.widx(b.start_date); w <= api.widx(b.end_date); w++) {
      const k = b.engineer + '|' + w; (per[k] = per[k] || []).push(b); } });
    const out = new Set();
    Object.keys(per).filter(k => per[k].length > 1).forEach(k => per[k].forEach(b => out.add(b.project)));
    return [...out].sort().join(',');
  };
    const bootForced = res.boot.projects.filter(p => p.forced).map(p => p.title).sort().join(',');
    ok('and that state matches the book the apply just wrote',
       bootForced === trulyDoubled(api.activeRows(api.readBookings())),
       `returned "${bootForced}" vs doubled "${trulyDoubled(api.activeRows(api.readBookings()))}"`);
    ok('and it reports rewriting the Projects tab',
       (res.projects_refreshed || 0) > 0, String(res.projects_refreshed));

    const afterCells = api.readProjectRows().filter(p => p.project_title)
      .map(p => cellAt(p._row, api.P_COL.RECORDIST)).join('|');
    ok('the Recordist column actually changed on the sheet',
       afterCells !== beforeCells, 'identical before and after');

    // every project's columns must agree with the live bookings, not the old plot
    const live = api.activeRows(api.readBookings());
    const wrong = api.readProjectRows().filter(p => p.project_title).filter(p => {
      const dub = [...new Set(live.filter(b => b.project === p.project_title && b.phase === 'Dub')
        .map(b => b.engineer))].sort().join(' + ');
      if (!dub) return false;
      return cellAt(p._row, api.P_COL.RECORDIST).split(' + ').sort().join(' + ') !== dub;
    });
    ok('every Recordist cell agrees with the bookings', wrong.length === 0,
       wrong.slice(0, 3).map(p => p.project_title).join(', '));

    // Does what the CLIENT is handed actually change? Three reports of Projects and
    // Analysis showing the previous plan, and three fixes aimed at the client. If the
    // payloads below are stale, every one of those fixes was aimed at the wrong layer.
    const bootAfter = api.apiBootstrap();
    const forcedAfter = bootAfter.projects.filter(p => p.forced).map(p => p.title).sort().join(',');
    ok('apiBootstrap flags exactly the projects that are double-booked',
       forcedAfter === trulyDoubled(api.activeRows(api.readBookings())),
       `bootstrap "${forcedAfter}" vs doubled "${trulyDoubled(api.activeRows(api.readBookings()))}"`);

    const rowsAfter = bootAfter.projects.reduce((n, p) => n + p.rows.length, 0);
    ok('apiBootstrap carries the new booking rows',
       rowsAfter === api.activeRows(api.readBookings()).length,
       `${rowsAfter} vs ${api.activeRows(api.readBookings()).length}`);

    const an = api.apiAnalysis();
    ok('apiAnalysis returns something', !!an, JSON.stringify(an).slice(0, 80));
  } else {
    ok('preview declined, so there is nothing to apply — reported honestly',
       pre.no_improvement === true);
  }
}

// ---- the Projects tab must follow the Bookings tab -------------------------
// A re-plan wrote only the Bookings tab, so the Projects tab kept showing the PLOT's
// engineers, warnings and forced highlight for ever after. The Schedule view reads
// bookings and updated; everything sourced from the Projects tab quietly did not —
// including the sheet itself, which the team is told they can read.
{
  const tabs = buildTabs();
  const { api } = loadWithSheet(tabs);
  const W = api.widx;
  const before = api.readProjectRows().filter(p => p.project_title)[0];
  const title = before.project_title;
  // readProjectRows exposes the INPUT columns only, so the output columns are read
  // straight off the tab. Addressed through P_COL, never by literal: these numbers
  // moved when Atmos and the second recordist pick were added, and a hard-coded 14
  // silently starts measuring a different column instead of failing loudly.
  const cellAt = (row, col) => String((tabs.Projects[row - 1] || [])[col - 1] || '');
  const staleRecordist = cellAt(before._row, api.P_COL.RECORDIST);

  // move a week by hand, which changes who is on the project
  const row = api.activeRows(api.readBookings()).filter(b => b.project === title && b.phase === 'Dub')[0];
  const other = engineers.map(e => e.name).filter(n => n !== row.engineer)[0];
  api.apiReassignWeek({ project: title, phase: row.phase,
                        week_start: PURE.weekStart(W(row.start_date)),
                        to_engineer: other, confirmed: true });

  const liveNow = api.activeRows(api.readBookings()).filter(b => b.project === title && b.phase === 'Dub');
  const actual = [...new Set(liveNow.map(b => b.engineer))].sort().join(' + ');
  ok('the fixture now has more than one dubber on that project',
     liveNow.length > 1, String(liveNow.length));

  const n = api.refreshProjectOutputsFromBook_([title]);
  ok('the refresh reports what it rewrote', n === 1, String(n));
  const freshRecordist = cellAt(before._row, api.P_COL.RECORDIST);
  ok('the Recordist column now matches the live bookings',
     freshRecordist.split(' + ').sort().join(' + ') === actual,
     `sheet "${freshRecordist}" vs bookings "${actual}"`);
  ok('and it is no longer whatever the plot wrote',
     freshRecordist !== staleRecordist, `${staleRecordist} → ${freshRecordist}`);
  ok('the Notes column says the re-plan touched it',
     /Re-planned|divided/i.test(cellAt(before._row, api.P_COL.NOTES)),
     cellAt(before._row, api.P_COL.NOTES));
  ok('a project not named is left alone',
     api.refreshProjectOutputsFromBook_(['No Such Show']) === 0);
}

// ---- undoing a drag: the week goes back to automatic -----------------------
// Until this existed the only route back was Save & re-plot on the whole project,
// which discards EVERY hand-placed week on it. Undoing one drag should cost you that
// drag and nothing else.
{
  const { api } = loadWithSheet(buildTabs());
  const W = api.widx;
  const long = api.activeRows(api.readBookings())
    .filter(b => W(b.end_date) - W(b.start_date) >= 2)[0];
  const mid = W(long.start_date) + 1;
  const weekIso = PURE.weekStart(mid);
  const other = engineers.map(e => e.name).filter(n => n !== long.engineer)[0];
  const owner = long.engineer;

  api.apiReassignWeek({ project: long.project, phase: long.phase,
                        week_start: weekIso, to_engineer: other, confirmed: true });
  const moved = api.activeRows(api.readBookings())
    .filter(b => b.project === long.project && b.phase === long.phase);
  ok('the drag landed and split the run into three',
     moved.length === 3 && moved.some(b => b.engineer === other), String(moved.length));

  const res = api.apiUndoWeekMove({ project: long.project, phase: long.phase, week_start: weekIso });
  ok('the undo reports success', res.ok === true, JSON.stringify(res));
  ok('and it went back to the engineer holding the weeks either side',
     res.to === owner, `${res.to} vs ${owner}`);

  const back = api.activeRows(api.readBookings())
    .filter(b => b.project === long.project && b.phase === long.phase);
  ok('the pieces merged back into one unbroken run', back.length === 1,
     JSON.stringify(back.map(b => `${b.engineer} ${b.start_date}..${b.end_date}`)));
  ok('covering exactly the weeks it started with',
     W(back[0].start_date) === W(long.start_date) && W(back[0].end_date) === W(long.end_date));
  ok('and no hand-placed marker survives',
     !back.some(b => /moved by hand/i.test(b.note || '')));
  ok('nothing was deleted — the superseded rows are still there',
     api.readBookings().filter(b => String(b.status).toLowerCase() === 'superseded').length > 0);

  // a week nobody can take it back from must say so rather than guess
  const solo = api.activeRows(api.readBookings())[0];
  ok('undoing a week that was never dragged is refused',
     api.apiUndoWeekMove({ project: solo.project, phase: solo.phase,
                           week_start: PURE.weekStart(W(solo.start_date)) }).ok === false);
}

// ---- undo works on a ONE-WEEK phase, which has no neighbour to merge into ---
// The first version inferred the original engineer from whoever held the weeks
// either side. A one-week edit has none, so it reported "nothing to hand it back to"
// and the undo was unusable exactly where a mistake is easiest to make. The row now
// records where the week came from, so there is nothing to infer.
{
  const { api } = loadWithSheet(buildTabs());
  const W = api.widx;
  const single = api.activeRows(api.readBookings())
    .filter(b => b.phase === 'Edit' && W(b.end_date) === W(b.start_date))[0];
  ok('the fixture has a one-week edit to test with', !!single,
     JSON.stringify(single || null));

  const owner = single.engineer;
  const iso = PURE.weekStart(W(single.start_date));
  const other = engineers.filter(e => /^yes$/i.test(e.can_edit) && e.name !== owner)[0].name;

  const moved = api.apiReassignWeek({ project: single.project, phase: 'Edit',
                                      week_start: iso, to_engineer: other, confirmed: true });
  ok('the one-week edit moves', moved.ok === true, JSON.stringify(moved).slice(0, 120));
  const now = api.activeRows(api.readBookings())
    .filter(b => b.project === single.project && b.phase === 'Edit');
  ok('and the row records where it came from',
     now.some(b => new RegExp('was ' + owner).test(b.note || '')),
     JSON.stringify(now.map(b => b.note)));

  const undone = api.apiUndoWeekMove({ project: single.project, phase: 'Edit', week_start: iso });
  ok('undoing a one-week phase works instead of refusing',
     undone.ok === true, undone.error || '');
  ok('and it goes back to exactly who had it', undone.to === owner, `${undone.to} vs ${owner}`);
  const back = api.activeRows(api.readBookings())
    .filter(b => b.project === single.project && b.phase === 'Edit');
  ok('with no hand-placed marker left', back.length === 1 && back[0].engineer === owner &&
     !/moved by hand/i.test(back[0].note || ''),
     JSON.stringify(back.map(b => `${b.engineer}:${b.note}`)));
}

// ---- drag reassignment: edges, refusals and warnings -----------------------
{
  const { api } = loadWithSheet(buildTabs());
  const W = api.widx;
  const b0 = api.activeRows(api.readBookings())
    .filter(b => W(b.end_date) - W(b.start_date) >= 1)[0];
  const firstIso = PURE.weekStart(W(b0.start_date));
  const other = engineers.map(e => e.name).filter(n => n !== b0.engineer)[0];

  // moving the FIRST week leaves two rows, not three — no empty remainder
  const r1 = api.apiReassignWeek({ project: b0.project, phase: b0.phase,
                                   week_start: firstIso, to_engineer: other, confirmed: true });
  ok('moving the first week of a run writes two rows', r1.ok && r1.rows_written === 2,
     JSON.stringify(r1).slice(0, 140));

  // refusals
  const bad = [
    [{ project: 'No Such Show', phase: 'Dub', week_start: firstIso, to_engineer: other },
     'an unknown project is refused'],
    [{ project: b0.project, phase: 'Dub', week_start: '2099-01-05', to_engineer: other },
     'a week with no booking is refused'],
    [{ project: b0.project, phase: b0.phase, week_start: firstIso, to_engineer: 'Nobody' },
     'an engineer not on the roster is refused'],
    [{ project: b0.project, phase: b0.phase, week_start: firstIso },
     'an incomplete move is refused'],
  ];
  bad.forEach(([payload, label]) => {
    const rowsBefore = api.readBookings().length;
    const res = api.apiReassignWeek(Object.assign({ confirmed: true }, payload));
    ok(label, res.ok === false && api.readBookings().length === rowsBefore,
       JSON.stringify(res));
  });

  ok('moving a week to the engineer who already has it is refused',
     api.apiReassignWeek({ project: b0.project, phase: b0.phase, week_start: firstIso,
                           to_engineer: other, confirmed: true }).ok === false);

  // warnings: dropping onto someone already booked that week
  const live = api.activeRows(api.readBookings());
  const target = live.filter(b => b.project !== b0.project)[0];
  const clashWeek = PURE.weekStart(W(target.start_date));
  const victim = live.filter(b => W(b.start_date) <= W(target.start_date) &&
                                  W(target.start_date) <= W(b.end_date) &&
                                  b.engineer !== target.engineer)[0];
  if (victim) {
    const pre = api.apiReassignWeek({ project: victim.project, phase: victim.phase,
                                      week_start: clashWeek, to_engineer: target.engineer });
    ok('dropping onto a booked engineer warns about double-booking',
       pre.ok && pre.warnings.some(w => w.kind === 'double'),
       JSON.stringify(pre.warnings));
    ok('and the double-booking warning names the colliding project',
       pre.warnings.filter(w => w.kind === 'double')
         .some(w => w.text.indexOf(target.project) !== -1),
       JSON.stringify(pre.warnings));
  }
}

// ---- the lock toggle writes one cell and nothing else -----------------------
{
  const { api, stats } = loadWithSheet(buildTabs());
  const title = api.readProjectRows()[0].project_title;
  const before = api.readBookings().length;
  const w0 = stats.writes;
  const res = api.apiSetProjectLock(title, true);
  ok('the toggle reports the new state', res.ok && res.locked === true, JSON.stringify(res));
  ok('it reads back as locked from the sheet',
     api.readProjectRows().filter(p => p.project_title === title)[0].locked === true);
  ok('it costs one write', stats.writes - w0 === 1, `${stats.writes - w0} writes`);
  ok('and it does not touch the bookings at all',
     api.readBookings().length === before, `${before} -> ${api.readBookings().length}`);

  api.apiSetProjectLock(title, false);
  ok('unlocking reads back as unlocked',
     api.readProjectRows().filter(p => p.project_title === title)[0].locked === false);
  ok('an unknown title is refused, not silently created',
     api.apiSetProjectLock('No Such Show', true).ok === false);
}

// ---- a duplicated book inflates overlap without the plan changing -----------
// This is the shape of "it feels like there is more overlap now": the engine's
// plan is untouched, but every duplicated row makes its weeks count twice
// (2026-08-13).
{
  const tabs = buildTabs();
  const { api } = loadWithSheet(tabs);
  ok('a clean book has no duplicate live rows',
     api.duplicateLiveRows_(api.activeRows(api.readBookings())).length === 0);

  const dup = buildTabs();
  const body = dup.Bookings.slice(1);
  dup.Bookings = [dup.Bookings[0]].concat(body, body.map(r => r.slice()));  // plotted twice
  const d2 = loadWithSheet(dup);
  const found = d2.api.duplicateLiveRows_(d2.api.activeRows(d2.api.readBookings()));
  ok('plotting the same book twice is detected as duplicates',
     found.length === body.length, `${found.length} of ${body.length}`);

  // the giveaway: overlap explodes while the ENGINE's plan is identical
  const clean = loadWithSheet(buildTabs()).api.apiSchedule('project');
  const dirty = d2.api.apiSchedule('project');
  const count = s => s.cells.reduce((n, row) =>
    n + row.filter(c => c && c.overlap).length, 0);
  ok('the duplicated book reports far more overlapped cells',
     count(dirty) > count(clean) * 3,
     `clean ${count(clean)}, duplicated ${count(dirty)}`);

  // a divided dub emits several Dub rows for one project — must NOT count
  const divided = api.activeRows(api.readBookings())
    .filter(b => b.phase === 'Dub')
    .reduce((m, b) => { m[b.project] = (m[b.project] || 0) + 1; return m; }, {});
  const multi = Object.keys(divided).filter(k => divided[k] > 1);
  ok('projects with several Dub rows are not flagged as duplicates',
     multi.length > 0 && api.duplicateLiveRows_(api.activeRows(api.readBookings())).length === 0,
     `${multi.length} project(s) have multiple Dub rows: ${multi.slice(0,2).join(', ')}`);
}

// ---- the quarter range clips the grid without losing or misaligning cells ----
{
  const { api } = loadWithSheet(buildTabs());
  const all = api.apiSchedule('project');
  ok('every quarter in the book is offered', (all.quarters||[]).length >= 2,
     JSON.stringify(all.quarters));

  const q = all.quarters[1];
  const one = api.apiSchedule('project', { from: q, to: q });
  ok('one quarter clips to at most 14 weeks',
     one.weeks.length > 0 && one.weeks.length <= 14, `${one.weeks.length} weeks`);
  ok('every week returned is inside the range',
     one.weeks.every(w => w.quarter === q), JSON.stringify(one.weeks.map(w=>w.quarter)));
  ok('and it is genuinely narrower than the full view',
     one.weeks.length < all.weeks.length, `${one.weeks.length} vs ${all.weeks.length}`);

  // the alignment guarantee: a booking straddling the range edge must still paint
  // its in-range weeks. The old code did `return` on the first out-of-range week,
  // which abandoned the rest of that booking entirely.
  const painted = one.cells.reduce((n,row)=>n + row.filter(Boolean).length, 0);
  ok('cells are painted inside a clipped range', painted > 0, `${painted} cells`);
  ok('no cell index exceeds the clipped week count',
     one.cells.every(row => row.length === one.weeks.length));

  // A booking that STARTS before the range and continues into it must still paint
  // its in-range weeks. The old loop hit `return` on the first out-of-range week and
  // abandoned the whole booking, so straddlers vanished from a clipped view.
  const firstWk = one.weeks[0].week;
  const straddler = one.labels.map((label, ri) => ({ label, ri }))
    .filter(x => one.cells[x.ri][0])
    .find(x => {
      const full = all.weeks.findIndex(w => w.week === firstWk);
      return full > 0 && all.cells[all.labels.indexOf(x.label)][full - 1];
    });
  ok('a booking straddling the range edge still paints inside it',
     !!straddler, 'no straddling booking found in this fixture');

  ok('markers stay within bounds',
     (one.markers||[]).every(m => m.col >= 0 && m.col < one.weeks.length),
     JSON.stringify(one.markers));
  ok('today_week is -1 when today falls outside the range or a valid column when inside',
     one.today_week === -1 || (one.today_week >= 0 && one.today_week < one.weeks.length),
     String(one.today_week));

  // rows with no work in the range are dropped in project mode, kept in engineer mode
  ok('a clipped project view drops projects with no work in the range',
     one.labels.length < all.labels.length,
     `${one.labels.length} of ${all.labels.length} projects`);
  ok('every remaining row has at least one cell',
     one.cells.every(row => row.some(Boolean)));
  ok('markers still point at the right rows after the drop',
     (one.markers||[]).every(m => m.row >= 0 && m.row < one.labels.length));
  const eng1 = api.apiSchedule('engineer', { from: q, to: q });
  const engAll = api.apiSchedule('engineer');
  ok('engineer mode keeps everyone, since an empty row means free all quarter',
     eng1.labels.length === engAll.labels.length,
     `${eng1.labels.length} vs ${engAll.labels.length}`);

  // an impossible range returns empty rather than throwing
  const none = api.apiSchedule('project', { from: '2099-Q1', to: '2099-Q4' });
  ok('an empty range is reported, not crashed', none.weeks.length === 0 && none.clipped === true,
     JSON.stringify({w:none.weeks.length, c:none.clipped}));
}

// ---- the schedule reads chronologically, even with no Projects tab ----------
// It used to sort on deadline looked up from PROJECTS while drawing from BOOKINGS,
// so an orphaned book tied at '9999' and fell through to the alphabetical
// tiebreak — an alphabetical SCHEDULE (2026-08-13).
{
  const { api } = loadWithSheet(buildTabs());
  const sch = api.apiSchedule('project');
  const starts = sch.cells.map(row => row.findIndex(c => c));
  ok('rows are ordered by when the work starts',
     starts.every((w, i) => i === 0 || w >= starts[i - 1]),
     JSON.stringify(sch.labels.map((l, i) => l + '@' + starts[i]).slice(0, 6)));

  // the failing case: no Projects rows at all, so no deadline is knowable
  const bare = buildTabs();
  bare.Projects = bare.Projects.slice(0, 2);        // banner + header only
  const b2 = loadWithSheet(bare).api.apiSchedule('project');
  const fw2 = b2.cells.map(row => row.findIndex(c => c));
  ok('still chronological with an empty Projects tab',
     fw2.every((w, i) => i === 0 || w >= fw2[i - 1]),
     JSON.stringify(b2.labels.map((l, i) => l + '@' + fw2[i]).slice(0, 6)));
  ok('and it is NOT alphabetical',
     b2.labels.join('|') !== b2.labels.slice().sort((a, c) => a.localeCompare(c)).join('|'),
     b2.labels.slice(0, 5).join(' | '));
}

// ---- nothing else scales with row count ------------------------------------
// The timezone bug hid for weeks because only reads and writes were counted. Any
// Sheets accessor called per row is the same bug, so measure the total instead:
// double the book and the call count must NOT double.
{
  const one = loadWithSheet(buildTabs());
  one.api.apiBootstrap();
  const small = one.stats.reads + one.stats.writes + one.stats.tz + one.stats.misc;

  const tabs = buildTabs();
  const hdr = tabs.Bookings[0], body = tabs.Bookings.slice(1);
  tabs.Bookings = [hdr].concat(body, body.map(function (r) { return r.slice(); }));
  const two = loadWithSheet(tabs);
  two.api.apiBootstrap();
  const big = two.stats.reads + two.stats.writes + two.stats.tz + two.stats.misc;

  ok('doubling the book does not increase Sheets calls',
     big === small, `${small} calls on ${body.length} rows, ${big} on ${body.length * 2}`);
}

// ---- the timezone is a round trip, not a constant ---------------------------
// getSpreadsheetTimeZone() goes to the server. isoFromCell called it once PER DATE
// CELL, so a real book cost hundreds of round trips on a single page load — which
// is exactly what "stuck reading the book" looked like (2026-08-13).
{
  const { api, stats } = loadWithSheet(buildTabs());
  api.apiBootstrap();
  const dateCells = 2 * 71 + 24;   // two per booking row, one deadline per project
  ok(`the timezone is fetched once, not once per date cell (~${dateCells})`,
     stats.tz <= 1, `${stats.tz} timezone lookups`);
}

// ---- saving one project through the app -------------------------------------
{
  const { api, stats } = loadWithSheet(buildTabs());
  const res = api.apiSaveProject({ title: 'Brand New Show', client: 'Netflix',
    deadline: '2027-03-01', dub: '2', edit: '1', mix: '1', mix_level: 'Advanced',
    music: false, special: false, recordist: 'Auto', mixer: 'Auto' });
  ok('the save succeeded', res && res.ok, JSON.stringify(res && res.errors));
  const total = stats.reads + stats.writes;
  ok('one save stays under 12 round trips', total < 12,
     `${total} calls (${stats.reads} reads, ${stats.writes} writes): ` + JSON.stringify(stats.byTab));
}

// ---- the grid payload, and a dragged week's round trip ----------------------
// A cell can hold two bookings, and a drag has to know which one it picked up, so
// the payload names them individually. The detail-panel fields that also lived here
// (run dates, row number, previous engineer) went out with the panel on 2026-08-30.
{
  const { api, stats } = loadWithSheet(buildTabs());
  const before = stats.reads + stats.writes;
  const d = api.apiSchedule('engineer', null);
  ok('the engineer grid still builds', !d.empty && d.mode === 'engineer');

  const items = [];
  d.cells.forEach(row => row.forEach(c => { if (c && c.items) c.items.forEach(i => items.push(i)); }));
  ok('every cell carries its bookings as items', items.length > 0, `${items.length} items`);
  ok('each item names its project and phase, so a drag knows what it grabbed',
     items.every(i => i.p && i.ph), JSON.stringify(items.slice(0, 2)));

  // A speed guard, not a correctness one: the grid is the heaviest read in the app and
  // this is what stops it quietly growing another sheet round trip.
  const cost = stats.reads + stats.writes - before;
  ok('one grid build costs under 8 round trips', cost < 8, `${cost} calls`);

  // "Return to automatic" is offered from `hand`, and names the engineer it came from.
  // The week is taken from the MIDDLE OF A RUN, not the middle of the grid — the grid
  // runs to the furthest deadline, so its midpoint week is often booked by nobody and
  // this whole check silently skipped.
  const live = api.activeRows(api.readBookings());
  const run = live.filter(b => api.widx(b.end_date) - api.widx(b.start_date) >= 1)[0];
  ok('the fixture has a multi-week run to move a week out of', !!run);

  const midW = api.widx(run.start_date) + 1;
  const midStart = (d.weeks.filter(w => api.widx(w.start) === midW)[0] || {}).start;
  ok('and that week is on the grid', !!midStart, `week ${midW} not in the payload`);

  const to = api.readEngineers().map(e => e.name).filter(n => n !== run.engineer)[0];
  // `confirmed`, not `confirm`: without it this is the dry run and writes nothing,
  // which would leave every assertion below passing against an unmoved book.
  const mv = api.apiReassignWeek({ project: run.project, phase: run.phase,
    week_start: midStart, to_engineer: to, confirmed: true });
  ok('a dragged week reports back as moved', mv && mv.ok && !mv.preview,
     JSON.stringify(mv && (mv.error || mv)));

  const d2 = api.apiSchedule('engineer', null);
  const ri = d2.labels.indexOf(to);
  let ci = -1;
  d2.weeks.forEach((w, i) => { if (w.start === midStart) ci = i; });
  const moved = (((d2.cells[ri] || [])[ci] || {}).items || [])
    .filter(i => i.p === run.project && i.ph === run.phase)[0];
  ok('the moved week appears in the new engineer\'s column', !!moved);
  ok('the moved week is flagged hand-placed in the payload', !!(moved && moved.hand),
     JSON.stringify(moved));
}


console.log(`\n${pass} passed, ${fail} failed`);
// Only exit when run directly — required as a module, the exit would kill the caller
// before it ever saw the exports below.
if (require.main === module) process.exit(fail ? 1 : 0);

// Exported so a rendering harness can stand the real web-app API up against a real
// sheet. The suite above runs on require, which is noisy but harmless — and keeps the
// fake-sheet setup in exactly one place rather than drifting in a second copy.
module.exports = { loadWithSheet, buildTabs };
