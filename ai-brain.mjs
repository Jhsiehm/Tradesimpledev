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

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      matches: [],
      reason: "api_error",
      source: "fallback_error",
      cached: false,
      updatedAt: Date.now(),
      error: "ANTHROPIC_API_KEY not configured"
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
    const text = await fetchAnthropic({ system, user, maxTokens: 900 });
    const rawClaudeResult = parseJsonFromText(text);
    const normalized = normalizeLobbyMapperResult(rawClaudeResult);
    if (normalized.reason === "matched" || normalized.reason === "no_match") {
      lobbyMap[filingId] = normalized;
      await saveLobbyMap();
    }
    return normalized;
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

  if (!process.env.ANTHROPIC_API_KEY) {
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
    const text = await fetchAnthropic({ system, user, maxTokens: 1100 });
    const parsed = parseJsonFromText(text);
    const result = {
      symbol: cleanSymbol,
      source: "anthropic",
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
    now: "AI narration is unavailable without ANTHROPIC_API_KEY, so TradeSimple is showing the structured policy, quote, and filing evidence directly.",
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      whereMoneyComesFrom: [],
      whatCouldHurtIt: [
        "SEC risk factors are available, but AI translation needs ANTHROPIC_API_KEY on the server."
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
    const text = await fetchAnthropic({ system, user, maxTokens: 1200 });
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

  if (!process.env.ANTHROPIC_API_KEY) {
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
    const text = await fetchAnthropic({ system, user, maxTokens: 700 });
    const parsed = parseJsonFromText(text);
    return {
      labels: Array.isArray(parsed.labels)
        ? parsed.labels.slice(0, 8).map((l) => ({
            at: String(l.at || ""),
            text: String(l.text || "")
          }))
        : [],
      source: "anthropic",
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

  const text = await fetchAnthropic({ system, user, maxTokens: 1600, timeoutMs: 45_000 });
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
