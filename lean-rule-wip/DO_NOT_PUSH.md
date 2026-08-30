# Do not `clasp push` from this folder

Its `.clasp.json` carried **the same `scriptId` as the live app**, so a push from here
would have overwritten production. The file is renamed to `.clasp.json.DISABLED`;
clasp ignores it, and the id is preserved in case anyone needs to know what it was.

This directory holds the withdrawn lean-season splitting work, kept for reference. It
was built four times and removed for good in v52 — quiet-month sharing is a human
call. Read that history before rebuilding any of it.

If you ever do need to push from a copy of the app, create a NEW Apps Script project
first and put its id in a fresh `.clasp.json`. Never reuse the live one.
