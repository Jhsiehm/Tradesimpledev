import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  recordPrediction,
  listPredictions,
  computeScorecard,
  verifyLedger
} from "../../prediction-ledger.mjs";

/** Injected at boot from server.mjs via registerPredictionsApi(deps). */
let deps = {};

export function registerPredictionsApi(next = {}) {
  deps = { ...deps, ...next };
}

// ── Prediction ledger ────────────────────────────────────────────────────────
// Shared dependency: a quote getter the ledger uses for entry/exit prices.
const ledgerDeps = {
  getQuote: async (symbol) => {
    const { quote } = await deps.quoteSnapshot(symbol);
    return quote ? { price: quote.price, source: quote.source } : null;
  }
};

async function predictionScorecardHandler(res, url) {
  try {
    const filter = {};
    const t = url.searchParams.get("ticker");
    const c = url.searchParams.get("catalystType");
    if (t) filter.ticker = t;
    if (c) filter.catalystType = c;
    const scorecard = await computeScorecard(filter);
    return deps.sendJson(res, 200, scorecard);
  } catch (err) {
    return deps.sendJson(res, 500, { error: "scorecard_failed", detail: err.message });
  }
}

async function predictionVerifyHandler(res) {
  try {
    return deps.sendJson(res, 200, await verifyLedger());
  } catch (err) {
    return deps.sendJson(res, 500, { error: "verify_failed", detail: err.message });
  }
}

async function predictionListHandler(res, url) {
  try {
    const filter = { limit: Math.min(200, Number(url.searchParams.get("limit")) || 50) };
    const t = url.searchParams.get("ticker");
    const s = url.searchParams.get("status");
    if (t) filter.ticker = t;
    if (s) filter.status = s;
    const predictions = await listPredictions(filter);
    return deps.sendJson(res, 200, { predictions, count: predictions.length });
  } catch (err) {
    return deps.sendJson(res, 500, { error: "list_failed", detail: err.message });
  }
}

async function predictionRecordHandler(req, res, session) {
  // Manual recording is gated to admins (or any authed user if no ADMIN_SECRET set).
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret && req.headers["x-admin-secret"] !== adminSecret) {
    return deps.sendJson(res, 403, { error: "forbidden" });
  }
  try {
    const body = await deps.readJson(req);
    const event = await recordPrediction(
      {
        ticker: body.ticker,
        direction: body.direction,
        horizonDays: body.horizonDays,
        thesis: body.thesis,
        confidence: body.confidence,
        catalyst: body.catalyst,
        predictedRange: body.predictedRange,
        origin: body.origin || `manual:${session?.user?.id || "anon"}`
      },
      ledgerDeps
    );
    return deps.sendJson(res, 200, { ok: true, prediction: event });
  } catch (err) {
    return deps.sendJson(res, 400, { error: "record_failed", detail: err.message });
  }
}

/**
 * Auto-populate the ledger from the product's own highest-conviction signals.
 * For each live bill with a clear directional impact on a ticker, record a
 * 30-day prediction — deduped so we never double-log the same open call.
 * This is what makes the track record grow on its own from real usage.
 */
async function autoRecordSignalPredictions() {
  try {
    const open = await listPredictions({ status: "open" });
    const openKeys = new Set(
      open.map((p) => `${p.catalyst?.id || ""}:${p.ticker}:${p.direction}`)
    );

    const live = deps.POLICY_BILLS.filter(
      (b) => !b.scenarioOnly && Array.isArray(b.passImpacts) && b.passImpacts.length
    );
    // Rank by legislative momentum; only auto-log the strongest signals.
    const ranked = live
      .map((b) => ({ bill: b, momentum: deps.computeLegislativeMomentum(b) }))
      .sort((a, b) => b.momentum - a.momentum)
      .slice(0, 8);

    let recorded = 0;
    for (const { bill, momentum } of ranked) {
      // Only log meaningfully-moving bills (avoid noise from dormant ones).
      if (momentum < 45) continue;
      const top = bill.passImpacts[0];
      // Seed shape: { sym, dir (1|-1), range, why }
      if (!top?.sym || !top?.dir) continue;
      const direction = top.dir > 0 ? "bullish" : top.dir < 0 ? "bearish" : "neutral";
      if (direction === "neutral") continue;

      const symbol = String(top.sym).toUpperCase();
      const key = `${bill.id}:${symbol}:${direction}`;
      if (openKeys.has(key)) continue;

      try {
        await recordPrediction(
          {
            ticker: symbol,
            direction,
            horizonDays: 30,
            confidence: momentum,
            predictedRange: top.range,
            thesis:
              bill.signal ||
              `${bill.shortTitle || bill.title}: ${top.why || "policy catalyst"} → ${symbol}`,
            catalyst: {
              type: "bill_stage",
              id: bill.id,
              title: bill.shortTitle || bill.title
            },
            origin: "auto:legis_signal"
          },
          ledgerDeps
        );
        recorded++;
      } catch {
        /* skip tickers we can't price right now */
      }
    }
    if (recorded) console.log(`[ledger] auto-recorded ${recorded} new prediction(s)`);
  } catch (err) {
    console.warn("[ledger] auto-record failed:", err.message);
  }
}

export {
  predictionScorecardHandler,
  predictionVerifyHandler,
  predictionListHandler,
  predictionRecordHandler,
  autoRecordSignalPredictions
};
