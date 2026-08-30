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
    (change.append || []).forEach(r => {
      held.bookings.push({ ...r, status: '', row_number: held.bookings.length + 2 });
    });
    return { superseded: (change.supersede || []).length, appended: (change.append || []).length };
  },
  // tests reset between cases
  _reset() { held = null; },
};
