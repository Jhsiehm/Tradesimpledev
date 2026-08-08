# Railway setup (Tradesimpledev)

## Seeing README instead of the site?

The landing page is **`index.html`** at the repo root (CSS/JS still live under `public/` and `/assets/`).

TradeSimple is a **Node app** (`server.mjs`). At `/` the server serves root `index.html`. If you see **README.md** text, Railway is **not** running Node — common causes:

1. Service type is **Static Site** → delete it; use a **Web Service** connected to GitHub `Tradesimpledev`.
2. **Start command** missing → set to `node server.mjs` (or redeploy latest `main` with `railway.json`).
3. **Root Directory** wrongly set → leave blank (repo root, not `public/`).
4. You're viewing the **GitHub repo** page, not the Railway **public URL** (Settings → Networking).

After a good deploy, open your `*.up.railway.app` URL — you should see the dark TradeSimple landing with “Markets move when bills pass.”

### Project link vs public app URL

`https://railway.com/project/...` is the **dashboard**, not your website. Users cannot open that link.

Get the public URL from:

**Railway → your project → Tradesimpledev service → Settings → Networking → Generate Domain**

Live app URL: `https://tradesimpledev.up.railway.app`

On GitHub Pages, paste that URL in the bottom banner (or visit once with  
`?app_origin=https://YOUR-DOMAIN.up.railway.app`).

## 1. Variables (required)

Run locally:

```bash
bash scripts/print-railway-vars.sh
```

Copy the output into **Railway → Tradesimpledev → Variables → Raw Editor**, then **Deploy**.

Or open `docs/RAILWAY_COPY_PASTE.env` (generated locally, gitignored) if you already ran setup once.

**Open terminal (default — no gates):**

Run `bash scripts/print-railway-vars.sh` (default profile) or paste:

| Variable | Value |
|----------|--------|
| `AUTH_SECRET` | 32+ char random (not `replace-with-a-long-random-string`) |
| `DATA_ACCURACY_MODE` | `demo` for soft launch |
| `LAUNCH_PHASE` | `full-feature` — enables Lobbying, Analysis Lab, AI Research, Settings, Alerts, Track Record |
| `DEMO_AUTH` | `true` |

A fresh visitor can open `/terminal` or `/dashboard` and land in a working paper-trading session with zero manual steps — no passcode, no signup form, no waitlist.

**Optional: landing + waitlist only, no terminal access:**

Only use this if you deliberately want a scarcity-gated soft launch (e.g. a private preview link before a public announcement). Run `bash scripts/print-railway-vars.sh linkedin` or set:

| Variable | Value |
|----------|--------|
| `AUTH_SECRET` | 32+ char random (not `replace-with-a-long-random-string`) |
| `DATA_ACCURACY_MODE` | `demo` |
| `LANDING_ONLY` | `true` — serves `/`, `/manifesto`, public landing APIs, and `POST /api/waitlist` only |
| `DEMO_AUTH` | `false` — defense in depth; demo auth is already blocked when `LANDING_ONLY=true` |
| `LAUNCH_PHASE` | `full-feature` (terminal gates apply after you turn landing-only off) |

Terminal routes (`/dashboard`, `/auth/demo`, `/login`, `/signup`) redirect to `/` while this is on. The landing page itself no longer has a waitlist form to sign up through — set `PREVIEW_PASSCODE` if you need to let specific people in early (see `.env.example`).

`APP_URL` is **optional** on Railway — the server uses `RAILWAY_PUBLIC_DOMAIN` when `APP_URL` is localhost or unset.

## 2. Remove bad suggested variables

Delete or overwrite any row still set to:

- `APP_URL=http://localhost:3000`
- `AUTH_SECRET=replace-with-a-long-random-string`
- `GOOGLE_CLIENT_ID=VALUE or ${{REF}}` (empty placeholders)

## 3. Google OAuth (after live URL exists)

1. Railway → **Settings → Networking** → copy public domain.
2. Google Cloud → OAuth client → redirect URI:

   `https://YOUR-DOMAIN/auth/callback/google`

3. Railway variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and optionally `APP_URL=https://YOUR-DOMAIN`.

## 4. Supabase (Tradesimpledev project)

**Project:** `Tradesimpledev` · ref `uyswlpnpxubxgvlqartu` · region `us-east-1`  
**API URL:** `https://uyswlpnpxubxgvlqartu.supabase.co`

Schema is in `supabase/schema.sql` (tables: `profiles`, `waitlist`, `portfolios`, `watchlists`, `prediction_events`). If the project is empty, paste that file into **Supabase → SQL Editor → Run**.

### Railway variables (names only — copy values from Supabase dashboard)

| Variable | Where to get it | Notes |
|----------|-----------------|-------|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | Must match `uyswlpnpxubxgvlqartu` host |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → **service_role** (secret) | Server-only; never expose to browser |

The server sets `data.supabase: true` in `GET /api/config` only when both vars are set and **not** placeholder strings (`YOUR_PROJECT_REF`, `your-service-role-key`, etc.).

### Full Railway checklist

**Required for boot:**

| Variable | Example / notes |
|----------|-----------------|
| `AUTH_SECRET` | 32+ char random (not `replace-with-a-long-random-string`) |
| `DATA_ACCURACY_MODE` | `demo` for soft launch |
| `LAUNCH_PHASE` | `full-feature` — all terminal views and API gates on |
| `LANDING_ONLY` | `true` for LinkedIn soft launch (landing + waitlist only; blocks dashboard/demo) |
| `DEMO_AUTH` | `false` for LinkedIn launch; `true` when demo terminal should work |

**Required for Supabase persistence (email accounts, paper trading, watchlists, waitlist):**

| Variable | Notes |
|----------|-------|
| `SUPABASE_URL` | See above |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role, not anon/publishable key |

**Optional but recommended:**

| Variable | Notes |
|----------|-------|
| `APP_URL` | Auto from `RAILWAY_PUBLIC_DOMAIN` if unset |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth (if re-enabled) |
| `FINNHUB_API_KEY` | Live quotes on Markets tab and stock briefs |
| `FINNHUB_MIN_INTERVAL_MS` | Ms between Finnhub API calls (default `2000` — ~30/min) |
| `CATALOG_WARM_INTERVAL_MS` | Ms between catalog warmup symbols (default `5000` — 52 symbols in ~4.3 min) |
| `QUOTE_FETCH_CONCURRENCY` | Parallel quote workers for `/api/market/quotes` (default `1` on free tier) |
| `FINNHUB_COOLDOWN_MS` | Pause all Finnhub calls after HTTP 429 (default `105000`) |
| `QUOTE_FRESH_SKIP_MS` | Skip Finnhub when live quote cached younger than this (default `120000`) |
| `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` | Optional Alpaca paper broker (set `ALPACA_PAPER_ENABLED=true` to route orders) |
| `ALPACA_PAPER_ENABLED` | `true` sends paper orders to Alpaca paper API (local account still mirrors fills) |
| `ALLOW_LIVE_TRADING` | Must stay `false` unless you intentionally enable live Alpaca (`ALPACA_TRADING_BASE_URL=https://api.alpaca.markets`) |
| `CONGRESS_API_KEY` | **Required for arbitrary `/bill/H.R.xxxx-119` briefs** — without it only curated seed bills load |
| `SENATE_LDA_API_KEY` | Live lobbying overlays on bill briefs |
| `RESEND_API_KEY` | Dispatch welcome emails + founder signup alerts (resend.com) |
| `DISPATCH_NOTIFY_EMAIL` | Founder inbox notified on each waitlist signup (requires `RESEND_API_KEY`) |
| `ANTHROPIC_API_KEY` | Optional Haiku plain-English synthesis on bill/contract share pages (cached; not used on landing rotation) |
| `ADMIN_SECRET` | Protects `/api/admin/waitlist` via `x-admin-secret` header |

Demo sessions (`demo-*` user IDs) always use local JSON files — they never write to Supabase.
