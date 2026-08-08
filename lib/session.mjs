// Session, cookie, and CSRF machinery — tightly coupled to AUTH_SECRET and
// the session/CSRF cookie names, but needed by nearly every auth-gated route
// across every domain, so it lives here rather than inside routes/auth.mjs
// (which owns login/signup/OAuth, not the primitives every other domain
// needs just to read the current session). Extracted from server.mjs
// (Phase 1 domain split) — logic is unchanged, only the location moved.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requestIsHttps } from "./http.mjs";

export const SESSION_COOKIE = "ts_session";
export const CSRF_COOKIE = "ts_csrf";
export const OAUTH_COOKIE = "ts_oauth";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export const INSECURE_AUTH_SECRETS = new Set([
  "",
  "dev-only-secret-change-before-deploying",
  "replace-with-a-long-random-string",
  "changeme",
  "secret"
]);

export const AUTH_SECRET = String(process.env.AUTH_SECRET || "").trim()
  || "dev-only-secret-change-before-deploying";

export function authSecretIsInsecure() {
  return INSECURE_AUTH_SECRETS.has(AUTH_SECRET);
}

export function unixNow() {
  return Math.floor(Date.now() / 1000);
}

export function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function hmac(value) {
  return createHmac("sha256", AUTH_SECRET).update(value).digest("base64url");
}

export function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signObject(value) {
  const payload = b64url(Buffer.from(JSON.stringify(value)));
  const sig = hmac(payload);
  return `${payload}.${sig}`;
}

export function verifyObject(value) {
  if (!value || !value.includes(".")) return null;
  const [payload, sig] = value.split(".");
  if (!safeEqual(hmac(payload), sig)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function parseCookies(req) {
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

export function cookieAttrs(maxAge, req) {
  const secure = requestIsHttps(req) ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function csrfCookieAttrs(maxAge, req) {
  const secure = requestIsHttps(req) ? "; Secure" : "";
  return `Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function newCsrfToken() {
  return b64url(randomBytes(24));
}

export function ensureCsrfCookie(res, req, maxAge = SESSION_TTL_SECONDS) {
  const token = newCsrfToken();
  res.setHeader("set-cookie", `${CSRF_COOKIE}=${token}; ${csrfCookieAttrs(maxAge, req)}`);
  return token;
}

export function requiresCsrf(req) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  return true;
}

export function validateCsrf(req) {
  const cookies = parseCookies(req);
  const cookieToken = String(cookies[CSRF_COOKIE] || "");
  const headerToken = String(req.headers["x-csrf-token"] || "");
  if (!cookieToken || !headerToken) return false;
  return safeEqual(cookieToken, headerToken);
}

export function createSession(user) {
  return signObject({ user, exp: unixNow() + SESSION_TTL_SECONDS });
}

export function getSession(req) {
  const cookies = parseCookies(req);
  const session = verifyObject(cookies[SESSION_COOKIE]);
  if (!session || session.exp < unixNow()) return null;
  return session;
}

export function setSessionCookie(res, user, req) {
  res.setHeader("set-cookie", [
    `${SESSION_COOKIE}=${createSession(user)}; ${cookieAttrs(SESSION_TTL_SECONDS, req)}`,
    `${CSRF_COOKIE}=${newCsrfToken()}; ${csrfCookieAttrs(SESSION_TTL_SECONDS, req)}`
  ]);
}

export function clearAuthCookies(res, req) {
  res.setHeader("set-cookie", [
    `${SESSION_COOKIE}=; ${cookieAttrs(0, req)}`,
    `${CSRF_COOKIE}=; ${csrfCookieAttrs(0, req)}`
  ]);
}
