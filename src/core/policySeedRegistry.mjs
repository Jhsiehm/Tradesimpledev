/**
 * Canonical metadata for policy scenario seeds.
 * Maps legacy internal IDs to real Congress refs or scenario-only slugs.
 */

import { historicalAnalogForScenario } from "../data/verifiedHistoricalFacts.mjs";

const CONGRESS_TYPE_LABEL = {
  s: "S.",
  hr: "H.R.",
  hjres: "H.J.Res.",
  sjres: "S.J.Res.",
  hres: "H.Res.",
  sres: "S.Res."
};

export const SEED_REGISTRY = {
  "S.2547-119": {
    scenarioId: "medicare-smart-prices",
    migrateId: "S.1836-119",
    congressRef: { type: "s", number: "1836", congress: "119" },
    title: "Strengthening Medicare And Reducing Taxpayer Prices Act",
    shortTitle: "SMART Prices Act — expand Medicare drug negotiation",
    sponsor: { name: "A. Klobuchar", party: "D", state: "MN" },
    ldaKeywords: ["medicare", "drug", "pharmaceutical", "prescription", "negotiation", "medicaid"],
    clearPlaceholderFacts: true
  },
  "H.R.4521-119": {
    scenarioId: "chips-implementation",
    migrateId: "scenario:chips-implementation",
    scenarioOnly: true,
    congressRef: null,
    title: "CHIPS Act implementation & fab grants (enacted law)",
    shortTitle: "CHIPS P.L. 117-167 grant disbursements",
    ldaKeywords: ["semiconductor", "chips", "manufacturing", "fab", "science act"],
    clearPlaceholderFacts: true,
    plainEnglish:
      "The CHIPS and Science Act (P.L. 117-167, signed Aug. 2022) is already law. This scenario tracks grant disbursement and fab build-out — not a new bill vote."
  },
  "H.R.7813-119": {
    scenarioId: "platform-antitrust",
    migrateId: "scenario:platform-antitrust",
    scenarioOnly: true,
    congressRef: null,
    title: "Platform competition / self-preferencing (scenario)",
    shortTitle: "Big-tech platform regulation risk",
    ldaKeywords: ["antitrust", "platform", "self-preferencing", "marketplace", "app store", "search"],
    clearPlaceholderFacts: true,
    plainEnglish:
      "Scenario based on prior antitrust packages (e.g. AICOA, 117th Congress). Watch live Judiciary markups for a current bill link."
  },
  "S.1823-119": {
    scenarioId: "crypto-market-clarity",
    migrateId: "H.R.3633-119",
    congressRef: { type: "hr", number: "3633", congress: "119" },
    title: "Digital Asset Market Clarity Act of 2025",
    shortTitle: "CLARITY Act — SEC/CFTC digital-commodity framework",
    sponsor: { name: "J. French Hill", party: "R", state: "AR" },
    ldaKeywords: ["digital asset", "cryptocurrency", "bitcoin", "blockchain", "commodity", "sec", "cftc"],
    clearPlaceholderFacts: true,
    plainEnglish:
      "House-passed market-structure bill (CLARITY Act). Defines CFTC vs SEC roles for digital commodities — watch Senate Banking reconciliation."
  },
  "S.3891-119": {
    scenarioId: "permitting-reform",
    migrateId: "scenario:permitting-reform",
    scenarioOnly: true,
    congressRef: null,
    title: "Federal energy permitting reform (scenario)",
    shortTitle: "NEPA / permitting timeline compression",
    ldaKeywords: ["permitting", "nepa", "energy", "transmission", "renewable", "infrastructure"],
    clearPlaceholderFacts: true,
    plainEnglish:
      "Scenario tracks bipartisan permitting-reform negotiations. Prior vehicle: S.4753 (EPRA, 118th) advanced committee 15–4 but did not enact."
  },
  "H.R.3456-119": {
    scenarioId: "ai-leadership",
    migrateId: "H.R.8516-119",
    congressRef: { type: "hr", number: "8516", congress: "119" },
    title: "American Leadership in Artificial Intelligence Act",
    shortTitle: "Consolidated House AI governance package",
    sponsor: { name: "T. Lieu", party: "D", state: "CA" },
    ldaKeywords: ["artificial intelligence", "machine learning", "algorithm", "ai safety", "transparency"],
    clearPlaceholderFacts: true,
    plainEnglish:
      "Bipartisan House package consolidating prior AI proposals — standards, federal adoption, and accountability themes."
  },
  "H.R.6023-119": {
    scenarioId: "china-outbound-investment",
    migrateId: "H.R.2246-119",
    congressRef: { type: "hr", number: "2246", congress: "119" },
    title: "FIGHT China Act",
    shortTitle: "Outbound investment guardrails on PRC military-tech",
    sponsor: { name: "A. Barr", party: "R", state: "KY" },
    ldaKeywords: ["china", "outbound investment", "semiconductor", "national security", "ccp", "sanction"],
    clearPlaceholderFacts: true,
    plainEnglish:
      "Restricts U.S. outbound investment into sensitive PRC sectors — relevant for semis/AI names with China revenue exposure."
  }
};

export function congressRefToBillId(ref) {
  if (!ref?.type || !ref?.number || !ref?.congress) return null;
  const label = CONGRESS_TYPE_LABEL[String(ref.type).toLowerCase()] || `${ref.type}.`;
  return `${label}${ref.number}-${ref.congress}`;
}

export function parseBillIdToCongressRef(id) {
  if (String(id).startsWith("scenario:")) return null;
  const dashIdx = String(id).lastIndexOf("-");
  if (dashIdx < 0) return null;
  const congress = id.slice(dashIdx + 1);
  const typeAndNum = id.slice(0, dashIdx);
  const dotIdx = typeAndNum.lastIndexOf(".");
  if (dotIdx < 0) return null;
  const typeRaw = typeAndNum.slice(0, dotIdx).toUpperCase();
  const number = typeAndNum.slice(dotIdx + 1);
  const TYPE_MAP = {
    S: "s",
    "H.R": "hr",
    "H.J.RES": "hjres",
    "S.J.RES": "sjres",
    "H.RES": "hres",
    "S.RES": "sres"
  };
  const type = TYPE_MAP[typeRaw] || typeRaw.toLowerCase().replace(/\./g, "");
  return { congress, type, number };
}

function stripSeedLobbyingDollars(bill) {
  return {
    ...bill,
    lobbyingAgainst: null,
    lobbyingFor: null,
    lobbyingSource: null,
    _seedLobbyingNote: bill.lobbyingNote || null
  };
}

export function applySeedRegistry(bill) {
  const stripped = stripSeedLobbyingDollars(bill);
  const reg = SEED_REGISTRY[bill.id];
  if (!reg) {
    const ref = stripped.congressRef || parseBillIdToCongressRef(stripped.id);
    const scenarioId =
      stripped.scenarioId ||
      (String(stripped.id).startsWith("scenario:")
        ? stripped.id.slice("scenario:".length)
        : String(stripped.id).replace(/-\d+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    const analog = historicalAnalogForScenario(scenarioId, stripped.historicalAnalog);
    return {
      ...stripped,
      scenarioId,
      congressRef: ref,
      scenarioOnly: stripped.scenarioOnly === true || String(stripped.id).startsWith("scenario:"),
      historicalAnalog: analog || stripped.historicalAnalog
    };
  }

  const congressRef = reg.congressRef ?? null;
  const migrateId =
    reg.migrateId ||
    (congressRef ? congressRefToBillId(congressRef) : `scenario:${reg.scenarioId}`);
  const scenarioOnly = reg.scenarioOnly === true || !congressRef;
  const historicalAnalog = historicalAnalogForScenario(reg.scenarioId, reg.historicalAnalog);

  const next = {
    ...stripped,
    scenarioId: reg.scenarioId,
    id: migrateId,
    congressRef,
    scenarioOnly,
    ldaKeywords: reg.ldaKeywords || stripped.tags || [],
    exactCongressRecord: false,
    sourceKind: scenarioOnly ? "tradesimple_scenario" : "tradesimple_modeled_seed",
    sourceNote: scenarioOnly
      ? "TradeSimple scenario — factual status from Congress.gov when linked. Dollar impacts remain scenario models."
      : "Linked to Congress.gov when API key is configured. Impact ranges remain scenario models.",
    historicalAnalog: historicalAnalog || stripped.historicalAnalog
  };

  if (reg.title) next.title = reg.title;
  if (reg.shortTitle) next.shortTitle = reg.shortTitle;
  if (reg.plainEnglish) next.plainEnglish = reg.plainEnglish;
  if (reg.sponsor) next.sponsor = reg.sponsor;

  if (reg.clearPlaceholderFacts && !next.exactCongressRecord) {
    next._placeholderFacts = true;
    next.status = "scenario";
    next.latestAction = "Awaiting Congress.gov refresh — scenario narrative only.";
    next.latestActionDate = null;
    next.cosponsors = null;
    next.floorScheduled = false;
    if (!reg.sponsor) next.sponsor = { name: "—", party: "U", state: "" };
  }

  if (!next.lobbyingNote && next._seedLobbyingNote) {
    next.lobbyingNote = "Lobbying dollars load from Senate LDA when SENATE_LDA_API_KEY is set.";
  }

  return next;
}

export function initializePolicyBills(rawBills) {
  return rawBills.map(applySeedRegistry);
}

/** Map legacy dashboard IDs (pre-migration) to canonical bill ids. */
export function resolveBillIdCanonical(billIdRaw) {
  const raw = String(billIdRaw || "").trim();
  if (!raw) return "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const reg = SEED_REGISTRY[decoded] || SEED_REGISTRY[raw];
  if (reg?.migrateId) return reg.migrateId;
  return decoded;
}

export function remapStakeholderKeys(stakeholders, registry = SEED_REGISTRY) {
  const out = { ...stakeholders };
  for (const [legacyId, reg] of Object.entries(registry)) {
    if (!out[legacyId]) continue;
    const newId =
      reg.migrateId ||
      (reg.congressRef ? congressRefToBillId(reg.congressRef) : `scenario:${reg.scenarioId}`);
    if (newId !== legacyId) {
      out[newId] = out[legacyId];
      delete out[legacyId];
    }
  }
  return out;
}

export function remapLinkedBillIds(ids, registry = SEED_REGISTRY) {
  return (ids || []).map((id) => {
    const reg = registry[id];
    if (!reg) return id;
    return (
      reg.migrateId ||
      (reg.congressRef ? congressRefToBillId(reg.congressRef) : `scenario:${reg.scenarioId}`)
    );
  });
}

export function listSeedValidationIssues(bills) {
  const issues = [];
  for (const bill of bills) {
    if (bill.scenarioOnly) continue;
    const ref = bill.congressRef || parseBillIdToCongressRef(bill.id);
    if (!ref) {
      issues.push({ billId: bill.id, code: "missing_congress_ref", message: "No congressRef and id is not parseable." });
      continue;
    }
    if (bill._placeholderFacts && bill.exactCongressRecord) {
      issues.push({ billId: bill.id, code: "conflict", message: "Placeholder facts with exactCongressRecord." });
    }
  }
  return issues;
}
