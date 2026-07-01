import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { remapLinkedBillIds } from "../core/policySeedRegistry.mjs";

/** Injected at boot from server.mjs via registerContractIntelligence(deps). */
let deps = {};

export function registerContractIntelligence(next = {}) {
  deps = { ...deps, ...next };
}

// ══════════════════════════════════════════════════════════════════════════════
// GOVERNMENT CONTRACT INTELLIGENCE
//
// Two separate scoring functions with two separate jobs:
// 1. computeGovernmentDependencyScore(symbol)
//    Company-level structural exposure. Used in the risk radar.
//    Does NOT use award amounts. Based on 10-K revenue mix and renewal profile.
//
// 2. computeContractEventSignal(symbol, awardAmount, agencyName)
//    Event-level signal. Used on individual contract award cards.
//    Based on CRS v2: Dependency + AgencySignal + AwardNovelty + RenewalRisk.
//    Calibrated: Spearman IC=0.145 (p=0.012), 282 events, 2015-2024.
//
// Key empirical findings:
//   - Large awards are often pre-priced (Q4 awards → -0.7% vs Q1 → +5.9% 20-day AR)
//   - Agency type matters more than award size (HHS/VA → +4.1% vs DoD → +0.9%)
//   - PLTR shows uniquely strong post-award drift (+9.1% mean 20-day AR, p=0.003)
//   - CRS is a research signal, NOT a buy/sell recommendation
// ══════════════════════════════════════════════════════════════════════════════

const CONTRACT_PROFILES = {
  LMT: {
    governmentRevenuePct: 0.94,
    renewalRisk: 0.30,
    primaryAgencies: ["Department of Defense", "Air Force", "Navy"],
    primaryPrograms: ["F-35 Lightning II", "Sikorsky helicopters", "missile systems"],
    dogeRisk: false,
    agencyBudgetRisk: "low",
    archetype: "Entrenched Contractor",
    linkedBillIds: [],
    note: "Lockheed derives 94% of revenue from government contracts, almost entirely defense. The F-35 program represents a multi-decade revenue stream with strong bipartisan congressional support.",
    archetypeExplain: "Large defense awards are heavily covered and often pre-announced via SAM.gov. The bigger question for LMT is whether defense budgets continue supporting the long-term program pipeline, not whether any single award is good news.",
    bull: "Multi-decade F-35 production and international sales provide long-duration revenue visibility.",
    bear: "F-35 cost overruns and a successful alternative aircraft program would be structural risks. DoD budget sequestration remains a tail risk."
  },
  BAH: {
    governmentRevenuePct: 0.97,
    renewalRisk: 0.60,
    primaryAgencies: ["Department of Defense", "NSA", "DHS", "civilian agencies"],
    primaryPrograms: ["IT modernization", "cybersecurity", "management consulting"],
    dogeRisk: true,
    agencyBudgetRisk: "high",
    archetype: "Fragile Contractor",
    linkedBillIds: [],
    note: "Booz Allen derives nearly all revenue from U.S. government clients. Management consulting is easier to defund than hardware programs. DOGE-style efficiency reviews are the clearest near-term risk.",
    archetypeExplain: "High government dependency with high recompete exposure creates fragility. Any federal spending environment shift is felt directly. Consulting contracts can be cancelled with less friction than weapons programs.",
    bull: "Long-term classified program exposure is difficult to cancel quickly and provides revenue stability.",
    bear: "97% government revenue means any federal workforce reduction or consulting cut is directly felt in earnings."
  },
  LDOS: {
    governmentRevenuePct: 0.88,
    renewalRisk: 0.55,
    primaryAgencies: ["Department of Defense", "VA", "HHS", "intelligence community"],
    primaryPrograms: ["IT services", "logistics", "health IT", "defense systems"],
    dogeRisk: true,
    agencyBudgetRisk: "medium",
    archetype: "Entrenched Contractor",
    linkedBillIds: [],
    note: "Leidos has both defense and civilian IT exposure. Civilian health and VA contracts may carry more new information than routine defense awards because they receive less market attention.",
    archetypeExplain: "LDOS is interesting because the civilian IT segment (VA, HHS) can surprise the market. Empirically, HHS and VA contracts produce stronger post-award drift than DoD contracts for IT companies.",
    bull: "Healthcare IT modernization at the VA is long-term and has bipartisan support.",
    bear: "IT services contracts are easier to cancel than weapons programs when budgets are under pressure."
  },
  SAIC: {
    governmentRevenuePct: 0.99,
    renewalRisk: 0.58,
    primaryAgencies: ["Department of Defense", "intelligence community", "civilian agencies"],
    primaryPrograms: ["defense IT", "C4ISR systems", "engineering services"],
    dogeRisk: true,
    agencyBudgetRisk: "medium",
    archetype: "Fragile Contractor",
    linkedBillIds: [],
    note: "SAIC is essentially a pure-play government contractor. Empirically, larger awards predict worse subsequent returns for SAIC (rho=-0.348, p=0.006), meaning big contracts are often already priced in by the time they appear on USASpending.",
    archetypeExplain: "Near-100% government revenue makes the spending environment critical. Large expected award vehicles are often already known. Smaller, novel program awards carry more signal.",
    bull: "Defense IT modernization is a multi-decade program with broad agency support.",
    bear: "Pure-play exposure means federal spending cuts hit immediately and directly."
  },
  PLTR: {
    governmentRevenuePct: 0.55,
    renewalRisk: 0.65,
    primaryAgencies: ["Department of Defense", "DHS", "CIA", "HHS"],
    primaryPrograms: ["Maven Smart System", "Gotham", "ImmigrationOS", "Foundry"],
    dogeRisk: true,
    agencyBudgetRisk: "medium",
    archetype: "Narrative-Sensitive Contractor",
    linkedBillIds: remapLinkedBillIds(["H.R.4521-119", "S.2-119"]),
    note: "PLTR is the only company in our calibration dataset with statistically significant post-award drift (+9.1% mean 20-day AR, p=0.003). Smaller, unexpected awards produce the most drift. Large IDIQ task orders are typically pre-priced.",
    archetypeExplain: "Investors use government AI adoption as evidence that PLTR's software platform is gaining durable institutional demand. A smaller award from a new agency can shift the narrative more than a big renewal of an existing program.",
    bull: "DoD AI spending is bipartisan and growing. New task orders expand both revenue and the platform adoption story.",
    bear: "Concentration in a few large DoD programs means one contract loss is an earnings-level event, not just a footnote."
  },
  GEO: {
    governmentRevenuePct: 0.72,
    renewalRisk: 0.68,
    primaryAgencies: ["Department of Homeland Security", "ICE", "U.S. Marshals Service"],
    primaryPrograms: ["immigration detention facilities", "community corrections"],
    dogeRisk: false,
    agencyBudgetRisk: "high",
    archetype: "Narrative-Sensitive Contractor",
    linkedBillIds: remapLinkedBillIds(["S.2-119"]),
    note: "GEO Group operates private detention facilities used by ICE. Appropriations and enforcement budgets directly affect bed-day demand and contract renewals.",
    archetypeExplain: "ICE detention funding is a direct revenue driver — when Congress advances multi-year enforcement appropriations, investors reprice detention operators on expected facility utilization.",
    bull: "Multi-year ICE funding reduces near-term appropriations uncertainty for detention operators.",
    bear: "Policy shifts away from private detention or lower enforcement budgets would hit utilization and contract renewals."
  },
  CXW: {
    governmentRevenuePct: 0.68,
    renewalRisk: 0.66,
    primaryAgencies: ["Department of Homeland Security", "ICE", "Federal Bureau of Prisons"],
    primaryPrograms: ["immigration detention", "correctional facilities"],
    dogeRisk: false,
    agencyBudgetRisk: "high",
    archetype: "Narrative-Sensitive Contractor",
    linkedBillIds: remapLinkedBillIds(["S.2-119"]),
    note: "CoreCivic runs immigration detention and corrections facilities. DHS/ICE appropriations are the primary demand signal.",
    archetypeExplain: "Border and immigration enforcement budgets flow to detention bed capacity — CoreCivic moves with ICE funding visibility more than broad market beta.",
    bull: "Sustained ICE appropriations support facility occupancy and renewal pipelines.",
    bear: "Enforcement budget cuts or policy limits on private detention reduce the addressable contract base."
  },
  SPCX: {
    governmentRevenuePct: 0.52,
    renewalRisk: 0.45,
    primaryAgencies: ["National Aeronautics and Space Administration", "Department of Defense", "Space Force"],
    primaryPrograms: ["Falcon 9 launch services", "Falcon Heavy", "Starship", "Starlink", "NASA VADR task orders"],
    dogeRisk: false,
    agencyBudgetRisk: "medium",
    archetype: "Narrative-Sensitive Contractor",
    linkedBillIds: [],
    note: "SpaceX derives a large share of revenue from NASA and DoD launch awards plus government Starlink connectivity. As a newly public company, smaller unexpected civilian-space awards can carry more narrative weight than routine NASA task orders.",
    archetypeExplain: "Federal launch awards validate capacity and backlog for investors watching post-IPO execution. NASA VADR and national-security launch task orders are direct revenue drivers — less about a single award size than sustained government demand visibility.",
    bull: "NASA and DoD launch pipelines plus Starlink government adoption support multi-year backlog visibility.",
    bear: "Launch failures, NASA budget cuts, or loss of national-security launch certification would hit both revenue and sentiment."
  }
};

/** Curated public figures → tickers (not live social feeds in v1). */
const FIGURE_LINKS = [
  {
    name: "Jensen Huang",
    label: "NVIDIA CEO — export control & AI infrastructure testimony",
    date: "2026-04-10",
    symbols: ["NVDA", "AMD"],
    url: "https://www.congress.gov/search?q=NVIDIA+export+controls"
  },
  {
    name: "Tim Cook",
    label: "Apple CEO — App Store & antitrust oversight hearing",
    date: "2026-03-22",
    symbols: ["AAPL", "GOOGL", "META"],
    url: "https://www.congress.gov/search?q=Apple+App+Store+antitrust"
  },
  {
    name: "Satya Nadella",
    label: "Microsoft CEO — federal AI procurement & cloud security briefing",
    date: "2026-04-05",
    symbols: ["MSFT", "NVDA", "PLTR"],
    url: "https://www.congress.gov/search?q=Microsoft+AI+government"
  },
  {
    name: "Bernie Sanders",
    label: "Senate sponsor — Medicare drug pricing expansion push",
    date: "2026-04-28",
    symbols: ["LLY", "MRK", "PFE", "ABBV"],
    url: "https://www.congress.gov/search?q=Medicare+drug+price+negotiation"
  },
  {
    name: "Brian Armstrong",
    label: "Coinbase CEO — digital asset market-structure testimony",
    date: "2026-03-18",
    symbols: ["COIN"],
    url: "https://www.congress.gov/search?q=crypto+market+structure"
  },
  {
    name: "Elon Musk",
    label: "SpaceX CEO — NASA launch contracts & space procurement policy",
    date: "2026-06-12",
    symbols: ["SPCX", "TSLA"],
    url: "https://www.congress.gov/search?q=SpaceX+NASA+launch"
  }
];

const FUND_TAGS = new Set(["legislation", "contracts", "lobbying", "figures", "custom"]);

const LOBBY_CLIENT_TICKERS = {
  "eli lilly": ["LLY"],
  "abbvie": ["ABBV"],
  "nvidia": ["NVDA"],
  "amazon": ["AMZN"],
  "coinbase": ["COIN"],
  "apple": ["AAPL"],
  "google": ["GOOGL"],
  "meta": ["META"],
  "microsoft": ["MSFT"],
  "intel": ["INTC"],
  "phrma": ["LLY", "MRK", "PFE", "ABBV"],
  "geo group": ["GEO"],
  "corecivic": ["CXW"],
  "palantir": ["PLTR"],
  "spacex": ["SPCX"],
  "space exploration": ["SPCX"]
};

// Agency signal scores: higher = less analyst coverage = more informational value
// Calibrated from empirical data:
//   HHS/VA contracts → +4.1% mean 20-day abnormal return (n=41)
//   DoD contracts → +0.9% mean 20-day abnormal return (n=162, noise level)
function agencySignalScore(agencyName) {
  if (!agencyName) return 55;
  const a = String(agencyName).toLowerCase();
  if (a.includes("health") || a.includes("veteran") || a.includes("hhs")) return 85;
  if (a.includes("homeland") || a.includes("transportation")) return 70;
  if (a.includes("energy") || a.includes("education") || a.includes("agriculture")) return 65;
  if (a.includes("defense") || a.includes("army") || a.includes("navy") ||
      a.includes("air force") || a.includes("marine") || a.includes("pentagon")) return 35;
  if (a.includes("general services") || a.includes("gsa")) return 45;
  return 55;
}

// Inverted log-size: smaller, more unexpected awards score higher
// Q1 awards (<$30M): +5.9% 20-day AR | Q4 awards (>$500M): -0.7% 20-day AR
// Large awards are typically pre-announced via SAM.gov and already priced in
function awardNoveltyScore(awardAmount) {
  const logAmt = Math.log(Math.max(Number(awardAmount) || 1e6, 1e6));
  // $10M=23.0 max, $10B=16.1 min (approx log scale)
  const raw = (23.0 - logAmt) / (23.0 - 16.1) * 100;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

// Company-level structural exposure — used for risk radar, NOT event scoring
// Measures how dependent the business model is on government money
function computeGovernmentDependencyScore(symbol) {
  const profile = CONTRACT_PROFILES[String(symbol || "").toUpperCase()];
  if (!profile) return null;
  const depScore     = profile.governmentRevenuePct * 100;                       // 0-100
  const renewScore   = profile.renewalRisk * 100;                                // 0-100
  const budgetScore  = profile.agencyBudgetRisk === "high" ? 80
    : profile.agencyBudgetRisk === "medium" ? 55 : 25;                          // 0-100
  const dogeScore    = profile.dogeRisk ? 70 : 30;                              // 0-100
  // Weights: dependency 45%, renewal 25%, budget risk 15%, efficiency review 15%
  const score = 0.45*depScore + 0.25*renewScore + 0.15*budgetScore + 0.15*dogeScore;
  return Math.round(Math.min(100, Math.max(0, score)));
}

// Event-level signal — used per contract award card
// Returns structured object with score, explanation, and watch items
function computeContractEventSignal(symbol, awardAmount, agencyName) {
  const profile = CONTRACT_PROFILES[String(symbol || "").toUpperCase()];
  if (!profile) return null;

  const dep     = profile.governmentRevenuePct * 100;  // 0-100
  const agSig   = agencySignalScore(agencyName);       // 0-100
  const novelty = awardNoveltyScore(awardAmount);      // 0-100
  const renewal = profile.renewalRisk * 100;           // 0-100

  // CRS v2 formula — calibrated weights
  const score = Math.round(Math.min(100, Math.max(0,
    0.30*dep + 0.30*agSig + 0.25*novelty + 0.15*renewal
  )));

  const label = score >= 75 ? "High signal"
    : score >= 45 ? "Monitor"
    : score >= 15 ? "Watch"
    : "Low signal";

  const agSigLabel = agSig >= 70 ? "less analyst coverage — higher surprise value"
    : agSig >= 50 ? "moderate analyst coverage"
    : "heavily covered — often pre-priced";

  const noveltyLabel = novelty >= 70 ? "small, unexpected award — higher information value"
    : novelty >= 40 ? "mid-size award — mixed signal"
    : "large award — likely already known to the market";

  const pricedInAssessment = novelty < 30 && agSig < 50
    ? "Likely already priced in"
    : novelty >= 60 || agSig >= 70
    ? "More likely new information"
    : "Mixed — depends on timing and market awareness";

  const plainEnglish = agSig >= 70
    ? `This is an award from ${agencyName || "a less-covered agency"}, which historically has produced stronger stock reactions than routine defense awards. That may be because fewer analysts track civilian government IT, making the news genuinely surprising.`
    : agSig <= 40
    ? `This is a contract from ${agencyName || "a major defense agency"}, which is typically well-covered by analysts. Large defense awards like this are often announced in advance via SAM.gov, so the market may already have expected it.`
    : `This award is from a moderately covered agency. Whether it matters depends on whether it represents a new program or a renewal of something already expected.`;

  const watchNext = [
    "Follow-on task orders from the same agency",
    `${profile.primaryAgencies[0] || "Agency"} budget request for next fiscal year`,
    "Company earnings call commentary on government pipeline",
    "SAM.gov solicitations for related contract vehicles",
    renewal > 0.5 ? "Contract recompete timeline" : null
  ].filter(Boolean).slice(0, 3);

  return {
    score,
    label,
    pricedInAssessment,
    plainEnglish,
    components: { dep, agSig, novelty, renewal },
    agSigLabel,
    noveltyLabel,
    watchNext,
    archetype: profile.archetype,
    archetypeExplain: profile.archetypeExplain,
    confidence: "Medium — calibrated on 282 events (5 companies, 2015–2024). Treat as directional signal.",
    dataNote: `${agencyName?.includes("Defense") ? "DoD awards may lag USASpending by up to 90 days." : "Non-DoD awards typically appear within 3 business days."} Not investment advice.`
  };
}

function buildGovernmentMoneyTrail(symbol, awardAmount, agencyName, programName) {
  const profile = CONTRACT_PROFILES[String(symbol || "").toUpperCase()];
  if (!profile) return null;
  const sig = computeContractEventSignal(symbol, awardAmount, agencyName);
  const agency = agencyName || profile.primaryAgencies[0] || "Federal agency";
  const program = programName || profile.primaryPrograms[0] || "Government program";
  const pct = Math.round(profile.governmentRevenuePct * 100);

  return {
    headline: `${symbol}: Government contract award from ${agency}`,
    simpleSummary: `${profile.archetype}. ${sig?.plainEnglish || ""}`,
    chain: [
      {
        label: "Government event",
        value: `Contract award from ${agency}`,
        explanation: `The federal government awarded a contract to ${symbol}. This appears in USASpending.gov public data.`
      },
      {
        label: "Agency mechanism",
        value: agency,
        explanation: `${sig?.agSigLabel || "Agency coverage level unknown"}. ${agency.includes("Health") || agency.includes("Veteran") ? "Civilian health agencies receive less analyst attention than DoD." : agency.includes("Defense") ? "DoD is the most tracked contracting agency — awards are often expected." : "Coverage level is moderate."}`
      },
      {
        label: "Program channel",
        value: program,
        explanation: `${sig?.noveltyLabel || "Award size context unknown"}. The channel from this program to company revenue depends on contract structure (IDIQ vs firm-fixed-price) and the company's existing program mix.`
      },
      {
        label: "Company exposure",
        value: `${pct}% of ${symbol} revenue is from government contracts`,
        explanation: `${profile.note} Archetype: ${profile.archetype}.`
      },
      {
        label: "Business mechanism",
        value: sig?.pricedInAssessment || "Unknown",
        explanation: `${profile.archetype === "Narrative-Sensitive Contractor"
          ? "For this company, government awards affect the growth story as much as the direct revenue. Investors watch contract flow as evidence of platform adoption."
          : "The primary mechanism is revenue — contract awards add to backlog and reduce near-term revenue uncertainty."}`
      },
      {
        label: "Investor scenario",
        value: sig?.label || "Monitor",
        explanation: `${profile.bull} Risk: ${profile.bear}`
      },
      {
        label: "Watch next",
        value: (sig?.watchNext || []).join(" · "),
        explanation: "These are the specific events that would confirm or weaken the thesis from this contract signal."
      }
    ],
    limitations: [
      "USASpending data may lag the actual contract signing date by up to 90 days for DoD.",
      "CRS calibration used 5 companies and 282 events — treat as directional, not precise.",
      "Correlation is not causation. Post-award returns are influenced by many factors.",
      "This is not investment advice."
    ]
  };
}

async function contractCausality(res, url) {
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase().trim();
  if (!symbol) return deps.sendJson(res, 400, { error: "symbol_required" });

  const profile = CONTRACT_PROFILES[symbol] || null;
  const depScore = computeGovernmentDependencyScore(symbol);
  const relatedBills = deps.POLICY_BILLS.filter((b) => (b.affected || []).includes(symbol));

  // Bars are always derived from contract profile (if present)
  const govPct     = profile ? Math.round(profile.governmentRevenuePct * 100) : null;
  const renewalPct = profile ? Math.round(profile.renewalRisk * 100) : null;
  const budgetNum  = profile ? (profile.agencyBudgetRisk === "high" ? 80 : profile.agencyBudgetRisk === "medium" ? 55 : 25) : null;
  const primaryAgency  = profile?.primaryAgencies?.[0] || "Federal agencies";
  const agSig = agencySignalScore(primaryAgency);

  const bars = profile ? [
    { label: `${primaryAgency.split(" ").slice(-1)[0]} exposure`, value: govPct, display: `${govPct}%` },
    { label: "Renewal risk", value: renewalPct, display: String(renewalPct) },
    { label: "Award novelty", value: 100 - agSig, display: String(100 - agSig) },
    { label: "Budget risk", value: budgetNum, display: profile.agencyBudgetRisk }
  ] : [];

  const evidence = [
    { source: "USASpending",    title: "What was awarded?",         detail: "Federal award amount, agency, recipient, date, and program fields." },
    { source: "SAM.gov",        title: "Was it expected?",           detail: "Solicitations, sources-sought notices, deadlines, and incumbent context." },
    { source: "Congress.gov",   title: "What funds it?",             detail: "Appropriations bills, authorization, committee actions, and latest status." },
    { source: "10-K / SEC",     title: "Does revenue depend on it?", detail: govPct ? `~${govPct}% government revenue${profile?.archetype ? ` (${profile.archetype})` : ""}. Customer concentration, backlog, and risk factor language.` : "Check 10-K for government revenue concentration and risk factor language." },
    { source: "LDA / lobbying", title: "Who is pushing?",            detail: "Lobbying spend, issue area pressure, and bill-aligned activity around agency budgets." }
  ];

  // If AI key is available, generate dynamic analysis
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const lobbyingContext = relatedBills.length
        ? `${relatedBills.length} mapped bills with momentum scores ${relatedBills.map(b => b.momentum ?? "?").join(", ")}.`
        : "";
      const ai = await deps.runCausalityAnalyzer({
        symbol,
        companyName: profile?.note?.split(" ")[0] || symbol,
        bills: relatedBills,
        lobbyingContext,
        contractProfile: profile,
      });
      return deps.sendJson(res, 200, {
        symbol,
        archetype: profile?.archetype || null,
        dogeRisk: profile?.dogeRisk || false,
        scores: { dependency: depScore, changeRisk: renewalPct ?? 50, confidence: depScore > 70 ? "Medium-high" : relatedBills.length ? "Medium" : "Low" },
        plainEnglish: ai.plainEnglish || profile?.note || `Policy and contract signals for ${symbol} are being analyzed.`,
        archetypeExplain: profile?.archetypeExplain || "",
        nodes: ai.nodes,
        bars,
        scenarios: ai.scenarios,
        translation: ai.translation,
        evidence,
        aiGenerated: true,
        billCount: relatedBills.length
      });
    } catch (err) {
      console.warn("[causality] AI generation failed, using template fallback:", err.message);
    }
  }

  // Template fallback — works for CONTRACT_PROFILES tickers, generic for others
  if (!profile) {
    // Generic fallback for tickers not in CONTRACT_PROFILES
    const genericNodes = relatedBills.length ? relatedBills.slice(0, 4).map((bill, i) => ({
      step: `${i + 1} · Bill exposure`,
      title: bill.title,
      detail: bill.impact || bill.policyImpact || `This bill affects ${symbol} through ${bill.issueArea || "policy pressure"}.`,
      source: "Congress.gov"
    })) : [
      { step: "1 · Policy scan", title: `No direct bill exposure mapped for ${symbol}`, detail: "This ticker is not currently in TradeSimple's contract or bill mapping. Add an Anthropic API key in Settings to enable AI-powered causality analysis for any ticker.", source: "TradeSimple model" }
    ];
    return deps.sendJson(res, 200, {
      symbol, archetype: null, dogeRisk: false,
      scores: { dependency: depScore, changeRisk: 50, confidence: "Low" },
      plainEnglish: `${symbol} is not in the government contractor database. ${relatedBills.length ? `${relatedBills.length} mapped bill(s) may create indirect exposure.` : "No direct policy exposure is currently mapped."}`,
      archetypeExplain: "", nodes: genericNodes, bars: [], scenarios: [], translation: [], evidence, aiGenerated: false, billCount: relatedBills.length
    });
  }

  const isNarrative = profile.archetype === "Narrative-Sensitive Contractor";
  const primaryProgram = profile.primaryPrograms?.[0] || "Government programs";
  const changeRisk = Math.round(0.50 * renewalPct + 0.30 * budgetNum + 0.20 * (profile.dogeRisk ? 70 : 20));
  deps.sendJson(res, 200, {
    symbol, archetype: profile.archetype, dogeRisk: profile.dogeRisk,
    scores: { dependency: depScore, changeRisk, confidence: depScore > 70 ? "Medium-high" : "Medium" },
    plainEnglish: profile.note, archetypeExplain: profile.archetypeExplain,
    nodes: [
      { step: "1 · Budget source",     title: `${primaryAgency} appropriations set the funding pool`,   detail: `If Congress expands or cuts this account, ${symbol}'s opportunity set changes directly.`, source: "Congress.gov" },
      { step: "2 · Agency buyer",      title: `${primaryAgency} is the primary demand center`,           detail: agSig >= 70 ? "Civilian agencies have thinner analyst coverage — awards carry higher surprise value." : "DoD is the most tracked agency. Awards are usually expected months ahead.", source: "USASpending" },
      { step: "3 · Procurement signal",title: "Solicitation history sets the surprise bar",              detail: agSig <= 40 ? "Large defense awards are often pre-announced via SAM.gov and already priced in." : "Awards from this agency tend to receive less pre-announcement coverage, which raises informational value.", source: "SAM.gov" },
      { step: "4 · Company exposure",  title: `${govPct}% of ${symbol} revenue is government-linked`,   detail: `${profile.archetype}. Revenue concentration means budget decisions map directly to earnings.`, source: "10-K filing" },
      { step: "5 · Market mechanism",  title: isNarrative ? "Investors price adoption curve, not just revenue" : "Investors price durability and renewal risk", detail: isNarrative ? "Contract awards validate platform adoption. Small awards from new agencies can shift multiples beyond their revenue contribution." : "Renewal risk, program durability, and margin profile drive scenario modeling.", source: "Model logic" },
      { step: "6 · Watch next",        title: `Track ${primaryProgram} and recompete timing`,            detail: profile.bull, source: "Alert rule" }
    ],
    bars,
    scenarios: [
      { name: "Upside",   change: profile.bull, read: isNarrative ? "Supports adoption narrative and can expand multiple." : "Confirms revenue durability, but large awards are often partly expected.", cls: "positive" },
      { name: "Base",     change: "Funding stays stable and contract flow continues.", read: "Confirms business quality more than it creates a new market surprise.", cls: "warning" },
      { name: "Downside", change: profile.bear, read: "Raises renewal risk and can pressure forward revenue and margin assumptions.", cls: "negative" }
    ],
    translation: [
      { step: "A", title: "What happened?",      body: `A contract award or budget signal appeared for ${symbol} in public government data.` },
      { step: "B", title: "Why does it matter?", body: `${govPct}% of ${symbol} revenue runs through government agencies. Budget decisions are felt directly in earnings.` },
      { step: "C", title: "What could change?",  body: "Future sales, renewal odds, margin durability, or investor confidence in the government business line." },
      { step: "D", title: "What to watch?",      body: profile.dogeRisk ? "Agency efficiency reviews, budget markups, recompete schedules, and earnings guidance on government pipeline." : `NDAA markup, budget appropriations for ${primaryAgency}, SAM.gov solicitations for ${primaryProgram}, and management comments on program health.` }
    ],
    evidence, aiGenerated: false, billCount: relatedBills.length
  });
}

export {
  CONTRACT_PROFILES,
  FIGURE_LINKS,
  FUND_TAGS,
  LOBBY_CLIENT_TICKERS,
  agencySignalScore,
  awardNoveltyScore,
  computeGovernmentDependencyScore,
  computeContractEventSignal,
  buildGovernmentMoneyTrail,
  contractCausality
};
