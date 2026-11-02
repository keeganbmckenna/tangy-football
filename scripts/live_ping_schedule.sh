#!/usr/bin/env bash
# Creates (or updates) the Upstash QStash schedule behind the live win-probability chart: once a day
# (10:00 UTC, before any kickoff) QStash calls /api/live/plan, which reads the day's kickoffs from
# ESPN and queues a ping of /api/live every 3 minutes only while games can be on
# (web/lib/livePing.ts). /api/live saves each matchup's odds while a game is in progress
# (web/lib/liveHistory.ts), so the chart fills in whether or not anyone has the site open. A full
# NFL Sunday is about 300 pings, inside the free plan's 500 messages a day; days without games
# use one.
#
# GitHub's scheduled Live ping (.github/workflows/live-ping.yml) stays as a backup; GitHub runs
# those late or not at all, so it can't be the only one.
#
# Needs QSTASH_TOKEN (and QSTASH_URL for a regional QStash) in web/.env.local, from Vercel's QStash
# integration, which also gives the deployed site the signing keys /api/live/plan checks. Run
# again after changing the schedule: the fixed id replaces the old one. Also plans today right
# away, so the first day doesn't wait for 10:00 UTC.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a
# shellcheck disable=SC1091
source web/.env.local
set +a
: "${QSTASH_TOKEN:?Add QSTASH_TOKEN to web/.env.local}"
QSTASH_URL="${QSTASH_URL:-https://qstash.upstash.io}"
PLAN=https://tangy-football.vercel.app/api/live/plan

curl -fsS -X POST "$QSTASH_URL/v2/schedules/$PLAN" \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Schedule-Id: tangy-live-plan" \
  -H "Upstash-Cron: 0 10 * * *" \
  -H "Upstash-Retries: 3"
echo
curl -fsS "$QSTASH_URL/v2/schedules/tangy-live-plan" -H "Authorization: Bearer $QSTASH_TOKEN" |
  python3 -c "import json, sys; s = json.load(sys.stdin); print('Scheduled', s['cron'], '->', s['destination'])"
# Today's plan now
curl -fsS -X POST "$QSTASH_URL/v2/publish/$PLAN" -H "Authorization: Bearer $QSTASH_TOKEN" -H "Upstash-Retries: 3"
echo
