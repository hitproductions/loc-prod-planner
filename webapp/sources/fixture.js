// The validation book as a data source. No credentials, no network.
//
// This exists so the app is runnable and testable before it is pointed at a real
// spreadsheet — and so it stays testable afterwards. Every route can be exercised
// against a known book, which is how the Apps Script version's tests work too.
const path = require('path');
const { loadAppsScript } = require('../../core/engine.js');

const engineers = require('../../validation/engineers.json');
const rawProjects = require('../../validation/projects.json');

function build() {
  const A = loadAppsScript();
  const projects = rawProjects.map(p => A.normalizeProject(p).project);
  const bookings = A.plotBatch(rawProjects, [], engineers).new_rows
    .map((b, i) => ({ ...b, status: '', row_number: i + 2 }));
  return { engineers, projects, bookings };
}

let held = null;
let events = [];

module.exports = {
  async read() {
    if (!held) held = build();
    // A copy per read: callers must not be able to mutate the store's book in place.
    return JSON.parse(JSON.stringify(held));
  },
  async write(change) {
    if (!held) held = build();
    if (change.supersede && change.supersede.length) {
      const gone = new Set(change.supersede);
      held.bookings.forEach(b => { if (gone.has(b.row_number)) b.status = 'superseded'; });
    }
    // Rolling back puts rows BACK, which is the only thing that ever clears a status.
    if (change.revive && change.revive.length) {
      const back = new Set(change.revive);
      held.bookings.forEach(b => { if (back.has(b.row_number)) b.status = ''; });
    }
    const appended = [];
    (change.append || []).forEach(r => {
      const row_number = held.bookings.length + 2;
      held.bookings.push({ ...r, status: '', row_number });
      appended.push(row_number);
    });
    // The project row, not just its bookings. Without this a saved project has a
    // schedule and no entry in the list — the orphan state.
    if (change.project) {
      const was = String(change.original_title || '').trim() || change.project.project_title;
      const i = held.projects.findIndex(p => p.project_title === was);
      if (i >= 0) held.projects[i] = { ...held.projects[i], ...change.project };
      else held.projects.push({ ...change.project });
    }
    return { superseded: (change.supersede || []).length, appended: appended.length,
             appended_rows: appended,
             project: change.project ? change.project.project_title : null };
  },
  async readEvents() { return events.slice(); },
  async appendEvent(e) { events.push({ ...e, id: events.length + 1 }); return e; },

  // tests reset between cases
  _reset() { held = null; events = []; },
};
