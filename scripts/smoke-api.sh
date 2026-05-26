#!/usr/bin/env bash
# Smoke-test TradeSimple APIs (requires server on PORT, default 3010).
set -euo pipefail
PORT="${PORT:-3010}"
BASE="http://localhost:${PORT}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

pass=0
fail=0

check() {
  local name="$1"
  local method="${2:-GET}"
  local path="$3"
  local body="${4:-}"
  local code
  if [[ "$method" == "POST" && -n "$body" ]]; then
    code=$(curl -sS -b "$JAR" -c "$JAR" -o /tmp/smoke-out.json -w "%{http_code}" -X POST \
      -H "content-type: application/json" -d "$body" "${BASE}${path}" 2>/dev/null || echo "000")
  else
    code=$(curl -sS -b "$JAR" -c "$JAR" -o /tmp/smoke-out.json -w "%{http_code}" -X "$method" "${BASE}${path}" 2>/dev/null || echo "000")
  fi
  if [[ "$code" =~ ^2 ]]; then
    echo "PASS $name ($code)"
    pass=$((pass + 1))
  else
    echo "FAIL $name ($code) $(head -c 120 /tmp/smoke-out.json 2>/dev/null)"
    fail=$((fail + 1))
  fi
}

curl -sS -c "$JAR" -b "$JAR" -L -o /dev/null "${BASE}/auth/demo?next=/dashboard" || { echo "Demo auth failed"; exit 1; }
echo "Demo session OK"

check "config" GET "/api/config"
check "session" GET "/api/session"
check "bootstrap" GET "/api/dashboard/bootstrap"
check "trading account" GET "/api/trading/account"
check "watchlist" GET "/api/watchlist"
check "market quotes" GET "/api/market/quotes?symbols=SPY,NVDA,AAPL"
check "crypto" GET "/api/crypto?ids=bitcoin,ethereum"
check "congress bills" GET "/api/congress/bills"
check "lobbying" GET "/api/lobbying"
check "analysis stock" GET "/api/analysis/stock?symbol=NVDA"
check "market history 1m" GET "/api/market/history?symbol=NVDA&range=1m"
check "market history 6m" GET "/api/market/history?symbol=NVDA&range=6m"
check "edgar" GET "/api/edgar/NVDA"
check "contracts LMT" GET "/api/contracts/Lockheed%20Martin"
check "causality LMT" GET "/api/contracts/causality?symbol=LMT"
check "thesis signals" GET "/api/thesis/signals?symbol=NVDA&thesisText=test&direction=bull"
check "relationship map" GET "/api/relationship-map?symbol=NVDA"
check "theses list" GET "/api/theses"
check "methodology" GET "/api/methodology"
check "funds list" GET "/api/funds"
check "share stock" GET "/api/share/stock?symbol=NVDA&mode=investor"
check "share edgar" GET "/api/share/edgar/NVDA"

check "create thesis" POST "/api/theses" '{"ticker":"AAPL","direction":"bull","thesisText":"Smoke test thesis for e2e","exitCats":["earnings"],"entry":0,"target":0,"stop":0}'
check "paper order" POST "/api/trading/orders" '{"symbol":"AAPL","qty":1,"side":"buy"}'
check "create fund A" POST "/api/funds" '{"name":"Smoke basket A","tag":"custom","symbols":["NVDA","AMD"]}'
FUND_A=$(node -e "const j=JSON.parse(require('fs').readFileSync('/tmp/smoke-out.json','utf8'));console.log(j.fund?.id||j.id||'')")
check "create fund B" POST "/api/funds" '{"name":"Smoke basket B","tag":"custom","symbols":["AAPL","MSFT"]}'
FUND_B=$(node -e "const j=JSON.parse(require('fs').readFileSync('/tmp/smoke-out.json','utf8'));console.log(j.fund?.id||j.id||'')")

if [[ -n "$FUND_A" ]]; then
  check "fund performance" GET "/api/funds/${FUND_A}/performance?range=6m"
  check "fund attribution" GET "/api/funds/${FUND_A}/attribution?range=6m"
  check "fund pulse" GET "/api/funds/${FUND_A}/pulse"
fi

if [[ -n "$FUND_A" && -n "$FUND_B" ]]; then
  check "funds compare" GET "/api/funds/compare?ids=${FUND_A},${FUND_B}"
fi

echo "---"
echo "Passed: $pass  Failed: $fail"
exit $(( fail > 0 ? 1 : 0 ))
