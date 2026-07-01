const MARKET_FALLBACK = {
  NVDA: { symbol: "NVDA", price: 208.19, change: 2.95, pct: 1.42, high: 212.0, low: 202.0, open: 205.2 },
  AAPL: { symbol: "AAPL", price: 228.6, change: -0.92, pct: -0.4, high: 235.0, low: 218.4, open: 229.5 },
  LLY: { symbol: "LLY", price: 796.6, change: 8.6, pct: 1.09, high: 810.0, low: 772.0, open: 788.0 },
  GME: { symbol: "GME", price: 24.8, change: 5.5, pct: 28.4, high: 26.0, low: 19.0, open: 19.3 },
  RTX: { symbol: "RTX", price: 112.84, change: -0.35, pct: -0.31, high: 114.5, low: 111.0, open: 113.2 },
  PLTR: { symbol: "PLTR", price: 132.07, change: 5.3, pct: 4.18, high: 134.0, low: 126.0, open: 126.8 },
  NOC: { symbol: "NOC", price: 498.3, change: 4.5, pct: 0.92, high: 502.0, low: 490.0, open: 493.8 },
  TSLA: { symbol: "TSLA", price: 285.3, change: 3.1, pct: 1.1, high: 298.0, low: 258.0, open: 282.4 },
  AMZN: { symbol: "AMZN", price: 212.8, change: 2.05, pct: 0.98, high: 218.0, low: 204.0, open: 210.9 },
  MSFT: { symbol: "MSFT", price: 468.2, change: 1.42, pct: 0.31, high: 472.0, low: 452.0, open: 466.8 },
  AMD: { symbol: "AMD", price: 118.6, change: 2.15, pct: 1.85, high: 124.0, low: 108.0, open: 116.45 },
  GOOGL: { symbol: "GOOGL", price: 168.9, change: 0.88, pct: 0.52, high: 171.5, low: 162.0, open: 168.0 },
  META: { symbol: "META", price: 598.4, change: 4.2, pct: 0.71, high: 612.0, low: 568.0, open: 594.2 },
  COIN: { symbol: "COIN", price: 276.5, change: -2.8, pct: -1.0, high: 292.0, low: 248.0, open: 279.3 },
  SPY: { symbol: "SPY", price: 598.2, change: 2.45, pct: 0.41, high: 602.0, low: 588.0, open: 595.75 },
  QQQ: { symbol: "QQQ", price: 518.6, change: 3.05, pct: 0.59, high: 524.0, low: 508.0, open: 515.55 },
  // Remaining symbols in the "Markets" tradable catalog (defense/contract/policy
  // tickers, indices, and crypto) — without an entry here, a symbol shows
  // "Unavailable" whenever live providers are unreachable (Yahoo/yfinance are
  // permanently blocked on Railway and Finnhub's free tier can't cover 50+
  // symbols), which is the steady-state case, not the exception.
  BA: { symbol: "BA", price: 209.0, change: -5.51, pct: -2.57, high: 216.0, low: 207.0, open: 214.51 },
  BAH: { symbol: "BAH", price: 108.4, change: -1.85, pct: -1.68, high: 111.5, low: 107.0, open: 110.25 },
  ABBV: { symbol: "ABBV", price: 192.5, change: 1.35, pct: 0.71, high: 194.0, low: 190.0, open: 191.15 },
  ADM: { symbol: "ADM", price: 51.2, change: -0.45, pct: -0.87, high: 52.3, low: 50.7, open: 51.65 },
  AMAT: { symbol: "AMAT", price: 182.4, change: 2.6, pct: 1.45, high: 184.5, low: 178.0, open: 179.8 },
  ASML: { symbol: "ASML", price: 735.0, change: -8.2, pct: -1.1, high: 748.0, low: 728.0, open: 743.2 },
  BAC: { symbol: "BAC", price: 44.3, change: 0.28, pct: 0.64, high: 44.8, low: 43.7, open: 44.02 },
  BTC: { symbol: "BTC", price: 104500, change: 1850, pct: 1.8, high: 106200, low: 101800, open: 102650 },
  CRWD: { symbol: "CRWD", price: 452.0, change: 6.4, pct: 1.44, high: 458.0, low: 440.0, open: 445.6 },
  CVS: { symbol: "CVS", price: 64.8, change: -0.55, pct: -0.84, high: 65.9, low: 64.1, open: 65.35 },
  CXW: { symbol: "CXW", price: 21.3, change: 0.62, pct: 3.0, high: 21.8, low: 20.3, open: 20.68 },
  DAL: { symbol: "DAL", price: 51.6, change: 0.85, pct: 1.67, high: 52.4, low: 50.2, open: 50.75 },
  DE: { symbol: "DE", price: 498.0, change: -3.2, pct: -0.64, high: 505.0, low: 494.0, open: 501.2 },
  ENPH: { symbol: "ENPH", price: 68.4, change: -1.1, pct: -1.58, high: 70.5, low: 67.2, open: 69.5 },
  ETH: { symbol: "ETH", price: 2780, change: -42, pct: -1.49, high: 2850, low: 2740, open: 2822 },
  FSLR: { symbol: "FSLR", price: 198.0, change: 4.3, pct: 2.22, high: 201.5, low: 191.0, open: 193.7 },
  GD: { symbol: "GD", price: 288.0, change: 1.95, pct: 0.68, high: 290.0, low: 284.5, open: 286.05 },
  GEO: { symbol: "GEO", price: 28.4, change: 0.95, pct: 3.46, high: 29.0, low: 27.0, open: 27.45 },
  GS: { symbol: "GS", price: 615.0, change: -4.8, pct: -0.78, high: 622.0, low: 610.0, open: 619.8 },
  HII: { symbol: "HII", price: 215.0, change: -2.4, pct: -1.1, high: 219.0, low: 212.5, open: 217.4 },
  INTC: { symbol: "INTC", price: 22.4, change: 0.35, pct: 1.59, high: 22.8, low: 21.9, open: 22.05 },
  JPM: { symbol: "JPM", price: 265.0, change: 1.8, pct: 0.68, high: 267.0, low: 261.5, open: 263.2 },
  KBE: { symbol: "KBE", price: 58.2, change: 0.42, pct: 0.73, high: 58.6, low: 57.4, open: 57.78 },
  LDOS: { symbol: "LDOS", price: 168.0, change: -1.3, pct: -0.77, high: 171.0, low: 166.5, open: 169.3 },
  LHX: { symbol: "LHX", price: 303.0, change: -5.17, pct: -1.68, high: 310.0, low: 301.0, open: 308.17 },
  LMT: { symbol: "LMT", price: 468.0, change: 3.1, pct: 0.67, high: 471.5, low: 462.0, open: 464.9 },
  MRK: { symbol: "MRK", price: 82.5, change: -0.95, pct: -1.14, high: 84.0, low: 81.8, open: 83.45 },
  PANW: { symbol: "PANW", price: 185.0, change: 2.7, pct: 1.48, high: 187.5, low: 180.5, open: 182.3 },
  PFE: { symbol: "PFE", price: 24.8, change: 0.18, pct: 0.73, high: 25.1, low: 24.4, open: 24.62 },
  SAIC: { symbol: "SAIC", price: 102.0, change: -1.4, pct: -1.35, high: 104.5, low: 101.0, open: 103.4 },
  SPCX: { symbol: "SPCX", price: 211.6, change: 5.89, pct: 2.86, high: 225.64, low: 192.5, open: 205.71 },
  TSM: { symbol: "TSM", price: 205.0, change: 3.5, pct: 1.74, high: 207.5, low: 200.0, open: 201.5 },
  UAL: { symbol: "UAL", price: 84.0, change: 1.65, pct: 2.0, high: 85.5, low: 81.5, open: 82.35 },
  UNH: { symbol: "UNH", price: 305.0, change: -6.2, pct: -1.99, high: 315.0, low: 300.0, open: 311.2 },
  XLE: { symbol: "XLE", price: 89.5, change: -0.65, pct: -0.72, high: 90.8, low: 88.9, open: 90.15 },
  XLF: { symbol: "XLF", price: 51.2, change: 0.3, pct: 0.59, high: 51.6, low: 50.7, open: 50.9 },
  XOM: { symbol: "XOM", price: 110.5, change: -1.1, pct: -0.99, high: 112.5, low: 109.8, open: 111.6 }
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
  GEO: {
    name: "The GEO Group",
    sector: "Private detention & corrections",
    marketCap: 2100000000,
    pe: 8.4,
    forwardPe: 7.2,
    ps: 0.42,
    grossMargin: 28,
    revenueGrowth: 4,
    freeCashFlowMargin: 8,
    debtToEquity: 1.85,
    beta: 1.12,
    analystTarget: 18,
    analystRating: "Hold",
    analystCount: 4,
    catalyst: "ICE appropriations · detention bed utilization · contract renewals",
    moat: "Long-term facility contracts with federal agencies create recurring revenue when enforcement budgets are funded.",
    plainBull: "Multi-year ICE funding improves visibility for detention bed demand and renewals.",
    plainBear: "Policy limits on private detention or lower enforcement spending directly hit occupancy."
  },
  CXW: {
    name: "CoreCivic",
    sector: "Private detention & corrections",
    marketCap: 1800000000,
    pe: 9.1,
    forwardPe: 8.0,
    ps: 0.38,
    grossMargin: 26,
    revenueGrowth: 3,
    freeCashFlowMargin: 7,
    debtToEquity: 1.72,
    beta: 1.08,
    analystTarget: 16,
    analystRating: "Hold",
    analystCount: 3,
    catalyst: "DHS/ICE funding · immigration enforcement budgets",
    moat: "Federal detention contracts tie revenue to immigration enforcement appropriations cycles.",
    plainBull: "Sustained border enforcement funding supports facility utilization.",
    plainBear: "Enforcement budget cuts or shifts away from private operators reduce contract demand."
  },
  SPCX: {
    name: "Space Exploration Technologies Corp.",
    sector: "Aerospace & launch services",
    marketCap: 2800000000000,
    pe: null,
    forwardPe: null,
    ps: 18.4,
    grossMargin: 42,
    revenueGrowth: 38,
    freeCashFlowMargin: 12,
    debtToEquity: 0.18,
    beta: 1.85,
    analystTarget: 240,
    analystRating: "Buy",
    analystCount: 12,
    catalyst: "NASA launch contracts · Starlink · Starship milestones · post-IPO lock-up",
    moat: "Reusable launch cadence, vertical integration, and Starlink scale create a durable cost advantage in orbital access.",
    plainBull: "NASA and DoD launch awards plus Starlink growth can validate the newly public equity story.",
    plainBear: "IPO valuation embeds aggressive growth; launch failures or budget shifts at NASA would hit sentiment fast."
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

const GOVERNMENT_SIGNAL_EXPOSURES = {
  NVDA: [
    "AI chip export controls",
    "AI infrastructure spending",
    "semiconductor subsidies",
    "China policy"
  ],
  AMD: [
    "AI chip export controls",
    "semiconductor subsidies",
    "data-center procurement",
    "China policy"
  ],
  AAPL: [
    "platform antitrust rules",
    "China policy",
    "app-store regulation",
    "supply-chain trade rules"
  ],
  AMZN: [
    "platform antitrust rules",
    "cloud procurement",
    "labor regulation",
    "data-center energy permitting"
  ],
  GOOGL: [
    "search antitrust remedies",
    "AI regulation",
    "cloud procurement",
    "privacy rules"
  ],
  META: [
    "privacy rules",
    "AI regulation",
    "platform competition policy",
    "content moderation scrutiny"
  ],
  MSFT: [
    "cloud procurement",
    "AI infrastructure spending",
    "cybersecurity rules",
    "antitrust review"
  ],
  LLY: [
    "Medicare drug pricing",
    "FDA approvals",
    "patent policy",
    "health-care reimbursement"
  ],
  TSLA: [
    "EV tax credits",
    "factory and charging permitting",
    "China trade policy",
    "safety investigations"
  ],
  COIN: [
    "crypto market-structure bills",
    "SEC/CFTC rulemaking",
    "stablecoin regulation",
    "banking access policy"
  ],
  GEO: ["ICE detention funding", "DHS appropriations", "immigration enforcement budgets"],
  CXW: ["ICE detention funding", "DHS appropriations", "immigration enforcement budgets"],
  PLTR: ["DHS surveillance contracts", "immigration enforcement IT", "defense AI procurement"],
  BAH: ["DHS IT modernization", "federal consulting budgets", "cybersecurity procurement"],
  SPCX: [
    "NASA launch services contracts",
    "DoD space launch procurement",
    "National security space budgets",
    "Starlink government connectivity"
  ],
  SPY: [
    "Federal Reserve path",
    "tax policy",
    "budget negotiations",
    "regulatory climate"
  ],
  QQQ: [
    "AI regulation",
    "antitrust enforcement",
    "export controls",
    "rate policy"
  ]
};

const RAW_POLICY_BILLS = [
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

const RAW_POLICY_STAKEHOLDERS = {
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

export {
  MARKET_FALLBACK,
  FUNDAMENTALS,
  CRYPTO_FALLBACK,
  GOVERNMENT_SIGNAL_EXPOSURES,
  RAW_POLICY_BILLS,
  LOBBYING_FALLBACK,
  RAW_POLICY_STAKEHOLDERS
};
