import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHmac,
  createPublicKey,
  createVerify,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const DATA_DIR = join(ROOT, "data");
const WAITLIST_FILE = join(DATA_DIR, "waitlist.jsonl");
const PAPER_ACCOUNTS_FILE = join(DATA_DIR, "paper-accounts.json");
const PAPER_STARTING_CASH = 100000;

loadEnvFile(".env");
loadEnvFile(".env.local");

const PORT = Number(process.env.PORT || 3000);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const AUTH_SECRET =
  process.env.AUTH_SECRET || "dev-only-secret-change-before-deploying";
const SESSION_COOKIE = "ts_session";
const OAUTH_COOKIE = "ts_oauth";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT ||
  "TradeSimple/1.0 (retail research terminal; contact: you@example.com)";

const RESEARCH_SYSTEM_PROMPT = `You are TradeSimple's research assistant. You explain how congressional bills, lobbying activity, federal contracts, and government appointments might affect specific stocks in plain English for retail investors.
FORMATTING RULES: Never use markdown headers, horizontal rules, or raw markdown syntax. Use plain paragraphs separated by line breaks. Keep responses under 250 words unless the user asks for a deep dive. Lead with the single most important insight in the first sentence. End every response with a maximum of 3 bullet watch items labeled Watch for:
TONE RULES: Never use dramatic language like existential threat, genuinely scared, or death sentence. Let numbers speak for themselves. Use this suggests not this means. Use historically not guaranteed. Never imply a buy or sell decision even indirectly.
STRUCTURE FOR EVERY RESPONSE: One sentence bottom line up front. The signal breakdown with numbers and ratios. Historical analog if one exists with actual price move and timeframe. What the user still does not know and would need to verify. Watch for with maximum 3 bullet points.
DISCLOSURE: Start every response that discusses position impact with exactly this line: Research signal only. Not financial advice.
DATA HONESTY: If a number comes from a specific source name it. If a number is estimated say so. Never invent historical analogs. If you do not have enough data to answer well say so directly.
DATA SOURCES YOU CAN REFERENCE: Congress.gov for bill stage and cosponsor data. LDA.gov for lobbying filings and spend. USASpending.gov for federal contract awards and agency budgets. SEC EDGAR for 10-K risk factors and revenue segment data. Finnhub for live equity quotes. SAM.gov for contract opportunities and recompetes.`;

const METHODOLOGY = {
  version: 1,
  disclaimer:
    "Every number below is a transparent scenario model inside TradeSimple. It is not a forecast, a consensus estimate, or investment advice. Live Congress.gov text and LDA filings always supersede the UI when they disagree.",
  sections: [
    {
      id: "legislativeMomentum",
      title: "Legislative momentum (0–100)",
      summary:
        "Eight sub-scores from 0–100 are combined with fixed weights. The weighted average is rounded to an integer and clamped between 0 and 100.",
      weights: [
        { name: "Stage progress", pct: 25, detail: "Maps normalized bill status: introduced 20, committee 40, markup 60, floor 80, enacted/passed 100, failed 5." },
        { name: "Sponsor effectiveness", pct: 15, detail: "Cosponsors as a share of chamber size (218 House / 100 Senate cap). Bipartisan bills add up to +25 points." },
        { name: "Cosponsor strength", pct: 15, detail: "Same density measure without the bipartisan bonus — captures sheer caucus scale." },
        { name: "Bipartisan breadth", pct: 10, detail: "Uses curated bipartisanScore when present; otherwise bipartisan cosponsors ÷ total cosponsors × 100." },
        { name: "Committee / schedule", pct: 10, detail: "Uses curated committeeScore when present; otherwise defaults from stage. Floor-scheduled bills gain +18 (capped at 100)." },
        { name: "Recency", pct: 10, detail: "Last action date buckets: ≤10d → 100, ≤30d → 88, ≤60d → 72, ≤120d → 55, ≤200d → 40, older → 28; missing date → 35." },
        { name: "Text enactability", pct: 10, detail: "Blend of historicalScore (55%) and floorScore (45%) when curated; else defaults from stage." },
        { name: "Time remaining", pct: 5, detail: "Calendar-month proxy for session runway unless the bill already passed." }
      ]
    },
    {
      id: "billConfidence",
      title: "Bill signal confidence (High / Medium / Low)",
      summary:
        "A points checklist — not a statistical confidence interval — describing how complete the seed bill record is.",
      weights: [
        { name: "Recency & action text", pct: null, detail: "Up to 45 pts from latestActionDate freshness plus 10 pts if latestAction exists." },
        { name: "Support signals", pct: null, detail: "12 pts if cosponsors > 0; 8 pts if bipartisanCosponsors is recorded." },
        { name: "Lobbying context", pct: null, detail: "12 pts if lobbyingAgainst or lobbyingFor dollars exist in seed data." },
        { name: "Narrative depth", pct: null, detail: "5 pts if plainEnglish text is longer than 80 characters." },
        { name: "Buckets", pct: null, detail: "≥72 pts → High; ≥44 → Medium; otherwise Low." }
      ]
    },
    {
      id: "lobbyingPressure",
      title: "Lobbying pressure on disclosures (0–100)",
      summary:
        "Built from each LDA-style filing row (client, registrant, amount, issues, spike factor, posted date). When no nine-quarter history exists, the server synthesizes eight trailing quarters from amount ÷ spike so the z-score still runs.",
      weights: [
        { name: "Spend spike shape", pct: 40, detail: "Current quarter vs trailing eight-quarter mean/std → z-score; mapped to 0–100 via spendSpikeSubscore (z clipped −2…3.5)." },
        { name: "Coalition breadth", pct: 20, detail: "Count of comma-separated issue tags: base 12 + 22 per tag (cap 100)." },
        { name: "Topic specificity", pct: 15, detail: "Starts at 100 and penalizes extra tags so vague omnibus filings score lower." },
        { name: "Recency", pct: 15, detail: "Posted date buckets: ≤14d best, decaying through 200d." },
        { name: "Direction certainty", pct: 10, detail: "Higher when spike factor > 1.65; +12 when issues mention pricing, antitrust, crypto, Medicare, export, or chips." }
      ]
    },
    {
      id: "lobbyingSubscores",
      title: "Lobby filing sub-labels (Spend / Issue / Recency confidence)",
      summary: "Heuristic labels that explain the filing row, not statistical confidence intervals.",
      weights: [
        { name: "Spend signal", pct: null, detail: "High if z ≥ 1.2 or spike > 1.8×; Low if |z| < 0.35; else Medium." },
        { name: "Issue signal", pct: null, detail: "High if ≥3 issue tokens; Medium if ≥1; else Low." },
        { name: "Recency signal", pct: null, detail: "High if filed ≤90 days; Medium if posted date exists but older; else Low." }
      ]
    },
    {
      id: "filingConfidence",
      title: "Filing confidence (High / Medium / Low)",
      summary: "Points for populated client/registrant/issue/amount/posted date fields.",
      weights: [
        { name: "Field checklist", pct: null, detail: "28 client + 14 registrant + issue length + amount + posted date freshness (≤45d bonus). ≥74 High; ≥42 Medium; else Low." }
      ]
    },
    {
      id: "billCardLobbying",
      title: "Lobbying pressure on LegisAlert cards",
      summary:
        "Matches the same lobbying-pressure engine, but the input is a synthetic filing built from the bill seed's lobbyingAgainst / lobbyingFor dollars and narrative text — useful when no LDA row is attached yet.",
      weights: []
    },
    {
      id: "marketMood",
      title: "Overview · Market mood panel",
      summary: "All four meters are modeled inside the browser from quotes + bill feed + lobbying feed — not third-party sentiment APIs.",
      weights: [
        { name: "Tape risk appetite", pct: null, detail: "SPY/QQQ blended daily % move mapped toward a 12–92 gauge." },
        { name: "Social sentiment proxy", pct: null, detail: "Derived from the same tape move; labeled as modeled (not live Reddit)." },
        { name: "Portfolio policy heat", pct: null, detail: "Max legislative momentum among bills touching simulated holdings, with a fallback when none match." },
        { name: "Lobby intensity", pct: null, detail: "Mean lobbyingPressure on the most recent filings (fallback constant when empty)." }
      ]
    }
  ]
};

const MARKET_FALLBACK = {
  NVDA: { symbol: "NVDA", price: 132.4, change: 1.85, pct: 1.42, high: 148.2, low: 102.6, open: 130.55 },
  AAPL: { symbol: "AAPL", price: 228.6, change: -0.92, pct: -0.4, high: 235.0, low: 218.4, open: 229.5 },
  LLY: { symbol: "LLY", price: 718.2, change: 6.4, pct: 0.9, high: 742.0, low: 682.0, open: 712.1 },
  TSLA: { symbol: "TSLA", price: 285.3, change: 3.1, pct: 1.1, high: 298.0, low: 258.0, open: 282.4 },
  AMZN: { symbol: "AMZN", price: 212.8, change: 2.05, pct: 0.98, high: 218.0, low: 204.0, open: 210.9 },
  MSFT: { symbol: "MSFT", price: 468.2, change: 1.42, pct: 0.31, high: 472.0, low: 452.0, open: 466.8 },
  AMD: { symbol: "AMD", price: 118.6, change: 2.15, pct: 1.85, high: 124.0, low: 108.0, open: 116.45 },
  GOOGL: { symbol: "GOOGL", price: 168.9, change: 0.88, pct: 0.52, high: 171.5, low: 162.0, open: 168.0 },
  META: { symbol: "META", price: 598.4, change: 4.2, pct: 0.71, high: 612.0, low: 568.0, open: 594.2 },
  COIN: { symbol: "COIN", price: 276.5, change: -2.8, pct: -1.0, high: 292.0, low: 248.0, open: 279.3 },
  SPY: { symbol: "SPY", price: 598.2, change: 2.45, pct: 0.41, high: 602.0, low: 588.0, open: 595.75 },
  QQQ: { symbol: "QQQ", price: 518.6, change: 3.05, pct: 0.59, high: 524.0, low: 508.0, open: 515.55 }
};

function mapFinnhubQuoteResponse(symbol, data) {
  const price = Number(data.c);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("invalid_or_missing_price");
  }
  return {
    symbol,
    price,
    change: data.d != null ? Number(data.d) : null,
    changePercent: data.dp != null ? Number(data.dp) : null,
    pct: data.dp != null ? Number(data.dp) : null,
    high: data.h != null ? Number(data.h) : null,
    low: data.l != null ? Number(data.l) : null,
    open: data.o != null ? Number(data.o) : null,
    prevClose: data.pc != null ? Number(data.pc) : null,
    previousClose: data.pc != null ? Number(data.pc) : null,
    timestamp: data.t ? new Date(data.t * 1000).toISOString() : null,
    source: "finnhub"
  };
}

function enrichStaticQuote(row) {
  if (!row || row.price == null) return null;
  const pct = row.pct != null ? Number(row.pct) : row.changePercent != null ? Number(row.changePercent) : 0;
  return {
    ...row,
    pct,
    changePercent: row.changePercent != null ? Number(row.changePercent) : pct,
    prevClose: row.prevClose != null ? Number(row.prevClose) : row.previousClose != null ? Number(row.previousClose) : null,
    previousClose: row.previousClose != null ? Number(row.previousClose) : row.prevClose != null ? Number(row.prevClose) : null,
    source: row.source || "fallback_static"
  };
}

const FUNDAMENTALS = {
  NVDA: {
    name: "NVIDIA Corporation",
    sector: "Semiconductors",
    marketCap: 2190000000000,
    pe: 69.4,
    forwardPe: 42.1,
    ps: 31.2,
    grossMargin: 75,
    revenueGrowth: 126,
    freeCashFlowMargin: 39,
    debtToEquity: 0.25,
    beta: 1.72,
    analystTarget: 1050,
    analystRating: "Strong Buy",
    analystCount: 47,
    catalyst: "Earnings · Blackwell GPU ramp · CHIPS Act grant flow",
    moat: "CUDA, developer mindshare, and AI accelerator supply make the business hard to copy quickly.",
    plainBull: "AI infrastructure spending is still early, and the biggest cloud buyers keep raising capex.",
    plainBear: "The valuation assumes near-perfect growth, and export controls can pressure China revenue."
  },
  AAPL: {
    name: "Apple Inc.",
    sector: "Consumer technology",
    marketCap: 2920000000000,
    pe: 28.2,
    forwardPe: 24.8,
    ps: 7.4,
    grossMargin: 46,
    revenueGrowth: 3,
    freeCashFlowMargin: 28,
    debtToEquity: 1.45,
    beta: 1.28,
    analystTarget: 220,
    analystRating: "Buy",
    analystCount: 38,
    catalyst: "WWDC · AI features · India manufacturing ramp",
    moat: "The installed device base and services ecosystem make customers sticky.",
    plainBull: "Services revenue and buybacks can support earnings even when iPhone growth is slow.",
    plainBear: "Hardware growth is mature, and platform regulation can pressure App Store economics."
  },
  LLY: {
    name: "Eli Lilly and Company",
    sector: "Pharmaceuticals",
    marketCap: 757000000000,
    pe: 62.1,
    forwardPe: 43.6,
    ps: 19.7,
    grossMargin: 80,
    revenueGrowth: 26,
    freeCashFlowMargin: 21,
    debtToEquity: 1.62,
    beta: 0.41,
    analystTarget: 980,
    analystRating: "Buy",
    analystCount: 29,
    catalyst: "Drug pricing calendar · FDA catalysts · GLP-1 supply print",
    moat: "GLP-1 obesity and diabetes drugs give Lilly a huge demand runway.",
    plainBull: "If GLP-1 supply keeps expanding, revenue can compound faster than typical pharma.",
    plainBear: "Drug-pricing legislation is the clearest policy risk because it targets Medicare pricing power."
  },
  TSLA: {
    name: "Tesla Inc.",
    sector: "Electric vehicles",
    marketCap: 582000000000,
    pe: 47.2,
    forwardPe: 54.5,
    ps: 6.8,
    grossMargin: 18,
    revenueGrowth: 9,
    freeCashFlowMargin: 4,
    debtToEquity: 0.12,
    beta: 2.28,
    analystTarget: 210,
    analystRating: "Hold",
    analystCount: 44,
    catalyst: "Permitting reform · Robotaxi / FSD milestones · Energy storage growth",
    moat: "Brand, manufacturing scale, charging network, and software ambition create upside optionality.",
    plainBull: "Energy storage and autonomous driving can matter more than near-term car margins if execution improves.",
    plainBear: "EV price cuts, competition, and demand softness make the current multiple harder to defend."
  },
  AMZN: {
    name: "Amazon.com Inc.",
    sector: "Internet retail and cloud",
    marketCap: 1980000000000,
    pe: 55.8,
    forwardPe: 34.5,
    ps: 3.3,
    grossMargin: 48,
    revenueGrowth: 13,
    freeCashFlowMargin: 9,
    debtToEquity: 0.52,
    beta: 1.19,
    analystTarget: 225,
    analystRating: "Strong Buy",
    analystCount: 52,
    catalyst: "AWS growth · Ads · Anthropic partnership",
    moat: "AWS, Prime, logistics scale, and ads create multiple profit engines.",
    plainBull: "AWS reacceleration and advertising growth can expand margins.",
    plainBear: "Cloud competition and antitrust pressure can cap the multiple."
  },
  MSFT: {
    name: "Microsoft Corporation",
    sector: "Software and cloud",
    marketCap: 3090000000000,
    pe: 34.8,
    forwardPe: 29.2,
    ps: 12.6,
    grossMargin: 69,
    revenueGrowth: 17,
    freeCashFlowMargin: 30,
    debtToEquity: 0.31,
    beta: 0.91,
    analystTarget: 470,
    analystRating: "Strong Buy",
    analystCount: 51,
    catalyst: "Azure AI growth · Copilot adoption",
    moat: "Enterprise software distribution and Azure make Microsoft one of the stickiest platforms in the market.",
    plainBull: "AI can raise software pricing and cloud demand across a massive installed base.",
    plainBear: "The stock already prices in a lot of AI success."
  },
  AMD: {
    name: "Advanced Micro Devices",
    sector: "Semiconductors",
    marketCap: 262000000000,
    pe: 248,
    forwardPe: 35.9,
    ps: 10.8,
    grossMargin: 51,
    revenueGrowth: 10,
    freeCashFlowMargin: 8,
    debtToEquity: 0.05,
    beta: 1.85,
    analystTarget: 190,
    analystRating: "Buy",
    analystCount: 42,
    catalyst: "MI300 / AI GPU share · Data center CPU cycle",
    moat: "AMD has strong CPU execution and an emerging AI accelerator business.",
    plainBull: "If MI300 adoption broadens, earnings can grow into the valuation.",
    plainBear: "AI GPU expectations are high, and Nvidia remains the default buyer choice."
  },
  GOOGL: {
    name: "Alphabet Inc.",
    sector: "Search and cloud",
    marketCap: 2140000000000,
    pe: 21.4,
    forwardPe: 19.2,
    ps: 6.5,
    grossMargin: 58,
    revenueGrowth: 15,
    freeCashFlowMargin: 23,
    debtToEquity: 0.11,
    beta: 1.04,
    analystTarget: 205,
    analystRating: "Buy",
    analystCount: 45,
    catalyst: "Search + cloud AI monetization · Regulatory headline risk",
    moat: "Search intent data, YouTube, Android, and cloud scale are hard to replicate.",
    plainBull: "Search remains very profitable, and AI can improve ad tools if managed well.",
    plainBear: "Antitrust remedies and AI search disruption are real risks."
  },
  META: {
    name: "Meta Platforms",
    sector: "Social platforms",
    marketCap: 1270000000000,
    pe: 26.9,
    forwardPe: 23.1,
    ps: 8.7,
    grossMargin: 81,
    revenueGrowth: 21,
    freeCashFlowMargin: 31,
    debtToEquity: 0.25,
    beta: 1.22,
    analystTarget: 565,
    analystRating: "Buy",
    analystCount: 48,
    catalyst: "Reels monetization · AI ranking capex · regulatory headlines",
    moat: "Massive social graph, ad targeting, and AI ranking infrastructure support high margins.",
    plainBull: "AI ad tools are improving monetization, and cost discipline remains visible.",
    plainBear: "Privacy rules, platform regulation, and heavy AI capex can pressure returns."
  },
  COIN: {
    name: "Coinbase Global",
    sector: "Crypto exchange",
    marketCap: 55000000000,
    pe: 28.6,
    forwardPe: 32.4,
    ps: 9.8,
    grossMargin: 86,
    revenueGrowth: 38,
    freeCashFlowMargin: 24,
    debtToEquity: 0.48,
    beta: 3.44,
    analystTarget: 250,
    analystRating: "Hold",
    analystCount: 22,
    catalyst: "Rulemaking calendar · Rates · Token volatility",
    moat: "Regulated exchange brand, custody, and institutional relationships help Coinbase survive cycles.",
    plainBull: "Clear crypto rules and higher token prices can expand trading and custody revenue.",
    plainBear: "The business is volatile and regulation can still land in a restrictive way."
  },
  SPY: {
    name: "SPDR S&P 500 ETF",
    sector: "Broad market ETF",
    marketCap: null,
    pe: 24.5,
    forwardPe: 21.2,
    ps: 3.1,
    grossMargin: null,
    revenueGrowth: 5,
    freeCashFlowMargin: null,
    debtToEquity: null,
    beta: 1,
    analystTarget: 560,
    analystRating: "ETF",
    analystCount: null,
    catalyst: "Fed path · earnings breadth · mega-cap concentration",
    moat: "Diversification across the largest U.S. companies.",
    plainBull: "Broad earnings growth and falling rates can support the index.",
    plainBear: "Large-cap concentration makes the ETF sensitive to mega-cap tech valuation."
  },
  QQQ: {
    name: "Invesco QQQ ETF",
    sector: "Nasdaq 100 ETF",
    marketCap: null,
    pe: 31.7,
    forwardPe: 27.4,
    ps: 5.4,
    grossMargin: null,
    revenueGrowth: 9,
    freeCashFlowMargin: null,
    debtToEquity: null,
    beta: 1.06,
    analystTarget: 480,
    analystRating: "ETF",
    analystCount: null,
    catalyst: "Rates · growth earnings · semis / mega-cap tech",
    moat: "Diversified exposure to the largest Nasdaq growth companies.",
    plainBull: "AI and software earnings can keep growth above the broad market.",
    plainBear: "High multiple growth stocks are sensitive to interest rates and disappointment."
  }
};

const CRYPTO_FALLBACK = {
  bitcoin: { name: "Bitcoin", symbol: "BTC", price: 68420, pct: 3.17, marketCap: 1347000000000 },
  ethereum: { name: "Ethereum", symbol: "ETH", price: 3291, pct: -1.44, marketCap: 395000000000 },
  solana: { name: "Solana", symbol: "SOL", price: 172, pct: 4.2, marketCap: 81000000000 }
};

const POLICY_BILLS = [
  {
    id: "S.2547-119",
    title: "Drug Price Negotiation Expansion Act",
    shortTitle: "Medicare negotiates 50 more drug prices per year",
    chamber: "Senate",
    status: "committee",
    sponsor: { name: "B. Sanders", party: "I", state: "VT" },
    cosponsors: 23,
    bipartisanCosponsors: 4,
    floorScheduled: false,
    latestAction: "Reported out of committee 14-9",
    latestActionDate: "2026-04-28",
    tags: ["health", "pharma", "Medicare", "drug pricing"],
    portfolioTickers: ["LLY"],
    historicalAnalog: {
      title: "ACA Drug Pricing Provision (2022)",
      outcome:
        "Failed Senate cloture 50-50; Inflation Reduction Act passed watered-down version (10 drugs, not 50). Similar committee trajectory.",
      impact: "Pharma stocks recovered within six months after the hardest pricing scenario faded."
    },
    signals: {
      bipartisanScore: 55,
      committeeScore: 72,
      floorScore: 20,
      historicalScore: 40
    },
    affected: ["LLY", "MRK", "PFE", "ABBV", "UNH", "CVS"],
    lobbyingAgainst: 31,
    lobbyingFor: 2.1,
    lobbyingNote: "Pfizer, Merck, AbbVie combined $31M — 2.8x their normal quarterly spend. PhRMA trade group added $12M on top. When pharma triples lobbying spend, they believe the bill actually has a path.",
    plainEnglish: "Currently Medicare can only negotiate prices on 10 drugs per year (from the Inflation Reduction Act). This bill expands that to 50 drugs annually — and LLY's GLP-1 drugs hit Medicare volume thresholds next year.",
    signal: "Pharma opposition spend is 2.8x normal quarterly pace, which means the bill is being treated as real revenue risk.",
    impact: "If passed, large-cap pharma faces margin compression. If it dies, pricing overhang likely clears.",
    passImpacts: [
      { sym: "LLY", dir: -1, range: "-8 to -15%", why: "Mounjaro/Zepbound hit Medicare volume threshold in 2026" },
      { sym: "MRK", dir: -1, range: "-5 to -10%", why: "Keytruda is a prime negotiation target" },
      { sym: "PFE", dir: -1, range: "-4 to -8%", why: "Multiple drugs in the negotiation pool" },
      { sym: "ABBV", dir: -1, range: "-6 to -12%", why: "Humira/Skyrizi pricing at risk" },
      { sym: "UNH", dir: 1, range: "+3 to +6%", why: "Lower drug costs reduce claim payouts" },
      { sym: "CVS", dir: 1, range: "+2 to +4%", why: "PBM margins improve on negotiated drugs" }
    ],
    failImpacts: [
      { sym: "LLY", dir: 1, range: "+4 to +8%", why: "Pricing power protected, overhang removed" },
      { sym: "MRK", dir: 1, range: "+2 to +5%", why: "Revenue forecasts intact" },
      { sym: "PFE", dir: 1, range: "+2 to +4%", why: "Pricing overhang clears" }
    ]
  },
  {
    id: "H.R.4521-119",
    title: "CHIPS and Science Act Implementation",
    shortTitle: "Semiconductor manufacturing grants disbursing",
    chamber: "House",
    status: "passed",
    sponsor: { name: "Bipartisan", party: "B", state: "" },
    cosponsors: 218,
    bipartisanCosponsors: 218,
    floorScheduled: false,
    latestAction: "Signed into law. Grant disbursements underway.",
    latestActionDate: "2026-03-15",
    tags: ["technology", "semiconductors", "manufacturing", "AI"],
    portfolioTickers: ["NVDA"],
    historicalAnalog: {
      title: "CHIPS Act passage (2022)",
      outcome: "Passed 64-33 Senate, 243-187 House. Semiconductor stocks rallied 8-12% in the week following passage.",
      impact: "NVDA +9.2%, INTC +8.1%, AMAT +11.4% in the week after final passage."
    },
    signals: {
      bipartisanScore: 95,
      committeeScore: 100,
      floorScore: 100,
      historicalScore: 88
    },
    affected: ["NVDA", "INTC", "TSM", "AMAT", "ASML"],
    lobbyingAgainst: 1.2,
    lobbyingFor: 24,
    lobbyingNote: "Semiconductor industry spent $24M lobbying FOR implementation. TSMC, Intel, Samsung, Micron all filed for grants. 4 semiconductor CEOs mentioned CHIPS Act timelines in Q1 earnings calls.",
    plainEnglish: "The CHIPS Act already passed in 2022. This is the implementation phase where the $52B in fab grants are being distributed. Nvidia benefits indirectly as TSMC expands US capacity.",
    signal: "Semiconductor companies are lobbying for implementation speed, not for initial passage.",
    impact: "Supply-chain localization reduces geopolitical risk and supports domestic fab equipment demand.",
    passImpacts: [
      { sym: "NVDA", dir: 1, range: "+5 to +10%", why: "TSMC US capacity expansion = supply security, geopolitical risk reduction" },
      { sym: "INTC", dir: 1, range: "+8 to +14%", why: "Direct grant recipient — Columbus OH fab funded" },
      { sym: "TSM", dir: 1, range: "+4 to +8%", why: "Arizona fab expansion grants reduce capital cost" },
      { sym: "AMAT", dir: 1, range: "+6 to +10%", why: "Fab equipment orders surge with new US fabs" },
      { sym: "ASML", dir: 1, range: "+3 to +6%", why: "Lithography demand from US fab expansion" }
    ],
    failImpacts: []
  },
  {
    id: "H.R.7813-119",
    title: "Platform Competition and Opportunity Act",
    shortTitle: "Restricts platform self-preferencing",
    chamber: "House",
    status: "committee",
    sponsor: { name: "D. Cicilline", party: "D", state: "RI" },
    cosponsors: 12,
    bipartisanCosponsors: 3,
    floorScheduled: false,
    latestAction: "Markup postponed — insufficient votes",
    latestActionDate: "2026-02-14",
    tags: ["technology", "antitrust", "platform"],
    portfolioTickers: ["AMZN", "AAPL", "GOOGL", "META"],
    historicalAnalog: {
      title: "American Choice and Innovation Online Act (2022)",
      outcome: "Died in Senate after similar trajectory; never reached floor despite committee clearance.",
      impact: "Mega-cap tech priced an 8-12% risk premium when active; recovered when bills stalled."
    },
    signals: {
      bipartisanScore: 30,
      committeeScore: 20,
      floorScore: 5,
      historicalScore: 25
    },
    affected: ["AMZN", "AAPL", "GOOGL", "META"],
    lobbyingAgainst: 18.4,
    lobbyingFor: 0.8,
    lobbyingNote: "AMZN, AAPL, GOOGL, META combined $18.4M against. Key signal: small business groups lobbying alongside tech companies. When natural enemies align, the bill's political coalition becomes untenable.",
    plainEnglish: "Would ban Amazon from favoring Amazon Basics, Apple from giving its own apps placement advantages, and Google from putting its own services above organic results. Legislative momentum faded after an unusual coalition formed against it.",
    signal: "Small-business groups and mega-cap platforms are unusually aligned against the bill, weakening the coalition.",
    impact: "Failure removes antitrust risk premium from mega-cap platform names.",
    passImpacts: [
      { sym: "AMZN", dir: -1, range: "-8 to -14%", why: "Marketplace neutrality destroys algorithmic advantage" },
      { sym: "AAPL", dir: -1, range: "-5 to -9%", why: "App Store search placement restrictions" },
      { sym: "GOOGL", dir: -1, range: "-6 to -11%", why: "Search result self-preferencing banned" },
      { sym: "META", dir: -1, range: "-3 to -6%", why: "Ad targeting restrictions on own-platform data" }
    ],
    failImpacts: [
      { sym: "AMZN", dir: 1, range: "+4 to +8%", why: "Antitrust overhang cleared — marketplace model intact" },
      { sym: "AAPL", dir: 1, range: "+2 to +5%", why: "App Store pricing power preserved" },
      { sym: "GOOGL", dir: 1, range: "+3 to +6%", why: "Search ad dominance protected" }
    ]
  },
  {
    id: "S.1823-119",
    title: "Digital Asset Market Structure Act",
    shortTitle: "Clarifies SEC and CFTC jurisdiction for crypto",
    chamber: "Senate",
    status: "committee",
    sponsor: { name: "C. Lummis", party: "R", state: "WY" },
    cosponsors: 8,
    bipartisanCosponsors: 3,
    floorScheduled: false,
    latestAction: "Joint committee hearing held. 60-day comment period open.",
    latestActionDate: "2026-04-10",
    tags: ["crypto", "financial", "SEC", "regulation"],
    portfolioTickers: ["COIN"],
    historicalAnalog: {
      title: "FIT21 Act (2024)",
      outcome: "Passed House 279-136 bipartisan; stalled in Senate.",
      impact: "COIN +22% the week FIT21 passed House; retraced when Senate did not move."
    },
    signals: {
      bipartisanScore: 60,
      committeeScore: 45,
      floorScore: 30,
      historicalScore: 35
    },
    affected: ["COIN", "BTC", "ETH"],
    lobbyingAgainst: 1.1,
    lobbyingFor: 6.2,
    lobbyingNote: "Crypto industry (Coinbase, Ripple, Binance.US) spending $6.2M FOR passage — unusual to see industry spend FOR regulation, but clarity is worth it. Traditional finance lobby mildly opposed.",
    plainEnglish: "The biggest unresolved question in crypto: is Bitcoin a security or a commodity? This bill would define which assets are under SEC vs CFTC jurisdiction. Clarity = bullish for crypto. Currently in 60-day public comment period.",
    signal: "Crypto firms are spending for regulation because jurisdictional clarity is worth more than ambiguity.",
    impact: "Passage is structurally bullish for compliant exchanges; failure keeps enforcement uncertainty alive.",
    passImpacts: [
      { sym: "COIN", dir: 1, range: "+15 to +30%", why: "Business certainty — Coinbase's regulatory cloud cleared" },
      { sym: "BTC", dir: 1, range: "+8 to +15%", why: "Institutional confidence unlocked with clear rules" },
      { sym: "ETH", dir: 1, range: "+10 to +18%", why: "Likely commodity classification reduces SEC overhang" }
    ],
    failImpacts: [
      { sym: "COIN", dir: -1, range: "-8 to -15%", why: "Status quo ambiguity remains — continued regulatory risk" },
      { sym: "BTC", dir: -1, range: "-3 to -6%", why: "Uncertainty overhang continues" }
    ]
  },
  {
    id: "S.3891-119",
    title: "Clean Energy Permitting Reform Act",
    shortTitle: "Speeds federal permits for EV and clean-energy projects",
    chamber: "Senate",
    status: "markup",
    sponsor: { name: "J. Manchin", party: "I", state: "WV" },
    cosponsors: 31,
    bipartisanCosponsors: 14,
    floorScheduled: true,
    latestAction: "Markup session completed. Reported favorably 12-10.",
    latestActionDate: "2026-04-22",
    tags: ["energy", "environment", "EV", "clean energy"],
    portfolioTickers: ["TSLA"],
    historicalAnalog: {
      title: "Fiscal Responsibility Act permitting provisions (2023)",
      outcome: "Passed with narrower permitting reforms than standalone bills.",
      impact: "Clean energy names moved +3-5% on headline permitting relief."
    },
    signals: {
      bipartisanScore: 72,
      committeeScore: 68,
      floorScore: 60,
      historicalScore: 55
    },
    affected: ["TSLA", "ENPH", "FSLR"],
    lobbyingAgainst: 8.4,
    lobbyingFor: 11.2,
    lobbyingNote: "Unusual: oil & gas AND clean energy companies both lobbying FOR this bill — permitting reform benefits all energy projects. Only environmental groups opposing. When industry and green groups align, passage momentum is real.",
    plainEnglish: "Current federal permitting for EV charging, battery manufacturing, and renewable energy projects takes 4-7 years on average. This bill would cap the timeline at 2 years for most projects. Directly benefits Tesla's Gigafactory expansion pipeline.",
    signal: "Oil, gas, and clean-energy companies all benefit from faster permitting, which creates rare cross-industry support.",
    impact: "Faster approvals help project timelines but do not fix EV demand or margin pressure by themselves.",
    passImpacts: [
      { sym: "TSLA", dir: 1, range: "+3 to +7%", why: "Gigafactory and Supercharger expansion timelines compress from 6 years to 2" },
      { sym: "ENPH", dir: 1, range: "+5 to +9%", why: "Solar install permitting dramatically faster" },
      { sym: "FSLR", dir: 1, range: "+4 to +8%", why: "Large-scale solar approvals faster" }
    ],
    failImpacts: [{ sym: "TSLA", dir: -1, range: "-2 to -4%", why: "Permitting bottlenecks remain — expansion slower" }]
  },
  {
    id: "H.R.3456-119",
    title: "AI Accountability and Transparency Act",
    shortTitle: "Disclosures and audits for high-risk AI systems",
    chamber: "House",
    status: "introduced",
    sponsor: { name: "T. Lieu", party: "D", state: "CA" },
    cosponsors: 6,
    bipartisanCosponsors: 1,
    floorScheduled: false,
    latestAction: "Referred to committee. No hearing scheduled.",
    latestActionDate: "2026-03-02",
    tags: ["AI", "technology", "regulation"],
    portfolioTickers: ["NVDA", "MSFT", "GOOGL", "META"],
    historicalAnalog: {
      title: "EU AI Act analogues",
      outcome: "US Congress has not passed AI-specific legislation; most bills die in committee.",
      impact: "Limited historical US market reaction to draft AI disclosure bills."
    },
    signals: {
      bipartisanScore: 15,
      committeeScore: 10,
      floorScore: 5,
      historicalScore: 20
    },
    affected: ["NVDA", "MSFT", "GOOGL", "META"],
    lobbyingAgainst: 4.1,
    lobbyingFor: 0.3,
    lobbyingNote:
      "Big tech spending $4.1M against. Routine opposition — not the 3x spike that signals existential legislative threat. Low momentum environment.",
    plainEnglish:
      "Would require algorithmic audits and transparency reports for high-risk AI in healthcare, finance, hiring, and criminal justice. Disclosure burden, not a ban.",
    signal: "Low-intensity lobbying and stalled committee calendar suggest limited near-term passage risk.",
    impact: "Mostly compliance overhead for cloud and platform names if it ever advances.",
    passImpacts: [
      { sym: "NVDA", dir: -1, range: "-1 to -3%", why: "Hardware not directly regulated; sentiment drag possible" },
      { sym: "MSFT", dir: -1, range: "-1 to -2%", why: "Compliance and audit costs" },
      { sym: "GOOGL", dir: -1, range: "-1 to -2%", why: "Audit and disclosure overhead" }
    ],
    failImpacts: [{ sym: "NVDA", dir: 0, range: "Minimal", why: "Low momentum limits risk premium" }]
  },
  {
    id: "H.R.6023-119",
    title: "Foreign Investment Transparency and Security Act",
    shortTitle: "Chinese investment restrictions in semis and AI",
    chamber: "House",
    status: "committee",
    sponsor: { name: "M. McCaul", party: "R", state: "TX" },
    cosponsors: 44,
    bipartisanCosponsors: 22,
    floorScheduled: false,
    latestAction: "Passed House Foreign Affairs Committee 32-8. Referred to Intel Committee.",
    latestActionDate: "2026-04-18",
    tags: ["foreign policy", "technology", "China", "national security"],
    portfolioTickers: ["NVDA", "TSM", "ASML"],
    historicalAnalog: {
      title: "CHIPS export controls + BIS expansions",
      outcome: "National-security framed trade rules have repeatedly advanced with bipartisan support.",
      impact: "NVDA sold off ~15% on initial H100 export headlines; incremental rules add headline risk."
    },
    signals: {
      bipartisanScore: 78,
      committeeScore: 65,
      floorScore: 35,
      historicalScore: 62
    },
    affected: ["NVDA", "TSM", "ASML", "INTC"],
    lobbyingAgainst: 2.8,
    lobbyingFor: 3.2,
    lobbyingNote:
      "Balanced filing environment: defense groups for, Chamber types against. Strong bipartisan cosponsor count is the bullish passage signal.",
    plainEnglish:
      "Would expand CFIUS-style screening for Chinese-linked investment into US semiconductor and AI companies. Highest sensitivity for China revenue exposure.",
    signal: "Bipartisan committee momentum contrasts with typical partisan tech fights.",
    impact: "Passage raises compliance and capital access concerns for fabs and designers with China links.",
    passImpacts: [
      { sym: "NVDA", dir: -1, range: "-4 to -9%", why: "China datacenter revenue further constrained" },
      { sym: "TSM", dir: -1, range: "-3 to -7%", why: "Advanced-node China demand risk" },
      { sym: "ASML", dir: -1, range: "-2 to -5%", why: "Further tightening of China equipment paths" },
      { sym: "INTC", dir: 1, range: "+2 to +4%", why: "US-only manufacturing relative winner" }
    ],
    failImpacts: [{ sym: "NVDA", dir: 1, range: "+3 to +6%", why: "China revenue overhang partially lifts" }]
  }
];

const LOBBYING_FALLBACK = [
  { client: "Eli Lilly and Company", registrant: "Cornerstone Government Affairs", amount: 4200000, issue: "Medicare pricing", spike: 3.1, portfolio: true },
  { client: "AbbVie Inc.", registrant: "Sidley Austin LLP", amount: 4800000, issue: "Drug pricing", spike: 2.9, portfolio: false },
  { client: "NVIDIA Corporation", registrant: "Holland & Knight LLP", amount: 1680000, issue: "Export controls and AI policy", spike: 1.0, portfolio: true },
  { client: "Amazon.com Inc.", registrant: "Squire Patton Boggs", amount: 2760000, issue: "Antitrust and e-commerce", spike: 1.4, portfolio: true },
  { client: "Coinbase Global Inc.", registrant: "Crypto Council for Innovation", amount: 2200000, issue: "Digital assets", spike: 1.8, portfolio: false }
];

const POLICY_STAKEHOLDERS = {
  "S.2547-119": {
    lawmakers: [
      { name: "Sen. Bernie Sanders", party: "I", state: "VT", role: "Sponsor", stance: "for", influence: 88, note: "Drug-pricing advocate; sponsor pressure keeps the issue alive." },
      { name: "Senate Finance members", party: "Mixed", state: "US", role: "Gatekeepers", stance: "watch", influence: 82, note: "Committee members decide whether Medicare pricing language reaches the floor." },
      { name: "Moderate Senate Democrats", party: "D", state: "US", role: "Swing bloc", stance: "watch", influence: 67, note: "Their support determines how aggressive the final bill can be." }
    ],
    committees: [
      { name: "Senate Finance Committee", role: "Medicare and revenue gatekeeper", influence: 92, stance: "active" },
      { name: "Senate HELP Committee", role: "Health policy pressure source", influence: 64, stance: "supportive" }
    ],
    lobbying: [
      { name: "Eli Lilly and Company", stance: "against", amount: 4200000, issue: "Medicare pricing", tickers: ["LLY"], relationship: "Protects GLP-1 pricing power and Medicare revenue." },
      { name: "PhRMA", stance: "against", amount: 12000000, issue: "Drug pricing", tickers: ["LLY", "MRK", "PFE", "ABBV"], relationship: "Industry-wide defense against price negotiation expansion." },
      { name: "AARP", stance: "for", amount: 2100000, issue: "Medicare affordability", tickers: ["UNH", "CVS"], relationship: "Supports lower patient drug costs, which can pressure pharma but help payers." }
    ],
    tickerImpacts: [
      { symbol: "LLY", direction: "downside", impact: "-8% to -15%", mechanism: "Medicare negotiation could reduce GLP-1 pricing power." },
      { symbol: "MRK", direction: "downside", impact: "-5% to -10%", mechanism: "Large Medicare-exposed drugs become negotiation candidates." },
      { symbol: "UNH", direction: "upside", impact: "+3% to +6%", mechanism: "Lower drug costs can reduce claims pressure." }
    ],
    analog: "Inflation Reduction Act drug provisions: pharma sold off around pricing risk, then recovered as final scope narrowed.",
    nextWatch: "New bipartisan cosponsors, floor scheduling, and another quarter of pharma LDA filings."
  },
  "H.R.4521-119": {
    lawmakers: [
      { name: "Commerce Committee leadership", party: "Mixed", state: "US", role: "Implementation oversight", stance: "for", influence: 76, note: "Keeps grant timing and eligibility language moving." },
      { name: "Semiconductor-state delegations", party: "Mixed", state: "AZ/OH/TX", role: "Regional pressure", stance: "for", influence: 72, note: "Members with fabs in-state want faster disbursements." }
    ],
    committees: [
      { name: "Commerce, Science, and Transportation", role: "Funding oversight", influence: 86, stance: "active" },
      { name: "Appropriations", role: "Disbursement timing", influence: 74, stance: "active" }
    ],
    lobbying: [
      { name: "NVIDIA Corporation", stance: "for", amount: 1680000, issue: "AI policy and supply chain", tickers: ["NVDA"], relationship: "Benefits indirectly when advanced packaging and foundry capacity are less geopolitically fragile." },
      { name: "Semiconductor Industry Association", stance: "for", amount: 8200000, issue: "CHIPS grants", tickers: ["NVDA", "AMD", "TSM", "ASML"], relationship: "Pushes faster implementation across the chip supply chain." },
      { name: "Intel Corporation", stance: "for", amount: 3100000, issue: "Domestic manufacturing grants", tickers: ["INTC"], relationship: "Direct grant recipient; wants fab funding certainty." }
    ],
    tickerImpacts: [
      { symbol: "NVDA", direction: "upside", impact: "+5% to +10%", mechanism: "Supply-chain security lowers geopolitical risk around AI accelerators." },
      { symbol: "TSM", direction: "upside", impact: "+4% to +8%", mechanism: "Arizona expansion grants can reduce capital burden." },
      { symbol: "ASML", direction: "upside", impact: "+3% to +6%", mechanism: "More fab builds can pull forward equipment demand." }
    ],
    analog: "Original CHIPS Act passage: semis rallied as the market priced public support for domestic manufacturing.",
    nextWatch: "Grant award timing, fab construction milestones, and export-control amendments."
  },
  "H.R.7813-119": {
    lawmakers: [
      { name: "House Judiciary Antitrust Subcommittee", party: "Mixed", state: "US", role: "Bill sponsor lane", stance: "for", influence: 78, note: "The subcommittee creates pressure even when floor odds are weak." },
      { name: "Small-business caucus members", party: "Mixed", state: "US", role: "Coalition swing", stance: "watch", influence: 61, note: "If this bloc defects, the bill loses its pro-small-business story." }
    ],
    committees: [
      { name: "House Judiciary Committee", role: "Markup gatekeeper", influence: 88, stance: "stalled" }
    ],
    lobbying: [
      { name: "Amazon.com Inc.", stance: "against", amount: 2760000, issue: "Marketplace rules", tickers: ["AMZN"], relationship: "Protects marketplace search, private-label, and advertising economics." },
      { name: "Apple Inc.", stance: "against", amount: 2100000, issue: "App Store placement", tickers: ["AAPL"], relationship: "Protects App Store economics and default app placement." },
      { name: "Technology trade groups", stance: "against", amount: 9600000, issue: "Platform regulation", tickers: ["AMZN", "AAPL", "GOOGL", "META"], relationship: "Coordinates opposition across large platforms." }
    ],
    tickerImpacts: [
      { symbol: "AMZN", direction: "upside", impact: "+4% to +8% if it dies", mechanism: "Marketplace self-preferencing risk fades." },
      { symbol: "AAPL", direction: "upside", impact: "+2% to +5% if it dies", mechanism: "App Store placement and fee risk eases." },
      { symbol: "GOOGL", direction: "upside", impact: "+3% to +6% if it dies", mechanism: "Search and vertical placement risk eases." }
    ],
    analog: "American Choice and Innovation Online Act: cleared committee attention but failed to reach durable floor momentum.",
    nextWatch: "Markup reschedule, small-business coalition changes, and new antitrust enforcement headlines."
  },
  "S.1823-119": {
    lawmakers: [
      { name: "Sen. Cynthia Lummis", party: "R", state: "WY", role: "Sponsor", stance: "for", influence: 80, note: "Frames market-structure clarity as a competitive advantage for U.S. crypto." },
      { name: "Senate Banking members", party: "Mixed", state: "US", role: "Jurisdiction gatekeepers", stance: "watch", influence: 84, note: "They decide how much SEC authority remains in the final draft." }
    ],
    committees: [
      { name: "Senate Banking Committee", role: "SEC jurisdiction", influence: 90, stance: "active" },
      { name: "Senate Agriculture Committee", role: "CFTC jurisdiction", influence: 76, stance: "active" }
    ],
    lobbying: [
      { name: "Coinbase Global Inc.", stance: "for", amount: 2200000, issue: "Digital assets", tickers: ["COIN"], relationship: "Clarity lowers enforcement uncertainty for exchange and custody revenue." },
      { name: "Crypto Council for Innovation", stance: "for", amount: 1800000, issue: "Market structure", tickers: ["COIN", "BTC", "ETH"], relationship: "Pushes rule clarity across token markets." },
      { name: "Traditional finance associations", stance: "against", amount: 1100000, issue: "Exchange competition", tickers: ["COIN"], relationship: "Can slow language that advantages crypto-native venues." }
    ],
    tickerImpacts: [
      { symbol: "COIN", direction: "upside", impact: "+15% to +30%", mechanism: "Regulatory clarity can expand institutional exchange and custody demand." },
      { symbol: "BTC", direction: "upside", impact: "+8% to +15%", mechanism: "Clearer commodity treatment can pull in cautious institutional buyers." },
      { symbol: "ETH", direction: "upside", impact: "+10% to +18%", mechanism: "Jurisdiction clarity reduces security-classification overhang." }
    ],
    analog: "FIT21 House passage: COIN rallied sharply, then gave back gains when Senate momentum faded.",
    nextWatch: "Committee language, SEC/CFTC split, and whether bipartisan cosponsors increase."
  },
  "S.3891-119": {
    lawmakers: [
      { name: "Senate Energy and Natural Resources members", party: "Mixed", state: "US", role: "Markup gatekeepers", stance: "for", influence: 83, note: "Committee support matters because permitting reform crosses energy factions." },
      { name: "Energy-state senators", party: "Mixed", state: "US", role: "Swing coalition", stance: "for", influence: 74, note: "Fossil and clean-energy interests can both support faster permitting." }
    ],
    committees: [
      { name: "Senate Energy and Natural Resources", role: "Markup and floor recommendation", influence: 88, stance: "active" },
      { name: "Environment and Public Works", role: "Environmental review language", influence: 70, stance: "watch" }
    ],
    lobbying: [
      { name: "Tesla Inc.", stance: "for", amount: 890000, issue: "EV infrastructure and permitting", tickers: ["TSLA"], relationship: "Faster permits can help factories, chargers, and energy deployments." },
      { name: "Clean energy developers", stance: "for", amount: 5300000, issue: "Project approvals", tickers: ["ENPH", "FSLR", "TSLA"], relationship: "Supports faster utility-scale approvals." },
      { name: "Environmental groups", stance: "against", amount: 2400000, issue: "Review standards", tickers: ["TSLA", "ENPH"], relationship: "Can force narrower language or longer timelines." }
    ],
    tickerImpacts: [
      { symbol: "TSLA", direction: "upside", impact: "+3% to +7%", mechanism: "Faster approval cycles can improve factory, charging, and energy project timelines." },
      { symbol: "ENPH", direction: "upside", impact: "+5% to +9%", mechanism: "Solar deployments benefit from faster local and federal approvals." }
    ],
    analog: "Fiscal Responsibility Act permitting provisions: clean-energy names moved on faster-project-cycle expectations.",
    nextWatch: "Floor calendar, environmental review amendments, and cross-industry lobbying changes."
  }
};

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "internal_error", message: "Something broke on the server." });
  }
});

server.listen(PORT, () => {
  console.log(`TradeSimple running at ${APP_URL}`);
});

async function route(req, res) {
  const url = new URL(req.url || "/", APP_URL);
  const pathname = url.pathname;

  if (pathname === "/") return sendStatic(res, "index.html");
  if (pathname === "/favicon.ico") {
    res.writeHead(204, { "cache-control": "public, max-age=86400" });
    return res.end();
  }
  if (pathname === "/dashboard") {
    const session = getSession(req);
    if (!session) return redirect(res, "/");
    return sendStatic(res, "dashboard.html");
  }
  if (pathname.startsWith("/assets/")) return sendStatic(res, pathname.replace("/assets/", ""));

  if (pathname === "/api/config") {
    return sendJson(res, 200, publicConfig());
  }
  if (pathname === "/api/session") {
    return sendJson(res, 200, { user: getSession(req)?.user || null });
  }
  if (pathname === "/api/waitlist" && req.method === "POST") return waitlistSignup(req, res);
  if (pathname === "/auth/demo") return startDemoSession(req, res);
  if (pathname === "/auth/logout") return logout(res);
  if (pathname === "/auth/google") return startOAuth(req, res, "google");
  if (pathname === "/auth/apple") return startOAuth(req, res, "apple");
  if (pathname === "/auth/callback/google") return finishOAuth(req, res, "google", url);
  if (pathname === "/auth/callback/apple") return finishOAuth(req, res, "apple", url);

  if (pathname.startsWith("/api/")) {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "unauthorized" });

    if (pathname === "/api/market/quotes") return marketQuotes(res, url);
    if (pathname === "/api/market/history") return marketHistory(res, url);
    if (pathname === "/api/analysis/stock") return stockAnalysis(res, url);
    if (pathname === "/api/policy/network") return policyNetwork(res, url);
    if (pathname === "/api/crypto") return cryptoPrices(res, url);
    if (pathname === "/api/congress/bills") return congressBills(res, url);
    if (pathname.startsWith("/api/contracts/") && req.method === "GET") return contractsByCompany(res, pathname);
    if (pathname.startsWith("/api/agency-budget/") && req.method === "GET") return agencyBudget(res, pathname);
    if (pathname === "/api/appointments" && req.method === "GET") return recentAppointments(res);
    if (pathname === "/api/methodology") return methodologyDoc(res);
    if (pathname === "/api/policy/bill-metrics") return billPolicyMetrics(res, url);
    if (pathname === "/api/lobbying") return lobbying(res);
    if (pathname === "/api/trading/account") return paperAccount(res, session);
    if (pathname === "/api/trading/orders" && req.method === "POST") return paperOrder(req, res, session);
    if (pathname.startsWith("/api/edgar/") && req.method === "GET") return edgarRiskFactors(res, pathname);
    if (pathname === "/api/research/ask" && req.method === "POST") return researchAsk(req, res, session);
  }

  sendStatic(res, pathname.slice(1));
}

async function sendStatic(res, relativePath) {
  const safePath = normalize(relativePath || "index.html").replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, "Forbidden");
  if (!existsSync(filePath)) return sendText(res, 404, "Not found");
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return sendText(res, 404, "Not found");
  const body = await readFile(filePath);
  res.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": "no-store"
  });
  res.end(body);
}

function publicConfig() {
  return {
    auth: {
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      apple: Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET),
      demo: process.env.DEMO_AUTH !== "false"
    },
    data: {
      finnhub: Boolean(process.env.FINNHUB_API_KEY),
      coingecko: Boolean(process.env.COINGECKO_API_KEY),
      congress: Boolean(process.env.CONGRESS_API_KEY),
      senateLda: Boolean(process.env.SENATE_LDA_API_KEY),
      alpaca: Boolean(process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      secEdgar: true
    },
    safety: {
      liveTradingEnabled: process.env.ALLOW_LIVE_TRADING === "true",
      tradingBaseUrl: process.env.ALPACA_TRADING_BASE_URL || "https://paper-api.alpaca.markets"
    }
  };
}

async function waitlistSignup(req, res) {
  const body = await readJson(req);
  const email = String(body.email || "").trim().toLowerCase();
  const source = String(body.source || "landing").slice(0, 80);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return sendJson(res, 400, {
      error: "invalid_email",
      message: "Enter a valid email address."
    });
  }

  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(
    WAITLIST_FILE,
    JSON.stringify({
      email,
      source,
      userAgent: req.headers["user-agent"] || "",
      createdAt: new Date().toISOString()
    }) + "\n",
    "utf8"
  );

  sendJson(res, 200, {
    ok: true,
    message: "You're on the waitlist. We'll send early access details when the private beta opens."
  });
}

async function marketQuotes(res, url) {
  const symbolsParam =
    url.searchParams.get("symbols") || "SPY,QQQ,NVDA,AAPL,TSLA,LLY,AMZN,MSFT,AMD,META";
  const symbols = symbolsParam
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 40);
  console.log(
    "QUOTES REQUEST received for symbols:",
    symbolsParam,
    "FINNHUB KEY present:",
    Boolean(process.env.FINNHUB_API_KEY)
  );
  const token = process.env.FINNHUB_API_KEY;

  if (!token) {
    console.error("Finnhub API key missing — serving static MARKET_FALLBACK only.");
    const quotes = symbols.map((symbol) => enrichStaticQuote(MARKET_FALLBACK[symbol])).filter(Boolean);
    return sendJson(res, 200, { source: "fallback", quotes, confidence: "Medium", updatedAt: new Date().toISOString() });
  }

  const quotes = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
        const response = await fetchWithTimeout(quoteUrl, {}, 7000);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        return mapFinnhubQuoteResponse(symbol, data);
      } catch (error) {
        console.error(
          "Finnhub fetch failed:",
          error?.message || String(error),
          "symbol:",
          symbol,
          "falling back to static data"
        );
        return enrichStaticQuote(MARKET_FALLBACK[symbol]);
      }
    })
  );

  const filteredQuotes = quotes.filter(Boolean);
  const liveCount = filteredQuotes.filter((q) => q.source === "finnhub").length;
  const source =
    liveCount === 0 ? "fallback" : liveCount < filteredQuotes.length ? "mixed" : "finnhub";

  sendJson(res, 200, {
    source,
    quotes: filteredQuotes,
    confidence: scoreConfidence({
      missingInputs: Math.max(0, symbols.length - filteredQuotes.length)
    }),
    updatedAt: new Date().toISOString()
  });
}

async function marketHistory(res, url) {
  const requested = String(url.searchParams.get("symbol") || "NVDA").toUpperCase().replace(/[^A-Z.]/g, "");
  const symbol = MARKET_FALLBACK[requested] || FUNDAMENTALS[requested] ? requested : "NVDA";
  const range = String(url.searchParams.get("range") || "6m").toLowerCase();
  const token = process.env.FINNHUB_API_KEY;
  const seconds = rangeSeconds(range);
  const to = Math.floor(Date.now() / 1000);
  const from = to - seconds;
  const resolution = range === "1d" ? "5" : range === "1w" ? "30" : "D";

  if (token) {
    try {
      const historyUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}&token=${encodeURIComponent(token)}`;
      const response = await fetchWithTimeout(historyUrl, {}, 9000);
      if (!response.ok) throw new Error(`finnhub_history_${response.status}`);
      const data = await response.json();
      if (data.s === "ok" && Array.isArray(data.c) && data.c.length) {
        const points = data.c.map((close, index) => ({
          date: data.t?.[index]
            ? new Date(data.t[index] * 1000).toISOString().slice(0, range === "1d" || range === "1w" ? 16 : 10)
            : "",
          close: Number(close),
          open: Number(data.o?.[index] || close),
          high: Number(data.h?.[index] || close),
          low: Number(data.l?.[index] || close),
          volume: Number(data.v?.[index] || 0)
        }));
        return sendJson(res, 200, {
          source: "finnhub",
          symbol,
          range,
          points,
          stats: historyStats(points),
          confidence: "High",
          updatedAt: new Date().toISOString()
        });
      }
    } catch {
      // Fall through to modeled history so the paper trader remains usable.
    }
  }

  const yahooPoints = await yahooHistory(symbol, range);
  if (yahooPoints.length) {
    return sendJson(res, 200, {
      source: "yahoo_chart",
      symbol,
      range,
      points: yahooPoints,
      stats: historyStats(yahooPoints),
      confidence: "Medium",
      updatedAt: new Date().toISOString()
    });
  }

  const stooqPoints = range === "1d" ? [] : await stooqHistory(symbol, from, to);
  if (stooqPoints.length) {
    return sendJson(res, 200, {
      source: "stooq_public",
      symbol,
      range,
      points: stooqPoints,
      stats: historyStats(stooqPoints),
      confidence: "Medium",
      updatedAt: new Date().toISOString()
    });
  }

  const quoteResult = await quoteSnapshot(symbol);
  const quote = quoteResult.quote || enrichStaticQuote(MARKET_FALLBACK[symbol]) || { symbol, price: 100, pct: 0, changePercent: 0 };
  const points = buildHistoricalSeries(symbol, range, quote);
  sendJson(res, 200, {
    source: "modeled_history",
    symbol,
    range,
    points,
    stats: historyStats(points),
    confidence: "Medium",
    updatedAt: new Date().toISOString()
  });
}

async function stockAnalysis(res, url) {
  const requested = String(url.searchParams.get("symbol") || "NVDA").toUpperCase().replace(/[^A-Z.]/g, "");
  const symbol = FUNDAMENTALS[requested] || MARKET_FALLBACK[requested] ? requested : "NVDA";
  const quoteResult = await quoteSnapshot(symbol);
  const quote = quoteResult.quote || enrichStaticQuote(MARKET_FALLBACK[symbol]) || { symbol, price: 0, change: 0, pct: 0, changePercent: 0 };
  const fundamentals = FUNDAMENTALS[symbol] || {
    name: symbol,
    sector: "Tracked equity",
    marketCap: null,
    pe: null,
    forwardPe: null,
    ps: null,
    grossMargin: null,
    revenueGrowth: null,
    freeCashFlowMargin: null,
    debtToEquity: null,
    beta: null,
    analystTarget: null,
    analystRating: null,
    analystCount: null,
    catalyst: null,
    moat: "Add a fundamentals provider to replace this modeled profile with live company data.",
    plainBull: "The live price feed is connected, but fundamentals are not mapped yet.",
    plainBear: "Without fundamentals, this ticker should be treated as quote-only."
  };
  const relatedBills = POLICY_BILLS.filter((bill) => (bill.affected || []).includes(symbol));
  const policyExposure = relatedBills.reduce((max, bill) => Math.max(max, computeLegislativeMomentum(bill)), 0);
  const valuationRisk = valuationRiskScore(fundamentals);
  const volatilityRisk = Math.min(100, Math.round(Number(fundamentals.beta || 1) * 38));
  const policyGraph = buildPolicyNetwork(symbol);

  sendJson(res, 200, {
    source: {
      quote: quoteResult.source,
      fundamentals: "modeled_fundamentals",
      policy: "congress.gov + lda.gov model"
    },
    updatedAt: new Date().toISOString(),
    symbol,
    company: {
      name: fundamentals.name,
      sector: fundamentals.sector,
      moat: fundamentals.moat
    },
    quote,
    confidence: scoreConfidence({
      staleInputs: quoteResult.source === "finnhub" ? 0 : 1,
      estimatedInputs: 1
    }),
    fundamentals,
    summary: {
      bull: fundamentals.plainBull,
      bear: fundamentals.plainBear,
      plainEnglish: `${symbol} is ${valuationRisk >= 70 ? "priced for growth" : valuationRisk <= 35 ? "not priced like hyper-growth" : "priced with a moderate growth premium"}. Policy exposure: ${policyExposure >= 60 ? "high" : policyExposure >= 30 ? "real" : "limited"} in mapped bills.`
    },
    metrics: metricExplanations(fundamentals),
    charts: {
      priceTrend: buildPriceSeries(symbol, quote),
      valuation: valuationBars(fundamentals),
      businessQuality: qualityBars(fundamentals),
      riskRadar: [
        { label: "Valuation sensitivity", value: valuationRisk, explain: "Higher means the stock has less room for disappointment." },
        { label: "Policy exposure", value: policyExposure, explain: "Highest legislative momentum among mapped bills touching this ticker." },
        { label: "Market volatility", value: volatilityRisk, explain: "Based on beta. Higher beta usually means wider daily swings." },
        { label: "Balance-sheet pressure", value: debtRiskScore(fundamentals.debtToEquity), explain: "Higher debt can reduce flexibility when rates are high." }
      ]
    },
    policyChains: buildPolicyChains(symbol, relatedBills),
    legisAlert: policyGraph.focusBills,
    stakeholderMap: policyGraph.stakeholderMap,
    apiExplanations: apiExplanations(symbol),
    promptHints: analysisPromptHints(symbol)
  });
}

async function policyNetwork(res, url) {
  const requested = String(url.searchParams.get("symbol") || "NVDA").toUpperCase().replace(/[^A-Z.]/g, "");
  const symbol = requested || "NVDA";
  sendJson(res, 200, buildPolicyNetwork(symbol));
}

function buildPolicyNetwork(symbol) {
  const focusSymbol = String(symbol || "NVDA").toUpperCase();
  const allBills = POLICY_BILLS.map((bill) => enrichPolicyBill(bill, focusSymbol));
  const focusBills = allBills.filter((bill) => (bill.affected || []).includes(focusSymbol));
  const source = {
    bills: process.env.CONGRESS_API_KEY ? "congress.gov + modeled impact layer" : "modeled bills",
    lobbying: process.env.SENATE_LDA_API_KEY ? "lda.gov + modeled relationship layer" : "modeled lobbying",
    relationships: "prototype stakeholder graph"
  };

  return {
    source,
    updatedAt: new Date().toISOString(),
    focusSymbol,
    confidence: scoreConfidence({
      missingInputs: focusBills.length ? 0 : 2
    }),
    summary: buildPolicySummary(focusSymbol, focusBills),
    allBills,
    focusBills,
    stakeholderMap: buildStakeholderMap(focusSymbol, focusBills.length ? focusBills : allBills.slice(0, 3))
  };
}

function enrichPolicyBill(bill, focusSymbol = "") {
  const metrics = augmentBillMetrics(bill);
  const model = POLICY_STAKEHOLDERS[bill.id] || emptyStakeholderModel(bill);
  const focusImpact = model.tickerImpacts.find((impact) => impact.symbol === focusSymbol) ||
    model.tickerImpacts.find((impact) => (bill.affected || []).includes(impact.symbol)) ||
    null;
  const topOpposition = model.lobbying
    .filter((item) => item.stance === "against")
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
  const topSupport = model.lobbying
    .filter((item) => item.stance === "for")
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];

  return {
    ...bill,
    ...metrics,
    relationshipSummary: focusImpact
      ? `${focusSymbol}: ${focusImpact.mechanism}`
      : bill.impact,
    focusImpact,
    stakeholders: {
      lawmakers: model.lawmakers,
      committees: model.committees,
      lobbying: model.lobbying
    },
    tickerImpacts: model.tickerImpacts,
    analog: model.analog,
    nextWatch: model.nextWatch,
    signalSteps: [
      {
        label: "Lobbying pressure",
        text: topOpposition
          ? `Lobbying pressure score ${metrics.lobbyingPressureScore}/100 (${metrics.lobbyingSignalConfidence} confidence). ${topOpposition.name} and aligned groups are spending against the bill, which signals revenue or margin risk.`
          : topSupport
            ? `Lobbying pressure score ${metrics.lobbyingPressureScore}/100 (${metrics.lobbyingSignalConfidence} confidence). ${topSupport.name} and aligned groups are spending for the bill, which signals they want faster implementation.`
            : `Lobbying pressure score ${metrics.lobbyingPressureScore}/100 (${metrics.lobbyingSignalConfidence} confidence). No large lobbying spike has been mapped yet.`
      },
      {
        label: "Congress path",
        text: `${bill.status} in the ${bill.chamber}. Latest action: ${bill.latestAction}. Legislative momentum: ${metrics.legislativeMomentum}/100 (${metrics.signalConfidence} confidence).`
      },
      {
        label: "Investor mechanism",
        text: focusImpact?.mechanism || bill.impact || "Translate the bill into revenue, margin, capex, or valuation multiple risk before acting."
      }
    ]
  };
}

function buildPolicySummary(symbol, bills) {
  if (!bills.length) {
    return {
      headline: `${symbol} has no mapped high-conviction bill pressure yet.`,
      detail: "Live bills can still appear in Congress.gov, but this prototype only flags the ones with a modeled stock channel.",
      riskLevel: "low"
    };
  }
  const strongest = bills.slice().sort((a, b) => Number(b.policyExposure || 0) - Number(a.policyExposure || 0))[0];
  const riskLevel = strongest.policyExposure >= 67 ? "high" : strongest.policyExposure >= 40 ? "medium" : "watch";
  return {
    headline: `${symbol} is linked to ${bills.length} policy ${bills.length === 1 ? "chain" : "chains"}.`,
    detail: `${strongest.title} is the highest-impact mapping: ${strongest.relationshipSummary}`,
    riskLevel
  };
}

function buildStakeholderMap(symbol, bills) {
  const nodes = new Map();
  const links = [];

  const addNode = (node) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addLink = (from, to, label, tone = "neutral", strength = 50) => {
    links.push({ from, to, label, tone, strength });
  };

  addNode({
    id: `ticker:${symbol}`,
    type: "ticker",
    label: symbol,
    detail: FUNDAMENTALS[symbol]?.name || "Focused ticker",
    tone: "green"
  });

  for (const bill of bills) {
    const model = POLICY_STAKEHOLDERS[bill.id] || emptyStakeholderModel(bill);
    const billId = `bill:${bill.id}`;
    addNode({
      id: billId,
      type: "bill",
      label: bill.id,
      title: bill.title,
      detail: `Legislative momentum ${bill.legislativeMomentum}/100 - ${bill.status}`,
      tone: bill.legislativeMomentum >= 67 ? "green" : bill.legislativeMomentum < 35 ? "red" : "amber"
    });
    if ((bill.affected || []).includes(symbol)) {
      addLink(billId, `ticker:${symbol}`, stockImpactChannel(symbol, bill), "green", Number(bill.legislativeMomentum || 0));
    }

    for (const lawmaker of model.lawmakers.slice(0, 4)) {
      const id = `person:${slug(lawmaker.name)}`;
      addNode({
        id,
        type: "person",
        label: lawmaker.name,
        detail: `${lawmaker.role} - ${lawmaker.party}-${lawmaker.state}`,
        tone: lawmaker.stance === "for" ? "green" : lawmaker.stance === "against" ? "red" : "amber"
      });
      addLink(id, billId, lawmaker.note, lawmaker.stance === "for" ? "green" : lawmaker.stance === "against" ? "red" : "amber", lawmaker.influence);
    }

    for (const committee of model.committees.slice(0, 3)) {
      const id = `committee:${slug(committee.name)}`;
      addNode({
        id,
        type: "committee",
        label: committee.name,
        detail: committee.role,
        tone: committee.stance === "stalled" ? "red" : committee.stance === "watch" ? "amber" : "green"
      });
      addLink(id, billId, committee.role, committee.stance === "stalled" ? "red" : "amber", committee.influence);
    }

    for (const lobbyist of model.lobbying.slice(0, 5)) {
      const id = `lobby:${slug(lobbyist.name)}`;
      const tone = lobbyist.stance === "against" ? "red" : lobbyist.stance === "for" ? "green" : "amber";
      addNode({
        id,
        type: "lobby",
        label: lobbyist.name,
        detail: `${compactDollars(lobbyist.amount)} ${lobbyist.stance} - ${lobbyist.issue}`,
        tone
      });
      addLink(id, billId, lobbyist.relationship, tone, Math.min(100, Math.round(Number(lobbyist.amount || 0) / 100000)));
      for (const ticker of lobbyist.tickers || []) {
        if (ticker === symbol) addLink(id, `ticker:${symbol}`, lobbyist.relationship, tone, 65);
      }
    }
  }

  return {
    symbol,
    nodes: [...nodes.values()],
    links: links.slice(0, 34),
    legend: [
      "People and committees shape bill movement.",
      "Lobbyists reveal where industries feel pressure.",
      "Bills affect stocks through revenue, margin, capex, or valuation."
    ]
  };
}

function emptyStakeholderModel(bill) {
  return {
    lawmakers: [],
    committees: [],
    lobbying: [],
    tickerImpacts: (bill.affected || []).map((symbol) => ({
      symbol,
      direction: "watch",
      impact: "Scenario watch",
      mechanism: bill.impact || "Impact channel not mapped yet."
    })),
    analog: "No historical analog mapped yet.",
    nextWatch: "Committee action, cosponsor changes, and lobbying filings."
  };
}

function compactDollars(value) {
  const amount = Number(value || 0);
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  if (amount >= 1e3) return `$${Math.round(amount / 1e3)}K`;
  return `$${amount.toFixed(0)}`;
}

function slug(value) {
  return String(value || "node")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function quoteSnapshot(symbol) {
  const fallbackRow = enrichStaticQuote(MARKET_FALLBACK[symbol]) || null;
  const token = process.env.FINNHUB_API_KEY;
  if (!token) return { source: "fallback", quote: fallbackRow };

  try {
    const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
    const response = await fetchWithTimeout(quoteUrl, {}, 7000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return {
      source: "finnhub",
      quote: mapFinnhubQuoteResponse(symbol, data)
    };
  } catch (error) {
    console.error(
      "Finnhub fetch failed:",
      error?.message || String(error),
      "symbol:",
      symbol,
      "falling back to static data"
    );
    return { source: "fallback", quote: fallbackRow };
  }
}

function metricExplanations(fundamentals) {
  const metrics = [
    {
      id: "pe",
      label: "P/E ratio",
      raw: fundamentals.pe,
      value: formatMultiple(fundamentals.pe),
      tone: fundamentals.pe > 55 ? "amber" : fundamentals.pe < 22 ? "green" : "neutral",
      plain: "What investors pay for $1 of current earnings.",
      takeaway: fundamentals.pe > 55
        ? "High P/E means the market expects big future growth. It can work, but misses get punished."
        : fundamentals.pe < 22
          ? "Lower P/E means expectations are more restrained, but it can also signal slower growth."
          : "Middle-range P/E: valuation matters, but earnings quality and growth matter just as much."
    },
    {
      id: "forwardPe",
      label: "Forward P/E",
      raw: fundamentals.forwardPe,
      value: formatMultiple(fundamentals.forwardPe),
      tone: fundamentals.forwardPe > 40 ? "amber" : fundamentals.forwardPe < 20 ? "green" : "neutral",
      plain: "What investors pay for next year's expected earnings.",
      takeaway: "If forward P/E is much lower than current P/E, analysts expect earnings to grow into the valuation."
    },
    {
      id: "ps",
      label: "Price / sales",
      raw: fundamentals.ps,
      value: formatMultiple(fundamentals.ps),
      tone: fundamentals.ps > 15 ? "amber" : fundamentals.ps < 5 ? "green" : "neutral",
      plain: "What investors pay for $1 of company revenue.",
      takeaway: "Useful when earnings are volatile. High P/S only makes sense if margins and growth are strong."
    },
    {
      id: "grossMargin",
      label: "Gross margin",
      raw: fundamentals.grossMargin,
      value: formatPercent(fundamentals.grossMargin),
      tone: fundamentals.grossMargin >= 55 ? "green" : fundamentals.grossMargin < 25 ? "amber" : "neutral",
      plain: "How much money remains after direct product costs.",
      takeaway: "Higher gross margin gives a business more room to invest, discount, and survive slowdowns."
    },
    {
      id: "revenueGrowth",
      label: "Revenue growth",
      raw: fundamentals.revenueGrowth,
      value: formatPercent(fundamentals.revenueGrowth),
      tone: fundamentals.revenueGrowth >= 20 ? "green" : fundamentals.revenueGrowth < 5 ? "amber" : "neutral",
      plain: "How fast sales are growing.",
      takeaway: "Growth is the fuel that can justify a premium valuation. Slowing growth makes high multiples fragile."
    },
    {
      id: "beta",
      label: "Beta",
      raw: fundamentals.beta,
      value: fundamentals.beta == null ? "N/A" : Number(fundamentals.beta).toFixed(2),
      tone: fundamentals.beta >= 1.6 ? "amber" : fundamentals.beta <= 0.8 ? "green" : "neutral",
      plain: "How jumpy the stock tends to be compared with the market.",
      takeaway: "Beta above 1 usually means bigger swings than the S&P 500. That cuts both ways."
    }
  ];
  return metrics.filter((metric) => metric.raw != null);
}

function valuationBars(fundamentals) {
  return [
    { label: "P/E", value: capScore(Number(fundamentals.pe || 0), 80), display: formatMultiple(fundamentals.pe), explain: "Current earnings multiple" },
    { label: "Forward P/E", value: capScore(Number(fundamentals.forwardPe || 0), 60), display: formatMultiple(fundamentals.forwardPe), explain: "Next-year earnings multiple" },
    { label: "P/S", value: capScore(Number(fundamentals.ps || 0), 35), display: formatMultiple(fundamentals.ps), explain: "Revenue multiple" }
  ].filter((item) => item.display !== "N/A");
}

function qualityBars(fundamentals) {
  const debt = fundamentals.debtToEquity == null ? null : Math.max(0, 100 - capScore(Number(fundamentals.debtToEquity), 2.5));
  return [
    { label: "Gross margin", value: Number(fundamentals.grossMargin || 0), display: formatPercent(fundamentals.grossMargin), explain: "Pricing power and cost control" },
    { label: "Revenue growth", value: capScore(Number(fundamentals.revenueGrowth || 0), 60), display: formatPercent(fundamentals.revenueGrowth), explain: "Top-line momentum" },
    { label: "Free cash flow", value: capScore(Number(fundamentals.freeCashFlowMargin || 0), 40), display: formatPercent(fundamentals.freeCashFlowMargin), explain: "Cash generation after reinvestment" },
    { label: "Balance sheet", value: debt, display: fundamentals.debtToEquity == null ? "N/A" : `${Number(fundamentals.debtToEquity).toFixed(2)}x D/E`, explain: "Higher score means less debt pressure" }
  ].filter((item) => item.value != null && item.display !== "N/A");
}

function buildPriceSeries(symbol, quote) {
  const price = Number(quote.price || MARKET_FALLBACK[symbol]?.price || 100);
  const beta = Number(FUNDAMENTALS[symbol]?.beta || 1);
  const seed = symbol.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const points = [];
  const count = 48;
  const slope = Number(quote.pct || 0) / 100;
  for (let i = 0; i < count; i += 1) {
    const progress = i / (count - 1);
    const seasonal = Math.sin((i + seed) / 4) * beta * 0.012;
    const pulse = Math.cos((i + seed) / 7) * 0.007;
    const value = price * (1 - slope * (1 - progress) + seasonal + pulse);
    points.push({
      label: i % 8 === 0 ? `${count - i}d` : "",
      value: Number(value.toFixed(2))
    });
  }
  points[count - 1].value = Number(price.toFixed(2));
  points[count - 1].label = "now";
  return points;
}

function buildHistoricalSeries(symbol, range, quote) {
  const count = historyPointCount(range);
  const price = Number(quote.price || MARKET_FALLBACK[symbol]?.price || 100);
  const beta = Number(FUNDAMENTALS[symbol]?.beta || 1);
  const seed = symbol.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const dailySlope = Number(quote.pct || 0) / 100 / Math.max(10, count / 2);
  const intraday = range === "1d" || range === "1w";
  const stepMs = range === "1d" ? 5 * 60000 : range === "1w" ? 30 * 60000 : 86400000;
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const stepsBack = count - 1 - i;
    const drift = 1 - dailySlope * stepsBack;
    const wave = Math.sin((i + seed) / 8) * beta * 0.035 + Math.cos((i + seed) / 17) * 0.028;
    const close = Math.max(1, price * (drift + wave));
    const open = close * (1 + Math.sin((i + seed) / 5) * 0.006);
    const high = Math.max(open, close) * (1 + 0.006 + Math.abs(Math.cos(i + seed)) * 0.009);
    const low = Math.min(open, close) * (1 - 0.006 - Math.abs(Math.sin(i + seed)) * 0.009);
    const date = intraday
      ? new Date(Date.now() - stepsBack * stepMs).toISOString().slice(0, 16)
      : new Date(Date.now() - stepsBack * 86400000).toISOString().slice(0, 10);
    points.push({
      date,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.round(1000000 + Math.abs(Math.sin(i + seed)) * 9000000)
    });
  }
  points[points.length - 1].close = Number(price.toFixed(2));
  return points;
}

function historyPointCount(range) {
  return {
    "1d": 78,
    "1w": 65,
    "1m": 22,
    "3m": 66,
    "6m": 126,
    "1y": 252,
    "5y": 260
  }[range] || 126;
}

function rangeSeconds(range) {
  return {
    "1d": 30 * 60 * 60,
    "1w": 8 * 86400,
    "1m": 35 * 86400,
    "3m": 100 * 86400,
    "6m": 200 * 86400,
    "1y": 390 * 86400,
    "5y": 1850 * 86400
  }[range] || 200 * 86400;
}

function historyStats(points) {
  const closes = points.map((point) => Number(point.close || 0)).filter(Boolean);
  if (!closes.length) return {};
  const first = closes[0];
  const last = closes[closes.length - 1];
  const max = Math.max(...closes);
  const min = Math.min(...closes);
  const change = last - first;
  return {
    first,
    last,
    high: max,
    low: min,
    change,
    pct: first ? (change / first) * 100 : 0
  };
}

async function stooqHistory(symbol, fromUnix, toUnix) {
  try {
    const stooqSymbol = `${symbol.toLowerCase().replace(".", "-")}.us`;
    const d1 = dateForStooq(new Date(fromUnix * 1000));
    const d2 = dateForStooq(new Date(toUnix * 1000));
    const response = await fetchWithTimeout(`https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&d1=${d1}&d2=${d2}&i=d`, {}, 9000);
    if (!response.ok) throw new Error(`stooq_${response.status}`);
    const csv = await response.text();
    const rows = csv.trim().split(/\r?\n/).slice(1);
    return rows.map((row) => {
      const [date, open, high, low, close, volume] = row.split(",");
      return {
        date,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume || 0)
      };
    }).filter((point) => point.date && Number.isFinite(point.close));
  } catch {
    return [];
  }
}

async function yahooHistory(symbol, range) {
  try {
    const interval = range === "1d" ? "5m" : range === "1w" ? "30m" : range === "1y" || range === "5y" ? "1wk" : "1d";
    const yahooRange = range === "1w" ? "5d" : range === "5y" ? "5y" : range;
    const response = await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${encodeURIComponent(yahooRange)}`, {}, 9000);
    if (!response.ok) throw new Error(`yahoo_${response.status}`);
    const data = await response.json();
    const result = data.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const quote = result?.indicators?.quote?.[0] || {};
    const closes = quote.close || [];
    return closes.map((close, index) => {
      if (close == null || !timestamps[index]) return null;
      const iso = new Date(timestamps[index] * 1000).toISOString();
      return {
        date: iso.slice(0, range === "1d" || range === "1w" ? 16 : 10),
        open: Number(quote.open?.[index] || close),
        high: Number(quote.high?.[index] || close),
        low: Number(quote.low?.[index] || close),
        close: Number(close),
        volume: Number(quote.volume?.[index] || 0)
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function dateForStooq(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function buildPolicyChains(symbol, bills) {
  if (!bills.length) {
    return [{
      title: "No mapped bill pressure",
      tone: "neutral",
      summary: `${symbol} does not currently have a high-confidence bill mapping in this prototype.`,
      steps: [
        { label: "Live bill feed", text: "Congress.gov still loads records, but no ticker impact has been mapped yet." },
        { label: "Investor action", text: "Treat this as market/fundamental analysis until a bill is tagged to the company or sector." }
      ]
    }];
  }

  return bills.map((bill) => {
    const against = Number(bill.lobbyingAgainst || 0);
    const lobbyingText = against >= 10
      ? `$${against.toFixed(1)}M lobbying against means opponents are taking the threat seriously.`
      : Number(bill.lobbyingFor || 0) >= 10
        ? `$${Number(bill.lobbyingFor).toFixed(1)}M lobbying for means the industry wants implementation speed.`
        : "Lobbying is present, but not yet a panic signal.";
    const lm = computeLegislativeMomentum(bill);
    const conf = billSignalConfidence(bill);
    return {
      title: `${bill.title} -> ${symbol}`,
      tone: lm >= 67 ? "green" : lm < 35 ? "red" : "amber",
      summary: stockImpactChannel(symbol, bill),
      steps: [
        { label: "1. Filing signal", text: lobbyingText },
        { label: "2. Bill pressure", text: `${bill.status} status. Legislative momentum ${lm}/100. Policy exposure ${lm}/100 · Confidence ${conf}. Latest action: ${bill.latestAction}.` },
        { label: "3. Stock channel", text: stockImpactChannel(symbol, bill) },
        { label: "4. Plain-English read", text: "The filing does not move the stock by itself. It tells you where political pressure is building before the market fully prices the scenario." }
      ]
    };
  });
}

function stockImpactChannel(symbol, bill) {
  const title = bill.title.toLowerCase();
  if (title.includes("drug") && symbol === "LLY") return "If Medicare negotiation expands, Lilly's GLP-1 pricing power becomes the market question.";
  if (title.includes("chips") && ["NVDA", "AMD", "TSM"].includes(symbol)) return "CHIPS implementation lowers supply-chain risk and can support semiconductor capex expectations.";
  if (title.includes("platform") && ["AMZN", "AAPL", "GOOGL", "META"].includes(symbol)) return "If platform regulation dies, the antitrust discount can fade. If it revives, margins and product placement get questioned.";
  if (title.includes("digital asset") && symbol === "COIN") return "Crypto market-structure clarity can lower regulatory uncertainty for Coinbase and institutional custody.";
  if (title.includes("permitting") && symbol === "TSLA") return "Faster permitting can help factories, charging, and energy projects move faster, but it does not solve EV demand by itself.";
  return bill.impact || "Map the bill mechanism to revenue, margin, capex, or valuation multiple before treating it as a trade signal.";
}

function apiExplanations(symbol) {
  return [
    {
      name: "Finnhub quotes",
      status: process.env.FINNHUB_API_KEY ? "connected" : "fallback",
      what: "Live or fallback stock prices, daily change, open, high, and low.",
      investorUse: "Shows what the market is doing now, but price alone does not explain why.",
      causalChain: "Quote move -> compare against fundamentals and policy events -> decide whether the move is noise or scenario repricing."
    },
    {
      name: "Congress.gov",
      status: process.env.CONGRESS_API_KEY ? "connected" : "fallback",
      what: "Bill titles, chamber, latest action, and legislative status.",
      investorUse: "Committee movement and floor action can turn a political idea into a market event.",
      causalChain: "Bill advances -> legislative momentum rises -> affected ticker risk/reward changes."
    },
    {
      name: "LDA.gov lobbying",
      status: process.env.SENATE_LDA_API_KEY ? "connected" : "fallback",
      what: "Lobbying filings, clients, registrants, issue areas, and spend when available.",
      investorUse: "A sudden spend spike often means the industry thinks the bill has teeth.",
      causalChain: "Lobbyist filing -> pressure around a bill -> investors reassess stock revenue, margins, or regulation risk."
    },
    {
      name: "CoinGecko crypto",
      status: process.env.COINGECKO_API_KEY ? "connected" : "public/fallback",
      what: "Crypto spot prices, 24-hour change, and market cap.",
      investorUse: symbol === "COIN" ? "Helps connect crypto market activity to Coinbase transaction and custody economics." : "Useful for crypto exposure and risk mood.",
      causalChain: "Crypto price/volume regime -> exchange activity changes -> crypto-linked equities reprice."
    },
    {
      name: "Alpaca paper trading",
      status: process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY ? "connected" : "simulated",
      what: "Paper account and order submission.",
      investorUse: "Lets you test the thesis without turning analysis into real-money execution.",
      causalChain: "Thesis -> paper order -> track outcome -> improve the model before risking capital."
    }
  ];
}

function analysisPromptHints(symbol) {
  return [
    `Explain ${symbol}'s P/E ratio in one paragraph for a beginner.`,
    `Which bill could move ${symbol}, and what is the revenue or margin mechanism?`,
    `Build a bull, base, and bear scenario for ${symbol} using valuation plus policy risk.`
  ];
}

function valuationRiskScore(fundamentals) {
  const pe = capScore(Number(fundamentals.pe || 0), 80);
  const ps = capScore(Number(fundamentals.ps || 0), 30);
  return Math.round((pe * 0.65) + (ps * 0.35));
}

function debtRiskScore(debtToEquity) {
  if (debtToEquity == null) return 28;
  return capScore(Number(debtToEquity), 2.5);
}

function capScore(value, max) {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

function formatMultiple(value) {
  return value == null ? "N/A" : `${Number(value).toFixed(1)}x`;
}

function formatPercent(value) {
  return value == null ? "N/A" : `${Number(value).toFixed(1)}%`;
}

async function cryptoPrices(res, url) {
  const ids = (url.searchParams.get("ids") || "bitcoin,ethereum,solana")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 25);
  const key = process.env.COINGECKO_API_KEY;
  const pro = process.env.COINGECKO_PRO === "true";
  const base = pro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
  const priceUrl = `${base}/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true&include_last_updated_at=true`;
  const headers = key ? { [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key } : {};

  const cryptoDisplayName = (id) =>
    ({ bitcoin: "Bitcoin", ethereum: "Ethereum", solana: "Solana" }[id] || id.replace(/-/g, " "));

  try {
    const response = await fetchWithTimeout(priceUrl, { headers }, 7000);
    if (!response.ok) throw new Error(`coingecko_${response.status}`);
    const data = await response.json();
    const assets = Object.entries(data).map(([id, value]) => ({
      id,
      name: cryptoDisplayName(id),
      symbol: id === "bitcoin" ? "BTC" : id === "ethereum" ? "ETH" : id === "solana" ? "SOL" : id.toUpperCase(),
      price: value.usd,
      pct: value.usd_24h_change,
      change24h: value.usd_24h_change,
      marketCap: value.usd_market_cap,
      lastUpdatedAt: value.last_updated_at ? new Date(value.last_updated_at * 1000).toISOString() : null
    }));
    sendJson(res, 200, {
      source: key ? "coingecko" : "coingecko_public",
      assets,
      confidence: key ? "High" : "Medium",
      updatedAt: new Date().toISOString()
    });
  } catch {
    const assets =
      ids.length > 0
        ? ids.map((id) => {
            const row = CRYPTO_FALLBACK[id];
            if (row && row.price != null) {
              return { id, change24h: row.pct, ...row };
            }
            return {
              id,
              name: `${cryptoDisplayName(id)} (offline sample)`,
              symbol: id === "bitcoin" ? "BTC" : id === "ethereum" ? "ETH" : id === "solana" ? "SOL" : id.slice(0, 4).toUpperCase(),
              price: null,
              pct: null,
              change24h: null,
              marketCap: null,
              placeholder: true
            };
          })
        : Object.entries(CRYPTO_FALLBACK).map(([id, row]) => ({ id, change24h: row.pct, ...row }));
    sendJson(res, 200, {
      source: "fallback",
      assets,
      confidence: "Medium",
      updatedAt: new Date().toISOString()
    });
  }
}

async function congressBills(res, url) {
  const key = process.env.CONGRESS_API_KEY;
  const query = (url.searchParams.get("q") || "").toLowerCase();

  if (!key) {
    return sendJson(res, 200, {
      source: "fallback",
      bills: filterBills(POLICY_BILLS.map(decorateBill), query),
      confidence: "Medium",
      updatedAt: new Date().toISOString()
    });
  }

  try {
    const billUrl = `https://api.congress.gov/v3/bill?format=json&limit=20&api_key=${encodeURIComponent(key)}`;
    const response = await fetchWithTimeout(billUrl, {}, 9000);
    if (!response.ok) throw new Error(`congress_${response.status}`);
    const data = await response.json();
    const liveBills = (data.bills || []).map((bill) => decorateBill(normalizeLiveCongressBill(bill)));
    sendJson(res, 200, {
      source: "congress.gov",
      bills: filterBills([...POLICY_BILLS.map(decorateBill), ...liveBills], query),
      confidence: "High",
      updatedAt: new Date().toISOString()
    });
  } catch {
    sendJson(res, 200, {
      source: "fallback",
      bills: filterBills(POLICY_BILLS.map(decorateBill), query),
      confidence: "Medium",
      updatedAt: new Date().toISOString()
    });
  }
}

async function lobbying(res) {
  try {
    const headers = process.env.SENATE_LDA_API_KEY
      ? { Authorization: `Token ${process.env.SENATE_LDA_API_KEY}` }
      : {};
    const response = await fetchWithTimeout("https://lda.gov/api/v1/filings/?limit=20&ordering=-dt_posted&format=json", { headers }, 9000);
    if (!response.ok) throw new Error(`lda_${response.status}`);
    const data = await response.json();
    const filings = (data.results || []).map((item) => decorateLobbyingFiling({
      client: item.client?.name || "Unknown client",
      registrant: item.registrant?.name || "Unknown registrant",
      amount: Number(item.amount || item.expenses || 0),
      issue: (item.issues || []).slice(0, 3).join(", ") || "Issue not listed",
      spike: null,
      portfolio: false,
      postedAt: item.dt_posted || null
    }));
    sendJson(res, 200, {
      source: "senate_lda",
      filings: filings.length ? filings : LOBBYING_FALLBACK.map((row) => decorateLobbyingFiling({ ...row, postedAt: row.postedAt || "2026-04-01" })),
      confidence: filings.length ? "High" : "Medium",
      updatedAt: new Date().toISOString()
    });
  } catch {
    sendJson(res, 200, {
      source: "fallback",
      filings: LOBBYING_FALLBACK.map((row) => decorateLobbyingFiling({ ...row, postedAt: row.postedAt || "2026-04-01" })),
      confidence: "Medium",
      updatedAt: new Date().toISOString()
    });
  }
}

async function paperAccount(res, session) {
  const store = await readPaperStore();
  const key = paperAccountKey(session);
  const account = ensurePaperAccount(store, key);
  const snapshot = await paperSnapshot(account);
  await writePaperStore(store);
  sendJson(res, 200, snapshot);
}

async function paperOrder(req, res, session) {
  const order = await readJson(req);
  const symbol = String(order.symbol || "").toUpperCase().replace(/[^A-Z.]/g, "");
  const qty = Number(order.qty);
  const side = order.side === "sell" ? "sell" : "buy";
  if (!symbol || !Number.isFinite(qty) || qty <= 0) {
    return sendJson(res, 400, { error: "invalid_order", message: "Symbol and positive quantity are required." });
  }

  const quoteResult = await quoteSnapshot(symbol);
  const quote = quoteResult.quote || enrichStaticQuote(MARKET_FALLBACK[symbol]);
  if (!quote || !Number(quote.price)) {
    return sendJson(res, 400, { error: "quote_unavailable", message: "No quote is available for that symbol." });
  }

  const store = await readPaperStore();
  const key = paperAccountKey(session);
  const account = ensurePaperAccount(store, key);
  const price = Number(quote.price);
  const notional = price * qty;
  const existing = account.positions[symbol] || { symbol, qty: 0, avgCost: 0 };

  if (side === "buy") {
    if (notional > account.cash + 0.0001) {
      return sendJson(res, 400, {
        error: "insufficient_cash",
        message: `This paper account has ${formatCurrency(account.cash)} buying power available.`
      });
    }
    const newQty = existing.qty + qty;
    const newCost = (existing.qty * existing.avgCost) + notional;
    account.cash = Number((account.cash - notional).toFixed(2));
    account.positions[symbol] = {
      symbol,
      qty: Number(newQty.toFixed(6)),
      avgCost: Number((newCost / newQty).toFixed(4))
    };
  } else {
    if (!existing.qty || qty > existing.qty + 0.000001) {
      return sendJson(res, 400, {
        error: "insufficient_shares",
        message: `You only have ${existing.qty || 0} paper shares of ${symbol}.`
      });
    }
    const newQty = existing.qty - qty;
    account.cash = Number((account.cash + notional).toFixed(2));
    if (newQty <= 0.000001) delete account.positions[symbol];
    else account.positions[symbol] = { ...existing, qty: Number(newQty.toFixed(6)) };
  }

  const payload = {
    id: `paper_${randomBytes(8).toString("hex")}`,
    symbol,
    qty,
    side,
    price,
    notional: Number(notional.toFixed(2)),
    status: "filled",
    type: "market",
    submittedAt: new Date().toISOString(),
    source: quoteResult.source
  };
  account.orders.unshift(payload);
  account.orders = account.orders.slice(0, 50);
  account.updatedAt = new Date().toISOString();
  await writePaperStore(store);
  sendJson(res, 200, { source: "local_paper", mode: "paper-simulated", order: payload, ...(await paperSnapshot(account)) });
}

async function paperSnapshot(account) {
  const positionList = Object.values(account.positions || {});
  const quotes = await Promise.all(positionList.map((position) => quoteSnapshot(position.symbol)));
  const positions = positionList.map((position, index) => {
    const snap = quotes[index];
    const rawQuote =
      snap?.quote ||
      enrichStaticQuote(MARKET_FALLBACK[position.symbol]) ||
      {};
    let livePrice = Number(rawQuote.price);
    let priceBasis = "market";
    if (!Number.isFinite(livePrice) || livePrice <= 0) {
      livePrice = Number(position.avgCost || 0);
      priceBasis = "cost_basis_fallback";
    }
    const marketValue = livePrice * Number(position.qty || 0);
    const costBasis = Number(position.avgCost || 0) * Number(position.qty || 0);
    const unrealizedPnl = marketValue - costBasis;
    return {
      ...position,
      price: livePrice,
      priceBasis,
      marketValue: Number(marketValue.toFixed(2)),
      costBasis: Number(costBasis.toFixed(2)),
      unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
      unrealizedPnlPct: costBasis ? (unrealizedPnl / costBasis) * 100 : 0,
      dayPct: Number(rawQuote.pct ?? rawQuote.changePercent ?? 0)
    };
  });
  const investedValue = positions.reduce((sum, position) => sum + position.marketValue, 0);
  const equity = account.cash + investedValue;
  const totalReturn = equity - PAPER_STARTING_CASH;
  return {
    source: "local_paper",
    mode: "paper-simulated",
    account: {
      status: "ready",
      currency: "USD",
      startingCash: PAPER_STARTING_CASH,
      cash: Number(account.cash.toFixed(2)),
      buyingPower: Number(account.cash.toFixed(2)),
      equity: Number(equity.toFixed(2)),
      portfolioValue: Number(investedValue.toFixed(2)),
      totalReturn: Number(totalReturn.toFixed(2)),
      totalReturnPct: (totalReturn / PAPER_STARTING_CASH) * 100,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    },
    positions,
    orders: account.orders || [],
    explain: "Every new user starts with $100,000 of local simulated cash. Orders fill at the current quote for practice only."
  };
}

async function readPaperStore() {
  try {
    return JSON.parse(await readFile(PAPER_ACCOUNTS_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writePaperStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(PAPER_ACCOUNTS_FILE, JSON.stringify(store, null, 2), "utf8");
}

function ensurePaperAccount(store, key) {
  if (!store[key]) {
    store[key] = {
      cash: PAPER_STARTING_CASH,
      positions: {},
      orders: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
  return store[key];
}

function paperAccountKey(session) {
  return String(session?.user?.id || session?.user?.email || "demo-user").replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

let tickerMapPromise = null;

function loadTickerMap() {
  if (!tickerMapPromise) {
    tickerMapPromise = (async () => {
      const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
        headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json" }
      });
      if (!res.ok) throw new Error("SEC company_tickers.json HTTP " + res.status);
      const obj = await res.json();
      const m = new Map();
      for (const k of Object.keys(obj)) {
        const row = obj[k];
        if (row?.ticker && row.cik_str != null) {
          m.set(String(row.ticker).toUpperCase(), String(row.cik_str).padStart(10, "0"));
        }
      }
      return m;
    })();
  }
  return tickerMapPromise;
}

function findLatest10K(recent) {
  const { form, filingDate, accessionNumber, primaryDocument } = recent;
  for (let i = 0; i < form.length; i++) {
    if (form[i] === "10-K") {
      return {
        form: form[i],
        filingDate: filingDate[i],
        accessionNumber: accessionNumber[i],
        primaryDocument: primaryDocument[i]
      };
    }
  }
  return null;
}

function accessionDir(accession) {
  return accession.replace(/-/g, "");
}

function stripHtmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractItem1ARiskFactors(html) {
  const patterns = [
    /ITEM\s*1A[.\s\u00A0]*RISK\s*FACTORS([\s\S]*?)ITEM\s*1B/gi,
    /Item\s*1A[.\s\u00A0]*Risk\s*Factors([\s\S]*?)Item\s*1B/gi,
    /ITEM\s*1A([\s\S]{800,}?)ITEM\s*1B/gi,
    /Item\s*1A([\s\S]{800,}?)Item\s*1B/gi
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      const t = stripHtmlToText(m[1]);
      if (t.length > 400) return t.slice(0, 120000);
    }
  }
  const m2 = html.match(/RISK\s*FACTORS([\s\S]{600,25000}?)ITEM\s*1B/gi);
  if (m2) {
    const t = stripHtmlToText(m2[0]);
    if (t.length > 400) return t.slice(0, 120000);
  }
  return "";
}

async function fetchEdgarRisk(symbol) {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) throw new Error("Invalid symbol");

  const tickers = await loadTickerMap();
  const cik10 = tickers.get(sym);
  if (!cik10) throw new Error("Ticker not found in SEC company_tickers");

  const subUrl = `https://data.sec.gov/submissions/CIK${cik10}.json`;
  const sRes = await fetch(subUrl, {
    headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json" }
  });
  if (!sRes.ok) throw new Error("data.sec.gov submissions HTTP " + sRes.status);
  const sub = await sRes.json();
  const recent = sub.filings?.recent;
  if (!recent) throw new Error("No filings.recent on submission");

  const tenk = findLatest10K(recent);
  if (!tenk) throw new Error("No 10-K in recent filings list");

  const cikInt = String(parseInt(cik10, 10));
  const dir = accessionDir(tenk.accessionNumber);
  const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${dir}/${tenk.primaryDocument}`;

  const hRes = await fetch(docUrl, {
    headers: { "User-Agent": SEC_USER_AGENT, Accept: "text/html,*/*" }
  });
  if (!hRes.ok) throw new Error("Archives filing HTTP " + hRes.status);
  const html = await hRes.text();

  let risk = extractItem1ARiskFactors(html);
  if (!risk) {
    const fallback = stripHtmlToText(html);
    risk = fallback.length > 800 ? fallback.slice(0, 15000) : "";
  }

  return {
    symbol: sym,
    cik: cik10,
    company: sub.name || null,
    form: tenk.form,
    filingDate: tenk.filingDate,
    accessionNumber: tenk.accessionNumber,
    primaryDocument: tenk.primaryDocument,
    sourceUrl: docUrl,
    riskFactors: risk
  };
}

async function edgarRiskFactors(res, pathname) {
  try {
    const raw = decodeURIComponent(pathname.slice("/api/edgar/".length));
    const sym = raw.split(/[./]/)[0] || "";
    const data = await fetchEdgarRisk(sym);
    if (!String(data.riskFactors || "").trim()) {
      return sendJson(res, 200, { message: "Risk factors section unavailable for this filing." });
    }
    sendJson(res, 200, data);
  } catch (e) {
    const msg = e.message || String(e);
    let code = 502;
    if (/Invalid symbol/.test(msg)) code = 400;
    sendJson(res, code, { error: msg });
  }
}

async function contractsByCompany(res, pathname) {
  try {
    const company = decodeURIComponent(pathname.slice("/api/contracts/".length)).trim();
    if (!company) return sendJson(res, 400, { error: "missing_company" });

    const response = await fetchWithTimeout(
      "https://api.usaspending.gov/api/v2/search/spending_by_award/",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: {
            keywords: [company],
            award_type_codes: ["A", "B", "C", "D"]
          },
          fields: [
            "Recipient Name",
            "Awarding Agency",
            "Award Amount",
            "Start Date",
            "End Date",
            "Period of Performance Start Date",
            "Period of Performance Current End Date"
          ],
          sort: "Award Amount",
          order: "desc",
          page: 1,
          limit: 10
        })
      },
      12000
    );
    if (!response.ok) throw new Error(`usaspending_contracts_${response.status}`);
    const data = await response.json();
    const results = (data.results || []).slice(0, 10).map((row) => ({
      recipientName: row["Recipient Name"] || null,
      awardingAgency: row["Awarding Agency"] || null,
      obligatedAmount: Number(row["Award Amount"] || 0),
      periodOfPerformance: {
        startDate: row["Period of Performance Start Date"] || row["Start Date"] || null,
        endDate: row["Period of Performance Current End Date"] || row["End Date"] || null
      }
    }));
    sendJson(res, 200, { company, results });
  } catch (e) {
    sendJson(res, 502, { error: e.message || String(e) });
  }
}

async function agencyBudget(res, pathname) {
  try {
    const agencyCode = decodeURIComponent(pathname.slice("/api/agency-budget/".length)).trim();
    if (!agencyCode) return sendJson(res, 400, { error: "missing_agency_code" });
    const response = await fetchWithTimeout(
      `https://api.usaspending.gov/api/v2/agency/${encodeURIComponent(agencyCode)}/budgetary_resources/`,
      {},
      12000
    );
    if (!response.ok) throw new Error(`usaspending_agency_budget_${response.status}`);
    const data = await response.json();
    const byFiscalYear = {};
    for (const row of data.budgetary_resources || []) {
      const fy = row.fiscal_year ?? row.year;
      const amount =
        Number(row.total_budgetary_resources ?? row.budgetary_resources_amount ?? row.amount ?? 0);
      if (fy == null) continue;
      byFiscalYear[String(fy)] = (byFiscalYear[String(fy)] || 0) + amount;
    }
    sendJson(res, 200, { agencyCode, byFiscalYear });
  } catch (e) {
    sendJson(res, 502, { error: e.message || String(e) });
  }
}

function recentAppointments(res) {
  // TODO: Replace with live Federal Register or Senate confirmation feed when available.
  sendJson(res, 200, [
    { name: "Alex Harper", role: "Secretary", agency: "Department of Commerce", priorEmployer: "Global Tech Advisors", confirmedDate: "2026-04-29" },
    { name: "Dana Liu", role: "Deputy Secretary", agency: "Department of Energy", priorEmployer: "National Grid Partners", confirmedDate: "2026-04-24" },
    { name: "Marcus Reed", role: "Administrator", agency: "Environmental Protection Agency", priorEmployer: "Clean Future Institute", confirmedDate: "2026-04-18" },
    { name: "Priya Natarajan", role: "Under Secretary", agency: "Department of the Treasury", priorEmployer: "Civic Capital", confirmedDate: "2026-04-12" },
    { name: "Elena Torres", role: "Commissioner", agency: "Federal Trade Commission", priorEmployer: "State Attorney General Office", confirmedDate: "2026-04-08" },
    { name: "Noah Whitman", role: "Director", agency: "Office of Management and Budget", priorEmployer: "Brookfield Policy Group", confirmedDate: "2026-04-03" },
    { name: "Rachel Kim", role: "Assistant Secretary", agency: "Department of Health and Human Services", priorEmployer: "MedCore Systems", confirmedDate: "2026-03-28" },
    { name: "Owen Patel", role: "Chair", agency: "Federal Communications Commission", priorEmployer: "Public Spectrum Alliance", confirmedDate: "2026-03-21" },
    { name: "Maya Sullivan", role: "Administrator", agency: "Small Business Administration", priorEmployer: "Main Street Ventures", confirmedDate: "2026-03-16" },
    { name: "Victor Chen", role: "General Counsel", agency: "Department of Transportation", priorEmployer: "Transit Infrastructure Partners", confirmedDate: "2026-03-10" }
  ]);
}

function formatHistoricalAnalogForPrompt(bill) {
  const h = bill.historicalAnalog || bill.analog;
  if (!h) return "None in TradeSimple seed data — do not invent one.";
  if (typeof h === "string") return h;
  const parts = [h.title, h.outcome, h.impact].filter(Boolean);
  return parts.length ? parts.join(" — ") : "None in seed data.";
}

function buildBillWhyUserContent(bill) {
  const statusKey = normalizeStatusKey(bill.status);
  const mom = computeLegislativeMomentum(bill);
  const conf = billSignalConfidence(bill);
  const sp = subscoreStageProgress(statusKey);
  const se = subscoreSponsorEffectiveness(bill);
  const cs = subscoreCosponsorStrength(bill);
  const bb = subscoreBipartisanBreadth(bill);
  const cm = subscoreCommitteeSchedule(bill);
  const rc = subscoreRecencyDays(bill.latestActionDate);
  const te = subscoreTextEnactability(bill);
  const tr = subscoreTimeRemaining(bill);
  const weighted =
    0.25 * sp +
    0.15 * se +
    0.15 * cs +
    0.1 * bb +
    0.1 * cm +
    0.1 * rc +
    0.1 * te +
    0.05 * tr;
  const sponsor = bill.sponsor
    ? `${bill.sponsor.name} (${bill.sponsor.party}-${bill.sponsor.state})`
    : "—";
  const committees = Array.isArray(bill.committees) ? bill.committees.join("; ") : "—";
  const portfolioTickers =
    (bill.portfolioTickers || bill.affected || []).filter(Boolean).join(", ") || "—";
  const sig = bill.signals || {};

  return `The user clicked "Ask why" on a legislative alert for this bill. Explain WHY the scores read the way they do — what each input means, how the weights combine, and what is still uncertain.

CONTEXT — figures below are from TradeSimple's in-app bill seed data and scoring models (scenario / illustrative unless your workflow explicitly synced live Congress.gov or LDA).

Bill: ${bill.id}
Title: ${bill.title}
Short title: ${bill.shortTitle || "—"}
Chamber: ${bill.chamber || "—"} · Stage status: ${bill.status}
Plain-language summary: ${bill.plainEnglish || "—"}

Tickers linked in app (portfolio / affected): ${portfolioTickers}
Sponsor: ${sponsor}
Cosponsors: ${bill.cosponsors ?? "—"} total · ${bill.bipartisanCosponsors ?? "—"} bipartisan · Floor scheduled: ${bill.floorScheduled ? "yes" : "no"}
Committees: ${committees}
Last action (${bill.latestActionDate || "—"}): ${bill.latestAction || "—"}

Lobbying scenario ($M in seed data): FOR $${bill.lobbyingFor ?? "—"}M · AGAINST $${bill.lobbyingAgainst ?? "—"}M
Note: ${bill.lobbyingNote || bill.signal || "—"}

Curated signal indices (0–100 when present): bipartisan ${sig.bipartisanScore ?? "—"}, committee ${sig.committeeScore ?? "—"}, floor ${sig.floorScore ?? "—"}, historical ${sig.historicalScore ?? "—"}

Model sub-scores (each 0–100 before weighting):
- Stage progress: ${sp} (weight 25%)
- Sponsor effectiveness: ${se} (15%)
- Cosponsor strength: ${cs} (15%)
- Bipartisan breadth: ${bb} (10%)
- Committee schedule: ${cm} (10%)${bill.floorScheduled ? " (includes floor-scheduled boost)" : ""}
- Recency (from latestActionDate): ${rc} (10%)
- Text enactability (historical/floor blend): ${te} (10%)
- Time remaining (calendar proxy): ${tr} (5%)

Weighted blend (before clamp): ${weighted.toFixed(1)} → Legislative momentum shown in-app: ${mom}/100
Overall data confidence label: ${conf}

Historical analog in seed data (verify before treating as market fact): ${formatHistoricalAnalogForPrompt(bill)}

Answer in the required structure. If any analog or number should not be relied on without checking primary sources, say so. For position impact on named tickers, include the disclosure line.`;
}

function localBillWhyAnswer(bill, name) {
  const mom = computeLegislativeMomentum(bill);
  const conf = billSignalConfidence(bill);
  const analog = formatHistoricalAnalogForPrompt(bill);
  const greet = name && name !== "there" ? `${name}, ` : "";
  return `Research signal only. Not financial advice.

${greet}Here is a compact read on ${bill.id} without the live AI layer: legislative momentum is modeled at ${mom}/100 (${conf} data confidence). Summary: ${bill.plainEnglish || bill.signal || bill.title}. Lobbying figures in seed data: $${bill.lobbyingAgainst ?? 0}M against vs $${bill.lobbyingFor ?? 0}M for. Seed analog (verify independently): ${analog}

Watch for:
• Committee / floor updates on Congress.gov
• New LDA filings if lobbying accelerates
• Company commentary that cites this bill theme

Add ANTHROPIC_API_KEY to the server for the full metrics walkthrough.`;
}

async function researchAsk(req, res, session) {
  const body = await readJson(req);
  const billId = body.billId != null ? String(body.billId).trim() : "";
  const question = String(
    body.question || body.prompt || body.message || body.query || ""
  ).slice(0, 2000);

  let bill = null;
  if (billId) {
    bill = POLICY_BILLS.find((b) => b.id === billId);
    if (!bill) return sendJson(res, 400, { error: "unknown_bill_id", billId });
  }

  if (!bill && !question.trim()) return sendJson(res, 400, { error: "empty_question" });

  const name = session.user?.name || "there";

  if (!process.env.ANTHROPIC_API_KEY) {
    const answer = bill ? localBillWhyAnswer(bill, name) : localPolicyAnswer(question, name);
    return sendJson(res, 200, { source: "local_model", answer });
  }

  let userContent;
  if (bill) {
    userContent = buildBillWhyUserContent(bill);
    if (question.trim()) userContent += `\n\nAdditional user note:\n${question}`;
  } else {
    const billDigest = POLICY_BILLS.map((b) => {
      const lm = computeLegislativeMomentum(b);
      const conf = billSignalConfidence(b);
      const aff = (b.affected || []).join(", ");
      return `${b.id}: ${b.title}; Legislative momentum ${lm}/100 (${conf}); affected ${aff}; signal: ${b.signal}`;
    }).join("\n");
    userContent = `Internal TradeSimple bill digest (scenario model for grounding, not a forecast):\n${billDigest}\n\nUser question:\n${question}`;
  }

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  const maxTokens = bill ? 1200 : 1024;

  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: RESEARCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }]
    })
  }, 20000);

  if (!response.ok) {
    return sendJson(res, 502, { error: "ai_provider_error", detail: await safeText(response) });
  }
  const data = await response.json();
  sendJson(res, 200, { source: "anthropic", answer: data.content?.[0]?.text || "No answer returned." });
}

function localPolicyAnswer(question, name) {
  const lower = question.toLowerCase();
  const bill =
    POLICY_BILLS.find((item) => item.affected.some((ticker) => lower.includes(ticker.toLowerCase()))) ||
    POLICY_BILLS.find((item) => lower.includes("crypto") && item.affected.includes("BTC")) ||
    POLICY_BILLS[0];
  const lm = computeLegislativeMomentum(bill);
  const conf = billSignalConfidence(bill);
  return `Here is the useful signal, ${name}: ${bill.title} has legislative momentum ${lm}/100 with ${conf} confidence. The key market chain is bill movement -> lobbying intensity -> affected tickers (${bill.affected.join(", ")}). ${bill.signal} ${bill.impact} This is a scenario model, not financial advice. Add ANTHROPIC_API_KEY for deeper natural-language research.`;
}

function startDemoSession(req, res) {
  if (process.env.DEMO_AUTH === "false") return sendText(res, 403, "Demo auth disabled");
  const next = new URL(req.url || "/", APP_URL).searchParams.get("next") || "/dashboard?view=trade";
  const user = {
    id: "demo-user",
    name: "Alex Johnson",
    email: "alex@example.com",
    picture: "",
    provider: "demo"
  };
  setSessionCookie(res, user);
  redirect(res, next.startsWith("/dashboard") ? next : "/dashboard?view=trade");
}

function logout(res) {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  redirect(res, "/");
}

function startOAuth(req, res, providerName) {
  const provider = oauthProvider(providerName);
  if (!provider.configured) return sendText(res, 400, `${providerName} OAuth is not configured. Add credentials to .env.local.`);

  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const oauthState = signObject({ provider: providerName, state, nonce, exp: unixNow() + 600 });
  const authorize = new URL(provider.authorizeUrl);
  authorize.searchParams.set("client_id", provider.clientId);
  authorize.searchParams.set("redirect_uri", `${APP_URL}/auth/callback/${providerName}`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", provider.scope);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  if (providerName === "google") authorize.searchParams.set("prompt", "select_account");

  res.setHeader("set-cookie", `${OAUTH_COOKIE}=${oauthState}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
  redirect(res, authorize.toString());
}

async function finishOAuth(req, res, providerName, url) {
  const provider = oauthProvider(providerName);
  const cookies = parseCookies(req);
  const oauthState = verifyObject(cookies[OAUTH_COOKIE]);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!provider.configured || !oauthState || oauthState.provider !== providerName || oauthState.state !== state || !code) {
    return sendText(res, 400, "OAuth callback validation failed.");
  }

  const tokenResponse = await fetchWithTimeout(provider.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${APP_URL}/auth/callback/${providerName}`
    })
  }, 12000);

  if (!tokenResponse.ok) return sendText(res, 502, `OAuth token exchange failed: ${await safeText(tokenResponse)}`);
  const token = await tokenResponse.json();
  const claims = await verifyOidcToken(token.id_token, provider, oauthState.nonce);
  const user = {
    id: `${providerName}:${claims.sub}`,
    name: claims.name || claims.email?.split("@")[0] || "Trader",
    email: claims.email || "",
    picture: claims.picture || "",
    provider: providerName
  };
  setSessionCookie(res, user);
  res.setHeader("set-cookie", [
    `${SESSION_COOKIE}=${createSession(user)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`,
    `${OAUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  ]);
  redirect(res, "/dashboard?view=trade");
}

async function verifyOidcToken(idToken, provider, nonce) {
  if (!idToken) throw new Error("missing_id_token");
  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".");
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  if (payload.iss !== provider.issuer) throw new Error("issuer_mismatch");
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(provider.clientId)) throw new Error("audience_mismatch");
  if (payload.exp < unixNow()) throw new Error("token_expired");
  if (payload.nonce && payload.nonce !== nonce) throw new Error("nonce_mismatch");

  const jwksResponse = await fetchWithTimeout(provider.jwksUrl, {}, 10000);
  if (!jwksResponse.ok) throw new Error("jwks_fetch_failed");
  const jwks = await jwksResponse.json();
  const jwk = jwks.keys?.find((key) => key.kid === header.kid);
  if (!jwk || jwk.kty !== "RSA") throw new Error("unsupported_or_missing_jwk");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const ok = verifier.verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(encodedSignature, "base64url"));
  if (!ok) throw new Error("token_signature_invalid");
  return payload;
}

function oauthProvider(name) {
  const providers = {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
      issuer: "https://accounts.google.com",
      scope: "openid email profile"
    },
    apple: {
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_CLIENT_SECRET,
      authorizeUrl: "https://appleid.apple.com/auth/authorize",
      tokenUrl: "https://appleid.apple.com/auth/token",
      jwksUrl: "https://appleid.apple.com/auth/keys",
      issuer: "https://appleid.apple.com",
      scope: "openid email name"
    }
  };
  const provider = providers[name];
  return { ...provider, configured: Boolean(provider?.clientId && provider?.clientSecret) };
}

function getSession(req) {
  const cookies = parseCookies(req);
  const session = verifyObject(cookies[SESSION_COOKIE]);
  if (!session || session.exp < unixNow()) return null;
  return session;
}

function setSessionCookie(res, user) {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=${createSession(user)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`);
}

function createSession(user) {
  return signObject({ user, exp: unixNow() + SESSION_TTL_SECONDS });
}

function signObject(value) {
  const payload = b64url(Buffer.from(JSON.stringify(value)));
  const sig = hmac(payload);
  return `${payload}.${sig}`;
}

function verifyObject(value) {
  if (!value || !value.includes(".")) return null;
  const [payload, sig] = value.split(".");
  if (!safeEqual(hmac(payload), sig)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function hmac(value) {
  return createHmac("sha256", AUTH_SECRET).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseCookies(req) {
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

function alpacaConfig() {
  const baseUrl = process.env.ALPACA_TRADING_BASE_URL || "https://paper-api.alpaca.markets";
  const live = baseUrl.includes("api.alpaca.markets") && !baseUrl.includes("paper-api");
  if (live && process.env.ALLOW_LIVE_TRADING !== "true") {
    return { configured: false, mode: "blocked_live", baseUrl };
  }
  return {
    configured: Boolean(process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY),
    mode: live ? "live" : "paper",
    baseUrl
  };
}

function alpacaFetch(path, init = {}) {
  const config = alpacaConfig();
  return fetchWithTimeout(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": process.env.ALPACA_API_KEY_ID,
      "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET_KEY,
      ...(init.headers || {})
    }
  }, 12000);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(response) {
  return (await response.text()).slice(0, 1000);
}

function filterBills(bills, query) {
  if (!query) return bills;
  return bills.filter((bill) =>
    [bill.id, bill.title, bill.shortTitle, bill.status, bill.signal, ...(bill.affected || [])]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

function inferTickers(title = "") {
  const lower = title.toLowerCase();
  if (lower.includes("semiconductor") || lower.includes("chips")) return ["NVDA", "INTC", "TSM"];
  if (lower.includes("drug") || lower.includes("medicare") || lower.includes("health")) return ["LLY", "MRK", "PFE"];
  if (lower.includes("digital asset") || lower.includes("crypto")) return ["COIN", "BTC", "ETH"];
  if (lower.includes("energy") || lower.includes("vehicle") || lower.includes("permit")) return ["TSLA", "ENPH"];
  if (lower.includes("platform") || lower.includes("antitrust")) return ["AMZN", "AAPL", "GOOGL", "META"];
  return [];
}

function chamberCap(chamber) {
  const c = String(chamber || "").toLowerCase();
  return c.includes("house") || c.startsWith("h") ? 218 : 100;
}

function normalizeStatusKey(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("passed") || s.includes("law") || s.includes("enacted")) return "passed";
  if (s.includes("floor")) return "floor";
  if (s.includes("markup")) return "markup";
  if (s.includes("committee")) return "committee";
  if (s.includes("failed") || s.includes("dead")) return "failed";
  if (s.includes("introduced")) return "introduced";
  if (s.includes("live")) return "committee";
  return "introduced";
}

function subscoreStageProgress(statusKey) {
  const m = { introduced: 20, committee: 40, markup: 60, floor: 80, passed: 100, failed: 5 };
  return m[statusKey] ?? 25;
}

function subscoreSponsorEffectiveness(bill) {
  const cap = chamberCap(bill.chamber);
  let s = Math.min(100, (Number(bill.cosponsors || 0) / Math.max(1, cap)) * 100);
  if (bill.sponsor?.party === "B") s = Math.min(100, s + 25);
  return Math.round(s);
}

function subscoreCosponsorStrength(bill) {
  const cap = chamberCap(bill.chamber);
  return Math.min(100, Math.round((Number(bill.cosponsors || 0) / Math.max(1, cap)) * 100));
}

function subscoreBipartisanBreadth(bill) {
  if (bill.signals?.bipartisanScore != null) {
    return Math.min(100, Math.round(Number(bill.signals.bipartisanScore)));
  }
  const cos = Number(bill.cosponsors || 0);
  const bi = Number(bill.bipartisanCosponsors || 0);
  if (!cos) return 0;
  return Math.min(100, Math.round((bi / cos) * 100));
}

function defaultCommitteeScore(bill) {
  const s = normalizeStatusKey(bill.status);
  if (s === "passed") return 100;
  if (s === "floor") return 82;
  if (s === "markup") return 68;
  if (s === "committee") return 48;
  return 32;
}

function subscoreCommitteeSchedule(bill) {
  let c = Math.min(100, bill.signals?.committeeScore != null ? Number(bill.signals.committeeScore) : defaultCommitteeScore(bill));
  if (bill.floorScheduled) c = Math.min(100, c + 18);
  return Math.round(c);
}

function subscoreRecencyDays(lastActionDate) {
  if (!lastActionDate) return 35;
  const days = Math.max(0, (Date.now() - new Date(lastActionDate).getTime()) / 864e5);
  if (days <= 10) return 100;
  if (days <= 30) return 88;
  if (days <= 60) return 72;
  if (days <= 120) return 55;
  if (days <= 200) return 40;
  return 28;
}

function defaultHistoricalScore(bill) {
  const s = normalizeStatusKey(bill.status);
  if (s === "passed") return 88;
  if (s === "markup") return 52;
  return 38;
}

function defaultFloorScore(bill) {
  const s = normalizeStatusKey(bill.status);
  if (s === "passed") return 100;
  if (bill.floorScheduled) return 62;
  if (s === "markup") return 48;
  return 28;
}

function subscoreTextEnactability(bill) {
  const h = bill.signals?.historicalScore != null ? Number(bill.signals.historicalScore) : defaultHistoricalScore(bill);
  const f = bill.signals?.floorScore != null ? Number(bill.signals.floorScore) : defaultFloorScore(bill);
  return Math.min(100, Math.round(h * 0.55 + f * 0.45));
}

function subscoreTimeRemaining(bill) {
  if (normalizeStatusKey(bill.status) === "passed") return 100;
  const m = new Date().getMonth();
  return Math.max(18, Math.round(100 - (m / 11) * 55));
}

function computeLegislativeMomentum(bill) {
  const statusKey = normalizeStatusKey(bill.status);
  const raw =
    0.25 * subscoreStageProgress(statusKey) +
    0.15 * subscoreSponsorEffectiveness(bill) +
    0.15 * subscoreCosponsorStrength(bill) +
    0.1 * subscoreBipartisanBreadth(bill) +
    0.1 * subscoreCommitteeSchedule(bill) +
    0.1 * subscoreRecencyDays(bill.latestActionDate) +
    0.1 * subscoreTextEnactability(bill) +
    0.05 * subscoreTimeRemaining(bill);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function billSignalConfidence(bill) {
  let pts = 0;
  if (bill.latestActionDate) {
    pts += 20;
    const d = (Date.now() - new Date(bill.latestActionDate).getTime()) / 864e5;
    if (d <= 30) pts += 25;
    else if (d <= 90) pts += 15;
    else if (d <= 180) pts += 8;
  }
  if (Number(bill.cosponsors) > 0) pts += 12;
  if (typeof bill.bipartisanCosponsors === "number") pts += 8;
  if (bill.latestAction) pts += 10;
  if (Number(bill.lobbyingAgainst) > 0 || Number(bill.lobbyingFor) > 0) pts += 12;
  if (String(bill.plainEnglish || "").length > 80) pts += 5;
  return pts >= 72 ? "High" : pts >= 44 ? "Medium" : "Low";
}

function scoreConfidence({ missingInputs = 0, staleInputs = 0, estimatedInputs = 0 } = {}) {
  if (missingInputs >= 2) return "Low";
  if (missingInputs === 0 && staleInputs === 0 && estimatedInputs === 0) return "High";
  return "Medium";
}

function pseudoFilingFromBill(bill) {
  const against = Number(bill.lobbyingAgainst || 0);
  const fo = Number(bill.lobbyingFor || 0);
  const amount = Math.max(against, fo, 0.1) * 1e6;
  const spike = against >= 20 ? 3 : against >= 10 ? 2.2 : fo >= 10 ? 1.9 : 1;
  return {
    client: bill.id || "bill",
    registrant: "Modeled aggregate",
    amount,
    issue: String(bill.lobbyingNote || bill.signal || bill.title || "").slice(0, 200),
    spike,
    postedAt: bill.latestActionDate || null,
    portfolio: false
  };
}

function ensureQuarterlySpend(f) {
  if (Array.isArray(f.quarterlySpend) && f.quarterlySpend.length >= 9) return f.quarterlySpend;
  const cur = parseFloat(f.amount || f.expenses || 0) || 0;
  const sf = Math.max(0.4, parseFloat(f.spike || f.spikeFactor || 1));
  const baseline = cur / sf;
  const out = [];
  for (let i = 0; i < 8; i++) out.push(Math.max(1, Math.round(baseline * (0.9 + ((i * 13) % 7) * 0.02))));
  out.push(cur);
  return out;
}

function computeSpendSpikeZ(f) {
  const hist = ensureQuarterlySpend(f);
  const cur = hist[8];
  const prior = hist.slice(0, 8);
  const mean = prior.reduce((a, b) => a + b, 0) / 8;
  const variance = prior.reduce((a, x) => a + (x - mean) ** 2, 0) / 8;
  const std = Math.sqrt(variance) || 1e-9;
  return (cur - mean) / std;
}

function spendSpikeSubscore(z) {
  const c = Math.min(3.5, Math.max(-2, z));
  return ((c + 2) / 5.5) * 100;
}

function computeLobbyingPressure(f) {
  const z = computeSpendSpikeZ(f);
  const issues = String(f.issue || "")
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const coalitionBreadth = Math.min(100, 12 + issues.length * 22);
  const topicSpecificity = Math.max(22, Math.min(100, 100 - (issues.length - 1) * 28));
  let recency = 48;
  if (f.postedAt) {
    const days = (Date.now() - new Date(f.postedAt).getTime()) / 864e5;
    if (days <= 14) recency = 100;
    else if (days <= 40) recency = 86;
    else if (days <= 100) recency = 62;
    else if (days <= 200) recency = 42;
  }
  let directionCertainty = parseFloat(f.spike || 0) > 1.65 ? 78 : 52;
  if (issues.some((i) => /pricing|antitrust|crypto|medicare|export|chips/i.test(i))) {
    directionCertainty = Math.min(100, directionCertainty + 12);
  }
  const raw =
    0.4 * spendSpikeSubscore(z) +
    0.2 * coalitionBreadth +
    0.15 * topicSpecificity +
    0.15 * recency +
    0.1 * directionCertainty;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function lobbyingFilingConfidence(f) {
  let pts = 0;
  if (f.client) pts += 28;
  if (f.registrant) pts += 14;
  if (f.postedAt) {
    pts += 12;
    const days = (Date.now() - new Date(f.postedAt).getTime()) / 864e5;
    if (days <= 45) pts += 22;
  }
  if (String(f.issue || "").length) pts += 18;
  if (parseFloat(f.amount || 0) > 0) pts += 16;
  return pts >= 74 ? "High" : pts >= 42 ? "Medium" : "Low";
}

function lobbyingSubConfidences(f) {
  const z = computeSpendSpikeZ(f);
  const issueList = String(f.issue || "")
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const spike = parseFloat(f.spike || f.spikeFactor || 1);
  const isSpike = spike > 1.8;
  const spendSignalConfidence = z >= 1.2 || isSpike ? "High" : Math.abs(z) < 0.35 ? "Low" : "Medium";
  const issueSignalConfidence = issueList.length >= 3 ? "High" : issueList.length >= 1 ? "Medium" : "Low";
  let recencySignalConfidence = "Low";
  if (f.postedAt) {
    const days = (Date.now() - new Date(f.postedAt).getTime()) / 864e5;
    recencySignalConfidence = days <= 90 ? "High" : "Medium";
  }
  return {
    spendSpikeZ: Math.round(z * 100) / 100,
    spikeVsTrail: Math.round(spike * 100) / 100,
    spendSignalConfidence,
    issueSignalConfidence,
    recencySignalConfidence
  };
}

function decorateLobbyingFiling(base) {
  const sub = lobbyingSubConfidences(base);
  const missingInputs =
    (base.client ? 0 : 1) +
    (base.registrant ? 0 : 1) +
    (base.issue ? 0 : 1) +
    (Number(base.amount || 0) > 0 ? 0 : 1);
  const staleInputs = base.postedAt && (Date.now() - new Date(base.postedAt).getTime()) / 864e5 > 90 ? 1 : 0;
  return {
    ...base,
    lobbyingPressure: computeLobbyingPressure(base),
    confidence: scoreConfidence({ missingInputs, staleInputs }),
    filingConfidence: lobbyingFilingConfidence(base),
    spendSpikeZ: sub.spendSpikeZ,
    spikeVsTrail: sub.spikeVsTrail,
    spendSignalConfidence: sub.spendSignalConfidence,
    issueSignalConfidence: sub.issueSignalConfidence,
    recencySignalConfidence: sub.recencySignalConfidence
  };
}

function augmentBillMetrics(bill) {
  const legislativeMomentum = computeLegislativeMomentum(bill);
  const signalConfidence = billSignalConfidence(bill);
  const policyExposure = legislativeMomentum;
  const pseudo = pseudoFilingFromBill(bill);
  const lobbyingPressureScore = computeLobbyingPressure(pseudo);
  const lobbyingSignalConfidence = lobbyingFilingConfidence(pseudo);
  const missingInputs =
    (bill.latestActionDate ? 0 : 1) +
    (Number(bill.cosponsors || 0) > 0 ? 0 : 1) +
    ((Number(bill.lobbyingAgainst || 0) > 0 || Number(bill.lobbyingFor || 0) > 0) ? 0 : 1);
  const staleInputs = bill.latestActionDate && (Date.now() - new Date(bill.latestActionDate).getTime()) / 864e5 > 90 ? 1 : 0;
  return {
    legislativeMomentum,
    policyExposure,
    confidence: scoreConfidence({ missingInputs, staleInputs }),
    signalConfidence,
    lobbyingPressureScore,
    lobbyingSignalConfidence
  };
}

function computeBillMetricBreakdown(bill) {
  const statusKey = normalizeStatusKey(bill.status);
  const components = [
    { key: "stageProgress", label: "Stage progress (from bill status)", value: subscoreStageProgress(statusKey), weight: 0.25 },
    { key: "sponsorEffectiveness", label: "Sponsor effectiveness", value: subscoreSponsorEffectiveness(bill), weight: 0.15 },
    { key: "cosponsorStrength", label: "Cosponsor strength", value: subscoreCosponsorStrength(bill), weight: 0.15 },
    { key: "bipartisanBreadth", label: "Bipartisan breadth", value: subscoreBipartisanBreadth(bill), weight: 0.1 },
    { key: "committeeSchedule", label: "Committee / floor posture", value: subscoreCommitteeSchedule(bill), weight: 0.1 },
    { key: "recency", label: "Recency of last action", value: subscoreRecencyDays(bill.latestActionDate), weight: 0.1 },
    { key: "textEnactability", label: "Text & floor enactability", value: subscoreTextEnactability(bill), weight: 0.1 },
    { key: "timeRemaining", label: "Session timing proxy", value: subscoreTimeRemaining(bill), weight: 0.05 }
  ];
  const weightedRaw = components.reduce((sum, c) => sum + c.weight * c.value, 0);
  const withContrib = components.map((c) => ({
    key: c.key,
    label: c.label,
    value: c.value,
    weight: c.weight,
    weightPct: Math.round(c.weight * 1000) / 10,
    contribution: Math.round(c.weight * c.value * 100) / 100
  }));
  const pseudo = pseudoFilingFromBill(bill);
  return {
    bill: {
      id: bill.id,
      title: bill.title,
      status: bill.status,
      chamber: bill.chamber || null,
      latestActionDate: bill.latestActionDate || null
    },
    legislativeMomentum: {
      score: computeLegislativeMomentum(bill),
      weightedRawBeforeClamp: Math.round(weightedRaw * 100) / 100,
      note: "Displayed momentum is the weighted sum rounded to an integer and clamped to 0–100.",
      components: withContrib
    },
    billSignalConfidence: {
      label: billSignalConfidence(bill),
      rubric: "Point-based checklist on the seed record (recency, cosponsors, lobbying dollars, narrative depth); ≥72 High, ≥44 Medium, else Low."
    },
    lobbyingPressureOnBillCard: {
      score: computeLobbyingPressure(pseudo),
      pseudoSpike: pseudo.spike,
      pseudoAmountUsd: pseudo.amount,
      note: "Same lobbying-pressure model applied to a synthetic filing built from seed lobbyingAgainst / lobbyingFor and narrative — comparable to card lobbyingPressureScore."
    },
    curatedSignals: bill.signals || null
  };
}

function methodologyDoc(res) {
  sendJson(res, 200, METHODOLOGY);
}

function billPolicyMetrics(res, url) {
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return sendJson(res, 400, { error: "missing_id" });
  const bill = POLICY_BILLS.find((b) => b.id === id);
  if (!bill) return sendJson(res, 404, { error: "unknown_bill_id", billId: id });
  sendJson(res, 200, {
    source: "policy_seed_model",
    confidence: augmentBillMetrics(bill).confidence,
    breakdown: computeBillMetricBreakdown(bill)
  });
}

function decorateBill(bill) {
  return { ...bill, ...augmentBillMetrics(bill) };
}

function normalizeLiveCongressBill(bill) {
  const actionText = `${bill.latestAction?.text || ""} ${bill.title || ""}`.toLowerCase();
  let status = "introduced";
  if (actionText.includes("became public law") || actionText.includes("signed by president")) status = "passed";
  else if (actionText.includes("passed senate") || actionText.includes("passed house")) status = "floor";
  else if (actionText.includes("reported") || actionText.includes("ordered to be reported")) status = "markup";
  else if (actionText.includes("committee")) status = "committee";

  const chamberRaw = bill.originChamber || bill.type || "House";
  const chamber = String(chamberRaw).toLowerCase().includes("senate") ? "Senate" : "House";

  return {
    id: `${bill.type}.${bill.number}-${bill.congress}`,
    title: bill.title,
    shortTitle: bill.title,
    chamber,
    status,
    sponsor: { name: "", party: "U", state: "" },
    cosponsors: Number(bill.cosponsors?.count ?? bill.cosponsors ?? 0),
    bipartisanCosponsors: 0,
    floorScheduled: false,
    latestAction: bill.latestAction?.text || "Updated by Congress.gov",
    latestActionDate: bill.latestAction?.actionDate || bill.updateDate || bill.updateDateIncludingText || "",
    affected: inferTickers(bill.title),
    lobbyingAgainst: null,
    lobbyingFor: null,
    plainEnglish: "",
    signal: "Live Congress.gov record. Add lobbying and committee scoring to turn this into a stronger trading signal.",
    impact: "Impact requires ticker mapping and historical analog model."
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function contentType(filePath) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8"
  }[extname(filePath)] || "application/octet-stream";
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function loadEnvFile(name) {
  const path = join(ROOT, name);
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
