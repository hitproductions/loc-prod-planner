#!/bin/sh
# Bring the running planner up to date with the checked-out source.
#
# Safe to run when nothing has changed and safe to run twice: docker compose only
# recreates a container whose image or config actually differs. Called either by a
# post-receive hook (deploy the moment Tara pushes) or by cron (deploy within N
# minutes), depending on how the remote is set up.
#
#   ./deploy/redeploy.sh            # build and restart if needed
#   ./deploy/redeploy.sh --pull     # git pull first, for the cron flavour
set -eu

cd "$(dirname "$0")/.."
COMPOSE="deploy/docker-compose.planner.yml"
LOG="${PLANNER_DEPLOY_LOG:-/var/log/planner-deploy.log}"

say() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

if [ "${1:-}" = "--pull" ]; then
  before=$(git rev-parse HEAD)
  # --ff-only: never create a merge commit on the server. If this fails, somebody has
  # committed ON the server, which wants a human rather than a script.
  git pull --ff-only --quiet
  after=$(git rev-parse HEAD)
  if [ "$before" = "$after" ]; then
    exit 0                      # nothing new; stay silent so cron does not spam
  fi
  say "pulled $(git rev-parse --short "$before") -> $(git rev-parse --short "$after")"
fi

# The tests need no credentials and no network: they run against the fixture. This is
# the last chance to catch a broken push before it is serving the production team.
if command -v node >/dev/null 2>&1; then
  say "running the suites that need no credentials"
  for t in test/wrapper.test.js test/webapp.test.js test/engine_drift.test.js \
           test/io_roundtrips.test.js; do
    if ! node "$t" >/dev/null 2>&1; then
      say "ABORTED: $t failed. Nothing was redeployed."
      exit 1
    fi
  done
  say "suites pass"
fi

say "building and restarting"
docker compose -f "$COMPOSE" up -d --build

# Prove it came back, rather than assuming. /api/health only answers ok once the
# instance has actually read the spreadsheet.
i=0
while [ "$i" -lt 30 ]; do
  if curl -fsS --max-time 3 http://127.0.0.1:8127/api/health >/dev/null 2>&1; then
    say "healthy"
    exit 0
  fi
  i=$((i + 1))
  sleep 2
done
say "WARNING: still not healthy after 60s — check: docker compose -f $COMPOSE logs planner"
exit 1
