// The read model, and the only thing that knows where the data lives.
//
// The whole point of the new app is that a request does NOT go to Google. The book is
// held in memory, served from there, and refreshed on a timer or when we write. That
// is what buys the speed: the Apps Script app spends ~150-250ms per SpreadsheetApp
// read and makes three or four of them per request, before any of our code runs.
//
// Sheets stays the system of record. It is not a cache of ours — it is the thing the
// team can open and repair by hand when something goes wrong, which has rescued this
// project more than once (HANDOFF §8). We read it, we write back to it, and we never
// become the only place the truth lives.

const SOURCES = {};

// A source supplies { engineers, projects, bookings } and accepts writes. Two exist:
// `fixture` (the validation book, no credentials, used for development and tests) and
// `sheets` (the real spreadsheet). Registering rather than importing keeps the server
// from depending on Google at all until it is actually pointed at a sheet.
function register(name, source) { SOURCES[name] = source; }

function createStore(sourceName, opts) {
  const source = SOURCES[sourceName];
  if (!source) throw new Error(`Unknown data source "${sourceName}". Registered: ${Object.keys(SOURCES).join(', ') || 'none'}`);
  const ttlMs = (opts && opts.ttlMs) != null ? opts.ttlMs : 30000;

  let book = null;
  let loadedAt = 0;
  let inflight = null;
  // Bumped on every load and every write. A re-plan is previewed against one book and
  // applied against whatever the book is by then — if those differ, the plan the user
  // agreed to is not the plan that would land, and applying it anyway is how you get a
  // schedule nobody chose.
  let version = 0;

  // One refresh at a time. Without this a burst of requests on a cold store each start
  // their own read of the same spreadsheet.
  async function load() {
    if (inflight) return inflight;
    inflight = (async () => {
      const fresh = await source.read();
      book = fresh;
      loadedAt = Date.now();
      version++;
      inflight = null;
      return book;
    })().catch(e => { inflight = null; throw e; });
    return inflight;
  }

  return {
    name: sourceName,
    // `force` skips the TTL — used after a write, and by an explicit Refresh.
    async get(force) {
      if (force || !book || Date.now() - loadedAt > ttlMs) await load();
      return book;
    },
    // Writes go to the source first and only then invalidate, so a failed write can
    // never leave the app showing a change the spreadsheet does not have.
    //
    // The event is recorded AFTER the write succeeds and never blocks it: a log that
    // could fail a real change would be worse than no log. If the log write throws, the
    // schedule is still correct and one entry is missing, which is the right way round.
    async write(change, meta) {
      const result = await source.write(change);
      book = null;
      version++;
      if (meta && source.appendEvent) {
        try {
          await source.appendEvent({
            at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
              .toISOString().slice(0, 19).replace('T', ' '),
            action: meta.action || 'change',
            summary: meta.summary || '',
            superseded: (change.supersede || []).join(','),
            appended: (result.appended_rows || []).join(','),
            // What a rollback needs to put a project row back. Row numbers alone
            // cannot say "and it was not cancelled before this".
            revert: meta.revert ? JSON.stringify(meta.revert) : '',
          });
        } catch (e) {
          console.error('change applied, log entry failed: ' + (e && e.message));
        }
      }
      return result;
    },
    async events() { return source.readEvents ? source.readEvents() : []; },
    version() { return version; },
    stats() {
      return { source: sourceName, version, loaded_at: loadedAt || null,
               age_ms: loadedAt ? Date.now() - loadedAt : null,
               ttl_ms: ttlMs, rows: book ? book.bookings.length : 0 };
    },
  };
}

module.exports = { register, createStore };
