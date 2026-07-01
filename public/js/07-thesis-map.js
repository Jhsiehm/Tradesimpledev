/* Extracted from app.js lines 11681-13333 */
  const rows = (claims || []).filter(Boolean);
  if (!rows.length) return [{ text: fallbackText || "", evidence: [] }];
  return rows.map((row) => {
    if (typeof row === "string") return { text: row, evidence: [] };
    return { text: row.text || "", evidence: row.evidence || [] };
  });
}

function renderEvidenceDrawerItems(items, emptyHint) {
  const list = (items || []).filter(Boolean);
  if (!list.length) {
    return `<p class="thesis-section-hint">${escapeHtml(emptyHint || "No evidence mapped yet.")}</p>`;
  }
  return list
    .map((ev) => {
      const modeled = ev.modeled !== false ? " · modeled" : "";
      const link = ev.sourceUrl
        ? `<a href="${escapeHtml(ev.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>`
        : "";
      return `
<div class="thesis-evidence-row">
<span>Source</span>${escapeHtml(ev.source || "—")}${modeled}
</div>
<div class="thesis-evidence-row"><span>Date</span>${escapeHtml(ev.date || ev.publishedAt || "—")}</div>
<div class="thesis-evidence-row"><span>Excerpt</span>${escapeHtml(ev.excerpt || ev.summary || ev.quote || "—")}</div>
<div class="thesis-evidence-row"><span>Relevance</span>${escapeHtml(ev.relevance || ev.supports || "Research context only")}</div>
${link ? `<div class="thesis-evidence-link">${link}</div>` : ""}`;
    })
    .join("");
}

function thesisRenderClaims(claims, _legacyEvidence) {
  const host = document.getElementById("tr-claims");
  if (!host) return;
  const list = thesisNormalizeClaims(claims, thesisState.thesis);
  if (!list.length || !list[0].text) {
    host.innerHTML = `<p class="thesis-section-hint">Write a fuller thesis to surface claim-level evidence drawers.</p>`;
    return;
  }
  host.innerHTML = list
    .map((claim) => {
      const body = renderEvidenceDrawerItems(
        claim.evidence,
        "No mapped evidence yet — add policy or catalyst keywords to your thesis."
      );
      return `
<article class="thesis-claim-card">
<details class="thesis-claim-details">
<summary class="thesis-claim-head">
<div class="thesis-claim-text">${escapeHtml(claim.text)}</div>
<span class="thesis-claim-toggle">Evidence (${(claim.evidence || []).length})</span>
</summary>
<div class="thesis-evidence-drawer">${body}<p class="thesis-section-hint">Research context only — sources do not imply causation.</p></div>
</details>
</article>`;
    })
    .join("");
}

function thesisRenderSignalCards(signals) {
  const sigGrid = document.getElementById("tr-signals");
  if (!sigGrid) return;
  const rows = (signals || []).slice(0, 8);
  if (!rows.length) {
    sigGrid.innerHTML = thesisState.signalsLoading
      ? `<p class="thesis-section-hint">Loading ticker-specific signals from the server…</p>`
      : `<p class="thesis-section-hint">Signals unavailable — rebuild the plan or check your connection.</p>`;
    return;
  }
  sigGrid.innerHTML = rows
    .map((s) => {
      const ts = s.timestamp ? new Date(s.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
      const link = s.sourceUrl
        ? `<div class="thesis-signal-link"><a href="${escapeHtml(s.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a></div>`
        : "";
      const ev = s.evidence;
      const evidenceBlock = ev
        ? `<details class="thesis-signal-evidence"><summary>Receipt</summary>${renderEvidenceDrawerItems([ev])}</details>`
        : "";
      const socialBadge = s.meta?.socialBadge
        ? `<span class="social-badge ${escapeHtml(String(s.meta.socialBadge).toLowerCase().replace(/\s+/g, "-"))}">${escapeHtml(s.meta.socialBadge)}</span>`
        : "";
      const sourceBadges = thesisSourceBadge(s.sourceStatus || s.meta?.sourceStatus || "modeled", s.confidence);
      return `
<div class="thesis-signal-card">
<div class="thesis-signal-source">${escapeHtml(s.source || "Source")} ${socialBadge} ${sourceBadges}</div>
<div class="thesis-signal-meta"><span>${escapeHtml(ts)}</span><span>${escapeHtml(s.thesisPart || "Signal")}</span></div>
<div class="thesis-signal-body"><strong>${escapeHtml(s.title || "")}</strong> — ${escapeHtml(s.summary || s.body || "")}</div>
<div class="thesis-signal-why"><span>Why ${escapeHtml(thesisState.ticker || "this ticker")}:</span> ${escapeHtml(s.whyTicker || "")}</div>
${evidenceBlock}
${link}
</div>`;
    })
    .join("");
}

function thesisRenderMonitors(monitors) {
  const watchList = document.getElementById("tr-watchlist");
  if (!watchList) return;
  const rows = (monitors || []).slice(0, 6);
  if (!rows.length) {
    watchList.innerHTML = `<p class="thesis-section-hint">Pick exit scenarios in step 3 to seed monitor rules.</p>`;
    return;
  }
  watchList.innerHTML = rows
    .map(
      (w) => `
<div class="thesis-watch-item">
<div>
<div class="thesis-watch-top">
<span class="thesis-watch-status ${thesisMonitorStatusClass(w.status)}">${escapeHtml(w.status || "Normal")}</span>
<span class="thesis-watch-src">${escapeHtml(w.src || "")}</span>
${thesisSourceBadge(w.sourceStatus || "modeled", w.confidence)}
</div>
<div class="thesis-watch-text">${escapeHtml(w.text || "")}</div>
<div class="thesis-watch-next">Next check: ${escapeHtml(w.nextCheck || "—")}</div>
<div class="thesis-watch-why">${escapeHtml(w.why || "")}</div>
</div>
</div>`
    )
    .join("");
}

function thesisRenderStickyRail(t, payload) {
  const sym = t.ticker || "";
  const q = quoteFor(sym);
  const priceEl = document.getElementById("tr-rail-price");
  const freshEl = document.getElementById("tr-rail-price-fresh");
  const earnEl = document.getElementById("tr-rail-earnings");
  const statusEl = document.getElementById("tr-rail-status");
  const alertsEl = document.getElementById("tr-rail-alerts");
  const freshRail = document.getElementById("tr-rail-freshness");
  const rrEl = document.getElementById("tr-rail-rr");
  if (priceEl) priceEl.textContent = q?.price != null ? money(q.price) : "—";
  if (freshEl) {
    const src = state.quoteFeedSource || q?.source || "—";
    freshEl.textContent = thesisQuoteIsFallback()
      ? "Fallback prices — not live"
      : `${sourceLabel(src)} · ${freshnessText(state.dataMeta.market?.updatedAt)}`;
  }
  if (earnEl) earnEl.textContent = payload?.earningsLabel || "—";
  if (statusEl) {
    statusEl.textContent = t.savedThesisId ? "Tracked in paper" : t.built ? "Open plan" : "Draft";
  }
  if (alertsEl) {
    alertsEl.textContent = String(thesisMonitorAlertCount(payload?.monitors || []));
  }
  if (freshRail) {
    const latest = latestFeedTime(["market", "bills", "lobbying"]);
    freshRail.textContent = latest ? `Feeds · ${freshnessText(latest)}` : "Waiting for feeds";
  }
  if (rrEl) {
    const hasExit = t.entry > 0 && t.target > 0 && t.stop > 0 && t.entry > t.stop;
    rrEl.textContent = hasExit ? `${((t.target - t.entry) / (t.entry - t.stop)).toFixed(1)}x` : "—";
  }
}

function thesisDefaultSymbol() {
  return (
    state.activeAnalysisSymbol ||
    state.dashboardBootstrap?.defaultAnalysisSymbol ||
    marketsDefaultSymbols().find((s) => !["SPY", "QQQ"].includes(s)) ||
    "NVDA"
  );
}

function thesisSyncIntakeState({ renderSummary = false } = {}) {
  const intakeTicker = document.getElementById("tc-ticker");
  const fromInput = String(intakeTicker?.value || "")
    .toUpperCase()
    .replace(/[^A-Z.]/g, "");
  const sym = fromInput || thesisState.ticker || thesisDefaultSymbol();
  if (!sym) return "";
  if (intakeTicker && !fromInput) intakeTicker.value = sym;
  thesisState.ticker = sym;
  thesisUpdateIntakePreview();
  if (renderSummary) thesisRenderCommandSummary();
  thesisEnsureResultPanelVisibility();
  return sym;
}

function thesisUpdateIntakePreview() {
  const el = document.getElementById("tc-quote-preview");
  if (!el) return;
  const sym = String(thesisState.ticker || "").toUpperCase();
  if (!sym) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  const q = quoteFor(sym);
  if (q?.price != null) {
    const pct = Number(q.pct ?? q.changePercent ?? 0);
    el.textContent = `Live quote: ${money(q.price)} (${signed(pct)}%)`;
    return;
  }
  if (state.quotes?.length) {
    el.textContent = `No quote for ${sym} yet — hit Refresh in the top bar.`;
    return;
  }
  el.textContent = `Loading quote for ${sym}…`;
}

function thesisEnsureResultPanelVisibility() {
  const result = document.getElementById("tscreen-result");
  if (!result) return;
  result.classList.toggle("active", Boolean(thesisState.built));
  if (!thesisState.built) {
    for (let i = 0; i < 4; i++) document.getElementById("tscreen-" + i)?.classList.remove("active");
    document.getElementById("thesisStepBar")?.setAttribute("hidden", "");
  }
  thesisSyncEmptyGuide();
}

function thesisSyncEmptyGuide() {
  const guide = document.getElementById("thesis-empty-guide");
  if (!guide) return;
  guide.hidden = Boolean(thesisState.built);
}

function thesisRenderCommandSummary() {
  const ctx = buildMarketThesisContextClient();
  const q = quoteFor(thesisState.ticker);
  const pnl = thesisState.savedOutcome?.position?.unrealizedPnl;
  const byId = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  byId("tc-summary-ticker", thesisState.ticker || "Enter ticker above");
  byId("tc-summary-health", ctx.health?.score != null ? `${ctx.health.score}/100` : thesisState.built ? "Unscored" : "Build thesis to score");
  byId("tc-summary-trend", thesisState.built ? (ctx.health?.trend || "unknown") : "—");
  if (q?.price != null) {
    byId("tc-summary-price", money(q.price));
  } else if (!thesisState.ticker) {
    byId("tc-summary-price", "—");
  } else if (!state.quotes?.length) {
    byId("tc-summary-price", "Loading…");
  } else {
    byId("tc-summary-price", "Unavailable");
  }
  byId("tc-summary-pnl", Number.isFinite(Number(pnl)) ? money(pnl) : "Not linked");
  thesisUpdateIntakePreview();
  const banner = document.getElementById("tc-upgrade-banner");
  if (banner) banner.hidden = !ctx.thesis?.needsUpgrade;
}

function thesisHydrateIntakeFromSaved(thesis) {
  const normalized = normalizeThesisClient(thesis || {});
  thesisState.normalizedThesis = normalized;
  thesisState.ticker = normalized.symbol;
  thesisState.dir = normalized.direction === "unclear" ? "watch" : normalized.direction;
  thesisState.timeHorizon = normalized.timeHorizon;
  thesisState.thesis = normalized.thesisText;
  thesisState.entry = normalized.entry;
  thesisState.target = normalized.target;
  thesisState.stop = normalized.stop;
  if (document.getElementById("tc-ticker")) document.getElementById("tc-ticker").value = normalized.symbol;
  if (document.getElementById("tc-direction")) {
    document.getElementById("tc-direction").value = normalized.direction === "watch" ? "unclear" : normalized.direction;
  }
  if (document.getElementById("tc-horizon")) document.getElementById("tc-horizon").value = normalized.timeHorizon;
  if (document.getElementById("tc-thesis")) document.getElementById("tc-thesis").value = normalized.thesisText;
  if (document.getElementById("tc-entry")) document.getElementById("tc-entry").value = normalized.entry || "";
  if (document.getElementById("tc-target")) document.getElementById("tc-target").value = normalized.target || "";
  if (document.getElementById("tc-stop")) document.getElementById("tc-stop").value = normalized.stop || "";
}

async function thesisRequestUpgradePreview() {
  if (!thesisState.savedThesisId) {
    alert("Save the thesis first so it can be upgraded.");
    return;
  }
  const data = await fetchJson(`/api/theses/${encodeURIComponent(thesisState.savedThesisId)}/upgrade-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  const preview = data.upgradePreview || {};
  const lines = [
    `Direction: ${preview.direction || "—"}`,
    `Horizon: ${preview.timeHorizon || "—"}`,
    `Bull case items: ${(preview.bullCase || []).length}`,
    `Bear case items: ${(preview.bearCase || []).length}`,
    `Evidence for: ${(preview.evidenceFor || []).length}`,
    `Evidence against: ${(preview.evidenceAgainst || []).length}`,
    `Watch triggers: ${(preview.watchTriggers || []).length}`,
    "",
    "Accept this upgrade? Existing thesis text stays preserved."
  ];
  const ok = await openAppConfirm({
    title: "Upgrade thesis structure?",
    lines
  });
  if (!ok) return;
  const accepted = await fetchJson(`/api/theses/${encodeURIComponent(thesisState.savedThesisId)}/accept-upgrade`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data)
  });
  const upgraded = accepted?.thesis || null;
  if (upgraded) {
    thesisHydrateIntakeFromSaved(upgraded);
    thesisState.savedOutcome = upgraded.outcome || thesisState.savedOutcome;
    thesisState.normalizedThesis = normalizeThesisClient(upgraded);
    thesisRenderResult();
    alert("Thesis upgraded.");
  }
}

function setupThesisLab() {
  document.querySelectorAll("[data-thesis-outer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-thesis-outer]").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".thesis-pane").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const pane = document.getElementById("thesis-pane-" + btn.dataset.thesisOuter);
      if (pane) pane.classList.add("active");
      if (btn.dataset.thesisOuter === "map") {
        setTimeout(thesisDrawMap, 60);
        thesisBuildTimeline();
        if (thesisCurrentMapSymbol()) void thesisLoadRelationshipMap();
      }
      thesisSyncEmptyGuide();
    });
  });

  document.querySelectorAll("[data-map-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-map-tab]").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".thesis-map-pane").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const pane = document.getElementById("thesis-map-" + btn.dataset.mapTab);
      if (pane) pane.classList.add("active");
      if (btn.dataset.mapTab === "graph") setTimeout(thesisDrawMap, 60);
      if (btn.dataset.mapTab === "timeline") thesisBuildTimeline();
    });
  });

  document.querySelectorAll(".thesis-filter-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".thesis-filter-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      thesisMapFilter = pill.dataset.fp;
      thesisDrawMap();
    });
  });

  const tickerInput = document.getElementById("t-ticker");
  if (tickerInput) {
    tickerInput.addEventListener("input", function () {
      this.value = this.value.toUpperCase().replace(/[^A-Z]/g, "");
      thesisState.ticker = this.value;
      thesisCheckStep0();
    });
  }

  document.querySelectorAll(".thesis-dir-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".thesis-dir-btn").forEach((b) => {
        b.classList.remove("active-bull", "active-bear", "active-watch");
      });
      const dir = btn.dataset.dir;
      btn.classList.add("active-" + dir);
      thesisState.dir = dir;
      thesisCheckStep0();
    });
  });

  const thesisArea = document.getElementById("t-thesis");
  if (thesisArea) {
    thesisArea.addEventListener("input", function () {
      thesisState.thesis = this.value;
      const n = this.value.length;
      const counter = document.getElementById("t-char-count");
      if (counter) counter.textContent = String(n);
      const nextBtn = document.getElementById("t-next-1");
      if (nextBtn) nextBtn.disabled = n < 30;
    });
  }

  document.querySelectorAll(".thesis-exit-opt").forEach((opt) => {
    opt.addEventListener("click", () => {
      opt.classList.toggle("selected");
      const c = opt.dataset.cat;
      if (thesisState.cats.has(c)) thesisState.cats.delete(c);
      else thesisState.cats.add(c);
      const nextBtn = document.getElementById("t-next-2");
      if (nextBtn) nextBtn.disabled = thesisState.cats.size === 0;
    });
  });

  ["t-entry", "t-target", "t-stop"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", thesisUpdateRR);
  });

  void thesisLoadTracked();
  thesisApplyMapContext();

  const intakeTicker = document.getElementById("tc-ticker");
  const intakeDirection = document.getElementById("tc-direction");
  const intakeHorizon = document.getElementById("tc-horizon");
  const intakeThesis = document.getElementById("tc-thesis");
  const intakeEntry = document.getElementById("tc-entry");
  const intakeTarget = document.getElementById("tc-target");
  const intakeStop = document.getElementById("tc-stop");
  const applyIntakeToState = () => {
    thesisState.ticker = String(intakeTicker?.value || "").toUpperCase().replace(/[^A-Z]/g, "");
    const selectedDirection = String(intakeDirection?.value || "unclear");
    thesisState.dir = selectedDirection === "unclear" ? "watch" : selectedDirection;
    thesisState.timeHorizon = String(intakeHorizon?.value || "unspecified");
    thesisState.thesis = String(intakeThesis?.value || "");
    thesisState.entry = Number(intakeEntry?.value) || 0;
    thesisState.target = Number(intakeTarget?.value) || 0;
    thesisState.stop = Number(intakeStop?.value) || 0;
    if (tickerInput) tickerInput.value = thesisState.ticker;
    if (thesisArea) thesisArea.value = thesisState.thesis;
    if (document.getElementById("t-entry")) document.getElementById("t-entry").value = thesisState.entry || "";
    if (document.getElementById("t-target")) document.getElementById("t-target").value = thesisState.target || "";
    if (document.getElementById("t-stop")) document.getElementById("t-stop").value = thesisState.stop || "";
  };
  [intakeTicker, intakeDirection, intakeHorizon, intakeThesis, intakeEntry, intakeTarget, intakeStop].forEach((el) => {
    if (!el) return;
    el.addEventListener("input", () => {
      applyIntakeToState();
      thesisRenderCommandSummary();
    });
    el.addEventListener("change", () => {
      applyIntakeToState();
      thesisRenderCommandSummary();
    });
  });
  thesisSyncIntakeState({ renderSummary: true });
  const generateBtn = document.getElementById("tc-generate-btn");
  if (generateBtn) {
    generateBtn.addEventListener("click", () => {
      applyIntakeToState();
      thesisBuild();
    });
  }
  const saveBtn = document.getElementById("tc-save-btn");
  if (saveBtn) saveBtn.addEventListener("click", () => void thesisTrackInPaper());
  const paperBtn = document.getElementById("tc-paper-btn");
  if (paperBtn) paperBtn.addEventListener("click", () => void thesisTrackInPaper());
  const upgradeBtn = document.getElementById("tc-upgrade-ai-btn");
  if (upgradeBtn) {
    upgradeBtn.addEventListener("click", async () => {
      try {
        await thesisRequestUpgradePreview();
      } catch (err) {
        alert(err.message || "Upgrade preview failed.");
      }
    });
  }
  const keepBtn = document.getElementById("tc-upgrade-keep-btn");
  if (keepBtn) {
    keepBtn.addEventListener("click", () => {
      const banner = document.getElementById("tc-upgrade-banner");
      if (banner) banner.hidden = true;
    });
  }
  const editBtn = document.getElementById("tc-upgrade-edit-btn");
  if (editBtn) {
    editBtn.addEventListener("click", () => {
      const thesisInput = document.getElementById("tc-thesis");
      if (thesisInput) thesisInput.focus();
    });
  }
}

function thesisCheckStep0() {
  const btn = document.getElementById("t-next-0");
  if (btn) btn.disabled = !thesisState.ticker || !thesisState.dir;
}

function thesisUpdateRR() {
  const e = parseFloat(document.getElementById("t-entry")?.value) || 0;
  const t = parseFloat(document.getElementById("t-target")?.value) || 0;
  const s = parseFloat(document.getElementById("t-stop")?.value) || 0;
  thesisState.entry = e;
  thesisState.target = t;
  thesisState.stop = s;
  const bar = document.getElementById("t-rr-bar");
  if (!bar) return;
  if (e > 0 && t > 0 && s > 0 && e > s) {
    bar.hidden = false;
    const rr = (t - e) / (e - s);
    const valEl = document.getElementById("t-rr-val");
    if (valEl) valEl.textContent = rr.toFixed(1) + "x";
  } else {
    bar.hidden = true;
  }
}

function thesisGoTo(n) {
  for (let i = 0; i < 4; i++) {
    const screen = document.getElementById("tscreen-" + i);
    if (screen) screen.classList.toggle("active", i === n);
    const pip = document.getElementById("tpip-" + i);
    if (pip) {
      pip.classList.remove("active", "done");
      if (i < n) pip.classList.add("done");
      else if (i === n) pip.classList.add("active");
    }
  }
  const result = document.getElementById("tscreen-result");
  if (result) result.classList.remove("active");
}

function thesisBuild() {
  for (let i = 0; i < 4; i++) {
    const screen = document.getElementById("tscreen-" + i);
    if (screen) screen.classList.remove("active");
    const pip = document.getElementById("tpip-" + i);
    if (pip) {
      pip.classList.remove("active");
      pip.classList.add("done");
    }
  }
  const result = document.getElementById("tscreen-result");
  if (result) result.classList.add("active");
  thesisState.built = true;
  thesisEnsureResultPanelVisibility();
  thesisUpdateQuoteTrustUi();
  thesisRenderResult();
  void thesisRefreshSavedOutcome();
  void thesisFetchSignals().then(() => {
    thesisStartMonitorRefresh();
    thesisBuildTimeline();
  });
  thesisApplyMapContext();
  thesisViewMap({ toast: true, firstVisit: true });
  thesisRenderCommandSummary();
}

function thesisViewMap(options = {}) {
  document.querySelectorAll("[data-thesis-outer]").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".thesis-pane").forEach((p) => p.classList.remove("active"));
  const mapBtn = document.querySelector('[data-thesis-outer="map"]');
  if (mapBtn) mapBtn.classList.add("active");
  const mapPane = document.getElementById("thesis-pane-map");
  if (mapPane) mapPane.classList.add("active");
  document.querySelectorAll("[data-map-tab]").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".thesis-map-pane").forEach((p) => p.classList.remove("active"));
  const graphTab = document.querySelector('[data-map-tab="graph"]');
  if (graphTab) graphTab.classList.add("active");
  const graphPane = document.getElementById("thesis-map-graph");
  if (graphPane) graphPane.classList.add("active");
  if (options.toast) thesisMapToast("Explore how your thesis connects");
  if (options.firstVisit) thesisMaybeShowMapHint();
  setTimeout(thesisDrawMap, 60);
  if (!options.skipReload) void thesisLoadRelationshipMap();
}

function thesisReset() {
  thesisState.ticker = "";
  thesisState.dir = "";
  thesisState.thesis = "";
  thesisState.cats = new Set();
  thesisState.entry = 0;
  thesisState.target = 0;
  thesisState.stop = 0;
  thesisState.built = false;
  thesisState.savedThesisId = null;
  thesisState.savedOutcome = null;
  thesisState.signalsPayload = null;
  thesisStopMonitorRefresh();
  state.pendingThesisId = null;
  const liveSection = document.getElementById("tr-live-outcome-section");
  if (liveSection) liveSection.hidden = true;
  const tickerInput = document.getElementById("t-ticker");
  if (tickerInput) tickerInput.value = "";
  const thesisArea = document.getElementById("t-thesis");
  if (thesisArea) thesisArea.value = "";
  const counter = document.getElementById("t-char-count");
  if (counter) counter.textContent = "0";
  document.querySelectorAll(".thesis-dir-btn").forEach((b) => b.classList.remove("active-bull", "active-bear", "active-watch"));
  document.querySelectorAll(".thesis-exit-opt").forEach((b) => b.classList.remove("selected"));
  ["t-entry", "t-target", "t-stop"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const rrBar = document.getElementById("t-rr-bar");
  if (rrBar) rrBar.hidden = true;
  document.getElementById("t-next-0").disabled = true;
  document.getElementById("t-next-1").disabled = true;
  document.getElementById("t-next-2").disabled = true;
  thesisGoTo(0);
}

function thesisRenderResult() {
  const t = thesisState;
  const ticker = t.ticker || "TICKER";
  const tickerEl = document.getElementById("tr-ticker");
  if (tickerEl) tickerEl.textContent = ticker;
  const dirPill = document.getElementById("tr-dir-pill");
  if (dirPill) {
    dirPill.className = "thesis-result-dir-pill";
    if (t.dir === "bull") {
      dirPill.textContent = "Long";
      dirPill.classList.add("pill-bull");
    } else if (t.dir === "bear") {
      dirPill.textContent = "Short / avoid";
      dirPill.classList.add("pill-bear");
    } else {
      dirPill.textContent = "Watching";
      dirPill.classList.add("pill-watch");
    }
  }
  const thesisEl = document.getElementById("tr-thesis-text");
  if (thesisEl) thesisEl.textContent = t.thesis || "No thesis written.";
  const hasExit = t.entry > 0 && t.target > 0 && t.stop > 0;
  const divider = document.getElementById("tr-exit-divider");
  const exitInfo = document.getElementById("tr-exit-info");
  const exitNote = document.getElementById("tr-exit-rr-note");
  if (hasExit && divider && exitInfo) {
    divider.hidden = false;
    exitInfo.hidden = false;
    if (exitNote) exitNote.hidden = false;
    const rr = ((t.target - t.entry) / (t.entry - t.stop)).toFixed(1);
    exitInfo.textContent = `Entry $${t.entry.toFixed(2)} · Target $${t.target.toFixed(2)} · Stop $${t.stop.toFixed(2)} · Plan R/R ${rr}x`;
  } else {
    if (divider) divider.hidden = true;
    if (exitInfo) exitInfo.hidden = true;
    if (exitNote) exitNote.hidden = true;
  }
  thesisUpdateQuoteTrustUi();

  const payload = t.signalsPayload;
  const signals = payload?.signals || [];
  thesisRenderClaims(payload?.claims || [{ text: t.thesis, evidence: [] }]);
  thesisRenderSignalCards(signals);

  const bands = thesisScenarioBands(t);
  const scHint = document.getElementById("tr-scenario-hint");
  if (scHint) {
    scHint.textContent = bands.computed
      ? "From your entry / target / stop plan — illustrative bands, not forecasts."
      : "Illustrative ranges — not forecasts or expected returns.";
  }
  const scRow = document.getElementById("tr-scenarios");
  if (scRow) {
    const note = bands.computed ? `<div class="thesis-sc-note">From your entry/target/stop plan</div>` : "";
    scRow.innerHTML = `
<div class="thesis-sc-card thesis-sc-bull">
<span class="thesis-sc-label">Best case</span>
<div class="thesis-sc-num">${escapeHtml(bands.best)}</div>
<div class="thesis-sc-desc">Plan plays out — catalysts align with your story.</div>
${note}
</div>
<div class="thesis-sc-card thesis-sc-base">
<span class="thesis-sc-label">Base case</span>
<div class="thesis-sc-num">${escapeHtml(bands.base)}</div>
<div class="thesis-sc-desc">Partial confirmation — some checkpoints fire, others slip.</div>
</div>
<div class="thesis-sc-card thesis-sc-bear">
<span class="thesis-sc-label">If wrong</span>
<div class="thesis-sc-num">${escapeHtml(bands.bear)}</div>
<div class="thesis-sc-desc">Exit rule fires${t.cats.size > 0 ? ` — ${t.cats.size} scenario${t.cats.size > 1 ? "s" : ""} defined` : ""}.</div>
</div>`;
  }

  const catLabels = {
    bill: "Bill or legislation fails",
    earnings: "Earnings miss",
    contract: "Contract cut or cancelled",
    competitor: "Competitor gains ground",
    macro: "Macro shift"
  };
  const exitMonitors = [...t.cats].map((c) => ({
    text: catLabels[c],
    src: "Your exit plan",
    status: "Watch",
    nextCheck: "When headline matches your exit rule",
    why: "You defined this as a reason to reconsider the plan."
  }));
  const apiMonitors = payload?.monitors || [];
  const mergedMonitors = apiMonitors.length ? apiMonitors : [...exitMonitors];
  thesisRenderMonitors(mergedMonitors.slice(0, 8));

  const thesisLower = t.thesis.toLowerCase();
  const hasBill = thesisLower.match(/bill|act|congress|chips|policy/) || t.cats.has("bill");
  const hasContract = thesisLower.match(/contract|government|federal/) || t.cats.has("contract");
  const hasLobby = thesisLower.match(/lobby|pressure/);
  let score = 0;
  const bars = [];
  const ts = Math.min(35, Math.round((Math.min(t.thesis.length, 350) / 350) * 35));
  score += ts;
  bars.push({
    label: "How specific your idea is",
    val: ts,
    max: 35,
    cls: ts >= 25 ? "fill-g" : ts >= 15 ? "fill-a" : "fill-r"
  });
  const cs = Math.min(25, t.cats.size * 8);
  score += cs;
  bars.push({
    label: "Exit conditions defined",
    val: cs,
    max: 25,
    cls: cs >= 16 ? "fill-g" : cs > 0 ? "fill-a" : "fill-r"
  });
  const ps = hasExit ? 25 : t.entry > 0 ? 10 : 0;
  score += ps;
  bars.push({
    label: "Price plan set",
    val: ps,
    max: 25,
    cls: ps >= 20 ? "fill-g" : ps > 0 ? "fill-a" : "fill-r"
  });
  const ss = Math.min(15, (hasBill ? 5 : 0) + (hasContract ? 5 : 0) + (hasLobby ? 5 : 0) + (signals.length >= 3 ? 5 : 3));
  score += ss;
  bars.push({
    label: "Evidence & signal coverage",
    val: ss,
    max: 15,
    cls: ss >= 10 ? "fill-g" : "fill-a"
  });
  score = Math.min(100, score);
  const scoreEl = document.getElementById("tr-score");
  if (scoreEl) {
    scoreEl.textContent = String(score);
    scoreEl.className = "thesis-score-num " + (score >= 70 ? "score-g" : score >= 45 ? "score-a" : "score-r");
  }
  const verdictEl = document.getElementById("tr-verdict");
  if (verdictEl) {
    verdictEl.textContent =
      score >= 70
        ? "Well-structured plan — specific, falsifiable checkpoints, and priced exits."
        : score >= 45
          ? "Developing plan — add detail, evidence keywords, or exit prices."
          : "Starting point — spell out drivers and at least one exit condition.";
  }
  const convBars = document.getElementById("tr-conv-bars");
  if (convBars) {
    convBars.innerHTML = bars
      .map(
        (b) => `
<div class="thesis-conv-row">
<span class="thesis-conv-label">${escapeHtml(b.label)}</span>
<div class="thesis-conv-track"><div class="thesis-conv-fill ${b.cls}" style="width:${Math.round((b.val / b.max) * 100)}%"></div></div>
<span class="thesis-conv-score">${b.val}/${b.max}</span>
</div>`
      )
      .join("");
  }
  thesisRenderStickyRail(t, payload || {});
  thesisRenderCommandSummary();
  thesisRenderLiveOutcome();
  thesisBuildTimeline();
}

function thesisPolicySnapshotForTicker(ticker) {
  const sym = String(ticker || "").toUpperCase();
  if (state.analysis?.symbol === sym) {
    const policyRow = (state.analysis.charts?.riskRadar || []).find((row) => row.label === "Policy Exposure");
    return {
      policyExposure: Number(policyRow?.value) || null,
      capturedAt: new Date().toISOString(),
      symbol: sym
    };
  }
  return { capturedAt: new Date().toISOString(), symbol: sym };
}

function thesisSideFromDirection(dir) {
  if (dir === "bear") return "sell";
  return "buy";
}

async function thesisLoadTracked() {
  try {
    const data = await fetchJson("/api/theses");
    state.thesisRecords = data.theses || [];
    const match = state.thesisRecords.find(
      (row) =>
        row.status === "open" &&
        row.ticker === thesisState.ticker &&
        row.direction === thesisState.dir &&
        row.thesisText === thesisState.thesis
    );
    if (match) {
      thesisState.savedThesisId = match.id;
      thesisState.savedOutcome = match.outcome || null;
      thesisHydrateIntakeFromSaved(match);
      if (thesisState.built) thesisRenderLiveOutcome();
    }
  } catch {
    /* keep local thesis UI usable offline */
  }
}

async function thesisRefreshSavedOutcome() {
  if (!thesisState.savedThesisId) return;
  try {
    const data = await fetchJson("/api/theses");
    state.thesisRecords = data.theses || [];
    const row = state.thesisRecords.find((item) => item.id === thesisState.savedThesisId);
    if (row) {
      thesisState.savedOutcome = row.outcome || null;
      if (thesisState.built) thesisRenderLiveOutcome();
    }
  } catch {
    /* ignore */
  }
}

async function thesisTrackInPaper() {
  const t = thesisState;
  if (!t.built || !t.ticker || !t.dir || !t.thesis) return;
  if (thesisQuoteIsFallback()) {
    alert("Live market data required. Your quote feed is on fallback prices — connect Finnhub or Yahoo live quotes before tracking this plan.");
    thesisUpdateQuoteTrustUi();
    return;
  }
  const btn = document.getElementById("tr-track-paper");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
  }
  try {
    const response = await fetchJson("/api/theses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticker: t.ticker,
        direction: t.dir,
        timeHorizon: t.timeHorizon || "unspecified",
        schemaVersion: 2,
        thesisText: t.thesis,
        exitCats: [...t.cats],
        entry: t.entry,
        target: t.target,
        stop: t.stop,
        snapshotAtCreate: thesisPolicySnapshotForTicker(t.ticker)
      })
    });
    const saved = response.thesis;
    thesisState.savedThesisId = saved.id;
    thesisState.savedOutcome = saved.outcome || null;
    state.pendingThesisId = saved.id;
    thesisRenderLiveOutcome();
    const qty = 1;
    const side = thesisSideFromDirection(t.dir);
    openTradeForSymbol(t.ticker, {
      side,
      qty,
      thesisNote: `Thesis saved for ${t.ticker}. Review the order below — paper fill only, not financial advice.`
    });
    thesisViewMap({ toast: true, skipReload: true });
    void thesisLoadRelationshipMap();
  } catch (error) {
    const msg = error.message || "Could not save thesis.";
    alert(`Could not track thesis in paper account: ${msg}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Track in paper account";
    }
  }
}

function thesisRenderLiveOutcome() {
  const section = document.getElementById("tr-live-outcome-section");
  const host = document.getElementById("tr-live-outcome");
  if (!section || !host) return;
  const outcome = thesisState.savedOutcome;
  if (!thesisState.savedThesisId || !outcome) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const rows = [];
  if (outcome.currentPrice != null) {
    rows.push(["Last price", money(outcome.currentPrice)]);
  }
  if (outcome.pctFromEntry != null && thesisState.entry > 0) {
    const cls = outcome.pctFromEntry >= 0 ? "pos" : "neg";
    rows.push(["Vs entry", `<strong class="${cls}">${outcome.pctFromEntry >= 0 ? "+" : ""}${outcome.pctFromEntry.toFixed(2)}%</strong>`]);
  }
  if (outcome.distanceToTargetPct != null && thesisState.target > 0) {
    rows.push([
      "Room to target",
      `<strong>${outcome.distanceToTargetPct >= 0 ? outcome.distanceToTargetPct.toFixed(2) : "0.00"}%</strong>${outcome.nearTarget ? " · at target" : ""}`
    ]);
  }
  if (outcome.distanceToStopPct != null && thesisState.stop > 0) {
    const stopLabel = thesisState.dir === "bear" ? "Cushion below stop" : "Cushion above stop";
    rows.push([
      stopLabel,
      `<strong>${outcome.distanceToStopPct >= 0 ? outcome.distanceToStopPct.toFixed(2) : "0.00"}%</strong>${outcome.nearStop ? " · at stop" : ""}`
    ]);
  }
  if (outcome.position) {
    const pnl = outcome.position.unrealizedPnl;
    const cls = pnl >= 0 ? "pos" : "neg";
    const pct =
      outcome.position.unrealizedPnlPct != null
        ? ` (${outcome.position.unrealizedPnlPct >= 0 ? "+" : ""}${outcome.position.unrealizedPnlPct}%)`
        : "";
    rows.push(["Paper P/L", `<strong class="${cls}">${money(pnl)}${pct}</strong>`]);
  } else if (outcome.linkedOrderId) {
    rows.push(["Paper position", "<span>No open position — order linked</span>"]);
  } else {
    rows.push(["Paper position", "<span>No position yet — place a paper order on Account</span>"]);
  }
  if (outcome.daysSince != null) {
    rows.push(["Days tracked", `<strong>${outcome.daysSince}</strong>`]);
  }
  if (outcome.policyDelta != null) {
    const cls = outcome.policyDelta > 0 ? "neg" : outcome.policyDelta < 0 ? "pos" : "";
    rows.push([
      "Policy heat Δ",
      `<strong class="${cls}">${outcome.policyDelta > 0 ? "+" : ""}${outcome.policyDelta} pts</strong>`
    ]);
  }
  host.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="thesis-live-row"><span>${escapeHtml(label)}</span><span>${value}</span></div>`
    )
    .join("");
}

let thesisMapFilter = "all";
let thesisHoveredNode = null;
let thesisMapNodesActive = [];
let thesisMapEdgesActive = [];
let thesisMapNewNodeIds = new Set();
let thesisMapNewEdgeIds = new Set();
let thesisMapPulseT = 0;
let thesisMapPulseRaf = null;
let thesisMapLoadFailed = false;
let thesisMapEditMode = false;
let thesisMapDragNode = null;
let thesisMapDragMoved = false;
let thesisMapPanState = null;
const thesisMapViewport = { scale: 1, x: 0, y: 0 };
const THESIS_MAP_MIN_ZOOM = 0.55;
const THESIS_MAP_MAX_ZOOM = 3.2;

const THESIS_MAP_HINT_KEY = "ts_map_hint_seen";

function thesisMapSeenKey(sym) {
  return `ts_map_seen_${sym}`;
}

function thesisMapLayoutKey(sym) {
  return `ts_map_layout_${String(sym || "").toUpperCase()}`;
}

function thesisUrlSymbol() {
  try {
    return String(new URLSearchParams(window.location.search).get("symbol") || "")
      .toUpperCase()
      .replace(/[^A-Z.]/g, "");
  } catch (_) {
    return "";
  }
}

function thesisCurrentMapSymbol() {
  return String(thesisState.ticker || state.activeAnalysisSymbol || state.tradeSymbol || thesisUrlSymbol() || "")
    .toUpperCase()
    .replace(/[^A-Z.]/g, "");
}

function thesisPrimeTicker(symbol) {
  const sym = String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z.]/g, "");
  if (!sym) return "";
  thesisState.ticker = sym;
  const intakeTicker = document.getElementById("tc-ticker");
  const tickerInput = document.getElementById("t-ticker");
  if (intakeTicker && !intakeTicker.value) intakeTicker.value = sym;
  if (tickerInput && !tickerInput.value) tickerInput.value = sym;
  thesisUpdateIntakePreview();
  thesisRenderCommandSummary();
  thesisEnsureResultPanelVisibility();
  return sym;
}

function thesisLoadLayoutOverrides(sym) {
  try {
    return JSON.parse(localStorage.getItem(thesisMapLayoutKey(sym)) || "{}");
  } catch (_) {
    return {};
  }
}

function thesisSaveLayoutOverrides(sym, overrides) {
  try {
    localStorage.setItem(thesisMapLayoutKey(sym), JSON.stringify(overrides));
  } catch (_) {}
}

function thesisApplyLayoutOverrides() {
  const sym = thesisCurrentMapSymbol();
  const overrides = thesisLoadLayoutOverrides(sym);
  thesisMapNodesActive.forEach((n) => {
    const o = overrides[n.id];
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) {
      n.x = o.x;
      n.y = o.y;
    }
  });
}

function thesisNodePageLink(n) {
  if (!n) return null;
  const sym = thesisCurrentMapSymbol();
  if (n.cat === "stock") return `/stock/${encodeURIComponent(sym || n.label)}`;
  if (n.cat === "bill" && String(n.id).startsWith("bill_")) {
    return billPageUrl({ id: n.id.slice(5) });
  }
  if (n.cat === "contract") return contractPageUrl(sym || n.label);
  if (n.url) return n.url;
  return null;
}

function thesisMapToast(message) {
  const el = document.getElementById("thesis-map-toast");
  if (!el || !message) return;
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(thesisMapToast._timer);
  thesisMapToast._timer = window.setTimeout(() => {
    el.hidden = true;
  }, 4200);
}

function thesisApplyMapContext() {
  thesisBindMapCanvas();
  const retry = document.getElementById("thesis-map-retry");
  if (retry && retry.dataset.bound !== "true") {
    retry.dataset.bound = "true";
    retry.addEventListener("click", () => void thesisLoadRelationshipMap());
  }
  thesisUpdateMapChrome();
}

function thesisUpdateMapChrome(payload) {
  const sym = thesisCurrentMapSymbol();
  const heading = document.getElementById("thesis-map-heading");
  const meta = document.getElementById("thesis-map-meta");
  if (heading) heading.textContent = sym ? `How ${sym} connects` : "How this thesis connects";
  if (meta) {
    const count = payload?.connectionCount ?? thesisMapEdgesActive.length;
    meta.textContent = count ? `${count} connection${count === 1 ? "" : "s"}` : "";
  }
  const legend = document.getElementById("thesis-map-new-legend");
  if (legend && payload) {
    const hasNew = (payload.newNodeIds || []).length > 0;
    legend.hidden = !hasNew;
    const label =
      payload.highlightMode === "since_visit"
        ? "Highlighted = new since last visit"
        : "Highlighted = new in last 24h";
    legend.innerHTML = `<span class="thesis-leg-ring" aria-hidden="true"></span>${label}`;
  }
}

function thesisUpdateFilterCounts(counts) {
  const labels = {
    all: "All",
    bill: "Bills",
    lobby: "Lobby",
    contract: "Contracts",
    figure: "Figures",
    market: "Market"
  };
  document.querySelectorAll(".thesis-filter-pill").forEach((pill) => {
    const fp = pill.dataset.fp;
    const n = counts?.[fp] ?? 0;
    pill.textContent = `${labels[fp] || fp} (${n})`;
  });
}

function thesisSetMapEmpty(show, message) {
  const empty = document.getElementById("thesis-map-empty");
  const canvas = document.getElementById("thesisMapCanvas");
  const msg = document.getElementById("thesis-map-empty-msg");
  thesisMapLoadFailed = show;
  if (empty) empty.hidden = !show;
  if (canvas) canvas.style.opacity = show ? "0.35" : "1";
  if (msg && message) msg.textContent = message;
}

function thesisMaybeShowMapHint() {
  if (localStorage.getItem(THESIS_MAP_HINT_KEY)) return;
  const el = document.getElementById("thesis-map-hint");
  if (el) el.hidden = false;
  localStorage.setItem(THESIS_MAP_HINT_KEY, "1");
}

function thesisMapHasNewHighlights() {
  return thesisMapNewNodeIds.size > 0 || thesisMapNewEdgeIds.size > 0;
}

function thesisStartMapPulse() {
  if (thesisMapPulseRaf || !thesisMapHasNewHighlights()) return;
  const tick = () => {
    thesisMapPulseT += 0.05;
    thesisDrawMap();
    if (thesisMapHasNewHighlights()) thesisMapPulseRaf = requestAnimationFrame(tick);
    else {
      thesisMapPulseRaf = null;
      thesisMapPulseT = 0;
    }
  };
  thesisMapPulseRaf = requestAnimationFrame(tick);
}

function thesisStopMapPulse() {
  if (thesisMapPulseRaf) cancelAnimationFrame(thesisMapPulseRaf);
  thesisMapPulseRaf = null;
  thesisMapPulseT = 0;
}

async function thesisLoadRelationshipMap() {
  if (!isFeatureEnabled("RELATIONSHIP_MAPS_ENABLED")) {
    thesisMapNodesActive = [];
    thesisMapEdgesActive = [];
    thesisMapNewNodeIds = new Set();
    thesisMapNewEdgeIds = new Set();
    thesisSetMapEmpty(true, "Relationship maps are not available in this beta.");
    thesisDrawMap();
    return;
  }
  const sym = thesisPrimeTicker(thesisCurrentMapSymbol());
  if (!sym) {
    thesisMapNodesActive = [];
    thesisMapEdgesActive = [];
    thesisMapNewNodeIds = new Set();
    thesisMapNewEdgeIds = new Set();
    thesisSetMapEmpty(false);
    thesisDrawMap();
    return;
  }
  thesisSetMapEmpty(false);
  const params = new URLSearchParams({ symbol: sym });
  const seen = localStorage.getItem(thesisMapSeenKey(sym));
  if (seen) params.set("since", seen);
  try {
    const data = await fetchJson(`/api/relationship-map?${params}`);
    state.relationshipMapPayload = data;
    thesisApplyRelationshipMap(data);
    thesisMapNewNodeIds = new Set(data.newNodeIds || []);
    thesisMapNewEdgeIds = new Set(data.newEdgeIds || []);
    thesisUpdateMapChrome(data);
    if (data.filterCounts) thesisUpdateFilterCounts(data.filterCounts);
    localStorage.setItem(thesisMapSeenKey(sym), new Date().toISOString());
    thesisStartMapPulse();
  } catch {
    state.relationshipMapPayload = null;
    thesisMapNodesActive = [];
    thesisMapEdgesActive = [];
    thesisMapNewNodeIds = new Set();
    thesisMapNewEdgeIds = new Set();
    thesisStopMapPulse();
    thesisSetMapEmpty(true, "Could not load the relationship map. Check your connection and try again.");
  }
  thesisDrawMap();
}

function thesisApplyRelationshipMap(data) {
  if (!data?.nodes?.length) {
    thesisMapNodesActive = [];
    thesisMapEdgesActive = [];
    return;
  }
  const refs = data.evidenceRefs || {};
  const fitCoord = (value) => Math.max(0.08, Math.min(0.92, Number(value) || 0.5));
  thesisMapNodesActive = data.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    sub: n.sub || "",
    cat: n.cat,
    x: fitCoord(n.x),
    y: fitCoord(n.y),
    r: n.r || 16,
    color: n.color || "#888",
    desc: n.detail || n.desc || "",
    detail: n.detail || n.desc || "",
    path: n.path || "",
    source: n.source || "",
    url: n.url || null,
    evidence: n.evidence || refs[n.id] || []
  }));
  thesisMapEdgesActive = (data.edges || []).map((e) => ({ ...e }));
  thesisApplyLayoutOverrides();
}

function thesisMapNodes() {
  return thesisMapNodesActive;
}

function thesisMapEdges() {
  return thesisMapEdgesActive;
}

function thesisNodeVisible(n) {
  if (thesisMapFilter === "all") return true;
  if (n.id === "stock") return true;
  return n.cat === thesisMapFilter;
}

function thesisMapShell() {
  return document.querySelector(".thesis-map-shell");
}

function thesisMapIsFullscreen() {
  return thesisMapShell()?.classList.contains("map-fullscreen") || false;
}

function thesisMapHeight(wrap) {
  if (thesisMapIsFullscreen()) return Math.max(520, Math.round(wrap.clientHeight || window.innerHeight * 0.58));
  return 420;
}

function thesisClampMapViewport(W, H) {
  const scale = Math.max(THESIS_MAP_MIN_ZOOM, Math.min(THESIS_MAP_MAX_ZOOM, thesisMapViewport.scale || 1));
  thesisMapViewport.scale = scale;
  if (scale <= 1) {
    thesisMapViewport.x = (W - W * scale) / 2;
    thesisMapViewport.y = (H - H * scale) / 2;
    return;
  }
  const pad = thesisMapIsFullscreen() ? 120 : 60;
  const minX = W - W * scale - pad;
  const minY = H - H * scale - pad;
  thesisMapViewport.x = Math.max(minX, Math.min(pad, thesisMapViewport.x));
  thesisMapViewport.y = Math.max(minY, Math.min(pad, thesisMapViewport.y));
}

function thesisResetMapViewport({ draw = true } = {}) {
  thesisMapViewport.scale = 1;
  thesisMapViewport.x = 0;
  thesisMapViewport.y = 0;
  if (draw) thesisDrawMap();
}

function thesisZoomMap(multiplier, focusX, focusY) {
  const canvas = document.getElementById("thesisMapCanvas");
  if (!canvas) return;
  const W = canvas.width || canvas.getBoundingClientRect().width || 640;
  const H = canvas.height || thesisMapHeight(canvas.parentElement);
  const oldScale = thesisMapViewport.scale || 1;
  const nextScale = Math.max(THESIS_MAP_MIN_ZOOM, Math.min(THESIS_MAP_MAX_ZOOM, oldScale * multiplier));
  const fx = Number.isFinite(focusX) ? focusX : W / 2;
  const fy = Number.isFinite(focusY) ? focusY : H / 2;
  const mapX = (fx - thesisMapViewport.x) / oldScale;
  const mapY = (fy - thesisMapViewport.y) / oldScale;
  thesisMapViewport.scale = nextScale;
  thesisMapViewport.x = fx - mapX * nextScale;
  thesisMapViewport.y = fy - mapY * nextScale;
  thesisClampMapViewport(W, H);
  thesisDrawMap();
}

function thesisToggleMapFullscreen(force) {
  const shell = thesisMapShell();
  if (!shell) return;
  const next = typeof force === "boolean" ? force : !thesisMapIsFullscreen();
  shell.classList.toggle("map-fullscreen", next);
  document.body.classList.toggle("thesis-map-fullscreen-open", next);
  const btn = document.getElementById("thesis-map-fullscreen");
  if (btn) {
    btn.setAttribute("aria-pressed", String(next));
    btn.textContent = next ? "Exit full screen" : "Full screen";
  }
  const hint = document.getElementById("thesis-map-hint");
  if (hint) {
    hint.hidden = false;
    hint.textContent = next
      ? "Drag the map to pan - scroll or use +/- to zoom - Esc exits full screen"
      : "Drag the map to pan - scroll to zoom - click any node for evidence";
  }
  setTimeout(thesisDrawMap, 60);
}

function thesisDrawMap() {
  const canvas = document.getElementById("thesisMapCanvas");
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const W = wrap.clientWidth || 640;
  const H = thesisMapHeight(wrap);
  canvas.width = W;
  canvas.height = H;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  thesisClampMapViewport(W, H);
  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  const gridLine = isDark ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.03)";
  const textMuted = isDark ? "#555" : "#999";
  const edgePos = isDark ? "rgba(126,200,74,0.38)" : "rgba(80,150,40,0.4)";
  const edgeNeg = isDark ? "rgba(201,64,64,0.38)" : "rgba(180,50,50,0.4)";
  const edgeNeu = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.strokeStyle = gridLine;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.strokeStyle = gridLine;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  const nodes = thesisMapNodes();
  const edges = thesisMapEdges();
  const pulse = thesisMapHasNewHighlights() ? 0.5 + 0.5 * Math.sin(thesisMapPulseT * 4) : 0;
  if (!nodes.length) {
    ctx.fillStyle = textMuted;
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "center";
    if (thesisMapLoadFailed) {
      ctx.fillText("Map data unavailable — use Retry below.", W / 2, H / 2);
    } else {
      ctx.fillText("Loading connections…", W / 2, H / 2 - 8);
      ctx.fillText("Build a thesis with a ticker to explore the map.", W / 2, H / 2 + 14);
    }
    return;
  }
  const stockNode = nodes.find((n) => n.id === "stock");
  if (stockNode) stockNode.label = thesisCurrentMapSymbol() || "Stock";
  ctx.save();
  ctx.translate(thesisMapViewport.x, thesisMapViewport.y);
  ctx.scale(thesisMapViewport.scale, thesisMapViewport.scale);
  edges.forEach((e) => {
    const from = nodes.find((n) => n.id === e.from);
    const to = nodes.find((n) => n.id === e.to);
    if (!from || !to || !thesisNodeVisible(from) || !thesisNodeVisible(to)) return;
    const x1 = from.x * W,
      y1 = from.y * H,
      x2 = to.x * W,
      y2 = to.y * H;
    const isActive = thesisHoveredNode && (thesisHoveredNode.id === from.id || thesisHoveredNode.id === to.id);
    const edgeKey = e.id || `${e.from}__${e.to}`;
    const isNewEdge = thesisMapNewEdgeIds.has(edgeKey);
    const col = e.strength === "positive" ? edgePos : e.strength === "negative" ? edgeNeg : edgeNeu;
    const cx = (x1 + x2) / 2 + (y2 - y1) * 0.15,
      cy = (y1 + y2) / 2 - (x2 - x1) * 0.15;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
    if (isNewEdge) {
      ctx.strokeStyle = `rgba(234, 179, 8, ${0.55 + pulse * 0.35})`;
      ctx.lineWidth = (isActive ? 2 : 1) + 1.2 + pulse;
    } else {
      ctx.strokeStyle = col;
      ctx.lineWidth = isActive ? 2 : 1;
    }
    ctx.stroke();
    const tVal = 0.85,
      ex = (1 - tVal) * (1 - tVal) * x1 + 2 * (1 - tVal) * tVal * cx + tVal * tVal * x2,
      ey = (1 - tVal) * (1 - tVal) * y1 + 2 * (1 - tVal) * tVal * cy + tVal * tVal * y2;
    const dx = 2 * (1 - tVal) * (cx - x1) + 2 * tVal * (x2 - cx),
      dy = 2 * (1 - tVal) * (cy - y1) + 2 * tVal * (y2 - cy);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-8, -4);
    ctx.lineTo(-8, 4);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.restore();
    if (isActive) {
      ctx.font = "9px Geist Mono, monospace";
      ctx.fillStyle = textMuted;
      ctx.textAlign = "center";
      ctx.fillText(e.label, (x1 + x2) / 2 + (y2 - y1) * 0.08, (y1 + y2) / 2 - (x2 - x1) * 0.08);
    }
  });
  nodes.forEach((n) => {
    if (!thesisNodeVisible(n)) return;
    const x = n.x * W,
      y = n.y * H;
    const isHov = thesisHoveredNode && thesisHoveredNode.id === n.id;
    const r = isHov ? n.r + 4 : n.r;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? n.color + "20" : n.color + "15";
    ctx.fill();
    ctx.strokeStyle = n.color;
    ctx.lineWidth = isHov ? 2 : 1.5;
    ctx.stroke();
    if (thesisMapNewNodeIds.has(n.id)) {
      ctx.beginPath();
      ctx.arc(x, y, r + 5 + pulse * 2, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(234, 179, 8, ${0.5 + pulse * 0.45})`;
      ctx.lineWidth = 2 + pulse;
      ctx.stroke();
    }
    ctx.font = `500 ${r > 18 ? 11 : 10}px Geist Mono, monospace`;
    ctx.fillStyle = isDark ? "#e0e0e0" : "#1a1a1a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(n.label, x, y - 4);
    ctx.font = "9px IBM Plex Mono, monospace";
    ctx.fillStyle = textMuted;
    ctx.fillText(n.sub.split("·")[0].trim(), x, y + 7);
  });
  ctx.restore();
}

function thesisGetNodeAt(x, y, W, H) {
  const nodes = thesisMapNodes();
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!thesisNodeVisible(n)) continue;
    if (Math.sqrt((x - n.x * W) ** 2 + (y - n.y * H) ** 2) <= n.r + 6) return n;
  }
  return null;
}

function thesisShowNodeDetail(n) {
  const det = document.getElementById("thesisNodeDetail");
  if (!det) return;
  const catName = {
    bill: "Bill / legislation",
    lobby: "Lobbying signal",
    contract: "Federal contract",
    figure: "Figure / curated social",
    market: "Market signal",
    stock: "Your stock"
  }[n.cat];
  const evidenceItems = n.evidence || state.relationshipMapPayload?.evidenceRefs?.[n.id] || [];
  const primary = evidenceItems[0];
  const story = n.detail || n.desc || "";
  const sourceLabel = n.source || primary?.source || "";
  const sourceUrl = n.url || primary?.sourceUrl || null;
  const sourceLink = sourceUrl
    ? `<a class="thesis-node-source-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>`
    : "";
  const sourceRow = sourceLabel
    ? `<div class="thesis-node-source"><span>${escapeHtml(sourceLabel)}</span>${sourceLink}</div>`
    : "";
  const evidenceHtml = evidenceItems.length
    ? `<details class="thesis-claim-details" open>
<summary class="thesis-claim-head"><span class="thesis-claim-toggle">Evidence (${evidenceItems.length})</span></summary>
<div class="thesis-evidence-drawer">${renderEvidenceDrawerItems(evidenceItems)}<p class="thesis-section-hint">Research context only — modeled or seed sources are labeled in each row.</p></div>
</details>`
    : `<p class="thesis-section-hint">No evidence receipts mapped for this node yet.</p>`;
  const pageLink = thesisNodePageLink(n);
  const pageBtn = pageLink
    ? `<a class="link-button" href="${escapeHtml(pageLink)}">Open detail page →</a>`
    : "";
  det.innerHTML = `
<div class="thesis-node-header">
<div>
<div class="thesis-node-cat" style="color:${n.color}">${escapeHtml(catName || n.cat)}</div>
<div class="thesis-node-name">${escapeHtml(n.label)}</div>
</div>
</div>
<div class="thesis-node-story">${escapeHtml(story)}</div>
${sourceRow}
${n.path ? `<div class="thesis-node-path"><span style="color:var(--muted);margin-right:5px">Signal path:</span>${escapeHtml(n.path)}</div>` : ""}
<div class="thesis-node-actions">${pageBtn}</div>
${evidenceHtml}`;
}

function thesisClearNodeDetail() {
  const det = document.getElementById("thesisNodeDetail");
  if (det) det.innerHTML = '<p class="thesis-node-empty">Click any node to see how it connects to your thesis</p>';
}

function thesisCanvasCoords(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  const x = (clientX - rect.left) * sx;
  const y = (clientY - rect.top) * sy;
  const scale = thesisMapViewport.scale || 1;
  const mapX = (x - thesisMapViewport.x) / scale;
  const mapY = (y - thesisMapViewport.y) / scale;
  return {
    x,
    y,
    mapX,
    mapY,
    nx: mapX / canvas.width,
    ny: mapY / canvas.height
  };
}

function thesisBindMapCanvas() {
  const canvas = document.getElementById("thesisMapCanvas");
  if (!canvas || canvas.dataset.bound === "true") return;
  canvas.dataset.bound = "true";

  const editToggle = document.getElementById("thesis-map-edit-toggle");
  const resetBtn = document.getElementById("thesis-map-reset-layout");
  const fullscreenBtn = document.getElementById("thesis-map-fullscreen");
  const zoomInBtn = document.getElementById("thesis-map-zoom-in");
  const zoomOutBtn = document.getElementById("thesis-map-zoom-out");
  const resetViewBtn = document.getElementById("thesis-map-reset-view");
  fullscreenBtn?.addEventListener("click", () => thesisToggleMapFullscreen());
  zoomInBtn?.addEventListener("click", () => thesisZoomMap(1.18));
  zoomOutBtn?.addEventListener("click", () => thesisZoomMap(1 / 1.18));
  resetViewBtn?.addEventListener("click", () => thesisResetMapViewport());
  editToggle?.addEventListener("click", () => {
    thesisMapEditMode = !thesisMapEditMode;
    editToggle.classList.toggle("active", thesisMapEditMode);
    editToggle.setAttribute("aria-pressed", String(thesisMapEditMode));
    editToggle.textContent = thesisMapEditMode ? "Lock layout" : "Edit layout";
    if (resetBtn) resetBtn.hidden = !thesisMapEditMode;
    const hint = document.getElementById("thesis-map-hint");
    if (hint) {
      hint.hidden = false;
      hint.textContent = thesisMapEditMode
        ? "Drag nodes to arrange your map · positions save per ticker"
        : "Click any node for evidence";
    }
    thesisDrawMap();
  });
  resetBtn?.addEventListener("click", () => {
    const sym = thesisCurrentMapSymbol();
    try {
      localStorage.removeItem(thesisMapLayoutKey(sym));
    } catch (_) {}
    thesisResetMapViewport({ draw: false });
    void thesisLoadRelationshipMap();
  });

  canvas.addEventListener("pointerdown", (e) => {
    const { x, y, mapX, mapY } = thesisCanvasCoords(canvas, e.clientX, e.clientY);
    const node = thesisGetNodeAt(mapX, mapY, canvas.width, canvas.height);
    thesisMapDragMoved = false;
    if (thesisMapEditMode && node && node.id !== "stock") {
      thesisMapDragNode = node;
      canvas.style.cursor = "grabbing";
    } else {
      thesisMapPanState = {
        startX: x,
        startY: y,
        originX: thesisMapViewport.x,
        originY: thesisMapViewport.y
      };
      canvas.style.cursor = "grabbing";
    }
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  canvas.addEventListener("pointermove", (e) => {
    const { x, y, mapX, mapY, nx, ny } = thesisCanvasCoords(canvas, e.clientX, e.clientY);
    if (thesisMapEditMode && thesisMapDragNode) {
      thesisMapDragNode.x = Math.max(0.06, Math.min(0.94, nx));
      thesisMapDragNode.y = Math.max(0.06, Math.min(0.94, ny));
      thesisMapDragMoved = true;
      thesisDrawMap();
      return;
    }
    if (thesisMapPanState) {
      const dx = x - thesisMapPanState.startX;
      const dy = y - thesisMapPanState.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) thesisMapDragMoved = true;
      thesisMapViewport.x = thesisMapPanState.originX + dx;
      thesisMapViewport.y = thesisMapPanState.originY + dy;
      thesisClampMapViewport(canvas.width, canvas.height);
      thesisDrawMap();
      return;
    }
    const node = thesisGetNodeAt(mapX, mapY, canvas.width, canvas.height);
    canvas.style.cursor = node ? (thesisMapEditMode ? "grab" : "pointer") : "grab";
    if (node !== thesisHoveredNode) {
      thesisHoveredNode = node;
      thesisDrawMap();
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (thesisMapEditMode && thesisMapDragNode && thesisMapDragMoved) {
      const sym = thesisCurrentMapSymbol();
      const overrides = thesisLoadLayoutOverrides(sym);
      thesisMapNodesActive.forEach((n) => {
        overrides[n.id] = { x: n.x, y: n.y };
      });
      thesisSaveLayoutOverrides(sym, overrides);
    }
    thesisMapDragNode = null;
    thesisMapPanState = null;
    if (canvas.releasePointerCapture) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }
  });

  canvas.addEventListener("click", (e) => {
    if (thesisMapDragMoved) {
      thesisMapDragMoved = false;
      return;
    }
    const { mapX, mapY } = thesisCanvasCoords(canvas, e.clientX, e.clientY);
    const node = thesisGetNodeAt(mapX, mapY, canvas.width, canvas.height);
    if (node) thesisShowNodeDetail(node);
    else thesisClearNodeDetail();
  });
  canvas.addEventListener("wheel", (e) => {
    if (!thesisMapNodesActive.length) return;
    const { x, y } = thesisCanvasCoords(canvas, e.clientX, e.clientY);
    thesisZoomMap(e.deltaY < 0 ? 1.12 : 1 / 1.12, x, y);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("pointerleave", () => {
    thesisHoveredNode = null;
    if (!thesisMapPanState) thesisMapDragNode = null;
    thesisDrawMap();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && thesisMapIsFullscreen()) thesisToggleMapFullscreen(false);
  });
  window.addEventListener("resize", thesisDrawMap);
}

function thesisBuildTimeline() {
  const wrap = document.getElementById("thesisHzEvents");
  if (!wrap) return;
  const events = thesisState.signalsPayload?.timelineEvents || [];
  if (!events.length) {
    wrap.innerHTML = `<p class="thesis-section-hint">Timeline appears when thesis signals load from the server.</p>`;
    return;
  }
  wrap.innerHTML = events
    .map(
      (ev) => `
<div class="thesis-hz-event" style="left:${ev.pct}%">
<div class="thesis-hz-event-line" style="background:${ev.color}50"></div>
<div class="thesis-hz-event-dot" style="background:${ev.color}"></div>
<div class="thesis-hz-event-label" style="color:${ev.color}">${escapeHtml(ev.label)}<br><span style="color:var(--muted)">${escapeHtml(ev.sub)}</span></div>
</div>`
    )
    .join("");
}

window.thesisGoTo = thesisGoTo;
window.thesisBuild = thesisBuild;
window.thesisViewMap = thesisViewMap;
window.thesisReset = thesisReset;
window.thesisTrackInPaper = thesisTrackInPaper;
