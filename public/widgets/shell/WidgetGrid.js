import { getWidgetDef, listWidgetTypes } from "../registry/widgetRegistry.js";
import { GRID, loadLayout, nextOpenSlot, saveLayout } from "./layoutStore.js";
import { mountWidgetShell } from "./WidgetShell.js";
import { escapeHtml } from "../shared/formatters.js";

function uid(type) {
  return `${type}-${Math.random().toString(16).slice(2, 10)}`;
}

export function createWidgetGrid(root) {
  const view = root.closest("#view-dashboard") || root;
  const gridEl = root.querySelector("[data-widget-grid]");
  const emptyEl = root.querySelector("[data-widget-empty]");
  const metaEl = view.querySelector("[data-widget-meta]");
  const pickerEl = root.querySelector("[data-widget-picker]");
  const addBtn = root.querySelector("[data-widget-add]");

  let widgets = [];
  let dragging = null;
  let resizing = null;

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
    return Math.max(320, maxY * (GRID.ROW_HEIGHT + GRID.MARGIN) + GRID.MARGIN);
  }

  function persist() {
    const saved = saveLayout(widgets);
    if (metaEl) {
      metaEl.textContent = widgets.length
        ? `${widgets.length} pinned · saved ${new Date(saved.updatedAt).toLocaleTimeString()}`
        : "No widgets pinned";
    }
  }

  async function mountOne(node, item) {
    const def = getWidgetDef(item.type);
    await mountWidgetShell(node, def, item.props || {});
  }

  async function render() {
    const isEmpty = widgets.length === 0;
    if (emptyEl) emptyEl.hidden = !isEmpty;
    gridEl.hidden = isEmpty;
    if (isEmpty) {
      gridEl.innerHTML = "";
      if (metaEl) metaEl.textContent = "No widgets pinned";
      return;
    }
    gridEl.style.height = `${gridHeight()}px`;
    gridEl.innerHTML = widgets
      .map(
        (item) => `
      <div class="widget-item" data-widget-id="${escapeHtml(item.i)}" data-widget-type="${escapeHtml(item.type)}" style="${layoutStyle(item)}"></div>`
      )
      .join("");

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
    if (!itemEl) return;
    const item = widgets.find((w) => w.i === itemEl.dataset.widgetId);
    if (!item) return;

    if (resizeHandle) {
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
    if (dragHandle) {
      event.preventDefault();
      dragging = {
        id: item.i,
        offsetCell: pointerToCell(event.clientX, event.clientY),
        origX: item.x,
        origY: item.y
      };
      itemEl.classList.add("is-dragging");
      itemEl.setPointerCapture?.(event.pointerId);
    }
  }

  function onPointerMove(event) {
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

  function onPointerUp(event) {
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
        <span>${escapeHtml(def.description)}</span>
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
    if (pickerEl) pickerEl.hidden = true;
    persist();
    void render();
  }

  function onClick(event) {
    const t = event.target;
    if (!(t instanceof Element)) return;
    const addType = t.closest("[data-add-type]")?.dataset?.addType;
    if (addType) {
      addWidget(addType);
      return;
    }
    if (t.closest("[data-widget-add]")) {
      if (pickerEl) pickerEl.hidden = !pickerEl.hidden;
      return;
    }
    if (pickerEl && !pickerEl.hidden && !t.closest("[data-widget-picker]") && !t.closest("[data-widget-add]")) {
      pickerEl.hidden = true;
    }
  }

  function onResize() {
    if (!widgets.length) return;
    gridEl.style.height = `${gridHeight()}px`;
    gridEl.querySelectorAll(".widget-item").forEach((node) => {
      const item = widgets.find((w) => w.i === node.dataset.widgetId);
      if (item) node.style.cssText = layoutStyle(item);
    });
  }

  async function init() {
    renderPicker();
    const loaded = await loadLayout();
    widgets = loaded.widgets || [];
    await render();
    if (metaEl && widgets.length) {
      metaEl.textContent = `${widgets.length} pinned${loaded.source ? ` · ${loaded.source}` : ""}`;
    }
  }

  gridEl.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  root.addEventListener("click", onClick);
  window.addEventListener("resize", onResize);

  return {
    init,
    refresh: () => render(),
    destroy() {
      gridEl.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("click", onClick);
      window.removeEventListener("resize", onResize);
    }
  };
}
