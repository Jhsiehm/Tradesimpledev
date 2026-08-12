import { escapeHtml, formatTimestamp } from "./formatters.js";

/**
 * Shared visual wrapper — border, source-tab, header chrome.
 * Individual widgets only supply body HTML.
 */
export function WidgetCard({
  title,
  sourceType = "trade",
  updatedAt = null,
  bodyHtml = "",
  onRemoveAttr = ""
}) {
  const ts = formatTimestamp(updatedAt);
  return `
    <article class="widget-card" data-source="${escapeHtml(sourceType)}">
      <header class="widget-header" data-widget-drag-handle>
        <div class="widget-header-title">
          <strong>${escapeHtml(title)}</strong>
        </div>
        <div class="widget-header-actions">
          <span class="widget-timestamp" data-widget-timestamp>${escapeHtml(ts)}</span>
          <button type="button" class="widget-remove-btn" data-widget-remove ${onRemoveAttr} aria-label="Remove widget">✕</button>
        </div>
      </header>
      <div class="widget-body">${bodyHtml}</div>
      <div class="widget-resize-handle" data-widget-resize-handle aria-hidden="true"></div>
    </article>
  `;
}
