/* Extracted from app.js lines 3800-4773 */
function renderSystemStatusChrome() {
  renderDataAccuracyBanner();
  renderSourceFreshnessBar();
  const summary = $("#system-status-summary");
  if (!summary) return;
  const mode = state.dataHealth?.dataMode || inferClientDataMode();
  const modeLbl = mode === "live" ? "Live" : mode === "mixed" ? "Mixed" : "Scenario";
  const focus = state.focusSymbol ? ` · Focus ${state.focusSymbol}` : "";
  summary.textContent = `System status · ${modeLbl} data${focus}`;
}

function renderDataAccuracyBanner() {
  const el = $("#data-accuracy-banner");
  if (!el) return;
  const health = state.dataHealth;
  const production = health?.production;
  const mode = health?.dataMode || inferClientDataMode();
  const warnings = health?.provenance?.warnings || [];
  const configured = health?.configured || {};
  const parts = [];

  if (production?.strict && !production?.ready) {
    el.hidden = false;
    el.className = "data-accuracy-banner mode-scenario";
    el.textContent = `Production data mode — ${production.message} Impact % ranges remain scenario models only.`;
    return;
  }

  if (mode === "live" && production?.ready) {
    el.hidden = false;
    el.className = "data-accuracy-banner mode-live";
    const bills = health?.bills;
    const billNote = bills
      ? ` Congress: ${bills.live} live / ${bills.scenario} scenario · LDA linked: ${bills.ldaLinked ?? 0}.`
      : "";
    el.textContent =
      `Live production feeds connected.${billNote} Pass/fail % ranges are illustrative scenario models, not forecasts.`;
    return;
  }

  if (mode === "mixed") {
    parts.push("Mixed data mode — some feeds are live and others use scenario or fallback data.");
  } else {
    parts.push("Scenario / demo mode — configure API keys for live Congress.gov, quotes, and lobbying.");
  }
  if (!configured.congress) parts.push("Set CONGRESS_API_KEY for live bill status.");
  if (!configured.finnhub) parts.push("Set FINNHUB_API_KEY for live equity quotes.");
  if (!configured.senateLda) parts.push("Set SENATE_LDA_API_KEY for live lobbying dollars.");
  if (!configured.fec) parts.push("Set FEC_API_KEY for live campaign finance pulse.");
  if (warnings.length) parts.push(warnings[0]);

  el.hidden = false;
  el.className = `data-accuracy-banner mode-${mode}`;
  el.textContent = parts.join(" ");
}

function inferClientDataMode() {
  const marketFb = feedsUseFallbackQuotes();
  const billsSrc = String(state.dataMeta.bills?.source || "").toLowerCase();
  const billsLive = billsSrc.includes("congress") && !billsSrc.includes("fallback");
  if (!marketFb && billsLive) return "live";
  if (!marketFb || billsLive) return "mixed";
  return "scenario";
}

function renderDashTelemetryStrip() {
  const sourcesEl = $("#dash-telemetry-sources");
  const syncEl = $("#dash-telemetry-sync");
  if (!sourcesEl && !syncEl) return;

  const cfg = state.config?.data || {};
  const items = [
    { label: "CONGRESS.GOV", live: Boolean(cfg.congress) },
    { label: "SENATE LDA", live: Boolean(cfg.senateLda || cfg.ldaEnabled) },
    { label: "USASPENDING", live: true },
    { label: "FEC.GOV", live: Boolean(cfg.fec) }
  ];

  if (sourcesEl) {
    sourcesEl.innerHTML = items
      .map((item, i) => {
        const dot = `<span class="telemetry-dot${item.live ? " is-live" : ""}" aria-hidden="true">●</span>`;
        const sep = i < items.length - 1 ? `<span class="telemetry-sep" aria-hidden="true">·</span>` : "";
        return `<span class="telemetry-source${item.live ? " is-live" : ""}">${dot}${escapeHtml(item.label)}</span>${sep}`;
      })
      .join("");
  }

  if (syncEl) {
    const timestamps = Object.values(state.dataMeta || {})
      .map((meta) => Date.parse(meta?.updatedAt || ""))
      .filter((t) => Number.isFinite(t));
    const latest = timestamps.length ? Math.max(...timestamps) : Date.now();
    const sec = Math.max(0, Math.floor((Date.now() - latest) / 1000));
    syncEl.textContent = `LAST SYNC ${sec}s`;
  }
}

function renderSourceFreshnessBar() {
  const bar = $("#source-freshness-bar");
  const grid = $("#source-freshness-grid");
  if (!bar || !grid) return;

  const health = state.dataHealth;
  const feeds = health?.feeds || {};
  const chips = [
    feedFreshnessChip("Markets", state.dataMeta.market, feeds.market),
    feedFreshnessChip("Bills", state.dataMeta.bills, feeds.bills, {
      extra:
        state.dataMeta.bills?.liveBillCount != null
          ? `${state.dataMeta.bills.liveBillCount} live · ${state.dataMeta.bills.scenarioBillCount ?? 0} scenario`
          : ""
    }),
    feedFreshnessChip("Lobbying", state.dataMeta.lobbying, feeds.lobbying),
    feedFreshnessChip("Contracts", state.dataMeta.contracts, feeds.contracts),
    feedFreshnessChip("FEC", state.dataMeta.fec, feeds.fec),
    feedFreshnessChip("Crypto", state.dataMeta.crypto, feeds.crypto)
  ];
  grid.innerHTML = chips.join("");
  renderDashTelemetryStrip();

  const link = $("#data-health-details-link");
  if (link) {
    link.onclick = (e) => {
      e.preventDefault();
      openMethodologyOrDataHealth();
    };
  }
}

function feedFreshnessChip(label, meta, serverFeed, { extra = "" } = {}) {
  const src = meta?.source || serverFeed?.source || "—";
  const isLive = src === "fec" || (serverFeed?.status === "connected" && !serverFeed?.fallback && !String(src).includes("fallback") && src !== "sample");
  const isFallback = src === "sample" || String(src).includes("fallback") || serverFeed?.fallback;
  const when = freshnessText(meta?.updatedAt || serverFeed?.lastSuccessAt);
  const detail = extra ? ` · ${extra}` : "";
  const srcLabel = label === "FEC" ? (isLive ? "Live FEC" : isFallback ? "Sample FEC" : sourceLabel(src)) : sourceLabel(src);
  return `<span class="source-freshness-chip ${isLive ? "is-live" : isFallback ? "is-fallback" : ""}" title="${escapeHtml(srcLabel)}">
    <span class="dot" aria-hidden="true"></span>
    <span>${escapeHtml(label)} · ${escapeHtml(when)}${escapeHtml(detail)}</span>
  </span>`;
}

function openMethodologyOrDataHealth() {
  const btn = $("#methodology-open-btn");
  if (btn) btn.click();
  else showView("settings", false);
}

function renderSourceBadges() {
  renderSourceFreshnessBar();
  const hidePagePills = Boolean($("#system-status-fold"));
  for (const sel of ["#market-source", "#bill-source", "#signals-source", "#lobby-source", "#contracts-source"]) {
    const el = $(sel);
    if (el) el.hidden = hidePagePills;
  }
  updateSourceBadge("#market-source", "market");
  updateSourceBadge("#crypto-source", "crypto");
  updateSourceBadge("#bill-source", "bills");
  updateSourceBadge("#signals-source", "bills");
  updateSourceBadge("#lobby-source", "lobbying");
  updateSourceBadge("#account-source", "account");
  updateSourceBadge("#contracts-source", "contracts");
  renderLiveFeedStatus();
}

function updateSourceBadge(selector, key) {
  const el = $(selector);
  if (!el) return;
  const meta = state.dataMeta[key];
  const label = sourceLabel(meta?.source || (meta?.updatedAt ? "cached" : "connecting"));
  const confidence = meta?.confidence ? ` · ${meta.confidence}` : "";
  const pulse = meta?.updatedAt ? "" : `<span class="live-dot" aria-hidden="true"></span>`;
  el.innerHTML = `${pulse}${escapeHtml(label)} · ${freshnessText(meta?.updatedAt)}${escapeHtml(confidence)}`;
  el.classList.add("status-pill", "source-pill");
  el.classList.toggle("source-live", Boolean(meta?.updatedAt) && !String(meta.source || "").includes("fallback"));
  el.classList.toggle("source-fallback", String(meta?.source || "").includes("fallback"));
}

function feedsUseFallbackQuotes() {
  const src = String(state.quoteFeedSource || state.dataMeta.market?.source || "").toLowerCase();
  return src === "fallback" || src === "mixed" || src.includes("fallback");
}

function skeletonCardMarkup(lines = 3) {
  const widths = ["wide", "mid", "short"];
  const inner = Array.from({ length: lines }, (_, i) =>
    `<div class="skeleton-line skeleton-block ${widths[i] || "mid"}"></div>`
  ).join("");
  return `<article class="skeleton-card" aria-hidden="true">${inner}</article>`;
}

function skeletonFeedMarkup(count = 2) {
  return Array.from({ length: count }, () => skeletonCardMarkup(3)).join("");
}

function portfolioPolicyRisk() {
  const holdingSyms = paperPositionSymbols();
  const watchSyms = isWatchlistScope() && !state.focusSymbol ? state.watchlistSymbols : [];
  const targetSyms = holdingSyms.length ? holdingSyms : watchSyms;
  const bills = policyBills();
  const relevant = bills.filter((b) => (b.affected || []).some((t) => targetSyms.includes(normalizeWatchSymbol(t))));
  let score = 0;
  if (relevant.length) {
    score = Math.round(relevant.reduce((m, b) => Math.max(m, billMomentum(b)), 0));
  } else if (bills.length) {
    score = Math.round(bills.reduce((m, b) => Math.max(m, billMomentum(b)), 0) * 0.55);
  } else {
    score = 32;
  }
  const label = score >= 67 ? "Elevated" : score >= 40 ? "Medium" : "Contained";
  const sub = relevant.length
    ? `${relevant.length} bill${relevant.length === 1 ? "" : "s"} touch ${holdingSyms.length ? "your holdings" : "your watchlist"}`
    : holdingSyms.length
      ? "Benchmark-level policy heat"
      : watchSyms.length
        ? "No mapped bills on watchlist yet"
        : "Add holdings to personalize";
  return { score, label, sub };
}

function renderLiveFeedStatus() {
  renderTrustFeedChip();
}

function countLiveQuotes() {
  const quotes = state.quotes || [];
  const live = quotes.filter((q) => {
    const src = String(q.source || "").toLowerCase();
    return src && !src.includes("fallback") && !q.isStale;
  }).length;
  const total = quotes.length || tradableSymbolRows().length || 0;
  return { live, total };
}

function buildTrustFeedChipText() {
  const billsMeta = state.dataMeta.bills || {};
  const contractsMeta = state.dataMeta.contracts || {};
  const congressWhen = billsMeta.updatedAt ? freshnessText(billsMeta.updatedAt) : "…";
  const contractsWhen = contractsMeta.updatedAt ? freshnessText(contractsMeta.updatedAt) : "…";
  const { live, total } = countLiveQuotes();
  const quotesPart = total ? `Quotes ${live}/${total} live` : "Quotes …";
  const congressSrc = sourceLabel(billsMeta.source || "Congress");
  const congressLabel = String(congressSrc).split(" ")[0] || "Congress";
  return `Feeds · ${congressLabel} ${congressWhen} · ${quotesPart} · Contracts ${contractsWhen}`;
}

function renderTrustFeedChip() {
  const el = $("#trust-feed-chip") || $("#live-feed-status");
  if (!el) return;
  const fallback = feedsUseFallbackQuotes();
  const text = buildTrustFeedChipText();
  if (state.quoteFeedError) {
    el.className = "topbar-status-chip trust-feed-chip status-warn";
    el.textContent = state.quoteFeedError;
    el.title = state.quoteFeedError;
    return;
  }
  el.className = `topbar-status-chip trust-feed-chip${fallback ? " status-warn" : state.dataMeta.market?.updatedAt ? " status-live" : ""}`;
  el.innerHTML = `<span class="trust-feed-chip-icon" aria-hidden="true"><span class="live-dot"></span></span><span class="trust-feed-chip-text">${escapeHtml(text)}</span>`;
  el.title = fallback
    ? "Quote feed is modeled or mixed — tap for per-provider status"
    : "Tap for per-provider feed health";
}

function renderFeedHealthDrawer() {
  const grid = $("#feed-health-grid");
  if (!grid) return;
  const health = state.dataHealth;
  const feeds = health?.feeds || {};
  const rows = [
    ["Markets", state.dataMeta.market, feeds.market],
    ["Bills", state.dataMeta.bills, feeds.bills],
    ["Lobbying", state.dataMeta.lobbying, feeds.lobbying],
    ["Contracts", state.dataMeta.contracts, feeds.contracts],
    ["FEC", state.dataMeta.fec, feeds.fec],
    ["Crypto", state.dataMeta.crypto, feeds.crypto]
  ];
  grid.innerHTML = rows
    .map(([label, meta, serverFeed]) => {
      const src = meta?.source || serverFeed?.source || "—";
      const isLive = src === "fec" || (serverFeed?.status === "connected" && !serverFeed?.fallback && !String(src).includes("fallback") && src !== "sample");
      const isFallback = src === "sample" || String(src).includes("fallback") || serverFeed?.fallback;
      const pillClass = isLive ? "green" : isFallback ? "amber" : "";
      const pill = isLive ? "Live" : isFallback || src === "sample" ? (label === "FEC" ? "Sample FEC" : "Fallback") : "Connecting";
      const when = freshnessText(meta?.updatedAt || serverFeed?.lastSuccessAt);
      const extra =
        label === "Bills" && meta?.liveBillCount != null
          ? `${meta.liveBillCount} live · ${meta.scenarioBillCount ?? 0} modeled`
          : label === "Markets"
            ? (() => {
                const { live, total } = countLiveQuotes();
                return total ? `${live}/${total} symbols live` : "";
              })()
            : "";
      return `
        <article class="feed-health-row">
          <div class="feed-health-row-head">
            <strong>${escapeHtml(label)}</strong>
            <span class="mini-pill ${pillClass}">${escapeHtml(pill)}</span>
          </div>
          <span class="muted">${escapeHtml(sourceLabel(src))} · ${escapeHtml(when)}</span>
          ${extra ? `<span class="muted">${escapeHtml(extra)}</span>` : ""}
        </article>`;
    })
    .join("");
}

function openFeedHealthDrawer() {
  const drawer = $("#feed-health-drawer");
  if (!drawer) return;
  renderFeedHealthDrawer();
  drawer.hidden = false;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  $("#trust-feed-chip")?.setAttribute("aria-expanded", "true");
  document.body.classList.add("feed-health-open");
}

function closeFeedHealthDrawer() {
  const drawer = $("#feed-health-drawer");
  if (!drawer) return;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  $("#trust-feed-chip")?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("feed-health-open");
  setTimeout(() => {
    if (!drawer.classList.contains("open")) drawer.hidden = true;
  }, 220);
}

function setupFeedHealthDrawer() {
  $("#trust-feed-chip")?.addEventListener("click", () => openFeedHealthDrawer());
  $("#feed-health-close")?.addEventListener("click", () => closeFeedHealthDrawer());
  $("#feed-health-backdrop")?.addEventListener("click", () => closeFeedHealthDrawer());
  $("#feed-health-settings-link")?.addEventListener("click", () => {
    closeFeedHealthDrawer();
    showView("settings");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#feed-health-drawer")?.classList.contains("open")) closeFeedHealthDrawer();
  });
}

function sinceLastVisitScopeTickers() {
  const set = new Set();
  if (state.focusSymbol) set.add(state.focusSymbol);
  for (const row of watchlistRows()) {
    const sym = normalizeWatchSymbol(row.symbol);
    if (sym) set.add(sym);
  }
  return [...set];
}

function visitTickerPayload(sym) {
  const signalIds = [];
  for (const sig of buildSignalFeed()) {
    const tickers = (sig.tickers || []).map(normalizeWatchSymbol);
    if (!tickers.includes(sym)) continue;
    const id = sig._billId
      ? `bill:${sig._billId}`
      : sig._fecKey
        ? `fec:${sig._fecKey}`
      : sig._contractSymbol
        ? `contract:${sig._contractSymbol}`
        : `sig:${sig.type}:${String(sig.title || "").slice(0, 48)}`;
    signalIds.push(id);
  }
  const billIds = policyBills()
    .filter((bill) => (bill.affected || []).map(normalizeWatchSymbol).includes(sym))
    .map((bill) => bill.id)
    .filter(Boolean);
  const contractIds = (state.contractWatch || [])
    .filter((award) => (award.mappedTickers || []).map(normalizeWatchSymbol).includes(sym))
    .map((award) => award.awardId || `${award.recipient}:${award.amount}`)
    .filter(Boolean);
  return { signalIds, billIds, contractIds };
}

function collectVisitSnapshot() {
  const tickers = {};
  for (const sym of sinceLastVisitScopeTickers()) {
    tickers[sym] = visitTickerPayload(sym);
  }
  const fecPulseIds = (state.fecPulse?.pulses || [])
    .map((p) => p.clusterKey || p.committee)
    .filter(Boolean);
  return { tickers, fecPulseIds, at: new Date().toISOString() };
}

function loadVisitSnapshot() {
  try {
    const raw = sessionStorage.getItem(LAST_VISIT_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function persistVisitSnapshot(snapshot = collectVisitSnapshot()) {
  try {
    sessionStorage.setItem(LAST_VISIT_SNAPSHOT_KEY, JSON.stringify(snapshot));
    sessionStorage.setItem(LAST_VISIT_AT_KEY, snapshot.at || new Date().toISOString());
  } catch (_) {}
}

function sinceLastVisitTimeLabel(iso) {
  if (!iso) return "your last visit";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "your last visit";
  if (ms >= 86400000) return "yesterday";
  if (ms >= 3600000) return `${Math.round(ms / 3600000)} hours ago`;
  return "your last visit";
}

function diffVisitSnapshots(prev, current) {
  const parts = [];
  const prevTickers = prev?.tickers || {};
  const curTickers = current.tickers || {};
  const symbols = sinceLastVisitScopeTickers();
  for (const sym of symbols) {
    const before = prevTickers[sym] || { signalIds: [], billIds: [], contractIds: [] };
    const now = curTickers[sym] || { signalIds: [], billIds: [], contractIds: [] };
    const prevSignals = new Set([...(before.signalIds || []), ...(before.billIds || []).map((id) => `bill:${id}`)]);
    const newSignals = [...new Set([...(now.signalIds || []), ...(now.billIds || []).map((id) => `bill:${id}`)])].filter(
      (id) => !prevSignals.has(id)
    ).length;
    const prevContracts = new Set(before.contractIds || []);
    const newContracts = (now.contractIds || []).filter((id) => !prevContracts.has(id)).length;
    if (newSignals) parts.push(`${newSignals} new signal${newSignals === 1 ? "" : "s"} on ${sym}`);
    if (newContracts) parts.push(`${newContracts} contract${newContracts === 1 ? "" : "s"} on ${sym}`);
  }
  return parts;
}

function sinceLastVisitStripContent() {
  const current = collectVisitSnapshot();
  const prev = loadVisitSnapshot();
  const lastAt = (() => {
    try {
      return sessionStorage.getItem(LAST_VISIT_AT_KEY);
    } catch (_) {
      return null;
    }
  })();
  if (!prev || !lastAt) {
    persistVisitSnapshot(current);
    return {
      className: "since-last-visit-strip since-last-visit-strip--quiet",
      html: `<span class="since-last-visit-text">First brief today</span>`,
      hidden: false
    };
  }
  const parts = diffVisitSnapshots(prev, current);
  const when = sinceLastVisitTimeLabel(lastAt);
  const fecIds = new Set(prev?.fecPulseIds || []);
  const newFec = (state.fecPulse?.pulses || [])
    .map((p) => p.clusterKey || p.committee)
    .filter((id) => id && !fecIds.has(id));
  if (newFec.length) parts.unshift(`${newFec.length} FEC pulse${newFec.length === 1 ? "" : "s"} since ${escapeHtml(when)}`);
  persistVisitSnapshot(current);
  if (!parts.length) {
    return {
      className: "since-last-visit-strip since-last-visit-strip--quiet",
      html: `<span class="since-last-visit-text">No new signals since ${escapeHtml(when)}</span>`,
      hidden: false
    };
  }
  return {
    className: "since-last-visit-strip since-last-visit-strip--active intel-card",
    html: `<span class="since-last-visit-dot" aria-hidden="true"></span><span class="since-last-visit-text">${escapeHtml(parts.join(" · "))}</span>`,
    hidden: false
  };
}

function renderSinceLastVisitStrip() {
  const overviewActive = $("#view-overview")?.classList.contains("active");
  const signalsActive = $("#view-signals")?.classList.contains("active");
  const content = sinceLastVisitStripContent();
  const targets = [
    { el: $("#since-last-visit-strip"), show: overviewActive },
    { el: $("#since-last-visit-strip-signals"), show: signalsActive }
  ];
  for (const { el, show } of targets) {
    if (!el) continue;
    if (!show) {
      el.hidden = true;
      continue;
    }
    el.className = content.className;
    el.innerHTML = content.html;
    el.hidden = content.hidden;
  }
  renderBookSummaryHeader();
}

function flashFeedRefreshed() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const active = document.querySelector(".view.active");
  if (!active) return;
  active.classList.add("feed-refreshed");
  window.setTimeout(() => active.classList.remove("feed-refreshed"), 620);
}

function setupSinceLastVisit() {
  window.addEventListener("beforeunload", () => {
    try {
      persistVisitSnapshot(collectVisitSnapshot());
    } catch (_) {}
  });
}

function setupPullToRefresh() {
  const workspace = document.querySelector(".workspace");
  const ptr = $("#workspace-ptr");
  if (!workspace || !ptr || workspace.dataset.ptrBound === "true") return;
  workspace.dataset.ptrBound = "true";
  const mq = window.matchMedia("(max-width: 760px)");
  const motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const label = ptr.querySelector(".workspace-ptr-label");
  let startY = 0;
  let pulling = false;
  let pullDist = 0;
  const threshold = 72;

  const ptrActiveView = () => {
    const active = document.querySelector(".view.active");
    return (
      active?.id === "view-overview" ||
      active?.id === "view-signals" ||
      active?.id === "view-fec"
    );
  };

  const resetPtr = () => {
    pulling = false;
    pullDist = 0;
    workspace.classList.remove("is-ptr-pulling", "is-ptr-ready", "is-ptr-refreshing");
    workspace.style.removeProperty("--ptr-offset");
    ptr.hidden = true;
    ptr.setAttribute("aria-hidden", "true");
  };

  workspace.addEventListener(
    "touchstart",
    (e) => {
      if (!mq.matches || !ptrActiveView() || workspace.classList.contains("is-ptr-refreshing")) return;
      if (workspace.scrollTop > 2) return;
      startY = e.touches[0].clientY;
      pulling = true;
    },
    { passive: true }
  );

  workspace.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling || !mq.matches) return;
      pullDist = Math.max(0, e.touches[0].clientY - startY);
      if (pullDist <= 0 || workspace.scrollTop > 2) {
        if (pullDist <= 0) resetPtr();
        return;
      }
      workspace.classList.add("is-ptr-pulling");
      ptr.hidden = false;
      ptr.setAttribute("aria-hidden", "false");
      const ready = pullDist >= threshold;
      workspace.classList.toggle("is-ptr-ready", ready);
      if (label) label.textContent = ready ? "Release to refresh" : "Pull to refresh";
      if (!motionMq.matches) {
        workspace.style.setProperty("--ptr-offset", `${Math.min(pullDist * 0.4, 52)}px`);
      }
    },
    { passive: true }
  );

  workspace.addEventListener("touchend", async () => {
    if (!pulling || !mq.matches) return;
    const shouldRefresh = pullDist >= threshold;
    if (!shouldRefresh) {
      resetPtr();
      return;
    }
    workspace.classList.add("is-ptr-refreshing");
    workspace.classList.remove("is-ptr-ready");
    if (label) label.textContent = "Refreshing…";
    try {
      await refreshTerminalData();
      if (isFeatureEnabled("BILLS_EXPLORER_ENABLED")) renderBills();
      if ($("#view-signals")?.classList.contains("active")) renderSignalsDesk();
      else if ($("#view-overview")?.classList.contains("active")) renderOverview();
      renderSinceLastVisitStrip();
      flashFeedRefreshed();
    } finally {
      setTimeout(resetPtr, motionMq.matches ? 0 : 380);
    }
  });

  workspace.addEventListener("touchcancel", resetPtr);
}

function setupClassbarScrollHide() {
  if (window.__classbarScrollBound) return;
  const classbar = document.querySelector(".dash-classbar");
  const workspace = document.querySelector(".workspace");
  if (!classbar || !workspace) return;
  window.__classbarScrollBound = true;
  let lastY = 0;
  let ticking = false;
  const mq = window.matchMedia("(max-width: 760px)");
  const syncHidden = (hidden) => {
    document.body.classList.toggle("dash-classbar-hidden", hidden);
    document.documentElement.style.setProperty("--dash-classbar-h", hidden ? "0px" : `${classbar.offsetHeight || 24}px`);
    syncDashChromeHeights();
  };
  const onScroll = () => {
    if (!mq.matches) {
      syncHidden(false);
      return;
    }
    const y = workspace.scrollTop;
    if (y > lastY + 4 && y > 56) {
      syncHidden(true);
    } else if (y < lastY - 4 || y <= 8) {
      syncHidden(false);
    }
    if (y <= 2 && y > 0) workspace.classList.add("is-scroll-refresh-hint");
    else workspace.classList.remove("is-scroll-refresh-hint");
    lastY = y;
  };
  workspace.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        onScroll();
        ticking = false;
      });
    },
    { passive: true }
  );
  mq.addEventListener("change", () => syncHidden(false));
}

function syncDashChromeHeights() {
  if (document.body?.dataset?.page !== "dashboard") return;
  const root = document.documentElement;
  const classbar = document.querySelector(".dash-classbar");
  const stack = document.querySelector(".topbar-stack");
  const chromeRail = document.querySelector(".dash-chrome-rail");
  const classH = classbar?.offsetHeight || 24;
  const stackH = stack?.offsetHeight || 82;
  const railH = chromeRail?.offsetHeight || 0;
  root.style.setProperty("--dash-classbar-h", `${classH}px`);
  root.style.setProperty("--dash-topbar-stack-h", `${stackH}px`);
  root.style.setProperty("--dash-chrome-rail-h", `${railH}px`);
  root.style.setProperty("--dash-sticky-filter-top", `${classH + stackH + railH}px`);
}

function closeMobileSidebarNav() {
  const sidebar = $("#main-sidebar");
  const hamBtn = $("#ham-btn");
  if (!sidebar?.classList.contains("nav-open")) return;
  sidebar.classList.remove("nav-open");
  hamBtn?.setAttribute("aria-expanded", "false");
}

function setupDashChromeMetrics() {
  syncDashChromeHeights();
  if (window.__dashChromeMetricsBound) return;
  window.__dashChromeMetricsBound = true;
  window.addEventListener("resize", syncDashChromeHeights, { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    const stack = document.querySelector(".topbar-stack");
    const chromeRail = document.querySelector(".dash-chrome-rail");
    const ro = new ResizeObserver(() => syncDashChromeHeights());
    if (stack) ro.observe(stack);
    if (chromeRail) ro.observe(chromeRail);
  }
}

function setupMobileBottomNav() {
  const nav = $("#mobile-bottom-nav");
  if (!nav || nav.dataset.bound === "true") return;
  nav.dataset.bound = "true";
  nav.querySelectorAll("[data-mobile-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.mobileView;
      if (!isViewEnabled(view)) return;
      closeMobileSidebarNav();
      showView(view);
    });
  });
}

function syncMobileBottomNav(view) {
  const nav = $("#mobile-bottom-nav");
  if (!nav) return;
  nav.querySelectorAll("[data-mobile-view]").forEach((btn) => {
    const active = btn.dataset.mobileView === view;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-current", active ? "page" : "false");
  });
}

function focusContextCounts(sym) {
  const bills = policyBills().filter((bill) => billMatchesFocusFilter(bill)).length;
  const contracts = (state.contracts || []).filter((row) => normalizeWatchSymbol(row.symbol) === sym).length
    + (state.contractWatch || []).filter(contractWatchMatchesTabFilters).length;
  const lobby = (state.lobbying || []).filter(lobbyingMatchesTabFilters).length;
  return { bills, contracts, lobby };
}

function renderMobileContextBar() {
  const bar = $("#mobile-context-bar");
  const inner = $("#mobile-context-inner");
  if (!bar || !inner) return;
  const sym = state.focusSymbol;
  if (!sym) {
    bar.hidden = true;
    inner.innerHTML = "";
    syncDashChromeHeights();
    return;
  }
  const counts = focusContextCounts(sym);
  bar.hidden = false;
  inner.innerHTML = `
    <button type="button" class="mobile-context-seg" data-mobile-context-view="analysis" aria-label="Analysis for ${escapeHtml(sym)}">
      <strong>${escapeHtml(sym)}</strong>
    </button>
    <button type="button" class="mobile-context-seg" data-mobile-context-view="bills" aria-label="Bills for ${escapeHtml(sym)}">
      Bills (${counts.bills})
    </button>
    <button type="button" class="mobile-context-seg" data-mobile-context-view="contracts" aria-label="Contracts for ${escapeHtml(sym)}">
      Contracts (${counts.contracts})
    </button>
    <button type="button" class="mobile-context-seg" data-mobile-context-view="lobbying" aria-label="Lobbying for ${escapeHtml(sym)}">
      Lobby (${counts.lobby})
    </button>`;
  inner.querySelectorAll("[data-mobile-context-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.mobileContextView;
      if (view === "analysis") {
        state.activeAnalysisSymbol = sym;
        const sel = $("#analysis-symbol");
        if (sel) setSymbolPickerValue(sel, sym, { notify: false });
      }
      showView(view);
    });
  });
  syncDashChromeHeights();
}

function freshnessText(value) {
  if (!value) return "waiting";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "updated";
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 8) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function setupRefreshAllControl() {
  const btn = $("#refresh-all-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Refreshing…";
    try {
      await Promise.allSettled([
        refreshTerminalData(),
        isFeatureEnabled("CONTRACTS_ANALYZER_ENABLED") ? refreshContractsFeed() : Promise.resolve(),
        isFeatureEnabled("ANALYSIS_LAB_ENABLED") ? loadAnalysis(state.activeAnalysisSymbol) : Promise.resolve(),
        loadTradeHistory(state.tradeSymbol, state.tradeRange)
      ]);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

function setupDashPolishControls() {
  $("#markets-refresh-inline")?.addEventListener("click", () => {
    void refreshMarketFeed({ render: true });
  });
  $("#thesis-header-start")?.addEventListener("click", () => {
    if (typeof thesisReset === "function") thesisReset();
    document.querySelector('[data-thesis-outer="build"]')?.click();
    document.getElementById("tc-ticker")?.focus();
    thesisSyncEmptyGuide();
  });
  $("#thesis-empty-example")?.addEventListener("click", () => {
    const ticker = document.getElementById("tc-ticker");
    const thesis = document.getElementById("tc-thesis");
    const dir = document.getElementById("tc-direction");
    if (ticker) ticker.value = "PLTR";
    if (dir) dir.value = "bull";
    if (thesis) {
      thesis.value =
        "PLTR wins more federal AI and defense software contracts as agencies modernize data systems.";
    }
    thesisState.ticker = "PLTR";
    thesisSyncIntakeState({ renderSummary: true });
    ticker?.focus();
  });
}

async function refreshTerminalData() {
  const settled = await Promise.allSettled([
    refreshAccountFeed({ render: false }),
    refreshMarketFeed({ render: false }),
    isFeatureEnabled("CRYPTO_TRACKER_ENABLED") ? refreshCryptoFeed({ render: false }) : Promise.resolve(),
    refreshPolicyFeed({ render: false }),
    refreshFecPulse({ render: false, force: true }),
    refreshTrendingFeed({ render: false }),
    refreshContractWatchFeed({ render: false })
  ]);

  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(["account", "market", "crypto", "policy", "fec", "trending", "contractWatch"][index], "feed failed", result.reason);
    }
  });

  renderTerminalData();
}

async function refreshAccountFeed({ render = true } = {}) {
  const account = await fetchJson("/api/trading/account");
  state.account = account;
  rememberFeedMeta("account", account, "local_paper");
  recordPortfolioEquitySnapshot(account);
  if (render) {
    renderSourceBadges();
    renderOverview();
    renderAccount();
    renderLiveAlerts();
  } else {
    renderPortfolioChart();
  }
  return account;
}

function paperAccountMeta(accountPayload) {
  return accountPayload?.account || {};
}

function paperEquity(accountPayload) {
  if (!accountPayload) return PAPER_STARTING_CASH;
  const meta = paperAccountMeta(accountPayload);
  const equity = Number(meta.equity);
  if (Number.isFinite(equity) && equity > 0) return equity;
  const cash = Number(meta.cash ?? PAPER_STARTING_CASH);
  const invested = (accountPayload?.positions || []).reduce(
    (sum, p) => sum + Number(p.marketValue || 0),
    0
  );
  return cash + invested;
}

function bootstrapPortfolioEquityHistory(accountPayload) {
  if (state.portfolioChartBootstrapped && state.portfolioEquityHistory.length >= 2) return;
  const equity = paperEquity(accountPayload);
  const starting = Number(paperAccountMeta(accountPayload).startingCash || PAPER_STARTING_CASH);
  const orders = [...(accountPayload?.orders || [])].sort(
    (a, b) => Date.parse(a.submittedAt || 0) - Date.parse(b.submittedAt || 0)
  );
  const points = [];

  if (orders.length) {
    let cash = starting;
    const holdings = {};
    points.push({
      date: orders[0].submittedAt || new Date(Date.now() - 7 * 86400000).toISOString(),
      value: starting,
      close: starting
    });
    for (const order of orders) {
      const sym = String(order.symbol || "").toUpperCase();
      const qty = Number(order.qty || 0);
      const price = Number(order.price || 0);
      const side = String(order.side || "buy").toLowerCase();
      const notional = Number(order.notional || price * qty);
      if (!sym || !qty || !price) continue;
      if (side === "buy") {
        cash -= notional;
        holdings[sym] = holdings[sym] || { qty: 0, avg: price };
        holdings[sym].qty += qty;
      } else {
        cash += notional;
        if (holdings[sym]) {
          holdings[sym].qty -= qty;
          if (holdings[sym].qty <= 0) delete holdings[sym];
        }
      }
      let invested = 0;
      for (const [symbol, pos] of Object.entries(holdings)) {
        const q = quoteFor(symbol);
        const mark = Number(q?.price || price);
        invested += mark * pos.qty;
      }
      points.push({
        date: order.submittedAt || new Date().toISOString(),
        value: cash + invested,
        close: cash + invested
      });
    }
  } else {
    const now = Date.now();
    for (let i = 6; i >= 0; i -= 1) {
      points.push({
        date: new Date(now - i * 86400000).toISOString(),
        value: equity,
        close: equity
      });
    }
  }

  const last = points[points.length - 1];
  if (!last || Math.abs(last.value - equity) > 0.01) {
    points.push({ date: new Date().toISOString(), value: equity, close: equity });
  }

  state.portfolioEquityHistory = points.slice(-120);
  state.portfolioChartBootstrapped = true;
}

function recordPortfolioEquitySnapshot(accountPayload) {
  if (!accountPayload) return;
  bootstrapPortfolioEquityHistory(accountPayload);
  const equity = paperEquity(accountPayload);
  if (window.TSCharts?.patchLiveBar) {
    state.portfolioEquityHistory = window.TSCharts.patchLiveBar(
      state.portfolioEquityHistory,
      equity
    );
  } else {
    const now = new Date().toISOString();
    const hist = state.portfolioEquityHistory;
    const last = hist[hist.length - 1];
    if (!last) hist.push({ date: now, value: equity, close: equity });
    else {
      last.date = now;
      last.value = equity;
      last.close = equity;
    }
  }
}

function portfolioChartSourceLabel() {
  const positions = state.account?.positions?.length || 0;
  if (!positions) {
    return "Paper account · $100,000 starting cash · no open positions yet";
  }
  const quoteSrc =
    state.quoteFeedSource === "finnhub"
      ? "live marks"
      : state.quoteFeedSource === "yfinance"
        ? "Yahoo (yfinance)"
      : state.quoteFeedSource === "yahoo_chart"
        ? "Yahoo marks"
        : "modeled marks";
  return `Paper equity · cash + positions · ${quoteSrc}`;
}

