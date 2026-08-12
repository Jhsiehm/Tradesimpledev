import { fetchJson, escapeHtml, pct, formatDate } from "../../shared/formatters.js";

export async function usePredictionData() {
  const [scorecard, list] = await Promise.all([
    fetchJson("/api/predictions/scorecard").catch(() => null),
    fetchJson("/api/predictions?limit=40")
  ]);
  const predictions = Array.isArray(list.predictions) ? list.predictions : [];
  return {
    updatedAt: new Date().toISOString(),
    empty: predictions.length === 0 && !scorecard,
    scorecard: scorecard || null,
    predictions: predictions.slice(0, 8).map((p) => ({
      id: p.id || p.event_id || p.hash,
      ticker: p.ticker || p.symbol || "—",
      direction: p.direction || p.side || "",
      horizon: p.horizon || p.horizonDays || "",
      status: p.status || (p.resolved ? "resolved" : "open"),
      excessReturn: p.excessReturn ?? p.excess_return ?? null,
      createdAt: p.createdAt || p.created_at || p.ts
    }))
  };
}

export function renderPredictionBody(data) {
  if (!data || data.empty) {
    return `<p class="widget-empty-inline">No predictions logged yet.</p>`;
  }
  const sc = data.scorecard;
  const hit =
    sc?.hitRate != null
      ? pct(Number(sc.hitRate) <= 1 ? Number(sc.hitRate) * 100 : Number(sc.hitRate), 0)
      : sc?.hits != null && sc?.resolved
        ? `${sc.hits}/${sc.resolved}`
        : null;
  const head = hit
    ? `<div class="widget-stack" style="margin-bottom:8px">
        <div class="widget-figure widget-figure--lg">${escapeHtml(String(hit))}</div>
        <div class="widget-muted">Hit rate · ${escapeHtml(String(sc.resolved ?? sc.n ?? "—"))} resolved</div>
      </div>`
    : "";
  const rows = (data.predictions || [])
    .map((p) => {
      const er = p.excessReturn;
      const erCls =
        er == null ? "" : Number(er) >= 0 ? "widget-signal-positive" : "widget-signal-negative";
      const erText = er == null ? p.status : pct(Number(er) <= 1 && Math.abs(Number(er)) < 1 ? Number(er) * 100 : Number(er));
      return `
        <div class="widget-row">
          <div>
            <span class="sym">${escapeHtml(p.ticker)}</span>
            <span class="widget-muted"> ${escapeHtml(p.direction || "")}${p.createdAt ? ` · ${escapeHtml(formatDate(p.createdAt))}` : ""}</span>
          </div>
          <span class="widget-figure ${erCls}">${escapeHtml(String(erText))}</span>
        </div>`;
    })
    .join("");
  return `${head}${rows || `<p class="widget-empty-inline">Ledger empty.</p>`}`;
}
