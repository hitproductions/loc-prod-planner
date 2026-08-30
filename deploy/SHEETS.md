# Which sheet is which

Decided 2026-08-31: **the copy is the real book.**

| | id | holds |
|---|---|---|
| `Loc Prod Planner Base for webapp` | `1_9A1gzFlr8xOkmmzRdH75JBS5KmkqEoS0lLO3GWOGiQ` | THE BOOK |
| its bound script | `1VuzPgXblusJLEhygMDkoT7VPt1H3j8X9KlCCRh6-jSRA5fG0KRfL09Km` | the sheet menu only |
| `Loc Prod Planner Base` (original) | script `1b5RDT0UhuHkvmUnlICT3lOpVhwgvBUmX_6KvWbnwbNSeHoZjVAkqIgwu` | **retired — do not push** |

## How this happened

Duplicating a sheet duplicates its bound Apps Script. So the copy, made as a sandbox
for the web app, quietly became a second full installation of the Apps Script app
pointing at different data. Every deploy from v73 to v77 went to the ORIGINAL's script
(`1b5RDT0UhuHkvmUnlICT3lOpVhwgvBUmX_6KvWbnwbNSeHoZjVAkqIgwu`), while the copy — the
one actually in use — kept an older build with the untrimmed menu.

The hazard was not the stale menu. It was that running **Set up sheets** from that old
build rebuilds the tabs from ITS `P_HEADERS`, which would have wiped the `Status` and
`Completed` columns the web app had just created.

## The rule

One book, one script. If a sheet is ever copied again, delete the copy's bound script
immediately unless it is deliberately becoming the new home — a live second copy of the
app pointing at different data is the same shape as `lean-rule-wip`, but worse, because
that one at least could not run.

## Deploying — and why there is no deployment

The Apps Script project on the copy exists for the SHEET MENU, not for a web app. Menu
functions are container-bound and run from the latest PUSHED code, so `clasp push` is
the whole deployment story:

    cd appsscript && npx clasp push --force

`doGet` and the HTML views are still in the project but are never reached, because no
web app deployment exists — the Node app replaced that UI. Creating one would publish a
second, slower interface onto the same book, which is what the new app was built to get
away from.

The original sheet's deployment is still live at its old URL, still served by the
Apps Script UI, and now reads a book nobody updates. Anyone holding that bookmark is
looking at an abandoned schedule.
