import { WidgetCard } from "../../shared/WidgetCard.js";
import { renderAwardBody, useAwardData } from "./useAwardData.js";

export async function mountAwardFeedItem(host, { title = "Contract awards" } = {}) {
  let data = null;
  try {
    data = await useAwardData();
  } catch (err) {
    host.innerHTML = WidgetCard({
      title,
      sourceType: "contract",
      bodyHtml: `<p class="widget-empty-inline">Could not load award feed.</p>`
    });
    return { updatedAt: null, error: err };
  }
  host.innerHTML = WidgetCard({
    title,
    sourceType: "contract",
    updatedAt: data.updatedAt,
    bodyHtml: renderAwardBody(data)
  });
  return data;
}

export const AwardFeedItem = {
  type: "awardFeedItem",
  title: "Contract awards",
  sourceType: "contract",
  mount: mountAwardFeedItem
};
