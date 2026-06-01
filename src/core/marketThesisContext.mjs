import { normalizeThesis } from "./normalizeThesis.mjs";
import { computeThesisHealth } from "./thesisHealth.mjs";
import { computeThesisMovement } from "./thesisMovement.mjs";
import { resolveSourceBadge } from "./sourceBadges.mjs";

export function buildMarketThesisContext({
  thesis,
  signalsPayload = {},
  analysisSnapshot = {},
  socialPulse = {},
  paperAccount = {},
  outcome = null
} = {}) {
  const normalized = normalizeThesis(thesis || {});
  const signals = Array.isArray(signalsPayload?.signals) ? signalsPayload.signals : [];
  const monitors = Array.isArray(signalsPayload?.monitors)
    ? signalsPayload.monitors
    : Array.isArray(normalized.monitors)
      ? normalized.monitors
      : [];

  const signalsWithBadges = signals.map((sig) => ({
    ...sig,
    sourceBadge: resolveSourceBadge({
      kind: sig?.sourceStatus || sig?.meta?.sourceStatus || "modeled",
      confidence: sig?.confidence ?? sig?.meta?.confidence,
      label: sig?.sourceType || sig?.meta?.sourceType
    })
  }));

  const monitorBadges = monitors.map((m) => ({
    ...m,
    sourceBadge: resolveSourceBadge({
      kind: m?.sourceStatus || "modeled",
      confidence: m?.confidence,
      label: m?.src
    })
  }));

  const context = {
    thesis: normalized,
    outcome: outcome || thesis?.outcome || null,
    signals: signalsWithBadges,
    monitors: monitorBadges,
    claims: Array.isArray(signalsPayload?.claims) ? signalsPayload.claims : [],
    evidence: signalsPayload?.evidence || analysisSnapshot?.evidence || {},
    map: signalsPayload?.relationshipMap || normalized.relationshipMap,
    socialPulse,
    paperPosition: normalized.paperPosition || paperAccount?.position || null,
    updatedAt: new Date().toISOString()
  };

  context.health = computeThesisHealth({
    thesis: normalized,
    monitors: monitorBadges,
    signals: signalsWithBadges,
    healthHistory: thesis?.healthHistory || []
  });
  context.movement = computeThesisMovement({
    thesis: normalized,
    monitors: monitorBadges,
    outcome: context.outcome
  });
  return context;
}
