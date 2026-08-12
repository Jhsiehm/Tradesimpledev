import { fetchJson } from "../shared/formatters.js";

const LOCAL_KEY = "ts_widget_layout_v1";
const COLS = 12;

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.widgets) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocal(payload) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

export function normalizeLayout(widgets) {
  if (!Array.isArray(widgets)) return [];
  return widgets
    .map((w, idx) => {
      if (!w || typeof w !== "object") return null;
      const type = String(w.type || "");
      if (!type) return null;
      const i = String(w.i || `${type}-${idx}`);
      const x = Math.max(0, Math.min(COLS - 1, Number(w.x) || 0));
      const y = Math.max(0, Number(w.y) || 0);
      const wUnits = Math.max(2, Math.min(COLS, Number(w.w) || 4));
      const hUnits = Math.max(2, Math.min(12, Number(w.h) || 4));
      return { i, type, x, y, w: wUnits, h: hUnits, props: w.props && typeof w.props === "object" ? w.props : {} };
    })
    .filter(Boolean);
}

/** Empty by default — invitation state, not a seeded demo board. */
export function emptyLayout() {
  return { widgets: [], updatedAt: null, source: "empty" };
}

export async function loadLayout() {
  const local = readLocal();
  try {
    const remote = await fetchJson("/api/dashboard/layout");
    const widgets = normalizeLayout(remote.widgets);
    const source = remote.source || "api";
    // Demo / no-Supabase sessions echo empty from the server — keep browser pins.
    if ((source === "demo_local" || source === "local_session") && local?.widgets?.length && widgets.length === 0) {
      return { ...local, source: "local" };
    }
    const payload = {
      widgets,
      updatedAt: remote.updated_at || remote.updatedAt || null,
      source
    };
    writeLocal(payload);
    return payload;
  } catch {
    if (local) return { ...local, source: local.source || "local" };
    return emptyLayout();
  }
}

let _saveTimer = 0;

export function saveLayout(widgets, { debounceMs = 400 } = {}) {
  const payload = {
    widgets: normalizeLayout(widgets),
    updatedAt: new Date().toISOString(),
    source: "local"
  };
  writeLocal(payload);
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    void persistRemote(payload.widgets);
  }, debounceMs);
  return payload;
}

async function persistRemote(widgets) {
  try {
    await fetchJson("/api/dashboard/layout", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ widgets })
    });
  } catch (err) {
    console.warn("[widgets] layout persist failed", err?.message || err);
  }
}

export function nextOpenSlot(widgets, size = { w: 4, h: 4 }) {
  const w = size.w || 4;
  const h = size.h || 4;
  let y = 0;
  for (let guard = 0; guard < 80; guard += 1) {
    for (let x = 0; x <= COLS - w; x += 1) {
      const overlaps = widgets.some((item) => {
        return !(x + w <= item.x || item.x + item.w <= x || y + h <= item.y || item.y + item.h <= y);
      });
      if (!overlaps) return { x, y, w, h };
    }
    y += 1;
  }
  return { x: 0, y: 0, w, h };
}

export const GRID = { COLS, ROW_HEIGHT: 56, MARGIN: 8 };
