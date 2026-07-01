/* Extracted from app.js lines 11222-11680 */
// ── Track Record (prediction ledger UI) ─────────────────────────────────────
let _trackRecordLoaded = false;
let _trackRecordCache = null;
let _trLogFilter = "all";

async function loadTrackRecord(force = false) {
  if (_trackRecordLoaded && !force) { renderTrackRecord(); return; }
  const statGrid = $("#tr-stat-grid");
  if (statGrid) statGrid.innerHTML = skeletonRows(4, "default");
  try {
    const [scorecard, list] = await Promise.all([
      fetchJson("/api/predictions/scorecard"),
      fetchJson("/api/predictions?limit=100")
    ]);
    _trackRecordCache = { scorecard, predictions: list.predictions || [] };
    _trackRecordLoaded = true;
    renderTrackRecord();
  } catch (err) {
    if (statGrid) statGrid.innerHTML = `<p class="tr-empty">Could not load the track record. ${escapeHtml(err.message || "")}</p>`;
  }
}

function trPct(n, withSign = true) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return `${withSign && v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function renderTrackRecord() {
  if (!_trackRecordCache) return;
  const { scorecard: sc, predictions } = _trackRecordCache;

  const badge = $("#tr-verify-badge");
  const vtext = $("#tr-verify-text");
  if (badge && vtext) {
    if (sc.integrity?.ok) {
      badge.classList.add("ok"); badge.classList.remove("broken");
      vtext.textContent = `Chain verified · ${sc.integrity.length} events`;
    } else {
      badge.classList.add("broken"); badge.classList.remove("ok");
      vtext.textContent = "Chain integrity FAILED";
    }
  }

  const grid = $("#tr-stat-grid");
  if (grid) {
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
        <span class="tr-stat-sub">${skill != null && skill > 0 ? `Beating a coin flip by ${(skill).toFixed(3)}` : "Lower is better (0 = perfect)"}</span>
      </div>
      <div class="tr-stat">
        <span class="tr-stat-label">Open / Total</span>
        <span class="tr-stat-value">${sc.counts.open}<span style="color:var(--faint);font-size:16px"> / ${sc.counts.total}</span></span>
        <span class="tr-stat-sub">Live predictions awaiting their horizon</span>
      </div>`;
  }

  renderTrCalibration(sc.calibration || []);
  renderTrCatalyst(sc.byCatalyst || {});
  renderTrLog(predictions);
}

function renderTrCalibration(buckets) {
  const el = $("#tr-calibration");
  if (!el) return;
  const withData = buckets.filter((b) => b.n > 0);
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

function renderTrCatalyst(byCat) {
  const el = $("#tr-catalyst");
  if (!el) return;
  const rows = Object.entries(byCat).filter(([, v]) => v.n > 0);
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

function renderTrLog(predictions) {
  const el = $("#tr-log");
  if (!el) return;
  let rows = predictions;
  if (_trLogFilter === "open") rows = rows.filter((p) => p.status === "open");
  else if (_trLogFilter === "resolved") rows = rows.filter((p) => p.status === "resolved");

  if (!rows.length) {
    el.innerHTML = `<p class="tr-empty">No predictions logged yet. As live bill signals cross our momentum threshold, they're auto-recorded here with a timestamp and a falsifiable claim.</p>`;
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

function setupTrackRecordTabs() {
  document.addEventListener("click", (e) => {
    const tab = e.target.closest(".tr-log-tab");
    if (!tab) return;
    document.querySelectorAll(".tr-log-tab").forEach((t) => t.classList.toggle("active", t === tab));
    _trLogFilter = tab.dataset.trFilter || "all";
    if (_trackRecordCache) renderTrLog(_trackRecordCache.predictions);
  });
}

window.showView = showView;
window.askWhyForBill = askWhyForBill;
window.openMethodologyModal = openMethodologyModal;

// Called by the Settings page after saving an API key — re-fetches config
// and re-runs analysis so AI layers activate without a page reload.
window.__tsActivateAi = async function () {
  try {
    const config = await fetchJson("/api/config");
    state.config = config;
    syncFeatureGatesFromConfig(config);
    applyFeatureGateVisibility();
    renderConnections();
    renderByokStatus();
    if (state.activeAnalysisSymbol && isFeatureEnabled("ANALYSIS_LAB_ENABLED")) {
      await loadAnalysis(state.activeAnalysisSymbol);
    }
  } catch (e) {
    console.warn("[ts] __tsActivateAi failed:", e.message);
  }
};

/*
═══════════════════════════════════════════════════════════
THESIS LAB
Self-contained module. No external deps. Reads/writes
thesisState only. Hooks into showView via the existing
pattern at the bottom of this file.
═══════════════════════════════════════════════════════════
*/
const thesisState = {
  ticker: "",
  dir: "",
  timeHorizon: "unspecified",
  thesis: "",
  cats: new Set(),
  entry: 0,
  target: 0,
  stop: 0,
  built: false,
  savedThesisId: null,
  savedOutcome: null,
  signalsPayload: null,
  signalsLoading: false,
  normalizedThesis: null,
  commandContext: null
};

const THESIS_MONITOR_REFRESH_MS = 45000;
let thesisMonitorRefreshTimer = null;

const THESIS_LIVE_QUOTE_SOURCES = new Set(["finnhub", "yfinance", "yahoo_chart"]);
const THESIS_FALLBACK_QUOTE_SOURCES = new Set(["fallback", "fallback_static"]);

function thesisTrackQuote() {
  const sym = String(thesisState.ticker || "").toUpperCase();
  return sym ? quoteFor(sym) : null;
}

function normalizeThesisClient(raw = {}) {
  const thesisText = String(raw.thesisText || raw.thesis || "").trim();
  const confidence = raw.confidence || {};
  return {
    id: raw.id || "",
    schemaVersion: Number(raw.schemaVersion) || 1,
    symbol: String(raw.symbol || raw.ticker || "").toUpperCase(),
    direction: String(raw.direction || "unclear"),
    timeHorizon: String(raw.timeHorizon || "unspecified"),
    thesisText,
    thesisRestatement: String(raw.thesisRestatement || thesisText),
    bullCase: Array.isArray(raw.bullCase) ? raw.bullCase : [],
    bearCase: Array.isArray(raw.bearCase) ? raw.bearCase : [],
    evidenceFor: Array.isArray(raw.evidenceFor) ? raw.evidenceFor : [],
    evidenceAgainst: Array.isArray(raw.evidenceAgainst) ? raw.evidenceAgainst : [],
    assumptions: Array.isArray(raw.assumptions) ? raw.assumptions : [],
    invalidationConditions: Array.isArray(raw.invalidationConditions) ? raw.invalidationConditions : [],
    watchTriggers: Array.isArray(raw.watchTriggers) ? raw.watchTriggers : [],
    confidence: {
      score: Number.isFinite(Number(confidence.score)) ? Number(confidence.score) : null,
      label: String(confidence.label || "unscored"),
      explanation: String(confidence.explanation || "Legacy thesis has not been scored yet.")
    },
    sourceStatus: String(raw.sourceStatus || "legacy_user_input"),
    needsUpgrade: Boolean(raw.needsUpgrade || Number(raw.schemaVersion || 1) < 2),
    entry: Number(raw.entry) || 0,
    target: Number(raw.target) || 0,
    stop: Number(raw.stop) || 0
  };
}

function thesisSourceBadge(kind = "modeled", confidence = null) {
  const normalized = String(kind || "modeled").toLowerCase().replace(/\s+/g, "_");
  const label = normalized.replace(/_/g, " ");
  const confLabel =
    Number.isFinite(Number(confidence))
      ? Number(confidence) >= 75
        ? "High confidence"
        : Number(confidence) >= 45
          ? "Medium confidence"
          : "Low confidence"
      : "Unscored";
  return `<span class="mini-pill">${escapeHtml(label)}</span><span class="mini-pill">${escapeHtml(confLabel)}</span>`;
}

function buildMarketThesisContextClient() {
  const normalized = thesisState.normalizedThesis || normalizeThesisClient({
    ticker: thesisState.ticker,
    direction: thesisState.dir || "unclear",
    timeHorizon: thesisState.timeHorizon,
    thesisText: thesisState.thesis,
    entry: thesisState.entry,
    target: thesisState.target,
    stop: thesisState.stop
  });
  const payload = thesisState.signalsPayload || {};
  const monitors = Array.isArray(payload.monitors) ? payload.monitors : [];
  const signals = Array.isArray(payload.signals) ? payload.signals : [];
  const alertCount = thesisMonitorAlertCount(monitors);
  const conf = Number(normalized.confidence?.score);
  const monitorScore = monitors.length
    ? Math.round((1 - alertCount / Math.max(monitors.length, 1)) * 100)
    : null;
  const healthScore = Number.isFinite(conf)
    ? Math.round((conf * 0.6) + ((monitorScore ?? 50) * 0.4))
    : monitorScore;
  const trend = healthScore == null ? "unknown" : healthScore >= 70 ? "stable" : healthScore >= 45 ? "watch" : "fragile";
  thesisState.commandContext = {
    thesis: normalized,
    monitors,
    signals,
    evidence: payload.evidence || {},
    claims: payload.claims || [],
    health: {
      score: Number.isFinite(healthScore) ? healthScore : null,
      trend,
      explanation: "Health blends confidence and monitor stability. Research context only."
    },
    movement: monitors.slice(0, 5).map((m) => ({
      at: new Date().toISOString(),
      label: m.text,
      status: m.status,
      source: m.src
    })),
    outcome: thesisState.savedOutcome || null
  };
  return thesisState.commandContext;
}

function thesisQuotesLive() {
  const q = thesisTrackQuote();
  if (q?.source) return THESIS_LIVE_QUOTE_SOURCES.has(String(q.source).toLowerCase());
  const src = String(state.quoteFeedSource || "").toLowerCase();
  return THESIS_LIVE_QUOTE_SOURCES.has(src);
}

function thesisQuoteIsFallback() {
  const q = thesisTrackQuote();
  if (q?.source) return THESIS_FALLBACK_QUOTE_SOURCES.has(String(q.source).toLowerCase());
  const src = String(state.quoteFeedSource || "").toLowerCase();
  return !src || src === "fallback" || src === "mixed";
}

function thesisUpdateQuoteTrustUi() {
  const fbBadge = $("#quote-fallback-badge");
  if (fbBadge) {
    fbBadge.hidden = true;
    fbBadge.setAttribute("aria-hidden", "true");
  }
  renderLiveFeedStatus();
  const blocker = document.getElementById("tr-quote-blocker");
  const trackBtn = document.getElementById("tr-track-paper");
  const fallback = thesisQuoteIsFallback();
  if (blocker) blocker.hidden = !thesisState.built || !fallback;
  if (trackBtn && thesisState.built) {
    trackBtn.disabled = fallback;
    trackBtn.title = fallback ? "Live market data required — fallback prices active" : "";
  }
}

function thesisFormatPctRange(low, high, isBull = true) {
  const lo = Math.round(Math.min(low, high));
  const hi = Math.round(Math.max(low, high));
  if (lo >= 0 && hi >= 0 && isBull) return `+${lo}–${hi}%`;
  return `${lo}–${hi}%`;
}

function thesisScenarioBands(t) {
  const hasP = t.entry > 0 && t.target > 0 && t.stop > 0;
  const isBull = t.dir !== "bear";
  if (hasP) {
    const best = ((t.target - t.entry) / t.entry) * 100;
    const base = best * 0.55;
    const bear = -((t.entry - t.stop) / t.entry) * 100;
    return {
      computed: true,
      best: thesisFormatPctRange(best * 0.9, best * 1.05, isBull),
      base: thesisFormatPctRange(base * 0.75, base * 1.1, isBull),
      bear: thesisFormatPctRange(bear * 0.9, bear * 1.05, false)
    };
  }
  return {
    computed: false,
    best: isBull ? "+20–30%" : "-18–25%",
    base: isBull ? "+8–15%" : "-7–12%",
    bear: isBull ? "-10–12%" : "+8–12%"
  };
}

function thesisMonitorStatusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("catalyst")) return "status-catalyst";
  if (s.includes("broken")) return "status-broken";
  if (s.includes("watch")) return "status-watch";
  return "status-normal";
}

function thesisMonitorAlertCount(monitors) {
  return (monitors || []).filter((m) => {
    const s = String(m.status || "").toLowerCase();
    return s.includes("watch") || s.includes("catalyst") || s.includes("broken");
  }).length;
}

function thesisStopMonitorRefresh() {
  if (thesisMonitorRefreshTimer) {
    clearInterval(thesisMonitorRefreshTimer);
    thesisMonitorRefreshTimer = null;
  }
}

function thesisStartMonitorRefresh() {
  thesisStopMonitorRefresh();
  if (!thesisState.built) return;
  const resultVisible = document.getElementById("tscreen-result")?.classList.contains("active");
  const thesisViewActive = document.getElementById("view-thesis")?.classList.contains("active");
  if (!resultVisible || !thesisViewActive) return;
  thesisMonitorRefreshTimer = setInterval(() => {
    const stillVisible =
      document.getElementById("tscreen-result")?.classList.contains("active") &&
      document.getElementById("view-thesis")?.classList.contains("active");
    if (!stillVisible || !thesisState.built) {
      thesisStopMonitorRefresh();
      return;
    }
    void thesisFetchSignals({ silent: true });
  }, THESIS_MONITOR_REFRESH_MS);
}

async function thesisFetchSignals(options = {}) {
  const t = thesisState;
  if (!t.ticker) return null;
  if (!options.silent) thesisState.signalsLoading = true;
  try {
    const params = new URLSearchParams({
      symbol: t.ticker,
      thesisText: t.thesis || "",
      direction: t.dir || "bull",
      exitCats: [...t.cats].join(",")
    });
    const data = await fetchJson(`/api/thesis/signals?${params}`);
    thesisState.signalsPayload = data;
    if (thesisState.built) thesisRenderResult();
    return data;
  } catch {
    if (!options.silent) thesisState.signalsPayload = null;
    return null;
  } finally {
    if (!options.silent) thesisState.signalsLoading = false;
  }
}

function thesisNormalizeClaims(claims, fallbackText) {
