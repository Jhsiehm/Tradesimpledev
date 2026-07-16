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
import { dbReady, dbInsert, dbSelect } from "./src/lib/supabase.mjs";

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
// Local disk (data/predictions.jsonl) is NOT durable on Railway — there is no
// persistent volume configured, so every redeploy/restart gets a fresh
// filesystem. Supabase's prediction_events table (when configured) is the
// canonical store: paginated in full on boot, ordered by seq, and every
// append is written there BEFORE it's considered committed. Local disk stays
// as a redundant cache/fallback so the app still works (in ephemeral mode)
// when Supabase isn't configured, but it is never the durability guarantee
// when Supabase is available.
const SUPABASE_PAGE_SIZE = 1000;

async function loadEventsFromSupabase() {
  const rows = [];
  let offset = 0;
  for (;;) {
    const page = await dbSelect(
      "prediction_events",
      `select=payload&order=seq.asc&limit=${SUPABASE_PAGE_SIZE}&offset=${offset}`
    );
    if (page === null) return null; // query failed — caller falls back to disk
    if (!page.length) break;
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }
  return rows.map((r) => r.payload).filter(Boolean);
}

async function loadEventsFromDisk() {
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
  return events;
}

async function ensureLoaded() {
  if (_events) return _events;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    if (dbReady) {
      try {
        const fromDb = await loadEventsFromSupabase();
        if (fromDb) {
          _events = fromDb;
          console.log(`[ledger] loaded ${_events.length} event(s) from Supabase (durable)`);
          return _events;
        }
        console.warn("[ledger] Supabase query failed at boot — falling back to local disk (EPHEMERAL until Supabase recovers)");
      } catch (err) {
        console.warn("[ledger] Supabase load failed at boot — falling back to local disk (EPHEMERAL until Supabase recovers):", err.message);
      }
    }
    _events = await loadEventsFromDisk();
    if (dbReady) {
      console.warn(`[ledger] loaded ${_events.length} event(s) from local disk (Supabase configured but unreachable at boot — durability degraded until it recovers)`);
    } else {
      console.warn(`[ledger] loaded ${_events.length} event(s) from local disk (EPHEMERAL — configure SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY so the ledger survives redeploys)`);
    }
    return _events;
  })();
  return _loadPromise;
}

function tailHash(events) {
  return events.length ? events[events.length - 1].hash : GENESIS_HASH;
}

/**
 * Append one event to the hash chain. Serialized via _writeChain so
 * concurrent appends don't race on seq/prevHash.
 *
 * A failed attempt (e.g. a transient Supabase error) must not permanently
 * wedge future appends: chaining .then() onto a rejected promise skips the
 * handler forever, so without the .catch(() => {}) below, one failed write
 * would silently block every prediction from ever being recorded again for
 * the rest of the process's life. _writeChain is kept always-resolved for
 * sequencing purposes; the real success/failure of *this* call is what gets
 * returned to its caller.
 */
function appendEvent(partial) {
  const attempt = _writeChain.then(async () => {
    const events = await ensureLoaded();
    const prevHash = tailHash(events);
    const seq = events.length;
    const base = { ...partial, seq, prevHash };
    const hash = hashEvent(prevHash, base);
    const event = { ...base, hash };

    // Supabase is the durability guarantee when configured — this write must
    // succeed before the event is considered committed. Without this await,
    // a restart landing between "wrote locally" and "mirrored to Supabase"
    // loses the event on the next boot, and the next auto-record pass
    // re-records it — that race is exactly what produced the duplicate
    // LDOS/DHS entry this fix closes.
    if (dbReady) {
      const inserted = await dbInsert("prediction_events", {
        event_id: event.id,
        seq: event.seq,
        type: event.type,
        ticker: event.ticker || null,
        payload: event,
        hash: event.hash,
        prev_hash: event.prevHash,
        created_at: event.createdAt || event.resolvedAt || event.voidedAt || new Date().toISOString()
      });
      if (!inserted) {
        throw new Error("Supabase write failed — refusing to commit a ledger event without durable storage");
      }
    }

    // Local disk stays as a redundant cache. Best-effort once Supabase is
    // canonical (a disk hiccup shouldn't block a durably-committed event),
    // but still mandatory when Supabase isn't configured at all.
    try {
      await mkdir(DATA_DIR, { recursive: true });
      await appendFile(LEDGER_FILE, JSON.stringify(event) + "\n", "utf8");
    } catch (err) {
      if (!dbReady) throw err;
      console.warn("[ledger] local disk mirror write failed (non-fatal — Supabase already has this event):", err.message);
    }

    events.push(event);
    return event;
  });
  // Always-resolved sequencing token for the *next* appendEvent call — must
  // not carry this attempt's rejection forward (see comment above).
  _writeChain = attempt.catch(() => {});
  return attempt;
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

// A catalyst's awardUrl gets rendered as a real, clickable link on the
// public track record — never trust it just because a caller (including the
// admin-only manual-record endpoint) supplied one. Only accept a direct
// usaspending.gov URL; anything else (including a javascript: scheme, which
// escapeHtml() alone would not stop in an href attribute) is dropped.
function sanitizeAwardUrl(value) {
  const raw = String(value || "").trim();
  return /^https:\/\/(www\.)?usaspending\.gov\//.test(raw) ? raw.slice(0, 500) : null;
}

function buildCatalyst(catalyst) {
  const amount = Number(catalyst.amount);
  return {
    type: String(catalyst.type || "unknown"),
    id: catalyst.id != null ? String(catalyst.id) : null,
    title: String(catalyst.title || "").slice(0, 240),
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    awardUrl: sanitizeAwardUrl(catalyst.awardUrl),
    contractType: catalyst.contractType ? String(catalyst.contractType).slice(0, 120) : null
  };
}

// ── Public: record a prediction ─────────────────────────────────────────────
/**
 * @param {object} input
 * @param {string} input.ticker
 * @param {"bullish"|"bearish"|"neutral"} input.direction
 * @param {number} [input.horizonDays=30]
 * @param {string} input.thesis  plain-English causal chain
 * @param {number} input.confidence  0..100
 * @param {object} [input.catalyst]  { type, id, title, amount, awardUrl, contractType }
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
    catalyst: input.catalyst ? buildCatalyst(input.catalyst) : null,
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
      byId.set(e.id, { ...e, status: "open", resolution: null, voided: false, voidReason: null, voidedAt: null });
    } else if (e.type === "resolution") {
      const p = byId.get(e.id);
      if (p) {
        p.status = "resolved";
        p.resolution = e;
      }
    } else if (e.type === "void") {
      const p = byId.get(e.id);
      if (p) {
        p.voided = true;
        p.voidReason = e.reason || null;
        p.voidedAt = e.voidedAt || null;
      }
    }
  }
  return Array.from(byId.values());
}

export async function listPredictions(filter = {}) {
  const events = await ensureLoaded();
  let preds = foldPredictions(events);
  // Voided entries stay in the hash chain forever (that's the point — they
  // can't be silently deleted) but are excluded from every normal read by
  // default, since the whole reason to void something is that it should
  // stop counting toward the public track record. Pass includeVoided:true
  // to see them (e.g. an admin audit view).
  if (!filter.includeVoided) preds = preds.filter((p) => !p.voided);
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

// ── Public: void a prediction (does NOT delete — appends a chained "void"
// event with a mandatory reason). Used to exclude entries that should never
// have been recorded (e.g. an unvalidated ticker slipping through a gating
// bug) from the public track record, without breaking the append-only
// tamper-evidence guarantee: the original mis-scoped prediction event stays
// in the chain forever, verifiable by anyone, alongside the void event and
// its documented reason. ──────────────────────────────────────────────────
export async function voidPrediction(id, reason) {
  const predId = String(id || "").trim();
  if (!predId) throw new Error("id required");
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) throw new Error("reason required");

  const events = await ensureLoaded();
  const pred = events.find((e) => e.type === "prediction" && e.id === predId);
  if (!pred) throw new Error(`no prediction with id ${predId}`);
  if (events.some((e) => e.type === "void" && e.id === predId)) {
    throw new Error(`prediction ${predId} is already voided`);
  }

  return appendEvent({
    type: "void",
    id: predId,
    ticker: pred.ticker,
    reason: cleanReason.slice(0, 600),
    voidedAt: new Date().toISOString()
  });
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
