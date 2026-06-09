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
  MSFT: ["microsoft"]
};

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
  return words;
}

function filingMatchesBill(filing, bill) {
  const hay = filingHaystack(filing);
  if (!hay) return false;
  const keywords = billKeywordSet(bill);
  let hits = 0;
  for (const kw of keywords) {
    if (kw.length < 4) continue;
    if (hay.includes(kw)) hits += 1;
  }
  return hits >= 2;
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
        lobbyingRows: []
      });
      continue;
    }

    let againstTotal = 0;
    let forTotal = 0;
    const rows = [];
    for (const filing of matched.slice(0, 12)) {
      const amount = Number(filing.amount || filing.expenses || 0);
      const stance = filing.stance || inferStance(filing, bill);
      if (stance === "against") againstTotal += amount;
      else if (stance === "for") forTotal += amount;
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
  return (data.results || []).map((item) => ({
    client: item.client?.name || item.client_name || "Unknown client",
    registrant: item.registrant?.name || item.registrant_name || "Unknown registrant",
    amount: Number(item.income || item.amount || item.expenses || 0),
    issue: Array.isArray(item.issues)
      ? item.issues.map((i) => i.name || i).join(", ")
      : item.issue || "",
    issues: Array.isArray(item.issues) ? item.issues.map((i) => i.name || i) : [],
    postedAt: item.dt_posted || item.filing_period || null,
    stance: null
  }));
}
