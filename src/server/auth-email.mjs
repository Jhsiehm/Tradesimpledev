import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Injected at boot from server.mjs via registerAuthEmail(deps). */
let deps = {};

export function registerAuthEmail(next = {}) {
  deps = { ...deps, ...next };
}

// ── Email / password accounts ────────────────────────────────────────────────
const ACCOUNTS_FILE = () => join(deps.DATA_DIR, "accounts.json");
const authAttempts = new Map();

function authRateLimitOk(req) {
  const ip = deps.clientIp(req);
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (!entry || now - entry.start > deps.AUTH_RATE_LIMIT_WINDOW_MS) {
    authAttempts.set(ip, { start: now, n: 1 });
    return true;
  }
  if (entry.n >= deps.AUTH_RATE_LIMIT_MAX) return false;
  entry.n += 1;
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - deps.AUTH_RATE_LIMIT_WINDOW_MS * 2;
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
  } catch {
    return false;
  }
}

async function readAccountsStore() {
  try {
    return JSON.parse(await readFile(ACCOUNTS_FILE(), "utf8"));
  } catch {
    return {};
  }
}

async function findAccountByEmail(email) {
  const e = String(email).toLowerCase();
  let remote = null;
  if (deps.dbReady) {
    const rows = await deps.dbSelect(
      "profiles",
      `email=eq.${encodeURIComponent(e)}&provider=eq.email&select=id,email,name,password_hash`
    );
    remote = rows && rows.length ? rows[0] : null;
  }
  const local = (await readAccountsStore())[e] || null;
  return remote || local;
}

async function writeLocalAccountRecord(acct) {
  await deps.withFileLock(ACCOUNTS_FILE(), async () => {
    const store = await readAccountsStore();
    store[acct.email] = acct;
    await mkdir(deps.DATA_DIR, { recursive: true });
    await writeFile(ACCOUNTS_FILE(), JSON.stringify(store, null, 2), "utf8");
  });
}

async function createAccountRecord(acct) {
  if (deps.dbReady) {
    const row = await deps.dbInsert("profiles", {
      id: acct.id,
      email: acct.email,
      name: acct.name,
      provider: "email",
      password_hash: acct.password_hash,
      picture: "",
      updated_at: new Date().toISOString()
    });
    if (row) return;
    console.warn("[auth] Supabase profile insert failed — saving account locally");
  }
  await writeLocalAccountRecord(acct);
}

async function authSignup(req, res) {
  if (!authRateLimitOk(req)) {
    return deps.sendJson(res, 429, {
      error: "rate_limited",
      message: "Too many attempts. Wait 15 minutes and try again."
    });
  }
  const body = await deps.readJson(req);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim().slice(0, 120) || email.split("@")[0];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return deps.sendJson(res, 400, { error: "invalid_email", message: "Enter a valid email address." });
  }
  if (password.length < 8 || password.length > 128) {
    return deps.sendJson(res, 400, { error: "weak_password", message: "Password must be 8–128 characters." });
  }
  if (await findAccountByEmail(email)) {
    return deps.sendJson(res, 409, {
      error: "email_taken",
      message: "An account with this email already exists — try logging in."
    });
  }
  const user = { id: `usr_${randomBytes(8).toString("hex")}`, name, email, picture: "", provider: "email" };
  try {
    await createAccountRecord({ id: user.id, email, name, password_hash: hashPassword(password) });
  } catch {
    return deps.sendJson(res, 500, { error: "signup_failed", message: "Could not create the account. Please try again." });
  }
  deps.setSessionCookie(res, user, req);
  const onboarding = deps.getOnboardingBillMeta();
  return deps.sendJson(res, 200, {
    ok: true,
    user: { id: user.id, name, email },
    onboardingBillId: onboarding.billId,
    onboardingBillTitle: onboarding.title
  });
}

async function authLogin(req, res) {
  if (!authRateLimitOk(req)) {
    return deps.sendJson(res, 429, {
      error: "rate_limited",
      message: "Too many attempts. Wait 15 minutes and try again."
    });
  }
  const body = await deps.readJson(req);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const acct = await findAccountByEmail(email);
  const hash = acct?.password_hash || "";
  const ok = hash && verifyPassword(password, hash);
  if (!acct || !ok) {
    return deps.sendJson(res, 401, { error: "invalid_credentials", message: "Invalid email or password." });
  }
  const user = {
    id: acct.id,
    name: acct.name || email.split("@")[0],
    email,
    picture: "",
    provider: "email"
  };
  deps.upsertUserProfile(user).catch(() => {});
  deps.setSessionCookie(res, user, req);
  const onboarding = deps.getOnboardingBillMeta();
  return deps.sendJson(res, 200, {
    ok: true,
    user: { id: user.id, name: user.name, email },
    onboardingBillId: onboarding.billId,
    onboardingBillTitle: onboarding.title
  });
}

function authLogoutApi(res, req) {
  deps.clearAuthCookies(res, req);
  return deps.sendJson(res, 200, { ok: true });
}

export { authSignup, authLogin, authLogoutApi };
