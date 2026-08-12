import { createWidgetGrid } from "./shell/WidgetGrid.js";

let gridApi = null;
let initPromise = null;

function rootEl() {
  return document.getElementById("widget-dashboard-root");
}

function viewIsActive() {
  return Boolean(document.getElementById("view-dashboard")?.classList.contains("active"));
}

export async function initWidgetDashboard() {
  const root = rootEl();
  if (!root) return null;
  if (gridApi) {
    await gridApi.refresh();
    return gridApi;
  }
  if (initPromise) return initPromise;
  initPromise = (async () => {
    gridApi = createWidgetGrid(root);
    root.dataset.widgetsReady = "1";
    await gridApi.init();
    return gridApi;
  })();
  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

export function refreshWidgetDashboard() {
  return gridApi?.refresh?.();
}

window.TradeSimpleWidgets = {
  init: initWidgetDashboard,
  refresh: refreshWidgetDashboard
};

// Avoid race: showView may run before this module finishes loading.
if (viewIsActive()) {
  void initWidgetDashboard();
}
document.addEventListener("DOMContentLoaded", () => {
  if (viewIsActive()) void initWidgetDashboard();
});
