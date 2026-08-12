import { fetchJson, escapeHtml, money, pct } from "../../shared/formatters.js";

export async function useWatchlistData() {
  const wl = await fetchJson("/api/watchlist");
  const symbols = (Array.isArray(wl.symbols) ? wl.symbols : []).filter(Boolean).slice(0, 24);
  if (!symbols.length) {
    return { updatedAt: wl.updated_at || new Date().toISOString(), empty: true, rows: [] };
  }
  let quotes = {};
  try {
    const q = await fetchJson(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
    const list = Array.isArray(q.quotes) ? q.quotes : Array.isArray(q) ? q : [];
    for (const row of list) {
      if (row?.symbol) quotes[String(row.symbol).toUpperCase()] = row;
    }
  } catch {
    quotes = {};
  }
  return {
    updatedAt: new Date().toISOString(),
    empty: false,
    rows: symbols.map((sym) => {
      const q = quotes[String(sym).toUpperCase()] || {};
      return {
        symbol: String(sym).toUpperCase(),
        price: q.price ?? q.last ?? null,
        changePercent: q.changePercent ?? q.pct ?? null
      };
    })
  };
}

export function renderWatchlistBody(data) {
  if (!data || data.empty) {
    return `<p class="widget-empty-inline">Watchlist empty — add tickers from Markets.</p>`;
  }
  return data.rows
    .map((row) => {
      const ch = row.changePercent;
      const cls =
        ch == null ? "" : Number(ch) >= 0 ? "widget-signal-positive" : "widget-signal-negative";
      return `
        <div class="widget-row">
          <span class="sym">${escapeHtml(row.symbol)}</span>
          <span>
            <span class="widget-figure">${escapeHtml(row.price == null ? "—" : money(row.price))}</span>
            <span class="widget-figure ${cls}" style="margin-left:8px">${escapeHtml(ch == null ? "—" : pct(ch))}</span>
          </span>
        </div>`;
    })
    .join("");
}
