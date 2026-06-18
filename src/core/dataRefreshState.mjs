import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const feedState = {
  market: { status: "unknown", fallback: true, lastSuccessAt: null, lastError: null, recordCount: 0 },
  bills: { status: "unknown", fallback: true, lastSuccessAt: null, lastError: null, recordCount: 0, liveCount: 0, scenarioCount: 0 },
  lobbying: { status: "unknown", fallback: true, lastSuccessAt: null, lastError: null, recordCount: 0 },
  contracts: { status: "unknown", fallback: true, lastSuccessAt: null, lastError: null, recordCount: 0 },
  crypto: { status: "unknown", fallback: true, lastSuccessAt: null, lastError: null, recordCount: 0 },
  fec: { status: "unknown", fallback: true, lastSuccessAt: null, lastError: null, recordCount: 0 }
};

let congressCacheDir = null;
let refreshTimersStarted = false;

export function initDataRefresh({ dataDir }) {
  congressCacheDir = join(dataDir, "cache", "congress");
}

export function noteFeedSuccess(name, { source, recordCount = 0, liveCount = 0, scenarioCount = 0 } = {}) {
  const fallback =
    String(source || "").includes("fallback") ||
    source === "policy_seed_model" ||
    source === "fallback" ||
    source === "sample";
  feedState[name] = {
    status: fallback ? "fallback" : "connected",
    fallback,
    source: source || null,
    lastSuccessAt: new Date().toISOString(),
    lastError: null,
    recordCount,
    liveCount,
    scenarioCount
  };
}

export function noteFeedError(name, err) {
  feedState[name] = {
    ...feedState[name],
    status: "error",
    lastError: String(err?.message || err || "unknown"),
    lastSuccessAt: feedState[name]?.lastSuccessAt || null
  };
}

export function getFeedState() {
  return { ...feedState };
}

export async function readCongressCache(billId) {
  if (!congressCacheDir) return null;
  try {
    const raw = await readFile(join(congressCacheDir, `${safeFileName(billId)}.json`), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed?.fetchedAt) return null;
    const ageMs = Date.now() - new Date(parsed.fetchedAt).getTime();
    if (ageMs > Number(process.env.CONGRESS_CACHE_TTL_MS || 3_600_000)) return null;
    return parsed.payload;
  } catch {
    return null;
  }
}

export async function writeCongressCache(billId, payload) {
  if (!congressCacheDir) return;
  await mkdir(congressCacheDir, { recursive: true });
  await writeFile(
    join(congressCacheDir, `${safeFileName(billId)}.json`),
    JSON.stringify({ fetchedAt: new Date().toISOString(), payload }, null, 0),
    "utf8"
  );
}

function safeFileName(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function startBackgroundRefresh(handlers = {}) {
  if (refreshTimersStarted) return;
  refreshTimersStarted = true;

  const quoteMs = Number(process.env.QUOTE_REFRESH_MS || 60_000);
  const congressMs = Number(process.env.CONGRESS_REFRESH_MS || 900_000);

  if (typeof handlers.refreshQuotes === "function") {
    setInterval(() => {
      handlers.refreshQuotes().catch((err) => noteFeedError("market", err));
    }, quoteMs);
  }

  if (typeof handlers.refreshCongress === "function") {
    setInterval(() => {
      handlers.refreshCongress().catch((err) => noteFeedError("bills", err));
    }, congressMs);
  }

  const ldaMs = Number(process.env.LDA_REFRESH_MS || 3_600_000);
  if (typeof handlers.refreshLobbying === "function") {
    setInterval(() => {
      handlers.refreshLobbying().catch((err) => noteFeedError("lobbying", err));
    }, ldaMs);
  }

  const fecMs = Number(process.env.FEC_REFRESH_MS || process.env.FEC_PULSE_CACHE_TTL_MS || 480_000);
  if (typeof handlers.refreshFec === "function") {
    setInterval(() => {
      handlers.refreshFec().catch((err) => noteFeedError("fec", err));
    }, fecMs);
  }
}

export function buildHealthPayload(env = process.env, extra = {}) {
  const feeds = getFeedState();
  const configured = {
    finnhub: Boolean(env.FINNHUB_API_KEY),
    congress: Boolean(env.CONGRESS_API_KEY),
    senateLda: Boolean(env.SENATE_LDA_API_KEY),
    secEdgar: Boolean(env.SEC_USER_AGENT && !String(env.SEC_USER_AGENT).includes("you@example.com")),
    fec: Boolean(env.FEC_API_KEY),
    yfinance: env.YFINANCE_ENABLED !== "false"
  };

  const blockingIssues = extra.blockingIssues || [];
  const dataMode =
    Object.values(feeds).every((f) => f.status === "connected" && !f.fallback)
      ? "live"
      : Object.values(feeds).some((f) => f.status === "connected" && !f.fallback)
        ? "mixed"
        : "scenario";

  return {
    dataMode,
    configured,
    feeds,
    blockingIssues,
    seedValidation: extra.seedValidation || null,
    production: extra.production || null,
    updatedAt: new Date().toISOString()
  };
}
