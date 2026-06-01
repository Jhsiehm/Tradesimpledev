const SOURCE_KINDS = new Set([
  "verified",
  "curated",
  "modeled",
  "live_feed",
  "user_provided",
  "legacy_user_input"
]);

export function normalizeSourceKind(kind) {
  const normalized = String(kind || "").toLowerCase().replace(/\s+/g, "_");
  return SOURCE_KINDS.has(normalized) ? normalized : "modeled";
}

export function confidenceLabel(score, fallback = "Unscored") {
  const n = Number(score);
  if (!Number.isFinite(n)) return fallback;
  if (n >= 75) return "High confidence";
  if (n >= 45) return "Medium confidence";
  return "Low confidence";
}

export function resolveSourceBadge({ kind, confidence, label } = {}) {
  const normalizedKind = normalizeSourceKind(kind);
  return {
    kind: normalizedKind,
    label: String(label || normalizedKind.replace(/_/g, " ")),
    confidence: confidenceLabel(confidence),
    confidenceScore: Number.isFinite(Number(confidence)) ? Number(confidence) : null
  };
}
