/* Extracted from app.js lines 1-55 */
const FEATURE_GATES = {
  THESIS_ENABLED: true,
  PAPER_TRADING_ENABLED: true,
  MARKETS_ENABLED: true,
  PUBLIC_SHARES_ENABLED: true,
  SESSION_ENABLED: true,
  WAITLIST_ENABLED: true,
  BILLS_EXPLORER_ENABLED: true,
  CONTRACTS_ANALYZER_ENABLED: true,
  LOBBYING_EXPLORER_ENABLED: false,
  ANALYSIS_LAB_ENABLED: false,
  CRYPTO_TRACKER_ENABLED: false,
  FUNDS_HYPOTHETICALS_ENABLED: false,
  SETTINGS_PAGE_ENABLED: false,
  RELATIONSHIP_MAPS_ENABLED: false,
  AI_RESEARCH_ENABLED: false,
  ALERTS_MONITORING_ENABLED: false,
  ADVANCED_ANALYTICS_ENABLED: false
};

const VIEW_FEATURE_GATES = {
  overview: "THESIS_ENABLED",
  thesis: "THESIS_ENABLED",
  signals: "BILLS_EXPLORER_ENABLED",
  trade: "PAPER_TRADING_ENABLED",
  bills: "BILLS_EXPLORER_ENABLED",
  contracts: "CONTRACTS_ANALYZER_ENABLED",
  lobbying: "LOBBYING_EXPLORER_ENABLED",
  fec: "BILLS_EXPLORER_ENABLED",
  analysis: "ANALYSIS_LAB_ENABLED",
  markets: "MARKETS_ENABLED",
  "track-record": "ADVANCED_ANALYTICS_ENABLED",
  settings: "SETTINGS_PAGE_ENABLED",
  research: "AI_RESEARCH_ENABLED"
};

function isFeatureEnabled(featureName) {
  return FEATURE_GATES[featureName] ?? false;
}

function isViewEnabled(view) {
  const gate = VIEW_FEATURE_GATES[view];
  return gate ? isFeatureEnabled(gate) : true;
}

function syncFeatureGatesFromConfig(config) {
  if (!config?.features || typeof config.features !== "object") return;
  Object.keys(FEATURE_GATES).forEach((key) => {
    if (key in config.features) FEATURE_GATES[key] = Boolean(config.features[key]);
  });
}

function disabledFeatureFallbackView() {
  return isViewEnabled("thesis") ? "thesis" : "overview";
}
