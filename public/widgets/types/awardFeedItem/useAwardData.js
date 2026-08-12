import { fetchJson, compactMoney, escapeHtml, formatDate } from "../../shared/formatters.js";

export async function useAwardData() {
  const data = await fetchJson("/api/contract-watch");
  const awards = (Array.isArray(data.awards) ? data.awards : [])
    .slice()
    .sort((a, b) => Date.parse(b.firstSeenAt || b.awardDate || 0) - Date.parse(a.firstSeenAt || a.awardDate || 0));
  return {
    updatedAt: data.updatedAt || data.lastRefreshAt || new Date().toISOString(),
    empty: awards.length === 0,
    awards: awards.slice(0, 6).map((a) => ({
      awardId: a.awardId,
      recipient: a.recipient || "Recipient",
      agency: a.agency || "Federal agency",
      amount: a.amount,
      awardDate: a.awardDate || a.actionDate,
      tickers: a.mappedTickers || a.relatedTickers || [],
      snippet: a.descriptionSnippet || "",
      url: a.contractUrl || ""
    }))
  };
}

export function renderAwardBody(data) {
  if (!data || data.empty) {
    return `<p class="widget-empty-inline">No significant awards in the recent window.</p>`;
  }
  return data.awards
    .map((a) => {
      const sym = (a.tickers || [])[0] || "—";
      return `
        <div class="widget-row">
          <div>
            <div class="sym">${escapeHtml(sym)} · ${escapeHtml(a.recipient)}</div>
            <div class="widget-muted">${escapeHtml(a.agency)}${a.awardDate ? ` · ${escapeHtml(formatDate(a.awardDate))}` : ""}</div>
          </div>
          <div class="widget-figure">${escapeHtml(compactMoney(a.amount))}</div>
        </div>
      `;
    })
    .join("");
}
