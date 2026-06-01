export function computeThesisMovement(context = {}) {
  const now = new Date().toISOString();
  const movement = Array.isArray(context.thesis?.movementHistory) ? context.thesis.movementHistory : [];
  if (movement.length) return movement.slice(-12);

  const items = [];
  if (Array.isArray(context.monitors)) {
    for (const m of context.monitors.slice(0, 8)) {
      items.push({
        at: now,
        type: "monitor",
        label: String(m.text || "Monitor update"),
        status: String(m.status || "Normal"),
        source: String(m.src || "TradeSimple monitor"),
        confidence: m.confidence ?? null
      });
    }
  }
  if (context.outcome?.currentPrice != null) {
    items.push({
      at: now,
      type: "price",
      label: "Current price snapshot",
      status: "Info",
      source: String(context.outcome.quoteSource || "Quote feed"),
      value: Number(context.outcome.currentPrice)
    });
  }
  return items.slice(-12);
}
