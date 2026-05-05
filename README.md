# TradeSimple Terminal

TradeSimple is a runnable full-stack prototype for a Bloomberg-style trading research terminal. It converts the pasted HTML idea into a server-backed app with:

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
- `FINNHUB_API_KEY` enables live equity quote snapshots.
- `COINGECKO_API_KEY` enables crypto pricing; set `COINGECKO_PRO=true` for the Pro API hostname.
- `CONGRESS_API_KEY` enables live Congress.gov bill records.
- `SENATE_LDA_API_KEY` enables authenticated LDA.gov lobbying filings at the higher registered-user rate limit.
- Alpaca defaults to `https://paper-api.alpaca.markets`. Live trading requires both a live endpoint and `ALLOW_LIVE_TRADING=true`.

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
