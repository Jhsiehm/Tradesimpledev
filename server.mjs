/**
 * TradeSimple v1 — local smoke (PORT=3010, DEMO_AUTH=true):
 *   curl -sS "http://localhost:3010/api/session"
 *   curl -sS "http://localhost:3010/api/thesis/signals?symbol=NVDA&thesisText=Blackwell%20GPU%20ramp&direction=bull"
 *   curl -sS -X POST "http://localhost:3010/api/funds" -H "Content-Type: application/json" -d '{"name":"Test","tag":"custom","symbols":["NVDA","AMD"]}'
 *   curl -sS "http://localhost:3010/api/dashboard/bootstrap"
 *   curl -sS "http://localhost:3010/api/relationship-map?symbol=NVDA"
 *   curl -sS "http://localhost:3010/api/share/stock?symbol=NVDA"
 *   node --check server.mjs public/app.js ai-brain.mjs public/charts.js social-pulse.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, readFileSync, existsSync } from "node:fs";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHmac,
  createPublicKey,
  createVerify,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import {
  dbReady,
  dbSelect,
  dbUpsert,
  dbInsert,
  dbPatch,
  fetchPortfolioRow,
  savePortfolioRow,
  fetchWatchlistRow,
  saveWatchlistRow
} from "./src/lib/supabase.mjs";
import {
  aiScorecardHandler,
  aiEdgarHandler,
  aiLobbyMapHandler,
  aiChartLabelHandler,
  aiThesisHandler,
  runThesisAnalyzer,
  enrichSnapshotWithRecentNews,
  fetchBillRelatedHeadlines,
  fetchCompanyNews,
  runScorecardNarrator,
  runEdgarSimplifier,
  runCausalityAnalyzer,
  runShareBriefSummary,
  inferBillMarketExposureAI,
  inferLiveBillWhyMarketsCareAI
} from "./ai-brain.mjs";
import { getSocialPulse } from "./social-pulse.mjs";
import {
  recordPrediction,
  resolveDuePredictions,
  listPredictions,
  computeScorecard,
  verifyLedger
} from "./prediction-ledger.mjs";
import { normalizeThesis } from "./src/core/normalizeThesis.mjs";
import { buildMarketThesisContext } from "./src/core/marketThesisContext.mjs";
import { billFieldMap, buildDataMode, provenanceEnvelope } from "./src/core/dataProvenance.mjs";
import {
  initializePolicyBills,
  remapLinkedBillIds,
  remapStakeholderKeys,
  parseBillIdToCongressRef,
  congressRefToBillId,
  resolveBillIdCanonical
} from "./src/core/policySeedRegistry.mjs";
import {
  buildBillLegislativeContext,
  parseCongressCommitteesResponse
} from "./src/core/billLegislativeContext.mjs";
import { validatePolicySeeds } from "./src/core/validatePolicySeeds.mjs";
import {
  initDataRefresh,
  noteFeedSuccess,
  noteFeedError,
  startBackgroundRefresh,
  buildHealthPayload,
  readCongressCache,
  writeCongressCache
} from "./src/core/dataRefreshState.mjs";
import { aggregateLobbyingForBills, fetchLdaFilings } from "./src/core/ldaLobbying.mjs";
import { isStrictDataMode, productionReadiness } from "./src/core/productionDataMode.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const DATA_DIR = join(ROOT, "data");
const WAITLIST_FILE = join(DATA_DIR, "waitlist.jsonl");
const TRENDING_TOPICS_FILE = join(DATA_DIR, "trending-topics.json");
const CONTRACT_WATCH_FILE = join(DATA_DIR, "contract-watch.json");
const CONTRACT_WATCH_POLL_MS = Number(process.env.CONTRACT_WATCH_POLL_MS || 30 * 60 * 1000);
const CONTRACT_WATCH_API_CACHE_MS = Number(process.env.CONTRACT_WATCH_API_CACHE_MS || 30 * 60 * 1000);
const PAPER_ACCOUNTS_FILE = join(DATA_DIR, "paper-accounts.json");
const PAPER_STARTING_CASH = 100000;

loadEnvFile(".env");
loadEnvFile(".env.local");

function isLandingOnly() {
  const value = String(process.env.LANDING_ONLY || "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function landingOnlyAllows(pathname, method) {
  if (pathname.startsWith("/assets/")) return true;
  if (pathname.startsWith("/src/imports/")) return true;
  if (method === "GET" || method === "HEAD") {
    if (pathname === "/" || pathname === "/manifesto") return true;
    if (pathname === "/favicon.ico" || pathname === "/favicon.png") return true;
    if (pathname === "/robots.txt" || pathname === "/.well-known/security.txt") return true;
  }
  if (method === "GET") {
    if (pathname === "/api/config") return true;
    if (pathname === "/api/landing-quotes") return true;
    if (pathname === "/api/landing-signal") return true;
    if (pathname === "/api/landing-fec-pulse") return true;
    if (pathname === "/api/fec/pulse") return true;
  }
  if (method === "POST" && pathname === "/api/waitlist") return true;
  return false;
}

function landingOnlyBlocked(res, pathname) {
  if (pathname.startsWith("/api/")) {
    return sendJson(res, 503, {
      error: "landing_only",
      message: "Terminal access opens soon. Join the waitlist on the home page."
    });
  }
  return redirect(res, "/#early-access");
}

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE GATES — Launch Phase Control
// ═══════════════════════════════════════════════════════════════════════════
const FEATURE_GATES = {
  // WEEK 1 LAUNCH — ONLY THESE ENABLED
  THESIS_ENABLED: true,
  PAPER_TRADING_ENABLED: true,
  MARKETS_ENABLED: true,
  PUBLIC_SHARES_ENABLED: true,
  SESSION_ENABLED: true,
  WAITLIST_ENABLED: true,

  // MONTH 2+ — DISABLED FOR NOW
  BILLS_EXPLORER_ENABLED: true,
  CONTRACTS_ANALYZER_ENABLED: true,
  LOBBYING_EXPLORER_ENABLED: false,
  ANALYSIS_LAB_ENABLED: false,
  CRYPTO_TRACKER_ENABLED: false,
  FUNDS_HYPOTHETICALS_ENABLED: false,
  SETTINGS_PAGE_ENABLED: false,
  RELATIONSHIP_MAPS_ENABLED: false,
  AI_RESEARCH_ENABLED: false,
  ALERTS_MONITORING_ENABLED: false,
  ADVANCED_ANALYTICS_ENABLED: false
};

if (process.env.LAUNCH_PHASE === "beta-extended") {
  FEATURE_GATES.BILLS_EXPLORER_ENABLED = true;
  FEATURE_GATES.ANALYSIS_LAB_ENABLED = true;
}

if (process.env.LAUNCH_PHASE === "full-feature") {
  Object.keys(FEATURE_GATES).forEach((key) => {
    FEATURE_GATES[key] = true;
  });
}

function featureEnabled(featureName) {
  return Boolean(FEATURE_GATES[featureName]);
}

function checkFeature(featureName, res) {
  if (!featureEnabled(featureName)) {
    sendJson(res, 403, {
      error: "feature_not_available",
      message: "This feature is not yet available in the beta."
    });
    return false;
  }
  return true;
}

function serverAiProviderEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);
}

const PORT = Number(process.env.PORT || 3000);

const INSECURE_AUTH_SECRETS = new Set([
  "",
  "dev-only-secret-change-before-deploying",
  "replace-with-a-long-random-string",
  "changeme",
  "secret"
]);

function isPlaceholderAppUrl(url) {
  const u = String(url || "").trim().toLowerCase();
  return !u || u.includes("localhost") || u.includes("127.0.0.1") || u.includes("0.0.0.0");
}

function resolveAppUrl() {
  const explicit = String(process.env.APP_URL || "").trim().replace(/\/$/, "");
  if (explicit && !isPlaceholderAppUrl(explicit)) return explicit;
  const railwayHost = String(process.env.RAILWAY_PUBLIC_DOMAIN || "").trim();
  if (railwayHost) return `https://${railwayHost}`;
  return `http://localhost:${PORT}`;
}

const APP_URL = resolveAppUrl();
const AUTH_SECRET = String(process.env.AUTH_SECRET || "").trim()
  || "dev-only-secret-change-before-deploying";

function authSecretIsInsecure() {
  return INSECURE_AUTH_SECRETS.has(AUTH_SECRET);
}
const SESSION_COOKIE = "ts_session";
const CSRF_COOKIE = "ts_csrf";
const OAUTH_COOKIE = "ts_oauth";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 65_536);
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 10);
const AUTH_RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);

// Shared by requestIsHttps() and clientIp(): only trust proxy-supplied
// X-Forwarded-* headers when we know a real proxy (Railway, or an explicit
// opt-in) sits in front of us. Otherwise a client could set these headers
// directly and spoof its own IP or the request's apparent scheme.
function isTrustedProxy() {
  return (
    process.env.TRUST_PROXY === "true" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN)
  );
}

function requestIsHttps(req) {
  if (isTrustedProxy()) {
    const proto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    if (proto === "https") return true;
  }
  return APP_URL.startsWith("https://");
}

function clientIp(req) {
  if (isTrustedProxy()) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || "anon";
}

function sanitizeRelativePath(raw, fallback = "/dashboard?view=home") {
  const next = String(raw || "").trim();
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  if (next.includes("\\") || next.includes("\0") || /^\/\\/.test(next)) return fallback;
  try {
    const decoded = decodeURIComponent(next);
    if (decoded.startsWith("//") || /^https?:/i.test(decoded)) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
const BASE_SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  // CSP: allow same-origin scripts/styles + Google Fonts + GSAP CDN + Anthropic API (for BYOK browser calls)
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "media-src 'self' https://assets.mixkit.co",
    "connect-src 'self' https://api.anthropic.com https://openai.com https://generativelanguage.googleapis.com",
    "frame-ancestors 'none'"
  ].join("; ")
};
// The "Markets" view alone requests ~50+ unique symbols. At Finnhub's free-tier
// ~60 req/min cap, a 30s TTL means ~50 calls every 30s (~100/min) — over budget.
// 60s TTL halves the steady-state floor to ~50/min, and the worker-pool fetch
// (below) staggers each symbol's cache-fill time, so refreshes trickle in
// rather than re-bursting all 50+ symbols at once.
const QUOTE_CACHE_TTL_MS = Number(process.env.QUOTE_CACHE_TTL_MS || 60_000);
// Skip Finnhub when a live quote is already cached younger than this (dedupes
// warmup + Markets + landing requests against the same ~60 req/min free tier).
const QUOTE_FRESH_SKIP_MS = Number(process.env.QUOTE_FRESH_SKIP_MS || 120_000);
const quoteCache = new Map();
// Finnhub's free tier is ~60 req/min with a per-second cap. A burst of parallel
// quote calls trips HTTP 429, so we (a) cap fetch concurrency and (b) trip a
// short circuit-breaker when Finnhub rate-limits us — serving cache/fallback
// until it recovers instead of hammering it on every subsequent request.
const QUOTE_FETCH_CONCURRENCY = Number(process.env.QUOTE_FETCH_CONCURRENCY || 1);
const FINNHUB_COOLDOWN_MS = Number(process.env.FINNHUB_COOLDOWN_MS || 105_000);
let finnhubCooldownUntil = 0;
// Pace Finnhub requests globally (single queue). Default 2s ≈ 30/min — well under
// the free-tier ~60/min cap even with catalog warmup + Markets refreshes.
const FINNHUB_MIN_INTERVAL_MS = Number(process.env.FINNHUB_MIN_INTERVAL_MS || 2_000);
const FINNHUB_FETCH_TIMEOUT_MS = Number(process.env.FINNHUB_FETCH_TIMEOUT_MS || 10_000);
// Catalog warmup: one symbol every N ms (52 × 5s ≈ 4.3 min; tunable to 5–8 min).
const CATALOG_WARM_INTERVAL_MS = Number(process.env.CATALOG_WARM_INTERVAL_MS || 5_000);
// 0 = no per-request deadline — always backfill misses with cache/static ref prices.
const MARKET_QUOTES_MAX_MS = Number(process.env.MARKET_QUOTES_MAX_MS || 0);
let lastFinnhubCallAt = 0;
let finnhubQueueTail = Promise.resolve();
const quoteProviderErrorAt = new Map();
const QUOTE_ERROR_LOG_COOLDOWN_MS = Number(process.env.QUOTE_ERROR_LOG_COOLDOWN_MS || 120_000);
// Stooq CSV endpoints (/q/l/, /q/d/l/) return 404 from datacenter IPs — disabled by default.
const STOOQ_QUOTES_ENABLED = String(process.env.STOOQ_QUOTES_ENABLED ?? "false").trim().toLowerCase() === "true";
const STOOQ_COOLDOWN_MS = Number(process.env.STOOQ_COOLDOWN_MS || 30 * 60_000);
const STOOQ_CRYPTO_SYMBOLS = new Set(["BTC", "ETH"]);
let stooqCooldownUntil = 0;
const stooqBatchFailures = { count: 0, sample: [], message: "", timer: null };

function logQuoteProviderError(provider, symbol, message) {
  if (/HTTP 429|\b429\b/.test(String(message || ""))) return;
  const key = `${provider}:${symbol}`;
  const now = Date.now();
  if (now - (quoteProviderErrorAt.get(key) || 0) < QUOTE_ERROR_LOG_COOLDOWN_MS) return;
  quoteProviderErrorAt.set(key, now);
  console.warn(`[data] ${provider} quote failed for ${symbol}: ${message}`);
}

function noteFinnhubRateLimited() {
  const now = Date.now();
  if (now < finnhubCooldownUntil) return;
  finnhubCooldownUntil = now + FINNHUB_COOLDOWN_MS;
  const key = "finnhub:_429";
  if (now - (quoteProviderErrorAt.get(key) || 0) < FINNHUB_COOLDOWN_MS) return;
  quoteProviderErrorAt.set(key, now);
  console.warn(
    `[data] Finnhub rate-limited (429) — pausing Finnhub for ${Math.round(FINNHUB_COOLDOWN_MS / 1000)}s; serving cached/yfinance/fallback prices.`
  );
}

function isLiveQuoteSource(source) {
  const s = String(source || "").toLowerCase();
  return s && s !== "fallback_static" && s !== "fallback";
}

function cachedQuoteFresh(symbol, maxAgeMs = QUOTE_FRESH_SKIP_MS) {
  const cached = quoteCache.get(symbol);
  if (!cached?.quote || !quoteHasValidPrice(cached.quote)) return null;
  if (Date.now() - cached.cachedAt >= maxAgeMs) return null;
  return cached;
}

function logQuoteProviderBatchError(provider, failures) {
  if (!failures?.count) return;
  const key = `${provider}:_batch`;
  const now = Date.now();
  if (now - (quoteProviderErrorAt.get(key) || 0) < QUOTE_ERROR_LOG_COOLDOWN_MS) return;
  quoteProviderErrorAt.set(key, now);
  const sample = failures.sample.slice(0, 5).join(", ");
  const extra = failures.count > failures.sample.length ? ` (+${failures.count - failures.sample.length} more)` : "";
  console.warn(`[data] ${provider} quote failed for ${failures.count} symbol(s) [${sample}${extra}]: ${failures.message}`);
}

function noteStooqBatchFailure(symbol, message) {
  stooqBatchFailures.count += 1;
  if (stooqBatchFailures.sample.length < 5) stooqBatchFailures.sample.push(symbol);
  stooqBatchFailures.message = message;
  if (stooqBatchFailures.timer) return;
  stooqBatchFailures.timer = setTimeout(() => {
    logQuoteProviderBatchError("Stooq", stooqBatchFailures);
    stooqBatchFailures.count = 0;
    stooqBatchFailures.sample = [];
    stooqBatchFailures.message = "";
    stooqBatchFailures.timer = null;
  }, 750);
}

function isStooqEligibleSymbol(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym || STOOQ_CRYPTO_SYMBOLS.has(sym)) return false;
  // US common stocks only — skip dotted tickers, funds, and non-equity symbols.
  return /^[A-Z]{1,5}$/.test(sym);
}

function toStooqSymbol(symbol) {
  return `${String(symbol || "").trim().toLowerCase().replace(/\./g, "-")}.us`;
}

async function withFinnhubSlot(fn) {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) return null;
  const run = finnhubQueueTail.then(async () => {
    if (Date.now() < finnhubCooldownUntil) return null;
    const waitMs = Math.max(0, FINNHUB_MIN_INTERVAL_MS - (Date.now() - lastFinnhubCallAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    if (Date.now() < finnhubCooldownUntil) return null;
    lastFinnhubCallAt = Date.now();
    return fn(token);
  });
  finnhubQueueTail = run.catch(() => {});
  return run;
}

async function fetchFinnhubQuote(symbol, token, attempt = 0) {
  const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
  try {
    const response = await fetchWithTimeout(quoteUrl, {}, FINNHUB_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      if (response.status === 429) noteFinnhubRateLimited();
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const mapped = mapFinnhubQuoteResponse(symbol, data);
    const quote = withQuoteFreshness(mapped, "finnhub", mapped.timestamp);
    quoteCache.set(symbol, { cachedAt: Date.now(), quote });
    return { source: "finnhub", quote };
  } catch (error) {
    const message = error?.message || String(error);
    const retryable = attempt === 0 && /aborted|timeout|fetch failed/i.test(message);
    if (retryable) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return fetchFinnhubQuote(symbol, token, attempt + 1);
    }
    throw error;
  }
}
// Yahoo's chart endpoint is blocked from Railway's datacenter IPs (403/fetch
// failed) for every symbol, every cycle. Without a breaker, each symbol that
// falls through to Yahoo eats a multi-second timeout, so a full ~50-symbol
// refresh can take longer than the cache TTL itself — which is what produced
// the ~60s cascade. Trip a longer cooldown on the first failure and skip
// straight to the static fallback until it recovers.
const YAHOO_COOLDOWN_MS = Number(process.env.YAHOO_COOLDOWN_MS || 5 * 60_000);
let yahooCooldownUntil = 0;
const stockSnapshotHistory = new Map();
const shareRateLimit = new Map();
const SHARE_RATE_LIMIT_MAX = Number(process.env.SHARE_RATE_LIMIT_MAX || 60);
const SHARE_RATE_LIMIT_WINDOW_MS = Number(process.env.SHARE_RATE_LIMIT_WINDOW_MS || 60_000);
// Coarse per-IP backstop across the whole authenticated /api/ surface. Several
// routes under this gate (contracts, congress bills, FEC, lobbying) call
// external, rate-limited/paid APIs on a cache miss with no per-endpoint
// throttle of their own — this bounds how fast one IP can force cache misses
// across all of them. Deliberately generous so normal dashboard use (which
// can fan out to a dozen-plus endpoints per view) is never affected; it's a
// backstop against abuse/loops, not a precise per-endpoint budget. Tune via
// env if real traffic patterns need a different ceiling.
const apiRateLimit = new Map();
const API_RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX || 300);
const API_RATE_LIMIT_WINDOW_MS = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000);
const EDGAR_SNAPSHOT_CACHE_TTL_MS = Number(process.env.EDGAR_SNAPSHOT_CACHE_TTL_MS || 6 * 60 * 60_000);
const edgarSnapshotCache = new Map();
// File-level write lock — prevents concurrent writes corrupting flat JSON/JSONL data files.
// Usage: await withFileLock(path, async () => { /* read-modify-write */ });
const fileLocks = new Map();
async function withFileLock(filePath, fn) {
  while (fileLocks.get(filePath)) {
    await new Promise((r) => setTimeout(r, 12));
  }
  fileLocks.set(filePath, true);
  try {
    return await fn();
  } finally {
    fileLocks.delete(filePath);
  }
}

const LANDING_QUOTES_TICKERS = ["GME", "AMZN", "SPCX", "RTX", "PLTR", "NOC", "NVDA", "AAPL", "LLY"];
const LANDING_QUOTES_TTL_MS = 5 * 60 * 1000;
let landingQuotesCache = null;
let landingQuotesCachedAt = 0;

const FEC_API_BASE = "https://api.open.fec.gov/v1";
const FEC_PULSE_CACHE_TTL_MS = Number(process.env.FEC_PULSE_CACHE_TTL_MS || 8 * 60 * 1000);
const FEC_COMMITTEE_MAP_FILE = join(DATA_DIR, "fec-committee-map.json");
const FEC_PULSE_SEED_FILE = join(DATA_DIR, "fec-pulse-seed.json");
const POLICY_CROSSWALK_FILE = join(DATA_DIR, "policy-crosswalk.json");
let fecCommitteeMap = { clusters: [], cycle: 2024 };
let fecPulseSeed = { source: "sample", pulses: [] };
let policyCrosswalk = { tags: [] };
let fecPulseCache = null;
let fecPulseCachedAt = 0;
let policyTrailCache = new Map();
const POLICY_TRAIL_CACHE_TTL_MS = Number(process.env.POLICY_TRAIL_CACHE_TTL_MS || 5 * 60 * 1000);

function loadFecSeedFiles() {
  try {
    fecCommitteeMap = JSON.parse(readFileSync(FEC_COMMITTEE_MAP_FILE, "utf8"));
  } catch {
    fecCommitteeMap = { clusters: [], cycle: 2024 };
  }
  try {
    fecPulseSeed = JSON.parse(readFileSync(FEC_PULSE_SEED_FILE, "utf8"));
  } catch {
    fecPulseSeed = { source: "sample", pulses: [], updatedAt: new Date().toISOString() };
  }
  try {
    policyCrosswalk = JSON.parse(readFileSync(POLICY_CROSSWALK_FILE, "utf8"));
  } catch {
    policyCrosswalk = { tags: [] };
  }
}
loadFecSeedFiles();
// Per-user research request tracking — in-memory, resets on server restart.
// Map<userId, { count: number, windowStart: number }>
const researchRateLimit = new Map();
const RESEARCH_RATE_LIMIT_MAX = Number(process.env.RESEARCH_RATE_LIMIT_MAX || 10);
const RESEARCH_RATE_LIMIT_WINDOW = Number(process.env.RESEARCH_RATE_LIMIT_WINDOW || 60) * 1000;
const BRIEF_AI_RATE_LIMIT_MAX = Number(process.env.BRIEF_AI_RATE_LIMIT_MAX || 10);
const BRIEF_AI_RATE_LIMIT_WINDOW = Number(process.env.BRIEF_AI_RATE_LIMIT_WINDOW_MS || 3_600_000);
const briefAiRateLimit = new Map();
const AD_HOC_CONGRESS_TTL_MS = Number(process.env.AD_HOC_CONGRESS_TTL_MS || 900_000);
const adHocCongressFetchedAt = new Map();
const usaspendingCache = new Map();
const USASPENDING_CACHE_TTL_MS = Number(process.env.USASPENDING_CACHE_TTL_MS || 900_000);
const USASPENDING_API_BASE = "https://api.usaspending.gov/api/v2";
const USASPENDING_FETCH_TIMEOUT_MS = Number(process.env.USASPENDING_FETCH_TIMEOUT_MS || 14_000);
const CURRENT_CONGRESS = "119";

const QUOTE_PROVIDER_LABELS = {
  finnhub: "Finnhub",
  yfinance: "Yahoo Finance (yfinance)",
  yahoo_chart: "Yahoo Finance chart",
  stooq_public: "Stooq",
  fallback_static: "Modeled fallback",
  fallback: "Modeled fallback",
  unavailable: "Unavailable"
};

const YFINANCE_BRIDGE_SCRIPT = join(ROOT, "scripts", "yf_bridge.py");
const YFINANCE_VENV_PYTHON = join(ROOT, ".venv-yfinance", "bin", "python3");
const YFINANCE_PYTHON =
  process.env.YFINANCE_PYTHON ||
  (process.env.YFINANCE_VENV
    ? join(process.env.YFINANCE_VENV, "bin", "python3")
    : existsSync(YFINANCE_VENV_PYTHON)
      ? YFINANCE_VENV_PYTHON
      : "python3");
const YFINANCE_BRIDGE_TIMEOUT_MS = Number(process.env.YFINANCE_BRIDGE_TIMEOUT_MS || 12_000);
let yfinanceBridgeStatus = null;

function yfinanceExplicitlyDisabled() {
  const flag = String(process.env.YFINANCE_ENABLED ?? "").trim().toLowerCase();
  return flag === "false" || flag === "0" || flag === "no";
}

function yfinanceBridgeEnv() {
  const env = { ...process.env };
  env.PYTHONWARNINGS = env.PYTHONWARNINGS || "ignore";
  const extraPath =
    process.env.YFINANCE_PYTHONPATH ||
    process.env.YFINANCE_LOCAL_PATH ||
    "";
  if (extraPath) {
    env.PYTHONPATH = env.PYTHONPATH ? `${extraPath}:${env.PYTHONPATH}` : extraPath;
  }
  return env;
}

function isYfinanceEnabled() {
  if (yfinanceExplicitlyDisabled()) return false;
  if (yfinanceBridgeStatus === false) return false;
  if (yfinanceBridgeStatus === true) return true;
  return String(process.env.YFINANCE_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

function markYfinanceBridgeUnavailable(reason) {
  yfinanceBridgeStatus = false;
  console.error("[yfinance] bridge unavailable:", reason);
}

function callYfinanceBridge({ symbol, mode, range = "6m" }) {
  if (!isYfinanceEnabled() || !existsSync(YFINANCE_BRIDGE_SCRIPT)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const payload = JSON.stringify({ mode, symbol, range });
    const child = spawn(
      YFINANCE_PYTHON,
      [YFINANCE_BRIDGE_SCRIPT],
      {
        cwd: ROOT,
        env: yfinanceBridgeEnv(),
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      console.error("[yfinance] bridge timeout", { symbol, mode, range });
      finish(null);
    }, YFINANCE_BRIDGE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      markYfinanceBridgeUnavailable(error?.message || String(error));
      finish(null);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit_${code}`;
        console.error("[yfinance] bridge failed:", detail, { symbol, mode, range });
        if (code === 127 || /No such file|not found/i.test(detail)) {
          markYfinanceBridgeUnavailable(detail);
        }
        finish(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim() || "{}");
        if (!parsed.ok) {
          console.error("[yfinance] bridge error:", parsed.error || "unknown", { symbol, mode, range });
          finish(null);
          return;
        }
        yfinanceBridgeStatus = true;
        finish(parsed);
      } catch (error) {
        console.error("[yfinance] invalid JSON:", error?.message || String(error), { symbol, mode, range });
        finish(null);
      }
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}

async function yfinanceQuoteSnapshot(symbol) {
  const result = await callYfinanceBridge({ symbol, mode: "quote" });
  const row = result?.quote;
  if (!row || row.price == null || !Number.isFinite(Number(row.price)) || Number(row.price) <= 0) {
    return null;
  }
  return {
    symbol,
    price: Number(row.price),
    change: row.change != null ? Number(row.change) : null,
    changePercent: row.changePercent != null ? Number(row.changePercent) : row.pct != null ? Number(row.pct) : null,
    pct: row.pct != null ? Number(row.pct) : row.changePercent != null ? Number(row.changePercent) : null,
    high: row.high != null ? Number(row.high) : null,
    low: row.low != null ? Number(row.low) : null,
    open: row.open != null ? Number(row.open) : null,
    prevClose: row.prevClose != null ? Number(row.prevClose) : null,
    previousClose: row.previousClose != null ? Number(row.previousClose) : row.prevClose != null ? Number(row.prevClose) : null,
    timestamp: row.timestamp || new Date().toISOString(),
    source: "yfinance"
  };
}

async function yfinanceHistory(symbol, range) {
  const result = await callYfinanceBridge({ symbol, mode: "history", range });
  const points = Array.isArray(result?.points) ? result.points : [];
  return points
    .map((point) => ({
      date: String(point.date || ""),
      open: Number(point.open),
      high: Number(point.high),
      low: Number(point.low),
      close: Number(point.close),
      volume: Number(point.volume || 0)
    }))
    .filter((point) => point.date && Number.isFinite(point.close) && point.close > 0);
}

const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT ||
  "TradeSimple/1.0 (retail research terminal; contact: you@example.com)";

const RESEARCH_SYSTEM_PROMPT = `You are TradeSimple's research assistant. You explain how congressional bills, lobbying activity, federal contracts, and government appointments might affect specific stocks in plain English for retail investors.
FORMATTING RULES: Write the main answer as 3-6 bullet points. Put each bullet on its own line starting with "- ". No markdown headers, horizontal rules, or paragraph blocks. Keep responses under 250 words unless the user asks for a deep dive. End every response with "Watch for:" on its own line followed by up to 3 bullet items (each starting with "- ").
TONE RULES: Never use dramatic language like existential threat, genuinely scared, or death sentence. Let numbers speak for themselves. Use this suggests not this means. Use historically not guaranteed. Never imply a buy or sell decision even indirectly.
STRUCTURE FOR EVERY RESPONSE: Start with the disclosure line when discussing position impact. Then 3-6 bullets covering bottom line, signal breakdown with numbers, historical analog if one exists, and what still needs verification. Then the Watch for section with up to 3 bullets.
DISCLOSURE: Start every response that discusses position impact with exactly this line: Research signal only. Not financial advice.
DATA HONESTY: If a number comes from a specific source name it. If a number is estimated say so. Never invent historical analogs. If you do not have enough data to answer well say so directly.
DATA SOURCES YOU CAN REFERENCE: Congress.gov for bill stage and cosponsor data. LDA.gov for lobbying filings and spend. USASpending.gov for federal contract awards and agency budgets. SEC EDGAR for 10-K risk factors and revenue segment data. Finnhub for equity quotes when configured (label source; free tier may be delayed). SAM.gov for contract opportunities and recompetes.
DATA HONESTY RULES: Only cite bill status, sponsors, and dates when the payload marks exactCongressRecord or dataLayer live. Scenario-only bills (scenarioOnly or id starting with scenario:) are educational models — do not present them as live Congress records. Pass/fail stock ranges are scenario models, not forecasts. If dataHealth shows fallback feeds, say so.`;

const METHODOLOGY = {
  version: 2,
  disclaimer:
    "Every number below is a transparent scenario model inside TradeSimple. It is not a forecast, a consensus estimate, or investment advice. Live Congress.gov text and LDA filings always supersede the UI when they disagree.",
  sections: [
    {
      id: "legislativeMomentum",
      title: "Legislative momentum (0–100)",
      summary:
        "Eight GovTrack-inspired sub-scores from 0–100 are combined with fixed weights. The weighted average is rounded to an integer and clamped between 0 and 100.",
      weights: [
        { name: "Stage progress", pct: 25, detail: "Maps richer bill status: introduced 20, committee 40, markup 58, reported 64, floor 76, one-chamber passage 86, final passage/law 100, incorporated 82, failed 5." },
        { name: "Sponsor effectiveness", pct: 15, detail: "Cosponsors as a share of chamber size (218 House / 100 Senate cap). Bipartisan bills add up to +25 points." },
        { name: "Cosponsor strength", pct: 15, detail: "Same density measure without the bipartisan bonus — captures sheer caucus scale." },
        { name: "Bipartisan breadth", pct: 10, detail: "Uses curated bipartisanScore when present; otherwise bipartisan cosponsors ÷ total cosponsors × 100." },
        { name: "Committee / schedule", pct: 10, detail: "Uses curated committeeScore when present; otherwise defaults from stage. Floor-scheduled bills gain +18 (capped at 100)." },
        { name: "Recency", pct: 10, detail: "Last action date buckets: ≤10d → 100, ≤30d → 88, ≤60d → 72, ≤120d → 55, ≤200d → 40, older → 28; missing date → 35." },
        { name: "Text enactability", pct: 10, detail: "Blend of historicalScore (55%) and floorScore (45%) when curated; else defaults from stage." },
        { name: "Time remaining", pct: 5, detail: "Calendar-month proxy for session runway unless the bill already passed." }
      ]
    },
    {
      id: "billConfidence",
      title: "Bill signal confidence (High / Medium / Low)",
      summary:
        "A points checklist — not a statistical confidence interval — describing how complete the seed bill record is.",
      weights: [
        { name: "Recency & action text", pct: null, detail: "Up to 45 pts from latestActionDate freshness plus 10 pts if latestAction exists." },
        { name: "Support signals", pct: null, detail: "12 pts if cosponsors > 0; 8 pts if bipartisanCosponsors is recorded." },
        { name: "Lobbying context", pct: null, detail: "12 pts if lobbyingAgainst or lobbyingFor dollars exist in seed data." },
        { name: "Narrative depth", pct: null, detail: "5 pts if plainEnglish text is longer than 80 characters." },
        { name: "Buckets", pct: null, detail: "≥72 pts → High; ≥44 → Medium; otherwise Low." }
      ]
    },
    {
      id: "lobbyingPressure",
      title: "Lobbying pressure on disclosures (0–100)",
      summary:
        "Built from each LDA-style filing row (client, registrant, amount, issues, spike factor, posted date). When no nine-quarter history exists, the server synthesizes eight trailing quarters from amount ÷ spike so the z-score still runs.",
      weights: [
        { name: "Spend spike shape", pct: 40, detail: "Current quarter vs trailing eight-quarter mean/std → z-score; mapped to 0–100 via spendSpikeSubscore (z clipped −2…3.5)." },
        { name: "Coalition breadth", pct: 20, detail: "Count of comma-separated issue tags: base 12 + 22 per tag (cap 100)." },
        { name: "Topic specificity", pct: 15, detail: "Starts at 100 and penalizes extra tags so vague omnibus filings score lower." },
        { name: "Recency", pct: 15, detail: "Posted date buckets: ≤14d best, decaying through 200d." },
        { name: "Direction certainty", pct: 10, detail: "Higher when spike factor > 1.65; +12 when issues mention pricing, antitrust, crypto, Medicare, export, or chips." }
      ]
    },
    {
      id: "lobbyingSubscores",
      title: "Lobby filing sub-labels (Spend / Issue / Recency confidence)",
      summary: "Heuristic labels that explain the filing row, not statistical confidence intervals.",
      weights: [
        { name: "Spend signal", pct: null, detail: "High if z ≥ 1.2 or spike > 1.8×; Low if |z| < 0.35; else Medium." },
        { name: "Issue signal", pct: null, detail: "High if ≥3 issue tokens; Medium if ≥1; else Low." },
        { name: "Recency signal", pct: null, detail: "High if filed ≤90 days; Medium if posted date exists but older; else Low." }
      ]
    },
    {
      id: "filingConfidence",
      title: "Filing confidence (High / Medium / Low)",
      summary: "Points for populated client/registrant/issue/amount/posted date fields.",
      weights: [
        { name: "Field checklist", pct: null, detail: "28 client + 14 registrant + issue length + amount + posted date freshness (≤45d bonus). ≥74 High; ≥42 Medium; else Low." }
      ]
    },
    {
      id: "billCardLobbying",
      title: "Lobbying pressure on LegisAlert cards",
      summary:
        "Matches the same lobbying-pressure engine, but the input is a synthetic filing built from the bill seed's lobbyingAgainst / lobbyingFor dollars and narrative text — useful when no LDA row is attached yet.",
      weights: []
    },
    {
      id: "policyCatalysts",
      title: "Congress catalyst queue",
      summary:
        "A ranked watch queue built from floor scheduling, stage progress, recent action, lobbying pressure, and mapped ticker exposure. It flags what could matter soon; it is not a prediction that a vote will happen.",
      weights: [
        { name: "Schedule posture", pct: null, detail: "Floor-scheduled bills and reported bills rank ahead of early introduced bills." },
        { name: "Recent action", pct: null, detail: "Recent committee, markup, report, or floor action increases urgency." },
        { name: "Market mapping", pct: null, detail: "Bills tied to mapped tickers get priority because TradeSimple can explain a revenue, margin, capex, or valuation channel." },
        { name: "Lobbying pressure", pct: null, detail: "High modeled lobbying pressure adds urgency because organized stakeholders are spending around the issue." }
      ]
    },
    {
      id: "marketMood",
      title: "Overview · Market mood panel",
      summary: "All four meters are modeled inside the browser from quotes + bill feed + lobbying feed — not third-party sentiment APIs.",
      weights: [
        { name: "Tape risk appetite", pct: null, detail: "SPY/QQQ blended daily % move mapped toward a 12–92 gauge." },
        { name: "Social sentiment proxy", pct: null, detail: "Derived from the same tape move; labeled as modeled (not live Reddit)." },
        { name: "Portfolio policy heat", pct: null, detail: "Max legislative momentum among bills touching simulated holdings, with a fallback when none match." },
        { name: "Lobby intensity", pct: null, detail: "Mean lobbyingPressure on the most recent filings (fallback constant when empty)." }
      ]
    },
    {
      id: "contractRevenueSignal",
      title: "Contract Revenue Signal (CRS v2) — event-level",
      summary: "Measures whether a specific government contract award is likely to contain new market-relevant information. Separate from the company-level Government Dependency score on the risk radar. Calibrated via Spearman rank-correlation grid search across 490 weight combinations, tested against 282 USASpending.gov award events (LMT, BAH, LDOS, SAIC, PLTR, 2015–2024). 20-day information coefficient: 0.145 (p=0.012). Highest CRS quartile: +3.5% mean 20-day abnormal return vs −0.3% lowest quartile.",
      weights: [
        { name: "Government dependency", pct: 30, detail: "Government revenue as % of total revenue from annual 10-K. Higher dependency means more of the business is affected by government budget decisions." },
        { name: "Agency signal", pct: 30, detail: "How informative contracts from this agency typically are. HHS/VA score 85 (less analyst coverage, more surprise value). DoD scores 35 (most anticipated awards in government contracting, typically pre-priced). Empirical: HHS/VA → +4.1% mean 20-day AR vs DoD → +0.9%." },
        { name: "Award novelty", pct: 25, detail: "Inverse log-size. Smaller, unexpected awards score higher. Q1 awards (<$30M) produced +5.9% mean 20-day AR vs Q4 (>$500M) at −0.7%. Large awards are typically pre-announced via SAM.gov months before USASpending publishes them." },
        { name: "Renewal risk", pct: 15, detail: "Fraction of active contracts expiring within 18 months. Higher renewal risk = more near-term revenue uncertainty from recompete outcomes." }
      ],
      findings: [
        "PLTR shows +9.1% mean 20-day abnormal return after any contract award (t=2.99, p=0.003, n=42) — the only statistically significant company-level finding in the dataset.",
        "Award size is negatively correlated with returns. Treating large awards as automatically bullish is incorrect. Large contracts are usually pre-announced and priced in.",
        "Agency type predicts returns better than company-level concentration metrics.",
        "No weight combination achieved p<0.05 across the full pooled 282-event sample. The signal is directionally real but requires per-company context."
      ],
      disclaimer: "CRS v2 is calibrated against historical data but is not a validated predictive model. Past event-study results do not guarantee future performance. Do not use CRS as a buy or sell signal. Sample is 5 companies — results may not generalize. DoD awards lag USASpending by ~90 days; other agencies within 3 business days."
    },
    {
      id: "governmentDependencyScore",
      title: "Government Revenue Dependency — company-level (risk radar)",
      summary: "Measures how structurally dependent a company's business model is on government money. Used in the risk radar as the fifth dimension. Distinct from CRS: this is about the company, not about a specific award event. Based on seeded 10-K revenue data, renewal risk estimates, agency budget environment, and efficiency review exposure.",
      weights: [
        { name: "Government revenue share", pct: 45, detail: "Government contracts as % of total annual revenue. Sourced from public 10-K filings; updated annually." },
        { name: "Renewal risk", pct: 25, detail: "Estimated fraction of active contracts approaching expiry within 18 months." },
        { name: "Agency budget risk", pct: 15, detail: "Whether primary agencies are under budget pressure (high/medium/low)." },
        { name: "Efficiency review exposure", pct: 15, detail: "Whether primary agencies are subject to active workforce or spending reviews." }
      ],
      disclaimer: "Seeded from public annual report data. Updated annually. Treat as an order-of-magnitude indicator, not a precise revenue forecast."
    }
  ]
};

const MARKET_FALLBACK = {
  NVDA: { symbol: "NVDA", price: 208.19, change: 2.95, pct: 1.42, high: 212.0, low: 202.0, open: 205.2 },
  AAPL: { symbol: "AAPL", price: 228.6, change: -0.92, pct: -0.4, high: 235.0, low: 218.4, open: 229.5 },
  LLY: { symbol: "LLY", price: 796.6, change: 8.6, pct: 1.09, high: 810.0, low: 772.0, open: 788.0 },
  GME: { symbol: "GME", price: 24.8, change: 5.5, pct: 28.4, high: 26.0, low: 19.0, open: 19.3 },
  RTX: { symbol: "RTX", price: 112.84, change: -0.35, pct: -0.31, high: 114.5, low: 111.0, open: 113.2 },
  PLTR: { symbol: "PLTR", price: 132.07, change: 5.3, pct: 4.18, high: 134.0, low: 126.0, open: 126.8 },
  NOC: { symbol: "NOC", price: 498.3, change: 4.5, pct: 0.92, high: 502.0, low: 490.0, open: 493.8 },
  TSLA: { symbol: "TSLA", price: 285.3, change: 3.1, pct: 1.1, high: 298.0, low: 258.0, open: 282.4 },
  AMZN: { symbol: "AMZN", price: 212.8, change: 2.05, pct: 0.98, high: 218.0, low: 204.0, open: 210.9 },
  MSFT: { symbol: "MSFT", price: 468.2, change: 1.42, pct: 0.31, high: 472.0, low: 452.0, open: 466.8 },
  AMD: { symbol: "AMD", price: 118.6, change: 2.15, pct: 1.85, high: 124.0, low: 108.0, open: 116.45 },
  GOOGL: { symbol: "GOOGL", price: 168.9, change: 0.88, pct: 0.52, high: 171.5, low: 162.0, open: 168.0 },
  META: { symbol: "META", price: 598.4, change: 4.2, pct: 0.71, high: 612.0, low: 568.0, open: 594.2 },
  COIN: { symbol: "COIN", price: 276.5, change: -2.8, pct: -1.0, high: 292.0, low: 248.0, open: 279.3 },
  SPY: { symbol: "SPY", price: 598.2, change: 2.45, pct: 0.41, high: 602.0, low: 588.0, open: 595.75 },
  QQQ: { symbol: "QQQ", price: 518.6, change: 3.05, pct: 0.59, high: 524.0, low: 508.0, open: 515.55 },
  // Remaining symbols in the "Markets" tradable catalog (defense/contract/policy
  // tickers, indices, and crypto) — without an entry here, a symbol shows
  // "Unavailable" whenever live providers are unreachable (Yahoo/yfinance are
  // permanently blocked on Railway and Finnhub's free tier can't cover 50+
  // symbols), which is the steady-state case, not the exception.
  BA: { symbol: "BA", price: 209.0, change: -5.51, pct: -2.57, high: 216.0, low: 207.0, open: 214.51 },
  BAH: { symbol: "BAH", price: 108.4, change: -1.85, pct: -1.68, high: 111.5, low: 107.0, open: 110.25 },
  ABBV: { symbol: "ABBV", price: 192.5, change: 1.35, pct: 0.71, high: 194.0, low: 190.0, open: 191.15 },
  ADM: { symbol: "ADM", price: 51.2, change: -0.45, pct: -0.87, high: 52.3, low: 50.7, open: 51.65 },
  AMAT: { symbol: "AMAT", price: 182.4, change: 2.6, pct: 1.45, high: 184.5, low: 178.0, open: 179.8 },
  ASML: { symbol: "ASML", price: 735.0, change: -8.2, pct: -1.1, high: 748.0, low: 728.0, open: 743.2 },
  BAC: { symbol: "BAC", price: 44.3, change: 0.28, pct: 0.64, high: 44.8, low: 43.7, open: 44.02 },
  BTC: { symbol: "BTC", price: 104500, change: 1850, pct: 1.8, high: 106200, low: 101800, open: 102650 },
  CRWD: { symbol: "CRWD", price: 452.0, change: 6.4, pct: 1.44, high: 458.0, low: 440.0, open: 445.6 },
  CVS: { symbol: "CVS", price: 64.8, change: -0.55, pct: -0.84, high: 65.9, low: 64.1, open: 65.35 },
  CXW: { symbol: "CXW", price: 21.3, change: 0.62, pct: 3.0, high: 21.8, low: 20.3, open: 20.68 },
  DAL: { symbol: "DAL", price: 51.6, change: 0.85, pct: 1.67, high: 52.4, low: 50.2, open: 50.75 },
  DE: { symbol: "DE", price: 498.0, change: -3.2, pct: -0.64, high: 505.0, low: 494.0, open: 501.2 },
  ENPH: { symbol: "ENPH", price: 68.4, change: -1.1, pct: -1.58, high: 70.5, low: 67.2, open: 69.5 },
  ETH: { symbol: "ETH", price: 2780, change: -42, pct: -1.49, high: 2850, low: 2740, open: 2822 },
  FSLR: { symbol: "FSLR", price: 198.0, change: 4.3, pct: 2.22, high: 201.5, low: 191.0, open: 193.7 },
  GD: { symbol: "GD", price: 288.0, change: 1.95, pct: 0.68, high: 290.0, low: 284.5, open: 286.05 },
  GEO: { symbol: "GEO", price: 28.4, change: 0.95, pct: 3.46, high: 29.0, low: 27.0, open: 27.45 },
  GS: { symbol: "GS", price: 615.0, change: -4.8, pct: -0.78, high: 622.0, low: 610.0, open: 619.8 },
  HII: { symbol: "HII", price: 215.0, change: -2.4, pct: -1.1, high: 219.0, low: 212.5, open: 217.4 },
  INTC: { symbol: "INTC", price: 22.4, change: 0.35, pct: 1.59, high: 22.8, low: 21.9, open: 22.05 },
  JPM: { symbol: "JPM", price: 265.0, change: 1.8, pct: 0.68, high: 267.0, low: 261.5, open: 263.2 },
  KBE: { symbol: "KBE", price: 58.2, change: 0.42, pct: 0.73, high: 58.6, low: 57.4, open: 57.78 },
  LDOS: { symbol: "LDOS", price: 168.0, change: -1.3, pct: -0.77, high: 171.0, low: 166.5, open: 169.3 },
  LHX: { symbol: "LHX", price: 303.0, change: -5.17, pct: -1.68, high: 310.0, low: 301.0, open: 308.17 },
  LMT: { symbol: "LMT", price: 468.0, change: 3.1, pct: 0.67, high: 471.5, low: 462.0, open: 464.9 },
  MRK: { symbol: "MRK", price: 82.5, change: -0.95, pct: -1.14, high: 84.0, low: 81.8, open: 83.45 },
  PANW: { symbol: "PANW", price: 185.0, change: 2.7, pct: 1.48, high: 187.5, low: 180.5, open: 182.3 },
  PFE: { symbol: "PFE", price: 24.8, change: 0.18, pct: 0.73, high: 25.1, low: 24.4, open: 24.62 },
  SAIC: { symbol: "SAIC", price: 102.0, change: -1.4, pct: -1.35, high: 104.5, low: 101.0, open: 103.4 },
  SPCX: { symbol: "SPCX", price: 211.6, change: 5.89, pct: 2.86, high: 225.64, low: 192.5, open: 205.71 },
  TSM: { symbol: "TSM", price: 205.0, change: 3.5, pct: 1.74, high: 207.5, low: 200.0, open: 201.5 },
  UAL: { symbol: "UAL", price: 84.0, change: 1.65, pct: 2.0, high: 85.5, low: 81.5, open: 82.35 },
  UNH: { symbol: "UNH", price: 305.0, change: -6.2, pct: -1.99, high: 315.0, low: 300.0, open: 311.2 },
  XLE: { symbol: "XLE", price: 89.5, change: -0.65, pct: -0.72, high: 90.8, low: 88.9, open: 90.15 },
  XLF: { symbol: "XLF", price: 51.2, change: 0.3, pct: 0.59, high: 51.6, low: 50.7, open: 50.9 },
  XOM: { symbol: "XOM", price: 110.5, change: -1.1, pct: -0.99, high: 112.5, low: 109.8, open: 111.6 }
};

/** Dashboard symbol universes — exposed via GET /api/dashboard/bootstrap (labeled config, not live quotes). */
const DASHBOARD_MARKET_SYMBOLS = Object.keys(MARKET_FALLBACK);
const DASHBOARD_MARKETS_DEFAULT = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA", "LLY", "AMZN", "MSFT", "AMD", "META"];
const DASHBOARD_TAPE_DEFAULT = ["SPY", "QQQ", "NVDA", "LLY", "TSLA"];
const DASHBOARD_WATCHLIST_DEFAULT = [
  { symbol: "PLTR", color: "#5eead4" },
  { symbol: "NVDA", color: "#93c5fd" },
  { symbol: "LMT", color: "#fcd34d" },
  { symbol: "TSM", color: "#f87171" },
  { symbol: "JPM", color: "#c4b5fd" }
];
const DASHBOARD_POLICY_BLURBS = {
  NVDA: "CHIPS tailwind; export-control risk",
  AAPL: "Platform antitrust risk fading",
  LLY: "Drug-pricing bill exposure",
  TSLA: "Permitting reform watch",
  SPCX: "NASA/DoD launch contracts; post-IPO policy watch",
  AMZN: "Antitrust overhang easing"
};

function buildDashboardPolicyBlurbs() {
  const blurbs = { ...DASHBOARD_POLICY_BLURBS };
  for (const bill of POLICY_BILLS) {
    const hint = bill.plainEnglish || bill.shortTitle || bill.title;
    for (const sym of bill.affected || []) {
      if (!blurbs[sym] && hint) blurbs[sym] = String(hint).slice(0, 72);
    }
  }
  return blurbs;
}

const CONTRACT_COMPANY_NAMES = {
  LMT: "Lockheed Martin",
  BAH: "Booz Allen Hamilton",
  LDOS: "Leidos",
  SAIC: "Science Applications International",
  PLTR: "Palantir Technologies",
  SPCX: "Space Exploration Technologies Corp.",
  GEO: "The GEO Group",
  CXW: "CoreCivic"
};

/** Extra USASpending search names for tickers that do not match a federal recipient keyword. */
const CONTRACT_SEARCH_HINTS = {
  NOC: "Northrop Grumman",
  GD: "General Dynamics",
  HII: "Huntington Ingalls",
  LHX: "L3Harris Technologies",
  BA: "Boeing",
  RTX: "RTX Corporation",
  SPCX: "Space Exploration Technologies"
};

function buildContractWatchlist() {
  return Object.keys(CONTRACT_PROFILES).map((symbol) => ({
    symbol,
    company: FUNDAMENTALS[symbol]?.name || CONTRACT_COMPANY_NAMES[symbol] || symbol
  }));
}

function resolveTradableSymbolName(symbol) {
  const sym = String(symbol || "").toUpperCase();
  return (
    FUNDAMENTALS[sym]?.name ||
    CONTRACT_COMPANY_NAMES[sym] ||
    CONTRACT_SEARCH_HINTS[sym] ||
    sym
  );
}

const finnhubSymbolNameCache = new Map();

/** Unified tradable universe — bills, contracts, lobbying, fundamentals, market seeds. */
function getTradableSymbolCatalog() {
  const map = new Map();
  const add = (rawSymbol, source, nameHint) => {
    const sym = String(rawSymbol || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z.]/g, "")
      .slice(0, 12);
    if (!sym) return;
    const row = map.get(sym) || { symbol: sym, name: resolveTradableSymbolName(sym), sources: new Set() };
    row.sources.add(source);
    if (nameHint && nameHint !== sym) row.name = nameHint;
    map.set(sym, row);
  };

  for (const sym of Object.keys(CONTRACT_PROFILES)) add(sym, "contract", resolveTradableSymbolName(sym));
  for (const [sym, name] of Object.entries(CONTRACT_COMPANY_NAMES)) add(sym, "contract", name);
  for (const [sym, name] of Object.entries(CONTRACT_SEARCH_HINTS)) add(sym, "contract", name);
  for (const sym of Object.keys(FUNDAMENTALS)) add(sym, "seed", FUNDAMENTALS[sym]?.name);
  for (const sym of Object.keys(MARKET_FALLBACK)) add(sym, "seed", resolveTradableSymbolName(sym));
  for (const bill of POLICY_BILLS) {
    for (const sym of bill.affected || []) add(sym, "bill", resolveTradableSymbolName(sym));
  }
  for (const syms of Object.values(LOBBY_CLIENT_TICKERS)) {
    for (const sym of syms) add(sym, "lobby", resolveTradableSymbolName(sym));
  }
  for (const bucket of BILL_KEYWORD_BUCKETS) {
    for (const sym of bucket.tickers || []) add(sym, "bill", resolveTradableSymbolName(sym));
  }
  for (const row of COMMITTEE_SECTOR_MAP) {
    for (const sym of row.tickers || []) add(sym, "bill", resolveTradableSymbolName(sym));
  }
  for (const row of POLICY_AREA_SECTOR_MAP) {
    for (const sym of row.tickers || []) add(sym, "bill", resolveTradableSymbolName(sym));
  }

  const symbols = [...map.values()]
    .map((row) => ({
      symbol: row.symbol,
      name: row.name,
      sources: [...row.sources].sort()
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    source: "symbol_registry",
    count: symbols.length,
    symbols,
    updatedAt: new Date().toISOString()
  };
}

let catalogQuoteSymbolsCache = null;

function getCatalogQuoteSymbols() {
  if (!catalogQuoteSymbolsCache) {
    catalogQuoteSymbolsCache = getTradableSymbolCatalog().symbols.map((row) => row.symbol);
  }
  return catalogQuoteSymbolsCache;
}

function getCatalogQuoteSymbolSet() {
  return new Set(getCatalogQuoteSymbols());
}

function quoteHasValidPrice(quote) {
  return quote?.price != null && Number.isFinite(Number(quote.price)) && Number(quote.price) > 0;
}

/** Static reference price for any tradable catalog symbol — explicit seed or generic placeholder. */
function resolveCatalogFallbackQuote(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return null;
  const explicit = enrichStaticQuote(MARKET_FALLBACK[sym]);
  if (explicit) return explicit;
  if (!getCatalogQuoteSymbolSet().has(sym)) return null;
  return enrichStaticQuote({
    symbol: sym,
    price: 100,
    change: 0,
    pct: 0,
    high: 100,
    low: 100,
    open: 100
  });
}

/** Pre-populate quoteCache with static refs so /api/market/quotes/catalog is instant on boot. */
function seedCatalogFallbackCache() {
  for (const symbol of getCatalogQuoteSymbols()) {
    const row = resolveCatalogFallbackQuote(symbol);
    if (!row) continue;
    const cached = quoteCache.get(symbol);
    if (cached && quoteHasValidPrice(cached.quote)) continue;
    const quote = withQuoteFreshness(row, "fallback_static", row.timestamp || null);
    quoteCache.set(symbol, { cachedAt: Date.now(), quote });
  }
}

function queueBackgroundQuoteRefresh(symbols) {
  const unique = [...new Set((symbols || []).map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))];
  const stale = unique.filter((symbol) => {
    const fresh = cachedQuoteFresh(symbol);
    return !(fresh && isLiveQuoteSource(fresh.quote.source));
  });
  if (!stale.length) return;
  const gapMs = Math.max(FINNHUB_MIN_INTERVAL_MS, 500);
  stale.forEach((symbol, index) => {
    setTimeout(() => {
      quoteSnapshot(symbol).catch(() => {});
    }, index * gapMs);
  });
}

async function enrichCatalogNamesFromFinnhub(catalog) {
  if (!process.env.FINNHUB_API_KEY || Date.now() < finnhubCooldownUntil) return catalog;
  const needs = catalog.symbols.filter((row) => row.name === row.symbol).slice(0, 12);
  for (const row of needs) {
    if (finnhubSymbolNameCache.has(row.symbol)) {
      const cached = finnhubSymbolNameCache.get(row.symbol);
      if (cached) row.name = cached;
      continue;
    }
    if (Date.now() < finnhubCooldownUntil) break;
    try {
      const data = await withFinnhubSlot(async (token) => {
        const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(row.symbol)}&token=${encodeURIComponent(token)}`;
        const response = await fetchWithTimeout(url, {}, 5000);
        if (!response.ok) {
          if (response.status === 429) noteFinnhubRateLimited();
          return null;
        }
        return response.json();
      });
      const name = data?.name || row.name;
      finnhubSymbolNameCache.set(row.symbol, name);
      row.name = name;
    } catch {
      finnhubSymbolNameCache.set(row.symbol, row.name);
    }
  }
  return catalog;
}

async function symbolsCatalogRoute(res) {
  const catalog = await enrichCatalogNamesFromFinnhub(getTradableSymbolCatalog());
  sendJson(res, 200, catalog);
}

async function dashboardBootstrapPayload(session) {
  let watchlistSymbols = [];
  if (dbReady && !isDemoSession(session)) {
    const row = await fetchWatchlistRow(session.user.id);
    if (row?.symbols?.length) watchlistSymbols = row.symbols;
  }

  return {
    source: "dashboard_config",
    updatedAt: new Date().toISOString(),
    paperStartingCash: PAPER_STARTING_CASH,
    defaultAnalysisSymbol: "NVDA",
    marketSymbols: DASHBOARD_MARKET_SYMBOLS,
    marketsDefaultSymbols: DASHBOARD_MARKETS_DEFAULT,
    tapeDefaultSymbols: DASHBOARD_TAPE_DEFAULT,
    analysisSymbols: DASHBOARD_MARKET_SYMBOLS,
    watchlistDefault: DASHBOARD_WATCHLIST_DEFAULT,
    watchlistSymbols,
    contractWatchlist: buildContractWatchlist(),
    tradableSymbols: getTradableSymbolCatalog().symbols,
    policyBlurbs: buildDashboardPolicyBlurbs(),
    holdingPalette: ["#5eead4", "#93c5fd", "#fcd34d", "#f87171", "#c4b5fd", "#a78bfa", "#fb923c", "#60a5fa", "#e879f9", "#4ade80"]
  };
}

async function dashboardBootstrapRoute(res, session) {
  sendJson(res, 200, await dashboardBootstrapPayload(session));
}

function thesisSummaryForUi(thesis) {
  return {
    id: thesis.id,
    ticker: thesis.ticker,
    direction: thesis.direction,
    thesisText: thesis.thesisText,
    status: thesis.status || "active",
    createdAt: thesis.createdAt,
    updatedAt: thesis.updatedAt,
    entry: thesis.entry,
    target: thesis.target,
    stop: thesis.stop,
    invalidation: thesis.invalidation,
    health: thesis.health || thesis.snapshotAtCreate?.health || null
  };
}

async function uiBootstrapRoute(res, session) {
  const account = await getPaperAccount(session);
  const [dashboard, paper] = await Promise.all([
    dashboardBootstrapPayload(session),
    paperSnapshot(account)
  ]);

  sendJson(res, 200, {
    source: "ui_bootstrap",
    version: "v1-ui-bridge",
    updatedAt: new Date().toISOString(),
    session: {
      user: session.user
    },
    dashboard,
    paper,
    theses: {
      count: Array.isArray(account.theses) ? account.theses.length : 0,
      items: Array.isArray(account.theses)
        ? account.theses.slice(0, 12).map(thesisSummaryForUi)
        : []
    },
    integration: {
      canonicalRuntime: "TradeSimple v1",
      preserveRoutes: ["/dashboard", "/api/trading/account", "/api/trading/orders", "/api/research/ask"],
      recommendedNextSurfaces: ["overview", "analysis", "signals", "thesis", "paper-trading"],
      notes: [
        "Use this endpoint as the initial shell payload for any upgraded UI.",
        "Keep data providers and trading validation server-side.",
        "Label modeled, fallback, and live data distinctly in the UI."
      ]
    }
  });
}

function buildThesisTimelineEvents(symbol, relatedBills = [], fundamentals = null) {
  const events = [];
  const colors = { bill: "#378add", market: "#7f77dd", contract: "#639922", lobby: "#ba7517" };

  if (fundamentals?.catalyst) {
    events.push({
      label: "Earnings checkpoint",
      sub: String(fundamentals.catalyst).slice(0, 48),
      color: colors.market,
      source: "modeled_fundamentals"
    });
  }

  for (const bill of relatedBills.slice(0, 3)) {
    const momentum = computeLegislativeMomentum(bill);
    events.push({
      label: (bill.shortTitle || bill.title || "Bill").slice(0, 28),
      sub: bill.floorScheduled
        ? `Floor · momentum ${momentum}/100`
        : `Committee · momentum ${momentum}/100`,
      color: colors.bill,
      source: bill.exactCongressRecord === false ? "modeled_seed" : "congress"
    });
  }

  const profile = CONTRACT_PROFILES[symbol];
  if (profile && events.length < 5) {
    events.push({
      label: "Federal contracts",
      sub: (profile.archetype || "Gov exposure").slice(0, 40),
      color: colors.contract,
      source: "modeled_profile"
    });
  }

  if (!events.length) return [];

  return events.slice(0, 6).map((ev, index, arr) => ({
    ...ev,
    pct: arr.length === 1 ? 50 : Math.round(8 + (index / Math.max(1, arr.length - 1)) * 82)
  }));
}

function mapFinnhubQuoteResponse(symbol, data) {
  const price = Number(data.c);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("invalid_or_missing_price");
  }
  return {
    symbol,
    price,
    change: data.d != null ? Number(data.d) : null,
    changePercent: data.dp != null ? Number(data.dp) : null,
    pct: data.dp != null ? Number(data.dp) : null,
    high: data.h != null ? Number(data.h) : null,
    low: data.l != null ? Number(data.l) : null,
    open: data.o != null ? Number(data.o) : null,
    prevClose: data.pc != null ? Number(data.pc) : null,
    previousClose: data.pc != null ? Number(data.pc) : null,
    timestamp: data.t ? new Date(data.t * 1000).toISOString() : null,
    source: "finnhub"
  };
}

function enrichStaticQuote(row) {
  if (!row || row.price == null) return null;
  const pct = row.pct != null ? Number(row.pct) : row.changePercent != null ? Number(row.changePercent) : 0;
  return {
    ...row,
    pct,
    changePercent: row.changePercent != null ? Number(row.changePercent) : pct,
    prevClose: row.prevClose != null ? Number(row.prevClose) : row.previousClose != null ? Number(row.previousClose) : null,
    previousClose: row.previousClose != null ? Number(row.previousClose) : row.prevClose != null ? Number(row.prevClose) : null,
    source: row.source || "fallback_static"
  };
}

function quoteProviderLabel(source) {
  return QUOTE_PROVIDER_LABELS[source] || String(source || "provider").replace(/_/g, " ");
}

function durationLabel(ms) {
  if (!Number.isFinite(Number(ms))) return "recently";
  const seconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function withQuoteFreshness(quote, source, providerTimestamp = null) {
  if (!quote) return quote;

  const fetchedAt = new Date().toISOString();
  const providerCode = quote.source || source || "unknown";
  const provider = quoteProviderLabel(providerCode);
  const providerMs = providerTimestamp ? Date.parse(providerTimestamp) : NaN;
  const freshnessMs = Number.isFinite(providerMs) ? Math.max(0, Date.now() - providerMs) : 0;
  const isUnavailable = quote.price == null || !Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0;
  const isFallback = providerCode === "fallback_static" || providerCode === "fallback";
  const isStale = Number.isFinite(providerMs) ? freshnessMs > 120_000 : false;
  const delayLabel = Number.isFinite(providerMs)
    ? `Updated ${durationLabel(freshnessMs)} ago`
    : isFallback
      ? "Modeled fallback quote"
      : "Fetched just now";

  return {
    ...quote,
    status: isUnavailable ? "unavailable" : isFallback ? "partial" : "available",
    source: providerCode,
    provider,
    providerCode,
    fetchedAt,
    providerTimestamp: providerTimestamp || quote.timestamp || null,
    freshnessMs,
    isDelayed: Number.isFinite(providerMs) ? freshnessMs > 15_000 : isFallback || null,
    isStale,
    delayLabel,
    marketDataNotice: "Market data may be delayed."
  };
}

function normalizeSnapshotQuote(quote, source, symbol) {
  if (quote) {
    const providerTimestamp = quote.providerTimestamp || quote.timestamp || null;
    return withQuoteFreshness(quote, quote.source || source, providerTimestamp);
  }
  return withQuoteFreshness(
    { symbol, price: null, change: null, pct: null, changePercent: null, source: "unavailable" },
    "unavailable",
    null
  );
}

const FUNDAMENTALS = {
  NVDA: {
    name: "NVIDIA Corporation",
    sector: "Semiconductors",
    marketCap: 2190000000000,
    pe: 69.4,
    forwardPe: 42.1,
    ps: 31.2,
    grossMargin: 75,
    revenueGrowth: 126,
    freeCashFlowMargin: 39,
    debtToEquity: 0.25,
    beta: 1.72,
    analystTarget: 1050,
    analystRating: "Strong Buy",
    analystCount: 47,
    catalyst: "Earnings · Blackwell GPU ramp · CHIPS Act grant flow",
    moat: "CUDA, developer mindshare, and AI accelerator supply make the business hard to copy quickly.",
    plainBull: "AI infrastructure spending is still early, and the biggest cloud buyers keep raising capex.",
    plainBear: "The valuation assumes near-perfect growth, and export controls can pressure China revenue."
  },
  AAPL: {
    name: "Apple Inc.",
    sector: "Consumer technology",
    marketCap: 2920000000000,
    pe: 28.2,
    forwardPe: 24.8,
    ps: 7.4,
    grossMargin: 46,
    revenueGrowth: 3,
    freeCashFlowMargin: 28,
    debtToEquity: 1.45,
    beta: 1.28,
    analystTarget: 220,
    analystRating: "Buy",
    analystCount: 38,
    catalyst: "WWDC · AI features · India manufacturing ramp",
    moat: "The installed device base and services ecosystem make customers sticky.",
    plainBull: "Services revenue and buybacks can support earnings even when iPhone growth is slow.",
    plainBear: "Hardware growth is mature, and platform regulation can pressure App Store economics."
  },
  LLY: {
    name: "Eli Lilly and Company",
    sector: "Pharmaceuticals",
    marketCap: 757000000000,
    pe: 62.1,
    forwardPe: 43.6,
    ps: 19.7,
    grossMargin: 80,
    revenueGrowth: 26,
    freeCashFlowMargin: 21,
    debtToEquity: 1.62,
    beta: 0.41,
    analystTarget: 980,
    analystRating: "Buy",
    analystCount: 29,
    catalyst: "Drug pricing calendar · FDA catalysts · GLP-1 supply print",
    moat: "GLP-1 obesity and diabetes drugs give Lilly a huge demand runway.",
    plainBull: "If GLP-1 supply keeps expanding, revenue can compound faster than typical pharma.",
    plainBear: "Drug-pricing legislation is the clearest policy risk because it targets Medicare pricing power."
  },
  TSLA: {
    name: "Tesla Inc.",
    sector: "Electric vehicles",
    marketCap: 582000000000,
    pe: 47.2,
    forwardPe: 54.5,
    ps: 6.8,
    grossMargin: 18,
    revenueGrowth: 9,
    freeCashFlowMargin: 4,
    debtToEquity: 0.12,
    beta: 2.28,
    analystTarget: 210,
    analystRating: "Hold",
    analystCount: 44,
    catalyst: "Permitting reform · Robotaxi / FSD milestones · Energy storage growth",
    moat: "Brand, manufacturing scale, charging network, and software ambition create upside optionality.",
    plainBull: "Energy storage and autonomous driving can matter more than near-term car margins if execution improves.",
    plainBear: "EV price cuts, competition, and demand softness make the current multiple harder to defend."
  },
  AMZN: {
    name: "Amazon.com Inc.",
    sector: "Internet retail and cloud",
    marketCap: 1980000000000,
    pe: 55.8,
    forwardPe: 34.5,
    ps: 3.3,
    grossMargin: 48,
    revenueGrowth: 13,
    freeCashFlowMargin: 9,
    debtToEquity: 0.52,
    beta: 1.19,
    analystTarget: 225,
    analystRating: "Strong Buy",
    analystCount: 52,
    catalyst: "AWS growth · Ads · Anthropic partnership",
    moat: "AWS, Prime, logistics scale, and ads create multiple profit engines.",
    plainBull: "AWS reacceleration and advertising growth can expand margins.",
    plainBear: "Cloud competition and antitrust pressure can cap the multiple."
  },
  MSFT: {
    name: "Microsoft Corporation",
    sector: "Software and cloud",
    marketCap: 3090000000000,
    pe: 34.8,
    forwardPe: 29.2,
    ps: 12.6,
    grossMargin: 69,
    revenueGrowth: 17,
    freeCashFlowMargin: 30,
    debtToEquity: 0.31,
    beta: 0.91,
    analystTarget: 470,
    analystRating: "Strong Buy",
    analystCount: 51,
    catalyst: "Azure AI growth · Copilot adoption",
    moat: "Enterprise software distribution and Azure make Microsoft one of the stickiest platforms in the market.",
    plainBull: "AI can raise software pricing and cloud demand across a massive installed base.",
    plainBear: "The stock already prices in a lot of AI success."
  },
  AMD: {
    name: "Advanced Micro Devices",
    sector: "Semiconductors",
    marketCap: 262000000000,
    pe: 248,
    forwardPe: 35.9,
    ps: 10.8,
    grossMargin: 51,
    revenueGrowth: 10,
    freeCashFlowMargin: 8,
    debtToEquity: 0.05,
    beta: 1.85,
    analystTarget: 190,
    analystRating: "Buy",
    analystCount: 42,
    catalyst: "MI300 / AI GPU share · Data center CPU cycle",
    moat: "AMD has strong CPU execution and an emerging AI accelerator business.",
    plainBull: "If MI300 adoption broadens, earnings can grow into the valuation.",
    plainBear: "AI GPU expectations are high, and Nvidia remains the default buyer choice."
  },
  GOOGL: {
    name: "Alphabet Inc.",
    sector: "Search and cloud",
    marketCap: 2140000000000,
    pe: 21.4,
    forwardPe: 19.2,
    ps: 6.5,
    grossMargin: 58,
    revenueGrowth: 15,
    freeCashFlowMargin: 23,
    debtToEquity: 0.11,
    beta: 1.04,
    analystTarget: 205,
    analystRating: "Buy",
    analystCount: 45,
    catalyst: "Search + cloud AI monetization · Regulatory headline risk",
    moat: "Search intent data, YouTube, Android, and cloud scale are hard to replicate.",
    plainBull: "Search remains very profitable, and AI can improve ad tools if managed well.",
    plainBear: "Antitrust remedies and AI search disruption are real risks."
  },
  META: {
    name: "Meta Platforms",
    sector: "Social platforms",
    marketCap: 1270000000000,
    pe: 26.9,
    forwardPe: 23.1,
    ps: 8.7,
    grossMargin: 81,
    revenueGrowth: 21,
    freeCashFlowMargin: 31,
    debtToEquity: 0.25,
    beta: 1.22,
    analystTarget: 565,
    analystRating: "Buy",
    analystCount: 48,
    catalyst: "Reels monetization · AI ranking capex · regulatory headlines",
    moat: "Massive social graph, ad targeting, and AI ranking infrastructure support high margins.",
    plainBull: "AI ad tools are improving monetization, and cost discipline remains visible.",
    plainBear: "Privacy rules, platform regulation, and heavy AI capex can pressure returns."
  },
  COIN: {
    name: "Coinbase Global",
    sector: "Crypto exchange",
    marketCap: 55000000000,
    pe: 28.6,
    forwardPe: 32.4,
    ps: 9.8,
    grossMargin: 86,
    revenueGrowth: 38,
    freeCashFlowMargin: 24,
    debtToEquity: 0.48,
    beta: 3.44,
    analystTarget: 250,
    analystRating: "Hold",
    analystCount: 22,
    catalyst: "Rulemaking calendar · Rates · Token volatility",
    moat: "Regulated exchange brand, custody, and institutional relationships help Coinbase survive cycles.",
    plainBull: "Clear crypto rules and higher token prices can expand trading and custody revenue.",
    plainBear: "The business is volatile and regulation can still land in a restrictive way."
  },
  GEO: {
    name: "The GEO Group",
    sector: "Private detention & corrections",
    marketCap: 2100000000,
    pe: 8.4,
    forwardPe: 7.2,
    ps: 0.42,
    grossMargin: 28,
    revenueGrowth: 4,
    freeCashFlowMargin: 8,
    debtToEquity: 1.85,
    beta: 1.12,
    analystTarget: 18,
    analystRating: "Hold",
    analystCount: 4,
    catalyst: "ICE appropriations · detention bed utilization · contract renewals",
    moat: "Long-term facility contracts with federal agencies create recurring revenue when enforcement budgets are funded.",
    plainBull: "Multi-year ICE funding improves visibility for detention bed demand and renewals.",
    plainBear: "Policy limits on private detention or lower enforcement spending directly hit occupancy."
  },
  CXW: {
    name: "CoreCivic",
    sector: "Private detention & corrections",
    marketCap: 1800000000,
    pe: 9.1,
    forwardPe: 8.0,
    ps: 0.38,
    grossMargin: 26,
    revenueGrowth: 3,
    freeCashFlowMargin: 7,
    debtToEquity: 1.72,
    beta: 1.08,
    analystTarget: 16,
    analystRating: "Hold",
    analystCount: 3,
    catalyst: "DHS/ICE funding · immigration enforcement budgets",
    moat: "Federal detention contracts tie revenue to immigration enforcement appropriations cycles.",
    plainBull: "Sustained border enforcement funding supports facility utilization.",
    plainBear: "Enforcement budget cuts or shifts away from private operators reduce contract demand."
  },
  SPCX: {
    name: "Space Exploration Technologies Corp.",
    sector: "Aerospace & launch services",
    marketCap: 2800000000000,
    pe: null,
    forwardPe: null,
    ps: 18.4,
    grossMargin: 42,
    revenueGrowth: 38,
    freeCashFlowMargin: 12,
    debtToEquity: 0.18,
    beta: 1.85,
    analystTarget: 240,
    analystRating: "Buy",
    analystCount: 12,
    catalyst: "NASA launch contracts · Starlink · Starship milestones · post-IPO lock-up",
    moat: "Reusable launch cadence, vertical integration, and Starlink scale create a durable cost advantage in orbital access.",
    plainBull: "NASA and DoD launch awards plus Starlink growth can validate the newly public equity story.",
    plainBear: "IPO valuation embeds aggressive growth; launch failures or budget shifts at NASA would hit sentiment fast."
  },
  SPY: {
    name: "SPDR S&P 500 ETF",
    sector: "Broad market ETF",
    marketCap: null,
    pe: 24.5,
    forwardPe: 21.2,
    ps: 3.1,
    grossMargin: null,
    revenueGrowth: 5,
    freeCashFlowMargin: null,
    debtToEquity: null,
    beta: 1,
    analystTarget: 560,
    analystRating: "ETF",
    analystCount: null,
    catalyst: "Fed path · earnings breadth · mega-cap concentration",
    moat: "Diversification across the largest U.S. companies.",
    plainBull: "Broad earnings growth and falling rates can support the index.",
    plainBear: "Large-cap concentration makes the ETF sensitive to mega-cap tech valuation."
  },
  QQQ: {
    name: "Invesco QQQ ETF",
    sector: "Nasdaq 100 ETF",
    marketCap: null,
    pe: 31.7,
    forwardPe: 27.4,
    ps: 5.4,
    grossMargin: null,
    revenueGrowth: 9,
    freeCashFlowMargin: null,
    debtToEquity: null,
    beta: 1.06,
    analystTarget: 480,
    analystRating: "ETF",
    analystCount: null,
    catalyst: "Rates · growth earnings · semis / mega-cap tech",
    moat: "Diversified exposure to the largest Nasdaq growth companies.",
    plainBull: "AI and software earnings can keep growth above the broad market.",
    plainBear: "High multiple growth stocks are sensitive to interest rates and disappointment."
  }
};

const CRYPTO_FALLBACK = {
  bitcoin: { name: "Bitcoin", symbol: "BTC", price: 68420, pct: 3.17, marketCap: 1347000000000 },
  ethereum: { name: "Ethereum", symbol: "ETH", price: 3291, pct: -1.44, marketCap: 395000000000 },
  solana: { name: "Solana", symbol: "SOL", price: 172, pct: 4.2, marketCap: 81000000000 }
};

const GOVERNMENT_SIGNAL_EXPOSURES = {
  NVDA: [
    "AI chip export controls",
    "AI infrastructure spending",
    "semiconductor subsidies",
    "China policy"
  ],
  AMD: [
    "AI chip export controls",
    "semiconductor subsidies",
    "data-center procurement",
    "China policy"
  ],
  AAPL: [
    "platform antitrust rules",
    "China policy",
    "app-store regulation",
    "supply-chain trade rules"
  ],
  AMZN: [
    "platform antitrust rules",
    "cloud procurement",
    "labor regulation",
    "data-center energy permitting"
  ],
  GOOGL: [
    "search antitrust remedies",
    "AI regulation",
    "cloud procurement",
    "privacy rules"
  ],
  META: [
    "privacy rules",
    "AI regulation",
    "platform competition policy",
    "content moderation scrutiny"
  ],
  MSFT: [
    "cloud procurement",
    "AI infrastructure spending",
    "cybersecurity rules",
    "antitrust review"
  ],
  LLY: [
    "Medicare drug pricing",
    "FDA approvals",
    "patent policy",
    "health-care reimbursement"
  ],
  TSLA: [
    "EV tax credits",
    "factory and charging permitting",
    "China trade policy",
    "safety investigations"
  ],
  COIN: [
    "crypto market-structure bills",
    "SEC/CFTC rulemaking",
    "stablecoin regulation",
    "banking access policy"
  ],
  GEO: ["ICE detention funding", "DHS appropriations", "immigration enforcement budgets"],
  CXW: ["ICE detention funding", "DHS appropriations", "immigration enforcement budgets"],
  PLTR: ["DHS surveillance contracts", "immigration enforcement IT", "defense AI procurement"],
  BAH: ["DHS IT modernization", "federal consulting budgets", "cybersecurity procurement"],
  SPCX: [
    "NASA launch services contracts",
    "DoD space launch procurement",
    "National security space budgets",
    "Starlink government connectivity"
  ],
  SPY: [
    "Federal Reserve path",
    "tax policy",
    "budget negotiations",
    "regulatory climate"
  ],
  QQQ: [
    "AI regulation",
    "antitrust enforcement",
    "export controls",
    "rate policy"
  ]
};

const RAW_POLICY_BILLS = [
  {
    id: "S.2547-119",
    title: "Drug Price Negotiation Expansion Act",
    shortTitle: "Medicare negotiates 50 more drug prices per year",
    chamber: "Senate",
    status: "committee",
    sponsor: { name: "B. Sanders", party: "I", state: "VT" },
    cosponsors: 23,
    bipartisanCosponsors: 4,
    floorScheduled: false,
    latestAction: "Reported out of committee 14-9",
    latestActionDate: "2026-04-28",
    tags: ["health", "pharma", "Medicare", "drug pricing"],
    portfolioTickers: ["LLY"],
    historicalAnalog: {
      title: "ACA Drug Pricing Provision (2022)",
      outcome:
        "Failed Senate cloture 50-50; Inflation Reduction Act passed watered-down version (10 drugs, not 50). Similar committee trajectory.",
      impact: "Pharma stocks recovered within six months after the hardest pricing scenario faded."
    },
    signals: {
      bipartisanScore: 55,
      committeeScore: 72,
      floorScore: 20,
      historicalScore: 40
    },
    affected: ["LLY", "MRK", "PFE", "ABBV", "UNH", "CVS"],
    lobbyingAgainst: 31,
    lobbyingFor: 2.1,
    lobbyingNote: "Pfizer, Merck, AbbVie combined $31M — 2.8x their normal quarterly spend. PhRMA trade group added $12M on top. When pharma triples lobbying spend, they believe the bill actually has a path.",
    plainEnglish: "Currently Medicare can only negotiate prices on 10 drugs per year (from the Inflation Reduction Act). This bill expands that to 50 drugs annually — and LLY's GLP-1 drugs hit Medicare volume thresholds next year.",
    signal: "Pharma opposition spend is 2.8x normal quarterly pace, which means the bill is being treated as real revenue risk.",
    impact: "If passed, large-cap pharma faces margin compression. If it dies, pricing overhang likely clears.",
    passImpacts: [
      { sym: "LLY", dir: -1, range: "-8 to -15%", why: "Mounjaro/Zepbound hit Medicare volume threshold in 2026" },
      { sym: "MRK", dir: -1, range: "-5 to -10%", why: "Keytruda is a prime negotiation target" },
      { sym: "PFE", dir: -1, range: "-4 to -8%", why: "Multiple drugs in the negotiation pool" },
      { sym: "ABBV", dir: -1, range: "-6 to -12%", why: "Humira/Skyrizi pricing at risk" },
      { sym: "UNH", dir: 1, range: "+3 to +6%", why: "Lower drug costs reduce claim payouts" },
      { sym: "CVS", dir: 1, range: "+2 to +4%", why: "PBM margins improve on negotiated drugs" }
    ],
    failImpacts: [
      { sym: "LLY", dir: 1, range: "+4 to +8%", why: "Pricing power protected, overhang removed" },
      { sym: "MRK", dir: 1, range: "+2 to +5%", why: "Revenue forecasts intact" },
      { sym: "PFE", dir: 1, range: "+2 to +4%", why: "Pricing overhang clears" }
    ]
  },
  {
    id: "H.R.4521-119",
    title: "CHIPS and Science Act Implementation",
    shortTitle: "Semiconductor manufacturing grants disbursing",
    chamber: "House",
    status: "passed",
    sponsor: { name: "Bipartisan", party: "B", state: "" },
    cosponsors: 218,
    bipartisanCosponsors: 218,
    floorScheduled: false,
    latestAction: "Signed into law. Grant disbursements underway.",
    latestActionDate: "2026-03-15",
    tags: ["technology", "semiconductors", "manufacturing", "AI"],
    portfolioTickers: ["NVDA"],
    historicalAnalog: {
      title: "CHIPS Act passage (2022)",
      outcome: "Passed 64-33 Senate, 243-187 House. Semiconductor stocks rallied 8-12% in the week following passage.",
      impact: "NVDA +9.2%, INTC +8.1%, AMAT +11.4% in the week after final passage."
    },
    signals: {
      bipartisanScore: 95,
      committeeScore: 100,
      floorScore: 100,
      historicalScore: 88
    },
    affected: ["NVDA", "INTC", "TSM", "AMAT", "ASML"],
    lobbyingAgainst: 1.2,
    lobbyingFor: 24,
    lobbyingNote: "Semiconductor industry spent $24M lobbying FOR implementation. TSMC, Intel, Samsung, Micron all filed for grants. 4 semiconductor CEOs mentioned CHIPS Act timelines in Q1 earnings calls.",
    plainEnglish: "The CHIPS Act already passed in 2022. This is the implementation phase where the $52B in fab grants are being distributed. Nvidia benefits indirectly as TSMC expands US capacity.",
    signal: "Semiconductor companies are lobbying for implementation speed, not for initial passage.",
    impact: "Supply-chain localization reduces geopolitical risk and supports domestic fab equipment demand.",
    passImpacts: [
      { sym: "NVDA", dir: 1, range: "+5 to +10%", why: "TSMC US capacity expansion = supply security, geopolitical risk reduction" },
      { sym: "INTC", dir: 1, range: "+8 to +14%", why: "Direct grant recipient — Columbus OH fab funded" },
      { sym: "TSM", dir: 1, range: "+4 to +8%", why: "Arizona fab expansion grants reduce capital cost" },
      { sym: "AMAT", dir: 1, range: "+6 to +10%", why: "Fab equipment orders surge with new US fabs" },
      { sym: "ASML", dir: 1, range: "+3 to +6%", why: "Lithography demand from US fab expansion" }
    ],
    failImpacts: []
  },
  {
    id: "H.R.7813-119",
    title: "Platform Competition and Opportunity Act",
    shortTitle: "Restricts platform self-preferencing",
    chamber: "House",
    status: "committee",
    sponsor: { name: "D. Cicilline", party: "D", state: "RI" },
    cosponsors: 12,
    bipartisanCosponsors: 3,
    floorScheduled: false,
    latestAction: "Markup postponed — insufficient votes",
    latestActionDate: "2026-02-14",
    tags: ["technology", "antitrust", "platform"],
    portfolioTickers: ["AMZN", "AAPL", "GOOGL", "META"],
    historicalAnalog: {
      title: "American Choice and Innovation Online Act (2022)",
      outcome: "Died in Senate after similar trajectory; never reached floor despite committee clearance.",
      impact: "Mega-cap tech priced an 8-12% risk premium when active; recovered when bills stalled."
    },
    signals: {
      bipartisanScore: 30,
      committeeScore: 20,
      floorScore: 5,
      historicalScore: 25
    },
    affected: ["AMZN", "AAPL", "GOOGL", "META"],
    lobbyingAgainst: 18.4,
    lobbyingFor: 0.8,
    lobbyingNote: "AMZN, AAPL, GOOGL, META combined $18.4M against. Key signal: small business groups lobbying alongside tech companies. When natural enemies align, the bill's political coalition becomes untenable.",
    plainEnglish: "Would ban Amazon from favoring Amazon Basics, Apple from giving its own apps placement advantages, and Google from putting its own services above organic results. Legislative momentum faded after an unusual coalition formed against it.",
    signal: "Small-business groups and mega-cap platforms are unusually aligned against the bill, weakening the coalition.",
    impact: "Failure removes antitrust risk premium from mega-cap platform names.",
    passImpacts: [
      { sym: "AMZN", dir: -1, range: "-8 to -14%", why: "Marketplace neutrality destroys algorithmic advantage" },
      { sym: "AAPL", dir: -1, range: "-5 to -9%", why: "App Store search placement restrictions" },
      { sym: "GOOGL", dir: -1, range: "-6 to -11%", why: "Search result self-preferencing banned" },
      { sym: "META", dir: -1, range: "-3 to -6%", why: "Ad targeting restrictions on own-platform data" }
    ],
    failImpacts: [
      { sym: "AMZN", dir: 1, range: "+4 to +8%", why: "Antitrust overhang cleared — marketplace model intact" },
      { sym: "AAPL", dir: 1, range: "+2 to +5%", why: "App Store pricing power preserved" },
      { sym: "GOOGL", dir: 1, range: "+3 to +6%", why: "Search ad dominance protected" }
    ]
  },
  {
    id: "S.1823-119",
    title: "Digital Asset Market Structure Act",
    shortTitle: "Clarifies SEC and CFTC jurisdiction for crypto",
    chamber: "Senate",
    status: "committee",
    sponsor: { name: "C. Lummis", party: "R", state: "WY" },
    cosponsors: 8,
    bipartisanCosponsors: 3,
    floorScheduled: false,
    latestAction: "Joint committee hearing held. 60-day comment period open.",
    latestActionDate: "2026-04-10",
    tags: ["crypto", "financial", "SEC", "regulation"],
    portfolioTickers: ["COIN"],
    historicalAnalog: {
      title: "FIT21 Act (2024)",
      outcome: "Passed House 279-136 bipartisan; stalled in Senate.",
      impact: "COIN +22% the week FIT21 passed House; retraced when Senate did not move."
    },
    signals: {
      bipartisanScore: 60,
      committeeScore: 45,
      floorScore: 30,
      historicalScore: 35
    },
    affected: ["COIN", "BTC", "ETH"],
    lobbyingAgainst: 1.1,
    lobbyingFor: 6.2,
    lobbyingNote: "Crypto industry (Coinbase, Ripple, Binance.US) spending $6.2M FOR passage — unusual to see industry spend FOR regulation, but clarity is worth it. Traditional finance lobby mildly opposed.",
    plainEnglish: "The biggest unresolved question in crypto: is Bitcoin a security or a commodity? This bill would define which assets are under SEC vs CFTC jurisdiction. Clarity = bullish for crypto. Currently in 60-day public comment period.",
    signal: "Crypto firms are spending for regulation because jurisdictional clarity is worth more than ambiguity.",
    impact: "Passage is structurally bullish for compliant exchanges; failure keeps enforcement uncertainty alive.",
    passImpacts: [
      { sym: "COIN", dir: 1, range: "+15 to +30%", why: "Business certainty — Coinbase's regulatory cloud cleared" },
      { sym: "BTC", dir: 1, range: "+8 to +15%", why: "Institutional confidence unlocked with clear rules" },
      { sym: "ETH", dir: 1, range: "+10 to +18%", why: "Likely commodity classification reduces SEC overhang" }
    ],
    failImpacts: [
      { sym: "COIN", dir: -1, range: "-8 to -15%", why: "Status quo ambiguity remains — continued regulatory risk" },
      { sym: "BTC", dir: -1, range: "-3 to -6%", why: "Uncertainty overhang continues" }
    ]
  },
  {
    id: "S.3891-119",
    title: "Clean Energy Permitting Reform Act",
    shortTitle: "Speeds federal permits for EV and clean-energy projects",
    chamber: "Senate",
    status: "markup",
    sponsor: { name: "J. Manchin", party: "I", state: "WV" },
    cosponsors: 31,
    bipartisanCosponsors: 14,
    floorScheduled: true,
    latestAction: "Markup session completed. Reported favorably 12-10.",
    latestActionDate: "2026-04-22",
    tags: ["energy", "environment", "EV", "clean energy"],
    portfolioTickers: ["TSLA"],
    historicalAnalog: {
      title: "Fiscal Responsibility Act permitting provisions (2023)",
      outcome: "Passed with narrower permitting reforms than standalone bills.",
      impact: "Clean energy names moved +3-5% on headline permitting relief."
    },
    signals: {
      bipartisanScore: 72,
      committeeScore: 68,
      floorScore: 60,
      historicalScore: 55
    },
    affected: ["TSLA", "ENPH", "FSLR"],
    lobbyingAgainst: 8.4,
    lobbyingFor: 11.2,
    lobbyingNote: "Unusual: oil & gas AND clean energy companies both lobbying FOR this bill — permitting reform benefits all energy projects. Only environmental groups opposing. When industry and green groups align, passage momentum is real.",
    plainEnglish: "Current federal permitting for EV charging, battery manufacturing, and renewable energy projects takes 4-7 years on average. This bill would cap the timeline at 2 years for most projects. Directly benefits Tesla's Gigafactory expansion pipeline.",
    signal: "Oil, gas, and clean-energy companies all benefit from faster permitting, which creates rare cross-industry support.",
    impact: "Faster approvals help project timelines but do not fix EV demand or margin pressure by themselves.",
    passImpacts: [
      { sym: "TSLA", dir: 1, range: "+3 to +7%", why: "Gigafactory and Supercharger expansion timelines compress from 6 years to 2" },
      { sym: "ENPH", dir: 1, range: "+5 to +9%", why: "Solar install permitting dramatically faster" },
      { sym: "FSLR", dir: 1, range: "+4 to +8%", why: "Large-scale solar approvals faster" }
    ],
    failImpacts: [{ sym: "TSLA", dir: -1, range: "-2 to -4%", why: "Permitting bottlenecks remain — expansion slower" }]
  },
  {
    id: "H.R.3456-119",
    title: "AI Accountability and Transparency Act",
    shortTitle: "Disclosures and audits for high-risk AI systems",
    chamber: "House",
    status: "introduced",
    sponsor: { name: "T. Lieu", party: "D", state: "CA" },
    cosponsors: 6,
    bipartisanCosponsors: 1,
    floorScheduled: false,
    latestAction: "Referred to committee. No hearing scheduled.",
    latestActionDate: "2026-03-02",
    tags: ["AI", "technology", "regulation"],
    portfolioTickers: ["NVDA", "MSFT", "GOOGL", "META"],
    historicalAnalog: {
      title: "EU AI Act analogues",
      outcome: "US Congress has not passed AI-specific legislation; most bills die in committee.",
      impact: "Limited historical US market reaction to draft AI disclosure bills."
    },
    signals: {
      bipartisanScore: 15,
      committeeScore: 10,
      floorScore: 5,
      historicalScore: 20
    },
    affected: ["NVDA", "MSFT", "GOOGL", "META"],
    lobbyingAgainst: 4.1,
    lobbyingFor: 0.3,
    lobbyingNote:
      "Big tech spending $4.1M against. Routine opposition — not the 3x spike that signals existential legislative threat. Low momentum environment.",
    plainEnglish:
      "Would require algorithmic audits and transparency reports for high-risk AI in healthcare, finance, hiring, and criminal justice. Disclosure burden, not a ban.",
    signal: "Low-intensity lobbying and stalled committee calendar suggest limited near-term passage risk.",
    impact: "Mostly compliance overhead for cloud and platform names if it ever advances.",
    passImpacts: [
      { sym: "NVDA", dir: -1, range: "-1 to -3%", why: "Hardware not directly regulated; sentiment drag possible" },
      { sym: "MSFT", dir: -1, range: "-1 to -2%", why: "Compliance and audit costs" },
      { sym: "GOOGL", dir: -1, range: "-1 to -2%", why: "Audit and disclosure overhead" }
    ],
    failImpacts: [{ sym: "NVDA", dir: 0, range: "Minimal", why: "Low momentum limits risk premium" }]
  },
  {
    id: "H.R.6023-119",
    title: "Foreign Investment Transparency and Security Act",
    shortTitle: "Chinese investment restrictions in semis and AI",
    chamber: "House",
    status: "committee",
    sponsor: { name: "M. McCaul", party: "R", state: "TX" },
    cosponsors: 44,
    bipartisanCosponsors: 22,
    floorScheduled: false,
    latestAction: "Passed House Foreign Affairs Committee 32-8. Referred to Intel Committee.",
    latestActionDate: "2026-04-18",
    tags: ["foreign policy", "technology", "China", "national security"],
    portfolioTickers: ["NVDA", "TSM", "ASML"],
    historicalAnalog: {
      title: "CHIPS export controls + BIS expansions",
      outcome: "National-security framed trade rules have repeatedly advanced with bipartisan support.",
      impact: "NVDA sold off ~15% on initial H100 export headlines; incremental rules add headline risk."
    },
    signals: {
      bipartisanScore: 78,
      committeeScore: 65,
      floorScore: 35,
      historicalScore: 62
    },
    affected: ["NVDA", "TSM", "ASML", "INTC"],
    lobbyingAgainst: 2.8,
    lobbyingFor: 3.2,
    lobbyingNote:
      "Balanced filing environment: defense groups for, Chamber types against. Strong bipartisan cosponsor count is the bullish passage signal.",
    plainEnglish:
      "Would expand CFIUS-style screening for Chinese-linked investment into US semiconductor and AI companies. Highest sensitivity for China revenue exposure.",
    signal: "Bipartisan committee momentum contrasts with typical partisan tech fights.",
    impact: "Passage raises compliance and capital access concerns for fabs and designers with China links.",
    passImpacts: [
      { sym: "NVDA", dir: -1, range: "-4 to -9%", why: "China datacenter revenue further constrained" },
      { sym: "TSM", dir: -1, range: "-3 to -7%", why: "Advanced-node China demand risk" },
      { sym: "ASML", dir: -1, range: "-2 to -5%", why: "Further tightening of China equipment paths" },
      { sym: "INTC", dir: 1, range: "+2 to +4%", why: "US-only manufacturing relative winner" }
    ],
    failImpacts: [{ sym: "NVDA", dir: 1, range: "+3 to +6%", why: "China revenue overhang partially lifts" }]
  }
];

const LOBBYING_FALLBACK = [
  { client: "Eli Lilly and Company", registrant: "Cornerstone Government Affairs", amount: 4200000, issue: "Medicare pricing", spike: 3.1, portfolio: true },
  { client: "AbbVie Inc.", registrant: "Sidley Austin LLP", amount: 4800000, issue: "Drug pricing", spike: 2.9, portfolio: false },
  { client: "NVIDIA Corporation", registrant: "Holland & Knight LLP", amount: 1680000, issue: "Export controls and AI policy", spike: 1.0, portfolio: true },
  { client: "Amazon.com Inc.", registrant: "Squire Patton Boggs", amount: 2760000, issue: "Antitrust and e-commerce", spike: 1.4, portfolio: true },
  { client: "Coinbase Global Inc.", registrant: "Crypto Council for Innovation", amount: 2200000, issue: "Digital assets", spike: 1.8, portfolio: false }
];

const RAW_POLICY_STAKEHOLDERS = {
  "S.2547-119": {
    lawmakers: [
      { name: "Sen. Bernie Sanders", party: "I", state: "VT", role: "Sponsor", stance: "for", influence: 88, note: "Drug-pricing advocate; sponsor pressure keeps the issue alive." },
      { name: "Senate Finance members", party: "Mixed", state: "US", role: "Gatekeepers", stance: "watch", influence: 82, note: "Committee members decide whether Medicare pricing language reaches the floor." },
      { name: "Moderate Senate Democrats", party: "D", state: "US", role: "Swing bloc", stance: "watch", influence: 67, note: "Their support determines how aggressive the final bill can be." }
    ],
    committees: [
      { name: "Senate Finance Committee", role: "Medicare and revenue gatekeeper", influence: 92, stance: "active" },
      { name: "Senate HELP Committee", role: "Health policy pressure source", influence: 64, stance: "supportive" }
    ],
    lobbying: [
      { name: "Eli Lilly and Company", stance: "against", amount: 4200000, issue: "Medicare pricing", tickers: ["LLY"], relationship: "Protects GLP-1 pricing power and Medicare revenue." },
      { name: "PhRMA", stance: "against", amount: 12000000, issue: "Drug pricing", tickers: ["LLY", "MRK", "PFE", "ABBV"], relationship: "Industry-wide defense against price negotiation expansion." },
      { name: "AARP", stance: "for", amount: 2100000, issue: "Medicare affordability", tickers: ["UNH", "CVS"], relationship: "Supports lower patient drug costs, which can pressure pharma but help payers." }
    ],
    tickerImpacts: [
      { symbol: "LLY", direction: "downside", impact: "-8% to -15%", mechanism: "Medicare negotiation could reduce GLP-1 pricing power." },
      { symbol: "MRK", direction: "downside", impact: "-5% to -10%", mechanism: "Large Medicare-exposed drugs become negotiation candidates." },
      { symbol: "UNH", direction: "upside", impact: "+3% to +6%", mechanism: "Lower drug costs can reduce claims pressure." }
    ],
    analog: "Inflation Reduction Act drug provisions: pharma sold off around pricing risk, then recovered as final scope narrowed.",
    nextWatch: "New bipartisan cosponsors, floor scheduling, and another quarter of pharma LDA filings."
  },
  "H.R.4521-119": {
    lawmakers: [
      { name: "Commerce Committee leadership", party: "Mixed", state: "US", role: "Implementation oversight", stance: "for", influence: 76, note: "Keeps grant timing and eligibility language moving." },
      { name: "Semiconductor-state delegations", party: "Mixed", state: "AZ/OH/TX", role: "Regional pressure", stance: "for", influence: 72, note: "Members with fabs in-state want faster disbursements." }
    ],
    committees: [
      { name: "Commerce, Science, and Transportation", role: "Funding oversight", influence: 86, stance: "active" },
      { name: "Appropriations", role: "Disbursement timing", influence: 74, stance: "active" }
    ],
    lobbying: [
      { name: "NVIDIA Corporation", stance: "for", amount: 1680000, issue: "AI policy and supply chain", tickers: ["NVDA"], relationship: "Benefits indirectly when advanced packaging and foundry capacity are less geopolitically fragile." },
      { name: "Semiconductor Industry Association", stance: "for", amount: 8200000, issue: "CHIPS grants", tickers: ["NVDA", "AMD", "TSM", "ASML"], relationship: "Pushes faster implementation across the chip supply chain." },
      { name: "Intel Corporation", stance: "for", amount: 3100000, issue: "Domestic manufacturing grants", tickers: ["INTC"], relationship: "Direct grant recipient; wants fab funding certainty." }
    ],
    tickerImpacts: [
      { symbol: "NVDA", direction: "upside", impact: "+5% to +10%", mechanism: "Supply-chain security lowers geopolitical risk around AI accelerators." },
      { symbol: "TSM", direction: "upside", impact: "+4% to +8%", mechanism: "Arizona expansion grants can reduce capital burden." },
      { symbol: "ASML", direction: "upside", impact: "+3% to +6%", mechanism: "More fab builds can pull forward equipment demand." }
    ],
    analog: "Original CHIPS Act passage: semis rallied as the market priced public support for domestic manufacturing.",
    nextWatch: "Grant award timing, fab construction milestones, and export-control amendments."
  },
  "H.R.7813-119": {
    lawmakers: [
      { name: "House Judiciary Antitrust Subcommittee", party: "Mixed", state: "US", role: "Bill sponsor lane", stance: "for", influence: 78, note: "The subcommittee creates pressure even when floor odds are weak." },
      { name: "Small-business caucus members", party: "Mixed", state: "US", role: "Coalition swing", stance: "watch", influence: 61, note: "If this bloc defects, the bill loses its pro-small-business story." }
    ],
    committees: [
      { name: "House Judiciary Committee", role: "Markup gatekeeper", influence: 88, stance: "stalled" }
    ],
    lobbying: [
      { name: "Amazon.com Inc.", stance: "against", amount: 2760000, issue: "Marketplace rules", tickers: ["AMZN"], relationship: "Protects marketplace search, private-label, and advertising economics." },
      { name: "Apple Inc.", stance: "against", amount: 2100000, issue: "App Store placement", tickers: ["AAPL"], relationship: "Protects App Store economics and default app placement." },
      { name: "Technology trade groups", stance: "against", amount: 9600000, issue: "Platform regulation", tickers: ["AMZN", "AAPL", "GOOGL", "META"], relationship: "Coordinates opposition across large platforms." }
    ],
    tickerImpacts: [
      { symbol: "AMZN", direction: "upside", impact: "+4% to +8% if it dies", mechanism: "Marketplace self-preferencing risk fades." },
      { symbol: "AAPL", direction: "upside", impact: "+2% to +5% if it dies", mechanism: "App Store placement and fee risk eases." },
      { symbol: "GOOGL", direction: "upside", impact: "+3% to +6% if it dies", mechanism: "Search and vertical placement risk eases." }
    ],
    analog: "American Choice and Innovation Online Act: cleared committee attention but failed to reach durable floor momentum.",
    nextWatch: "Markup reschedule, small-business coalition changes, and new antitrust enforcement headlines."
  },
  "S.1823-119": {
    lawmakers: [
      { name: "Sen. Cynthia Lummis", party: "R", state: "WY", role: "Sponsor", stance: "for", influence: 80, note: "Frames market-structure clarity as a competitive advantage for U.S. crypto." },
      { name: "Senate Banking members", party: "Mixed", state: "US", role: "Jurisdiction gatekeepers", stance: "watch", influence: 84, note: "They decide how much SEC authority remains in the final draft." }
    ],
    committees: [
      { name: "Senate Banking Committee", role: "SEC jurisdiction", influence: 90, stance: "active" },
      { name: "Senate Agriculture Committee", role: "CFTC jurisdiction", influence: 76, stance: "active" }
    ],
    lobbying: [
      { name: "Coinbase Global Inc.", stance: "for", amount: 2200000, issue: "Digital assets", tickers: ["COIN"], relationship: "Clarity lowers enforcement uncertainty for exchange and custody revenue." },
      { name: "Crypto Council for Innovation", stance: "for", amount: 1800000, issue: "Market structure", tickers: ["COIN", "BTC", "ETH"], relationship: "Pushes rule clarity across token markets." },
      { name: "Traditional finance associations", stance: "against", amount: 1100000, issue: "Exchange competition", tickers: ["COIN"], relationship: "Can slow language that advantages crypto-native venues." }
    ],
    tickerImpacts: [
      { symbol: "COIN", direction: "upside", impact: "+15% to +30%", mechanism: "Regulatory clarity can expand institutional exchange and custody demand." },
      { symbol: "BTC", direction: "upside", impact: "+8% to +15%", mechanism: "Clearer commodity treatment can pull in cautious institutional buyers." },
      { symbol: "ETH", direction: "upside", impact: "+10% to +18%", mechanism: "Jurisdiction clarity reduces security-classification overhang." }
    ],
    analog: "FIT21 House passage: COIN rallied sharply, then gave back gains when Senate momentum faded.",
    nextWatch: "Committee language, SEC/CFTC split, and whether bipartisan cosponsors increase."
  },
  "S.3891-119": {
    lawmakers: [
      { name: "Senate Energy and Natural Resources members", party: "Mixed", state: "US", role: "Markup gatekeepers", stance: "for", influence: 83, note: "Committee support matters because permitting reform crosses energy factions." },
      { name: "Energy-state senators", party: "Mixed", state: "US", role: "Swing coalition", stance: "for", influence: 74, note: "Fossil and clean-energy interests can both support faster permitting." }
    ],
    committees: [
      { name: "Senate Energy and Natural Resources", role: "Markup and floor recommendation", influence: 88, stance: "active" },
      { name: "Environment and Public Works", role: "Environmental review language", influence: 70, stance: "watch" }
    ],
    lobbying: [
      { name: "Tesla Inc.", stance: "for", amount: 890000, issue: "EV infrastructure and permitting", tickers: ["TSLA"], relationship: "Faster permits can help factories, chargers, and energy deployments." },
      { name: "Clean energy developers", stance: "for", amount: 5300000, issue: "Project approvals", tickers: ["ENPH", "FSLR", "TSLA"], relationship: "Supports faster utility-scale approvals." },
      { name: "Environmental groups", stance: "against", amount: 2400000, issue: "Review standards", tickers: ["TSLA", "ENPH"], relationship: "Can force narrower language or longer timelines." }
    ],
    tickerImpacts: [
      { symbol: "TSLA", direction: "upside", impact: "+3% to +7%", mechanism: "Faster approval cycles can improve factory, charging, and energy project timelines." },
      { symbol: "ENPH", direction: "upside", impact: "+5% to +9%", mechanism: "Solar deployments benefit from faster local and federal approvals." }
    ],
    analog: "Fiscal Responsibility Act permitting provisions: clean-energy names moved on faster-project-cycle expectations.",
    nextWatch: "Floor calendar, environmental review amendments, and cross-industry lobbying changes."
  }
};

let POLICY_BILLS = initializePolicyBills(RAW_POLICY_BILLS);
const POLICY_STAKEHOLDERS = remapStakeholderKeys(RAW_POLICY_STAKEHOLDERS);

/** In-memory Congress.gov overlays refreshed on interval and /api/congress/bills. */
const congressLiveCache = new Map();
const liveBillAnalysisCache = new Map();
/** Bills discovered from Congress.gov list (not in POLICY_BILLS seeds). */
const liveCongressBillRegistry = new Map();
/** In-flight Congress.gov fetches keyed by canonical bill id. */
const congressBillFetchInflight = new Map();
/** Live LDA aggregates per bill id (no seed lobbying dollars). */
const billLobbyingOverlay = new Map();
let lastSeedValidation = null;

// ══════════════════════════════════════════════════════════════════════════════
// GOVERNMENT CONTRACT INTELLIGENCE
//
// Two separate scoring functions with two separate jobs:
// 1. computeGovernmentDependencyScore(symbol)
//    Company-level structural exposure. Used in the risk radar.
//    Does NOT use award amounts. Based on 10-K revenue mix and renewal profile.
//
// 2. computeContractEventSignal(symbol, awardAmount, agencyName)
//    Event-level signal. Used on individual contract award cards.
//    Based on CRS v2: Dependency + AgencySignal + AwardNovelty + RenewalRisk.
//    Calibrated: Spearman IC=0.145 (p=0.012), 282 events, 2015-2024.
//
// Key empirical findings:
//   - Large awards are often pre-priced (Q4 awards → -0.7% vs Q1 → +5.9% 20-day AR)
//   - Agency type matters more than award size (HHS/VA → +4.1% vs DoD → +0.9%)
//   - PLTR shows uniquely strong post-award drift (+9.1% mean 20-day AR, p=0.003)
//   - CRS is a research signal, NOT a buy/sell recommendation
// ══════════════════════════════════════════════════════════════════════════════

const CONTRACT_PROFILES = {
  LMT: {
    governmentRevenuePct: 0.94,
    renewalRisk: 0.30,
    primaryAgencies: ["Department of Defense", "Air Force", "Navy"],
    primaryPrograms: ["F-35 Lightning II", "Sikorsky helicopters", "missile systems"],
    dogeRisk: false,
    agencyBudgetRisk: "low",
    archetype: "Entrenched Contractor",
    linkedBillIds: [],
    note: "Lockheed derives 94% of revenue from government contracts, almost entirely defense. The F-35 program represents a multi-decade revenue stream with strong bipartisan congressional support.",
    archetypeExplain: "Large defense awards are heavily covered and often pre-announced via SAM.gov. The bigger question for LMT is whether defense budgets continue supporting the long-term program pipeline, not whether any single award is good news.",
    bull: "Multi-decade F-35 production and international sales provide long-duration revenue visibility.",
    bear: "F-35 cost overruns and a successful alternative aircraft program would be structural risks. DoD budget sequestration remains a tail risk."
  },
  BAH: {
    governmentRevenuePct: 0.97,
    renewalRisk: 0.60,
    primaryAgencies: ["Department of Defense", "NSA", "DHS", "civilian agencies"],
    primaryPrograms: ["IT modernization", "cybersecurity", "management consulting"],
    dogeRisk: true,
    agencyBudgetRisk: "high",
    archetype: "Fragile Contractor",
    linkedBillIds: [],
    note: "Booz Allen derives nearly all revenue from U.S. government clients. Management consulting is easier to defund than hardware programs. DOGE-style efficiency reviews are the clearest near-term risk.",
    archetypeExplain: "High government dependency with high recompete exposure creates fragility. Any federal spending environment shift is felt directly. Consulting contracts can be cancelled with less friction than weapons programs.",
    bull: "Long-term classified program exposure is difficult to cancel quickly and provides revenue stability.",
    bear: "97% government revenue means any federal workforce reduction or consulting cut is directly felt in earnings."
  },
  LDOS: {
    governmentRevenuePct: 0.88,
    renewalRisk: 0.55,
    primaryAgencies: ["Department of Defense", "VA", "HHS", "intelligence community"],
    primaryPrograms: ["IT services", "logistics", "health IT", "defense systems"],
    dogeRisk: true,
    agencyBudgetRisk: "medium",
    archetype: "Entrenched Contractor",
    linkedBillIds: [],
    note: "Leidos has both defense and civilian IT exposure. Civilian health and VA contracts may carry more new information than routine defense awards because they receive less market attention.",
    archetypeExplain: "LDOS is interesting because the civilian IT segment (VA, HHS) can surprise the market. Empirically, HHS and VA contracts produce stronger post-award drift than DoD contracts for IT companies.",
    bull: "Healthcare IT modernization at the VA is long-term and has bipartisan support.",
    bear: "IT services contracts are easier to cancel than weapons programs when budgets are under pressure."
  },
  SAIC: {
    governmentRevenuePct: 0.99,
    renewalRisk: 0.58,
    primaryAgencies: ["Department of Defense", "intelligence community", "civilian agencies"],
    primaryPrograms: ["defense IT", "C4ISR systems", "engineering services"],
    dogeRisk: true,
    agencyBudgetRisk: "medium",
    archetype: "Fragile Contractor",
    linkedBillIds: [],
    note: "SAIC is essentially a pure-play government contractor. Empirically, larger awards predict worse subsequent returns for SAIC (rho=-0.348, p=0.006), meaning big contracts are often already priced in by the time they appear on USASpending.",
    archetypeExplain: "Near-100% government revenue makes the spending environment critical. Large expected award vehicles are often already known. Smaller, novel program awards carry more signal.",
    bull: "Defense IT modernization is a multi-decade program with broad agency support.",
    bear: "Pure-play exposure means federal spending cuts hit immediately and directly."
  },
  PLTR: {
    governmentRevenuePct: 0.55,
    renewalRisk: 0.65,
    primaryAgencies: ["Department of Defense", "DHS", "CIA", "HHS"],
    primaryPrograms: ["Maven Smart System", "Gotham", "ImmigrationOS", "Foundry"],
    dogeRisk: true,
    agencyBudgetRisk: "medium",
    archetype: "Narrative-Sensitive Contractor",
    linkedBillIds: remapLinkedBillIds(["H.R.4521-119", "S.2-119"]),
    note: "PLTR is the only company in our calibration dataset with statistically significant post-award drift (+9.1% mean 20-day AR, p=0.003). Smaller, unexpected awards produce the most drift. Large IDIQ task orders are typically pre-priced.",
    archetypeExplain: "Investors use government AI adoption as evidence that PLTR's software platform is gaining durable institutional demand. A smaller award from a new agency can shift the narrative more than a big renewal of an existing program.",
    bull: "DoD AI spending is bipartisan and growing. New task orders expand both revenue and the platform adoption story.",
    bear: "Concentration in a few large DoD programs means one contract loss is an earnings-level event, not just a footnote."
  },
  GEO: {
    governmentRevenuePct: 0.72,
    renewalRisk: 0.68,
    primaryAgencies: ["Department of Homeland Security", "ICE", "U.S. Marshals Service"],
    primaryPrograms: ["immigration detention facilities", "community corrections"],
    dogeRisk: false,
    agencyBudgetRisk: "high",
    archetype: "Narrative-Sensitive Contractor",
    linkedBillIds: remapLinkedBillIds(["S.2-119"]),
    note: "GEO Group operates private detention facilities used by ICE. Appropriations and enforcement budgets directly affect bed-day demand and contract renewals.",
    archetypeExplain: "ICE detention funding is a direct revenue driver — when Congress advances multi-year enforcement appropriations, investors reprice detention operators on expected facility utilization.",
    bull: "Multi-year ICE funding reduces near-term appropriations uncertainty for detention operators.",
    bear: "Policy shifts away from private detention or lower enforcement budgets would hit utilization and contract renewals."
  },
  CXW: {
    governmentRevenuePct: 0.68,
    renewalRisk: 0.66,
    primaryAgencies: ["Department of Homeland Security", "ICE", "Federal Bureau of Prisons"],
    primaryPrograms: ["immigration detention", "correctional facilities"],
    dogeRisk: false,
    agencyBudgetRisk: "high",
    archetype: "Narrative-Sensitive Contractor",
    linkedBillIds: remapLinkedBillIds(["S.2-119"]),
    note: "CoreCivic runs immigration detention and corrections facilities. DHS/ICE appropriations are the primary demand signal.",
    archetypeExplain: "Border and immigration enforcement budgets flow to detention bed capacity — CoreCivic moves with ICE funding visibility more than broad market beta.",
    bull: "Sustained ICE appropriations support facility occupancy and renewal pipelines.",
    bear: "Enforcement budget cuts or policy limits on private detention reduce the addressable contract base."
  },
  SPCX: {
    governmentRevenuePct: 0.52,
    renewalRisk: 0.45,
    primaryAgencies: ["National Aeronautics and Space Administration", "Department of Defense", "Space Force"],
    primaryPrograms: ["Falcon 9 launch services", "Falcon Heavy", "Starship", "Starlink", "NASA VADR task orders"],
    dogeRisk: false,
    agencyBudgetRisk: "medium",
    archetype: "Narrative-Sensitive Contractor",
    linkedBillIds: [],
    note: "SpaceX derives a large share of revenue from NASA and DoD launch awards plus government Starlink connectivity. As a newly public company, smaller unexpected civilian-space awards can carry more narrative weight than routine NASA task orders.",
    archetypeExplain: "Federal launch awards validate capacity and backlog for investors watching post-IPO execution. NASA VADR and national-security launch task orders are direct revenue drivers — less about a single award size than sustained government demand visibility.",
    bull: "NASA and DoD launch pipelines plus Starlink government adoption support multi-year backlog visibility.",
    bear: "Launch failures, NASA budget cuts, or loss of national-security launch certification would hit both revenue and sentiment."
  }
};

/** Curated public figures → tickers (not live social feeds in v1). */
const FIGURE_LINKS = [
  {
    name: "Jensen Huang",
    label: "NVIDIA CEO — export control & AI infrastructure testimony",
    date: "2026-04-10",
    symbols: ["NVDA", "AMD"],
    url: "https://www.congress.gov/search?q=NVIDIA+export+controls"
  },
  {
    name: "Tim Cook",
    label: "Apple CEO — App Store & antitrust oversight hearing",
    date: "2026-03-22",
    symbols: ["AAPL", "GOOGL", "META"],
    url: "https://www.congress.gov/search?q=Apple+App+Store+antitrust"
  },
  {
    name: "Satya Nadella",
    label: "Microsoft CEO — federal AI procurement & cloud security briefing",
    date: "2026-04-05",
    symbols: ["MSFT", "NVDA", "PLTR"],
    url: "https://www.congress.gov/search?q=Microsoft+AI+government"
  },
  {
    name: "Bernie Sanders",
    label: "Senate sponsor — Medicare drug pricing expansion push",
    date: "2026-04-28",
    symbols: ["LLY", "MRK", "PFE", "ABBV"],
    url: "https://www.congress.gov/search?q=Medicare+drug+price+negotiation"
  },
  {
    name: "Brian Armstrong",
    label: "Coinbase CEO — digital asset market-structure testimony",
    date: "2026-03-18",
    symbols: ["COIN"],
    url: "https://www.congress.gov/search?q=crypto+market+structure"
  },
  {
    name: "Elon Musk",
    label: "SpaceX CEO — NASA launch contracts & space procurement policy",
    date: "2026-06-12",
    symbols: ["SPCX", "TSLA"],
    url: "https://www.congress.gov/search?q=SpaceX+NASA+launch"
  }
];

const FUND_TAGS = new Set(["legislation", "contracts", "lobbying", "figures", "custom"]);

const LOBBY_CLIENT_TICKERS = {
  "eli lilly": ["LLY"],
  "abbvie": ["ABBV"],
  "nvidia": ["NVDA"],
  "amazon": ["AMZN"],
  "coinbase": ["COIN"],
  "apple": ["AAPL"],
  "google": ["GOOGL"],
  "meta": ["META"],
  "microsoft": ["MSFT"],
  "intel": ["INTC"],
  "phrma": ["LLY", "MRK", "PFE", "ABBV"],
  "geo group": ["GEO"],
  "corecivic": ["CXW"],
  "palantir": ["PLTR"],
  "spacex": ["SPCX"],
  "space exploration": ["SPCX"]
};

// Agency signal scores: higher = less analyst coverage = more informational value
// Calibrated from empirical data:
//   HHS/VA contracts → +4.1% mean 20-day abnormal return (n=41)
//   DoD contracts → +0.9% mean 20-day abnormal return (n=162, noise level)
function agencySignalScore(agencyName) {
  if (!agencyName) return 55;
  const a = String(agencyName).toLowerCase();
  if (a.includes("health") || a.includes("veteran") || a.includes("hhs")) return 85;
  if (a.includes("homeland") || a.includes("transportation")) return 70;
  if (a.includes("energy") || a.includes("education") || a.includes("agriculture")) return 65;
  if (a.includes("defense") || a.includes("army") || a.includes("navy") ||
      a.includes("air force") || a.includes("marine") || a.includes("pentagon")) return 35;
  if (a.includes("general services") || a.includes("gsa")) return 45;
  return 55;
}

// Inverted log-size: smaller, more unexpected awards score higher
// Q1 awards (<$30M): +5.9% 20-day AR | Q4 awards (>$500M): -0.7% 20-day AR
// Large awards are typically pre-announced via SAM.gov and already priced in
function awardNoveltyScore(awardAmount) {
  const logAmt = Math.log(Math.max(Number(awardAmount) || 1e6, 1e6));
  // $10M=23.0 max, $10B=16.1 min (approx log scale)
  const raw = (23.0 - logAmt) / (23.0 - 16.1) * 100;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

// Company-level structural exposure — used for risk radar, NOT event scoring
// Measures how dependent the business model is on government money
function computeGovernmentDependencyScore(symbol) {
  const profile = CONTRACT_PROFILES[String(symbol || "").toUpperCase()];
  if (!profile) return null;
  const depScore     = profile.governmentRevenuePct * 100;                       // 0-100
  const renewScore   = profile.renewalRisk * 100;                                // 0-100
  const budgetScore  = profile.agencyBudgetRisk === "high" ? 80
    : profile.agencyBudgetRisk === "medium" ? 55 : 25;                          // 0-100
  const dogeScore    = profile.dogeRisk ? 70 : 30;                              // 0-100
  // Weights: dependency 45%, renewal 25%, budget risk 15%, efficiency review 15%
  const score = 0.45*depScore + 0.25*renewScore + 0.15*budgetScore + 0.15*dogeScore;
  return Math.round(Math.min(100, Math.max(0, score)));
}

// Event-level signal — used per contract award card
// Returns structured object with score, explanation, and watch items
function computeContractEventSignal(symbol, awardAmount, agencyName) {
  const profile = CONTRACT_PROFILES[String(symbol || "").toUpperCase()];
  if (!profile) return null;

  const dep     = profile.governmentRevenuePct * 100;  // 0-100
  const agSig   = agencySignalScore(agencyName);       // 0-100
  const novelty = awardNoveltyScore(awardAmount);      // 0-100
  const renewal = profile.renewalRisk * 100;           // 0-100

  // CRS v2 formula — calibrated weights
  const score = Math.round(Math.min(100, Math.max(0,
    0.30*dep + 0.30*agSig + 0.25*novelty + 0.15*renewal
  )));

  const label = score >= 75 ? "High signal"
    : score >= 45 ? "Monitor"
    : score >= 15 ? "Watch"
    : "Low signal";

  const agSigLabel = agSig >= 70 ? "less analyst coverage — higher surprise value"
    : agSig >= 50 ? "moderate analyst coverage"
    : "heavily covered — often pre-priced";

  const noveltyLabel = novelty >= 70 ? "small, unexpected award — higher information value"
    : novelty >= 40 ? "mid-size award — mixed signal"
    : "large award — likely already known to the market";

  const pricedInAssessment = novelty < 30 && agSig < 50
    ? "Likely already priced in"
    : novelty >= 60 || agSig >= 70
    ? "More likely new information"
    : "Mixed — depends on timing and market awareness";

  const plainEnglish = agSig >= 70
    ? `This is an award from ${agencyName || "a less-covered agency"}, which historically has produced stronger stock reactions than routine defense awards. That may be because fewer analysts track civilian government IT, making the news genuinely surprising.`
    : agSig <= 40
    ? `This is a contract from ${agencyName || "a major defense agency"}, which is typically well-covered by analysts. Large defense awards like this are often announced in advance via SAM.gov, so the market may already have expected it.`
    : `This award is from a moderately covered agency. Whether it matters depends on whether it represents a new program or a renewal of something already expected.`;

  const watchNext = [
    "Follow-on task orders from the same agency",
    `${profile.primaryAgencies[0] || "Agency"} budget request for next fiscal year`,
    "Company earnings call commentary on government pipeline",
    "SAM.gov solicitations for related contract vehicles",
    renewal > 0.5 ? "Contract recompete timeline" : null
  ].filter(Boolean).slice(0, 3);

  return {
    score,
    label,
    pricedInAssessment,
    plainEnglish,
    components: { dep, agSig, novelty, renewal },
    agSigLabel,
    noveltyLabel,
    watchNext,
    archetype: profile.archetype,
    archetypeExplain: profile.archetypeExplain,
    confidence: "Medium — calibrated on 282 events (5 companies, 2015–2024). Treat as directional signal.",
    dataNote: `${agencyName?.includes("Defense") ? "DoD awards may lag USASpending by up to 90 days." : "Non-DoD awards typically appear within 3 business days."} Not investment advice.`
  };
}

function buildGovernmentMoneyTrail(symbol, awardAmount, agencyName, programName) {
  const profile = CONTRACT_PROFILES[String(symbol || "").toUpperCase()];
  if (!profile) return null;
  const sig = computeContractEventSignal(symbol, awardAmount, agencyName);
  const agency = agencyName || profile.primaryAgencies[0] || "Federal agency";
  const program = programName || profile.primaryPrograms[0] || "Government program";
  const pct = Math.round(profile.governmentRevenuePct * 100);

  return {
    headline: `${symbol}: Government contract award from ${agency}`,
    simpleSummary: `${profile.archetype}. ${sig?.plainEnglish || ""}`,
    chain: [
      {
        label: "Government event",
        value: `Contract award from ${agency}`,
        explanation: `The federal government awarded a contract to ${symbol}. This appears in USASpending.gov public data.`
      },
      {
        label: "Agency mechanism",
        value: agency,
        explanation: `${sig?.agSigLabel || "Agency coverage level unknown"}. ${agency.includes("Health") || agency.includes("Veteran") ? "Civilian health agencies receive less analyst attention than DoD." : agency.includes("Defense") ? "DoD is the most tracked contracting agency — awards are often expected." : "Coverage level is moderate."}`
      },
      {
        label: "Program channel",
        value: program,
        explanation: `${sig?.noveltyLabel || "Award size context unknown"}. The channel from this program to company revenue depends on contract structure (IDIQ vs firm-fixed-price) and the company's existing program mix.`
      },
      {
        label: "Company exposure",
        value: `${pct}% of ${symbol} revenue is from government contracts`,
        explanation: `${profile.note} Archetype: ${profile.archetype}.`
      },
      {
        label: "Business mechanism",
        value: sig?.pricedInAssessment || "Unknown",
        explanation: `${profile.archetype === "Narrative-Sensitive Contractor"
          ? "For this company, government awards affect the growth story as much as the direct revenue. Investors watch contract flow as evidence of platform adoption."
          : "The primary mechanism is revenue — contract awards add to backlog and reduce near-term revenue uncertainty."}`
      },
      {
        label: "Investor scenario",
        value: sig?.label || "Monitor",
        explanation: `${profile.bull} Risk: ${profile.bear}`
      },
      {
        label: "Watch next",
        value: (sig?.watchNext || []).join(" · "),
        explanation: "These are the specific events that would confirm or weaken the thesis from this contract signal."
      }
    ],
    limitations: [
      "USASpending data may lag the actual contract signing date by up to 90 days for DoD.",
      "CRS calibration used 5 companies and 282 events — treat as directional, not precise.",
      "Correlation is not causation. Post-award returns are influenced by many factors.",
      "This is not investment advice."
    ]
  };
}

async function contractCausality(res, url) {
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase().trim();
  if (!symbol) return sendJson(res, 400, { error: "symbol_required" });

  const profile = CONTRACT_PROFILES[symbol] || null;
  const depScore = computeGovernmentDependencyScore(symbol);
  const relatedBills = POLICY_BILLS.filter((b) => (b.affected || []).includes(symbol));

  // Bars are always derived from contract profile (if present)
  const govPct     = profile ? Math.round(profile.governmentRevenuePct * 100) : null;
  const renewalPct = profile ? Math.round(profile.renewalRisk * 100) : null;
  const budgetNum  = profile ? (profile.agencyBudgetRisk === "high" ? 80 : profile.agencyBudgetRisk === "medium" ? 55 : 25) : null;
  const primaryAgency  = profile?.primaryAgencies?.[0] || "Federal agencies";
  const agSig = agencySignalScore(primaryAgency);

  const bars = profile ? [
    { label: `${primaryAgency.split(" ").slice(-1)[0]} exposure`, value: govPct, display: `${govPct}%` },
    { label: "Renewal risk", value: renewalPct, display: String(renewalPct) },
    { label: "Award novelty", value: 100 - agSig, display: String(100 - agSig) },
    { label: "Budget risk", value: budgetNum, display: profile.agencyBudgetRisk }
  ] : [];

  const evidence = [
    { source: "USASpending",    title: "What was awarded?",         detail: "Federal award amount, agency, recipient, date, and program fields." },
    { source: "SAM.gov",        title: "Was it expected?",           detail: "Solicitations, sources-sought notices, deadlines, and incumbent context." },
    { source: "Congress.gov",   title: "What funds it?",             detail: "Appropriations bills, authorization, committee actions, and latest status." },
    { source: "10-K / SEC",     title: "Does revenue depend on it?", detail: govPct ? `~${govPct}% government revenue${profile?.archetype ? ` (${profile.archetype})` : ""}. Customer concentration, backlog, and risk factor language.` : "Check 10-K for government revenue concentration and risk factor language." },
    { source: "LDA / lobbying", title: "Who is pushing?",            detail: "Lobbying spend, issue area pressure, and bill-aligned activity around agency budgets." }
  ];

  // If AI key is available, generate dynamic analysis
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const lobbyingContext = relatedBills.length
        ? `${relatedBills.length} mapped bills with momentum scores ${relatedBills.map(b => b.momentum ?? "?").join(", ")}.`
        : "";
      const ai = await runCausalityAnalyzer({
        symbol,
        companyName: profile?.note?.split(" ")[0] || symbol,
        bills: relatedBills,
        lobbyingContext,
        contractProfile: profile,
      });
      return sendJson(res, 200, {
        symbol,
        archetype: profile?.archetype || null,
        dogeRisk: profile?.dogeRisk || false,
        scores: { dependency: depScore, changeRisk: renewalPct ?? 50, confidence: depScore > 70 ? "Medium-high" : relatedBills.length ? "Medium" : "Low" },
        plainEnglish: ai.plainEnglish || profile?.note || `Policy and contract signals for ${symbol} are being analyzed.`,
        archetypeExplain: profile?.archetypeExplain || "",
        nodes: ai.nodes,
        bars,
        scenarios: ai.scenarios,
        translation: ai.translation,
        evidence,
        aiGenerated: true,
        billCount: relatedBills.length
      });
    } catch (err) {
      console.warn("[causality] AI generation failed, using template fallback:", err.message);
    }
  }

  // Template fallback — works for CONTRACT_PROFILES tickers, generic for others
  if (!profile) {
    // Generic fallback for tickers not in CONTRACT_PROFILES
    const genericNodes = relatedBills.length ? relatedBills.slice(0, 4).map((bill, i) => ({
      step: `${i + 1} · Bill exposure`,
      title: bill.title,
      detail: bill.impact || bill.policyImpact || `This bill affects ${symbol} through ${bill.issueArea || "policy pressure"}.`,
      source: "Congress.gov"
    })) : [
      { step: "1 · Policy scan", title: `No direct bill exposure mapped for ${symbol}`, detail: "This ticker is not currently in TradeSimple's contract or bill mapping. Add an Anthropic API key in Settings to enable AI-powered causality analysis for any ticker.", source: "TradeSimple model" }
    ];
    return sendJson(res, 200, {
      symbol, archetype: null, dogeRisk: false,
      scores: { dependency: depScore, changeRisk: 50, confidence: "Low" },
      plainEnglish: `${symbol} is not in the government contractor database. ${relatedBills.length ? `${relatedBills.length} mapped bill(s) may create indirect exposure.` : "No direct policy exposure is currently mapped."}`,
      archetypeExplain: "", nodes: genericNodes, bars: [], scenarios: [], translation: [], evidence, aiGenerated: false, billCount: relatedBills.length
    });
  }

  const isNarrative = profile.archetype === "Narrative-Sensitive Contractor";
  const primaryProgram = profile.primaryPrograms?.[0] || "Government programs";
  const changeRisk = Math.round(0.50 * renewalPct + 0.30 * budgetNum + 0.20 * (profile.dogeRisk ? 70 : 20));
  sendJson(res, 200, {
    symbol, archetype: profile.archetype, dogeRisk: profile.dogeRisk,
    scores: { dependency: depScore, changeRisk, confidence: depScore > 70 ? "Medium-high" : "Medium" },
    plainEnglish: profile.note, archetypeExplain: profile.archetypeExplain,
    nodes: [
      { step: "1 · Budget source",     title: `${primaryAgency} appropriations set the funding pool`,   detail: `If Congress expands or cuts this account, ${symbol}'s opportunity set changes directly.`, source: "Congress.gov" },
      { step: "2 · Agency buyer",      title: `${primaryAgency} is the primary demand center`,           detail: agSig >= 70 ? "Civilian agencies have thinner analyst coverage — awards carry higher surprise value." : "DoD is the most tracked agency. Awards are usually expected months ahead.", source: "USASpending" },
      { step: "3 · Procurement signal",title: "Solicitation history sets the surprise bar",              detail: agSig <= 40 ? "Large defense awards are often pre-announced via SAM.gov and already priced in." : "Awards from this agency tend to receive less pre-announcement coverage, which raises informational value.", source: "SAM.gov" },
      { step: "4 · Company exposure",  title: `${govPct}% of ${symbol} revenue is government-linked`,   detail: `${profile.archetype}. Revenue concentration means budget decisions map directly to earnings.`, source: "10-K filing" },
      { step: "5 · Market mechanism",  title: isNarrative ? "Investors price adoption curve, not just revenue" : "Investors price durability and renewal risk", detail: isNarrative ? "Contract awards validate platform adoption. Small awards from new agencies can shift multiples beyond their revenue contribution." : "Renewal risk, program durability, and margin profile drive scenario modeling.", source: "Model logic" },
      { step: "6 · Watch next",        title: `Track ${primaryProgram} and recompete timing`,            detail: profile.bull, source: "Alert rule" }
    ],
    bars,
    scenarios: [
      { name: "Upside",   change: profile.bull, read: isNarrative ? "Supports adoption narrative and can expand multiple." : "Confirms revenue durability, but large awards are often partly expected.", cls: "positive" },
      { name: "Base",     change: "Funding stays stable and contract flow continues.", read: "Confirms business quality more than it creates a new market surprise.", cls: "warning" },
      { name: "Downside", change: profile.bear, read: "Raises renewal risk and can pressure forward revenue and margin assumptions.", cls: "negative" }
    ],
    translation: [
      { step: "A", title: "What happened?",      body: `A contract award or budget signal appeared for ${symbol} in public government data.` },
      { step: "B", title: "Why does it matter?", body: `${govPct}% of ${symbol} revenue runs through government agencies. Budget decisions are felt directly in earnings.` },
      { step: "C", title: "What could change?",  body: "Future sales, renewal odds, margin durability, or investor confidence in the government business line." },
      { step: "D", title: "What to watch?",      body: profile.dogeRisk ? "Agency efficiency reviews, budget markups, recompete schedules, and earnings guidance on government pipeline." : `NDAA markup, budget appropriations for ${primaryAgency}, SAM.gov solicitations for ${primaryProgram}, and management comments on program health.` }
    ],
    evidence, aiGenerated: false, billCount: relatedBills.length
  });
}
// ══════════════════════════════════════════════════════════════════════════════

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    console.error(error);
    if (error?.message === "body_too_large") {
      return sendJson(res, 413, { error: "body_too_large", message: "Request body is too large." });
    }
    if (error?.message === "invalid_json") {
      return sendJson(res, 400, { error: "invalid_json", message: "Invalid JSON body." });
    }
    sendJson(res, 500, { error: "internal_error", message: "Something went wrong. Please try again." });
  }
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`TradeSimple running at ${APP_URL} (port ${PORT})`);
  if (authSecretIsInsecure()) {
    if (process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT) {
      console.error("[FATAL] AUTH_SECRET is missing or still a placeholder. Set AUTH_SECRET in Railway Variables (32+ random chars). Exiting.");
      process.exit(1);
    }
    console.warn("[WARN] AUTH_SECRET is using the default dev value. Set AUTH_SECRET in .env.local before deploying.");
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN && isPlaceholderAppUrl(process.env.APP_URL || "")) {
    console.log(`[deploy] APP_URL auto-set from Railway domain → ${APP_URL}`);
  }
  if (SEC_USER_AGENT.includes("you@example.com")) {
    console.warn("[WARN] SEC_USER_AGENT contains placeholder email. Set SEC_USER_AGENT in .env.local for EDGAR access (SEC fair-access policy requires a real contact).");
  }

  // Durable persistence status — accounts, paper portfolios, watchlists.
  // Without Supabase these live in DATA_DIR, which is ephemeral on Railway and
  // is wiped on every redeploy/restart. Make this impossible to miss at boot.
  if (dbReady) {
    console.log("[data] Supabase persistence ACTIVE — accounts, paper portfolios, and watchlists survive restarts.");
  } else {
    const ephemeralWarn =
      "[WARN] Supabase NOT configured — accounts, paper portfolios, and watchlists are stored on the local filesystem and WILL BE LOST on every redeploy/restart. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (and run supabase/schema.sql) to make them durable.";
    if (process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT) {
      console.error(ephemeralWarn);
    } else {
      console.warn(ephemeralWarn);
    }
  }

  // Python sidecar health check
  if (isYfinanceEnabled()) {
    const { existsSync: _exists } = await import("node:fs");
    if (!_exists(YFINANCE_BRIDGE_SCRIPT)) {
      console.warn(`[WARN] yfinance bridge not found at ${YFINANCE_BRIDGE_SCRIPT}. Market data will use static fallback. Run: pip install yfinance`);
    } else {
      const { execFile } = await import("node:child_process");
      execFile(YFINANCE_PYTHON, ["--version"], { timeout: 3000 }, (err, stdout) => {
        if (err) console.warn(`[WARN] Python (${YFINANCE_PYTHON}) not available: ${err.message}. Install Python 3 and run: pip install yfinance`);
        else console.log(`[data] Python sidecar ready: ${stdout.trim()}`);
      });
    }
  }

  initDataRefresh({ dataDir: DATA_DIR });
  for (const bill of POLICY_BILLS) {
    if (bill.scenarioOnly) continue;
    const cached = await readCongressCache(bill.id);
    if (cached) congressLiveCache.set(bill.id, cached);
  }

  lastSeedValidation = await validatePolicySeeds(POLICY_BILLS, {
    congressApiKey: process.env.CONGRESS_API_KEY || ""
  });
  if (!lastSeedValidation.ok) {
    console.warn("[data] Policy seed validation:", lastSeedValidation.message);
    for (const issue of lastSeedValidation.structural || []) {
      console.warn(`  · ${issue.billId}: ${issue.message}`);
    }
  } else {
    console.log("[data] Policy seeds:", lastSeedValidation.message);
  }

  void resolveLobbyFilingsForShare().catch(() => {});

  if (!process.env.CONGRESS_API_KEY) {
    console.warn("[data] CONGRESS_API_KEY not set — Bills tab uses scenario narratives until configured.");
  }
  if (!process.env.FINNHUB_API_KEY) {
    console.warn("[data] FINNHUB_API_KEY not set — equity quotes may use Yahoo or modeled fallback.");
  }
  if (!process.env.FEC_API_KEY) {
    console.warn("[data] FEC_API_KEY not set — campaign finance pulse uses illustrative sample data (api.open.fec.gov).");
  } else {
    console.log("[data] FEC Open API configured — live PAC filings enabled.");
  }

  const production = productionReadiness(process.env);
  if (isStrictDataMode()) {
    if (!production.ready) {
      console.error("[data] PRODUCTION DATA MODE — not ready:", production.message);
      for (const m of production.missing) console.error(`  · missing ${m.key} (${m.label})`);
      for (const i of production.invalid) console.error(`  · invalid ${i.key} (${i.label})`);
    } else {
      console.log("[data] Production data mode — all required feeds configured.");
    }
  }

  startBackgroundRefresh({
    refreshCongress: refreshCongressLiveCache,
    refreshLobbying: refreshLdaLobbyingCache,
    refreshFec: () => getFecPulsePayload({ forceRefresh: true })
  });

  // ── Prediction ledger lifecycle ──────────────────────────────────────────
  // Verify chain integrity on boot, then keep the ledger self-populating and
  // self-resolving so the track record grows from real signals without manual work.
  verifyLedger()
    .then((v) =>
      console.log(
        v.ok
          ? `[ledger] integrity OK · ${v.length} events`
          : `[ledger] ⚠ integrity broken at seq ${v.brokenAtSeq}`
      )
    )
    .catch(() => {});
  if (process.env.LEDGER_AUTO_RECORD !== "false") {
    setTimeout(() => autoRecordSignalPredictions(), 8_000);
    setInterval(() => autoRecordSignalPredictions(), 24 * 60 * 60 * 1000); // daily
  }
  setTimeout(() => resolveDuePredictions(ledgerDeps).then((r) => {
    if (r.resolved) console.log(`[ledger] resolved ${r.resolved} prediction(s)`);
  }).catch(() => {}), 20_000);
  setInterval(() => resolveDuePredictions(ledgerDeps).then((r) => {
    if (r.resolved) console.log(`[ledger] resolved ${r.resolved} prediction(s)`);
  }).catch(() => {}), 6 * 60 * 60 * 1000); // every 6h

  if (process.env.CONGRESS_API_KEY) {
    refreshCongressLiveCache().catch((err) => console.warn("[data] Initial Congress refresh failed:", err.message));
  }
  if (process.env.SENATE_LDA_API_KEY) {
    refreshLdaLobbyingCache().catch((err) => console.warn("[data] Initial LDA refresh failed:", err.message));
  }
  if (process.env.FEC_API_KEY) {
    fetchFecJson("/candidates/search/", { q: "smith", per_page: 1 })
      .then((r) => {
        if (r?.results) console.log("[fec] API key verified — authenticated to openFEC.");
        else if (fecRateLimitedUntil > Date.now()) console.warn("[fec] API key set but rate-limited by openFEC — will retry after cooldown.");
        else console.warn("[fec] API key set but health check returned no results — key may be invalid.");
      })
      .catch((err) => console.warn("[fec] API key health check failed:", err.message));
    // Stagger initial FEC refresh: one cluster every 15s to avoid rate limit burst
    setTimeout(() => {
      buildLiveFecPulsePayload({ stagger: true })
        .then((payload) => {
          fecPulseCache = payload;
          fecPulseCachedAt = Date.now();
          console.log(`[fec] Staggered boot refresh complete — ${payload.pulses?.length || 0} live pulses.`);
        })
        .catch((err) => console.warn("[data] Initial FEC pulse refresh failed:", err.message));
    }, 5_000);
  }
  setTimeout(() => {
    refreshContractWatch()
      .then((r) => {
        if (r.awards?.length) console.warn(`[contract-watch] ${r.awards.length} significant award(s) in 7d window`);
      })
      .catch((err) => console.warn("[contract-watch] Initial refresh failed:", err.message));
  }, 14_000);
  setInterval(() => {
    refreshContractWatch().catch((err) => console.warn("[contract-watch] Poll failed:", err.message));
  }, CONTRACT_WATCH_POLL_MS);
  setTimeout(() => {
    try {
      const report = validateBillPipelineSample();
      if (report.warnings.length) {
        console.warn(`[data] Bill pipeline self-check: ${report.warnings.length} issue(s) — ${report.warnings.slice(0, 4).join("; ")}`);
      }
    } catch (err) {
      console.warn("[data] Bill pipeline self-check skipped:", err.message);
    }
  }, 15_000);

  seedCatalogFallbackCache();
  warmQuoteCatalogCache();
});

/** Stagger catalog quote fetches one symbol at a time so boot never bursts Finnhub. */
function warmQuoteCatalogCache() {
  const allSymbols = getCatalogQuoteSymbols();
  if (!allSymbols.length) return;
  const symbols = allSymbols.filter((sym) => {
    const fresh = cachedQuoteFresh(sym);
    return !(fresh && isLiveQuoteSource(fresh.quote.source));
  });
  const skipped = allSymbols.length - symbols.length;
  const estSec = Math.round((symbols.length * CATALOG_WARM_INTERVAL_MS) / 1000);
  console.warn(
    `[data] Warming ${symbols.length} catalog quote caches over ~${estSec}s` +
      (skipped ? ` (${skipped} already fresh, skipped)` : "")
  );
  void (async () => {
    for (let index = 0; index < symbols.length; index++) {
      const sym = symbols[index];
      try {
        await quoteSnapshot(sym);
      } catch {
        /* yfinance/static fallback inside quoteSnapshot */
      }
      if (index < symbols.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, CATALOG_WARM_INTERVAL_MS));
      }
    }
    if (!symbols.length) return;
    const catalogSet = getCatalogQuoteSymbolSet();
    const quotes = [...quoteCache.entries()]
      .filter(([sym]) => catalogSet.has(sym))
      .map(([, entry]) => entry.quote)
      .filter(quoteHasValidPrice);
    const fallbackCount = quotes.filter((q) => q.source === "fallback_static").length;
    noteFeedSuccess("market", {
      source: fallbackCount === quotes.length ? "fallback" : "mixed_live",
      recordCount: quotes.length
    });
  })();
}

function requestIp(req) {
  // Only trust proxy-supplied IP headers behind a known proxy — otherwise a
  // client can set these directly to spoof its IP and evade the IP-windowed
  // rate limiters this feeds (share endpoints, the general /api/ backstop).
  if (isTrustedProxy()) {
    const raw =
      req.headers["cf-connecting-ip"] ||
      req.headers["x-real-ip"] ||
      req.headers["x-forwarded-for"];
    if (raw) return String(Array.isArray(raw) ? raw[0] : raw).split(",")[0].trim();
  }
  return String(req.socket?.remoteAddress || "unknown");
}

function checkIpWindowLimit(bucket, req, { max, windowMs }) {
  const now = Date.now();
  const ip = requestIp(req);
  let entry = bucket.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  entry.count += 1;
  bucket.set(ip, entry);

  if (bucket.size > 1000) {
    for (const [key, val] of bucket.entries()) {
      if (now > val.resetAt) bucket.delete(key);
    }
  }

  return {
    ok: entry.count <= max,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
  };
}

function enforceShareRateLimit(req, res) {
  const check = checkIpWindowLimit(shareRateLimit, req, {
    max: SHARE_RATE_LIMIT_MAX,
    windowMs: SHARE_RATE_LIMIT_WINDOW_MS
  });
  if (check.ok) return false;
  res.writeHead(429, responseHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "retry-after": String(check.retryAfterSeconds)
  }));
  res.end(JSON.stringify({
    error: "rate_limited",
    message: "Too many share snapshot requests. Try again shortly.",
    retryAfterSeconds: check.retryAfterSeconds
  }));
  return true;
}

function featureComingSoonPage(featureName) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <link rel="icon" type="image/png" href="/favicon.png"/>
  <link rel="apple-touch-icon" href="/favicon.png"/>
  <title>Coming Soon | TradeSimple</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      background: #0a0a0a;
      color: #e8e6e0;
      padding: 2rem;
      max-width: 40rem;
      margin: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      border: 1px solid rgba(200,255,0,0.2);
      border-radius: 8px;
      padding: 2rem;
      text-align: center;
      background: rgba(255,255,255,0.02);
    }
    h1 { color: #C8FF00; font-size: 2rem; margin: 0 0 0.5rem; }
    p { line-height: 1.6; color: #ccc; margin: 1rem 0; }
    .cta {
      display: inline-block;
      margin-top: 1rem;
      padding: 0.75rem 1.5rem;
      background: #C8FF00;
      color: #0a0a0a;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Coming soon</h1>
    <p><strong>${escapeHtmlText(featureName)}</strong> is not yet available in the beta.</p>
    <p>Launch week is focused on thesis workflows, paper trading, and source-backed stock cards.</p>
    <a href="/dashboard?view=thesis" class="cta">Back to Thesis</a>
  </div>
</body>
</html>`;
}

function checkFeaturePage(featureName, res, label, { head = false } = {}) {
  if (featureEnabled(featureName)) return true;
  sendHtml(res, 403, featureComingSoonPage(label), { head });
  return false;
}

/** Strip trailing slashes so /dashboard/ and /dashboard resolve the same shell. */
function normalizeRoutePathname(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

async function route(req, res) {
  const url = new URL(req.url || "/", APP_URL);
  const pathname = normalizeRoutePathname(url.pathname);

  if (isLandingOnly() && !landingOnlyAllows(pathname, req.method)) {
    return landingOnlyBlocked(res, pathname);
  }

  // Coarse per-IP backstop across the whole /api/ surface — applied here,
  // before any route-specific handling, so it also covers routes matched
  // earlier in this function (e.g. /api/usaspending/*, /api/session) that
  // never reach the authenticated-block gate further down. Endpoints with
  // their own tighter limiter (auth, share) are still bound by it too; this
  // is just an outer ceiling, not a replacement for those.
  if (pathname.startsWith("/api/")) {
    const apiLimit = checkIpWindowLimit(apiRateLimit, req, {
      max: API_RATE_LIMIT_MAX,
      windowMs: API_RATE_LIMIT_WINDOW_MS
    });
    if (!apiLimit.ok) {
      res.writeHead(429, responseHeaders({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": String(apiLimit.retryAfterSeconds)
      }));
      return res.end(JSON.stringify({ error: "rate_limited", message: "Too many requests. Please slow down." }));
    }
  }

  if (pathname === "/") return sendLandingIndex(res);
  if (pathname === "/favicon.ico") return sendStatic(res, "favicon.png");
  if (pathname === "/dashboard") {
    const session = getSession(req);
    if (!session) {
      const nextPath = `/dashboard${url.search || "?view=home"}`;
      if (process.env.DEMO_AUTH !== "false") {
        return redirect(res, `/auth/demo?next=${encodeURIComponent(nextPath)}`);
      }
      return redirect(res, `/signup?next=${encodeURIComponent(nextPath)}`);
    }
    return sendStatic(res, "dashboard.html");
  }
  if (pathname === "/bill") {
    if (!checkFeaturePage("BILLS_EXPLORER_ENABLED", res, "Bills Explorer", { head: req.method === "HEAD" })) return;
    return redirect(res, "/dashboard?view=bills");
  }
  if (pathname.startsWith("/bill/") && (req.method === "GET" || req.method === "HEAD")) {
    if (!checkFeaturePage("BILLS_EXPLORER_ENABLED", res, "Bills Explorer", { head: req.method === "HEAD" })) return;
    return publicBillCard(req, res, pathname, { head: req.method === "HEAD" });
  }
  if (pathname === "/contract") {
    if (!checkFeaturePage("CONTRACTS_ANALYZER_ENABLED", res, "Contracts Analyzer", { head: req.method === "HEAD" })) return;
    return redirect(res, "/dashboard?view=contracts");
  }
  if (pathname.startsWith("/contract/") && (req.method === "GET" || req.method === "HEAD")) {
    if (!checkFeaturePage("CONTRACTS_ANALYZER_ENABLED", res, "Contracts Analyzer", { head: req.method === "HEAD" })) return;
    return publicContractCard(res, pathname, { head: req.method === "HEAD" });
  }
  if (pathname === "/lobby") {
    if (!checkFeaturePage("LOBBYING_EXPLORER_ENABLED", res, "Lobbying Explorer", { head: req.method === "HEAD" })) return;
    return redirect(res, "/dashboard?view=lobbying");
  }
  if (pathname.startsWith("/lobby/") && (req.method === "GET" || req.method === "HEAD")) {
    if (!checkFeaturePage("LOBBYING_EXPLORER_ENABLED", res, "Lobbying Explorer", { head: req.method === "HEAD" })) return;
    return publicLobbyCard(res, pathname, { head: req.method === "HEAD" });
  }
  if (pathname === "/fec") {
    return redirect(res, "/dashboard?view=fec");
  }
  if (pathname.startsWith("/fec/") && (req.method === "GET" || req.method === "HEAD")) {
    return publicFecCard(req, res, pathname, { head: req.method === "HEAD" });
  }
  if (pathname === "/stock") return redirect(res, "/stock/NVDA");
  if (pathname.startsWith("/stock/") && (req.method === "GET" || req.method === "HEAD")) {
    return publicStockCard(res, pathname, { head: req.method === "HEAD" });
  }
  if (pathname.startsWith("/assets/")) return sendStatic(res, pathname.replace("/assets/", ""), req);
  if (pathname.startsWith("/src/imports/")) return sendImportsStatic(res, pathname);

  if (pathname === "/api/config") {
    return sendJson(res, 200, publicConfig());
  }
  if (pathname === "/api/share/stock" && req.method === "GET") return shareStockSnapshot(req, res, url);
  if (pathname === "/api/share/bill" && req.method === "GET") {
    if (!checkFeature("BILLS_EXPLORER_ENABLED", res)) return;
    return shareBillSnapshot(req, res, url);
  }
  if (pathname === "/api/share/contract" && req.method === "GET") {
    if (!checkFeature("CONTRACTS_ANALYZER_ENABLED", res)) return;
    return shareContractSnapshot(req, res, url);
  }
  if (pathname.startsWith("/api/usaspending/award/") && req.method === "GET") {
    return usaspendingAwardRoute(res, pathname);
  }
  if (pathname === "/api/usaspending/recipient" && req.method === "GET") {
    return usaspendingRecipientRoute(res, url);
  }
  if (pathname === "/api/share/lobby" && req.method === "GET") {
    if (!checkFeature("LOBBYING_EXPLORER_ENABLED", res)) return;
    return shareLobbySnapshot(req, res, url);
  }
  if (pathname === "/api/share/fec" && req.method === "GET") {
    return shareFecSnapshot(req, res, url);
  }
  if (pathname === "/api/ai/scorecard" && req.method === "POST") {
    if (!FEATURE_GATES.AI_RESEARCH_ENABLED || !serverAiProviderEnabled()) {
      return sendJson(res, 503, { error: "feature_unavailable", message: "AI research is not yet enabled." });
    }
    if (!getSession(req)) return sendJson(res, 401, { error: "unauthorized" });
    return aiScorecardHandler(req, res);
  }
  if (pathname === "/api/ai/edgar" && req.method === "POST") {
    if (!FEATURE_GATES.AI_RESEARCH_ENABLED || !serverAiProviderEnabled()) {
      return sendJson(res, 503, { error: "feature_unavailable", message: "AI research is not yet enabled." });
    }
    if (!getSession(req)) return sendJson(res, 401, { error: "unauthorized" });
    return aiEdgarHandler(req, res);
  }
  if (pathname === "/api/ai/lobby-map" && req.method === "POST") {
    if (!FEATURE_GATES.AI_RESEARCH_ENABLED || !serverAiProviderEnabled()) {
      return sendJson(res, 503, { error: "feature_unavailable", message: "AI research is not yet enabled." });
    }
    if (!getSession(req)) return sendJson(res, 401, { error: "unauthorized" });
    return aiLobbyMapHandler(req, res);
  }
  if (pathname === "/api/ai/chart-label" && req.method === "POST") {
    if (!FEATURE_GATES.AI_RESEARCH_ENABLED || !serverAiProviderEnabled()) {
      return sendJson(res, 503, { error: "feature_unavailable", message: "AI research is not yet enabled." });
    }
    if (!getSession(req)) return sendJson(res, 401, { error: "unauthorized" });
    return aiChartLabelHandler(req, res);
  }
  if (pathname === "/api/ai/thesis" && req.method === "POST") {
    if (!FEATURE_GATES.AI_RESEARCH_ENABLED || !serverAiProviderEnabled()) {
      return sendJson(res, 503, { error: "feature_unavailable", message: "AI research is not yet enabled." });
    }
    if (!getSession(req)) return sendJson(res, 401, { error: "unauthorized" });
    return aiThesisHandler(req, res);
  }
  if (pathname.startsWith("/api/share/edgar/") && req.method === "GET") {
    return shareEdgarRiskFactors(res, pathname);
  }
  if (pathname === "/api/session") {
    const session = getSession(req);
    const cookies = parseCookies(req);
    if (session && !cookies[CSRF_COOKIE]) {
      ensureCsrfCookie(res, req);
    }
    return sendJson(res, 200, { user: session?.user || null });
  }
  if (pathname === "/api/waitlist" && req.method === "POST") return waitlistSignup(req, res);
  if (pathname === "/api/admin/waitlist" && req.method === "GET") return waitlistAdmin(req, res);
  if (pathname === "/api/admin/trending" && req.method === "POST") return trendingAdminHandler(req, res);
  if (pathname === "/api/admin/contract-watch" && req.method === "POST") return contractWatchAdminHandler(req, res);
  if (pathname === "/api/admin/validate-bills" && req.method === "GET") return validateBillsAdmin(req, res);
  if (pathname === "/terminal" || pathname === "/terminal/") {
    return redirect(res, "/auth/demo?next=/dashboard%3Fview%3Dhome");
  }
  if (pathname === "/auth/demo") return startDemoSession(req, res);
  if (pathname === "/auth/logout") return logout(res, req);
  if (pathname === "/auth/google") return startOAuth(req, res, "google");
  if (pathname === "/auth/apple") return startOAuth(req, res, "apple");
  if (pathname === "/auth/callback/google") return finishOAuth(req, res, "google", url);
  if (pathname === "/auth/callback/apple") return finishOAuth(req, res, "apple", url);

  if (pathname === "/robots.txt") return sendStatic(res, "robots.txt");
  if (pathname === "/.well-known/security.txt") return sendStatic(res, ".well-known/security.txt");
  if (pathname === "/api/landing-quotes" && req.method === "GET") return landingQuotesHandler(res);
  if (pathname === "/api/landing-signal" && req.method === "GET") return landingSignalHandler(res);
  if ((pathname === "/api/fec/pulse" || pathname === "/api/landing-fec-pulse") && req.method === "GET") {
    return fecPulseHandler(res, url);
  }
  if (pathname.startsWith("/api/fec/filing/") && req.method === "GET") {
    const clusterKey = decodeURIComponent(pathname.slice("/api/fec/filing/".length)).trim();
    return fecPulseDetailHandler(res, clusterKey);
  }
  if (pathname.startsWith("/api/fec/pulse/") && req.method === "GET") {
    const clusterKey = decodeURIComponent(pathname.slice("/api/fec/pulse/".length)).trim();
    return fecPulseDetailHandler(res, clusterKey);
  }
  if (pathname === "/api/trending" && req.method === "GET") return trendingListHandler(res);
  if (pathname === "/api/contract-watch" && req.method === "GET") return contractWatchListHandler(res);
  if (pathname === "/api/contract-watch/alerts" && req.method === "GET") return contractWatchAlertsHandler(res, url);
  if (pathname === "/api/onboarding/bill" && req.method === "GET") return onboardingBillHandler(res);

  // ── Email/password accounts (public — these create the session) ──
  if (pathname === "/api/auth/signup" && req.method === "POST") return authSignup(req, res);
  if (pathname === "/api/auth/login" && req.method === "POST") return authLogin(req, res);
  if (pathname === "/api/auth/logout" && req.method === "POST") return authLogoutApi(res, req);
  if (pathname === "/manifesto") return sendStatic(res, "manifesto.html");
  if (pathname === "/login" || pathname === "/signup") return sendStatic(res, "auth.html");

  // ── Prediction ledger (public reads — the track record is a brand asset) ──
  if (pathname === "/api/predictions/scorecard" && req.method === "GET") return predictionScorecardHandler(res, url);
  if (pathname === "/api/predictions/verify" && req.method === "GET") return predictionVerifyHandler(res);
  if (pathname === "/api/predictions" && req.method === "GET") return predictionListHandler(res, url);

  if (pathname.startsWith("/api/")) {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "unauthorized" });

    if (requiresCsrf(req, pathname) && !validateCsrf(req)) {
      return sendJson(res, 403, { error: "csrf_invalid", message: "Invalid or missing CSRF token." });
    }

    if (pathname === "/api/market/quotes/catalog") return marketQuotesCatalog(res);
    if (pathname === "/api/market/quotes") return marketQuotes(res, url);
    if (pathname === "/api/market/history") return marketHistory(res, url);
    if (pathname === "/api/analysis/stock") {
      if (!checkFeature("ANALYSIS_LAB_ENABLED", res)) return;
      return stockAnalysis(res, url);
    }
    if (pathname === "/api/policy/network") return policyNetwork(res, url);
    if (pathname === "/api/crypto") {
      if (!checkFeature("CRYPTO_TRACKER_ENABLED", res)) return;
      return cryptoPrices(res, url);
    }
    // Keep this feed open: overview/top signal and thesis grounding depend on seeded/live bills.
    if (pathname === "/api/congress/bills") return congressBills(res, url);
    if (pathname === "/api/contracts/causality" && req.method === "GET") {
      if (!checkFeature("CONTRACTS_ANALYZER_ENABLED", res)) return;
      return contractCausality(res, url);
    }
    if (pathname.startsWith("/api/contracts/") && req.method === "GET") {
      if (!checkFeature("CONTRACTS_ANALYZER_ENABLED", res)) return;
      return contractsByCompany(res, pathname);
    }
    if (pathname.startsWith("/api/agency-budget/") && req.method === "GET") return agencyBudget(res, pathname);
    if (pathname === "/api/appointments" && req.method === "GET") return recentAppointments(res);
    if (pathname === "/api/methodology") return methodologyDoc(res);
    if (pathname === "/api/policy/bill-metrics") return billPolicyMetrics(res, url);
    if (pathname === "/api/lobbying") {
      if (!checkFeature("LOBBYING_EXPLORER_ENABLED", res)) return;
      return lobbying(res);
    }
    if (pathname === "/api/fec/bill-context" && req.method === "GET") return fecBillContextHandler(res, url);
    if (pathname === "/api/policy-trail" && req.method === "GET") return policyTrailHandler(res, url);
    if (pathname === "/api/funds" && req.method === "GET") {
      if (!checkFeature("FUNDS_HYPOTHETICALS_ENABLED", res)) return;
      return listFunds(res, session);
    }
    if (pathname === "/api/funds" && req.method === "POST") {
      if (!checkFeature("FUNDS_HYPOTHETICALS_ENABLED", res)) return;
      return createFund(req, res, session);
    }
    if (pathname === "/api/funds/compare" && req.method === "GET") {
      if (!checkFeature("FUNDS_HYPOTHETICALS_ENABLED", res)) return;
      return fundsCompareRoute(res, session, url);
    }
    if (pathname === "/api/dashboard/bootstrap" && req.method === "GET") {
      return dashboardBootstrapRoute(res, session);
    }
    if (pathname === "/api/symbols/catalog" && req.method === "GET") {
      return symbolsCatalogRoute(res);
    }
    if (pathname === "/api/ui/bootstrap" && req.method === "GET") {
      return uiBootstrapRoute(res, session);
    }
    if (pathname === "/api/health/data" && req.method === "GET") {
      return dataHealthRoute(res);
    }
    if (pathname === "/api/relationship-map" && req.method === "GET") {
      if (!checkFeature("RELATIONSHIP_MAPS_ENABLED", res)) return;
      return relationshipMapRoute(res, url);
    }
    const fundPerfMatch = pathname.match(/^\/api\/funds\/([^/]+)\/performance$/);
    if (fundPerfMatch && req.method === "GET") {
      if (!checkFeature("FUNDS_HYPOTHETICALS_ENABLED", res)) return;
      return fundPerformanceRoute(res, session, fundPerfMatch[1], url);
    }
    const fundAttrMatch = pathname.match(/^\/api\/funds\/([^/]+)\/attribution$/);
    if (fundAttrMatch && req.method === "GET") {
      if (!checkFeature("FUNDS_HYPOTHETICALS_ENABLED", res)) return;
      return fundAttributionRoute(res, session, fundAttrMatch[1], url);
    }
    const fundPulseMatch = pathname.match(/^\/api\/funds\/([^/]+)\/pulse$/);
    if (fundPulseMatch && req.method === "GET") {
      if (!checkFeature("FUNDS_HYPOTHETICALS_ENABLED", res)) return;
      return fundPulseRoute(res, session, fundPulseMatch[1]);
    }
    if (pathname === "/api/trading/account") return paperAccount(res, session);
    if (pathname === "/api/trading/orders" && req.method === "POST") return paperOrder(req, res, session);
    if (pathname === "/api/thesis/signals" && req.method === "GET") return thesisSignalsHandler(res, url);
    if (pathname === "/api/theses" && req.method === "GET") return listTheses(res, session);
    if (pathname === "/api/theses" && req.method === "POST") return createThesis(req, res, session);
  const thesisUpgradePreviewMatch = pathname.match(/^\/api\/theses\/([^/]+)\/upgrade-preview$/);
  if (thesisUpgradePreviewMatch && req.method === "POST") {
    return thesisUpgradePreview(req, res, session, thesisUpgradePreviewMatch[1]);
  }
  const thesisAcceptUpgradeMatch = pathname.match(/^\/api\/theses\/([^/]+)\/accept-upgrade$/);
  if (thesisAcceptUpgradeMatch && req.method === "POST") {
    return thesisAcceptUpgrade(req, res, session, thesisAcceptUpgradeMatch[1]);
  }
    const thesisMonitorsMatch = pathname.match(/^\/api\/theses\/([^/]+)\/monitors$/);
    if (thesisMonitorsMatch && req.method === "GET") {
      if (!checkFeature("ALERTS_MONITORING_ENABLED", res)) return;
      return thesisMonitorsRoute(res, session, thesisMonitorsMatch[1]);
    }
    const thesisIdMatch = pathname.match(/^\/api\/theses\/([^/]+)$/);
    if (thesisIdMatch && req.method === "PATCH") return patchThesis(req, res, session, thesisIdMatch[1]);
    if (pathname === "/api/portfolio" && req.method === "GET") return getPortfolio(res, session);
    if (pathname === "/api/portfolio" && req.method === "PATCH") return patchPortfolio(req, res, session);
    if (pathname === "/api/watchlist" && req.method === "GET") return getWatchlist(res, session);
    if (pathname === "/api/watchlist" && req.method === "PATCH") return patchWatchlist(req, res, session);
    if (pathname === "/api/settings/anthropic" && req.method === "POST") {
      if (!checkFeature("SETTINGS_PAGE_ENABLED", res)) return;
      return saveAnthropicSettings(req, res);
    }
    if (pathname.startsWith("/api/edgar/") && req.method === "GET") return edgarRiskFactors(res, pathname);
    if (pathname === "/api/research/ask" && req.method === "POST") {
      if (!FEATURE_GATES.AI_RESEARCH_ENABLED || !serverAiProviderEnabled()) {
        return sendJson(res, 503, {
          error: "feature_unavailable",
          message: "AI research is not yet enabled."
        });
      }
      return researchAsk(req, res, session);
    }
    if (pathname === "/api/predictions" && req.method === "POST") return predictionRecordHandler(req, res, session);
  }

  if (/^\/(bill|contract|lobby|stock)\//.test(pathname)) {
    return sendDetailRouteHelp(res, pathname);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendText(res, 404, "Not found");
  }

  return servePublicStaticFallback(res, pathname);
}

async function servePublicStaticFallback(res, pathname) {
  const relative = pathname.slice(1);
  if (!relative) return sendLandingIndex(res);
  if (/\.[a-z0-9]+$/i.test(relative)) {
    return sendStatic(res, relative);
  }
  return sendText(res, 404, "Not found");
}

function sendDetailRouteHelp(res, pathname) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" type="image/png" href="/favicon.png"/><link rel="apple-touch-icon" href="/favicon.png"/>
<title>Restart required | TradeSimple</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#e8e6e0;padding:2rem;max-width:40rem;margin:auto}code{background:#1a1a1a;padding:.15rem .35rem;border-radius:4px}a{color:#5bbf82}</style>
</head><body>
<h1>Detail page unavailable</h1>
<p>The server handling <code>${escapeHtmlText(pathname)}</code> does not have bill/contract/lobby routes loaded. This usually means an <strong>older Node process</strong> is still running.</p>
<p>Stop the process on your port and restart:</p>
<pre><code>node server.mjs</code></pre>
<p>Then open <a href="${escapeHtmlText(pathname)}">this link again</a> or return to <a href="/dashboard?view=bills">Bills</a>.</p>
</body></html>`;
  sendHtml(res, 503, html);
}

async function sendLandingIndex(res) {
  const filePath = join(ROOT, "index.html");
  if (!existsSync(filePath)) return sendStatic(res, "index.html");
  let body = await readFile(filePath, "utf8");
  body = injectLandingCanonicalMeta(body);
  res.writeHead(200, responseHeaders({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  }));
  res.end(body);
}

function injectLandingCanonicalMeta(html) {
  const base = APP_URL.replace(/\/$/, "");
  const ogImage = `${base}/media/og-image.png`;
  return String(html)
    .replace(
      /<meta property="og:url" content="[^"]*"\/>/,
      `<meta property="og:url" content="${escapeHtmlText(`${base}/`)}" />`
    )
    .replace(
      /<meta property="og:image" content="[^"]*"\/>/,
      `<meta property="og:image" content="${escapeHtmlText(ogImage)}" />`
    )
    .replace(
      /<meta name="twitter:image" content="[^"]*"\/>/,
      `<meta name="twitter:image" content="${escapeHtmlText(ogImage)}" />`
    )
    .replace(
      /<link rel="canonical" href="[^"]*"\/>/,
      `<link rel="canonical" href="${escapeHtmlText(`${base}/`)}" />`
    )
    .replace(
      /<meta name="ts-app-origin" content="[^"]*"\/>/,
      `<meta name="ts-app-origin" content="${escapeHtmlText(base)}" />`
    );
}

async function sendStatic(res, relativePath, req = null) {
  const safePath = normalize(relativePath || "index.html").replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, "Forbidden");
  if (!existsSync(filePath)) return sendText(res, 404, "Not found");
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return sendText(res, 404, "Not found");

  const type = contentType(filePath);
  const isMedia = type.startsWith("video/") || type.startsWith("audio/");
  const cacheControl = isMedia ? "public, max-age=86400, immutable" : "no-store";
  const baseHeaders = responseHeaders({
    "content-type": type,
    "cache-control": cacheControl,
    "accept-ranges": "bytes",
    "content-length": String(fileStat.size)
  });

  if (req?.method === "HEAD") {
    res.writeHead(200, baseHeaders);
    res.end();
    return;
  }

  const rangeHeader = req?.headers?.range;
  if (isMedia && rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
    if (match) {
      const size = fileStat.size;
      let start = match[1] ? Number.parseInt(match[1], 10) : 0;
      let end = match[2] ? Number.parseInt(match[2], 10) : size - 1;
      if (Number.isNaN(start) || start < 0 || start >= size) {
        res.writeHead(416, responseHeaders({
          "content-range": `bytes */${size}`,
          "accept-ranges": "bytes"
        }));
        res.end();
        return;
      }
      end = Math.min(end, size - 1);
      if (Number.isNaN(end) || end < start) end = size - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, responseHeaders({
        "content-type": type,
        "cache-control": cacheControl,
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(chunkSize)
      }));
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }

  if (isMedia) {
    res.writeHead(200, baseHeaders);
    createReadStream(filePath).pipe(res);
    return;
  }

  const body = await readFile(filePath);
  res.writeHead(200, baseHeaders);
  res.end(body);
}

async function sendImportsStatic(res, pathname) {
  const base = join(ROOT, "src", "imports");
  const suffix = decodeURIComponent(pathname.replace(/^\/src\/imports\/?/, ""));
  if (!suffix || suffix.includes("..")) return sendText(res, 403, "Forbidden");
  const filePath = normalize(join(base, suffix));
  if (!filePath.startsWith(base)) return sendText(res, 403, "Forbidden");
  if (!existsSync(filePath)) return sendText(res, 404, "Not found");
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return sendText(res, 404, "Not found");
  const body = await readFile(filePath);
  res.writeHead(200, responseHeaders({
    "content-type": contentType(filePath),
    "cache-control": "no-store"
  }));
  res.end(body);
}

function publicConfig() {
  const ldaEnabled = Boolean(process.env.SENATE_LDA_API_KEY);
  const dispatchWelcomeEnabled = Boolean(process.env.RESEND_API_KEY);
  return {
    auth: {
      demo: !isLandingOnly() && process.env.DEMO_AUTH !== "false",
      email: !isLandingOnly()
    },
    launch: {
      landingOnly: isLandingOnly(),
      waitlistOpen: true
    },
    dispatch: {
      dispatchWelcomeEnabled,
      dispatchNotifyEnabled: dispatchWelcomeEnabled && Boolean(process.env.DISPATCH_NOTIFY_EMAIL),
      ldaEnabled
    },
    data: {
      finnhub: Boolean(process.env.FINNHUB_API_KEY),
      yfinance: isYfinanceEnabled(),
      coingecko: Boolean(process.env.COINGECKO_API_KEY),
      congress: Boolean(process.env.CONGRESS_API_KEY),
      senateLda: ldaEnabled,
      ldaEnabled,
      alpaca: Boolean(process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      anthropicModel: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      gemini: Boolean(process.env.GEMINI_API_KEY),
      serverAi: serverAiProviderEnabled(),
      supabase: dbReady,
      secEdgar: true,
      fec: Boolean(process.env.FEC_API_KEY),
      healthEndpoint: "/api/health/data",
      strictDataMode: isStrictDataMode()
    },
    safety: {
      liveTradingEnabled: process.env.ALLOW_LIVE_TRADING === "true",
      alpacaPaperEnabled: alpacaPaperEnabled(),
      tradingBaseUrl: process.env.ALPACA_TRADING_BASE_URL || "https://paper-api.alpaca.markets"
    },
    features: { ...FEATURE_GATES }
  };
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────

async function saveAnthropicSettings(req, res) {
  // Admin-only: this sets the server's shared Anthropic key/model for every
  // user's "server AI" requests, not a per-user setting. Any authenticated
  // user being able to call this would let them silently redirect every other
  // user's AI traffic through a key of their choosing.
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !safeEqual(String(req.headers["x-admin-secret"] || ""), secret)) {
    logAdminAuthFailure("settings/anthropic", req);
    return sendJson(res, 401, { error: "unauthorized" });
  }
  if (!adminRateLimitOk(req)) {
    return sendJson(res, 429, { error: "rate_limited", message: "Too many attempts. Try again later." });
  }

  const body = await readJson(req);
  const apiKey = String(body.apiKey || "").trim();
  const model  = String(body.model  || "").trim();

  // Reject control characters (newline, CR, NUL) so a submitted value can
  // never inject extra lines into .env.local when persisted below.
  if (/[\r\n\0]/.test(apiKey) || /[\r\n\0]/.test(model)) {
    return sendJson(res, 400, { error: "invalid_characters", message: "Key/model must not contain control characters." });
  }
  if (!apiKey) return sendJson(res, 400, { error: "api_key_required" });
  if (!apiKey.startsWith("sk-ant-")) return sendJson(res, 400, { error: "invalid_key_format", message: "Key must start with sk-ant-" });

  // Update in-memory immediately so the next request uses it
  process.env.ANTHROPIC_API_KEY = apiKey;
  if (model) process.env.ANTHROPIC_MODEL = model;

  // Persist to .env.local so it survives restarts
  try {
    const envPath = join(ROOT, ".env.local");
    let content = "";
    try { content = await readFile(envPath, "utf8"); } catch { /* file may not exist */ }

    function setEnvLine(src, key, value) {
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const re = new RegExp(`^${key}=.*$`, "m");
      return re.test(src) ? src.replace(re, `${key}=${escaped}`) : src + (src.endsWith("\n") ? "" : "\n") + `${key}=${escaped}\n`;
    }

    content = setEnvLine(content, "ANTHROPIC_API_KEY", apiKey);
    if (model) content = setEnvLine(content, "ANTHROPIC_MODEL", model);
    await writeFile(envPath, content, "utf8");
  } catch (err) {
    console.error("[settings] Failed to write .env.local:", err.message);
  }

  sendJson(res, 200, { ok: true });
}

// ── SUPABASE HELPERS ──────────────────────────────────────────────────────────

async function upsertUserProfile(user) {
  if (!dbReady) return;
  await dbUpsert("profiles", {
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture || "",
    provider: user.provider,
    updated_at: new Date().toISOString()
  }, "id");
}

async function getPortfolio(res, session) {
  if (!dbReady || isDemoSession(session)) {
    return sendJson(res, 200, {
      positions: [],
      cash: PAPER_STARTING_CASH,
      source: "local_paper",
      message: "Supabase not configured; paper account uses /api/trading/account."
    });
  }
  const account = await getPaperAccount(session);
  const blob = encodePortfolioBlob(account);
  sendJson(res, 200, {
    positions: blob.holdings,
    cash: account.cash,
    orders: blob.orders,
    theses: blob.theses,
    funds: blob.funds,
    updated_at: account.updatedAt,
    source: "supabase"
  });
}

async function patchPortfolio(req, res, session) {
  if (!dbReady || isDemoSession(session)) {
    return sendJson(res, 503, { error: "database_not_configured" });
  }
  const body = await readJson(req);
  const hasUpdate =
    Array.isArray(body.positions) ||
    typeof body.cash === "number" ||
    Array.isArray(body.orders) ||
    Array.isArray(body.theses) ||
    Array.isArray(body.funds);
  if (!hasUpdate) return sendJson(res, 400, { error: "nothing_to_update" });
  await runPaperWrite(session, async (account) => {
    if (Array.isArray(body.positions)) {
      if (body.positions.every((row) => row && typeof row === "object" && row.symbol)) {
        const holdings = {};
        for (const row of body.positions) {
          const sym = normalizeTickerSymbol(row.symbol);
          if (!sym) continue;
          holdings[sym] = {
            symbol: sym,
            qty: Number(row.qty || 0),
            avgCost: Number(row.avg_price ?? row.avgCost ?? 0)
          };
        }
        account.positions = holdings;
      } else {
        account.positions = body.positions;
      }
    }
    if (typeof body.cash === "number") account.cash = body.cash;
    if (Array.isArray(body.orders)) account.orders = body.orders;
    if (Array.isArray(body.theses)) account.theses = body.theses;
    if (Array.isArray(body.funds)) account.funds = body.funds;
  });
  const account = await getPaperAccount(session);
  sendJson(res, 200, {
    ok: true,
    portfolio: {
      positions: account.positions,
      cash: account.cash,
      updated_at: account.updatedAt
    }
  });
}

async function getWatchlist(res, session) {
  if (isDemoSession(session)) {
    return sendJson(res, 200, {
      symbols: DASHBOARD_WATCHLIST_DEFAULT.map((row) => row.symbol).filter(Boolean),
      source: "demo_default"
    });
  }
  if (!dbReady) {
    return sendJson(res, 200, {
      symbols: [],
      source: "dashboard_default",
      message: "Supabase not configured; watchlist comes from /api/dashboard/bootstrap defaults."
    });
  }
  const row = await fetchWatchlistRow(session.user.id);
  if (!row) return sendJson(res, 200, { symbols: [] });
  sendJson(res, 200, { symbols: row.symbols || [], updated_at: row.updated_at });
}

async function patchWatchlist(req, res, session) {
  if (isDemoSession(session)) {
    return sendJson(res, 200, {
      ok: true,
      symbols: DASHBOARD_WATCHLIST_DEFAULT.map((row) => row.symbol).filter(Boolean),
      source: "demo_local"
    });
  }
  const body = await readJson(req);
  if (!Array.isArray(body.symbols)) return sendJson(res, 400, { error: "symbols must be an array" });
  const symbols = body.symbols.map((s) => String(s).toUpperCase().trim()).filter(Boolean).slice(0, 50);
  if (!dbReady) {
    return sendJson(res, 200, {
      ok: true,
      symbols,
      source: "local_session",
      message: "Supabase not configured; watchlist changes apply for this session only."
    });
  }
  await upsertUserProfile(session.user);
  const result = await saveWatchlistRow(session.user.id, symbols);
  if (!result) return sendJson(res, 502, { error: "database_error" });
  sendJson(res, 200, { ok: true, symbols: result.symbols, source: "supabase" });
}

async function waitlistAdmin(req, res) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !safeEqual(String(req.headers["x-admin-secret"] || ""), secret)) {
    logAdminAuthFailure("admin/waitlist", req);
    return sendJson(res, 401, { error: "unauthorized" });
  }
  if (!adminRateLimitOk(req)) {
    return sendJson(res, 429, { error: "rate_limited", message: "Too many attempts. Try again later." });
  }
  if (dbReady) {
    const rows = await dbSelect("waitlist", "select=email,source,user_agent,created_at&order=created_at.desc");
    return sendJson(res, 200, { count: rows?.length || 0, entries: rows || [], source: "supabase" });
  }
  try {
    const raw = await readFile(WAITLIST_FILE, "utf8").catch(() => "");
    const entries = raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return sendJson(res, 200, { count: entries.length, entries, source: "file" });
  } catch {
    return sendJson(res, 200, { count: 0, entries: [], source: "file" });
  }
}

async function notifyDispatchSignup(email, source) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const notifyEmail = String(process.env.DISPATCH_NOTIFY_EMAIL || "").trim();
  if (!apiKey || !notifyEmail) return;

  const fromEmail = String(process.env.DISPATCH_FROM_EMAIL || "").trim()
    || "TradeSimple Dispatch <onboarding@resend.dev>";

  try {
    const response = await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [notifyEmail],
        subject: `Dispatch signup: ${email}`,
        text: [
          "New TradeSimple dispatch signup",
          "",
          `Email: ${email}`,
          `Source: ${source}`,
          `Time: ${new Date().toISOString()}`
        ].join("\n")
      })
    }, 8000);
    if (!response.ok) {
      console.error("[dispatch-notify] Resend error", response.status, await response.text());
    }
  } catch (err) {
    console.error("[dispatch-notify]", err.message);
  }
}

async function sendDispatchWelcomeEmail(email) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) return;

  const fromEmail = String(process.env.DISPATCH_FROM_EMAIL || "").trim()
    || "TradeSimple Dispatch <onboarding@resend.dev>";
  const leadId = EDITORIAL_LEAD_BILL_ID || "S.2-119";
  const briefUrl = `${APP_URL}/bill/${encodeURIComponent(leadId)}`;

  try {
    const response = await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: "You're on the TradeSimple dispatch list",
        text: [
          "Thanks for subscribing to TradeSimple dispatch.",
          "",
          "We'll reach you before the headline breaks wide.",
          "",
          `Read today's editorial brief: ${briefUrl}`,
          "",
          "— TradeSimple"
        ].join("\n")
      })
    }, 8000);
    if (!response.ok) {
      console.error("[dispatch-welcome] Resend error", response.status, await response.text());
    }
  } catch (err) {
    console.error("[dispatch-welcome]", err.message);
  }
}

function validateBillsAdmin(req, res) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !safeEqual(String(req.headers["x-admin-secret"] || ""), secret)) {
    logAdminAuthFailure("admin/validate-bills", req);
    return sendJson(res, 401, { error: "unauthorized" });
  }
  if (!adminRateLimitOk(req)) {
    return sendJson(res, 429, { error: "rate_limited", message: "Too many attempts. Try again later." });
  }
  return sendJson(res, 200, validateBillPipelineSample());
}

async function waitlistSignup(req, res) {
  const body = await readJson(req);
  const email = String(body.email || "").trim().toLowerCase();
  const source = String(body.source || "landing").slice(0, 80);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return sendJson(res, 400, {
      error: "invalid_email",
      message: "Enter a valid email address."
    });
  }

  const alreadyMsg = "You're already on the dispatch list. We'll reach you before early access opens.";
  const successMsg = "You're on the dispatch list. We'll reach you before the headline.";
  const failMsg = "Could not save your email right now. Try again in a moment.";

  // ── Supabase path ──────────────────────────────────────────────────────────
  if (dbReady) {
    const existing = await dbSelect("waitlist", `email=eq.${encodeURIComponent(email)}&select=id`);
    if (existing && existing.length > 0) return sendJson(res, 200, { ok: true, message: alreadyMsg });
    const inserted = await dbInsert("waitlist", {
      email,
      source,
      user_agent: req.headers["user-agent"] || ""
    });
    if (!inserted) return sendJson(res, 502, { error: "persist_failed", message: failMsg });
    notifyDispatchSignup(email, source).catch(() => {});
    sendDispatchWelcomeEmail(email).catch(() => {});
    return sendJson(res, 200, { ok: true, message: successMsg });
  }

  // ── File fallback ──────────────────────────────────────────────────────────
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const existing = await readFile(WAITLIST_FILE, "utf8");
    const alreadyOn = existing.split("\n").filter(Boolean).some((line) => {
      try { return JSON.parse(line).email === email; } catch { return false; }
    });
    if (alreadyOn) return sendJson(res, 200, { ok: true, message: alreadyMsg });
  } catch { /* file doesn't exist yet */ }

  await withFileLock(WAITLIST_FILE, () =>
    appendFile(
      WAITLIST_FILE,
      JSON.stringify({ email, source, userAgent: req.headers["user-agent"] || "", createdAt: new Date().toISOString() }) + "\n",
      "utf8"
    )
  );
  notifyDispatchSignup(email, source).catch(() => {});
  sendDispatchWelcomeEmail(email).catch(() => {});
  sendJson(res, 200, { ok: true, message: successMsg });
}

async function marketQuotesCatalog(res) {
  const symbols = getCatalogQuoteSymbols();
  const filteredQuotes = [];
  const needsLiveRefresh = [];
  for (const symbol of symbols) {
    const result = quoteSnapshotCachedOrFallback(symbol);
    if (result.quote && quoteHasValidPrice(result.quote)) {
      filteredQuotes.push(result.quote);
      const cached = quoteCache.get(symbol);
      const fresh = cachedQuoteFresh(symbol);
      const isStale = !fresh || !isLiveQuoteSource(fresh.quote.source);
      if (isStale || result.quote.source === "fallback_static") needsLiveRefresh.push(symbol);
      continue;
    }
    const fallbackRow = resolveCatalogFallbackQuote(symbol);
    if (fallbackRow) {
      const quote = withQuoteFreshness(fallbackRow, "fallback_static", fallbackRow.timestamp || null);
      quoteCache.set(symbol, { cachedAt: Date.now(), quote });
      filteredQuotes.push(quote);
      needsLiveRefresh.push(symbol);
    }
  }
  if (needsLiveRefresh.length) queueBackgroundQuoteRefresh(needsLiveRefresh);
  const liveCount = filteredQuotes.filter((q) => q.source === "finnhub").length;
  const yfinanceCount = filteredQuotes.filter((q) => q.source === "yfinance").length;
  const publicCount = filteredQuotes.filter(
    (q) => q.source === "yahoo_chart" || q.source === "yfinance" || q.source === "stooq_public"
  ).length;
  const fallbackCount = filteredQuotes.filter((q) => q.source === "fallback_static").length;
  const source =
    fallbackCount === filteredQuotes.length
      ? "fallback"
      : liveCount === filteredQuotes.length
        ? "finnhub"
        : yfinanceCount === filteredQuotes.length
          ? "yfinance"
          : publicCount === filteredQuotes.length
            ? yfinanceCount
              ? "yfinance"
              : "yahoo_chart"
            : "mixed_live";
  const envelope = {
    source,
    catalog: true,
    symbolCount: symbols.length,
    quotes: filteredQuotes,
    confidence: scoreConfidence({
      missingInputs: Math.max(0, symbols.length - filteredQuotes.length) + fallbackCount,
      estimatedInputs: publicCount && !liveCount ? 1 : 0
    }),
    updatedAt: new Date().toISOString()
  };
  if (fallbackCount > 0) {
    envelope.staticQuoteCount = fallbackCount;
    envelope.liveQuoteCount = filteredQuotes.length - fallbackCount;
    if (fallbackCount === filteredQuotes.length) {
      envelope.fallback = true;
      envelope.fallbackNote =
        "Live quotes unavailable. Prices shown are static reference data and do not reflect current market conditions.";
    } else {
      envelope.partialFallback = true;
      envelope.fallbackNote = `${fallbackCount} symbol${fallbackCount === 1 ? "" : "s"} using static reference prices; others are live or delayed market data.`;
    }
  }
  if (filteredQuotes.length < symbols.length) {
    envelope.partial = true;
    envelope.pendingCount = symbols.length - filteredQuotes.length;
  }
  noteFeedSuccess("market", { source: envelope.source, recordCount: filteredQuotes.length });
  sendJson(res, 200, envelope);
}

async function marketQuotes(res, url) {
  const symbolsParam =
    url.searchParams.get("symbols") || "SPY,QQQ,NVDA,AAPL,TSLA,LLY,AMZN,MSFT,AMD,META";
  const symbols = [
    ...new Set(
      symbolsParam
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean)
    )
  ].slice(0, 120);
  const deadline = MARKET_QUOTES_MAX_MS > 0 ? Date.now() + MARKET_QUOTES_MAX_MS : Infinity;
  // Fetch with bounded concurrency so we never burst the provider rate limit.
  const filteredQuotes = [];
  let nextIndex = 0;
  async function quoteWorker() {
    while (nextIndex < symbols.length) {
      if (Date.now() >= deadline) break;
      const symbol = symbols[nextIndex++];
      const result = await quoteSnapshot(symbol);
      if (result.quote) filteredQuotes.push(result.quote);
    }
  }
  const workerCount = Math.min(QUOTE_FETCH_CONCURRENCY, symbols.length) || 1;
  await Promise.all(Array.from({ length: workerCount }, quoteWorker));
  const returnedSymbols = new Set(filteredQuotes.map((q) => q.symbol));
  for (const symbol of symbols) {
    if (returnedSymbols.has(symbol)) continue;
    const result = quoteSnapshotCachedOrFallback(symbol, { pending: true });
    if (result.quote) {
      filteredQuotes.push({ ...result.quote, pending: true });
      returnedSymbols.add(symbol);
    }
  }
  const liveCount = filteredQuotes.filter((q) => q.source === "finnhub").length;
  const yfinanceCount = filteredQuotes.filter((q) => q.source === "yfinance").length;
  const publicCount = filteredQuotes.filter((q) => q.source === "yahoo_chart" || q.source === "yfinance" || q.source === "stooq_public").length;
  const fallbackCount = filteredQuotes.filter((q) => q.source === "fallback_static").length;
  const source =
    fallbackCount === filteredQuotes.length
      ? "fallback"
      : liveCount === filteredQuotes.length
        ? "finnhub"
        : yfinanceCount === filteredQuotes.length
          ? "yfinance"
          : publicCount === filteredQuotes.length
            ? yfinanceCount ? "yfinance" : "yahoo_chart"
            : "mixed_live";

  const envelope = {
    source,
    quotes: filteredQuotes,
    confidence: scoreConfidence({
      missingInputs: Math.max(0, symbols.length - filteredQuotes.length) + fallbackCount,
      estimatedInputs: publicCount && !liveCount ? 1 : 0
    }),
    updatedAt: new Date().toISOString()
  };
  if (fallbackCount > 0) {
    envelope.staticQuoteCount = fallbackCount;
    envelope.liveQuoteCount = filteredQuotes.length - fallbackCount;
    if (fallbackCount === filteredQuotes.length) {
      envelope.fallback = true;
      envelope.fallbackNote =
        "Live quotes unavailable. Prices shown are static reference data and do not reflect current market conditions.";
    } else {
      envelope.partialFallback = true;
      envelope.fallbackNote = `${fallbackCount} symbol${fallbackCount === 1 ? "" : "s"} using static reference prices; others are live or delayed market data.`;
    }
  }
  if (filteredQuotes.length < symbols.length) {
    envelope.partial = true;
    envelope.pendingCount = symbols.length - filteredQuotes.length;
  }
  const pendingLive = filteredQuotes
    .filter((q) => q.pending && q.source === "fallback_static")
    .map((q) => q.symbol);
  if (pendingLive.length) queueBackgroundQuoteRefresh(pendingLive);
  noteFeedSuccess("market", { source: envelope.source, recordCount: filteredQuotes.length });
  sendJson(res, 200, envelope);
}

// Landing hero signal. With live Congress data: a daily highest-momentum pick,
// cached per calendar day and invalidated when the Congress live cache refreshes.
// Without live data: the original 30-second rotation through the seed pool.
let landingSignalDailyPick = null; // { dateKey, version, payload }
let landingSignalCacheVersion = 2;

function bumpLandingSignalCacheVersion() {
  landingSignalCacheVersion += 1;
}

function landingSignalDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

const ONBOARDING_BILL_FALLBACK = "H.R.3633-119";
const EDITORIAL_LEAD_BILL_ID = String(process.env.EDITORIAL_LEAD_BILL_ID || "S.2-119").trim();
const EDITORIAL_LEAD_CONTEXT = String(
  process.env.EDITORIAL_LEAD_CONTEXT ||
    "Drug pricing bill in Senate reconciliation — Medicare negotiation provisions would pressure pharma revenue. LLY, MRK, and BMY on the watchlist."
).trim();

function landingSignalBillPool() {
  const byId = new Map();
  for (const b of POLICY_BILLS) {
    if (b.scenarioOnly || !b.affected?.length) continue;
    if (!b.plainEnglish && !b._dynamicCongressBill) continue;
    if (!landingSignalBillQualifies(b)) continue;
    byId.set(b.id, b);
  }
  for (const [, b] of liveCongressBillRegistry) {
    if (!byId.has(b.id) && b.affected?.length && landingSignalBillQualifies(b)) byId.set(b.id, b);
  }
  const pool = [...byId.values()];
  return pool.length ? pool : POLICY_BILLS.filter((b) => b.affected?.length && landingSignalBillQualifies(b));
}

function landingSignalBillQualifies(bill) {
  const merged = decorateBill(mergeCongressLiveIntoBill(applyBillMarketExposure(bill)));
  const tickers = merged.affected || [];
  if (!tickers.length) return false;
  const why =
    buildWhyMarketsCareRules(merged, tickers) ||
    merged.plainEnglish ||
    merged.signal ||
    "";
  if (!why || why.length < 36) return Boolean((merged.plainEnglish || merged.signal || "").length > 36);
  const corpus = billExposureCorpus(merged);
  if (/ICE and Border Patrol|detention operators/i.test(why) && !isHomelandEnforcementCorpus(corpus, merged)) {
    return false;
  }
  return true;
}

function landingMomentumScore(bill) {
  let score = computeLegislativeMomentum(bill);
  const stageKey = normalizeStatusKey(bill.status, bill.latestAction, bill);
  if (stageKey === "passed_one_chamber") score += 10;
  else if (stageKey === "resolving") score += 8;
  else if (stageKey === "floor") score += 4;
  if (billActionWithinDays(bill, 2)) score += 14;
  else if (billActionWithinDays(bill, 7)) score += 7;
  return score;
}

function pickTopMomentumBill(pool = landingSignalBillPool()) {
  if (!pool.length) return null;
  const merged = pool.map((b) => mergeCongressLiveIntoBill(b));
  return merged
    .map((bill) => ({ bill, momentum: landingMomentumScore(bill) }))
    .sort((a, b) => b.momentum - a.momentum || String(a.bill.id).localeCompare(String(b.bill.id)))[0]?.bill;
}

function resolveOnboardingBill(pool = landingSignalBillPool()) {
  const editorial = resolveEditorialLeadBill(pool);
  if (editorial) {
    return {
      billId: editorial.id,
      title: editorial.shortTitle || editorial.title || editorial.id,
      reason: "editorial_lead"
    };
  }
  const top = pickTopMomentumBill(pool);
  if (top) {
    return {
      billId: top.id,
      title: top.shortTitle || top.title || top.id,
      reason: "top_momentum"
    };
  }
  const fallback =
    POLICY_BILLS.find((b) => b.id === ONBOARDING_BILL_FALLBACK) ||
    POLICY_BILLS.find((b) => b.affected?.length) ||
    POLICY_BILLS[0];
  return {
    billId: fallback?.id || ONBOARDING_BILL_FALLBACK,
    title: fallback?.shortTitle || fallback?.title || ONBOARDING_BILL_FALLBACK,
    reason: "fallback"
  };
}

function getOnboardingBillMeta() {
  return resolveOnboardingBill();
}

function onboardingBillBriefPath(meta = getOnboardingBillMeta()) {
  return `/bill/${encodeURIComponent(meta.billId)}?onboarding=1`;
}

function onboardingBillHandler(res) {
  onboardingBillHandlerAsync(res).catch((err) => {
    console.error("[onboarding-bill]", err.message);
    sendJson(res, 500, { error: "onboarding_bill_failed" });
  });
}

async function onboardingBillHandlerAsync(res) {
  const pool = landingSignalBillPool();
  const editorial = await resolveEditorialLeadBillAsync(pool);
  if (editorial) {
    return sendJson(res, 200, {
      billId: editorial.id,
      title: editorial.shortTitle || editorial.title || editorial.id,
      reason: "editorial_lead"
    });
  }
  return sendJson(res, 200, resolveOnboardingBill(pool));
}

function buildLandingSignalPayload(bill, mode, dateKey, { editorial = false } = {}) {
  const merged = decorateBill(mergeCongressLiveIntoBill(applyBillMarketExposure(bill)));
  const momentum = computeLegislativeMomentum(merged);
  const tickers = (merged.affected || []).slice(0, 3);
  const statusInfo = merged.statusInfo || statusInfoForBill(merged);
  const whyMarketsCare = buildWhyMarketsCareRules(merged, tickers) || merged.plainEnglish || merged.signal || "";
  const chain = (buildCausalChainRules(merged, tickers, statusInfo) || []).join(" ") ||
    `Congress.gov → ${merged.status || "Introduced"} → ${tickers.join(", ")}`;
  const freshness = buildFreshnessBadge({
    type: "bill",
    bill: merged,
    relatedContracts: [],
    exposureSource: merged.exposureSource || null
  });
  const policyTag =
    (Array.isArray(merged.tags) && merged.tags[0]) || merged.policyArea || null;
  return {
    billId: merged.id,
    label: editorial
      ? `Editorial lead · ${tickers[0] || "Policy"} · Policy exposure ${momentum}/100`
      : `LegisAlert · ${tickers[0] || "Policy"} · Policy exposure ${momentum}/100`,
    headline: merged.shortTitle || merged.title,
    editorialContext: editorial ? EDITORIAL_LEAD_CONTEXT : null,
    briefPath: shareBillPath(merged.id),
    chain,
    ticker: tickers[0] || null,
    tickers,
    policyTag,
    whyMarketsCare,
    confidence: momentum,
    signal: merged.signal || merged.plainEnglish || "",
    mode,
    editorial: Boolean(editorial),
    date: dateKey,
    pickedAt: new Date().toISOString(),
    live: Boolean(merged.exactCongressRecord),
    latestAction: merged.latestAction || null,
    latestActionDate: merged.latestActionDate || null,
    freshness
  };
}

function landingSignalHandler(res) {
  landingSignalHandlerAsync(res).catch((err) => {
    console.error("[landing-signal]", err.message);
    sendJson(res, 500, { error: "landing_signal_failed" });
  });
}

async function sendLandingSignalResponse(res, payload) {
  if (payload) {
    payload.trending = await buildLandingTrendingStrip();
    payload.contractAward = pickLandingContractAwardLine();
    try {
      const fecPayload = await getFecPulsePayload();
      if (fecPayload?.source === "fec") {
        payload.fecPulse = pickLandingFecPulseLine(fecPayload);
        payload.fecSource = "fec";
      } else {
        payload.fecPulse = null;
        payload.fecSource = "unavailable";
      }
    } catch {
      payload.fecPulse = null;
      payload.fecSource = "unavailable";
    }
    if (process.env.STRIPE_FOUNDING_MEMBER_LINK) {
      payload.foundingMemberLink = process.env.STRIPE_FOUNDING_MEMBER_LINK;
      payload.foundingMemberPrice = process.env.FOUNDING_MEMBER_PRICE || "$49/mo";
    }
  }
  return sendJson(res, 200, payload);
}

async function landingSignalHandlerAsync(res) {
  const pool = landingSignalBillPool();
  if (!pool.length) return sendLandingSignalResponse(res, null);

  const editorialBill = await resolveEditorialLeadBillAsync(pool);
  const merged = pool.map((b) => mergeCongressLiveIntoBill(b));
  const hasLiveData = merged.some((b) => b.exactCongressRecord) || Boolean(editorialBill?.exactCongressRecord);
  const dateKey = landingSignalDateKey();

  if (editorialBill) {
    if (
      !landingSignalDailyPick ||
      landingSignalDailyPick.dateKey !== dateKey ||
      landingSignalDailyPick.version !== landingSignalCacheVersion ||
      landingSignalDailyPick.payload?.billId !== editorialBill.id
    ) {
      landingSignalDailyPick = {
        dateKey,
        version: landingSignalCacheVersion,
        payload: buildLandingSignalPayload(editorialBill, "editorial", dateKey, { editorial: true })
      };
    }
    return sendLandingSignalResponse(res, landingSignalDailyPick.payload);
  }

  if (hasLiveData) {
    // Daily mode: deterministic per calendar day — highest momentum wins,
    // ties broken stably by bill id.
    if (
      !landingSignalDailyPick ||
      landingSignalDailyPick.dateKey !== dateKey ||
      landingSignalDailyPick.version !== landingSignalCacheVersion
    ) {
      const topBill = pickTopMomentumBill(pool);
      landingSignalDailyPick = {
        dateKey,
        version: landingSignalCacheVersion,
        payload: buildLandingSignalPayload(topBill, "daily", dateKey)
      };
    }
    return sendLandingSignalResponse(res, landingSignalDailyPick.payload);
  }

  // Fallback (no live Congress data): rotate every 30 seconds so the landing
  // page still feels alive in dev/demo mode.
  const idx = Math.floor(Date.now() / 30_000) % merged.length;
  return sendLandingSignalResponse(res, buildLandingSignalPayload(merged[idx], "rotation", dateKey));
}

// ── Trending topics (curated + live enrichment) ─────────────────────────────

const TRENDING_ENRICH_CACHE_TTL_MS = 5 * 60 * 1000;
let trendingEnrichCache = { fetchedAt: 0, topics: [] };

function topicKeywordsMatch(text, keywords = []) {
  const lower = String(text || "").toLowerCase();
  return keywords.some((kw) => lower.includes(String(kw || "").toLowerCase().trim()));
}

function inferTickerFromRecipientName(name = "") {
  const upper = String(name || "").toUpperCase();
  if (!upper) return null;
  const nameMap = { ...CONTRACT_COMPANY_NAMES, ...CONTRACT_SEARCH_HINTS };
  for (const [sym, label] of Object.entries(nameMap)) {
    const token = String(label || "").toUpperCase().split(/\s+/)[0];
    if (token.length >= 4 && upper.includes(token)) return sym;
  }
  for (const sym of Object.keys(CONTRACT_PROFILES)) {
    const hint = resolveContractCompanyName(sym);
    if (hint && upper.includes(String(hint).toUpperCase().slice(0, Math.min(10, hint.length)))) return sym;
  }
  return null;
}

async function loadTrendingTopicsStore() {
  try {
    const raw = await readFile(TRENDING_TOPICS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const topics = Array.isArray(parsed?.topics) ? parsed.topics : [];
    return { topics: topics.filter((t) => t && t.id && t.title) };
  } catch {
    return { topics: [] };
  }
}

async function saveTrendingTopicsStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await withFileLock(TRENDING_TOPICS_FILE, () =>
    writeFile(TRENDING_TOPICS_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8")
  );
}

function searchTrendingCorpusBills(keywords = []) {
  const matches = [];
  for (const bill of allBrowsablePolicyBills()) {
    const merged = decorateBill(mergeCongressLiveIntoBill(applyBillMarketExposure(bill)));
    const corpus = billExposureCorpus(merged).toLowerCase();
    if (!topicKeywordsMatch(corpus, keywords)) continue;
    matches.push({
      billId: merged.id,
      title: merged.shortTitle || merged.title || merged.id,
      status: merged.status || null,
      latestActionDate: merged.latestActionDate || merged.lastSubstantiveActionDate || null,
      tickers: (merged.affected || []).slice(0, 6),
      momentum: computeLegislativeMomentum(merged),
      briefUrl: shareBillPath(merged.id),
      source: "corpus"
    });
  }
  return matches.sort((a, b) => b.momentum - a.momentum).slice(0, 6);
}

async function searchCongressTrendingMatches(keywords = [], apiKey) {
  const matches = [];
  if (!apiKey) return matches;
  const cacheKey = `trending:congress:${keywords.join("|").toLowerCase()}`;
  const cached = usaspendingCacheGet(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetchWithTimeout(
      `https://api.congress.gov/v3/bill/${CURRENT_CONGRESS}?format=json&limit=100&sort=updateDate+desc&api_key=${encodeURIComponent(apiKey)}`,
      {},
      9000
    );
    if (!resp.ok) return matches;
    const data = await resp.json();
    for (const bill of data.bills || []) {
      const title = bill.title || "";
      if (!topicKeywordsMatch(title, keywords)) continue;
      const normalized = decorateBill(normalizeLiveCongressBill(bill));
      matches.push({
        billId: normalized.id,
        title: normalized.shortTitle || normalized.title || normalized.id,
        status: normalized.status || null,
        latestActionDate: normalized.latestActionDate || null,
        tickers: (normalized.affected || []).slice(0, 6),
        momentum: computeLegislativeMomentum(normalized),
        briefUrl: shareBillPath(normalized.id),
        source: "congress_api"
      });
    }
    const sorted = matches.sort((a, b) => b.momentum - a.momentum).slice(0, 6);
    usaspendingCacheSet(cacheKey, sorted);
    return sorted;
  } catch {
    return matches;
  }
}

async function searchTrendingContractMatches(keywords = []) {
  const matches = [];
  const seen = new Set();
  for (const kw of keywords.slice(0, 3)) {
    const results = await fetchUsaspendingSpendingByAward(
      { keywords: [kw] },
      `trending:contracts:${String(kw).toLowerCase()}`
    );
    for (const row of results || []) {
      const key = row.awardId || row.internalId || row.recipientName;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      matches.push({
        awardId: row.awardId || null,
        recipientName: row.recipientName || null,
        awardingAgency: row.awardingAgency || null,
        obligatedAmount: row.obligatedAmount || 0,
        startDate: row.startDate || null,
        directUrl: row.directUrl || usaspendingSearchUrl(row.recipientName || kw),
        inferredTicker: inferTickerFromRecipientName(row.recipientName),
        description: row.description || null
      });
    }
  }
  return matches.slice(0, 8);
}

async function searchTrendingHeadlineMatches(topic) {
  const keywords = topic.keywords || [];
  const tickers = [...new Set([...(topic.tickers || []), ...(topic.relatedTickers || [])])].slice(0, 4);
  const pool = [];
  const seen = new Set();

  if (process.env.FINNHUB_API_KEY && tickers.length) {
    for (const sym of tickers) {
      const rows = await fetchCompanyNews(sym, { days: 3, limit: 6 }).catch(() => []);
      for (const row of rows) {
        const blob = `${row.headline || ""} ${row.summary || ""}`.toLowerCase();
        if (!topicKeywordsMatch(blob, keywords) && !topicKeywordsMatch(blob, [topic.title])) continue;
        const key = row.url || row.headline;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        pool.push({ ...row, symbol: sym, stub: false });
      }
    }
  }

  if (!pool.length) {
    pool.push({
      headline: `Monitoring: ${topic.title}`,
      source: "TradeSimple rules",
      url: null,
      publishedAt: new Date().toISOString(),
      summary: `Keyword watch on ${keywords.join(", ") || topic.title}. Context only — not investment advice.`,
      stub: true
    });
  }

  return pool
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, 6);
}

function buildTrendingMappedTickers(topic, congressMatches = [], contractMatches = []) {
  const set = new Set();
  (topic.tickers || []).forEach((t) => set.add(String(t).toUpperCase()));
  (topic.relatedTickers || []).forEach((t) => set.add(String(t).toUpperCase()));
  for (const row of congressMatches) {
    (row.tickers || []).forEach((t) => set.add(String(t).toUpperCase()));
  }
  for (const row of contractMatches) {
    if (row.inferredTicker) set.add(String(row.inferredTicker).toUpperCase());
  }
  return [...set].filter((t) => VALID_TICKER_PATTERN.test(t)).slice(0, 10);
}

async function enrichTrendingTopic(topic) {
  const keywords = topic.keywords || [];
  const corpusMatches = searchTrendingCorpusBills(keywords);
  const apiCongressMatches = await searchCongressTrendingMatches(keywords, process.env.CONGRESS_API_KEY);
  const corpusIds = new Set(corpusMatches.map((m) => m.billId));
  const congressMatches = [
    ...corpusMatches,
    ...apiCongressMatches.filter((m) => !corpusIds.has(m.billId))
  ].slice(0, 8);
  const contractMatches = await searchTrendingContractMatches(keywords);
  const headlineMatches = await searchTrendingHeadlineMatches(topic);
  const mappedTickers = buildTrendingMappedTickers(topic, congressMatches, contractMatches);
  const directTickers = (topic.tickers || [])
    .map((t) => String(t).toUpperCase())
    .filter((t) => VALID_TICKER_PATTERN.test(t));
  const relatedTickers = [
    ...new Set([
      ...(topic.relatedTickers || []).map((t) => String(t).toUpperCase()),
      ...mappedTickers.filter((t) => !directTickers.includes(t))
    ])
  ].filter((t) => VALID_TICKER_PATTERN.test(t)).slice(0, 8);

  const bestBill = congressMatches[0] || null;
  const freshness = buildFreshnessBadge({
    type: "bill",
    bill: bestBill
      ? {
          exactCongressRecord: bestBill.source === "congress_api",
          _dynamicCongressBill: true,
          latestActionDate: bestBill.latestActionDate,
          lobbyingSource: null
        }
      : {},
    relatedContracts: contractMatches
      .filter((c) => c.directUrl)
      .map((c) => ({ directUrl: c.directUrl, awardCount: 1 }))
  });

  return {
    id: topic.id,
    title: topic.title,
    type: topic.type || "topic",
    keywords: topic.keywords || [],
    tickers: directTickers,
    relatedTickers,
    pinned: Boolean(topic.pinned),
    addedAt: topic.addedAt || null,
    hasPublicTicker: directTickers.length > 0,
    privateCompany: directTickers.length === 0,
    congressMatches,
    contractMatches,
    headlineMatches,
    mappedTickers,
    freshness,
    briefUrl: bestBill?.briefUrl || null,
    disclaimer: "Monitoring topic · not investment advice",
    enrichedAt: new Date().toISOString()
  };
}

async function getEnrichedTrendingTopics({ force = false } = {}) {
  const store = await loadTrendingTopicsStore();
  if (
    !force &&
    trendingEnrichCache.topics.length &&
    Date.now() - trendingEnrichCache.fetchedAt < TRENDING_ENRICH_CACHE_TTL_MS
  ) {
    return trendingEnrichCache.topics;
  }
  const enriched = [];
  for (const topic of store.topics) {
    enriched.push(await enrichTrendingTopic(topic));
  }
  enriched.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  trendingEnrichCache = { fetchedAt: Date.now(), topics: enriched };
  return enriched;
}

function summarizeTrendingForLanding(topic) {
  const direct = topic.tickers || [];
  const related = (topic.relatedTickers || []).filter((t) => !direct.includes(t));
  let tickerLabel = "";
  if (direct.length) tickerLabel = direct.join(", ");
  else if (related.length) tickerLabel = `No public ticker · related: ${related.slice(0, 3).join(", ")}`;
  else tickerLabel = "No public ticker";

  return {
    id: topic.id,
    title: topic.title,
    type: topic.type,
    mappedTickers: topic.mappedTickers || [],
    tickerLabel,
    hasPublicTicker: topic.hasPublicTicker,
    privateCompany: topic.privateCompany,
    briefUrl: topic.briefUrl,
    headline: (topic.headlineMatches || [])[0]?.headline || null,
    freshness: topic.freshness,
    disclaimer: topic.disclaimer
  };
}

async function buildLandingTrendingStrip() {
  const topics = await getEnrichedTrendingTopics();
  return topics.filter((t) => t.pinned).slice(0, 3).map(summarizeTrendingForLanding);
}

function trendingListHandler(res) {
  trendingListHandlerAsync(res).catch((err) => {
    console.error("[trending]", err.message);
    sendJson(res, 500, { error: "trending_failed" });
  });
}

async function trendingListHandlerAsync(res) {
  const topics = await getEnrichedTrendingTopics();
  const watchPayload = await getContractWatchPayload().catch(() => ({ awards: [] }));
  const watchTopics = (watchPayload.awards || [])
    .filter((row) => row.isNew || isWithinDays(row.firstSeenAt, 2))
    .slice(0, 8)
    .map(contractWatchAlertAsTrendingTopic);
  const merged = [...watchTopics, ...topics.filter((t) => !String(t.id).startsWith("contract-watch-"))];
  sendJson(res, 200, {
    topics: merged,
    count: merged.length,
    contractWatchCount: watchTopics.length,
    disclaimer: "Monitoring topics · not investment advice",
    updatedAt: new Date().toISOString()
  });
}

async function trendingAdminHandler(req, res) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !safeEqual(String(req.headers["x-admin-secret"] || ""), secret)) {
    logAdminAuthFailure("admin/trending", req);
    return sendJson(res, 401, { error: "unauthorized" });
  }
  if (!adminRateLimitOk(req)) {
    return sendJson(res, 429, { error: "rate_limited", message: "Too many attempts. Try again later." });
  }
  const body = await readJson(req);
  const store = await loadTrendingTopicsStore();
  const incoming = body.topic || body;
  const topics = Array.isArray(body.topics) ? body.topics : null;

  if (topics) {
    store.topics = topics
      .filter((t) => t && t.id && t.title)
      .map((t) => ({
        id: String(t.id).trim(),
        title: String(t.title).trim(),
        keywords: Array.isArray(t.keywords) ? t.keywords.map(String) : [],
        tickers: Array.isArray(t.tickers) ? t.tickers.map((s) => String(s).toUpperCase()) : [],
        relatedTickers: Array.isArray(t.relatedTickers) ? t.relatedTickers.map((s) => String(s).toUpperCase()) : [],
        type: String(t.type || "topic"),
        pinned: Boolean(t.pinned),
        addedAt: t.addedAt || new Date().toISOString().slice(0, 10)
      }));
  } else if (incoming?.id && incoming?.title) {
    const normalized = {
      id: String(incoming.id).trim(),
      title: String(incoming.title).trim(),
      keywords: Array.isArray(incoming.keywords) ? incoming.keywords.map(String) : [],
      tickers: Array.isArray(incoming.tickers) ? incoming.tickers.map((s) => String(s).toUpperCase()) : [],
      relatedTickers: Array.isArray(incoming.relatedTickers)
        ? incoming.relatedTickers.map((s) => String(s).toUpperCase())
        : [],
      type: String(incoming.type || "topic"),
      pinned: incoming.pinned !== false,
      addedAt: incoming.addedAt || new Date().toISOString().slice(0, 10)
    };
    const idx = store.topics.findIndex((t) => t.id === normalized.id);
    if (idx >= 0) store.topics[idx] = { ...store.topics[idx], ...normalized };
    else store.topics.push(normalized);
  } else {
    return sendJson(res, 400, { error: "invalid_topic", message: "Provide topic { id, title } or topics[]" });
  }

  await saveTrendingTopicsStore(store);
  trendingEnrichCache = { fetchedAt: 0, topics: [] };
  const enriched = await getEnrichedTrendingTopics({ force: true });
  sendJson(res, 200, { ok: true, count: store.topics.length, topics: enriched });
}

// ── Contract Watch (USASpending significant-award monitor) ─────────────────

const CONTRACT_WATCH_PRIVATE_RELATED = {
  spacex: ["SPCX", "BAH", "LMT", "RKLB"],
  "space exploration": ["SPCX", "BAH", "LMT", "RKLB"],
  anduril: ["LMT", "PLTR", "BAH"]
};

const CONTRACT_WATCH_DISCLAIMER =
  "Federal award data from USASpending.gov. DoD postings may lag signing by up to 90 days. Research context only — not investment advice.";

let contractWatchRuntime = { lastRefreshAt: null, awards: [], alerts: [], refreshing: false };
let contractWatchApiCache = { fetchedAt: 0, payload: null };

function defaultContractWatchStore() {
  return {
    config: {
      recipients: [
        "SPACEX",
        "SPACE EXPLORATION",
        "SPACE EXPLORATION TECHNOLOGIES",
        "PALANTIR",
        "GEO GROUP",
        "CORECIVIC",
        "BOOZ ALLEN",
        "LOCKHEED",
        "NORTHROP"
      ],
      minAmount: 10_000_000,
      agencies: [
        "Department of Defense",
        "National Aeronautics and Space Administration",
        "Department of Homeland Security"
      ]
    },
    seenAwardIds: {},
    alerts: [],
    awards: [],
    lastRefreshAt: null,
    updatedAt: null
  };
}

async function loadContractWatchStore() {
  try {
    const raw = await readFile(CONTRACT_WATCH_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const base = defaultContractWatchStore();
    return {
      ...base,
      ...parsed,
      config: { ...base.config, ...(parsed.config || {}) },
      seenAwardIds: parsed.seenAwardIds && typeof parsed.seenAwardIds === "object" ? parsed.seenAwardIds : {},
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
      awards: Array.isArray(parsed.awards) ? parsed.awards : []
    };
  } catch {
    return defaultContractWatchStore();
  }
}

async function saveContractWatchStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await withFileLock(CONTRACT_WATCH_FILE, () =>
    writeFile(CONTRACT_WATCH_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8")
  );
}

function parseUsaspendingTimestamp(value) {
  if (!value) return NaN;
  const normalized = String(value).trim().replace(" ", "T");
  const ts = Date.parse(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
  return Number.isFinite(ts) ? ts : NaN;
}

function isWithinDays(value, days) {
  const ts = parseUsaspendingTimestamp(value);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= Number(days) * 86_400_000;
}

function contractWatchAwardKey(row) {
  return (
    row?.internalId ||
    row?.generated_internal_id ||
    row?.["generated_internal_id"] ||
    row?.awardId ||
    row?.["Award ID"] ||
    null
  );
}

function agencyMatchesWatch(awardingAgency, agencies = []) {
  if (!agencies.length) return true;
  const agency = String(awardingAgency || "").toLowerCase();
  return agencies.some((name) => {
    const n = String(name || "").toLowerCase();
    return agency.includes(n) || n.includes(agency);
  });
}

function mapUsaspendingWatchAwardRow(row) {
  const base = mapUsaspendingAwardRow(row);
  return {
    ...base,
    lastModifiedDate: row["Last Modified Date"] || null
  };
}

async function fetchUsaspendingWatchAwards(filters, cacheKey, { sort = "Last Modified Date", limit = 20 } = {}) {
  if (cacheKey) {
    const cached = usaspendingCacheGet(cacheKey);
    if (cached) return cached;
  }

  const watchFields = [
    "Award ID",
    "generated_internal_id",
    "recipient_id",
    "Recipient Name",
    "Awarding Agency",
    "Award Amount",
    "Description",
    "Start Date",
    "End Date",
    "Contract Award Type",
    "NAICS",
    "PSC",
    "Last Modified Date"
  ];

  try {
    const response = await fetchWithTimeout(
      `${USASPENDING_API_BASE}/search/spending_by_award/`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: { ...filters, award_type_codes: ["A", "B", "C", "D"] },
          fields: watchFields,
          sort,
          order: "desc",
          page: 1,
          limit
        })
      },
      USASPENDING_FETCH_TIMEOUT_MS
    );
    if (!response.ok) return null;
    const data = await response.json();
    const results = (data.results || []).slice(0, limit).map(mapUsaspendingWatchAwardRow);
    if (results.length && cacheKey) usaspendingCacheSet(cacheKey, results);
    return results.length ? results : null;
  } catch {
    return null;
  }
}

function contractWatchSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function relatedTickersForPrivateRecipient(recipientName = "", watchKeyword = "") {
  const blob = `${recipientName} ${watchKeyword}`.toLowerCase();
  const found = new Set();
  for (const [needle, tickers] of Object.entries(CONTRACT_WATCH_PRIVATE_RELATED)) {
    if (blob.includes(needle)) tickers.forEach((t) => found.add(String(t).toUpperCase()));
  }
  if (/spacex|space exploration/i.test(blob)) ["SPCX", "BAH", "LMT", "RKLB"].forEach((t) => found.add(t));
  if (/palantir/i.test(blob)) found.add("PLTR");
  if (/geo group/i.test(blob)) found.add("GEO");
  if (/corecivic/i.test(blob)) found.add("CXW");
  if (/booz allen/i.test(blob)) found.add("BAH");
  if (/lockheed/i.test(blob)) found.add("LMT");
  if (/northrop/i.test(blob)) found.add("NOC");
  if (/leidos/i.test(blob)) found.add("LDOS");
  if (/saic/i.test(blob)) found.add("SAIC");
  return [...found].filter((t) => VALID_TICKER_PATTERN.test(t)).slice(0, 6);
}

function mapContractWatchTickers(row) {
  const recipient = row.recipientName || "";
  const direct = contractSymbolForCompany(recipient) || inferTickerFromRecipientName(recipient);
  const mapped = direct ? [direct] : [];
  const related = relatedTickersForPrivateRecipient(recipient, row.watchKeyword || "");
  const noPublicTicker = mapped.length === 0;
  const mergedRelated = [...new Set(related.filter((t) => !mapped.includes(t)))];
  return { mappedTickers: mapped, relatedTickers: mergedRelated, noPublicTicker };
}

function buildContractWatchFreshness({ lastModifiedDate, firstSeenAt, isNew }) {
  const modDays = freshnessDaysSince(lastModifiedDate);
  const seenDays = freshnessDaysSince(firstSeenAt);
  let label = "Recent";
  if (isNew || (seenDays != null && seenDays <= 2)) label = "New";
  else if (modDays != null && modDays <= 1) label = "Updated today";
  else if (modDays != null && modDays <= 7) label = "This week";
  return {
    label,
    status: modDays != null && modDays <= 7 ? "verified" : "stale",
    lastModifiedDate: lastModifiedDate || null,
    firstSeenAt: firstSeenAt || null
  };
}

function contractWatchRelativeTime(value) {
  const days = freshnessDaysSince(value);
  if (days == null) return "recently";
  if (days < 1 / 24) return "just now";
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h ago`;
  if (days < 14) return `${Math.round(days)}d ago`;
  return freshnessShortDate(value) || "recently";
}

function formatContractWatchAward(row, mapping, seenRecord, nowIso) {
  const key = contractWatchAwardKey(row);
  const firstSeenAt = seenRecord[key] || nowIso;
  const lastModifiedDate = row.lastModifiedDate || null;
  const isNew = isWithinDays(firstSeenAt, 2) && isWithinDays(lastModifiedDate, 7);
  const primaryTicker = mapping.mappedTickers[0] || mapping.relatedTickers[0] || null;
  const description = row.description || "";
  return {
    awardId: row.awardId || key,
    internalId: row.internalId || null,
    recipient: row.recipientName || "Unknown recipient",
    amount: Number(row.obligatedAmount || 0),
    agency: row.awardingAgency || null,
    awardDate: row.startDate || null,
    actionDate: row.lastModifiedDate || row.startDate || null,
    lastModifiedDate,
    descriptionSnippet: description ? `${description.slice(0, 180)}${description.length > 180 ? "…" : ""}` : null,
    mappedTickers: mapping.mappedTickers,
    relatedTickers: mapping.relatedTickers,
    noPublicTicker: mapping.noPublicTicker,
    contractUrl: row.directUrl || usaspendingSearchUrl(row.recipientName),
    contractBriefUrl: primaryTicker ? shareContractPath(primaryTicker) : null,
    freshness: buildContractWatchFreshness({ lastModifiedDate, firstSeenAt, isNew }),
    isNew,
    firstSeenAt,
    watchKeyword: row.watchKeyword || null,
    disclaimer: CONTRACT_WATCH_DISCLAIMER
  };
}

async function refreshContractWatch({ force = false } = {}) {
  if (contractWatchRuntime.refreshing && !force) return contractWatchRuntime;
  contractWatchRuntime.refreshing = true;

  try {
    const store = await loadContractWatchStore();
    const config = store.config || defaultContractWatchStore().config;
    const minAmount = Number(config.minAmount) || 10_000_000;
    const recipients = [...new Set((config.recipients || []).map((r) => String(r).trim()).filter(Boolean))];
    const agencies = config.agencies || [];
    const seen = { ...(store.seenAwardIds || {}) };
    const isFirstRun = !Object.keys(seen).length;
    const nowIso = new Date().toISOString();
    const collected = new Map();

    for (const kw of recipients) {
      await contractWatchSleep(400);
      const rows =
        (await fetchUsaspendingWatchAwards({ keywords: [kw] }, `watch:kw:${kw.toLowerCase()}`, { limit: 25 })) || [];
      for (const row of rows) {
        if (Number(row.obligatedAmount || 0) < minAmount) continue;
        if (!agencyMatchesWatch(row.awardingAgency, agencies)) continue;
        if (!isWithinDays(row.lastModifiedDate, 7)) continue;
        const key = contractWatchAwardKey(row);
        if (!key || collected.has(key)) continue;
        collected.set(key, { ...row, watchKeyword: kw });
      }
    }

    for (const agency of agencies.slice(0, 3)) {
      await contractWatchSleep(400);
      const rows =
        (await fetchUsaspendingWatchAwards(
          {
            agencies: [{ type: "awarding", tier: "toptier", name: agency }],
            award_amounts: [{ lower_bound: minAmount }]
          },
          `watch:agency:${agency.toLowerCase()}:${minAmount}`,
          { limit: 20 }
        )) || [];
      for (const row of rows) {
        if (Number(row.obligatedAmount || 0) < minAmount) continue;
        if (!isWithinDays(row.lastModifiedDate, 7)) continue;
        const key = contractWatchAwardKey(row);
        if (!key || collected.has(key)) continue;
        collected.set(key, { ...row, watchKeyword: agency });
      }
    }

    const newAlerts = [];
    const awards = [];

    for (const [key, row] of collected) {
      const mapping = mapContractWatchTickers(row);
      const wasSeen = Boolean(seen[key]);
      if (!wasSeen) seen[key] = nowIso;
      const formatted = formatContractWatchAward(row, mapping, seen, seen[key]);
      awards.push(formatted);

      if (!wasSeen && !isFirstRun) {
        newAlerts.push(formatted);
      } else if (!wasSeen && isFirstRun && isWithinDays(row.lastModifiedDate, 2)) {
        newAlerts.push(formatted);
      }
    }

    awards.sort(
      (a, b) => parseUsaspendingTimestamp(b.lastModifiedDate) - parseUsaspendingTimestamp(a.lastModifiedDate)
    );

    store.seenAwardIds = seen;
    store.awards = awards.slice(0, 120);
    store.alerts = [...newAlerts, ...(store.alerts || [])]
      .filter((row, idx, arr) => arr.findIndex((x) => x.awardId === row.awardId) === idx)
      .slice(0, 60);
    store.lastRefreshAt = nowIso;
    store.updatedAt = nowIso;

    await saveContractWatchStore(store);
    contractWatchRuntime = {
      lastRefreshAt: nowIso,
      awards: store.awards,
      alerts: store.alerts,
      refreshing: false
    };
    contractWatchApiCache = { fetchedAt: 0, payload: null };
  } catch (err) {
    console.error("[contract-watch] refresh failed:", err.message);
  } finally {
    contractWatchRuntime.refreshing = false;
  }

  return contractWatchRuntime;
}

async function getContractWatchPayload({ force = false } = {}) {
  if (
    !force &&
    contractWatchApiCache.payload &&
    Date.now() - contractWatchApiCache.fetchedAt < CONTRACT_WATCH_API_CACHE_MS
  ) {
    return contractWatchApiCache.payload;
  }

  const store = await loadContractWatchStore();
  let awards = store.awards?.length ? store.awards : contractWatchRuntime.awards;
  if (!awards.length && !contractWatchRuntime.lastRefreshAt) {
    await refreshContractWatch({ force: true });
    awards = contractWatchRuntime.awards;
  }

  const payload = {
    source: "contract_watch",
    updatedAt: store.updatedAt || contractWatchRuntime.lastRefreshAt || new Date().toISOString(),
    lastRefreshAt: store.lastRefreshAt || contractWatchRuntime.lastRefreshAt,
    minAmount: Number(store.config?.minAmount) || 10_000_000,
    recipientCount: (store.config?.recipients || []).length,
    disclaimer: CONTRACT_WATCH_DISCLAIMER,
    awards: awards.slice(0, 80),
    alertCount: (store.alerts || []).filter((a) => isWithinDays(a.firstSeenAt, 2)).length
  };
  contractWatchApiCache = { fetchedAt: Date.now(), payload };
  return payload;
}

function contractWatchAlertAsTrendingTopic(award) {
  const tickers = award.mappedTickers || [];
  const related = award.relatedTickers || [];
  const titleRecipient = award.recipient || "Federal recipient";
  return {
    id: `contract-watch-${award.awardId}`,
    title: `${compactMoney(award.amount)} → ${titleRecipient}`,
    type: "contract",
    keywords: award.watchKeyword ? [award.watchKeyword] : [],
    tickers,
    relatedTickers: related.filter((t) => !tickers.includes(t)),
    pinned: Boolean(award.isNew),
    hasPublicTicker: tickers.length > 0,
    privateCompany: Boolean(award.noPublicTicker),
    contractMatches: [
      {
        awardId: award.awardId,
        recipientName: award.recipient,
        awardingAgency: award.agency,
        obligatedAmount: award.amount,
        startDate: award.awardDate,
        directUrl: award.contractUrl,
        inferredTicker: tickers[0] || related[0] || null,
        description: award.descriptionSnippet,
        firstSeenAt: award.firstSeenAt,
        lastModifiedDate: award.lastModifiedDate
      }
    ],
    headlineMatches: award.isNew
      ? [
          {
            headline: `New federal award: ${compactMoney(award.amount)} to ${titleRecipient}`,
            source: "USASpending · Contract Watch",
            url: award.contractUrl,
            publishedAt: award.firstSeenAt || award.lastModifiedDate,
            summary: award.descriptionSnippet || CONTRACT_WATCH_DISCLAIMER,
            stub: false
          }
        ]
      : [],
    congressMatches: [],
    mappedTickers: [...new Set([...tickers, ...related])],
    freshness: {
      label: award.freshness?.label || "Recent",
      level: award.freshness?.status === "verified" ? "verified" : "stale",
      sourcesLine: award.firstSeenAt
        ? `First seen by TradeSimple ${contractWatchRelativeTime(award.firstSeenAt)} · USASpending modified ${award.lastModifiedDate || "unknown"}`
        : `USASpending · ${award.lastModifiedDate || "unknown"}`
    },
    briefUrl: award.contractBriefUrl,
    disclaimer: CONTRACT_WATCH_DISCLAIMER,
    enrichedAt: new Date().toISOString(),
    contractWatch: true
  };
}

function pickLandingContractAwardLine() {
  const awards = contractWatchRuntime.awards?.length
    ? contractWatchRuntime.awards
    : contractWatchApiCache.payload?.awards || [];
  const fresh = awards.find((row) => isWithinDays(row.firstSeenAt, 1) || (row.isNew && isWithinDays(row.lastModifiedDate, 1)));
  if (!fresh) return null;
  return {
    line: `New federal award: ${compactMoney(fresh.amount)} to ${fresh.recipient}`,
    recipient: fresh.recipient,
    amount: fresh.amount,
    url: fresh.contractUrl,
    firstSeenAt: fresh.firstSeenAt,
    awardDate: fresh.awardDate,
    disclaimer: CONTRACT_WATCH_DISCLAIMER
  };
}

function contractWatchListHandler(res) {
  getContractWatchPayload()
    .then((payload) => sendJson(res, 200, payload))
    .catch((err) => {
      console.error("[contract-watch]", err.message);
      sendJson(res, 500, { error: "contract_watch_failed" });
    });
}

function contractWatchAlertsHandler(res, url) {
  const sinceParam = url.searchParams.get("since");
  const sinceTs = sinceParam ? Date.parse(sinceParam) : NaN;
  getContractWatchPayload()
    .then(async (payload) => {
      const store = await loadContractWatchStore();
      let alerts = (store.alerts || payload.awards.filter((a) => a.isNew)).filter(
        (row) => isWithinDays(row.firstSeenAt, 2) || isWithinDays(row.lastModifiedDate, 2)
      );
      if (Number.isFinite(sinceTs)) {
        alerts = alerts.filter((row) => {
          const ts = Date.parse(row.firstSeenAt || "");
          return Number.isFinite(ts) && ts > sinceTs;
        });
      }
      sendJson(res, 200, {
        source: "contract_watch_alerts",
        updatedAt: new Date().toISOString(),
        lastRefreshAt: payload.lastRefreshAt,
        count: alerts.length,
        alerts,
        disclaimer: CONTRACT_WATCH_DISCLAIMER
      });
    })
    .catch((err) => {
      console.error("[contract-watch/alerts]", err.message);
      sendJson(res, 500, { error: "contract_watch_alerts_failed" });
    });
}

async function contractWatchAdminHandler(req, res) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !safeEqual(String(req.headers["x-admin-secret"] || ""), secret)) {
    logAdminAuthFailure("admin/contract-watch", req);
    return sendJson(res, 401, { error: "unauthorized" });
  }
  if (!adminRateLimitOk(req)) {
    return sendJson(res, 429, { error: "rate_limited", message: "Too many attempts. Try again later." });
  }
  const body = await readJson(req);
  const store = await loadContractWatchStore();
  const config = store.config || defaultContractWatchStore().config;

  if (Array.isArray(body.recipients)) {
    config.recipients = [...new Set(body.recipients.map((r) => String(r).trim().toUpperCase()).filter(Boolean))];
  } else if (body.recipient) {
    const term = String(body.recipient).trim().toUpperCase();
    if (term && !config.recipients.includes(term)) config.recipients.push(term);
  }
  if (body.minAmount != null) config.minAmount = Math.max(0, Number(body.minAmount) || config.minAmount);
  if (Array.isArray(body.agencies)) config.agencies = body.agencies.map(String);

  store.config = config;
  store.updatedAt = new Date().toISOString();
  await saveContractWatchStore(store);
  contractWatchApiCache = { fetchedAt: 0, payload: null };
  await refreshContractWatch({ force: true });
  const payload = await getContractWatchPayload({ force: true });
  sendJson(res, 200, {
    ok: true,
    config: store.config,
    awardCount: payload.awards.length,
    alertCount: payload.alertCount,
    lastRefreshAt: payload.lastRefreshAt
  });
}

async function refreshTrendingCongressDiscoveries(key) {
  if (!key) return 0;
  const store = await loadTrendingTopicsStore();
  const keywords = [...new Set(store.topics.flatMap((t) => t.keywords || []).filter(Boolean))];
  if (!keywords.length) return 0;

  let added = 0;
  const seenIds = new Set([...liveCongressBillRegistry.keys(), ...POLICY_BILLS.map((b) => b.id)]);
  try {
    const resp = await fetchWithTimeout(
      `https://api.congress.gov/v3/bill/${CURRENT_CONGRESS}?format=json&limit=100&sort=updateDate+desc&api_key=${encodeURIComponent(key)}`,
      {},
      9000
    );
    if (!resp.ok) return added;
    const data = await resp.json();
    for (const bill of data.bills || []) {
      const titleLower = (bill.title || "").toLowerCase();
      if (!keywords.some((kw) => titleLower.includes(String(kw).toLowerCase()))) continue;
      const normalized = decorateBill(normalizeLiveCongressBill(bill));
      if (!seenIds.has(normalized.id)) {
        liveCongressBillRegistry.set(normalized.id, normalized);
        seenIds.add(normalized.id);
        added += 1;
      }
    }
  } catch {
    /* Congress API unavailable */
  }
  return added;
}

// ── Prediction ledger ────────────────────────────────────────────────────────
// Shared dependency: a quote getter the ledger uses for entry/exit prices.
const ledgerDeps = {
  getQuote: async (symbol) => {
    const { quote } = await quoteSnapshot(symbol);
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
    return sendJson(res, 200, scorecard);
  } catch (err) {
    return sendJson(res, 500, { error: "scorecard_failed", detail: err.message });
  }
}

async function predictionVerifyHandler(res) {
  try {
    return sendJson(res, 200, await verifyLedger());
  } catch (err) {
    return sendJson(res, 500, { error: "verify_failed", detail: err.message });
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
    return sendJson(res, 200, { predictions, count: predictions.length });
  } catch (err) {
    return sendJson(res, 500, { error: "list_failed", detail: err.message });
  }
}

async function predictionRecordHandler(req, res, session) {
  // Fails closed: with no ADMIN_SECRET configured, there is no way to prove
  // the caller is an admin, so manual recording must be refused rather than
  // opened up to any authenticated user. The public track record is a brand
  // asset — the hash chain proves tamper-evidence after the fact, not that
  // what got appended in the first place was legitimate.
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || !safeEqual(String(req.headers["x-admin-secret"] || ""), adminSecret)) {
    logAdminAuthFailure("predictions/record", req);
    return sendJson(res, 403, { error: "forbidden" });
  }
  if (!adminRateLimitOk(req)) {
    return sendJson(res, 429, { error: "rate_limited", message: "Too many attempts. Try again later." });
  }
  try {
    const body = await readJson(req);
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
    return sendJson(res, 200, { ok: true, prediction: event });
  } catch (err) {
    return sendJson(res, 400, { error: "record_failed", detail: err.message });
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

    const live = POLICY_BILLS.filter(
      (b) => !b.scenarioOnly && Array.isArray(b.passImpacts) && b.passImpacts.length
    );
    // Rank by legislative momentum; only auto-log the strongest signals.
    const ranked = live
      .map((b) => ({ bill: b, momentum: computeLegislativeMomentum(b) }))
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

function landingQuoteFromFallback(symbol) {
  const row = enrichStaticQuote(MARKET_FALLBACK[symbol]);
  if (!row) return null;
  return { symbol, price: row.price, changePercent: row.changePercent ?? row.pct, source: "fallback_static" };
}

async function landingQuoteForSymbol(symbol, timeoutMs = 4500) {
  try {
    const result = await Promise.race([
      quoteSnapshot(symbol),
      new Promise((_, reject) => setTimeout(() => reject(new Error("landing_quote_timeout")), timeoutMs))
    ]);
    if (result?.quote) {
      return { symbol, price: result.quote.price, changePercent: result.quote.changePercent, source: result.quote.source };
    }
  } catch {
    /* fall through to static fallback */
  }
  return landingQuoteFromFallback(symbol);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }
  const workerCount = Math.min(concurrency, items.length) || 1;
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function fecElectionCycle() {
  const year = new Date().getFullYear();
  return year % 2 === 0 ? year : year - 1;
}

function fecSamplePulsePayload() {
  const seed = fecPulseSeed?.pulses?.length ? fecPulseSeed : { pulses: [] };
  const payload = enrichFecPulsePayload({
    source: "sample",
    updatedAt: seed.updatedAt || new Date().toISOString(),
    cycle: seed.cycle || fecElectionCycle(),
    configured: Boolean(process.env.FEC_API_KEY),
    pulses: (seed.pulses || []).map((row) => {
      const cluster = (fecCommitteeMap.clusters || []).find((c) => c.key === row.clusterKey);
      return { ...row, source: "sample", policyTags: clusterPolicyTags(cluster) };
    })
  });
  noteFeedSuccess("fec", { source: "sample", recordCount: payload.pulses.length });
  return payload;
}

let fecRateLimitedUntil = 0;

async function fetchFecJson(path, params = {}) {
  const key = process.env.FEC_API_KEY;
  if (!key) return null;
  if (Date.now() < fecRateLimitedUntil) return null;
  const qs = new URLSearchParams({ ...params, api_key: key });
  const url = `${FEC_API_BASE}${path}${path.includes("?") ? "&" : "?"}${qs.toString()}`;
  try {
    const response = await fetchWithTimeout(url, {}, 10_000);
    if (response.status === 429) {
      fecRateLimitedUntil = Date.now() + 10 * 60 * 1000;
      console.warn("[fec] Rate limited by openFEC — pausing FEC calls for 10 minutes.");
      return null;
    }
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function clusterPolicyTags(cluster) {
  return cluster?.policyTags || cluster?.policy_tags || [];
}

function clusterPacIds(cluster) {
  return cluster?.pacCommitteeIds || cluster?.fec_committee_ids || [];
}

function clusterTickers(cluster) {
  return cluster?.tickers || [];
}

function getCrosswalkTag(tagKey) {
  return (policyCrosswalk.tags || []).find((t) => t.key === tagKey) || null;
}

function normalizeLinkHaystack(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^\w\s&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function haystackIncludes(haystack, needle) {
  const h = normalizeLinkHaystack(haystack);
  const n = normalizeLinkHaystack(needle);
  if (!h || !n) return false;
  return h.includes(n) || n.includes(h);
}

function billCommitteeHaystacks(bill) {
  return [
    bill.title,
    bill.shortTitle,
    ...(bill.committees || []),
    ...(bill._committeeNames || []),
    bill.legislativeContext?.primaryCommittee,
    bill.policyArea,
    ...(bill.tags || [])
  ].filter(Boolean);
}

function billMatchesClusterExplicit(bill, cluster) {
  if (!bill || !cluster) return null;
  const committeeKeys = cluster.billCommitteeKeys || [];
  const policyTags = clusterPolicyTags(cluster);
  const primaryTag = cluster.policyTag || policyTags[0] || null;
  const crosswalk = primaryTag ? getCrosswalkTag(primaryTag) : null;
  const billHaystacks = billCommitteeHaystacks(bill);

  for (const key of committeeKeys) {
    for (const field of billHaystacks) {
      if (haystackIncludes(field, key)) {
        return {
          reason: `bill assigned to ${cluster.committee} (${cluster.chamber})`,
          matchType: "committee",
          matchField: key
        };
      }
    }
  }

  if (crosswalk) {
    for (const area of crosswalk.billPolicyAreas || []) {
      if (haystackIncludes(bill.policyArea, area)) {
        return {
          reason: `bill policy area "${bill.policyArea}" matches ${primaryTag} crosswalk`,
          matchType: "policyArea",
          matchField: primaryTag
        };
      }
    }
    for (const kw of crosswalk.billKeywords || []) {
      for (const field of billHaystacks) {
        if (haystackIncludes(field, kw)) {
          return {
            reason: `bill text matches ${primaryTag} keyword "${kw}" in policy-crosswalk.json`,
            matchType: "billKeyword",
            matchField: kw
          };
        }
      }
    }
  }

  for (const tagKey of policyTags) {
    const cw = getCrosswalkTag(tagKey);
    if (!cw) continue;
    for (const kw of cw.billKeywords || []) {
      for (const field of billHaystacks) {
        if (haystackIncludes(field, kw)) {
          return {
            reason: `bill matches ${tagKey} policy tag via crosswalk`,
            matchType: "policyTag",
            matchField: tagKey
          };
        }
      }
    }
  }

  return null;
}

function matchFecClusterForBill(bill) {
  const clusters = fecCommitteeMap.clusters || [];
  if (!clusters.length || !bill) return null;
  let best = null;
  let bestScore = 0;
  for (const cluster of clusters) {
    const match = billMatchesClusterExplicit(bill, cluster);
    if (!match) continue;
    const score =
      match.matchType === "committee" ? 4 : match.matchType === "policyArea" ? 3 : match.matchType === "policyTag" ? 2 : 1;
    if (score > bestScore) {
      bestScore = score;
      best = cluster;
    }
  }
  return best;
}

function congressGovBillUrl(billId) {
  const ref = parseBillIdToCongressRef(billId);
  if (!ref) return null;
  const TYPE_SLUG = { s: "senate-bill", hr: "house-bill", hjres: "house-joint-resolution", sjres: "senate-joint-resolution", hres: "house-resolution", sres: "senate-resolution" };
  const slug = TYPE_SLUG[ref.type] || ref.type;
  return `https://www.congress.gov/bill/${ref.congress}th-congress/${slug}/${ref.number}`;
}

function linkTickersForCluster(cluster) {
  const template =
    cluster.explainTemplate?.ticker ||
    "{ticker} via {label} PAC cluster · explicit map {mapKey}";
  const pacIds = clusterPacIds(cluster);
  return clusterTickers(cluster).map((symbol) => ({
    symbol,
    linkReason: template
      .replace("{ticker}", symbol)
      .replace("{mapKey}", cluster.key)
      .replace("{label}", cluster.label || cluster.committee || cluster.key),
    sourceUrl: pacIds[0] ? `https://www.fec.gov/data/committee/${encodeURIComponent(pacIds[0])}/` : null,
    provenance: {
      source: "fec-committee-map.json",
      mapKey: cluster.key,
      pacCommitteeIds: pacIds,
      policyTag: cluster.policyTag || clusterPolicyTags(cluster)[0] || null
    }
  }));
}

function billSharesPolicyTagWithCluster(bill, cluster) {
  const primaryTag = cluster.policyTag || clusterPolicyTags(cluster)[0];
  const cw = primaryTag ? getCrosswalkTag(primaryTag) : null;
  if (!cw) return false;
  const haystacks = billCommitteeHaystacks(bill);
  for (const kw of cw.billKeywords || []) {
    for (const field of haystacks) {
      if (haystackIncludes(field, kw)) return true;
    }
  }
  for (const area of cw.billPolicyAreas || []) {
    if (haystackIncludes(bill.policyArea, area)) return true;
  }
  return false;
}

function linkBillsForCluster(cluster, limit = 8) {
  const template = cluster.explainTemplate?.bill || "Linked because {reason}";
  const links = [];
  const seen = new Set();
  const clusterTickerSet = new Set(clusterTickers(cluster));

  for (const bill of POLICY_BILLS) {
    let match = billMatchesClusterExplicit(bill, cluster);
    if (!match) {
      const overlap = (bill.affected || []).filter((sym) => clusterTickerSet.has(sym));
      if (overlap.length && billSharesPolicyTagWithCluster(bill, cluster)) {
        match = {
          reason: `bill maps ${overlap.slice(0, 2).join(", ")} in affected tickers and matches ${cluster.policyTag || "cluster"} crosswalk`,
          matchType: "affectedTickerConfirm",
          matchField: overlap[0]
        };
      }
    }
    if (!match || seen.has(bill.id)) continue;
    seen.add(bill.id);
    links.push({
      id: bill.id,
      title: bill.shortTitle || bill.title,
      status: bill.status || null,
      sourceUrl: congressGovBillUrl(bill.id),
      linkReason: template.replace("{reason}", match.reason).replace("{committee}", cluster.committee || ""),
      provenance: {
        source: "fec-committee-map.json + policy-crosswalk.json",
        mapKey: cluster.key,
        matchType: match.matchType,
        matchField: match.matchField
      }
    });
    if (links.length >= limit) break;
  }
  return links;
}

function linkLobbyingForCluster(cluster, limit = 6) {
  const pool = getLobbyFilingsPool();
  const aliases = [
    ...(cluster.lobbyingClientAliases || []),
    ...(cluster.registrantNames || [])
  ];
  const policyTags = clusterPolicyTags(cluster);
  const primaryTag = cluster.policyTag || policyTags[0] || null;
  const crosswalk = primaryTag ? getCrosswalkTag(primaryTag) : null;
  const template = cluster.explainTemplate?.lobbying || "Linked because {reason}";
  const links = [];
  const seen = new Set();

  for (const filing of pool) {
    const client = filing.client || filing.name || "";
    const registrant = filing.registrant || "";
    const issue = filing.issue || "";
    let match = null;

    for (const alias of aliases) {
      if (haystackIncludes(client, alias) || haystackIncludes(registrant, alias)) {
        match = {
          reason: `LDA client/registrant "${alias}" listed in cluster map`,
          matchType: "clientAlias",
          matchField: alias
        };
        break;
      }
    }

    if (!match && crosswalk) {
      for (const kw of crosswalk.ldaIssueKeywords || []) {
        if (haystackIncludes(issue, kw)) {
          match = {
            reason: `LDA issue "${issue}" shares ${primaryTag} tag in policy-crosswalk.json`,
            matchType: "ldaIssue",
            matchField: kw
          };
          break;
        }
      }
    }

    if (!match) continue;
    const filingId = filing.filingId || lobbyingFilingId(filing);
    if (seen.has(filingId)) continue;
    seen.add(filingId);
    links.push({
      id: filingId,
      client,
      registrant,
      amount: filing.amount || null,
      issue,
      sourceUrl: filing.filingUrl || "https://lda.senate.gov/filings/public/filing/search/",
      linkReason: template.replace("{reason}", match.reason),
      provenance: {
        source: "policy-crosswalk.json + fec-committee-map.json",
        mapKey: cluster.key,
        matchType: match.matchType,
        matchField: match.matchField
      }
    });
    if (links.length >= limit) break;
  }
  return links;
}

function getContractWatchAwardsPool() {
  if (contractWatchRuntime.awards?.length) return contractWatchRuntime.awards;
  if (contractWatchApiCache.payload?.awards?.length) return contractWatchApiCache.payload.awards;
  return [];
}

function linkContractsForCluster(cluster, limit = 6) {
  const awards = getContractWatchAwardsPool();
  const recipientKeys = [
    ...(cluster.contractRecipientKeys || []),
    ...((cluster.policyTag ? getCrosswalkTag(cluster.policyTag)?.contractRecipientKeys : null) || [])
  ];
  const policyTags = clusterPolicyTags(cluster);
  const primaryTag = cluster.policyTag || policyTags[0] || null;
  const crosswalk = primaryTag ? getCrosswalkTag(primaryTag) : null;
  const explicitTickers = new Set(clusterTickers(cluster));
  const template = cluster.explainTemplate?.contract || "Linked because {reason}";
  const links = [];
  const seen = new Set();

  for (const award of awards) {
    const recipient = award.recipient || award.recipientName || "";
    let match = null;

    for (const key of recipientKeys) {
      if (haystackIncludes(recipient, key)) {
        match = {
          reason: `USASpending recipient matches "${key}" in cluster map`,
          matchType: "recipientKey",
          matchField: key
        };
        break;
      }
    }

    if (!match) {
      const sym = contractSymbolForCompany(recipient) || inferTickerFromRecipientName(recipient);
      if (sym && explicitTickers.has(sym)) {
        match = {
          reason: `${sym} mapped from recipient "${recipient}" via CONTRACT_PROFILES`,
          matchType: "contractProfile",
          matchField: sym
        };
      }
    }

    if (!match && crosswalk) {
      const mapped = award.mappedTickers || [];
      for (const sym of mapped) {
        if (explicitTickers.has(sym)) {
          match = {
            reason: `${sym} on award maps to cluster tickers via contract watch`,
            matchType: "mappedTicker",
            matchField: sym
          };
          break;
        }
      }
      const naics = String(award.naics || award.naicsCode || "").slice(0, 3);
      if (!match && naics) {
        for (const prefix of crosswalk.contractNaicsPrefixes || []) {
          if (naics.startsWith(prefix)) {
            match = {
              reason: `contract NAICS ${naics} matches ${primaryTag} bucket in policy-crosswalk.json`,
              matchType: "naics",
              matchField: prefix
            };
            break;
          }
        }
      }
    }

    if (!match) continue;
    const awardId = award.awardId || award.id;
    if (!awardId || seen.has(awardId)) continue;
    seen.add(awardId);
    links.push({
      id: awardId,
      recipient,
      amount: award.amount || award.obligatedAmount || null,
      agency: award.agency || award.awardingAgency || null,
      sourceUrl: award.directUrl || (awardId ? `https://www.usaspending.gov/award/${encodeURIComponent(awardId)}` : null),
      linkReason: template.replace("{reason}", match.reason),
      provenance: {
        source: "contract-watch + policy-crosswalk.json",
        mapKey: cluster.key,
        matchType: match.matchType,
        matchField: match.matchField
      }
    });
    if (links.length >= limit) break;
  }
  return links;
}

function buildFecPulseWithLinks(pulse, cluster) {
  const resolvedCluster =
    cluster || (fecCommitteeMap.clusters || []).find((c) => c.key === pulse?.clusterKey) || null;
  if (!resolvedCluster) {
    return {
      ...pulse,
      links: { tickers: [], bills: [], lobbyingFilings: [], contracts: [] },
      linkCounts: { tickers: 0, bills: 0, lobbyingFilings: 0, contracts: 0 }
    };
  }
  const tickerLinks = linkTickersForCluster(resolvedCluster);
  const billLinks = linkBillsForCluster(resolvedCluster);
  const lobbyLinks = linkLobbyingForCluster(resolvedCluster);
  const contractLinks = linkContractsForCluster(resolvedCluster);
  return {
    ...pulse,
    tickers: tickerLinks.map((row) => row.symbol),
    policyTags: clusterPolicyTags(resolvedCluster),
    links: {
      tickers: tickerLinks,
      bills: billLinks,
      lobbyingFilings: lobbyLinks,
      contracts: contractLinks
    },
    linkCounts: {
      tickers: tickerLinks.length,
      bills: billLinks.length,
      lobbyingFilings: lobbyLinks.length,
      contracts: contractLinks.length
    }
  };
}

function enrichFecPulsePayload(payload) {
  const pulses = (payload?.pulses || []).map((pulse) => {
    const cluster = (fecCommitteeMap.clusters || []).find((c) => c.key === pulse.clusterKey);
    return buildFecPulseWithLinks(pulse, cluster);
  });
  return { ...payload, pulses };
}

async function policyTrailHandler(res, url) {
  const ticker = String(url.searchParams.get("ticker") || "").toUpperCase();
  if (!ticker || !VALID_TICKER_PATTERN.test(ticker)) {
    return sendJson(res, 400, { error: "invalid_ticker", message: "Provide a valid ticker symbol." });
  }
  const cacheKey = ticker;
  const cached = policyTrailCache.get(cacheKey);
  if (cached && Date.now() - cached.at < POLICY_TRAIL_CACHE_TTL_MS) {
    return sendJson(res, 200, cached.payload);
  }

  const clusters = (fecCommitteeMap.clusters || []).filter((c) => clusterTickers(c).includes(ticker));
  const fecLinks = clusters.map((cluster) => {
    const tickerLink = linkTickersForCluster(cluster).find((row) => row.symbol === ticker);
    const pulse = (fecPulseCache?.pulses || []).find((p) => p.clusterKey === cluster.key);
    return {
      clusterKey: cluster.key,
      label: cluster.label,
      committee: cluster.committee,
      linkReason: tickerLink?.linkReason || `${ticker} in ${cluster.key} PAC cluster via explicit map`,
      provenance: tickerLink?.provenance || { source: "fec-committee-map.json", mapKey: cluster.key },
      pulseSummary: pulse?.plainEnglish || null,
      linkCounts: buildFecPulseWithLinks(pulse || { clusterKey: cluster.key }, cluster).linkCounts
    };
  });

  const bills = POLICY_BILLS.filter((b) => (b.affected || []).includes(ticker)).map((b) => ({
    id: b.id,
    title: b.shortTitle || b.title,
    linkReason: `${ticker} listed in bill affected tickers (verified POLICY_BILLS map)`,
    provenance: { source: "POLICY_BILLS", matchType: "affected", billId: b.id }
  }));

  const companyHint = resolveTradableSymbolName(ticker) || ticker;
  const lobbyPool = getLobbyFilingsPool();
  const lobbying = [];
  const lobbySeen = new Set();
  for (const filing of lobbyPool) {
    const filingTickers = filing.tickers || [];
    const client = filing.client || filing.name || "";
    if (!filingTickers.includes(ticker) && !haystackIncludes(client, companyHint.split(" ")[0])) continue;
    const filingId = filing.filingId || lobbyingFilingId(filing);
    if (lobbySeen.has(filingId)) continue;
    lobbySeen.add(filingId);
    lobbying.push({
      id: filingId,
      client,
      issue: filing.issue || null,
      amount: filing.amount || null,
      linkReason: filingTickers.includes(ticker)
        ? `LDA filing explicitly tags ${ticker}`
        : `LDA client name matches ${companyHint}`,
      provenance: { source: filing.source || "lda", matchType: filingTickers.includes(ticker) ? "ticker" : "client" }
    });
    if (lobbying.length >= 8) break;
  }

  const contractProfile = CONTRACT_PROFILES[ticker] || null;
  const contracts = [];
  const contractSeen = new Set();
  for (const award of getContractWatchAwardsPool()) {
    const recipient = award.recipient || award.recipientName || "";
    const mapped = award.mappedTickers || [];
    const sym = contractSymbolForCompany(recipient) || inferTickerFromRecipientName(recipient);
    if (sym !== ticker && !mapped.includes(ticker)) continue;
    const awardId = award.awardId || award.id;
    if (!awardId || contractSeen.has(awardId)) continue;
    contractSeen.add(awardId);
    contracts.push({
      id: awardId,
      recipient,
      amount: award.amount || award.obligatedAmount || null,
      agency: award.agency || award.awardingAgency || null,
      linkReason: contractProfile
        ? `${ticker} via CONTRACT_PROFILES — ${Math.round(contractProfile.governmentRevenuePct * 100)}% government revenue`
        : `Recipient "${recipient}" maps to ${ticker} via USASpending recipient crosswalk`,
      provenance: {
        source: contractProfile ? "CONTRACT_PROFILES" : "contract-watch",
        matchType: "recipient",
        mapKey: contractProfile ? ticker : null
      }
    });
    if (contracts.length >= 8) break;
  }

  const payload = {
    ticker,
    trail: { fec: fecLinks, bills, lobbying, contracts },
    updatedAt: new Date().toISOString()
  };
  policyTrailCache.set(cacheKey, { at: Date.now(), payload });
  return sendJson(res, 200, payload);
}

async function fecPulseDetailHandler(res, clusterKey) {
  if (!clusterKey) return sendJson(res, 400, { error: "missing_cluster_key" });
  try {
    const payload = await getFecPulsePayload();
    const cluster = (fecCommitteeMap.clusters || []).find((c) => c.key === clusterKey);
    if (!cluster) return sendJson(res, 404, { error: "unknown_cluster", message: "FEC cluster not found." });
    const pulse =
      payload.pulses.find((p) => p.clusterKey === clusterKey) ||
      buildFecPulseWithLinks({ clusterKey, committee: cluster.committee, chamber: cluster.chamber, label: cluster.label }, cluster);
    const enriched = buildFecPulseWithLinks(pulse, cluster);
    return sendJson(res, 200, {
      pulse: enriched,
      cluster: {
        key: cluster.key,
        label: cluster.label,
        committee: cluster.committee,
        chamber: cluster.chamber,
        policyTags: clusterPolicyTags(cluster),
        policyTag: cluster.policyTag || null,
        pacCommitteeIds: clusterPacIds(cluster)
      },
      source: payload.source,
      updatedAt: payload.updatedAt,
      cycle: payload.cycle
    });
  } catch (err) {
    return sendJson(res, 502, { error: "fec_detail_failed", message: err.message || "Could not load FEC detail." });
  }
}

function buildFecPulsePlainEnglish(cluster, amount, period, tickers, recentFilings = 0) {
  const amt = compactMoney(amount);
  const tk = (tickers || []).slice(0, 3).join(", ") || "mapped names";
  const filingBit =
    recentFilings > 0
      ? `${recentFilings} fresh filing${recentFilings === 1 ? "" : "s"} over 48 hours`
      : "cycle totals updated";
  return `${cluster.label} linked to ${cluster.committee} reported ${amt} in receipts — ${filingBit}. Names in play: ${tk}.`;
}

// FEC endpoint split (Phase 2, Task 2.2):
// - Aggregate receipts/disbursements: /committee/{id}/totals/ (processed, nightly refresh, full cycle)
// - Recent filing activity (last 48h): /filings/ filtered by min_last_modified_date (processed, nightly)
// The processed endpoints are coded and stable. The efile schedule endpoints
// (/schedules/schedule_a/efile/) are real-time but uncoded and only cover ~4 months.
// For a daily-cadence product the processed endpoints are the right choice.
async function fetchFecClusterMetrics(cluster, cycle) {
  const ids = cluster.fec_committee_ids || [];
  let receipts = 0;
  let disbursements = 0;
  let recentFilings = 0;
  let latestFilingDate = null;
  const minDate = new Date(Date.now() - 48 * 3600 * 1000).toISOString().slice(0, 10);
  for (const committeeId of ids.slice(0, 4)) {
    // Processed totals endpoint: cycle-aggregate receipts + disbursements
    const totals = await fetchFecJson(`/committee/${encodeURIComponent(committeeId)}/totals/`, {
      cycle,
      per_page: 1,
      sort: "-cycle"
    });
    const totalRow = totals?.results?.[0];
    if (totalRow) {
      receipts += Number(totalRow.receipts || 0);
      disbursements += Number(totalRow.disbursements || 0);
    }
    // Processed filings endpoint: recent activity within 48h window
    const filings = await fetchFecJson("/filings/", {
      committee_id: committeeId,
      min_last_modified_date: minDate,
      per_page: 20,
      sort: "-receipt_date"
    });
    const filingRows = filings?.results || [];
    recentFilings += filingRows.length;
    for (const row of filingRows) {
      const d = row.receipt_date || row.coverage_end_date || row.filed_date;
      if (d && (!latestFilingDate || d > latestFilingDate)) latestFilingDate = d;
    }
  }
  return { receipts, disbursements, recentFilings, latestFilingDate };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function buildLiveFecPulsePayload({ stagger = false } = {}) {
  const key = process.env.FEC_API_KEY;
  if (!key) return fecSamplePulsePayload();
  const cycle = fecCommitteeMap.cycle || fecElectionCycle();
  const clusters = (fecCommitteeMap.clusters || []).slice(0, 18);
  const results = [];
  for (const cluster of clusters) {
    if (stagger) await sleep(15_000);
    const metrics = await fetchFecClusterMetrics(cluster, cycle);
    const amount = metrics.receipts || metrics.disbursements || 0;
    if (!amount && !metrics.recentFilings) { results.push(null); continue; }
    const tickers = cluster.tickers || [];
    const period = `${cycle} cycle · last 48h filings`;
    results.push({
      committee: cluster.committee,
      chamber: cluster.chamber,
      label: cluster.label,
      amountSummary: `${compactMoney(amount)} cycle receipts`,
      period,
      tickers,
      filingDate: metrics.latestFilingDate || new Date().toISOString().slice(0, 10),
      plainEnglish: buildFecPulsePlainEnglish(cluster, amount, period, tickers, metrics.recentFilings),
      clusterKey: cluster.key,
      policyTags: clusterPolicyTags(cluster),
      recentFilings: metrics.recentFilings,
      fecUrl: `https://www.fec.gov/data/committee/${encodeURIComponent((cluster.fec_committee_ids || [])[0] || "")}/`,
      source: "fec"
    });
  }
  const pulses = results
    .filter((row) => row && (row.recentFilings > 0 || Number(String(row.amountSummary || "").replace(/[^\d.]/g, "")) > 0))
    .sort((a, b) => Number(b.recentFilings || 0) - Number(a.recentFilings || 0))
    .slice(0, 20);
  if (!pulses.length) return fecSamplePulsePayload();
  noteFeedSuccess("fec", { source: "fec", recordCount: pulses.length });
  return enrichFecPulsePayload({
    source: "fec",
    updatedAt: new Date().toISOString(),
    cycle,
    configured: true,
    pulses
  });
}

async function getFecPulsePayload({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (forceRefresh) {
    fecPulseCachedAt = 0;
    policyTrailCache.clear();
  }
  if (!forceRefresh && fecPulseCache && now - fecPulseCachedAt < FEC_PULSE_CACHE_TTL_MS) {
    return fecPulseCache;
  }
  try {
    const payload = await buildLiveFecPulsePayload();
    fecPulseCache = payload;
    fecPulseCachedAt = now;
    return payload;
  } catch (err) {
    noteFeedError("fec", err);
    if (fecPulseCache) return { ...fecPulseCache, stale: true };
    return fecSamplePulsePayload();
  }
}

function fecPulseHandler(res, url) {
  const forceRefresh = url?.searchParams?.get("refresh") === "1";
  getFecPulsePayload({ forceRefresh })
    .then((payload) => sendJson(res, 200, payload))
    .catch((err) => {
      console.error("[fec-pulse]", err.message);
      sendJson(res, 200, fecSamplePulsePayload());
    });
}

async function fetchFecSponsorSummary(bill, cycle) {
  const sponsor = bill?.sponsor?.name || bill?.sponsor;
  if (!sponsor || !process.env.FEC_API_KEY) return null;
  const lastName = String(sponsor)
    .replace(/^Rep\.|^Sen\.|^Hon\./i, "")
    .trim()
    .split(/[\s,]+/)
    .pop();
  if (!lastName || lastName.length < 3) return null;
  const office = String(bill.chamber || "").toLowerCase().includes("senate") ? "S" : "H";
  const search = await fetchFecJson("/candidates/search/", { q: lastName, office, per_page: 3 });
  const candidate = search?.results?.[0];
  if (!candidate?.candidate_id) return null;
  const totals = await fetchFecJson(`/candidate/${encodeURIComponent(candidate.candidate_id)}/totals/`, {
    cycle,
    per_page: 1
  });
  const row = totals?.results?.[0];
  if (!row) return null;
  return {
    name: candidate.name || sponsor,
    candidateId: candidate.candidate_id,
    receipts: Number(row.receipts || 0),
    disbursements: Number(row.disbursements || 0),
    cycle,
    fecUrl: `https://www.fec.gov/data/candidate/${encodeURIComponent(candidate.candidate_id)}/`
  };
}

async function buildBillMoneyContext(bill) {
  const cluster = matchFecClusterForBill(bill);
  if (!cluster) {
    return {
      matched: false,
      source: process.env.FEC_API_KEY ? "fec" : "sample",
      message: "No committee money match for this bill yet.",
      updatedAt: new Date().toISOString()
    };
  }
  const cycle = fecCommitteeMap.cycle || fecElectionCycle();
  const key = process.env.FEC_API_KEY;
  let metrics = { receipts: 0, disbursements: 0, recentFilings: 0, latestFilingDate: null };
  if (key) {
    metrics = await fetchFecClusterMetrics(cluster, cycle);
  } else {
    const seedRow = (fecPulseSeed.pulses || []).find((row) => row.clusterKey === cluster.key);
    if (seedRow) {
      metrics.receipts = Number(String(seedRow.amountSummary || "").replace(/[^\d.]/g, "")) * 1e6 || 0;
      metrics.latestFilingDate = seedRow.filingDate;
      metrics.recentFilings = seedRow.recentFilings || 0;
    }
  }
  const sponsorSummary = await fetchFecSponsorSummary(bill, cycle);
  const tickers = clusterTickers(cluster);
  const amount = metrics.receipts || metrics.disbursements || 0;
  const period = `${cycle} cycle`;
  const linkBundle = buildFecPulseWithLinks(
    { clusterKey: cluster.key, committee: cluster.committee, chamber: cluster.chamber, label: cluster.label },
    cluster
  );
  const topIndustries = [
    { label: cluster.label, amount: compactMoney(amount) }
  ];
  const marketBullets = [
    `${cluster.committee} (${cluster.chamber}) maps to ${cluster.label} — ${compactMoney(amount)} in ${period} receipts per FEC.`,
    tickers.length
      ? `Mapped tickers: ${tickers.slice(0, 4).join(", ")}. Correlation with filings is not causation.`
      : "No ticker map on this cluster yet.",
    sponsorSummary
      ? `Sponsor ${sponsorSummary.name} reported ${compactMoney(sponsorSummary.receipts)} in ${cycle} cycle receipts.`
      : "Sponsor fundraising totals unavailable without a FEC name match.",
    linkBundle.linkCounts.bills
      ? `${linkBundle.linkCounts.bills} linked bill(s) via committee crosswalk.`
      : "No linked bills in explicit committee map yet.",
    linkBundle.linkCounts.lobbyingFilings
      ? `${linkBundle.linkCounts.lobbyingFilings} linked LDA filing(s).`
      : null,
    linkBundle.linkCounts.contracts
      ? `${linkBundle.linkCounts.contracts} linked contract award(s).`
      : null
  ].filter(Boolean);
  const plainEnglish = buildFecPulsePlainEnglish(
    cluster,
    amount,
    period,
    tickers,
    metrics.recentFilings
  );
  return {
    matched: true,
    source: key ? "fec" : "sample",
    clusterKey: cluster.key,
    cycle,
    committee: cluster.committee,
    chamber: cluster.chamber,
    label: cluster.label,
    committeeTotals: {
      receipts: metrics.receipts,
      disbursements: metrics.disbursements,
      summary: `${compactMoney(amount)} ${period} receipts`
    },
    sponsorSummary,
    topIndustries,
    tickers,
    links: linkBundle.links,
    linkCounts: linkBundle.linkCounts,
    marketBullets,
    plainEnglish,
    fecUrl: `https://www.fec.gov/data/committee/${encodeURIComponent((cluster.fec_committee_ids || [])[0] || "")}/`,
    filingDate: metrics.latestFilingDate || null,
    updatedAt: new Date().toISOString(),
    attribution: "Source: FEC"
  };
}

async function fecBillContextHandler(res, url) {
  const billId = url.searchParams.get("billId") || url.searchParams.get("id") || "";
  try {
    const bill = await resolvePolicyBillAsync(billId);
    if (!bill) {
      return sendJson(res, 404, { error: "unknown_bill_id", message: "Bill not found." });
    }
    const merged = decorateBill(mergeCongressLiveIntoBill(applyBillMarketExposure(bill)));
    const moneyContext = await buildBillMoneyContext(merged);
    return sendJson(res, 200, { billId: merged.id, moneyContext });
  } catch (err) {
    return sendJson(res, 502, { error: "fec_bill_context_failed", message: err.message || "Could not load FEC context." });
  }
}

function pickLandingFecPulseLine(payload) {
  const pulses = payload?.pulses || [];
  if (!pulses.length) return null;
  const idx = Math.floor(Date.now() / FEC_PULSE_CACHE_TTL_MS) % pulses.length;
  return pulses[idx];
}

function pickLandingFecPulseSlice(payload, count = 3) {
  const pulses = payload?.pulses || [];
  if (!pulses.length) return [];
  const start = Math.floor(Date.now() / FEC_PULSE_CACHE_TTL_MS) % pulses.length;
  const out = [];
  for (let i = 0; i < Math.min(count, pulses.length); i++) {
    out.push(pulses[(start + i) % pulses.length]);
  }
  return out;
}

async function landingQuotesHandler(res) {
  const now = Date.now();
  if (landingQuotesCache && now - landingQuotesCachedAt < LANDING_QUOTES_TTL_MS) {
    return sendJson(res, 200, landingQuotesCache);
  }
  try {
    const quotes = [];
    const needsFetch = [];
    for (const symbol of LANDING_QUOTES_TICKERS) {
      const fresh = cachedQuoteFresh(symbol);
      if (fresh && quoteHasValidPrice(fresh.quote)) {
        quotes.push({
          symbol,
          price: fresh.quote.price,
          changePercent: fresh.quote.changePercent ?? fresh.quote.pct,
          source: fresh.quote.source
        });
      } else {
        needsFetch.push(symbol);
      }
    }
    for (const symbol of needsFetch) {
      const row = await landingQuoteForSymbol(symbol);
      if (row) quotes.push(row);
    }
    const order = new Map(LANDING_QUOTES_TICKERS.map((sym, index) => [sym, index]));
    quotes.sort((a, b) => (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0));
    const payload = { quotes, updatedAt: new Date().toISOString() };
    if (quotes.length) {
      landingQuotesCache = payload;
      landingQuotesCachedAt = now;
    }
    return sendJson(res, 200, payload);
  } catch {
    if (landingQuotesCache) {
      return sendJson(res, 200, { ...landingQuotesCache, stale: true });
    }
    const quotes = LANDING_QUOTES_TICKERS.map((symbol) => landingQuoteFromFallback(symbol)).filter(Boolean);
    return sendJson(res, 200, { quotes, updatedAt: new Date().toISOString(), fallback: true });
  }
}

/** Shared path for GET /api/market/history and analysis chart (real closes when APIs succeed). */
async function fetchMarketHistoryPayload(symbol, range) {
  const token = process.env.FINNHUB_API_KEY;
  const seconds = rangeSeconds(range);
  const to = Math.floor(Date.now() / 1000);
  const from = to - seconds;
  const resolution = finnhubHistoryResolution(range);

  if (token && Date.now() >= finnhubCooldownUntil) {
    try {
      const data = await withFinnhubSlot(async (t) => {
        const historyUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}&token=${encodeURIComponent(t)}`;
        const response = await fetchWithTimeout(historyUrl, {}, 9000);
        if (!response.ok) {
          if (response.status === 429) noteFinnhubRateLimited();
          return null;
        }
        return response.json();
      });
      if (data?.s === "ok" && Array.isArray(data.c) && data.c.length >= historyMinPoints(range)) {
        const points = data.c.map((close, index) => ({
          date: data.t?.[index]
            ? new Date(data.t[index] * 1000).toISOString().slice(0, range === "1d" || range === "1w" ? 16 : 10)
            : "",
          close: Number(close),
          open: Number(data.o?.[index] || close),
          high: Number(data.h?.[index] || close),
          low: Number(data.l?.[index] || close),
          volume: Number(data.v?.[index] || 0)
        }));
        return { source: "finnhub", range, points, stats: historyStats(points) };
      }
    } catch (error) {
      console.error(
        "Finnhub history failed:",
        error?.message || String(error),
        "symbol:",
        symbol,
        "trying yfinance fallback"
      );
    }
  }

  const yfinancePoints = await yfinanceHistory(symbol, range);
  if (yfinancePoints.length >= historyMinPoints(range)) {
    return { source: "yfinance", range, points: yfinancePoints, stats: historyStats(yfinancePoints) };
  }

  const yahooPoints = await yahooHistory(symbol, range);
  if (yahooPoints.length >= historyMinPoints(range)) {
    return { source: "yahoo_chart", range, points: yahooPoints, stats: historyStats(yahooPoints) };
  }

  if (
    STOOQ_QUOTES_ENABLED &&
    range !== "1d" &&
    isStooqEligibleSymbol(symbol) &&
    Date.now() >= stooqCooldownUntil
  ) {
    const stooqPoints = await stooqHistory(symbol, from, to);
    if (stooqPoints.length) {
      return { source: "stooq_public", range, points: stooqPoints, stats: historyStats(stooqPoints) };
    }
  }

  const quoteResult = await quoteSnapshot(symbol);
  const quote = quoteResult.quote || enrichStaticQuote(MARKET_FALLBACK[symbol]) || { symbol, price: 100, pct: 0, changePercent: 0 };
  const points = buildHistoricalSeries(symbol, range, quote);
  return { source: "modeled_history", range, points, stats: historyStats(points) };
}

async function marketHistory(res, url) {
  const requested = String(url.searchParams.get("symbol") || "NVDA").toUpperCase().replace(/[^A-Z.]/g, "");
  const symbol = MARKET_FALLBACK[requested] || FUNDAMENTALS[requested] ? requested : "NVDA";
  const range = String(url.searchParams.get("range") || "6m").toLowerCase();
  const payload = await fetchMarketHistoryPayload(symbol, range);
  sendJson(res, 200, {
    symbol,
    ...payload,
    confidence: payload.source === "finnhub" ? "High" : payload.source === "yfinance" ? "Medium" : "Medium",
    updatedAt: new Date().toISOString()
  });
}

function normalizeStockSymbol(value) {
  const requested = String(value || "NVDA").toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 12);
  return requested || "NVDA";
}

function normalizeReaderMode(value) {
  const mode = String(value || "investor").toLowerCase();
  return ["citizen", "investor", "analyst"].includes(mode) ? mode : "investor";
}

function escapeHtmlText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function publicStockCard(res, pathname, { head = false } = {}) {
  const raw = decodeURIComponent(pathname.slice("/stock/".length)).split(/[/?#]/)[0];
  const symbol = normalizeStockSymbol(raw);
  const ogHeadline = buildStockOgPreview(symbol);
  const title = `${symbol} government-to-market explainer | TradeSimple`;
  const description = ogHeadline.slice(0, 280);
  const html = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/favicon.png" />
    <title>${escapeHtmlText(title)}</title>
    <meta name="description" content="${escapeHtmlText(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtmlText(title)}" />
    <meta property="og:description" content="${escapeHtmlText(description)}" />
    <meta property="og:url" content="${escapeHtmlText(`${APP_URL}/stock/${symbol}`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtmlText(title)}" />
    <meta name="twitter:description" content="${escapeHtmlText(description)}" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400;1,9..144,600&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/src/imports/design-tokens.css?v=cd-brief-1" />
    <link rel="stylesheet" href="/assets/stock-card.css?v=stock-dossier-2" />
    <link rel="stylesheet" href="/assets/bill-card.css?v=bill-dossier-2" />
  </head>
  <body data-symbol="${escapeHtmlText(symbol)}">
    <main id="stock-card-root" class="stock-card-root" aria-live="polite">
      <section class="stock-card-loading">
        <span class="mini-label">TradeSimple public card</span>
        <h1>${escapeHtmlText(symbol)}</h1>
        <p>Loading government-to-market snapshot.</p>
      </section>
    </main>
    <script src="/assets/brief-shell.js?v=brief-shell-2" defer></script>
    <script src="/assets/stock-card.js?v=stock-dossier-2" defer></script>
  </body>
</html>`;
  sendHtml(res, 200, html, { head });
}

function resolvePolicyBill(billIdRaw) {
  const billId = resolveBillIdCanonical(billIdRaw);
  if (!billId) return null;
  const direct = POLICY_BILLS.find((b) => b.id === billId);
  if (direct) return direct;
  const live = liveCongressBillRegistry.get(billId);
  if (live) return live;
  return null;
}

function knownSeedBillIds(limit = 24) {
  return POLICY_BILLS.filter((b) => !b.scenarioOnly)
    .map((b) => b.id)
    .slice(0, limit);
}

function isAdHocCongressFresh(billId) {
  const fetchedAt = adHocCongressFetchedAt.get(billId);
  if (!fetchedAt) return false;
  return Date.now() - fetchedAt < AD_HOC_CONGRESS_TTL_MS;
}

function billFromCongressOverlay(billId, overlay) {
  const ref = parseBillIdToCongressRef(billId);
  const displayId = ref ? congressRefToBillId(ref) || billId : billId;
  const base = {
    id: billId,
    displayId,
    title: overlay.title || billId,
    shortTitle: overlay.title || billId,
    summary: overlay.summary || null,
    chamber: overlay.chamber || "House",
    status: overlay.status || "introduced",
    sponsor: overlay.sponsor || { name: "—", party: "U", state: "" },
    cosponsors: overlay.cosponsors ?? null,
    bipartisanCosponsors: 0,
    floorScheduled: false,
    exactCongressRecord: true,
    _dynamicCongressBill: true,
    introducedDate: overlay.introducedDate || null,
    policyArea: overlay.policyArea || null,
    committees: overlay.committees || [],
    _committeeNames: overlay._committeeNames || [],
    latestAction: overlay.latestAction || "Updated by Congress.gov",
    latestActionDate: overlay.latestActionDate || null,
    lobbyingAgainst: null,
    lobbyingFor: null,
    sourceKind: "congress_exact",
    sourceNote: "Exact Congress.gov record (on-demand fetch)."
  };
  return applyBillMarketExposure(base);
}

async function fetchCongressBillOverlay(billId, ref, key) {
  const baseUrl = `https://api.congress.gov/v3/bill/${ref.congress}/${ref.type}/${ref.number}`;
  const qs = `format=json&api_key=${encodeURIComponent(key)}`;
  const [detailResp, commResp, actions] = await Promise.all([
    fetchWithTimeout(`${baseUrl}?${qs}`, {}, 10_000),
    fetchWithTimeout(`${baseUrl}/committees?${qs}`, {}, 10_000).catch(() => null),
    fetchCongressBillActions(baseUrl, qs)
  ]);
  if (!detailResp.ok) return null;
  const data = await detailResp.json();
  const b = data.bill;
  if (!b) return null;
  let committees = [];
  if (commResp?.ok) {
    try {
      committees = parseCongressCommitteesResponse(await commResp.json());
    } catch {
      committees = [];
    }
  }
  const overlay = mapCongressBillDetailToOverlay(b, ref, committees, actions);
  const chamberRaw = b.originChamber || b.type || ref.type;
  const chamber = String(chamberRaw).toLowerCase().includes("senate") ? "Senate" : "House";
  return {
    id: billId,
    ...overlay,
    chamber,
    sponsor: overlay.sponsor || { name: "—", party: "U", state: "" }
  };
}

async function fetchCongressBillById(billIdRaw) {
  const billId = resolveBillIdCanonical(billIdRaw);
  if (!billId) return null;
  const existing = resolvePolicyBill(billId);
  if (existing) return existing;

  if (isAdHocCongressFresh(billId)) {
    const cached = liveCongressBillRegistry.get(billId);
    if (cached) return cached;
    const overlay = congressLiveCache.get(billId);
    if (overlay) {
      const rebuilt = decorateBill(mergeCongressLiveIntoBill(billFromCongressOverlay(billId, overlay)));
      liveCongressBillRegistry.set(billId, rebuilt);
      return rebuilt;
    }
  }

  const ref = parseBillIdToCongressRef(billId);
  if (!ref) return null;

  const key = process.env.CONGRESS_API_KEY;
  const diskOverlay = await readCongressCache(billId);
  if (diskOverlay) {
    const hydrated = await hydrateCongressOverlayWithActions(diskOverlay, billId, key);
    congressLiveCache.set(billId, hydrated);
    adHocCongressFetchedAt.set(billId, Date.now());
    if (hydrated !== diskOverlay) void writeCongressCache(billId, hydrated);
    const fromDisk = decorateBill(mergeCongressLiveIntoBill(billFromCongressOverlay(billId, hydrated)));
    liveCongressBillRegistry.set(billId, fromDisk);
    return fromDisk;
  }

  if (!key) return null;

  if (congressBillFetchInflight.has(billId)) {
    return congressBillFetchInflight.get(billId);
  }

  const inflight = (async () => {
    try {
      const overlay = await fetchCongressBillOverlay(billId, ref, key);
      if (!overlay) return null;
      congressLiveCache.set(billId, overlay);
      adHocCongressFetchedAt.set(billId, Date.now());
      await writeCongressCache(billId, overlay);
      const bill = decorateBill(mergeCongressLiveIntoBill(billFromCongressOverlay(billId, overlay)));
      liveCongressBillRegistry.set(billId, bill);
      bumpLandingSignalCacheVersion();
      liveBillAnalysisCache.clear();
      return bill;
    } finally {
      congressBillFetchInflight.delete(billId);
    }
  })();
  congressBillFetchInflight.set(billId, inflight);
  return inflight;
}

async function resolvePolicyBillAsync(billIdRaw) {
  const billId = resolveBillIdCanonical(billIdRaw);
  if (!billId) return null;
  let bill = resolvePolicyBill(billIdRaw);
  if (!bill) bill = await fetchCongressBillById(billIdRaw);
  if (!bill) return null;

  const key = process.env.CONGRESS_API_KEY;
  if (!key || !congressRefForBill(bill)) return bill;

  const cached = congressLiveCache.get(billId) || {
    latestAction: bill.latestAction,
    latestActionDate: bill.latestActionDate,
    status: bill.status,
    title: bill.title,
    introducedDate: bill.introducedDate,
    policyArea: bill.policyArea,
    committees: bill.committees,
    sponsor: bill.sponsor
  };
  if ((cached.actions || cached._congressActions || []).length) return bill;

  const hydrated = await hydrateCongressOverlayWithActions(cached, billId, key);
  if (!(hydrated.actions || hydrated._congressActions || []).length) return bill;

  congressLiveCache.set(billId, hydrated);
  void writeCongressCache(billId, hydrated);
  const merged = decorateBill(mergeCongressLiveIntoBill(billFromCongressOverlay(billId, hydrated)));
  liveCongressBillRegistry.set(billId, merged);
  return merged;
}

function checkBriefAiRateLimit(clientKey) {
  const now = Date.now();
  const key = String(clientKey || "anon");
  const entry = briefAiRateLimit.get(key);
  if (!entry || now - entry.windowStart > BRIEF_AI_RATE_LIMIT_WINDOW) {
    briefAiRateLimit.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: BRIEF_AI_RATE_LIMIT_MAX - 1 };
  }
  if (entry.count >= BRIEF_AI_RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.ceil((BRIEF_AI_RATE_LIMIT_WINDOW - (now - entry.windowStart)) / 1000);
    return { allowed: false, retryAfterSeconds };
  }
  entry.count += 1;
  return { allowed: true, remaining: BRIEF_AI_RATE_LIMIT_MAX - entry.count };
}

setInterval(() => {
  const cutoff = Date.now() - BRIEF_AI_RATE_LIMIT_WINDOW * 2;
  for (const [key, entry] of briefAiRateLimit) {
    if (entry.windowStart < cutoff) briefAiRateLimit.delete(key);
  }
}, 10 * 60 * 1000);

async function attachShareBriefAiSummary(req, payload, kind) {
  if (!process.env.ANTHROPIC_API_KEY) return payload;
  try {
    const aiSummary = await runShareBriefSummary({
      kind,
      payload,
      rateLimitKey: clientIp(req),
      checkRateLimit: checkBriefAiRateLimit
    });
    if (aiSummary?.text) return { ...payload, aiSummary };
  } catch (err) {
    console.warn("[ai] share brief summary skipped:", err.message);
  }
  return payload;
}

const LIVE_ANALYSIS_UPDATE_CADENCE = "Congress refresh 15min";

function liveBillAnalysisCacheKey(bill) {
  return `${bill?.id || ""}:${bill?.latestActionDate || "na"}:${(bill?.affected || []).join(",")}`;
}

function parseBillWhatHappened(bill) {
  const parsed = parseBillStageFromAction(bill.latestAction, bill.actions || bill._congressActions, bill);
  const action = String(parsed.latestAction || bill?.latestAction || "").trim();
  const title = bill?.shortTitle || bill?.title || bill?.id || "This bill";
  if (!action) return `${title} — no latest action recorded yet.`;
  const key = parsed.statusKey;
  if (key === "passed_one_chamber") {
    if (/senate/i.test(action)) return `Senate passed ${title} — ${action}`;
    if (/house/i.test(action)) return `House passed ${title} — ${action}`;
    return `One chamber passed ${title} — ${action}`;
  }
  if (key === "enacted") return `${title} became law — ${action}`;
  if (key === "resolving") return `${title} in conference / resolving differences — ${action}`;
  if (/presented to president|to president/i.test(action)) return `${title} sent to the President — ${action}`;
  if (key === "floor" && (parsed.floorScheduled || /rules committee|calendar/i.test(action))) {
    return `${title} is on the floor calendar — ${action}`;
  }
  if (/agreed to in house|agreed to in senate/i.test(action)) {
    return `Chamber agreed to ${title} — ${action}`;
  }
  return `${title}: ${action}`;
}

function billStageLabelForChain(bill, statusInfo) {
  const label = statusInfo?.label || bill?.status || "In progress";
  const id = bill?.displayId || bill?.id || "Bill";
  if (/passed|enacted|law/i.test(label)) return `${id} · ${label}`;
  if (/floor|chamber/i.test(label)) return `${id} · ${label}`;
  return `${id} · ${label}`;
}

function isHomelandEnforcementCorpus(corpus, bill = {}) {
  const text = String(corpus || "").toLowerCase();
  return (
    /\bice\b/.test(text) ||
    text.includes("border patrol") ||
    text.includes("homeland") ||
    text.includes("immigration") ||
    text.includes("detention") ||
    text.includes("secure america") ||
    String(bill?.policyArea || "").toLowerCase().includes("immigration")
  );
}

function buildWhyMarketsCareRules(bill, tickers = []) {
  const corpus = billExposureCorpus(bill).toLowerCase();
  const syms = tickers.slice(0, 6);
  const names = syms.map((s) => FUNDAMENTALS[s]?.name || s).join(", ");
  if (isHomelandEnforcementCorpus(corpus, bill)) {
    return `Congress is funding ICE and Border Patrol through DHS — that flows to detention operators (${syms.filter((s) => ["GEO", "CXW"].includes(s)).join(", ") || "GEO, CXW"}), surveillance/IT vendors (${syms.filter((s) => ["PLTR", "BAH"].includes(s)).join(", ") || "PLTR, BAH"}), and border infrastructure contractors. Markets reprice ${names || syms.join(", ")} on enforcement budget visibility.`;
  }
  if (
    /\bdigital asset|crypto|bitcoin|blockchain|stablecoin|virtual currency|clarity act\b/i.test(corpus) ||
    (bill.tags || []).some((t) => /crypto|digital asset/i.test(String(t)))
  ) {
    return `Digital-asset market-structure bills affect exchanges and crypto proxies (${syms.filter((s) => ["COIN", "BTC", "ETH"].includes(s)).join(", ") || "COIN, BTC, ETH"}). Markets reprice ${names || syms.join(", ")} on passage odds and compliance clarity — not a price forecast.`;
  }
  if (
    /\bforeign affairs|international relations|caucasus|diplomatic|embassy|state department|foreign aid\b/i.test(corpus) ||
    String(bill?.policyArea || "").toLowerCase().includes("international")
  ) {
    const defenseSyms = syms.filter((s) => ["LMT", "RTX", "GD", "NOC", "BAH", "PLTR"].includes(s));
    return `Foreign-affairs and security-authorization bills shift diplomatic contracting and defense supplier visibility (${defenseSyms.join(", ") || "LMT, RTX, GD"}). ${names || syms.join(", ")} may see sentiment effects from authorization levels — not a price forecast.`;
  }
  if (/\bdefense|military|pentagon|national security|armed forces\b/i.test(corpus)) {
    return `Defense authorization and procurement bills flow through prime contractors (${syms.filter((s) => ["LMT", "RTX", "NOC", "PLTR", "BAH"].includes(s)).join(", ") || "LMT, RTX, PLTR"}). ${names || syms.join(", ")} reprice on budget visibility and program language — not a price forecast.`;
  }
  if (syms.length) {
    return `If ${bill?.shortTitle || bill?.title || "this bill"} advances, mapped tickers (${syms.join(", ")}) may see revenue, compliance, or sentiment effects from the policy mechanism — not a price forecast.`;
  }
  return "";
}

function buildCausalChainRules(bill, tickers = [], statusInfo = null) {
  const stage = billStageLabelForChain(bill, statusInfo);
  const corpus = billExposureCorpus(bill).toLowerCase();
  const chain = [stage];
  if (
    isHomelandEnforcementCorpus(corpus, bill) ||
    corpus.includes("border")
  ) {
    chain.push("→ DHS / ICE / CBP");
    const contractors = tickers.filter((s) => ["GEO", "CXW", "PLTR", "BAH", "LMT"].includes(s));
    chain.push(`→ Contractors (${contractors.length ? contractors.join(", ") : "detention & IT vendors"})`);
    if (tickers.length) chain.push(`→ Tickers: ${tickers.slice(0, 5).join(", ")}`);
    return chain;
  }
  if (tickers.length) {
    chain.push(`→ Mapped tickers: ${tickers.slice(0, 5).join(", ")}`);
  }
  return chain;
}

function buildLobbyAngleSentence(bill) {
  const merged = applyLobbyingOverlay(bill);
  const rows = merged?.stakeholders?.lobbying || merged?._ldaRows || [];
  if (!rows.length && merged?.lobbyingSource !== "senate_lda") return null;
  const top = rows[0];
  if (top?.name) {
    const stance = top.stance === "against" ? "opposing" : top.stance === "for" ? "supporting" : "active on";
    const amtM =
      top.amountM != null
        ? top.amountM
        : top.amount != null
          ? Math.round((Number(top.amount) / 1_000_000) * 10) / 10
          : null;
    return `${top.name} is ${stance} this issue${amtM != null ? ` (~$${amtM}M disclosed)` : ""}.`;
  }
  if (merged?.lobbyingSource === "senate_lda" && Number(merged.lobbyingFilingsCount) > 0) {
    return `Senate LDA shows ${merged.lobbyingFilingsCount} matched filing(s) — $${merged.lobbyingFor ?? 0}M for, $${merged.lobbyingAgainst ?? 0}M against.`;
  }
  return null;
}

async function buildContractAngleSentence(tickers = []) {
  const profiled = tickers.filter((s) => CONTRACT_PROFILES[s]).slice(0, 2);
  if (!profiled.length) return null;
  const parts = [];
  for (const sym of profiled) {
    const profile = CONTRACT_PROFILES[sym];
    try {
      const ctx = await resolveContractUsaspendingContext(sym);
      const count = ctx?.awards?.length || 0;
      const agency = profile.primaryAgencies?.[0] || ctx?.awards?.[0]?.awardingAgency || "federal agencies";
      parts.push(
        `${sym} (~${Math.round((profile.governmentRevenuePct || 0) * 100)}% gov revenue${count ? `, ${count} USASpending award(s)` : ""} via ${agency})`
      );
    } catch {
      parts.push(`${sym} (~${Math.round((profile.governmentRevenuePct || 0) * 100)}% gov revenue, ${profile.primaryAgencies?.[0] || "federal"})`);
    }
  }
  return parts.length ? `Contract exposure: ${parts.join("; ")}.` : null;
}

async function buildRelatedContractsForBill(affected = []) {
  const tickers = [...new Set((affected || []).map((t) => String(t || "").toUpperCase()).filter((t) => VALID_TICKER_PATTERN.test(t)))].slice(0, 8);
  const rows = [];
  for (const ticker of tickers) {
    const profile = CONTRACT_PROFILES[ticker];
    let awardCount = null;
    let topAgency = profile?.primaryAgencies?.[0] || null;
    let directUrl = usaspendingSearchUrl(resolveContractCompanyName(ticker));
    try {
      const ctx = await resolveContractUsaspendingContext(ticker);
      if (ctx?.awards?.length) {
        awardCount = ctx.awards.length;
        topAgency = ctx.awards[0]?.awardingAgency || topAgency;
        directUrl = ctx.awards[0]?.directUrl || directUrl;
      }
    } catch {
      /* USASpending optional */
    }
    if (!profile && !awardCount) continue;
    rows.push({
      symbol: ticker,
      name: FUNDAMENTALS[ticker]?.name || resolveTradableSymbolName(ticker),
      governmentRevenuePct: profile?.governmentRevenuePct ?? null,
      awardCount,
      topAgency,
      directUrl,
      url: shareContractPath(ticker)
    });
  }
  return rows;
}

function headlineMatchesBillTopic(bill, text = "") {
  const blob = String(text || "").toLowerCase();
  if (!blob.trim()) return false;
  const tokens = billMatchTokens(billExposureCorpus(bill));
  let hits = 0;
  for (const token of tokens) {
    if (token.length < 4) continue;
    if (blob.includes(token)) hits += 1;
  }
  if (hits >= 2) return true;
  const corpus = billExposureCorpus(bill).toLowerCase();
  if (isHomelandEnforcementCorpus(corpus, bill)) {
    return /\bice\b|border patrol|homeland|immigration enforcement|secure america|reconciliation/i.test(blob);
  }
  if (/\bcrypto|digital asset|bitcoin|blockchain|stablecoin\b/i.test(corpus)) {
    return /\bcrypto|digital asset|bitcoin|blockchain|stablecoin|coinbase\b/i.test(blob);
  }
  if (/\bforeign affairs|international|caucasus|diplomatic\b/i.test(corpus)) {
    return /\bforeign affairs|diplomatic|congress|house passed|senate\b/i.test(blob);
  }
  return hits >= 1 && blob.includes(String(bill?.shortTitle || bill?.title || "").slice(0, 24).toLowerCase());
}

function buildLiveBillAnalysisRules(bill, tickers, statusInfo) {
  const whatHappened = parseBillWhatHappened(bill);
  const whyMarketsCare = buildWhyMarketsCareRules(bill, tickers);
  return {
    whatHappened,
    whyMarketsCare,
    causalChain: buildCausalChainRules(bill, tickers, statusInfo),
    lobbyingAngle: buildLobbyAngleSentence(bill),
    contractAngle: null
  };
}

async function buildLiveBillAnalysis(bill, req = null) {
  const mergedBill = applyLobbyingOverlay(bill);
  const statusInfo = mergedBill.statusInfo || statusInfoForBill(mergedBill);
  const tickers = (mergedBill.affected || mergedBill.portfolioTickers || []).filter((t) => VALID_TICKER_PATTERN.test(t)).slice(0, 8);
  const cacheKey = liveBillAnalysisCacheKey(mergedBill);
  const cached = liveBillAnalysisCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < Number(process.env.CONGRESS_REFRESH_MS || 900_000)) {
    return cached.analysis;
  }

  const freshnessBadge = buildFreshnessBadge({
    type: "bill",
    bill: mergedBill,
    relatedContracts: [],
    exposureSource: mergedBill.exposureSource
  });
  const freshness =
    freshnessBadge.level === "verified" ? "live" : freshnessBadge.level === "stale" ? "cached" : mergedBill.scenarioOnly ? "scenario" : "cached";

  let rules = buildLiveBillAnalysisRules(mergedBill, tickers, statusInfo);
  rules.contractAngle = await buildContractAngleSentence(tickers);

  let whyMarketsCare = rules.whyMarketsCare;
  let causalChain = rules.causalChain;
  if (!whyMarketsCare && process.env.ANTHROPIC_API_KEY) {
    try {
      const ai = await inferLiveBillWhyMarketsCareAI({
        bill: mergedBill,
        billId: mergedBill.id,
        rateLimitKey: req ? clientIp(req) : "anon",
        checkRateLimit: checkBriefAiRateLimit
      });
      if (ai?.whyMarketsCare) {
        whyMarketsCare = ai.whyMarketsCare;
        if (ai.causalChain?.length) causalChain = ai.causalChain;
      }
    } catch (err) {
      console.warn("[ai] live bill analysis skipped:", err.message);
    }
  }

  let headline = null;
  let whatHappened = rules.whatHappened;
  try {
    const headlines = await fetchBillRelatedHeadlines(mergedBill, tickers);
    const match = headlines.find((row) =>
      headlineMatchesBillTopic(mergedBill, `${row.headline || ""} ${row.summary || ""}`)
    );
    if (match) {
      headline = {
        text: match.headline,
        source: match.source || "Finnhub",
        publishedAt: match.publishedAt || null
      };
      const actionDate = mergedBill.latestActionDate ? formatShortIsoDate(mergedBill.latestActionDate) : "recent Congress.gov action";
      whatHappened = `${whatHappened} Headlines: ${match.headline} — aligns with Congress.gov action on ${actionDate}.`;
    }
  } catch {
    /* headlines optional */
  }

  const lobbyRows = (mergedBill.stakeholders?.lobbying || mergedBill._ldaRows || []).slice(0, 6).map((row) => ({
    client: row.name || row.client || null,
    stance: row.stance || null,
    amountM: row.amountM ?? (row.amount != null ? Math.round((Number(row.amount) / 1_000_000) * 10) / 10 : null),
    issue: row.issue || null
  }));

  const analysis = {
    asOf: new Date().toISOString(),
    freshness,
    freshnessBadge,
    headline,
    explanation: {
      whatHappened,
      whyMarketsCare: whyMarketsCare || bill.plainEnglish || bill.signal || "",
      causalChain,
      lobbyingAngle: rules.lobbyingAngle,
      contractAngle: rules.contractAngle
    },
    linkedEntities: {
      bills: [{ id: mergedBill.id, title: mergedBill.shortTitle || mergedBill.title || mergedBill.id, url: shareBillPath(mergedBill.id) }],
      stocks: tickers.map((sym) => ({
        symbol: sym,
        name: FUNDAMENTALS[sym]?.name || resolveTradableSymbolName(sym),
        url: shareStockPath(sym)
      })),
      lobbyFilings: lobbyRows,
      contracts: tickers
        .filter((sym) => CONTRACT_PROFILES[sym])
        .map((sym) => ({
          symbol: sym,
          name: FUNDAMENTALS[sym]?.name || sym,
          governmentRevenuePct: CONTRACT_PROFILES[sym].governmentRevenuePct,
          url: shareContractPath(sym)
        }))
    },
    updateCadence: LIVE_ANALYSIS_UPDATE_CADENCE
  };

  liveBillAnalysisCache.set(cacheKey, { analysis, cachedAt: Date.now() });
  return analysis;
}

function formatShortIsoDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || "");
  return d.toISOString().slice(0, 10);
}

function allBrowsablePolicyBills() {
  const byId = new Map();
  for (const bill of POLICY_BILLS) byId.set(bill.id, bill);
  for (const [, bill] of liveCongressBillRegistry) {
    if (!byId.has(bill.id)) byId.set(bill.id, bill);
  }
  return [...byId.values()];
}

function billActionWithinDays(bill, days = 7) {
  if (!bill?.latestActionDate) return false;
  const age = (Date.now() - new Date(bill.latestActionDate).getTime()) / 86400000;
  return age >= 0 && age <= days;
}

function freshnessDaysSince(value) {
  if (!value) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 86400000);
}

function freshnessShortDate(value) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function freshnessSourceLine(sources = []) {
  return sources
    .map((row) => {
      const name = row.source || row.kind || "Source";
      const date = row.asOf ? freshnessShortDate(row.asOf) : "";
      if (date) return `${name} ${date}`;
      if (row.note) return `${name} · ${row.note}`;
      return name;
    })
    .filter(Boolean)
    .join(" · ");
}

function buildFreshnessBadge(entity = {}) {
  const type = entity.type || entity.entityType;
  if (type === "stock") return buildStockFreshnessBadge(entity);
  if (type === "contract") return buildContractFreshnessBadge(entity);
  if (type === "lobby") return buildLobbyFreshnessBadge(entity);
  return buildBillFreshnessBadge(entity);
}

function buildBillFreshnessBadge({ bill = {}, relatedContracts = [], exposureSource = null } = {}) {
  const sources = [];
  let verified = false;
  let stale = false;
  const expSrc = exposureSource || bill.exposureSource || null;

  if (bill.exactCongressRecord || bill._dynamicCongressBill) {
    const asOf = bill.latestActionDate || bill.lastSubstantiveActionDate || null;
    const days = freshnessDaysSince(asOf);
    sources.push({
      kind: "congress",
      asOf,
      source: "Congress",
      note: bill.latestAction ? String(bill.latestAction).slice(0, 72) : undefined
    });
    if (days != null && days <= 7) verified = true;
    else stale = true;
  }

  const ldaCount = Number(bill.lobbyingFilingsCount || 0);
  if (bill.lobbyingSource === "senate_lda" && ldaCount > 0) {
    sources.push({
      kind: "lda",
      asOf: bill.lobbyingPostedAt || bill.latestActionDate || null,
      source: "LDA",
      note: `${ldaCount} filing${ldaCount === 1 ? "" : "s"}`
    });
    verified = true;
  }

  const awardRows = (relatedContracts || []).filter((row) => row.directUrl && Number(row.awardCount || 0) > 0);
  if (awardRows.length) {
    const awardTotal = awardRows.reduce((sum, row) => sum + Number(row.awardCount || 0), 0);
    sources.push({
      kind: "usaspending",
      asOf: null,
      source: "USASpending",
      note: `${awardTotal} award${awardTotal === 1 ? "" : "s"}`
    });
    verified = true;
  }

  if (expSrc && !bill.exactCongressRecord) {
    sources.push({
      kind: expSrc.includes("seed") ? "seed" : "rules",
      asOf: null,
      source: expSrc.includes("seed") ? "Seed mapping" : "Rules mapping"
    });
  }

  const modeledOnly =
    bill.scenarioOnly ||
    bill.dataLayer === "scenario" ||
    (!bill.exactCongressRecord && !bill._dynamicCongressBill && !verified && !stale);

  let level = "modeled";
  let label = "Modeled";
  let detail = "Rules-based exposure and illustrative scenarios — no live Congress overlay.";
  if (verified) {
    level = "verified";
    label = "Verified";
    detail = "Live public records back this brief.";
  } else if (stale) {
    level = "stale";
    label = "Stale";
    detail = "Live source connected, but the latest action or award is aging.";
  } else if (modeledOnly) {
    level = "modeled";
    label = "Modeled";
    detail = "Illustrative mapping — confirm status on Congress.gov before acting.";
  }

  return { level, label, detail, sources, sourcesLine: freshnessSourceLine(sources) };
}

function buildStockFreshnessBadge({ quote = {}, relatedBills = [], recentNews = [], updatedAt = null } = {}) {
  const sources = [];
  let verified = false;
  let stale = false;
  const qSrc = quote.source || quote.providerCode || null;
  const qTs = quote.providerTimestamp || quote.fetchedAt || updatedAt || null;
  const quoteDays = freshnessDaysSince(qTs);

  if (qSrc && qSrc !== "fallback_static" && qSrc !== "fallback" && qSrc !== "unavailable") {
    const liveQuote = qSrc === "finnhub" || qSrc === "yfinance" || qSrc === "stooq_public" || qSrc === "alpaca";
    sources.push({
      kind: "quote",
      asOf: qTs,
      source: liveQuote ? "Finnhub live" : quoteProviderLabel(qSrc),
      note: quote.delayLabel || undefined
    });
    if (liveQuote && quoteDays != null && quoteDays <= 2) verified = true;
    else if (liveQuote) stale = true;
  } else {
    sources.push({ kind: "quote", asOf: qTs, source: "Modeled quote", note: "Fallback tape" });
  }

  if (relatedBills.length) {
    sources.push({
      kind: "policy",
      asOf: relatedBills[0]?.latestActionDate || null,
      source: "Bill mapping",
      note: `${relatedBills.length} mapped bill${relatedBills.length === 1 ? "" : "s"}`
    });
  }

  const headline = (recentNews || [])[0];
  if (headline?.publishedAt) {
    sources.push({
      kind: "news",
      asOf: headline.publishedAt,
      source: headline.source || "Headlines",
      note: headline.headline ? String(headline.headline).slice(0, 64) : undefined
    });
    const newsDays = freshnessDaysSince(headline.publishedAt);
    if (newsDays != null && newsDays <= 7) verified = true;
    else if (newsDays != null) stale = true;
  }

  let level = verified ? "verified" : stale ? "stale" : "modeled";
  const labels = { verified: "Verified", stale: "Stale", modeled: "Modeled" };
  const details = {
    verified: "Live quote and/or recent headlines back this snapshot.",
    stale: "Quote or headline feed is connected but no longer fresh.",
    modeled: "Quote fallback or partial mapping — treat policy links as illustrative."
  };
  return {
    level,
    label: labels[level],
    detail: details[level],
    sources,
    sourcesLine: freshnessSourceLine(sources)
  };
}

function buildContractFreshnessBadge({ awards = [], relatedBills = [], updatedAt = null, source = "usaspending.gov" } = {}) {
  const sources = [];
  let verified = false;
  let stale = false;
  const rows = Array.isArray(awards) ? awards : [];
  const withUrl = rows.filter((row) => row.directUrl);
  // Period-of-performance end dates are frequently years in the future for active
  // multi-year contracts, so they can't stand in for "when did this award last change."
  // Only Last Modified Date (or a past-dated start/end) reflects real recency.
  const now = Date.now();
  const awardRecencyDate = (row) => {
    for (const candidate of [row?.lastModifiedDate, row?.endDate, row?.startDate]) {
      const ts = Date.parse(candidate || "");
      if (Number.isFinite(ts) && ts <= now) return candidate;
    }
    return null;
  };
  const newestAward = rows.reduce((best, row) => {
    const ts = Date.parse(awardRecencyDate(row) || "");
    if (!Number.isFinite(ts)) return best;
    if (!best || ts > Date.parse(awardRecencyDate(best) || "")) return row;
    return best;
  }, null);

  if (withUrl.length) {
    const asOf = (newestAward && awardRecencyDate(newestAward)) || updatedAt || null;
    sources.push({
      kind: "usaspending",
      asOf,
      source: "USASpending",
      note: `${rows.length} award${rows.length === 1 ? "" : "s"}`
    });
    const awardDays = freshnessDaysSince(asOf);
    if (awardDays != null && awardDays <= 7) verified = true;
    else stale = true;
  } else if (rows.length) {
    sources.push({
      kind: "usaspending",
      asOf: updatedAt,
      source: source || "USASpending",
      note: `${rows.length} award row${rows.length === 1 ? "" : "s"}`
    });
    stale = true;
  }

  if (relatedBills.length) {
    sources.push({
      kind: "policy",
      asOf: relatedBills[0]?.latestActionDate || null,
      source: "Bill linkage",
      note: `${relatedBills.length} related bill${relatedBills.length === 1 ? "" : "s"}`
    });
  }

  let level = verified ? "verified" : stale || rows.length ? "stale" : "modeled";
  const labels = { verified: "Verified", stale: "Stale", modeled: "Modeled" };
  const details = {
    verified: "USASpending awards with direct URLs anchor this contract brief.",
    stale: "Awards loaded but the latest obligation period is aging.",
    modeled: "No live USASpending rows — profile text is illustrative."
  };
  return {
    level,
    label: labels[level],
    detail: details[level],
    sources,
    sourcesLine: freshnessSourceLine(sources)
  };
}

function buildLobbyFreshnessBadge({ filing = {}, relatedBills = [], source = "senate_lda", updatedAt = null } = {}) {
  const sources = [];
  let verified = false;
  let stale = false;
  const postedAt = filing.postedAt || filing.filingDate || filing.dtPosted || updatedAt || null;
  const filingDays = freshnessDaysSince(postedAt);

  if (source === "senate_lda" || filing.source === "senate_lda") {
    sources.push({
      kind: "lda",
      asOf: postedAt,
      source: "Senate LDA",
      note: filing.client || filing.registrant || undefined
    });
    if (filingDays != null && filingDays <= 45) verified = true;
    else if (postedAt) stale = true;
  } else {
    sources.push({ kind: "lda", asOf: postedAt, source: "Illustrative LDA", note: "Sample filing" });
  }

  if (relatedBills.length) {
    sources.push({
      kind: "policy",
      asOf: relatedBills[0]?.latestActionDate || null,
      source: "Bill linkage",
      note: `${relatedBills.length} related bill${relatedBills.length === 1 ? "" : "s"}`
    });
  }

  let level = verified ? "verified" : stale ? "stale" : "modeled";
  const labels = { verified: "Verified", stale: "Stale", modeled: "Modeled" };
  const details = {
    verified: "Senate LDA filing date and bill linkage are live.",
    stale: "Filing is on record but no longer recent.",
    modeled: "Illustrative lobbying sample — not a live LDA pull."
  };
  return {
    level,
    label: labels[level],
    detail: details[level],
    sources,
    sourcesLine: freshnessSourceLine(sources)
  };
}

function resolveEditorialLeadBill(pool = landingSignalBillPool()) {
  if (!EDITORIAL_LEAD_BILL_ID) return null;
  let bill = resolvePolicyBill(EDITORIAL_LEAD_BILL_ID);
  if (!bill) bill = liveCongressBillRegistry.get(EDITORIAL_LEAD_BILL_ID);
  if (!bill) {
    const canonical = resolveBillIdCanonical(EDITORIAL_LEAD_BILL_ID);
    bill = pool.find((row) => row.id === canonical || row.id === EDITORIAL_LEAD_BILL_ID);
  }
  if (!bill) return null;
  return decorateBill(mergeCongressLiveIntoBill(applyBillMarketExposure(bill)));
}

async function resolveEditorialLeadBillAsync(pool = landingSignalBillPool()) {
  const sync = resolveEditorialLeadBill(pool);
  if (sync) return sync;
  if (!EDITORIAL_LEAD_BILL_ID) return null;
  try {
    const fetched = await resolvePolicyBillAsync(EDITORIAL_LEAD_BILL_ID);
    if (!fetched) return null;
    return decorateBill(mergeCongressLiveIntoBill(applyBillMarketExposure(fetched)));
  } catch {
    return null;
  }
}

async function resolveStockPolicyPulse(symbol, fundamentals, req = null) {
  const sym = String(symbol || "").toUpperCase();
  const candidates = allBrowsablePolicyBills()
    .map((bill) => decorateBill(mergeCongressLiveIntoBill(applyBillMarketExposure(bill))))
    .filter((bill) => billMatchesStockByInference(bill, sym) || billMatchesStockBySectorKeyword(bill, fundamentals))
    .filter((bill) => billActionWithinDays(bill, 7))
    .sort((a, b) => Number(computeLegislativeMomentum(b) || 0) - Number(computeLegislativeMomentum(a) || 0));
  const top = candidates[0];
  if (!top) return null;
  const liveAnalysis = await buildLiveBillAnalysis(top, req);
  return {
    billId: top.id,
    billTitle: top.shortTitle || top.title || top.id,
    asOf: liveAnalysis.asOf,
    whyMarketsCare: liveAnalysis.explanation?.whyMarketsCare || "",
    causalChain: liveAnalysis.explanation?.causalChain || [],
    whatHappened: liveAnalysis.explanation?.whatHappened || "",
    billUrl: shareBillPath(top.id)
  };
}

async function buildBillSharePayload(billIdRaw, req = null) {
  const billId = resolveBillIdCanonical(billIdRaw);
  if (!billId) {
    const err = new Error("unknown_bill_id");
    err.code = "unknown_bill_id";
    throw err;
  }
  const bill = await resolvePolicyBillAsync(billId);
  if (!bill) {
    const err = new Error("unknown_bill_id");
    err.code = "unknown_bill_id";
    err.userMessage = process.env.CONGRESS_API_KEY
      ? `Bill ${billId} was not found on Congress.gov. Check the bill number and congress session (e.g. H.R.7668-119).`
      : `Bill ${billId} is not in TradeSimple's curated set. Set CONGRESS_API_KEY on the server to load any Congress.gov bill, or pick a known bill from the dashboard.`;
    throw err;
  }
  let merged = decorateBill(mergeCongressLiveIntoBill(applyBillMarketExposure(bill)));
  merged = await enrichBillShareExposure(merged, req);
  const focusSymbol = (merged.affected || merged.portfolioTickers || [])[0] || "";
  const detail = enrichPolicyBill(merged, focusSymbol);
  const breakdown = computeBillMetricBreakdown(merged);
  const statusInfo = statusInfoForBill(merged);
  const canonicalId = merged.id;
  const live = Boolean(merged.exactCongressRecord || merged._dynamicCongressBill);
  const passImpacts = normalizeBillImpactRows(merged.passImpacts);
  const failImpacts = normalizeBillImpactRows(merged.failImpacts);
  const affected = (merged.affected || []).slice(0, 12);
  const relatedContracts = await buildRelatedContractsForBill(affected);
  const liveAnalysis = await buildLiveBillAnalysis({ ...merged, statusInfo }, req);
  const freshness = buildFreshnessBadge({
    type: "bill",
    bill: merged,
    relatedContracts,
    exposureSource: merged.exposureSource || null
  });
  const moneyContext = await buildBillMoneyContext(merged);
  return {
    billId: canonicalId,
    live: live || liveAnalysis.freshness === "live" || freshness.level === "verified",
    bill: { ...detail, exposureConfidence: merged.exposureConfidence || detail.exposureConfidence || null },
    statusInfo,
    breakdown,
    relatedTickers: affected,
    relatedContracts,
    passImpacts,
    failImpacts,
    exposureConfidence: merged.exposureConfidence || null,
    exposureSource: merged.exposureSource || null,
    sectors: merged.sectors || [],
    historicalAnalog: merged.historicalAnalog || null,
    legislativeContext: detail.legislativeContext || merged.legislativeContext || null,
    methodologyDisclaimer: merged.exposureMethodologyDisclaimer || METHODOLOGY.disclaimer,
    mapping: {
      traceUrls: Object.fromEntries(affected.map((ticker) => [ticker, shareStockPath(ticker)]))
    },
    liveAnalysis,
    freshness,
    moneyContext,
    whyMarketsCare: liveAnalysis.explanation?.whyMarketsCare || null,
    updatedAt: new Date().toISOString(),
    share: {
      canonicalPath: `/bill/${encodeURIComponent(canonicalId)}`,
      canonicalUrl: `${APP_URL}/bill/${encodeURIComponent(canonicalId)}`,
      title: merged.shortTitle || merged.title || canonicalId,
      disclaimer:
        "Legislative status from Congress.gov when linked. Scenario impact ranges are illustrative models, not investment advice."
    }
  };
}

async function shareBillSnapshot(req, res, url) {
  if (enforceShareRateLimit(req, res)) return;
  const billId = url.searchParams.get("billId") || url.searchParams.get("id") || "";
  try {
    const payload = await buildBillSharePayload(billId, req);
    const withAi = await attachShareBriefAiSummary(req, payload, "bill");
    sendJson(res, 200, { ...withAi, public: true });
  } catch (err) {
    const code = err.code === "unknown_bill_id" ? 404 : 502;
    sendJson(res, code, {
      error: err.code || "share_bill_unavailable",
      message: err.userMessage || err.message || "Could not load bill.",
      knownBillIds: err.code === "unknown_bill_id" ? knownSeedBillIds() : undefined,
      dashboardUrl: "/dashboard?view=bills",
      congressKeyRequired: err.code === "unknown_bill_id" ? !process.env.CONGRESS_API_KEY : undefined
    });
  }
}

function truncateOgDescription(text, max = 200) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function buildBillOgDescription(bill, moneyContext = null) {
  if (moneyContext?.matched && moneyContext.plainEnglish) {
    return truncateOgDescription(`${moneyContext.plainEnglish} Research context only.`);
  }
  if (!bill) return "Legislative status, lobbying, and scenario impacts. Research context only.";
  const why =
    bill.whyMarketsCare ||
    bill.plainEnglish ||
    bill.signal ||
    (bill.liveAnalysis?.explanation?.whyMarketsCare) ||
    "";
  if (why) {
    return truncateOgDescription(why);
  }
  const title = bill.shortTitle || bill.title || bill.id || "this bill";
  return truncateOgDescription(
    `Legislative status, lobbying, and scenario impacts for ${title}. Research context only.`
  );
}

function billOgHeadHtml({ title, description, canonicalUrl, ogImage }) {
  const safeTitle = escapeHtmlText(title);
  const safeDesc = escapeHtmlText(description);
  const safeUrl = escapeHtmlText(canonicalUrl);
  const safeImage = escapeHtmlText(ogImage);
  return `
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDesc}" />
    <link rel="canonical" href="${safeUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDesc}" />
    <meta property="og:url" content="${safeUrl}" />
    <meta property="og:image" content="${safeImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDesc}" />
    <meta name="twitter:image" content="${safeImage}" />`;
}

async function publicBillCard(req, res, pathname, { head = false } = {}) {
  const raw = decodeURIComponent(pathname.slice("/bill/".length).split(/[/?#]/)[0]);
  const canonical = resolveBillIdCanonical(raw);
  if (canonical && canonical !== raw && resolvePolicyBill(canonical)) {
    return redirect(res, `/bill/${encodeURIComponent(canonical)}`);
  }
  let bill = resolvePolicyBill(raw);
  const billId = bill?.id || canonical || raw;
  const validFormat = Boolean(parseBillIdToCongressRef(canonical || raw));
  if (!bill && validFormat && process.env.CONGRESS_API_KEY) {
    try {
      bill = await resolvePolicyBillAsync(canonical || raw);
    } catch {
      bill = null;
    }
  }
  const decorated = bill
    ? decorateBill(mergeCongressLiveIntoBill(applyBillMarketExposure(bill)))
    : null;
  let moneyContext = null;
  if (decorated) {
    try {
      moneyContext = await buildBillMoneyContext(decorated);
    } catch {
      moneyContext = null;
    }
  }
  const pageTitle = decorated
    ? `${decorated.shortTitle || decorated.title || billId} | TradeSimple`
    : validFormat
      ? `${canonical || raw} | TradeSimple bill brief`
      : `Bill not found | TradeSimple`;
  const description = buildBillOgDescription(decorated || bill, moneyContext);
  const canonicalUrl = `${APP_URL}/bill/${encodeURIComponent(decorated?.id || billId)}`;
  const ogImage = `${APP_URL}/media/og-image.png`;
  const html = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/favicon.png" />
    ${billOgHeadHtml({ title: pageTitle, description, canonicalUrl, ogImage })}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400;1,9..144,600&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/src/imports/design-tokens.css?v=cd-brief-1" />
    <link rel="stylesheet" href="/assets/stock-card.css?v=bill-intel-3" />
    <link rel="stylesheet" href="/assets/bill-card.css?v=bill-intel-3" />
  </head>
  <body data-bill-id="${escapeHtmlText(billId)}">
    <main id="bill-card-root" class="bill-card-root" aria-live="polite">
      <section class="stock-card-loading">
        <span class="mini-label">TradeSimple bill brief</span>
        <h1>${escapeHtmlText(bill?.displayId || billId)}</h1>
        <p>Loading bill details.</p>
      </section>
    </main>
    <script src="/assets/brief-shell.js?v=brief-shell-3" defer></script>
    <script src="/assets/bill-card.js?v=bill-intel-3" defer></script>
  </body>
</html>`;
  sendHtml(res, bill || validFormat ? 200 : 404, html, { head });
}

function knownFecClusterKeys(limit = 12) {
  return (fecCommitteeMap.clusters || []).slice(0, limit).map((c) => c.key);
}

async function buildFecSharePayload(clusterKey) {
  const key = String(clusterKey || "").trim();
  if (!key) {
    const err = new Error("Missing cluster key.");
    err.code = "missing_cluster_key";
    err.userMessage = "Provide a clusterKey query parameter.";
    throw err;
  }
  const cluster = (fecCommitteeMap.clusters || []).find((c) => c.key === key);
  if (!cluster) {
    const err = new Error("Unknown FEC cluster.");
    err.code = "unknown_cluster";
    err.userMessage = "FEC cluster not found.";
    throw err;
  }
  const payload = await getFecPulsePayload();
  const pulse =
    payload.pulses.find((p) => p.clusterKey === key) ||
    buildFecPulseWithLinks(
      { clusterKey: key, committee: cluster.committee, chamber: cluster.chamber, label: cluster.label },
      cluster
    );
  const enriched = buildFecPulseWithLinks(pulse, cluster);
  const canonicalUrl = `${APP_URL}/fec/${encodeURIComponent(key)}`;
  return {
    clusterKey: key,
    cluster: {
      key: cluster.key,
      label: cluster.label,
      committee: cluster.committee,
      chamber: cluster.chamber,
      policyTags: clusterPolicyTags(cluster),
      policyTag: cluster.policyTag || null
    },
    pulse: enriched,
    source: payload.source,
    cycle: payload.cycle,
    updatedAt: payload.updatedAt,
    share: {
      title: `${cluster.label || cluster.committee} | TradeSimple FEC brief`,
      canonicalUrl,
      disclaimer: "Campaign finance context only. Not investment advice."
    },
    methodologyDisclaimer: "Campaign finance context only. Not investment advice."
  };
}

async function shareFecSnapshot(req, res, url) {
  if (enforceShareRateLimit(req, res)) return;
  const clusterKey = url.searchParams.get("clusterKey") || url.searchParams.get("key") || "";
  try {
    const payload = await buildFecSharePayload(clusterKey);
    sendJson(res, 200, { ...payload, public: true });
  } catch (err) {
    const code = err.code === "unknown_cluster" || err.code === "missing_cluster_key" ? 404 : 502;
    sendJson(res, code, {
      error: err.code || "share_fec_unavailable",
      message: err.userMessage || err.message || "Could not load FEC filing.",
      knownClusterKeys: err.code === "unknown_cluster" ? knownFecClusterKeys() : undefined,
      dashboardUrl: "/dashboard?view=fec"
    });
  }
}

function buildFecOgDescription(payload) {
  const pulse = payload?.pulse || {};
  const cluster = payload?.cluster || {};
  const why = pulse.plainEnglish || `${cluster.label || cluster.committee || "FEC cluster"} campaign finance filing.`;
  return truncateOgDescription(`${why} Research context only.`);
}

async function publicFecCard(req, res, pathname, { head = false } = {}) {
  const raw = decodeURIComponent(pathname.slice("/fec/".length).split(/[/?#]/)[0]);
  const clusterKey = String(raw || "").trim();
  let payload = null;
  try {
    if (clusterKey) payload = await buildFecSharePayload(clusterKey);
  } catch {
    payload = null;
  }
  const cluster = payload?.cluster || (fecCommitteeMap.clusters || []).find((c) => c.key === clusterKey) || null;
  const pageTitle = cluster
    ? `${cluster.label || cluster.committee || clusterKey} | TradeSimple FEC brief`
    : clusterKey
      ? `${clusterKey} | TradeSimple FEC brief`
      : `FEC brief not found | TradeSimple`;
  const description = payload ? buildFecOgDescription(payload) : "FEC campaign finance filing linked to bills, lobbying, contracts, and tickers.";
  const canonicalUrl = `${APP_URL}/fec/${encodeURIComponent(cluster?.key || clusterKey)}`;
  const ogImage = `${APP_URL}/media/og-image.png`;
  const html = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/favicon.png" />
    ${billOgHeadHtml({ title: pageTitle, description, canonicalUrl, ogImage })}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400;1,9..144,600&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/src/imports/design-tokens.css?v=cd-brief-1" />
    <link rel="stylesheet" href="/assets/stock-card.css?v=fec-intel-1" />
    <link rel="stylesheet" href="/assets/bill-card.css?v=fec-intel-1" />
  </head>
  <body data-fec-cluster-key="${escapeHtmlText(clusterKey)}">
    <main id="fec-card-root" class="bill-card-root" aria-live="polite">
      <section class="stock-card-loading">
        <span class="mini-label">TradeSimple FEC brief</span>
        <h1>${escapeHtmlText(cluster?.label || clusterKey || "FEC filing")}</h1>
        <p>Loading filing details.</p>
      </section>
    </main>
    <script src="/assets/brief-shell.js?v=brief-shell-3" defer></script>
    <script src="/assets/fec-card.js?v=fec-intel-1" defer></script>
  </body>
</html>`;
  sendHtml(res, payload || cluster ? 200 : 404, html, { head });
}

function contractCausalitySnapshot(symbol) {
  const sym = String(symbol || "").toUpperCase().trim();
  const profile = CONTRACT_PROFILES[sym] || null;
  const depScore = computeGovernmentDependencyScore(sym);
  const relatedBills = POLICY_BILLS.filter((b) => (b.affected || []).includes(sym));
  const govPct = profile ? Math.round(profile.governmentRevenuePct * 100) : null;
  const renewalPct = profile ? Math.round(profile.renewalRisk * 100) : null;
  const budgetNum = profile
    ? profile.agencyBudgetRisk === "high"
      ? 80
      : profile.agencyBudgetRisk === "medium"
        ? 55
        : 25
    : null;
  const primaryAgency = profile?.primaryAgencies?.[0] || "Federal agencies";
  const agSig = agencySignalScore(primaryAgency);
  const bars = profile
    ? [
        { label: `${primaryAgency.split(" ").slice(-1)[0]} exposure`, value: govPct, display: `${govPct}%` },
        { label: "Renewal risk", value: renewalPct, display: String(renewalPct) },
        { label: "Award novelty", value: 100 - agSig, display: String(100 - agSig) },
        { label: "Budget risk", value: budgetNum, display: profile.agencyBudgetRisk }
      ]
    : [];
  const evidence = [
    { source: "USASpending", title: "What was awarded?", detail: "Federal award amount, agency, recipient, date, and program fields." },
    { source: "SAM.gov", title: "Was it expected?", detail: "Solicitations, sources-sought notices, deadlines, and incumbent context." },
    { source: "Congress.gov", title: "What funds it?", detail: "Appropriations bills, authorization, committee actions, and latest status." },
    {
      source: "10-K / SEC",
      title: "Does revenue depend on it?",
      detail: govPct
        ? `~${govPct}% government revenue${profile?.archetype ? ` (${profile.archetype})` : ""}.`
        : "Check 10-K for government revenue concentration."
    },
    { source: "LDA / lobbying", title: "Who is pushing?", detail: "Lobbying spend and bill-aligned activity around agency budgets." }
  ];
  if (!profile) {
    return {
      symbol: sym,
      archetype: null,
      dogeRisk: false,
      scores: { dependency: depScore, changeRisk: 50, confidence: "Low" },
      plainEnglish: `${sym} is not in TradeSimple's government-contractor database. ${relatedBills.length ? `${relatedBills.length} mapped bill(s) may create indirect exposure.` : "No direct policy exposure is currently mapped."}`,
      archetypeExplain: "",
      nodes: [],
      bars: [],
      scenarios: [],
      translation: [],
      evidence,
      aiGenerated: false,
      billCount: relatedBills.length,
      relatedBills: resolveRelatedBillsForContract(sym)
    };
  }
  const isNarrative = profile.archetype === "Narrative-Sensitive Contractor";
  const primaryProgram = profile.primaryPrograms?.[0] || "Government programs";
  const changeRisk = Math.round(0.5 * renewalPct + 0.3 * budgetNum + 0.2 * (profile.dogeRisk ? 70 : 20));
  return {
    symbol: sym,
    archetype: profile.archetype,
    dogeRisk: profile.dogeRisk,
    scores: { dependency: depScore, changeRisk, confidence: depScore > 70 ? "Medium-high" : "Medium" },
    plainEnglish: profile.note,
    archetypeExplain: profile.archetypeExplain,
    nodes: [
      { step: "1 · Budget source", title: `${primaryAgency} appropriations set the funding pool`, detail: `If Congress expands or cuts this account, ${sym}'s opportunity set changes directly.`, source: "Congress.gov" },
      { step: "2 · Agency buyer", title: `${primaryAgency} is the primary demand center`, detail: agSig >= 70 ? "Civilian agencies can surprise more than routine DoD awards." : "DoD awards are often expected months ahead.", source: "USASpending" },
      { step: "3 · Procurement signal", title: "Solicitation history sets the surprise bar", detail: agSig <= 40 ? "Large defense awards are often pre-announced." : "Awards from this agency can carry more informational value.", source: "SAM.gov" },
      { step: "4 · Company exposure", title: `${govPct}% of ${sym} revenue is government-linked`, detail: `${profile.archetype}. Budget decisions map to earnings.`, source: "10-K filing" },
      { step: "5 · Market mechanism", title: isNarrative ? "Investors price adoption curve" : "Investors price durability and renewal risk", detail: isNarrative ? "Contract awards validate platform adoption beyond revenue alone." : "Renewal risk and program durability drive scenario modeling.", source: "Model logic" },
      { step: "6 · Watch next", title: `Track ${primaryProgram} and recompete timing`, detail: profile.bull, source: "Alert rule" }
    ],
    bars,
    scenarios: [
      { name: "Upside", change: profile.bull, read: isNarrative ? "Supports adoption narrative." : "Confirms revenue durability.", cls: "positive" },
      { name: "Base", change: "Funding stays stable and contract flow continues.", read: "Confirms business quality more than a new surprise.", cls: "warning" },
      { name: "Downside", change: profile.bear, read: "Raises renewal risk and can pressure forward revenue assumptions.", cls: "negative" }
    ],
    translation: [
      { step: "A", title: "What happened?", body: `A contract award or budget signal appeared for ${sym} in public government data.` },
      { step: "B", title: "Why does it matter?", body: `${govPct}% of ${sym} revenue runs through government agencies.` },
      { step: "C", title: "What could change?", body: "Future sales, renewal odds, margin durability, or investor confidence." },
      { step: "D", title: "What to watch?", body: profile.dogeRisk ? "Agency efficiency reviews, budget markups, and recompete schedules." : `NDAA markup, ${primaryAgency} appropriations, and SAM.gov solicitations for ${primaryProgram}.` }
    ],
    evidence,
    aiGenerated: false,
    billCount: relatedBills.length,
    relatedBills: resolveRelatedBillsForContract(sym),
    profile: {
      governmentRevenuePct: profile.governmentRevenuePct,
      renewalRisk: profile.renewalRisk,
      primaryAgencies: profile.primaryAgencies,
      primaryPrograms: profile.primaryPrograms,
      archetype: profile.archetype
    }
  };
}

function resolveContractCompanyName(symbol) {
  return (
    CONTRACT_COMPANY_NAMES[symbol] ||
    CONTRACT_SEARCH_HINTS[symbol] ||
    FUNDAMENTALS[symbol]?.name ||
    symbol
  );
}

function findRelatedBillsForSymbol(symbol) {
  const sym = String(symbol || "").toUpperCase();
  const fundamentals = FUNDAMENTALS[sym] || { name: sym, sector: "" };
  const byId = new Map();
  for (const bill of allBrowsablePolicyBills()) {
    if (billMatchesStockByInference(bill, sym) || billMatchesStockBySectorKeyword(bill, fundamentals)) {
      byId.set(bill.id, bill);
    }
  }
  const profile = CONTRACT_PROFILES[sym];
  for (const billId of profile?.linkedBillIds || []) {
    const bill = resolvePolicyBill(billId) || liveCongressBillRegistry.get(billId);
    if (bill) byId.set(bill.id, bill);
  }
  return [...byId.values()]
    .sort((a, b) => Number(computeLegislativeMomentum(b) || 0) - Number(computeLegislativeMomentum(a) || 0))
    .slice(0, 8);
}

function resolveRelatedBillsForSymbol(symbol) {
  const sym = String(symbol || "").toUpperCase();
  return resolveRelatedBillsForStock(sym, FUNDAMENTALS[sym] || { name: sym, sector: "" });
}

function shareBillPath(billId) {
  return `/bill/${encodeURIComponent(billId)}`;
}

function shareStockPath(symbol) {
  return `/stock/${encodeURIComponent(String(symbol || "").toUpperCase())}`;
}

function shareContractPath(symbol) {
  return `/contract/${encodeURIComponent(String(symbol || "").toUpperCase())}`;
}

function shareLobbyPath(filingId) {
  return `/lobby/${encodeURIComponent(filingId)}`;
}

function formatRelatedBillRef(bill) {
  const merged = decorateBill(mergeCongressLiveIntoBill(bill));
  const metrics = augmentBillMetrics(merged);
  return {
    id: bill.id,
    title: bill.shortTitle || bill.title || bill.id,
    displayId: bill.displayId || bill.id,
    momentum: metrics.legislativeMomentum ?? bill.legislativeMomentum ?? null,
    latestAction: bill.latestAction || merged.latestAction || null,
    url: shareBillPath(bill.id)
  };
}

function billMatchesStockByInference(bill, symbol) {
  const sym = String(symbol || "").toUpperCase();
  if ((bill.affected || []).includes(sym)) return true;
  const merged = applyBillMarketExposure(bill);
  return (merged.affected || []).includes(sym);
}

function billMatchesStockBySectorKeyword(bill, fundamentals) {
  const corpus = billExposureCorpus(bill).toLowerCase();
  const sector = String(fundamentals?.sector || "").toLowerCase();
  const sectorWords = sector.split(/[\s/,&]+/).filter((word) => word.length > 3);
  if (sectorWords.some((word) => corpus.includes(word))) return true;
  const nameTokens = normalizeLobbyEntityName(fundamentals?.name || "")
    .split(" ")
    .filter((token) => token.length > 3);
  return nameTokens.some((token) => corpus.includes(token));
}

function resolveRelatedBillsForStock(symbol, fundamentals) {
  const sym = String(symbol || "").toUpperCase();
  const byId = new Map();
  for (const bill of allBrowsablePolicyBills()) {
    if (billMatchesStockByInference(bill, sym) || billMatchesStockBySectorKeyword(bill, fundamentals)) {
      byId.set(bill.id, bill);
    }
  }
  const profile = CONTRACT_PROFILES[sym];
  for (const billId of profile?.linkedBillIds || []) {
    const bill = resolvePolicyBill(billId) || liveCongressBillRegistry.get(billId);
    if (bill) byId.set(bill.id, bill);
  }
  return [...byId.values()]
    .sort((a, b) => Number(computeLegislativeMomentum(b) || 0) - Number(computeLegislativeMomentum(a) || 0))
    .slice(0, 5)
    .map(formatRelatedBillRef);
}

function buildContractProfileSummary(symbol, profile, awardHint = null) {
  if (profile) {
    return {
      symbol,
      governmentRevenuePct: profile.governmentRevenuePct,
      awardCount: awardHint?.awardCount ?? null,
      topAgency: profile.primaryAgencies?.[0] || null
    };
  }
  if (awardHint?.awardCount) {
    return {
      symbol,
      governmentRevenuePct: null,
      awardCount: awardHint.awardCount,
      topAgency: awardHint.topAgency || null
    };
  }
  return null;
}

function resolveLobbyFilingsForStock(symbol) {
  const sym = String(symbol || "").toUpperCase();
  const pool = getLobbyFilingsPool();
  const matches = [];
  const seen = new Set();
  const companyNorm = normalizeLobbyEntityName(FUNDAMENTALS[sym]?.name || "");
  for (const filing of pool) {
    const tickers = lobbyTickersForClient(filing.client);
    const clientNorm = normalizeLobbyEntityName(filing.client);
    const nameMatch = companyNorm && clientNorm.includes(companyNorm.split(" ")[0]);
    if (!tickers.includes(sym) && !nameMatch) continue;
    const id = filing.filingId || lobbyingFilingId(filing);
    if (seen.has(id)) continue;
    seen.add(id);
    matches.push(filing);
  }
  return matches
    .sort((a, b) => {
      const amt = Number(b.amount || 0) - Number(a.amount || 0);
      if (amt !== 0) return amt;
      return String(b.postedAt || "").localeCompare(String(a.postedAt || ""));
    })
    .slice(0, 3)
    .map((f) => ({
      filingId: f.filingId,
      client: f.client,
      amount: f.amount,
      issue: f.issue,
      url: shareLobbyPath(f.filingId)
    }));
}

function inferStockSectorTags(symbol, fundamentals, relatedBills) {
  const tags = new Set();
  for (const billRef of relatedBills) {
    const raw = POLICY_BILLS.find((row) => row.id === billRef.id);
    (raw?.tags || raw?.sectors || []).forEach((tag) => tags.add(String(tag).toLowerCase()));
  }
  const sector = String(fundamentals?.sector || "").toLowerCase();
  if (/semiconductor|chip|tech|software|ai/.test(sector)) tags.add("tech");
  if (/defense|aerospace|security/.test(sector) || CONTRACT_PROFILES[symbol]) tags.add("defense");
  if (/health|pharma|biotech/.test(sector)) tags.add("health");
  if (/energy|utility|oil|gas/.test(sector)) tags.add("energy");
  if (/financial|bank|insurance/.test(sector)) tags.add("financial");
  return [...tags].slice(0, 5);
}

function computeStockExposureConfidence(symbol, relatedBills, contractProfile, lobbyingFilings) {
  const sym = String(symbol || "").toUpperCase();
  const directBill = relatedBills.some((billRef) => {
    const raw = POLICY_BILLS.find((row) => row.id === billRef.id);
    return (raw?.affected || []).includes(sym);
  });
  if (directBill && contractProfile) return "high";
  if (directBill || contractProfile) return "medium";
  if (relatedBills.length || lobbyingFilings.length) return "low";
  return "low";
}

function buildStockPolicyExposureDrivers(symbol, relatedBills, contractProfile, fundamentals) {
  const drivers = [];
  if (contractProfile?.governmentRevenuePct != null) {
    drivers.push(`~${Math.round(contractProfile.governmentRevenuePct * 100)}% government revenue concentration`);
  }
  relatedBills.slice(0, 3).forEach((bill) => {
    drivers.push(`${bill.displayId || bill.id}: ${String(bill.title || "").slice(0, 72)}`);
  });
  if (!drivers.length && fundamentals?.sector) drivers.push(`${fundamentals.sector} sector policy sensitivity`);
  return drivers.slice(0, 4);
}

function buildStockTraceUrls(symbol, relatedBills, contractProfile) {
  const urls = { stock: shareStockPath(symbol) };
  if (contractProfile) urls.contract = shareContractPath(symbol);
  if (relatedBills[0]?.id) urls.topBill = shareBillPath(relatedBills[0].id);
  return urls;
}

function buildStockShareAnalysisRules(symbol, fundamentals, payload, mapping) {
  const relatedBills = mapping?.relatedBills || [];
  const contractProfile = mapping?.contractProfile;
  const lobbyingFilings = mapping?.lobbyingFilings || [];
  const companyName = fundamentals?.name || symbol;
  const topBill = relatedBills[0];
  let plainEnglish = "";
  if (relatedBills.length && contractProfile) {
    plainEnglish = `${companyName} (${symbol}) sits at the intersection of ${relatedBills.length} mapped bill${relatedBills.length === 1 ? "" : "s"} and federal contract exposure${
      contractProfile.governmentRevenuePct != null
        ? ` (~${Math.round(contractProfile.governmentRevenuePct * 100)}% of revenue)`
        : ""
    }. Legislative momentum on ${topBill?.displayId || topBill?.id || "key bills"} can move contract visibility and investor expectations.`;
  } else if (relatedBills.length) {
    plainEnglish = `${companyName} is linked to ${relatedBills.length} active bill${relatedBills.length === 1 ? "" : "s"} in TradeSimple's policy graph${
      topBill ? `, led by ${topBill.displayId || topBill.id}` : ""
    }. Changes in committee action or floor timing can affect the addressable market and compliance costs.`;
  } else if (contractProfile) {
    plainEnglish = `${companyName} is profiled as a government contractor${
      contractProfile.governmentRevenuePct != null
        ? ` with ~${Math.round(contractProfile.governmentRevenuePct * 100)}% revenue from federal awards`
        : ""
    }. Budget and recompete cycles are the primary policy mechanism to watch.`;
  } else if (lobbyingFilings.length) {
    plainEnglish = `${companyName} shows ${lobbyingFilings.length} recent lobbying filing${lobbyingFilings.length === 1 ? "" : "s"} tied to this symbol. Filings signal legislative pressure but are not standalone buy or sell signals.`;
  } else {
    plainEnglish = `${companyName} (${symbol}) has limited high-confidence policy mapping in TradeSimple's curated graph. Monitor sector headlines and new filings for emerging links.`;
  }

  const whatChangedItems = Array.isArray(payload?.whatChanged?.items) ? payload.whatChanged.items : [];
  const quote = payload?.quote || {};
  const quoteLine = quote.price
    ? `Quote ${quote.price}${quote.pct != null || quote.changePercent != null ? ` (${Number(quote.pct ?? quote.changePercent) >= 0 ? "+" : ""}${Number(quote.pct ?? quote.changePercent).toFixed(2)}%)` : ""}`
    : null;
  const headlineItem = payload?.recentNews?.[0]?.headline || payload?.evidence?.recentNews?.[0]?.headline;
  const whatChanged = [whatChangedItems.slice(0, 2).map((item) => item.detail || item.label).join(" "), quoteLine, headlineItem ? `Headline: ${headlineItem}` : null]
    .filter(Boolean)
    .join(" · ") || null;

  const whatToWatch = [];
  relatedBills.slice(0, 3).forEach((bill) => {
    whatToWatch.push(`${bill.displayId || bill.id}: ${String(bill.latestAction || bill.title || "").slice(0, 100)}`);
  });
  if (contractProfile?.topAgency) {
    whatToWatch.push(`${contractProfile.topAgency} budget and renewal decisions affecting ${symbol}`);
  }
  const profileRow = CONTRACT_PROFILES[symbol];
  if (profileRow?.renewalRisk != null && profileRow.renewalRisk > 0.5) {
    whatToWatch.push("Contract recompete and renewal risk flagged in TradeSimple model");
  }
  lobbyingFilings.slice(0, 2).forEach((filing) => {
    whatToWatch.push(`Lobbying: ${filing.client} on ${String(filing.issue || "mapped issues").slice(0, 80)}`);
  });
  if (!whatToWatch.length) whatToWatch.push("New bill filings, rule text, contracts, and company earnings commentary");

  return {
    plainEnglish,
    whatChanged,
    whatToWatch: whatToWatch.slice(0, 5)
  };
}

function buildStockOgPreview(symbol) {
  const sym = normalizeStockSymbol(symbol);
  const fundamentals = FUNDAMENTALS[sym] || { name: sym, sector: "Tracked equity" };
  const relatedBills = resolveRelatedBillsForStock(sym, fundamentals);
  const contractProfileSummary = buildContractProfileSummary(sym, CONTRACT_PROFILES[sym], null);
  const mapping = {
    relatedBills,
    contractProfile: contractProfileSummary,
    lobbyingFilings: []
  };
  const analysis = buildStockShareAnalysisRules(sym, fundamentals, {}, mapping);
  return analysis.plainEnglish || `${sym}: government signal and policy exposure context. Not investment advice.`;
}

async function enrichStockSharePayload(payload, symbol, fundamentals, contractProfile, req = null) {
  const relatedBills = resolveRelatedBillsForStock(symbol, fundamentals);
  const contractProfileSummary = buildContractProfileSummary(symbol, contractProfile, null);
  try {
    await resolveLobbyFilingsForShare();
  } catch {
    /* lobby pool optional */
  }
  const lobbyingFilings = resolveLobbyFilingsForStock(symbol);
  const exposureConfidence = computeStockExposureConfidence(symbol, relatedBills, contractProfileSummary, lobbyingFilings);
  const policyScore = relatedBills.reduce((max, bill) => Math.max(max, Number(bill.momentum || 0)), 0);
  const mapping = {
    exposureConfidence,
    policyExposure: {
      score: policyScore,
      drivers: buildStockPolicyExposureDrivers(symbol, relatedBills, contractProfileSummary, fundamentals)
    },
    relatedBills,
    contractProfile: contractProfileSummary,
    lobbyingFilings,
    sectorTags: inferStockSectorTags(symbol, fundamentals, relatedBills),
    traceUrls: buildStockTraceUrls(symbol, relatedBills, contractProfileSummary)
  };
  let analysis = buildStockShareAnalysisRules(symbol, fundamentals, payload, mapping);
  const thinMapping = relatedBills.length === 0 && !contractProfileSummary;
  if (thinMapping && process.env.ANTHROPIC_API_KEY) {
    try {
      const aiSummary = await runShareBriefSummary({
        kind: "stock",
        payload: { ...payload, mapping, analysis },
        rateLimitKey: req ? clientIp(req) : "anon",
        checkRateLimit: checkBriefAiRateLimit
      });
      if (aiSummary?.text) analysis = { ...analysis, plainEnglish: aiSummary.text, aiGenerated: true };
    } catch (err) {
      console.warn("[ai] stock share analysis skipped:", err.message);
    }
  }
  const policyPulse = await resolveStockPolicyPulse(symbol, fundamentals, req);
  return { ...payload, mapping, analysis, policyPulse };
}

function resolveRelatedBillsForContract(symbol) {
  const sym = String(symbol || "").toUpperCase().trim();
  const profile = CONTRACT_PROFILES[sym] || null;
  const fundamentals = FUNDAMENTALS[sym] || { name: sym, sector: "" };
  const byId = new Map();
  for (const bill of allBrowsablePolicyBills()) {
    if ((bill.affected || []).includes(sym) || billMatchesStockByInference(bill, sym) || billMatchesStockBySectorKeyword(bill, fundamentals)) {
      byId.set(bill.id, bill);
    }
  }
  for (const billId of profile?.linkedBillIds || []) {
    const bill = resolvePolicyBill(billId) || liveCongressBillRegistry.get(billId);
    if (bill) byId.set(bill.id, bill);
  }
  return [...byId.values()]
    .sort((a, b) => Number(computeLegislativeMomentum(b) || 0) - Number(computeLegislativeMomentum(a) || 0))
    .slice(0, 6)
    .map(formatRelatedBillRef);
}

function normalizeLobbyEntityName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(inc|corp|corporation|company|llc|ltd|global|group)\b/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lobbyNameTokens(name) {
  return normalizeLobbyEntityName(name)
    .split(" ")
    .filter((token) => token.length > 2);
}

function lobbyNamesOverlap(rowName, filing) {
  const rowNorm = normalizeLobbyEntityName(rowName);
  const clientNorm = normalizeLobbyEntityName(filing.client);
  const registrantNorm = normalizeLobbyEntityName(filing.registrant);
  if (!rowNorm) return false;
  if (clientNorm && (clientNorm.includes(rowNorm) || rowNorm.includes(clientNorm))) return true;
  if (registrantNorm && (registrantNorm.includes(rowNorm) || rowNorm.includes(registrantNorm))) return true;
  const rowTokens = lobbyNameTokens(rowName);
  const poolTokens = new Set([
    ...lobbyNameTokens(filing.client),
    ...lobbyNameTokens(filing.registrant)
  ]);
  let hits = 0;
  for (const token of rowTokens) if (poolTokens.has(token)) hits += 1;
  return rowTokens.length <= 2 ? hits >= 1 : hits >= 2;
}

function lobbyIssueOverlap(rowIssue, filingIssue) {
  const a = String(rowIssue || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim();
  const b = String(filingIssue || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim();
  if (!a || !b) return false;
  const tokens = a.split(" ").filter((token) => token.length > 3);
  let hits = 0;
  for (const token of tokens) if (b.includes(token)) hits += 1;
  return hits >= 1;
}

const LOBBYING_FALLBACK_POSTED_AT = "2026-01-01";

function decorateLobbyFallbackRow(row) {
  return decorateLobbyingFiling({
    ...row,
    postedAt: row.postedAt || LOBBYING_FALLBACK_POSTED_AT,
    source: row.source || "fallback"
  });
}

function getLobbyFilingsPool() {
  const fallback = LOBBYING_FALLBACK.map(decorateLobbyFallbackRow);
  if (!cachedLobbyFilingsForShare.length) return fallback;
  const seen = new Set();
  const merged = [];
  for (const filing of [...cachedLobbyFilingsForShare, ...fallback]) {
    const key = filing.filingId || lobbyingFilingId(filing);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...filing, filingId: key });
  }
  return merged;
}

function matchLobbyRowToFiling(row, filingsPool) {
  let best = null;
  let bestScore = 0;
  for (const filing of filingsPool) {
    if (!lobbyNamesOverlap(row.name, filing)) continue;
    let score = 2;
    if (lobbyIssueOverlap(row.issue, filing.issue)) score += 2;
    if (Number(row.amount || 0) > 0 && Number(filing.amount || 0) > 0) {
      const ratio = Math.min(Number(row.amount), Number(filing.amount)) / Math.max(Number(row.amount), Number(filing.amount));
      if (ratio >= 0.5) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = filing;
    }
  }
  return best;
}

function attachLobbyFilingIds(rows) {
  const pool = getLobbyFilingsPool();
  return (rows || []).map((row) => {
    if (row.filingId) return row;
    const filing = matchLobbyRowToFiling(row, pool);
    return filing?.filingId ? { ...row, filingId: filing.filingId } : row;
  });
}

function computeGenericContractEventSignal(symbol, awardAmount, agencyName) {
  const agSig = agencySignalScore(agencyName);
  const novelty = awardNoveltyScore(awardAmount);
  const score = Math.round(Math.min(100, Math.max(0, 0.45 * agSig + 0.55 * novelty)));
  const label = score >= 75 ? "High signal" : score >= 45 ? "Monitor" : score >= 15 ? "Watch" : "Low signal";
  const agSigLabel =
    agSig >= 70 ? "less analyst coverage — higher surprise value"
    : agSig >= 50 ? "moderate analyst coverage"
    : "heavily covered — often pre-priced";
  return {
    score,
    label,
    pricedInAssessment: novelty < 30 && agSig < 50 ? "Likely already priced in" : "Mixed — depends on timing",
    plainEnglish: `Live USASpending award for ${symbol} from ${agencyName || "a federal agency"}. ${agSigLabel}. Full CRS calibration applies to profiled defense IT contractors (LMT, BAH, LDOS, SAIC, PLTR).`,
    components: { dep: null, agSig, novelty, renewal: null },
    agSigLabel,
    noveltyLabel: novelty >= 70 ? "smaller award — higher surprise value" : "award size context from USASpending",
    watchNext: ["Follow-on task orders", "Agency budget request", "Company earnings commentary on government pipeline"],
    archetype: "Live USASpending recipient",
    archetypeExplain: "TradeSimple loaded this brief from USASpending.gov without a curated contractor profile.",
    confidence: "Low — generic scoring without company revenue mix calibration.",
    dataNote: "Not investment advice. DoD awards may lag USASpending by up to 90 days."
  };
}

function buildGenericGovernmentMoneyTrail(symbol, companyName, awardAmount, agencyName, programName) {
  const sig = computeGenericContractEventSignal(symbol, awardAmount, agencyName);
  return {
    headline: `${symbol}: Federal contract award from ${agencyName || "U.S. government"}`,
    simpleSummary: sig.plainEnglish,
    chain: [
      { label: "Government event", value: `Contract award to ${companyName}`, explanation: "Public USASpending.gov data." },
      { label: "Agency", value: agencyName || "Federal agency", explanation: sig.agSigLabel },
      { label: "Program", value: programName || "Contract vehicle", explanation: sig.noveltyLabel },
      { label: "Market read", value: sig.label, explanation: sig.pricedInAssessment }
    ],
    limitations: ["Generic profile — no curated government-revenue percentage.", "Not investment advice."]
  };
}

function enhanceGenericContractCausality(causality, symbol, company, awards) {
  const agencies = [...new Set(awards.map((a) => a.awardingAgency).filter(Boolean))].slice(0, 4);
  const total = awards.reduce((sum, row) => sum + Number(row.obligatedAmount || 0), 0);
  const related = findRelatedBillsForSymbol(symbol);
  causality.plainEnglish = `${company} (${symbol}) has ${awards.length} recent federal award(s) on USASpending totaling ${compactMoney(total)}. ${agencies.length ? `Top agencies: ${agencies.join(", ")}.` : ""} ${related.length ? `${related.length} mapped bill(s) may affect this name.` : "No mapped bills yet — check appropriations for primary agencies."}`;
  causality.relatedBills = resolveRelatedBillsForContract(symbol);
  causality.billCount = related.length;
  causality.scores = { dependency: null, changeRisk: 50, confidence: "Low" };
  if (agencies.length) {
    causality.nodes = [
      { step: "1 · Live awards", title: `${awards.length} USASpending row(s) loaded`, detail: `Total obligated ~${compactMoney(total)} in this pull.`, source: "USASpending" },
      { step: "2 · Agencies", title: agencies[0], detail: agencies.slice(1).join(" · ") || "Single-agency exposure in this sample.", source: "USASpending" },
      { step: "3 · Policy link", title: related.length ? `${related.length} related bill(s) mapped` : "No mapped bills", detail: related.length ? "See related bills section for legislative context." : "Heuristic bill mapping not available for this ticker.", source: "TradeSimple" }
    ];
  }
  return causality;
}

function compactMoney(value) {
  const n = Number(value || 0);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

async function buildContractSharePayload(symbolRaw) {
  const symbol = String(symbolRaw || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (!symbol) {
    const err = new Error("missing_symbol");
    err.code = "missing_symbol";
    throw err;
  }
  const profile = CONTRACT_PROFILES[symbol] || null;
  const ctx = await resolveContractUsaspendingContext(symbol);
  const company = ctx.company;
  const rawResults = ctx.awards;
  if (!rawResults?.length) {
    const err = new Error("no_usaspending_awards");
    err.code = profile ? "usaspending_unavailable" : "no_usaspending_awards";
    err.userMessage = profile
      ? `USASpending.gov returned no recent awards for ${company}. The federal API may be down or the company name did not resolve.`
      : `No federal contract awards found for ${company} (${symbol}) on USASpending.gov. Try a profiled ticker (LMT, PLTR) or verify the company receives federal contracts.`;
    throw err;
  }
  const awards = rawResults.map((row) => {
    const eventSignal = profile
      ? computeContractEventSignal(symbol, row.obligatedAmount, row.awardingAgency)
      : computeGenericContractEventSignal(symbol, row.obligatedAmount, row.awardingAgency);
    const moneyTrail = profile
      ? buildGovernmentMoneyTrail(symbol, row.obligatedAmount, row.awardingAgency, row.description)
      : buildGenericGovernmentMoneyTrail(symbol, company, row.obligatedAmount, row.awardingAgency, row.description);
    return { ...row, eventSignal, moneyTrail };
  });
  let causality = contractCausalitySnapshot(symbol);
  if (!profile) causality = enhanceGenericContractCausality(causality, symbol, company, awards);
  const relatedBills = causality.relatedBills || resolveRelatedBillsForContract(symbol);
  const topAward = awards.reduce(
    (best, row) => (Number(row.obligatedAmount || 0) > Number(best?.obligatedAmount || 0) ? row : best),
    awards[0]
  );
  const totalObligated = awards.reduce((sum, row) => sum + Number(row.obligatedAmount || 0), 0);
  const analysisPlain = profile
    ? `${company} is modeled as a ${profile.archetype || "government contractor"} with ~${Math.round(profile.governmentRevenuePct * 100)}% federal revenue exposure. Top recent award: ${compactMoney(topAward?.obligatedAmount || 0)} from ${topAward?.awardingAgency || "a federal agency"}.`
    : `${company} (${symbol}) has ${awards.length} USASpending award row(s) totaling ~${compactMoney(totalObligated)}.${relatedBills.length ? ` ${relatedBills.length} related bill(s) map to this symbol.` : " No mapped bills yet."}`;
  return {
    symbol,
    company,
    relatedBills,
    profiled: Boolean(profile),
    recipientId: ctx.recipientId || awards.find((row) => row.recipientId)?.recipientId || null,
    recipientName: ctx.recipientName || awards.find((row) => row.recipientName)?.recipientName || company,
    usaspendingResolvedVia: ctx.resolvedVia || "company_search",
    awards,
    awardCount: awards.length,
    totalObligated,
    causality,
    mapping: {
      relatedStocks: [{ symbol, name: company }],
      traceUrls: { stock: shareStockPath(symbol), contract: shareContractPath(symbol) }
    },
    analysis: { plainEnglish: analysisPlain },
    source: "usaspending.gov",
    updatedAt: new Date().toISOString(),
    freshness: buildFreshnessBadge({
      type: "contract",
      awards,
      relatedBills,
      updatedAt: new Date().toISOString(),
      source: "usaspending.gov"
    }),
    share: {
      canonicalPath: `/contract/${encodeURIComponent(symbol)}`,
      canonicalUrl: `${APP_URL}/contract/${encodeURIComponent(symbol)}`,
      title: `${company} federal contracts`,
      disclaimer: "Award data from USASpending.gov when available. Scenario text is research context, not investment advice."
    }
  };
}

async function shareContractSnapshot(req, res, url) {
  if (enforceShareRateLimit(req, res)) return;
  const symbol = String(url.searchParams.get("symbol") || url.searchParams.get("id") || "")
    .toUpperCase()
    .trim();
  try {
    const payload = await buildContractSharePayload(symbol);
    const withAi = await attachShareBriefAiSummary(req, payload, "contract");
    sendJson(res, 200, { ...withAi, public: true });
  } catch (err) {
    const code =
      err.code === "missing_symbol" || err.code === "no_usaspending_awards" || err.code === "usaspending_unavailable"
        ? 404
        : 502;
    sendJson(res, code, {
      error: err.code || "share_contract_unavailable",
      message: err.userMessage || err.message || "Could not load contract brief.",
      profiledSymbols: Object.keys(CONTRACT_PROFILES),
      dashboardUrl: "/dashboard?view=contracts"
    });
  }
}

function publicContractCard(res, pathname, { head = false } = {}) {
  const raw = decodeURIComponent(pathname.slice("/contract/".length).split(/[/?#]/)[0]);
  const symbol = String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const validSymbol = symbol.length >= 1 && symbol.length <= 6;
  const company = resolveContractCompanyName(symbol);
  const profile = CONTRACT_PROFILES[symbol] || null;
  const title = validSymbol ? `${company} (${symbol}) contracts | TradeSimple` : `Contract brief | TradeSimple`;
  const description = validSymbol
    ? profile
      ? `Federal contract exposure, USASpending awards, and policy causality for ${company}.`
      : `Live USASpending federal contract awards for ${company}. Research context only.`
    : "Invalid contract symbol.";
  const html = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/favicon.png" />
    <title>${escapeHtmlText(title)}</title>
    <meta name="description" content="${escapeHtmlText(description)}" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400;1,9..144,600&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/src/imports/design-tokens.css?v=cd-brief-1" />
    <link rel="stylesheet" href="/assets/stock-card.css?v=contract-dossier-2" />
    <link rel="stylesheet" href="/assets/detail-pages.css?v=contract-dossier-2" />
    <link rel="stylesheet" href="/assets/bill-card.css?v=contract-dossier-2" />
    <link rel="stylesheet" href="/assets/contract-card.css?v=contract-dossier-2" />
  </head>
  <body data-contract-symbol="${escapeHtmlText(symbol)}">
    <main id="contract-card-root" class="bill-card-root" aria-live="polite">
      <section class="stock-card-loading"><h1>${escapeHtmlText(symbol || "Contract")}</h1><p>Loading contract brief…</p></section>
    </main>
    <script src="/assets/brief-shell.js?v=brief-shell-2" defer></script>
    <script src="/assets/contract-card.js?v=contract-dossier-2" defer></script>
  </body>
</html>`;
  sendHtml(res, validSymbol ? 200 : 404, html, { head });
}

async function resolveLobbyFilingsForShare() {
  if (cachedLobbyFilingsForShare.length) return cachedLobbyFilingsForShare;
  const ldaKey = process.env.SENATE_LDA_API_KEY;
  if (ldaKey) {
    try {
      const raw = await fetchLdaFilings({ apiKey: ldaKey, fetchFn: fetchWithTimeout, limit: 80 });
      cachedLobbyFilingsForShare = raw.map((item) =>
        decorateLobbyingFiling({
          client: item.client,
          registrant: item.registrant,
          amount: item.amount,
          issue: item.issue,
          spike: null,
          portfolio: false,
          postedAt: item.postedAt,
          source: "senate_lda"
        })
      );
      return cachedLobbyFilingsForShare;
    } catch {
      /* fall through */
    }
  }
  cachedLobbyFilingsForShare = LOBBYING_FALLBACK.map(decorateLobbyFallbackRow);
  return cachedLobbyFilingsForShare;
}

function findLobbyFilingById(filingIdRaw) {
  const id = String(filingIdRaw || "").trim();
  if (!id) return null;
  const decoded = decodeURIComponent(id);
  const matchId = (f) => f.filingId === id || f.filingId === decoded;
  const fromCache = cachedLobbyFilingsForShare.find(matchId);
  if (fromCache) return fromCache;
  return getLobbyFilingsPool().find(matchId) || null;
}

async function buildLobbySharePayload(filingIdRaw) {
  await resolveLobbyFilingsForShare();
  const filing = findLobbyFilingById(filingIdRaw);
  if (!filing) {
    const err = new Error("unknown_filing_id");
    err.code = "unknown_filing_id";
    throw err;
  }
  const relatedTickers = lobbyTickersForClient(filing.client).slice(0, 8);
  const relatedBills = POLICY_BILLS.filter((bill) => {
    const text = `${bill.title || ""} ${(bill.tags || []).join(" ")} ${(bill.affected || []).join(" ")}`.toLowerCase();
    const issue = String(filing.issue || "").toLowerCase();
    const client = String(filing.client || "").toLowerCase();
    return issue.split(/,\s*/).some((tag) => tag.length > 4 && text.includes(tag.slice(0, 12)))
      || (bill.affected || []).some((t) => client.includes(String(t).toLowerCase()))
      || relatedTickers.some((sym) => (bill.affected || []).includes(sym));
  }).slice(0, 6);
  let inferredStance = filing.stance || null;
  if (!inferredStance && relatedBills.length) {
    const lobbyRows = relatedBills.flatMap((b) => b.stakeholders?.lobbying || []);
    const clientKey = String(filing.client || "").toLowerCase();
    const match = lobbyRows.find((row) => String(row.name || "").toLowerCase().includes(clientKey.slice(0, 12)));
    if (match?.stance) inferredStance = match.stance;
  }
  const enrichedFiling = inferredStance && !filing.stance ? { ...filing, stance: inferredStance } : filing;
  const mappedBills = relatedBills.map((b) => ({
    id: b.id,
    displayId: b.displayId || b.id,
    title: b.shortTitle || b.title,
    momentum: computeLegislativeMomentum(b),
    affected: (b.affected || []).slice(0, 6),
    latestActionDate: b.latestActionDate || null,
    url: shareBillPath(b.id)
  }));
  return {
    filing: enrichedFiling,
    relatedTickers,
    relatedBills: mappedBills,
    mapping: {
      traceUrls: Object.fromEntries(relatedTickers.map((ticker) => [ticker, shareStockPath(ticker)]))
    },
    source: filing.source || "senate_lda",
    updatedAt: new Date().toISOString(),
    freshness: buildFreshnessBadge({
      type: "lobby",
      filing: enrichedFiling,
      relatedBills,
      source: filing.source || "senate_lda",
      updatedAt: new Date().toISOString()
    }),
    share: {
      canonicalPath: `/lobby/${encodeURIComponent(filing.filingId)}`,
      canonicalUrl: `${APP_URL}/lobby/${encodeURIComponent(filing.filingId)}`,
      title: `${filing.client} lobbying filing`,
      disclaimer: "Lobbying data from Senate LDA when configured; otherwise illustrative samples. Research context only."
    }
  };
}

async function shareLobbySnapshot(req, res, url) {
  if (enforceShareRateLimit(req, res)) return;
  const filingId = url.searchParams.get("filingId") || url.searchParams.get("id") || "";
  try {
    const payload = await buildLobbySharePayload(filingId);
    sendJson(res, 200, { ...payload, public: true });
  } catch (err) {
    const code = err.code === "unknown_filing_id" ? 404 : 502;
    sendJson(res, code, {
      error: err.code || "share_lobby_unavailable",
      message: err.message || "Could not load lobbying filing."
    });
  }
}

function publicLobbyCard(res, pathname, { head = false } = {}) {
  const raw = decodeURIComponent(pathname.slice("/lobby/".length).split(/[/?#]/)[0]);
  const filingId = raw;
  const title = `Lobbying filing | TradeSimple`;
  const html = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/favicon.png" />
    <title>${escapeHtmlText(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400;1,9..144,600&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/src/imports/design-tokens.css?v=cd-brief-1" />
    <link rel="stylesheet" href="/assets/stock-card.css?v=lobby-dossier-2" />
    <link rel="stylesheet" href="/assets/detail-pages.css?v=lobby-dossier-2" />
    <link rel="stylesheet" href="/assets/bill-card.css?v=lobby-dossier-2" />
    <link rel="stylesheet" href="/assets/lobby-card.css?v=lobby-dossier-2" />
  </head>
  <body data-lobby-id="${escapeHtmlText(filingId)}">
    <main id="lobby-card-root" class="bill-card-root" aria-live="polite">
      <section class="stock-card-loading"><h1>Lobbying brief</h1><p>Loading filing…</p></section>
    </main>
    <script src="/assets/brief-shell.js?v=brief-shell-2" defer></script>
    <script src="/assets/lobby-card.js?v=lobby-dossier-2" defer></script>
  </body>
</html>`;
  sendHtml(res, 200, html, { head });
}

async function shareStockSnapshot(req, res, url) {
  if (enforceShareRateLimit(req, res)) return;

  const symbol = normalizeStockSymbol(url.searchParams.get("symbol"));
  const readerMode = normalizeReaderMode(url.searchParams.get("mode") || url.searchParams.get("readerMode"));

  try {
    const payload = await buildStockSnapshot(symbol, {
      readerMode,
      public: true,
      includeNarrator: true,
      includeEdgar: true,
      includeNews: true,
      includeLobbyMap: true,
      req
    });
    sendJson(res, 200, {
      ...payload,
      public: true,
      share: {
        canonicalPath: `/stock/${encodeURIComponent(symbol)}`,
        canonicalUrl: `${APP_URL}/stock/${encodeURIComponent(symbol)}`,
        canonicalEndpoint: `/api/share/stock?symbol=${encodeURIComponent(symbol)}&mode=${encodeURIComponent(readerMode)}`,
        title: `${symbol} government-to-market explainer`,
        disclaimer:
          "Market data may be delayed. TradeSimple explains policy-market relationships, not investment advice.",
        evidenceDisclaimer:
          payload.evidence?.disclaimer ||
          "Research context only. Linked sources do not imply causation or investment advice."
      }
    });
  } catch (err) {
    console.error(`[share/stock] ${symbol} snapshot failed:`, err?.stack || err?.message || String(err));
    sendJson(res, 502, { error: "share_snapshot_unavailable", message: err.message || String(err) });
  }
}

async function stockAnalysis(res, url) {
  const symbol = normalizeStockSymbol(url.searchParams.get("symbol"));
  const readerMode = normalizeReaderMode(url.searchParams.get("mode") || url.searchParams.get("readerMode"));
  const payload = await buildStockSnapshot(symbol, {
    readerMode,
    public: false,
    includeNarrator: true,
    includeEdgar: false,
    includeNews: true,
    includeLobbyMap: true
  });
  sendJson(res, 200, payload);
}

async function buildStockSnapshot(
  symbol,
  {
    readerMode,
    mode,
    public: isPublic = false,
    includeNarrator = false,
    includeEdgar = false,
    includeNews = true,
    includeLobbyMap = true,
    req = null
  } = {}
) {
  const normalizedReaderMode = normalizeReaderMode(readerMode || mode);
  const quoteResult = await quoteSnapshot(symbol);
  const quote = normalizeSnapshotQuote(
    quoteResult.quote || enrichStaticQuote(MARKET_FALLBACK[symbol]) || null,
    quoteResult.source,
    symbol
  );
  const fundamentals = FUNDAMENTALS[symbol] || {
    name: symbol,
    sector: "Tracked equity",
    marketCap: null,
    pe: null,
    forwardPe: null,
    ps: null,
    grossMargin: null,
    revenueGrowth: null,
    freeCashFlowMargin: null,
    debtToEquity: null,
    beta: null,
    analystTarget: null,
    analystRating: null,
    analystCount: null,
    catalyst: null,
    moat: "Add a fundamentals provider to replace this modeled profile with live company data.",
    plainBull: "The live price feed is connected, but fundamentals are not mapped yet.",
    plainBear: "Without fundamentals, this ticker should be treated as quote-only."
  };
  const relatedBills = POLICY_BILLS.filter((bill) => (bill.affected || []).includes(symbol));
  const policyExposure = relatedBills.reduce((max, bill) => Math.max(max, computeLegislativeMomentum(bill)), 0);
  // Government contract intelligence — company level (for radar) and event level (for cards)
  const contractProfile = CONTRACT_PROFILES[symbol] || null;
  const govDependencyScore = computeGovernmentDependencyScore(symbol);
  // Plain-English contract line for left-panel summary
  const contractSummaryLine = contractProfile
    ? ` Government contracts represent about ${Math.round(contractProfile.governmentRevenuePct * 100)}% of revenue. ${contractProfile.archetypeExplain}`
    : "";
  const valuationRisk = valuationRiskScore(fundamentals);
  const volatilityRisk = Math.min(100, Math.round(Number(fundamentals.beta || 1) * 38));
  const policyGraph = buildPolicyNetwork(symbol);

  const analysisChartRange = "6m";
  const historyPayload = await fetchMarketHistoryPayload(symbol, analysisChartRange);
  const histSampled = downsampleHistoryPoints(historyPayload.points || [], 200);
  const priceTrendFromHistory =
    histSampled.length > 1
      ? histSampled.map((p) => ({
          label: p.date || "",
          value: Number(p.close),
          open: p.open,
          high: p.high,
          low: p.low,
          volume: p.volume
        }))
      : [];
  const priceTrendSeries =
    priceTrendFromHistory.length > 1 ? priceTrendFromHistory : buildPriceSeries(symbol, quote);
  const priceTrendSource =
    priceTrendFromHistory.length > 1 ? historyPayload.source : "modeled_trend";

  const policyNetworkSnapshot = policyGraph;
  let payload = {
    source: {
      quote: quoteResult.source,
      fundamentals: "modeled_fundamentals",
      policy: "congress.gov + lda.gov model",
      edgar: "sec.gov",
      ai: "anthropic_or_local_fallback"
    },
    updatedAt: new Date().toISOString(),
    symbol,
    public: Boolean(isPublic),
    readerMode: normalizedReaderMode,
    company: {
      name: fundamentals.name,
      sector: fundamentals.sector,
      moat: fundamentals.moat
    },
    quote,
    confidence: scoreConfidence({
      staleInputs: quoteResult.source === "finnhub" ? 0 : 1,
      estimatedInputs: 1
    }),
    fundamentals,
    summary: {
      bull: fundamentals.plainBull,
      bear: fundamentals.plainBear,
      plainEnglish: `${symbol} is ${valuationRisk >= 70 ? "priced for growth" : valuationRisk <= 35 ? "not priced like hyper-growth" : "priced with a moderate growth premium"}. Policy exposure: ${policyExposure >= 60 ? "high" : policyExposure >= 30 ? "real" : "limited"} in mapped bills.${contractSummaryLine}`
    },
    metrics: metricExplanations(fundamentals),
    charts: {
      priceTrend: priceTrendSeries,
      priceTrendSource,
      priceTrendRange: analysisChartRange,
      valuation: valuationBars(fundamentals),
      businessQuality: qualityBars(fundamentals),
      riskRadar: []
    },
    governmentSignals: buildGovernmentSignalSummary(symbol, fundamentals, relatedBills, contractProfile),
    policyChains: buildPolicyChains(symbol, relatedBills),
    governmentToMarketChain: buildPolicyChains(symbol, relatedBills),
    contractProfile: contractProfile,
    govDependencyScore: govDependencyScore,
    legisAlert: policyGraph.focusBills,
    policyNetwork: policyNetworkSnapshot,
    stakeholderMap: policyGraph.stakeholderMap,
    lobbyMapping: includeLobbyMap
      ? buildLobbyMappingStatus(symbol, policyGraph.focusBills)
      : {
          matches: [],
          status: "not_requested",
          reason: "not_requested",
          updatedAt: Date.now(),
          summary: "Lobby mapping was not requested for this snapshot.",
          source: "not_requested",
          confidence: "Unavailable"
        },
    apiExplanations: apiExplanations(symbol),
    promptHints: analysisPromptHints(symbol)
  };

  if (includeNews) {
    payload = await enrichSnapshotWithRecentNews(payload, symbol);
  } else {
    payload.recentNews = [];
  }
  payload.charts.riskRadar = buildGovernmentRiskRadar({
    symbol,
    quote,
    valuationRisk,
    policyExposure,
    govDependencyScore,
    contractProfile,
    focusBills: policyGraph.focusBills,
    recentNews: payload.recentNews
  });
  if (includeEdgar) {
    payload.edgar = await publicEdgarSnapshot(symbol);
  }

  payload.evidence = buildEvidenceStack({
    symbol,
    payload,
    policyNetwork: policyGraph,
    fundamentals,
    contractProfile,
    edgar: payload.edgar || null
  });
  payload.whatChanged = buildWhatChangedSummary(payload, stockSnapshotHistory.get(symbol));
  stockSnapshotHistory.set(symbol, snapshotHistorySeed(payload));

  if (includeNarrator) {
    payload.scorecard = await runScorecardNarrator({
      symbol,
      snapshot: payload,
      mode: payload.readerMode
    }).catch((err) => ({
      symbol,
      source: "fallback_error",
      headline: `${symbol} explainer unavailable`,
      now: "The AI explainer could not run right now. The government signal evidence is still available below.",
      whyItMatters: "Use the policy chain, evidence stack, and risk radar to inspect the market mechanism.",
      watchFor: [],
      error: err.message,
      cached: false,
      updatedAt: new Date().toISOString()
    }));
    payload.explainer = {
      headline: payload.scorecard.headline,
      now: payload.scorecard.now,
      whyItMatters: payload.scorecard.whyItMatters,
      watchFor: payload.scorecard.watchFor || [],
      source: payload.scorecard.source,
      updatedAt: payload.scorecard.updatedAt,
      cached: Boolean(payload.scorecard.cached)
    };
  }

  return attachStockFreshness(
    await enrichStockSharePayload(payload, symbol, fundamentals, contractProfile, req),
    relatedBills
  );
}

function attachStockFreshness(payload, relatedBills = []) {
  payload.freshness = buildFreshnessBadge({
    type: "stock",
    quote: payload.quote,
    relatedBills,
    recentNews: payload.recentNews || [],
    updatedAt: payload.updatedAt
  });
  return payload;
}

function plainList(items) {
  const clean = (items || []).filter(Boolean).map(String);
  if (clean.length <= 1) return clean[0] || "";
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function buildGovernmentSignalSummary(symbol, fundamentals, relatedBills, contractProfile) {
  const seed = GOVERNMENT_SIGNAL_EXPOSURES[symbol] || [];
  const billTags = relatedBills.flatMap((bill) => bill.tags || []).slice(0, 4);
  const exposures = [...new Set([...seed, ...billTags])].slice(0, 5);
  const companyName = fundamentals?.name || symbol;

  return {
    headline: exposures.length
      ? `${symbol} is exposed to ${plainList(exposures)}.`
      : `${symbol} has no high-confidence government exposure mapped yet.`,
    detail: exposures.length
      ? `${companyName} can be affected when government action changes revenue access, subsidy timing, compliance costs, contract visibility, or investor expectations.`
      : "TradeSimple will show a stronger mechanism when a bill, filing, contract, or SEC risk factor maps to this ticker.",
    exposures: exposures.map((label) => ({
      label,
      mechanism: governmentExposureMechanism(label, symbol, contractProfile)
    })),
    disclaimer:
      "Government exposure is context, not a forecast or investment recommendation."
  };
}

function governmentExposureMechanism(label, symbol, contractProfile) {
  const lower = String(label || "").toLowerCase();
  if (lower.includes("export") || lower.includes("china")) {
    return "Rules can change the addressable market, customer access, compliance burden, and revenue mix.";
  }
  if (lower.includes("subsid") || lower.includes("chips")) {
    return "Grant timing can influence supply-chain security, domestic capacity, and capex expectations.";
  }
  if (lower.includes("drug") || lower.includes("medicare") || lower.includes("fda")) {
    return "Policy can affect pricing power, reimbursement, approval timing, and demand visibility.";
  }
  if (lower.includes("antitrust") || lower.includes("platform") || lower.includes("privacy")) {
    return "Enforcement can change margins, product rules, data use, and valuation expectations.";
  }
  if (lower.includes("contract") || lower.includes("procurement") || contractProfile) {
    return "Award, budget, or recompete changes can affect backlog, revenue certainty, and guidance risk.";
  }
  if (lower.includes("tax") || lower.includes("rate") || lower.includes("federal reserve")) {
    return "Macro policy can move discount rates, earnings expectations, and broad-market multiples.";
  }
  return "The market mechanism is likely revenue, margin, capex, compliance cost, or investor expectation change.";
}

function snapshotHistorySeed(snapshot) {
  const riskRadar = Object.fromEntries(
    (snapshot?.charts?.riskRadar || []).map((row) => [row.label, Math.round(Number(row.value || 0))])
  );
  return {
    symbol: snapshot?.symbol || "",
    quote: {
      price: Number(snapshot?.quote?.price || 0),
      pct: Number(snapshot?.quote?.pct ?? snapshot?.quote?.changePercent ?? 0),
      providerTimestamp: snapshot?.quote?.providerTimestamp || null
    },
    riskRadar,
    recentNewsKeys: (snapshot?.recentNews || []).map((item) => item.url || item.headline).filter(Boolean).slice(0, 12),
    relatedBillIds: (snapshot?.legisAlert || []).map((bill) => bill.id).filter(Boolean).slice(0, 12),
    lobby: {
      reason: snapshot?.lobbyMapping?.reason || "unknown",
      count: Number(snapshot?.lobbyMapping?.matches?.length || 0)
    },
    edgar: {
      status: snapshot?.edgar?.status || "not_requested",
      filingDate: snapshot?.edgar?.filingDate || null
    },
    updatedAt: snapshot?.updatedAt || new Date().toISOString()
  };
}

function buildWhatChangedSummary(snapshot, previous = null) {
  const symbol = snapshot?.symbol || "Ticker";
  const quote = snapshot?.quote || {};
  const pct = Number(quote.pct ?? quote.changePercent ?? 0);
  const headline = (snapshot?.recentNews || [])[0]?.headline;
  const policyScore = Number(snapshot?.charts?.riskRadar?.find?.((row) => row.label === "Policy Exposure")?.value || 0);
  const lobby = snapshot?.lobbyMapping || {};
  const items = [];

  const previousPct = Number(previous?.quote?.pct);
  const quoteChanged = Number.isFinite(previousPct) && Math.abs(pct - previousPct) >= 0.25;
  items.push({
    type: "quote",
    label: quoteChanged ? "Quote move changed" : "Quote checked",
    detail: quoteChanged
      ? `${symbol} moved ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%, from ${previousPct >= 0 ? "+" : ""}${previousPct.toFixed(1)}% in the prior snapshot.`
      : `${symbol} moved ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%.`,
    severity: Math.abs(pct) >= 2 ? "watch" : "info",
    sourceType: quote.provider || quoteProviderLabel(quote.source),
    freshness: quote.delayLabel || "Quote freshness unavailable",
    confidence: quote.status === "available" ? "Medium" : quote.status === "partial" ? "Low" : "Unavailable",
    reason: "Quote movement is supporting context; the card still prioritizes government-to-market mechanisms."
  });

  const currentNewsKeys = (snapshot?.recentNews || []).map((item) => item.url || item.headline).filter(Boolean);
  const previousNewsKeys = new Set(previous?.recentNewsKeys || []);
  const newNews = currentNewsKeys.filter((key) => !previousNewsKeys.has(key));
  items.push({
    type: "news",
    label: newNews.length ? "New headline" : "News window checked",
    detail: newNews.length && headline
      ? `New headline detected: ${headline}`
      : "No new company headline detected in this snapshot.",
    severity: newNews.length ? "watch" : "info",
    sourceType: "Finnhub News",
    freshness: (snapshot?.recentNews || [])[0]?.publishedAt || "Current news window",
    confidence: newNews.length ? "Medium" : "No match",
    reason: "Recent headlines are injected before the narrator writes the plain-English explanation."
  });

  const previousPolicyScore = Number(previous?.riskRadar?.["Policy Exposure"]);
  const riskDelta = Number.isFinite(previousPolicyScore) ? policyScore - previousPolicyScore : 0;
  items.push({
    type: "risk",
    label: Math.abs(riskDelta) >= 5 ? "Policy exposure changed" : "Policy exposure unchanged",
    detail: Math.abs(riskDelta) >= 5
      ? `Policy Exposure moved ${riskDelta > 0 ? "+" : ""}${Math.round(riskDelta)} points to ${Math.round(policyScore)}.`
      : policyScore >= 67
        ? "Government exposure remains high."
        : policyScore >= 35
          ? "Government exposure remains active."
          : "Government exposure remains limited in mapped data.",
    severity: policyScore >= 67 ? "watch" : "info",
    sourceType: "TradeSimple policy model",
    freshness: snapshot?.updatedAt || "Current snapshot",
    confidence: policyScore > 0 ? "Medium" : "No match",
    reason: "Policy exposure comes from mapped bills, stage, lobbying pressure, and ticker relationship strength."
  });

  const currentLobbyCount = Number(lobby.matches?.length || 0);
  const previousLobbyCount = Number(previous?.lobby?.count || 0);
  const lobbyChanged = previous
    ? currentLobbyCount !== previousLobbyCount || lobby.reason !== previous?.lobby?.reason
    : false;
  items.push({
    type: "lobby",
    label: lobbyChanged ? "Lobbying map changed" : "Lobbying map unchanged",
    detail: lobby.reason === "matched"
      ? `${currentLobbyCount} lobbying ${currentLobbyCount === 1 ? "filing" : "filings"} mapped to active policy issues.`
      : lobby.reason === "api_error"
        ? "Lobbying map temporarily unavailable."
        : "No lobbying activity mapped to this ticker yet.",
    severity: lobby.reason === "api_error" ? "caution" : currentLobbyCount ? "watch" : "info",
    sourceType: lobby.source || "TradeSimple lobby mapper",
    freshness: lobby.updatedAt ? new Date(lobby.updatedAt).toISOString() : snapshot?.updatedAt,
    confidence: lobby.reason === "matched" ? "Medium" : lobby.reason === "api_error" ? "Unavailable" : "No match",
    reason: "This distinguishes an actual no-match from a mapping failure."
  });

  const visibleItems = items.slice(0, 4);
  const headlineText = visibleItems.map((item) => item.detail).join(" ");

  return {
    status: previous ? "compared" : "baseline",
    headline: previous ? headlineText : `Baseline snapshot created. ${headlineText}`,
    items: visibleItems,
    previousUpdatedAt: previous?.updatedAt || null,
    updatedAt: new Date().toISOString()
  };
}

function buildGovernmentRiskRadar({
  symbol,
  quote,
  valuationRisk,
  policyExposure,
  govDependencyScore,
  contractProfile,
  focusBills,
  recentNews
}) {
  const maxLobby = (focusBills || []).reduce(
    (max, bill) => Math.max(max, Number(bill.lobbyingPressureScore || 0)),
    0
  );
  const newsCount = Array.isArray(recentNews) ? recentNews.length : 0;
  const quoteMove = Math.min(30, Math.abs(Number(quote?.pct || quote?.changePercent || 0)) * 7);
  const newsMomentum = Math.round(Math.min(100, newsCount * 12 + quoteMove));
  const topBill = (focusBills || []).slice().sort((a, b) => Number(b.policyExposure || 0) - Number(a.policyExposure || 0))[0];

  return [
    {
      label: "Policy Exposure",
      value: Math.round(policyExposure || 0),
      caption: topBill
        ? `${topBill.id} is the clearest mapped policy channel for ${symbol}.`
        : `${symbol} has no high-conviction bill mapping in this snapshot.`,
      explain: "Highest legislative momentum among mapped bills touching this ticker."
    },
    {
      label: "Contract Dependency",
      value: govDependencyScore !== null ? govDependencyScore : 0,
      caption: contractProfile
        ? `${Math.round(contractProfile.governmentRevenuePct * 100)}% of revenue is tied to government customers or contracts.`
        : "No material federal-contract revenue dependency is mapped for this ticker.",
      explain: "Company-level structural exposure to government revenue, renewal risk, and agency budgets."
    },
    {
      label: "Regulatory Pressure",
      value: Math.round(maxLobby || 0),
      caption: maxLobby
        ? `Lobbying and bill pressure are active around the mapped policy issue.`
        : "No major lobbying pressure is mapped to this ticker yet.",
      explain: "Modeled from lobbying pressure, bill stage, and stakeholder intensity."
    },
    {
      label: "Valuation Sensitivity",
      value: Math.round(valuationRisk || 0),
      caption: valuationRisk >= 70
        ? "Expectations are high, so policy uncertainty can matter more."
        : "The valuation signal is not the dominant government mechanism in this snapshot.",
      explain: "Based on P/E and forward P/E versus a sector baseline."
    },
    {
      label: "News Momentum",
      value: newsMomentum,
      caption: newsCount
        ? `${newsCount} recent headline${newsCount === 1 ? "" : "s"} are included before the explainer runs.`
        : "No fresh company headlines were returned by the news feed.",
      explain: "Combines recent company headlines with the latest quote move."
    }
  ];
}

function buildLobbyMappingStatus(symbol, focusBills) {
  const matches = [];
  for (const bill of focusBills || []) {
    const lobbyRows = bill.stakeholders?.lobbying || [];
    for (const row of lobbyRows) {
      matches.push({
        billId: bill.id,
        client: row.name,
        amount: row.amount || null,
        direction: row.stance || "neutral",
        issue: row.issue || bill.shortTitle || bill.title,
        reasoning: row.relationship || bill.relationshipSummary || bill.impact || ""
      });
    }
    for (const row of bill._ldaRows || []) {
      matches.push({
        billId: bill.id,
        client: row.name,
        amount: row.amount || null,
        direction: row.stance || "neutral",
        issue: row.issue || bill.shortTitle || bill.title,
        reasoning: row.relationship || bill.lobbyingNote || bill.signal || "",
        source: "senate_lda"
      });
    }
  }

  const reason = matches.length ? "matched" : "no_match";
  return {
    matches: matches.slice(0, 8),
    status: reason,
    reason,
    updatedAt: Date.now(),
    summary: matches.length
      ? `${matches.length} lobbying ${matches.length === 1 ? "filing is" : "filings are"} mapped to active policy issues.`
      : "No lobbying activity mapped to this symbol yet.",
    source: process.env.SENATE_LDA_API_KEY ? "lda.gov + TradeSimple mapper" : "TradeSimple modeled mapper",
    confidence: matches.length ? "Medium" : "No match"
  };
}

function congressSearchUrl(value) {
  return `https://www.congress.gov/search?q=${encodeURIComponent(value || "market policy")}`;
}

function usaspendingSearchUrl(company) {
  return `https://www.usaspending.gov/keyword_search/?keyword=${encodeURIComponent(company || "")}`;
}

function tickerResearchUrl(symbol) {
  return `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(String(symbol || "").toLowerCase())}`;
}

function analystConsensusLabel(rating) {
  const text = String(rating || "").toLowerCase();
  if (text.includes("strong") || text === "buy") return "Positive consensus";
  if (text.includes("hold") || text.includes("neutral")) return "Mixed consensus";
  if (text.includes("sell")) return "Negative consensus";
  if (text.includes("etf")) return "Benchmark view";
  return "Consensus view";
}

function buildEvidenceStack({ symbol, payload, policyNetwork, fundamentals, contractProfile, edgar }) {
  const focusBills = policyNetwork?.focusBills || [];
  const lobbyingMatches = payload.lobbyMapping?.matches || [];
  const companyName = payload.company?.name || symbol;
  const now = new Date().toISOString();
  const recentNews = (payload.recentNews || []).slice(0, 8).map((item) => ({
    ...item,
    status: "available",
    sourceLabel: item.source || "Finnhub News",
    sourceType: "Finnhub News",
    freshness: item.publishedAt || now,
    confidence: item.url ? "Medium" : "Low",
    reason: "Recent company headlines are used as context before the narrator writes the explainer."
  }));
  const secFiling = edgar?.status === "available"
    ? {
        status: "available",
        form: edgar.form,
        filingDate: edgar.filingDate,
        sourceLabel: "SEC EDGAR",
        sourceType: "SEC filing",
        sourceUrl: edgar.sourceUrl,
        freshness: edgar.updatedAt || edgar.filingDate || now,
        confidence: "High",
        reason: "Annual filings identify revenue sources and business risks in the company's own words."
      }
    : {
        status: edgar?.status || "unavailable",
        sourceLabel: "SEC EDGAR",
        sourceType: "SEC filing",
        sourceUrl: edgar?.sourceUrl || "https://www.sec.gov/edgar/search/",
        freshness: edgar?.updatedAt || now,
        confidence: "Unavailable",
        reason: edgar?.message || "SEC summary unavailable; raw source lookup remains available."
      };

  return {
    status: "available",
    recentNews,
    relatedBills: focusBills.slice(0, 8).map((bill) => ({
      sourceStatus: "available",
      id: bill.id,
      title: bill.title,
      status: bill.status,
      latestAction: bill.latestAction,
      legislativeMomentum: bill.legislativeMomentum,
      policyExposure: bill.policyExposure,
      sourceLabel: bill.exactCongressRecord
        ? "Congress.gov"
        : bill.scenarioOnly
          ? "TradeSimple scenario"
          : "Scenario · pending Congress.gov",
      sourceType: "Congress.gov",
      sourceUrl: congressSearchUrl(bill.title || bill.id),
      freshness: bill.latestActionDate || payload.updatedAt,
      confidence: bill.exactCongressRecord ? "High" : "Medium",
      reason: "Bill status and latest action establish the government signal before market interpretation."
    })),
    lobbyingFilings: lobbyingMatches.map((match) => ({
      ...match,
      status: "available",
      sourceLabel: "Senate LDA",
      sourceType: "Senate lobbying disclosure",
      sourceUrl: "https://lda.senate.gov/filings/public/filing/search/",
      freshness: payload.lobbyMapping?.updatedAt ? new Date(payload.lobbyMapping.updatedAt).toISOString() : payload.updatedAt,
      confidence: match.score != null && Number(match.score) >= 0.7 ? "High" : "Medium",
      reason: match.reasoning || "Filing issue text overlaps with a tracked policy channel."
    })),
    secFiling: secFiling.status === "available" ? secFiling : null,
    secFilings: secFiling.status === "available" ? [secFiling] : [],
    governmentContracts: contractProfile
      ? {
          status: "available",
          relevant: true,
          sourceLabel: "USASpending.gov",
          sourceType: "Government contracts",
          sourceUrl: usaspendingSearchUrl(companyName),
          freshness: payload.updatedAt,
          confidence: "Medium",
          reason: "Contract dependency can make agency budgets, awards, and recompetes part of the market pathway.",
          summary: `${Math.round(contractProfile.governmentRevenuePct * 100)}% government revenue exposure. ${contractProfile.archetypeExplain}`
        }
      : {
          status: "no_match",
          relevant: false,
          sourceLabel: "USASpending.gov",
          sourceType: "Government contracts",
          sourceUrl: usaspendingSearchUrl(companyName),
          freshness: payload.updatedAt,
          confidence: "No match",
          reason: "No material federal contract dependency is mapped in TradeSimple's company profile.",
          summary: "No material federal contract dependency is mapped in TradeSimple's company profile."
        },
    analystConsensus: {
      status: fundamentals?.analystRating ? "available" : "partial",
      label: analystConsensusLabel(fundamentals?.analystRating),
      target: fundamentals?.analystTarget ?? null,
      analystCount: fundamentals?.analystCount ?? null,
      sourceLabel: "Modeled consensus profile",
      sourceType: "Analyst consensus",
      sourceUrl: tickerResearchUrl(symbol),
      freshness: payload.updatedAt,
      confidence: fundamentals?.analystCount ? "Low" : "Partial",
      reason: "Consensus is supporting context only; it does not drive the government-to-market mechanism."
    },
    disclaimer: "Research context only. Linked sources do not imply causation or investment advice."
  };
}

async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function publicEdgarSnapshot(symbol) {
  if (["SPY", "QQQ"].includes(symbol)) {
    return {
      status: "unsupported",
      symbol,
      message: "ETF filings are not shown in the public stock-card EDGAR block.",
      revenueSegments: [],
      topRisks: [],
      yoyDirection: []
    };
  }

  const cached = edgarSnapshotCache.get(symbol);
  if (cached && Date.now() - cached.cachedAt < EDGAR_SNAPSHOT_CACHE_TTL_MS) {
    return { ...cached.value, cached: true };
  }

  let value;
  try {
    const edgar = await withTimeout(
      buildEdgarSnapshot(symbol),
      Number(process.env.EDGAR_SNAPSHOT_TIMEOUT_MS || 14_000),
      "SEC EDGAR snapshot timed out"
    );
    value = {
      status: "available",
      symbol,
      company: edgar.company,
      form: edgar.form,
      filingDate: edgar.filingDate,
      accessionNumber: edgar.accessionNumber,
      primaryDocument: edgar.primaryDocument,
      sourceUrl: edgar.sourceUrl,
      simplified: edgar.simplified,
      revenueSegments: edgar.simplified?.whereMoneyComesFrom || [],
      topRisks: edgar.simplified?.whatCouldHurtIt || [],
      yoyDirection: edgar.simplified?.numbersGoingRight ? [edgar.simplified.numbersGoingRight] : [],
      riskFactorsAvailable: Boolean(String(edgar.riskFactors || "").trim()),
      updatedAt: new Date().toISOString()
    };
  } catch (err) {
    value = {
      status: "unavailable",
      symbol,
      message: "SEC filing summary is temporarily unavailable.",
      error: err.message || String(err),
      revenueSegments: [],
      topRisks: [],
      yoyDirection: [],
      updatedAt: new Date().toISOString()
    };
  }

  edgarSnapshotCache.set(symbol, { value, cachedAt: Date.now() });
  return value;
}

async function policyNetwork(res, url) {
  const requested = String(url.searchParams.get("symbol") || "NVDA").toUpperCase().replace(/[^A-Z.]/g, "");
  const symbol = requested || "NVDA";
  sendJson(res, 200, buildPolicyNetwork(symbol));
}

function buildPolicyNetwork(symbol) {
  const focusSymbol = String(symbol || "NVDA").toUpperCase();
  const allBills = POLICY_BILLS.map((bill) => enrichPolicyBill(mergeCongressLiveIntoBill(bill), focusSymbol));
  const focusBills = allBills.filter((bill) => (bill.affected || []).includes(focusSymbol));
  const source = {
    bills: process.env.CONGRESS_API_KEY ? "congress.gov + modeled impact layer" : "modeled bills",
    lobbying: process.env.SENATE_LDA_API_KEY ? "lda.gov + modeled relationship layer" : "modeled lobbying",
    relationships: "prototype stakeholder graph"
  };

  return {
    source,
    updatedAt: new Date().toISOString(),
    focusSymbol,
    confidence: scoreConfidence({
      missingInputs: focusBills.length ? 0 : 2
    }),
    summary: buildPolicySummary(focusSymbol, focusBills),
    catalysts: buildPolicyCatalysts(focusBills.length ? focusBills : allBills),
    allBills,
    focusBills,
    stakeholderMap: buildStakeholderMap(focusSymbol, focusBills.length ? focusBills : allBills.slice(0, 3))
  };
}

function enrichPolicyBill(bill, focusSymbol = "") {
  const merged = mergeCongressLiveIntoBill(bill);
  const model = POLICY_STAKEHOLDERS[bill.id] || emptyStakeholderModel(merged);
  const base = decorateBill({
    ...merged,
    nextWatch: bill.nextWatch || model.nextWatch || null
  });
  const lobbyingStakeholders = attachLobbyFilingIds(
    base._ldaRows?.length > 0
      ? base._ldaRows
      : (model.lobbying || []).map((row) => ({
          ...row,
          amount: row.amount ?? null,
          relationship: `${row.relationship || ""} (narrative — no LDA dollar match)`.trim()
        }))
  );
  const metrics = augmentBillMetrics(base);
  const statusInfo = statusInfoForBill(base);
  const focusImpact = model.tickerImpacts.find((impact) => impact.symbol === focusSymbol) ||
    model.tickerImpacts.find((impact) => (base.affected || []).includes(impact.symbol)) ||
    null;
  const topOpposition = model.lobbying
    .filter((item) => item.stance === "against")
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
  const topSupport = model.lobbying
    .filter((item) => item.stance === "for")
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];

  return {
    ...base,
    ...metrics,
    statusInfo,
    stagePath: statusInfo.stagePath,
    momentumDrivers: momentumDriversForBill(base),
    catalyst: catalystForBill({ ...base, statusInfo }, metrics),
    nextWatchItems: nextWatchItemsForBill(base, statusInfo),
    relationshipSummary: focusImpact
      ? `${focusSymbol}: ${focusImpact.mechanism}`
      : base.impact,
    focusImpact,
    stakeholders: {
      lawmakers: model.lawmakers,
      committees: model.committees,
      lobbying: lobbyingStakeholders
    },
    tickerImpacts: model.tickerImpacts,
    analog: model.analog,
    nextWatch: base.nextWatch,
    signalSteps: [
      {
        label: "Lobbying pressure",
        text: topOpposition
          ? `Lobbying pressure score ${metrics.lobbyingPressureScore}/100 (${metrics.lobbyingSignalConfidence} confidence). ${topOpposition.name} and aligned groups are spending against the bill, which signals revenue or margin risk.`
          : topSupport
            ? `Lobbying pressure score ${metrics.lobbyingPressureScore}/100 (${metrics.lobbyingSignalConfidence} confidence). ${topSupport.name} and aligned groups are spending for the bill, which signals they want faster implementation.`
            : `Lobbying pressure score ${metrics.lobbyingPressureScore}/100 (${metrics.lobbyingSignalConfidence} confidence). No large lobbying spike has been mapped yet.`
      },
      {
        label: "Congress path",
        text: `${statusInfo.label} in the ${base.chamber}. ${statusInfo.nextStep} Latest action: ${base.latestAction}. Legislative momentum: ${metrics.legislativeMomentum}/100 (${metrics.signalConfidence} confidence).`
      },
      {
        label: "Investor mechanism",
        text: focusImpact?.mechanism || base.impact || "Translate the bill into revenue, margin, capex, or valuation multiple risk before acting."
      }
    ]
  };
}

function buildPolicySummary(symbol, bills) {
  if (!bills.length) {
    return {
      headline: `${symbol} has no mapped high-conviction bill pressure yet.`,
      detail: "Live bills can still appear in Congress.gov, but this prototype only flags the ones with a modeled stock channel.",
      riskLevel: "low"
    };
  }
  const strongest = bills.slice().sort((a, b) => Number(b.policyExposure || 0) - Number(a.policyExposure || 0))[0];
  const riskLevel = strongest.policyExposure >= 67 ? "high" : strongest.policyExposure >= 40 ? "medium" : "watch";
  return {
    headline: `${symbol} is linked to ${bills.length} policy ${bills.length === 1 ? "chain" : "chains"}.`,
    detail: `${strongest.title} is the highest-impact mapping: ${strongest.relationshipSummary}`,
    riskLevel
  };
}

function buildStakeholderMap(symbol, bills) {
  const nodes = new Map();
  const links = [];

  const addNode = (node) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addLink = (from, to, label, tone = "neutral", strength = 50) => {
    links.push({ from, to, label, tone, strength });
  };

  addNode({
    id: `ticker:${symbol}`,
    type: "ticker",
    label: symbol,
    detail: FUNDAMENTALS[symbol]?.name || "Focused ticker",
    tone: "green"
  });

  for (const bill of bills) {
    const model = POLICY_STAKEHOLDERS[bill.id] || emptyStakeholderModel(bill);
    const billId = `bill:${bill.id}`;
    addNode({
      id: billId,
      type: "bill",
      label: bill.id,
      title: bill.title,
      detail: `Legislative momentum ${bill.legislativeMomentum}/100 - ${bill.status}`,
      tone: bill.legislativeMomentum >= 67 ? "green" : bill.legislativeMomentum < 35 ? "red" : "amber"
    });
    if ((bill.affected || []).includes(symbol)) {
      addLink(billId, `ticker:${symbol}`, stockImpactChannel(symbol, bill), "green", Number(bill.legislativeMomentum || 0));
    }

    for (const lawmaker of model.lawmakers.slice(0, 4)) {
      const id = `person:${slug(lawmaker.name)}`;
      addNode({
        id,
        type: "person",
        label: lawmaker.name,
        detail: `${lawmaker.role} - ${lawmaker.party}-${lawmaker.state}`,
        tone: lawmaker.stance === "for" ? "green" : lawmaker.stance === "against" ? "red" : "amber"
      });
      addLink(id, billId, lawmaker.note, lawmaker.stance === "for" ? "green" : lawmaker.stance === "against" ? "red" : "amber", lawmaker.influence);
    }

    for (const committee of model.committees.slice(0, 3)) {
      const id = `committee:${slug(committee.name)}`;
      addNode({
        id,
        type: "committee",
        label: committee.name,
        detail: committee.role,
        tone: committee.stance === "stalled" ? "red" : committee.stance === "watch" ? "amber" : "green"
      });
      addLink(id, billId, committee.role, committee.stance === "stalled" ? "red" : "amber", committee.influence);
    }

    for (const lobbyist of model.lobbying.slice(0, 5)) {
      const id = `lobby:${slug(lobbyist.name)}`;
      const tone = lobbyist.stance === "against" ? "red" : lobbyist.stance === "for" ? "green" : "amber";
      addNode({
        id,
        type: "lobby",
        label: lobbyist.name,
        detail: `${compactDollars(lobbyist.amount)} ${lobbyist.stance} - ${lobbyist.issue}`,
        tone
      });
      addLink(id, billId, lobbyist.relationship, tone, Math.min(100, Math.round(Number(lobbyist.amount || 0) / 100000)));
      for (const ticker of lobbyist.tickers || []) {
        if (ticker === symbol) addLink(id, `ticker:${symbol}`, lobbyist.relationship, tone, 65);
      }
    }
  }

  return {
    symbol,
    nodes: [...nodes.values()],
    links: links.slice(0, 34),
    legend: [
      "People and committees shape bill movement.",
      "Lobbyists reveal where industries feel pressure.",
      "Bills affect stocks through revenue, margin, capex, or valuation."
    ]
  };
}

const RELATIONSHIP_MAP_COLORS = {
  stock: "#d85a30",
  bill: "#378add",
  lobby: "#ba7517",
  contract: "#639922",
  figure: "#9b6ed0",
  market: "#7f77dd"
};

const NVDA_PEER_SYMBOLS = ["AMD", "TSM", "AVGO", "INTC"];

function relationshipMapNodeLayout(index, total, radiusX, radiusY, cx, cy) {
  const angle = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
  return {
    x: Number((cx + Math.cos(angle) * radiusX).toFixed(3)),
    y: Number((cy + Math.sin(angle) * radiusY).toFixed(3))
  };
}

function buildRelationshipMap(symbol) {
  const sym = normalizeStockSymbol(symbol);
  const policy = buildPolicyNetwork(sym);
  const focusBills = policy.focusBills.slice(0, 5);
  const nodes = [];
  const edges = [];
  const evidenceRefs = {};

  const pushNode = (node) => {
    nodes.push(node);
    if (node.evidence?.length) evidenceRefs[node.id] = node.evidence;
  };
  const pushEdge = (from, to, label, strength = "neutral") => {
    edges.push({ id: `${from}__${to}`, from, to, label, strength });
  };

  const companyName = FUNDAMENTALS[sym]?.name || sym;
  pushNode({
    id: "stock",
    label: sym,
    sub: companyName,
    cat: "stock",
    x: 0.5,
    y: 0.5,
    r: 26,
    color: RELATIONSHIP_MAP_COLORS.stock,
    desc: `Central ticker for this map. Connections show policy, lobbying, contracts, figures, and market channels that may affect ${sym} — correlation is not causation.`,
    path: "All mapped signals → repricing context for " + sym,
    evidence: collectThesisEvidencePool(sym).slice(0, 2)
  });

  focusBills.forEach((bill, i) => {
    const pos = relationshipMapNodeLayout(i, focusBills.length, 0.28, 0.22, 0.22, 0.2);
    const id = `bill_${bill.id}`;
    const ev = evidenceFromBill(bill, sym);
    pushNode({
      id,
      label: bill.id,
      sub: "Bill · Congress.gov",
      cat: "bill",
      ...pos,
      r: 18,
      color: RELATIONSHIP_MAP_COLORS.bill,
      desc: bill.plainEnglish || bill.signal || bill.latestAction || bill.title,
      path: bill.relationshipSummary || bill.impact || "Legislative path → " + sym,
      evidence: [ev]
    });
    pushEdge(id, "stock", bill.shortTitle || "Policy channel", bill.legislativeMomentum >= 55 ? "positive" : "neutral");
  });

  const lobbySeen = new Set();
  for (const bill of focusBills) {
    const model = POLICY_STAKEHOLDERS[bill.id] || emptyStakeholderModel(bill);
    for (const lobbyist of (model.lobbying || []).slice(0, 3)) {
      const tickers = lobbyist.tickers || [];
      if (tickers.length && !tickers.includes(sym)) continue;
      const id = `lobby_${slug(lobbyist.name)}`;
      if (lobbySeen.has(id)) continue;
      lobbySeen.add(id);
      const idx = lobbySeen.size - 1;
      const pos = relationshipMapNodeLayout(idx, 6, 0.3, 0.24, 0.78, 0.22);
      pushNode({
        id,
        label: String(lobbyist.name || "Lobby").slice(0, 18),
        sub: "Lobbying · LDA",
        cat: "lobby",
        ...pos,
        r: 16,
        color: RELATIONSHIP_MAP_COLORS.lobby,
        desc: `${lobbyist.issue || "Lobbying"} — ${lobbyist.stance || "tracked"} (${compactDollars(lobbyist.amount)})`,
        path: "Lobby spend → bill pressure → " + sym,
        evidence: [
          buildEvidenceItem({
            id: `lobby_${id}`,
            title: lobbyist.issue || lobbyist.name,
            summary: lobbyist.relationship || lobbyist.issue || "Lobbying disclosure",
            excerpt: lobbyist.relationship || "",
            source: "Senate LDA · stakeholder map",
            sourceUrl: "https://lda.senate.gov/filings/public/filing/search/",
            publishedAt: bill.latestActionDate,
            supports: "Lobbying pressure",
            symbol: sym,
            type: "lobby",
            modeled: true
          })
        ]
      });
      pushEdge(id, "stock", lobbyist.stance === "against" ? "Opposition spend" : "Support spend", lobbyist.stance === "against" ? "negative" : "positive");
      const billId = `bill_${bill.id}`;
      if (nodes.some((n) => n.id === billId)) pushEdge(id, billId, "Lobbying on bill", "neutral");
    }
  }

  const contractProfile = CONTRACT_PROFILES[sym];
  if (contractProfile) {
    const pos = { x: 0.82, y: 0.72 };
    const id = `contract_${sym}`;
    pushNode({
      id,
      label: "Contracts",
      sub: "USASpending · profile",
      cat: "contract",
      ...pos,
      r: 17,
      color: RELATIONSHIP_MAP_COLORS.contract,
      desc: contractProfile.note || contractProfile.archetypeExplain,
      path: "Award flow → revenue visibility → " + sym,
      evidence: [evidenceFromContractProfile(sym, contractProfile)]
    });
    pushEdge(id, "stock", contractProfile.archetype || "Gov revenue", "positive");
  }

  const figures = FIGURE_LINKS.filter((f) => (f.symbols || []).includes(sym)).slice(0, 4);
  figures.forEach((figure, i) => {
    const pos = relationshipMapNodeLayout(i, Math.max(4, figures.length), 0.26, 0.2, 0.2, 0.78);
    const id = `figure_${slug(figure.name)}`;
    pushNode({
      id,
      label: figure.name.split(" ").slice(-1)[0] || figure.name,
      sub: "Figure · Curated",
      cat: "figure",
      ...pos,
      r: 15,
      color: RELATIONSHIP_MAP_COLORS.figure,
      desc: figure.label || figure.name,
      path: "Public testimony / comments → policy narrative → " + sym,
      evidence: [evidenceFromFigure(figure, sym)]
    });
    pushEdge(id, "stock", "Policy appearance", "neutral");
  });

  const marketNodes = [];
  if (FUNDAMENTALS[sym]?.catalyst) {
    marketNodes.push({
      id: "market_earnings",
      label: "Earnings",
      sub: "Fundamentals · modeled",
      desc: FUNDAMENTALS[sym].catalyst,
      evidence: [
        buildEvidenceItem({
          title: "Earnings checkpoint",
          summary: FUNDAMENTALS[sym].catalyst,
          excerpt: FUNDAMENTALS[sym].catalyst,
          source: "Modeled fundamentals",
          sourceUrl: `/api/analysis/stock?symbol=${encodeURIComponent(sym)}`,
          supports: "Catalysts",
          symbol: sym,
          type: "market",
          modeled: true
        })
      ]
    });
  }

  if (sym === "NVDA" || sym === "AMD") {
    marketNodes.push({
      id: "market_capex",
      label: "AI capex",
      sub: "Hyperscaler demand",
      desc: "Cloud capex guides from MSFT, AMZN, GOOGL, and META set the accelerator order pipeline.",
      evidence: [
        buildEvidenceItem({
          title: "Hyperscaler capex",
          summary: "Cloud capex guides set GPU demand visibility.",
          source: "Modeled market linkage",
          supports: "Demand pipeline",
          symbol: sym,
          type: "market",
          modeled: true
        })
      ]
    });
  }

  if (sym === "NVDA") {
    marketNodes.push({
      id: "market_blackwell",
      label: "Blackwell",
      sub: "Product ramp",
      desc: "Shipment timing and yield commentary are near-term falsification tests for the NVDA thesis.",
      evidence: [
        buildEvidenceItem({
          title: "Blackwell ramp",
          summary: "Product cycle checkpoint for NVDA.",
          source: "NVDA catalyst profile",
          supports: "Product cycle",
          symbol: sym,
          type: "market",
          modeled: true
        })
      ]
    });
    for (const peer of NVDA_PEER_SYMBOLS) {
      const peerName = FUNDAMENTALS[peer]?.name || peer;
      marketNodes.push({
        id: `peer_${peer}`,
        label: peer,
        sub: "Peer · market",
        desc: `${peerName} — competitive and supply-chain read-through for NVDA.`,
        evidence: [
          buildEvidenceItem({
            title: `${peer} peer context`,
            summary: FUNDAMENTALS[peer]?.catalyst || `${peer} moves can reprice NVDA through share narratives.`,
            source: "Peer ticker profile",
            sourceUrl: `/api/analysis/stock?symbol=${encodeURIComponent(peer)}`,
            supports: "Competitive risk",
            symbol: peer,
            type: "market",
            modeled: true
          })
        ]
      });
    }
  }

  marketNodes.forEach((spec, i) => {
    const pos = relationshipMapNodeLayout(i, marketNodes.length, 0.34, 0.28, 0.5, 0.1);
    pushNode({
      ...spec,
      cat: "market",
      ...pos,
      r: spec.id.startsWith("peer_") ? 14 : 16,
      color: RELATIONSHIP_MAP_COLORS.market,
      path: spec.id.startsWith("peer_") ? "Peer move → NVDA narrative" : "Market checkpoint → " + sym
    });
    pushEdge(
      spec.id,
      "stock",
      spec.id.startsWith("peer_") ? "Peer signal" : "Direct checkpoint",
      spec.id.startsWith("peer_") ? "negative" : "neutral"
    );
  });

  const enrichedNodes = nodes.map(enrichRelationshipMapNode);

  return {
    source: "relationship_map",
    symbol: sym,
    updatedAt: new Date().toISOString(),
    nodes: enrichedNodes,
    edges,
    evidenceRefs,
    filters: ["all", "bill", "lobby", "contract", "figure", "market"],
    filterCounts: relationshipMapFilterCounts(enrichedNodes),
    connectionCount: edges.length,
    nvdaExpansion: sym === "NVDA",
    disclaimer:
      "Relationship map is research context only. Connections do not imply causation and are not investment advice."
  };
}

function relationshipNodeEventAt(node) {
  const dates = (node.evidence || [])
    .map((ev) => ev.publishedAt || ev.date)
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (!dates.length) return null;
  return dates.reduce((a, b) => (a > b ? a : b));
}

function enrichRelationshipMapNode(node) {
  const primary = node.evidence?.[0];
  const detail = String(node.desc || primary?.summary || primary?.excerpt || "").trim();
  const eventAt = relationshipNodeEventAt(node);
  return {
    ...node,
    detail,
    source: primary?.source || node.sub || null,
    url: primary?.sourceUrl || null,
    eventAt: eventAt ? eventAt.toISOString() : null
  };
}

function relationshipMapFilterCounts(nodes) {
  const counts = { all: 0, bill: 0, lobby: 0, contract: 0, figure: 0, market: 0 };
  for (const n of nodes) {
    if (n.id === "stock") continue;
    counts.all += 1;
    if (Object.prototype.hasOwnProperty.call(counts, n.cat)) counts[n.cat] += 1;
  }
  return counts;
}

function computeRelationshipMapNewIds(nodes, edges, sinceDate) {
  const sinceMs = sinceDate instanceof Date ? sinceDate.getTime() : NaN;
  if (Number.isNaN(sinceMs)) return { newNodeIds: [], newEdgeIds: [] };
  const newNodeIds = [];
  for (const n of nodes) {
    if (n.id === "stock") continue;
    const at = n.eventAt ? new Date(n.eventAt) : relationshipNodeEventAt(n);
    if (at && !Number.isNaN(at.getTime()) && at.getTime() > sinceMs) newNodeIds.push(n.id);
  }
  const newNodeSet = new Set(newNodeIds);
  const newEdgeIds = edges
    .filter((e) => newNodeSet.has(e.from) || newNodeSet.has(e.to))
    .map((e) => e.id || `${e.from}__${e.to}`);
  return { newNodeIds, newEdgeIds };
}

async function relationshipMapRoute(res, url) {
  const symbol = normalizeStockSymbol(url.searchParams.get("symbol") || "NVDA");
  const map = buildRelationshipMap(symbol);
  const sinceRaw = url.searchParams.get("since");
  let sinceDate = null;
  if (sinceRaw) {
    const parsed = new Date(sinceRaw);
    if (!Number.isNaN(parsed.getTime())) sinceDate = parsed;
  }
  const highlightSince = sinceDate || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { newNodeIds, newEdgeIds } = computeRelationshipMapNewIds(map.nodes, map.edges, highlightSince);
  sendJson(res, 200, {
    ...map,
    newNodeIds,
    newEdgeIds,
    highlightMode: sinceDate ? "since_visit" : "last_24h",
    highlightSince: highlightSince.toISOString()
  });
}

function emptyStakeholderModel(bill) {
  return {
    lawmakers: [],
    committees: [],
    lobbying: [],
    tickerImpacts: (bill.affected || []).map((symbol) => ({
      symbol,
      direction: "watch",
      impact: "Scenario watch",
      mechanism: bill.impact || "Impact channel not mapped yet."
    })),
    analog: "No historical analog mapped yet.",
    nextWatch: "Committee action, cosponsor changes, and lobbying filings."
  };
}

function compactDollars(value) {
  const amount = Number(value || 0);
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  if (amount >= 1e3) return `$${Math.round(amount / 1e3)}K`;
  return `$${amount.toFixed(0)}`;
}

function slug(value) {
  return String(value || "node")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Instant quote for deadline backfill — cache or static seed only, no network I/O. */
function quoteSnapshotCachedOrFallback(symbol, { pending = false } = {}) {
  const freshLive = cachedQuoteFresh(symbol);
  if (freshLive && isLiveQuoteSource(freshLive.quote.source)) {
    const quote = withQuoteFreshness(
      freshLive.quote,
      freshLive.quote.source,
      freshLive.quote.providerTimestamp || freshLive.quote.timestamp
    );
    return { source: quote.source, quote, cached: true };
  }
  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.cachedAt < QUOTE_CACHE_TTL_MS && quoteHasValidPrice(cached.quote)) {
    const quote = withQuoteFreshness(
      cached.quote,
      cached.quote.source,
      cached.quote.providerTimestamp || cached.quote.timestamp
    );
    if (pending && !isLiveQuoteSource(quote.source)) quote.pending = true;
    return { source: quote.source, quote, cached: true };
  }
  const fallbackRow = resolveCatalogFallbackQuote(symbol);
  if (fallbackRow) {
    const quote = withQuoteFreshness(
      fallbackRow,
      "fallback_static",
      fallbackRow?.timestamp || null
    );
    if (pending) quote.pending = true;
    quoteCache.set(symbol, { cachedAt: Date.now(), quote });
    return { source: "fallback", quote };
  }
  return { source: "fallback", quote: null };
}

async function quoteSnapshot(symbol) {
  const fallbackRow = resolveCatalogFallbackQuote(symbol) || null;
  const cached = quoteCache.get(symbol);
  if (
    cached &&
    Date.now() - cached.cachedAt < QUOTE_CACHE_TTL_MS &&
    quoteHasValidPrice(cached.quote) &&
    isLiveQuoteSource(cached.quote.source)
  ) {
    const quote = withQuoteFreshness(
      cached.quote,
      cached.quote.source,
      cached.quote.providerTimestamp || cached.quote.timestamp
    );
    return { source: quote.source, quote, cached: true };
  }

  const freshLive = cachedQuoteFresh(symbol);
  if (freshLive && isLiveQuoteSource(freshLive.quote.source)) {
    const quote = withQuoteFreshness(
      freshLive.quote,
      freshLive.quote.source,
      freshLive.quote.providerTimestamp || freshLive.quote.timestamp
    );
    return { source: quote.source, quote, cached: true };
  }

  if (process.env.FINNHUB_API_KEY && Date.now() >= finnhubCooldownUntil) {
    try {
      const finnhubResult = await withFinnhubSlot((token) => fetchFinnhubQuote(symbol, token));
      if (finnhubResult) return finnhubResult;
    } catch (error) {
      logQuoteProviderError("Finnhub", symbol, error?.message || String(error));
    }
  }

  const yfinanceQuote = await yfinanceQuoteSnapshot(symbol);
  if (yfinanceQuote) {
    const quote = withQuoteFreshness(yfinanceQuote, "yfinance", yfinanceQuote.timestamp);
    quoteCache.set(symbol, { cachedAt: Date.now(), quote });
    return { source: "yfinance", quote };
  }

  if (Date.now() >= yahooCooldownUntil) {
    // Set the cooldown before awaiting so concurrent workers that pass this
    // check in the same tick don't all dogpile Yahoo and each re-log/re-trip
    // the breaker once it expires.
    yahooCooldownUntil = Date.now() + YAHOO_COOLDOWN_MS;
    const yahooQuote = await yahooQuoteSnapshot(symbol);
    if (yahooQuote) {
      yahooCooldownUntil = 0;
      const quote = withQuoteFreshness(yahooQuote, "yahoo_chart", yahooQuote.timestamp);
      quoteCache.set(symbol, { cachedAt: Date.now(), quote });
      return { source: "yahoo_chart", quote };
    }
    if (!quoteProviderErrorAt.has("yahoo:_cooldown")) {
      quoteProviderErrorAt.set("yahoo:_cooldown", Date.now());
      console.warn(`[data] Yahoo chart unavailable — pausing Yahoo for ${Math.round(YAHOO_COOLDOWN_MS / 1000)}s; serving cached/fallback prices.`);
    }
  }

  if (
    STOOQ_QUOTES_ENABLED &&
    isStooqEligibleSymbol(symbol) &&
    Date.now() >= stooqCooldownUntil
  ) {
    const stooqQuote = await stooqQuoteSnapshot(symbol);
    if (stooqQuote) {
      const quote = withQuoteFreshness(stooqQuote, "stooq_public", stooqQuote.timestamp);
      quoteCache.set(symbol, { cachedAt: Date.now(), quote });
      return { source: "stooq_public", quote };
    }
  }

  if (fallbackRow) {
    const quote = withQuoteFreshness(
      fallbackRow,
      "fallback_static",
      fallbackRow?.timestamp || null
    );
    quoteCache.set(symbol, { cachedAt: Date.now(), quote });
    return { source: "fallback", quote };
  }
  return { source: "fallback", quote: fallbackRow };
}

async function yahooQuoteSnapshot(symbol) {
  try {
    const response = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`,
      {},
      9000
    );
    if (!response.ok) throw new Error(`yahoo_quote_${response.status}`);
    const data = await response.json();
    const result = data.chart?.result?.[0];
    const meta = result?.meta || {};
    const quote = result?.indicators?.quote?.[0] || {};
    const closes = (quote.close || []).filter((value) => value != null);
    const opens = (quote.open || []).filter((value) => value != null);
    const highs = (quote.high || []).filter((value) => value != null);
    const lows = (quote.low || []).filter((value) => value != null);
    const price = Number(meta.regularMarketPrice ?? closes[closes.length - 1]);
    if (!Number.isFinite(price) || price <= 0) return null;
    const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPreviousClose);
    const change = Number.isFinite(prevClose) && prevClose > 0 ? price - prevClose : null;
    const pct = change != null ? (change / prevClose) * 100 : null;
    return {
      symbol,
      price,
      change,
      changePercent: pct,
      pct,
      high: Number(meta.regularMarketDayHigh ?? Math.max(...highs)),
      low: Number(meta.regularMarketDayLow ?? Math.min(...lows)),
      open: Number(meta.regularMarketOpen ?? opens[0]),
      prevClose: Number.isFinite(prevClose) ? prevClose : null,
      previousClose: Number.isFinite(prevClose) ? prevClose : null,
      timestamp: meta.regularMarketTime ? new Date(Number(meta.regularMarketTime) * 1000).toISOString() : new Date().toISOString(),
      source: "yahoo_chart"
    };
  } catch (error) {
    logQuoteProviderError("Yahoo", symbol, error?.message || String(error));
    return null;
  }
}

async function stooqQuoteSnapshot(symbol) {
  if (!isStooqEligibleSymbol(symbol)) return null;
  try {
    const stooqSymbol = toStooqSymbol(symbol);
    const response = await fetchWithTimeout(
      `https://stooq.pl/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`,
      { headers: { "User-Agent": "TradeSimple/1.0 (+https://tradesimple.app)" } },
      8000
    );
    if (!response.ok) {
      if (response.status === 404) {
        stooqCooldownUntil = Date.now() + STOOQ_COOLDOWN_MS;
      }
      throw new Error(`stooq_${response.status}`);
    }
    const csv = await response.text();
    const line = csv.trim().split(/\r?\n/).pop();
    if (!line || /^N\/D/i.test(line)) return null;
    const [, , , open, high, low, close] = line.split(",");
    const price = Number(close);
    if (!Number.isFinite(price) || price <= 0) return null;
    const openNum = Number(open);
    const change = Number.isFinite(openNum) && openNum > 0 ? price - openNum : null;
    const pct = change != null ? (change / openNum) * 100 : null;
    return {
      symbol,
      price,
      change,
      changePercent: pct,
      pct,
      high: Number(high) || null,
      low: Number(low) || null,
      open: Number.isFinite(openNum) ? openNum : null,
      timestamp: new Date().toISOString(),
      source: "stooq_public"
    };
  } catch (error) {
    const message = error?.message || String(error);
    noteStooqBatchFailure(symbol, message);
    return null;
  }
}

function metricExplanations(fundamentals) {
  const metrics = [
    {
      id: "pe",
      label: "P/E ratio",
      raw: fundamentals.pe,
      value: formatMultiple(fundamentals.pe),
      tone: fundamentals.pe > 55 ? "amber" : fundamentals.pe < 22 ? "green" : "neutral",
      plain: "What investors pay for $1 of current earnings.",
      takeaway: fundamentals.pe > 55
        ? "High P/E means the market expects big future growth. It can work, but misses get punished."
        : fundamentals.pe < 22
          ? "Lower P/E means expectations are more restrained, but it can also signal slower growth."
          : "Middle-range P/E: valuation matters, but earnings quality and growth matter just as much."
    },
    {
      id: "forwardPe",
      label: "Forward P/E",
      raw: fundamentals.forwardPe,
      value: formatMultiple(fundamentals.forwardPe),
      tone: fundamentals.forwardPe > 40 ? "amber" : fundamentals.forwardPe < 20 ? "green" : "neutral",
      plain: "What investors pay for next year's expected earnings.",
      takeaway: "If forward P/E is much lower than current P/E, analysts expect earnings to grow into the valuation."
    },
    {
      id: "ps",
      label: "Price / sales",
      raw: fundamentals.ps,
      value: formatMultiple(fundamentals.ps),
      tone: fundamentals.ps > 15 ? "amber" : fundamentals.ps < 5 ? "green" : "neutral",
      plain: "What investors pay for $1 of company revenue.",
      takeaway: "Useful when earnings are volatile. High P/S only makes sense if margins and growth are strong."
    },
    {
      id: "grossMargin",
      label: "Gross margin",
      raw: fundamentals.grossMargin,
      value: formatPercent(fundamentals.grossMargin),
      tone: fundamentals.grossMargin >= 55 ? "green" : fundamentals.grossMargin < 25 ? "amber" : "neutral",
      plain: "How much money remains after direct product costs.",
      takeaway: "Higher gross margin gives a business more room to invest, discount, and survive slowdowns."
    },
    {
      id: "revenueGrowth",
      label: "Revenue growth",
      raw: fundamentals.revenueGrowth,
      value: formatPercent(fundamentals.revenueGrowth),
      tone: fundamentals.revenueGrowth >= 20 ? "green" : fundamentals.revenueGrowth < 5 ? "amber" : "neutral",
      plain: "How fast sales are growing.",
      takeaway: "Growth is the fuel that can justify a premium valuation. Slowing growth makes high multiples fragile."
    },
    {
      id: "beta",
      label: "Beta",
      raw: fundamentals.beta,
      value: fundamentals.beta == null ? "N/A" : Number(fundamentals.beta).toFixed(2),
      tone: fundamentals.beta >= 1.6 ? "amber" : fundamentals.beta <= 0.8 ? "green" : "neutral",
      plain: "How jumpy the stock tends to be compared with the market.",
      takeaway: "Beta above 1 usually means bigger swings than the S&P 500. That cuts both ways."
    }
  ];
  return metrics.filter((metric) => metric.raw != null);
}

function valuationBars(fundamentals) {
  return [
    { label: "P/E", value: capScore(Number(fundamentals.pe || 0), 80), display: formatMultiple(fundamentals.pe), explain: "Current earnings multiple" },
    { label: "Forward P/E", value: capScore(Number(fundamentals.forwardPe || 0), 60), display: formatMultiple(fundamentals.forwardPe), explain: "Next-year earnings multiple" },
    { label: "P/S", value: capScore(Number(fundamentals.ps || 0), 35), display: formatMultiple(fundamentals.ps), explain: "Revenue multiple" }
  ].filter((item) => item.display !== "N/A");
}

function qualityBars(fundamentals) {
  const debt = fundamentals.debtToEquity == null ? null : Math.max(0, 100 - capScore(Number(fundamentals.debtToEquity), 2.5));
  return [
    { label: "Gross margin", value: Number(fundamentals.grossMargin || 0), display: formatPercent(fundamentals.grossMargin), explain: "Pricing power and cost control" },
    { label: "Revenue growth", value: capScore(Number(fundamentals.revenueGrowth || 0), 60), display: formatPercent(fundamentals.revenueGrowth), explain: "Top-line momentum" },
    { label: "Free cash flow", value: capScore(Number(fundamentals.freeCashFlowMargin || 0), 40), display: formatPercent(fundamentals.freeCashFlowMargin), explain: "Cash generation after reinvestment" },
    { label: "Balance sheet", value: debt, display: fundamentals.debtToEquity == null ? "N/A" : `${Number(fundamentals.debtToEquity).toFixed(2)}x D/E`, explain: "Higher score means less debt pressure" }
  ].filter((item) => item.value != null && item.display !== "N/A");
}

function seededWalkStep(seed, index) {
  const x = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function buildPriceSeries(symbol, quote) {
  const price = Number(quote.price || MARKET_FALLBACK[symbol]?.price || 100);
  const seed = symbol.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const count = 48;
  const slope = Number(quote.pct || 0) / 100;
  const vol = 0.008 + Number(FUNDAMENTALS[symbol]?.beta || 1) * 0.004;
  let walk = price / (1 + slope) || price;
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const shock = (seededWalkStep(seed, i) - 0.5) * vol;
    walk = Math.max(1, walk * (1 + shock));
    points.push({
      label: i % 8 === 0 ? `${count - i}d` : "",
      value: Number(walk.toFixed(2))
    });
  }
  points[count - 1].value = Number(price.toFixed(2));
  points[count - 1].label = "now";
  return points;
}

function buildHistoricalSeries(symbol, range, quote) {
  const count = historyPointCount(range);
  const price = Number(quote.price || MARKET_FALLBACK[symbol]?.price || 100);
  const seed = symbol.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const dailySlope = Number(quote.pct || 0) / 100 / Math.max(10, count / 2);
  const intraday = range === "1d" || range === "1w";
  const stepMs = range === "1d" ? 5 * 60000 : range === "1w" ? 30 * 60000 : 86400000;
  const vol = intraday ? 0.0045 : 0.012 + Number(FUNDAMENTALS[symbol]?.beta || 1) * 0.003;
  let close = price / (1 + dailySlope * (count - 1)) || price;
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const stepsBack = count - 1 - i;
    const shock = (seededWalkStep(seed, i + 3) - 0.5) * vol;
    const drift = 1 + dailySlope;
    close = Math.max(1, close * drift * (1 + shock));
    const wick = close * (0.003 + seededWalkStep(seed, i + 99) * 0.008);
    const open = i === 0 ? close : Number(points[i - 1].close);
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick;
    const date = intraday
      ? new Date(Date.now() - stepsBack * stepMs).toISOString().slice(0, 16)
      : new Date(Date.now() - stepsBack * 86400000).toISOString().slice(0, 10);
    points.push({
      date,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.round(800000 + seededWalkStep(seed, i + 7) * 4200000)
    });
  }
  points[points.length - 1].close = Number(price.toFixed(2));
  points[points.length - 1].high = Math.max(points[points.length - 1].high, price);
  points[points.length - 1].low = Math.min(points[points.length - 1].low, price);
  return points;
}

function historyPointCount(range) {
  return {
    "1d": 78,
    "1w": 65,
    "1m": 22,
    "3m": 66,
    "6m": 126,
    "1y": 252,
    "5y": 260
  }[range] || 126;
}

function rangeSeconds(range) {
  return {
    "1d": 30 * 60 * 60,
    "1w": 8 * 86400,
    "1m": 35 * 86400,
    "3m": 100 * 86400,
    "6m": 200 * 86400,
    "1y": 390 * 86400,
    "5y": 1850 * 86400
  }[range] || 200 * 86400;
}

/** Finnhub candle resolution for TradeSimple trade-range chips (1d–1y). */
function finnhubHistoryResolution(range) {
  if (range === "1d") return "5";
  if (range === "1w") return "30";
  if (range === "1y" || range === "5y") return "W";
  return "D";
}

function historyMinPoints(range) {
  if (range === "1d") return 12;
  if (range === "1w") return 8;
  return 10;
}

/** Yahoo chart API range param (1m/3m/6m are months, not minutes). */
function yahooChartRangeParam(range) {
  return {
    "1d": "1d",
    "1w": "5d",
    "1m": "1mo",
    "3m": "3mo",
    "6m": "6mo",
    "1y": "1y",
    "5y": "5y"
  }[range] || "6mo";
}

function historyStats(points) {
  const closes = points.map((point) => Number(point.close || 0)).filter(Boolean);
  if (!closes.length) return {};
  const first = closes[0];
  const last = closes[closes.length - 1];
  const max = Math.max(...closes);
  const min = Math.min(...closes);
  const change = last - first;
  return {
    first,
    last,
    high: max,
    low: min,
    change,
    pct: first ? (change / first) * 100 : 0
  };
}

function downsampleHistoryPoints(points, max) {
  if (!Array.isArray(points) || !points.length || points.length <= max) return points;
  const out = [];
  const step = (points.length - 1) / Math.max(1, max - 1);
  for (let i = 0; i < max; i += 1) {
    out.push(points[Math.min(points.length - 1, Math.round(i * step))]);
  }
  return out;
}

async function stooqHistory(symbol, fromUnix, toUnix) {
  if (!isStooqEligibleSymbol(symbol)) return [];
  try {
    const stooqSymbol = toStooqSymbol(symbol);
    const d1 = dateForStooq(new Date(fromUnix * 1000));
    const d2 = dateForStooq(new Date(toUnix * 1000));
    const response = await fetchWithTimeout(
      `https://stooq.pl/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&d1=${d1}&d2=${d2}&i=d`,
      {},
      9000
    );
    if (!response.ok) {
      if (response.status === 404) stooqCooldownUntil = Date.now() + STOOQ_COOLDOWN_MS;
      throw new Error(`stooq_${response.status}`);
    }
    const csv = await response.text();
    const rows = csv.trim().split(/\r?\n/).slice(1);
    return rows.map((row) => {
      const [date, open, high, low, close, volume] = row.split(",");
      return {
        date,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume || 0)
      };
    }).filter((point) => point.date && Number.isFinite(point.close));
  } catch {
    return [];
  }
}

async function yahooHistory(symbol, range) {
  try {
    const interval = range === "1d" ? "5m" : range === "1w" ? "30m" : range === "1y" || range === "5y" ? "1wk" : "1d";
    const yahooRange = yahooChartRangeParam(range);
    const response = await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${encodeURIComponent(yahooRange)}`, {}, 9000);
    if (!response.ok) throw new Error(`yahoo_${response.status}`);
    const data = await response.json();
    const result = data.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const quote = result?.indicators?.quote?.[0] || {};
    const closes = quote.close || [];
    return closes.map((close, index) => {
      if (close == null || !timestamps[index]) return null;
      const iso = new Date(timestamps[index] * 1000).toISOString();
      return {
        date: iso.slice(0, range === "1d" || range === "1w" ? 16 : 10),
        open: Number(quote.open?.[index] || close),
        high: Number(quote.high?.[index] || close),
        low: Number(quote.low?.[index] || close),
        close: Number(close),
        volume: Number(quote.volume?.[index] || 0)
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function dateForStooq(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function buildPolicyChains(symbol, bills) {
  const billChains = bills.length === 0
    ? [{
        title: "No mapped bill pressure",
        tone: "neutral",
        summary: `${symbol} does not currently have a high-confidence bill mapping in this build.`,
        steps: [
          { label: "Government Action", text: "Congress.gov still loads records, but no bill is tagged to this company or sector yet." },
          { label: "Company Exposure", text: "No direct revenue, margin, capex, contract, or compliance channel is mapped in this snapshot." },
          { label: "Market Mechanism", text: "Price action is more likely coming from company fundamentals or broad-market conditions until a government signal maps cleanly." },
          { label: "Investor Question", text: "Watch for a new bill, agency rule, contract award, or SEC risk disclosure that changes the mechanism." }
        ]
      }]
    : bills.map((bill) => {
        const against = Number(bill.lobbyingAgainst || 0);
        const lobbyingText =
          bill.lobbyingSource === "senate_lda" && against >= 1
            ? `$${against.toFixed(1)}M LDA-reported spend against (matched filings).`
            : bill.lobbyingSource === "senate_lda" && Number(bill.lobbyingFor || 0) >= 1
              ? `$${Number(bill.lobbyingFor).toFixed(1)}M LDA-reported spend for (matched filings).`
              : bill.lobbyingFilingsCount > 0
                ? `${bill.lobbyingFilingsCount} LDA filing(s) matched — review amounts in Bills detail.`
                : "No LDA filings matched this bill yet.";
        const lm = computeLegislativeMomentum(bill);
        const conf = billSignalConfidence(bill);
        return {
          title: `${bill.title} → ${symbol}`,
          tone: lm >= 67 ? "green" : lm < 35 ? "red" : "amber",
          summary: stockImpactChannel(symbol, bill),
          steps: [
            { label: "Government Action",  text: `${bill.status} stage. Legislative momentum ${lm}/100. Confidence: ${conf}. Latest: ${bill.latestAction}. ${lobbyingText}` },
            { label: "Company Exposure",    text: `${symbol} is mapped to this issue through ${plainList(bill.tags || ["policy exposure"])}.` },
            { label: "Market Mechanism",    text: stockImpactChannel(symbol, bill) },
            { label: "Investor Question",    text: bill.nextWatch || "Watch the next official action, amendment language, and lobbying filings." }
          ]
        };
      });

  // Add government contract chain for tracked symbols
  const contractProfile = CONTRACT_PROFILES[symbol];
  if (contractProfile) {
    const pct = Math.round(contractProfile.governmentRevenuePct * 100);
    const agency = contractProfile.primaryAgencies[0] || "federal agencies";
    const program = contractProfile.primaryPrograms[0] || "government programs";
    const dogeFlag = contractProfile.dogeRisk
      ? "Agency efficiency reviews are flagged as active — higher-than-average risk."
      : "No active efficiency review flagged for primary agencies.";
    billChains.push({
      title: `Government contract revenue → ${symbol}`,
      tone: contractProfile.agencyBudgetRisk === "high" ? "red"
        : contractProfile.agencyBudgetRisk === "medium" ? "amber" : "green",
      summary: `${pct}% of ${symbol} revenue comes from government contracts. ${contractProfile.archetypeExplain}`,
      steps: [
        {
          label: "Government Action",
          text: `${pct}% of annual revenue is from government contracts. Primary agency: ${agency}. Key programs: ${contractProfile.primaryPrograms.slice(0, 2).join(", ")}.`
        },
        {
          label: "Company Exposure",
          text: "Not all awards are equal. Smaller, unexpected awards from less-covered agencies (like HHS or VA) have historically produced stronger stock reactions than large, pre-announced defense awards. Large IDIQs are often already known to the market before they appear on USASpending."
        },
        {
          label: "Market Mechanism",
          text: `${dogeFlag} Agency budget risk: ${contractProfile.agencyBudgetRisk}. Renewal risk: ${Math.round(contractProfile.renewalRisk * 100)}% of contracts approaching expiry.`
        },
        {
          label: "Investor Question",
          text: `Watch whether awards, recompetes, or agency budgets confirm the revenue path. Positive scenario: ${contractProfile.bull} Risk scenario: ${contractProfile.bear}`
        }
      ]
    });
  }

  return billChains.map(addPolicyChainAliases);
}

function addPolicyChainAliases(chain) {
  const steps = chain.steps || [];
  const byLabel = (label) => steps.find((step) => step.label === label)?.text || "";
  return {
    ...chain,
    governmentAction: chain.governmentAction || byLabel("Government Action"),
    companyExposure: chain.companyExposure || byLabel("Company Exposure"),
    marketMechanism: chain.marketMechanism || byLabel("Market Mechanism"),
    investorQuestion: chain.investorQuestion || byLabel("Investor Question")
  };
}

function stockImpactChannel(symbol, bill) {
  const title = bill.title.toLowerCase();
  if (title.includes("drug") && symbol === "LLY") return "If Medicare negotiation expands, Lilly's GLP-1 pricing power becomes the market question.";
  if (title.includes("chips") && ["NVDA", "AMD", "TSM"].includes(symbol)) return "CHIPS implementation lowers supply-chain risk and can support semiconductor capex expectations.";
  if (title.includes("platform") && ["AMZN", "AAPL", "GOOGL", "META"].includes(symbol)) return "If platform regulation dies, the antitrust discount can fade. If it revives, margins and product placement get questioned.";
  if (title.includes("digital asset") && symbol === "COIN") return "Crypto market-structure clarity can lower regulatory uncertainty for Coinbase and institutional custody.";
  if (title.includes("permitting") && symbol === "TSLA") return "Faster permitting can help factories, charging, and energy projects move faster, but it does not solve EV demand by itself.";
  return bill.impact || "Map the bill mechanism to revenue, margin, capex, or valuation multiple before treating it as a trade signal.";
}

function apiExplanations(symbol) {
  return [
    {
      name: "Finnhub quotes",
      status: process.env.FINNHUB_API_KEY ? "connected" : "fallback",
      what: "Live or fallback stock prices, daily change, open, high, and low.",
      investorUse: "Shows what the market is doing now, but price alone does not explain why.",
      causalChain: "Quote move -> compare against fundamentals and policy events -> decide whether the move is noise or scenario repricing."
    },
    {
      name: "Congress.gov",
      status: process.env.CONGRESS_API_KEY ? "connected" : "fallback",
      what: "Bill titles, chamber, latest action, and legislative status.",
      investorUse: "Committee movement and floor action can turn a political idea into a market event.",
      causalChain: "Bill advances -> legislative momentum rises -> affected ticker risk/reward changes."
    },
    {
      name: "LDA.gov lobbying",
      status: process.env.SENATE_LDA_API_KEY ? "connected" : "fallback",
      what: "Lobbying filings, clients, registrants, issue areas, and spend when available.",
      investorUse: "A sudden spend spike often means the industry thinks the bill has teeth.",
      causalChain: "Lobbyist filing -> pressure around a bill -> investors reassess stock revenue, margins, or regulation risk."
    },
    {
      name: "CoinGecko crypto",
      status: process.env.COINGECKO_API_KEY ? "connected" : "public/fallback",
      what: "Crypto spot prices, 24-hour change, and market cap.",
      investorUse: symbol === "COIN" ? "Helps connect crypto market activity to Coinbase transaction and custody economics." : "Useful for crypto exposure and risk mood.",
      causalChain: "Crypto price/volume regime -> exchange activity changes -> crypto-linked equities reprice."
    },
    {
      name: "Alpaca paper trading",
      status: process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY ? "connected" : "simulated",
      what: "Paper account and order submission.",
      investorUse: "Lets you test the thesis without turning analysis into real-money execution.",
      causalChain: "Thesis -> paper order -> track outcome -> improve the model before risking capital."
    }
  ];
}

function analysisPromptHints(symbol) {
  return [
    `Explain ${symbol}'s P/E ratio in one paragraph for a beginner.`,
    `Which bill could move ${symbol}, and what is the revenue or margin mechanism?`,
    `Build a bull, base, and bear scenario for ${symbol} using valuation plus policy risk.`
  ];
}

function valuationRiskScore(fundamentals) {
  const pe = capScore(Number(fundamentals.pe || 0), 80);
  const ps = capScore(Number(fundamentals.ps || 0), 30);
  return Math.round((pe * 0.65) + (ps * 0.35));
}

function debtRiskScore(debtToEquity) {
  if (debtToEquity == null) return 28;
  return capScore(Number(debtToEquity), 2.5);
}

function capScore(value, max) {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

function formatMultiple(value) {
  return value == null ? "N/A" : `${Number(value).toFixed(1)}x`;
}

function formatPercent(value) {
  return value == null ? "N/A" : `${Number(value).toFixed(1)}%`;
}

async function cryptoPrices(res, url) {
  const ids = (url.searchParams.get("ids") || "bitcoin,ethereum,solana")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 25);
  const key = process.env.COINGECKO_API_KEY;
  const pro = process.env.COINGECKO_PRO === "true";
  const base = pro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
  const priceUrl = `${base}/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true&include_last_updated_at=true`;
  const headers = key ? { [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key } : {};

  const cryptoDisplayName = (id) =>
    ({ bitcoin: "Bitcoin", ethereum: "Ethereum", solana: "Solana" }[id] || id.replace(/-/g, " "));

  try {
    const response = await fetchWithTimeout(priceUrl, { headers }, 7000);
    if (!response.ok) throw new Error(`coingecko_${response.status}`);
    const data = await response.json();
    const assets = Object.entries(data).map(([id, value]) => ({
      id,
      name: cryptoDisplayName(id),
      symbol: id === "bitcoin" ? "BTC" : id === "ethereum" ? "ETH" : id === "solana" ? "SOL" : id.toUpperCase(),
      price: value.usd,
      pct: value.usd_24h_change,
      change24h: value.usd_24h_change,
      marketCap: value.usd_market_cap,
      lastUpdatedAt: value.last_updated_at ? new Date(value.last_updated_at * 1000).toISOString() : null
    }));
    sendJson(res, 200, {
      source: key ? "coingecko" : "coingecko_public",
      assets,
      confidence: key ? "High" : "Medium",
      updatedAt: new Date().toISOString()
    });
  } catch {
    const assets =
      ids.length > 0
        ? ids.map((id) => {
            const row = CRYPTO_FALLBACK[id];
            if (row && row.price != null) {
              return { id, change24h: row.pct, ...row };
            }
            return {
              id,
              name: `${cryptoDisplayName(id)} (offline sample)`,
              symbol: id === "bitcoin" ? "BTC" : id === "ethereum" ? "ETH" : id === "solana" ? "SOL" : id.slice(0, 4).toUpperCase(),
              price: null,
              pct: null,
              change24h: null,
              marketCap: null,
              placeholder: true
            };
          })
        : Object.entries(CRYPTO_FALLBACK).map(([id, row]) => ({ id, change24h: row.pct, ...row }));
    sendJson(res, 200, {
      source: "fallback",
      assets,
      confidence: "Medium",
      updatedAt: new Date().toISOString()
    });
  }
}

function parseSeedBillId(id) {
  return parseBillIdToCongressRef(id);
}

const PROCEDURAL_CONGRESS_ACTION =
  /^(read the first time|read twice|referred to|received in|held at the desk|message on senate action|cleared for white house|sponsor introductory remarks)/i;

const LIVE_BILL_KEYWORDS = [
  "drug", "pharma", "health", "medicare", "medicaid", "prescription",
  "chip", "semiconductor", "microchip",
  "artificial intelligence", "machine learning", "algorithmic", " ai ",
  "crypto", "digital asset", "bitcoin", "blockchain", "stablecoin",
  "energy", "vehicle", "electric", "solar", "wind", "clean energy", "charging",
  "platform", "antitrust", "monopoly", "competition", "big tech", "app store",
  "defense", "military", "pentagon", "national security", "procurement",
  "bank", "financial institution", "lending", "federal reserve",
  "trade", "tariff", "import", "export", "china", "foreign investment",
  "broadband", "telecom", "5g", "spectrum", "internet access",
  "tax", "corporate tax", "capital gains",
  "data", "privacy", "cybersecurity", "surveillance",
  "climate", "carbon", "emission",
  "foreign affairs", "international relations", "diplomatic", "caucasus",
  "ice", "border patrol", "homeland security", "immigration", "detention", "customs", "dhs", "secure america", "enforcement"
];

function pickSubstantiveCongressAction(actions = [], fallbackText = "") {
  const sorted = [...(actions || [])].sort(
    (a, b) => new Date(b.actionDate || 0).getTime() - new Date(a.actionDate || 0).getTime()
  );
  const cleanRow = (row) => {
    const text = String(row.text || row.actionText || "").trim();
    if (!text || PROCEDURAL_CONGRESS_ACTION.test(text)) return null;
    return { text, actionDate: row.actionDate || row.date || null };
  };
  const isPassageAction = (text) =>
    /passed\s+(house|senate)/i.test(text) ||
    /agreed to in (the )?(house|senate)/i.test(text) ||
    (/on passage/i.test(text) && /\bpassed\b/i.test(text)) ||
    (/motion to reconsider/i.test(text) && /(laid on the table|table)/i.test(text)) ||
    (/\bpassed\b/i.test(text) && !/committee/i.test(text) && /yeas and nays|roll call|without amendment/i.test(text));
  const tierMatchers = [
    (text) => /became public law|signed by president|signed into law|presented to president|to president/i.test(text),
    isPassageAction,
    (text) => /conference|resolving differences/i.test(text),
    (text) => /rules committee|provides for consideration|floor|calendar/i.test(text),
    (text) =>
      /passed|agreed to|reported|markup|hearing|veto|failed/i.test(text)
  ];
  for (const match of tierMatchers) {
    for (const row of sorted) {
      const item = cleanRow(row);
      if (item && match(item.text)) return item;
    }
  }
  for (const row of sorted) {
    const item = cleanRow(row);
    if (item) return item;
  }
  return fallbackText ? { text: fallbackText, actionDate: null } : null;
}

function parseBillStageFromAction(latestAction = "", actionHistory = null, bill = {}) {
  let action = String(latestAction || "").trim();
  let actionDate = bill.latestActionDate || null;
  if (Array.isArray(actionHistory) && actionHistory.length) {
    const picked = pickSubstantiveCongressAction(actionHistory, action);
    if (picked?.text) {
      action = picked.text;
      actionDate = picked.actionDate || actionDate;
    }
  }
  const s = action.toLowerCase();
  const passedCommittee = /passed\s+(house|senate)\s+[^.]{0,90}committee/.test(s);
  let statusKey = "introduced";
  let floorScheduled = Boolean(bill.floorScheduled);

  if (s.includes("failed cloture") || s.includes("failed") || s.includes("withdrawn") || s.includes("dead")) statusKey = "failed";
  else if (s.includes("veto")) statusKey = "vetoed";
  else if (s.includes("incorporated") || s.includes("included in") || s.includes("folded into")) statusKey = "incorporated";
  else if (
    s.includes("became public law") ||
    s.includes("signed by president") ||
    s.includes("signed into law") ||
    s.includes("presented to president") ||
    s.includes("to president")
  ) {
    statusKey = "enacted";
  } else if (s.includes("conference") || s.includes("resolving differences")) statusKey = "resolving";
  else if (s.includes("motion to reconsider") && (s.includes("laid on the table") || s.includes("table"))) statusKey = "passed_one_chamber";
  else if (passedCommittee) statusKey = "reported";
  else if (
    s.includes("passed senate") ||
    s.includes("passed house") ||
    s.includes("passed one chamber") ||
    s.includes("agreed to in house") ||
    s.includes("agreed to in the house") ||
    s.includes("agreed to in senate") ||
    (s.includes("agreed to") && s.includes("house")) ||
    (/on passage.*passed/i.test(action) && /house|senate/i.test(action))
  ) {
    statusKey = "passed_one_chamber";
  } else if (/\bpassed\b/.test(s) && !s.includes("committee") && (s.includes("without amendment") || s.includes("yeas and nays") || s.includes("roll call"))) {
    statusKey = "passed_one_chamber";
  } else if (
    s.includes("rules committee") &&
    (s.includes("consideration") || s.includes("provides for") || s.includes("calendar") || /\bs\.\s*\d+\b/.test(s))
  ) {
    statusKey = "floor";
    floorScheduled = true;
  } else if (floorScheduled || s.includes("floor") || s.includes("calendar")) statusKey = "floor";
  else if (s.includes("reported") || s.includes("ordered to be reported")) statusKey = "reported";
  else if (s.includes("markup") || s.includes("hearing held") || s.includes("hearing")) statusKey = "markup";
  else if (s.includes("committee") || s.includes("referred")) statusKey = "committee";
  else if (s.includes("introduced") || s.includes("live")) statusKey = "introduced";

  return {
    statusKey,
    latestAction: action,
    latestActionDate: actionDate,
    lastSubstantiveActionDate: actionDate,
    floorScheduled
  };
}

function coarseBillStatusFromStageKey(statusKey, fallback = "introduced") {
  if (statusKey === "enacted") return "passed";
  if (["passed_one_chamber", "resolving", "floor"].includes(statusKey)) return "floor";
  if (["reported", "markup"].includes(statusKey)) return "markup";
  if (statusKey === "committee") return "committee";
  if (["failed", "vetoed", "incorporated"].includes(statusKey)) return fallback || "introduced";
  return fallback || "introduced";
}

async function fetchCongressBillActions(baseUrl, qs) {
  try {
    const resp = await fetchWithTimeout(`${baseUrl}/actions?${qs}&limit=40&sort=actionDate+desc`, {}, 8000);
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.actions || []).map((row) => ({
      text: row.text || row.actionText || "",
      actionDate: row.actionDate || row.date || null
    }));
  } catch {
    return [];
  }
}

function mapCongressBillDetailToOverlay(b, ref, committees = [], actions = []) {
  const picked = pickSubstantiveCongressAction(actions, b.latestAction?.text || "");
  const latestAction = picked?.text || b.latestAction?.text || "Updated by Congress.gov";
  const latestActionDate = picked?.actionDate || b.latestAction?.actionDate || b.updateDate || null;
  const stage = parseBillStageFromAction(latestAction, actions, { floorScheduled: false, latestActionDate });
  const sponsors = Array.isArray(b.sponsors) ? b.sponsors : [];
  const sp = sponsors[0];
  const policyArea = b.policyArea?.name || b.policyArea || null;
  return {
    title: b.title || ref?.id,
    introducedDate: b.introducedDate || null,
    policyArea: policyArea ? String(policyArea) : null,
    committees,
    _committeeNames: committees.map((c) => c.name).filter(Boolean),
    latestAction,
    latestActionDate,
    lastSubstantiveActionDate: stage.lastSubstantiveActionDate || latestActionDate,
    actions,
    _congressActions: actions,
    cosponsors: b.cosponsors?.count != null ? Number(b.cosponsors.count) : null,
    status: coarseBillStatusFromStageKey(stage.statusKey),
    exactCongressRecord: true,
    floorScheduled: stage.floorScheduled,
    sponsor: sp
      ? { name: sp.fullName || sp.lastName || "", party: sp.party || "U", state: sp.state || "" }
      : null
  };
}

async function hydrateCongressOverlayWithActions(overlay, billId, key) {
  if (!overlay || !key) return overlay;
  if ((overlay.actions || overlay._congressActions || []).length) return overlay;
  const ref = parseBillIdToCongressRef(billId);
  if (!ref) return overlay;
  const baseUrl = `https://api.congress.gov/v3/bill/${ref.congress}/${ref.type}/${ref.number}`;
  const qs = `format=json&api_key=${encodeURIComponent(key)}`;
  const actions = await fetchCongressBillActions(baseUrl, qs);
  if (!actions.length) return overlay;
  const stage = parseBillStageFromAction(overlay.latestAction, actions, overlay);
  return {
    ...overlay,
    actions,
    _congressActions: actions,
    latestAction: stage.latestAction || overlay.latestAction,
    latestActionDate: stage.latestActionDate || overlay.latestActionDate,
    lastSubstantiveActionDate: stage.lastSubstantiveActionDate || overlay.lastSubstantiveActionDate,
    status: coarseBillStatusFromStageKey(stage.statusKey, overlay.status),
    floorScheduled: stage.floorScheduled
  };
}

async function refreshDynamicCongressRegistry(key) {
  const seedIds = new Set(POLICY_BILLS.map((b) => b.id));
  for (const id of [...liveCongressBillRegistry.keys()]) {
    if (!seedIds.has(id)) liveCongressBillRegistry.delete(id);
  }
  let added = 0;
  const liveResp = await fetchWithTimeout(
    `https://api.congress.gov/v3/bill/${CURRENT_CONGRESS}?format=json&limit=50&sort=updateDate+desc&api_key=${encodeURIComponent(key)}`,
    {},
    9000
  );
  if (!liveResp.ok) return added;
  const data = await liveResp.json();
  const seenIds = new Set(seedIds);
  for (const bill of data.bills || []) {
    const titleLower = (bill.title || "").toLowerCase();
    if (!LIVE_BILL_KEYWORDS.some((kw) => titleLower.includes(kw))) continue;
    const normalized = decorateBill(normalizeLiveCongressBill(bill));
    if (!seenIds.has(normalized.id) && normalized.affected?.length > 0) {
      seenIds.add(normalized.id);
      liveCongressBillRegistry.set(normalized.id, normalized);
      added += 1;
    }
  }
  return added;
}

function validateBillPipelineSample() {
  const pool = allBrowsablePolicyBills()
    .map((b) => decorateBill(mergeCongressLiveIntoBill(applyBillMarketExposure(b))))
    .filter((b) => b.affected?.length);
  const byMomentum = [...pool].sort((a, b) => computeLegislativeMomentum(b) - computeLegislativeMomentum(a));
  const byRecency = [...pool].sort((a, b) => {
    const da = new Date(a.lastSubstantiveActionDate || a.latestActionDate || 0).getTime();
    const db = new Date(b.lastSubstantiveActionDate || b.latestActionDate || 0).getTime();
    return db - da;
  });
  const sample = [...new Map([...byMomentum.slice(0, 10), ...byRecency.slice(0, 5)].map((b) => [b.id, b])).values()];
  const warnings = [];
  const rows = [];
  for (const bill of sample) {
    const stageKey = normalizeStatusKey(bill.status, bill.latestAction, bill);
    const why = buildWhyMarketsCareRules(bill, bill.affected || []);
    const row = { billId: bill.id, stageKey, affected: (bill.affected || []).slice(0, 4), ldaFilings: bill.lobbyingFilingsCount || 0 };
    if (!bill.affected?.length) warnings.push(`${bill.id}: empty affected`);
    if (/ICE and Border Patrol/i.test(why || "") && !isHomelandEnforcementCorpus(billExposureCorpus(bill), bill)) {
      warnings.push(`${bill.id}: homeland copy on non-homeland bill`);
    }
    if (bill.exactCongressRecord && /passed house/i.test(bill.latestAction || "") && stageKey === "introduced") {
      warnings.push(`${bill.id}: stage mismatch (passed house → ${stageKey})`);
    }
    if (process.env.SENATE_LDA_API_KEY && billLobbyingOverlay.get(bill.id)?.lobbyingFilingsCount > 0 && !bill.lobbyingSource) {
      warnings.push(`${bill.id}: LDA overlay not applied`);
    }
    rows.push(row);
  }
  return {
    checkedAt: new Date().toISOString(),
    sampleSize: rows.length,
    registrySize: liveCongressBillRegistry.size,
    warnings,
    rows
  };
}

function congressRefForBill(bill) {
  if (bill?.congressRef) return bill.congressRef;
  if (bill?.scenarioOnly || String(bill?.id || "").startsWith("scenario:")) return null;
  return parseBillIdToCongressRef(bill.id);
}

function applyLobbyingOverlay(bill) {
  const overlay = billLobbyingOverlay.get(bill.id);
  if (!overlay || overlay.lobbyingSource !== "senate_lda") return bill;
  return {
    ...bill,
    lobbyingAgainst: overlay.lobbyingAgainst,
    lobbyingFor: overlay.lobbyingFor,
    lobbyingSource: overlay.lobbyingSource,
    lobbyingFilingsCount: overlay.lobbyingFilingsCount,
    lobbyingPostedAt: overlay.lobbyingPostedAt || bill.lobbyingPostedAt || null,
    lobbyingNote: overlay.lobbyingNote || bill.lobbyingNote,
    _ldaRows: overlay.lobbyingRows || []
  };
}

function mergeCongressLiveIntoBill(bill) {
  const cached = congressLiveCache.get(bill.id);
  if (!cached) return applyLobbyingOverlay(bill);
  const isSeed = POLICY_BILLS.some((b) => b.id === bill.id);
  if (isSeed && !seedMetadataMatchesBill(cached, bill)) return applyLobbyingOverlay(bill);
  const stage = parseBillStageFromAction(
    cached.latestAction || bill.latestAction,
    cached.actions || cached._congressActions,
    { ...bill, floorScheduled: bill.floorScheduled }
  );
  return applyLobbyingOverlay({
    ...bill,
    title: cached.title || bill.title,
    introducedDate: cached.introducedDate || bill.introducedDate || null,
    policyArea: cached.policyArea || bill.policyArea || null,
    committees: cached.committees?.length ? cached.committees : bill.committees,
    _committeeNames: cached._committeeNames || bill._committeeNames,
    latestAction: stage.latestAction || cached.latestAction || bill.latestAction,
    latestActionDate: stage.latestActionDate || cached.latestActionDate || bill.latestActionDate,
    lastSubstantiveActionDate: cached.lastSubstantiveActionDate || stage.lastSubstantiveActionDate || stage.latestActionDate,
    actions: cached.actions || bill.actions,
    _congressActions: cached.actions || bill._congressActions,
    cosponsors: cached.cosponsors ?? bill.cosponsors,
    status: coarseBillStatusFromStageKey(stage.statusKey, cached.status || bill.status),
    floorScheduled: stage.floorScheduled || bill.floorScheduled,
    exactCongressRecord: true,
    _placeholderFacts: false,
    sponsor: cached.sponsor || bill.sponsor,
    sourceKind: "congress_exact",
    sourceNote: "Exact Congress.gov record (live refresh)."
  });
}

async function refreshCongressLiveCache() {
  const key = process.env.CONGRESS_API_KEY;
  if (!key) return { updated: 0, dynamic: 0 };
  const updates = await refreshSeedBillMetadata(key);
  for (const [id, payload] of updates.entries()) {
    congressLiveCache.set(id, payload);
    await writeCongressCache(id, payload);
    const seedBill = POLICY_BILLS.find((b) => b.id === id);
    if (seedBill) {
      const normalized = decorateBill(mergeCongressLiveIntoBill(seedBill));
      liveCongressBillRegistry.set(id, normalized);
    }
  }
  const dynamicCount = await refreshDynamicCongressRegistry(key).catch(() => 0);
  const trendingCount = await refreshTrendingCongressDiscoveries(key).catch(() => 0);
  if (updates.size || dynamicCount || trendingCount) {
    bumpLandingSignalCacheVersion();
    liveBillAnalysisCache.clear();
  }
  const decorated = POLICY_BILLS.map((b) => decorateBill(mergeCongressLiveIntoBill(b)));
  const liveBillCount = decorated.filter((b) => b.exactCongressRecord).length;
  noteFeedSuccess("bills", {
    source: "congress.gov",
    recordCount: decorated.length,
    liveCount: liveBillCount,
    scenarioCount: decorated.length - liveBillCount
  });
  return { updated: updates.size, dynamic: dynamicCount, trending: trendingCount };
}

async function refreshLdaLobbyingCache() {
  const key = process.env.SENATE_LDA_API_KEY;
  if (!key) {
    billLobbyingOverlay.clear();
    return { matched: 0, filings: 0 };
  }
  const filings = await fetchLdaFilings({
    apiKey: key,
    fetchFn: (url, opts) => fetchWithTimeout(url, opts || {}, 12_000)
  });
  const billPool = allBrowsablePolicyBills().map((b) => applyBillMarketExposure(b));
  const overlays = aggregateLobbyingForBills(billPool, filings);
  billLobbyingOverlay.clear();
  let matched = 0;
  for (const [id, payload] of overlays.entries()) {
    billLobbyingOverlay.set(id, payload);
    if (payload.lobbyingFilingsCount > 0) matched += 1;
  }
  noteFeedSuccess("lobbying", {
    source: "senate_lda",
    recordCount: filings.length
  });
  return { matched, filings: filings.length };
}

function dataHealthRoute(res) {
  const bills = POLICY_BILLS.map((b) => decorateBill(mergeCongressLiveIntoBill(b)));
  const liveBillCount = bills.filter((b) => b.exactCongressRecord).length;
  const scenarioBillCount = bills.filter((b) => b.scenarioOnly || !b.exactCongressRecord).length;
  const ldaLinked = bills.filter((b) => b.lobbyingSource === "senate_lda").length;
  const production = productionReadiness(process.env);
  const payload = buildHealthPayload(process.env, {
    blockingIssues: [
      ...(lastSeedValidation?.structural || []).map((i) => `${i.billId}: ${i.message}`),
      ...(production.strict && !production.ready ? [production.message] : [])
    ],
    seedValidation: lastSeedValidation,
    production
  });
  payload.bills = { live: liveBillCount, scenario: scenarioBillCount, total: bills.length, ldaLinked };
  payload.strictDataMode = isStrictDataMode();
  sendJson(res, 200, payload);
}

const BILL_TITLE_STOP_WORDS = new Set([
  "act",
  "bill",
  "and",
  "for",
  "the",
  "with",
  "from",
  "into",
  "this",
  "that",
  "house",
  "senate",
  "united",
  "states",
  "implementation"
]);

function billMatchTokens(text = "") {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/&/g, " and ")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !BILL_TITLE_STOP_WORDS.has(token))
  );
}

function seedMetadataMatchesBill(update, seedBill) {
  const liveTitle = update?.title || "";
  if (!liveTitle) return false;

  const seedText = [
    seedBill.title,
    seedBill.shortTitle,
    ...(seedBill.tags || [])
  ].join(" ");
  const seedTokens = billMatchTokens(seedText);
  const liveTokens = billMatchTokens(liveTitle);
  const overlap = [...seedTokens].filter((token) => liveTokens.has(token));

  if (overlap.length >= 2) return true;

  const liveLower = liveTitle.toLowerCase();
  return (seedBill.tags || []).some((tag) => {
    const normalized = String(tag).toLowerCase().trim();
    return normalized.length > 3 && liveLower.includes(normalized);
  });
}

async function refreshSeedBillMetadata(key) {
  const settled = await Promise.allSettled(
    POLICY_BILLS.map(async (bill) => {
      if (bill.scenarioOnly) return null;
      const parsed = congressRefForBill(bill);
      if (!parsed) return null;
      const baseUrl = `https://api.congress.gov/v3/bill/${parsed.congress}/${parsed.type}/${parsed.number}`;
      const qs = `format=json&api_key=${encodeURIComponent(key)}`;
      const [detailResp, commResp, actions] = await Promise.all([
        fetchWithTimeout(`${baseUrl}?${qs}`, {}, 8000),
        fetchWithTimeout(`${baseUrl}/committees?${qs}`, {}, 8000).catch(() => null),
        fetchCongressBillActions(baseUrl, qs)
      ]);
      if (!detailResp.ok) return null;
      const data = await detailResp.json();
      const b = data.bill;
      if (!b) return null;
      let committees = [];
      if (commResp?.ok) {
        try {
          const commData = await commResp.json();
          committees = parseCongressCommitteesResponse(commData);
        } catch {
          committees = [];
        }
      }
      const mapped = mapCongressBillDetailToOverlay(b, parsed, committees, actions);
      const sponsors = Array.isArray(b.sponsors) ? b.sponsors : [];
      const sp = sponsors[0];
      return {
        id: bill.id,
        title: mapped.title || bill.title,
        introducedDate: mapped.introducedDate || bill.introducedDate || null,
        policyArea: mapped.policyArea || bill.policyArea || null,
        committees: mapped.committees,
        _committeeNames: mapped._committeeNames,
        latestAction: mapped.latestAction || bill.latestAction,
        latestActionDate: mapped.latestActionDate || bill.latestActionDate,
        lastSubstantiveActionDate: mapped.lastSubstantiveActionDate,
        actions: mapped.actions,
        _congressActions: mapped._congressActions,
        cosponsors: mapped.cosponsors ?? bill.cosponsors,
        status: mapped.status || bill.status,
        floorScheduled: mapped.floorScheduled,
        exactCongressRecord: true,
        sponsor: mapped.sponsor ||
          (sp
            ? { name: sp.fullName || sp.lastName || bill.sponsor?.name || "", party: sp.party || bill.sponsor?.party || "U", state: sp.state || bill.sponsor?.state || "" }
            : bill.sponsor)
      };
    })
  );
  const updates = new Map();
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) updates.set(r.value.id, r.value);
  }
  return updates;
}

async function congressBills(res, url) {
  const key = process.env.CONGRESS_API_KEY;
  const query = (url.searchParams.get("q") || "").toLowerCase();

  if (!key) {
    if (isStrictDataMode()) {
      return sendJson(res, 503, {
        error: "congress_not_configured",
        message: "CONGRESS_API_KEY is required in production data mode.",
        dataMode: "unavailable"
      });
    }
    const fallbackBills = filterBills(POLICY_BILLS.map((b) => decorateBill(mergeCongressLiveIntoBill(b))), query);
    const scenarioCount = fallbackBills.filter((b) => b.scenarioOnly || !b.exactCongressRecord).length;
    noteFeedSuccess("bills", {
      source: "fallback",
      recordCount: fallbackBills.length,
      liveCount: fallbackBills.length - scenarioCount,
      scenarioCount
    });
    return sendJson(res, 200, {
      source: "fallback",
      dataMode: "scenario",
      bills: fallbackBills,
      catalysts: buildPolicyCatalysts(fallbackBills),
      confidence: "Medium",
      liveBillCount: fallbackBills.filter((b) => b.exactCongressRecord).length,
      scenarioBillCount: scenarioCount,
      updatedAt: new Date().toISOString(),
      provenance: provenanceEnvelope({
        dataMode: "scenario",
        warnings: ["CONGRESS_API_KEY not set — bill status is scenario narrative until configured."]
      })
    });
  }

  try {
    const seedIds = new Set(POLICY_BILLS.map((b) => b.id));

    const [seedUpdatesMap, dynamicCount] = await Promise.all([
      refreshSeedBillMetadata(key),
      refreshDynamicCongressRegistry(key)
    ]);

    const refreshedSeeds = POLICY_BILLS.map((bill) => {
      const base = mergeCongressLiveIntoBill(bill);
      const u = seedUpdatesMap.get(bill.id);
      if (!u) return decorateBill(base);
      if (!seedMetadataMatchesBill(u, bill)) return decorateBill(base);
      congressLiveCache.set(bill.id, u);
      void writeCongressCache(bill.id, u);
      return decorateBill({
        ...base,
        title: u.title || base.title,
        latestAction: u.latestAction,
        latestActionDate: u.latestActionDate,
        lastSubstantiveActionDate: u.lastSubstantiveActionDate,
        cosponsors: u.cosponsors,
        status: u.status,
        exactCongressRecord: true,
        _placeholderFacts: false,
        sponsor: u.sponsor || base.sponsor
      });
    });
    if (seedUpdatesMap.size || dynamicCount) bumpLandingSignalCacheVersion();

    const liveBills = [...liveCongressBillRegistry.values()].filter((b) => !seedIds.has(b.id));

    const bills = filterBills([...refreshedSeeds, ...liveBills], query);
    const liveBillCount = bills.filter((b) => b.exactCongressRecord).length;
    const scenarioBillCount = bills.length - liveBillCount;
    noteFeedSuccess("bills", {
      source: "congress.gov",
      recordCount: bills.length,
      liveCount: liveBillCount,
      scenarioCount: scenarioBillCount
    });
    sendJson(res, 200, {
      source: "congress.gov",
      dataMode: buildDataMode({ bills: { status: "connected", fallback: false } }),
      bills,
      catalysts: buildPolicyCatalysts(bills),
      confidence: "High",
      liveBillCount,
      scenarioBillCount,
      updatedAt: new Date().toISOString(),
      provenance: provenanceEnvelope({
        dataMode: liveBillCount === bills.length ? "live" : "mixed",
        warnings:
          scenarioBillCount > 0
            ? [`${scenarioBillCount} bill(s) are scenario-only or awaiting Congress.gov match.`]
            : []
      })
    });
  } catch (err) {
    noteFeedError("bills", err);
    const fallbackBills = filterBills(POLICY_BILLS.map((b) => decorateBill(mergeCongressLiveIntoBill(b))), query);
    sendJson(res, 200, {
      source: "fallback",
      dataMode: "scenario",
      bills: fallbackBills,
      catalysts: buildPolicyCatalysts(fallbackBills),
      confidence: "Medium",
      updatedAt: new Date().toISOString()
    });
  }
}

async function lobbying(res) {
  const ldaKey = process.env.SENATE_LDA_API_KEY;
  if (!ldaKey && isStrictDataMode()) {
    return sendJson(res, 503, {
      error: "lda_not_configured",
      message: "SENATE_LDA_API_KEY is required in production data mode.",
      filings: [],
      source: "unavailable"
    });
  }
  try {
    if (!ldaKey) throw new Error("lda_not_configured");
    const raw = await fetchLdaFilings({ apiKey: ldaKey, fetchFn: fetchWithTimeout, limit: 80 });
    const filings = raw.map((item) =>
      decorateLobbyingFiling({
        client: item.client,
        registrant: item.registrant,
        amount: item.amount,
        issue: item.issue,
        spike: null,
        portfolio: false,
        postedAt: item.postedAt,
        source: "senate_lda"
      })
    );
    void refreshLdaLobbyingCache().catch((err) => console.warn("[lda] bill overlay refresh failed:", err.message));
    noteFeedSuccess("lobbying", { source: "senate_lda", recordCount: filings.length });
    cachedLobbyFilingsForShare = filings;
    sendJson(res, 200, {
      source: "senate_lda",
      filings,
      confidence: filings.length ? "High" : "Low",
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    noteFeedError("lobbying", err);
    if (isStrictDataMode()) {
      return sendJson(res, 503, {
        error: "lda_unavailable",
        message: err?.message || "LDA feed failed",
        filings: [],
        source: "unavailable"
      });
    }
    const fallbackFilings = LOBBYING_FALLBACK.map((row) =>
      decorateLobbyingFiling({ ...row, postedAt: row.postedAt || new Date().toISOString().slice(0, 10) })
    );
    cachedLobbyFilingsForShare = fallbackFilings;
    sendJson(res, 200, {
      source: "fallback",
      filings: fallbackFilings,
      confidence: "Medium",
      updatedAt: new Date().toISOString(),
      disclaimer: "Illustrative sample filings — set SENATE_LDA_API_KEY for live LDA data."
    });
  }
}

async function paperAccount(res, session) {
  const account = await getPaperAccount(session);
  const snapshot = await paperSnapshot(account);
  sendJson(res, 200, snapshot);
}

// Serialize all paper account writes through a single promise chain.
let paperWriteQueue = Promise.resolve();

function enqueuePaperWrite(fn) {
  paperWriteQueue = paperWriteQueue.then(fn).catch((err) => {
    console.error("[paper-accounts] write error:", err);
  });
  return paperWriteQueue;
}

function runPaperWrite(session, mutator) {
  return new Promise((resolve) => {
    enqueuePaperWrite(async () => {
      const result = await mutatePaperAccount(session, mutator);
      resolve(result);
    });
  });
}

function isBasicTickerFormat(symbol) {
  return /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(symbol);
}

async function validateTradableSymbol(rawSymbol) {
  const symbol = normalizeStockSymbol(rawSymbol);
  if (!isBasicTickerFormat(symbol)) {
    return { valid: false, symbol, reason: "invalid_format" };
  }
  const catalog = getTradableSymbolCatalog();
  if (catalog.symbols.some((row) => row.symbol === symbol)) {
    return { valid: true, symbol, source: "catalog" };
  }
  const snap = await quoteSnapshot(symbol);
  if (snap?.quote?.price && Number(snap.quote.price) > 0) {
    return { valid: true, symbol, source: snap.source || "quote" };
  }
  return { valid: false, symbol, reason: "unknown_symbol" };
}

async function paperOrder(req, res, session) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: "invalid_json" });
  }

  const symbol = String(body.symbol || "").trim().toUpperCase();
  const qty = Number(body.qty);
  const side = String(body.side || "").trim().toLowerCase();
  const type = "market";

  if (!symbol) return sendJson(res, 400, { error: "missing_symbol" });
  if (!Number.isFinite(qty) || qty <= 0) return sendJson(res, 400, { error: "invalid_qty" });
  if (side !== "buy" && side !== "sell") return sendJson(res, 400, { error: "invalid_side" });

  if (process.env.ALLOW_LIVE_TRADING !== "true") {
    if (String(body.live || "").toLowerCase() === "true") {
      return sendJson(res, 403, {
        error: "live_trading_disabled",
        message: "Live trading is not enabled on this server. This is a paper trading environment."
      });
    }
  }

  const validation = await validateTradableSymbol(symbol);
  if (!validation.valid) {
    return sendJson(res, 400, {
      error: validation.reason || "unknown_symbol",
      message: `Symbol ${symbol} is not in the tradable catalog and could not be validated. Try a ticker from the picker or check spelling.`
    });
  }

  let result;
  let httpStatus = 200;
  let alpacaOrder = null;

  if (alpacaPaperEnabled()) {
    try {
      alpacaOrder = await submitAlpacaPaperOrder({ symbol: validation.symbol, qty, side, type });
    } catch (error) {
      console.error("[alpaca] order failed:", error?.message || String(error));
      return sendJson(res, 502, {
        error: "alpaca_order_failed",
        message: "Alpaca paper order rejected. Local paper account was not changed.",
        detail: String(error?.message || error).slice(0, 240)
      });
    }
  }

  await runPaperWrite(session, async (account) => {
    const cached = quoteCache.get(validation.symbol);
    let price = cached?.quote?.price ?? MARKET_FALLBACK[validation.symbol]?.price ?? null;
    if (!price) {
      const snap = await quoteSnapshot(validation.symbol);
      price = snap?.quote?.price ?? null;
    }
    if (alpacaOrder?.filled_avg_price) {
      const filled = Number(alpacaOrder.filled_avg_price);
      if (Number.isFinite(filled) && filled > 0) price = filled;
    }
    const source = alpacaOrder
      ? "alpaca_paper"
      : cached
        ? cached.quote?.source || "finnhub"
        : "fallback_static";

    if (!price) {
      result = {
        error: "unknown_symbol",
        message: `No price data available for ${validation.symbol}. Check the symbol and try again.`
      };
      httpStatus = 400;
      return;
    }

    const notional = price * qty;

    if (side === "buy") {
      if (account.cash < notional) {
        result = { error: "insufficient_funds", cash: account.cash, required: notional };
        httpStatus = 400;
        return;
      }
      account.cash -= notional;
      const existing = account.positions[validation.symbol];
      if (existing) {
        const totalQty = Number(existing.qty) + qty;
        const totalCost = Number(existing.avgCost) * Number(existing.qty) + price * qty;
        existing.qty = totalQty;
        existing.avgCost = totalCost / totalQty;
      } else {
        account.positions[validation.symbol] = { symbol: validation.symbol, qty, avgCost: price };
      }
    } else {
      const pos = account.positions[validation.symbol];
      if (!pos || Number(pos.qty) < qty) {
        result = {
          error: "insufficient_shares",
          held: pos ? Number(pos.qty) : 0,
          requested: qty
        };
        httpStatus = 400;
        return;
      }
      account.cash += notional;
      pos.qty = Number(pos.qty) - qty;
      if (pos.qty <= 0) delete account.positions[validation.symbol];
    }

    const orderId = alpacaOrder?.id || `paper_${randomBytes(8).toString("hex")}`;
    const order = {
      id: orderId,
      symbol: validation.symbol,
      qty,
      side,
      price,
      notional,
      status: alpacaOrder?.status || "filled",
      type,
      submittedAt: alpacaOrder?.submitted_at || new Date().toISOString(),
      source,
      broker: alpacaOrder ? "alpaca_paper" : "local"
    };
    account.orders.unshift(order);
    if (account.orders.length > 200) account.orders = account.orders.slice(0, 200);

    const thesisId = String(body.thesisId || "").trim();
    if (thesisId) {
      const thesis = findThesis(account, thesisId);
      if (thesis) thesis.orderId = orderId;
    }

    result = {
      source: useSupabasePaper(session) ? "supabase_paper" : "local_paper",
      mode: alpacaOrder ? "alpaca-paper" : "paper-simulated",
      broker: alpacaOrder ? "alpaca_paper" : "local",
      order,
      thesisId: thesisId || null,
      contractProfile: Boolean(CONTRACT_PROFILES[validation.symbol]),
      ...(await paperSnapshot(account))
    };
  });

  sendJson(res, httpStatus, result);
}

async function paperSnapshot(account) {
  const positionList = Object.values(account.positions || {});
  const quotes = await Promise.all(positionList.map((position) => quoteSnapshot(position.symbol)));
  const positions = positionList.map((position, index) => {
    const snap = quotes[index];
    const rawQuote =
      snap?.quote ||
      enrichStaticQuote(MARKET_FALLBACK[position.symbol]) ||
      {};
    let livePrice = Number(rawQuote.price);
    let priceBasis = "market";
    if (!Number.isFinite(livePrice) || livePrice <= 0) {
      livePrice = Number(position.avgCost || 0);
      priceBasis = "cost_basis_fallback";
    }
    const marketValue = livePrice * Number(position.qty || 0);
    const costBasis = Number(position.avgCost || 0) * Number(position.qty || 0);
    const unrealizedPnl = marketValue - costBasis;
    return {
      ...position,
      price: livePrice,
      priceBasis,
      marketValue: Number(marketValue.toFixed(2)),
      costBasis: Number(costBasis.toFixed(2)),
      unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
      unrealizedPnlPct: costBasis ? (unrealizedPnl / costBasis) * 100 : 0,
      dayPct: Number(rawQuote.pct ?? rawQuote.changePercent ?? 0)
    };
  });
  const investedValue = positions.reduce((sum, position) => sum + position.marketValue, 0);
  const equity = account.cash + investedValue;
  const totalReturn = equity - PAPER_STARTING_CASH;
  return {
    source: "local_paper",
    mode: "paper-simulated",
    account: {
      status: "ready",
      currency: "USD",
      startingCash: PAPER_STARTING_CASH,
      cash: Number(account.cash.toFixed(2)),
      buyingPower: Number(account.cash.toFixed(2)),
      equity: Number(equity.toFixed(2)),
      portfolioValue: Number(investedValue.toFixed(2)),
      totalReturn: Number(totalReturn.toFixed(2)),
      totalReturnPct: (totalReturn / PAPER_STARTING_CASH) * 100,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    },
    positions,
    orders: account.orders || [],
    explain: "Every new user starts with $100,000 of local simulated cash. Orders fill at the current quote for practice only."
  };
}

async function readPaperStore() {
  try {
    return JSON.parse(await readFile(PAPER_ACCOUNTS_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writePaperStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await withFileLock(PAPER_ACCOUNTS_FILE, () =>
    writeFile(PAPER_ACCOUNTS_FILE, JSON.stringify(store, null, 2), "utf8")
  );
}

function ensurePaperAccount(store, key) {
  if (!store[key]) {
    store[key] = createDefaultPaperAccount();
  }
  const account = store[key];
  if (!Array.isArray(account.theses)) account.theses = [];
  if (!Array.isArray(account.funds)) account.funds = [];
  return account;
}

function createDefaultPaperAccount() {
  return {
    cash: PAPER_STARTING_CASH,
    positions: {},
    orders: [],
    theses: [],
    funds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function isDemoSession(session) {
  const id = String(session?.user?.id || "");
  return id.startsWith("demo-") || id === "demo-user";
}

function useSupabasePaper(session) {
  return dbReady && !isDemoSession(session);
}

const PORTFOLIO_BLOB_VERSION = 1;

function encodePortfolioBlob(account) {
  return {
    _ts: PORTFOLIO_BLOB_VERSION,
    holdings: account.positions || {},
    orders: account.orders || [],
    theses: account.theses || [],
    funds: account.funds || [],
    createdAt: account.createdAt || new Date().toISOString(),
    updatedAt: account.updatedAt || new Date().toISOString()
  };
}

function decodePortfolioBlob(positionsJson, cash) {
  if (
    positionsJson &&
    typeof positionsJson === "object" &&
    !Array.isArray(positionsJson) &&
    positionsJson._ts === PORTFOLIO_BLOB_VERSION
  ) {
    return {
      cash: Number(cash ?? PAPER_STARTING_CASH),
      positions: positionsJson.holdings || {},
      orders: positionsJson.orders || [],
      theses: positionsJson.theses || [],
      funds: positionsJson.funds || [],
      createdAt: positionsJson.createdAt || new Date().toISOString(),
      updatedAt: positionsJson.updatedAt || new Date().toISOString()
    };
  }
  if (Array.isArray(positionsJson) && positionsJson.length) {
    const holdings = {};
    for (const row of positionsJson) {
      const sym = normalizeTickerSymbol(row.symbol);
      if (!sym) continue;
      holdings[sym] = {
        symbol: sym,
        qty: Number(row.qty || 0),
        avgCost: Number(row.avg_price ?? row.avgCost ?? 0)
      };
    }
    return { ...createDefaultPaperAccount(), cash: Number(cash ?? PAPER_STARTING_CASH), positions: holdings };
  }
  return { ...createDefaultPaperAccount(), cash: Number(cash ?? PAPER_STARTING_CASH) };
}

async function loadPaperAccountFromSupabase(userId) {
  const row = await fetchPortfolioRow(userId);
  if (!row) return null;
  return decodePortfolioBlob(row.positions, row.cash);
}

async function savePaperAccountToSupabase(session, account) {
  account.updatedAt = new Date().toISOString();
  await upsertUserProfile(session.user);
  return savePortfolioRow(session.user.id, {
    cash: account.cash,
    positions: encodePortfolioBlob(account)
  });
}

async function migrateLocalPaperToSupabase(session) {
  const key = paperAccountKey(session);
  const store = await readPaperStore();
  const local = store[key];
  if (!local) return null;
  const account = ensurePaperAccount({ [key]: local }, key);
  await savePaperAccountToSupabase(session, account);
  return account;
}

async function getPaperAccount(session) {
  if (useSupabasePaper(session)) {
    let account = await loadPaperAccountFromSupabase(session.user.id);
    if (!account) account = await migrateLocalPaperToSupabase(session);
    if (!account) {
      account = createDefaultPaperAccount();
      await savePaperAccountToSupabase(session, account);
    }
    return account;
  }
  const store = await readPaperStore();
  const key = paperAccountKey(session);
  const existed = Boolean(store[key]);
  const account = ensurePaperAccount(store, key);
  if (!existed) await writePaperStore(store);
  return account;
}

async function mutatePaperAccount(session, mutator) {
  if (useSupabasePaper(session)) {
    const account = await getPaperAccount(session);
    const result = await mutator(account);
    await savePaperAccountToSupabase(session, account);
    return result;
  }
  const store = await readPaperStore();
  const key = paperAccountKey(session);
  const account = ensurePaperAccount(store, key);
  const result = await mutator(account);
  account.updatedAt = new Date().toISOString();
  await writePaperStore(store);
  return result;
}

function normalizeTickerSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 12);
}

function billCongressUrl(bill) {
  const id = String(bill?.id || "");
  if (bill?.scenarioOnly || id.startsWith("scenario:")) {
    return congressSearchUrl(bill?.title || bill?.shortTitle || bill?.scenarioId || id);
  }
  const ref = congressRefForBill(bill);
  if (ref) {
    const typePath = {
      hr: "house-bill",
      hres: "house-resolution",
      hjres: "house-joint-resolution",
      s: "senate-bill",
      sres: "senate-resolution",
      sjres: "senate-joint-resolution"
    }[ref.type] || "bill";
    return `https://www.congress.gov/bill/${ref.congress}th-congress/${typePath}/${ref.number}`;
  }
  if (bill?.exactCongressRecord === false) {
    return congressSearchUrl(bill?.title || bill?.shortTitle || id);
  }
  const match = id.match(/^(H\.R\.|S\.|HR|HRES|SRES|HJRES|SJRES)\s*\.?(\d+)-(\d+)$/i);
  if (!match) return congressSearchUrl(id || bill?.title || "market bill");
  const rawType = match[1].replace(/\./g, "").toLowerCase();
  const number = match[2];
  const congress = match[3];
  const typePath = {
    hr: "house-bill",
    hres: "house-resolution",
    hjres: "house-joint-resolution",
    s: "senate-bill",
    sres: "senate-resolution",
    sjres: "senate-joint-resolution"
  }[rawType] || "bill";
  return `https://www.congress.gov/bill/${congress}th-congress/${typePath}/${number}`;
}

function lobbyTickersForClient(client) {
  const key = String(client || "").toLowerCase();
  for (const [needle, tickers] of Object.entries(LOBBY_CLIENT_TICKERS)) {
    if (key.includes(needle)) return tickers;
  }
  return [];
}

function parseFundSymbolsInput(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  const parsed = [];
  for (const item of rows) {
    if (typeof item === "string") {
      const symbol = normalizeTickerSymbol(item);
      if (symbol) parsed.push({ symbol, weight: null });
      continue;
    }
    if (item && typeof item === "object") {
      const symbol = normalizeTickerSymbol(item.symbol || item.ticker);
      if (!symbol) continue;
      const weight = item.weight != null ? Number(item.weight) : null;
      parsed.push({
        symbol,
        weight: Number.isFinite(weight) && weight > 0 ? weight : null
      });
    }
  }
  const seen = new Set();
  return parsed.filter((row) => {
    if (seen.has(row.symbol)) return false;
    seen.add(row.symbol);
    return true;
  });
}

function finalizeFundWeights(rows) {
  if (!rows.length) return [];
  const explicit = rows.every((row) => row.weight != null);
  if (explicit) {
    const sum = rows.reduce((acc, row) => acc + row.weight, 0);
    return rows.map((row) => ({
      symbol: row.symbol,
      weight: sum > 0 ? row.weight / sum : 1 / rows.length
    }));
  }
  const w = 1 / rows.length;
  return rows.map((row) => ({ symbol: row.symbol, weight: w }));
}

function findFund(account, fundId) {
  return (account.funds || []).find((row) => row.id === fundId) || null;
}

function publicFundRow(fund) {
  return {
    id: fund.id,
    name: fund.name,
    tag: fund.tag,
    symbols: (fund.symbols || []).map((row) => ({
      symbol: row.symbol,
      weight: Number(row.weight)
    })),
    benchmark: fund.benchmark || null,
    createdAt: fund.createdAt
  };
}

async function listFunds(res, session) {
  const account = await getPaperAccount(session);
  sendJson(res, 200, {
    funds: (account.funds || []).map(publicFundRow),
    disclaimer: "Hypothetical baskets for research only. Not a recommendation to buy or sell."
  });
}

async function createFund(req, res, session) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: "invalid_json" });
  }

  const name = String(body.name || "").trim().slice(0, 80);
  const tag = String(body.tag || "custom").trim().toLowerCase();
  const benchmarkRaw = body.benchmark == null || body.benchmark === "" ? null : normalizeTickerSymbol(body.benchmark);
  const benchmark = benchmarkRaw === "SPY" ? "SPY" : benchmarkRaw ? benchmarkRaw : null;
  const symbolRows = finalizeFundWeights(parseFundSymbolsInput(body.symbols));

  if (!name) return sendJson(res, 400, { error: "missing_name" });
  if (!FUND_TAGS.has(tag)) {
    return sendJson(res, 400, {
      error: "invalid_tag",
      allowed: [...FUND_TAGS]
    });
  }
  if (symbolRows.length < 1) return sendJson(res, 400, { error: "missing_symbols" });
  if (symbolRows.length > 24) return sendJson(res, 400, { error: "too_many_symbols", max: 24 });

  let created;
  await runPaperWrite(session, async (account) => {
    created = {
      id: `fund_${randomBytes(6).toString("hex")}`,
      name,
      tag,
      symbols: symbolRows,
      benchmark,
      createdAt: new Date().toISOString()
    };
    account.funds.unshift(created);
    if (account.funds.length > 50) account.funds = account.funds.slice(0, 50);
  });

  sendJson(res, 201, {
    fund: publicFundRow(created),
    disclaimer: "Hypothetical basket for research only. Not a recommendation to buy or sell."
  });
}

function parseHistoryDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function alignSymbolHistories(histories) {
  const series = histories.map((row) => ({
    symbol: row.symbol,
    source: row.source,
    points: (row.points || [])
      .map((p) => ({ date: parseHistoryDate(p.date), close: Number(p.close || 0) }))
      .filter((p) => p.date && Number.isFinite(p.close) && p.close > 0)
  }));
  const minLen = Math.min(...series.map((s) => s.points.length).filter((n) => n > 0));
  if (!Number.isFinite(minLen) || minLen < 2) return null;

  const tail = series.map((s) => ({
    symbol: s.symbol,
    source: s.source,
    points: s.points.slice(-minLen)
  }));

  const dates = tail[0].points.map((p) => p.date);
  const normalized = tail.map((s) => {
    const first = s.points[0].close;
    return {
      symbol: s.symbol,
      source: s.source,
      points: s.points.map((p, i) => ({
        date: dates[i] || p.date,
        close: p.close,
        index: (p.close / first) * 100
      }))
    };
  });

  return { dates, symbols: normalized, length: minLen };
}

function weightedBasketSeries(symbols, weights) {
  const len = symbols[0]?.points?.length || 0;
  const points = [];
  for (let i = 0; i < len; i += 1) {
    let value = 0;
    for (let j = 0; j < symbols.length; j += 1) {
      value += weights[j] * symbols[j].points[i].index;
    }
    points.push({
      date: symbols[0].points[i].date,
      close: Number(value.toFixed(4)),
      value: Number(value.toFixed(4))
    });
  }
  return points;
}

function returnPctFromIndexPoints(points, lookback) {
  if (!points?.length) return null;
  const end = points[points.length - 1].close;
  const startIdx = Math.max(0, points.length - 1 - lookback);
  const start = points[startIdx].close;
  if (!start) return null;
  return Number((((end - start) / start) * 100).toFixed(2));
}

function maxDrawdownPct(points) {
  if (!points?.length) return null;
  let peak = points[0].close;
  let maxDd = 0;
  for (const p of points) {
    const v = Number(p.close);
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return Number((maxDd * 100).toFixed(2));
}

function symbolContributionPct(symbols, weights) {
  const out = [];
  let totalMove = 0;
  for (let i = 0; i < symbols.length; i += 1) {
    const pts = symbols[i].points;
    const first = pts[0]?.index || 100;
    const last = pts[pts.length - 1]?.index || 100;
    const move = weights[i] * (last - first);
    const returnPct = first ? ((last - first) / first) * 100 : 0;
    totalMove += move;
    out.push({
      symbol: symbols[i].symbol,
      move,
      returnPct: Number(returnPct.toFixed(2)),
      source: symbols[i].source
    });
  }
  return out
    .map((row) => ({
      symbol: row.symbol,
      contributionPct: totalMove ? Number(((row.move / totalMove) * 100).toFixed(2)) : 0,
      returnPct: row.returnPct,
      source: row.source
    }))
    .sort((a, b) => b.contributionPct - a.contributionPct);
}

function lookbackForRange(range) {
  return { "1w": 5, "1m": 21, "6m": 9999 }[range] || 9999;
}

async function fundPerformanceRoute(res, session, fundId, url) {
  const range = String(url.searchParams.get("range") || "6m").toLowerCase();
  const account = await getPaperAccount(session);
  const fund = findFund(account, fundId);
  if (!fund) return sendJson(res, 404, { error: "fund_not_found" });

  const histories = await Promise.all(
    fund.symbols.map(async (row) => {
      const payload = await fetchMarketHistoryPayload(row.symbol, range);
      return { symbol: row.symbol, weight: row.weight, ...payload };
    })
  );

  let benchmark = null;
  if (fund.benchmark) {
    const benchPayload = await fetchMarketHistoryPayload(fund.benchmark, range);
    const aligned = alignSymbolHistories([{ symbol: fund.benchmark, ...benchPayload }]);
    if (aligned) {
      const benchPoints = aligned.symbols[0].points.map((p) => ({
        date: p.date,
        close: p.index,
        value: p.index
      }));
      benchmark = {
        symbol: fund.benchmark,
        source: benchPayload.source,
        points: benchPoints,
        stats: historyStats(benchPoints),
        returns: {
          "1w": returnPctFromIndexPoints(benchPoints, lookbackForRange("1w")),
          "1m": returnPctFromIndexPoints(benchPoints, lookbackForRange("1m")),
          "6m": returnPctFromIndexPoints(benchPoints, lookbackForRange("6m"))
        }
      };
    }
  }

  const aligned = alignSymbolHistories(histories);
  if (!aligned) {
    return sendJson(res, 200, {
      fund: publicFundRow(fund),
      range,
      error: "insufficient_history",
      message: "Not enough overlapping price history to build this basket index.",
      sources: histories.map((h) => ({ symbol: h.symbol, source: h.source })),
      disclaimer: "Hypothetical index for research only. Correlation with policy events is not causation."
    });
  }

  const weights = fund.symbols.map((row) => row.weight);
  const basketPoints = weightedBasketSeries(aligned.symbols, weights);
  const contributions = symbolContributionPct(aligned.symbols, weights);
  const symbolReturns = aligned.symbols.map((s, i) => {
    const pts = s.points;
    const ret = pts.length > 1 ? ((pts[pts.length - 1].index - pts[0].index) / pts[0].index) * 100 : 0;
    return {
      symbol: s.symbol,
      weight: fund.symbols[i].weight,
      returnPct: Number(ret.toFixed(2)),
      source: s.source
    };
  }).sort((a, b) => b.returnPct - a.returnPct);

  sendJson(res, 200, {
    fund: publicFundRow(fund),
    range,
    indexStart: 100,
    basket: {
      points: basketPoints,
      stats: historyStats(basketPoints),
      maxDrawdownPct: maxDrawdownPct(basketPoints),
      returns: {
        "1w": returnPctFromIndexPoints(basketPoints, lookbackForRange("1w")),
        "1m": returnPctFromIndexPoints(basketPoints, lookbackForRange("1m")),
        "6m": returnPctFromIndexPoints(basketPoints, lookbackForRange("6m"))
      }
    },
    benchmark,
    contributions,
    leaderboard: symbolReturns,
    sources: histories.map((h) => ({ symbol: h.symbol, source: h.source })),
    disclaimer: "Hypothetical weighted index for research only. Not a recommendation to buy or sell. Policy overlays are correlational, not causal."
  });
}

async function fundMetricsForCompare(fund, range = "6m") {
  const histories = await Promise.all(
    fund.symbols.map(async (row) => {
      const payload = await fetchMarketHistoryPayload(row.symbol, range);
      return { symbol: row.symbol, weight: row.weight, ...payload };
    })
  );
  const aligned = alignSymbolHistories(histories);
  if (!aligned) {
    return {
      fund: publicFundRow(fund),
      range,
      error: "insufficient_history",
      returns6m: null,
      maxDrawdownPct: null
    };
  }
  const weights = fund.symbols.map((row) => row.weight);
  const basketPoints = weightedBasketSeries(aligned.symbols, weights);
  return {
    fund: publicFundRow(fund),
    range,
    returns6m: returnPctFromIndexPoints(basketPoints, lookbackForRange("6m")),
    maxDrawdownPct: maxDrawdownPct(basketPoints),
    symbolCount: fund.symbols.length
  };
}

async function fundsCompareRoute(res, session, url) {
  const raw = String(url.searchParams.get("ids") || "");
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (ids.length < 2) {
    return sendJson(res, 400, {
      error: "missing_ids",
      message: "Provide two fund ids: /api/funds/compare?ids=id1,id2"
    });
  }

  const account = await getPaperAccount(session);
  const funds = ids.map((id) => findFund(account, id)).filter(Boolean);
  if (funds.length < 2) {
    return sendJson(res, 404, { error: "fund_not_found", message: "One or both fund ids were not found." });
  }

  const [a, b] = await Promise.all(funds.map((fund) => fundMetricsForCompare(fund, "6m")));
  sendJson(res, 200, {
    range: "6m",
    funds: [a.fund, b.fund],
    comparison: {
      metrics: [
        {
          label: "6M return",
          a: a.returns6m,
          b: b.returns6m,
          format: "percent"
        },
        {
          label: "Max drawdown",
          a: a.maxDrawdownPct,
          b: b.maxDrawdownPct,
          format: "percent"
        },
        {
          label: "Holdings",
          a: a.symbolCount,
          b: b.symbolCount,
          format: "count"
        }
      ],
      rows: [
        {
          metric: "6M return",
          [a.fund.id]: a.returns6m,
          [b.fund.id]: b.returns6m
        },
        {
          metric: "Max drawdown",
          [a.fund.id]: a.maxDrawdownPct,
          [b.fund.id]: b.maxDrawdownPct
        }
      ]
    },
    disclaimer:
      "Side-by-side hypothetical basket stats for research only. Not a recommendation to buy or sell. Correlation with policy events is not causation."
  });
}

function rangeStartDate(range) {
  const days = { "1w": 7, "1m": 35, "6m": 200, "1y": 390 }[range] || 200;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function buildEvidenceItem({
  id,
  title,
  summary,
  source,
  sourceUrl,
  publishedAt,
  supports,
  symbol,
  type,
  excerpt,
  relevance,
  modeled
}) {
  const dateStr = publishedAt ? String(publishedAt).slice(0, 10) : null;
  const excerptText = excerpt || summary || "";
  return {
    id: id || `ev_${randomBytes(4).toString("hex")}`,
    title: title || excerptText.slice(0, 80) || "Source item",
    summary: summary || excerptText,
    excerpt: excerptText,
    relevance: relevance || "Research context only",
    source: source || "TradeSimple",
    sourceUrl: sourceUrl || null,
    publishedAt: publishedAt || null,
    date: dateStr,
    supports: supports || "General",
    symbol: symbol || null,
    type: type || "modeled",
    modeled: modeled !== false,
    quote: excerptText
  };
}

function evidenceFromBill(bill, symbol) {
  return buildEvidenceItem({
    id: `bill_${bill.id}`,
    title: bill.shortTitle || bill.title,
    summary: bill.plainEnglish || bill.signal || bill.latestAction || bill.title,
    excerpt: bill.latestAction || bill.plainEnglish || bill.title,
    source: bill.exactCongressRecord ? "Congress.gov" : "Congress.gov · modeled",
    sourceUrl: billCongressUrl(bill),
    publishedAt: bill.latestActionDate || bill.createdAt,
    supports: "Policy & regulation",
    symbol,
    type: "bill",
    modeled: !bill.exactCongressRecord,
    relevance: "Legislative status mapped to this ticker — research context only."
  });
}

function evidenceFromContractProfile(symbol, profile) {
  return buildEvidenceItem({
    id: `contract_${symbol}`,
    title: `${symbol} federal contract exposure`,
    summary: profile?.note || profile?.archetypeExplain || "Government contract profile for this symbol.",
    excerpt: profile?.archetypeExplain || profile?.note || "",
    source: "USASpending.gov · modeled",
    sourceUrl: usaspendingSearchUrl(symbol),
    publishedAt: null,
    supports: "Government revenue",
    symbol,
    type: "contract",
    modeled: true,
    relevance: "Contract dependency context — not a causal price link."
  });
}

function evidenceFromFigure(figure, symbol) {
  return buildEvidenceItem({
    id: `figure_${figure.name}`,
    title: figure.label || figure.name,
    summary: figure.label || `${figure.name} — public policy appearance`,
    excerpt: figure.label || "",
    source: "Curated public figure map",
    sourceUrl: figure.url || congressSearchUrl(figure.name),
    publishedAt: figure.date,
    supports: "Policy & regulation",
    symbol,
    type: "figure",
    modeled: true,
    relevance: "Curated policy appearance map — not a live social feed."
  });
}

function evidenceFromNewsItem(item, symbol) {
  return buildEvidenceItem({
    id: `news_${item.url || item.headline}`,
    title: item.headline || "Company headline",
    summary: item.headline || "",
    excerpt: item.headline || "",
    source: item.source || item.sourceLabel || "Finnhub News",
    sourceUrl: item.url || null,
    publishedAt: item.publishedAt,
    supports: "Market checkpoint",
    symbol,
    type: "news",
    modeled: false,
    relevance: "Recent headline for research context only."
  });
}

function collectThesisEvidencePool(symbol, recentNews = []) {
  const sym = String(symbol || "").toUpperCase();
  const pool = [];
  const relatedBills = POLICY_BILLS.filter((bill) => (bill.affected || []).includes(sym));
  relatedBills.slice(0, 4).forEach((bill) => pool.push(evidenceFromBill(bill, sym)));
  const profile = CONTRACT_PROFILES[sym];
  if (profile) pool.push(evidenceFromContractProfile(sym, profile));
  FIGURE_LINKS.filter((f) => (f.symbols || []).includes(sym))
    .slice(0, 2)
    .forEach((f) => pool.push(evidenceFromFigure(f, sym)));
  for (const filing of LOBBYING_FALLBACK) {
    const tickers = lobbyTickersForClient(filing.client);
    if (!tickers.includes(sym)) continue;
    pool.push(
      buildEvidenceItem({
        id: `lobby_${filing.client}`,
        title: filing.issue || `${filing.client} lobbying`,
        summary: filing.issue || "Lobbying filing mapped to this symbol.",
        excerpt: filing.issue || "",
        source: "Senate LDA (seed/fallback)",
        sourceUrl: "https://lda.senate.gov/filings/public/filing/search/",
        publishedAt: filing.postedAt,
        supports: "Lobbying pressure",
        symbol: sym,
        type: "lobby",
        modeled: true
      })
    );
    break;
  }
  (recentNews || []).slice(0, 3).forEach((item) => pool.push(evidenceFromNewsItem(item, sym)));
  return pool;
}

function mapClaimEvidence(claimText, pool, index) {
  const lower = String(claimText || "").toLowerCase();
  const matched = pool.filter((ev) => {
    const part = String(ev.supports || "").toLowerCase();
    return part.length > 3 && lower.includes(part.slice(0, Math.min(12, part.length)));
  });
  if (matched.length) return matched.slice(0, 3);
  if (pool[index]) return [pool[index]];
  return pool.slice(0, 2);
}

function normalizeSignalEvidence(raw, signal) {
  if (!raw) return null;
  if (raw.id && raw.title) return raw;
  const sym = String(signal?.id || "").split("_")[0].toUpperCase();
  return buildEvidenceItem({
    id: signal?.id ? `ev_${signal.id}` : undefined,
    title: signal?.title,
    summary: raw.quote || raw.summary || "",
    excerpt: raw.quote || raw.summary || "",
    source: raw.source || signal?.source,
    sourceUrl: signal?.sourceUrl,
    publishedAt: raw.date,
    supports: raw.supports || signal?.thesisPart,
    symbol: sym.length <= 5 ? sym : null,
    type: signal?.category || "modeled",
    modeled: /modeled/i.test(String(signal?.source || raw.source || ""))
  });
}

function attributionEventsForFund(fund, range) {
  const symbols = new Set(fund.symbols.map((row) => row.symbol));
  const start = rangeStartDate(range);
  const events = [];

  for (const bill of POLICY_BILLS) {
    const affected = (bill.affected || []).filter((sym) => symbols.has(sym));
    if (!affected.length) continue;
    const date = parseHistoryDate(bill.latestActionDate) || parseHistoryDate(bill.createdAt) || "2026-01-01";
    if (date < start) continue;
    events.push({
      type: "bill",
      label: bill.shortTitle || bill.title,
      date,
      symbolsAffected: affected,
      url: billCongressUrl(bill),
      source: bill.exactCongressRecord ? "Congress.gov" : "TradeSimple bill seed",
      evidence: [evidenceFromBill(bill, affected[0])]
    });
  }

  for (const filing of LOBBYING_FALLBACK) {
    const tickers = lobbyTickersForClient(filing.client).filter((sym) => symbols.has(sym));
    if (!tickers.length) continue;
    const date = parseHistoryDate(filing.postedAt) || "2026-04-01";
    if (date < start) continue;
    events.push({
      type: "lobby",
      label: `${filing.client} — ${filing.issue || "Lobbying filing"}`,
      date,
      symbolsAffected: tickers,
      url: "https://lda.gov/",
      source: "Senate LDA (seed/fallback)",
      evidence: [
        buildEvidenceItem({
          id: `lobby_${filing.client}`,
          title: filing.issue || "Lobbying filing",
          summary: filing.issue || "Lobbying disclosure mapped to portfolio tickers.",
          excerpt: filing.issue || "",
          source: "Senate LDA (seed/fallback)",
          sourceUrl: "https://lda.senate.gov/filings/public/filing/search/",
          publishedAt: date,
          supports: "Lobbying pressure",
          symbol: tickers[0],
          type: "lobby",
          modeled: true,
          relevance: "Research context only — lobbying overlap with holdings."
        })
      ]
    });
  }

  for (const [billId, model] of Object.entries(POLICY_STAKEHOLDERS)) {
    for (const lobby of model.lobbying || []) {
      const tickers = (lobby.tickers || []).filter((sym) => symbols.has(sym));
      if (!tickers.length) continue;
      const bill = POLICY_BILLS.find((b) => b.id === billId);
      const date = parseHistoryDate(bill?.latestActionDate) || "2026-04-01";
      if (date < start) continue;
      events.push({
        type: "lobby",
        label: `${lobby.name} — ${lobby.issue || billId}`,
        date,
        symbolsAffected: tickers,
        url: bill ? billCongressUrl(bill) : congressSearchUrl(billId),
        source: "TradeSimple stakeholder map",
        evidence: bill
          ? [evidenceFromBill(bill, tickers[0])]
          : [
              buildEvidenceItem({
                id: `lobby_map_${billId}`,
                title: lobby.issue || lobby.name,
                summary: lobby.issue || "Stakeholder lobbying map entry.",
                excerpt: lobby.issue || "",
                source: "TradeSimple stakeholder map",
                sourceUrl: congressSearchUrl(billId),
                publishedAt: date,
                supports: "Lobbying pressure",
                symbol: tickers[0],
                type: "lobby",
                modeled: true,
                relevance: "Research context only."
              })
            ]
      });
    }
  }

  for (const [sym, profile] of Object.entries(CONTRACT_PROFILES)) {
    if (!symbols.has(sym)) continue;
    const date = parseHistoryDate(
      (POLICY_BILLS.find((b) => (profile.linkedBillIds || []).includes(b.id)) || {}).latestActionDate
    ) || "2026-03-15";
    if (date < start) continue;
    events.push({
      type: "contract",
      label: `${sym} — ${profile.archetype || "Government contract exposure"}`,
      date,
      symbolsAffected: [sym],
      url: usaspendingSearchUrl(sym),
      source: "USASpending / contract profile seed",
      evidence: [evidenceFromContractProfile(sym, profile)]
    });
  }

  for (const figure of FIGURE_LINKS) {
    const affected = (figure.symbols || []).filter((sym) => symbols.has(sym));
    if (!affected.length) continue;
    const date = parseHistoryDate(figure.date);
    if (!date || date < start) continue;
    events.push({
      type: "figure",
      label: figure.label || `${figure.name} — public policy appearance`,
      date,
      symbolsAffected: affected,
      url: figure.url || congressSearchUrl(figure.name),
      source: "Curated public figure map (not live social)",
      evidence: [evidenceFromFigure(figure, affected[0])]
    });
  }

  const dedup = new Map();
  for (const ev of events) {
    const key = `${ev.type}|${ev.date}|${ev.label}`;
    if (!dedup.has(key)) dedup.set(key, ev);
  }

  return [...dedup.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** Fund matrix tuning — recency half-life (days), source priors, saturation curve. */
const FUND_MATRIX_RECENCY_HALF_LIFE_DAYS = Number(process.env.FUND_MATRIX_RECENCY_HALF_LIFE_DAYS || 42);
const FUND_MATRIX_RECENCY_FLOOR = 0.22;
const FUND_MATRIX_SOURCE_WEIGHT = {
  bill: 1.2,
  lobby: 0.95,
  contract: 1.15,
  figure: 0.88
};

function fundMatrixRecencyFactor(eventMs, now = Date.now()) {
  if (!Number.isFinite(eventMs) || eventMs > now) return 0.32;
  const ageDays = (now - eventMs) / 86_400_000;
  const decay = Math.exp((-ageDays * Math.LN2) / Math.max(7, FUND_MATRIX_RECENCY_HALF_LIFE_DAYS));
  return Math.max(FUND_MATRIX_RECENCY_FLOOR, decay);
}

function fundMatrixEventContribution(ev, symbol, now = Date.now()) {
  const affected = (ev.symbolsAffected || []).filter(Boolean);
  if (!affected.includes(symbol)) return 0;

  const typeWeight = FUND_MATRIX_SOURCE_WEIGHT[ev.type] || 1;
  const recency = fundMatrixRecencyFactor(Date.parse(ev.date || ""), now);
  // Broad events (many tickers) count less per symbol; single-ticker events get a small specificity boost.
  const breadth =
    affected.length <= 1 ? 1.12 : 1 / Math.sqrt(Math.min(affected.length, 8));

  return typeWeight * recency * breadth;
}

function fundMatrixCellScore(raw, rowMaxRaw) {
  const r = Math.max(0, Number(raw) || 0);
  const maxR = Math.max(0.0001, Number(rowMaxRaw) || 0);
  const relative = (r / maxR) * 100;
  // Saturating absolute scale: ~3 weighted events ≈ high conviction without needing row max.
  const absolute = 100 * (1 - Math.exp(-r / 2.8));
  return Number(Math.min(100, relative * 0.55 + absolute * 0.45).toFixed(1));
}

function buildFundRelationshipMatrix(fund, events = []) {
  const symbols = (fund?.symbols || []).map((row) => row.symbol).filter(Boolean);
  const sourceTypes = ["bill", "lobby", "contract", "figure"];
  const now = Date.now();

  const rows = sourceTypes.map((type) => {
    const matched = events.filter((ev) => ev.type === type);
    const bySymbol = Object.fromEntries(symbols.map((sym) => [sym, 0]));
    for (const ev of matched) {
      for (const sym of ev.symbolsAffected || []) {
        if (bySymbol[sym] == null) continue;
        bySymbol[sym] += fundMatrixEventContribution(ev, sym, now);
      }
    }
    const maxCell = Math.max(...Object.values(bySymbol), 0.0001);
    const cells = symbols.map((sym) => {
      const raw = Number((bySymbol[sym] || 0).toFixed(3));
      return {
        symbol: sym,
        raw,
        score: fundMatrixCellScore(raw, maxCell)
      };
    });
    const rowScore = Number(
      Math.min(
        100,
        cells.reduce((sum, cell) => sum + cell.score, 0) / Math.max(1, cells.length)
      ).toFixed(1)
    );
    return {
      type,
      label: { bill: "Legislation", lobby: "Lobbying", contract: "Contracts", figure: "Figures" }[type] || type,
      eventCount: matched.length,
      rowScore,
      cells
    };
  });

  const columnScores = symbols.map((sym) => {
    const vals = rows.map((row) => row.cells.find((cell) => cell.symbol === sym)?.score || 0);
    const max = Math.max(...vals, 0);
    const avg = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const score = Number((max * 0.65 + avg * 0.35).toFixed(1));
    return { symbol: sym, score };
  });

  return {
    symbols,
    rows,
    columnScores,
    weights: {
      recencyHalfLifeDays: FUND_MATRIX_RECENCY_HALF_LIFE_DAYS,
      source: FUND_MATRIX_SOURCE_WEIGHT
    },
    legend:
      "Scores blend recency (42d half-life), source type (bills/contracts weighted higher), and ticker-specificity. Not causal."
  };
}

function buildFundRelationshipGraph(fund, events = []) {
  const symbols = (fund?.symbols || []).map((row) => row.symbol).filter(Boolean);
  const symbolNodes = symbols.map((sym) => ({ id: `sym:${sym}`, label: sym, kind: "symbol" }));
  const sourceKinds = [
    { id: "src:bill", label: "Legislation", type: "bill" },
    { id: "src:lobby", label: "Lobbying", type: "lobby" },
    { id: "src:contract", label: "Contracts", type: "contract" },
    { id: "src:figure", label: "Figures", type: "figure" }
  ];
  const sourceNodes = sourceKinds.map((row) => ({ id: row.id, label: row.label, kind: "source", type: row.type }));
  const edgeMap = new Map();

  for (const ev of events) {
    const sourceId = `src:${ev.type}`;
    for (const sym of ev.symbolsAffected || []) {
      if (!symbols.includes(sym)) continue;
      const key = `${sourceId}|sym:${sym}`;
      edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
    }
  }

  const edges = [...edgeMap.entries()].map(([key, count]) => {
    const [from, to] = key.split("|");
    return { from, to, weight: count };
  });

  return {
    nodes: [...sourceNodes, ...symbolNodes],
    edges,
    legend: "Edge thickness represents count of mapped events in selected range."
  };
}

async function fundAttributionRoute(res, session, fundId, url) {
  const range = String(url.searchParams.get("range") || "6m").toLowerCase();
  const account = await getPaperAccount(session);
  const fund = findFund(account, fundId);
  if (!fund) return sendJson(res, 404, { error: "fund_not_found" });

  const events = attributionEventsForFund(fund, range);
  sendJson(res, 200, {
    fund: publicFundRow(fund),
    range,
    events,
    matrix: buildFundRelationshipMatrix(fund, events),
    graph: buildFundRelationshipGraph(fund, events),
    disclaimer:
      "Events are mapped for context only. Correlation with price moves is not causation and is not investment advice."
  });
}

async function fundPulseRoute(res, session, fundId) {
  const account = await getPaperAccount(session);
  const fund = findFund(account, fundId);
  if (!fund) return sendJson(res, 404, { error: "fund_not_found" });

  const symbols = (fund.symbols || []).map((row) => row.symbol).filter(Boolean);
  const symbolQuotes = await Promise.all(
    symbols.map(async (symbol) => {
      const result = await quoteSnapshot(symbol).catch(() => null);
      return { symbol, quote: result?.quote || null, source: result?.source || null };
    })
  );

  const quotePulse = symbolQuotes.map((row) => {
    const pct = Number(row.quote?.pct || 0);
    const freshMs = Number(row.quote?.freshnessMs || 0);
    const status =
      !row.quote
        ? "Broken"
        : Math.abs(pct) >= 3
          ? "Catalyst Soon"
          : freshMs > 120000
            ? "Watch"
            : "Normal";
    return {
      symbol: row.symbol,
      price: row.quote?.price ?? null,
      pct: Number.isFinite(pct) ? Number(pct.toFixed(2)) : null,
      source: row.quote?.source || row.source,
      freshnessMs: Number.isFinite(freshMs) ? freshMs : null,
      status
    };
  });

  const socialPulse = await getSocialPulse({ symbols, figureLinks: FIGURE_LINKS, includeRss: true });

  const figureEvents = FIGURE_LINKS
    .filter((figure) => (figure.symbols || []).some((sym) => symbols.includes(sym)))
    .map((figure) => {
      const date = parseHistoryDate(figure.date);
      const affected = (figure.symbols || []).filter((sym) => symbols.includes(sym));
      const ageDays = date ? Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 86_400_000)) : null;
      const status = ageDays != null && ageDays <= 7 ? "Catalyst Soon" : ageDays != null && ageDays <= 30 ? "Watch" : "Normal";
      return {
        name: figure.name,
        label: figure.label,
        date,
        symbolsAffected: affected,
        url: figure.url || null,
        status
      };
    })
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 8);

  sendJson(res, 200, {
    fund: publicFundRow(fund),
    updatedAt: new Date().toISOString(),
    quotePulse,
    figurePulse: figureEvents,
    socialPulse,
    disclaimer:
      "Public-figure and social pulse items are contextual and may lag. Curated links are not live tweets unless SOCIAL_RSS_URL is configured. Not a trading signal and not investment advice."
  });
}

function policyExposureForSymbol(symbol) {
  const relatedBills = POLICY_BILLS.filter((bill) => (bill.affected || []).includes(symbol));
  return relatedBills.reduce((max, bill) => Math.max(max, computeLegislativeMomentum(bill)), 0);
}

function findThesis(account, thesisId) {
  return (account.theses || []).find((row) => row.id === thesisId) || null;
}

function thesisDirectionForSignals(direction) {
  const d = String(direction || "").toLowerCase();
  if (d === "unclear") return "watch";
  return ["bull", "bear", "watch"].includes(d) ? d : "watch";
}

function normalizeThesisRecord(rawThesis, extra = {}) {
  const normalized = normalizeThesis({
    ...rawThesis,
    symbol: rawThesis?.symbol || rawThesis?.ticker,
    thesisText: rawThesis?.thesisText || rawThesis?.thesis,
    ...extra
  });
  return {
    ...rawThesis,
    ...normalized,
    ticker: normalized.symbol || rawThesis?.ticker || "",
    symbol: normalized.symbol || rawThesis?.symbol || ""
  };
}

async function computeThesisOutcome(thesis, account) {
  const symbol = String(thesis.ticker || "").toUpperCase();
  const quoteResult = await quoteSnapshot(symbol);
  const currentPrice = Number(quoteResult?.quote?.price);
  const hasQuote = Number.isFinite(currentPrice) && currentPrice > 0;
  const entry = Number(thesis.entry) || 0;
  const target = Number(thesis.target) || 0;
  const stop = Number(thesis.stop) || 0;
  const direction = thesis.direction || "bull";

  let pctFromEntry = null;
  let distanceToTargetPct = null;
  let distanceToStopPct = null;
  let nearTarget = false;
  let nearStop = false;

  if (hasQuote && entry > 0) {
    pctFromEntry = Number((((currentPrice - entry) / entry) * 100).toFixed(2));
  }

  if (hasQuote && target > 0) {
    if (direction === "bear") {
      distanceToTargetPct = Number((((currentPrice - target) / currentPrice) * 100).toFixed(2));
      nearTarget = currentPrice <= target;
    } else {
      distanceToTargetPct = Number((((target - currentPrice) / currentPrice) * 100).toFixed(2));
      nearTarget = currentPrice >= target;
    }
  }

  if (hasQuote && stop > 0) {
    if (direction === "bear") {
      distanceToStopPct = Number((((stop - currentPrice) / currentPrice) * 100).toFixed(2));
      nearStop = currentPrice >= stop;
    } else {
      distanceToStopPct = Number((((currentPrice - stop) / currentPrice) * 100).toFixed(2));
      nearStop = currentPrice <= stop;
    }
  }

  const pos = account.positions?.[symbol];
  let position = null;
  if (pos && Number(pos.qty) > 0) {
    const qty = Number(pos.qty);
    const avgCost = Number(pos.avgCost) || 0;
    const marketValue = currentPrice * qty;
    const costBasis = avgCost * qty;
    const unrealizedPnl = marketValue - costBasis;
    position = {
      symbol,
      qty,
      avgCost,
      price: hasQuote ? currentPrice : avgCost,
      marketValue: Number(marketValue.toFixed(2)),
      costBasis: Number(costBasis.toFixed(2)),
      unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
      unrealizedPnlPct: costBasis > 0 ? Number(((unrealizedPnl / costBasis) * 100).toFixed(2)) : null
    };
  }

  const createdMs = Date.parse(thesis.createdAt || "");
  const daysSince =
    Number.isFinite(createdMs) ? Math.max(0, Math.floor((Date.now() - createdMs) / 86_400_000)) : null;

  const snapPolicy = thesis.snapshotAtCreate?.policyExposure;
  const currentPolicy = policyExposureForSymbol(symbol);
  const policyDelta =
    Number.isFinite(Number(snapPolicy)) ? Number((currentPolicy - Number(snapPolicy)).toFixed(1)) : null;

  return {
    symbol,
    currentPrice: hasQuote ? currentPrice : null,
    quoteSource: quoteResult?.source || null,
    entry: entry || null,
    target: target || null,
    stop: stop || null,
    pctFromEntry,
    distanceToTargetPct,
    distanceToStopPct,
    nearTarget,
    nearStop,
    position,
    daysSince,
    policyExposure: currentPolicy,
    policyDelta,
    linkedOrderId: thesis.orderId || null
  };
}

async function buildThesisMonitorContext(symbol, thesisText, direction, extra = {}) {
  const sym = String(symbol || "").toUpperCase();
  const quoteResult = await quoteSnapshot(sym).catch(() => null);
  const snapPolicy = extra.snapshotPolicy;
  const currentPolicy = policyExposureForSymbol(sym);
  const policyDelta = Number.isFinite(Number(snapPolicy))
    ? Number((currentPolicy - Number(snapPolicy)).toFixed(1))
    : null;
  let recentNews = [];
  try {
    const enriched = await enrichSnapshotWithRecentNews({}, sym);
    recentNews = enriched.recentNews || [];
  } catch {
    recentNews = [];
  }
  return {
    symbol: sym,
    thesisText: String(thesisText || ""),
    direction: direction || "bull",
    exitCats: extra.exitCats || [],
    quote: quoteResult?.quote || null,
    quoteSource: quoteResult?.source || null,
    quoteFallback: ["fallback_static", "fallback"].includes(quoteResult?.source),
    quoteStaleMs: Number(quoteResult?.quote?.freshnessMs) || 0,
    policyExposure: currentPolicy,
    policyDelta,
    snapshotPolicy: snapPolicy,
    relatedBills: POLICY_BILLS.filter((bill) => (bill.affected || []).includes(sym)),
    recentNews,
    fundamentals: FUNDAMENTALS[sym] || null
  };
}

async function monitorsForThesis(thesis) {
  const context = await buildThesisMonitorContext(
    thesis.ticker || thesis.symbol,
    thesis.thesisText || thesis.thesis,
    thesisDirectionForSignals(thesis.direction),
    {
    exitCats: thesis.exitCats,
    snapshotPolicy: thesis.snapshotAtCreate?.policyExposure
    }
  );
  return evaluateThesisMonitors(thesis, context);
}

async function listTheses(res, session) {
  const account = await getPaperAccount(session);
  const rows = await Promise.all(
    (account.theses || []).map(async (thesis) => {
      const outcome = await computeThesisOutcome(thesis, account);
      const monitors = await monitorsForThesis(thesis);
      const normalized = normalizeThesisRecord(thesis, { outcome, monitors });
      return {
        ...normalized,
        outcome,
        monitors,
        context: buildMarketThesisContext({
          thesis: normalized,
          outcome,
          signalsPayload: { monitors }
        })
      };
    })
  );
  sendJson(res, 200, { theses: rows });
}

async function createThesis(req, res, session) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: "invalid_json" });
  }

  const ticker = normalizeStockSymbol(body.ticker);
  const direction = String(body.direction || "").trim().toLowerCase();
  if (!ticker) return sendJson(res, 400, { error: "missing_ticker" });
  if (!["bull", "bear", "watch", "unclear"].includes(direction)) {
    return sendJson(res, 400, { error: "invalid_direction" });
  }

  const thesisText = String(body.thesisText || "").trim();
  if (!thesisText) return sendJson(res, 400, { error: "missing_thesis_text" });

  let snapshotAtCreate = body.snapshotAtCreate;
  if (!snapshotAtCreate || typeof snapshotAtCreate !== "object") {
    snapshotAtCreate = { policyExposure: policyExposureForSymbol(ticker), capturedAt: new Date().toISOString() };
  } else if (snapshotAtCreate.policyExposure == null) {
    snapshotAtCreate = { ...snapshotAtCreate, policyExposure: policyExposureForSymbol(ticker) };
  }

  const thesis = {
    id: `thesis_${randomBytes(8).toString("hex")}`,
    schemaVersion: Number(body.schemaVersion) || 1,
    ticker,
    symbol: ticker,
    direction,
    thesisText,
    exitCats: Array.isArray(body.exitCats) ? body.exitCats.map(String) : [],
    entry: Number(body.entry) || 0,
    target: Number(body.target) || 0,
    stop: Number(body.stop) || 0,
    snapshotAtCreate,
    orderId: null,
    status: "open",
    createdAt: new Date().toISOString(),
    closedAt: null,
    updatedAt: new Date().toISOString(),
    sourceStatus: "legacy_user_input"
  };

  let saved;
  await runPaperWrite(session, async (account) => {
    account.theses.unshift(thesis);
    if (account.theses.length > 100) account.theses = account.theses.slice(0, 100);
    saved = thesis;
  });

  const account = await getPaperAccount(session);
  const outcome = await computeThesisOutcome(saved, account);
  const monitors = await monitorsForThesis(saved);
  const normalized = normalizeThesisRecord(saved, { outcome, monitors });
  sendJson(res, 201, {
    thesis: {
      ...normalized,
      outcome,
      monitors,
      context: buildMarketThesisContext({
        thesis: normalized,
        outcome,
        signalsPayload: { monitors }
      })
    }
  });
}

async function thesisMonitorsRoute(res, session, thesisId) {
  const account = await getPaperAccount(session);
  const thesis = findThesis(account, thesisId);
  if (!thesis) return sendJson(res, 404, { error: "thesis_not_found" });
  const monitors = await monitorsForThesis(thesis);
  sendJson(res, 200, {
    thesisId,
    ticker: thesis.ticker || thesis.symbol,
    monitors,
    updatedAt: new Date().toISOString(),
    disclaimer: "Monitor rules are heuristic research context only — not investment advice."
  });
}

async function patchThesis(req, res, session, thesisId) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: "invalid_json" });
  }

  let result;
  let httpStatus = 200;

  await runPaperWrite(session, async (account) => {
    const thesis = findThesis(account, thesisId);
    if (!thesis) {
      result = { error: "thesis_not_found" };
      httpStatus = 404;
      return;
    }

    if (body.orderId != null) {
      thesis.orderId = String(body.orderId).trim() || null;
    }
    if (body.timeHorizon != null) thesis.timeHorizon = String(body.timeHorizon || "unspecified");
    if (body.direction != null) thesis.direction = String(body.direction || "unclear").toLowerCase();
    if (body.thesisText != null) thesis.thesisText = String(body.thesisText || thesis.thesisText || "");
    if (body.thesisRestatement != null) thesis.thesisRestatement = String(body.thesisRestatement || "");
    if (body.bullCase != null) thesis.bullCase = Array.isArray(body.bullCase) ? body.bullCase.map(String) : [];
    if (body.bearCase != null) thesis.bearCase = Array.isArray(body.bearCase) ? body.bearCase.map(String) : [];
    if (body.evidenceFor != null) thesis.evidenceFor = Array.isArray(body.evidenceFor) ? body.evidenceFor.map(String) : [];
    if (body.evidenceAgainst != null) thesis.evidenceAgainst = Array.isArray(body.evidenceAgainst) ? body.evidenceAgainst.map(String) : [];
    if (body.assumptions != null) thesis.assumptions = Array.isArray(body.assumptions) ? body.assumptions.map(String) : [];
    if (body.invalidationConditions != null) thesis.invalidationConditions = Array.isArray(body.invalidationConditions) ? body.invalidationConditions.map(String) : [];
    if (body.watchTriggers != null) thesis.watchTriggers = Array.isArray(body.watchTriggers) ? body.watchTriggers.map(String) : [];
    if (body.confidence != null && typeof body.confidence === "object") thesis.confidence = body.confidence;
    if (body.schemaVersion != null) thesis.schemaVersion = Number(body.schemaVersion) || thesis.schemaVersion || 1;
    if (body.closed === true || body.status === "closed") {
      thesis.status = "closed";
      thesis.closedAt = new Date().toISOString();
    }

    thesis.updatedAt = new Date().toISOString();
    result = { thesis };
  });

  if (httpStatus !== 200) return sendJson(res, httpStatus, result);

  const account = await getPaperAccount(session);
  const thesis = findThesis(account, thesisId);
  const outcome = await computeThesisOutcome(thesis, account);
  const monitors = await monitorsForThesis(thesis);
  const normalized = normalizeThesisRecord(thesis, { outcome, monitors });
  sendJson(res, 200, {
    thesis: {
      ...normalized,
      outcome,
      monitors,
      context: buildMarketThesisContext({
        thesis: normalized,
        outcome,
        signalsPayload: { monitors }
      })
    }
  });
}

async function thesisUpgradePreview(req, res, session, thesisId) {
  const account = await getPaperAccount(session);
  const thesis = findThesis(account, thesisId);
  if (!thesis) return sendJson(res, 404, { error: "thesis_not_found" });

  const normalized = normalizeThesisRecord(thesis);
  try {
    const analysis = await runThesisAnalyzer({
      symbol: normalized.symbol,
      thesisText: normalized.thesisText,
      direction: thesisDirectionForSignals(normalized.direction),
      horizonHint: normalized.timeHorizon
    });
    return sendJson(res, 200, {
      thesisId,
      originalSchemaVersion: Number(normalized.schemaVersion) || 1,
      proposedSchemaVersion: 2,
      originalThesisText: normalized.originalThesisText || normalized.thesisText,
      upgradePreview: {
        direction: normalized.direction === "unclear" ? "watch" : normalized.direction,
        timeHorizon: normalized.timeHorizon || "unspecified",
        thesisRestatement: analysis.thesisRestatement || normalized.thesisText,
        bullCase: analysis.bullCase || [],
        bearCase: analysis.bearCase || [],
        evidenceFor: analysis.evidenceFor || [],
        evidenceAgainst: analysis.evidenceAgainst || [],
        assumptions: analysis.missingInfo || [],
        invalidationConditions: analysis.missingInfo || [],
        watchTriggers: analysis.watchTriggers || [],
        confidence: analysis.confidence || { score: null, label: "unscored", explanation: "" },
        thesisQualityScore: Number(analysis.confidence?.score) || null
      },
      warnings: [
        "Evidence fields may include inferred reasoning and should be reviewed."
      ]
    });
  } catch (err) {
    return sendJson(res, 502, { error: "upgrade_preview_failed", detail: err.message });
  }
}

async function thesisAcceptUpgrade(req, res, session, thesisId) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: "invalid_json" });
  }
  let saved = null;
  await runPaperWrite(session, async (account) => {
    const thesis = findThesis(account, thesisId);
    if (!thesis) {
      saved = { error: "thesis_not_found" };
      return;
    }
    const preview = body.upgradePreview || {};
    thesis.originalThesisText = thesis.originalThesisText || thesis.thesisText || thesis.thesis || "";
    thesis.schemaVersion = Number(body.proposedSchemaVersion) || 2;
    thesis.direction = String(preview.direction || thesis.direction || "unclear");
    thesis.timeHorizon = String(preview.timeHorizon || thesis.timeHorizon || "unspecified");
    thesis.thesisRestatement = String(preview.thesisRestatement || thesis.thesisRestatement || thesis.thesisText || "");
    thesis.bullCase = Array.isArray(preview.bullCase) ? preview.bullCase.map(String) : [];
    thesis.bearCase = Array.isArray(preview.bearCase) ? preview.bearCase.map(String) : [];
    thesis.evidenceFor = Array.isArray(preview.evidenceFor) ? preview.evidenceFor.map(String) : [];
    thesis.evidenceAgainst = Array.isArray(preview.evidenceAgainst) ? preview.evidenceAgainst.map(String) : [];
    thesis.assumptions = Array.isArray(preview.assumptions) ? preview.assumptions.map(String) : [];
    thesis.invalidationConditions = Array.isArray(preview.invalidationConditions)
      ? preview.invalidationConditions.map(String)
      : [];
    thesis.watchTriggers = Array.isArray(preview.watchTriggers) ? preview.watchTriggers.map(String) : [];
    thesis.confidence = preview.confidence || thesis.confidence || null;
    thesis.thesisQualityScore = Number(preview.thesisQualityScore) || thesis.thesisQualityScore || null;
    thesis.updatedAt = new Date().toISOString();
    saved = { thesis };
  });

  if (saved?.error) return sendJson(res, 404, saved);
  const account = await getPaperAccount(session);
  const thesis = findThesis(account, thesisId);
  const outcome = await computeThesisOutcome(thesis, account);
  const monitors = await monitorsForThesis(thesis);
  const normalized = normalizeThesisRecord(thesis, { outcome, monitors });
  return sendJson(res, 200, {
    thesis: {
      ...normalized,
      outcome,
      monitors,
      context: buildMarketThesisContext({
        thesis: normalized,
        outcome,
        signalsPayload: { monitors }
      })
    }
  });
}

function thesisTextMatches(text, patterns) {
  const lower = String(text || "").toLowerCase();
  return patterns.some((re) => re.test(lower));
}

async function thesisSignalsHandler(res, url) {
  const symbol = normalizeStockSymbol(url.searchParams.get("symbol"));
  const thesisText = String(url.searchParams.get("thesisText") || "").trim();
  const direction = String(url.searchParams.get("direction") || "bull").toLowerCase();
  const exitCats = String(url.searchParams.get("exitCats") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const context = await buildThesisMonitorContext(symbol, thesisText, direction, { exitCats });
  const socialPulse = await getSocialPulse({
    symbols: [symbol],
    figureLinks: FIGURE_LINKS,
    includeRss: true
  });
  const payload = buildThesisSignals(symbol, thesisText, direction, { ...context, socialPulse });
  sendJson(res, 200, payload);
}

function evaluateThesisMonitors(thesis, context = {}) {
  const sym = String(context.symbol || thesis?.ticker || "").toUpperCase();
  const text = String(context.thesisText || thesis?.thesisText || "").toLowerCase();
  const exitCats = new Set(context.exitCats || thesis?.exitCats || []);
  const monitors = [];
  const fundamentals = context.fundamentals || FUNDAMENTALS[sym] || null;
  const semisThesis =
    sym === "NVDA" ||
    sym === "AMD" ||
    sym === "TSM" ||
    thesisTextMatches(text, [/chip|semiconductor|blackwell|cuda|gpu|data.?center|hyperscal|capex|export/]);

  const pushMonitor = (row) => {
    monitors.push({
      id: row.id || `mon_${row.ruleId}_${sym}`,
      ruleId: row.ruleId,
      text: row.text,
      src: row.src,
      status: row.status,
      nextCheck: row.nextCheck,
      why: row.why
    });
  };

  if (context.quoteFallback) {
    pushMonitor({
      ruleId: "quote_freshness",
      text: `${sym} quote feed on fallback prices`,
      src: context.quoteSource || "Quote provider",
      status: "Broken",
      nextCheck: "Connect Finnhub or Yahoo live quotes",
      why: "Fallback prices cannot support thesis tracking — research context only until live quotes return."
    });
  } else if (context.quoteStaleMs > 120000) {
    pushMonitor({
      ruleId: "quote_freshness",
      text: `${sym} quote freshness`,
      src: context.quoteSource || "Quote provider",
      status: "Watch",
      nextCheck: "Refresh market quotes",
      why: "Stale quotes weaken plan checkpoints — confirm before acting on price levels."
    });
  } else if (context.quote) {
    pushMonitor({
      ruleId: "quote_freshness",
      text: `${sym} live quote feed`,
      src: context.quoteSource || "Quote provider",
      status: "Normal",
      nextCheck: "On each dashboard refresh",
      why: "Quote feed is current enough for research context."
    });
  }

  const delta = Number(context.policyDelta);
  if (Number.isFinite(delta)) {
    const abs = Math.abs(delta);
    pushMonitor({
      ruleId: "policy_exposure_delta",
      text: "Policy exposure vs plan snapshot",
      src: "TradeSimple policy graph",
      status: abs >= 20 ? "Catalyst Soon" : abs >= 8 ? "Watch" : "Normal",
      nextCheck: "Bill momentum & committee calendar",
      why: `Policy exposure moved ${delta >= 0 ? "+" : ""}${delta} pts since the plan was saved — correlational context only.`
    });
  }

  for (const bill of (context.relatedBills || []).slice(0, 2)) {
    const momentum = computeLegislativeMomentum(bill);
    const status =
      momentum >= 70 ? "Catalyst Soon" : momentum >= 45 ? "Watch" : momentum <= 20 && bill.status === "committee" ? "Normal" : "Watch";
    pushMonitor({
      ruleId: "bill_momentum",
      id: `mon_bill_${bill.id}`,
      text: `${bill.shortTitle || bill.title} — legislative momentum`,
      src: "Congress.gov",
      status,
      nextCheck: bill.floorScheduled ? "Floor vote window" : "Committee / markup calendar",
      why: (bill.passImpacts || []).find((row) => row.sym === sym)?.why || bill.plainEnglish || "Policy path may affect research context for this plan."
    });
  }

  if (semisThesis) {
    pushMonitor({
      ruleId: "earnings",
      id: `mon_earnings_${sym}`,
      text: `${sym} earnings & guidance`,
      src: "Company filings",
      status: "Catalyst Soon",
      nextCheck: fundamentals?.catalyst?.includes("Earnings")
        ? "Modeled earnings window — confirm on calendar"
        : "Next earnings date (modeled)",
      why: "Data-center revenue mix and guidance are direct falsification tests for the plan."
    });
    pushMonitor({
      ruleId: "export_policy",
      id: `mon_export_${sym}`,
      text: "Export control headlines (BIS)",
      src: "Commerce / BIS",
      status: thesisTextMatches(text, [/export|china/]) ? "Watch" : "Normal",
      nextCheck: "Federal Register & BIS rule updates",
      why: "Incremental China GPU rules can affect revenue assumptions — research context only."
    });
  }

  if (fundamentals && thesisTextMatches(text, [/capex|hyperscal|cloud|microsoft|amazon|google|meta/])) {
    pushMonitor({
      ruleId: "hyperscaler_capex",
      id: `mon_capex_${sym}`,
      text: "Hyperscaler capex commentary",
      src: "Mega-cap earnings",
      status: "Watch",
      nextCheck: "Next MSFT / AMZN / GOOGL / META earnings",
      why: "Cloud capex guides inform AI accelerator demand context — not a causal forecast."
    });
  }

  const exitLabels = {
    bill: "Bill or legislation fails",
    earnings: "Earnings miss",
    contract: "Contract cut or cancelled",
    competitor: "Competitor gains ground",
    macro: "Macro shift"
  };
  for (const cat of exitCats) {
    pushMonitor({
      ruleId: `exit_${cat}`,
      text: exitLabels[cat] || `Exit: ${cat}`,
      src: "Your exit plan",
      status: "Watch",
      nextCheck: "When headline matches your exit rule",
      why: "You defined this as a reason to reconsider the plan."
    });
  }

  return monitors.slice(0, 8);
}

function buildThesisSignals(symbol, thesisText, direction, context = {}) {
  const sym = String(symbol || "NVDA").toUpperCase();
  const text = String(thesisText || "");
  const lower = text.toLowerCase();
  const fundamentals = context.fundamentals || FUNDAMENTALS[sym] || null;
  const govDependent = Boolean(CONTRACT_PROFILES[sym]);
  const relatedBills = context.relatedBills || POLICY_BILLS.filter((bill) => (bill.affected || []).includes(sym));
  const now = new Date().toISOString();
  const signals = [];
  const evidenceFlat = [];
  const evidencePool = collectThesisEvidencePool(sym, context.recentNews || []);

  const pushSignal = (row) => {
    const normalizedEvidence = normalizeSignalEvidence(row.evidence, row);
    signals.push({ ...row, evidence: normalizedEvidence });
    if (normalizedEvidence) evidenceFlat.push({ ...normalizedEvidence, signalId: row.id });
  };

  if (fundamentals?.catalyst) {
    pushSignal({
      id: `${sym}_catalyst`,
      title: "Company catalyst calendar",
      source: "Modeled fundamentals",
      sourceUrl: `/api/analysis/stock?symbol=${encodeURIComponent(sym)}`,
      timestamp: now,
      summary: fundamentals.catalyst,
      whyTicker: `Frames the next checkpoints that can move ${sym} — separate from generic policy headlines.`,
      thesisPart: "Catalysts & timing",
      category: "market",
      evidence: {
        source: "TradeSimple fundamentals profile",
        date: now.slice(0, 10),
        quote: fundamentals.catalyst,
        supports: "Catalysts & timing"
      }
    });
  }

  if (fundamentals) {
    const bullLine = fundamentals.plainBull || "";
    const bearLine = fundamentals.plainBear || "";
    if (bullLine || bearLine) {
      pushSignal({
        id: `${sym}_plain_case`,
        title: direction === "bear" ? "Bear case in plain English" : "Bull case in plain English",
        source: "Modeled fundamentals",
        sourceUrl: `/api/analysis/stock?symbol=${encodeURIComponent(sym)}`,
        timestamp: now,
        summary: direction === "bear" ? bearLine : bullLine,
        whyTicker: `Grounds your ${direction === "bear" ? "downside" : "upside"} view in ${sym}-specific business drivers, not a generic market take.`,
        thesisPart: "Business drivers",
        category: "market",
        evidence: {
          source: "TradeSimple fundamentals profile",
          date: now.slice(0, 10),
          quote: direction === "bear" ? bearLine : bullLine,
          supports: "Business drivers"
        }
      });
    }
  }

  const semisThesis =
    sym === "NVDA" ||
    sym === "AMD" ||
    sym === "TSM" ||
    thesisTextMatches(lower, [/chip|semiconductor|blackwell|cuda|gpu|data.?center|hyperscal|capex|export/]);

  if (semisThesis) {
    pushSignal({
      id: `${sym}_hyperscaler_capex`,
      title: "Hyperscaler AI capex",
      source: "Mega-cap earnings · modeled",
      sourceUrl: "https://www.sec.gov/edgar/search/",
      timestamp: now,
      summary:
        "Microsoft, Amazon, Google, and Meta capex guides set the order pipeline for AI accelerators — watch quarterly capex commentary, not generic Congress headlines.",
      whyTicker: `${sym} revenue visibility ties to cloud buyers raising or cutting AI infrastructure spend.`,
      thesisPart: "Demand pipeline",
      category: "market",
      evidence: {
        source: "Hyperscaler capex linkage (MSFT, AMZN, GOOGL, META)",
        date: now.slice(0, 10),
        quote: "Cloud capex guides are the leading indicator for data-center GPU demand.",
        supports: "Demand pipeline"
      }
    });
    pushSignal({
      id: `${sym}_export_controls`,
      title: "AI chip export controls",
      source: "BIS / Commerce · policy model",
      sourceUrl: "https://www.bis.doc.gov/",
      timestamp: now,
      summary:
        "Rules on advanced GPU sales to China are the largest near-term revenue risk for leading AI chip names — incremental tightening often hits before earnings confirm it.",
      whyTicker: `Export headlines reprice ${sym} faster than slow-moving fab bills when China datacenter demand is in the thesis.`,
      thesisPart: "Policy & regulation",
      category: "bill",
      evidence: {
        source: "Export control policy track",
        date: now.slice(0, 10),
        quote: "Incremental BIS rules can constrain China datacenter GPU revenue.",
        supports: "Policy & regulation"
      }
    });
    if (sym === "NVDA" || lower.includes("blackwell")) {
      pushSignal({
        id: "NVDA_blackwell",
        title: "Blackwell product ramp",
        source: "Company / supply chain · modeled",
        sourceUrl: `/api/analysis/stock?symbol=NVDA`,
        timestamp: now,
        summary:
          "Blackwell shipment timing and yield commentary drive near-term revenue beats or misses — supply constraints can delay the thesis even when demand is strong.",
        whyTicker: "NVDA’s premium multiple assumes a clean Blackwell ramp; slips show up in guidance first.",
        thesisPart: "Product cycle",
        category: "market",
        evidence: {
          source: "NVDA catalyst profile",
          date: now.slice(0, 10),
          quote: "Earnings · Blackwell GPU ramp · CHIPS Act grant flow",
          supports: "Product cycle"
        }
      });
    }
    if (sym === "NVDA" || lower.includes("amd") || lower.includes("compet")) {
      pushSignal({
        id: `${sym}_amd_competition`,
        title: "AMD MI300 competition",
        source: "Peer earnings · market",
        sourceUrl: `/api/analysis/stock?symbol=AMD`,
        timestamp: now,
        summary:
          "AMD design wins at hyperscalers signal share shifts — even small share losses matter when the buyer base is concentrated.",
        whyTicker: `Competitive GPU wins reprice ${sym} through market-share and margin narratives before revenue prints.`,
        thesisPart: "Competitive risk",
        category: "market",
        evidence: {
          source: "AMD catalyst profile",
          date: now.slice(0, 10),
          quote: "MI300 / AI GPU share · Data center CPU cycle",
          supports: "Competitive risk"
        }
      });
    }
    pushSignal({
      id: `${sym}_earnings_window`,
      title: "Next earnings checkpoint",
      source: "Earnings calendar · modeled",
      sourceUrl: `/api/analysis/stock?symbol=${encodeURIComponent(sym)}`,
      timestamp: now,
      summary:
        "Data-center revenue mix, gross margin, and forward guidance are the direct repricing events — treat earnings as the falsification date for the plan.",
      whyTicker: `${sym} moves hardest on guidance changes to AI revenue, not on unrelated lobbying filings.`,
      thesisPart: "Catalysts & timing",
      category: "market",
      evidence: {
        source: "Earnings falsification window",
        date: now.slice(0, 10),
        quote: "Quarterly prints are the clearest checkpoint for AI demand assumptions.",
        supports: "Catalysts & timing"
      }
    });
  }

  const billRelevant = (bill) => {
    const tags = (bill.tags || []).join(" ").toLowerCase();
    const title = `${bill.title || ""} ${bill.shortTitle || ""}`.toLowerCase();
    if (semisThesis && (tags.includes("semiconductor") || title.includes("chip") || title.includes("export"))) return true;
    if (thesisTextMatches(lower, [/bill|congress|legislation|policy|chips|medicare|antitrust|crypto/])) {
      if (lower.includes("chip") && (title.includes("chip") || tags.includes("semiconductor"))) return true;
      if (lower.includes("export") && title.includes("export")) return true;
      if (lower.includes("bill") || lower.includes("congress") || lower.includes("legislation")) return true;
    }
    return semisThesis && (tags.includes("semiconductor") || title.includes("chip") || title.includes("export"));
  };

  for (const bill of relatedBills.filter(billRelevant).slice(0, 4)) {
    const momentum = computeLegislativeMomentum(bill);
    pushSignal({
      id: `bill_${bill.id}`,
      title: bill.shortTitle || bill.title,
      source: bill.exactCongressRecord ? "Congress.gov" : "Congress.gov · modeled",
      sourceUrl: billCongressUrl(bill),
      timestamp: bill.latestActionDate || now.slice(0, 10),
      summary: bill.plainEnglish || bill.signal || bill.latestAction || "Legislative update tracked for this ticker.",
      whyTicker: (bill.passImpacts || []).find((row) => row.sym === sym)?.why || bill.impact || `Mapped to ${sym} in TradeSimple policy graph.`,
      thesisPart: "Policy & regulation",
      category: "bill",
      evidence: evidenceFromBill(bill, sym),
      meta: { momentum, billId: bill.id }
    });
  }

  if (govDependent && thesisTextMatches(lower, [/contract|government|federal|dod|defense/])) {
    const profile = CONTRACT_PROFILES[sym];
    pushSignal({
      id: `${sym}_contracts`,
      title: "Federal contract exposure",
      source: "USASpending.gov · modeled",
      sourceUrl: usaspendingSearchUrl(sym),
      timestamp: now,
      summary: profile?.note || "Government contract awards and cancellations can move names with high federal revenue mix.",
      whyTicker: `${sym} has modeled government revenue exposure — contract headlines matter for this plan.`,
      thesisPart: "Government revenue",
      category: "contract",
      evidence: evidenceFromContractProfile(sym, profile)
    });
  }

  const claimTexts = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 24)
    .slice(0, 4);
  const fallbackClaim = text.slice(0, 220) || `Plan for ${sym}`;
  const claims = (claimTexts.length ? claimTexts : [fallbackClaim]).map((claimText, index) => ({
    text: claimText,
    evidence: mapClaimEvidence(claimText, evidencePool, index)
  }));

  const socialPulse = context.socialPulse || null;
  for (const item of (socialPulse?.items || []).slice(0, 3)) {
    if (signals.length >= 10) break;
    const badge = item.badge || socialPulse?.primaryBadge || "Curated";
    pushSignal({
      id: `social_${item.id || slug(item.title)}`,
      title: item.title || "Public figure / feed item",
      source: item.source || (badge === "Live feed" ? "RSS feed" : "Curated map"),
      sourceUrl: item.url || null,
      timestamp: item.publishedAt || now,
      summary: item.summary || item.title || "",
      whyTicker: `${sym} can appear in policy headlines and testimony — treat ${badge.toLowerCase()} items as context, not trade triggers.`,
      thesisPart: "Policy & figures",
      category: "figure",
      evidence: buildEvidenceItem({
        id: item.id,
        title: item.title,
        summary: item.summary,
        excerpt: item.summary,
        source: item.source || badge,
        sourceUrl: item.url,
        publishedAt: item.publishedAt,
        supports: "Policy & figures",
        symbol: sym,
        type: "figure",
        modeled: item.modeled !== false,
        relevance: socialPulse?.disclaimer || "Research context only."
      }),
      meta: { socialBadge: badge }
    });
  }

  const monitors = evaluateThesisMonitors(
    { ticker: sym, thesisText: text, direction, exitCats: context.exitCats || [] },
    context
  );

  return {
    source: "thesis_signals",
    symbol: sym,
    direction,
    updatedAt: now,
    signals: signals.slice(0, 10),
    evidence: evidenceFlat,
    evidencePool,
    claims,
    monitors,
    socialPulse,
    timelineEvents: buildThesisTimelineEvents(sym, relatedBills, fundamentals),
    earningsLabel: fundamentals?.catalyst?.includes("Earnings") ? "Modeled — confirm live calendar" : "—",
    govDependent,
    disclaimer: "Research context only. Signals and monitors do not imply causation or investment advice."
  };
}

function paperAccountKey(session) {
  return String(session?.user?.id || session?.user?.email || "demo-user").replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

let tickerMapPromise = null;

function loadTickerMap() {
  if (!tickerMapPromise) {
    tickerMapPromise = (async () => {
      const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
        headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json" }
      });
      if (!res.ok) throw new Error("SEC company_tickers.json HTTP " + res.status);
      const obj = await res.json();
      const m = new Map();
      for (const k of Object.keys(obj)) {
        const row = obj[k];
        if (row?.ticker && row.cik_str != null) {
          m.set(String(row.ticker).toUpperCase(), String(row.cik_str).padStart(10, "0"));
        }
      }
      return m;
    })();
  }
  return tickerMapPromise;
}

function findLatest10K(recent) {
  const { form, filingDate, accessionNumber, primaryDocument } = recent;
  for (let i = 0; i < form.length; i++) {
    if (form[i] === "10-K") {
      return {
        form: form[i],
        filingDate: filingDate[i],
        accessionNumber: accessionNumber[i],
        primaryDocument: primaryDocument[i]
      };
    }
  }
  return null;
}

function accessionDir(accession) {
  return accession.replace(/-/g, "");
}

function stripHtmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractItem1ARiskFactors(html) {
  const patterns = [
    /ITEM\s*1A[.\s\u00A0]*RISK\s*FACTORS([\s\S]*?)ITEM\s*1B/gi,
    /Item\s*1A[.\s\u00A0]*Risk\s*Factors([\s\S]*?)Item\s*1B/gi,
    /ITEM\s*1A([\s\S]{800,}?)ITEM\s*1B/gi,
    /Item\s*1A([\s\S]{800,}?)Item\s*1B/gi
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      const t = stripHtmlToText(m[1]);
      if (t.length > 400) return t.slice(0, 120000);
    }
  }
  const m2 = html.match(/RISK\s*FACTORS([\s\S]{600,25000}?)ITEM\s*1B/gi);
  if (m2) {
    const t = stripHtmlToText(m2[0]);
    if (t.length > 400) return t.slice(0, 120000);
  }
  return "";
}

async function fetchEdgarRisk(symbol) {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) throw new Error("Invalid symbol");

  const tickers = await loadTickerMap();
  const cik10 = tickers.get(sym);
  if (!cik10) throw new Error("Ticker not found in SEC company_tickers");

  const subUrl = `https://data.sec.gov/submissions/CIK${cik10}.json`;
  const sRes = await fetch(subUrl, {
    headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json" }
  });
  if (!sRes.ok) throw new Error("data.sec.gov submissions HTTP " + sRes.status);
  const sub = await sRes.json();
  const recent = sub.filings?.recent;
  if (!recent) throw new Error("No filings.recent on submission");

  const tenk = findLatest10K(recent);
  if (!tenk) throw new Error("No 10-K in recent filings list");

  const cikInt = String(parseInt(cik10, 10));
  const dir = accessionDir(tenk.accessionNumber);
  const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${dir}/${tenk.primaryDocument}`;

  const hRes = await fetch(docUrl, {
    headers: { "User-Agent": SEC_USER_AGENT, Accept: "text/html,*/*" }
  });
  if (!hRes.ok) throw new Error("Archives filing HTTP " + hRes.status);
  const html = await hRes.text();

  let risk = extractItem1ARiskFactors(html);
  if (!risk) {
    const fallback = stripHtmlToText(html);
    risk = fallback.length > 800 ? fallback.slice(0, 15000) : "";
  }

  return {
    symbol: sym,
    cik: cik10,
    company: sub.name || null,
    form: tenk.form,
    filingDate: tenk.filingDate,
    accessionNumber: tenk.accessionNumber,
    primaryDocument: tenk.primaryDocument,
    sourceUrl: docUrl,
    riskFactors: risk
  };
}

async function buildEdgarSnapshot(symbol) {
  const data = await fetchEdgarRisk(symbol);
  const riskText = String(data.riskFactors || "");

  const simplified = riskText.trim()
    ? await runEdgarSimplifier({
        symbol,
        riskFactorsText: riskText,
        filingDate: data.filingDate
      }).catch(() => null)
    : null;

  return { ...data, simplified };
}

async function shareEdgarRiskFactors(res, pathname) {
  const sym = decodeURIComponent(pathname.split("/").pop() || "")
    .toUpperCase()
    .replace(/[^A-Z.]/g, "");

  if (!sym) return sendJson(res, 400, { error: "symbol_required" });

  try {
    const payload = await buildEdgarSnapshot(sym);
    return sendJson(res, 200, payload);
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function edgarRiskFactors(res, pathname) {
  try {
    const raw = decodeURIComponent(pathname.slice("/api/edgar/".length));
    const sym = raw.split(/[./]/)[0] || "";
    if (!sym) return sendJson(res, 400, { error: "symbol_required" });
    const payload = await buildEdgarSnapshot(sym);
    if (!String(payload.riskFactors || "").trim()) {
      return sendJson(res, 200, { message: "Risk factors section unavailable for this filing.", ...payload });
    }
    return sendJson(res, 200, payload);
  } catch (e) {
    const msg = e.message || String(e);
    let code = 502;
    if (/Invalid symbol/.test(msg)) code = 400;
    sendJson(res, code, { error: msg });
  }
}

// Request-only fields per USASpending SpendingByAwardFields (contracts).
// internal_id is returned automatically; Period of Performance * are response-only aliases.
const USASPENDING_AWARD_FIELDS = [
  "Award ID",
  "generated_internal_id",
  "recipient_id",
  "Recipient Name",
  "Awarding Agency",
  "Award Amount",
  "Description",
  "Start Date",
  "End Date",
  "Last Modified Date",
  "Contract Award Type",
  "NAICS",
  "PSC"
];

const USASPENDING_CONTRACT_AWARD_TYPES = ["A", "B", "C", "D"];

function usaspendingCacheGet(key) {
  const cached = usaspendingCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt >= USASPENDING_CACHE_TTL_MS) {
    usaspendingCache.delete(key);
    return null;
  }
  return cached.data;
}

function usaspendingCacheSet(key, data) {
  usaspendingCache.set(key, { fetchedAt: Date.now(), data });
}

function usaspendingAwardDirectUrl(row) {
  const genId = row?.["generated_internal_id"] || row?.generated_internal_id || row?.internalId;
  if (genId) return `https://www.usaspending.gov/award/${genId}/`;
  const numericId = row?.internal_id ?? row?.numericId;
  if (numericId != null && numericId !== "") return `https://www.usaspending.gov/award/${numericId}/`;
  return null;
}

function usaspendingAwardDescription(row) {
  const desc = row?.Description ?? row?.description;
  if (desc && String(desc).trim()) return String(desc).trim();
  const parts = [];
  const contractType = row?.["Contract Award Type"] || row?.contractType || row?.["Award Type"];
  if (contractType) parts.push(String(contractType).trim());
  if (row?.NAICS) parts.push(`NAICS ${row.NAICS}`);
  if (row?.PSC) parts.push(`PSC ${row.PSC}`);
  if (parts.length) return parts.join(" · ");
  const awardId = row?.["Award ID"] || row?.awardId;
  const recipient = row?.["Recipient Name"] || row?.recipientName;
  const agency = row?.["Awarding Agency"] || row?.awardingAgency;
  if (awardId) {
    return `${recipient || "Federal recipient"} — ${agency || "Federal agency"} · contract ${awardId}`;
  }
  return null;
}

function mapUsaspendingAwardRow(row) {
  const description = usaspendingAwardDescription(row);
  return {
    awardId: row["Award ID"] || null,
    internalId: row["generated_internal_id"] || null,
    numericId: row.internal_id ?? null,
    recipientId: row.recipient_id || null,
    directUrl: usaspendingAwardDirectUrl(row),
    recipientName: row["Recipient Name"] || null,
    awardingAgency: row["Awarding Agency"] || null,
    description,
    contractType: row["Contract Award Type"] || row["Award Type"] || null,
    obligatedAmount: Number(row["Award Amount"] || 0),
    startDate: row["Start Date"] || row["Period of Performance Start Date"] || null,
    endDate: row["End Date"] || row["Period of Performance Current End Date"] || null,
    lastModifiedDate: row["Last Modified Date"] || null
  };
}

function pickBestUsaspendingRecipient(results, keyword) {
  if (!Array.isArray(results) || !results.length) return null;
  const kw = String(keyword || "")
    .trim()
    .toUpperCase();
  const scored = results.map((row) => {
    const name = String(row.name || row.recipient_name || "").toUpperCase();
    let score = 0;
    if (name === kw) score += 100;
    else if (kw && name.includes(kw)) score += 55;
    else if (kw.length >= 3 && name.includes(kw.slice(0, 3))) score += 20;
    const level = row.recipient_level || row.recipientLevel;
    if (level === "P") score += 12;
    else if (level === "R") score += 6;
    const amount = Number(row.amount || 0);
    if (amount > 0) score += Math.min(12, Math.log10(amount + 1));
    return { row, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 18) return null;
  const r = best.row;
  return {
    id: r.id || null,
    name: r.name || r.recipient_name || null,
    uei: r.uei || null,
    duns: r.duns || null,
    level: r.recipient_level || r.recipientLevel || null,
    amount: Number(r.amount || 0)
  };
}

async function fetchUsaspendingRecipientAutocomplete(searchText) {
  const term = String(searchText || "").trim();
  if (!term) return null;
  const cacheKey = `autocomplete:${term.toLowerCase()}`;
  const cached = usaspendingCacheGet(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchWithTimeout(
      `${USASPENDING_API_BASE}/autocomplete/recipient/`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ search_text: term, limit: 10 })
      },
      USASPENDING_FETCH_TIMEOUT_MS
    );
    if (!response.ok) return null;
    const data = await response.json();
    const match = pickBestUsaspendingRecipient(
      (data.results || []).map((row) => ({
        name: row.recipient_name,
        recipient_name: row.recipient_name,
        uei: row.uei,
        duns: row.duns
      })),
      term
    );
    if (match?.name) {
      usaspendingCacheSet(cacheKey, match);
      return match;
    }
  } catch {
    /* API down or rate-limited */
  }
  return null;
}

async function fetchUsaspendingRecipientList(keyword) {
  const term = String(keyword || "").trim();
  if (!term) return null;
  const cacheKey = `recipient-list:${term.toLowerCase()}`;
  const cached = usaspendingCacheGet(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchWithTimeout(
      `${USASPENDING_API_BASE}/recipient/`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          keyword: term,
          award_type: "contracts",
          limit: 12,
          page: 1,
          sort: "amount",
          order: "desc"
        })
      },
      USASPENDING_FETCH_TIMEOUT_MS
    );
    if (!response.ok) return null;
    const data = await response.json();
    const match = pickBestUsaspendingRecipient(data.results || [], term);
    if (match?.id) {
      usaspendingCacheSet(cacheKey, match);
      return match;
    }
  } catch {
    /* API down or rate-limited */
  }
  return null;
}

async function searchUsaspendingRecipient(searchTerms) {
  const terms = [...new Set(searchTerms.map((t) => String(t || "").trim()).filter(Boolean))];
  for (const term of terms) {
    const listed = await fetchUsaspendingRecipientList(term);
    if (listed?.id) return listed;
    const auto = await fetchUsaspendingRecipientAutocomplete(term);
    if (auto?.name) {
      const resolved = await fetchUsaspendingRecipientList(auto.name);
      if (resolved?.id) return resolved;
    }
  }
  return null;
}

async function fetchUsaspendingSpendingByAward(filters, cacheKey) {
  if (cacheKey) {
    const cached = usaspendingCacheGet(cacheKey);
    if (cached) return cached;
  }

  try {
    const response = await fetchWithTimeout(
      `${USASPENDING_API_BASE}/search/spending_by_award/`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: { ...filters, award_type_codes: USASPENDING_CONTRACT_AWARD_TYPES },
          fields: USASPENDING_AWARD_FIELDS,
          sort: "Award Amount",
          order: "desc",
          page: 1,
          limit: 15
        })
      },
      USASPENDING_FETCH_TIMEOUT_MS
    );
    if (!response.ok) return null;
    const data = await response.json();
    const results = (data.results || []).slice(0, 15).map(mapUsaspendingAwardRow);
    if (results.length && cacheKey) usaspendingCacheSet(cacheKey, results);
    return results.length ? results : null;
  } catch {
    return null;
  }
}

async function fetchUsaspendingAwardsByRecipient(recipientId) {
  const id = String(recipientId || "").trim();
  if (!id) return null;
  return fetchUsaspendingSpendingByAward({ recipient_id: id }, `awards:recipient:${id.toLowerCase()}`);
}

async function fetchUsaspendingAwards(company) {
  const key = String(company || "").trim().toLowerCase();
  if (!key) return null;
  const cacheKey = `awards:company:${key}`;
  const cached = usaspendingCacheGet(cacheKey);
  if (cached) return cached;

  const filterSets = [
    { recipient_search_text: [company] },
    { keywords: [company] },
    { recipient_search_text: [`${company} CORP`] },
    { keywords: [company.toUpperCase()] }
  ];

  for (const extraFilters of filterSets) {
    const results = await fetchUsaspendingSpendingByAward(extraFilters);
    if (results?.length) {
      usaspendingCacheSet(cacheKey, results);
      return results;
    }
  }
  return null;
}

async function resolveContractUsaspendingContext(symbol) {
  const sym = String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const cacheKey = `ctx:${sym}`;
  const cached = usaspendingCacheGet(cacheKey);
  if (cached) return cached;

  const companyHint = resolveContractCompanyName(sym);
  let awards = await fetchUsaspendingAwards(companyHint);
  let recipientId = awards?.find((row) => row.recipientId)?.recipientId || null;
  let recipientName = awards?.find((row) => row.recipientName)?.recipientName || null;
  let company = companyHint;
  let resolvedVia = awards?.length ? "company_search" : null;

  if (!awards?.length && sym !== companyHint) {
    awards = await fetchUsaspendingAwards(sym);
    if (awards?.length) resolvedVia = "symbol_search";
  }

  if (!awards?.length) {
    const recipient = await searchUsaspendingRecipient([companyHint, sym]);
    if (recipient) {
      company = recipient.name || companyHint;
      recipientId = recipient.id;
      recipientName = recipient.name || company;
      awards = await fetchUsaspendingAwardsByRecipient(recipient.id);
      if (!awards?.length) awards = await fetchUsaspendingAwards(company);
      resolvedVia = "recipient_search";
    }
  }

  const data = {
    symbol: sym,
    company,
    recipientId,
    recipientName,
    awards: awards || null,
    resolvedVia
  };
  if (awards?.length) usaspendingCacheSet(cacheKey, data);
  return data;
}

async function fetchUsaspendingAwardDetail(awardId) {
  const id = String(awardId || "").trim();
  if (!id) return null;
  const cacheKey = `award-detail:${id}`;
  const cached = usaspendingCacheGet(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchWithTimeout(
      `${USASPENDING_API_BASE}/awards/${encodeURIComponent(id)}/`,
      { headers: { accept: "application/json" } },
      USASPENDING_FETCH_TIMEOUT_MS
    );
    if (!response.ok) return null;
    const data = await response.json();
    const mapped = {
      id: data.id ?? null,
      generatedInternalId: data.generated_unique_award_id || id,
      directUrl: usaspendingAwardDirectUrl({
        generated_internal_id: data.generated_unique_award_id,
        internal_id: data.id
      }),
      category: data.category || null,
      type: data.type || null,
      typeDescription: data.type_description || null,
      description: data.description || null,
      totalObligation: Number(data.total_obligation || 0),
      dateSigned: data.date_signed || null,
      awardingAgency: data.awarding_agency?.toptier_agency?.name || data.awarding_agency?.subtier_agency?.name || null,
      recipientName: data.recipient?.recipient_name || null,
      recipientId: data.recipient?.recipient_hash || null,
      periodOfPerformance: data.period_of_performance || null
    };
    usaspendingCacheSet(cacheKey, mapped);
    return mapped;
  } catch {
    return null;
  }
}

async function fetchUsaspendingAgencyBudget(agencyCode) {
  const code = String(agencyCode || "").trim();
  if (!code) return null;
  const cacheKey = `agency-budget:${code}`;
  const cached = usaspendingCacheGet(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchWithTimeout(
      `${USASPENDING_API_BASE}/agency/${encodeURIComponent(code)}/budgetary_resources/`,
      { headers: { accept: "application/json" } },
      USASPENDING_FETCH_TIMEOUT_MS
    );
    if (!response.ok) return null;
    const data = await response.json();
    const byFiscalYear = {};
    for (const row of data.budgetary_resources || []) {
      const fy = row.fiscal_year ?? row.year;
      const amount = Number(row.total_budgetary_resources ?? row.budgetary_resources_amount ?? row.amount ?? 0);
      if (fy == null) continue;
      byFiscalYear[String(fy)] = (byFiscalYear[String(fy)] || 0) + amount;
    }
    const payload = { agencyCode: code, byFiscalYear };
    usaspendingCacheSet(cacheKey, payload);
    return payload;
  } catch {
    return null;
  }
}

function contractSymbolForCompany(company) {
  const c = String(company || "").toLowerCase();
  if (c.includes("lockheed")) return "LMT";
  if (c.includes("booz")) return "BAH";
  if (c.includes("leidos")) return "LDOS";
  if (c.includes("saic")) return "SAIC";
  if (c.includes("palantir")) return "PLTR";
  if (c.includes("rtx") || c.includes("raytheon")) return "RTX";
  if (c.includes("northrop")) return "NOC";
  if (c.includes("general dynamics")) return "GD";
  if (c.includes("geo group")) return "GEO";
  if (c.includes("corecivic")) return "CXW";
  if (c.includes("spacex") || c.includes("space exploration")) return "SPCX";
  return null;
}

async function contractsByCompany(res, pathname) {
  try {
    const company = decodeURIComponent(pathname.slice("/api/contracts/".length)).trim();
    if (!company) return sendJson(res, 400, { error: "missing_company" });

    const rawResults = await fetchUsaspendingAwards(company);
    let recipientId = rawResults?.find((row) => row.recipientId)?.recipientId || null;
    let resolvedVia = rawResults?.length ? "company_search" : null;
    if (!rawResults?.length) {
      const recipient = await searchUsaspendingRecipient([company]);
      if (recipient?.id) {
        recipientId = recipient.id;
        const byRecipient = await fetchUsaspendingAwardsByRecipient(recipient.id);
        if (byRecipient?.length) {
          rawResults = byRecipient;
          resolvedVia = "recipient_search";
        }
      }
    }
    if (!rawResults?.length) {
      return sendJson(res, 502, { error: "usaspending_unavailable", message: "USASpending.gov returned no awards for this company." });
    }

    const symbol = contractSymbolForCompany(company);
    const results = symbol
      ? rawResults.map((row) => ({
          ...row,
          eventSignal: computeContractEventSignal(symbol, row.obligatedAmount, row.awardingAgency),
          moneyTrail: buildGovernmentMoneyTrail(symbol, row.obligatedAmount, row.awardingAgency, row.description)
        }))
      : rawResults;

    sendJson(res, 200, {
      company,
      symbol,
      results,
      recipientId,
      resolvedVia,
      source: "usaspending.gov"
    });
  } catch (e) {
    sendJson(res, 502, { error: e.message || String(e) });
  }
}

async function usaspendingAwardRoute(res, pathname) {
  const awardId = decodeURIComponent(pathname.slice("/api/usaspending/award/".length).split(/[/?#]/)[0]).trim();
  if (!awardId) return sendJson(res, 400, { error: "missing_award_id" });
  const detail = await fetchUsaspendingAwardDetail(awardId);
  if (!detail) {
    return sendJson(res, 502, { error: "usaspending_unavailable", message: "Could not load award from USASpending.gov." });
  }
  sendJson(res, 200, { ...detail, source: "usaspending.gov" });
}

async function usaspendingRecipientRoute(res, url) {
  const symbol = String(url.searchParams.get("symbol") || "").toUpperCase().replace(/[^A-Z]/g, "");
  const query = String(url.searchParams.get("q") || url.searchParams.get("keyword") || "").trim();
  const terms = symbol ? [resolveContractCompanyName(symbol), symbol] : query ? [query] : [];
  if (!terms.length) return sendJson(res, 400, { error: "missing_query", message: "Provide symbol= or q=." });
  const recipient = await searchUsaspendingRecipient(terms);
  if (!recipient) {
    return sendJson(res, 404, { error: "recipient_not_found", message: "No USASpending recipient matched that query." });
  }
  sendJson(res, 200, { ...recipient, source: "usaspending.gov" });
}

async function agencyBudget(res, pathname) {
  try {
    const agencyCode = decodeURIComponent(pathname.slice("/api/agency-budget/".length)).trim();
    if (!agencyCode) return sendJson(res, 400, { error: "missing_agency_code" });
    const payload = await fetchUsaspendingAgencyBudget(agencyCode);
    if (!payload) throw new Error(`usaspending_agency_budget_unavailable`);
    sendJson(res, 200, payload);
  } catch (e) {
    sendJson(res, 502, { error: e.message || String(e) });
  }
}

function recentAppointments(res) {
  // TODO: Replace with live Federal Register or Senate confirmation feed when available.
  sendJson(res, 200, [
    { name: "Alex Harper", role: "Secretary", agency: "Department of Commerce", priorEmployer: "Global Tech Advisors", confirmedDate: "2026-04-29" },
    { name: "Dana Liu", role: "Deputy Secretary", agency: "Department of Energy", priorEmployer: "National Grid Partners", confirmedDate: "2026-04-24" },
    { name: "Marcus Reed", role: "Administrator", agency: "Environmental Protection Agency", priorEmployer: "Clean Future Institute", confirmedDate: "2026-04-18" },
    { name: "Priya Natarajan", role: "Under Secretary", agency: "Department of the Treasury", priorEmployer: "Civic Capital", confirmedDate: "2026-04-12" },
    { name: "Elena Torres", role: "Commissioner", agency: "Federal Trade Commission", priorEmployer: "State Attorney General Office", confirmedDate: "2026-04-08" },
    { name: "Noah Whitman", role: "Director", agency: "Office of Management and Budget", priorEmployer: "Brookfield Policy Group", confirmedDate: "2026-04-03" },
    { name: "Rachel Kim", role: "Assistant Secretary", agency: "Department of Health and Human Services", priorEmployer: "MedCore Systems", confirmedDate: "2026-03-28" },
    { name: "Owen Patel", role: "Chair", agency: "Federal Communications Commission", priorEmployer: "Public Spectrum Alliance", confirmedDate: "2026-03-21" },
    { name: "Maya Sullivan", role: "Administrator", agency: "Small Business Administration", priorEmployer: "Main Street Ventures", confirmedDate: "2026-03-16" },
    { name: "Victor Chen", role: "General Counsel", agency: "Department of Transportation", priorEmployer: "Transit Infrastructure Partners", confirmedDate: "2026-03-10" }
  ]);
}

function formatHistoricalAnalogForPrompt(bill) {
  const h = bill.historicalAnalog || bill.analog;
  if (!h) return "None in TradeSimple seed data — do not invent one.";
  if (typeof h === "string") return h;
  const parts = [h.title, h.outcome, h.impact].filter(Boolean);
  return parts.length ? parts.join(" — ") : "None in seed data.";
}

function buildBillWhyUserContent(bill) {
  const statusKey = normalizeStatusKey(bill.status);
  const mom = computeLegislativeMomentum(bill);
  const conf = billSignalConfidence(bill);
  const sp = subscoreStageProgress(statusKey);
  const se = subscoreSponsorEffectiveness(bill);
  const cs = subscoreCosponsorStrength(bill);
  const bb = subscoreBipartisanBreadth(bill);
  const cm = subscoreCommitteeSchedule(bill);
  const rc = subscoreRecencyDays(bill.latestActionDate);
  const te = subscoreTextEnactability(bill);
  const tr = subscoreTimeRemaining(bill);
  const weighted =
    0.25 * sp +
    0.15 * se +
    0.15 * cs +
    0.1 * bb +
    0.1 * cm +
    0.1 * rc +
    0.1 * te +
    0.05 * tr;
  const sponsor = bill.sponsor
    ? `${bill.sponsor.name} (${bill.sponsor.party}-${bill.sponsor.state})`
    : "—";
  const committees = Array.isArray(bill.committees) ? bill.committees.join("; ") : "—";
  const portfolioTickers =
    (bill.portfolioTickers || bill.affected || []).filter(Boolean).join(", ") || "—";
  const sig = bill.signals || {};

  return `The user clicked "Ask why" on a legislative alert for this bill. Explain WHY the scores read the way they do — what each input means, how the weights combine, and what is still uncertain.

CONTEXT — figures below are from TradeSimple's in-app bill seed data and scoring models (scenario / illustrative unless your workflow explicitly synced live Congress.gov or LDA).

Bill: ${bill.id}
Title: ${bill.title}
Short title: ${bill.shortTitle || "—"}
Chamber: ${bill.chamber || "—"} · Stage status: ${bill.status}
Plain-language summary: ${bill.plainEnglish || "—"}

Tickers linked in app (portfolio / affected): ${portfolioTickers}
Sponsor: ${sponsor}
Cosponsors: ${bill.cosponsors ?? "—"} total · ${bill.bipartisanCosponsors ?? "—"} bipartisan · Floor scheduled: ${bill.floorScheduled ? "yes" : "no"}
Committees: ${committees}
Last action (${bill.latestActionDate || "—"}): ${bill.latestAction || "—"}

Lobbying (LDA matched, $M): FOR $${bill.lobbyingFor ?? "—"}M · AGAINST $${bill.lobbyingAgainst ?? "—"}M · source: ${bill.lobbyingSource || "none"}
Note: ${bill.lobbyingNote || bill.signal || "—"}

Curated signal indices (0–100 when present): bipartisan ${sig.bipartisanScore ?? "—"}, committee ${sig.committeeScore ?? "—"}, floor ${sig.floorScore ?? "—"}, historical ${sig.historicalScore ?? "—"}

Model sub-scores (each 0–100 before weighting):
- Stage progress: ${sp} (weight 25%)
- Sponsor effectiveness: ${se} (15%)
- Cosponsor strength: ${cs} (15%)
- Bipartisan breadth: ${bb} (10%)
- Committee schedule: ${cm} (10%)${bill.floorScheduled ? " (includes floor-scheduled boost)" : ""}
- Recency (from latestActionDate): ${rc} (10%)
- Text enactability (historical/floor blend): ${te} (10%)
- Time remaining (calendar proxy): ${tr} (5%)

Weighted blend (before clamp): ${weighted.toFixed(1)} → Legislative momentum shown in-app: ${mom}/100
Overall data confidence label: ${conf}

Historical analog in seed data (verify before treating as market fact): ${formatHistoricalAnalogForPrompt(bill)}

Answer in the required structure. If any analog or number should not be relied on without checking primary sources, say so. For position impact on named tickers, include the disclosure line.`;
}

function localBillWhyAnswer(bill, name) {
  const mom = computeLegislativeMomentum(bill);
  const conf = billSignalConfidence(bill);
  const analog = formatHistoricalAnalogForPrompt(bill);
  const greet = name && name !== "there" ? `${name}, ` : "";
  return `Research signal only. Not financial advice.

${greet}Here is a compact read on ${bill.id} without the live AI layer: legislative momentum is modeled at ${mom}/100 (${conf} data confidence). Summary: ${bill.plainEnglish || bill.signal || bill.title}. Lobbying (LDA): $${bill.lobbyingAgainst ?? "—"}M against vs $${bill.lobbyingFor ?? "—"}M for (${bill.lobbyingSource || "no LDA match"}). Historical analog: ${analog}

Watch for:
• Committee / floor updates on Congress.gov
• New LDA filings if lobbying accelerates
• Company commentary that cites this bill theme

Add ANTHROPIC_API_KEY or GEMINI_API_KEY to the server for the full metrics walkthrough.`;
}

function parseAiBulletItems(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bullets = [];
  for (const line of lines) {
    const matched = line.match(/^(?:[-•*]|\d+[.)])\s+(.+)$/);
    if (matched) bullets.push(matched[1].trim());
  }
  if (bullets.length >= 2) return bullets.slice(0, 6);
  if (bullets.length === 1 && lines.length === 1) return bullets;
  const sentences = raw
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  if (sentences.length >= 2) return sentences.slice(0, 6);
  if (bullets.length === 1) return bullets;
  return raw ? [raw] : [];
}

function parseResearchResponseText(raw) {
  const full = String(raw ?? "").trim();
  const lower = full.toLowerCase();
  const needle = "watch for:";
  const keyIdx = lower.indexOf(needle);
  const mainText = keyIdx === -1 ? full : full.slice(0, keyIdx).trim();
  const after = keyIdx === -1 ? "" : full.slice(keyIdx).replace(/^watch for:\s*/i, "");
  const watchFor = parseAiBulletItems(after).slice(0, 3);
  const bullets = parseAiBulletItems(mainText);
  const prose = bullets.length ? bullets.join("\n") : mainText;
  return { prose, bullets, watchFor, raw: full };
}

async function callResearchAiProvider({ userContent, maxTokens }) {
  const preferred = String(
    process.env.AI_TRANSLATION_PROVIDER ||
    process.env.SERVER_AI_PROVIDER ||
    ""
  ).toLowerCase();

  if (preferred !== "gemini" && process.env.ANTHROPIC_API_KEY) {
    const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: RESEARCH_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }]
      })
    }, 20000);

    if (!response.ok) {
      return { ok: false, status: 502, error: "ai_provider_error", detail: await safeText(response) };
    }
    const data = await response.json();
    return { ok: true, source: "anthropic", text: data.content?.[0]?.text || "No answer returned." };
  }

  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: RESEARCH_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.2
        }
      })
    }, 20000);

    if (!response.ok) {
      return { ok: false, status: 502, error: "ai_provider_error", detail: await safeText(response) };
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim();
    return { ok: true, source: "gemini", text: text || "No answer returned." };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: RESEARCH_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }]
      })
    }, 20000);

    if (!response.ok) {
      return { ok: false, status: 502, error: "ai_provider_error", detail: await safeText(response) };
    }
    const data = await response.json();
    return { ok: true, source: "anthropic", text: data.content?.[0]?.text || "No answer returned." };
  }

  return {
    ok: false,
    status: 503,
    error: "feature_unavailable",
    detail: "AI research is not yet enabled."
  };
}

async function researchAsk(req, res, session) {
  const body = await readJson(req);

  const userId = session?.user?.id || session?.user?.email || "demo-user";
  const rateCheck = checkResearchRateLimit(userId);
  if (!rateCheck.allowed) {
    return sendJson(res, 429, {
      error: "rate_limited",
      message: `You've sent ${RESEARCH_RATE_LIMIT_MAX} research requests this minute. Wait ${rateCheck.retryAfterSeconds}s before trying again.`,
      retryAfterSeconds: rateCheck.retryAfterSeconds
    });
  }

  const billId = body.billId != null ? String(body.billId).trim() : "";
  const question = String(
    body.question || body.prompt || body.message || body.query || ""
  ).slice(0, 2000);

  let bill = null;
  if (billId) {
    bill = POLICY_BILLS.find((b) => b.id === billId);
    if (!bill) return sendJson(res, 400, { error: "unknown_bill_id", billId });
  }

  if (!bill && !question.trim()) return sendJson(res, 400, { error: "empty_question" });

  const name = session.user?.name || "there";

  if (!serverAiProviderEnabled()) {
    const answer = bill ? localBillWhyAnswer(bill, name) : localPolicyAnswer(question, name);
    return sendJson(res, 200, { source: "local_model", ...parseResearchResponseText(answer) });
  }

  let userContent;
  if (bill) {
    userContent = buildBillWhyUserContent(bill);
    if (question.trim()) userContent += `\n\nAdditional user note:\n${question}`;
  } else {
    const billDigest = POLICY_BILLS.map((b) => {
      const lm = computeLegislativeMomentum(b);
      const conf = billSignalConfidence(b);
      const aff = (b.affected || []).join(", ");
      return `${b.id}: ${b.title}; Legislative momentum ${lm}/100 (${conf}); affected ${aff}; signal: ${b.signal}`;
    }).join("\n");
    userContent = `Internal TradeSimple bill digest (scenario model for grounding, not a forecast):\n${billDigest}\n\nUser question:\n${question}`;
  }

  const maxTokens = bill ? 1200 : 1024;
  const result = await callResearchAiProvider({ userContent, maxTokens });
  if (!result.ok) {
    return sendJson(res, result.status || 502, {
      error: result.error || "ai_provider_error",
      detail: result.detail || "AI provider failed."
    });
  }
  sendJson(res, 200, { source: result.source, ...parseResearchResponseText(result.text) });
}

function checkResearchRateLimit(userId) {
  const now = Date.now();
  const key = String(userId || "anon");
  const entry = researchRateLimit.get(key);

  if (!entry || now - entry.windowStart > RESEARCH_RATE_LIMIT_WINDOW) {
    researchRateLimit.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: RESEARCH_RATE_LIMIT_MAX - 1 };
  }

  if (entry.count >= RESEARCH_RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.ceil((RESEARCH_RATE_LIMIT_WINDOW - (now - entry.windowStart)) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  entry.count += 1;
  return { allowed: true, remaining: RESEARCH_RATE_LIMIT_MAX - entry.count };
}

setInterval(() => {
  const cutoff = Date.now() - RESEARCH_RATE_LIMIT_WINDOW * 2;
  for (const [key, entry] of researchRateLimit) {
    if (entry.windowStart < cutoff) researchRateLimit.delete(key);
  }
}, 5 * 60 * 1000);

function localPolicyAnswer(question, name) {
  const lower = question.toLowerCase();
  const bill =
    POLICY_BILLS.find((item) => item.affected.some((ticker) => lower.includes(ticker.toLowerCase()))) ||
    POLICY_BILLS.find((item) => lower.includes("crypto") && item.affected.includes("BTC")) ||
    POLICY_BILLS[0];
  const lm = computeLegislativeMomentum(bill);
  const conf = billSignalConfidence(bill);
  return `Here is the useful signal, ${name}: ${bill.title} has legislative momentum ${lm}/100 with ${conf} confidence. The key market chain is bill movement -> lobbying intensity -> affected tickers (${bill.affected.join(", ")}). ${bill.signal} ${bill.impact} This is a scenario model, not financial advice. Add ANTHROPIC_API_KEY for deeper natural-language research.`;
}

async function startDemoSession(req, res) {
  if (isLandingOnly()) return redirect(res, "/#early-access");
  if (process.env.DEMO_AUTH === "false") return sendText(res, 403, "Demo auth disabled");
  const url = new URL(req.url || "/", APP_URL);
  const next = sanitizeRelativePath(url.searchParams.get("next"));
  // Each visitor gets an isolated demo account — no shared state between concurrent users.
  const demoId = `demo-${randomBytes(8).toString("hex")}`;
  const user = {
    id: demoId,
    name: "Demo User",
    email: `${demoId}@demo.tradesimple.app`,
    picture: "",
    provider: "demo"
  };
  setSessionCookie(res, user, req);
  redirect(res, next);
}

function logout(res, req) {
  clearAuthCookies(res, req);
  redirect(res, "/");
}

// ── Admin-secret-gated endpoints ─────────────────────────────────────────────
// Shared rate limiting + failure logging for every endpoint gated on
// ADMIN_SECRET (waitlist admin, trending admin, contract-watch admin, bill
// validation admin, prediction recording, Anthropic settings). The secret
// comparisons themselves use safeEqual() (constant-time) at each call site.
const ADMIN_RATE_LIMIT_MAX = Number(process.env.ADMIN_RATE_LIMIT_MAX || 20);
const ADMIN_RATE_LIMIT_WINDOW_MS = Number(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const adminAttempts = new Map();

function adminRateLimitOk(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = adminAttempts.get(ip);
  if (!entry || now - entry.start > ADMIN_RATE_LIMIT_WINDOW_MS) {
    adminAttempts.set(ip, { start: now, n: 1 });
    return true;
  }
  if (entry.n >= ADMIN_RATE_LIMIT_MAX) return false;
  entry.n += 1;
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - ADMIN_RATE_LIMIT_WINDOW_MS * 2;
  for (const [ip, entry] of adminAttempts) {
    if (entry.start < cutoff) adminAttempts.delete(ip);
  }
}, 5 * 60 * 1000);

// Never logs the submitted secret itself — only that an attempt failed, from where.
function logAdminAuthFailure(routeLabel, req) {
  console.warn(`[admin] auth failed for ${routeLabel} from ${clientIp(req)}`);
}

// ── Email / password accounts ────────────────────────────────────────────────
// Accounts persist to Supabase `profiles` when connected, else to a local
// data/accounts.json file so the flow works in dev. Passwords are scrypt-hashed.
const ACCOUNTS_FILE = join(DATA_DIR, "accounts.json");
const authAttempts = new Map();

function authRateLimitOk(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (!entry || now - entry.start > AUTH_RATE_LIMIT_WINDOW_MS) {
    authAttempts.set(ip, { start: now, n: 1 });
    return true;
  }
  if (entry.n >= AUTH_RATE_LIMIT_MAX) return false;
  entry.n += 1;
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - AUTH_RATE_LIMIT_WINDOW_MS * 2;
  for (const [ip, entry] of authAttempts) {
    if (entry.start < cutoff) authAttempts.delete(ip);
  }
}, 5 * 60 * 1000);

function hashPassword(password) {
  const saltBuf = randomBytes(16);
  const salt = saltBuf.toString("hex");
  return `scrypt$${salt}$${scryptSync(password, saltBuf, 64).toString("hex")}`;
}
function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hash] = String(stored).split("$");
    if (scheme !== "scrypt" || !saltHex || !hash) return false;
    const saltBuf = Buffer.from(saltHex, "hex");
    if (!saltBuf.length) return false;
    const computed = scryptSync(password, saltBuf, 64);
    const expected = Buffer.from(hash, "hex");
    return computed.length === expected.length && timingSafeEqual(computed, expected);
  } catch { return false; }
}

async function readAccountsStore() {
  try { return JSON.parse(await readFile(ACCOUNTS_FILE, "utf8")); } catch { return {}; }
}
async function findAccountByEmail(email) {
  const e = String(email).toLowerCase();
  let remote = null;
  if (dbReady) {
    const rows = await dbSelect("profiles",
      `email=eq.${encodeURIComponent(e)}&provider=eq.email&select=id,email,name,password_hash`);
    remote = rows && rows.length ? rows[0] : null;
  }
  const local = (await readAccountsStore())[e] || null;
  return remote || local;
}
async function writeLocalAccountRecord(acct) {
  await withFileLock(ACCOUNTS_FILE, async () => {
    const store = await readAccountsStore();
    store[acct.email] = acct;
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(ACCOUNTS_FILE, JSON.stringify(store, null, 2), "utf8");
  });
}
async function createAccountRecord(acct) {
  if (dbReady) {
    const row = await dbInsert("profiles", {
      id: acct.id, email: acct.email, name: acct.name, provider: "email",
      password_hash: acct.password_hash, picture: "", updated_at: new Date().toISOString()
    });
    if (row) return;
    console.warn("[auth] Supabase profile insert failed — saving account locally");
  }
  await writeLocalAccountRecord(acct);
}

async function authSignup(req, res) {
  if (!authRateLimitOk(req)) {
    return sendJson(res, 429, {
      error: "rate_limited",
      message: "Too many attempts. Wait 15 minutes and try again."
    });
  }
  const body = await readJson(req);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim().slice(0, 120) || email.split("@")[0];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: "invalid_email", message: "Enter a valid email address." });
  if (password.length < 8 || password.length > 128) {
    return sendJson(res, 400, { error: "weak_password", message: "Password must be 8–128 characters." });
  }
  if (await findAccountByEmail(email)) return sendJson(res, 409, { error: "email_taken", message: "An account with this email already exists — try logging in." });
  const user = { id: `usr_${randomBytes(8).toString("hex")}`, name, email, picture: "", provider: "email" };
  try {
    await createAccountRecord({ id: user.id, email, name, password_hash: hashPassword(password) });
  } catch {
    return sendJson(res, 500, { error: "signup_failed", message: "Could not create the account. Please try again." });
  }
  setSessionCookie(res, user, req);
  const onboarding = getOnboardingBillMeta();
  return sendJson(res, 200, {
    ok: true,
    user: { id: user.id, name, email },
    onboardingBillId: onboarding.billId,
    onboardingBillTitle: onboarding.title
  });
}

async function authLogin(req, res) {
  if (!authRateLimitOk(req)) {
    return sendJson(res, 429, {
      error: "rate_limited",
      message: "Too many attempts. Wait 15 minutes and try again."
    });
  }
  const body = await readJson(req);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const acct = await findAccountByEmail(email);
  const hash = acct?.password_hash || "";
  const ok = hash && verifyPassword(password, hash);
  if (!acct || !ok) {
    return sendJson(res, 401, { error: "invalid_credentials", message: "Invalid email or password." });
  }
  const user = { id: acct.id, name: acct.name || email.split("@")[0], email, picture: "", provider: "email" };
  upsertUserProfile(user).catch(() => {});
  setSessionCookie(res, user, req);
  const onboarding = getOnboardingBillMeta();
  return sendJson(res, 200, {
    ok: true,
    user: { id: user.id, name: user.name, email },
    onboardingBillId: onboarding.billId,
    onboardingBillTitle: onboarding.title
  });
}

function authLogoutApi(res, req) {
  clearAuthCookies(res, req);
  return sendJson(res, 200, { ok: true });
}

function startOAuth(req, res, providerName) {
  const provider = oauthProvider(providerName);
  if (!provider.configured) return sendText(res, 400, `${providerName} OAuth is not configured. Add credentials to .env.local.`);

  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const oauthState = signObject({ provider: providerName, state, nonce, exp: unixNow() + 600 });
  const authorize = new URL(provider.authorizeUrl);
  authorize.searchParams.set("client_id", provider.clientId);
  authorize.searchParams.set("redirect_uri", `${APP_URL}/auth/callback/${providerName}`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", provider.scope);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  if (providerName === "google") authorize.searchParams.set("prompt", "select_account");

  res.setHeader("set-cookie", `${OAUTH_COOKIE}=${oauthState}; ${cookieAttrs(600, req)}`);
  redirect(res, authorize.toString());
}

async function finishOAuth(req, res, providerName, url) {
  const provider = oauthProvider(providerName);
  const cookies = parseCookies(req);
  const oauthState = verifyObject(cookies[OAUTH_COOKIE]);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!provider.configured || !oauthState || oauthState.provider !== providerName || oauthState.state !== state || !code) {
    return sendText(res, 400, "OAuth callback validation failed.");
  }

  const tokenResponse = await fetchWithTimeout(provider.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${APP_URL}/auth/callback/${providerName}`
    })
  }, 12000);

  if (!tokenResponse.ok) return sendText(res, 502, `OAuth token exchange failed: ${await safeText(tokenResponse)}`);
  const token = await tokenResponse.json();
  const claims = await verifyOidcToken(token.id_token, provider, oauthState.nonce);
  const user = {
    id: `${providerName}:${claims.sub}`,
    name: claims.name || claims.email?.split("@")[0] || "Trader",
    email: claims.email || "",
    picture: claims.picture || "",
    provider: providerName
  };
  upsertUserProfile(user).catch(() => {});
  res.setHeader("set-cookie", [
    `${SESSION_COOKIE}=${createSession(user)}; ${cookieAttrs(SESSION_TTL_SECONDS, req)}`,
    `${CSRF_COOKIE}=${newCsrfToken()}; ${csrfCookieAttrs(SESSION_TTL_SECONDS, req)}`,
    `${OAUTH_COOKIE}=; ${cookieAttrs(0, req)}`
  ]);
  redirect(res, "/dashboard?view=home");
}

async function verifyOidcToken(idToken, provider, nonce) {
  if (!idToken) throw new Error("missing_id_token");
  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".");
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  if (payload.iss !== provider.issuer) throw new Error("issuer_mismatch");
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(provider.clientId)) throw new Error("audience_mismatch");
  if (payload.exp < unixNow()) throw new Error("token_expired");
  if (payload.nonce && payload.nonce !== nonce) throw new Error("nonce_mismatch");

  const jwksResponse = await fetchWithTimeout(provider.jwksUrl, {}, 10000);
  if (!jwksResponse.ok) throw new Error("jwks_fetch_failed");
  const jwks = await jwksResponse.json();
  const jwk = jwks.keys?.find((key) => key.kid === header.kid);
  if (!jwk || jwk.kty !== "RSA") throw new Error("unsupported_or_missing_jwk");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const ok = verifier.verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(encodedSignature, "base64url"));
  if (!ok) throw new Error("token_signature_invalid");
  return payload;
}

function oauthProvider(name) {
  const providers = {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
      issuer: "https://accounts.google.com",
      scope: "openid email profile"
    },
    apple: {
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_CLIENT_SECRET,
      authorizeUrl: "https://appleid.apple.com/auth/authorize",
      tokenUrl: "https://appleid.apple.com/auth/token",
      jwksUrl: "https://appleid.apple.com/auth/keys",
      issuer: "https://appleid.apple.com",
      scope: "openid email name"
    }
  };
  const provider = providers[name];
  return { ...provider, configured: Boolean(provider?.clientId && provider?.clientSecret) };
}

function getSession(req) {
  const cookies = parseCookies(req);
  const session = verifyObject(cookies[SESSION_COOKIE]);
  if (!session || session.exp < unixNow()) return null;
  return session;
}

function setSessionCookie(res, user, req) {
  res.setHeader("set-cookie", [
    `${SESSION_COOKIE}=${createSession(user)}; ${cookieAttrs(SESSION_TTL_SECONDS, req)}`,
    `${CSRF_COOKIE}=${newCsrfToken()}; ${csrfCookieAttrs(SESSION_TTL_SECONDS, req)}`
  ]);
}

function newCsrfToken() {
  return b64url(randomBytes(24));
}

function csrfCookieAttrs(maxAge, req) {
  const secure = requestIsHttps(req) ? "; Secure" : "";
  return `Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function ensureCsrfCookie(res, req, maxAge = SESSION_TTL_SECONDS) {
  const token = newCsrfToken();
  res.setHeader("set-cookie", `${CSRF_COOKIE}=${token}; ${csrfCookieAttrs(maxAge, req)}`);
  return token;
}

function clearAuthCookies(res, req) {
  res.setHeader("set-cookie", [
    `${SESSION_COOKIE}=; ${cookieAttrs(0, req)}`,
    `${CSRF_COOKIE}=; ${csrfCookieAttrs(0, req)}`
  ]);
}

function requiresCsrf(req, pathname) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (pathname.startsWith("/api/ai/")) return false;
  return true;
}

function validateCsrf(req) {
  const cookies = parseCookies(req);
  const cookieToken = String(cookies[CSRF_COOKIE] || "");
  const headerToken = String(req.headers["x-csrf-token"] || "");
  if (!cookieToken || !headerToken) return false;
  return safeEqual(cookieToken, headerToken);
}

function cookieAttrs(maxAge, req) {
  const secure = requestIsHttps(req) ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function createSession(user) {
  return signObject({ user, exp: unixNow() + SESSION_TTL_SECONDS });
}

function signObject(value) {
  const payload = b64url(Buffer.from(JSON.stringify(value)));
  const sig = hmac(payload);
  return `${payload}.${sig}`;
}

function verifyObject(value) {
  if (!value || !value.includes(".")) return null;
  const [payload, sig] = value.split(".");
  if (!safeEqual(hmac(payload), sig)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function hmac(value) {
  return createHmac("sha256", AUTH_SECRET).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function alpacaConfig() {
  const baseUrl = process.env.ALPACA_TRADING_BASE_URL || "https://paper-api.alpaca.markets";
  const live = baseUrl.includes("api.alpaca.markets") && !baseUrl.includes("paper-api");
  if (live && process.env.ALLOW_LIVE_TRADING !== "true") {
    return { configured: false, mode: "blocked_live", baseUrl };
  }
  return {
    configured: Boolean(process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY),
    mode: live ? "live" : "paper",
    baseUrl
  };
}

function alpacaFetch(path, init = {}) {
  const config = alpacaConfig();
  return fetchWithTimeout(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": process.env.ALPACA_API_KEY_ID,
      "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET_KEY,
      ...(init.headers || {})
    }
  }, 12000);
}

function alpacaPaperEnabled() {
  const config = alpacaConfig();
  if (!config.configured) return false;
  if (config.mode === "live") return process.env.ALLOW_LIVE_TRADING === "true";
  return process.env.ALPACA_PAPER_ENABLED === "true";
}

async function submitAlpacaPaperOrder({ symbol, qty, side, type = "market" }) {
  const response = await alpacaFetch("/v2/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol,
      qty,
      side,
      type,
      time_in_force: "day"
    })
  });
  if (!response.ok) {
    const detail = await safeText(response);
    throw new Error(`alpaca_${response.status}:${detail}`);
  }
  return response.json();
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_JSON_BODY_BYTES) {
      throw new Error("body_too_large");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_json");
  }
}

async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(response) {
  return (await response.text()).slice(0, 1000);
}

function filterBills(bills, query) {
  if (!query) return bills;
  return bills.filter((bill) =>
    [bill.id, bill.title, bill.shortTitle, bill.status, bill.signal, ...(bill.affected || [])]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

function inferTickers(title = "") {
  const lower = title.toLowerCase();
  const matched = [];
  if (lower.includes("semiconductor") || lower.includes("chips") || lower.includes("microchip")) matched.push(...["NVDA", "INTC", "TSM", "AMD"]);
  if (lower.includes("artificial intelligence") || lower.includes(" ai ") || lower.includes("ai act") || lower.includes("ai accountability") || lower.includes("machine learning") || lower.includes("algorithmic")) matched.push(...["NVDA", "MSFT", "GOOGL", "META"]);
  if (lower.includes("drug") || lower.includes("medicare") || lower.includes("medicaid") || lower.includes("pharmaceutical") || lower.includes("prescription") || lower.includes("health insurance")) matched.push(...["LLY", "MRK", "PFE", "ABBV"]);
  if (lower.includes("digital asset") || lower.includes("crypto") || lower.includes("bitcoin") || lower.includes("blockchain") || lower.includes("stablecoin") || lower.includes("virtual currency")) matched.push(...["COIN", "BTC", "ETH"]);
  if (lower.includes("energy") || lower.includes("vehicle") || lower.includes("permit") || lower.includes("clean energy") || lower.includes("solar") || lower.includes("wind") || lower.includes("electric vehicle") || lower.includes("ev ") || lower.includes("charging")) matched.push(...["TSLA", "ENPH", "FSLR"]);
  if (lower.includes("platform") || lower.includes("antitrust") || lower.includes("monopoly") || lower.includes("competition") || lower.includes("big tech") || lower.includes("app store") || lower.includes("marketplace")) matched.push(...["AMZN", "AAPL", "GOOGL", "META"]);
  if (lower.includes("defense") || lower.includes("military") || lower.includes("pentagon") || lower.includes("national security") || lower.includes("armed forces") || lower.includes("procurement")) matched.push(...["LMT", "RTX", "NOC", "PLTR", "BAH"]);
  if (lower.includes("bank") || lower.includes("financial institution") || lower.includes("lending") || lower.includes("credit") || lower.includes("fdic") || lower.includes("federal reserve")) matched.push(...["JPM", "BAC", "GS", "KBE", "XLF"]);
  if (lower.includes("trade") || lower.includes("tariff") || lower.includes("import") || lower.includes("export") || lower.includes("china trade")) matched.push(...["NVDA", "AAPL", "AMZN"]);
  if (lower.includes("broadband") || lower.includes("internet access") || lower.includes("telecom") || lower.includes("spectrum") || lower.includes("5g")) matched.push(...["GOOGL", "META", "MSFT"]);
  if (lower.includes("tax") || lower.includes("revenue") || lower.includes("irs") || lower.includes("corporate tax") || lower.includes("capital gains")) matched.push(...["AAPL", "MSFT", "GOOGL", "META", "AMZN"]);
  if (lower.includes("space") || lower.includes("nasa") || lower.includes("satellite") || lower.includes("launch vehicle") || lower.includes("spacex") || lower.includes("starlink")) matched.push(...["SPCX", "LMT", "RKLB"]);
  if (lower.includes("climate") || lower.includes("carbon") || lower.includes("emission")) matched.push(...["XLE", "TSLA", "ENPH"]);
  if (lower.includes("privacy") || lower.includes("cybersecurity") || lower.includes("data security")) matched.push(...["MSFT", "CRWD", "PANW"]);
  if (/\bice\b/.test(lower) || lower.includes("border patrol") || lower.includes("customs and border") || lower.includes("homeland security") || lower.includes("immigration enforcement") || lower.includes("detention") || lower.includes("secure america") || /\bdhs\b/.test(lower)) {
    matched.push(...["GEO", "CXW", "PLTR", "BAH", "LMT"]);
  }
  if (/\bforeign affairs\b|\binternational relations\b|caucasus|diplomatic|foreign aid/.test(lower)) {
    matched.push(...["LMT", "RTX", "GD", "NOC"]);
  }
  return [...new Set(matched)];
}

const BILL_KEYWORD_BUCKETS = [
  { id: "semiconductors", patterns: [/semiconductor/i, /\bchips\b/i, /microchip/i, /chips act/i], sectors: ["semiconductors", "technology"], tickers: ["NVDA", "INTC", "TSM", "AMD"], tier: "direct" },
  { id: "ai", patterns: [/artificial intelligence/i, /\bai\b/i, /ai act/i, /machine learning/i, /algorithmic/i], sectors: ["AI", "technology"], tickers: ["NVDA", "MSFT", "GOOGL", "META"], tier: "direct" },
  { id: "pharma", patterns: [/\bdrug\b/i, /medicare/i, /medicaid/i, /pharmaceutical/i, /prescription/i, /health insurance/i], sectors: ["health", "pharma"], tickers: ["LLY", "MRK", "PFE", "ABBV"], tier: "direct" },
  { id: "crypto", patterns: [/digital asset/i, /\bcrypto\b/i, /\bbitcoin\b/i, /blockchain/i, /stablecoin/i, /virtual currency/i, /clarity act/i], sectors: ["crypto", "financial"], tickers: ["COIN", "BTC", "ETH"], tier: "crypto_proxy" },
  { id: "energy", patterns: [/energy/i, /electric vehicle/i, /\bev\b/i, /charging/i, /clean energy/i, /solar/i, /wind/i, /\bpermit/i], sectors: ["energy", "clean energy"], tickers: ["TSLA", "ENPH", "FSLR", "XLE"], tier: "sector_etf" },
  { id: "antitrust", patterns: [/platform/i, /antitrust/i, /monopoly/i, /competition/i, /big tech/i, /app store/i, /marketplace/i], sectors: ["antitrust", "platform", "technology"], tickers: ["AMZN", "AAPL", "GOOGL", "META"], tier: "direct" },
  { id: "defense", patterns: [/defense/i, /military/i, /pentagon/i, /national security/i, /armed forces/i, /procurement/i, /weapons/i], sectors: ["defense", "national security"], tickers: ["LMT", "RTX", "NOC", "PLTR", "SPCX"], tier: "direct" },
  {
    id: "space",
    patterns: [/space/i, /nasa/i, /satellite/i, /launch vehicle/i, /spacex/i, /starlink/i, /orbital/i],
    sectors: ["aerospace", "space"],
    tickers: ["SPCX", "LMT", "RKLB"],
    tier: "direct"
  },
  {
    id: "foreign_affairs",
    patterns: [/foreign affairs/i, /international relations/i, /diplomatic/i, /caucasus/i, /embassy/i, /state department/i, /foreign aid/i],
    sectors: ["foreign policy", "defense"],
    tickers: ["LMT", "RTX", "GD", "NOC", "BAH"],
    tier: "direct"
  },
  { id: "banking", patterns: [/\bbank/i, /financial institution/i, /lending/i, /credit union/i, /\bfdic\b/i, /federal reserve/i], sectors: ["banking", "financial"], tickers: ["JPM", "BAC", "GS", "KBE", "XLF"], tier: "sector_etf" },
  { id: "trade", patterns: [/\btrade\b/i, /tariff/i, /\bimport\b/i, /\bexport\b/i, /foreign investment/i, /trade with china/i, /china trade/i], sectors: ["trade", "foreign policy"], tickers: ["NVDA", "AAPL", "AMZN", "SPY"], tier: "broad_index" },
  { id: "telecom", patterns: [/broadband/i, /internet access/i, /telecom/i, /spectrum/i, /\b5g\b/i], sectors: ["telecom", "technology"], tickers: ["GOOGL", "META", "MSFT"], tier: "direct" },
  { id: "tax", patterns: [/\btax\b/i, /\birs\b/i, /corporate tax/i, /capital gains/i], sectors: ["tax", "fiscal"], tickers: ["AAPL", "MSFT", "GOOGL", "META", "AMZN"], tier: "broad_index" },
  { id: "climate", patterns: [/climate/i, /carbon/i, /emission/i, /greenhouse/i], sectors: ["climate", "energy"], tickers: ["XLE", "TSLA", "ENPH"], tier: "sector_etf" },
  { id: "cyber", patterns: [/privacy/i, /cybersecurity/i, /data security/i, /surveillance/i], sectors: ["cyber", "technology"], tickers: ["MSFT", "CRWD", "PANW"], tier: "direct" },
  {
    id: "homeland_border",
    patterns: [
      /\bice\b/i,
      /border patrol/i,
      /customs and border/i,
      /\bcbp\b/i,
      /homeland security/i,
      /\bdhs\b/i,
      /immigration enforcement/i,
      /detention/i,
      /secure america/i,
      /immigration/i
    ],
    sectors: ["homeland security", "immigration", "defense"],
    tickers: ["GEO", "CXW", "PLTR", "BAH", "LMT"],
    tier: "direct"
  }
];

const COMMITTEE_SECTOR_MAP = [
  { patterns: [/banking/i, /financial services/i, /finance/i], sectors: ["banking"], tickers: ["KBE", "XLF", "JPM"], tier: "sector_etf" },
  { patterns: [/armed services/i, /defense/i, /veterans/i, /intelligence/i], sectors: ["defense"], tickers: ["LMT", "RTX", "NOC", "SPCX"], tier: "direct" },
  { patterns: [/energy/i, /natural resources/i, /environment/i], sectors: ["energy"], tickers: ["XLE", "XOM", "TSLA"], tier: "sector_etf" },
  { patterns: [/judiciary/i, /antitrust/i], sectors: ["antitrust", "technology"], tickers: ["GOOGL", "META", "AMZN"], tier: "direct" },
  { patterns: [/commerce/i, /science/i, /technology/i], sectors: ["technology"], tickers: ["NVDA", "MSFT", "GOOGL"], tier: "direct" },
  { patterns: [/ways and means/i, /finance/i], sectors: ["tax", "financial"], tickers: ["XLF", "SPY"], tier: "broad_index" },
  { patterns: [/health/i, /education/i, /labor/i], sectors: ["health"], tickers: ["UNH", "LLY", "PFE"], tier: "direct" },
  { patterns: [/agriculture/i], sectors: ["agriculture"], tickers: ["DE", "ADM"], tier: "direct" },
  { patterns: [/homeland security/i, /border/i, /immigration/i], sectors: ["homeland security"], tickers: ["GEO", "CXW", "PLTR"], tier: "direct" }
];

const POLICY_AREA_SECTOR_MAP = [
  { patterns: [/health/i, /medicare/i], sectors: ["health"], tickers: ["UNH", "LLY"], tier: "direct" },
  { patterns: [/finance/i, /financial/i], sectors: ["financial"], tickers: ["XLF", "JPM"], tier: "sector_etf" },
  { patterns: [/commerce/i, /science/i, /technology/i], sectors: ["technology"], tickers: ["QQQ", "NVDA"], tier: "broad_index" },
  { patterns: [/energy/i, /environment/i], sectors: ["energy"], tickers: ["XLE", "TSLA"], tier: "sector_etf" },
  { patterns: [/defense/i, /national security/i, /armed/i], sectors: ["defense"], tickers: ["LMT", "RTX", "SPCX"], tier: "direct" },
  { patterns: [/space/i, /nasa/i, /aerospace/i], sectors: ["aerospace", "space"], tickers: ["SPCX", "LMT"], tier: "direct" },
  { patterns: [/international/i, /foreign/i], sectors: ["foreign policy"], tickers: ["LMT", "RTX", "GD"], tier: "direct" },
  { patterns: [/tax/i], sectors: ["tax"], tickers: ["SPY"], tier: "broad_index" },
  { patterns: [/transport/i], sectors: ["transport"], tickers: ["UAL", "DAL"], tier: "direct" },
  { patterns: [/immigration/i, /homeland/i], sectors: ["homeland security"], tickers: ["GEO", "CXW", "PLTR"], tier: "direct" }
];

const EXPOSURE_IMPACT_TIERS = {
  broad_index: { pass: "+2 to +5%", fail: "-2 to -5%" },
  sector_etf: { pass: "+5 to +12%", fail: "-5 to -12%" },
  crypto_proxy: { pass: "+8 to +15%", fail: "-8 to -15%" },
  direct: { pass: "+10 to +25%", fail: "-10 to -25%" }
};

const EXPOSURE_METHODOLOGY_DISCLAIMER =
  "Ticker links and pass/stall ranges are illustrative models from keyword, committee, and policy-area rules — not price targets or investment advice.";

const VALID_TICKER_PATTERN = /^[A-Z]{1,5}$/;

function billExposureCorpus(bill) {
  const parts = [
    bill.title,
    bill.shortTitle,
    bill.summary,
    bill.plainEnglish,
    bill.latestAction,
    bill.policyArea,
    ...(bill.tags || []),
    ...(bill._committeeNames || []),
    ...(bill.committees || []).map((c) => c?.name || c?.committeeName || "")
  ];
  return parts.filter(Boolean).join(" ");
}

function matchExposureBuckets(text, buckets) {
  const hits = [];
  for (const bucket of buckets) {
    const matched = bucket.patterns.some((p) => p.test(text));
    if (matched) hits.push(bucket);
  }
  return hits;
}

function tickerVolatilityTier(symbol, bucketTier = "direct") {
  const sym = String(symbol || "").toUpperCase();
  if (["SPY", "QQQ", "IWM", "DIA"].includes(sym)) return "broad_index";
  if (["BTC", "ETH"].includes(sym)) return "crypto_proxy";
  if (["KBE", "XLF", "XLE", "XBI", "SMH"].includes(sym)) return "sector_etf";
  return bucketTier || "direct";
}

function buildIllustrativeImpactRows(tickers, bucketTier, confidence) {
  const passRows = [];
  const failRows = [];
  for (const sym of tickers.slice(0, 6)) {
    if (!VALID_TICKER_PATTERN.test(sym)) continue;
    const tier = tickerVolatilityTier(sym, bucketTier);
    const template = EXPOSURE_IMPACT_TIERS[tier] || EXPOSURE_IMPACT_TIERS.direct;
    const name = FUNDAMENTALS[sym]?.name || sym;
    const why = `Illustrative model — ${confidence} confidence keyword/committee mapping for ${name}.`;
    passRows.push({
      sym,
      symbol: sym,
      ticker: sym,
      dir: 1,
      range: template.pass,
      impact: template.pass,
      why,
      headline: why,
      label: why
    });
    failRows.push({
      sym,
      symbol: sym,
      ticker: sym,
      dir: -1,
      range: template.fail,
      impact: template.fail,
      why: `Illustrative stall/fail scenario for ${name}.`,
      headline: `Stall scenario for ${name}`,
      label: `Stall scenario for ${name}`
    });
  }
  return { passImpacts: passRows, failImpacts: failRows };
}

function findRelatedSeedExposure(bill, tags) {
  const tagSet = new Set(tags);
  let best = null;
  let bestScore = 0;
  for (const seed of POLICY_BILLS) {
    if (seed.id === bill.id) continue;
    const seedTags = seed.tags || [];
    const overlap = seedTags.filter((t) => tagSet.has(t)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = seed;
    }
  }
  if (bestScore >= 2 && best?.affected?.length) {
    return {
      tickers: best.affected.slice(0, 5),
      sectors: best.tags || [],
      tier: "direct",
      confidence: "medium",
      source: "related_seed",
      plainEnglish: best.plainEnglish || null
    };
  }
  return null;
}

const BROAD_MEGACAP_TICKERS = new Set(["NVDA", "AAPL", "AMZN", "GOOGL", "META", "MSFT", "SPY"]);

function corpusIncludesLobbyClient(corpus, client) {
  const needle = String(client || "").toLowerCase().trim();
  if (!needle) return false;
  if (needle.length <= 4) {
    return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(corpus);
  }
  return corpus.includes(needle);
}

function inferBillMarketExposure(bill) {
  const corpus = billExposureCorpus(bill);
  const lower = corpus.toLowerCase();
  const keywordHitsRaw = matchExposureBuckets(corpus, BILL_KEYWORD_BUCKETS);
  const hasForeignAffairs = keywordHitsRaw.some((h) => h.id === "foreign_affairs");
  const keywordHits = hasForeignAffairs
    ? keywordHitsRaw.filter((h) => !["trade", "tax", "telecom"].includes(h.id))
    : keywordHitsRaw;
  const committeeText = (bill._committeeNames || []).join(" ");
  const committeeHits = matchExposureBuckets(committeeText, COMMITTEE_SECTOR_MAP);
  const policyHits = bill.policyArea ? matchExposureBuckets(String(bill.policyArea), POLICY_AREA_SECTOR_MAP) : [];

  const tickerSet = new Set();
  const sectorSet = new Set();
  let dominantTier = "direct";

  for (const hit of keywordHits) {
    hit.tickers.forEach((t) => tickerSet.add(t));
    hit.sectors.forEach((s) => sectorSet.add(s));
    if (hit.tier === "direct") dominantTier = "direct";
    else if (hit.tier === "sector_etf" && dominantTier !== "direct") dominantTier = "sector_etf";
  }
  for (const hit of committeeHits) {
    hit.tickers.forEach((t) => tickerSet.add(t));
    hit.sectors.forEach((s) => sectorSet.add(s));
  }
  for (const hit of policyHits) {
    hit.tickers.forEach((t) => tickerSet.add(t));
    hit.sectors.forEach((s) => sectorSet.add(s));
    if (!keywordHits.length && !committeeHits.length) dominantTier = hit.tier || dominantTier;
  }

  for (const [client, syms] of Object.entries(LOBBY_CLIENT_TICKERS)) {
    if (corpusIncludesLobbyClient(lower, client)) syms.forEach((t) => tickerSet.add(t));
  }

  const tags = inferTags(corpus);
  tags.forEach((t) => sectorSet.add(t));

  if (keywordHits.some((h) => h.id === "foreign_affairs") && !keywordHits.some((h) => h.id === "trade" || h.id === "crypto" || h.id === "ai")) {
    for (const sym of BROAD_MEGACAP_TICKERS) tickerSet.delete(sym);
  }
  if (keywordHits.some((h) => h.id === "crypto") && !/\bcrypto|bitcoin|blockchain|digital asset|stablecoin|virtual currency|clarity act\b/i.test(lower)) {
    for (const sym of ["COIN", "BTC", "ETH"]) tickerSet.delete(sym);
  }

  let relatedSeed = null;
  if (tickerSet.size < 2) {
    relatedSeed = findRelatedSeedExposure(bill, tags);
    if (relatedSeed) {
      relatedSeed.tickers.forEach((t) => tickerSet.add(t));
      relatedSeed.sectors.forEach((s) => sectorSet.add(s));
    }
  }

  const tickers = [...tickerSet].filter((t) => VALID_TICKER_PATTERN.test(t)).slice(0, 8);
  const sectors = [...sectorSet];

  let exposureConfidence = "low";
  const signalCount = keywordHits.length + (committeeHits.length ? 1 : 0) + (policyHits.length ? 1 : 0);
  if (keywordHits.length >= 2 || (keywordHits.length >= 1 && committeeHits.length >= 1)) {
    exposureConfidence = "high";
  } else if (keywordHits.length >= 1 || committeeHits.length >= 1 || relatedSeed) {
    exposureConfidence = "medium";
  } else if (policyHits.length >= 1 && tickers.length) {
    exposureConfidence = "low";
  }

  if (!tickers.length) {
    return {
      affected: [],
      sectors: [],
      passImpacts: [],
      failImpacts: [],
      plainEnglish: null,
      exposureConfidence: "low",
      exposureSource: null
    };
  }

  const { passImpacts, failImpacts } = buildIllustrativeImpactRows(tickers, dominantTier, exposureConfidence);
  const statusInfo = statusInfoForBill(bill);
  const catalyst = catalystForBill(bill);
  const tickerLabel = tickers.slice(0, 3).join(", ");
  const plainEnglish =
    relatedSeed?.plainEnglish ||
    `This bill may affect ${tickerLabel}${tickers.length > 3 ? " and related names" : ""} via ${sectors.slice(0, 2).join(" / ") || "policy"} channels. ${statusInfo.nextStep || "Monitor committee action."}`;

  return {
    affected: tickers,
    portfolioTickers: tickers.slice(0, 3),
    sectors,
    tags: tags.length ? tags : sectors.slice(0, 4),
    passImpacts,
    failImpacts,
    plainEnglish,
    signal: `Rules-based mapping (${exposureConfidence} confidence): may affect ${tickerLabel}.`,
    impact: `Illustrative exposure for ${tickerLabel} — ${statusInfo.marketMeaning || "monitor legislative path."}`,
    catalyst,
    exposureConfidence,
    exposureSource: relatedSeed ? "rules+related_seed" : "rules",
    exposureMethodologyDisclaimer: EXPOSURE_METHODOLOGY_DISCLAIMER
  };
}

function seedBillHasRichExposure(bill) {
  return POLICY_BILLS.some((b) => b.id === bill.id) &&
    ((bill.affected?.length > 0 && bill.passImpacts?.length > 0) ||
      (bill.affected?.length > 0 && bill.plainEnglish && !bill._dynamicCongressBill));
}

function applyBillMarketExposure(bill) {
  if (seedBillHasRichExposure(bill)) return bill;
  const inferred = inferBillMarketExposure(bill);
  if (!inferred.affected?.length) return bill;
  return {
    ...bill,
    affected: bill.affected?.length ? bill.affected : inferred.affected,
    portfolioTickers: bill.portfolioTickers?.length ? bill.portfolioTickers : inferred.portfolioTickers,
    sectors: bill.sectors?.length ? bill.sectors : inferred.sectors,
    tags: bill.tags?.length ? bill.tags : inferred.tags,
    passImpacts: bill.passImpacts?.length ? bill.passImpacts : inferred.passImpacts,
    failImpacts: bill.failImpacts?.length ? bill.failImpacts : inferred.failImpacts,
    plainEnglish: bill.plainEnglish || inferred.plainEnglish,
    signal: bill.signal || inferred.signal,
    impact: bill.impact || inferred.impact,
    exposureConfidence: bill.exposureConfidence || inferred.exposureConfidence,
    exposureSource: bill.exposureSource || inferred.exposureSource,
    exposureMethodologyDisclaimer: bill.exposureMethodologyDisclaimer || inferred.exposureMethodologyDisclaimer
  };
}

function normalizeBillImpactRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const sym = String(row.sym || row.symbol || row.ticker || "").toUpperCase();
    const why = row.why || row.headline || row.label || "";
    return {
      ...row,
      sym,
      symbol: sym,
      ticker: sym,
      headline: row.headline || row.label || why,
      label: row.label || row.headline || why,
      range: row.range || row.impact || ""
    };
  });
}

async function enrichBillShareExposure(bill, req = null) {
  let enriched = applyBillMarketExposure(bill);
  const needsAi =
    (!enriched.affected?.length || enriched.exposureConfidence === "low") &&
    process.env.ANTHROPIC_API_KEY &&
    !seedBillHasRichExposure(enriched);
  if (!needsAi) return enriched;
  try {
    const ai = await inferBillMarketExposureAI({
      bill: enriched,
      billId: enriched.id,
      rateLimitKey: req ? clientIp(req) : "anon",
      checkRateLimit: checkBriefAiRateLimit
    });
    if (!ai?.tickers?.length) return enriched;
    if (enriched.exposureConfidence === "high" || enriched.exposureConfidence === "medium") return enriched;
    const tickers = ai.tickers.filter((t) => VALID_TICKER_PATTERN.test(t)).slice(0, 6);
    if (!tickers.length) return enriched;
    const { passImpacts, failImpacts } = buildIllustrativeImpactRows(tickers, "direct", "medium");
    if (ai.bull?.length) {
      ai.bull.slice(0, 6).forEach((item, i) => {
        if (passImpacts[i] && item?.range) passImpacts[i].range = item.range;
        if (passImpacts[i] && item?.why) passImpacts[i].why = item.why;
      });
    }
    if (ai.bear?.length) {
      ai.bear.slice(0, 6).forEach((item, i) => {
        if (failImpacts[i] && item?.range) failImpacts[i].range = item.range;
        if (failImpacts[i] && item?.why) failImpacts[i].why = item.why;
      });
    }
    return {
      ...enriched,
      affected: tickers,
      portfolioTickers: tickers.slice(0, 3),
      passImpacts: enriched.passImpacts?.length ? enriched.passImpacts : passImpacts,
      failImpacts: enriched.failImpacts?.length ? enriched.failImpacts : failImpacts,
      plainEnglish: enriched.plainEnglish || ai.plainEnglish || enriched.plainEnglish,
      signal: enriched.signal || `AI-assisted mapping: may affect ${tickers.slice(0, 3).join(", ")}.`,
      exposureConfidence: enriched.affected?.length ? enriched.exposureConfidence : "medium",
      exposureSource: "ai_cache",
      exposureMethodologyDisclaimer: EXPOSURE_METHODOLOGY_DISCLAIMER
    };
  } catch (err) {
    console.warn("[ai] bill exposure inference skipped:", err.message);
    return enriched;
  }
}

function inferTags(title = "") {
  const lower = title.toLowerCase();
  const tags = [];
  if (lower.includes("semiconductor") || lower.includes("chips") || lower.includes("microchip")) tags.push("semiconductors", "technology");
  if (lower.includes("artificial intelligence") || lower.includes(" ai ") || lower.includes("ai act") || lower.includes("machine learning") || lower.includes("algorithmic")) tags.push("AI", "technology");
  if (lower.includes("drug") || lower.includes("medicare") || lower.includes("medicaid") || lower.includes("pharmaceutical") || lower.includes("prescription") || lower.includes("health")) tags.push("health", "pharma", "Medicare");
  if (lower.includes("digital asset") || lower.includes("crypto") || lower.includes("bitcoin") || lower.includes("blockchain") || lower.includes("stablecoin")) tags.push("crypto", "financial");
  if (lower.includes("energy") || lower.includes("clean energy") || lower.includes("solar") || lower.includes("wind") || lower.includes("electric vehicle") || lower.includes("charging")) tags.push("energy", "clean energy");
  if (lower.includes("platform") || lower.includes("antitrust") || lower.includes("competition") || lower.includes("big tech")) tags.push("antitrust", "platform", "technology");
  if (lower.includes("defense") || lower.includes("military") || lower.includes("pentagon") || lower.includes("national security")) tags.push("defense", "national security");
  if (lower.includes("bank") || lower.includes("financial institution") || lower.includes("lending") || lower.includes("federal reserve")) tags.push("banking", "financial");
  if (lower.includes("trade") || lower.includes("tariff") || lower.includes("import") || lower.includes("export") || lower.includes("china trade")) tags.push("trade", "foreign policy");
  if (lower.includes("tax") || lower.includes("irs") || lower.includes("corporate tax")) tags.push("tax", "fiscal");
  if (lower.includes("broadband") || lower.includes("telecom") || lower.includes("5g") || lower.includes("spectrum")) tags.push("telecom", "technology");
  if (
    /\bice\b/.test(lower) ||
    /\bborder\b/.test(lower) ||
    lower.includes("homeland") ||
    lower.includes("immigration") ||
    lower.includes("detention") ||
    lower.includes("customs")
  ) {
    tags.push("homeland security", "immigration");
  }
  return [...new Set(tags)];
}

function chamberCap(chamber) {
  const c = String(chamber || "").toLowerCase();
  return c.includes("house") || c.startsWith("h") ? 218 : 100;
}

const BILL_STAGE_ORDER = [
  { key: "introduced", label: "Introduced" },
  { key: "committee", label: "Committee" },
  { key: "markup", label: "Markup" },
  { key: "reported", label: "Reported" },
  { key: "floor", label: "Floor" },
  { key: "passed_one_chamber", label: "Chamber vote" },
  { key: "resolving", label: "Final passage" },
  { key: "enacted", label: "Law" }
];

const BILL_STATUS_INFO = {
  introduced: {
    label: "Introduced",
    progress: 20,
    tone: "neutral",
    marketMeaning: "Early signal only; most introduced bills never become market-moving law.",
    nextStep: "Watch for committee referral, hearings, and first cosponsors."
  },
  committee: {
    label: "In committee",
    progress: 40,
    tone: "amber",
    marketMeaning: "The bill has a gatekeeper, but still needs hearing, markup, or report activity.",
    nextStep: "Watch the assigned committee calendar and sponsor coalition."
  },
  markup: {
    label: "Markup / hearing",
    progress: 58,
    tone: "amber",
    marketMeaning: "Committee text is being shaped; amendments can change the market impact.",
    nextStep: "Watch whether the committee votes to report the bill."
  },
  reported: {
    label: "Reported by committee",
    progress: 64,
    tone: "green",
    marketMeaning: "The committee has advanced the bill, so floor scheduling becomes the next real catalyst.",
    nextStep: "Watch House or Senate floor calendars for consideration."
  },
  floor: {
    label: "Floor calendar watch",
    progress: 76,
    tone: "green",
    marketMeaning: "The bill is closer to a chamber vote; headlines can move affected tickers faster.",
    nextStep: "Watch debate rules, amendments, and vote timing."
  },
  passed_one_chamber: {
    label: "Passed one chamber",
    progress: 86,
    tone: "green",
    marketMeaning: "One chamber has voted yes; the other chamber or a companion bill now matters most.",
    nextStep: "Watch companion bill movement and cross-chamber negotiations."
  },
  resolving: {
    label: "Final passage / conference",
    progress: 92,
    tone: "green",
    marketMeaning: "The policy is in final-shape negotiations; small language changes can matter.",
    nextStep: "Watch conference text, final vote timing, and administration statements."
  },
  enacted: {
    label: "Law / implementation",
    progress: 100,
    tone: "green",
    marketMeaning: "Passage risk has shifted into implementation timing, agency rules, and funding flow.",
    nextStep: "Watch rulemaking, grant awards, guidance, and agency deadlines."
  },
  incorporated: {
    label: "Folded into another bill",
    progress: 82,
    tone: "amber",
    marketMeaning: "The original bill may stop moving, but the policy can keep moving inside a larger vehicle.",
    nextStep: "Watch the new vehicle and whether the same language survives."
  },
  vetoed: {
    label: "Veto / override watch",
    progress: 30,
    tone: "red",
    marketMeaning: "The path is blocked unless Congress can override or rewrite the bill.",
    nextStep: "Watch override vote counts or replacement language."
  },
  failed: {
    label: "Stalled or failed",
    progress: 5,
    tone: "red",
    marketMeaning: "Near-term passage pressure is low; the issue can still return in another bill.",
    nextStep: "Watch reintroduction, amendment vehicles, or renewed lobbying."
  }
};

function normalizeStatusKey(status, latestAction = "", bill = {}) {
  const combined = `${status || ""} ${latestAction || ""}`.trim();
  return parseBillStageFromAction(combined, bill.actions || bill._congressActions, bill).statusKey;
}

function subscoreStageProgress(statusKey) {
  return BILL_STATUS_INFO[statusKey]?.progress ?? 25;
}

function buildStagePath(statusKey) {
  const terminal = ["failed", "vetoed", "incorporated"].includes(statusKey);
  const activeKey = statusKey === "passed" ? "enacted" : statusKey;
  const activeIdx = BILL_STAGE_ORDER.findIndex((stage) => stage.key === activeKey);
  const safeIdx = activeIdx < 0 ? 0 : activeIdx;
  const path = BILL_STAGE_ORDER.map((stage, index) => ({
    ...stage,
    state: index < safeIdx ? "done" : index === safeIdx && !terminal ? "active" : "todo"
  }));
  if (terminal) {
    path.push({
      key: activeKey,
      label: BILL_STATUS_INFO[activeKey]?.label || "Terminal status",
      state: "active"
    });
  }
  return path;
}

function statusInfoForBill(bill) {
  const key = normalizeStatusKey(bill.status, bill.latestAction, bill);
  const info = BILL_STATUS_INFO[key] || BILL_STATUS_INFO.introduced;
  return {
    key,
    label: info.label,
    progress: info.progress,
    tone: info.tone,
    marketMeaning: info.marketMeaning,
    nextStep: bill.nextStep || info.nextStep,
    stagePath: buildStagePath(key)
  };
}

function subscoreSponsorEffectiveness(bill) {
  const cap = chamberCap(bill.chamber);
  let s = Math.min(100, (Number(bill.cosponsors || 0) / Math.max(1, cap)) * 100);
  if (bill.sponsor?.party === "B") s = Math.min(100, s + 25);
  return Math.round(s);
}

function subscoreCosponsorStrength(bill) {
  const cap = chamberCap(bill.chamber);
  return Math.min(100, Math.round((Number(bill.cosponsors || 0) / Math.max(1, cap)) * 100));
}

function subscoreBipartisanBreadth(bill) {
  if (bill.signals?.bipartisanScore != null) {
    return Math.min(100, Math.round(Number(bill.signals.bipartisanScore)));
  }
  const cos = Number(bill.cosponsors || 0);
  const bi = Number(bill.bipartisanCosponsors || 0);
  if (!cos) return 0;
  return Math.min(100, Math.round((bi / cos) * 100));
}

function defaultCommitteeScore(bill) {
  const s = normalizeStatusKey(bill.status, bill.latestAction, bill);
  if (s === "enacted" || s === "resolving") return 100;
  if (s === "passed_one_chamber") return 90;
  if (s === "floor") return 82;
  if (s === "reported") return 74;
  if (s === "markup") return 68;
  if (s === "committee") return 48;
  return 32;
}

function subscoreCommitteeSchedule(bill) {
  let c = Math.min(100, bill.signals?.committeeScore != null ? Number(bill.signals.committeeScore) : defaultCommitteeScore(bill));
  if (bill.floorScheduled) c = Math.min(100, c + 18);
  return Math.round(c);
}

function subscoreRecencyDays(lastActionDate) {
  if (!lastActionDate) return 35;
  const days = Math.max(0, (Date.now() - new Date(lastActionDate).getTime()) / 864e5);
  if (days <= 10) return 100;
  if (days <= 30) return 88;
  if (days <= 60) return 72;
  if (days <= 120) return 55;
  if (days <= 200) return 40;
  return 28;
}

function defaultHistoricalScore(bill) {
  const s = normalizeStatusKey(bill.status, bill.latestAction, bill);
  if (s === "enacted" || s === "resolving") return 88;
  if (s === "passed_one_chamber" || s === "reported") return 66;
  if (s === "markup") return 52;
  return 38;
}

function defaultFloorScore(bill) {
  const s = normalizeStatusKey(bill.status, bill.latestAction, bill);
  if (s === "enacted" || s === "resolving") return 100;
  if (s === "passed_one_chamber") return 86;
  if (bill.floorScheduled) return 62;
  if (s === "reported") return 56;
  if (s === "markup") return 48;
  return 28;
}

function subscoreTextEnactability(bill) {
  const h = bill.signals?.historicalScore != null ? Number(bill.signals.historicalScore) : defaultHistoricalScore(bill);
  const f = bill.signals?.floorScore != null ? Number(bill.signals.floorScore) : defaultFloorScore(bill);
  return Math.min(100, Math.round(h * 0.55 + f * 0.45));
}

function subscoreTimeRemaining(bill) {
  if (["enacted", "resolving", "passed_one_chamber"].includes(normalizeStatusKey(bill.status, bill.latestAction, bill))) return 100;
  const m = new Date().getMonth();
  return Math.max(18, Math.round(100 - (m / 11) * 55));
}

function computeLegislativeMomentum(bill) {
  const statusKey = normalizeStatusKey(bill.status, bill.latestAction, bill);
  const raw =
    0.25 * subscoreStageProgress(statusKey) +
    0.15 * subscoreSponsorEffectiveness(bill) +
    0.15 * subscoreCosponsorStrength(bill) +
    0.1 * subscoreBipartisanBreadth(bill) +
    0.1 * subscoreCommitteeSchedule(bill) +
    0.1 * subscoreRecencyDays(bill.latestActionDate) +
    0.1 * subscoreTextEnactability(bill) +
    0.05 * subscoreTimeRemaining(bill);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function billSignalConfidence(bill) {
  let pts = 0;
  if (bill.latestActionDate) {
    pts += 20;
    const d = (Date.now() - new Date(bill.latestActionDate).getTime()) / 864e5;
    if (d <= 30) pts += 25;
    else if (d <= 90) pts += 15;
    else if (d <= 180) pts += 8;
  }
  if (Number(bill.cosponsors) > 0) pts += 12;
  if (typeof bill.bipartisanCosponsors === "number") pts += 8;
  if (bill.latestAction) pts += 10;
  if (bill.lobbyingSource === "senate_lda" && (Number(bill.lobbyingFilingsCount) > 0 || Number(bill.lobbyingAgainst) > 0 || Number(bill.lobbyingFor) > 0)) {
    pts += 12;
  }
  if (String(bill.plainEnglish || "").length > 80) pts += 5;
  return pts >= 72 ? "High" : pts >= 44 ? "Medium" : "Low";
}

function scoreConfidence({ missingInputs = 0, staleInputs = 0, estimatedInputs = 0 } = {}) {
  if (missingInputs >= 2) return "Low";
  if (missingInputs === 0 && staleInputs === 0 && estimatedInputs === 0) return "High";
  return "Medium";
}

function pseudoFilingFromBill(bill) {
  if (bill.lobbyingSource !== "senate_lda") return null;
  const against = Number(bill.lobbyingAgainst || 0);
  const fo = Number(bill.lobbyingFor || 0);
  const amount = Math.max(against, fo, 0) * 1e6;
  if (amount <= 0) return null;
  const spike = against >= 20 ? 3 : against >= 10 ? 2.2 : fo >= 10 ? 1.9 : 1;
  return {
    client: bill.title || bill.id || "bill",
    registrant: "Senate LDA aggregate",
    amount,
    issue: String(bill.lobbyingNote || bill.signal || bill.title || "").slice(0, 200),
    spike,
    postedAt: bill.latestActionDate || null,
    portfolio: false,
    source: "senate_lda"
  };
}

function ensureQuarterlySpend(f) {
  if (Array.isArray(f.quarterlySpend) && f.quarterlySpend.length >= 9) return f.quarterlySpend;
  const cur = parseFloat(f.amount || f.expenses || 0) || 0;
  const sf = Math.max(0.4, parseFloat(f.spike || f.spikeFactor || 1));
  const baseline = cur / sf;
  const out = [];
  for (let i = 0; i < 8; i++) out.push(Math.max(1, Math.round(baseline * (0.9 + ((i * 13) % 7) * 0.02))));
  out.push(cur);
  return out;
}

function computeSpendSpikeZ(f) {
  const hist = ensureQuarterlySpend(f);
  const cur = hist[8];
  const prior = hist.slice(0, 8);
  const mean = prior.reduce((a, b) => a + b, 0) / 8;
  const variance = prior.reduce((a, x) => a + (x - mean) ** 2, 0) / 8;
  const std = Math.sqrt(variance) || 1e-9;
  return (cur - mean) / std;
}

function spendSpikeSubscore(z) {
  const c = Math.min(3.5, Math.max(-2, z));
  return ((c + 2) / 5.5) * 100;
}

function computeLobbyingPressure(f) {
  const z = computeSpendSpikeZ(f);
  const issues = String(f.issue || "")
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const coalitionBreadth = Math.min(100, 12 + issues.length * 22);
  const topicSpecificity = Math.max(22, Math.min(100, 100 - (issues.length - 1) * 28));
  let recency = 48;
  if (f.postedAt) {
    const days = (Date.now() - new Date(f.postedAt).getTime()) / 864e5;
    if (days <= 14) recency = 100;
    else if (days <= 40) recency = 86;
    else if (days <= 100) recency = 62;
    else if (days <= 200) recency = 42;
  }
  let directionCertainty = parseFloat(f.spike || 0) > 1.65 ? 78 : 52;
  if (issues.some((i) => /pricing|antitrust|crypto|medicare|export|chips/i.test(i))) {
    directionCertainty = Math.min(100, directionCertainty + 12);
  }
  const raw =
    0.4 * spendSpikeSubscore(z) +
    0.2 * coalitionBreadth +
    0.15 * topicSpecificity +
    0.15 * recency +
    0.1 * directionCertainty;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function lobbyingFilingConfidence(f) {
  let pts = 0;
  if (f.client) pts += 28;
  if (f.registrant) pts += 14;
  if (f.postedAt) {
    pts += 12;
    const days = (Date.now() - new Date(f.postedAt).getTime()) / 864e5;
    if (days <= 45) pts += 22;
  }
  if (String(f.issue || "").length) pts += 18;
  if (parseFloat(f.amount || 0) > 0) pts += 16;
  return pts >= 74 ? "High" : pts >= 42 ? "Medium" : "Low";
}

function lobbyingSubConfidences(f) {
  const z = computeSpendSpikeZ(f);
  const issueList = String(f.issue || "")
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const spike = parseFloat(f.spike || f.spikeFactor || 1);
  const isSpike = spike > 1.8;
  const spendSignalConfidence = z >= 1.2 || isSpike ? "High" : Math.abs(z) < 0.35 ? "Low" : "Medium";
  const issueSignalConfidence = issueList.length >= 3 ? "High" : issueList.length >= 1 ? "Medium" : "Low";
  let recencySignalConfidence = "Low";
  if (f.postedAt) {
    const days = (Date.now() - new Date(f.postedAt).getTime()) / 864e5;
    recencySignalConfidence = days <= 90 ? "High" : "Medium";
  }
  return {
    spendSpikeZ: Math.round(z * 100) / 100,
    spikeVsTrail: Math.round(spike * 100) / 100,
    spendSignalConfidence,
    issueSignalConfidence,
    recencySignalConfidence
  };
}

function lobbyingFilingId(base) {
  const raw = [base.client, base.registrant, base.postedAt, base.amount, base.issue, base.source]
    .map((v) => String(v || "").trim().toLowerCase())
    .join("|");
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  return `lf_${Math.abs(hash).toString(36)}`;
}

let cachedLobbyFilingsForShare = [];

function decorateLobbyingFiling(base) {
  const sub = lobbyingSubConfidences(base);
  const missingInputs =
    (base.client ? 0 : 1) +
    (base.registrant ? 0 : 1) +
    (base.issue ? 0 : 1) +
    (Number(base.amount || 0) > 0 ? 0 : 1);
  const staleInputs = base.postedAt && (Date.now() - new Date(base.postedAt).getTime()) / 864e5 > 90 ? 1 : 0;
  const filing = {
    ...base,
    filingId: base.filingId || lobbyingFilingId(base),
    lobbyingPressure: computeLobbyingPressure(base),
    confidence: scoreConfidence({ missingInputs, staleInputs }),
    filingConfidence: lobbyingFilingConfidence(base),
    spendSpikeZ: sub.spendSpikeZ,
    spikeVsTrail: sub.spikeVsTrail,
    spendSignalConfidence: sub.spendSignalConfidence,
    issueSignalConfidence: sub.issueSignalConfidence,
    recencySignalConfidence: sub.recencySignalConfidence
  };
  return filing;
}

function driverTone(value) {
  const n = Number(value || 0);
  if (n >= 70) return "green";
  if (n <= 35) return "red";
  return "amber";
}

function describeMomentumComponent(row, bill, statusInfo) {
  const value = Number(row.value || 0);
  if (row.key === "stageProgress") {
    return `${statusInfo.label}: ${statusInfo.marketMeaning}`;
  }
  if (row.key === "committeeSchedule") {
    if (bill.floorScheduled) return "A floor-calendar flag is active, so timing risk is higher than an ordinary committee bill.";
    if (value >= 70) return "Committee posture is supportive enough that scheduling is worth watching.";
    return "Committee posture is still the main bottleneck.";
  }
  if (row.key === "bipartisanBreadth") {
    const bi = Number(bill.bipartisanCosponsors || 0);
    if (bi > 0) return `${bi} bipartisan cosponsors reduce the chance this is a one-party messaging bill.`;
    return "Little bipartisan breadth is visible yet.";
  }
  if (row.key === "cosponsorStrength" || row.key === "sponsorEffectiveness") {
    const cos = Number(bill.cosponsors || 0);
    return cos > 0
      ? `${cos} cosponsors are mapped against the ${bill.chamber || "chamber"} threshold.`
      : "No meaningful cosponsor base has been mapped yet.";
  }
  if (row.key === "recency") {
    return bill.latestActionDate
      ? `Latest action date is ${bill.latestActionDate}; fresher action carries more weight.`
      : "No fresh action date is available, so recency confidence is limited.";
  }
  if (row.key === "textEnactability") {
    return "Historical analog and floor-path signals shape whether this looks like a durable vehicle.";
  }
  if (row.key === "timeRemaining") {
    return "Session timing is a small modifier, not the main reason for the score.";
  }
  return row.label;
}

function momentumDriversForBill(bill) {
  const statusInfo = statusInfoForBill(bill);
  const breakdown = computeBillMetricBreakdown(bill);
  const components = breakdown.legislativeMomentum.components;
  const stage = components.find((row) => row.key === "stageProgress");
  const strengths = components
    .filter((row) => row.key !== "stageProgress" && Number(row.value || 0) >= 55)
    .sort((a, b) => Number(b.contribution || 0) - Number(a.contribution || 0))
    .slice(0, 2);
  const watches = components
    .filter((row) => row.key !== "stageProgress" && Number(row.value || 0) < 55)
    .sort((a, b) => Number(a.value || 0) - Number(b.value || 0))
    .slice(0, 2);
  return [stage, ...strengths, ...watches]
    .filter(Boolean)
    .slice(0, 4)
    .map((row) => ({
      key: row.key,
      label: row.label,
      value: row.value,
      contribution: row.contribution,
      tone: driverTone(row.value),
      detail: describeMomentumComponent(row, bill, statusInfo)
    }));
}

function nextWatchItemsForBill(bill, statusInfo) {
  const rawItems = String(bill.nextWatch || "")
    .split(/[.;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const items = [statusInfo.nextStep, ...rawItems];
  if (bill.latestAction) items.push(`Latest action: ${String(bill.latestAction).slice(0, 150)}`);
  items.push("Watch new lobbying filings for signs that stakeholders are reacting.");
  return [...new Set(items.filter(Boolean))].slice(0, 4);
}

function daysSince(dateValue) {
  if (!dateValue) return null;
  const t = new Date(dateValue).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 864e5);
}

function catalystForBill(bill, metrics = null) {
  const statusInfo = bill.statusInfo || statusInfoForBill(bill);
  const m = metrics || augmentBillMetrics(bill);
  const days = daysSince(bill.latestActionDate);
  let urgency = 8;
  if (bill.floorScheduled) urgency += 34;
  if (["reported", "floor"].includes(statusInfo.key)) urgency += 24;
  if (["passed_one_chamber", "resolving"].includes(statusInfo.key)) urgency += 28;
  if (statusInfo.key === "enacted") urgency += 16;
  if (statusInfo.key === "incorporated") urgency += 18;
  if (days != null && days <= 14) urgency += 22;
  else if (days != null && days <= 45) urgency += 14;
  else if (days != null && days <= 90) urgency += 7;
  if (Number(m.lobbyingPressureScore || 0) >= 70) urgency += 12;
  else if (Number(m.lobbyingPressureScore || 0) >= 50) urgency += 6;
  if ((bill.affected || []).length) urgency += 8;
  if (["failed", "vetoed"].includes(statusInfo.key)) urgency = Math.min(urgency, 34);
  urgency = Math.max(0, Math.min(100, Math.round(urgency)));

  const dateLabel =
    bill.scheduledDate ||
    bill.scheduledConsiderationDate ||
    bill.latestActionDate ||
    (bill.floorScheduled ? "Floor calendar active" : "No date posted");
  const label = bill.floorScheduled
    ? "Floor calendar watch"
    : statusInfo.key === "enacted"
      ? "Implementation watch"
      : statusInfo.label;
  return {
    billId: bill.id,
    title: bill.shortTitle || bill.title,
    statusLabel: statusInfo.label,
    label,
    dateLabel,
    urgency,
    urgencyLabel: urgency >= 75 ? "High" : urgency >= 50 ? "Medium" : "Watch",
    tone: urgency >= 75 ? "green" : urgency < 40 ? "red" : statusInfo.tone,
    momentum: m.legislativeMomentum,
    lobbyingPressure: m.lobbyingPressureScore,
    tickers: (bill.affected || []).slice(0, 5),
    summary: statusInfo.marketMeaning,
    nextStep: statusInfo.nextStep,
    source: bill.floorScheduled ? "floor schedule flag" : "latest action / modeled status"
  };
}

function buildPolicyCatalysts(bills) {
  return (bills || [])
    .map((bill) => catalystForBill(bill, bill.legislativeMomentum != null ? bill : null))
    .filter((item) => item.urgency >= 30)
    .sort((a, b) => b.urgency - a.urgency || b.momentum - a.momentum)
    .slice(0, 6);
}

function augmentBillMetrics(bill) {
  const legislativeMomentum = computeLegislativeMomentum(bill);
  const signalConfidence = billSignalConfidence(bill);
  const policyExposure = legislativeMomentum;
  const pseudo = pseudoFilingFromBill(bill);
  const lobbyingPressureScore = pseudo ? computeLobbyingPressure(pseudo) : 0;
  const lobbyingSignalConfidence = pseudo ? lobbyingFilingConfidence(pseudo) : "Low";
  const hasLdaLobbying =
    bill.lobbyingSource === "senate_lda" &&
    (Number(bill.lobbyingFilingsCount) > 0 || Number(bill.lobbyingAgainst) > 0 || Number(bill.lobbyingFor) > 0);
  const missingInputs =
    (bill.latestActionDate ? 0 : 1) +
    (Number(bill.cosponsors || 0) > 0 ? 0 : 1) +
    (hasLdaLobbying ? 0 : 1);
  const staleInputs = bill.latestActionDate && (Date.now() - new Date(bill.latestActionDate).getTime()) / 864e5 > 90 ? 1 : 0;
  return {
    legislativeMomentum,
    policyExposure,
    confidence: scoreConfidence({ missingInputs, staleInputs }),
    signalConfidence,
    lobbyingPressureScore,
    lobbyingSignalConfidence
  };
}

function computeBillMetricBreakdown(bill) {
  const statusKey = normalizeStatusKey(bill.status, bill.latestAction, bill);
  const statusInfo = statusInfoForBill(bill);
  const components = [
    { key: "stageProgress", label: "Stage progress (from bill status)", value: subscoreStageProgress(statusKey), weight: 0.25 },
    { key: "sponsorEffectiveness", label: "Sponsor effectiveness", value: subscoreSponsorEffectiveness(bill), weight: 0.15 },
    { key: "cosponsorStrength", label: "Cosponsor strength", value: subscoreCosponsorStrength(bill), weight: 0.15 },
    { key: "bipartisanBreadth", label: "Bipartisan breadth", value: subscoreBipartisanBreadth(bill), weight: 0.1 },
    { key: "committeeSchedule", label: "Committee / floor posture", value: subscoreCommitteeSchedule(bill), weight: 0.1 },
    { key: "recency", label: "Recency of last action", value: subscoreRecencyDays(bill.latestActionDate), weight: 0.1 },
    { key: "textEnactability", label: "Text & floor enactability", value: subscoreTextEnactability(bill), weight: 0.1 },
    { key: "timeRemaining", label: "Session timing proxy", value: subscoreTimeRemaining(bill), weight: 0.05 }
  ];
  const weightedRaw = components.reduce((sum, c) => sum + c.weight * c.value, 0);
  const withContrib = components.map((c) => ({
    key: c.key,
    label: c.label,
    value: c.value,
    weight: c.weight,
    weightPct: Math.round(c.weight * 1000) / 10,
    contribution: Math.round(c.weight * c.value * 100) / 100
  }));
  const pseudo = pseudoFilingFromBill(bill);
  return {
    bill: {
      id: bill.id,
      title: bill.title,
      status: bill.status,
      statusLabel: statusInfo.label,
      chamber: bill.chamber || null,
      latestActionDate: bill.latestActionDate || null
    },
    legislativeMomentum: {
      score: computeLegislativeMomentum(bill),
      weightedRawBeforeClamp: Math.round(weightedRaw * 100) / 100,
      note: "Displayed momentum is the weighted sum rounded to an integer and clamped to 0–100.",
      components: withContrib
    },
    billSignalConfidence: {
      label: billSignalConfidence(bill),
      rubric: "Point-based checklist (recency, cosponsors, matched LDA filings, narrative depth); ≥72 High, ≥44 Medium, else Low."
    },
    lobbyingPressureOnBillCard: pseudo
      ? {
          score: computeLobbyingPressure(pseudo),
          ldaSpike: pseudo.spike,
          ldaAmountUsd: pseudo.amount,
          note: "Lobbying pressure from Senate LDA matched filings aggregated to this bill."
        }
      : {
          score: 0,
          note: "No matched LDA filings — lobbying pressure not scored until SENATE_LDA_API_KEY returns matches."
        },
    curatedSignals: bill.signals || null
  };
}

function methodologyDoc(res) {
  sendJson(res, 200, METHODOLOGY);
}

function billPolicyMetrics(res, url) {
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return sendJson(res, 400, { error: "missing_id" });
  const bill = POLICY_BILLS.find((b) => b.id === id);
  if (!bill) return sendJson(res, 404, { error: "unknown_bill_id", billId: id });
  sendJson(res, 200, {
    source: "policy_seed_model",
    confidence: augmentBillMetrics(bill).confidence,
    breakdown: computeBillMetricBreakdown(bill)
  });
}

function decorateBill(bill) {
  const stake = POLICY_STAKEHOLDERS[bill.id] || null;
  const scenarioOnly = bill.scenarioOnly === true || String(bill.id || "").startsWith("scenario:");
  const exact = bill.exactCongressRecord === true;
  const displayId = exact
    ? bill.id
    : scenarioOnly
      ? `Scenario · ${bill.scenarioId || bill.id.replace(/^scenario:/, "")}`
      : bill.id;
  const base = {
    ...bill,
    displayId,
    scenarioOnly,
    nextWatch: bill.nextWatch || stake?.nextWatch || null
  };
  if (base._placeholderFacts && !exact) {
    base.status = "scenario";
    base.latestActionDate = null;
    base.cosponsors = base.cosponsors == null ? null : base.cosponsors;
  }
  const metrics = augmentBillMetrics(base);
  const statusInfo = statusInfoForBill(base);
  const sourceKind = exact
    ? "congress_exact"
    : scenarioOnly
      ? "tradesimple_scenario"
      : "tradesimple_modeled_seed";
  const sourceNote = exact
    ? "Exact Congress.gov record."
    : scenarioOnly
      ? "TradeSimple scenario — not a live bill record. Status and dates fill in when Congress.gov is linked and refreshed."
      : "Linked seed — refresh with CONGRESS_API_KEY for live status. Impact ranges remain scenario models.";
  const stakeholders = stake
    ? { lawmakers: stake.lawmakers, committees: stake.committees, lobbying: [] }
    : bill.stakeholders || null;
  const legislativeContext = buildBillLegislativeContext(
    { ...base, statusInfo, floorScheduled: base.floorScheduled },
    statusInfo,
    { stakeholders }
  );
  const exposedBase = applyBillMarketExposure(base);
  return {
    ...base,
    ...metrics,
    exactCongressRecord: exact,
    sourceKind,
    sourceNote,
    dataLayer: exact ? "live" : scenarioOnly ? "scenario" : "mixed",
    provenance: billFieldMap({ ...base, exactCongressRecord: exact, scenarioOnly }),
    congressUrl: billCongressUrl(base),
    statusInfo,
    stagePath: statusInfo.stagePath,
    momentumDrivers: momentumDriversForBill(base),
    catalyst: catalystForBill({ ...base, statusInfo }, metrics),
    nextWatchItems: nextWatchItemsForBill(base, statusInfo),
    stakeholders: stake || bill.stakeholders || null,
    legislativeContext,
    whyMarketsCare: buildWhyMarketsCareRules(exposedBase, exposedBase.affected || [], statusInfo) || null
  };
}

function normalizeLiveCongressBill(bill) {
  const ref = {
    congress: String(bill.congress),
    type: String(bill.type || "hr").toLowerCase(),
    number: String(bill.number)
  };
  const canonicalId = congressRefToBillId(ref) || `${bill.type}.${bill.number}-${bill.congress}`;
  const latestActionText = bill.latestAction?.text || "Updated by Congress.gov";
  const latestActionDate = bill.latestAction?.actionDate || bill.updateDate || bill.updateDateIncludingText || "";
  const stage = parseBillStageFromAction(latestActionText, null, { latestActionDate, floorScheduled: false });

  const chamberRaw = bill.originChamber || bill.type || "House";
  const chamber = String(chamberRaw).toLowerCase().includes("senate") ? "Senate" : "House";

  const sponsors = Array.isArray(bill.sponsors) ? bill.sponsors : [];
  const sp = sponsors[0];
  const policyArea = bill.policyArea?.name || bill.policyArea || null;
  const draft = {
    id: canonicalId,
    title: bill.title,
    shortTitle: bill.title,
    chamber,
    status: coarseBillStatusFromStageKey(stage.statusKey),
    sponsor: sp
      ? { name: sp.fullName || sp.lastName || "", party: sp.party || "U", state: sp.state || "" }
      : { name: "", party: "U", state: "" },
    cosponsors: Number(bill.cosponsors?.count ?? bill.cosponsors ?? 0),
    bipartisanCosponsors: 0,
    floorScheduled: stage.floorScheduled,
    exactCongressRecord: true,
    _dynamicCongressBill: true,
    introducedDate: bill.introducedDate || null,
    policyArea,
    latestAction: stage.latestAction || latestActionText,
    latestActionDate: stage.latestActionDate || latestActionDate,
    lastSubstantiveActionDate: stage.lastSubstantiveActionDate || latestActionDate,
    tags: inferTags(`${bill.title || ""} ${policyArea || ""}`),
    lobbyingAgainst: null,
    lobbyingFor: null,
    plainEnglish: "",
    signal: "",
    impact: ""
  };
  const exposed = applyBillMarketExposure(draft);
  const tickers = exposed.affected || [];
  return {
    ...draft,
    ...exposed,
    portfolioTickers: tickers,
    signal: tickers.length
      ? `Live Congress.gov bill — may affect ${tickers.join(", ")}.`
      : "Live Congress.gov bill. No ticker mapping available yet.",
    impact: tickers.length
      ? `Potential exposure for ${tickers.join(", ")} — monitor for committee action or lobbying filings.`
      : "No ticker mapping available. Monitor for sector-level impact."
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, responseHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }));
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, html, { head = false } = {}) {
  res.writeHead(status, responseHeaders({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  }));
  if (head) return res.end();
  res.end(html);
}

function sendText(res, status, text) {
  res.writeHead(status, responseHeaders({ "content-type": "text/plain; charset=utf-8" }));
  res.end(text);
}

function redirect(res, location) {
  res.writeHead(302, responseHeaders({ location }));
  res.end();
}

function responseHeaders(headers = {}) {
  const merged = { ...BASE_SECURITY_HEADERS, ...headers };
  if (
    APP_URL.startsWith("https://") ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_PUBLIC_DOMAIN
  ) {
    merged["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  }
  return merged;
}

function contentType(filePath) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8"
  }[extname(filePath)] || "application/octet-stream";
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function loadEnvFile(name) {
  const path = join(ROOT, name);
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
