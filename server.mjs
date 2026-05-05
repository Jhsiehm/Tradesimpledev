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

const MARKET_FALLBACK = {
  NVDA: { symbol: "NVDA", price: 891.2, change: 20.88, pct: 2.41, high: 974, low: 460, open: 875.3 },
  AAPL: { symbol: "AAPL", price: 189.45, change: -1.58, pct: -0.83, high: 220, low: 164, open: 190.2 },
  LLY: { symbol: "LLY", price: 796.6, change: 8.62, pct: 1.09, high: 892, low: 648, open: 788.1 },
  TSLA: { symbol: "TSLA", price: 182.63, change: 2.18, pct: 1.2, high: 278, low: 138, open: 180.4 },
  AMZN: { symbol: "AMZN", price: 189.72, change: 2.49, pct: 1.33, high: 201, low: 151, open: 187.2 },
  MSFT: { symbol: "MSFT", price: 415.8, change: 1.66, pct: 0.4, high: 441, low: 362, open: 414.1 },
  AMD: { symbol: "AMD", price: 162.4, change: 3.27, pct: 2.05, high: 227, low: 116, open: 159.8 },
  GOOGL: { symbol: "GOOGL", price: 172.38, change: 1.21, pct: 0.71, high: 193, low: 130, open: 171.2 },
  META: { symbol: "META", price: 501.22, change: 3.84, pct: 0.77, high: 531, low: 355, open: 498.9 },
  COIN: { symbol: "COIN", price: 218.44, change: -2.03, pct: -0.92, high: 283, low: 108, open: 221.1 },
  SPY: { symbol: "SPY", price: 524.81, change: 2.82, pct: 0.54, high: 558, low: 458, open: 522.4 },
  QQQ: { symbol: "QQQ", price: 441.33, change: 3.58, pct: 0.81, high: 480, low: 367, open: 438.7 }
};

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
    moat: "Diversified exposure to the largest Nasdaq growth companies.",
    plainBull: "AI and software earnings can keep growth above the broad market.",
    plainBear: "High multiple growth stocks are sensitive to interest rates and disappointment."
  }
};

const CRYPTO_FALLBACK = {
  bitcoin: { symbol: "BTC", price: 68420, pct: 3.17, marketCap: 1347000000000 },
  ethereum: { symbol: "ETH", price: 3291, pct: -1.44, marketCap: 395000000000 },
  solana: { symbol: "SOL", price: 172, pct: 4.2, marketCap: 81000000000 }
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
    passageOdds: 34,
    confidence: "medium",
    affected: ["LLY", "MRK", "PFE", "ABBV", "UNH"],
    lobbyingAgainst: 31,
    lobbyingFor: 2.1,
    lobbyingNote: "Pfizer, Merck, AbbVie combined $31M — 2.8x their normal quarterly spend. PhRMA trade group added $12M on top. When pharma triples lobbying spend, they believe the bill actually has a path.",
    plainEnglish: "Currently Medicare can only negotiate prices on 10 drugs per year (from the Inflation Reduction Act). This bill expands that to 50 drugs annually — and LLY's GLP-1 drugs hit Medicare volume thresholds next year.",
    signal: "Pharma opposition spend is 2.8x normal quarterly pace, which means the bill is being treated as real revenue risk.",
    impact: "If passed, large-cap pharma faces margin compression. If it dies, pricing overhang likely clears.",
    passImpacts: [
      { sym: "LLY", dir: -1, range: "-8 to -15%", why: "Mounjaro/Zepbound hit Medicare volume threshold in 2026" },
      { sym: "MRK", dir: -1, range: "-5 to -10%", why: "Keytruda is a prime negotiation target" },
      { sym: "UNH", dir: 1, range: "+3 to +6%", why: "Lower drug costs reduce claim payouts" },
    ],
    failImpacts: [
      { sym: "LLY", dir: 1, range: "+4 to +8%", why: "Pricing power protected, overhang removed" },
      { sym: "MRK", dir: 1, range: "+2 to +5%", why: "Revenue forecasts intact" },
    ],
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
    passageOdds: 100,
    confidence: "high",
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
    ],
    failImpacts: [],
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
    passageOdds: 18,
    confidence: "high",
    affected: ["AMZN", "AAPL", "GOOGL", "META"],
    lobbyingAgainst: 18.4,
    lobbyingFor: 0.8,
    lobbyingNote: "AMZN, AAPL, GOOGL, META combined $18.4M against. Key signal: small business groups lobbying alongside tech companies. When natural enemies align, the bill's political coalition becomes untenable.",
    plainEnglish: "Would ban Amazon from favoring Amazon Basics, Apple from giving its own apps placement advantages, and Google from putting its own services above organic results. Passage odds collapsed after unusual coalition formed against it.",
    signal: "Small-business groups and mega-cap platforms are unusually aligned against the bill, weakening the coalition.",
    impact: "Failure removes antitrust risk premium from mega-cap platform names.",
    passImpacts: [
      { sym: "AMZN", dir: -1, range: "-8 to -14%", why: "Marketplace neutrality destroys algorithmic advantage" },
      { sym: "AAPL", dir: -1, range: "-5 to -9%", why: "App Store search placement restrictions" },
      { sym: "GOOGL", dir: -1, range: "-6 to -11%", why: "Search result self-preferencing banned" },
    ],
    failImpacts: [
      { sym: "AMZN", dir: 1, range: "+4 to +8%", why: "Antitrust overhang cleared — marketplace model intact" },
      { sym: "AAPL", dir: 1, range: "+2 to +5%", why: "App Store pricing power preserved" },
      { sym: "GOOGL", dir: 1, range: "+3 to +6%", why: "Search ad dominance protected" },
    ],
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
    passageOdds: 44,
    confidence: "medium",
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
    ],
    failImpacts: [
      { sym: "COIN", dir: -1, range: "-8 to -15%", why: "Status quo ambiguity remains — continued regulatory risk" },
    ],
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
    passageOdds: 58,
    confidence: "medium",
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
    ],
    failImpacts: [
      { sym: "TSLA", dir: -1, range: "-2 to -4%", why: "Permitting bottlenecks remain — expansion slower" },
    ],
  },
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
    if (pathname === "/api/lobbying") return lobbying(res);
    if (pathname === "/api/trading/account") return paperAccount(res, session);
    if (pathname === "/api/trading/orders" && req.method === "POST") return paperOrder(req, res, session);
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
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY)
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
  const symbols = (url.searchParams.get("symbols") || "SPY,QQQ,NVDA,AAPL,LLY,TSLA,AMZN,MSFT,AMD,GOOGL,META,COIN")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 40);
  const token = process.env.FINNHUB_API_KEY;

  if (!token) {
    const quotes = symbols.map((symbol) => MARKET_FALLBACK[symbol]).filter(Boolean);
    return sendJson(res, 200, { source: "fallback", quotes, updatedAt: new Date().toISOString() });
  }

  const quotes = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
        const response = await fetchWithTimeout(quoteUrl, {}, 7000);
        if (!response.ok) throw new Error(`finnhub_${response.status}`);
        const data = await response.json();
        if (!Number(data.c)) throw new Error("empty_quote");
        return {
          symbol,
          price: data.c,
          change: data.d,
          pct: data.dp,
          high: data.h,
          low: data.l,
          open: data.o,
          previousClose: data.pc,
          timestamp: data.t ? new Date(data.t * 1000).toISOString() : null
        };
      } catch {
        return MARKET_FALLBACK[symbol] || null;
      }
    })
  );

  sendJson(res, 200, { source: "finnhub", quotes: quotes.filter(Boolean), updatedAt: new Date().toISOString() });
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
      updatedAt: new Date().toISOString()
    });
  }

  const quoteResult = await quoteSnapshot(symbol);
  const quote = quoteResult.quote || MARKET_FALLBACK[symbol] || { symbol, price: 100, pct: 0 };
  const points = buildHistoricalSeries(symbol, range, quote);
  sendJson(res, 200, {
    source: "modeled_history",
    symbol,
    range,
    points,
    stats: historyStats(points),
    updatedAt: new Date().toISOString()
  });
}

async function stockAnalysis(res, url) {
  const requested = String(url.searchParams.get("symbol") || "NVDA").toUpperCase().replace(/[^A-Z.]/g, "");
  const symbol = FUNDAMENTALS[requested] || MARKET_FALLBACK[requested] ? requested : "NVDA";
  const quoteResult = await quoteSnapshot(symbol);
  const quote = quoteResult.quote || MARKET_FALLBACK[symbol] || { symbol, price: 0, change: 0, pct: 0 };
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
    moat: "Add a fundamentals provider to replace this modeled profile with live company data.",
    plainBull: "The live price feed is connected, but fundamentals are not mapped yet.",
    plainBear: "Without fundamentals, this ticker should be treated as quote-only."
  };
  const relatedBills = POLICY_BILLS.filter((bill) => (bill.affected || []).includes(symbol));
  const policyExposure = relatedBills.reduce((max, bill) => Math.max(max, Number(bill.passageOdds || 0)), 0);
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
        { label: "Policy exposure", value: policyExposure, explain: "Highest passage odds among mapped bills touching this ticker." },
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
    summary: buildPolicySummary(focusSymbol, focusBills),
    allBills,
    focusBills,
    stakeholderMap: buildStakeholderMap(focusSymbol, focusBills.length ? focusBills : allBills.slice(0, 3))
  };
}

function enrichPolicyBill(bill, focusSymbol = "") {
  const model = POLICY_STAKEHOLDERS[bill.id] || emptyStakeholderModel(bill);
  const focusImpact = model.tickerImpacts.find((impact) => impact.symbol === focusSymbol) ||
    model.tickerImpacts.find((impact) => (bill.affected || []).includes(impact.symbol)) ||
    null;
  const lobbyingPressure = Number(bill.lobbyingAgainst || 0) + Number(bill.lobbyingFor || 0);
  const impactScore = Math.max(
    1,
    Math.min(
      5,
      Math.round((Number(bill.passageOdds || 0) / 25) + (lobbyingPressure >= 20 ? 1 : 0))
    )
  );
  const topOpposition = model.lobbying
    .filter((item) => item.stance === "against")
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
  const topSupport = model.lobbying
    .filter((item) => item.stance === "for")
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];

  return {
    ...bill,
    impactScore,
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
          ? `${topOpposition.name} and aligned groups are spending against the bill, which signals revenue or margin risk.`
          : topSupport
            ? `${topSupport.name} and aligned groups are spending for the bill, which signals they want faster implementation.`
            : "No large lobbying spike has been mapped yet."
      },
      {
        label: "Congress path",
        text: `${bill.status} in the ${bill.chamber}. Latest action: ${bill.latestAction}. Modeled passage odds: ${bill.passageOdds}%.`
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
  const strongest = bills.slice().sort((a, b) => Number(b.impactScore || 0) - Number(a.impactScore || 0))[0];
  const riskLevel = strongest.impactScore >= 4 ? "high" : strongest.impactScore >= 3 ? "medium" : "watch";
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
      detail: `${bill.passageOdds}% odds - ${bill.status}`,
      tone: bill.passageOdds >= 60 ? "green" : bill.passageOdds < 35 ? "red" : "amber"
    });
    if ((bill.affected || []).includes(symbol)) {
      addLink(billId, `ticker:${symbol}`, stockImpactChannel(symbol, bill), "green", Number(bill.passageOdds || 0));
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
  const fallback = MARKET_FALLBACK[symbol] || null;
  const token = process.env.FINNHUB_API_KEY;
  if (!token) return { source: "fallback", quote: fallback };

  try {
    const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
    const response = await fetchWithTimeout(quoteUrl, {}, 7000);
    if (!response.ok) throw new Error(`finnhub_${response.status}`);
    const data = await response.json();
    if (!Number(data.c)) throw new Error("empty_quote");
    return {
      source: "finnhub",
      quote: {
        symbol,
        price: data.c,
        change: data.d,
        pct: data.dp,
        high: data.h,
        low: data.l,
        open: data.o,
        previousClose: data.pc,
        timestamp: data.t ? new Date(data.t * 1000).toISOString() : null
      }
    };
  } catch {
    return { source: "fallback", quote: fallback };
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
    return {
      title: `${bill.title} -> ${symbol}`,
      tone: bill.passageOdds >= 60 ? "green" : bill.passageOdds < 35 ? "red" : "amber",
      summary: stockImpactChannel(symbol, bill),
      steps: [
        { label: "1. Filing signal", text: lobbyingText },
        { label: "2. Bill pressure", text: `${bill.status} status with ${bill.passageOdds}% modeled passage odds. Latest action: ${bill.latestAction}.` },
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
      causalChain: "Bill advances -> passage odds rise -> affected ticker risk/reward changes."
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

  try {
    const response = await fetchWithTimeout(priceUrl, { headers }, 7000);
    if (!response.ok) throw new Error(`coingecko_${response.status}`);
    const data = await response.json();
    const assets = Object.entries(data).map(([id, value]) => ({
      id,
      symbol: id === "bitcoin" ? "BTC" : id === "ethereum" ? "ETH" : id === "solana" ? "SOL" : id.toUpperCase(),
      price: value.usd,
      pct: value.usd_24h_change,
      marketCap: value.usd_market_cap,
      lastUpdatedAt: value.last_updated_at ? new Date(value.last_updated_at * 1000).toISOString() : null
    }));
    sendJson(res, 200, { source: key ? "coingecko" : "coingecko_public", assets, updatedAt: new Date().toISOString() });
  } catch {
    sendJson(res, 200, {
      source: "fallback",
      assets: ids.map((id) => ({ id, ...CRYPTO_FALLBACK[id] })).filter((asset) => asset.price),
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
      bills: filterBills(POLICY_BILLS, query),
      updatedAt: new Date().toISOString()
    });
  }

  try {
    const billUrl = `https://api.congress.gov/v3/bill?format=json&limit=20&api_key=${encodeURIComponent(key)}`;
    const response = await fetchWithTimeout(billUrl, {}, 9000);
    if (!response.ok) throw new Error(`congress_${response.status}`);
    const data = await response.json();
    const liveBills = (data.bills || []).map((bill) => ({
      id: `${bill.type}.${bill.number}-${bill.congress}`,
      title: bill.title,
      shortTitle: bill.title,
      chamber: bill.originChamber || bill.type,
      status: "Live Congress.gov",
      latestAction: bill.latestAction?.text || "Updated by Congress.gov",
      latestActionDate: bill.latestAction?.actionDate || bill.updateDate || bill.updateDateIncludingText,
      passageOdds: estimatePassageOdds(bill),
      confidence: "low",
      affected: inferTickers(bill.title),
      lobbyingAgainst: null,
      lobbyingFor: null,
      signal: "Live Congress.gov record. Add lobbying and committee scoring to turn this into a stronger trading signal.",
      impact: "Impact requires ticker mapping and historical analog model."
    }));
    sendJson(res, 200, { source: "congress.gov", bills: filterBills([...POLICY_BILLS, ...liveBills], query), updatedAt: new Date().toISOString() });
  } catch {
    sendJson(res, 200, { source: "fallback", bills: filterBills(POLICY_BILLS, query), updatedAt: new Date().toISOString() });
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
    const filings = (data.results || []).map((item) => ({
      client: item.client?.name || "Unknown client",
      registrant: item.registrant?.name || "Unknown registrant",
      amount: Number(item.amount || item.expenses || 0),
      issue: (item.issues || []).slice(0, 3).join(", ") || "Issue not listed",
      spike: null,
      portfolio: false,
      postedAt: item.dt_posted || null
    }));
    sendJson(res, 200, { source: "senate_lda", filings: filings.length ? filings : LOBBYING_FALLBACK, updatedAt: new Date().toISOString() });
  } catch {
    sendJson(res, 200, { source: "fallback", filings: LOBBYING_FALLBACK, updatedAt: new Date().toISOString() });
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
  const quote = quoteResult.quote || MARKET_FALLBACK[symbol];
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
    const quote = quotes[index].quote || MARKET_FALLBACK[position.symbol] || {};
    const price = Number(quote.price || position.avgCost || 0);
    const marketValue = price * Number(position.qty || 0);
    const costBasis = Number(position.avgCost || 0) * Number(position.qty || 0);
    const unrealizedPnl = marketValue - costBasis;
    return {
      ...position,
      price,
      marketValue: Number(marketValue.toFixed(2)),
      costBasis: Number(costBasis.toFixed(2)),
      unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
      unrealizedPnlPct: costBasis ? (unrealizedPnl / costBasis) * 100 : 0,
      dayPct: Number(quote.pct || 0)
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

async function researchAsk(req, res, session) {
  const body = await readJson(req);
  const question = String(body.question || "").slice(0, 2000);
  if (!question.trim()) return sendJson(res, 400, { error: "empty_question" });

  if (!process.env.ANTHROPIC_API_KEY) {
    const answer = localPolicyAnswer(question, session.user?.name || "there");
    return sendJson(res, 200, { source: "local_model", answer });
  }

  const prompt = `You are TradeSimple AI. Analyze market impact through legislation, lobbying intensity, passage odds, and portfolio exposure. Do not provide personalized financial advice.\n\nBills:\n${POLICY_BILLS.map((bill) => `${bill.id}: ${bill.title}, ${bill.passageOdds}% odds, affected ${bill.affected.join(", ")}, signal: ${bill.signal}`).join("\n")}\n\nUser question: ${question}`;
  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: 900,
      messages: [{ role: "user", content: prompt }]
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
  return `Here is the useful signal, ${name}: ${bill.title} is at ${bill.passageOdds}% passage odds with ${bill.confidence} confidence. The key market chain is bill movement -> lobbying intensity -> affected tickers (${bill.affected.join(", ")}). ${bill.signal} ${bill.impact} This is a scenario model, not financial advice. Add ANTHROPIC_API_KEY for deeper natural-language research.`;
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

function estimatePassageOdds(bill) {
  const action = `${bill.latestAction?.text || ""} ${bill.title || ""}`.toLowerCase();
  if (action.includes("became public law") || action.includes("signed by president")) return 100;
  if (action.includes("passed senate") || action.includes("passed house")) return 72;
  if (action.includes("reported") || action.includes("ordered to be reported")) return 46;
  if (action.includes("committee")) return 24;
  return 12;
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
