import { getWidgetDef, listWidgetTypes } from "../registry/widgetRegistry.js";
import { GRID, loadLayout, nextOpenSlot, saveLayout } from "./layoutStore.js";
import { mountWidgetShell } from "./WidgetShell.js";
import { escapeHtml } from "../shared/formatters.js";

const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_PX = 14;
const MOBILE_MQ = "(max-width: 720px)";

function uid(type) {
  return `${type}-${Math.random().toString(16).slice(2, 10)}`;
}

export function createWidgetGrid(root) {
  const gridEl = root.querySelector("[data-widget-grid]");
  const pickerEl = root.querySelector("[data-widget-picker]");
  const mobileMq = window.matchMedia(MOBILE_MQ);

  let widgets = [];
  let dragging = null;
  let resizing = null;
  let longPress = null;
  let ignoreClickUntil = 0;

  function isMobile() {
    return mobileMq.matches;
  }

  function colWidth() {
    const width = gridEl.clientWidth || root.clientWidth || 960;
    return (width - GRID.MARGIN) / GRID.COLS;
  }

  function layoutStyle(item) {
    const cw = colWidth();
    const left = item.x * cw + GRID.MARGIN / 2;
    const top = item.y * (GRID.ROW_HEIGHT + GRID.MARGIN) + GRID.MARGIN / 2;
    const width = item.w * cw - GRID.MARGIN;
    const height = item.h * (GRID.ROW_HEIGHT + GRID.MARGIN) - GRID.MARGIN;
    return `left:${left}px;top:${top}px;width:${width}px;height:${height}px;`;
  }

  function gridHeight() {
    const maxY = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
    const minRows = 8;
    return Math.max(minRows, maxY) * (GRID.ROW_HEIGHT + GRID.MARGIN) + GRID.MARGIN;
  }

  function persist() {
    saveLayout(widgets);
  }

  async function mountOne(node, item) {
    const def = getWidgetDef(item.type);
    await mountWidgetShell(node, def, item.props || {});
  }

  function syncModeClass() {
    root.classList.toggle("is-mobile-stack", isMobile());
    gridEl.classList.toggle("is-mobile-stack", isMobile());
  }

  async function render() {
    syncModeClass();
    const mobile = isMobile();

    if (mobile) {
      gridEl.style.height = "";
      gridEl.innerHTML = widgets
        .map(
          (item) => `
      <div class="widget-item" data-widget-id="${escapeHtml(item.i)}" data-widget-type="${escapeHtml(item.type)}"></div>`
        )
        .join("");
    } else {
      gridEl.style.height = `${gridHeight()}px`;
      gridEl.innerHTML = widgets
        .map(
          (item) => `
      <div class="widget-item" data-widget-id="${escapeHtml(item.i)}" data-widget-type="${escapeHtml(item.type)}" style="${layoutStyle(item)}"></div>`
        )
        .join("");
    }

    await Promise.all(
      [...gridEl.querySelectorAll(".widget-item")].map(async (node) => {
        const item = widgets.find((w) => w.i === node.dataset.widgetId);
        if (item) await mountOne(node, item);
      })
    );
  }

  function pointerToCell(clientX, clientY) {
    const rect = gridEl.getBoundingClientRect();
    const cw = colWidth();
    const x = Math.max(0, Math.floor((clientX - rect.left) / cw));
    const y = Math.max(0, Math.floor((clientY - rect.top) / (GRID.ROW_HEIGHT + GRID.MARGIN)));
    return { x, y };
  }

  function clearLongPress() {
    if (longPress?.timer) clearTimeout(longPress.timer);
    longPress = null;
  }

  function openPickerAt(clientX, clientY) {
    if (!pickerEl) return;
    renderPicker();
    const rootRect = root.getBoundingClientRect();
    const left = Math.max(8, Math.min(clientX - rootRect.left - 20, rootRect.width - 220));
    const top = Math.max(8, Math.min(clientY - rootRect.top - 12, rootRect.height - 200));
    pickerEl.style.left = `${left}px`;
    pickerEl.style.top = `${top}px`;
    pickerEl.hidden = false;
  }

  function closePicker() {
    if (pickerEl) pickerEl.hidden = true;
  }

  function onPointerDown(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const removeBtn = target.closest("[data-widget-remove]");
    if (removeBtn) {
      const itemEl = removeBtn.closest(".widget-item");
      if (!itemEl) return;
      widgets = widgets.filter((w) => w.i !== itemEl.dataset.widgetId);
      persist();
      void render();
      return;
    }

    const resizeHandle = target.closest("[data-widget-resize-handle]");
    const dragHandle = target.closest("[data-widget-drag-handle]");
    const itemEl = target.closest(".widget-item");
    const mobile = isMobile();

    // Desktop-only drag/resize; mobile is a stacked list.
    if (!mobile && resizeHandle && itemEl) {
      clearLongPress();
      const item = widgets.find((w) => w.i === itemEl.dataset.widgetId);
      if (!item) return;
      event.preventDefault();
      resizing = {
        id: item.i,
        startX: event.clientX,
        startY: event.clientY,
        origW: item.w,
        origH: item.h
      };
      itemEl.classList.add("is-resizing");
      itemEl.setPointerCapture?.(event.pointerId);
      return;
    }

    if (!mobile && dragHandle && itemEl) {
      clearLongPress();
      const item = widgets.find((w) => w.i === itemEl.dataset.widgetId);
      if (!item) return;
      event.preventDefault();
      dragging = {
        id: item.i,
        offsetCell: pointerToCell(event.clientX, event.clientY),
        origX: item.x,
        origY: item.y
      };
      itemEl.classList.add("is-dragging");
      itemEl.setPointerCapture?.(event.pointerId);
      return;
    }

    // Long-press empty board to add.
    if (!itemEl) {
      clearLongPress();
      longPress = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        timer: setTimeout(() => {
          if (!longPress) return;
          openPickerAt(longPress.x, longPress.y);
          ignoreClickUntil = Date.now() + 450;
          if (navigator.vibrate) {
            try {
              navigator.vibrate(12);
            } catch {
              /* ignore */
            }
          }
          longPress = null;
        }, LONG_PRESS_MS)
      };
    }
  }

  function onPointerMove(event) {
    if (longPress) {
      const dx = event.clientX - longPress.x;
      const dy = event.clientY - longPress.y;
      if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) clearLongPress();
    }

    if (isMobile()) return;

    if (dragging) {
      const item = widgets.find((w) => w.i === dragging.id);
      const el = gridEl.querySelector(`[data-widget-id="${dragging.id}"]`);
      if (!item || !el) return;
      const cell = pointerToCell(event.clientX, event.clientY);
      const dx = cell.x - dragging.offsetCell.x;
      const dy = cell.y - dragging.offsetCell.y;
      item.x = Math.max(0, Math.min(GRID.COLS - item.w, dragging.origX + dx));
      item.y = Math.max(0, dragging.origY + dy);
      el.style.cssText = layoutStyle(item);
      gridEl.style.height = `${gridHeight()}px`;
      return;
    }
    if (resizing) {
      const item = widgets.find((w) => w.i === resizing.id);
      const el = gridEl.querySelector(`[data-widget-id="${resizing.id}"]`);
      if (!item || !el) return;
      const cw = colWidth();
      const dw = Math.round((event.clientX - resizing.startX) / cw);
      const dh = Math.round((event.clientY - resizing.startY) / (GRID.ROW_HEIGHT + GRID.MARGIN));
      item.w = Math.max(2, Math.min(GRID.COLS - item.x, resizing.origW + dw));
      item.h = Math.max(2, Math.min(12, resizing.origH + dh));
      el.style.cssText = layoutStyle(item);
      gridEl.style.height = `${gridHeight()}px`;
    }
  }

  function onPointerUp() {
    clearLongPress();
    if (dragging) {
      const el = gridEl.querySelector(`[data-widget-id="${dragging.id}"]`);
      el?.classList.remove("is-dragging");
      dragging = null;
      persist();
    }
    if (resizing) {
      const el = gridEl.querySelector(`[data-widget-id="${resizing.id}"]`);
      el?.classList.remove("is-resizing");
      resizing = null;
      persist();
    }
  }

  function renderPicker() {
    if (!pickerEl) return;
    pickerEl.innerHTML = listWidgetTypes()
      .map(
        (def) => `
      <button type="button" class="widget-picker-item" data-source="${escapeHtml(def.sourceType)}" data-add-type="${escapeHtml(def.type)}">
        <strong>${escapeHtml(def.label)}</strong>
      </button>`
      )
      .join("");
  }

  function addWidget(type) {
    const def = getWidgetDef(type);
    if (!def) return;
    const slot = nextOpenSlot(widgets, def.defaultSize);
    widgets.push({
      i: uid(type),
      type,
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
      props: {}
    });
    closePicker();
    persist();
    void render();
  }

  function onClick(event) {
    const t = event.target;
    if (!(t instanceof Element)) return;
    if (Date.now() < ignoreClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const addType = t.closest("[data-add-type]")?.dataset?.addType;
    if (addType) {
      addWidget(addType);
      return;
    }
    if (pickerEl && !pickerEl.hidden && !t.closest("[data-widget-picker]")) {
      closePicker();
    }
  }

  function onContextMenu(event) {
    if (event.target instanceof Element && event.target.closest(".widget-dashboard")) {
      event.preventDefault();
    }
  }

  function onResize() {
    syncModeClass();
    if (isMobile()) {
      gridEl.style.height = "";
      gridEl.querySelectorAll(".widget-item").forEach((node) => {
        node.removeAttribute("style");
      });
      return;
    }
    gridEl.style.height = `${gridHeight()}px`;
    gridEl.querySelectorAll(".widget-item").forEach((node) => {
      const item = widgets.find((w) => w.i === node.dataset.widgetId);
      if (item) node.style.cssText = layoutStyle(item);
    });
  }

  function onMqChange() {
    dragging = null;
    resizing = null;
    void render();
  }

  async function init() {
    renderPicker();
    const loaded = await loadLayout();
    widgets = loaded.widgets || [];
    await render();
  }

  root.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  root.addEventListener("click", onClick);
  root.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("resize", onResize);
  if (typeof mobileMq.addEventListener === "function") {
    mobileMq.addEventListener("change", onMqChange);
  } else {
    mobileMq.addListener(onMqChange);
  }

  return {
    init,
    refresh: () => render(),
    destroy() {
      clearLongPress();
      root.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      root.removeEventListener("click", onClick);
      root.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("resize", onResize);
      if (typeof mobileMq.removeEventListener === "function") {
        mobileMq.removeEventListener("change", onMqChange);
      } else {
        mobileMq.removeListener(onMqChange);
      }
    }
  };
}
