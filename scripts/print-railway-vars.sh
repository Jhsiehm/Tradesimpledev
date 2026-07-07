#!/usr/bin/env bash
# Prints Railway Variables to paste into Railway → Tradesimpledev → Variables.
# Does not upload automatically — copy/paste into the dashboard.
# Usage: bash scripts/print-railway-vars.sh [linkedin|full]
set -euo pipefail
PROFILE="${1:-linkedin}"
SECRET="${AUTH_SECRET:-$(openssl rand -hex 32)}"
echo "Paste these into Railway → Variables (Raw Editor):"
echo ""
if [[ "$PROFILE" == "full" ]]; then
cat <<EOF
AUTH_SECRET=${SECRET}
DATA_ACCURACY_MODE=demo
DEMO_AUTH=true
LAUNCH_PHASE=full-feature
EOF
else
cat <<EOF
AUTH_SECRET=${SECRET}
DATA_ACCURACY_MODE=demo
LANDING_ONLY=true
DEMO_AUTH=false
LAUNCH_PHASE=full-feature
EOF
fi
echo ""
echo "Profile: ${PROFILE} (linkedin = waitlist-only soft launch; full = demo terminal enabled)"
echo "APP_URL is optional on Railway — the server auto-uses RAILWAY_PUBLIC_DOMAIN."
echo ""
echo "Supabase (Tradesimpledev · ref uyswlpnpxubxgvlqartu) — add manually from Supabase dashboard:"
echo "  SUPABASE_URL=https://uyswlpnpxubxgvlqartu.supabase.co"
echo "  SUPABASE_SERVICE_ROLE_KEY=<service_role secret from Settings → API>"
echo ""
echo "After deploy, add Google redirect URI:"
echo "  https://YOUR-DOMAIN.up.railway.app/auth/callback/google"
