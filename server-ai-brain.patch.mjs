/**
 * TradeSimple — ai-brain integration reference
 *
 * Drop-in documentation for wiring ai-brain.mjs into server.mjs.
 * This file is not executed at runtime.
 */

// ── Imports (server.mjs) ─────────────────────────────────────────────────────
// import {
//   aiScorecardHandler,
//   aiEdgarHandler,
//   aiLobbyMapHandler,
//   aiChartLabelHandler,
//   fetchCompanyNews,
//   enrichSnapshotWithRecentNews,
//   runEdgarSimplifier
// } from "./ai-brain.mjs";

// ── Public AI routes (before /api/ auth guard) ───────────────────────────────
// POST /api/ai/scorecard   → aiScorecardHandler
// POST /api/ai/edgar       → aiEdgarHandler
// POST /api/ai/lobby-map   → aiLobbyMapHandler
// POST /api/ai/chart-label → aiChartLabelHandler
//
// Rate limiting is enforced inside each handler (default 20 req/min/IP).
// Env: AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS

// POST /api/ai/lobby-map
// Returns: {
//   matches: [...],
//   reason: "matched" | "no_match" | "api_error",
//   source: "anthropic" | "cache" | "fallback_error",
//   cached: boolean,
//   updatedAt: ISO string,
//   error?: string
// }

// ── runLobbyMapper() ─────────────────────────────────────────────────────────
// Returns an envelope, NOT a raw array. Call sites must use result.matches.

// ── Stock snapshots ──────────────────────────────────────────────────────────
// stockAnalysis() and any future /api/share/stock should call:
//   payload = await enrichSnapshotWithRecentNews(payload, symbol);
// Response includes payload.recentNews (Finnhub company-news, 10m cache).

// ── EDGAR public share ───────────────────────────────────────────────────────
// GET /api/share/edgar/:SYMBOL → buildEdgarSnapshot(symbol)
// Includes riskFactors + simplified (runEdgarSimplifier).

// ── Quote freshness ──────────────────────────────────────────────────────────
// Every quote from quoteSnapshot / marketQuotes includes:
//   fetchedAt, providerTimestamp, freshnessMs, isDelayed, source
// Env: QUOTE_CACHE_TTL_MS (default 15000 for launch; was 55000)

export const AI_BRAIN_PATCH_VERSION = 1;
