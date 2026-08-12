import { WidgetCard } from "../../shared/WidgetCard.js";
import { renderCrsScoreBody, useCrsScoreData } from "./useCrsScoreData.js";

export async function mountCrsScoreCard(host, { title = "CRS score" } = {}) {
  let data = null;
  try {
    data = await useCrsScoreData();
  } catch (err) {
    host.innerHTML = WidgetCard({
      title,
      sourceType: "trade",
      bodyHtml: `<p class="widget-empty-inline">Could not load CRS data.</p>`
    });
    return { updatedAt: null, error: err };
  }
  host.innerHTML = WidgetCard({
    title,
    sourceType: "trade",
    updatedAt: data.updatedAt,
    bodyHtml: renderCrsScoreBody(data)
  });
  return data;
}

export const CrsScoreCard = {
  type: "crsScoreCard",
  title: "CRS score",
  sourceType: "trade",
  mount: mountCrsScoreCard
};
