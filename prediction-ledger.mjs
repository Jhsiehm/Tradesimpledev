/**
 * TradeSimple — Prediction Ledger
 * ────────────────────────────────────────────────────────────────────────────
 * The moat. Every signal TradeSimple surfaces becomes a falsifiable, timestamped
 * prediction. When its horizon elapses, it is scored against the REAL market move
 * — measured as excess return vs a benchmark (alpha), not raw price drift.
 *
 * Why this is defensible:
 *   1. APPEND-ONLY + HASH-CHAINED. Each event hashes the previous one (like a
 *      mini-blockchain). You cannot silently delete, reorder, or backdate a bad
 *      call without breaking the chain — and anyone can verify it. A track record
 *      that is provably un-cherry-picked is worth infinitely more than a marketing
 *      "we're usually right."
 *   2. CALIBRATION-SCORED. We don't just track "were we right" — we track whether
 *      our confidence is honest (Brier score + reliability curve). A 90%-confident
 *      miss is punished harder than a 55%-confident miss.
 *   3. ALPHA, NOT BETA. A defense stock rising 2% while the market rises 2% is not
 *      signal. We score excess return vs SPY, so only genuine policy edge counts.
 *   4. COMPOUNDS WITH TIME. A competitor starting today cannot backfill two years
 *      of verified, outcome-tracked calls. The ledger is the asset.
 *
 * Storage: append-only JSONL at data/predictions.jsonl (canonical, hash-chained),
 * with an optional best-effort mirror to Supabase when configured.
 */

import { createHash } from "node:crypto";
import { appendFile, readFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dbReady, dbInsert } from "./src/lib/supabase.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(ROOT, "data");
const LEDGER_FILE = process.env.PREDICTIONS_FILE || join(DATA_DIR, "predictions.jsonl");

export const METHODOLOGY_VERSION = "ledger-1.0";
export const BENCHMARK_SYMBOL = "SPY";

/** Excess-return dead-band (%). Moves smaller than this vs benchmark = noise/neutral. */
const DEADBAND_PCT = 1.0;
const GENESIS_HASH = "GENESIS";
const VALID_DIRECTIONS = new Set(["bullish", "bearish", "neutral"]);

// ── In-memory state (loaded once, kept hot) ─────────────────────────────────
let _events = null;        // full ordered event log
let _loadPromise = null;
let _writeChain = Promise.resolve(); // serializes appends so the hash chain stays consistent

// ── Canonical JSON (stable key order) so hashes are deterministic ────────────
function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

function hashEvent(prevHash, eventWithoutHash) {
  return createHash("sha256")
    .update(prevHash + canonicalize(eventWithoutHash))
    .digest("hex");
}

function shortId(prefix) {
  return `${prefix}_${createHash("sha256")
    .update(`${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 12)}`;
}

// ── Load ────────────────────────────────────────────────────────────────────
async function ensureLoaded() {
  if (_events) return _events;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    let raw = "";
    try {
      raw = await readFile(LEDGER_FILE, "utf8");
    } catch {
      raw = "";
    }
    const events = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {
        /* skip corrupt line — integrity check will flag the gap */
      }
    }
    _events = events;
    return _events;
  })();
  return _loadPromise;
}

function tailHash(events) {
  return events.length ? events[events.length - 1].hash : GENESIS_HASH;
}

/** Append one event to the hash chain. Serialized via _writeChain. */
function appendEvent(partial) {
  _writeChain = _writeChain.then(async () => {
    const events = await ensureLoaded();
    const prevHash = tailHash(events);
    const seq = events.length;
    const base = { ...partial, seq, prevHash };
    const hash = hashEvent(prevHash, base);
    const event = { ...base, hash };

    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(LEDGER_FILE, JSON.stringify(event) + "\n", "utf8");
    events.push(event);

    // Best-effort durability mirror — never blocks or breaks the canonical chain.
    if (dbReady) {
      dbInsert("prediction_events", {
        event_id: event.id,
        seq: event.seq,
        type: event.type,
        ticker: event.ticker || null,
        payload: event,
        hash: event.hash,
        prev_hash: event.prevHash,
        created_at: event.createdAt || event.resolvedAt || new Date().toISOString()
      }).catch(() => {});
    }
    return event;
  });
  return _writeChain;
}

// ── Range parsing helper (e.g. "+15 to +30%" → 22.5) ────────────────────────
function parseRangeMidpoint(str) {
  if (!str) return null;
  const nums = String(str).match(/-?\d+(\.\d+)?/g);
  if (!nums || !nums.length) return null;
  const vals = nums.map(Number).filter((n) => Number.isFinite(n));
  if (!vals.length) return null;
  const mid = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.abs(mid);
}

// ── Public: record a prediction ─────────────────────────────────────────────
/**
 * @param {object} input
 * @param {string} input.ticker
 * @param {"bullish"|"bearish"|"neutral"} input.direction
 * @param {number} [input.horizonDays=30]
 * @param {string} input.thesis  plain-English causal chain
 * @param {number} input.confidence  0..100
 * @param {object} [input.catalyst]  { type, id, title }
 * @param {string} [input.predictedRange]  e.g. "+15 to +30%"
 * @param {string} [input.origin]  "auto:top_signal" | "manual" | ...
 * @param {object} deps  { getQuote: async (symbol) => ({ price, source }) }
 */
export async function recordPrediction(input, deps) {
  const ticker = String(input.ticker || "").trim().toUpperCase();
  const direction = String(input.direction || "").toLowerCase();
  if (!ticker) throw new Error("ticker required");
  if (!VALID_DIRECTIONS.has(direction)) throw new Error(`invalid direction: ${direction}`);

  const horizonDays = Math.max(1, Math.min(365, Number(input.horizonDays) || 30));
  const confidence = Math.max(0, Math.min(100, Number(input.confidence) || 50));
  const now = Date.now();

  const getQuote = deps?.getQuote;
  if (typeof getQuote !== "function") throw new Error("deps.getQuote required");

  const [tickQuote, benchQuote] = await Promise.all([
    getQuote(ticker).catch(() => null),
    getQuote(BENCHMARK_SYMBOL).catch(() => null)
  ]);
  const entryPrice = Number(tickQuote?.price);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error(`no entry price for ${ticker}`);
  }

  const event = {
    type: "prediction",
    id: shortId("pred"),
    createdAt: new Date(now).toISOString(),
    ticker,
    benchmark: BENCHMARK_SYMBOL,
    direction,
    horizonDays,
    horizonEndsAt: new Date(now + horizonDays * 86400000).toISOString(),
    thesis: String(input.thesis || "").slice(0, 600),
    catalyst: input.catalyst
      ? {
          type: String(input.catalyst.type || "unknown"),
          id: input.catalyst.id != null ? String(input.catalyst.id) : null,
          title: String(input.catalyst.title || "").slice(0, 240)
        }
      : null,
    confidence,
    predictedMagnitudePct: parseRangeMidpoint(input.predictedRange),
    entry: {
      price: entryPrice,
      benchmarkPrice: Number.isFinite(Number(benchQuote?.price)) ? Number(benchQuote.price) : null,
      source: tickQuote?.source || "unknown",
      at: new Date(now).toISOString()
    },
    methodologyVersion: METHODOLOGY_VERSION,
    origin: String(input.origin || "manual")
  };

  // appendEvent attaches seq/prevHash/hash to a copy — return that canonical record.
  return await appendEvent(event);
}

// ── Scoring ─────────────────────────────────────────────────────────────────
export function scoreResolution(pred, exitPrice, exitBenchmarkPrice) {
  const entryP = pred.entry.price;
  const entryB = pred.entry.benchmarkPrice;
  const tickerReturnPct = ((exitPrice - entryP) / entryP) * 100;
  const benchmarkReturnPct =
    Number.isFinite(entryB) && Number.isFinite(exitBenchmarkPrice) && entryB > 0
      ? ((exitBenchmarkPrice - entryB) / entryB) * 100
      : 0;
  const excessReturnPct = tickerReturnPct - benchmarkReturnPct;

  const directionActual =
    excessReturnPct > DEADBAND_PCT ? "bullish"
    : excessReturnPct < -DEADBAND_PCT ? "bearish"
    : "neutral";

  const hit = pred.direction === directionActual;
  // Brier: forecast probability the call is correct = confidence; outcome = 1 if hit.
  const p = pred.confidence / 100;
  const outcome = hit ? 1 : 0;
  const brier = (p - outcome) ** 2;

  return {
    tickerReturnPct: round(tickerReturnPct, 3),
    benchmarkReturnPct: round(benchmarkReturnPct, 3),
    excessReturnPct: round(excessReturnPct, 3),
    directionActual,
    hit,
    brier: round(brier, 4)
  };
}

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ── Public: resolve all predictions whose horizon has elapsed ───────────────
/**
 * @param {object} deps { getQuote }
 * @returns {Promise<{ checked, resolved, errors }>}
 */
export async function resolveDuePredictions(deps) {
  const getQuote = deps?.getQuote;
  if (typeof getQuote !== "function") throw new Error("deps.getQuote required");

  const events = await ensureLoaded();
  const resolvedIds = new Set(
    events.filter((e) => e.type === "resolution").map((e) => e.id)
  );
  const now = Date.now();
  const due = events.filter(
    (e) =>
      e.type === "prediction" &&
      !resolvedIds.has(e.id) &&
      new Date(e.horizonEndsAt).getTime() <= now
  );

  let resolved = 0;
  let errors = 0;
  // Cache benchmark quote once per run.
  let benchPrice = null;
  try {
    benchPrice = Number((await getQuote(BENCHMARK_SYMBOL))?.price) || null;
  } catch {
    benchPrice = null;
  }

  for (const pred of due) {
    try {
      const exitQuote = await getQuote(pred.ticker);
      const exitPrice = Number(exitQuote?.price);
      if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
        errors++;
        continue;
      }
      const score = scoreResolution(pred, exitPrice, benchPrice);
      const horizonEndMs = new Date(pred.horizonEndsAt).getTime();
      await appendEvent({
        type: "resolution",
        id: pred.id,
        ticker: pred.ticker,
        resolvedAt: new Date().toISOString(),
        exit: {
          price: exitPrice,
          benchmarkPrice: benchPrice,
          source: exitQuote?.source || "unknown",
          at: new Date().toISOString()
        },
        resolutionLagMs: Date.now() - horizonEndMs,
        ...score
      });
      resolved++;
    } catch {
      errors++;
    }
  }
  return { checked: due.length, resolved, errors };
}

// ── Read model: fold events into current prediction states ──────────────────
function foldPredictions(events) {
  const byId = new Map();
  for (const e of events) {
    if (e.type === "prediction") {
      byId.set(e.id, { ...e, status: "open", resolution: null });
    } else if (e.type === "resolution") {
      const p = byId.get(e.id);
      if (p) {
        p.status = "resolved";
        p.resolution = e;
      }
    }
  }
  return Array.from(byId.values());
}

export async function listPredictions(filter = {}) {
  const events = await ensureLoaded();
  let preds = foldPredictions(events);
  if (filter.ticker) {
    const t = String(filter.ticker).toUpperCase();
    preds = preds.filter((p) => p.ticker === t);
  }
  if (filter.status) preds = preds.filter((p) => p.status === filter.status);
  if (filter.catalystType) {
    preds = preds.filter((p) => p.catalyst?.type === filter.catalystType);
  }
  preds.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (filter.limit) preds = preds.slice(0, Number(filter.limit));
  return preds;
}

// ── Scorecard: the public, brand-defining aggregate ─────────────────────────
export async function computeScorecard(filter = {}) {
  const preds = await listPredictions(filter);
  const resolved = preds.filter((p) => p.status === "resolved" && p.resolution);
  const open = preds.filter((p) => p.status === "open");
  const directional = resolved.filter((p) => p.direction !== "neutral");

  const hits = directional.filter((p) => p.resolution.hit);
  const hitRate = directional.length ? hits.length / directional.length : null;

  const meanBrier = resolved.length
    ? round(resolved.reduce((s, p) => s + p.resolution.brier, 0) / resolved.length, 4)
    : null;

  // Directional edge: average excess return signed in the predicted direction.
  // Positive = the calls carry genuine alpha; ~0 = no edge; negative = anti-signal.
  const edges = directional.map((p) =>
    p.direction === "bullish" ? p.resolution.excessReturnPct : -p.resolution.excessReturnPct
  );
  const directionalEdgePct = edges.length
    ? round(edges.reduce((a, b) => a + b, 0) / edges.length, 3)
    : null;

  const meanExcessOnHit = mean(hits.map((p) => Math.abs(p.resolution.excessReturnPct)));
  const meanExcessOnMiss = mean(
    directional.filter((p) => !p.resolution.hit).map((p) => Math.abs(p.resolution.excessReturnPct))
  );

  // Calibration / reliability curve.
  const buckets = [
    [50, 60], [60, 70], [70, 80], [80, 90], [90, 100.0001]
  ].map(([lo, hi]) => {
    const inB = directional.filter((p) => p.confidence >= lo && p.confidence < hi);
    const bHits = inB.filter((p) => p.resolution.hit).length;
    return {
      range: `${lo}-${hi >= 100 ? 100 : hi}`,
      midpoint: (lo + Math.min(hi, 100)) / 2,
      n: inB.length,
      predictedRate: round((lo + Math.min(hi, 100)) / 2 / 100, 3),
      actualRate: inB.length ? round(bHits / inB.length, 3) : null
    };
  });

  // Breakdown by catalyst type.
  const byCatalyst = {};
  for (const p of directional) {
    const key = p.catalyst?.type || "unknown";
    (byCatalyst[key] ||= { n: 0, hits: 0, edgeSum: 0 });
    byCatalyst[key].n++;
    if (p.resolution.hit) byCatalyst[key].hits++;
    byCatalyst[key].edgeSum +=
      p.direction === "bullish" ? p.resolution.excessReturnPct : -p.resolution.excessReturnPct;
  }
  for (const k of Object.keys(byCatalyst)) {
    const b = byCatalyst[k];
    b.hitRate = b.n ? round(b.hits / b.n, 3) : null;
    b.edgePct = b.n ? round(b.edgeSum / b.n, 3) : null;
    delete b.edgeSum;
  }

  const integrity = await verifyLedger();

  return {
    methodologyVersion: METHODOLOGY_VERSION,
    benchmark: BENCHMARK_SYMBOL,
    deadbandPct: DEADBAND_PCT,
    counts: {
      total: preds.length,
      open: open.length,
      resolved: resolved.length,
      directionalResolved: directional.length
    },
    hitRate: hitRate != null ? round(hitRate, 3) : null,
    directionalEdgePct,
    meanBrier,
    skillVsCoinflip: meanBrier != null ? round(0.25 - meanBrier, 4) : null, // >0 beats a coin flip
    meanExcessOnHitPct: meanExcessOnHit != null ? round(meanExcessOnHit, 3) : null,
    meanExcessOnMissPct: meanExcessOnMiss != null ? round(meanExcessOnMiss, 3) : null,
    calibration: buckets,
    byCatalyst,
    firstPredictionAt: preds.length ? preds[preds.length - 1].createdAt : null,
    lastResolvedAt: resolved.length ? resolved[0].resolution?.resolvedAt : null,
    integrity,
    generatedAt: new Date().toISOString()
  };
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

// ── Integrity: walk the hash chain, prove it is untampered ──────────────────
export async function verifyLedger() {
  const events = await ensureLoaded();
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const { hash, ...rest } = e;
    const expected = hashEvent(prevHash, rest);
    if (e.prevHash !== prevHash || e.hash !== expected || e.seq !== i) {
      return { ok: false, brokenAtSeq: i, brokenId: e.id || null, length: events.length };
    }
    prevHash = e.hash;
  }
  return { ok: true, length: events.length, headHash: prevHash };
}

/** Test hook — reset in-memory cache (so tests can reload from disk). */
export function _resetCacheForTest() {
  _events = null;
  _loadPromise = null;
  _writeChain = Promise.resolve();
}
