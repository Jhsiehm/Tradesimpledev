const DEFAULT_CONFIDENCE = {
  score: null,
  label: "unscored",
  explanation: "Legacy thesis has not been scored yet."
};

const DEFAULT_HEALTH = {
  score: null,
  trend: "unknown",
  explanation: "No health history available yet."
};

const DEFAULT_RELATIONSHIP_MAP = {
  nodes: [],
  edges: []
};

function asArray(input) {
  return Array.isArray(input) ? input.filter((x) => x != null) : [];
}

function requiredStructuredMissing(out) {
  return !out.timeHorizon || !out.direction || !out.thesisRestatement;
}

export function normalizeThesis(rawThesis = {}) {
  const schemaVersion = Number(rawThesis.schemaVersion) || 1;
  const thesisText = String(
    rawThesis.thesisText || rawThesis.thesis || rawThesis.originalThesisText || ""
  ).trim();
  const confidence = rawThesis.confidence && typeof rawThesis.confidence === "object"
    ? {
        score: Number.isFinite(Number(rawThesis.confidence.score))
          ? Math.max(0, Math.min(100, Number(rawThesis.confidence.score)))
          : null,
        label: String(rawThesis.confidence.label || DEFAULT_CONFIDENCE.label),
        explanation: String(rawThesis.confidence.explanation || DEFAULT_CONFIDENCE.explanation)
      }
    : { ...DEFAULT_CONFIDENCE };

  const normalized = {
    id: String(rawThesis.id || ""),
    schemaVersion,
    symbol: String(rawThesis.symbol || rawThesis.ticker || "").toUpperCase(),
    direction: String(rawThesis.direction || "unclear"),
    timeHorizon: String(rawThesis.timeHorizon || "unspecified"),
    thesisText,
    thesisRestatement: String(rawThesis.thesisRestatement || thesisText),
    bullCase: asArray(rawThesis.bullCase).map(String),
    bearCase: asArray(rawThesis.bearCase).map(String),
    evidenceFor: asArray(rawThesis.evidenceFor).map(String),
    evidenceAgainst: asArray(rawThesis.evidenceAgainst).map(String),
    assumptions: asArray(rawThesis.assumptions).map(String),
    invalidationConditions: asArray(rawThesis.invalidationConditions).map(String),
    watchTriggers: asArray(rawThesis.watchTriggers).map(String),
    confidence,
    thesisQualityScore: Number.isFinite(Number(rawThesis.thesisQualityScore))
      ? Number(rawThesis.thesisQualityScore)
      : null,
    thesisHealth: rawThesis.thesisHealth && typeof rawThesis.thesisHealth === "object"
      ? {
          score: Number.isFinite(Number(rawThesis.thesisHealth.score))
            ? Number(rawThesis.thesisHealth.score)
            : null,
          trend: String(rawThesis.thesisHealth.trend || "unknown"),
          explanation: String(rawThesis.thesisHealth.explanation || DEFAULT_HEALTH.explanation)
        }
      : { ...DEFAULT_HEALTH },
    monitors: asArray(rawThesis.monitors),
    relationshipMap: rawThesis.relationshipMap && typeof rawThesis.relationshipMap === "object"
      ? {
          nodes: asArray(rawThesis.relationshipMap.nodes),
          edges: asArray(rawThesis.relationshipMap.edges)
        }
      : { ...DEFAULT_RELATIONSHIP_MAP },
    paperPosition: rawThesis.paperPosition || null,
    entry: Number(rawThesis.entry) || 0,
    target: Number(rawThesis.target) || 0,
    stop: Number(rawThesis.stop) || 0,
    sourceStatus: String(rawThesis.sourceStatus || "legacy_user_input"),
    needsUpgrade: Boolean(
      rawThesis.needsUpgrade ||
        schemaVersion < 2 ||
        requiredStructuredMissing({
          timeHorizon: rawThesis.timeHorizon,
          direction: rawThesis.direction,
          thesisRestatement: rawThesis.thesisRestatement
        })
    ),
    createdAt: rawThesis.createdAt || null,
    updatedAt: rawThesis.updatedAt || rawThesis.createdAt || null,
    originalThesisText: String(rawThesis.originalThesisText || thesisText)
  };

  return normalized;
}
