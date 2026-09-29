#!/bin/sh
# Deploy the planner to Google Cloud Run.
#
# PRIVATE BY DEFAULT. The service is deployed with --no-allow-unauthenticated, so there
# is no public URL: you reach it through an authenticated local tunnel (see below). That
# matters because the app authenticates nobody — a public Cloud Run URL would put the
# whole schedule on the open internet.
#
#   ./deploy/cloudrun.sh                 # deploy (private)
#   ./deploy/cloudrun.sh --public        # deploy public — ONLY behind Cloudflare Access
#
# Then, to use it:
#   gcloud run services proxy planner --region asia-southeast1 --port 8127
#   ...and open http://localhost:8127
set -eu

PROJECT=${PLANNER_GCP_PROJECT:-loc-prod-planner}
REGION=${PLANNER_GCP_REGION:-asia-southeast1}
SERVICE=${PLANNER_GCP_SERVICE:-planner}
SHEET=${PLANNER_SHEET_ID:-1_9A1gzFlr8xOkmmzRdH75JBS5KmkqEoS0lLO3GWOGiQ}
SA=planner-app@loc-prod-planner.iam.gserviceaccount.com

AUTH=--no-allow-unauthenticated
PW_ARG=""
if [ "${1:-}" = "--public" ]; then
  AUTH=--allow-unauthenticated
  # A public Cloud Run URL with no gate puts the whole schedule, client project names
  # included, on the open internet at a guessable *.run.app address. Refuse rather than
  # let that happen by omission.
  if [ -z "${PLANNER_PASSWORD:-}" ]; then
    echo "REFUSING: --public needs PLANNER_PASSWORD set." >&2
    echo "  The app authenticates nobody. Without a password the URL is open to anyone." >&2
    echo "  e.g.  PLANNER_PASSWORD='something-long' ./deploy/cloudrun.sh --public" >&2
    exit 1
  fi
  PW_ARG="--set-env-vars PLANNER_PASSWORD=$PLANNER_PASSWORD"
fi

cd "$(dirname "$0")/.."

echo "project $PROJECT / region $REGION / service $SERVICE"
[ "$AUTH" = "--allow-unauthenticated" ] && \
  echo "deploying PUBLIC, behind the shared-password gate." 

gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --source . \
  --service-account "$SA" \
  --set-env-vars "PLANNER_SOURCE=sheets,PLANNER_SHEET_ID=$SHEET" \
  $PW_ARG \
  --memory 512Mi \
  --cpu 1 \
  --timeout 120 \
  --min-instances 0 \
  --max-instances 1 \
  $AUTH

# --max-instances 1 is NOT a cost control, it is a correctness requirement: the app
# holds the re-plan preview and the book's version in memory, so a second instance
# would reject tokens the first one issued.
#
# --memory 512Mi because a re-plan peaks near 184 MB; the 256Mi default would kill it.
#
# No key file is mounted. --service-account makes Cloud Run run AS planner-app, and the
# app picks up credentials from the metadata server — nothing to leak, nothing to rotate.

echo
echo "deployed. To use it:"
echo "  gcloud run services proxy $SERVICE --region $REGION --port 8127"
echo "  then open http://localhost:8127"
