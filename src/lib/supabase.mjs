/**
 * Supabase REST client — no SDK, just fetch().
 * Uses the service-role key (server-side only, never sent to browser).
 */

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isPlaceholder(value) {
  const v = String(value || "").trim();
  return !v || v.includes("YOUR_PROJECT_REF") || v.includes("your-service-role-key");
}

export const dbReady = Boolean(
  SUPABASE_URL &&
  SUPABASE_KEY &&
  !isPlaceholder(SUPABASE_URL) &&
  !isPlaceholder(SUPABASE_KEY)
);

function restUrl(table, params = "") {
  return `${SUPABASE_URL}/rest/v1/${table}${params ? `?${params}` : ""}`;
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** SELECT — returns array of rows, or null on error */
export async function dbSelect(table, params = "") {
  if (!dbReady) return null;
  const res = await fetch(restUrl(table, params), { headers: headers() });
  if (!res.ok) { console.error(`[db] SELECT ${table} error`, res.status, await res.text()); return null; }
  return res.json();
}

/** INSERT — upsert on conflict via Prefer header */
export async function dbUpsert(table, row, onConflict = "") {
  if (!dbReady) return null;
  const prefer = `return=representation${onConflict ? `,resolution=merge-duplicates` : ""}`;
  const url = onConflict ? restUrl(table, `on_conflict=${onConflict}`) : restUrl(table);
  const res = await fetch(url, {
    method: "POST",
    headers: headers({ Prefer: prefer }),
    body: JSON.stringify(row),
  });
  if (!res.ok) { console.error(`[db] UPSERT ${table} error`, res.status, await res.text()); return null; }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

/** PATCH — update rows matching params */
export async function dbPatch(table, params, update) {
  if (!dbReady) return null;
  const res = await fetch(restUrl(table, params), {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(update),
  });
  if (!res.ok) { console.error(`[db] PATCH ${table} error`, res.status, await res.text()); return null; }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

/** INSERT — single insert, no upsert */
export async function dbInsert(table, row) {
  if (!dbReady) return null;
  const res = await fetch(restUrl(table), {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) { console.error(`[db] INSERT ${table} error`, res.status, await res.text()); return null; }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

/** DELETE — rows matching PostgREST params. Returns deleted row count, or null on error. */
export async function dbDelete(table, params = "") {
  if (!dbReady) return null;
  const res = await fetch(restUrl(table, params), {
    method: "DELETE",
    headers: headers({ Prefer: "return=representation" }),
  });
  if (!res.ok) { console.error(`[db] DELETE ${table} error`, res.status, await res.text()); return null; }
  const data = await res.json();
  return Array.isArray(data) ? data.length : 0;
}

/** Fetch one portfolio row for a user, or null if missing / error */
export async function fetchPortfolioRow(userId) {
  if (!dbReady) return null;
  const rows = await dbSelect(
    "portfolios",
    `user_id=eq.${encodeURIComponent(userId)}&select=positions,cash,updated_at`
  );
  if (!rows?.length) return null;
  return rows[0];
}

/** Upsert portfolio row (cash + positions jsonb blob) keyed by user_id */
export async function savePortfolioRow(userId, { cash, positions }) {
  if (!dbReady) return null;
  return dbUpsert(
    "portfolios",
    {
      user_id: userId,
      cash,
      positions,
      updated_at: new Date().toISOString()
    },
    "user_id"
  );
}

/** Fetch watchlist symbols for a user, or null if missing / error */
export async function fetchWatchlistRow(userId) {
  if (!dbReady) return null;
  const rows = await dbSelect(
    "watchlists",
    `user_id=eq.${encodeURIComponent(userId)}&select=symbols,updated_at`
  );
  if (!rows?.length) return null;
  return rows[0];
}

/** Upsert watchlist symbols keyed by user_id */
export async function saveWatchlistRow(userId, symbols) {
  if (!dbReady) return null;
  return dbUpsert(
    "watchlists",
    {
      user_id: userId,
      symbols,
      updated_at: new Date().toISOString()
    },
    "user_id"
  );
}
