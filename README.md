# TradeSimple

**Read the record before the headline.**

TradeSimple is an open, verifiable attempt to answer one question: does the public record — votes, contracts, lobbying — actually move markets before the headline does, and can that claim survive being checked?

Every signal it surfaces becomes a timestamped, hash-chained prediction. Nothing can be quietly deleted, reordered, or backdated after the outcome is known. You don't have to trust our track record — you can verify it.

> **Status: research beta.** Not a brokerage, not investment advice, not a finished product. Paper trading only. See [Safety Boundary](#safety-boundary).

---

## Why this exists

Most "politician trading" tools show you portfolios after the fact — but the 45-day disclosure window means the trade is often already over by the time it's public. That's not a data problem, it's a timing problem.

TradeSimple starts one step earlier: **votes → contract awards → lobbying disclosures → exposed tickers**, sourced from Congress.gov, USASpending, and Senate LDA filings, with every claim timestamped and source-labeled.

## The ledger (the actual point)

This is the part that makes the claims checkable instead of just asserted:

- **Append-only, hash-chained** — every prediction event hashes the previous one. You can't silently edit history without breaking the chain, and anyone can verify it.
- **Calibration-scored** — we track not just "was it right" but whether stated confidence was honest (Brier score + reliability curve). A confident miss is punished harder than a hedged one.
- **Alpha, not beta** — scored against excess return vs. SPY, so a defense stock rising with the whole market doesn't count as signal.
- **Public and inspectable** — see [`/track-record`](#) for the live ledger.

Read the full methodology in [`prediction-ledger.mjs`](./prediction-ledger.mjs).

**Where it currently stands, honestly:** a calibrated composite score (CRS) validated on defense-IT contractors (Spearman ρ = 0.40, p = 0.0006) — but it does *not* generalize cleanly to other sectors tested so far (e.g. detention/corrections). That failure is logged in the ledger, not hidden from it. This is a hypothesis under public test, not a proven edge — treat it accordingly.

## What's in the repo

- Full-stack terminal: server-backed app, auth-gated dashboard, paper trading only (live trading gated off by default)
- Analysis Lab — plain-English fundamentals, policy impact chains, source-labeled signal explanations
- Prediction ledger — the falsifiable track record described above
- Public, shareable detail pages for stocks, bills, contracts, and lobbying filings (no login required)

## Quick start

```bash
git clone https://github.com/Jhsiehm/Tradesimpledev.git
cd Tradesimpledev
cp .env.example .env.local   # fill in the keys you want — see Configuration below
node server.mjs
```

Open `http://localhost:3000`. No npm dependencies required to run locally.

## Configuration

<details>
<summary>Environment variables and provider setup</summary>

| Variable | Purpose |
|----------|---------|
| `AUTH_SECRET` | Required in production — 32+ char random string |
| `FINNHUB_API_KEY` | Live equity quotes (primary provider) |
| `CONGRESS_API_KEY` | Live Congress.gov bill records |
| `SENATE_LDA_API_KEY` | Lobbying filings at the higher rate limit |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Durable ledger storage |
| `DATA_ACCURACY_MODE` | `demo` for soft launch, `production` for fully-sourced data |

Full variable list in [`.env.example`](./.env.example). Deployment notes (Railway, hybrid Finnhub/yfinance data stack) in [`docs/`](./docs).

</details>

## API routes

<details>
<summary>Public and session-gated endpoints</summary>

- `GET /api/market/quotes?symbols=SPY,NVDA`
- `GET /api/analysis/stock?symbol=NVDA`
- `GET /api/congress/bills?q=NVDA`
- `GET /api/lobbying`
- `GET /api/trading/account` · `POST /api/trading/orders` (paper only)
- `POST /api/research/ask`

All routes except `/api/config`, `/api/session`, and `/api/waitlist` require a signed session. Full list in [source](./server.mjs).

</details>

## Safety Boundary

TradeSimple is **not** a registered broker-dealer, investment adviser, or live trading product. It's a software foundation for research and paper trading. Signals are informational only — not financial advice. Before any real-money use, it would need broker onboarding, KYC/AML, order review and audit logs, and a data-license review it does not currently have.

## Contributing

Issues and PRs welcome — especially around sector generalization testing, additional data sources, or calibration methodology. See [`docs/`](./docs) for internal design notes.

---

*Built by [Joshua Metters](https://github.com/Jhsiehm) and Taekyong K.*
