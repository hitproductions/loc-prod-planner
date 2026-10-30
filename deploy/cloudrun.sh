#!/bin/sh
# Deploy the planner to Google Cloud Run.
#
# PRIVATE BY DEFAULT. The service is deployed with --no-allow-unauthenticated, so there
# is no public URL: you reach it through an authenticated local tunnel (see below). That
# matters because the app authenticates nobody — a public Cloud Run URL would put the
# whole schedule on the open internet.
#
#   ./deploy/cloudrun.sh                 # deploy (private)
#   ./deploy/cloudrun.sh --public        # deploy public, behind Google sign-in
#   ./deploy/cloudrun.sh --public --view # the read-only service, same sign-in
#   ./deploy/cloudrun.sh --setup-secret  # once: store the Google client secret in Secret Manager
#
# The Google client secret lives in Secret Manager, not in a setting typed at each deploy
# (Tara, 2026-10-30): --setup-secret stores it once, every deploy reads it from there. Run
# --setup-secret again only if the secret is rotated in the Google Cloud console.
#
# Then, to use it:
#   gcloud run services proxy planner --region asia-southeast1 --port 8127
#   ...and open http://localhost:8127
set -eu

PROJECT=${PLANNER_GCP_PROJECT:-loc-prod-planner}
REGION=${PLANNER_GCP_REGION:-asia-southeast1}
SERVICE=${PLANNER_GCP_SERVICE:-planner}
# --view deploys a SECOND service with the writes switched off. That is the only honest
# way to give engineers /view.html: the read-only guarantee is PLANNER_READONLY=1 on the
# server, not the flag the page sets in the browser. Serving /view.html from the editing
# service would look read-only and refuse nothing.
RO=""
if [ "${1:-}" = "--view" ] || [ "${2:-}" = "--view" ]; then
  SERVICE="${SERVICE}-view"
  RO="|PLANNER_READONLY=1"
fi
SHEET=${PLANNER_SHEET_ID:-1_9A1gzFlr8xOkmmzRdH75JBS5KmkqEoS0lLO3GWOGiQ}
SA=planner-app@loc-prod-planner.iam.gserviceaccount.com

# The Google sign-in client. The ID is not a secret; set PLANNER_GOOGLE_CLIENT_ID to an empty
# string to deploy behind the old shared password instead.
GOOGLE_CLIENT_ID=${PLANNER_GOOGLE_CLIENT_ID-63803252709-9m03lkbc51eslcgu1vjs7lr5qk1ves12.apps.googleusercontent.com}
SECRET_NAME=${PLANNER_GOOGLE_SECRET_NAME:-planner-google-client-secret}

if [ "${1:-}" = "--setup-secret" ]; then
  # Prompted, never an argument: an argument lands in ~/.zsh_history in the clear.
  printf 'Google OAuth client secret (typing is hidden): ' >&2
  stty -echo 2>/dev/null || true; read -r SECRET; stty echo 2>/dev/null || true
  printf '\n' >&2
  if [ -z "${SECRET:-}" ]; then echo "REFUSING: no secret given." >&2; exit 1; fi
  gcloud services enable secretmanager.googleapis.com --project "$PROJECT"
  # printf is a shell builtin, so the secret never appears in the process list.
  if gcloud secrets describe "$SECRET_NAME" --project "$PROJECT" >/dev/null 2>&1; then
    printf '%s' "$SECRET" | gcloud secrets versions add "$SECRET_NAME" --project "$PROJECT" --data-file=-
  else
    printf '%s' "$SECRET" | gcloud secrets create "$SECRET_NAME" --project "$PROJECT" \
      --replication-policy=automatic --data-file=-
  fi
  unset SECRET
  # The planner runs as $SA, so that account is the one that must be able to read it.
  gcloud secrets add-iam-policy-binding "$SECRET_NAME" --project "$PROJECT" \
    --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor >/dev/null
  echo "Stored as $SECRET_NAME. Deploy with: deploy/cloudrun.sh --public"
  exit 0
fi

AUTH=--no-allow-unauthenticated
PW_ENV=""
SECRETS_ARG=""
if [ "${1:-}" = "--public" ] && [ -n "$GOOGLE_CLIENT_ID" ]; then
  # Sign in with Google replaces the shared password. Everyone uses their own account, and
  # History records who changed what. The OAuth client is made in the Google Cloud console
  # (see deploy/GOOGLE-LOGIN.md); its secret is read from Secret Manager at run time.
  AUTH=--allow-unauthenticated
  if ! gcloud secrets describe "$SECRET_NAME" --project "$PROJECT" >/dev/null 2>&1; then
    echo "REFUSING: the Google client secret is not in Secret Manager yet." >&2
    echo "  Run once:  deploy/cloudrun.sh --setup-secret" >&2
    exit 1
  fi
  SECRETS_ARG="--set-secrets PLANNER_GOOGLE_CLIENT_SECRET=$SECRET_NAME:latest"
  PW_ENV="|PLANNER_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID|PLANNER_GOOGLE_DOMAIN=${PLANNER_GOOGLE_DOMAIN:-hitproductions.net}"
  [ -n "${PLANNER_GOOGLE_ALLOW:-}" ] && PW_ENV="$PW_ENV|PLANNER_GOOGLE_ALLOW=$PLANNER_GOOGLE_ALLOW"
  [ -n "${PLANNER_PUBLIC_URL:-}" ] && PW_ENV="$PW_ENV|PLANNER_PUBLIC_URL=$PLANNER_PUBLIC_URL"
elif [ "${1:-}" = "--public" ]; then
  AUTH=--allow-unauthenticated
  # A public Cloud Run URL with no gate puts the whole schedule, client project names
  # included, on the open internet at a guessable *.run.app address. Refuse rather than
  # let that happen by omission.
  if [ -z "${PLANNER_PASSWORD:-}" ]; then
    # Prompted rather than required on the command line: a password typed as an argument
    # is written to ~/.zsh_history in the clear and stays there.
    if [ -t 0 ]; then
      printf 'Password for the planner (typing is hidden): ' >&2
      stty -echo 2>/dev/null; read -r PLANNER_PASSWORD; stty echo 2>/dev/null
      printf '\n' >&2
    fi
    if [ -z "${PLANNER_PASSWORD:-}" ]; then
      echo "REFUSING: --public needs a password." >&2
      echo "  The app authenticates nobody. Without one the URL is open to anyone." >&2
      exit 1
    fi
  fi
  # OUTSIDE the block above, so it also applies to a password supplied through the
  # environment. Inside it, PLANNER_PASSWORD=short skipped the check and deployed.
  if [ ${#PLANNER_PASSWORD} -lt 12 ]; then
    echo "REFUSING: that password is under 12 characters." >&2
    echo "  This is the only thing between a public URL and the whole schedule." >&2
    exit 1
  fi
  PW_ENV="|PLANNER_PASSWORD=$PLANNER_PASSWORD"
fi

cd "$(dirname "$0")/.."

echo "project $PROJECT / region $REGION / service $SERVICE"
if [ "$AUTH" = "--allow-unauthenticated" ]; then
  case "$PW_ENV" in
    *PLANNER_GOOGLE_CLIENT_ID*) echo "deploying PUBLIC, behind Google sign-in." ;;
    *) echo "deploying PUBLIC, behind the shared-password gate." ;;
  esac
fi

gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --source . \
  --service-account "$SA" \
  --set-env-vars "^|^PLANNER_SOURCE=sheets|PLANNER_SHEET_ID=$SHEET$RO$PW_ENV" \
  $SECRETS_ARG \
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
[ -n "$RO" ] && echo "This is the READ-ONLY service. Every write route answers 403."
echo "deployed. To use it:"
echo "  gcloud run services proxy $SERVICE --region $REGION --port 8127"
echo "  then open http://localhost:8127"
