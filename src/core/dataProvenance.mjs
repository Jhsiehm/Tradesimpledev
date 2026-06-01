/**
 * Field-level provenance for TradeSimple API responses.
 * Separates live facts from scenario models.
 */

export const DATA_LAYERS = {
  live: "live",
  verified_historical: "verified_historical",
  scenario: "scenario",
  unavailable: "unavailable"
};

export function fieldProvenance(layer, source, extra = {}) {
  return {
    layer,
    source,
    fetchedAt: extra.fetchedAt || null,
    verifiedAt: extra.verifiedAt || null,
    sourceUrl: extra.sourceUrl || null,
    note: extra.note || null
  };
}

export function buildDataMode(feeds = {}) {
  const values = Object.values(feeds);
  if (!values.length) return "scenario";
  const allLive = values.every((f) => f?.status === "connected" && !f?.fallback);
  const anyLive = values.some((f) => f?.status === "connected" && !f?.fallback);
  const anyFallback = values.some((f) => f?.fallback || f?.status === "fallback");
  if (allLive) return "live";
  if (anyLive && anyFallback) return "mixed";
  if (anyFallback && !anyLive) return "scenario";
  return anyLive ? "mixed" : "scenario";
}

export function provenanceEnvelope({ dataMode, fields = {}, warnings = [], staleAfterMinutes = 60 }) {
  return {
    dataMode,
    fields,
    warnings: [...warnings],
    staleAfterMinutes,
    generatedAt: new Date().toISOString()
  };
}

export function billFieldMap(bill) {
  const exact = bill?.exactCongressRecord === true;
  const scenarioOnly = bill?.scenarioOnly === true;
  return {
    title: fieldProvenance(
      exact ? DATA_LAYERS.live : DATA_LAYERS.scenario,
      exact ? "congress.gov" : "tradesimple_scenario",
      { note: bill?.sourceNote || null }
    ),
    status: fieldProvenance(
      exact ? DATA_LAYERS.live : scenarioOnly ? DATA_LAYERS.unavailable : DATA_LAYERS.scenario,
      exact ? "congress.gov" : "tradesimple_scenario_placeholder",
      { note: scenarioOnly ? "Status shown only after Congress.gov refresh." : null }
    ),
    latestActionDate: fieldProvenance(
      exact ? DATA_LAYERS.live : DATA_LAYERS.unavailable,
      exact ? "congress.gov" : "pending_refresh"
    ),
    sponsor: fieldProvenance(
      exact ? DATA_LAYERS.live : DATA_LAYERS.unavailable,
      exact ? "congress.gov" : "pending_refresh"
    ),
    passImpacts: fieldProvenance(DATA_LAYERS.scenario, "tradesimple_model_v2", {
      note: "Illustrative range — not a forecast."
    }),
    lobbyingAgainst: fieldProvenance(
      bill?.lobbyingAgainst != null && bill?.lobbyingSource === "lda"
        ? DATA_LAYERS.live
        : DATA_LAYERS.scenario,
      bill?.lobbyingSource === "lda" ? "senate_lda" : "tradesimple_scenario"
    ),
    historicalAnalog: fieldProvenance(
      bill?.historicalAnalog?.verified ? DATA_LAYERS.verified_historical : DATA_LAYERS.scenario,
      bill?.historicalAnalog?.verified ? "verified_historical_pack" : "tradesimple_scenario"
    )
  };
}

export function attachProvenance(payload, envelope) {
  if (!payload || typeof payload !== "object") return payload;
  return { ...payload, provenance: envelope };
}
