/**
 * TradeSimple charts — vanilla JS, no dependencies.
 * window.TSCharts: mount | update | destroy
 */
(function (global) {
  const instances = new WeakMap();

  function resolveEl(target) {
    if (!target) return null;
    return typeof target === "string" ? document.querySelector(target) : target;
  }

  function defaultMoney(value) {
    const n = Number(value || 0);
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }

  function defaultFormatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    return String(value);
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function normalizePoints(points) {
    return (Array.isArray(points) ? points : [])
      .filter(Boolean)
      .map((p) => {
        const close = Number(p.close ?? p.value ?? 0);
        const open = p.open != null ? Number(p.open) : close;
        const high = p.high != null ? Number(p.high) : Math.max(open, close);
        const low = p.low != null ? Number(p.low) : Math.min(open, close);
        return {
          date: p.date || p.label || "",
          close,
          value: close,
          open,
          high,
          low,
          volume: p.volume != null ? Number(p.volume) : null
        };
      })
      .filter((p) => Number.isFinite(p.close));
  }

  function hasOhlc(points) {
    return points.length > 1 && points.some((p, i) => {
      if (i === 0) return false;
      return Math.abs(p.high - p.low) > 0.0001 || Math.abs(p.open - p.close) > 0.0001;
    });
  }

  function patchLiveBar(points, liveValue) {
    const v = Number(liveValue);
    if (!Number.isFinite(v)) return points;
    const now = new Date().toISOString();
    if (!points.length) {
      return [{ date: now, close: v, value: v, open: v, high: v, low: v }];
    }
    const last = points[points.length - 1];
    const lastMs = Date.parse(last.date);
    const sameBucket = Number.isFinite(lastMs) && Date.now() - lastMs < 120_000;
    if (sameBucket) {
      last.close = v;
      last.value = v;
      last.high = Math.max(last.high, v);
      last.low = Math.min(last.low, v);
      return points;
    }
    points.push({
      date: now,
      close: v,
      value: v,
      open: last.close,
      high: Math.max(last.close, v),
      low: Math.min(last.close, v)
    });
    if (points.length > 180) points.shift();
    return points;
  }

  function buildShell(state) {
    const mode = state.mode === "candle" && hasOhlc(state.points) ? "candle" : "line";
    state.mode = mode;
    const liveLabel = state.liveLabel && !state.compact ? `<span class="ts-chart-live">${escapeHtml(state.liveLabel)}</span>` : "";
    const sourceLabel = state.source
      ? `<span class="ts-chart-source">${escapeHtml(state.source)}</span>`
      : "";
    const modeToggle = state.compact
      ? ""
      : `<div class="ts-chart-mode-toggle" role="group" aria-label="Chart style">
            <button type="button" class="ts-chart-mode-btn ${mode === "line" ? "active" : ""}" data-ts-mode="line">Line</button>
            <button type="button" class="ts-chart-mode-btn ${mode === "candle" ? "active" : ""}" data-ts-mode="candle" ${hasOhlc(state.points) ? "" : "disabled"}>Candles</button>
          </div>`;
    return `
      <div class="ts-chart" data-mode="${mode}">
        <div class="ts-chart-head">
          ${sourceLabel}
          ${liveLabel}
          ${modeToggle}
        </div>
        <div class="ts-chart-plot" style="min-height:${state.height}px">
          <div class="ts-chart-y-title">${escapeHtml(state.yLabel)}</div>
          <svg class="ts-chart-svg" role="img"></svg>
          <div class="ts-chart-crosshair" aria-hidden="true"></div>
          <div class="ts-chart-dot" aria-hidden="true"></div>
          <div class="ts-chart-tooltip" aria-hidden="true"></div>
        </div>
        <div class="ts-chart-foot">
          <span class="ts-chart-x-label">${escapeHtml(state.xLabel)}</span>
          <span class="ts-chart-y-range"></span>
        </div>
        <div class="ts-chart-markers-host"></div>
        <p class="ts-chart-empty" hidden></p>
      </div>
    `;
  }

  function scaleLayout(points, width, height, pad) {
    const lows = points.map((p) => p.low);
    const highs = points.map((p) => p.high);
    let min = Math.min(...lows);
    let max = Math.max(...highs);
    if (max - min < 0.0001) {
      const mid = max || 1;
      min = mid * 0.998;
      max = mid * 1.002;
    }
    const padPct = 0.06;
    const span = max - min;
    min -= span * padPct;
    max += span * padPct;
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const xAt = (i) => pad.left + (i / Math.max(1, points.length - 1)) * innerW;
    const yAt = (v) => pad.top + innerH - ((v - min) / (max - min)) * innerH;
    return { min, max, xAt, yAt, innerW, innerH };
  }

  function drawGrid(svg, layout, pad, width, height, tickCount = 4) {
    const lines = [];
    const steps = Math.max(1, tickCount);
    for (let i = 0; i <= steps; i += 1) {
      const y = pad.top + (layout.innerH * i) / steps;
      lines.push(
        `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" class="ts-chart-grid-line" />`
      );
    }
    return lines.join("");
  }

  function drawYLabels(state, layout, pad, formatMoney, tickCount = 4) {
    const labels = [];
    const steps = Math.max(1, tickCount);
    for (let i = 0; i <= steps; i += 1) {
      const v = layout.max - ((layout.max - layout.min) * i) / steps;
      const y = pad.top + (layout.innerH * i) / steps;
      labels.push(
        `<text x="${pad.left - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="ts-chart-y-tick">${escapeHtml(formatMoney(v))}</text>`
      );
    }
    return labels.join("");
  }

  function markerColor(type) {
    if (type === "bill") return "var(--amber)";
    if (type === "lobby") return "#7f77dd";
    if (type === "contract") return "var(--blue, #60a5fa)";
    if (type === "figure") return "#e879f9";
    return "var(--muted)";
  }

  function findMarkerIndex(points, date) {
    if (!date || !points.length) return -1;
    const target = String(date).slice(0, 10);
    let best = -1;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = String(p.date || "").slice(0, 10);
      if (!d) return;
      const dist = Math.abs(Date.parse(d) - Date.parse(target));
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  function drawEventMarkers(points, layout, markers) {
    if (!markers?.length) return "";
    return markers
      .map((marker) => {
        const idx = findMarkerIndex(points, marker.date);
        if (idx < 0) return "";
        const x = layout.xAt(idx);
        const color = marker.color || markerColor(marker.type);
        return `<line x1="${x.toFixed(1)}" y1="${layout.pad.top}" x2="${x.toFixed(1)}" y2="${(layout.pad.top + layout.innerH).toFixed(1)}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3" opacity="0.85" />`;
      })
      .join("");
  }

  function renderMarkerPills(markers, points, focusedIndex = -1) {
    if (!markers?.length) return "";
    const pills = markers.slice(0, 8).map((marker, i) => {
      const type = escapeHtml(marker.type || "event");
      const label = escapeHtml(marker.label || type);
      const date = escapeHtml(String(marker.date || "").slice(0, 10));
      const url = marker.url
        ? `<a href="${escapeHtml(marker.url)}" target="_blank" rel="noopener noreferrer" class="ts-chart-marker-link">Source</a>`
        : "";
      const focusCls = i === focusedIndex ? " ts-chart-marker-pill-focus" : "";
      return `<span class="ts-chart-marker-pill${focusCls}" data-type="${type}" data-marker-idx="${i}" title="${label} · ${date}">${type} · ${date} ${url}</span>`;
    });
    const extra = markers.length > 8 ? `<span class="ts-chart-marker-more">+${markers.length - 8} more</span>` : "";
    return `<div class="ts-chart-markers" aria-label="Policy event markers">${pills.join("")}${extra}</div>`;
  }

  function drawLine(points, layout) {
    const coords = points.map((p, i) => `${layout.xAt(i).toFixed(1)},${layout.yAt(p.close).toFixed(1)}`);
    const up = points[points.length - 1].close >= points[0].close;
    const stroke = up ? "var(--green)" : "var(--red)";
    const bottom = layout.yAt(layout.min);
    const area = `${layout.xAt(0).toFixed(1)},${bottom.toFixed(1)} ${coords.join(" ")} ${layout.xAt(points.length - 1).toFixed(1)},${bottom.toFixed(1)}`;
    return `
      <polygon points="${area}" class="ts-chart-area ${up ? "up" : "down"}" />
      <polyline points="${coords.join(" ")}" class="ts-chart-line ${up ? "up" : "down"}" fill="none" stroke="${stroke}" />
    `;
  }

  function drawCandles(points, layout) {
    const barW = Math.max(2, Math.min(10, layout.innerW / Math.max(1, points.length) * 0.65));
    return points
      .map((p, i) => {
        const x = layout.xAt(i);
        const yHigh = layout.yAt(p.high);
        const yLow = layout.yAt(p.low);
        const yOpen = layout.yAt(p.open);
        const yClose = layout.yAt(p.close);
        const up = p.close >= p.open;
        const color = up ? "var(--green)" : "var(--red)";
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(1, Math.abs(yOpen - yClose));
        return `
          <line x1="${x.toFixed(1)}" y1="${yHigh.toFixed(1)}" x2="${x.toFixed(1)}" y2="${yLow.toFixed(1)}" stroke="${color}" stroke-width="1" />
          <rect x="${(x - barW / 2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${bodyH.toFixed(1)}" fill="${color}" />
        `;
      })
      .join("");
  }

  function draw(state) {
    const root = state.root;
    const plot = state.plotEl;
    const svg = plot?.querySelector(".ts-chart-svg");
    const emptyEl = root?.querySelector(".ts-chart-empty");
    const yRange = root?.querySelector(".ts-chart-y-range");
    if (!svg || !plot) return;

    const points = state.points;
    if (!points.length) {
      svg.innerHTML = "";
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = state.emptyMessage || "No chart data yet.";
      }
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    const width = Math.max(280, plot.clientWidth || 460);
    const height = state.height;
    const tickCount = state.compact ? 2 : 4;
    const pad = state.compact
      ? { top: 8, right: 8, bottom: 4, left: 12 }
      : { top: 12, right: 12, bottom: 8, left: 52 };
    const layout = scaleLayout(points, width, height, pad);
    state.layout = layout;
    state.pad = pad;
    state.svgWidth = width;
    state.svgHeight = height;

    const body =
      state.mode === "candle" && hasOhlc(points)
        ? drawCandles(points, layout)
        : drawLine(points, layout);
    const markers = drawEventMarkers(points, layout, state.markers);

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = `
      ${drawGrid(svg, layout, pad, width, height, tickCount)}
      ${body}
      ${markers}
      ${state.hideYLabels ? "" : drawYLabels(state, layout, pad, state.formatMoney, tickCount)}
    `;

    if (state.animateIn && !state.animateInPlayed && state.mode !== "candle") {
      const line = svg.querySelector(".ts-chart-line");
      if (line && typeof line.getTotalLength === "function") {
        // getTotalLength() throws InvalidStateError when the chart lives in a
        // hidden view (display:none) — skip the draw-in animation, never crash render.
        try {
          const len = line.getTotalLength();
          line.style.strokeDasharray = `${len}`;
          line.style.strokeDashoffset = `${len}`;
          requestAnimationFrame(() => {
            line.style.transition = "stroke-dashoffset 1.05s cubic-bezier(0.16, 1, 0.3, 1)";
            line.style.strokeDashoffset = "0";
          });
          state.animateInPlayed = true;
        } catch {
          state.animateInPlayed = true;
        }
      }
    }

    const markersHost = root?.querySelector(".ts-chart-markers-host");
    if (markersHost) {
      markersHost.innerHTML = state.markers?.length
        ? renderMarkerPills(state.markers, points, state.focusedMarkerIndex ?? -1)
        : "";
    }

    if (state.focusedMarkerIndex != null && state.markers?.[state.focusedMarkerIndex]) {
      const marker = state.markers[state.focusedMarkerIndex];
      const idx = findMarkerIndex(points, marker.date);
      if (idx >= 0 && plot) {
        const x = layout.xAt(idx);
        const y = layout.yAt(points[idx].close);
        const dot = plot.querySelector(".ts-chart-dot");
        const tooltip = plot.querySelector(".ts-chart-tooltip");
        if (dot) {
          dot.style.left = `${x}px`;
          dot.style.top = `${y}px`;
          dot.style.opacity = "1";
        }
        if (tooltip) {
          tooltip.textContent = `${marker.label || marker.type || "Event"} · ${String(marker.date || "").slice(0, 10)}`;
          tooltip.style.left = `${Math.min(width - 8, x + 12)}px`;
          tooltip.style.top = `${Math.max(8, y - 28)}px`;
          tooltip.style.opacity = "1";
        }
        plot.classList.add("ts-chart-tracing");
      }
    }

    if (yRange) {
      const first = points[0].close;
      const last = points[points.length - 1].close;
      const chg = first ? ((last - first) / first) * 100 : 0;
      const sign = chg >= 0 ? "+" : "";
      yRange.textContent = `${state.formatMoney(last)} · ${sign}${chg.toFixed(2)}% over window`;
      yRange.className = `ts-chart-y-range ${chg >= 0 ? "up" : "down"}`;
    }
  }

  function bindPointer(state) {
    const plot = state.plotEl;
    if (!plot || state.bound) return;
    state.bound = true;

    const crosshair = plot.querySelector(".ts-chart-crosshair");
    const dot = plot.querySelector(".ts-chart-dot");
    const tooltip = plot.querySelector(".ts-chart-tooltip");

    plot.addEventListener("mousemove", (event) => {
      const points = state.points;
      if (!points.length || !state.layout) return;
      const rect = plot.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const index = Math.max(0, Math.min(points.length - 1, Math.round(pct * (points.length - 1))));
      const point = points[index];
      const x = state.layout.xAt(index) * (rect.width / state.svgWidth);
      const y = state.layout.yAt(point.close) * (rect.height / state.svgHeight);
      const first = points[0].close || 1;
      const chg = ((point.close - first) / first) * 100;

      crosshair.style.left = `${x}px`;
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      tooltip.style.left = `${Math.min(rect.width - 200, Math.max(8, x + 12))}px`;
      tooltip.style.top = `${Math.min(rect.height - 100, Math.max(8, y - 48))}px`;
      tooltip.innerHTML = `
        <strong>${escapeHtml(state.formatDate(point.date))}</strong>
        <span>${escapeHtml(state.formatMoney(point.close))}</span>
        <small>${escapeHtml(state.yLabel)}</small>
        <small class="${chg >= 0 ? "up" : "down"}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% vs start of window</small>
        ${
          point.open != null && Math.abs(point.open - point.close) > 0.001
            ? `<small>O ${escapeHtml(state.formatMoney(point.open))} · H ${escapeHtml(state.formatMoney(point.high))} · L ${escapeHtml(state.formatMoney(point.low))}</small>`
            : ""
        }
      `;
      plot.classList.add("ts-chart-tracing");
    });

    plot.addEventListener("mouseleave", () => {
      plot.classList.remove("ts-chart-tracing");
    });

    const root = state.root;
    root.querySelectorAll("[data-ts-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        state.mode = btn.dataset.tsMode;
        root.querySelectorAll("[data-ts-mode]").forEach((b) => b.classList.toggle("active", b === btn));
        draw(state);
      });
    });

    if (typeof ResizeObserver !== "undefined") {
      state.resizeObserver = new ResizeObserver(() => draw(state));
      state.resizeObserver.observe(plot);
    }
  }

  function mount(target, options = {}) {
    const root = resolveEl(target);
    if (!root) return null;

    destroy(root);

    const points = normalizePoints(options.points || []);
    const state = {
      root,
      points,
      mode: options.mode || (hasOhlc(points) ? "candle" : "line"),
      symbol: options.symbol || "",
      source: options.source || "",
      liveLabel: options.liveLabel || "",
      emptyMessage: options.emptyMessage || "",
      yLabel: options.yLabel || "Value (USD)",
      xLabel: options.xLabel || "Time →",
      height: Number(options.height) || 156,
      formatMoney: typeof options.formatMoney === "function" ? options.formatMoney : defaultMoney,
      formatDate: typeof options.formatDate === "function" ? options.formatDate : defaultFormatDate,
      markers: Array.isArray(options.markers) ? options.markers : [],
      compact: Boolean(options.compact),
      hideYLabels: Boolean(options.hideYLabels ?? options.compact),
      animateIn: Boolean(options.animateIn),
      animateInPlayed: false
    };

    root.classList.toggle("ts-chart-compact", state.compact);
    root.innerHTML = buildShell(state);
    state.plotEl = root.querySelector(".ts-chart-plot");
    instances.set(root, state);
    draw(state);
    bindPointer(state);
    return state;
  }

  function update(target, patch = {}) {
    const root = resolveEl(target);
    if (!root) return null;
    let state = instances.get(root);
    if (!state) return mount(target, patch);

    if (patch.points) state.points = normalizePoints(patch.points);
    if (patch.liveValue != null) {
      state.points = patchLiveBar(state.points, patch.liveValue);
      state.liveLabel = patch.liveLabel || `Updated just now`;
    }
    if (patch.source != null) state.source = patch.source;
    if (patch.mode) state.mode = patch.mode;
    if (patch.markers) state.markers = patch.markers;
    draw(state);
    return state;
  }

  function destroy(target) {
    const root = resolveEl(target);
    if (!root) return;
    const state = instances.get(root);
    if (state?.resizeObserver) state.resizeObserver.disconnect();
    instances.delete(root);
    root.innerHTML = "";
    root.classList.remove("ts-chart-root");
  }

  function focusMarker(target, matcher = {}) {
    const root = resolveEl(target);
    if (!root) return false;
    const state = instances.get(root);
    if (!state?.markers?.length) return false;

    const dateNeedle = matcher.date ? String(matcher.date).slice(0, 10) : null;
    const typeNeedle = matcher.type ? String(matcher.type).toLowerCase() : null;
    let idx = -1;
    if (dateNeedle) {
      idx = state.markers.findIndex((m) => {
        const d = String(m.date || "").slice(0, 10);
        if (d !== dateNeedle) return false;
        if (typeNeedle && String(m.type || "").toLowerCase() !== typeNeedle) return false;
        return true;
      });
    }
    if (idx < 0 && typeNeedle) {
      idx = state.markers.findIndex((m) => String(m.type || "").toLowerCase() === typeNeedle);
    }
    if (idx < 0) return false;

    state.focusedMarkerIndex = idx;
    draw(state);
    root.querySelector(`[data-marker-idx="${idx}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return true;
  }

  global.TSCharts = {
    mount,
    update,
    destroy,
    focusMarker,
    normalizePoints,
    patchLiveBar,
    hasOhlc
  };
})(typeof window !== "undefined" ? window : globalThis);
