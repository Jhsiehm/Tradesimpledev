import { WidgetCard } from "../shared/WidgetCard.js";

/**
 * Mounts shared chrome around a widget body mount function.
 * Widgets themselves should prefer calling WidgetCard directly;
 * this helper is for grid-level remount orchestration.
 */
export async function mountWidgetShell(host, def, props = {}) {
  if (!def?.mount) {
    host.innerHTML = WidgetCard({
      title: def?.label || "Widget",
      sourceType: def?.sourceType || "trade",
      bodyHtml: `<p class="widget-empty-inline">Unknown widget type.</p>`
    });
    return null;
  }
  return def.mount(host, { title: def.label, ...props });
}
