function toTrend(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return "unknown";
  if (current > previous + 2) return "improving";
  if (current < previous - 2) return "deteriorating";
  return "stable";
}

export function computeThesisHealth(context = {}) {
  const monitors = Array.isArray(context.monitors) ? context.monitors : [];
  const alerts = monitors.filter((m) => {
    const status = String(m?.status || "").toLowerCase();
    return status.includes("broken") || status.includes("watch") || status.includes("catalyst");
  }).length;
  const total = monitors.length || 1;
  const monitorScore = Math.max(0, Math.min(100, Math.round((1 - alerts / total) * 100)));
  const confidenceScore = Number(context.thesis?.confidence?.score);
  const signalCoverage = Array.isArray(context.signals) ? Math.min(context.signals.length, 8) * 10 : 0;
  const composite = Math.round(
    (monitorScore * 0.45) +
      (Number.isFinite(confidenceScore) ? confidenceScore * 0.35 : 45 * 0.35) +
      (Math.min(signalCoverage, 80) * 0.2)
  );
  const prev = Array.isArray(context.healthHistory) && context.healthHistory.length
    ? Number(context.healthHistory[context.healthHistory.length - 1]?.score)
    : null;
  return {
    score: Math.max(0, Math.min(100, composite)),
    trend: toTrend(composite, prev),
    explanation:
      "Health blends monitor stability, confidence, and signal coverage. It is research context only, not investment advice.",
    factors: [
      { key: "monitorStability", score: monitorScore },
      { key: "confidence", score: Number.isFinite(confidenceScore) ? confidenceScore : null },
      { key: "signalCoverage", score: Math.min(signalCoverage, 80) }
    ]
  };
}
