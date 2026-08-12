/**
 * Canonical ticker ↔ name-alias crosswalk. Single source of truth —
 * do not add ticker/name mappings anywhere else in the codebase.
 *
 * aliases: lowercase name fragments matched as whole words/phrases
 * (see matchesAlias() — NOT raw substring). Include the legal name,
 * common short name, and known subsidiary/brand names actually seen
 * in LDA or USASpending filings. Do not include tickers of other
 * asset classes (crypto, funds) here — this table is equities only.
 */
export const COMPANY_ALIASES = {
  LLY: { name: "Eli Lilly and Company", aliases: ["eli lilly", "lilly"] },
  MRK: { name: "Merck & Co.", aliases: ["merck"] },
  PFE: { name: "Pfizer Inc.", aliases: ["pfizer"] },
  ABBV: { name: "AbbVie Inc.", aliases: ["abbvie"] },
  UNH: { name: "UnitedHealth Group", aliases: ["unitedhealth", "unitedhealth group"] },
  CVS: { name: "CVS Health", aliases: ["cvs health", "cvs"] },
  NVDA: { name: "NVIDIA Corporation", aliases: ["nvidia"] },
  INTC: { name: "Intel Corporation", aliases: ["intel corporation", "intel corp", "intel"] },
  TSM: { name: "Taiwan Semiconductor", aliases: ["taiwan semiconductor", "tsmc"] },
  AMAT: { name: "Applied Materials", aliases: ["applied materials"] },
  ASML: { name: "ASML Holding", aliases: ["asml"] },
  AMZN: { name: "Amazon.com", aliases: ["amazon.com", "amazon"] },
  AAPL: { name: "Apple Inc.", aliases: ["apple inc", "apple"] },
  GOOGL: { name: "Alphabet Inc.", aliases: ["alphabet inc", "google llc", "google"] },
  META: { name: "Meta Platforms", aliases: ["meta platforms", "facebook inc"] },
  COIN: { name: "Coinbase Global", aliases: ["coinbase"] },
  TSLA: { name: "Tesla, Inc.", aliases: ["tesla inc", "tesla motors", "tesla"] },
  ENPH: { name: "Enphase Energy", aliases: ["enphase"] },
  FSLR: { name: "First Solar", aliases: ["first solar"] },
  MSFT: { name: "Microsoft Corporation", aliases: ["microsoft corporation", "microsoft corp", "microsoft"] },
  GEO: { name: "The GEO Group", aliases: ["geo group", "the geo group"] },
  CXW: {
    name: "CoreCivic",
    aliases: ["corecivic", "core civic", "corrections corporation"]
  },
  PLTR: { name: "Palantir Technologies", aliases: ["palantir"] },
  BAH: { name: "Booz Allen Hamilton", aliases: ["booz allen hamilton", "booz allen"] },
  LMT: { name: "Lockheed Martin", aliases: ["lockheed martin", "lockheed"] },
  SPCX: {
    name: "Space Exploration Technologies Corp.",
    aliases: ["spacex", "space exploration technologies corp", "space exploration technologies"]
  },
  LDOS: { name: "Leidos", aliases: ["leidos"] },
  SAIC: {
    name: "Science Applications International",
    aliases: ["saic", "science applications international"]
  },
  NOC: { name: "Northrop Grumman", aliases: ["northrop grumman"] },
  GD: { name: "General Dynamics", aliases: ["general dynamics"] },
  HII: { name: "Huntington Ingalls", aliases: ["huntington ingalls"] },
  LHX: { name: "L3Harris Technologies", aliases: ["l3harris"] },
  BA: { name: "Boeing", aliases: ["the boeing company", "boeing"] },
  RTX: { name: "RTX Corporation", aliases: ["rtx corporation", "raytheon"] }
};

export const SECTOR_GROUP_ALIASES = {
  phrma: { name: "PhRMA (trade association)", tickers: ["LLY", "MRK", "PFE", "ABBV"] }
};

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAliasIndex() {
  const entries = [];
  for (const [ticker, def] of Object.entries(COMPANY_ALIASES)) {
    for (const alias of def.aliases || []) {
      entries.push({
        ticker,
        alias,
        re: new RegExp(`\\b${escapeRegex(alias)}\\b`, "i")
      });
    }
  }
  return entries.sort((a, b) => b.alias.length - a.alias.length);
}

const aliasIndex = buildAliasIndex();
const associationAliasIndex = Object.entries(SECTOR_GROUP_ALIASES)
  .map(([alias, def]) => ({
    alias,
    tickers: [...new Set((def.tickers || []).map((ticker) => String(ticker || "").toUpperCase()))],
    re: new RegExp(`\\b${escapeRegex(alias)}\\b`, "i")
  }))
  .sort((a, b) => b.alias.length - a.alias.length);

/** Returns the ticker for a raw entity-name string, or null. */
export function resolveTickerForName(rawName) {
  const hay = String(rawName || "");
  if (!hay) return null;
  for (const entry of aliasIndex) {
    if (entry.re.test(hay)) return entry.ticker;
  }
  return null;
}

/** Returns ALL company tickers matched in a longer haystack. */
export function resolveTickersInText(text) {
  const hay = String(text || "");
  if (!hay) return [];
  const found = new Set();
  for (const entry of aliasIndex) {
    if (entry.re.test(hay)) found.add(entry.ticker);
  }
  return [...found];
}

/** Returns ALL sector-group tickers matched in text (e.g. "phrma"). */
export function resolveSectorGroupTickersInText(text) {
  const hay = String(text || "");
  if (!hay) return [];
  const found = new Set();
  for (const entry of associationAliasIndex) {
    if (entry.re.test(hay)) {
      for (const ticker of entry.tickers) found.add(ticker);
    }
  }
  return [...found];
}

export function displayNameForTicker(ticker) {
  return COMPANY_ALIASES[String(ticker || "").toUpperCase()]?.name || null;
}
