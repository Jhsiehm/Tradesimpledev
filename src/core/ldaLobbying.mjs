/**
 * Map Senate LDA filings to policy bills by issue keywords and client names.
 */

const TICKER_CLIENT_HINTS = {
  LLY: ["lilly", "eli lilly"],
  MRK: ["merck"],
  PFE: ["pfizer"],
  ABBV: ["abbvie"],
  UNH: ["unitedhealth"],
  CVS: ["cvs"],
  NVDA: ["nvidia"],
  INTC: ["intel"],
  TSM: ["taiwan semiconductor", "tsmc"],
  AMAT: ["applied materials"],
  ASML: ["asml"],
  AMZN: ["amazon"],
  AAPL: ["apple"],
  GOOGL: ["google", "alphabet"],
  META: ["meta platforms", "facebook"],
  COIN: ["coinbase"],
  BTC: ["bitcoin", "blockchain"],
  ETH: ["ethereum"],
  TSLA: ["tesla"],
  ENPH: ["enphase"],
  FSLR: ["first solar"],
  MSFT: ["microsoft"],
  GEO: ["geo group", "the geo group"],
  CXW: ["corecivic", "core civic", "corrections corporation"],
  PLTR: ["palantir"],
  BAH: ["booz allen", "booz allen hamilton"],
  LMT: ["lockheed martin", "lockheed"],
  SPCX: ["spacex", "space exploration technologies", "space exploration technologies corp"]
};

const HOMELAND_ISSUE_KEYWORDS = [
  "immigration",
  "detention",
  "homeland",
  "enforcement",
  "border",
  "customs",
  "deportation",
  "asylum",
  "refugee"
];

function normalizeHaystack(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function filingHaystack(filing) {
  return normalizeHaystack(
    [filing.client, filing.registrant, filing.issue, ...(filing.issues || [])].join(" ")
  );
}

function billCorpus(bill) {
  return normalizeHaystack(
    [
      bill.title,
      bill.shortTitle,
      bill.plainEnglish,
      bill.signal,
      ...(bill.tags || []),
      ...(bill.ldaKeywords || []),
      ...(bill.affected || [])
    ].join(" ")
  );
}

function isHomelandBill(bill) {
  const corpus = billCorpus(bill);
  if (
    /\b(homeland|immigration|detention|border patrol|customs and border|\bdhs\b|\bice\b|enforcement|secure america)\b/.test(
      corpus
    )
  ) {
    return true;
  }
  return (bill.affected || []).some((t) => ["GEO", "CXW", "PLTR", "BAH"].includes(String(t || "").toUpperCase()));
}

function billKeywordSet(bill) {
  const words = new Set();
  const pushTokens = (text) => {
    for (const token of normalizeHaystack(text).split(" ")) {
      if (token.length > 2) words.add(token);
    }
  };
  pushTokens(bill.title);
  pushTokens(bill.shortTitle);
  pushTokens(bill.plainEnglish);
  pushTokens(bill.signal);
  for (const tag of bill.tags || []) pushTokens(tag);
  for (const kw of bill.ldaKeywords || []) pushTokens(kw);
  for (const ticker of bill.affected || []) {
    for (const hint of TICKER_CLIENT_HINTS[ticker] || [ticker.toLowerCase()]) {
      pushTokens(hint);
    }
  }
  if (isHomelandBill(bill)) {
    for (const kw of HOMELAND_ISSUE_KEYWORDS) words.add(kw);
  }
  return words;
}

function clientMatchesBillTickers(filing, bill) {
  const hay = filingHaystack(filing);
  if (!hay) return false;
  for (const ticker of bill.affected || []) {
    for (const hint of TICKER_CLIENT_HINTS[ticker] || []) {
      if (hint.length >= 3 && hay.includes(hint)) return true;
    }
  }
  return false;
}

function filingHasHomelandIssue(filing) {
  const hay = filingHaystack(filing);
  return HOMELAND_ISSUE_KEYWORDS.some((kw) => hay.includes(kw));
}

function filingMatchesBill(filing, bill) {
  const hay = filingHaystack(filing);
  if (!hay) return false;

  if (clientMatchesBillTickers(filing, bill)) return true;

  const keywords = billKeywordSet(bill);
  let hits = 0;
  for (const kw of keywords) {
    if (kw.length < 4) continue;
    if (hay.includes(kw)) hits += 1;
  }

  if (hits >= 2) return true;

  if (isHomelandBill(bill) && filingHasHomelandIssue(filing) && hits >= 1) return true;

  return false;
}

function lobbyingFilingId(base) {
  const raw = [base.client, base.registrant, base.postedAt, base.amount, base.issue, base.source]
    .map((v) => String(v || "").trim().toLowerCase())
    .join("|");
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  return `lf_${Math.abs(hash).toString(36)}`;
}

function inferStance(filing, bill) {
  const hay = filingHaystack(filing);
  const againstWords = ["oppose", "against", "restrict", "limit", "ban", "antitrust", "negotiat"];
  const forWords = ["support", "favor", "implement", "fund", "clarity", "permit", "grant"];
  let against = 0;
  let fo = 0;
  for (const w of againstWords) if (hay.includes(w)) against += 1;
  for (const w of forWords) if (hay.includes(w)) fo += 1;
  if (against > fo) return "against";
  if (fo > against) return "for";
  return "neutral";
}

export function aggregateLobbyingForBills(bills, filings) {
  const overlays = new Map();
  for (const bill of bills) {
    const matched = (filings || []).filter((f) => filingMatchesBill(f, bill));
    if (!matched.length) {
      overlays.set(bill.id, {
        lobbyingAgainst: null,
        lobbyingFor: null,
        lobbyingSource: null,
        lobbyingFilingsCount: 0,
        lobbyingPostedAt: null,
        lobbyingRows: []
      });
      continue;
    }

    let againstTotal = 0;
    let forTotal = 0;
    const rows = [];
    let latestPosted = null;
    for (const filing of matched.slice(0, 12)) {
      const amount = Number(filing.amount || filing.expenses || 0);
      const stance = filing.stance || inferStance(filing, bill);
      if (stance === "against") againstTotal += amount;
      else if (stance === "for") forTotal += amount;
      if (filing.postedAt && (!latestPosted || filing.postedAt > latestPosted)) {
        latestPosted = filing.postedAt;
      }
      rows.push({
        name: filing.client || filing.registrant || "Unknown client",
        filingId: filing.filingId || lobbyingFilingId(filing),
        stance,
        amount,
        issue: filing.issue || (filing.issues || []).slice(0, 2).join(", "),
        tickers: (bill.affected || []).slice(0, 4),
        relationship: `LDA filing${filing.postedAt ? ` (${String(filing.postedAt).slice(0, 10)})` : ""}`,
        source: "senate_lda"
      });
    }

    overlays.set(bill.id, {
      lobbyingAgainst: againstTotal > 0 ? Math.round((againstTotal / 1_000_000) * 10) / 10 : null,
      lobbyingFor: forTotal > 0 ? Math.round((forTotal / 1_000_000) * 10) / 10 : null,
      lobbyingSource: "senate_lda",
      lobbyingFilingsCount: matched.length,
      lobbyingPostedAt: latestPosted,
      lobbyingNote:
        matched.length > 0
          ? `${matched.length} LDA filing(s) matched this bill's issue keywords (live aggregate, not a forecast).`
          : null,
      lobbyingRows: rows
    });
  }
  return overlays;
}

export async function fetchLdaFilings({ apiKey, fetchFn = fetch, limit = 200 } = {}) {
  const headers = apiKey ? { Authorization: `Token ${apiKey}` } : {};
  const url = `https://lda.gov/api/v1/filings/?limit=${limit}&ordering=-dt_posted&format=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const resp = await fetchFn(url, { headers, signal: controller.signal });
  clearTimeout(timer);
  if (!resp.ok) throw new Error(`lda_${resp.status}`);
  const data = await resp.json();
  return (data.results || []).map((item) => {
    const client = item.client?.name || item.client_name || "Unknown client";
    const registrant = item.registrant?.name || item.registrant_name || "Unknown registrant";
    const postedAt = item.dt_posted || item.filing_period || null;
    const issue = Array.isArray(item.issues)
      ? item.issues.map((i) => i.name || i).join(", ")
      : item.issue || "";
    const base = {
      client,
      registrant,
      amount: Number(item.income || item.amount || item.expenses || 0),
      issue,
      issues: Array.isArray(item.issues) ? item.issues.map((i) => i.name || i) : [],
      postedAt,
      stance: null,
      source: "senate_lda"
    };
    return {
      ...base,
      filingId: item.uuid ? `lda_${item.uuid}` : lobbyingFilingId(base)
    };
  });
}
