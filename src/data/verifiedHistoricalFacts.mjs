/**
 * Verified historical analogs — cite sourceUrl before using in UI or AI.
 * Stock-move claims are intentionally omitted unless tied to a cited study.
 */

export const HISTORICAL_ANALOG_PACK = {
  "medicare-smart-prices": {
    verified: true,
    title: "Inflation Reduction Act drug pricing (2022)",
    outcome:
      "IRA (P.L. 117-169) authorized Medicare to negotiate prices on a limited set of Part D drugs; broader expansion bills have been introduced in subsequent Congresses.",
    impact: "Pharma equities often trade headline risk around negotiation scope; verify current prices independently.",
    verifiedFacts: [
      {
        claim: "IRA enacted Medicare drug price negotiation framework",
        sourceUrl: "https://www.congress.gov/bill/117th-congress/house-bill/5376"
      }
    ]
  },
  "chips-implementation": {
    verified: true,
    title: "CHIPS and Science Act (2022)",
    outcome: "Senate passed 64–33 (July 27, 2022); House passed 243–187 (July 28, 2022); signed Aug. 9, 2022.",
    impact: "Semiconductor names moved on policy headlines ahead of passage; magnitude varied by name and week.",
    verifiedFacts: [
      {
        claim: "Final passage vote counts (64–33 Senate, 243–187 House)",
        sourceUrl: "https://en.wikipedia.org/wiki/CHIPS_and_Science_Act"
      },
      {
        claim: "Appropriated roughly $52.7B for CHIPS manufacturing programs",
        sourceUrl: "https://www.congress.gov/bill/117th-congress/house-bill/4346"
      }
    ]
  },
  "platform-antitrust": {
    verified: true,
    title: "House antitrust / self-preferencing packages (117th Congress)",
    outcome:
      "Several House antitrust bills (including AICOA-style proposals) advanced in committee but did not become law in the 117th Congress.",
    impact: "Mega-cap platform stocks often trade regulatory headline risk when active; recover when bills stall.",
    verifiedFacts: [
      {
        claim: "AICOA (H.R.3816, 117th) did not become law",
        sourceUrl: "https://www.congress.gov/bill/117th-congress/house-bill/3816"
      }
    ]
  },
  "crypto-market-clarity": {
    verified: true,
    title: "FIT21 / market-structure framework (118th–119th)",
    outcome:
      "H.R.4763 (FIT21) passed the House 279–136 in the 118th Congress; the 119th CLARITY Act (H.R.3633) passed the House 294–134 (July 2025) and advanced in Senate Banking.",
    impact: "Crypto-linked equities often spike on House passage headlines; Senate timing drives retracements.",
    verifiedFacts: [
      {
        claim: "H.R.4763 (118th FIT21) House passage 279–136",
        sourceUrl: "https://www.congress.gov/bill/118th-congress/house-bill/4763"
      },
      {
        claim: "H.R.3633 (CLARITY Act) House passage 294–134",
        sourceUrl: "https://www.congress.gov/bill/119th-congress/house-bill/3633"
      }
    ]
  },
  "permitting-reform": {
    verified: true,
    title: "Energy Permitting Reform Act (2024, 118th)",
    outcome:
      "S.4753 advanced Senate Energy and Natural Resources 15–4 in Aug. 2024 but did not reach floor enactment; permitting packages remain under negotiation in the 119th Congress.",
    impact: "Clean-energy and infrastructure names can move on permitting headlines; verify against project timelines.",
    verifiedFacts: [
      {
        claim: "S.4753 reported from Senate Energy Committee Aug. 2024 (15–4 vote)",
        sourceUrl: "https://www.congress.gov/bill/118th-congress/senate-bill/4753"
      }
    ]
  },
  "ai-leadership": {
    verified: true,
    title: "U.S. AI governance legislation (pre-2026)",
    outcome:
      "Congress has not enacted a comprehensive U.S. AI statute; sectoral and state rules fill the gap while House packages consolidate proposals.",
    impact: "Limited consistent US equity reaction to draft AI disclosure bills; compliance-cost narrative dominates.",
    verifiedFacts: [
      {
        claim: "No single comprehensive federal AI law as of early 2026",
        sourceUrl: "https://www.congress.gov/search?q=artificial%20intelligence"
      }
    ]
  },
  "china-outbound-investment": {
    verified: true,
    title: "Outbound investment & export-control era",
    outcome:
      "BIS semiconductor export rules and outbound-investment frameworks (including COINS-related authorities) advanced on bipartisan national-security grounds.",
    impact: "Semiconductor names with China revenue exposure often trade headline risk on export-control news.",
    verifiedFacts: [
      {
        claim: "FIGHT China Act (H.R.2246, 119th) addresses outbound investment to PRC",
        sourceUrl: "https://www.congress.gov/bill/119th-congress/house-bill/2246"
      }
    ]
  }
};

export function historicalAnalogForScenario(scenarioId, fallback = null) {
  return HISTORICAL_ANALOG_PACK[scenarioId] || fallback;
}
