const HOLDING_PALETTE = ["#5eead4", "#93c5fd", "#fcd34d", "#f87171", "#c4b5fd", "#a78bfa", "#fb923c", "#60a5fa", "#e879f9", "#4ade80"];

function dashboardBootstrap() {
  return state.dashboardBootstrap || {};
}

function marketSymbols() {
  const rows = dashboardBootstrap().marketSymbols;
  return Array.isArray(rows) && rows.length ? rows : ["SPY", "QQQ"];
}

function marketsDefaultSymbols() {
  const rows = dashboardBootstrap().marketsDefaultSymbols;
  return Array.isArray(rows) && rows.length ? rows : marketSymbols().slice(0, 10);
}

function tapeDefaultQuoteSymbols() {
  const rows = dashboardBootstrap().tapeDefaultSymbols;
  return Array.isArray(rows) && rows.length ? rows : marketsDefaultSymbols().slice(0, 5);
}

function watchlistRows() {
  const palette = dashboardBootstrap().holdingPalette || HOLDING_PALETTE;
  if (state.watchlistSymbols.length) {
    return state.watchlistSymbols.map((symbol, index) => ({
      symbol,
      color: palette[index % palette.length]
    }));
  }
  const defaults = dashboardBootstrap().watchlistDefault;
  return Array.isArray(defaults) && defaults.length ? defaults : [];
}

function contractWatchlist() {
  const rows = dashboardBootstrap().contractWatchlist;
  return Array.isArray(rows) ? rows : [];
}

const LIVE_FEED_INTERVALS = {
  marketMs: 30000,
  cryptoMs: 30000,
  accountMs: 15000,
  policyMs: 300000,
  contractsMs: 600000,
  tradeHistoryMs: 12000,
  analysisChartMs: 12000,
  portfolioChartMs: 5000
};

const PAPER_STARTING_CASH = 100000;

const THEME_STORAGE_KEY = "ts_theme";
const READER_MODE_STORAGE_KEY = "ts_reader_mode";

function getStoredTheme() {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    if (t === "light" || t === "dark") return t;
  } catch (_) {}
  return "dark";
}

function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, t);
  } catch (_) {}
  document.querySelectorAll(".theme-toggle-btn").forEach((btn) => {
    const active = btn.dataset.themeSet === t;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function setupThemeToggle() {
  document.querySelectorAll(".theme-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.themeSet));
  });
  const current =
    document.documentElement.getAttribute("data-theme") || getStoredTheme();
  applyTheme(current);
}

function getStoredReaderMode() {
  try {
    const mode = localStorage.getItem(READER_MODE_STORAGE_KEY);
    if (mode === "citizen" || mode === "investor" || mode === "analyst") return mode;
  } catch (_) {}
  return "investor";
}

function applyReaderMode(mode, { reload = false } = {}) {
  const next = mode === "citizen" || mode === "analyst" ? mode : "investor";
  state.readerMode = next;
  document.documentElement.setAttribute("data-reader-mode", next);
  try {
    localStorage.setItem("ts_reader_mode", next);
  } catch (_) {}
  document.querySelectorAll(".reader-mode-btn").forEach((btn) => {
    const active = btn.dataset.readerMode === next;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (reload && state.activeAnalysisSymbol) loadAnalysis(state.activeAnalysisSymbol);
}

function setupReaderModeToggle() {
  document.querySelectorAll(".reader-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyReaderMode(btn.dataset.readerMode, { reload: true }));
  });
  applyReaderMode(getStoredReaderMode(), { reload: false });
}

function formatAge(ms) {
  if (ms == null || !Number.isFinite(ms)) return "unknown";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function formatQuoteMeta(quote) {
  if (!quote || quote.price == null) return "";
  const sourceLabel = quote.provider || quoteSourceDisplay(quote.source);
  const age = quote.delayLabel || `updated ${formatAge(quote.freshnessMs)}`;
  let text = `${age} · ${sourceLabel} · Market data may be delayed`;
  if (quote.isStale || Number(quote.freshnessMs) > 120000) text += " · Quote may be stale";
  return text;
}

function quoteSourceDisplay(source) {
  const map = {
    finnhub: "Finnhub",
    yfinance: "Yahoo (yfinance)",
    yahoo_chart: "Yahoo chart",
    fallback_static: "modeled fallback",
    fallback: "modeled fallback"
  };
  return map[source] || String(source || "provider").replace(/_/g, " ");
}

const CURRENT_CONGRESS = "119";

let dashboardReadyResolve;
const dashboardReady = new Promise((resolve) => {
  dashboardReadyResolve = resolve;
});
window.__tsDashboardReady = dashboardReady;

function paperPositionSymbols() {
  const positions = state?.account?.positions;
  if (!Array.isArray(positions)) return [];
  return positions.map((p) => p.symbol).filter(Boolean);
}

function quoteSymbolUniverse() {
  return [
    ...new Set([
      ...marketsDefaultSymbols(),
      ...tapeDefaultQuoteSymbols(),
      ...marketSymbols(),
      ...paperPositionSymbols(),
      ...watchlistRows().map((w) => w.symbol),
      state.activeAnalysisSymbol,
      state.tradeSymbol
    ].filter(Boolean))
  ];
}

/** Align server fields (pct vs change24h) for tape + markets crypto cards. */
function normalizeCryptoAssets(assets) {
  return (assets || []).map((a) => {
    const pctRaw = a.pct ?? a.change24h;
    const pct = pctRaw != null && Number.isFinite(Number(pctRaw)) ? Number(pctRaw) : null;
    return { ...a, pct };
  });
}

function policyBlurbFor(symbol) {
  const blurbs = dashboardBootstrap().policyBlurbs || {};
  if (blurbs[symbol]) return blurbs[symbol];
  const bill = policyBills().find((item) => (item.affected || []).includes(symbol));
  if (bill) {
    return twelveWordSummary(bill.plainEnglish || bill.shortTitle || bill.title || bill.impact);
  }
  return "Open Bills for policy mapping on this ticker.";
}

function holdingColor(symbol) {
  const w = watchlistRows().find((item) => item.symbol === symbol);
  if (w?.color) return w.color;
  const palette = dashboardBootstrap().holdingPalette || HOLDING_PALETTE;
  const syms = paperPositionSymbols().slice().sort();
  const idx = syms.indexOf(symbol);
  if (idx >= 0) return palette[idx % palette.length];
  return "var(--line)";
}

function portfolioTickerSet() {
  return new Set([...paperPositionSymbols(), ...watchlistRows().map((w) => w.symbol)]);
}

function isTrackedTicker(sym) {
  return marketSymbols().includes(sym) || portfolioTickerSet().has(sym);
}

function populateSymbolSelects() {
  const symbols = [
    ...new Set([
      ...marketSymbols(),
      ...paperPositionSymbols(),
      ...watchlistRows().map((w) => w.symbol)
    ])
  ].sort();
  for (const id of ["analysis-symbol", "order-symbol"]) {
    const select = document.getElementById(id);
    if (!select) continue;
    const current = select.value;
    select.innerHTML = symbols.map((sym) => `<option value="${escapeHtml(sym)}">${escapeHtml(sym)}</option>`).join("");
    if (symbols.includes(current)) select.value = current;
    else if (symbols.includes(state.activeAnalysisSymbol) && id === "analysis-symbol") {
      select.value = state.activeAnalysisSymbol;
    } else if (symbols.includes(state.tradeSymbol) && id === "order-symbol") {
      select.value = state.tradeSymbol;
    }
  }
}

function renderCausalityTickerRow() {
  const row = document.querySelector(".causality-ticker-row");
  if (!row) return;
  const list = contractWatchlist();
  if (!list.length) {
    row.innerHTML = `<span class="muted">No contract watchlist from server.</span>`;
    return;
  }
  row.innerHTML = list
    .map(
      (item, index) =>
        `<button type="button" class="causality-ticker-btn${index === 0 ? " active" : ""}" data-cticker="${escapeHtml(item.symbol)}">${escapeHtml(item.symbol)}</button>`
    )
    .join("");
}

async function loadDashboardBootstrap() {
  try {
    const [boot, wl] = await Promise.all([
      fetchJson("/api/dashboard/bootstrap"),
      fetchJson("/api/watchlist").catch(() => ({ symbols: [] }))
    ]);
    state.dashboardBootstrap = boot;
    const fromDb = Array.isArray(wl.symbols) ? wl.symbols.map((s) => String(s).toUpperCase()).filter(Boolean) : [];
    const fromDefault = (boot.watchlistDefault || []).map((w) => w.symbol).filter(Boolean);
    state.watchlistSymbols = fromDb.length ? fromDb : fromDefault;
    if (!state._symbolFromUrl) {
      const defaultSym =
        boot.defaultAnalysisSymbol ||
        marketsDefaultSymbols().find((s) => !["SPY", "QQQ"].includes(s)) ||
        "SPY";
      state.activeAnalysisSymbol = defaultSym;
      state.tradeSymbol = state.tradeSymbol || defaultSym;
    }
    populateSymbolSelects();
    renderCausalityTickerRow();
  } catch (error) {
    console.warn("[bootstrap] dashboard config unavailable", error);
    state.dashboardBootstrap = { source: "unavailable" };
  } finally {
    dashboardReadyResolve();
  }
}

function formatSpendZ(z) {
  if (z == null || Number.isNaN(Number(z))) return "—";
  const n = Number(z);
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}σ`;
}

function lobbyZClass(z) {
  const n = Number(z);
  if (Number.isNaN(n)) return "";
  if (n >= 1.2) return "lobby-z-hot";
  if (n <= -0.8) return "lobby-z-cool";
  return "lobby-z-mid";
}

function formatBillAnalogText(bill) {
  const h = bill.historicalAnalog || bill.analog;
  if (!h) return "";
  if (typeof h === "string") return h;
  return [h.title, h.outcome, h.impact].filter(Boolean).join(" — ");
}

function billMomentum(bill) {
  return Number(bill?.legislativeMomentum ?? bill?.passageOdds ?? 0);
}

function billConfidenceLabel(bill) {
  return bill?.signalConfidence || bill?.confidence || "Low";
}

function twelveWordSummary(text) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "—";
  const slice = words.slice(0, 12).join(" ");
  return words.length > 12 ? `${slice}…` : slice;
}

function industryStanceForBill(bill) {
  const against = Number(bill.lobbyingAgainst || 0);
  const fo = Number(bill.lobbyingFor || 0);
  if (against > fo * 1.02) return { text: "Industry opposes", kind: "opp" };
  if (fo > against * 1.02) return { text: "Industry supports", kind: "for" };
  return { text: "Mixed industry signals", kind: "mix" };
}

function watchForBullets(bill) {
  if (Array.isArray(bill.nextWatchItems) && bill.nextWatchItems.length) {
    return bill.nextWatchItems.slice(0, 3);
  }
  const parts = String(bill.nextWatch || "")
    .split(/[.;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = parts.slice(0, 3);
  if (out.length < 3 && bill.latestAction) out.push(`Latest action: ${bill.latestAction.slice(0, 140)}${bill.latestAction.length > 140 ? "…" : ""}`);
  if (out.length < 3) out.push(bill.floorScheduled ? "Watch for a possible floor vote or scheduling update." : "Watch for committee movement and new cosponsors.");
  if (out.length < 3) out.push("Watch for new lobbying filings tied to this issue.");
  return out.slice(0, 3);
}

function billStatusInfo(bill) {
  const status = String(bill?.status || "introduced").toLowerCase();
  return bill?.statusInfo || {
    key: status,
    label: status || "introduced",
    tone: status.includes("pass") ? "green" : status.includes("committee") || status.includes("markup") ? "amber" : "neutral",
    nextStep: "Watch the next official action.",
    marketMeaning: bill?.signal || "No detailed status explanation is available yet.",
    stagePath: bill?.stagePath || []
  };
}

function toneClassFromStatus(tone) {
  if (tone === "green") return "green";
  if (tone === "red") return "red";
  if (tone === "amber") return "amber";
  return "neutral";
}

function stageColorForBill(bill) {
  const tone = billStatusInfo(bill).tone;
  if (tone === "green") return "var(--green)";
  if (tone === "red") return "var(--red)";
  if (tone === "amber") return "var(--amber)";
  return "var(--faint)";
}

function stageTrackHtml(bill) {
  const info = billStatusInfo(bill);
  const path = Array.isArray(bill.stagePath) && bill.stagePath.length ? bill.stagePath : info.stagePath || [];
  if (!path.length) return "";
  return `<div class="stage-track policy-stage-track" aria-label="Bill status path">${path.map((stage, index) => {
    const state = stage.state || "todo";
    const line = index < path.length - 1
      ? `<div class="stage-line ${state === "done" ? "done" : ""}"></div>`
      : "";
    return `<div class="stage-node ${escapeHtml(state)}">${escapeHtml(stage.label || stage.key || "")}</div>${line}`;
  }).join("")}</div>`;
}

function momentumDriversHtml(bill, opts = {}) {
  const drivers = Array.isArray(bill.momentumDrivers) ? bill.momentumDrivers : [];
  if (!drivers.length) return "";
  const slice = drivers.slice(0, opts.compact ? 2 : 4);
  return `<div class="momentum-driver-stack ${opts.compact ? "compact" : ""}">
    ${slice.map((driver) => `
      <div class="momentum-driver ${toneClassFromStatus(driver.tone)}">
        <div>
          <strong>${escapeHtml(driver.label || "Score driver")}</strong>
          <p>${escapeHtml(driver.detail || "")}</p>
        </div>
        <span>${Number(driver.value || 0)}/100</span>
      </div>
    `).join("")}
  </div>`;
}

function catalystCandidates() {
  const fromServer = Array.isArray(state.policyCatalysts) ? state.policyCatalysts : [];
  if (fromServer.length) return fromServer;
  return policyBills()
    .map((bill) => bill.catalyst)
    .filter(Boolean)
    .sort((a, b) => Number(b.urgency || 0) - Number(a.urgency || 0))
    .slice(0, 6);
}

function renderPolicyCatalysts() {
  const targets = [$("#policy-catalyst-feed"), $("#bill-catalyst-feed")].filter(Boolean);
  if (!targets.length) return;
  const catalysts = catalystCandidates().slice(0, 4);
  const html = catalysts.length
    ? catalysts.map((item) => {
        const tone = toneClassFromStatus(item.tone);
        return `
          <article class="policy-catalyst-card ${tone} actionable-card" ${drilldownAttrs("bills", { billId: item.billId, filter: item.billId }, `Open ${item.billId}`)}>
            <div class="policy-catalyst-top">
              <span class="mini-pill ${tone === "green" ? "green" : ""}">${escapeHtml(item.label || "Catalyst")}</span>
              <span class="policy-catalyst-score">${Number(item.urgency || 0)}/100</span>
            </div>
            <h3>${escapeHtml(item.title || item.billId || "")}</h3>
            <p>${escapeHtml(item.nextStep || item.summary || "")}</p>
            <div class="policy-catalyst-meta">
              <span>${escapeHtml(item.dateLabel || "No date posted")}</span>
              <span>${escapeHtml((item.tickers || []).join(", ") || "No mapped tickers")}</span>
              <span>Momentum ${Number(item.momentum || 0)}/100</span>
            </div>
          </article>
        `;
      }).join("")
    : `<article class="empty-state">No near-term Congress catalysts loaded yet. Refresh bills or try a ticker filter.</article>`;
  targets.forEach((target) => {
    target.innerHTML = html;
  });
  const source = $("#policy-catalyst-source");
  if (source) source.textContent = catalysts.length ? `${catalysts.length} active watches` : "Waiting";
}

function drilldownAttrs(action, fields = {}, label = "") {
  const attrs = [`data-drill-action="${escapeHtml(action)}"`, 'role="link"', 'tabindex="0"'];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    const dataKey = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    attrs.push(`data-${dataKey}="${escapeHtml(value)}"`);
  }
  if (label) attrs.push(`aria-label="${escapeHtml(label)}"`);
  return attrs.join(" ");
}

function tickerSourceUrl(symbol) {
  const sym = String(symbol || "").toUpperCase();
  if (sym === "BTC" || sym === "BITCOIN") return "https://www.coingecko.com/en/coins/bitcoin";
  if (sym === "ETH" || sym === "ETHEREUM") return "https://www.coingecko.com/en/coins/ethereum";
  if (sym === "SOL" || sym === "SOLANA") return "https://www.coingecko.com/en/coins/solana";
  return `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(sym.toLowerCase())}`;
}

function normalizedPublicStockSymbol(symbol) {
  return String(symbol || "").toUpperCase().replace(/[^A-Z.]/g, "");
}

function publicStockCardUrl(symbol) {
  const sym = normalizedPublicStockSymbol(symbol);
  return sym ? `/stock/${encodeURIComponent(sym)}` : "/stock/NVDA";
}

function shareCardLink(symbol, label = "Share Card") {
  const sym = normalizedPublicStockSymbol(symbol);
  if (!sym || sym === "BTC" || sym === "ETH" || sym === "SOL") return "";
  return `<a class="ticker-share-link" href="${publicStockCardUrl(sym)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${escapeHtml(label)}</a>`;
}

function billSourceUrl(bill) {
  const id = String(bill?.id || "");
  if (bill?.exactCongressRecord === false || bill?.sourceKind === "tradesimple_modeled_seed") {
    return `https://www.congress.gov/search?q=${encodeURIComponent(bill?.title || bill?.shortTitle || id || "market bill")}`;
  }
  const match = id.match(/^(H\.R\.|S\.|HR|HRES|SRES|HJRES|SJRES)\s*\.?(\d+)-(\d+)$/i);
  if (!match) return `https://www.congress.gov/search?q=${encodeURIComponent(id || bill?.title || "market bill")}`;
  const rawType = match[1].replace(/\./g, "").toLowerCase();
  const number = match[2];
  const congress = match[3];
  const typePath = {
    hr: "house-bill",
    hres: "house-resolution",
    hjres: "house-joint-resolution",
    s: "senate-bill",
    sres: "senate-resolution",
    sjres: "senate-joint-resolution"
  }[rawType] || "bill";
  return `https://www.congress.gov/bill/${congress}th-congress/${typePath}/${number}`;
}

function billSourceLabel(bill) {
  return bill?.exactCongressRecord === true ? "Open exact Congress.gov record" : "Search Congress.gov by title";
}

function billSourceNote(bill) {
  if (bill?.exactCongressRecord === true) return "Exact Congress.gov bill record.";
  return bill?.sourceNote || "Modeled TradeSimple seed. Its internal bill-style ID may not match a real Congress.gov bill number.";
}

function usaspendingSearchUrl(company, recipientId) {
  if (recipientId) {
    return `https://www.usaspending.gov/recipient/${encodeURIComponent(recipientId)}/`;
  }
  return `https://www.usaspending.gov/keyword_search/?keyword=${encodeURIComponent(company || "")}`;
}

function contractAwardDirectUrl(award) {
  if (award?.directUrl) return award.directUrl;
  const id = award?.internalId || award?.generated_internal_id;
  if (id) return `https://www.usaspending.gov/award/${id}/`;
  if (award?.numericId != null && award?.numericId !== "") {
    return `https://www.usaspending.gov/award/${award.numericId}/`;
  }
  return null;
}

function contractAwardDisplayDescription(award) {
  if (award?.description && String(award.description).trim()) return String(award.description).trim();
  const parts = [];
  if (award?.contractType) parts.push(award.contractType);
  if (award?.awardId) parts.push(`Contract ${award.awardId}`);
  if (award?.awardingAgency) parts.push(award.awardingAgency);
  return parts.length ? parts.join(" · ") : null;
}

function contractAwardPeriodLabel(award) {
  const start = award?.startDate || award?.periodOfPerformance?.startDate;
  const end = award?.endDate || award?.periodOfPerformance?.endDate;
  const fmt = (d) => {
    if (!d) return "";
    const t = new Date(d);
    return Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : String(d);
  };
  const period = [fmt(start), fmt(end)].filter(Boolean).join(" → ");
  return period || "Period not listed";
}

function normalizeContractAward(row) {
  const normalized = {
    ...row,
    startDate: row.startDate || row.periodOfPerformance?.startDate || null,
    endDate: row.endDate || row.periodOfPerformance?.endDate || null
  };
  normalized.directUrl = contractAwardDirectUrl(normalized);
  normalized.description = contractAwardDisplayDescription(normalized);
  return normalized;
}

function analysisFocusBills() {
  if (state.policyNetwork?.focusBills?.length) return state.policyNetwork.focusBills;
  return state.analysis?.legisAlert || [];
}

function setupAnalysisTabs() {
  const buttons = document.querySelectorAll("[data-analysis-tab]");
  const panels = document.querySelectorAll("[data-analysis-panel]");
  if (!buttons.length) return;
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.analysisTab;
      buttons.forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      panels.forEach((p) => {
        p.hidden = p.dataset.analysisPanel !== tab;
      });
    });
  });
}

function setupAnalysisTickerAi() {
  const btn = $("#analysis-ticker-ai-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    openGlobalResearchDrawer();
    const q = $("#research-question");
    if (q && state.activeAnalysisSymbol) {
      q.value = `Help me understand policy, lobbying, and fundamentals for ${state.activeAnalysisSymbol}.`;
      q.focus();
    }
  });
}

function setupAnalysisLobbyBillJump() {
  const mapped = $("#analysis-lobby-mapped");
  if (!mapped) return;
  mapped.addEventListener("click", (event) => {
    const btn = event.target.closest(".analysis-jump-bill");
    const billId = btn?.dataset?.billId;
    if (!billId) return;
    event.preventDefault();
    showView("bills");
    const filter = $("#bill-filter");
    if (filter) filter.value = billId;
    renderBills();
  });
}

function setupWatchlistStripInteraction() {
  const strip = $("#watchlist-strip");
  if (!strip) return;
  if (strip.dataset.interactionReady === "true") return;
  strip.dataset.interactionReady = "true";
  strip.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-watch-symbol]");
    const sym = chip?.dataset?.watchSymbol;
    if (!sym) return;
    openTickerAnalysis(sym);
  });
}

function setupDashboardDrilldowns() {
  if (document.body.dataset.drilldownsReady === "true") return;
  document.body.dataset.drilldownsReady = "true";

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-drill-action]");
    if (!target) return;
    const nestedControl = event.target.closest("a, button, input, select, textarea, label");
    if (nestedControl && nestedControl !== target) return;
    event.preventDefault();
    activateDrilldown(target.dataset);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest("[data-drill-action]");
    if (!target || target !== event.target) return;
    event.preventDefault();
    activateDrilldown(target.dataset);
  });
}

function activateDrilldown(data) {
  const action = data.drillAction;
  if (action === "analysis") return openTickerAnalysis(data.symbol);
  if (action === "trade") return openTradeForSymbol(data.symbol || state.tradeSymbol);
  if (action === "bills") return openBillsDrilldown(data.billId || data.filter || "");
  if (action === "contracts") return openContractsDrilldown(data.company || data.symbol || "");
  if (action === "source" && data.url) return window.open(data.url, "_blank", "noopener,noreferrer");
  if (action === "view" && data.viewName) return showView(data.viewName);
}

function openTickerAnalysis(symbol) {
  const sym = String(symbol || "").toUpperCase().replace(/[^A-Z.]/g, "");
  if (!sym) return;
  if (!isTrackedTicker(sym)) {
    showView("markets");
    return;
  }
  state.activeAnalysisSymbol = sym;
  const sel = $("#analysis-symbol");
  if (sel && [...sel.options].some((option) => option.value === sym || option.textContent === sym)) sel.value = sym;
  showView("analysis");
  loadAnalysis(sym);
}

function openTradeForSymbol(symbol, options = {}) {
  const sym = String(symbol || "").toUpperCase().replace(/[^A-Z.]/g, "");
  if (!sym) return showView("trade");
  const orderSelect = $("#order-symbol");
  if (orderSelect && ![...orderSelect.options].some((option) => option.value === sym)) {
    const opt = document.createElement("option");
    opt.value = sym;
    opt.textContent = sym;
    orderSelect.appendChild(opt);
  }
  state.tradeSymbol = sym;
  if (orderSelect) orderSelect.value = sym;
  const sideSelect = $("#order-side");
  if (options.side && sideSelect) sideSelect.value = options.side;
  const qtyInput = $("#order-qty");
  if (options.qty != null && qtyInput) qtyInput.value = String(options.qty);
  showView("trade");
  loadTradeHistory(sym, state.tradeRange);
  if (options.thesisNote && $("#order-result")) {
    $("#order-result").textContent = options.thesisNote;
  }
}

function openBillsDrilldown(filter = "") {
  showView("bills");
  const value = String(filter || "").trim();
  const input = $("#bill-filter");
  if (input) input.value = value;
  renderBills();
  if (!value) return;
  requestAnimationFrame(() => {
    const rows = [...document.querySelectorAll("#bill-feed tr[data-bill-toggle]")];
    const row = rows.find((item) => item.textContent.toLowerCase().includes(value.toLowerCase()));
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    const detail = document.getElementById(row.dataset.billToggle);
    if (detail) detail.hidden = false;
  });
}

function openContractsDrilldown(company = "") {
  showView("contracts");
  const value = String(company || "").trim().toLowerCase();
  if (!value) return;
  requestAnimationFrame(() => {
    const row = [...document.querySelectorAll("#contracts-body tr[data-company]")]
      .find((item) => item.dataset.company.toLowerCase().includes(value) || item.textContent.toLowerCase().includes(value));
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.classList.add("row-flash");
    window.setTimeout(() => row?.classList.remove("row-flash"), 1400);
  });
}

function setupBillsFeedInteraction() {
  const feed = $("#bill-feed");
  if (!feed) return;
  if (feed.dataset.interactionReady === "true") return;
  feed.dataset.interactionReady = "true";
  const toggleRow = (row) => {
    const detailsId = row?.dataset?.billToggle;
    if (!detailsId) return;
    const target = document.getElementById(detailsId);
    if (target) target.hidden = !target.hidden;
  };
  feed.addEventListener("click", (event) => {
    const row = event.target.closest("[data-bill-toggle]");
    toggleRow(row);
  });
  feed.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-bill-toggle]");
    if (!row) return;
    event.preventDefault();
    toggleRow(row);
  });
}

function setupAnalysisBillsInteraction() {
  const tbody = $("#analysis-bills-tbody");
  if (!tbody) return;
  if (tbody.dataset.interactionReady === "true") return;
  tbody.dataset.interactionReady = "true";

  function activate(row) {
    const detailId = row?.dataset?.analysisBillDetail;
    if (!detailId) return;
    const target = document.getElementById(detailId);
    const willOpen = !!(target?.hidden);
    toggleAnalysisBillDetail(detailId);
    document.querySelectorAll(".analysis-bill-row").forEach((r) => {
      r.setAttribute("aria-expanded", r === row && willOpen ? "true" : "false");
    });
  }

  tbody.addEventListener("click", (event) => {
    const row = event.target.closest(".analysis-bill-row");
    if (!row) return;
    activate(row);
  });
  tbody.addEventListener("keydown", (event) => {
    const row = event.target.closest(".analysis-bill-row");
    if (!row) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(row);
    }
  });
}

function analysisPlainImpactSentence(text) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return "Impact not summarized for this filing.";
  const first = t.split(/(?<=[.!?])\s+/)[0] || t;
  return first.length > 220 ? `${first.slice(0, 217)}…` : first;
}

function analysisLobbyRecencyLine(filing) {
  const d = filing.filingDate || filing.date || filing.periodEnd || filing.quarter || "";
  return d ? `Filed ${d}` : "Filing period not shown in this dataset";
}

function toggleAnalysisBillDetail(detailId) {
  const row = document.getElementById(detailId);
  if (!row) return;
  const opening = row.hidden;
  document.querySelectorAll(".analysis-bill-detail-row").forEach((r) => {
    r.hidden = true;
  });
  document.querySelectorAll(".analysis-bill-row").forEach((r) => {
    r.classList.remove("expanded");
  });
  if (opening) {
    row.hidden = false;
    document.querySelector(`[data-analysis-bill-detail="${detailId}"]`)?.classList.add("expanded");
  }
}

function renderAnalysisBillsTable(symbol) {
  const tbody = $("#analysis-bills-tbody");
  const emptyEl = $("#analysis-bills-empty");
  const billsPanel = document.querySelector('#view-analysis [data-analysis-panel="bills"]');
  const tableWrap = billsPanel?.querySelector(".table-wrap");
  if (!tbody) return;

  const bills = analysisFocusBills();
  if (!bills.length) {
    tbody.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent =
        "No bills are currently mapped to this ticker. This means no legislation in our tracked set directly names this company or sector. This is useful information — it suggests lower near-term policy risk.";
    }
    if (tableWrap) tableWrap.hidden = true;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  if (tableWrap) tableWrap.hidden = false;

  tbody.innerHTML = bills
    .map((bill, idx) => {
      const mom = billMomentum(bill);
      const lob = Number(bill.lobbyingPressureScore ?? 0);
      const stance = industryStanceForBill(bill);
      const momCls = mom >= 67 ? "high" : mom < 35 ? "low" : "medium";
      const lobCls = lob >= 67 ? "high" : lob < 35 ? "low" : "medium";
      const titleLine = bill.shortTitle || bill.title || "—";
      const what = twelveWordSummary(bill.plainEnglish || bill.signal || bill.title || "");
      const stage = String(bill.status || "introduced").toLowerCase();
      const tickers = (bill.affected || []).join(", ");
      const stanceClass =
        stance.kind === "for" ? "industry-stance-for" : stance.kind === "opp" ? "industry-stance-opp" : "industry-stance-mix";
      const stanceLabel = stance.text;
      const safeId = String(bill.id || idx).replace(/[^a-zA-Z0-9_-]/g, "");
      const detailId = `analysis-bill-detail-${safeId}-${idx}`;
      const lobbyList = bill.stakeholders?.lobbying || [];
      const lobbyRows =
        lobbyList.length > 0
          ? lobbyList
              .map(
                (l) =>
                  `<li><strong>${escapeHtml(l.name || "")}</strong> — ${money(Number(l.amount || 0))}${
                    l.issue ? ` · ${escapeHtml(l.issue)}` : ""
                  }</li>`
              )
              .join("")
          : "<li>No firm-level lobbying lines are mapped to this bill in the dataset.</li>";
      const watches = watchForBullets(bill)
        .map((w) => `<li>${escapeHtml(w)}</li>`)
        .join("");
      return `
      <tr class="analysis-bill-row" data-analysis-bill-detail="${detailId}" role="button" tabindex="0" aria-expanded="false">
        <td>
          <div class="analysis-bill-cell-title">
            <span class="mono">${escapeHtml(bill.id || "")}</span>
            <span>${escapeHtml(titleLine)}</span>
          </div>
        </td>
        <td>${escapeHtml(what)}</td>
        <td>${escapeHtml(stage)}</td>
        <td><span class="score-badge ${momCls}">${mom}/100</span></td>
        <td><span class="score-badge ${lobCls}">${lob}/100</span></td>
        <td><span class="${stanceClass}">${escapeHtml(stanceLabel)}</span></td>
        <td class="mono">${escapeHtml(tickers)}</td>
      </tr>
      <tr id="${detailId}" class="analysis-bill-detail-row" hidden>
        <td colspan="7">
          <div class="analysis-bill-detail">
            <p>${escapeHtml(bill.plainEnglish || bill.signal || "")}</p>
            <h4>Lobbying firms and spend</h4>
            <ul class="analysis-bill-lobby-list">${lobbyRows}</ul>
            <h4>Watch for:</h4>
            <ul>${watches}</ul>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");
}

function renderAnalysisLobbyTab() {
  const mappedEl = $("#analysis-lobby-mapped");
  const otherEl = $("#analysis-lobby-other");
  const toggleBtn = $("#analysis-lobby-other-toggle");
  if (!mappedEl || !otherEl || !toggleBtn) return;

  renderLobbyMappingStatus(state.analysis?.lobbyMapping);

  const sym = state.activeAnalysisSymbol;
  const filings = state.lobbying || [];
  const mapped = [];
  const other = [];

  for (const filing of filings) {
    const rel = relatedBillForFiling(filing);
    if (rel?.bill && (rel.bill.affected || []).includes(sym)) {
      mapped.push({ filing, bill: rel.bill, relationship: rel.relationship });
    } else {
      other.push(filing);
    }
  }

  if (mapped.length) {
    mappedEl.innerHTML = mapped
      .map(({ filing, bill, relationship }) => {
        const impactSrc = relationship || bill.relationshipSummary || bill.impact || bill.plainEnglish || bill.signal || "";
        const impactLine = analysisPlainImpactSentence(impactSrc);
        const billTitle = (bill.shortTitle || bill.title || bill.id || "").slice(0, 72);
        return `
        <div class="analysis-lobby-item">
          <div class="analysis-lobby-item-head"><strong>${escapeHtml(filing.client || "")}</strong></div>
          <div class="lobby-reg">${escapeHtml(filing.registrant || "")}</div>
          <div class="analysis-lobby-spend-row">
            <span class="lobby-spend">${money(Number(filing.amount || 0))}</span>
            <span class="muted">${escapeHtml(analysisLobbyRecencyLine(filing))}</span>
          </div>
          ${filing.issue ? `<span class="mini-pill">${escapeHtml(filing.issue)}</span>` : ""}
          <div class="analysis-lobby-bill-line">
            <button type="button" class="link-button analysis-jump-bill" data-bill-id="${escapeHtml(bill.id || "")}">
              ${escapeHtml(bill.id || "")} — ${escapeHtml(billTitle)}${billTitle.length >= 72 ? "…" : ""}
            </button>
          </div>
          <p class="muted" style="margin:8px 0 0;font-size:13px;line-height:1.5">${escapeHtml(impactLine)}</p>
        </div>`;
      })
      .join("");
  } else {
    mappedEl.innerHTML = `<p class="muted">No lobbying filings in the current feed are connected to a bill that names ${escapeHtml(
      sym
    )}. That can mean spend is broad-issue, not yet mapped in our model, or simply absent from the snapshot.</p>`;
  }

  toggleBtn.replaceWith(toggleBtn.cloneNode(true));
  const newToggle = $("#analysis-lobby-other-toggle");
  otherEl.innerHTML = "";
  if (!other.length) {
    newToggle.hidden = true;
    otherEl.hidden = true;
    return;
  }

  newToggle.hidden = false;
  otherEl.hidden = true;
  newToggle.textContent = `Show ${other.length} other filing${other.length === 1 ? "" : "s"}`;

  otherEl.innerHTML = other
    .map(
      (f) => `
    <div class="analysis-lobby-compact">
      <div><strong>${escapeHtml(f.client || "")}</strong> <span class="lobby-reg">${escapeHtml(f.registrant || "")}</span></div>
      <div class="analysis-lobby-compact-meta"><span>${escapeHtml(f.issue || "—")}</span> · <span class="mono">${money(
        Number(f.amount || 0)
      )}</span></div>
    </div>`
    )
    .join("");

  newToggle.addEventListener("click", () => {
    otherEl.hidden = !otherEl.hidden;
    newToggle.textContent = otherEl.hidden
      ? `Show ${other.length} other filing${other.length === 1 ? "" : "s"}`
      : "Hide other filings";
  });
}

function contractCrsDisplay(award, symbol) {
  const sig = award?.eventSignal;
  if (sig?.label) {
    const crsLabel =
      sig.pricedInAssessment === "Likely already priced in"
        ? "Likely priced in"
        : sig.score >= 75 || sig.pricedInAssessment === "More likely new information"
          ? "Higher signal"
          : "Monitor";
    const crsClass =
      crsLabel === "Higher signal" ? "green" : crsLabel === "Likely priced in" ? "neutral" : "";
    return { crsLabel, crsClass, title: `Contract Revenue Signal: ${sig.plainEnglish || sig.label}` };
  }
  const agName = award?.awardingAgency || "";
  const agLower = agName.toLowerCase();
  const agScore = agLower.includes("health") || agLower.includes("veteran") ? 85
    : agLower.includes("homeland") || agLower.includes("transport") ? 70
    : agLower.includes("energy") || agLower.includes("education") ? 65
    : agLower.includes("defense") || agLower.includes("army") || agLower.includes("navy") || agLower.includes("air force") ? 35
    : agLower.includes("general services") ? 45 : 55;
  const logAmt = Math.log(Math.max(Number(award?.obligatedAmount) || 1e6, 1e6));
  const novelty = Math.round(Math.min(100, Math.max(0, (23.0 - logAmt) / (23.0 - 16.1) * 100)));
  const crsLabel = agScore >= 70 && novelty >= 50 ? "Higher signal"
    : agScore <= 40 && novelty <= 30 ? "Likely priced in"
    : "Monitor";
  const crsClass = agScore >= 70 && novelty >= 50 ? "green"
    : agScore <= 40 && novelty <= 30 ? "neutral" : "";
  return {
    crsLabel,
    crsClass,
    title: `Contract Revenue Signal: how likely this award contains new information (${symbol || "tracked contractor"})`
  };
}

function renderMoneyTrailPanel(trail) {
  const panel = $("#analysis-money-trail");
  const chainEl = $("#money-trail-chain");
  const limitsEl = $("#money-trail-limits");
  if (!panel || !chainEl) return;
  if (!trail) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  chainEl.innerHTML = (trail.chain || [])
    .map(
      (step) => `
      <div class="money-trail-step">
        <span class="money-trail-step-label">${escapeHtml(step.label)}</span>
        <div>
          <div class="money-trail-step-value">${escapeHtml(step.value)}</div>
          <div class="money-trail-step-explain">${escapeHtml(step.explanation)}</div>
        </div>
      </div>`
    )
    .join("");
  if (limitsEl) {
    limitsEl.innerHTML = (trail.limitations || []).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  }
}

function renderContractInsightBanner(analysis) {
  const banner   = $("#analysis-contract-insight");
  const pill     = $("#contract-archetype-pill");
  const dogePill = $("#contract-doge-pill");
  const explain  = $("#contract-archetype-explain");
  const bull     = $("#contract-bull");
  const bear     = $("#contract-bear");
  const cp = analysis?.contractProfile;
  if (!banner) return;
  if (!cp) { banner.hidden = true; return; }
  banner.hidden = false;
  if (pill)     pill.textContent    = cp.archetype || "";
  if (dogePill) dogePill.hidden     = !cp.dogeRisk;
  if (explain)  explain.textContent = cp.archetypeExplain || cp.note || "";
  if (bull)     bull.textContent    = cp.bull || "";
  if (bear)     bear.textContent    = cp.bear || "";
}

function renderAnalysisPolicyChains(chains) {
  const targets = [$("#analysis-policy-chains"), $("#analysis-stock-policy-chains")].filter(Boolean);
  if (!targets.length) return;
  if (!chains || !chains.length) {
    targets.forEach((el) => {
      el.innerHTML = "";
    });
    return;
  }
  const html = chains.map((chain) => {
    const toneClass = chain.tone === "green" ? "green" : chain.tone === "red" ? "red" : "amber";
    const steps = (chain.steps || []).map((step) =>
      `<div class="chain-step">
        <span class="chain-step-label mono">${escapeHtml(step.label)}</span>
        <span class="chain-step-text">${escapeHtml(step.text)}</span>
      </div>`
    ).join("");
    return `
      <div class="policy-chain-card ${toneClass}-card">
        <div class="chain-head">
          <strong>${escapeHtml(chain.title)}</strong>
        </div>
        <p class="chain-summary muted">${escapeHtml(chain.summary)}</p>
        <div class="chain-steps">${steps}</div>
      </div>
    `;
  }).join("");
  targets.forEach((el) => {
    el.innerHTML = html;
  });
}

function renderAnalysisContractsTab(symbol, companyName) {
  const tbody = $("#analysis-contracts-tbody");
  if (!tbody) return;
  const co = companyName || symbol;
  const watch = contractWatchlist().find((w) => w.symbol === symbol);
  const fetchCo = watch?.company || co;
  const cached = state.contractCache[symbol] || state.contracts.find((r) => r.symbol === symbol);
  if (!cached) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Loading live USASpending.gov awards for <strong>${escapeHtml(co)}</strong>…</td></tr>`;
    loadAnalysisContractsData(symbol, fetchCo);
    return;
  }
  if (cached.loading) {
    tbody.innerHTML = `<tr><td colspan="6">Loading live awards for ${escapeHtml(co)}…</td></tr>`;
    return;
  }
  if (cached.error || !cached.results?.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      No recent federal contract awards found for ${escapeHtml(co)} in USASpending.gov.
      <a class="link-button" href="${usaspendingSearchUrl(fetchCo, cached.recipientId)}" target="_blank" rel="noopener noreferrer">Search directly ↗</a>
    </td></tr>`;
    return;
  }

  const now = Date.now();
  const rows = (cached.results || []).slice(0, 8);
  tbody.innerHTML = rows.map((award, idx) => {
    const normalized = normalizeContractAward(award);
    const daysToEnd = normalized.endDate
      ? Math.round((new Date(normalized.endDate).getTime() - now) / 864e5)
      : null;
    const status = daysToEnd == null ? "Unknown"
      : daysToEnd < 0 ? "Expired"
      : daysToEnd <= 90 ? "Expires soon"
      : daysToEnd <= 365 ? "Active"
      : "Active";
    const sClass = daysToEnd == null ? "neutral"
      : daysToEnd < 0 ? "low"
      : daysToEnd <= 90 ? "medium"
      : "neutral";
    const period = contractAwardPeriodLabel(normalized);
    const fullDesc = contractAwardDisplayDescription(normalized) || "No description";
    const desc = fullDesc.slice(0, 120) + (fullDesc.length > 120 ? "…" : "");
    const linkUrl = contractAwardDirectUrl(normalized) || usaspendingSearchUrl(fetchCo, cached.recipientId);
    const { crsLabel, crsClass, title: crsTitle } = contractCrsDisplay(award, symbol);
    const trail = award.moneyTrail || null;
    return `
      <tr class="contract-award-row-click" data-award-idx="${idx}" style="cursor:${trail ? "pointer" : "default"}">
        <td>
          <div>${escapeHtml(normalized.awardingAgency || "Agency not listed")}</div>
          <small class="muted mono">${escapeHtml(normalized.awardId || "")}</small>
        </td>
        <td title="${escapeHtml(fullDesc)}">${escapeHtml(desc)}</td>
        <td class="mono">${compactMoney(normalized.obligatedAmount || 0)}</td>
        <td class="muted mono" style="font-size:11px">${escapeHtml(period)}</td>
        <td>
          <span class="score-badge ${sClass}">${status}</span>
          <span class="mini-pill ${crsClass}" title="${escapeHtml(crsTitle)}">${escapeHtml(crsLabel)}</span>
        </td>
        <td>
          <a class="link-button" href="${linkUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">↗</a>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".contract-award-row-click").forEach((row) => {
    row.addEventListener("click", () => {
      const idx = Number(row.dataset.awardIdx);
      const award = rows[idx];
      if (award?.moneyTrail) renderMoneyTrailPanel(award.moneyTrail);
    });
  });
}

async function loadAnalysisContractsData(symbol, companyName) {
  if (state.contractCache[symbol]?.loading) return;
  state.contractCache[symbol] = { loading: true };
  try {
    const data = await fetchJson(`/api/contracts/${encodeURIComponent(companyName || symbol)}`);
    state.contractCache[symbol] = summarizeContractResults({ symbol, company: companyName || symbol }, data);
  } catch (error) {
    console.error("[contracts] analysis fetch failed", error);
    state.contractCache[symbol] = { error: true, results: [] };
  }
  if (state.activeAnalysisSymbol === symbol) renderAnalysisContractsTab(symbol, companyName);
}

const state = {
  config: null,
  session: null,
  quotes: [],
  crypto: [],
  bills: [],
  lobbying: [],
  account: null,
  contracts: [],
  contractsLoadedAt: null,
  contractCache: {},
  dataMeta: {},
  feedTimers: [],
  feedInflight: {},
  quoteFeedSource: "",
  byok: {
    provider: null,
    key: null,
    model: null
  },
  analysis: null,
  policyNetwork: null,
  policyCatalysts: [],
  methodology: null,
  activeAnalysisSymbol: "NVDA",
  readerMode: getStoredReaderMode(),
  tradeSymbol: "NVDA",
  tradeRange: "1d",
  tradeHistory: null,
  portfolioEquityHistory: [],
  portfolioChartBootstrapped: false,
  pendingThesisId: null,
  thesisRecords: [],
  funds: [],
  activeFundId: null,
  fundRange: "6m",
  fundPerformance: null,
  fundAttribution: null,
  fundPulse: null,
  fundTickerDraft: [],
  fundWeightDraft: {},
  fundPulseTimer: null,
  relationshipMapPayload: null,
  dashboardBootstrap: null,
  watchlistSymbols: [],
  _symbolFromUrl: false
};

document.addEventListener("DOMContentLoaded", () => {
  setupThemeToggle();
  setupReaderModeToggle();
  const page = document.body.dataset.page;
  if (page === "landing") initLanding();
  if (page === "dashboard") initDashboard();
});

async function initLanding() {
  initScrollReveal();
  const [config, session] = await Promise.all([fetchJson("/api/config"), fetchJson("/api/session")]);
  state.config = config;
  state.session = session;
  setupWaitlistForm();

  document.querySelectorAll("[data-provider]").forEach((link) => {
    const provider = link.dataset.provider;
    if (provider === "demo" && !config.auth.demo) setDisabled(link, "Demo disabled");
    if ((provider === "google" || provider === "apple") && !config.auth[provider]) {
      setDisabled(link, `Add ${provider} OAuth keys`);
    }
  });

  const sessionLink = document.querySelector("[data-session-link]");
  if (session?.user) {
    sessionLink.textContent = "Open terminal";
    sessionLink.href = "/dashboard?view=trade";
  } else if (config.auth.demo) {
    sessionLink.textContent = "Try demo terminal";
    sessionLink.href = "/auth/demo?next=/dashboard%3Fview%3Dtrade";
  }
}

function setupWaitlistForm() {
  const form = $("#waitlist-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#waitlist-email");
    const status = $("#waitlist-status");
    const button = form.querySelector("button");
    const email = input.value.trim();

    status.className = "waitlist-status";
    status.textContent = "Adding you to the early access list...";
    button.disabled = true;

    try {
      const response = await fetchJson("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, source: "landing_waitlist" })
      });
      status.className = "waitlist-status success";
      status.textContent = response.message || "You're on the waitlist.";
      input.value = "";
    } catch (error) {
      status.className = "waitlist-status error";
      status.textContent = error.message.includes("invalid_email")
        ? "Enter a valid email address."
        : "Could not join the waitlist. Try again in a moment.";
    } finally {
      button.disabled = false;
    }
  });
}

async function initDashboard() {
  const params = new URLSearchParams(window.location.search);
  const initialSymbol = String(params.get("symbol") || "").toUpperCase().replace(/[^A-Z.]/g, "");
  if (initialSymbol) state._symbolFromUrl = true;

  try {
    state.account = await fetchJson("/api/trading/account");
  } catch (e) {
    console.warn("[init] trading account prefetch failed", e);
  }

  setupNavigation();
  setupDashboardDrilldowns();
  setupForms();
  setupFilters();
  setupAnalysisControls();
  setupTradeControls();
  setupRefreshAllControl();
  setupMethodologyModal();
  setupResearchDrawer();
  setupAnalysisTabs();
  initMoneyTrailClose();
  setupAnalysisTickerAi();
  setupAnalysisLobbyBillJump();
  setupWatchlistStripInteraction();
  setupBillsFeedInteraction();
  setupAnalysisBillsInteraction();
  setupSignalChainInteraction();
  setupHypotheticalFunds();

  const [config, session] = await Promise.all([fetchJson("/api/config"), fetchJson("/api/session")]);
  state.config = config;
  state.session = session;
  loadByokFromStorage();
  renderSession();
  renderConnections();

  await loadDashboardBootstrap();

  if (initialSymbol) {
    state.activeAnalysisSymbol = initialSymbol;
    state.tradeSymbol = initialSymbol;
    const analysisSelect = $("#analysis-symbol");
    if (analysisSelect && ![...analysisSelect.options].some((o) => o.value === initialSymbol)) {
      const opt = document.createElement("option");
      opt.value = initialSymbol;
      opt.textContent = initialSymbol;
      analysisSelect.appendChild(opt);
    }
    const orderSelect = $("#order-symbol");
    if (orderSelect && ![...orderSelect.options].some((o) => o.value === initialSymbol)) {
      const opt = document.createElement("option");
      opt.value = initialSymbol;
      opt.textContent = initialSymbol;
      orderSelect.appendChild(opt);
    }
  }

  const initialView = params.get("view") || "overview";
  showView(initialView, false);

  await Promise.all([
    refreshTerminalData(),
    loadAnalysis(state.activeAnalysisSymbol),
    loadTradeHistory(state.tradeSymbol, state.tradeRange)
  ]);
  void refreshContractsFeed();
  setupEdgarControls();
  startLiveFeeds();
}

function startLiveFeeds() {
  state.feedTimers.forEach((timer) => clearInterval(timer));
  state.feedTimers = [
    setInterval(() => runFeed("market", refreshMarketFeed), LIVE_FEED_INTERVALS.marketMs),
    setInterval(() => runFeed("crypto", refreshCryptoFeed), LIVE_FEED_INTERVALS.cryptoMs),
    setInterval(() => runFeed("account", refreshAccountFeed), LIVE_FEED_INTERVALS.accountMs),
    setInterval(() => runFeed("policy", refreshPolicyFeed), LIVE_FEED_INTERVALS.policyMs),
    setInterval(() => runFeed("contracts", refreshContractsFeed), LIVE_FEED_INTERVALS.contractsMs),
    setInterval(() => runFeed("tradeHistory", refreshActiveTradeHistory), LIVE_FEED_INTERVALS.tradeHistoryMs),
    setInterval(() => runFeed("analysisChart", refreshActiveAnalysisChart), LIVE_FEED_INTERVALS.analysisChartMs),
    setInterval(() => runFeed("portfolioChart", refreshPortfolioChartLive), LIVE_FEED_INTERVALS.portfolioChartMs)
  ];

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      runFeed("resume", async () => {
        await Promise.allSettled([
          refreshMarketFeed(),
          refreshCryptoFeed(),
          refreshAccountFeed(),
          refreshPolicyFeed()
        ]);
      });
    }
  }, { once: true });
}

async function runFeed(name, task) {
  if (state.feedInflight[name]) return;
  state.feedInflight[name] = true;
  try {
    await task();
  } catch (error) {
    console.error(`[feed:${name}] refresh failed`, error);
  } finally {
    state.feedInflight[name] = false;
  }
}

function rememberFeedMeta(key, payload, fallbackSource = "") {
  if (!payload) return;
  state.dataMeta[key] = {
    source: payload.source || fallbackSource,
    confidence: payload.confidence || "",
    updatedAt: payload.updatedAt || new Date().toISOString()
  };
}

function renderSourceBadges() {
  updateSourceBadge("#market-source", "market");
  updateSourceBadge("#crypto-source", "crypto");
  updateSourceBadge("#bill-source", "bills");
  updateSourceBadge("#lobby-source", "lobbying");
  updateSourceBadge("#account-source", "account");
  updateSourceBadge("#contracts-source", "contracts");
  renderLiveFeedStatus();
}

function updateSourceBadge(selector, key) {
  const el = $(selector);
  if (!el) return;
  const meta = state.dataMeta[key];
  const label = sourceLabel(meta?.source || "connecting");
  const confidence = meta?.confidence ? ` · ${meta.confidence}` : "";
  el.innerHTML = `<span class="live-dot" aria-hidden="true"></span>${escapeHtml(label)} · ${freshnessText(meta?.updatedAt)}${escapeHtml(confidence)}`;
  el.classList.add("status-pill", "source-pill");
  el.classList.toggle("source-live", Boolean(meta?.updatedAt) && !String(meta.source || "").includes("fallback"));
  el.classList.toggle("source-fallback", String(meta?.source || "").includes("fallback"));
}

function renderLiveFeedStatus() {
  const el = $("#live-feed-status");
  if (!el) return;
  const market = state.dataMeta.market;
  const policy = state.dataMeta.bills;
  const parts = [
    market ? `markets ${freshnessText(market.updatedAt)}` : "markets connecting",
    policy ? `policy ${freshnessText(policy.updatedAt)}` : "policy connecting"
  ];
  el.innerHTML = `<span class="live-dot" aria-hidden="true"></span>${escapeHtml(parts.join(" / "))}`;
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
      await Promise.all([
        refreshTerminalData(),
        refreshContractsFeed(),
        loadAnalysis(state.activeAnalysisSymbol),
        loadTradeHistory(state.tradeSymbol, state.tradeRange)
      ]);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

async function refreshTerminalData() {
  const settled = await Promise.allSettled([
    refreshAccountFeed({ render: false }),
    refreshMarketFeed({ render: false }),
    refreshCryptoFeed({ render: false }),
    refreshPolicyFeed({ render: false })
  ]);

  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(["account", "market", "crypto", "policy"][index], "feed failed", result.reason);
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
    patchPortfolioChartLive();
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

function renderPortfolioChart() {
  const host = $("#portfolio-sparkline");
  if (!host || !window.TSCharts) return;

  const accountPayload = state.account;
  const equity = paperEquity(accountPayload);
  const points = state.portfolioEquityHistory.length
    ? state.portfolioEquityHistory
    : [{ date: new Date().toISOString(), value: equity, close: equity }];

  const hasPositions = (accountPayload?.positions || []).length > 0;
  const emptyMessage = hasPositions
    ? ""
    : "You have $100,000 simulated cash and no open positions. Place a paper trade in Account to see equity move with your holdings.";

  if (!host.dataset.tsChartMounted) {
    window.TSCharts.mount(host, {
      points,
      mode: "line",
      source: portfolioChartSourceLabel(),
      yLabel: "Portfolio value (USD)",
      xLabel: "Time →",
      height: 156,
      emptyMessage,
      formatMoney: money,
      formatDate: formatPointDate,
      liveLabel: "Updating with account feed"
    });
    host.dataset.tsChartMounted = "1";
  } else {
    window.TSCharts.update(host, {
      points,
      liveValue: equity,
      source: portfolioChartSourceLabel(),
      liveLabel: `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    });
  }
}

async function refreshPortfolioChartLive() {
  if (!$("#view-overview")?.classList.contains("active")) return;
  if (!state.account) return;
  recordPortfolioEquitySnapshot(state.account);
  renderPortfolioChart();
}

async function refreshMarketFeed({ render = true } = {}) {
  const data = await fetchJson(`/api/market/quotes?symbols=${quoteSymbolUniverse().join(",")}`);
  state.quotes = normalizeQuotes(data.quotes || []);
  state.quoteFeedSource = data.source || "";
  rememberFeedMeta("market", data, data.source || "quotes");
  if (render) {
    renderSourceBadges();
    renderTape();
    renderOverview();
    renderMarkets();
    renderAccount();
    if (state.tradeHistory) renderTradePanel();
    renderLiveAlerts();
  } else if ($("#view-overview")?.classList.contains("active") && state.account) {
    recordPortfolioEquitySnapshot(state.account);
    renderPortfolioChart();
  }
  syncQuotesFallbackBanner(data);
  if (render && $("#view-analysis")?.classList.contains("active") && state.analysis) {
    refreshActiveAnalysisChart();
  }
  return data;
}

async function refreshCryptoFeed({ render = true } = {}) {
  const data = await fetchJson("/api/crypto?ids=bitcoin,ethereum,solana");
  state.crypto = normalizeCryptoAssets(data.assets || []);
  rememberFeedMeta("crypto", data, data.source || "crypto");
  if (render) {
    renderSourceBadges();
    renderTape();
    renderOverview();
    renderCrypto();
    renderLiveAlerts();
  }
  return data;
}

async function refreshPolicyFeed({ render = true } = {}) {
  const [bills, lobbying] = await Promise.all([
    fetchJson("/api/congress/bills"),
    fetchJson("/api/lobbying")
  ]);
  state.bills = bills.bills || [];
  window._policyBillsForByok = state.bills || [];
  state.policyCatalysts = bills.catalysts || [];
  state.lobbying = lobbying.filings || [];
  rememberFeedMeta("bills", bills, bills.source || "bills");
  rememberFeedMeta("lobbying", lobbying, lobbying.source || "lobbying");
  if (render) {
    renderSourceBadges();
    renderOverview();
    renderPolicyCatalysts();
    renderBills();
    populateFundBillPicker();
    renderLobbying();
    if (state.analysis) renderAnalysis();
    renderLiveAlerts();
  }
  return { bills, lobbying };
}

async function refreshActiveTradeHistory() {
  if (!$("#view-trade")?.classList.contains("active")) return;
  const symbol = state.tradeSymbol;
  const range = state.tradeRange;
  try {
    const history = await fetchJson(
      `/api/market/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`
    );
    state.tradeHistory = history;
    renderTradePanel();
  } catch {
    /* keep last good chart */
  }
}

function refreshActiveAnalysisChart() {
  if (!$("#view-analysis")?.classList.contains("active") || !state.analysis) return;
  const symbol = state.activeAnalysisSymbol;
  const quote = quoteFor(symbol);
  const pts = state.analysis.charts?.priceTrend || [];
  if (!pts.length) return;
  const host = $("#analysis-sparkline");
  if (!host?.dataset.tsChartMounted || !window.TSCharts) return;
  window.TSCharts.update(host, {
    points: pts,
    liveValue: quote?.price,
    source: priceTrendCaption(symbol, state.analysis.charts),
    liveLabel: quote?.price ? `Live ${money(quote.price)}` : ""
  });
}

function renderTerminalData() {
  renderSourceBadges();
  renderTape();
  thesisUpdateQuoteTrustUi();
  renderOverview();
  renderMarkets();
  renderCrypto();
  renderBills();
  renderLobbying();
  renderAccount();
  renderContracts();
  renderSignalFeed();
  renderLiveAlerts();
  if (state.analysis) renderAnalysis();
}

function normalizeQuotes(rawList) {
  return rawList.map((q) => {
    const pctNum =
      q.pct != null ? Number(q.pct) : q.changePercent != null ? Number(q.changePercent) : 0;
    const cp = q.changePercent != null ? Number(q.changePercent) : pctNum;
    return { ...q, pct: pctNum, changePercent: cp };
  });
}

function syncQuotesFallbackBanner(data) {
  const tableWrap = document.querySelector("#view-markets section.panel .table-wrap");
  if (!tableWrap?.parentNode) return;
  const existing = document.getElementById("ts-fallback-banner");
  if (!data?.fallback) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const banner = document.createElement("div");
  banner.id = "ts-fallback-banner";
  banner.style.background = "#1a1a00";
  banner.style.border = "1px solid #665500";
  banner.style.color = "#ccaa00";
  banner.style.fontSize = "0.78rem";
  banner.style.padding = "6px 12px";
  banner.style.marginBottom = "8px";
  banner.style.borderRadius = "4px";
  banner.textContent = "⚠ Static reference prices — live data unavailable";
  tableWrap.parentNode.insertBefore(banner, tableWrap);
}

async function loadMarketsData() {
  try {
    const data = await fetchJson(`/api/market/quotes?symbols=${marketsDefaultSymbols().join(",")}`);
    const normalized = normalizeQuotes(data.quotes || []);
    const map = new Map((state.quotes || []).map((q) => [q.symbol, q]));
    normalized.forEach((q) => map.set(q.symbol, q));
    state.quotes = Array.from(map.values());
    state.quoteFeedSource = data.source || state.quoteFeedSource;
    rememberFeedMeta("market", data, data.source || "quotes");
    renderSourceBadges();
    thesisUpdateQuoteTrustUi();
    renderTape();
    renderMarkets();
    syncQuotesFallbackBanner(data);
  } catch (e) {
    console.error("[markets] quotes fetch failed", e);
    syncQuotesFallbackBanner({ fallback: false });
    renderMarkets();
  }

  try {
    const crypto = await fetchJson("/api/crypto?ids=bitcoin,ethereum");
    state.crypto = normalizeCryptoAssets(crypto.assets || []);
    rememberFeedMeta("crypto", crypto, crypto.source || "crypto");
    renderSourceBadges();
    renderCrypto();
    renderTape();
  } catch (e) {
    console.error("[markets] crypto fetch failed", e);
    renderCrypto();
    renderTape();
  }
}

function renderSession() {
  const user = state.session?.user;
  if (!user) return;
  $("[data-user-name]").textContent = user.name || "Trader";
  $("[data-user-email]").textContent = `${user.email || "local session"} - ${user.provider}`;
  $("[data-user-initials]").textContent = initials(user.name || user.email || "TS");
}

function renderTape() {
  const symbols = [...tapeDefaultQuoteSymbols(), "BTC", "ETH"];
  const parts = symbols.map((symbol) => {
    const quote = symbol === "BTC" || symbol === "ETH"
      ? state.crypto.find((asset) => asset.symbol === symbol)
      : quoteFor(symbol);
    const attrs = drilldownAttrs(symbol === "BTC" || symbol === "ETH" ? "source" : "analysis", {
      symbol,
      url: symbol === "BTC" || symbol === "ETH" ? tickerSourceUrl(symbol) : ""
    }, `Open ${symbol}`);
    if (!quote) return `<span class="ticker-tape-item" ${attrs}>${escapeHtml(symbol)} waiting</span>`;
    const pct = Number(quote.pct || 0);
    return `<span class="ticker-tape-item" ${attrs}>${escapeHtml(symbol)} <span class="${pct >= 0 ? "up" : "down"}">${pct >= 0 ? "+" : ""}${fmt(pct)}%</span></span>`;
  });
  $("#ticker-tape").innerHTML = parts.join("  /  ");
}

function renderOverview() {
  let investedValue = 0;
  let cost = 0;
  let dayChange = 0;
  const positions = [];
  const accountMeta = paperAccountMeta(state.account);
  const cash = Number(accountMeta.cash ?? PAPER_STARTING_CASH);
  const fromAccount = (state.account?.positions || []).slice().sort((a, b) => Number(b.marketValue || 0) - Number(a.marketValue || 0));
  const rows = !fromAccount.length
    ? `<tr><td colspan="6">No open positions yet. Place a paper trade in Account to populate this table and the policy map.</td></tr>`
    : fromAccount
        .map((position) => {
          let quote = quoteFor(position.symbol);
          if (!quote && position.price != null) {
            quote = { price: position.price, pct: Number(position.dayPct || 0), change: 0 };
          }
          if (!quote && position.marketValue != null && Number(position.qty) > 0) {
            quote = {
              price: Number(position.marketValue) / Number(position.qty),
              pct: Number(position.dayPct || 0),
              change: 0
            };
          }
          if (!quote) return "";
          const shares = Number(position.qty || 0);
          const positionValue = Number(quote.price || 0) * shares;
          const positionCost = Number(position.avgCost || 0) * shares;
          const totalReturn = positionCost ? ((positionValue - positionCost) / positionCost) * 100 : 0;
          investedValue += positionValue;
          cost += positionCost;
          dayChange += Number(quote.change || 0) * shares;
          const sym = position.symbol;
          const accent = holdingColor(sym);
          positions.push({
            symbol: sym,
            shares,
            avgCost: position.avgCost,
            policy: policyBlurbFor(sym),
            quote,
            value: positionValue,
            cost: positionCost,
            totalReturn
          });
          const stripe = ` style="box-shadow:inset 3px 0 0 0 ${accent}"`;
          return `
      <tr class="clickable-row" ${drilldownAttrs("analysis", { symbol: sym }, `Open ${sym} analysis`)}${stripe}>
        <td class="ticker-link-cell"><span class="ticker-swatch" style="--swatch:${accent}"></span><span>${sym}</span>${shareCardLink(sym, "Share Card")}</td>
        <td>${fmt(shares)}</td>
        <td>${money(quote.price)}${position.priceBasis === "cost_basis_fallback" ? ' <small class="muted">(cost basis)</small>' : ""}</td>
        <td>${money(positionValue)}</td>
        <td class="${quote.pct >= 0 ? "up" : "down"}">${signed(quote.pct)}%</td>
        <td>${policyBlurbFor(sym)}</td>
      </tr>
    `;
        })
        .filter(Boolean)
        .join("");

  $("#holdings-body").innerHTML = rows;
  const equity = paperEquity(state.account);
  const startingCash = Number(accountMeta.startingCash || PAPER_STARTING_CASH);
  const totalReturn = Number(accountMeta.totalReturn);
  const totalReturnPct = Number(accountMeta.totalReturnPct);
  const returnPct = Number.isFinite(totalReturnPct)
    ? totalReturnPct
    : cost
      ? ((investedValue - cost) / cost) * 100
      : equity > startingCash
        ? ((equity - startingCash) / startingCash) * 100
        : 0;
  const returnDollars = Number.isFinite(totalReturn) ? totalReturn : equity - startingCash;

  $("#portfolio-value").textContent = money(equity);
  $("#portfolio-change").innerHTML = `<span class="${returnPct >= 0 ? "up" : "down"}">${signed(returnPct)}% on holdings</span> · ${money(returnDollars)} vs $100k start · ${money(dayChange)} positions today`;
  $("#portfolio-hero-value").textContent = money(equity);
  const heroDay = fromAccount.length
    ? `<span class="${dayChange >= 0 ? "up" : "down"}">${dayChange >= 0 ? "+" : ""}${money(Math.abs(dayChange))} positions today</span>`
    : `<span class="muted">All cash · no open positions</span>`;
  $("#portfolio-hero-change").innerHTML = `${heroDay} / <span class="${returnPct >= 0 ? "up" : "down"}">${signed(returnPct)}% vs start</span>`;

  if (state.account) recordPortfolioEquitySnapshot(state.account);
  renderPortfolioChart();
  $("#holdings-updated").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("#overview-subtitle").textContent =
    state.quoteFeedSource === "fallback" || state.quoteFeedSource === "mixed"
      ? `Tracking ${state.quotes.length} equities using modeled fallback prices (set FINNHUB_API_KEY on the server for live tape), ${state.crypto.length} crypto assets, and ${policyBills().length} market-relevant bills.`
      : `Tracking ${state.quotes.length} equities, ${state.crypto.length} crypto assets, and ${policyBills().length} market-relevant bills.`;

  const safety = state.config?.safety;
  $("#trade-mode").textContent = safety?.liveTradingEnabled ? "Live enabled" : "Paper";
  $("#trade-mode-sub").textContent = safety?.liveTradingEnabled ? "Broker live mode is unlocked" : "Live trading is locked";

  const bills = policyBills();
  const maxMom = bills.reduce((max, b) => Math.max(max, billMomentum(b)), 0);
  const statBillCount = $("#stat-bill-count");
  const statBillMomentum = $("#stat-bill-momentum");
  if (statBillCount) statBillCount.textContent = String(bills.length);
  if (statBillMomentum) statBillMomentum.textContent = bills.length ? `Max legislative momentum ${maxMom}/100` : "No bills loaded yet";

  const filings = state.lobbying || [];
  const topFiling = filings.length
    ? filings.reduce(
        (best, f) => (Number(f.lobbyingPressure || 0) >= Number(best.lobbyingPressure || 0) ? f : best),
        filings[0]
      )
    : null;
  const statLobbyP = $("#stat-lobby-pressure");
  const statLobbyC = $("#stat-lobby-confidence");
  if (statLobbyP) statLobbyP.textContent = topFiling && topFiling.lobbyingPressure != null ? `${topFiling.lobbyingPressure}/100` : "—";
  if (statLobbyC) {
    statLobbyC.textContent = topFiling
      ? `Top filing · ${topFiling.filingConfidence || "Low"} confidence`
      : "No filings loaded yet";
  }

  $("#signal-list").innerHTML = policyBills()
    .slice()
    .sort((a, b) => billMomentum(b) - billMomentum(a))
    .slice(0, 4)
    .map(signalCard)
    .join("");
  renderPortfolioDashboard(positions, value, returnPct, dayChange);
  renderWatchlistStrip();
  renderMarketMood();
  renderPolicyCatalysts();
}

function renderMarketMood() {
  if (!$("#market-mood-panel")) return;
  const spy = quoteFor("SPY");
  const qqq = quoteFor("QQQ");
  const spyPct = spy ? Number(spy.pct || 0) : 0;
  const qqqPct = qqq ? Number(qqq.pct || 0) : 0;
  const tapePct = spy && qqq ? (spyPct + qqqPct) / 2 : spyPct || qqqPct || 0;
  const fearGreed = Math.round(Math.min(92, Math.max(12, 50 + tapePct * 14)));
  const fearLbl =
    fearGreed >= 58 ? "Risk-on tilt — tape supportive today" : fearGreed <= 42 ? "Defensive tilt — tape soft today" : "Balanced — tape mixed";

  const wsbProxy = tapePct > 0.35 ? Math.min(88, 52 + tapePct * 12) : tapePct < -0.35 ? Math.max(18, 48 + tapePct * 12) : 50 + tapePct * 8;
  const wsbRounded = Math.round(Math.min(95, Math.max(8, wsbProxy)));
  const wsbLbl = wsbRounded >= 58 ? "Bullish tilt" : wsbRounded <= 42 ? "Bearish tilt" : "Neutral";

  const holdingSyms = paperPositionSymbols();
  const bills = policyBills();
  const relevant = bills.filter((b) => (b.affected || []).some((t) => holdingSyms.includes(t)));
  let policyRisk = 0;
  if (relevant.length) {
    policyRisk = Math.round(relevant.reduce((m, b) => Math.max(m, billMomentum(b)), 0));
  } else if (bills.length) {
    policyRisk = Math.round(bills.reduce((m, b) => Math.max(m, billMomentum(b)), 0) * 0.55);
  } else {
    policyRisk = 32;
  }
  const policyLbl = policyRisk >= 67 ? "Elevated" : policyRisk >= 40 ? "Medium" : "Contained";

  const filings = state.lobbying || [];
  let lobbyIntensity = 0;
  if (filings.length) {
    const slice = filings.slice(0, 8).map((f) => Number(f.lobbyingPressure || 0));
    lobbyIntensity = Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
  } else {
    lobbyIntensity = policyRisk > 50 ? 54 : 38;
  }
  const lobbyLbl = lobbyIntensity >= 67 ? "High" : lobbyIntensity >= 40 ? "Medium" : "Low";

  const setBar = (id, pct) => {
    const el = document.getElementById(id);
    if (el) el.style.width = `${Math.max(3, Math.min(100, pct))}%`;
  };
  setBar("mood-fear-greed-bar", fearGreed);
  setBar("mood-wsb-bar", wsbRounded);
  setBar("mood-policy-bar", policyRisk);
  setBar("mood-lobby-bar", lobbyIntensity);

  const fgVal = $("#mood-fear-greed-val");
  if (fgVal) {
    fgVal.textContent = String(fearGreed);
    fgVal.className = `mood-meter-val ${fearGreed >= 55 ? "up" : fearGreed <= 45 ? "down" : ""}`;
  }
  const fgLbl = $("#mood-fear-greed-lbl");
  if (fgLbl) fgLbl.textContent = fearLbl;

  const wsbVal = $("#mood-wsb-val");
  if (wsbVal) {
    wsbVal.textContent = wsbLbl;
    wsbVal.className = `mood-meter-val ${wsbRounded >= 55 ? "up" : wsbRounded <= 45 ? "down" : ""}`;
  }

  const polVal = $("#mood-policy-val");
  if (polVal) {
    polVal.textContent = `${policyLbl} (${policyRisk})`;
    polVal.className = `mood-meter-val ${policyRisk >= 60 ? "amber-text" : ""}`;
  }

  const lobVal = $("#mood-lobby-val");
  if (lobVal) {
    lobVal.textContent = `${lobbyLbl} (${lobbyIntensity})`;
    lobVal.className = `mood-meter-val ${lobbyIntensity >= 60 ? "down" : ""}`;
  }

  const maxBill = relevant.slice().sort((a, b) => billMomentum(b) - billMomentum(a))[0];
  const lly = holdingSyms.includes("LLY") ? relevant.find((b) => (b.affected || []).includes("LLY")) : null;
  const nvda = holdingSyms.includes("NVDA") ? relevant.find((b) => (b.affected || []).includes("NVDA")) : null;

  let summary = `Tape mood is ${tapePct >= 0 ? "positive" : "negative"} on a blended SPY/QQQ move (${signed(tapePct)}% average). `;
  if (maxBill) {
    const title = maxBill.shortTitle || maxBill.title || maxBill.id;
    const snippet = title.length > 118 ? `${title.slice(0, 118)}…` : title;
    summary += `The strongest legislative momentum touching your holdings is ${maxBill.id} at ${billMomentum(maxBill)}/100 — ${snippet}. `;
  } else {
    summary += "No curated bill maps cleanly onto these holdings right now; policy heat is mostly benchmark-level. ";
  }
  if (lly && maxBill?.id !== lly.id) {
    summary += `LLY still carries drug-pricing narrative risk (${billMomentum(lly)}/100). `;
  }
  if (nvda && maxBill?.id !== nvda.id) {
    summary += `NVDA remains tied to implementation-era chips policy (${billMomentum(nvda)}/100). `;
  }
  summary += `Lobbying reads ${lobbyIntensity}/100 on recent filings — informational, not a timing signal.`;
  const sumEl = $("#market-mood-summary");
  if (sumEl) sumEl.textContent = summary;
}

function renderLiveAlerts() {
  const el = $("#live-alerts");
  if (!el) return;
  const alerts = buildLiveAlerts();
  const updated = $("#live-alert-updated");
  if (updated) {
    const latest = latestFeedTime(["market", "crypto", "bills", "lobbying", "contracts"]);
    updated.textContent = latest ? `Latest feed ${freshnessText(latest)}` : "Waiting for feeds";
  }
  el.innerHTML = alerts.length
    ? alerts.map((alert) => `
      <article class="live-alert-card ${alert.tone} actionable-card" ${drilldownAttrs(alert.action || "view", {
        viewName: alert.viewName || "",
        symbol: alert.symbol || "",
        billId: alert.billId || "",
        filter: alert.filter || "",
        company: alert.company || "",
        url: alert.url || ""
      }, alert.aria || `Open ${alert.label}`)}>
        <span class="mini-pill ${alert.pillClass}">${escapeHtml(alert.label)}</span>
        <strong>${escapeHtml(alert.title)}</strong>
        <p>${escapeHtml(alert.body)}</p>
      </article>
    `).join("")
    : `<article class="live-alert-card"><strong>Live feeds are warming up.</strong><p>Market, crypto, policy, lobbying, and account data will appear here as each source returns.</p></article>`;
}

function buildLiveAlerts() {
  const alerts = [];
  const marketSource = state.dataMeta.market?.source || state.quoteFeedSource;
  if (marketSource && !String(marketSource).includes("fallback")) {
    alerts.push({
      label: "Market live",
      pillClass: "green",
      tone: "good",
      title: `${sourceLabel(marketSource)} quotes connected`,
      body: `Equity tape last updated ${freshnessText(state.dataMeta.market?.updatedAt)}.`,
      action: "view",
      viewName: "markets"
    });
  } else if (marketSource) {
    alerts.push({
      label: "Fallback",
      pillClass: "amber",
      tone: "watch",
      title: "Quote feed is using fallback pricing",
      body: "Set or check FINNHUB_API_KEY before treating market prices as live.",
      action: "view",
      viewName: "markets"
    });
  }

  const topMover = state.quotes
    .filter((q) => Number.isFinite(Number(q.pct)))
    .sort((a, b) => Math.abs(Number(b.pct || 0)) - Math.abs(Number(a.pct || 0)))[0];
  if (topMover) {
    alerts.push({
      label: "Top move",
      pillClass: Number(topMover.pct) >= 0 ? "green" : "red",
      tone: Number(topMover.pct) >= 0 ? "good" : "risk",
      title: `${topMover.symbol} ${signed(topMover.pct)}%`,
      body: `Price ${money(topMover.price)} from ${sourceLabel(topMover.source || marketSource)}.`,
      action: "analysis",
      symbol: topMover.symbol
    });
  }

  const topBill = policyBills().slice().sort((a, b) => billMomentum(b) - billMomentum(a))[0];
  if (topBill) {
    alerts.push({
      label: "Policy",
      pillClass: billMomentum(topBill) >= 67 ? "green" : "amber",
      tone: "watch",
      title: `${topBill.id}: ${billMomentum(topBill)}/100 momentum`,
      body: `${topBill.shortTitle || topBill.title} · ${(topBill.affected || []).slice(0, 4).join(", ") || "no ticker map"}`,
      action: "bills",
      billId: topBill.id
    });
  }

  const topLobby = (state.lobbying || []).slice().sort((a, b) => Number(b.lobbyingPressure || 0) - Number(a.lobbyingPressure || 0))[0];
  if (topLobby) {
    alerts.push({
      label: "Lobbying",
      pillClass: Number(topLobby.lobbyingPressure || 0) >= 67 ? "red" : "amber",
      tone: "risk",
      title: `${topLobby.client || "Filing"} pressure ${Number(topLobby.lobbyingPressure || 0)}/100`,
      body: `${topLobby.issue || "Issue not listed"} · filed ${freshnessText(topLobby.postedAt || state.dataMeta.lobbying?.updatedAt)}.`,
      action: "bills",
      filter: relatedBillForFiling(topLobby)?.bill?.id || topLobby.client || ""
    });
  }

  const topContract = state.contracts.slice().sort((a, b) => Number(b.totalObligated || 0) - Number(a.totalObligated || 0))[0];
  if (topContract) {
    alerts.push({
      label: "Contracts",
      pillClass: topContract.exposureClass === "high" ? "green" : "amber",
      tone: "watch",
      title: `${topContract.symbol} federal awards ${compactMoney(topContract.totalObligated)}`,
      body: `${topContract.topAgency || "Agency not listed"} · ${topContract.riskLabel}.`,
      action: "contracts",
      company: topContract.company
    });
  }

  return alerts.slice(0, 5);
}

function latestFeedTime(keys) {
  const times = keys
    .map((key) => state.dataMeta[key]?.updatedAt)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString();
}

function renderPortfolioDashboard(positions, totalValue, returnPct, dayChange) {
  const allocationEl = $("#portfolio-allocation");
  const policyEl = $("#portfolio-policy-feed");
  const summaryEl = $("#portfolio-dashboard-summary");
  if (!allocationEl || !policyEl || !summaryEl) return;

  const sorted = positions.slice().sort((a, b) => b.value - a.value);
  allocationEl.innerHTML = sorted.map((position) => {
    const weight = totalValue ? (position.value / totalValue) * 100 : 0;
    const col = holdingColor(position.symbol);
    return `
      <article class="allocation-row actionable-card" ${drilldownAttrs("analysis", { symbol: position.symbol }, `Open ${position.symbol} allocation analysis`)} style="--holding-accent:${col}">
        <div>
          <span class="ticker-swatch" style="--swatch:${col}"></span>
          <strong>${escapeHtml(position.symbol)}</strong>
          <span>${money(position.value)} / ${fmt(weight)}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill allocation-bar-fill" style="width:${Math.max(2, Math.min(100, weight))}%"></div></div>
        <small class="${position.totalReturn >= 0 ? "up" : "down"}">${signed(position.totalReturn)}% total return</small>
      </article>
    `;
  }).join("");

  const policyRows = sorted.map((position) => {
    const bill = policyBills().find((item) => (item.affected || []).includes(position.symbol));
    const acc = holdingColor(position.symbol);
    return `
      <article class="portfolio-policy-card actionable-card ${bill ? momentumClass(bill) : ""}" ${drilldownAttrs(bill ? "bills" : "analysis", {
        billId: bill?.id || "",
        symbol: position.symbol
      }, bill ? `Open ${bill.id} for ${position.symbol}` : `Open ${position.symbol} analysis`)} style="--holding-accent:${acc}">
        <div>
          <span class="mini-pill ${bill ? momentumClass(bill) : ""}" style="border-color:${acc}">${escapeHtml(position.symbol)}</span>
          <strong>${escapeHtml(bill?.title || "No active mapped bill")}</strong>
        </div>
        <p>${escapeHtml(bill?.relationshipSummary || bill?.impact || position.policy || "This holding is mainly driven by market and company fundamentals right now.")}</p>
        ${bill ? `<small>Legislative momentum ${billMomentum(bill)}/100 · Policy exposure ${Number(bill.policyExposure ?? billMomentum(bill))}/100 · Confidence ${escapeHtml(billConfidenceLabel(bill))} · ${escapeHtml(bill.status)}</small>` : `<small>No LegisAlert pressure mapped</small>`}
      </article>
    `;
  }).join("");
  policyEl.innerHTML = policyRows;

  const best = sorted.slice().sort((a, b) => Number(b.quote?.pct || 0) - Number(a.quote?.pct || 0))[0];
  const exposed = sorted.filter((position) => policyBills().some((bill) => (bill.affected || []).includes(position.symbol)));
  const biggestBill = policyBills()
    .filter((bill) => bill.affected?.some((ticker) => positions.some((position) => position.symbol === ticker)))
    .sort((a, b) => Number(b.policyExposure ?? billMomentum(b)) - Number(a.policyExposure ?? billMomentum(a)))[0];
  summaryEl.innerHTML = `
    <article class="actionable-card" ${drilldownAttrs("trade", {}, "Open paper trading account")}>
      <span class="mini-pill ${dayChange >= 0 ? "green" : "red"}">Today</span>
      <p>Your portfolio is ${dayChange >= 0 ? "up" : "down"} ${money(Math.abs(dayChange))} today and ${returnPct >= 0 ? "up" : "down"} ${fmt(Math.abs(returnPct))}% from entry.</p>
    </article>
    <article class="actionable-card" ${drilldownAttrs("analysis", { symbol: best?.symbol || "" }, `Open ${best?.symbol || "top mover"} analysis`)}>
      <span class="mini-pill green">Top mover</span>
      <p>${escapeHtml(best?.symbol || "N/A")} is the strongest holding today at ${signed(best?.quote?.pct || 0)}%.</p>
    </article>
    <article class="actionable-card" ${drilldownAttrs("bills", { billId: biggestBill?.id || "" }, "Open portfolio policy exposure")}>
      <span class="mini-pill amber">Policy exposure</span>
      <p>${exposed.length} holdings have mapped policy chains. ${biggestBill ? `${biggestBill.title} is the highest-impact watch item.` : "No high-impact bill is mapped to current holdings."}</p>
    </article>
    <p class="muted" style="font-size:11px;margin-top:12px;line-height:1.5">Informational scenarios only — not financial advice.</p>
  `;
}

function renderWatchlistStrip() {
  const el = $("#watchlist-strip");
  if (!el) return;
  const wlSyms = watchlistRows().map((w) => w.symbol);
  console.log(
    "[client] watchlist symbols requested vs quotes:",
    JSON.stringify({
      watchlist: wlSyms,
      prices: wlSyms.map((sym) => {
        const q = quoteFor(sym);
        return { symbol: sym, price: q?.price, pct: q?.pct };
      })
    })
  );
  el.innerHTML = watchlistRows().map((row) => {
    const quote = quoteFor(row.symbol);
    const pct = quote ? Number(quote.pct || 0) : null;
    const pctCls = pct == null ? "muted" : pct >= 0 ? "up" : "down";
    const pctTxt = pct == null ? "…" : `${pct >= 0 ? "+" : ""}${fmt(pct)}%`;
    return `
      <span class="watchlist-chip-wrap" style="--watch-accent:${row.color}">
        <button type="button" class="watchlist-chip actionable-card" data-watch-symbol="${escapeHtml(row.symbol)}" title="Open ${escapeHtml(row.symbol)} analysis">
          <span class="watchlist-chip-sym">${escapeHtml(row.symbol)}</span>
          <span class="watchlist-chip-price">${quote ? money(quote.price) : "—"}</span>
          <span class="${pctCls}">${pctTxt}</span>
        </button>
        ${shareCardLink(row.symbol, "Card")}
      </span>
    `;
  }).join("");
}

function renderMarkets() {
  console.log("Markets view activated");
  console.log("Fetching quotes for:", marketsDefaultSymbols());
  const tbody = $("#market-body");
  if (!tbody) return;

  tbody.innerHTML = marketsDefaultSymbols().map((sym) => {
    const quote = quoteFor(sym);
    const pctRaw = quote ? Number(quote.changePercent ?? quote.pct ?? 0) : null;
    const pct = pctRaw != null && Number.isFinite(pctRaw) ? pctRaw : null;
    const chg = quote?.change != null ? Number(quote.change) : null;
    const pctCls = pct == null ? "muted" : pct >= 0 ? "up" : "down";
    const pctTxt = pct == null ? "N/A" : `${pct >= 0 ? "+" : ""}${fmt(pct)}%`;
    const chgTxt = chg == null ? "N/A" : signed(chg);
    const policyHtml = marketsPolicySignalHtml(sym);
    return `
      <tr class="clickable-row" ${drilldownAttrs("analysis", { symbol: sym }, `Open ${sym} analysis`)}>
        <td class="mono ticker-link-cell"><span>${escapeHtml(sym)}</span>${shareCardLink(sym, "Share Card")}</td>
        <td class="mono">${quote?.price != null ? money(quote.price) : "N/A"}</td>
        <td class="mono ${pctCls}">${chgTxt} (${pctTxt})</td>
        <td class="mono">${quote?.open != null ? money(quote.open) : "N/A"}</td>
        <td class="mono">${quote?.high != null ? money(quote.high) : "N/A"}</td>
        <td class="mono">${quote?.low != null ? money(quote.low) : "N/A"}</td>
        <td>${policyHtml}</td>
      </tr>
    `;
  }).join("");
}

function renderCrypto() {
  const grid = $("#crypto-grid");
  if (!grid) return;
  const cryptoData = state.crypto || [];
  if (!cryptoData.length) {
    grid.innerHTML =
      '<p class="muted mono" style="padding:16px;font-size:11px;">Crypto prices unavailable. Set COINGECKO_API_KEY in .env.local for live data.</p>';
    return;
  }
  grid.innerHTML = cryptoData.map((asset) => {
    const label = asset.name || asset.id || asset.symbol || "—";
    const pct = asset.pct != null ? Number(asset.pct) : null;
    const pctCls = pct == null ? "muted" : pct >= 0 ? "up" : "down";
    const pctLine =
      pct != null ? `${signed(pct)}% in 24h` : asset.placeholder ? "Sample / offline (24h)" : "— in 24h";
    const priceNum = asset.price != null ? Number(asset.price) : NaN;
    const priceHtml =
      Number.isFinite(priceNum) && priceNum > 0 ? money(priceNum) : "— (placeholder)";
    return `
    <article class="crypto-card actionable-card" ${drilldownAttrs("source", {
      url: tickerSourceUrl(asset.symbol || asset.id)
    }, `Open ${asset.symbol || label} source`)}>
      <span class="mini-pill">${escapeHtml(asset.symbol || asset.id || "")}</span>
      <strong>${priceHtml}</strong>
      <p class="${pctCls}">${pctLine}</p>
      <p class="muted">Market cap ${asset.marketCap ? compactMoney(asset.marketCap) : "not available"}</p>
      <p class="muted mono" style="font-size:10px;">${escapeHtml(label)}</p>
    </article>
  `;
  }).join("");
}

async function refreshContractsFeed({ render = true } = {}) {
  const requests = contractWatchlist().map(async (item) => {
    try {
      const data = await fetchJson(`/api/contracts/${encodeURIComponent(item.company)}`);
      return summarizeContractResults(item, data);
    } catch (error) {
      console.warn(`[contracts] ${item.symbol} fetch failed`, error);
      return null;
    }
  });
  const settled = await Promise.allSettled(requests);
  state.contracts = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value)
    .filter(Boolean);
  state.contractsFeedErrors = settled.filter((r) => r.status === "rejected").length;
  state.contractsLoadedAt = new Date().toISOString();
  rememberFeedMeta("contracts", {
    source: state.contracts.length ? "usaspending.gov" : "contracts_unavailable",
    confidence: state.contracts.length ? "Medium" : "Low",
    updatedAt: state.contractsLoadedAt
  });
  if (render) {
    renderSourceBadges();
    renderContracts();
    renderLiveAlerts();
    if (state.analysis) renderAnalysisContractsTab(state.analysis.symbol, state.analysis.company?.name);
  }
  return state.contracts;
}

function summarizeContractResults(item, data) {
  const results = (data.results || []).map(normalizeContractAward);
  const recipientId = data.recipientId || results.find((row) => row.recipientId)?.recipientId || null;
  const now = Date.now();
  const activeResults = results.filter((row) => {
    const end = row.endDate ? new Date(row.endDate).getTime() : null;
    return !Number.isFinite(end) || end >= now;
  });
  const sorted = (activeResults.length ? activeResults : results)
    .slice()
    .sort((a, b) => Number(b.obligatedAmount || 0) - Number(a.obligatedAmount || 0));
  const top = sorted[0] || {};
  const totalObligated = results.reduce((sum, row) => sum + Number(row.obligatedAmount || 0), 0);
  const endDates = results
    .map((row) => row.endDate)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => Number.isFinite(t) && t >= now);
  const soonestEnd = endDates.length ? new Date(Math.min(...endDates)).toISOString().slice(0, 10) : "";
  const daysToSoonest = soonestEnd ? Math.round((new Date(soonestEnd).getTime() - now) / 864e5) : null;
  const exposureClass = totalObligated >= 1e9 ? "high" : totalObligated >= 1e8 ? "medium" : "low";
  const riskLabel = daysToSoonest != null && daysToSoonest <= 180
    ? "Renewal / recompete watch"
    : results.length
      ? "Active award monitor"
      : "No recent awards found";
  const riskClass = daysToSoonest != null && daysToSoonest <= 180 ? "medium"
    : results.length ? "neutral" : "low";
  return {
    ...item,
    source: "usaspending.gov",
    resultCount: results.length,
    activeResultCount: activeResults.length,
    totalObligated,
    topAward: Number(top.obligatedAmount || 0),
    topAgency: top.awardingAgency || "Agency not listed",
    topRecipient: top.recipientName || item.company,
    startDate: top.startDate || "",
    endDate: top.endDate || "",
    soonestEnd,
    exposureClass,
    riskLabel,
    riskClass,
    recipientId,
    results
  };
}

function renderContracts() {
  const tbody = $("#contracts-body");
  if (!tbody) return;
  const intro = $("#contracts-intro");
  if (intro) {
    intro.textContent = state.contractsLoadedAt
      ? `Showing live USASpending.gov award data for ${state.contracts.length} government-exposed companies. Awards can lag agency disclosure by up to 90 days. Click a row to see individual awards.`
      : "Loading recent awards from USASpending.gov…";
  }
  if (!state.contractsLoadedAt) {
    tbody.innerHTML = `<tr><td colspan="7">Loading USASpending.gov awards…</td></tr>`;
    return;
  }
  if (!state.contracts.length) {
    tbody.innerHTML = `<tr><td colspan="7">Contract feed unavailable — USASpending.gov did not return awards. Try <strong>Refresh all</strong>. If this persists, the federal API may be down or rate-limited.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.contracts.map((row) => {
    const detailId = `cd-${escapeHtml(row.symbol)}`;
    return `
      <tr class="clickable-row contract-summary-row"
          data-contract-toggle="${detailId}"
          data-symbol="${escapeHtml(row.symbol)}"
          role="button" tabindex="0"
          title="Click to see individual awards">
        <td class="mono">${escapeHtml(row.symbol)}</td>
        <td>${escapeHtml(row.company)}</td>
        <td><span class="score-badge ${row.exposureClass}">${compactMoney(row.totalObligated)}</span></td>
        <td class="mono">${row.topAward ? compactMoney(row.topAward) : "—"}</td>
        <td>${escapeHtml(row.topAgency)}</td>
        <td><span class="score-badge ${row.riskClass}">${escapeHtml(row.riskLabel)}</span></td>
        <td class="mono contract-expand-hint">▸ Awards</td>
      </tr>
      <tr id="${detailId}" class="contract-detail-row" hidden>
        <td colspan="7">
          ${renderContractDetailPanel(row)}
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".contract-summary-row").forEach((summaryRow) => {
    summaryRow.addEventListener("click", () => {
      const detailId = summaryRow.dataset.contractToggle;
      if (!detailId) return;
      const detail = document.getElementById(detailId);
      if (!detail) return;
      const isOpen = !detail.hidden;
      tbody.querySelectorAll(".contract-detail-row").forEach((d) => { d.hidden = true; });
      tbody.querySelectorAll(".contract-expand-hint").forEach((h) => { h.textContent = "▸ Awards"; });
      tbody.querySelectorAll(".contract-summary-row").forEach((r) => r.classList.remove("contract-row-open"));
      if (!isOpen) {
        detail.hidden = false;
        summaryRow.querySelector(".contract-expand-hint").textContent = "▾ Awards";
        summaryRow.classList.add("contract-row-open");
        detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
    summaryRow.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        summaryRow.click();
      }
    });
  });
}

function renderContractDetailPanel(row) {
  const companySearchUrl = usaspendingSearchUrl(row.company, row.recipientId);
  if (!row.results || !row.results.length) {
    return `<div class="contract-detail-panel">
      <p class="muted">No individual award records were returned for ${escapeHtml(row.company)}.</p>
      <a class="link-button" href="${companySearchUrl}" target="_blank" rel="noopener noreferrer">
        Search USASpending.gov for ${escapeHtml(row.company)}
      </a>
    </div>`;
  }

  const now = Date.now();
  const awardRows = row.results.slice(0, 10).map((award) => {
    const normalized = normalizeContractAward(award);
    const daysToEnd = normalized.endDate
      ? Math.round((new Date(normalized.endDate).getTime() - now) / 864e5)
      : null;
    const statusLabel = daysToEnd == null ? "Period unknown"
      : daysToEnd < 0 ? "Expired"
      : daysToEnd <= 90 ? "Expires soon"
      : daysToEnd <= 365 ? "Active"
      : "Active";
    const statusClass = daysToEnd == null ? "neutral"
      : daysToEnd < 0 ? "low"
      : daysToEnd <= 90 ? "medium"
      : "neutral";
    const periodStr = contractAwardPeriodLabel(normalized);
    const fullDesc = contractAwardDisplayDescription(normalized) || "No description provided";
    const desc = fullDesc.slice(0, 160) + (fullDesc.length > 160 ? "…" : "");
    const directUrl = contractAwardDirectUrl(normalized);
    const linkUrl = directUrl || usaspendingSearchUrl(normalized.recipientName || row.company, row.recipientId);
    const linkLabel = directUrl ? `Award ${escapeHtml(normalized.awardId || "detail")}` : "USASpending search";
    return `
      <div class="contract-award-row">
        <div class="contract-award-head">
          <span class="contract-award-id mono">${escapeHtml(normalized.awardId || "—")}</span>
          <span class="contract-award-agency">${escapeHtml(normalized.awardingAgency || "Agency not listed")}</span>
          <span class="score-badge ${statusClass} contract-award-status">${statusLabel}</span>
          <strong class="contract-award-amount mono">${compactMoney(normalized.obligatedAmount || 0)}</strong>
        </div>
        <p class="contract-award-desc">${escapeHtml(desc)}</p>
        <div class="contract-award-foot">
          <span class="muted mono contract-award-period">${escapeHtml(periodStr)}</span>
          <a class="link-button" href="${linkUrl}" target="_blank" rel="noopener noreferrer">${linkLabel} ↗</a>
        </div>
      </div>
    `;
  }).join("");

  const totalLabel = `${row.resultCount} award${row.resultCount !== 1 ? "s" : ""} found · ${row.activeResultCount} active`;
  return `
    <div class="contract-detail-panel">
      <div class="contract-detail-header">
        <span class="contract-detail-company">${escapeHtml(row.company)}</span>
        <span class="muted mono contract-detail-count">${totalLabel}</span>
        <a class="link-button" href="${companySearchUrl}" target="_blank" rel="noopener noreferrer">All on USASpending ↗</a>
      </div>
      <div class="contract-award-list">
        ${awardRows}
      </div>
      <p class="contract-detail-disclaimer muted">
        Awards from USASpending.gov. Data may lag agency disclosure by up to 90 days.
        Dollar amounts are total obligated value. Not a prediction of contract continuation or cancellation.
      </p>
    </div>
  `;
}

function renderBills() {
  const query = ($("#bill-filter")?.value || "").toLowerCase();
  const bills = policyBills({ includeUnmapped: Boolean(query) }).filter((bill) => {
    if (!query) return true;
    return [bill.id, bill.title, bill.shortTitle, bill.status, bill.signal, ...(bill.affected || []), ...(bill.tags || [])]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const feed = $("#bill-feed");
  if (!feed) return;
  if (!bills.length) {
    feed.innerHTML = `<tr><td colspan="8">No bill matched that filter. Try a ticker like LLY, NVDA, AMZN, COIN, or TSLA.</td></tr>`;
    return;
  }
  feed.innerHTML = bills.map((bill) => {
    const tickerLinks = (bill.affected || [])
      .map((ticker) => `<span class="ticker-inline-chip">${escapeHtml(ticker)}${shareCardLink(ticker, "Card")}</span>`)
      .join("");
    const status = billStatusInfo(bill);
    const stageColor = stageColorForBill(bill);
    const momentum = billMomentum(bill);
    const lobby = Number(bill.lobbyingPressureScore ?? 0);
    const catalyst = bill.catalyst || {};
    const detailsId = `bill-detail-${escapeHtml(bill.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
    return `
      <tr class="clickable-row" data-bill-toggle="${detailsId}" role="button" tabindex="0" title="Open bill details">
        <td class="mono">
          ${escapeHtml(bill.id)}
          <small class="bill-source-mini ${bill.exactCongressRecord ? "exact" : "modeled"}">${bill.exactCongressRecord ? "exact" : "modeled seed"}</small>
        </td>
        <td>${escapeHtml(bill.title || "")}</td>
        <td>
          <span class="status-stage-chip ${toneClassFromStatus(status.tone)}" style="color:${stageColor}">${escapeHtml(status.label)}</span>
          <small class="stage-cell-next">${escapeHtml(status.nextStep || "")}</small>
        </td>
        <td><span class="score-badge ${momentum >= 67 ? "high" : momentum < 35 ? "low" : "medium"}">${momentum}/100</span></td>
        <td><span class="score-badge ${lobby >= 67 ? "high" : lobby < 35 ? "low" : "medium"}">${lobby}/100</span></td>
        <td>${escapeHtml(billConfidenceLabel(bill))}</td>
        <td class="mono ticker-link-cell">${tickerLinks || "—"}</td>
        <td class="mono">${escapeHtml(bill.latestActionDate || "")}</td>
      </tr>
      <tr id="${detailsId}" hidden>
        <td colspan="8">
          <div class="bill-detail-shell">
            <div class="bill-detail-grid">
              <div>
                <h4>What happens next</h4>
                <p>${escapeHtml(status.nextStep || "Watch the next official action.")}</p>
                <p class="muted">${escapeHtml(status.marketMeaning || "")}</p>
              </div>
              <div>
                <h4>Catalyst watch</h4>
                <p>${escapeHtml(catalyst.label || status.label)} · ${escapeHtml(catalyst.dateLabel || bill.latestActionDate || "No date posted")}</p>
                <p class="muted">Urgency ${Number(catalyst.urgency || 0)}/100 · ${escapeHtml(catalyst.source || "modeled status")}</p>
              </div>
            </div>
            <p>${escapeHtml(bill.plainEnglish || bill.signal || "")}</p>
            ${momentumDriversHtml(bill)}
            <table>
              <thead><tr><th>Firm</th><th>Stance</th><th>Amount</th><th>Issue Area</th></tr></thead>
              <tbody>
                ${(bill.stakeholders?.lobbying?.length
                  ? bill.stakeholders.lobbying.map((l) => `<tr><td>${escapeHtml(l.name || "")}</td><td>${escapeHtml(l.stance || "")}</td><td class="mono">${money(l.amount || 0)}</td><td>${escapeHtml(l.issue || "")}</td></tr>`)
                  : [`<tr><td colspan="4" class="muted">No firm-level lobbying mapped to this bill yet.</td></tr>`]
                ).join("")}
              </tbody>
            </table>
            <ul>${watchForBullets(bill).map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
            <p class="bill-source-note">${escapeHtml(billSourceNote(bill))}</p>
            <a class="link-button" target="_blank" rel="noopener noreferrer" href="${billSourceUrl(bill)}">${escapeHtml(billSourceLabel(bill))}</a>
          </div>
        </td>
      </tr>
    `;
  }).join("");
  renderBillStakeholders();
  renderPolicyCatalysts();
}

function renderLobbying() {
  renderLobbyBridge();
  const feedEl = $("#lobby-feed");
  if (!feedEl) return;
  feedEl.innerHTML = state.lobbying.map((filing) => {
    const pressure = Number(filing.lobbyingPressure ?? 0);
    const fConf = filing.filingConfidence || "Low";
    const z = filing.spendSpikeZ;
    const spikeX = filing.spikeVsTrail;
    const zLabel = formatSpendZ(z);
    const zPillClass = lobbyZClass(z);
    const spikeLine =
      spikeX != null && !Number.isNaN(Number(spikeX))
        ? `${Number(spikeX).toFixed(2)}× vs trail`
        : "Trail baseline";
    const connection = relatedBillForFiling(filing);
    const connectedBill = connection?.bill;
    return `
      <article class="lobby-card">
        <div class="meta-line lobby-card-metrics">
          <span class="mini-pill ${pressure >= 67 ? "red" : pressure >= 40 ? "amber" : ""}">Pressure ${pressure}/100</span>
          <span class="lobby-z-pill mini-pill ${zPillClass}">Z ${escapeHtml(zLabel)}</span>
          <span class="mini-pill lobby-spike-pill">${escapeHtml(spikeLine)}</span>
          <span class="mini-pill">Filing: ${escapeHtml(fConf)}</span>
        </div>
        <div class="lobby-pressure-bar" aria-hidden="true"><span style="width:${Math.max(4, Math.min(100, pressure))}%"></span></div>
        <div class="lobby-subconf muted">
          <span>Recency · ${escapeHtml(filing.recencySignalConfidence || "—")}</span>
          <span>Issue · ${escapeHtml(filing.issueSignalConfidence || "—")}</span>
          <span>Spend · ${escapeHtml(filing.spendSignalConfidence || "—")}</span>
        </div>
        <h3>${escapeHtml(filing.client)}</h3>
        <p>${escapeHtml(filing.issue || "Issue not listed")}</p>
        <p class="muted">Filed by ${escapeHtml(filing.registrant || "unknown registrant")}</p>
        <div class="lobby-causal-box ${connectedBill ? "" : "muted-box"}">
          ${connectedBill ? `
            <span>${escapeHtml(filing.client)} -> ${escapeHtml(connectedBill.title)}</span>
            <p>${escapeHtml(connection.relationship || connectedBill.relationshipSummary || connectedBill.impact || "")}</p>
            <div class="meta-line">
              <span class="mini-pill ${momentumClass(connectedBill)}">Legislative momentum ${billMomentum(connectedBill)}/100</span>
              ${(connectedBill.affected || []).slice(0, 4).map((ticker) => `<span class="mini-pill green">${escapeHtml(ticker)}</span>`).join("")}
            </div>
          ` : `
            <span>No mapped bill yet</span>
            <p>This filing is still useful context, but it has not been tied to a specific TradeSimple bill-impact chain.</p>
          `}
        </div>
      </article>
    `;
  }).join("");
}

function renderAccount() {
  const account = state.account?.account || {};
  $("#account-grid").innerHTML = [
    ["Liquid cash", money(Number(account.cash || account.buyingPower || 0)), "Available to buy stocks right now"],
    ["Equity", money(Number(account.equity || 0)), "Cash plus current paper positions"],
    ["Invested", money(Number(account.portfolioValue || 0)), "Current value of paper holdings"],
    ["Total return", `${signed(account.totalReturnPct || 0)}%`, `${money(Number(account.totalReturn || 0))} since the $100,000 start`]
  ].map(([label, value, subtitle]) => `
    <article class="connection-card paper-stat-card">
      <span class="mini-pill">${label}</span>
      <strong>${value}</strong>
      <p class="muted">${escapeHtml(subtitle)}</p>
    </article>
  `).join("");

  $("#paper-positions-body").innerHTML = (state.account?.positions || []).length
    ? state.account.positions.map((position) => `
      <tr>
        <td>${escapeHtml(position.symbol)}</td>
        <td>${fmt(position.qty)}</td>
        <td>${money(position.avgCost)}</td>
        <td>${money(position.price)}</td>
        <td>${money(position.marketValue)}</td>
        <td class="${position.unrealizedPnl >= 0 ? "up" : "down"}">${money(position.unrealizedPnl)} (${signed(position.unrealizedPnlPct)}%)</td>
        <td>${positionPolicyRiskHtml(position.symbol)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="7">No paper positions yet. Use the order ticket to make your first simulated trade.</td></tr>`;

  $("#paper-orders").innerHTML = (state.account?.orders || []).length
    ? state.account.orders.slice(0, 8).map((order) => `
      <article class="paper-order-row ${order.side === "buy" ? "green" : "red"}">
        <div>
          <strong>${escapeHtml(order.side?.toUpperCase() || "ORDER")} ${escapeHtml(order.symbol)}</strong>
          <span>${fmt(order.qty)} shares at ${money(order.price)}</span>
        </div>
        <small>${money(order.notional)} / ${new Date(order.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
      </article>
    `).join("")
    : `<article class="empty-state">No orders yet. Paper fills will appear here.</article>`;

  renderTradePanel();
  void loadFunds();
}

const FUND_TAG_LABELS = {
  legislation: "Legislation",
  contracts: "Contracts",
  lobbying: "Lobbying",
  figures: "Figures",
  custom: "Custom"
};

function parseFundTickerInput(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase().replace(/[^A-Z.]/g, ""))
    .filter(Boolean);
}

function renderFundTickerChips() {
  const host = $("#fund-ticker-chips");
  const editor = $("#fund-weight-editor");
  const rowsHost = $("#fund-weight-rows");
  if (!host) return;
  const chips = state.fundTickerDraft;
  host.innerHTML = chips.length
    ? chips.map((sym) => `
      <button type="button" class="mini-pill fund-chip" data-remove-fund-ticker="${escapeHtml(sym)}">${escapeHtml(sym)} ×</button>
    `).join("")
    : `<span class="muted">Add tickers above or pull from a bill’s affected list.</span>`;
  host.querySelectorAll("[data-remove-fund-ticker]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sym = btn.dataset.removeFundTicker;
      state.fundTickerDraft = state.fundTickerDraft.filter((t) => t !== sym);
      delete state.fundWeightDraft[sym];
      renderFundTickerChips();
    });
  });

  if (editor && rowsHost) {
    editor.hidden = !chips.length;
    rowsHost.innerHTML = chips
      .map(
        (sym) => `
      <label class="fund-weight-row">
        <span>${escapeHtml(sym)}</span>
        <input type="number" min="0" step="0.01" placeholder="equal" data-fund-weight="${escapeHtml(sym)}" value="${state.fundWeightDraft[sym] != null ? escapeHtml(String(state.fundWeightDraft[sym])) : ""}" />
      </label>`
      )
      .join("");
    rowsHost.querySelectorAll("[data-fund-weight]").forEach((input) => {
      input.addEventListener("input", () => {
        const sym = input.dataset.fundWeight;
        const val = Number(input.value);
        if (Number.isFinite(val) && val > 0) state.fundWeightDraft[sym] = val;
        else delete state.fundWeightDraft[sym];
      });
    });
  }
}

function fundSymbolsPayloadFromDraft() {
  const symbols = [...new Set(state.fundTickerDraft)];
  const pending = parseFundTickerInput($("#fund-tickers-input")?.value);
  pending.forEach((sym) => {
    if (!symbols.includes(sym)) symbols.push(sym);
  });
  const explicit = symbols.some((sym) => state.fundWeightDraft[sym] != null);
  return symbols.map((symbol) => {
    if (!explicit) return symbol;
    const weight = state.fundWeightDraft[symbol];
    return weight != null && weight > 0 ? { symbol, weight } : { symbol, weight: null };
  });
}

function populateFundBillPicker() {
  const select = $("#fund-bill-picker");
  if (!select) return;
  const bills = policyBills().slice().sort((a, b) => billMomentum(b) - billMomentum(a));
  select.innerHTML = [
    `<option value="">Choose a bill…</option>`,
    ...bills.map((bill) => {
      const label = `${bill.id} — ${(bill.shortTitle || bill.title || "").slice(0, 72)}`;
      return `<option value="${escapeHtml(bill.id)}">${escapeHtml(label)}</option>`;
    })
  ].join("");
}

function setupHypotheticalFunds() {
  const form = $("#fund-create-form");
  if (!form) return;

  state.fundTickerDraft = [];
  state.fundWeightDraft = {};
  renderFundTickerChips();
  populateFundBillPicker();

  const tickersInput = $("#fund-tickers-input");
  tickersInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    const added = parseFundTickerInput(tickersInput.value);
    if (!added.length) return;
    const set = new Set(state.fundTickerDraft);
    added.forEach((sym) => set.add(sym));
    state.fundTickerDraft = [...set];
    tickersInput.value = "";
    renderFundTickerChips();
  });

  $("#fund-add-from-bill")?.addEventListener("click", () => {
    const billId = $("#fund-bill-picker")?.value;
    if (!billId) return;
    const bill = policyBills().find((b) => b.id === billId);
    const affected = (bill?.affected || []).map((s) => String(s).toUpperCase());
    if (!affected.length) return;
    const set = new Set(state.fundTickerDraft);
    affected.forEach((sym) => set.add(sym));
    state.fundTickerDraft = [...set];
    renderFundTickerChips();
    const status = $("#fund-create-status");
    if (status) {
      status.textContent = `Added ${affected.length} tickers from ${bill.id}. Review weights — defaults are equal.`;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("#fund-name")?.value?.trim();
    const tag = $("#fund-tag")?.value || "custom";
    const symbols = fundSymbolsPayloadFromDraft();
    const benchmark = $("#fund-benchmark-spy")?.checked ? "SPY" : null;
    const status = $("#fund-create-status");
    if (!symbols.length) {
      if (status) status.textContent = "Add at least one ticker.";
      return;
    }
    if (status) status.textContent = "Creating hypothetical fund…";
    try {
      const response = await fetchJson("/api/funds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, tag, symbols, benchmark })
      });
      state.funds.unshift(response.fund);
      state.activeFundId = response.fund.id;
      if ($("#fund-name")) $("#fund-name").value = "";
      if (tickersInput) tickersInput.value = "";
      state.fundTickerDraft = [];
      state.fundWeightDraft = {};
      renderFundTickerChips();
      renderFundsUi();
      populateFundCompareSelects();
      await loadFundDetail(response.fund.id);
      if (status) status.textContent = `Created “${response.fund.name}”.`;
    } catch (error) {
      if (status) status.textContent = "Could not create fund. Check tickers and try again.";
      console.error("[funds] create failed", error);
    }
  });

  $("#fund-select")?.addEventListener("change", (event) => {
    const id = event.target.value;
    state.activeFundId = id || null;
    if (id) void loadFundDetail(id);
    else renderFundsUi();
  });

  document.querySelectorAll("[data-fund-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-fund-range]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.fundRange = btn.dataset.fundRange || "6m";
      if (state.activeFundId) void loadFundDetail(state.activeFundId);
    });
  });

  $("#fund-compare-run")?.addEventListener("click", () => void runFundCompare());
  populateFundCompareSelects();

  window.addEventListener("resize", () => {
    if (state.fundAttribution?.graph) renderFundRelationshipGraph(state.fundAttribution);
  });
}

function populateFundCompareSelects() {
  const bar = $("#fund-compare-bar");
  const selA = $("#fund-compare-a");
  const selB = $("#fund-compare-b");
  if (!selA || !selB) return;
  if (!state.funds.length) {
    if (bar) bar.hidden = true;
    return;
  }
  if (bar) bar.hidden = false;
  const options = state.funds.map(
    (fund) => `<option value="${escapeHtml(fund.id)}">${escapeHtml(fund.name)}</option>`
  );
  selA.innerHTML = options.join("");
  selB.innerHTML = options.join("");
  if (state.funds.length > 1) {
    selB.selectedIndex = 1;
  }
}

async function runFundCompare() {
  const idA = $("#fund-compare-a")?.value;
  const idB = $("#fund-compare-b")?.value;
  const tbody = $("#fund-compare-compare-body");
  if (!idA || !idB || idA === idB || !tbody) return;
  tbody.innerHTML = `<tr><td colspan="3">Loading comparison…</td></tr>`;
  try {
    const data = await fetchJson(
      `/api/funds/compare?ids=${encodeURIComponent(idA)},${encodeURIComponent(idB)}`
    );
    const [fundA, fundB] = data.funds || [];
    $("#fund-compare-th-a").textContent = fundA?.name || "Fund A";
    $("#fund-compare-th-b").textContent = fundB?.name || "Fund B";
    const fmtPct = (v) => (v == null ? "—" : `${signed(v)}%`);
    const metrics = data.comparison?.metrics || [];
    tbody.innerHTML = metrics
      .map((row) => {
        if (row.format === "count") {
          return `<tr><td>${escapeHtml(row.label)}</td><td>${row.a ?? "—"}</td><td>${row.b ?? "—"}</td></tr>`;
        }
        return `<tr><td>${escapeHtml(row.label)}</td><td class="${Number(row.a) >= 0 ? "up" : "down"}">${fmtPct(row.a)}</td><td class="${Number(row.b) >= 0 ? "up" : "down"}">${fmtPct(row.b)}</td></tr>`;
      })
      .join("");
  } catch {
    tbody.innerHTML = `<tr><td colspan="3">Could not compare funds.</td></tr>`;
  }
}

async function loadFunds() {
  try {
    const data = await fetchJson("/api/funds");
    state.funds = data.funds || [];
    if (!state.activeFundId && state.funds.length) state.activeFundId = state.funds[0].id;
    populateFundCompareSelects();
    renderFundsUi();
    if (state.activeFundId) await loadFundDetail(state.activeFundId);
  } catch (error) {
    console.warn("[funds] list failed", error);
  }
}

function renderFundsUi() {
  const select = $("#fund-select");
  const empty = $("#fund-detail-empty");
  const body = $("#fund-detail-body");
  if (!select) return;

  if (!state.funds.length) {
    select.innerHTML = `<option value="">No funds yet</option>`;
    if (empty) empty.hidden = false;
    if (body) body.hidden = true;
    stopFundPulseRefresh();
    return;
  }

  select.innerHTML = state.funds
    .map((fund) => `<option value="${escapeHtml(fund.id)}" ${fund.id === state.activeFundId ? "selected" : ""}>${escapeHtml(fund.name)}</option>`)
    .join("");

  if (empty) empty.hidden = Boolean(state.activeFundId);
  if (body) body.hidden = !state.activeFundId;
}

async function loadFundDetail(fundId) {
  const range = state.fundRange || "6m";
  const chartHost = $("#fund-performance-chart");
  if (chartHost) {
    if (window.TSCharts) window.TSCharts.destroy(chartHost);
    delete chartHost.dataset.tsChartMounted;
    chartHost.innerHTML = `<div class="empty-chart">Loading basket index…</div>`;
  }

  try {
    const [perf, attr, pulse] = await Promise.all([
      fetchJson(`/api/funds/${encodeURIComponent(fundId)}/performance?range=${encodeURIComponent(range)}`),
      fetchJson(`/api/funds/${encodeURIComponent(fundId)}/attribution?range=${encodeURIComponent(range)}`),
      fetchJson(`/api/funds/${encodeURIComponent(fundId)}/pulse`).catch(() => null)
    ]);
    state.fundPerformance = perf;
    state.fundAttribution = attr;
    state.fundPulse = pulse;
    renderFundDetail();
    scheduleFundPulseRefresh(fundId);
  } catch (error) {
    console.error("[funds] detail failed", error);
    if (chartHost) chartHost.innerHTML = `<div class="empty-chart">Fund data unavailable.</div>`;
  }
}

function renderFundDetail() {
  renderFundsUi();
  const perf = state.fundPerformance;
  const attr = state.fundAttribution;
  const fund = perf?.fund || attr?.fund;
  if (!fund) return;

  const meta = $("#fund-meta-line");
  if (meta) {
    const syms = (fund.symbols || []).map((row) => `${row.symbol} ${(row.weight * 100).toFixed(0)}%`).join(" · ");
    meta.innerHTML = `
      <span class="mini-pill">${escapeHtml(FUND_TAG_LABELS[fund.tag] || fund.tag)}</span>
      <span class="muted">${escapeHtml(syms)}</span>
      ${fund.benchmark ? `<span class="mini-pill">Benchmark ${escapeHtml(fund.benchmark)}</span>` : ""}
    `;
  }

  renderFundCompareTable(perf);
  renderFundLeaderboard(perf);
  renderFundRelationshipMatrix(attr);
  renderFundRelationshipGraph(attr);
  renderFundLivePulse(state.fundPulse);
  renderFundAttributionTray(attr);
  renderFundPerformanceChart(perf, attr);
}

function stopFundPulseRefresh() {
  if (!state.fundPulseTimer) return;
  clearInterval(state.fundPulseTimer);
  state.fundPulseTimer = null;
}

function scheduleFundPulseRefresh(fundId) {
  stopFundPulseRefresh();
  if (!fundId || !$("#view-overview")?.classList.contains("active")) return;
  state.fundPulseTimer = setInterval(async () => {
    if (state.activeFundId !== fundId) return;
    if (!$("#view-overview")?.classList.contains("active")) return;
    try {
      state.fundPulse = await fetchJson(`/api/funds/${encodeURIComponent(fundId)}/pulse`);
      renderFundLivePulse(state.fundPulse);
    } catch {
      /* keep last pulse */
    }
  }, 20_000);
}

function fundPulseStatusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("catalyst")) return "pulse-catalyst";
  if (s.includes("watch")) return "pulse-watch";
  if (s.includes("broken")) return "pulse-broken";
  return "pulse-normal";
}

function renderFundLivePulse(pulse) {
  const tray = $("#fund-pulse-tray");
  if (!tray) return;
  const quotes = pulse?.quotePulse || [];
  const figures = pulse?.figurePulse || [];
  if (!quotes.length && !figures.length) {
    tray.innerHTML = `<p class="muted">No pulse data yet for this basket.</p>`;
    return;
  }

  const quoteHtml = quotes.length
    ? `
    <section class="fund-pulse-block">
      <h5>Market heartbeat</h5>
      ${quotes
        .map(
          (row) => `
        <article class="fund-pulse-row">
          <div class="fund-pulse-head">
            <strong>${escapeHtml(row.symbol)}</strong>
            <span class="fund-pulse-status ${fundPulseStatusClass(row.status)}">${escapeHtml(row.status || "Normal")}</span>
          </div>
          <p class="muted">
            ${row.price != null ? money(row.price) : "—"}
            ${row.pct != null ? ` · ${signed(row.pct)}%` : ""}
            ${row.source ? ` · ${escapeHtml(sourceLabel(row.source))}` : ""}
          </p>
        </article>`
        )
        .join("")}
    </section>`
    : "";

  const figureHtml = figures.length
    ? `
    <section class="fund-pulse-block">
      <h5>Public figure pulse</h5>
      ${figures
        .map(
          (row) => `
        <article class="fund-pulse-row">
          <div class="fund-pulse-head">
            <strong>${escapeHtml(row.name || "Figure")}</strong>
            <span class="social-badge curated">Curated</span>
            <span class="fund-pulse-status ${fundPulseStatusClass(row.status)}">${escapeHtml(row.status || "Normal")}</span>
          </div>
          <p class="muted">${escapeHtml(row.label || "")}</p>
          <p class="muted">${(row.symbolsAffected || []).map((s) => `<span class="mini-pill green">${escapeHtml(s)}</span>`).join(" ")}</p>
          ${row.url ? `<a class="link-button" href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">Open source</a>` : ""}
        </article>`
        )
        .join("")}
    </section>`
    : "";

  const socialItems = pulse?.socialPulse?.items || [];
  const socialHtml = socialItems.length
    ? `
    <section class="fund-pulse-block">
      <h5>Social pulse <span class="social-badge ${escapeHtml((pulse.socialPulse.primaryBadge || "Curated").toLowerCase().replace(/\s+/g, "-"))}">${escapeHtml(pulse.socialPulse.primaryBadge || "Curated")}</span></h5>
      ${socialItems
        .slice(0, 6)
        .map(
          (row) => `
        <article class="fund-pulse-row">
          <div class="fund-pulse-head">
            <strong>${escapeHtml(row.title || "Item")}</strong>
            <span class="social-badge ${escapeHtml(String(row.badge || "Curated").toLowerCase().replace(/\s+/g, "-"))}">${escapeHtml(row.badge || "Curated")}</span>
          </div>
          <p class="muted">${escapeHtml(row.summary || "")}</p>
          ${row.url ? `<a class="link-button" href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">Open source</a>` : ""}
        </article>`
        )
        .join("")}
      <p class="muted">${escapeHtml(pulse.socialPulse.disclaimer || "")}</p>
    </section>`
    : "";

  tray.innerHTML = quoteHtml + figureHtml + socialHtml;
  if (pulse?.disclaimer) {
    tray.insertAdjacentHTML("beforeend", `<p class="funds-disclaimer muted">${escapeHtml(pulse.disclaimer)}</p>`);
  }
  if (pulse?.updatedAt) {
    tray.insertAdjacentHTML(
      "beforeend",
      `<p class="muted fund-pulse-updated">Updated ${escapeHtml(freshnessText(pulse.updatedAt))}</p>`
    );
  }
}

function fundGraphNodeColor(node) {
  if (node.kind === "symbol") return "#d85a30";
  if (node.type === "bill") return "#378add";
  if (node.type === "lobby") return "#ba7517";
  if (node.type === "contract") return "#639922";
  if (node.type === "figure") return "#7f77dd";
  return "#888";
}

function renderFundRelationshipGraph(attr) {
  const canvas = document.getElementById("fund-map-canvas");
  const legend = $("#fund-map-legend");
  if (!canvas) return;
  const graph = attr?.graph;
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const wrap = canvas.parentElement;
  const W = Math.max(320, wrap?.clientWidth || 640);
  const H = 220;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  if (!nodes.length) {
    ctx.font = "12px Outfit, sans-serif";
    ctx.fillStyle = "#888";
    ctx.fillText("No relationship edges in this window.", 16, 28);
    if (legend) legend.innerHTML = "";
    return;
  }

  const sources = nodes.filter((n) => n.kind === "source");
  const symbols = nodes.filter((n) => n.kind === "symbol");
  const placed = new Map();
  const leftX = W * 0.2;
  const rightX = W * 0.8;
  const padY = 24;
  const usable = H - padY * 2;

  sources.forEach((node, i) => {
    const y = padY + (usable * (i + 1)) / (sources.length + 1);
    placed.set(node.id, { x: leftX, y, node });
  });
  symbols.forEach((node, i) => {
    const y = padY + (usable * (i + 1)) / (symbols.length + 1);
    placed.set(node.id, { x: rightX, y, node });
  });

  const maxWeight = Math.max(1, ...edges.map((e) => Number(e.weight || 1)));
  edges.forEach((edge) => {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) return;
    const weight = Number(edge.weight || 1);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = "rgba(91, 191, 130, 0.35)";
    ctx.lineWidth = 1 + (weight / maxWeight) * 4;
    ctx.stroke();
  });

  placed.forEach(({ x, y, node }) => {
    const r = node.kind === "symbol" ? 16 : 12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fundGraphNodeColor(node);
    ctx.fill();
    ctx.font = node.kind === "symbol" ? "10px IBM Plex Mono, monospace" : "9px IBM Plex Mono, monospace";
    ctx.fillStyle = "#f4f1ea";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = String(node.label || "").slice(0, node.kind === "symbol" ? 5 : 10);
    ctx.fillText(label, x, y);
  });

  if (legend) {
    legend.innerHTML = [
      graph.legend ? `<span class="mini-pill">${escapeHtml(graph.legend)}</span>` : "",
      `<span class="mini-pill">Legislation</span>`,
      `<span class="mini-pill">Lobbying</span>`,
      `<span class="mini-pill">Contracts</span>`,
      `<span class="mini-pill">Figures</span>`,
      `<span class="mini-pill green">Tickers</span>`
    ].join("");
  }
}

function renderFundCompareTable(perf) {
  const tbody = $("#fund-compare-body");
  if (!tbody) return;
  const rets = perf?.basket?.returns || {};
  const benchRets = perf?.benchmark?.returns || {};
  const maxDd = perf?.basket?.maxDrawdownPct;

  const rows = [
    ["1W", rets["1w"], benchRets["1w"]],
    ["1M", rets["1m"], benchRets["1m"]],
    ["6M", rets["6m"], benchRets["6m"]]
  ];

  tbody.innerHTML = rows.map(([label, basketPct, benchPct]) => `
    <tr>
      <td>${label}</td>
      <td class="${Number(basketPct) >= 0 ? "up" : "down"}">${basketPct == null ? "—" : `${signed(basketPct)}%`}</td>
      <td class="${Number(benchPct) >= 0 ? "up" : "down"}">${benchPct == null ? "—" : `${signed(benchPct)}%`}</td>
      <td>${label === "6M" && maxDd != null ? `${maxDd}%` : "—"}</td>
    </tr>
  `).join("");
}

function renderFundLeaderboard(perf) {
  const host = $("#fund-leaderboard");
  if (!host) return;
  const rows = perf?.leaderboard || [];
  host.innerHTML = rows.length
    ? rows.map((row, idx) => `
      <article class="fund-leader-row ${idx === 0 ? "top" : ""}">
        <strong>${escapeHtml(row.symbol)}</strong>
        <span class="${Number(row.returnPct) >= 0 ? "up" : "down"}">${signed(row.returnPct)}%</span>
        <small class="muted">${Number((row.weight || 0) * 100).toFixed(0)}% weight · ${escapeHtml(row.source || "")}</small>
      </article>
    `).join("")
    : `<p class="muted">No symbol returns yet.</p>`;
}

function attributionTypeLabel(type) {
  return { bill: "Bill", lobby: "Lobbying", contract: "Contract", figure: "Figure" }[type] || type;
}

function renderFundAttributionTray(attr) {
  const tray = $("#fund-attribution-tray");
  if (!tray) return;
  const events = attr?.events || [];
  tray.innerHTML = events.length
    ? events.map((ev, idx) => `
      <article class="fund-attrib-row" data-type="${escapeHtml(ev.type)}" data-attrib-idx="${idx}" data-attrib-date="${escapeHtml(ev.date || "")}" tabindex="0" role="button">
        <div class="fund-attrib-head">
          <span class="mini-pill">${escapeHtml(attributionTypeLabel(ev.type))}</span>
          <time datetime="${escapeHtml(ev.date)}">${escapeHtml(ev.date)}</time>
        </div>
        <h5>${escapeHtml(ev.label)}</h5>
        <p class="muted">${(ev.symbolsAffected || []).map((s) => `<span class="mini-pill green">${escapeHtml(s)}</span>`).join(" ")}</p>
        <p class="muted">${escapeHtml(ev.source || "")}</p>
        ${ev.url ? `<a class="link-button" href="${escapeHtml(ev.url)}" target="_blank" rel="noopener noreferrer">Open source</a>` : ""}
        <details class="fund-attrib-evidence">
          <summary>View evidence</summary>
          <div class="fund-attrib-evidence-body">${renderEvidenceDrawerItems(ev.evidence || [], "No receipt items for this event.")}</div>
          <p class="muted fund-attrib-evidence-note">Research context only — not causal attribution.</p>
        </details>
      </article>
    `).join("")
    : `<p class="muted">No mapped events in this window for these tickers.</p>`;

  tray.querySelectorAll(".fund-attrib-row[data-attrib-date]").forEach((row) => {
    const activate = () => {
      tray.querySelectorAll(".fund-attrib-row").forEach((r) => r.classList.remove("fund-attrib-row-focus"));
      row.classList.add("fund-attrib-row-focus");
      const chartHost = $("#fund-performance-chart");
      if (chartHost && window.TSCharts?.focusMarker) {
        window.TSCharts.focusMarker(chartHost, {
          date: row.dataset.attribDate,
          type: row.dataset.type
        });
      }
    };
    row.addEventListener("click", activate);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
  });

  if (attr?.disclaimer) {
    tray.insertAdjacentHTML(
      "beforeend",
      `<p class="funds-disclaimer muted">${escapeHtml(attr.disclaimer)}</p>`
    );
  }
}

function matrixCellColor(score) {
  const n = Math.max(0, Math.min(100, Number(score) || 0));
  const alpha = (0.16 + n / 150).toFixed(3);
  return `rgba(91, 191, 130, ${alpha})`;
}

function renderFundRelationshipMatrix(attr) {
  const host = $("#fund-matrix-grid");
  const summary = $("#fund-matrix-summary");
  if (!host || !summary) return;
  const matrix = attr?.matrix;
  const symbols = matrix?.symbols || [];
  const rows = matrix?.rows || [];
  if (!symbols.length || !rows.length) {
    host.innerHTML = `<p class="muted" style="padding:10px">No matrix data for this range yet.</p>`;
    summary.innerHTML = "";
    return;
  }

  const header = symbols.map((sym) => `<th>${escapeHtml(sym)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = (row.cells || [])
        .map((cell) => {
          const score = Number(cell.score || 0);
          return `<td class="fund-matrix-cell" style="background:${matrixCellColor(score)}">${score.toFixed(0)}</td>`;
        })
        .join("");
      return `
      <tr>
        <td class="fund-matrix-row-head">${escapeHtml(row.label || row.type)} <span class="muted">(${Number(row.eventCount || 0)})</span></td>
        ${cells}
        <td class="up">${Number(row.rowScore || 0).toFixed(0)}</td>
      </tr>`;
    })
    .join("");

  host.innerHTML = `
    <table class="fund-matrix-table">
      <thead>
        <tr>
          <th>Source</th>
          ${header}
          <th>Row score</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;

  const topCols = (matrix.columnScores || [])
    .slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 4);
  summary.innerHTML = [
    matrix.legend ? `<span class="mini-pill">${escapeHtml(matrix.legend)}</span>` : "",
    ...topCols.map(
      (col) => `<span class="mini-pill green">${escapeHtml(col.symbol)} ${Number(col.score || 0).toFixed(0)}</span>`
    )
  ].join("");
}

function renderFundPerformanceChart(perf, attr) {
  const host = $("#fund-performance-chart");
  if (!host || !window.TSCharts) return;
  const points = perf?.basket?.points || [];
  if (!points.length) {
    window.TSCharts.destroy(host);
    host.innerHTML = `<div class="empty-chart">${escapeHtml(perf?.message || "Not enough history for this basket.")}</div>`;
    return;
  }

  const markers = (attr?.events || []).slice(0, 12).map((ev) => ({
    type: ev.type,
    date: ev.date,
    label: ev.label,
    url: ev.url
  }));
  const sources = (perf?.sources || []).map((s) => s.source).filter(Boolean);
  const sourceLabel = sources.length ? [...new Set(sources)].join(" · ") : "mixed";

  const normalized = window.TSCharts.normalizePoints(points);
  if (!host.dataset.tsChartMounted) {
    window.TSCharts.mount(host, {
      points: normalized,
      mode: "line",
      symbol: perf?.fund?.name || "Basket",
      source: `Index start=100 · ${sourceLabel}`,
      yLabel: "Basket index",
      xLabel: "Date →",
      height: 200,
      markers,
      formatMoney: (v) => Number(v).toFixed(2)
    });
    host.dataset.tsChartMounted = "1";
  } else {
    window.TSCharts.update(host, { points: normalized, source: `Index start=100 · ${sourceLabel}`, markers });
  }
}

function positionPolicyRiskHtml(symbol) {
  const bill = policyBills()
    .filter((item) => (item.affected || []).includes(symbol))
    .sort((a, b) => billMomentum(b) - billMomentum(a))[0];
  if (!bill) return `<span class="score-badge neutral">No mapped risk</span>`;
  const score = Number(bill.policyExposure ?? billMomentum(bill));
  const cls = score >= 67 ? "high" : score < 35 ? "low" : "medium";
  return `<span class="score-badge ${cls}" title="${escapeHtml(bill.title || "")}">${score}/100 ${escapeHtml(bill.id || "")}</span>`;
}

async function loadTradeHistory(symbol, range = state.tradeRange) {
  state.tradeSymbol = symbol;
  state.tradeRange = range;
  const title = $("#trade-symbol-title");
  if (title) title.textContent = `${symbol} paper trade setup`;
  const chart = $("#trade-history-chart");
  if (chart) {
    if (window.TSCharts) window.TSCharts.destroy(chart);
    delete chart.dataset.tsChartMounted;
    chart.innerHTML = `<div class="empty-chart">Loading ${symbol} history...</div>`;
  }
  try {
    state.tradeHistory = await fetchJson(`/api/market/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`);
    renderTradePanel();
  } catch {
    if (chart) chart.innerHTML = `<div class="empty-chart">Historical chart unavailable.</div>`;
  }
}

function renderTradePanel() {
  const symbol = state.tradeSymbol;
  const quote = quoteFor(symbol);
  const history = state.tradeHistory?.symbol === symbol ? state.tradeHistory : null;
  const stats = history?.stats || {};
  const position = (state.account?.positions || []).find((item) => item.symbol === symbol);

  const symbolSelect = $("#order-symbol");
  if (symbolSelect && symbolSelect.value !== symbol) symbolSelect.value = symbol;
  $("#trade-symbol-title").textContent = `${symbol} paper trade setup`;
  $("#trade-symbol-price").textContent = quote ? money(quote.price) : "Loading";
  $("#trade-symbol-price").className = quote?.pct >= 0 ? "up" : "down";
  $("#trade-history-range").textContent = stats.low ? `${money(stats.low)} - ${money(stats.high)}` : "Loading";
  $("#trade-history-return").textContent = `${signed(stats.pct || 0)}%`;
  $("#trade-history-return").className = Number(stats.pct || 0) >= 0 ? "up" : "down";
  renderTradeHistoryChart(history, symbol, quote);
  $("#trade-plain-context").innerHTML = tradePlainContext(symbol, quote, stats, position, history?.source);
  updateOrderEstimate();
}

function tradePlainContext(symbol, quote, stats, position, source) {
  const bill = policyBills().find((item) => (item.affected || []).includes(symbol));
  const trend = Number(stats.pct || 0) >= 0 ? "up" : "down";
  const owned = position ? `You currently own ${fmt(position.qty)} paper shares with ${money(position.marketValue)} marked value.` : "You do not currently own this stock in the paper account.";
  const policy = bill
    ? `Policy watch: ${bill.title} — Legislative momentum ${billMomentum(bill)}/100 · Policy exposure ${Number(bill.policyExposure ?? billMomentum(bill))}/100 · Confidence ${billConfidenceLabel(bill)}. ${bill.relationshipSummary || bill.impact}`
    : "No high-conviction bill is mapped to this ticker right now.";
  return `
    <strong>Plain-English chart read</strong>
    <p>${symbol} is ${trend} ${fmt(Math.abs(stats.pct || 0))}% over this selected range. Today it is ${quote ? signed(quote.pct) : "0.00"}%.</p>
    <p>${owned}</p>
    <p>${escapeHtml(policy)}</p>
    <small>History source: ${escapeHtml(sourceLabel(source || "loading"))}. This is practice trading, not financial advice.</small>
  `;
}

function updateOrderEstimate() {
  const symbol = $("#order-symbol")?.value || state.tradeSymbol;
  const qty = Number($("#order-qty")?.value || 0);
  const side = $("#order-side")?.value || "buy";
  const quote = quoteFor(symbol);
  const notional = quote && qty > 0 ? quote.price * qty : 0;
  const estimate = $("#trade-order-estimate");
  if (estimate) estimate.textContent = `${side.toUpperCase()} est. ${money(notional)}`;
}

function formatPointDate(value) {
  if (!value) return "Point";
  if (String(value).includes("T")) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }
  return value;
}

function ensureChartMetaEl(host, id) {
  let meta = document.getElementById(id);
  if (!meta && host?.parentElement) {
    meta = document.createElement("div");
    meta.id = id;
    meta.className = "sparkline-meta";
    host.after(meta);
  }
  return meta;
}

function renderTradeHistoryChart(history, symbol, quote) {
  const host = $("#trade-history-chart");
  if (!host) return;
  const points = history?.points || [];
  if (!points.length || !window.TSCharts) {
    if (window.TSCharts) window.TSCharts.destroy(host);
    delete host.dataset.tsChartMounted;
    host.innerHTML = `<div class="empty-chart">No historical data loaded.</div>`;
    const meta = document.getElementById("trade-history-meta");
    if (meta) meta.innerHTML = "";
    return;
  }

  const normalized = window.TSCharts.normalizePoints(points);
  const source = sourceLabel(history?.source || "loading");
  const mode = window.TSCharts.hasOhlc(normalized) ? "candle" : "line";

  if (!host.dataset.tsChartMounted) {
    window.TSCharts.mount(host, {
      points: normalized,
      mode,
      symbol,
      source,
      yLabel: `${symbol} price (USD)`,
      xLabel: "Time →",
      height: 280,
      formatMoney: money,
      formatDate: formatPointDate,
      liveLabel: quote?.price ? `Live ${money(quote.price)}` : ""
    });
    host.dataset.tsChartMounted = "1";
  } else {
    window.TSCharts.update(host, {
      points: normalized,
      mode,
      liveValue: quote?.price,
      source,
      liveLabel: quote?.price ? `Live ${money(quote.price)}` : ""
    });
  }

  const closes = normalized.map((p) => p.close);
  const up = closes[closes.length - 1] >= closes[0];
  const sampled = normalized.filter((_, i) => i % Math.max(1, Math.floor(normalized.length / 4)) === 0).slice(0, 4);
  const meta = ensureChartMetaEl(host, "trade-history-meta");
  if (meta) {
    meta.innerHTML = `
      <span>${escapeHtml(sampled[0]?.date || "")}</span>
      <strong class="${up ? "up" : "down"}">${money(closes[closes.length - 1])}</strong>
      <span>${escapeHtml(normalized[normalized.length - 1]?.date || "")}</span>`;
  }
}

function renderAnalysisPriceChart(symbol, pts, charts, quote) {
  const host = $("#analysis-sparkline");
  if (!host) return;
  if (!pts.length || !window.TSCharts) {
    if (window.TSCharts) window.TSCharts.destroy(host);
    delete host.dataset.tsChartMounted;
    host.innerHTML = `<div class="empty-chart">No trend data for this window.</div>`;
    return;
  }

  const normalized = window.TSCharts.normalizePoints(
    pts.map((p) => ({
      date: p.date || p.label || "",
      close: p.value ?? p.close,
      open: p.open,
      high: p.high,
      low: p.low
    }))
  );
  const caption = priceTrendCaption(symbol, charts);
  const mode = window.TSCharts.hasOhlc(normalized) ? "candle" : "line";

  if (!host.dataset.tsChartMounted) {
    window.TSCharts.mount(host, {
      points: normalized,
      mode,
      symbol,
      source: caption,
      yLabel: `${symbol} price (USD)`,
      xLabel: "Time →",
      height: 210,
      formatMoney: money,
      formatDate: formatPointDate,
      liveLabel: quote?.price ? `Live ${money(quote.price)}` : ""
    });
    host.dataset.tsChartMounted = "1";
  } else {
    window.TSCharts.update(host, {
      points: normalized,
      liveValue: quote?.price,
      source: caption,
      liveLabel: quote?.price ? `Live ${money(quote.price)}` : ""
    });
  }
}

function renderLobbyMappingStatus(lobby) {
  const el = $("#analysis-lobby-map-status");
  if (!el) return;
  const data = lobby || {};
  const reason = data.reason || data.status || "no_match";
  const pillClass =
    reason === "matched" ? "green" : reason === "api_error" ? "red" : reason === "not_requested" ? "" : "amber";
  const copy =
    reason === "api_error"
      ? data.error || "Lobby mapper could not run. Bill-linked filings below may still appear."
      : reason === "not_requested"
        ? data.summary || "Lobby mapping was not requested for this snapshot."
        : data.summary ||
          (data.matches?.length
            ? `${data.matches.length} lobbying ${data.matches.length === 1 ? "filing is" : "filings are"} mapped to active policy issues.`
            : "No lobbying activity mapped to this ticker yet.");
  el.innerHTML = `
    <div class="lobby-map-status empty-state-card ${escapeHtml(reason)}">
      <div class="meta-line">
        <span class="mini-pill ${pillClass}">${escapeHtml(data.confidence || (reason === "matched" ? "Medium" : "No match"))}</span>
        <span class="muted">${escapeHtml(data.source || "TradeSimple mapper")}</span>
      </div>
      <p>${escapeHtml(copy)}</p>
    </div>`;
}

function renderConnections() {
  const config = state.config;
  const grid = $("#connection-grid");
  if (!config || !grid) return;
  // Expose AI availability to inline scripts (e.g. causality loading message)
  document.body.dataset.anthropicReady = String(Boolean(config.data?.anthropic));
  const rows = [
    ["Google OAuth", config.auth.google, "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"],
    ["Apple OAuth", config.auth.apple, "APPLE_CLIENT_ID and APPLE_CLIENT_SECRET"],
    ["Finnhub equities", config.data.finnhub, "FINNHUB_API_KEY"],
    ["CoinGecko crypto", config.data.coingecko, "COINGECKO_API_KEY"],
    ["Congress.gov bills", config.data.congress, "CONGRESS_API_KEY"],
    ["Senate LDA lobbying", config.data.senateLda, "SENATE_LDA_API_KEY"],
    ["Alpaca paper broker", config.data.alpaca, "ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY"],
    ["Anthropic research", config.data.anthropic, "ANTHROPIC_API_KEY"],
    ["SEC EDGAR (10-K)", config.data.secEdgar, "SEC_USER_AGENT in .env.local"],
    ["Live trading lock", !config.safety.liveTradingEnabled, "ALLOW_LIVE_TRADING=false"]
  ];

  grid.innerHTML = rows.map(([name, ok, env]) => `
    <article class="connection-card ${ok ? "ok" : "missing"}">
      <span class="mini-pill ${ok ? "green" : "red"}">${ok ? "Configured" : "Needs key"}</span>
      <strong>${name}</strong>
      <p class="muted">${env}</p>
    </article>
  `).join("");
}

function resetEdgarPanel() {
  const meta = $("#edgar-meta");
  const body = $("#edgar-risk-body");
  const simplified = $("#edgar-simplified");
  const link = $("#edgar-source-link");
  const btn = $("#edgar-load-btn");
  if (meta) meta.textContent = "";
  if (body) body.textContent = "";
  if (simplified) {
    simplified.hidden = true;
    simplified.innerHTML = "";
  }
  if (link) {
    link.hidden = true;
    link.href = "#";
  }
  if (btn) btn.disabled = false;
}

function renderEdgarSection(title, items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return "";
  return `
    <section class="edgar-simplified-block">
      <h3 class="edgar-simplified-title">${escapeHtml(title)}</h3>
      <ul class="edgar-simplified-list">${list.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("")}</ul>
    </section>`;
}

function renderEdgarSimplified(simplified) {
  const el = $("#edgar-simplified");
  if (!el || !simplified) {
    if (el) el.hidden = true;
    return;
  }
  const blocks = [
    renderEdgarSection("Where the money comes from", simplified.whereMoneyComesFrom),
    renderEdgarSection("What could hurt the company", simplified.whatCouldHurtIt),
    simplified.numbersGoingRight
      ? `<section class="edgar-simplified-block"><h3 class="edgar-simplified-title">Are the numbers moving the right way?</h3><p>${escapeHtml(
          String(simplified.numbersGoingRight)
        )}</p></section>`
      : ""
  ].filter(Boolean);
  if (!blocks.length) {
    el.hidden = true;
    return;
  }
  el.innerHTML = `<p class="edgar-simplified-source muted">Source: SEC EDGAR 10-K · plain-English translation</p>${blocks.join("")}`;
  el.hidden = false;
}

async function loadEdgarRiskFactors(symbol) {
  const meta = $("#edgar-meta");
  const bodyEl = $("#edgar-risk-body");
  const link = $("#edgar-source-link");
  const btn = $("#edgar-load-btn");
  if (!btn || !bodyEl) return;

  if (!symbol || symbol === "SPY" || symbol === "QQQ") {
    resetEdgarPanel();
    if (meta) meta.textContent = "Choose a company ticker (not SPY/QQQ) for SEC issuer filings.";
    return;
  }

  btn.disabled = true;
  if (meta) meta.textContent = "Fetching from SEC EDGAR…";
  bodyEl.textContent = "";
  if (link) link.hidden = true;

  try {
    const data = await fetchJson(`/api/edgar/${encodeURIComponent(symbol)}`);
    if (meta) {
      meta.textContent = `${data.company || data.symbol} · ${data.form || "10-K"} filed ${data.filingDate || ""}`;
    }
    if (link && data.sourceUrl) {
      link.href = data.sourceUrl;
      link.hidden = false;
    }
    renderEdgarSimplified(data.simplified);
    bodyEl.textContent =
      data.riskFactors?.trim() ||
      "No Item 1A section was extracted. Use the SEC link to read the filing.";
  } catch (error) {
    if (meta) meta.textContent = "Could not load EDGAR data.";
    bodyEl.textContent = error.message || String(error);
  } finally {
    btn.disabled = false;
  }
}

function setupEdgarControls() {
  const btn = $("#edgar-load-btn");
  if (!btn) return;
  btn.addEventListener("click", () => loadEdgarRiskFactors(state.activeAnalysisSymbol));
}

function priceTrendSourceLabel(charts) {
  if (!charts) return "modeled";
  const src = charts.priceTrendSource || "modeled_trend";
  const map = {
    finnhub: "Finnhub daily",
    yfinance: "Yahoo (yfinance)",
    yahoo_chart: "Yahoo chart",
    stooq_public: "Stooq daily",
    modeled_history: "modeled OHLC",
    modeled_trend: "modeled curve"
  };
  return map[src] || String(src).replace(/_/g, " ");
}

function priceTrendCaption(symbol, charts) {
  const range = (charts && charts.priceTrendRange) || "6m";
  return `${symbol} · ${range} · ${priceTrendSourceLabel(charts)}`;
}

async function loadAnalysis(symbol) {
  state.activeAnalysisSymbol = symbol;
  resetEdgarPanel();
  const sparkHost = $("#analysis-sparkline");
  if (sparkHost) {
    if (window.TSCharts) window.TSCharts.destroy(sparkHost);
    delete sparkHost.dataset.tsChartMounted;
  }
  const source = $("#analysis-source");
  if (source) source.textContent = "Loading";

  try {
    const mode = state.readerMode || getStoredReaderMode();
    const analysis = await fetchJson(
      `/api/share/stock?symbol=${encodeURIComponent(symbol)}&mode=${encodeURIComponent(mode)}`
    );
    const policyNetwork = analysis.policyNetwork || {
      focusSymbol: symbol,
      focusBills: analysis.legisAlert || [],
      allBills: analysis.legisAlert || [],
      stakeholderMap: analysis.stakeholderMap || null,
      catalysts: analysis.legisAlert?.map((bill) => bill.catalyst).filter(Boolean) || [],
      source: analysis.source || {}
    };
    state.analysis = analysis;
    state.policyNetwork = policyNetwork;
    if (policyNetwork.catalysts?.length) state.policyCatalysts = policyNetwork.catalysts;
    renderAnalysis();
    renderOverview();
    renderBills();
    renderPolicyCatalysts();
    renderLobbying();
  } catch (error) {
    if (source) source.textContent = "Analysis unavailable";
    const summary = $("#analysis-left-summary");
    if (summary) summary.textContent = "The analysis endpoint did not return. Check the server console and try again.";
  }
}

function setAnalysisScoreBadge(el, value, badgeClass) {
  if (!el) return;
  el.className = `score-badge ${badgeClass}`;
  el.textContent = `${value}/100`;
}

/** Legislative / lobby / policy badges share one scale (same as bill tables): ≥67 → high, <35 → low, else medium. */
function analysisScoreTierClass(score, hasBills) {
  if (!hasBills) return "neutral";
  const n = Number(score);
  if (n >= 67) return "high";
  if (n < 35) return "low";
  return "medium";
}

function renderAnalysisHero(analysis) {
  const symbol = analysis.symbol || state.activeAnalysisSymbol || "—";
  const quote = analysis.quote || {};
  const price = Number(quote.price || 0);
  const pct = Number(quote.pct ?? quote.changePercent ?? 0);
  const change = Number(quote.change || 0);
  const signal = analysis.governmentSignals || {};
  const updated = formatQuoteMeta(quote) || (quote.fetchedAt || analysis.updatedAt ? `Updated ${freshnessText(quote.fetchedAt || analysis.updatedAt)}` : "Updated shortly");

  const symEl = $("#analysis-hero-symbol");
  const companyEl = $("#analysis-hero-company");
  const policyEl = $("#analysis-hero-policy-line");
  const priceEl = $("#analysis-hero-price");
  const changeEl = $("#analysis-hero-change");
  const updatedEl = $("#analysis-hero-updated");

  if (symEl) symEl.textContent = symbol;
  if (companyEl) companyEl.textContent = analysis.company?.name || symbol;
  if (policyEl) policyEl.textContent = signal.headline || `${symbol} government exposure is loading.`;
  if (priceEl) priceEl.textContent = price ? money(price) : "—";
  if (changeEl) {
    changeEl.className = pct >= 0 ? "up" : "down";
    changeEl.textContent = `${change >= 0 ? "+" : ""}${money(Math.abs(change))} / ${signed(pct)}%`;
  }
  if (updatedEl) updatedEl.textContent = updated;

  renderShareButton(symbol);
}

function renderShareButton(symbol) {
  const btn = $("#analysis-share-btn");
  if (!btn) return;
  btn.textContent = "Share Card";
  btn.onclick = async () => {
    const url = `${window.location.origin}${publicStockCardUrl(symbol)}`;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = "Card link copied";
      window.setTimeout(() => {
        btn.textContent = "Share Card";
      }, 1800);
    } catch (_) {
      btn.textContent = url;
    }
  };
}

function renderGovernmentExplainer(analysis) {
  const explainer = analysis.explainer || analysis.scorecard || {};
  const signals = analysis.governmentSignals || {};
  const nowEl = $("#analysis-explainer-now");
  const whyEl = $("#analysis-explainer-why");
  const watchEl = $("#analysis-explainer-watch");
  const sourceEl = $("#analysis-explainer-source");
  const fallbackNow = signals.detail || "TradeSimple is mapping government signals to this ticker.";
  const fallbackWhy = "The market mechanism is the bridge: revenue, margin, capex, contract visibility, compliance cost, or investor expectations.";
  const watch = Array.isArray(explainer.watchFor) && explainer.watchFor.length
    ? explainer.watchFor
    : (analysis.legisAlert || []).flatMap((bill) => watchForBullets(bill)).slice(0, 3);

  if (nowEl) nowEl.textContent = explainer.now || fallbackNow;
  if (whyEl) whyEl.textContent = explainer.whyItMatters || fallbackWhy;
  if (watchEl) {
    watchEl.innerHTML = (watch.length ? watch : ["New government filings", "Company revenue commentary", "Rule or bill text changes"])
      .slice(0, 3)
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
  }
  if (sourceEl) {
    const mode = analysis.readerMode || state.readerMode || "investor";
    sourceEl.textContent = `${mode} mode · ${sourceLabel(explainer.source || "structured snapshot")}${explainer.cached ? " · cached" : ""}`;
  }
}

function renderAnalysisRiskRadar(items) {
  const el = $("#analysis-risk-radar");
  if (!el) return;
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    el.innerHTML = `<article class="empty-state">Risk radar is waiting for the stock snapshot.</article>`;
    return;
  }
  el.innerHTML = rows.map((item) => {
    const value = Math.max(0, Math.min(100, Number(item.value || 0)));
    const tone = value >= 67 ? "high" : value < 35 ? "low" : "medium";
    return `
      <article class="risk-radar-row ${tone}">
        <div class="risk-radar-top">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${Math.round(value)}/100</span>
        </div>
        <div class="risk-radar-track" aria-hidden="true"><span style="width:${value}%"></span></div>
        <p>${escapeHtml(item.caption || item.explain || "")}</p>
      </article>
    `;
  }).join("");
}

function evidenceLink(url, label) {
  if (!url) return `<span class="mini-pill">${escapeHtml(label || "Source")}</span>`;
  return `<a class="mini-pill evidence-source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || "Source")}</a>`;
}

function renderEvidenceStack(evidence) {
  const el = $("#analysis-evidence-stack");
  if (!el) return;
  const data = evidence || {};
  const news = (data.recentNews || []).slice(0, 5);
  const bills = (data.relatedBills || []).slice(0, 5);
  const lobbying = (data.lobbyingFilings || []).slice(0, 5);
  const sec = data.secFiling;
  const contracts = data.governmentContracts;
  const analyst = data.analystConsensus;

  const drawer = (title, count, body, open = false) => `
    <details class="evidence-drawer" ${open ? "open" : ""}>
      <summary><span>${escapeHtml(title)}</span><span>${escapeHtml(String(count))}</span></summary>
      <div class="evidence-drawer-body">${body}</div>
    </details>`;

  const newsBody = news.length
    ? news.map((item) => `
      <div class="evidence-item">
        ${evidenceLink(item.url, item.source || "News")}
        <p>${escapeHtml(item.headline || "")}</p>
        ${item.publishedAt ? `<small>${escapeHtml(freshnessText(item.publishedAt))}</small>` : ""}
      </div>`).join("")
    : `<p class="muted">No recent headlines returned by the company-news feed.</p>`;

  const billBody = bills.length
    ? bills.map((bill) => `
      <div class="evidence-item">
        ${evidenceLink(bill.sourceUrl, bill.sourceLabel || "Congress.gov")}
        <p><strong>${escapeHtml(bill.id || "")}</strong> ${escapeHtml(bill.title || "")}</p>
        <small>${escapeHtml(bill.latestAction || bill.status || "Status unavailable")} · Momentum ${Number(bill.legislativeMomentum || 0)}/100</small>
      </div>`).join("")
    : `<p class="muted">No bills are mapped to this symbol in the current snapshot.</p>`;

  const lobbyingBody = lobbying.length
    ? lobbying.map((row) => `
      <div class="evidence-item">
        ${evidenceLink(row.sourceUrl, row.sourceLabel || "Senate LDA")}
        <p><strong>${escapeHtml(row.client || "Mapped filing")}</strong> ${escapeHtml(row.issue || "")}</p>
        <small>${escapeHtml(row.billId || "")} · ${escapeHtml(row.direction || "neutral")} ${row.amount ? `· ${compactMoney(row.amount)}` : ""}</small>
      </div>`).join("")
    : `<p class="muted">No lobbying activity mapped to this symbol yet.</p>`;

  const secBody = sec
    ? `<div class="evidence-item">${evidenceLink(sec.sourceUrl, sec.sourceLabel || "SEC EDGAR")}<p>${escapeHtml(sec.form || "10-K")} filed ${escapeHtml(sec.filingDate || "date unavailable")}</p></div>`
    : `<p class="muted">SEC filing summary is unavailable for this snapshot.</p>`;

  const contractBody = contracts
    ? `<div class="evidence-item">${evidenceLink(contracts.sourceUrl, contracts.sourceLabel || "USASpending.gov")}<p>${escapeHtml(contracts.summary || "")}</p></div>`
    : `<p class="muted">No contract evidence loaded.</p>`;

  const analystBody = analyst
    ? `<div class="evidence-item">${evidenceLink(analyst.sourceUrl, analyst.sourceLabel || "Consensus")}<p>${escapeHtml(analyst.label || "Consensus view")}</p><small>${analyst.analystCount ? `${Number(analyst.analystCount)} analysts` : "Modeled profile"}${analyst.target ? ` · target ${money(analyst.target)}` : ""}</small></div>`
    : `<p class="muted">Analyst consensus is not mapped for this ticker.</p>`;

  const disclaimer = data.disclaimer
    ? `<p class="muted evidence-stack-note">${escapeHtml(data.disclaimer)}</p>`
    : `<p class="muted evidence-stack-note">Research context only — sources do not imply causation.</p>`;

  el.innerHTML = [
    drawer("Recent news", news.length, newsBody, true),
    drawer("Related bills", bills.length, billBody),
    drawer("Lobbying filings", lobbying.length, lobbyingBody),
    drawer("SEC filing risks", sec ? 1 : 0, secBody),
    drawer("Government contracts", contracts?.relevant ? 1 : 0, contractBody),
    drawer("Analyst consensus", analyst ? 1 : 0, analystBody),
    disclaimer
  ].join("");
}

function renderEdgarSnapshot(edgar) {
  const meta = $("#edgar-meta");
  const body = $("#edgar-risk-body");
  const link = $("#edgar-source-link");
  const btn = $("#edgar-load-btn");
  if (!meta || !body) return;

  if (!edgar) {
    meta.textContent = "SEC filing summary will load with the public snapshot when available.";
    return;
  }
  if (edgar.status !== "available") {
    meta.textContent = edgar.message || "SEC filing summary is unavailable for this ticker.";
    renderEdgarSimplified(null);
    if (link) link.hidden = true;
    return;
  }
  meta.textContent = `${edgar.company || edgar.symbol} · ${edgar.form || "10-K"} filed ${edgar.filingDate || ""}`;
  if (link && edgar.sourceUrl) {
    link.href = edgar.sourceUrl;
    link.hidden = false;
  }
  if (btn) btn.textContent = "Refresh SEC filing";
  renderEdgarSimplified(edgar.simplified);
  body.textContent = "Use the SEC.gov link for the original filing text, or refresh this block to fetch the full Item 1A excerpt.";
}

function renderAnalysis() {
  const analysis = state.analysis;
  if (!analysis) return;
  const quote = analysis.quote || {};
  const change = Number(quote.pct || 0);
  const symbol = analysis.symbol;
  const focusBills = analysisFocusBills();

  renderAnalysisHero(analysis);
  renderGovernmentExplainer(analysis);
  renderAnalysisRiskRadar(analysis.charts?.riskRadar || []);
  renderEvidenceStack(analysis.evidence || {});
  renderEdgarSnapshot(analysis.edgar);

  const analysisSource = $("#analysis-source");
  if (analysisSource) {
    analysisSource.innerHTML = [
      `quotes: ${escapeHtml(sourceLabel(analysis.source?.quote))}`,
      `fundamentals: ${escapeHtml(sourceLabel(analysis.source?.fundamentals || "modeled_fundamentals"))}`,
      `policy: ${escapeHtml(sourceLabel(analysis.source?.policy))}`,
      `snapshot: public share endpoint`
    ].join(" / ");
  }

  const quoteMetaEl = $("#analysis-quote-meta");
  if (quoteMetaEl) {
    const metaLine = formatQuoteMeta(quote);
    if (metaLine) {
      quoteMetaEl.textContent = metaLine;
      quoteMetaEl.hidden = false;
    } else {
      quoteMetaEl.textContent = "";
      quoteMetaEl.hidden = true;
    }
  }

  renderAnalysisRecentNews(analysis.recentNews);

  const name = analysis.company?.name || symbol;
  const sector = analysis.company?.sector || "tracked";
  const moat = String(analysis.company?.moat || "").trim();
  const govSignal = analysis.governmentSignals || {};
  const billN = focusBills.length;
  const pe = Number(analysis.fundamentals?.pe || 0);
  const growthExpect = pe > 40 || Number(analysis.fundamentals?.forwardPe || 0) > 35;
  const lineA = govSignal.headline || (moat
    ? `${name} — ${moat.endsWith(".") ? moat.slice(0, -1) : moat}.`
    : `${name} is a ${sector} company.`);
  const lineB = govSignal.detail || `Its stock price reflects ${growthExpect ? "high growth expectations in the market" : "how investors are pricing earnings today"}.`;
  const lineC =
    billN === 0
      ? "No bills in our tracked set map to this ticker — useful information for near-term policy risk."
      : `${billN} bill${billN === 1 ? "" : "s"} currently moving through Congress could affect its business.`;
  const topBill = billN ? [...focusBills].sort((a, b) => billMomentum(b) - billMomentum(a))[0] : null;
  const topSignal = topBill
    ? String(topBill.plainEnglish || topBill.signal || "")
        .trim()
        .replace(/\s+/g, " ")
    : "";
  const lineD = topSignal ? ` ${topSignal.endsWith(".") ? topSignal.slice(0, -1) : topSignal}.` : "";
  const leftSum = $("#analysis-left-summary");
  if (leftSum) leftSum.textContent = `${lineA} ${lineB} ${lineC}${lineD}`;

  const maxMom = billN ? Math.max(...focusBills.map((b) => billMomentum(b))) : 0;
  const maxLobby = billN ? Math.max(...focusBills.map((b) => Number(b.lobbyingPressureScore ?? 0))) : 0;
  const maxPol = billN ? Math.max(...focusBills.map((b) => Number(b.policyExposure ?? billMomentum(b)))) : 0;
  const momCls = analysisScoreTierClass(maxMom, billN);
  const lobCls = analysisScoreTierClass(maxLobby, billN);
  const polCls = analysisScoreTierClass(maxPol, billN);
  setAnalysisScoreBadge($("#analysis-score-legislation"), billN ? maxMom : 0, momCls);
  setAnalysisScoreBadge($("#analysis-score-lobby"), billN ? maxLobby : 0, lobCls);
  setAnalysisScoreBadge($("#analysis-score-policy"), billN ? maxPol : 0, polCls);

  const contractBlock = $("#analysis-score-contract-block");
  const contractBadge = $("#analysis-score-contract");
  const govDep = analysis.govDependencyScore;
  const hasContractData = govDep !== null && govDep !== undefined && analysis.contractProfile;
  if (contractBlock) contractBlock.hidden = !hasContractData;
  if (hasContractData && contractBadge) {
    const depCls = govDep >= 67 ? "high" : govDep < 35 ? "low" : "medium";
    setAnalysisScoreBadge(contractBadge, govDep, depCls);
  }

  renderContractInsightBanner(analysis);

  if (analysis.contractProfile && leftSum) {
    const cp = analysis.contractProfile;
    const pct = Math.round(cp.governmentRevenuePct * 100);
    const extra = ` Government contracts: ${pct}% of revenue (${cp.archetype}${cp.dogeRisk ? " — efficiency review flagged" : ""}).`;
    if (!leftSum.textContent.includes("Government contracts:")) leftSum.textContent += extra;
  }

  const pts = analysis.charts?.priceTrend || [];
  let trendPct = 0;
  if (pts.length >= 2) {
    const v0 = Number(pts[0].value || 0);
    const v1 = Number(pts[pts.length - 1].value || 0);
    if (v0) trendPct = ((v1 - v0) / v0) * 100;
  }
  const ctx = $("#analysis-price-context");
  if (ctx) {
    ctx.textContent =
      pts.length >= 2
        ? `Quote is supporting context: ${symbol} is ${signed(change)}% today and has ${trendPct >= 0 ? "gained" : "fallen"} ${fmt(
            Math.abs(trendPct)
          )}% over the trend window shown below. The explainer above focuses on the government mechanism, not a price prediction.`
        : `Quote is supporting context: ${symbol} is ${signed(change)}% today. The explainer above focuses on government mechanisms, not a price prediction.`;
  }

  $("#sparkline-caption").textContent = priceTrendCaption(symbol, analysis.charts);
  renderAnalysisPriceChart(symbol, pts, analysis.charts, quote);

  const metricOrder = [
    { id: "pe", label: "P/E ratio" },
    { id: "forwardPe", label: "Forward P/E" },
    { id: "ps", label: "Price to Sales" },
    { id: "grossMargin", label: "Gross Margin" },
    { id: "revenueGrowth", label: "Revenue Growth" },
    { id: "beta", label: "Beta" }
  ];
  const byId = Object.fromEntries((analysis.metrics || []).map((m) => [m.id, m]));
  const fundEl = $("#analysis-fundamentals-rows");
  if (fundEl) {
    fundEl.innerHTML = metricOrder
      .map(({ id, label }) => {
        const m = byId[id];
        const plain = m ? escapeHtml(`${m.plain} ${m.takeaway || ""}`.trim()) : "We do not have this metric modeled for this ticker yet.";
        const val = m ? escapeHtml(String(m.value)) : "—";
        return `
          <div class="analysis-fund-row">
            <div class="analysis-fund-mono"><strong>${escapeHtml(label)} <em class="model-tag">Modeled</em></strong><span>${val}</span></div>
            <div class="analysis-fund-plain">${plain}</div>
          </div>
          <hr class="analysis-fund-hr" />
        `;
      })
      .join("");
  }

  const f = analysis.fundamentals || {};
  const analystEl = $("#analysis-analyst-card");
  if (analystEl) {
    const consensus = analysis.evidence?.analystConsensus?.label || (f.analystRating === "ETF" ? "Benchmark view" : "Consensus view");
    const rating = escapeHtml(consensus);
    const tgt = f.analystTarget != null ? money(Number(f.analystTarget)) : "—";
    const count =
      f.analystCount != null && Number(f.analystCount) > 0
        ? `${Number(f.analystCount)} analysts`
        : f.analystRating === "ETF"
          ? "Index / ETF — targets are benchmark-style"
          : "Consensus (modeled)";
    const catalyst = f.catalyst ? escapeHtml(f.catalyst) : "No separate catalyst line — see bull/bear below.";
    analystEl.innerHTML = `
      <div class="analyst-card-grid">
        <div>
          <span class="signal-label-sm">Street view</span>
          <div class="analyst-rating-row">
            <strong class="analyst-rating-pill">${rating}</strong>
            <span class="muted">Target <strong>${tgt}</strong></span>
          </div>
          <p class="analyst-catalyst">${catalyst}</p>
          <small class="muted">${escapeHtml(count)}</small>
        </div>
        <div class="analyst-bullbear">
          <p><span class="mini-pill green">Positive scenario</span> ${escapeHtml(f.plainBull || "")}</p>
          <p><span class="mini-pill red">Risk scenario</span> ${escapeHtml(f.plainBear || "")}</p>
        </div>
      </div>
    `;
  }

  const shortCo = name.split(" ")[0];
  const edBtn = $("#edgar-load-btn");
  if (edBtn) edBtn.textContent = `Refresh ${shortCo} 10-K translation`;

  renderAnalysisBillsTable(symbol);
  renderAnalysisLobbyTab();
  renderAnalysisContractsTab(symbol, name);
  renderAnalysisPolicyChains(analysis.policyChains || []);
}

function renderAnalysisRecentNews(recentNews) {
  const panel = $("#analysis-news-panel");
  const list = $("#analysis-recent-news");
  if (!panel || !list) return;

  const items = Array.isArray(recentNews) ? recentNews.filter((n) => n && n.headline) : [];
  if (!items.length) {
    panel.hidden = true;
    list.innerHTML = "";
    return;
  }

  panel.hidden = false;
  list.innerHTML = items.slice(0, 5).map((item) => {
    const src = escapeHtml(item.source || "News");
    const headline = escapeHtml(item.headline || "");
    const url = item.url ? escapeHtml(item.url) : "";
    const inner = url
      ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${headline}</a>`
      : headline;
    return `<li class="analysis-news-item"><span class="mini-pill">${src}</span> ${inner}</li>`;
  }).join("");
}

function initMoneyTrailClose() {
  const closeBtn = $("#money-trail-close");
  if (!closeBtn || closeBtn.dataset.bound) return;
  closeBtn.dataset.bound = "1";
  closeBtn.addEventListener("click", () => {
    const panel = $("#analysis-money-trail");
    if (panel) panel.hidden = true;
  });
}

function renderStakeholderMap(map) {
  const el = $("#stakeholder-map");
  if (!el) return;
  if (!map?.nodes?.length) {
    el.innerHTML = `<article class="empty-state">No stakeholder graph loaded yet.</article>`;
    return;
  }
  const groups = ["person", "committee", "lobby", "bill", "ticker"].map((type) => ({
    type,
    nodes: map.nodes.filter((node) => node.type === type)
  })).filter((group) => group.nodes.length);

  el.innerHTML = `
    <div class="stakeholder-summary">
      ${(map.legend || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
    </div>
    <div class="stakeholder-node-grid">
      ${groups.map((group) => `
        <section class="stakeholder-group">
          <h3>${groupLabel(group.type)}</h3>
          ${group.nodes.slice(0, 6).map((node) => `
            <div class="stakeholder-node ${toneClass(node.tone)}">
              <span>${escapeHtml(node.label)}</span>
              <small>${escapeHtml(node.detail || node.title || "")}</small>
            </div>
          `).join("")}
        </section>
      `).join("")}
    </div>
    <div class="relationship-flow">
      ${(map.links || []).slice(0, 10).map((link) => {
        const from = map.nodes.find((node) => node.id === link.from);
        const to = map.nodes.find((node) => node.id === link.to);
        return `
          <article class="relationship-link ${toneClass(link.tone)}">
            <strong>${escapeHtml(from?.label || link.from)} -> ${escapeHtml(to?.label || link.to)}</strong>
            <p>${escapeHtml(link.label || "")}</p>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function legisAlertCard(bill, options = {}) {
  const momentum = billMomentum(bill);
  const exposure = Number(bill.policyExposure ?? momentum);
  const conf = billConfidenceLabel(bill);
  const lobbyScore = Number(bill.lobbyingPressureScore ?? 0);
  const lobbyConf = bill.lobbyingSignalConfidence || "Low";
  const compact = options.compact;
  const pClass = momentumClass(bill);
  const status = billStatusInfo(bill);
  const tags = bill.tags || [];
  const tagRow = tags.length
    ? `<div class="meta-line bill-tag-row">${tags.map((t) => `<span class="mini-pill bill-tag-pill">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";
  const inPort = (bill.portfolioTickers || []).filter((t) => portfolioTickerSet().has(t));
  const inPortRow = inPort.length
    ? `<div class="meta-line"><span class="mini-pill green">In your book</span>${inPort.map((t) => `<span class="mini-pill" style="border-color:${holdingColor(t)}">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";
  const sig = bill.signals || {};
  const hasSig =
    sig.bipartisanScore != null ||
    sig.committeeScore != null ||
    sig.floorScore != null ||
    sig.historicalScore != null;
  const signalsRow = hasSig
    ? `<div class="meta-line bill-curated-signals">
        ${sig.bipartisanScore != null ? `<span class="mini-pill">Bipartisan ${escapeHtml(String(sig.bipartisanScore))}</span>` : ""}
        ${sig.committeeScore != null ? `<span class="mini-pill">Committee ${escapeHtml(String(sig.committeeScore))}</span>` : ""}
        ${sig.floorScore != null ? `<span class="mini-pill">Floor ${escapeHtml(String(sig.floorScore))}</span>` : ""}
        ${sig.historicalScore != null ? `<span class="mini-pill">Historical ${escapeHtml(String(sig.historicalScore))}</span>` : ""}
      </div>`
    : "";
  const analogText = formatBillAnalogText(bill);

  const stageTrack = stageTrackHtml(bill);

  // Pass / fail impact chips
  const passImpacts = bill.passImpacts || bill.tickerImpacts?.filter(t => t.direction === "upside" || t.direction === "downside").map(t => ({
    sym: t.symbol, dir: t.direction === "upside" ? 1 : -1, range: t.impact, why: t.mechanism
  })) || [];
  const failImpacts = bill.failImpacts || [];
  const chipHtml = (arr) => arr.map(i => {
    const cls = i.dir > 0 ? "pass-up" : i.dir < 0 ? "pass-dn" : "pass-neu";
    const arrow = i.dir > 0 ? "↑" : i.dir < 0 ? "↓" : "→";
    return `<span class="impact-chip ${cls}" title="${escapeHtml(i.why || "")}">${escapeHtml(i.sym)} ${arrow} ${escapeHtml(i.range || "")}</span>`;
  }).join("") || `<span class="muted" style="font-size:11px">No major impact modeled</span>`;

  // Lobby signal rows (compact view: just pills; expanded: full signal breakdown)
  const bipartisan = Number(bill.bipartisanCosponsors || 0) >= 5;
  const lobbySignal = compact ? `
    <div class="meta-line">
      <span class="mini-pill">Lobbying pressure ${lobbyScore}/100</span>
      <span class="mini-pill">${escapeHtml(lobbyConf)} conf.</span>
      ${bipartisan ? `<span class="mini-pill green">${bill.bipartisanCosponsors} bipartisan</span>` : ""}
      <span class="mini-pill">${escapeHtml(bill.latestActionDate || "")}</span>
    </div>
    ${signalsRow}` : `
    ${signalsRow}
    <div class="bill-signal-grid">
      <div class="bill-signal-col">
        <div class="signal-label-sm">Legislative & lobbying signals</div>
        <div class="signal-row-item">
          <span class="signal-ico">⚖️</span>
          <span class="signal-lbl">Lobbying pressure</span>
          <span class="signal-val ${lobbyScore >= 67 ? "dn" : lobbyScore >= 40 ? "amber-text" : ""}">${lobbyScore}/100 (${escapeHtml(lobbyConf)})</span>
        </div>
        <div class="signal-row-item">
          <span class="signal-ico">👥</span>
          <span class="signal-lbl">Cosponsors</span>
          <span class="signal-val ${bipartisan ? "up" : ""}">${bill.cosponsors || 0} (${bill.bipartisanCosponsors || 0} bipartisan${bipartisan ? " ✓" : ""})</span>
        </div>
        <div class="signal-row-item">
          <span class="signal-ico">📅</span>
          <span class="signal-lbl">Floor scheduled</span>
          <span class="signal-val ${bill.floorScheduled ? "up" : "muted"}">${bill.floorScheduled ? "Yes ✓" : "Not yet"}</span>
        </div>
      </div>
      <div class="bill-signal-col">
        <div class="signal-label-sm">Why this number</div>
        ${momentumDriversHtml(bill, { compact })}
        <p class="muted" style="font-size:12px;line-height:1.65">${escapeHtml(bill.lobbyingNote || bill.signal || "")}</p>
        ${analogText ? `<div class="analog-box"><div class="analog-lbl">Historical analog</div><p>${escapeHtml(analogText)}</p></div>` : ""}
      </div>
    </div>`;

  const sponsor = bill.sponsor;
  const sponsorLine = sponsor
    ? `Sponsor: ${escapeHtml(sponsor.name)} (${escapeHtml(sponsor.party)}-${escapeHtml(sponsor.state)}) · ${escapeHtml(bill.latestActionDate || "")}`
    : escapeHtml(bill.latestActionDate || "");

  return `
    <article class="legis-card ${pClass}">
      ${tagRow}
      ${inPortRow}
      <div class="legis-card-head">
        <div>
          <span class="mini-pill">${escapeHtml(bill.id)} · ${escapeHtml(status.label)} · ${(bill.affected || []).slice(0, 2).join(" · ")}</span>
          <h3>${escapeHtml(bill.title)}</h3>
        </div>
        <div class="impact-score">
          <strong>${momentum}/100</strong>
          <span>Legislative momentum</span>
          <span class="conf-badge">Policy exposure: ${exposure}/100 · Confidence: ${escapeHtml(conf)}</span>
        </div>
      </div>
      <p class="bill-plain-english">${escapeHtml(bill.plainEnglish || bill.shortTitle || bill.signal || "")}</p>
      <div class="passage-meter" aria-label="Legislative momentum ${momentum} out of 100">
        <span style="width:${Math.max(0, Math.min(100, momentum))}%"></span>
      </div>
      ${stageTrack}
      ${lobbySignal}
      ${compact ? "" : `
        <div class="impact-scenarios">
          <div class="scenario-col">
            <div class="scenario-label up">If passes →</div>
            <div class="impact-chip-row">${chipHtml(passImpacts)}</div>
          </div>
          <div class="scenario-col">
            <div class="scenario-label dn">If fails →</div>
            <div class="impact-chip-row">${chipHtml(failImpacts)}</div>
          </div>
        </div>
        <div class="impact-disclaimer muted">Note: Impact ranges are estimates based on historical analogs. Click a ticker chip to research. Not financial advice.</div>
      `}
      <div class="legis-card-footer">
        <span class="muted" style="font-size:11px;font-family:var(--mono)">${sponsorLine}</span>
        <div class="legis-card-footer-actions">
          <button type="button" class="button button-ghost compact" onclick="window.openMethodologyModal({ billId: ${JSON.stringify(bill.id)} })">Explain metrics</button>
          <button type="button" class="button button-secondary compact" onclick="window.askWhyForBill(${JSON.stringify(bill.id)})">Ask why (metrics)</button>
          <button type="button" class="button button-ghost compact" onclick="window.showView('research')">Ask AI</button>
        </div>
      </div>
    </article>
  `;
}

function renderBillStakeholders() {
  const el = $("#bill-stakeholders");
  if (!el) return;
  const network = state.policyNetwork;
  if (!network?.stakeholderMap) {
    el.innerHTML = `<article class="empty-state">Pick a ticker in Analysis Lab to load its stakeholder graph.</article>`;
    return;
  }
  const nodes = network.stakeholderMap.nodes || [];
  const links = network.stakeholderMap.links || [];
  $("#bill-network-source").textContent = sourceLabel(network.source?.relationships || "modeled");
  el.innerHTML = `
    <div class="stakeholder-side-head">
      <span class="mini-pill green">${escapeHtml(network.focusSymbol)}</span>
      <h3>${escapeHtml(network.summary?.headline || "Policy graph loaded")}</h3>
      <p>${escapeHtml(network.summary?.detail || "")}</p>
    </div>
    <div class="stakeholder-mini-list">
      ${nodes.filter((node) => node.type !== "ticker").slice(0, 9).map((node) => `
        <div class="stakeholder-mini ${toneClass(node.tone)}">
          <span>${escapeHtml(node.label)}</span>
          <small>${escapeHtml(node.detail || node.title || "")}</small>
        </div>
      `).join("")}
    </div>
    <div class="relationship-flow compact-flow">
      ${links.slice(0, 6).map((link) => {
        const from = nodes.find((node) => node.id === link.from);
        const to = nodes.find((node) => node.id === link.to);
        return `
          <article class="relationship-link ${toneClass(link.tone)}">
            <strong>${escapeHtml(from?.label || "Signal")} -> ${escapeHtml(to?.label || "Bill")}</strong>
            <p>${escapeHtml(link.label || "")}</p>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderLobbyBridge() {
  const el = $("#lobby-bill-bridge");
  if (!el) return;
  const bills = policyBills()
    .slice()
    .sort((a, b) => (Number(b.lobbyingAgainst || 0) + Number(b.lobbyingFor || 0)) - (Number(a.lobbyingAgainst || 0) + Number(a.lobbyingFor || 0)))
    .slice(0, 4);
  el.innerHTML = bills.map((bill) => `
    <article class="bridge-card ${momentumClass(bill)}">
      <span class="mini-pill">${escapeHtml(bill.id)}</span>
      <h3>${escapeHtml(bill.title)}</h3>
      <p>${escapeHtml(bill.signal || bill.relationshipSummary || "")}</p>
      <div class="bridge-chain">
        <span>Lobbying pressure ${bill.lobbyingPressureScore ?? 0}/100</span>
        <span>Legislative momentum ${billMomentum(bill)}/100</span>
        <span>${(bill.affected || []).slice(0, 3).join(", ")}</span>
      </div>
    </article>
  `).join("");
}

function barGroup(title, items, note) {
  return `
    <section class="bar-group">
      <div class="bar-group-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(note)}</span>
      </div>
      ${(items || []).map((item) => `
        <div class="bar-row interactive-bar-row">
          <div class="bar-row-label">
            <span>${escapeHtml(item.label)}</span>
            <small>${escapeHtml(item.display || `${item.value}/100`)}</small>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.max(0, Math.min(100, Number(item.value || 0)))}%"></div>
          </div>
          <p>${escapeHtml(item.explain || "")}</p>
          <div class="bar-tooltip">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.display || `${item.value}/100`)}</span>
            <small>${escapeHtml(item.explain || note || "")}</small>
          </div>
        </div>
      `).join("")}
    </section>
  `;
}

function toneClass(tone) {
  if (tone === "green") return "green";
  if (tone === "red") return "red";
  if (tone === "amber") return "amber";
  return "";
}

function momentumClass(bill) {
  const m = billMomentum(bill);
  if (m >= 67) return "green";
  if (m < 35) return "red";
  return "amber";
}

function groupLabel(type) {
  return {
    person: "Congress people",
    committee: "Committees",
    lobby: "Lobbyists and clients",
    bill: "Bills",
    ticker: "Stocks"
  }[type] || type;
}

function rawPolicyBills() {
  const merged = new Map();
  (state.bills || []).forEach((bill) => merged.set(bill.id, bill));
  (state.policyNetwork?.allBills || []).forEach((bill) => {
    merged.set(bill.id, { ...(merged.get(bill.id) || {}), ...bill });
  });
  return [...merged.values()];
}

/* ── Signal Chain ──────────────────────────────────────────────────────────── */

const SIGNAL_PAGE_SIZE = 8;
let _signalFeedExpanded = false;

function signalRecencyFactor(dateStr) {
  if (!dateStr) return 0.4;
  const ageDays = (Date.now() - new Date(dateStr).getTime()) / 86400000;
  if (ageDays <= 7) return 1.0;
  if (ageDays <= 30) return 0.85;
  if (ageDays <= 90) return 0.65;
  return 0.4;
}

function fmtM(val) {
  const n = Number(val || 0);
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function buildSignalFeed() {
  const signals = [];

  // Bill signals
  for (const bill of policyBills()) {
    const score = billMomentum(bill);
    const date = bill.latestActionDate || bill.introduced || "";
    const tickers = (bill.affected || bill.portfolioTickers || []).slice(0, 4);
    const passImpacts = bill.passImpacts || [];
    const failImpacts = bill.failImpacts || [];
    const allImpacts = [...passImpacts, ...failImpacts].slice(0, 4);

    const lobbyPressure = Number(bill.lobbyingAgainst || 0) + Number(bill.lobbyingFor || 0);
    const isHeavilyLobbied = lobbyPressure >= 60;
    const type = isHeavilyLobbied ? "lobbying" : "bill";

    const source = bill.id || "Bill";
    const mechanism = bill.signal || bill.impact || "Legislative pressure building";
    const impact = allImpacts.length
      ? allImpacts.map((i) => (i.dir > 0 ? `${i.sym} ↑` : i.dir < 0 ? `${i.sym} ↓` : `${i.sym} →`)).join(", ")
      : tickers.length ? `${tickers[0]} exposed` : "Market exposure";

    signals.push({
      type,
      score,
      date,
      tickers,
      title: bill.title || bill.id,
      chain: [source, mechanism.slice(0, 80), impact.slice(0, 60)],
      impacts: allImpacts,
      footer: bill.latestAction || bill.status || "",
      footerDate: bill.latestActionDate || "",
      sortKey: score * signalRecencyFactor(date),
      _billId: bill.id,
    });
  }

  // Contract signals
  for (const row of (state.contracts || [])) {
    const val = Number(row.totalObligated || 0);
    if (!val) continue;
    const score = Math.min(99, Math.round((val / 1e9) * 20 + (row.riskScore || 0)));
    const date = row.updatedAt || state.contractsLoadedAt || "";
    const tickers = row.symbol ? [row.symbol] : [];
    const mechanism = `${row.topAgency || "Federal agency"} award → revenue uplift`;
    const impactRange = val >= 1e9 ? "+5–12%" : val >= 1e8 ? "+2–6%" : "+1–3%";

    signals.push({
      type: "contract",
      score,
      date,
      tickers,
      title: `${row.company || row.symbol} — ${fmtM(val)} awarded`,
      chain: [
        `${row.topAgency || "Gov't agency"} contract`,
        mechanism.slice(0, 80),
        `${row.symbol || row.company} ${impactRange}`,
      ],
      impacts: tickers.map((sym) => ({ sym, dir: 1, range: impactRange })),
      footer: `${row.riskLabel || ""} · via USASpending.gov`,
      footerDate: "",
      sortKey: score * signalRecencyFactor(date),
      _contractSymbol: row.symbol,
    });
  }

  return signals.sort((a, b) => b.sortKey - a.sortKey);
}

function renderSignalCard(sig) {
  const typeLabel = sig.type === "lobbying" ? "Lobby" : sig.type === "contract" ? "Contract" : "Bill";
  const typeClass = `sc-card--${sig.type}`;

  const tickerHtml = sig.tickers.map((t) => `<span class="sc-ticker-pill">${escapeHtml(t)}</span>`).join("");

  const chainHtml = sig.chain
    .filter(Boolean)
    .map((node, i, arr) =>
      i < arr.length - 1
        ? `<span class="sc-chain-node">${escapeHtml(node)}</span><span class="sc-chain-arrow">→</span>`
        : `<span class="sc-chain-node">${escapeHtml(node)}</span>`
    )
    .join("");

  const impactHtml = sig.impacts.slice(0, 4).map((imp) => {
    const cls = imp.dir > 0 ? "sc-chip-up" : imp.dir < 0 ? "sc-chip-dn" : "sc-chip-neu";
    const arrow = imp.dir > 0 ? "↑" : imp.dir < 0 ? "↓" : "→";
    return `<span class="sc-chip ${cls}">${escapeHtml(imp.sym)} ${arrow}${imp.range ? " " + escapeHtml(imp.range) : ""}</span>`;
  }).join("");

  const drillAttr = sig._billId
    ? drilldownAttrs("bills", { billId: sig._billId }, `Open ${sig._billId} in Bills`)
    : sig._contractSymbol
    ? drilldownAttrs("view", { viewName: "contracts" }, `Open contracts view`)
    : "";

  return `
    <article class="sc-card ${typeClass}" ${drillAttr} tabindex="0" role="button" aria-label="${escapeHtml(sig.title)}">
      <div class="sc-card-header">
        <span class="sc-type-badge">${typeLabel}</span>
        <div class="sc-tickers">${tickerHtml}</div>
        <span class="sc-score">${sig.score}/100</span>
      </div>
      <p class="sc-title">${escapeHtml(sig.title)}</p>
      <div class="sc-chain">${chainHtml}</div>
      ${impactHtml ? `<div class="sc-impacts">${impactHtml}</div>` : ""}
      <div class="sc-footer">
        <span>${escapeHtml(sig.footer.slice(0, 80))}</span>
        ${sig.footerDate ? `<span>${escapeHtml(sig.footerDate)}</span>` : ""}
      </div>
    </article>
  `;
}

function renderSignalFeed() {
  const feed = $("#signal-chain-feed");
  const footer = $("#signal-chain-footer");
  if (!feed) return;

  const signals = buildSignalFeed();

  if (!signals.length) {
    feed.innerHTML = `<div class="sc-empty muted">No signals available yet — waiting for bills and contract data.</div>`;
    if (footer) footer.hidden = true;
    return;
  }

  const visible = _signalFeedExpanded ? signals : signals.slice(0, SIGNAL_PAGE_SIZE);
  feed.innerHTML = visible.map(renderSignalCard).join("");

  if (footer) {
    const hasMore = signals.length > SIGNAL_PAGE_SIZE;
    footer.hidden = !hasMore || _signalFeedExpanded;
  }
}

function policyBills(options = {}) {
  const bills = rawPolicyBills();
  if (options.includeUnmapped) return bills;
  return bills.filter(isMarketRelevantBill);
}

function isMarketRelevantBill(bill) {
  const affected = bill.affected || [];
  const hasMappedTicker = affected.some(
    (ticker) => marketSymbols().includes(ticker) || ["BTC", "ETH"].includes(ticker)
  );
  const isCurrentSeed = String(bill.id || "").endsWith(`-${CURRENT_CONGRESS}`);
  const hasScenario = Boolean(bill.plainEnglish || bill.signal || bill.impact);
  if (hasMappedTicker) return true;
  if (isCurrentSeed && hasScenario && (bill.tags?.length || bill.portfolioTickers?.length)) return true;
  return false;
}

function relatedBillForFiling(filing) {
  const client = normalizeText(filing.client);
  const issue = normalizeText(filing.issue);
  for (const bill of policyBills()) {
    for (const lobby of bill.stakeholders?.lobbying || []) {
      const lobbyName = normalizeText(lobby.name);
      const lobbyIssue = normalizeText(lobby.issue);
      if (
        (client && (lobbyName.includes(client) || client.includes(lobbyName.split(" ")[0]))) ||
        (issue && lobbyIssue && (issue.includes(lobbyIssue) || lobbyIssue.includes(issue.split(" ")[0])))
      ) {
        return { bill, relationship: lobby.relationship };
      }
    }
  }

  const keywordMap = [
    ["drug medicare pharma health pricing", "drug"],
    ["chips semiconductor export ai", "chips"],
    ["antitrust platform ecommerce marketplace app store", "platform"],
    ["crypto digital asset sec cftc", "digital asset"],
    ["permit energy ev clean solar", "permitting"]
  ];
  const haystack = `${client} ${issue}`;
  for (const [keywords, titleNeedle] of keywordMap) {
    if (keywords.split(" ").some((word) => haystack.includes(word))) {
      const bill = policyBills().find((item) => normalizeText(item.title).includes(titleNeedle));
      if (bill) return { bill, relationship: bill.relationshipSummary || bill.impact };
    }
  }
  return null;
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function signalCard(bill) {
  const m = billMomentum(bill);
  const conf = billConfidenceLabel(bill);
  return `
    <article class="signal-card actionable-card" ${drilldownAttrs("bills", { billId: bill.id }, `Open ${bill.id} in Bills`)}>
      <h3>${escapeHtml(bill.title)}</h3>
      <p>${escapeHtml(bill.impact || bill.signal || "")}</p>
      <div class="meta-line">
        <span class="mini-pill ${m >= 67 ? "green" : m < 35 ? "red" : "amber"}">Legislative momentum ${m}/100</span>
        <span class="mini-pill">Confidence ${escapeHtml(conf)}</span>
        ${(bill.affected || []).slice(0, 4).map((ticker) => `<span class="mini-pill">${ticker}</span>`).join("")}
      </div>
    </article>
  `;
}

function setupNavigation() {
  document.querySelectorAll("[data-view], [data-view-jump]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view || button.dataset.viewJump));
  });
}

function globalResearchDrawerEl() {
  return document.querySelector("aside.research-drawer-global");
}

function openGlobalResearchDrawer() {
  globalResearchDrawerEl()?.classList.add("open");
}

function ensureThesisLabReady() {
  if (!setupThesisLab._ran) {
    setupThesisLab();
    setupThesisLab._ran = true;
  }
  thesisBindMapCanvas();
  const mapPane = document.getElementById("thesis-pane-map");
  if (mapPane && mapPane.classList.contains("active")) setTimeout(thesisDrawMap, 60);
}

function showView(view, updateUrl = true) {
  /* Research UI lives in the global drawer; there is no #view-research — pair drawer with Bills so nav/state stay coherent. */
  if (view === "research") {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === "bills"));
    document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === "view-bills"));
    if (updateUrl) {
      const params = new URLSearchParams(window.location.search);
      params.set("view", "bills");
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    }
    openGlobalResearchDrawer();
    return;
  }
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
  if (updateUrl && view) {
    const params = new URLSearchParams(window.location.search);
    params.set("view", view);
    if (view === "analysis") params.set("symbol", state.activeAnalysisSymbol);
    if (view === "trade") params.set("symbol", state.tradeSymbol);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }
  if (view === "analysis" && !state.analysis) loadAnalysis(state.activeAnalysisSymbol);
  if (view === "trade" && !state.tradeHistory) loadTradeHistory(state.tradeSymbol, state.tradeRange);
  if (view === "markets") void loadMarketsData();
  if (view === "contracts" && !state.contractsLoadedAt) void refreshContractsFeed();
  if (view === "thesis") {
    ensureThesisLabReady();
    void thesisLoadTracked();
    if (thesisState.built && document.getElementById("tscreen-result")?.classList.contains("active")) {
      void thesisFetchSignals({ silent: true });
      thesisStartMonitorRefresh();
    }
  } else {
    thesisStopMonitorRefresh();
  }
  if (view === "overview" && state.activeFundId) {
    scheduleFundPulseRefresh(state.activeFundId);
  } else {
    stopFundPulseRefresh();
  }
}

function setupAnalysisControls() {
  const select = $("#analysis-symbol");
  if (!select) return;
  select.value = state.activeAnalysisSymbol;
  select.addEventListener("change", () => {
    state.activeAnalysisSymbol = select.value;
    if ($("#view-analysis")?.classList.contains("active")) {
      const params = new URLSearchParams(window.location.search);
      params.set("view", "analysis");
      params.set("symbol", select.value);
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    }
    loadAnalysis(select.value);
  });
}

function setupTradeControls() {
  const symbolSelect = $("#order-symbol");
  const qtyInput = $("#order-qty");
  const sideSelect = $("#order-side");
  if (!symbolSelect) return;
  symbolSelect.value = state.tradeSymbol;
  symbolSelect.addEventListener("change", () => {
    state.tradeSymbol = symbolSelect.value;
    loadTradeHistory(state.tradeSymbol, state.tradeRange);
    updateOrderEstimate();
    if ($("#view-trade")?.classList.contains("active")) {
      const params = new URLSearchParams(window.location.search);
      params.set("view", "trade");
      params.set("symbol", state.tradeSymbol);
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    }
  });
  qtyInput?.addEventListener("input", updateOrderEstimate);
  sideSelect?.addEventListener("change", updateOrderEstimate);
  document.querySelectorAll("[data-trade-range]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-trade-range]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.tradeRange = button.dataset.tradeRange || "6m";
      loadTradeHistory(state.tradeSymbol, state.tradeRange);
    });
  });
}

function setupFilters() {
  $("#bill-filter").addEventListener("input", renderBills);
  $("#clear-bill-filter").addEventListener("click", () => {
    $("#bill-filter").value = "";
    renderBills();
  });
  $("#terminal-search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toUpperCase();
    if (!query) return;
    if (isTrackedTicker(query)) showView("markets");
    if (state.bills.some((bill) => [bill.id, bill.title, ...(bill.affected || [])].join(" ").toUpperCase().includes(query))) {
      showView("bills");
      $("#bill-filter").value = query;
      renderBills();
    }
  });
}

// ── BYOK helpers ─────────────────────────────────────────────────────────────

const BYOK_STORAGE_KEY = "ts_byok_v1";

const BYOK_PROVIDERS = {
  anthropic: {
    label: "Anthropic (Claude)",
    placeholder: "sk-ant-...",
    defaultModel: "claude-sonnet-4-5",
    models: [
      { value: "claude-opus-4-5", label: "Claude Opus 4.5 (most capable)" },
      { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (fast, recommended)" },
      { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (cheapest)" }
    ]
  },
  openai: {
    label: "OpenAI (ChatGPT)",
    placeholder: "sk-...",
    defaultModel: "gpt-4o-mini",
    models: [
      { value: "gpt-4o", label: "GPT-4o (most capable)" },
      { value: "gpt-4o-mini", label: "GPT-4o mini (fast, recommended)" },
      { value: "gpt-4-turbo", label: "GPT-4 Turbo" }
    ]
  },
  gemini: {
    label: "Google Gemini",
    placeholder: "AIza...",
    defaultModel: "gemini-2.0-flash",
    models: [
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash (recommended)" },
      { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite (cheapest)" },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" }
    ]
  }
};

function loadByokFromStorage() {
  try {
    const raw = localStorage.getItem(BYOK_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved?.provider && saved?.key && BYOK_PROVIDERS[saved.provider]) {
      state.byok.provider = saved.provider;
      state.byok.key = saved.key;
      state.byok.model = saved.model || BYOK_PROVIDERS[saved.provider].defaultModel;
    }
  } catch {
    /* localStorage unavailable or malformed */
  }
}

function saveByokToStorage(provider, key, model) {
  try {
    if (!provider || !key) {
      localStorage.removeItem(BYOK_STORAGE_KEY);
      state.byok = { provider: null, key: null, model: null };
    } else {
      localStorage.setItem(BYOK_STORAGE_KEY, JSON.stringify({ provider, key, model }));
      state.byok = { provider, key, model };
    }
  } catch {
    /* ignore */
  }
}

function clearByok() {
  saveByokToStorage(null, null, null);
}

function byokIsConfigured() {
  return Boolean(state.byok.provider && state.byok.key);
}

async function callByokProvider(question, billContext) {
  const { provider, key, model } = state.byok;
  if (!provider || !key) throw new Error("No BYOK key configured.");

  const systemPrompt = `You are TradeSimple's research assistant. Explain how congressional bills, lobbying activity, federal contracts, and government policy might affect specific stocks in plain English for retail investors.
RULES: Never use markdown headers. Use plain paragraphs. Keep responses under 250 words. Lead with the single most important insight. End with up to 3 bullet "Watch for:" items.
TONE: No dramatic language. Let numbers speak. Use "this suggests" not "this means". Disclose: Research signal only. Not financial advice.`;

  const billDigest = (window._policyBillsForByok || [])
    .map((b) => `${b.id}: ${b.title}; affected: ${(b.affected || []).join(", ")}; signal: ${b.signal}`)
    .join("\n");

  let userContent;
  if (billContext) {
    const bill = (window._policyBillsForByok || []).find((b) => b.id === billContext);
    if (bill) {
      userContent = `Bill focus (scenario model, not a forecast):\n${bill.id}: ${bill.title}; affected: ${(bill.affected || []).join(", ")}; signal: ${bill.signal}\n\n${question || "Explain why this bill matters for investors and which tickers are most exposed."}`;
    } else {
      userContent = question || `Explain bill ${billContext} for investors.`;
    }
  } else if (billDigest) {
    userContent = `Bill context (scenario model, not a forecast):\n${billDigest}\n\nUser question:\n${question}`;
  } else {
    userContent = question;
  }

  let text = "";

  if (provider === "anthropic") {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Anthropic API error ${resp.status}`);
    }
    const data = await resp.json();
    text = data.content?.[0]?.text || "";
  } else if (provider === "openai") {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenAI API error ${resp.status}`);
    }
    const data = await resp.json();
    text = data.choices?.[0]?.message?.content || "";
  } else if (provider === "gemini") {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: systemPrompt + "\n\n" + userContent }]
        }]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Gemini API error ${resp.status}`);
    }
    const data = await resp.json();
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  return parseByokResponse(text);
}

function parseByokResponse(text) {
  if (!text) return { prose: "No response returned.", watchFor: [] };
  const watchMatch = text.match(/Watch\s+for[:\s]+([\s\S]+)$/i);
  let prose = text;
  const watchFor = [];
  if (watchMatch) {
    prose = text.slice(0, watchMatch.index).trim();
    const items = watchMatch[1]
      .split(/\n|•|-|\*/)
      .map((s) => s.trim())
      .filter(Boolean);
    watchFor.push(...items.slice(0, 3));
  }
  return { prose, watchFor };
}

window._policyBillsForByok = [];

function setupForms() {
  $("#order-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    $("#order-result").textContent = "Submitting paper order...";
    try {
      const response = await fetchJson("/api/trading/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: form.get("symbol"),
          qty: form.get("qty"),
          side: form.get("side"),
          ...(state.pendingThesisId ? { thesisId: state.pendingThesisId } : {})
        })
      });
      state.account = response;
      renderAccount();
      if (state.pendingThesisId) {
        void thesisRefreshSavedOutcome();
        state.pendingThesisId = null;
      }
      $("#order-result").textContent = `${response.order.side.toUpperCase()} ${response.order.qty} ${response.order.symbol} filled at ${money(response.order.price)}. New buying power: ${money(response.account.buyingPower)}.`;
    } catch (error) {
      let msg = "Paper order rejected. Check the symbol and quantity.";
      try {
        const m = /^400:\s*(.+)$/s.exec(error.message || "");
        if (m) {
          const body = JSON.parse(m[1]);
          if (body.error === "no_position" || body.error === "insufficient_shares") {
            msg = body.message || msg;
          }
        }
      } catch (_) {
        /* keep default */
      }
      if (msg === "Paper order rejected. Check the symbol and quantity." && error.message.includes("insufficient")) {
        msg = "Paper order rejected: not enough cash or shares for that order.";
      }
      $("#order-result").textContent = msg;
    }
  });

  $("#research-log").innerHTML = `
    <div class="message">
      Ask about a bill, ticker, lobbying spike, or portfolio exposure. Use <strong>Ask why (metrics)</strong> on a bill card for the research model, or <strong>Explain metrics</strong> (top bar) for the full transparent rubric and line-item bill breakdowns.
      Without ANTHROPIC_API_KEY the server returns a short local summary for bill-why requests.
    </div>
  `;
  $("#research-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = $("#research-question")?.value.trim();
    if (!question) return;
    appendMessage(question, "user");
    if ($("#research-question")) $("#research-question").value = "";

    if (byokIsConfigured()) {
      appendMessage("Analyzing with your AI key…", "ai", true);
      try {
        const response = await callByokProvider(question, null);
        document.querySelector("[data-pending-message]")?.remove();
        appendResearchAiMessage(response.prose || "", response.watchFor || []);
      } catch (error) {
        document.querySelector("[data-pending-message]")?.remove();
        const msg = error.message || "Request failed.";
        appendMessage(`AI error: ${msg}. Check your key in AI Settings.`, "ai");
        renderByokStatus();
      }
      return;
    }

    if (state.config?.data?.anthropic) {
      appendMessage("Analyzing policy signal...", "ai", true);
      try {
        const response = await fetchJson("/api/research/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question })
        });
        document.querySelector("[data-pending-message]")?.remove();
        if (response.error) appendMessage(response.error, "ai");
        else appendResearchAiMessage(response.prose || "", response.watchFor || []);
      } catch (error) {
        document.querySelector("[data-pending-message]")?.remove();
        appendMessage(error.message || "Request failed.", "ai");
      }
      return;
    }

    appendMessage(
      "No AI key configured. Add your own API key using the AI Settings button above, or ask the app owner to set ANTHROPIC_API_KEY on the server.",
      "ai"
    );
    renderByokPanel();
  });

  loadByokFromStorage();
  renderByokStatus();
}

// ── BYOK settings panel ───────────────────────────────────────────────────────

function renderByokPanel() {
  const log = $("#research-log");
  if (!log) return;

  log.querySelector(".byok-panel")?.remove();

  const panel = document.createElement("div");
  panel.className = "byok-panel";

  const providerOptions = Object.entries(BYOK_PROVIDERS)
    .map(([v, p]) => `<option value="${v}" ${state.byok.provider === v ? "selected" : ""}>${escapeHtml(p.label)}</option>`)
    .join("");

  const currentProvider = state.byok.provider || "anthropic";
  const providerConfig = BYOK_PROVIDERS[currentProvider];
  const modelOptions = (providerConfig?.models || [])
    .map((m) => `<option value="${m.value}" ${state.byok.model === m.value ? "selected" : ""}>${escapeHtml(m.label)}</option>`)
    .join("");

  panel.innerHTML = `
    <div class="byok-panel-head">
      <span class="byok-panel-title">AI Settings — use your own key</span>
      <button type="button" class="byok-panel-close" aria-label="Close AI settings">✕</button>
    </div>
    <div class="byok-panel-body">
      <p class="byok-panel-desc">
        Your key is saved in your browser only — never sent to TradeSimple's server.
        Get a key from your provider's website. Usage is billed to your own account.
      </p>
      <label class="byok-label">Provider
        <select class="byok-select" id="byok-provider-select">${providerOptions}</select>
      </label>
      <label class="byok-label">Model
        <select class="byok-select" id="byok-model-select">${modelOptions}</select>
      </label>
      <label class="byok-label">API key
        <input
          class="byok-input"
          id="byok-key-input"
          type="password"
          placeholder="${escapeHtml(providerConfig?.placeholder || "paste your key here")}"
          value="${state.byok.key ? "•".repeat(12) : ""}"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <div class="byok-actions">
        <button type="button" class="button button-primary compact" id="byok-save-btn">Save key</button>
        ${state.byok.key ? '<button type="button" class="button button-ghost compact" id="byok-clear-btn">Remove key</button>' : ""}
      </div>
      ${state.byok.key ? `<div class="byok-status-saved">Key saved · ${escapeHtml(BYOK_PROVIDERS[state.byok.provider]?.label || state.byok.provider)} · ${escapeHtml(state.byok.model || "")}</div>` : ""}
      <p class="byok-panel-links">
        Get a key:
        <a href="https://console.anthropic.com/keys" target="_blank" rel="noopener">Anthropic</a> ·
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">OpenAI</a> ·
        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Google Gemini</a>
      </p>
    </div>`;

  log.appendChild(panel);
  log.scrollTop = log.scrollHeight;

  panel.querySelector("#byok-provider-select")?.addEventListener("change", (e) => {
    const p = BYOK_PROVIDERS[e.target.value];
    if (!p) return;
    const modelSel = panel.querySelector("#byok-model-select");
    if (modelSel) {
      modelSel.innerHTML = p.models
        .map((m) => `<option value="${m.value}">${escapeHtml(m.label)}</option>`)
        .join("");
    }
    const keyInput = panel.querySelector("#byok-key-input");
    if (keyInput) keyInput.placeholder = p.placeholder;
  });

  panel.querySelector("#byok-save-btn")?.addEventListener("click", () => {
    const provider = panel.querySelector("#byok-provider-select")?.value;
    const model = panel.querySelector("#byok-model-select")?.value;
    const rawKey = panel.querySelector("#byok-key-input")?.value.trim();
    const key = rawKey.replace(/•/g, "").trim() || state.byok.key;
    if (!key) {
      panel.querySelector("#byok-key-input")?.focus();
      return;
    }
    saveByokToStorage(provider, key, model);
    panel.remove();
    appendMessage(
      `Key saved. Using ${BYOK_PROVIDERS[provider]?.label || provider} · ${model}. Your key stays in your browser — ask away.`,
      "ai"
    );
    renderByokStatus();
  });

  panel.querySelector("#byok-clear-btn")?.addEventListener("click", () => {
    clearByok();
    panel.remove();
    appendMessage("Key removed. Switching back to server AI (if available).", "ai");
    renderByokStatus();
  });

  panel.querySelector(".byok-panel-close")?.addEventListener("click", () => {
    panel.remove();
  });
}

function renderByokStatus() {
  const btn = document.querySelector(".byok-settings-btn");
  if (!btn) return;
  if (byokIsConfigured()) {
    btn.textContent = `AI: ${BYOK_PROVIDERS[state.byok.provider]?.label?.split(" ")[0] || "Custom"} key ✓`;
    btn.classList.add("byok-active");
  } else {
    btn.textContent = "AI Settings";
    btn.classList.remove("byok-active");
  }
}

function toggleByokPanel() {
  const existing = document.querySelector(".byok-panel");
  if (existing) {
    existing.remove();
    return;
  }
  renderByokPanel();
}

function appendMessage(text, kind, pending = false) {
  const div = document.createElement("div");
  div.className = `message ${kind === "user" ? "user" : ""}`;
  if (pending) div.dataset.pendingMessage = "true";
  if (kind === "ai" && typeof text === "string" && text.includes("**")) {
    div.innerHTML = escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  } else {
    div.textContent = text;
  }
  $("#research-log").appendChild(div);
  $("#research-log").scrollTop = $("#research-log").scrollHeight;
}

function appendResearchAiMessage(prose, watchFor) {
  const div = document.createElement("div");
  div.className = "message";
  const p = document.createElement("p");
  if (typeof prose === "string" && prose.includes("**")) {
    p.innerHTML = escapeHtml(prose).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  } else {
    p.textContent = prose || "";
  }
  div.appendChild(p);
  if (Array.isArray(watchFor) && watchFor.length) {
    const ul = document.createElement("ul");
    for (const item of watchFor) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.appendChild(li);
    }
    div.appendChild(ul);
  }
  $("#research-log").appendChild(div);
  $("#research-log").scrollTop = $("#research-log").scrollHeight;
}

async function askWhyForBill(billId) {
  if (!billId) return;
  const id = String(billId);
  showView("bills");
  openGlobalResearchDrawer();
  appendMessage(`Ask why · ${id} (bill metrics)`, "user");
  appendMessage("Running bill metrics through research…", "ai", true);

  if (byokIsConfigured()) {
    try {
      const response = await callByokProvider("", id);
      document.querySelector("[data-pending-message]")?.remove();
      appendResearchAiMessage(response.prose || "", response.watchFor || []);
    } catch (error) {
      document.querySelector("[data-pending-message]")?.remove();
      appendMessage(`AI error: ${error.message || "Request failed."}. Check your key in AI Settings.`, "ai");
      renderByokStatus();
    }
    return;
  }

  if (!state.config?.data?.anthropic) {
    document.querySelector("[data-pending-message]")?.remove();
    appendMessage(
      "No AI key configured. Add your own API key using AI Settings, or ask the app owner to set ANTHROPIC_API_KEY on the server.",
      "ai"
    );
    renderByokPanel();
    return;
  }

  try {
    const response = await fetch("/api/research/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ billId: id, question: "" })
    });
    document.querySelector("[data-pending-message]")?.remove();
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg =
        payload.error === "unknown_bill_id"
          ? `No seeded scoring packet for ${id}. Ask a free-form question, or pick a bill from the curated POLICY set in LegisAlert.`
          : payload.detail || payload.error || `Request failed (${response.status}).`;
      appendMessage(msg, "ai");
      return;
    }
    if (payload.error) appendMessage(payload.error, "ai");
    else appendResearchAiMessage(payload.prose || "", payload.watchFor || []);
  } catch (error) {
    document.querySelector("[data-pending-message]")?.remove();
    appendMessage(error.message || "Request failed.", "ai");
  }
}

function policyFor(symbol) {
  const bill = policyBills().find((item) => (item.affected || []).includes(symbol));
  if (!bill) return "No mapped bill";
  return `${bill.status}: Legislative momentum ${billMomentum(bill)}/100`;
}

/** POLICY column on Markets — uses in-memory bills only (no extra API). */
function marketsPolicySignalHtml(symbol) {
  const bills = policyBills()
    .filter((b) => (b.affected || []).includes(symbol))
    .slice()
    .sort((a, b) => billMomentum(b) - billMomentum(a));
  const top = bills[0];
  if (!top) {
    return `<span class="muted mono" style="color:var(--text-dim)">No signal</span>`;
  }
  const text = top.signal || top.shortTitle || top.title || "Policy watch";
  return escapeHtml(twelveWordSummary(text));
}

function quoteFor(symbol) {
  return state.quotes.find((quote) => quote.symbol === symbol);
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }
  return response.json();
}

function setDisabled(link, title) {
  link.setAttribute("aria-disabled", "true");
  link.href = "#";
  link.title = title;
}

function sourceLabel(source) {
  return String(source || "unknown").replaceAll("_", " ");
}

function money(value) {
  const number = Number(value || 0);
  return number.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: number >= 1000 ? 0 : 2 });
}

function compactMoney(value) {
  const number = Number(value || 0);
  if (number >= 1e12) return `$${fmt(number / 1e12)}T`;
  if (number >= 1e9) return `$${fmt(number / 1e9)}B`;
  if (number >= 1e6) return `$${fmt(number / 1e6)}M`;
  return money(number);
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1e9) return `${fmt(number / 1e9)}B`;
  if (number >= 1e6) return `${fmt(number / 1e6)}M`;
  if (number >= 1e3) return `${fmt(number / 1e3)}K`;
  return fmt(number);
}

function fmt(value) {
  return Number(value || 0).toFixed(2);
}

function signed(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? "+" : ""}${fmt(number)}`;
}

function initials(value) {
  return String(value)
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TS";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let methodologyUiBound = false;

async function ensureMethodology() {
  if (state.methodology) return state.methodology;
  state.methodology = await fetchJson("/api/methodology");
  return state.methodology;
}

function closeMethodologyModal() {
  const modal = $("#methodology-modal");
  if (modal) {
    modal.hidden = true;
    document.body.classList.remove("methodology-modal-open");
  }
}

function renderMethodologyHtml(opts, breakdown) {
  const doc = state.methodology;
  const requestedBillId = opts.billId;
  let html = `<p class="methodology-lede">${escapeHtml(doc.disclaimer)}</p>`;

  if (requestedBillId && !breakdown) {
    html += `<div class="methodology-callout" id="method-bill-breakdown"><p><strong>No line-item breakdown</strong> for <span class="mono-inline">${escapeHtml(requestedBillId)}</span>. Only curated TradeSimple policy seeds expose decomposed sub-scores. Congress-only records still follow the rubric below.</p></div>`;
  } else if (breakdown) {
    const lm = breakdown.legislativeMomentum;
    const lb = breakdown.lobbyingPressureOnBillCard;
    html += `<section class="methodology-section methodology-bill-breakdown" id="method-bill-breakdown">`;
    html += `<h3>Transparent breakdown · ${escapeHtml(breakdown.bill.id)}</h3>`;
    html += `<p class="muted">${escapeHtml(breakdown.bill.title)}</p>`;
    html += `<p>Legislative momentum <strong>${lm.score}/100</strong>. Weighted sum before rounding/clamp: <strong>${lm.weightedRawBeforeClamp}</strong>. ${escapeHtml(lm.note)}</p>`;
    html += `<table class="methodology-table"><thead><tr><th>Input</th><th>Sub-score (0–100)</th><th>Weight</th><th>Weighted contribution</th></tr></thead><tbody>`;
    for (const row of lm.components) {
      html += `<tr><td>${escapeHtml(row.label)}</td><td>${row.value}</td><td>${row.weightPct}%</td><td>${row.contribution}</td></tr>`;
    }
    html += `</tbody></table>`;
    html += `<p><strong>Bill signal confidence:</strong> ${escapeHtml(breakdown.billSignalConfidence.label)}. ${escapeHtml(breakdown.billSignalConfidence.rubric)}</p>`;
    html += `<p><strong>Lobbying pressure on card:</strong> ${lb.score}/100 · synthetic spike ${lb.pseudoSpike}× · modeled notional ${money(Number(lb.pseudoAmountUsd || 0))}. ${escapeHtml(lb.note)}</p>`;
    if (breakdown.curatedSignals && Object.keys(breakdown.curatedSignals).length) {
      html += `<dl class="methodology-dl">`;
      for (const [k, v] of Object.entries(breakdown.curatedSignals)) {
        html += `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`;
      }
      html += `</dl>`;
    }
    html += `</section><div class="methodology-between-sections"></div>`;
  }

  for (const sec of doc.sections) {
    html += `<section class="methodology-section" id="method-${escapeHtml(sec.id)}">`;
    html += `<h3>${escapeHtml(sec.title)}</h3>`;
    html += `<p class="muted">${escapeHtml(sec.summary)}</p>`;
    if (sec.weights?.length) {
      html += `<ul class="methodology-detail-list">`;
      for (const w of sec.weights) {
        const head = w.pct != null ? `${w.name} (${w.pct}%)` : w.name;
        html += `<li><strong>${escapeHtml(head)}</strong> — ${escapeHtml(w.detail)}</li>`;
      }
      html += `</ul>`;
    }
    html += `</section>`;
  }
  return html;
}

async function openMethodologyModal(arg) {
  const opts = typeof arg === "string" ? { focus: arg } : { ...(arg || {}) };
  const modal = $("#methodology-modal");
  const bodyEl = $("#methodology-modal-body");
  if (!modal || !bodyEl) return;
  modal.hidden = false;
  document.body.classList.add("methodology-modal-open");
  bodyEl.innerHTML = `<p class="muted">Loading methodology…</p>`;
  try {
    await ensureMethodology();
    let breakdown = null;
    if (opts.billId) {
      const r = await fetch(`/api/policy/bill-metrics?id=${encodeURIComponent(opts.billId)}`);
      if (r.ok) breakdown = (await r.json()).breakdown;
    }
    bodyEl.innerHTML = renderMethodologyHtml(opts, breakdown);
    const scrollId =
      opts.billId ? "method-bill-breakdown" : `method-${opts.focus || "legislativeMomentum"}`;
    requestAnimationFrame(() => {
      document.getElementById(scrollId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } catch (err) {
    bodyEl.innerHTML = `<p class="muted">Could not load methodology: ${escapeHtml(err.message || String(err))}</p>`;
  }
}

function methodologyModalClick(e) {
  if (e.target.closest("[data-close-methodology]")) {
    e.preventDefault();
    closeMethodologyModal();
    return;
  }
  const foc = e.target.closest("[data-methodology-focus]");
  if (foc?.dataset.methodologyFocus) {
    e.preventDefault();
    openMethodologyModal({ focus: foc.dataset.methodologyFocus });
  }
}

function methodologyModalEscape(e) {
  if (e.key !== "Escape") return;
  const modal = $("#methodology-modal");
  if (modal && !modal.hidden) closeMethodologyModal();
}

function setupMethodologyModal() {
  const modal = $("#methodology-modal");
  if (!modal || methodologyUiBound) return;
  methodologyUiBound = true;
  document.body.addEventListener("click", methodologyModalClick);
  document.addEventListener("keydown", methodologyModalEscape);
  $("#methodology-open-btn")?.addEventListener("click", () => openMethodologyModal({}));
}

function initScrollReveal() {
  if (typeof IntersectionObserver === "undefined") return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.06, rootMargin: "0px 0px -32px 0px" }
  );

  // Hero copy and phone — stagger phone slightly
  document.querySelectorAll(".brand-hero .hero-copy").forEach((el) => {
    el.classList.add("reveal-ready");
    observer.observe(el);
  });

  const phoneStage = document.querySelector(".phone-stage");
  if (phoneStage) {
    phoneStage.classList.add("reveal-ready");
    phoneStage.style.transitionDelay = "0.12s";
    observer.observe(phoneStage);
  }

  // Ticker bar
  const ticker = document.querySelector(".landing-ticker");
  if (ticker) {
    ticker.classList.add("reveal-ready");
    observer.observe(ticker);
  }

  // Features strip — cascade with 100ms stagger
  document.querySelectorAll(".features-strip article").forEach((el, i) => {
    el.classList.add("reveal-ready");
    el.setAttribute("data-delay", String(i + 1));
    observer.observe(el);
  });

  // Site sections (LegisAlert, Sentiment, etc.)
  document.querySelectorAll(".site-section, .comparison-section").forEach((el) => {
    el.classList.add("reveal-ready");
    observer.observe(el);
  });

  // Signal cards inside landing stagger
  document.querySelectorAll(".signal-stack .signal-card").forEach((el, i) => {
    el.classList.add("reveal-ready");
    el.setAttribute("data-delay", String(i + 1));
    observer.observe(el);
  });

  // Sentiment demo rows
  document.querySelectorAll(".sentiment-demo div").forEach((el, i) => {
    el.classList.add("reveal-ready");
    el.setAttribute("data-delay", String(i + 1));
    observer.observe(el);
  });

  // Waitlist
  const waitlist = document.querySelector(".waitlist-inner");
  if (waitlist) {
    waitlist.classList.add("reveal-ready");
    observer.observe(waitlist);
  }
}

function $(selector) {
  return document.querySelector(selector);
}

function setupSignalChainInteraction() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#signal-chain-more");
    if (!btn) return;
    _signalFeedExpanded = true;
    renderSignalFeed();
  });
}

function setupResearchDrawer() {
  const btn = document.querySelector(".research-drawer-btn");
  const drawer = globalResearchDrawerEl();
  const close = drawer?.querySelector(".research-drawer-close");
  if (!btn || !drawer || !close) return;
  btn.addEventListener("click", () => drawer.classList.toggle("open"));
  close.addEventListener("click", () => drawer.classList.remove("open"));
  document.querySelector(".byok-settings-btn")?.addEventListener("click", toggleByokPanel);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer.classList.contains("open")) drawer.classList.remove("open");
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
    renderConnections();
    renderByokStatus();
    if (state.activeAnalysisSymbol) await loadAnalysis(state.activeAnalysisSymbol);
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
  thesis: "",
  cats: new Set(),
  entry: 0,
  target: 0,
  stop: 0,
  built: false,
  savedThesisId: null,
  savedOutcome: null,
  signalsPayload: null,
  signalsLoading: false
};

const THESIS_MONITOR_REFRESH_MS = 45000;
let thesisMonitorRefreshTimer = null;

const THESIS_LIVE_QUOTE_SOURCES = new Set(["finnhub", "yfinance", "yahoo_chart"]);
const THESIS_FALLBACK_QUOTE_SOURCES = new Set(["fallback", "fallback_static"]);

function thesisTrackQuote() {
  const sym = String(thesisState.ticker || "").toUpperCase();
  return sym ? quoteFor(sym) : null;
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
    const live = thesisQuotesLive();
    fbBadge.hidden = live;
    fbBadge.classList.toggle("quote-fallback-prominent", thesisQuoteIsFallback());
    fbBadge.title = live
      ? ""
      : "Live market data required for thesis tracking. Set FINNHUB_API_KEY or wait for Yahoo quotes.";
  }
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
      return `
<div class="thesis-signal-card">
<div class="thesis-signal-source">${escapeHtml(s.source || "Source")} ${socialBadge}</div>
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
        if (thesisState.built && thesisState.ticker) void thesisLoadRelationshipMap();
      }
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
  thesisUpdateQuoteTrustUi();
  thesisRenderResult();
  void thesisRefreshSavedOutcome();
  void thesisFetchSignals().then(() => {
    thesisStartMonitorRefresh();
    thesisBuildTimeline();
  });
  thesisApplyMapContext();
  thesisViewMap({ toast: true, firstVisit: true });
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

const THESIS_MAP_HINT_KEY = "ts_map_hint_seen";

function thesisMapSeenKey(sym) {
  return `ts_map_seen_${sym}`;
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
  const sym = String(thesisState.ticker || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
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
  const sym = String(thesisState.ticker || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
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
  thesisMapNodesActive = data.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    sub: n.sub || "",
    cat: n.cat,
    x: n.x,
    y: n.y,
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

function thesisDrawMap() {
  const canvas = document.getElementById("thesisMapCanvas");
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const W = wrap.clientWidth || 640;
  const H = 420;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
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
  if (stockNode) stockNode.label = thesisState.ticker || "Stock";
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
      ctx.font = "9px IBM Plex Mono, monospace";
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
    ctx.font = `500 ${r > 18 ? 11 : 10}px IBM Plex Mono, monospace`;
    ctx.fillStyle = isDark ? "#e0e0e0" : "#1a1a1a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(n.label, x, y - 4);
    ctx.font = "9px IBM Plex Mono, monospace";
    ctx.fillStyle = textMuted;
    ctx.fillText(n.sub.split("·")[0].trim(), x, y + 7);
  });
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
${evidenceHtml}`;
}

function thesisClearNodeDetail() {
  const det = document.getElementById("thesisNodeDetail");
  if (det) det.innerHTML = '<p class="thesis-node-empty">Click any node to see how it connects to your thesis</p>';
}

function thesisBindMapCanvas() {
  const canvas = document.getElementById("thesisMapCanvas");
  if (!canvas || canvas.dataset.bound === "true") return;
  canvas.dataset.bound = "true";
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width,
      sy = canvas.height / rect.height;
    const node = thesisGetNodeAt((e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy, canvas.width, canvas.height);
    canvas.style.cursor = node ? "pointer" : "default";
    if (node !== thesisHoveredNode) {
      thesisHoveredNode = node;
      thesisDrawMap();
    }
  });
  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width,
      sy = canvas.height / rect.height;
    const node = thesisGetNodeAt((e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy, canvas.width, canvas.height);
    if (node) thesisShowNodeDetail(node);
    else thesisClearNodeDetail();
  });
  canvas.addEventListener("mouseleave", () => {
    thesisHoveredNode = null;
    thesisDrawMap();
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
