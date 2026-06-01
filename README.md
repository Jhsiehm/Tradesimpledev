# TradeSimple Terminal

TradeSimple is a **research beta** — a runnable full-stack policy-and-markets terminal (not a brokerage). It ships as a server-backed app with:

- Product landing page
- Google, Apple, and local demo sign-in routes
- Signed HTTP-only session cookies
- Auth-gated dashboard
- Server-side market, crypto, Congress.gov, Senate LDA, Alpaca, and optional AI routes
- Analysis Lab with plain-English fundamentals, lightweight charts, policy impact chains, and API signal explanations
- Paper/simulated order entry with live trading blocked unless explicitly enabled

## Run

```bash
node server.mjs
```

Open `http://localhost:3000`.

This project intentionally has no npm dependencies because the current workspace runtime exposes `node` but not `npm`/`pnpm`.

### Public detail pages (shareable, no login)

| Route | API |
|-------|-----|
| `/stock/NVDA` | `GET /api/share/stock?symbol=NVDA` |
| `/bill/S.1836-119` | `GET /api/share/bill?billId=...` |
| `/contract/LMT` | `GET /api/share/contract?symbol=LMT` |
| `/lobby/{filingId}` | `GET /api/share/lobby?filingId=...` |

The dashboard links to these from Bills, Contracts, Lobbying, and the Thesis Lab signal map. Thesis map node positions can be dragged in **Edit layout** mode (saved per ticker in `localStorage`).

## Configure

Copy `.env.example` to `.env.local` and fill in the keys you want:

```bash
cp .env.example .env.local
```

Important redirect URIs:

- Google: `http://localhost:3000/auth/callback/google`
- Apple: `http://localhost:3000/auth/callback/apple`

Provider notes:

- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` enable Google sign-in.
- `APPLE_CLIENT_ID` and `APPLE_CLIENT_SECRET` enable Apple sign-in. Apple's client secret is a JWT generated from your Apple developer team/key.
- `FINNHUB_API_KEY` enables live equity quote snapshots (primary provider).
- Optional **yfinance sidecar** for quotes and history when Finnhub fails or is unset (see below).
- `COINGECKO_API_KEY` enables crypto pricing; set `COINGECKO_PRO=true` for the Pro API hostname.
- `CONGRESS_API_KEY` enables live Congress.gov bill records.
- `SENATE_LDA_API_KEY` enables authenticated LDA.gov lobbying filings at the higher registered-user rate limit.
- Alpaca defaults to `https://paper-api.alpaca.markets`. Live trading requires both a live endpoint and `ALLOW_LIVE_TRADING=true`.

### Live + accurate production mode

Set `DATA_ACCURACY_MODE=production` in `.env.local` (see `.env.example`). In this mode:

- Bill status and sponsors come from **Congress.gov** (no fictional action dates on linked bills).
- Lobbying dollars on bill cards come from **Senate LDA** matched filings only (seed lobbying $ removed).
- Historical analogs use **verified fact packs** with source links (`src/data/verifiedHistoricalFacts.mjs`).
- Pass/fail % impact ranges stay **scenario models** (labeled, not forecasts).
- `/api/health/data` reports feed readiness; the dashboard shows a source freshness bar.

Start locally:

```bash
./scripts/start-production.sh
```

Open `http://localhost:3010/dashboard` (stop any existing server on that port first). Check health: `GET /api/health/data` (requires session cookie after `/auth/demo`).

## Market data: Finnhub vs yfinance (hybrid)

TradeSimple uses a **hybrid** stack:

| Provider | Role | Best for |
|----------|------|----------|
| **Finnhub** | Primary when `FINNHUB_API_KEY` is set | Licensed/delayed live quotes and candles with a stable API key |
| **yfinance** (Python) | Fallback and enrichment via `scripts/yf_bridge.py` | Free history and quotes without an API key; fundamentals-friendly Yahoo data |
| **Yahoo chart HTTP** | Last resort before Stooq/modeled data | Same underlying Yahoo source, no Python install |

**Opinion:** Finnhub is the better choice for **production live quotes** (clearer licensing, consistent API). yfinance is the better choice for **local dev and free history** when you do not want another API key or Finnhub is rate-limited.

### Enable the yfinance sidecar

```bash
cd "/Users/joshuaugyenlhundruphsiehmetters/Documents/TradeSimple v1"
python3 -m venv .venv-yfinance
source .venv-yfinance/bin/activate
pip install -r scripts/requirements-yfinance.txt
# Recommended if you have the local clone:
pip install -e "/Users/joshuaugyenlhundruphsiehmetters/Downloads/yfinance-main"
```

In `.env.local`:

```bash
YFINANCE_ENABLED=true
YFINANCE_VENV=/Users/joshuaugyenlhundruphsiehmetters/Documents/TradeSimple v1/.venv-yfinance
```

Smoke-test the bridge:

```bash
python3 scripts/yf_bridge.py quote NVDA
python3 scripts/yf_bridge.py history NVDA 6m
```

Then run `node server.mjs` — quotes/history will tag `source: "yfinance"` when the bridge succeeds.

Set `YFINANCE_ENABLED=false` to skip Python entirely. Missing Python or yfinance never crashes the Node server.

## Safety Boundary

This is not a registered broker-dealer, investment adviser, or live trading product. It is a software foundation for research and paper trading. Before real-money trading, add:

- Broker onboarding or OAuth through a regulated broker
- KYC/AML and suitability flow where legally required
- Order review, risk checks, and audit logs
- Terms, disclosures, and data-provider license review
- Persistent database-backed accounts and encrypted user secrets
- Rate limiting, monitoring, and incident response

## API Routes

- `GET /api/config`
- `GET /api/session`
- `POST /api/waitlist`
- `GET /api/market/quotes?symbols=SPY,NVDA`
- `GET /api/analysis/stock?symbol=NVDA`
- `GET /api/crypto?ids=bitcoin,ethereum`
- `GET /api/congress/bills?q=NVDA`
- `GET /api/lobbying`
- `GET /api/trading/account`
- `POST /api/trading/orders`
- `POST /api/research/ask`

All routes except `/api/config`, `/api/session`, and `/api/waitlist` require a signed session.

Waitlist submissions are appended to `data/waitlist.jsonl`, which is ignored by git.

## Product Prompt

The design and explanation rules for future dashboard extensions live in `docs/analysis-ui-prompt.md`.
