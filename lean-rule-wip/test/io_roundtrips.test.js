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
    PropertiesService: { getDocumentProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {} }) },
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
    resetSchedule, plotAllUnplotted, relinkProjectBookings, orphanProjects_,
    apiReassignWeek, widx };`);
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
    Engineers: [['name','can_record','can_edit','can_mix','mix_level','music_specialist','overflow_only','specials_only']]
      .concat(engineers.map(e => [e.name, e.can_record, e.can_edit, e.can_mix, e.mix_level,
                                  e.music_specialist, e.overflow_only, e.specials_only])),
    // Dates as Date OBJECTS, which is what a real sheet hands back once the column
    // carries a date format — the old string fixture took isoFromCell's regex fast
    // path and so never exercised the timezone lookup at all.
    Bookings: [['project','phase','engineer','start_date','end_date','source','note','status']]
      .concat(book.map(b => [b.project, b.phase, b.engineer,
                             new Date(b.start_date + 'T00:00:00Z'), new Date(b.end_date + 'T00:00:00Z'),
                             b.source, b.note, ''])),
    Projects: [['Projects — master list'],
               ['Project','Client','Deadline','Phases D/E/M','Mix level','Music','Special',
                'Recordist pick','Editor pick','Mixer pick','Dub wks','Edit wks','Mix wks',
                'Recordist','Editor','Mixer','Warnings','Notes','Plotted','Locked']]
      .concat(projects.map(p => [p.project_title, p.client, new Date(p.deadline + 'T00:00:00Z'),
        `${p.dub_weeks}/${p.edit_weeks}/${p.mix_weeks}`, p.mix_level_required,
        p.music_songs, p.special_project, 'Auto', 'Auto', 'Auto',
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
