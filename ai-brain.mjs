import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(ROOT, "data");
const LOBBY_MAP_FILE = join(DATA_DIR, "ai-lobby-map.json");

const AI_RESEARCH_DISCLAIMER =
  "Research signal only. Not financial advice. Do not recommend buying, selling, or holding any security.";

const aiRateLimitHits = new Map();
const AI_RATE_LIMIT_WINDOW_MS = Number(process.env.AI_RATE_LIMIT_WINDOW_MS || 60_000);
const AI_RATE_LIMIT_MAX = Number(process.env.AI_RATE_LIMIT_MAX || 20);

const companyNewsCache = new Map();
const COMPANY_NEWS_TTL_MS = 10 * 60_000;
const scorecardCache = new Map();
const SCORECARD_CACHE_TTL_MS = Number(process.env.SCORECARD_CACHE_TTL_MS || 5 * 60_000);

let lobbyMap = {};
let lobbyMapLoaded = false;

function jsonResp(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function clientIp(req) {
  const raw =
    req.headers["cf-connecting-ip"] ||
    req.headers["x-real-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "unknown";

  return String(Array.isArray(raw) ? raw[0] : raw).split(",")[0].trim();
}

function checkAiRateLimit(req) {
  const now = Date.now();
  const ip = clientIp(req);
  let entry = aiRateLimitHits.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + AI_RATE_LIMIT_WINDOW_MS };
  }

  entry.count += 1;
  aiRateLimitHits.set(ip, entry);

  if (aiRateLimitHits.size > 500) {
    for (const [key, val] of aiRateLimitHits.entries()) {
      if (now > val.resetAt) aiRateLimitHits.delete(key);
    }
  }

  return {
    ok: entry.count <= AI_RATE_LIMIT_MAX,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    remaining: Math.max(0, AI_RATE_LIMIT_MAX - entry.count)
  };
}

function enforceAiRateLimit(req, res) {
  const limit = checkAiRateLimit(req);
  if (limit.ok) return false;

  jsonResp(
    res,
    429,
    {
      error: "rate_limited",
      message: "Too many AI requests. Try again shortly.",
      retryAfterSeconds: limit.retryAfterSeconds
    },
    { "retry-after": String(limit.retryAfterSeconds) }
  );
  return true;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function fetchAnthropic({ system, user, maxTokens = 1024, model, timeoutMs = 20_000 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Anthropic ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || "";
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGemini({ system, user, maxTokens = 1024, model, timeoutMs = 20_000 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const geminiModel = model || process.env.GEMINI_MODEL || "gemini-2.0-flash";

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.2
          }
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Gemini ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim() || "";
  } finally {
    clearTimeout(timer);
  }
}

function hasServerAiProvider() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);
}

async function fetchAiText(options) {
  const preferred = String(
    process.env.AI_TRANSLATION_PROVIDER ||
    process.env.SERVER_AI_PROVIDER ||
    ""
  ).toLowerCase();
  if (preferred === "gemini" && process.env.GEMINI_API_KEY) {
    return { source: "gemini", text: await fetchGemini(options) };
  }
  if (preferred === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return { source: "anthropic", text: await fetchAnthropic(options) };
  }
  if (process.env.GEMINI_API_KEY) {
    return { source: "gemini", text: await fetchGemini(options) };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { source: "anthropic", text: await fetchAnthropic(options) };
  }
  throw new Error("No server AI provider configured");
}

function parseJsonFromText(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Could not parse JSON from model response");
  }
}

function normalizeLobbyMapperResult(value, fallbackReason = "matched") {
  const rawMatches = Array.isArray(value?.matches)
    ? value.matches
    : Array.isArray(value)
      ? value
      : [];

  const matches = rawMatches
    .filter(Boolean)
    .filter((m) => Number(m.score || 0) >= 0.35)
    .slice(0, 8)
    .map((m) => ({
      billId: String(m.billId || ""),
      score: Number(m.score || 0),
      direction: ["for", "against", "neutral"].includes(m.direction) ? m.direction : "neutral",
      tokens: Array.isArray(m.tokens) ? m.tokens.slice(0, 5).map(String) : [],
      reasoning: String(m.reasoning || "")
    }))
    .filter((m) => m.billId);

  const reason = value?.reason || (matches.length ? fallbackReason : "no_match");

  return {
    matches,
    reason,
    source: value?.source || "anthropic",
    cached: Boolean(value?.cached),
    updatedAt: value?.updatedAt || Date.now(),
    ...(value?.error ? { error: String(value.error) } : {})
  };
}

async function ensureLobbyMapLoaded() {
  if (lobbyMapLoaded) return;
  lobbyMapLoaded = true;
  if (!existsSync(LOBBY_MAP_FILE)) return;
  try {
    const raw = await readFile(LOBBY_MAP_FILE, "utf8");
    lobbyMap = JSON.parse(raw) || {};
  } catch {
    lobbyMap = {};
  }
}

async function saveLobbyMap() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(LOBBY_MAP_FILE, JSON.stringify(lobbyMap, null, 2), "utf8");
}

function lobbyFilingId(filing) {
  const client = String(filing?.client || filing?.registrant || "unknown");
  const issue = String(filing?.issue || "");
  const posted = String(filing?.postedAt || filing?.posted || "");
  const amount = String(filing?.amount || "");
  return `${client}|${issue}|${posted}|${amount}`.slice(0, 240);
}

export async function runLobbyMapper({ filing, bills }) {
  await ensureLobbyMapLoaded();
  const filingId = lobbyFilingId(filing);
  const cached = lobbyMap[filingId];

  if (cached) {
    if (Array.isArray(cached)) {
      const wrapped = normalizeLobbyMapperResult(cached, cached.length ? "matched" : "no_match");
      return { ...wrapped, source: "cache", cached: true };
    }
    if (cached.matches || cached.reason) {
      const wrapped = normalizeLobbyMapperResult(cached, cached.reason || "matched");
      return { ...wrapped, source: "cache", cached: true };
    }
  }

  if (!hasServerAiProvider()) {
    return {
      matches: [],
      reason: "api_error",
      source: "fallback_error",
      cached: false,
      updatedAt: Date.now(),
      error: "Server AI provider not configured"
    };
  }

  const billDigest = (Array.isArray(bills) ? bills : [])
    .slice(0, 40)
    .map((b) => ({
      id: b.id,
      title: b.title || b.shortTitle,
      tags: b.tags || [],
      affected: b.affected || [],
      issueHints: [b.plainEnglish, b.signal, b.impact].filter(Boolean).join(" ").slice(0, 280)
    }));

  const system = `You map Senate lobbying filings to congressional bills for research context only.
${AI_RESEARCH_DISCLAIMER}
Return ONLY valid JSON:
{
  "matches": [
    { "billId": "string", "score": 0.0-1.0, "direction": "for"|"against"|"neutral", "tokens": ["keyword"], "reasoning": "one sentence" }
  ]
}
Use score >= 0.35 only when there is a meaningful issue overlap. If nothing maps, return {"matches":[]}.`;

  const user = `Filing:
${JSON.stringify(
  {
    client: filing?.client,
    registrant: filing?.registrant,
    amount: filing?.amount,
    issue: filing?.issue,
    postedAt: filing?.postedAt || filing?.posted
  },
  null,
  2
)}

Tracked bills:
${JSON.stringify(billDigest, null, 2)}`;

  try {
    const { text, source } = await fetchAiText({ system, user, maxTokens: 900 });
    const rawClaudeResult = parseJsonFromText(text);
    const normalized = normalizeLobbyMapperResult(rawClaudeResult);
    if (normalized.reason === "matched" || normalized.reason === "no_match") {
      lobbyMap[filingId] = normalized;
      await saveLobbyMap();
    }
    return { ...normalized, source };
  } catch (err) {
    return {
      matches: [],
      reason: "api_error",
      source: "fallback_error",
      cached: false,
      updatedAt: Date.now(),
      error: err.message
    };
  }
}

function yyyyMmDd(daysAgo = 0) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toISOString().slice(0, 10);
}

export async function fetchCompanyNews(symbol, { days = 2, limit = 8 } = {}) {
  const cleanSymbol = String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z.]/g, "")
    .slice(0, 12);

  if (!cleanSymbol) return [];

  const cacheKey = `${cleanSymbol}:${days}:${limit}`;
  const cached = companyNewsCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < COMPANY_NEWS_TTL_MS) {
    return cached.news;
  }

  const token = process.env.FINNHUB_API_KEY;
  if (!token) return [];

  const url = new URL("https://finnhub.io/api/v1/company-news");
  url.searchParams.set("symbol", cleanSymbol);
  url.searchParams.set("from", yyyyMmDd(days));
  url.searchParams.set("to", yyyyMmDd(0));
  url.searchParams.set("token", token);

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) throw new Error(`Finnhub ${resp.status}`);
    const data = await resp.json();

    const news = (Array.isArray(data) ? data : [])
      .filter((item) => item && item.headline)
      .slice(0, limit)
      .map((item) => ({
        headline: String(item.headline || ""),
        source: String(item.source || "Finnhub"),
        url: String(item.url || ""),
        publishedAt: item.datetime
          ? new Date(Number(item.datetime) * 1000).toISOString()
          : null,
        summary: item.summary ? String(item.summary).slice(0, 280) : ""
      }));

    companyNewsCache.set(cacheKey, { news, cachedAt: Date.now() });
    return news;
  } catch (err) {
    console.error("[finnhub company-news]", err.message);
    return [];
  }
}

const BILL_HEADLINE_TOPIC_PATTERNS = [
  /\bice\b/i,
  /border patrol/i,
  /customs and border/i,
  /\bcbp\b/i,
  /homeland security/i,
  /\bdhs\b/i,
  /immigration enforcement/i,
  /detention/i,
  /secure america/i,
  /reconciliation/i
];

export async function fetchBillRelatedHeadlines(bill, tickers = [], { days = 7, limit = 12 } = {}) {
  const corpus = [
    bill?.title,
    bill?.shortTitle,
    bill?.latestAction,
    bill?.policyArea,
    ...(bill?.tags || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const pool = [];
  const seen = new Set();
  const add = (item) => {
    const key = item.url || item.headline;
    if (!key || seen.has(key)) return;
    seen.add(key);
    pool.push(item);
  };

  const symbols = [...new Set((tickers || []).map((t) => String(t || "").toUpperCase()).filter((t) => /^[A-Z]{1,5}$/.test(t)))].slice(
    0,
    4
  );
  for (const sym of symbols) {
    const rows = await fetchCompanyNews(sym, { days, limit: 6 }).catch(() => []);
    for (const row of rows) {
      const blob = `${row.headline || ""} ${row.summary || ""}`.toLowerCase();
      if (BILL_HEADLINE_TOPIC_PATTERNS.some((p) => p.test(blob)) || BILL_HEADLINE_TOPIC_PATTERNS.some((p) => p.test(corpus))) {
        add(row);
      }
    }
  }

  if (!pool.length && corpus) {
    for (const sym of symbols.slice(0, 2)) {
      const rows = await fetchCompanyNews(sym, { days, limit: 4 }).catch(() => []);
      rows.forEach(add);
    }
  }

  return pool
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, limit);
}

/** Haiku causal explanation — cache miss only when rules produce empty whyMarketsCare. */
export async function inferLiveBillWhyMarketsCareAI({ bill, billId, rateLimitKey, checkRateLimit }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const id = billId || bill?.id || "";
  const cacheKey = `live-why:${id}:${bill?.latestActionDate || "na"}`;
  const cached = await readBillExposureCache(cacheKey);
  if (cached?.whyMarketsCare) return { ...cached, cached: true };

  if (typeof checkRateLimit === "function" && rateLimitKey) {
    const rateCheck = checkRateLimit(rateLimitKey);
    if (!rateCheck.allowed) return null;
  }

  const system = `You explain why a US congressional bill matters to public markets.
Return ONLY valid JSON:
{
  "whyMarketsCare": "1-2 plain English sentences linking bill stage to agencies, contractors, and tickers",
  "causalChain": ["Bill stage", "→ Agency", "→ Contractors", "→ Tickers"]
}
No buy/sell language. ${AI_RESEARCH_DISCLAIMER}`;

  const user = [
    `Bill: ${bill?.displayId || id}`,
    `Title: ${bill?.title || bill?.shortTitle || ""}`,
    `Policy area: ${bill?.policyArea || "n/a"}`,
    `Latest action: ${bill?.latestAction || ""}`,
    `Mapped tickers: ${(bill?.affected || []).join(", ") || "none"}`
  ].join("\n");

  const text = await fetchAnthropic({
    system,
    user: `Explain why this bill matters to markets now:\n\n${user}`,
    maxTokens: 320,
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001"
  });
  const parsed = parseJsonFromText(text);
  if (!parsed?.whyMarketsCare) return null;
  const payload = {
    whyMarketsCare: String(parsed.whyMarketsCare).trim(),
    causalChain: Array.isArray(parsed.causalChain) ? parsed.causalChain.map(String).slice(0, 6) : []
  };
  await writeBillExposureCache(cacheKey, payload);
  return { ...payload, cached: false };
}

export async function enrichSnapshotWithRecentNews(snapshot, symbol) {
  const existing = Array.isArray(snapshot?.recentNews) ? snapshot.recentNews.filter(Boolean) : [];
  if (existing.length) return { ...(snapshot || {}), recentNews: existing.slice(0, 8) };

  const recentNews = await fetchCompanyNews(symbol).catch(() => []);
  return { ...(snapshot || {}), recentNews };
}

export async function runScorecardNarrator({ symbol, snapshot, mode = "investor" }) {
  snapshot = await enrichSnapshotWithRecentNews(snapshot || {}, symbol);

  const cleanSymbol = String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z.]/g, "")
    .slice(0, 12);
  const readerMode = ["citizen", "investor", "analyst"].includes(String(mode).toLowerCase())
    ? String(mode).toLowerCase()
    : "investor";
  const cacheKey = `${cleanSymbol}:${readerMode}`;
  const cached = scorecardCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < SCORECARD_CACHE_TTL_MS) {
    return { ...cached.value, cached: true };
  }

  if (!hasServerAiProvider()) {
    const fallbackCopy = narratorFallbackCopy(cleanSymbol, readerMode);
    const fallback = {
      symbol: cleanSymbol,
      source: "local_fallback",
      headline: fallbackCopy.headline,
      now: fallbackCopy.now,
      whyItMatters: fallbackCopy.whyItMatters,
      watchFor: fallbackCopy.watchFor,
      narrative: [fallbackCopy.now, fallbackCopy.whyItMatters].join("\n\n"),
      mode: readerMode,
      disclaimer: AI_RESEARCH_DISCLAIMER,
      cached: false,
      updatedAt: new Date().toISOString()
    };
    scorecardCache.set(cacheKey, { value: fallback, cachedAt: Date.now() });
    return fallback;
  }

  const newsLines = (snapshot.recentNews || [])
    .slice(0, 6)
    .map((n) => `- ${n.headline} (${n.source || "news"}${n.publishedAt ? ` · ${n.publishedAt}` : ""})`)
    .join("\n");

  const system = `You are TradeSimple's Government-to-Market Explainer Layer.
Your job is not to pick stocks. Your job is: here is the government signal, here is the market mechanism, here is what to watch next.
${AI_RESEARCH_DISCLAIMER}
Never use buy/sell/hold language. Never predict guaranteed price moves. Never say "real-time". Avoid "bullish", "bearish", "upside", and "recommendation".
Citizen mode avoids finance jargon. Investor mode may use normal market terms. Analyst mode may mention raw scores, z-scores, and model limitations.
Return ONLY JSON:
{
  "headline": "short title",
  "now": "what government or policy signal matters now, 1-3 sentences",
  "whyItMatters": "the market mechanism: revenue, margin, capex, compliance, subsidy, contract, valuation, or expectations",
  "watchFor": ["up to 3 bullets"]
}`;

  const user = `Mode: ${readerMode}
Symbol: ${cleanSymbol}
Snapshot JSON:
${JSON.stringify(snapshot, null, 2).slice(0, 12000)}

RECENT NEWS HEADLINES:
${newsLines || "(none in snapshot)"}`;

  try {
    const { text, source } = await fetchAiText({ system, user, maxTokens: 1100 });
    const parsed = parseJsonFromText(text);
    const result = {
      symbol: cleanSymbol,
      source,
      headline: String(parsed.headline || `${cleanSymbol} research context`),
      now: String(parsed.now || parsed.narrative || ""),
      whyItMatters: String(parsed.whyItMatters || ""),
      watchFor: Array.isArray(parsed.watchFor) ? parsed.watchFor.slice(0, 3).map(String) : [],
      narrative: [parsed.now, parsed.whyItMatters].filter(Boolean).join("\n\n"),
      mode: readerMode,
      disclaimer: AI_RESEARCH_DISCLAIMER,
      cached: false,
      updatedAt: new Date().toISOString()
    };
    scorecardCache.set(cacheKey, { value: result, cachedAt: Date.now() });
    return result;
  } catch (err) {
    const fallback = {
      symbol: cleanSymbol,
      source: "fallback_error",
      headline: `${cleanSymbol} narration unavailable`,
      now: "The AI narrator could not run right now. The structured government evidence is still available below.",
      whyItMatters: "Use the market mechanism chain and evidence stack to separate policy exposure from ordinary price movement.",
      watchFor: [],
      narrative: "The AI narrator could not run right now. Try again shortly.",
      mode: readerMode,
      disclaimer: AI_RESEARCH_DISCLAIMER,
      error: err.message,
      cached: false,
      updatedAt: new Date().toISOString()
    };
    scorecardCache.set(cacheKey, { value: fallback, cachedAt: Date.now() });
    return fallback;
  }
}

function narratorFallbackCopy(symbol, mode) {
  if (mode === "citizen") {
    return {
      headline: `${symbol} government-to-market context`,
      now: "AI narration is unavailable, so TradeSimple is showing the verified policy, filing, quote, and news evidence directly.",
      whyItMatters: "Government rules can matter when they change where a company can sell, what it can charge, how expensive compliance becomes, or how confident investors feel about future revenue.",
      watchFor: ["New rule language", "Company comments", "Updated SEC risk factors"]
    };
  }
  if (mode === "analyst") {
    return {
      headline: `${symbol} structured government exposure`,
      now: "AI narration is unavailable; inspect the deterministic snapshot fields instead: policy chains, riskRadar scores, lobbyMapping reason, EDGAR status, quote freshness, and source metadata.",
      whyItMatters: "The market pathway should be evaluated through revenue access, margin pressure, subsidy timing, contract dependency, compliance cost, and valuation-sensitivity assumptions. Treat scores as model context, not forecasts.",
      watchFor: ["Risk score deltas", "Lobbying map reason changes", "New source timestamps"]
    };
  }
  return {
    headline: `${symbol} government-to-market context`,
    now: "AI narration is unavailable without a server AI provider, so TradeSimple is showing the structured policy, quote, and filing evidence directly.",
    whyItMatters: "Government actions can still matter through revenue access, compliance costs, subsidies, contract awards, and investor expectations.",
    watchFor: ["Committee calendar", "Lobbying filings", "SEC risk factor updates"]
  };
}

export async function runEdgarSimplifier({ symbol, riskFactorsText, filingDate }) {
  const risk = String(riskFactorsText || "").trim();
  if (!risk) {
    return {
      whereMoneyComesFrom: [],
      whatCouldHurtIt: [],
      numbersGoingRight: "No risk-factor text was available to translate."
    };
  }

  if (!hasServerAiProvider()) {
    return {
      whereMoneyComesFrom: [],
      whatCouldHurtIt: [
        "SEC risk factors are available, but AI translation needs ANTHROPIC_API_KEY or GEMINI_API_KEY on the server."
      ],
      numbersGoingRight: "Read the filing excerpt below for the company's own wording."
    };
  }

  const system = `Translate SEC 10-K Item 1A risk factors into plain English for research context.
${AI_RESEARCH_DISCLAIMER}
Return ONLY JSON:
{
  "whereMoneyComesFrom": ["bullet"],
  "whatCouldHurtIt": ["bullet"],
  "numbersGoingRight": "one short paragraph"
}`;

  const user = `Symbol: ${symbol}
Filing date: ${filingDate || "unknown"}
Risk factors excerpt (may be truncated):
${risk.slice(0, 14000)}`;

  try {
    const { text } = await fetchAiText({ system, user, maxTokens: 1200 });
    const parsed = parseJsonFromText(text);
    return {
      whereMoneyComesFrom: Array.isArray(parsed.whereMoneyComesFrom)
        ? parsed.whereMoneyComesFrom.slice(0, 6).map(String)
        : [],
      whatCouldHurtIt: Array.isArray(parsed.whatCouldHurtIt)
        ? parsed.whatCouldHurtIt.slice(0, 8).map(String)
        : [],
      numbersGoingRight: String(parsed.numbersGoingRight || "")
    };
  } catch (err) {
    return {
      whereMoneyComesFrom: [],
      whatCouldHurtIt: ["SEC translation temporarily unavailable."],
      numbersGoingRight: "",
      error: err.message
    };
  }
}

export async function runChartLabeler({ symbol, points, context = {} }) {
  const series = Array.isArray(points) ? points.slice(-24) : [];
  if (!series.length) {
    return { labels: [], source: "empty", updatedAt: new Date().toISOString() };
  }

  if (!hasServerAiProvider()) {
    const last = series[series.length - 1];
    const first = series[0];
    const move =
      first?.value && last?.value
        ? ((Number(last.value) - Number(first.value)) / Number(first.value)) * 100
        : 0;
    return {
      labels: [
        {
          at: last?.label || last?.date || "",
          text: `${symbol} moved about ${move >= 0 ? "+" : ""}${move.toFixed(1)}% across the shown window (modeled label).`
        }
      ],
      source: "local_fallback",
      updatedAt: new Date().toISOString()
    };
  }

  const system = `Label price chart points in plain English for research context only.
${AI_RESEARCH_DISCLAIMER}
Return ONLY JSON: {"labels":[{"at":"date","text":"short label"}]}`;

  const user = `Symbol: ${symbol}
Context: ${JSON.stringify(context).slice(0, 2000)}
Points: ${JSON.stringify(series).slice(0, 8000)}`;

  try {
    const { text, source } = await fetchAiText({ system, user, maxTokens: 700 });
    const parsed = parseJsonFromText(text);
    return {
      labels: Array.isArray(parsed.labels)
        ? parsed.labels.slice(0, 8).map((l) => ({
            at: String(l.at || ""),
            text: String(l.text || "")
          }))
        : [],
      source,
      updatedAt: new Date().toISOString()
    };
  } catch (err) {
    return {
      labels: [],
      source: "fallback_error",
      error: err.message,
      updatedAt: new Date().toISOString()
    };
  }
}

export async function aiScorecardHandler(req, res) {
  if (req.method !== "POST") return jsonResp(res, 405, { error: "method_not_allowed" });
  const limited = enforceAiRateLimit(req, res);
  if (limited) return;

  try {
    const body = await readJsonBody(req);
    const symbol = String(body.symbol || "").toUpperCase().replace(/[^A-Z.]/g, "");
    if (!symbol) return jsonResp(res, 400, { error: "symbol_required" });
    const result = await runScorecardNarrator({
      symbol,
      snapshot: body.snapshot || {},
      mode: body.mode || "investor"
    });
    return jsonResp(res, 200, result);
  } catch (err) {
    return jsonResp(res, 400, { error: err.message });
  }
}

export async function aiEdgarHandler(req, res) {
  if (req.method !== "POST") return jsonResp(res, 405, { error: "method_not_allowed" });
  const limited = enforceAiRateLimit(req, res);
  if (limited) return;

  try {
    const body = await readJsonBody(req);
    const symbol = String(body.symbol || "").toUpperCase().replace(/[^A-Z.]/g, "");
    const simplified = await runEdgarSimplifier({
      symbol,
      riskFactorsText: body.riskFactorsText || body.riskFactors || "",
      filingDate: body.filingDate
    });
    return jsonResp(res, 200, { symbol, simplified, updatedAt: new Date().toISOString() });
  } catch (err) {
    return jsonResp(res, 400, { error: err.message });
  }
}

export async function aiLobbyMapHandler(req, res) {
  if (req.method !== "POST") return jsonResp(res, 405, { error: "method_not_allowed" });
  const limited = enforceAiRateLimit(req, res);
  if (limited) return;

  try {
    const body = await readJsonBody(req);
    const filing = body.filing;
    const bills = body.bills;
    if (!filing) return jsonResp(res, 400, { error: "filing_required" });
    const result = await runLobbyMapper({ filing, bills: Array.isArray(bills) ? bills : [] });
    return jsonResp(res, 200, result);
  } catch (err) {
    return jsonResp(res, 400, { error: err.message });
  }
}

/**
 * Generate a plain-English causality analysis for how policy/contracts affect a stock.
 * Works for any ticker — uses bills, lobbying context, and contract profile as grounding data.
 */
export async function runCausalityAnalyzer({ symbol, companyName, bills = [], lobbyingContext = "", contractProfile = null, price = null, sector = "" }) {
  const govPct = contractProfile ? Math.round(contractProfile.governmentRevenuePct * 100) : null;
  const billSummary = bills.slice(0, 5).map((b, i) =>
    `${i + 1}. "${b.title}" — stage: ${b.stage || "unknown"}, momentum: ${b.momentum ?? "?"}/100, impact: ${b.impact || b.policyImpact || "unclear"}`
  ).join("\n");

  const system = `You are TradeSimple's policy-market analyst. You explain in plain English how legislation, government contracts, and lobbying pressure create real investment risk or opportunity for a specific stock. You are precise, concise, and never hype. You do not give buy/sell advice. Always ground analysis in the specific data provided.`;

  const ticker = symbol;
  const user = `Analyze the policy-to-market causality for ${ticker}${companyName ? ` (${companyName})` : ""}${sector ? `, sector: ${sector}` : ""}.

${govPct !== null ? `Government contracts: ~${govPct}% of revenue. Archetype: ${contractProfile.archetype}.` : "No government contract profile available."}
${contractProfile?.note ? `Context: ${contractProfile.note}` : ""}
${billSummary ? `Active bills affecting this ticker:\n${billSummary}` : "No directly mapped bills found."}
${lobbyingContext ? `Lobbying context: ${lobbyingContext}` : ""}
${price ? `Current price: $${price}` : ""}

Respond with ONLY a raw JSON object. No markdown, no explanation outside the JSON. Use this structure exactly:
{"plainEnglish":"2-3 sentence summary of the clearest policy-to-stock mechanism. Name the bill or agency if relevant.","nodes":[{"step":"1 · Budget","title":"One causal statement","detail":"1-2 sentence mechanism explanation","source":"source name"},{"step":"2 · Signal","title":"One causal statement","detail":"1-2 sentence mechanism explanation","source":"source name"},{"step":"3 · Exposure","title":"One causal statement","detail":"1-2 sentence mechanism explanation","source":"source name"},{"step":"4 · Market","title":"One causal statement","detail":"1-2 sentence mechanism explanation","source":"source name"}],"scenarios":[{"name":"Upside","change":"Specific upside in one sentence","read":"What it means","cls":"positive"},{"name":"Base","change":"Base case in one sentence","read":"What to watch","cls":"warning"},{"name":"Downside","change":"Specific downside in one sentence","read":"What it means","cls":"negative"}],"translation":[{"step":"A","title":"What is happening?","body":"One sentence"},{"step":"B","title":"Why does it matter?","body":"One sentence with a number if known"},{"step":"C","title":"What could change?","body":"One sentence"},{"step":"D","title":"What to watch?","body":"Specific signal or source"}]}

Fill in real content for ${ticker}. Be specific — if a bill is named in the data, use its actual title.`;

  const { text } = await fetchAiText({ system, user, maxTokens: 1600, timeoutMs: 45_000 });
  const parsed = parseJsonFromText(text);

  // Normalize and validate
  return {
    plainEnglish: String(parsed.plainEnglish || ""),
    nodes: Array.isArray(parsed.nodes) ? parsed.nodes.slice(0, 6) : [],
    scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios.slice(0, 3) : [],
    translation: Array.isArray(parsed.translation) ? parsed.translation.slice(0, 4) : []
  };
}

export async function aiChartLabelHandler(req, res) {
  if (req.method !== "POST") return jsonResp(res, 405, { error: "method_not_allowed" });
  const limited = enforceAiRateLimit(req, res);
  if (limited) return;

  try {
    const body = await readJsonBody(req);
    const symbol = String(body.symbol || "").toUpperCase().replace(/[^A-Z.]/g, "");
    if (!symbol) return jsonResp(res, 400, { error: "symbol_required" });
    const result = await runChartLabeler({
      symbol,
      points: body.points || [],
      context: body.context || {}
    });
    return jsonResp(res, 200, result);
  } catch (err) {
    return jsonResp(res, 400, { error: err.message });
  }
}

function normalizeStringList(input, limit = 6) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeThesisConfidence(confidence) {
  const scoreRaw = Number(confidence?.score);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : null;
  return {
    score,
    label: String(confidence?.label || (score == null ? "" : score >= 75 ? "High" : score >= 45 ? "Medium" : "Low")),
    explanation: String(confidence?.explanation || "")
  };
}

function normalizeThesisAnalysis(payload = {}) {
  return {
    thesisRestatement: String(payload.thesisRestatement || ""),
    bullCase: normalizeStringList(payload.bullCase, 8),
    bearCase: normalizeStringList(payload.bearCase, 8),
    marketMechanism: String(payload.marketMechanism || ""),
    policyMechanism: String(payload.policyMechanism || ""),
    evidenceFor: normalizeStringList(payload.evidenceFor, 10),
    evidenceAgainst: normalizeStringList(payload.evidenceAgainst, 10),
    missingInfo: normalizeStringList(payload.missingInfo, 10),
    watchTriggers: normalizeStringList(payload.watchTriggers, 10),
    confidence: normalizeThesisConfidence(payload.confidence),
    timeHorizon: String(payload.timeHorizon || ""),
    investorPlainEnglishSummary: String(payload.investorPlainEnglishSummary || ""),
    notInvestmentAdvice: String(payload.notInvestmentAdvice || AI_RESEARCH_DISCLAIMER)
  };
}

function hasRequiredThesisFields(thesis) {
  return Boolean(
    Array.isArray(thesis?.evidenceFor) &&
      thesis.evidenceFor.length > 0 &&
      Array.isArray(thesis?.evidenceAgainst) &&
      thesis.evidenceAgainst.length > 0 &&
      Array.isArray(thesis?.watchTriggers) &&
      thesis.watchTriggers.length > 0 &&
      thesis?.confidence &&
      Number.isFinite(Number(thesis.confidence.score)) &&
      String(thesis.confidence.label || "").trim() &&
      String(thesis.confidence.explanation || "").trim()
  );
}

async function repairThesisAnalysis(rawText, context = {}) {
  const system = `You repair malformed thesis-analysis JSON for TradeSimple.
${AI_RESEARCH_DISCLAIMER}
Return ONLY valid JSON with this exact shape:
{
  "thesisRestatement": "string",
  "bullCase": ["string"],
  "bearCase": ["string"],
  "marketMechanism": "string",
  "policyMechanism": "string",
  "evidenceFor": ["string"],
  "evidenceAgainst": ["string"],
  "missingInfo": ["string"],
  "watchTriggers": ["string"],
  "confidence": {
    "score": 0-100,
    "label": "Low|Medium|High",
    "explanation": "string"
  },
  "timeHorizon": "string",
  "investorPlainEnglishSummary": "string",
  "notInvestmentAdvice": "Research signal only. Not financial advice. Do not recommend buying, selling, or holding any security."
}
Required and non-empty: evidenceFor, evidenceAgainst, watchTriggers, confidence.score, confidence.label, confidence.explanation.`;

  const user = `Repair this model output so it matches the required schema and required fields.
If details are missing, infer cautiously from provided context and explicitly note uncertainty in missingInfo.

Context:
${JSON.stringify(context, null, 2).slice(0, 9000)}

Broken output:
${String(rawText || "").slice(0, 12000)}`;

  const { text: repairedText } = await fetchAiText({ system, user, maxTokens: 1500, timeoutMs: 30_000 });
  return normalizeThesisAnalysis(parseJsonFromText(repairedText));
}

export async function runThesisAnalyzer({
  symbol,
  thesisText,
  direction = "bull",
  policySignals = [],
  contractSignals = [],
  lobbyingSignals = [],
  horizonHint = ""
}) {
  const cleanSymbol = String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z.]/g, "")
    .slice(0, 12);
  const cleanDirection = ["bull", "bear", "watch"].includes(String(direction).toLowerCase())
    ? String(direction).toLowerCase()
    : "watch";
  const cleanThesisText = String(thesisText || "").trim().slice(0, 4000);

  if (!cleanSymbol) throw new Error("symbol_required");
  if (!cleanThesisText) throw new Error("thesis_text_required");
  if (!hasServerAiProvider()) throw new Error("Server AI provider not configured");

  const context = {
    symbol: cleanSymbol,
    direction: cleanDirection,
    thesisText: cleanThesisText,
    policySignals: Array.isArray(policySignals) ? policySignals.slice(0, 12) : [],
    contractSignals: Array.isArray(contractSignals) ? contractSignals.slice(0, 12) : [],
    lobbyingSignals: Array.isArray(lobbyingSignals) ? lobbyingSignals.slice(0, 12) : [],
    horizonHint: String(horizonHint || "").slice(0, 180)
  };

  const system = `You are TradeSimple's thesis analyzer.
${AI_RESEARCH_DISCLAIMER}
Generate a balanced research memo with explicit confirming and disconfirming evidence.
Return ONLY valid JSON in this exact schema:
{
  "thesisRestatement": "string",
  "bullCase": ["string"],
  "bearCase": ["string"],
  "marketMechanism": "string",
  "policyMechanism": "string",
  "evidenceFor": ["string"],
  "evidenceAgainst": ["string"],
  "missingInfo": ["string"],
  "watchTriggers": ["string"],
  "confidence": {
    "score": 0-100,
    "label": "Low|Medium|High",
    "explanation": "string"
  },
  "timeHorizon": "string",
  "investorPlainEnglishSummary": "string",
  "notInvestmentAdvice": "Research signal only. Not financial advice. Do not recommend buying, selling, or holding any security."
}
Hard requirements:
- evidenceFor must contain at least 1 specific item.
- evidenceAgainst must contain at least 1 specific item.
- watchTriggers must contain at least 1 specific item.
- confidence must include score, label, explanation.
- Never output markdown or commentary outside JSON.`;

  const user = `Analyze this thesis context and return structured JSON only.
${JSON.stringify(context, null, 2).slice(0, 12000)}`;

  const { text, source } = await fetchAiText({ system, user, maxTokens: 1800, timeoutMs: 35_000 });
  let normalized = normalizeThesisAnalysis(parseJsonFromText(text));
  if (!hasRequiredThesisFields(normalized)) {
    normalized = await repairThesisAnalysis(text, context);
  }
  if (!hasRequiredThesisFields(normalized)) {
    throw new Error(
      "thesis_schema_invalid: missing required fields evidenceFor, evidenceAgainst, confidence, or watchTriggers"
    );
  }
  return {
    ...normalized,
    source,
    updatedAt: new Date().toISOString()
  };
}

export async function aiThesisHandler(req, res) {
  if (req.method !== "POST") return jsonResp(res, 405, { error: "method_not_allowed" });
  const limited = enforceAiRateLimit(req, res);
  if (limited) return;

  try {
    const body = await readJsonBody(req);
    const analysis = await runThesisAnalyzer({
      symbol: body.symbol,
      thesisText: body.thesisText || body.thesis,
      direction: body.direction,
      policySignals: body.policySignals,
      contractSignals: body.contractSignals,
      lobbyingSignals: body.lobbyingSignals,
      horizonHint: body.horizonHint
    });
    return jsonResp(res, 200, analysis);
  } catch (err) {
    return jsonResp(res, 400, { error: err.message || "thesis_analysis_failed" });
  }
}

const BRIEF_SUMMARY_CACHE_DIR = join(DATA_DIR, "cache", "brief-summaries");
const briefSummaryMem = new Map();
const BRIEF_SUMMARY_TTL_MS = Number(process.env.BRIEF_SUMMARY_TTL_MS || 86_400_000);

function briefSummaryCacheKey(kind, payload) {
  if (kind === "bill") {
    const bill = payload.bill || {};
    return `bill:${payload.billId || bill.id}:${bill.latestActionDate || "none"}`;
  }
  if (kind === "stock") {
    const mapping = payload.mapping || {};
    const billIds = (mapping.relatedBills || []).slice(0, 3).map((b) => b.id).join(",");
    return `stock:${payload.symbol}:${billIds}:${mapping.contractProfile ? "c" : "n"}`;
  }
  const awards = payload.awards || [];
  const hashParts = awards
    .slice(0, 5)
    .map((a) => `${a.awardId || a.internalId || ""}:${a.obligatedAmount || 0}`)
    .join("|");
  return `contract:${payload.symbol}:${payload.awardCount || 0}:${hashParts}`;
}

async function readBriefSummaryCache(cacheKey) {
  const mem = briefSummaryMem.get(cacheKey);
  if (mem && Date.now() - mem.fetchedAt < BRIEF_SUMMARY_TTL_MS) return mem.text;
  try {
    const raw = await readFile(join(BRIEF_SUMMARY_CACHE_DIR, `${safeBriefCacheName(cacheKey)}.json`), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed?.text || !parsed.fetchedAt) return null;
    if (Date.now() - new Date(parsed.fetchedAt).getTime() > BRIEF_SUMMARY_TTL_MS) return null;
    briefSummaryMem.set(cacheKey, { text: parsed.text, fetchedAt: Date.now() });
    return parsed.text;
  } catch {
    return null;
  }
}

async function writeBriefSummaryCache(cacheKey, text) {
  briefSummaryMem.set(cacheKey, { text, fetchedAt: Date.now() });
  try {
    await mkdir(BRIEF_SUMMARY_CACHE_DIR, { recursive: true });
    await writeFile(
      join(BRIEF_SUMMARY_CACHE_DIR, `${safeBriefCacheName(cacheKey)}.json`),
      JSON.stringify({ fetchedAt: new Date().toISOString(), text }),
      "utf8"
    );
  } catch {
    /* disk cache optional */
  }
}

function safeBriefCacheName(key) {
  return String(key).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

/** Cached plain-English share-page summary — Haiku only, no call unless cache miss. */
export async function runShareBriefSummary({ kind, payload, rateLimitKey, checkRateLimit }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const cacheKey = briefSummaryCacheKey(kind, payload);
  const cached = await readBriefSummaryCache(cacheKey);
  if (cached) return { text: cached, cached: true, cacheKey };

  if (typeof checkRateLimit === "function" && rateLimitKey) {
    const rateCheck = checkRateLimit(rateLimitKey);
    if (!rateCheck.allowed) return null;
  }

  let user = "";
  if (kind === "bill") {
    const bill = payload.bill || {};
    user = [
      `Bill: ${bill.displayId || payload.billId}`,
      `Title: ${bill.title || bill.shortTitle || ""}`,
      `Status: ${bill.status || ""}`,
      `Latest action (${bill.latestActionDate || "n/a"}): ${bill.latestAction || ""}`,
      `Sponsor: ${bill.sponsor?.name || ""} (${bill.sponsor?.party || ""}-${bill.sponsor?.state || ""})`,
      `Affected tickers: ${(bill.affected || []).join(", ") || "none mapped"}`,
      `Momentum: ${payload.breakdown?.legislativeMomentum?.score ?? "n/a"}/100`,
      `Signal: ${bill.signal || bill.plainEnglish || ""}`
    ].join("\n");
  } else if (kind === "stock") {
    const mapping = payload.mapping || {};
    user = [
      `Symbol: ${payload.symbol}`,
      `Company: ${payload.company?.name || payload.symbol}`,
      `Sector: ${payload.company?.sector || payload.fundamentals?.sector || "unknown"}`,
      `Related bills: ${(mapping.relatedBills || []).map((b) => b.displayId || b.id).join(", ") || "none"}`,
      `Contract profile: ${mapping.contractProfile ? JSON.stringify(mapping.contractProfile) : "none"}`,
      `Lobbying filings: ${(mapping.lobbyingFilings || []).map((f) => f.client).join(", ") || "none"}`,
      `Quote: ${payload.quote?.price ?? "n/a"} (${payload.quote?.pct ?? payload.quote?.changePercent ?? "n/a"}%)`,
      `Rules summary: ${payload.analysis?.plainEnglish || ""}`
    ].join("\n");
  } else {
    const c = payload.causality || {};
    user = [
      `Symbol: ${payload.symbol}`,
      `Company: ${payload.company}`,
      `Awards loaded: ${payload.awardCount || 0}`,
      `Total obligated: ${payload.totalObligated || 0}`,
      `Archetype: ${c.archetype || "generic USASpending"}`,
      `Plain English: ${c.plainEnglish || ""}`,
      `Top award agencies: ${(payload.awards || []).slice(0, 3).map((a) => a.awardingAgency).filter(Boolean).join(", ")}`
    ].join("\n");
  }

  const system = `You write 2-3 sentence plain-English brief summaries for TradeSimple share pages.
Use only the facts provided. No buy/sell language. ${AI_RESEARCH_DISCLAIMER}`;
  const text = await fetchAnthropic({
    system,
    user: `Summarize this ${kind} brief for a curious retail investor:\n\n${user}`,
    maxTokens: 220,
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001"
  });
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  await writeBriefSummaryCache(cacheKey, trimmed);
  return { text: trimmed, cached: false, cacheKey };
}

const BILL_EXPOSURE_CACHE_DIR = join(DATA_DIR, "cache", "bill-exposure");
const billExposureMem = new Map();

function billExposureCacheKey(billId, latestActionDate) {
  return `exposure:bill:${billId}:${latestActionDate || "none"}`;
}

async function readBillExposureCache(cacheKey) {
  const mem = billExposureMem.get(cacheKey);
  if (mem && Date.now() - mem.fetchedAt < BRIEF_SUMMARY_TTL_MS) return mem.payload;
  try {
    const raw = await readFile(join(BILL_EXPOSURE_CACHE_DIR, `${safeBriefCacheName(cacheKey)}.json`), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed?.payload || !parsed.fetchedAt) return null;
    if (Date.now() - new Date(parsed.fetchedAt).getTime() > BRIEF_SUMMARY_TTL_MS) return null;
    billExposureMem.set(cacheKey, { payload: parsed.payload, fetchedAt: Date.now() });
    return parsed.payload;
  } catch {
    return null;
  }
}

async function writeBillExposureCache(cacheKey, payload) {
  billExposureMem.set(cacheKey, { payload, fetchedAt: Date.now() });
  try {
    await mkdir(BILL_EXPOSURE_CACHE_DIR, { recursive: true });
    await writeFile(
      join(BILL_EXPOSURE_CACHE_DIR, `${safeBriefCacheName(cacheKey)}.json`),
      JSON.stringify({ fetchedAt: new Date().toISOString(), payload }),
      "utf8"
    );
  } catch {
    /* disk cache optional */
  }
}

const VALID_EXPOSURE_TICKER = /^[A-Z]{1,5}$/;

function normalizeAiExposurePayload(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const tickers = (Array.isArray(parsed.tickers) ? parsed.tickers : [])
    .map((t) => String(t || "").toUpperCase().trim())
    .filter((t) => VALID_EXPOSURE_TICKER.test(t));
  if (!tickers.length) return null;
  const bull = (Array.isArray(parsed.bull) ? parsed.bull : []).map((row) => ({
    symbol: String(row?.symbol || row?.ticker || "").toUpperCase(),
    range: String(row?.range || row?.impact || "").trim(),
    why: String(row?.why || row?.reason || "").trim()
  }));
  const bear = (Array.isArray(parsed.bear) ? parsed.bear : []).map((row) => ({
    symbol: String(row?.symbol || row?.ticker || "").toUpperCase(),
    range: String(row?.range || row?.impact || "").trim(),
    why: String(row?.why || row?.reason || "").trim()
  }));
  return {
    tickers: [...new Set(tickers)].slice(0, 6),
    bull,
    bear,
    plainEnglish: String(parsed.plainEnglish || parsed.summary || "").trim() || null
  };
}

/** Haiku ticker exposure for dynamic bills — cache miss only, 24h TTL. */
export async function inferBillMarketExposureAI({ bill, billId, rateLimitKey, checkRateLimit }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const id = billId || bill?.id || "";
  const cacheKey = billExposureCacheKey(id, bill?.latestActionDate);
  const cached = await readBillExposureCache(cacheKey);
  if (cached) return { ...cached, cached: true };

  if (typeof checkRateLimit === "function" && rateLimitKey) {
    const rateCheck = checkRateLimit(rateLimitKey);
    if (!rateCheck.allowed) return null;
  }

  const system = `You map US congressional bills to publicly traded US tickers for a research terminal.
Return ONLY valid JSON (no markdown):
{
  "tickers": ["AAPL"],
  "bull": [{"symbol":"AAPL","range":"+5 to +10%","why":"plain English mechanism if bill passes"}],
  "bear": [{"symbol":"AAPL","range":"-3 to -8%","why":"plain English mechanism if bill stalls"}],
  "plainEnglish": "1-2 sentences, no buy/sell language"
}
Rules:
- tickers must be 1-5 uppercase letters only
- Use conservative illustrative ranges, not fake precision
- Only include tickers with plausible policy linkage
- ${AI_RESEARCH_DISCLAIMER}`;

  const user = [
    `Bill: ${bill?.displayId || id}`,
    `Title: ${bill?.title || bill?.shortTitle || ""}`,
    `Summary: ${bill?.summary || bill?.plainEnglish || ""}`,
    `Policy area: ${bill?.policyArea || "n/a"}`,
    `Latest action: ${bill?.latestAction || ""}`,
    `Committees: ${(bill?._committeeNames || []).join("; ") || "n/a"}`,
    `Status: ${bill?.status || ""}`
  ].join("\n");

  const text = await fetchAnthropic({
    system,
    user: `Infer market exposure for this bill:\n\n${user}`,
    maxTokens: 480,
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001"
  });
  const normalized = normalizeAiExposurePayload(parseJsonFromText(text));
  if (!normalized) return null;
  await writeBillExposureCache(cacheKey, normalized);
  return { ...normalized, cached: false };
}
