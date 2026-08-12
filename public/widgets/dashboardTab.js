import { createWidgetGrid } from "./shell/WidgetGrid.js";

let gridApi = null;

function rootEl() {
  return document.getElementById("widget-dashboard-root");
}

export async function initWidgetDashboard() {
  const root = rootEl();
  if (!root || root.dataset.widgetsReady === "1") {
    if (gridApi) await gridApi.refresh();
    return gridApi;
  }
  gridApi = createWidgetGrid(root);
  root.dataset.widgetsReady = "1";
  await gridApi.init();
  return gridApi;
}

export function refreshWidgetDashboard() {
  return gridApi?.refresh?.();
}

window.TradeSimpleWidgets = {
  init: initWidgetDashboard,
  refresh: refreshWidgetDashboard
};
