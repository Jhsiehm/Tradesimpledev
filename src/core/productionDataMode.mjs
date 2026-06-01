import { getFeedState } from "./dataRefreshState.mjs";

const REQUIRED_KEYS = [
  { key: "CONGRESS_API_KEY", label: "Congress.gov live bill status" },
  { key: "FINNHUB_API_KEY", label: "Live equity quotes" },
  { key: "SENATE_LDA_API_KEY", label: "Senate LDA lobbying filings" }
];

const RECOMMENDED_KEYS = [
  { key: "SEC_USER_AGENT", label: "SEC EDGAR fair-access contact", invalidIf: (v) => !v || String(v).includes("you@example.com") }
];

export function isStrictDataMode(env = process.env) {
  const flag = String(env.DATA_ACCURACY_MODE || "").trim().toLowerCase();
  if (flag === "production" || flag === "strict" || flag === "live") return true;
  if (flag === "demo" || flag === "development" || flag === "off") return false;
  return String(env.NODE_ENV || "").trim().toLowerCase() === "production";
}

export function productionReadiness(env = process.env, feeds = getFeedState()) {
  const missing = [];
  const invalid = [];

  for (const { key, label } of REQUIRED_KEYS) {
    if (!env[key]) missing.push({ key, label });
  }
  for (const { key, label, invalidIf } of RECOMMENDED_KEYS) {
    if (invalidIf?.(env[key])) invalid.push({ key, label });
  }

  const feedIssues = [];
  if (feeds.bills?.status === "fallback" || (feeds.bills?.fallback && feeds.bills?.status !== "unknown")) {
    feedIssues.push("bills_feed_fallback");
  }
  if (feeds.market?.status === "fallback" || (feeds.market?.fallback && feeds.market?.status !== "unknown")) {
    feedIssues.push("market_feed_fallback");
  }
  if (feeds.lobbying?.status === "fallback" || (feeds.lobbying?.fallback && feeds.lobbying?.status !== "unknown")) {
    feedIssues.push("lobbying_feed_fallback");
  }

  const ready = missing.length === 0 && (!isStrictDataMode(env) || feedIssues.length === 0);

  return {
    strict: isStrictDataMode(env),
    ready,
    missing,
    invalid,
    feedIssues,
    message: missing.length
      ? `Missing required keys: ${missing.map((m) => m.key).join(", ")}`
      : feedIssues.length && isStrictDataMode(env)
        ? `Feeds in fallback: ${feedIssues.join(", ")}`
        : "Production data requirements satisfied."
  };
}
