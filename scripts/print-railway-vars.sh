#!/usr/bin/env bash
# Prints Railway Variables to paste into Railway → Tradesimpledev → Variables.
# Does not upload automatically — copy/paste into the dashboard.
set -euo pipefail
SECRET="${AUTH_SECRET:-$(openssl rand -hex 32)}"
echo "Paste these into Railway → Variables (Raw Editor):"
echo ""
cat <<EOF
AUTH_SECRET=${SECRET}
DATA_ACCURACY_MODE=demo
DEMO_AUTH=true
EOF
echo ""
echo "APP_URL is optional on Railway — the server auto-uses RAILWAY_PUBLIC_DOMAIN."
echo ""
echo "Supabase (Tradesimpledev · ref uyswlpnpxubxgvlqartu) — add manually from Supabase dashboard:"
echo "  SUPABASE_URL=https://uyswlpnpxubxgvlqartu.supabase.co"
echo "  SUPABASE_SERVICE_ROLE_KEY=<service_role secret from Settings → API>"
echo ""
echo "After deploy, add Google redirect URI:"
echo "  https://YOUR-DOMAIN.up.railway.app/auth/callback/google"
