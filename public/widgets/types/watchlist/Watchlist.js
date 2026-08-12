import { WidgetCard } from "../../shared/WidgetCard.js";
import { renderWatchlistBody, useWatchlistData } from "./useWatchlistData.js";

export async function mountWatchlist(host, { title = "Watchlist" } = {}) {
  let data = null;
  try {
    data = await useWatchlistData();
  } catch (err) {
    host.innerHTML = WidgetCard({
      title,
      sourceType: "trade",
      bodyHtml: `<p class="widget-empty-inline">Could not load watchlist.</p>`
    });
    return { updatedAt: null, error: err };
  }
  host.innerHTML = WidgetCard({
    title,
    sourceType: "trade",
    updatedAt: data.updatedAt,
    bodyHtml: renderWatchlistBody(data)
  });
  return data;
}

export const Watchlist = {
  type: "watchlist",
  title: "Watchlist",
  sourceType: "trade",
  mount: mountWatchlist
};
