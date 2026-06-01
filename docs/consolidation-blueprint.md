# TradeSimple Consolidation Blueprint

## Goal

Consolidate the strongest TradeSimple variants into one product without losing the working v1 backend. TradeSimple v1 stays the canonical runtime because it already owns auth, signed sessions, data providers, paper trading, research routes, production data mode, public share cards, and the no-dependency Node deployment path.

## Source Inventory

### Canonical Backend: `Documents/TradeSimple v1`

Strengths to preserve:

- Server-backed auth: demo, Google, Apple, signed HTTP-only session cookies.
- Data routes: market quotes/history, crypto, Congress.gov, Senate LDA, contracts, agency budgets, appointments, EDGAR, social pulse, AI research.
- Trading guardrails: paper account and paper orders, with live trading blocked unless explicitly enabled.
- Thesis system: thesis creation, upgrade preview, signal monitors, outcomes, and relationship maps.
- Source trust: production data mode, source freshness, data health route, provenance helpers, public detail cards.
- Operational simplicity: runnable with `node server.mjs` and no npm install.

### Earlier Documents v2 Folder: `Documents/ Trade Simple v2`

Strengths already mostly absorbed by v1:

- Smaller prototype surface that proved the full-stack static dashboard model.
- Simpler mental model for the original API set.

Use v2 only as a reference for simpler flows or copy if v1 becomes too dense.

### Manus React Prototype: `Downloads/tradesimple (1).zip`

Strengths to selectively transplant:

- Stronger visual identity: fixed classification bars, acid-green terminal shell, ticker intelligence cards, signal dossier presentation, crisp dark theme.
- Clear page boundaries: dashboard, signals, tickers, ticker detail, thesis lab, settings.
- Better ticker-detail interaction ideas: comparison overlay, percent/raw chart mode, event-linked tooltip.
- Reusable component thinking: layout, card, badge, feed item, route-level screens.

Known weaknesses to avoid carrying over:

- Mock localStorage database.
- Missing login page.
- Claims of live/AI behavior where the implementation is simulated.

## Architecture Decision

Use v1 as the host app and API authority. Do not manually reimplement v1 behavior in the React prototype.

Preferred path:

1. Add bridge endpoints to v1 that expose UI-ready payloads.
2. Replace v1 dashboard sections incrementally with upgraded static components, or mount a React build later if the dependency tradeoff is worth it.
3. Keep `/dashboard` working throughout.
4. Move one workflow at a time: overview, analysis/ticker detail, signals, thesis, paper trading, settings.

## Integration Boundaries

### Backend Is Source Of Truth

Do not duplicate these in a client-only mock layer:

- Sessions and user identity.
- Portfolio/watchlist persistence.
- Paper order validation and fills.
- Quote/history provider selection.
- Congress/LDA/contract provenance.
- Thesis creation, monitors, and outcomes.
- AI research calls and rate limits.

### UI Can Be Reworked Freely

Safe areas for design consolidation:

- Card layouts.
- Navigation density.
- Ticker/signal visual hierarchy.
- Copy labels and empty states.
- Source freshness display.
- Explanation drawers.
- Chart controls and comparison UI.

## Phased Plan

### Phase 0: Landing Rehaul

- Keep v1 as the runtime and apply the Manus identity to the static landing page.
- Bring over the terminal classification language, CRS tiers, proof/status strips, cinematic archive wall, user-triggered soundtrack, and sharper source-backed product copy.
- Adopt the `tradesimple (2)` editorial font stack on the landing page: Cormorant Garamond for manifesto/headlines and Space Mono for terminal labels.
- Avoid copying the mock localStorage database or unsupported claims.

### Phase 1: Bridge And Map

- Add `/api/ui/bootstrap` in v1 with dashboard config, paper account snapshot, recent thesis summaries, and integration metadata.
- Document route mapping from React pages to v1 APIs.
- Keep v1 dashboard unchanged.

### Phase 2: Overview Upgrade

- Apply the React prototype's terminal-card language to v1 overview.
- Preserve existing `public/app.js` data flows.
- Keep source freshness, paper mode, and not-financial-advice labels visible.

### Phase 3: Ticker Detail / Analysis Lab

- Bring over the React ticker detail strengths:
  - Raw price vs percent-performance chart mode.
  - Compare ticker overlay.
  - Event-linked chart markers.
  - Stronger signal dossier panel.
- Use existing `/api/analysis/stock`, `/api/market/history`, `/api/relationship-map`, and `/api/share/stock`.

### Phase 4: Signals And Policy Intelligence

- Consolidate bills, lobbying, contracts, and signal feed into one consistent intelligence language.
- Every signal should show source, date, confidence, affected tickers, mechanism, and uncertainty.

### Phase 5: Thesis And Paper Trading

- Preserve v1 thesis persistence and paper order route.
- Add a clearer order preview and thesis-linked paper trade guardrail.
- Make quote fallback status impossible to miss before paper order entry.

### Phase 6: Optional React Mount

Only after the API and static UI are stable, decide whether to add a React build:

- If yes: host React under `/app` or replace `/dashboard` after parity.
- If no: keep v1 no-dependency static frontend and transplant design ideas manually.

## Route Mapping

| Product Surface | v1 API |
| --- | --- |
| Session | `GET /api/session` |
| UI bootstrap | `GET /api/ui/bootstrap` |
| Dashboard config | `GET /api/dashboard/bootstrap` |
| Source freshness | `GET /api/health/data` |
| Quotes | `GET /api/market/quotes?symbols=SPY,NVDA` |
| History | `GET /api/market/history?symbol=NVDA` |
| Analysis Lab | `GET /api/analysis/stock?symbol=NVDA` |
| Policy network | `GET /api/policy/network` |
| Bills | `GET /api/congress/bills?q=NVDA` |
| Lobbying | `GET /api/lobbying` |
| Contracts | `GET /api/contracts/{symbol}` |
| Relationship map | `GET /api/relationship-map?symbol=NVDA` |
| Paper account | `GET /api/trading/account` |
| Paper order | `POST /api/trading/orders` |
| Theses | `GET /api/theses`, `POST /api/theses` |
| Thesis signals | `GET /api/thesis/signals?symbol=NVDA` |
| AI research | `POST /api/research/ask` |

## First Safety Rules

- Never remove the v1 dashboard until the replacement has feature parity.
- Never expose API keys to the browser.
- Label fallback/model/demo data clearly.
- Keep live trading locked by default.
- Prefer additive bridge routes before invasive rewrites.
