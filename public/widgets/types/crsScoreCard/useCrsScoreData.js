import { fetchJson, compactMoney, escapeHtml, formatDate } from "../../shared/formatters.js";

/**
 * CRS score widget data — derives signal from contract-watch awards.
 * Prefer awards that already carry eventSignal; otherwise estimate from agency/amount.
 */
function estimateCrs(award) {
  if (award?.eventSignal?.score != null) {
    return {
      score: Number(award.eventSignal.score),
      label: award.eventSignal.label || "CRS",
      plainEnglish: award.eventSignal.plainEnglish || "",
      pricedInAssessment: award.eventSignal.pricedInAssessment || ""
    };
  }
  const ag = String(award?.agency || award?.awardingAgency || "").toLowerCase();
  const agScore =
    ag.includes("health") || ag.includes("veteran") ? 85
      : ag.includes("homeland") || ag.includes("transport") ? 70
        : ag.includes("defense") || ag.includes("army") || ag.includes("navy") ? 35
          : 55;
  const logAmt = Math.log(Math.max(Number(award?.amount || award?.obligatedAmount) || 1e6, 1e6));
  const novelty = Math.round(Math.min(100, Math.max(0, ((23.0 - logAmt) / (23.0 - 16.1)) * 100)));
  const score = Math.round(0.55 * agScore + 0.45 * novelty);
  const label = score >= 75 ? "Higher signal" : score <= 40 ? "Likely priced in" : "Monitor";
  return {
    score,
    label,
    plainEnglish: `${award?.recipient || "Award"} · ${compactMoney(award?.amount)}`,
    pricedInAssessment: label
  };
}

export async function useCrsScoreData() {
  const data = await fetchJson("/api/contract-watch");
  const awards = Array.isArray(data.awards) ? data.awards : [];
  const top = awards
    .slice()
    .sort((a, b) => Date.parse(b.firstSeenAt || b.awardDate || 0) - Date.parse(a.firstSeenAt || a.awardDate || 0))[0];
  if (!top) {
    return {
      updatedAt: data.updatedAt || data.lastRefreshAt || new Date().toISOString(),
      empty: true,
      items: []
    };
  }
  const crs = estimateCrs(top);
  const tickers = top.mappedTickers || top.relatedTickers || [];
  return {
    updatedAt: data.updatedAt || data.lastRefreshAt || top.firstSeenAt || new Date().toISOString(),
    empty: false,
    primary: {
      ...crs,
      recipient: top.recipient || "Recipient",
      agency: top.agency || top.awardingAgency || "Federal agency",
      amount: top.amount || top.obligatedAmount,
      awardDate: top.awardDate || top.actionDate,
      tickers,
      awardId: top.awardId
    },
    items: awards.slice(0, 4).map((a) => {
      const c = estimateCrs(a);
      return {
        awardId: a.awardId,
        recipient: a.recipient,
        amount: a.amount,
        score: c.score,
        label: c.label,
        tickers: a.mappedTickers || a.relatedTickers || []
      };
    })
  };
}

export function renderCrsScoreBody(data) {
  if (!data || data.empty) {
    return `<p class="widget-empty-inline">No recent awards to score. Polling USASpending…</p>`;
  }
  const p = data.primary;
  const tone =
    p.score >= 75 ? "widget-signal-positive" : p.score <= 40 ? "widget-signal-neutral" : "";
  const tickerLine = (p.tickers || []).slice(0, 3).map((t) => escapeHtml(t)).join(" · ") || "—";
  const rows = (data.items || [])
    .slice(1, 4)
    .map(
      (item) => `
      <div class="widget-row">
        <span class="sym">${escapeHtml((item.tickers || [])[0] || item.recipient || "—")}</span>
        <span class="widget-figure ${item.score >= 75 ? "widget-signal-positive" : ""}">${escapeHtml(String(item.score))}</span>
      </div>`
    )
    .join("");
  return `
    <div class="widget-stack">
      <div class="widget-figure widget-figure--xl ${tone}">${escapeHtml(String(p.score))}</div>
      <div class="widget-muted">${escapeHtml(p.label)} · ${escapeHtml(tickerLine)}</div>
      <div>${escapeHtml(p.recipient)} · ${escapeHtml(compactMoney(p.amount))}</div>
      <div class="widget-muted">${escapeHtml(p.agency)}${p.awardDate ? ` · ${escapeHtml(formatDate(p.awardDate))}` : ""}</div>
      ${rows ? `<div>${rows}</div>` : ""}
    </div>
  `;
}
