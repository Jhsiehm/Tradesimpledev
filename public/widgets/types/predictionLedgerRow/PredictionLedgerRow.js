import { WidgetCard } from "../../shared/WidgetCard.js";
import { renderPredictionBody, usePredictionData } from "./usePredictionData.js";

export async function mountPredictionLedgerRow(host, { title = "Prediction ledger" } = {}) {
  let data = null;
  try {
    data = await usePredictionData();
  } catch (err) {
    host.innerHTML = WidgetCard({
      title,
      sourceType: "legislation",
      bodyHtml: `<p class="widget-empty-inline">Could not load prediction ledger.</p>`
    });
    return { updatedAt: null, error: err };
  }
  host.innerHTML = WidgetCard({
    title,
    sourceType: "legislation",
    updatedAt: data.updatedAt,
    bodyHtml: renderPredictionBody(data)
  });
  return data;
}

export const PredictionLedgerRow = {
  type: "predictionLedgerRow",
  title: "Prediction ledger",
  sourceType: "legislation",
  mount: mountPredictionLedgerRow
};
