/* Shared client utilities — load before all other dashboard chunks */
async function fetchJson(url, init) {
  init = init || {};
  const method = String(init.method || "GET").toUpperCase();
  const headers = { ...(init.headers || {}) };
  if (method !== "GET" && method !== "HEAD") {
    const csrf = csrfTokenFromCookie();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  const response = await fetch(url, { ...init, headers, credentials: init.credentials || "same-origin" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }
  return response.json();
}

function csrfTokenFromCookie() {
  const match = document.cookie.match(/(?:^|;\s*)ts_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function setDisabled(link, title) {
  link.setAttribute("aria-disabled", "true");
  link.href = "#";
  link.title = title;
}

function sourceLabel(source) {
  const s = String(source || "unknown");
  if (s === "fec") return "Live FEC";
  if (s === "sample") return "Sample FEC";
  return s.replaceAll("_", " ");
}

function money(value) {
  const number = Number(value || 0);
  return number.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: number >= 1000 ? 0 : 2 });
}

function compactMoney(value) {
  const number = Number(value || 0);
  if (number >= 1e12) return `$${fmt(number / 1e12)}T`;
  if (number >= 1e9) return `$${fmt(number / 1e9)}B`;
  if (number >= 1e6) return `$${fmt(number / 1e6)}M`;
  return money(number);
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1e9) return `${fmt(number / 1e9)}B`;
  if (number >= 1e6) return `${fmt(number / 1e6)}M`;
  if (number >= 1e3) return `${fmt(number / 1e3)}K`;
  return fmt(number);
}

function fmt(value) {
  return Number(value || 0).toFixed(2);
}

function signed(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? "+" : ""}${fmt(number)}`;
}

function initials(value) {
  return String(value)
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TS";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function $(selector) {
  return document.querySelector(selector);
}
