// Re-plan support. The preview, diff table and Apply button live in the web app
// (see 40_WebApp.gs); what remains here is the shared state between them.
//
// Re-planning never moves dates — deadlines are fixed by the client, so a
// re-solve only ever changes who (rule 13).

var REPLAN_STASH_KEY = 'replan_payload';

// Cheap guard against applying a preview that no longer matches the book.
// HANDOFF §10 records that there is no concurrency control; this at least
// refuses to write a stale plan rather than corrupting the book silently.
function bookFingerprint_(bookings) {
  var live = activeRows(bookings);
  var parts = live.map(function (b) {
    return b.row_number + ':' + b.project + ':' + b.phase + ':' + b.engineer + ':' + b.start_date;
  });
  return live.length + '/' + parts.join('|').length + '/' +
         Utilities.base64Encode(Utilities.computeDigest(
           Utilities.DigestAlgorithm.MD5, parts.join('|'))).slice(0, 12);
}
