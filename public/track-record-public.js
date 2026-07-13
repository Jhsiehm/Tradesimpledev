// Standalone renderer for the public, read-only Track Record page.
// Deliberately does not load app.js (13k+ lines of authenticated app logic) —
// this trims the rendering logic already used in app.js's renderTrackRecord()
// down to the minimum needed for a shareable, unauthenticated page.
(function () {
  "use strict";

  function $(selector) {
    return document.querySelector(selector);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function trPct(n, withSign) {
    if (withSign === undefined) withSign = true;
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const v = Number(n);
    return `${withSign && v > 0 ? "+" : ""}${v.toFixed(1)}%`;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }

  let logFilter = "all";
  let cachedPredictions = [];

  function renderStatGrid(sc) {
    const grid = $("#tr-stat-grid");
    if (!grid) return;
    const hitRate = sc.hitRate != null ? Math.round(sc.hitRate * 100) : null;
    const edge = sc.directionalEdgePct;
    const edgeCls = edge == null ? "" : edge > 0 ? "pos" : edge < 0 ? "neg" : "";
    const skill = sc.skillVsCoinflip;
    grid.innerHTML = `
      <div class="tr-stat">
        <span class="tr-stat-label">Directional hit rate</span>
        <span class="tr-stat-value ${hitRate != null && hitRate >= 50 ? "pos" : ""}">${hitRate != null ? hitRate + "%" : "—"}</span>
        <span class="tr-stat-sub">${sc.counts.directionalResolved} resolved directional calls</span>
      </div>
      <div class="tr-stat">
        <span class="tr-stat-label">Avg edge vs ${escapeHtml(sc.benchmark || "SPY")}</span>
        <span class="tr-stat-value ${edgeCls}">${trPct(edge)}</span>
        <span class="tr-stat-sub">Excess return in the predicted direction</span>
      </div>
      <div class="tr-stat">
        <span class="tr-stat-label">Calibration (Brier)</span>
        <span class="tr-stat-value">${sc.meanBrier != null ? sc.meanBrier.toFixed(3) : "—"}</span>
        <span class="tr-stat-sub">${skill != null && skill > 0 ? `Beating a coin flip by ${skill.toFixed(3)}` : "Lower is better (0 = perfect)"}</span>
      </div>
      <div class="tr-stat">
        <span class="tr-stat-label">Open / Total</span>
        <span class="tr-stat-value">${sc.counts.open}<span style="color:var(--faint);font-size:16px"> / ${sc.counts.total}</span></span>
        <span class="tr-stat-sub">Live predictions awaiting their horizon</span>
      </div>`;
  }

  function renderCalibration(buckets) {
    const el = $("#tr-calibration");
    if (!el) return;
    const withData = (buckets || []).filter((b) => b.n > 0);
    if (!withData.length) {
      el.innerHTML = `<p class="tr-empty" style="margin:auto">Not enough resolved predictions yet to chart calibration.</p>`;
      document.getElementById("tr-cal-legend-inline")?.remove();
      return;
    }
    el.innerHTML = buckets.map((b) => {
      const expectedH = Math.round((b.predictedRate || 0) * 100);
      const actualH = b.actualRate != null ? Math.round(b.actualRate * 100) : 0;
      const under = b.actualRate != null && b.actualRate < b.predictedRate;
      return `
        <div class="tr-cal-col">
          <div class="tr-cal-bars">
            <div class="tr-cal-bar expected" style="height:${expectedH}%" title="Predicted ${expectedH}%"></div>
            <div class="tr-cal-bar actual ${under ? "under" : ""}" style="height:${actualH}%" title="Actual ${b.actualRate != null ? actualH + "%" : "n/a"}"></div>
          </div>
          <span class="tr-cal-label">${escapeHtml(b.range)}</span>
          <span class="tr-cal-n">n=${b.n}</span>
        </div>`;
    }).join("");
    if (!document.getElementById("tr-cal-legend-inline")) {
      el.insertAdjacentHTML("afterend", `<div class="tr-cal-legend" id="tr-cal-legend-inline">
        <span><span class="tr-cal-swatch" style="background:rgba(255,255,255,0.10)"></span>Confidence claimed</span>
        <span><span class="tr-cal-swatch" style="background:var(--green)"></span>Actually right</span>
      </div>`);
    }
  }

  function renderCatalyst(byCat) {
    const el = $("#tr-catalyst");
    if (!el) return;
    const rows = Object.entries(byCat || {}).filter(([, v]) => v.n > 0);
    if (!rows.length) {
      el.innerHTML = `<p class="tr-empty">No resolved predictions by catalyst yet.</p>`;
      return;
    }
    rows.sort((a, b) => (b[1].edgePct || 0) - (a[1].edgePct || 0));
    el.innerHTML = rows.map(([type, v]) => {
      const hit = v.hitRate != null ? Math.round(v.hitRate * 100) : null;
      const edgeCls = v.edgePct == null ? "" : v.edgePct > 0 ? "pos" : "neg";
      const label = type.replace(/_/g, " ");
      return `
        <div class="tr-cat-row">
          <div class="tr-cat-name">${escapeHtml(label)}<small>${v.n} call${v.n === 1 ? "" : "s"}</small></div>
          <div class="tr-cat-stat">${hit != null ? hit + "%" : "—"}<small>hit rate</small></div>
          <div class="tr-cat-stat ${edgeCls === "pos" ? "up" : edgeCls === "neg" ? "down" : ""}">${trPct(v.edgePct)}<small>edge</small></div>
        </div>`;
    }).join("");
  }

  function renderLog() {
    const el = $("#tr-log");
    if (!el) return;
    let rows = cachedPredictions;
    if (logFilter === "open") rows = rows.filter((p) => p.status === "open");
    else if (logFilter === "resolved") rows = rows.filter((p) => p.status === "resolved");

    if (!rows.length) {
      el.innerHTML = `<p class="tr-empty">No predictions logged yet.</p>`;
      return;
    }

    el.innerHTML = rows.map((p) => {
      const r = p.resolution;
      const dirLabel = p.direction === "bullish" ? "LONG" : p.direction === "bearish" ? "SHORT" : "NEUTRAL";
      const created = new Date(p.createdAt);
      const dateStr = created.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const catalyst = p.catalyst?.title ? escapeHtml(p.catalyst.title) : "Signal";

      let outcome;
      if (p.status === "open") {
        const ends = new Date(p.horizonEndsAt);
        const daysLeft = Math.max(0, Math.ceil((ends - Date.now()) / 86400000));
        outcome = `<span class="tr-log-badge open">Open</span><span class="tr-log-return"><small>${daysLeft}d left · ${p.horizonDays}d horizon</small></span>`;
      } else if (r) {
        const cls = r.hit ? "hit" : "miss";
        const retCls = r.excessReturnPct > 0 ? "pos" : r.excessReturnPct < 0 ? "neg" : "";
        outcome = `<span class="tr-log-badge ${cls}">${r.hit ? "Hit" : "Miss"}</span><span class="tr-log-return ${retCls}">${trPct(r.excessReturnPct)}<small>vs ${escapeHtml(p.benchmark || "SPY")}</small></span>`;
      } else {
        outcome = `<span class="tr-log-badge open">—</span>`;
      }

      const conf = Number.isFinite(Number(p.confidence)) ? `${Math.round(p.confidence)}% conf` : "";
      return `
        <div class="tr-log-row">
          <span class="tr-log-dir ${p.direction}">${dirLabel}</span>
          <div class="tr-log-body">
            <span class="tr-log-tick">${escapeHtml(p.ticker)}</span>
            <p class="tr-log-thesis">${escapeHtml(p.thesis || catalyst)}</p>
            <div class="tr-log-meta-line">${dateStr} · ${catalyst}${conf ? " · " + conf : ""}</div>
          </div>
          <div class="tr-log-outcome">${outcome}</div>
        </div>`;
    }).join("");
  }

  function setupTabs() {
    document.addEventListener("click", (e) => {
      const tab = e.target.closest(".tr-log-tab");
      if (!tab) return;
      document.querySelectorAll(".tr-log-tab").forEach((t) => t.classList.toggle("active", t === tab));
      logFilter = tab.dataset.trFilter || "all";
      renderLog();
    });
  }

  async function load() {
    setupTabs();
    try {
      const [scorecard, list] = await Promise.all([
        fetchJson("/api/predictions/scorecard"),
        fetchJson("/api/predictions?limit=100")
      ]);
      cachedPredictions = list.predictions || [];

      const badge = $("#tr-verify-badge");
      const vtext = $("#tr-verify-text");
      if (badge && vtext) {
        if (scorecard.integrity?.ok) {
          badge.classList.add("ok");
          vtext.textContent = `Chain verified · ${scorecard.integrity.length} events`;
        } else {
          badge.classList.add("broken");
          vtext.textContent = "Chain integrity FAILED";
        }
      }

      renderStatGrid(scorecard);
      renderCalibration(scorecard.calibration || []);
      renderCatalyst(scorecard.byCatalyst || {});
      renderLog();
    } catch (err) {
      const grid = $("#tr-stat-grid");
      if (grid) grid.innerHTML = `<p class="tr-empty">Could not load the track record. ${escapeHtml(err.message || "")}</p>`;
    }
  }

  load();
})();
