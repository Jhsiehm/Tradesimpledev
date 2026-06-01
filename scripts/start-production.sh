#!/usr/bin/env bash
# Live + accurate TradeSimple — requires keys in .env.local (see .env.example).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DATA_ACCURACY_MODE="${DATA_ACCURACY_MODE:-production}"
export PORT="${PORT:-3010}"
export DEMO_AUTH="${DEMO_AUTH:-true}"

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

export DATA_ACCURACY_MODE="${DATA_ACCURACY_MODE:-production}"

echo "TradeSimple production data mode (DATA_ACCURACY_MODE=$DATA_ACCURACY_MODE)"
if [[ -n "${CONGRESS_API_KEY:-}" ]]; then echo "  Congress:  configured"; else echo "  Congress:  MISSING"; fi
if [[ -n "${FINNHUB_API_KEY:-}" ]]; then echo "  Finnhub:   configured"; else echo "  Finnhub:   MISSING"; fi
if [[ -n "${SENATE_LDA_API_KEY:-}" ]]; then echo "  LDA:       configured"; else echo "  LDA:       MISSING"; fi
echo "  URL:       ${APP_URL:-http://localhost:$PORT}"
echo ""

exec node server.mjs
