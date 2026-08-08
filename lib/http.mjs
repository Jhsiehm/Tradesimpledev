// Shared HTTP request/response plumbing used across every route domain:
// response senders, static-file serving, feature gates, rate limiting, and
// the generic IP/proxy helpers. Extracted from server.mjs (Phase 1 domain
// split) — logic is unchanged from the original, only the location moved.
import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// lib/ sits directly under the project root, so ROOT is one level up from
// this file's own directory — NOT dirname(import.meta.url) itself, which
// would resolve to lib/ and break every PUBLIC_DIR/DATA_DIR-relative path.
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_DIR = join(ROOT, "public");
export const DATA_DIR = join(ROOT, "data");

export const PORT = Number(process.env.PORT || 3000);

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

export const APP_URL = resolveAppUrl();

// Shared by requestIsHttps() and clientIp(): only trust proxy-supplied
// X-Forwarded-* headers when we know a real proxy (Railway, or an explicit
// opt-in) sits in front of us. Otherwise a client could set these headers
// directly and spoof its own IP or the request's apparent scheme.
export function isTrustedProxy() {
  return (
    process.env.TRUST_PROXY === "true" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN)
  );
}

export function requestIsHttps(req) {
  if (isTrustedProxy()) {
    const proto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    if (proto === "https") return true;
  }
  return APP_URL.startsWith("https://");
}

// Consolidated from two near-duplicate implementations that lived in
// server.mjs (clientIp/requestIp) — same trusted-header precedence
// (cf-connecting-ip, x-real-ip, x-forwarded-for) now used everywhere.
export function clientIp(req) {
  if (isTrustedProxy()) {
    const raw =
      req.headers["cf-connecting-ip"] ||
      req.headers["x-real-ip"] ||
      req.headers["x-forwarded-for"];
    if (raw) return String(Array.isArray(raw) ? raw[0] : raw).split(",")[0].trim();
  }
  return String(req.socket?.remoteAddress || "unknown");
}

export const BASE_SECURITY_HEADERS = {
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

export function responseHeaders(headers = {}) {
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

export function sendJson(res, status, body) {
  res.writeHead(status, responseHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }));
  res.end(JSON.stringify(body));
}

export function sendHtml(res, status, html, { head = false } = {}) {
  res.writeHead(status, responseHeaders({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  }));
  if (head) return res.end();
  res.end(html);
}

export function sendText(res, status, text) {
  res.writeHead(status, responseHeaders({ "content-type": "text/plain; charset=utf-8" }));
  res.end(text);
}

export function redirect(res, location) {
  res.writeHead(302, responseHeaders({ location }));
  res.end();
}

export function contentType(filePath) {
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

export async function sendStatic(res, relativePath, req = null) {
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

export async function sendImportsStatic(res, pathname) {
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

export function escapeHtmlText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ── Feature gates — launch phase control ────────────────────────────────────
export const FEATURE_GATES = {
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

export function featureEnabled(featureName) {
  return Boolean(FEATURE_GATES[featureName]);
}

export function checkFeature(featureName, res) {
  if (!featureEnabled(featureName)) {
    sendJson(res, 403, {
      error: "feature_not_available",
      message: "This feature is not yet available in the beta."
    });
    return false;
  }
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

export function checkFeaturePage(featureName, res, label, { head = false } = {}) {
  if (featureEnabled(featureName)) return true;
  sendHtml(res, 403, featureComingSoonPage(label), { head });
  return false;
}

// ── Rate limiting ────────────────────────────────────────────────────────────
// Windowed per-IP limiter mechanism, shared by every domain's rate limiter.
// Each domain owns its own bucket Map + max/window constants; only this
// mechanism is shared (consolidated here from several near-identical
// hand-rolled copies that used to live throughout server.mjs).
export function checkIpWindowLimit(bucket, req, { max, windowMs }) {
  const now = Date.now();
  const ip = clientIp(req);
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

// General per-IP backstop across the whole /api/ surface — applied before
// any route-specific handling. Endpoints with their own tighter limiter
// (auth, share) are still bound by it too; this is just an outer ceiling.
const apiRateLimit = new Map();
const API_RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX || 300);
const API_RATE_LIMIT_WINDOW_MS = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000);

export function apiRateLimitGuard(req, res) {
  const apiLimit = checkIpWindowLimit(apiRateLimit, req, {
    max: API_RATE_LIMIT_MAX,
    windowMs: API_RATE_LIMIT_WINDOW_MS
  });
  if (apiLimit.ok) return false;
  res.writeHead(429, responseHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "retry-after": String(apiLimit.retryAfterSeconds)
  }));
  res.end(JSON.stringify({ error: "rate_limited", message: "Too many requests. Please slow down." }));
  return true;
}

// ── Body parsing / outbound fetch helpers ───────────────────────────────────
const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 65_536);

export async function readJson(req) {
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

export async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function safeText(response) {
  return (await response.text()).slice(0, 1000);
}
