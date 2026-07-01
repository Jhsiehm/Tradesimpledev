/* Extracted from app.js lines 1-903 */

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

function normalizeWatchSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 12);
}

const WATCHLIST_STORAGE_KEY = "ts_watchlist";
const FEED_SCOPE_STORAGE_KEY = "ts_feed_scope";
const WATCHLIST_PROMPT_SEEN_KEY = "ts_watchlist_prompt_seen";
const DEFAULT_WATCHLIST_SYMBOLS = ["PLTR", "NVDA", "LMT", "TSM", "JPM"];
const WATCHLIST_SUGGESTED_CHIPS = ["PLTR", "NVDA", "TSM", "LMT", "JPM", "TSLA", "SOFI", "AMD"];

function watchlistUserKey(userId) {
  const id = String(userId || state.session?.user?.id || "").trim();
  return id ? `${WATCHLIST_STORAGE_KEY}_${id.replace(/[^a-zA-Z0-9_.:-]/g, "_")}` : WATCHLIST_STORAGE_KEY;
}

function getWatchlist() {
  return [...state.watchlistSymbols];
}

function readWatchlistFromStorage(userId) {
  try {
    const keys = [watchlistUserKey(userId), WATCHLIST_STORAGE_KEY];
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : parsed?.symbols;
      if (Array.isArray(rows) && rows.length) {
        return rows.map(normalizeWatchSymbol).filter(Boolean);
      }
    }
  } catch (_) {}
  return null;
}

function writeWatchlistToStorage(symbols, userId) {
  try {
    const payload = JSON.stringify(symbols);
    localStorage.setItem(watchlistUserKey(userId), payload);
    localStorage.setItem(WATCHLIST_STORAGE_KEY, payload);
  } catch (_) {}
}

function getFeedScope() {
  try {
    const stored = sessionStorage.getItem(FEED_SCOPE_STORAGE_KEY);
    if (stored === "all" || stored === "watchlist") return stored;
  } catch (_) {}
  return state.watchlistSymbols.length ? "watchlist" : "all";
}

function isWatchlistScope() {
  return getFeedScope() === "watchlist" && state.watchlistSymbols.length > 0;
}

function setFeedScope(scope) {
  const next = scope === "all" ? "all" : "watchlist";
  try {
    sessionStorage.setItem(FEED_SCOPE_STORAGE_KEY, next);
  } catch (_) {}
  state.feedScope = next;
  renderFeedScopeToggle();
  refreshPolicyScopedViews();
}

function itemMatchesWatchlist(tickers) {
  const list = (tickers || []).map(normalizeWatchSymbol).filter(Boolean);
  if (!list.length) return false;
  return list.some((sym) => isOnWatchlist(sym));
}

function rowMatchesPolicyScope(tickers = []) {
  if (state.focusSymbol) return rowMatchesFocusSymbol(tickers);
  if (!isWatchlistScope()) return true;
  return itemMatchesWatchlist(tickers);
}

function watchlistEmptyStateHtml() {
  return `<div class="guided-empty-state"><strong>No policy catalysts found for your watchlist today.</strong> <button type="button" class="link-button" data-feed-scope-set="all">View all policy</button></div>`;
}

function watchlistNewSinceVisitCount() {
  const current = collectVisitSnapshot();
  const prev = loadVisitSnapshot();
  if (!prev) return 0;
  let total = 0;
  const prevTickers = prev?.tickers || {};
  const curTickers = current.tickers || {};
  for (const sym of sinceLastVisitScopeTickers()) {
    const before = prevTickers[sym] || { signalIds: [], billIds: [], contractIds: [] };
    const now = curTickers[sym] || { signalIds: [], billIds: [], contractIds: [] };
    const prevSignals = new Set([...(before.signalIds || []), ...(before.billIds || []).map((id) => `bill:${id}`)]);
    total += [...new Set([...(now.signalIds || []), ...(now.billIds || []).map((id) => `bill:${id}`)])].filter(
      (id) => !prevSignals.has(id)
    ).length;
    const prevContracts = new Set(before.contractIds || []);
    total += (now.contractIds || []).filter((id) => !prevContracts.has(id)).length;
  }
  const fecIds = new Set(prev?.fecPulseIds || []);
  for (const pulse of state.fecPulse?.pulses || []) {
    const id = pulse.clusterKey || pulse.committee;
    if (!id || fecIds.has(id)) continue;
    if (isWatchlistScope() && !itemMatchesWatchlist(pulse.tickers || [])) continue;
    total += 1;
  }
  return total;
}

function renderBookSummaryHeader() {
  const el = $("#ts-book-summary");
  if (!el) return;
  const count = state.watchlistSymbols.length;
  if (!count) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const fresh = watchlistNewSinceVisitCount();
  const freshPart = fresh ? ` · ${fresh} new this week` : "";
  el.textContent = `Your book · ${count} name${count === 1 ? "" : "s"}${freshPart}`;
}

function renderFeedScopeToggle() {
  const bar = $("#feed-scope-bar");
  if (!bar) return;
  const scope = getFeedScope();
  bar.querySelectorAll("[data-feed-scope]").forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.feedScope === scope);
  });
}

function refreshPolicyScopedViews() {
  renderBookSummaryHeader();
  renderTabFilterContexts();
  if ($("#view-overview")?.classList.contains("active")) renderOverview();
  if ($("#view-signals")?.classList.contains("active")) renderSignalsDesk();
  if ($("#view-bills")?.classList.contains("active") && isFeatureEnabled("BILLS_EXPLORER_ENABLED")) renderBills();
  if ($("#view-fec")?.classList.contains("active")) renderFecView();
  renderSinceLastVisitStrip();
}

function setWatchlist(symbols, options = {}) {
  setWatchlistSymbols(symbols, options);
}

let watchlistPersistTimer = null;

function scheduleWatchlistPersist() {
  if (watchlistPersistTimer) clearTimeout(watchlistPersistTimer);
  watchlistPersistTimer = setTimeout(() => {
    watchlistPersistTimer = null;
    persistWatchlist().catch((err) => console.warn("[watchlist] persist failed", err));
  }, 400);
}

async function persistWatchlist() {
  const symbols = [...state.watchlistSymbols];
  writeWatchlistToStorage(symbols, state.session?.user?.id);
  try {
    await fetchJson("/api/watchlist", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbols })
    });
  } catch (error) {
    if (error?.status === 503) return;
    throw error;
  }
}

function setWatchlistSymbols(symbols, { persist = true } = {}) {
  const next = [];
  const seen = new Set();
  for (const raw of symbols || []) {
    const sym = normalizeWatchSymbol(raw);
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    next.push(sym);
    if (next.length >= 50) break;
  }
  state.watchlistSymbols = next;
  if (!state.feedScope && next.length) state.feedScope = "watchlist";
  renderWatchlistStrip();
  populateSymbolSelects();
  renderBookSummaryHeader();
  renderFeedScopeToggle();
  if (persist) scheduleWatchlistPersist();
}

function toggleWatchlistSymbol(symbol) {
  const sym = normalizeWatchSymbol(symbol);
  if (!sym) return;
  if (state.watchlistSymbols.includes(sym)) {
    setWatchlistSymbols(state.watchlistSymbols.filter((row) => row !== sym));
  } else {
    setWatchlistSymbols([...state.watchlistSymbols, sym]);
  }
}

function isOnWatchlist(symbol) {
  return state.watchlistSymbols.includes(normalizeWatchSymbol(symbol));
}

function contractWatchlist() {
  const rows = dashboardBootstrap().contractWatchlist;
  return Array.isArray(rows) ? rows : [];
}

function tradableSymbolRows() {
  const rows = dashboardBootstrap().tradableSymbols;
  return Array.isArray(rows) ? rows : [];
}

function symbolHasSource(row, source) {
  return (row?.sources || []).includes(source);
}

function symbolSourceBadgeLabel(source) {
  if (source === "contract") return "Contract";
  if (source === "bill") return "Bill";
  if (source === "lobby") return "Lobby";
  if (source === "seed" || source === "market" || source === "fundamentals") return "Market";
  return source;
}

const MARKETS_FILTER_STORAGE_KEY = "ts_markets_filter";
const MARKETS_MOBILE_DESK_KEY = "ts_markets_mobile_desk";
const LAST_VISIT_AT_KEY = "ts_last_visit_at";
const LAST_VISIT_SNAPSHOT_KEY = "ts_last_visit_snapshot";
const MARKETS_INDEX_ETFS = new Set([
  "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "ARKK", "XLE", "XLF", "XLK", "XLV", "XLI", "XLP", "XLY", "XLU", "XLB", "KBE"
]);
const MARKETS_TOPIC_TAGS = {
  defense: new Set(["LMT", "NOC", "RTX", "GD", "BAH", "PLTR", "LDOS", "HII", "TXT", "LHX", "KTOS", "CACI", "SPCX"]),
  crypto: new Set(["COIN", "MSTR", "MARA", "RIOT", "HOOD"]),
  tech: new Set(["NVDA", "AMD", "AAPL", "MSFT", "GOOGL", "META", "AMZN", "INTC", "AVGO", "CRM", "ORCL", "MU", "QCOM"]),
  pharma: new Set(["LLY", "PFE", "MRNA", "ABBV", "JNJ", "BMY", "GILD", "REGN", "VRTX"])
};

function getStoredMarketsFilter() {
  try {
    const value = sessionStorage.getItem(MARKETS_FILTER_STORAGE_KEY) || localStorage.getItem(MARKETS_FILTER_STORAGE_KEY);
    const allowed = new Set([
      "all", "contract", "legislation", "lobbying", "indices", "market", "watchlist",
      "defense", "crypto", "tech", "pharma"
    ]);
    if (value && allowed.has(value)) return value;
  } catch (_) {}
  return "all";
}

function persistMarketsFilter(filter) {
  try {
    sessionStorage.setItem(MARKETS_FILTER_STORAGE_KEY, filter);
    localStorage.setItem(MARKETS_FILTER_STORAGE_KEY, filter);
  } catch (_) {}
}

const FOCUS_SYMBOL_STORAGE_KEY = "ts_focus_symbol";
const BILLS_STAGE_FILTER_KEY = "ts_bills_stage_filter";
const SIGNALS_TYPE_FILTER_KEY = "ts_signals_type_filter";
const CONTRACTS_AGENCY_FILTER_KEY = "ts_contracts_agency_filter";
const CONTRACTS_MIN_AMOUNT_KEY = "ts_contracts_min_amount";
const LOBBY_KEYWORD_KEY = "ts_lobby_keyword";
const LOBBY_TOPIC_KEY = "ts_lobby_topic";
const BILLS_MODE_SESSION_KEY = "ts_bills_mode";

const LOBBY_TOPIC_KEYWORDS = {
  defense: ["defense", "military", "armed", "dod", "weapon", "aerospace", "national security"],
  pharma: ["pharma", "drug", "prescription", "medicare", "fda", "health", "biotech"],
  tech: ["tech", "software", "semiconductor", "artificial intelligence", "data privacy", "cyber", "cloud"]
};
const SIGNALS_DESK_PREVIEW = 3;
let _trendingDeskExpanded = false;
let _contractWatchDeskExpanded = false;

function getStoredFocusSymbol() {
  try {
    return normalizeWatchSymbol(sessionStorage.getItem(FOCUS_SYMBOL_STORAGE_KEY) || localStorage.getItem(FOCUS_SYMBOL_STORAGE_KEY) || "");
  } catch (_) {
    return "";
  }
}

function persistFocusSymbol(symbol) {
  const sym = normalizeWatchSymbol(symbol);
  try {
    if (sym) {
      sessionStorage.setItem(FOCUS_SYMBOL_STORAGE_KEY, sym);
      localStorage.setItem(FOCUS_SYMBOL_STORAGE_KEY, sym);
    } else {
      sessionStorage.removeItem(FOCUS_SYMBOL_STORAGE_KEY);
      localStorage.removeItem(FOCUS_SYMBOL_STORAGE_KEY);
    }
  } catch (_) {}
}

function getStoredTabFilter(key, allowed, fallback = "all") {
  try {
    const value = sessionStorage.getItem(key) || localStorage.getItem(key);
    if (value && allowed.has(value)) return value;
  } catch (_) {}
  return fallback;
}

function persistTabFilter(key, value) {
  try {
    sessionStorage.setItem(key, value);
    localStorage.setItem(key, value);
  } catch (_) {}
}

function setFocusSymbol(symbol, { persist = true, render = true, syncAnalysis = true } = {}) {
  const sym = normalizeWatchSymbol(symbol);
  state.focusSymbol = sym || null;
  if (persist) persistFocusSymbol(sym);
  if (sym && syncAnalysis) {
    state.activeAnalysisSymbol = sym;
    const sel = $("#analysis-symbol");
    if (sel) setSymbolPickerValue(sel, sym, { notify: false });
  }
  if (sym) {
    const marketsSearch = $("#markets-search");
    if (marketsSearch) marketsSearch.value = sym;
    state.marketsSearch = sym;
  }
  if (render) {
    renderFocusBar();
    renderMobileContextBar();
    syncResearchFabLabel();
    renderTabFilterContexts();
    renderMarkets();
    if (isFeatureEnabled("BILLS_EXPLORER_ENABLED")) renderBills();
    if (isFeatureEnabled("CONTRACTS_ANALYZER_ENABLED")) {
      renderContracts();
      renderContractsTabWatch();
    }
    if (isFeatureEnabled("LOBBYING_EXPLORER_ENABLED")) renderLobbying();
    if (isViewEnabled("signals")) renderSignalsDesk();
    if ($("#view-analysis")?.classList.contains("active") && sym && isFeatureEnabled("ANALYSIS_LAB_ENABLED")) {
      loadAnalysis(sym);
    }
    syncFocusUrlParam();
  }
  return sym;
}

function clearFocusSymbol() {
  setFocusSymbol("", { render: true });
  const marketsSearch = $("#markets-search");
  if (marketsSearch) marketsSearch.value = "";
  state.marketsSearch = "";
  renderMarkets();
}

function syncFocusUrlParam() {
  const params = new URLSearchParams(window.location.search);
  if (state.focusSymbol) params.set("symbol", state.focusSymbol);
  else params.delete("symbol");
  const clean = params.toString();
  window.history.replaceState({}, "", clean ? `${window.location.pathname}?${clean}` : window.location.pathname);
}

function renderFocusBar() {
  const bar = $("#ts-focus-bar");
  if (!bar) return;
  const sym = state.focusSymbol;
  bar.hidden = !sym;
  const symEl = $("#ts-focus-symbol");
  const hint = $("#ts-focus-hint");
  const marketsLink = $("#ts-focus-markets-link");
  if (symEl) symEl.textContent = sym || "—";
  if (hint) {
    hint.textContent = sym
      ? "Bills, contracts, lobbying, markets, and signals respect this ticker until you clear it."
      : "";
  }
  if (marketsLink) {
    marketsLink.hidden = !sym;
    marketsLink.onclick = (e) => {
      e.preventDefault();
      showView("markets");
    };
  }
}

function renderTabFilterContexts() {
  const sym = state.focusSymbol;
  const scopeSuffix = isWatchlistScope() && !sym ? " · watchlist" : "";
  const focusSuffix = sym ? ` · focus ${sym}` : "";

  const billsCtx = $("#bills-filter-context");
  if (billsCtx && billsGuidedMode() !== "guided") {
    const n = filteredBillsRows().length;
    const stage = state.billsStageFilter || "all";
    const stageLbl = stage === "all" ? "" : ` · ${stage}`;
    billsCtx.hidden = false;
    billsCtx.textContent = `${n} bill${n === 1 ? "" : "s"}${stageLbl}${scopeSuffix}${focusSuffix}`;
  }

  const contractsCtx = $("#contracts-filter-context");
  if (contractsCtx) {
    const n = (state.contracts || []).filter(contractMatchesTabFilters).length;
    contractsCtx.hidden = false;
    contractsCtx.textContent = `${n} compan${n === 1 ? "y" : "ies"}${focusSuffix}`;
  }

  const lobbyCtx = $("#lobby-filter-context");
  if (lobbyCtx) {
    const n = (state.lobbying || []).filter(lobbyingMatchesTabFilters).length;
    const kw = String(state.lobbyKeyword || "").trim();
    const topic = state.lobbyTopicFilter || "";
    const topicLbl = topic ? ` · ${topic.charAt(0).toUpperCase()}${topic.slice(1)}` : "";
    lobbyCtx.hidden = false;
    lobbyCtx.textContent = `${n} filing${n === 1 ? "" : "s"}${topicLbl}${kw ? ` · "${kw}"` : ""}${focusSuffix}`;
  }

  const signalsCtx = $("#signals-filter-context");
  if (signalsCtx) {
    const type = state.signalsTypeFilter || "all";
    const typeLbl = type === "all" ? "All types" : type.charAt(0).toUpperCase() + type.slice(1);
    const count = countSignalsDeskItems(type);
    signalsCtx.hidden = false;
    signalsCtx.textContent = `${typeLbl} · ${count} item${count === 1 ? "" : "s"}${scopeSuffix}${focusSuffix}`;
  }

  const marketsCtx = $("#markets-filter-context");
  if (marketsCtx) {
    const subTab = state.marketsSubTab || "equities";
    if (subTab === "crypto") {
      const n = (state.crypto || []).length;
      marketsCtx.hidden = false;
      marketsCtx.textContent = `${n} asset${n === 1 ? "" : "s"} · Crypto${focusSuffix}`;
    } else {
      const rows = filteredMarketsRows();
      const filter = state.marketsFilter || "all";
      const label = marketsFilterLabel(filter);
      marketsCtx.hidden = false;
      marketsCtx.textContent = `${rows.length} symbol${rows.length === 1 ? "" : "s"} · ${label}${focusSuffix}`;
    }
  }
}

function syncResearchFabLabel() {
  const btn = $("#research-drawer-btn") || document.querySelector(".research-drawer-btn");
  if (!btn) return;
  const sym = state.focusSymbol || state.activeAnalysisSymbol;
  btn.textContent = sym ? `Ask about ${sym}` : "Ask AI";
  btn.setAttribute("aria-label", sym ? `Ask AI about ${sym}` : "Ask AI research assistant");
}

function focusNoLinkageHtml(view) {
  const sym = state.focusSymbol;
  if (!sym) return "";
  const linkedViews = new Set(["bills", "contracts", "lobbying", "markets", "signals", "analysis"]);
  if (!linkedViews.has(view)) {
    return `<p class="ts-filter-context muted" style="padding:0 16px 8px">No ${escapeHtml(sym)} linkage on this tab yet — <button type="button" class="link-button" data-view-jump="markets">browse Markets</button></p>`;
  }
  return "";
}

function billMatchesStageFilter(bill) {
  const stage = state.billsStageFilter || "all";
  if (stage === "all") return true;
  const status = billStatusInfo(bill);
  const key = String(status.key || bill.status || "").toLowerCase();
  const label = String(status.label || "").toLowerCase();
  if (stage === "floor") {
    return Boolean(
      bill.floorScheduled ||
        key.includes("floor") ||
        label.includes("floor") ||
        label.includes("chamber") ||
        /floor vote/i.test(bill.catalyst?.label || "")
    );
  }
  if (stage === "passed") {
    return (
      key.includes("pass") ||
      key.includes("enacted") ||
      key.includes("law") ||
      label.includes("pass") ||
      label.includes("enacted")
    );
  }
  return true;
}

function rowMatchesFocusSymbol(tickers = []) {
  const sym = state.focusSymbol;
  if (!sym) return true;
  return (tickers || []).map(normalizeWatchSymbol).includes(sym);
}

function billMatchesFocusFilter(bill) {
  const tickers = [...(bill.affected || []), ...(bill.portfolioTickers || [])];
  return rowMatchesPolicyScope(tickers);
}

function filteredBillsRows() {
  const query = ($("#bill-filter")?.value || "").toLowerCase();
  return policyBills({ includeUnmapped: Boolean(query || state.focusSymbol) }).filter((bill) => {
    if (!billMatchesStageFilter(bill)) return false;
    if (!billMatchesFocusFilter(bill)) return false;
    if (!query) return true;
    return [bill.id, bill.title, bill.shortTitle, bill.status, bill.signal, ...(bill.affected || []), ...(bill.tags || [])]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function contractAgencyHaystack(row) {
  return [row.topAgency, ...(row.results || []).map((r) => r.awardingAgency)]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

function contractAgencyMatches(row, agency) {
  if (!agency || agency === "all") return true;
  const hay = contractAgencyHaystack(row);
  if (agency === "dod") return /DEFENSE|DOD|DEPT OF DEFENSE|ARMY|NAVY|AIR FORCE/.test(hay);
  if (agency === "nasa") return /NASA/.test(hay);
  if (agency === "dhs") return /HOMELAND|DHS/.test(hay);
  return true;
}

function contractAwardAgencyMatches(award, agency) {
  if (!agency || agency === "all") return true;
  const hay = String(award.agency || "").toUpperCase();
  if (agency === "dod") return /DEFENSE|DOD|DEPT OF DEFENSE|ARMY|NAVY|AIR FORCE/.test(hay);
  if (agency === "nasa") return /NASA/.test(hay);
  if (agency === "dhs") return /HOMELAND|DHS/.test(hay);
  return true;
}

function contractMatchesTabFilters(row) {
  if (!contractAgencyMatches(row, state.contractsAgencyFilter)) return false;
  const min = Number(state.contractsMinAmount || 0);
  if (min > 0 && Number(row.totalObligated || 0) < min) return false;
  if (state.focusSymbol && normalizeWatchSymbol(row.symbol) !== state.focusSymbol) return false;
  return true;
}

function contractWatchMatchesTabFilters(award) {
  if (!contractAwardAgencyMatches(award, state.contractsAgencyFilter)) return false;
  const min = Number(state.contractsMinAmount || 0);
  if (min > 0 && Number(award.amount || 0) < min) return false;
  if (state.focusSymbol) {
    const tickers = [...(award.mappedTickers || []), ...(award.relatedTickers || [])];
    if (!rowMatchesFocusSymbol(tickers)) return false;
  }
  return true;
}

function lobbyingMatchesTabFilters(filing) {
  const topic = state.lobbyTopicFilter || "";
  if (topic) {
    const keywords = LOBBY_TOPIC_KEYWORDS[topic] || [];
    const hay = [filing.client, filing.registrant, filing.issue].join(" ").toLowerCase();
    const keywordHit = keywords.some((word) => hay.includes(word));
    const connection = relatedBillForFiling(filing);
    const tickers = connection?.bill?.affected || [];
    const tagHit = (MARKETS_TOPIC_TAGS[topic] && tickers.some((sym) => MARKETS_TOPIC_TAGS[topic].has(normalizeWatchSymbol(sym))));
    if (!keywordHit && !tagHit) return false;
  }
  const keyword = String(state.lobbyKeyword || "").trim().toLowerCase();
  if (keyword) {
    const hay = [filing.client, filing.registrant, filing.issue].join(" ").toLowerCase();
    if (!hay.includes(keyword)) return false;
  }
  if (!state.focusSymbol) return true;
  const connection = relatedBillForFiling(filing);
  const tickers = connection?.bill?.affected || [];
  if (rowMatchesFocusSymbol(tickers)) return true;
  const client = String(filing.client || "").toUpperCase();
  return client.includes(state.focusSymbol);
}

function signalMatchesTypeFilter(sig) {
  const type = state.signalsTypeFilter || "all";
  if (type === "all") return true;
  if (type === "bills") return sig.type === "bill" || sig.type === "lobbying" || sig.type === "fec";
  if (type === "contracts") return sig.type === "contract";
  if (type === "trending") {
    const topics = state.trending || [];
    const topicTickers = topics.flatMap((t) => [...(t.tickers || []), ...(t.relatedTickers || [])]);
    return sig.tickers.some((t) => topicTickers.includes(t));
  }
  return true;
}

function signalMatchesFocusFilter(sig) {
  return rowMatchesPolicyScope(sig.tickers || []);
}

function trendingMatchesSignalsFilter(topic) {
  const type = state.signalsTypeFilter || "all";
  if (type === "contracts") return topic.type === "contract";
  if (type === "bills") return topic.type === "legislation" || topic.type === "ma";
  if (type === "trending" || type === "all") return true;
  return true;
}

function countSignalsDeskItems(type = "all") {
  const t = type || state.signalsTypeFilter || "all";
  let count = 0;
  if (t === "all" || t === "trending") {
    count += (state.trending || []).filter(trendingMatchesSignalsFilter).length;
  }
  if (t === "all" || t === "contracts") {
    count += (state.contractWatch || []).filter(contractWatchMatchesTabFilters).length;
  }
  if (t === "all" || t === "bills") {
    count += buildSignalFeed().filter((sig) => signalMatchesTypeFilter(sig) && signalMatchesFocusFilter(sig)).length;
    count += catalystCandidates().filter((item) => !state.focusSymbol || (item.tickers || []).map(normalizeWatchSymbol).includes(state.focusSymbol)).length;
    count += policyBills().filter((bill) => billMatchesFocusFilter(bill)).length;
    count += buildLiveAlerts().length;
  }
  if (t === "trending") {
    count = (state.trending || []).filter(trendingMatchesSignalsFilter).length;
  }
  if (t === "contracts") {
    count = (state.contractWatch || []).filter(contractWatchMatchesTabFilters).length
      + buildSignalFeed().filter((sig) => sig.type === "contract" && signalMatchesFocusFilter(sig)).length;
  }
  if (t === "bills") {
    count = buildSignalFeed().filter((sig) => (sig.type === "bill" || sig.type === "lobbying" || sig.type === "fec") && signalMatchesFocusFilter(sig)).length
      + catalystCandidates().length
      + policyBills().filter(billMatchesFocusFilter).length;
  }
  return count;
}

function applySignalsDeskVisibility() {
  const type = state.signalsTypeFilter || "all";
  const show = (allowed) => type === "all" || allowed.includes(type);
  const setHidden = (sel, allowed) => {
    const el = typeof sel === "string" ? $(sel) : sel;
    if (el) el.hidden = !show(allowed);
  };
  setHidden("#trending-panel", ["trending"]);
  setHidden("#contract-watch-panel", ["contracts"]);
  setHidden("#signal-chain-fold", ["bills", "contracts", "all"]);
  setHidden("#signals-tape-fold", ["bills", "all"]);
  setHidden("#policy-catalyst-fold", ["bills", "all"]);
  setHidden("#contract-watch-evidence-fold", ["contracts", "all"]);
  setHidden("#signals-conviction-panel", ["bills", "all"]);
  const evidenceFold = $("#signals-evidence-fold");
  if (evidenceFold) {
    evidenceFold.hidden = type === "trending" || type === "contracts";
    if (evidenceFold.open) evidenceFold.open = false;
  }
  const primaryLane = $("#signals-primary-lane");
  if (primaryLane) {
    primaryLane.classList.toggle("signals-primary-lane--trending", type === "trending");
    primaryLane.classList.toggle("signals-primary-lane--contracts", type === "contracts");
  }
  const top = $("#signals-top-signal");
  if (top && type !== "all" && type !== "bills") top.hidden = true;
}

function syncFilterChipGroup(bar, attr, activeValue) {
  if (!bar) return;
  bar.querySelectorAll(`[${attr}]`).forEach((chip) => {
    chip.classList.toggle("is-active", chip.getAttribute(attr) === activeValue);
  });
}

function stockPageUrl(symbol) {
  const sym = normalizeWatchSymbol(symbol);
  return sym ? `/stock/${encodeURIComponent(sym)}` : "/dashboard?view=analysis";
}

function marketsSourceSortKey(row) {
  const order = { contract: 0, bill: 1, lobby: 2, seed: 3, market: 3, fundamentals: 3 };
  const sources = row?.sources || [];
  if (!sources.length) return 4;
  return Math.min(...sources.map((source) => order[source] ?? 4));
}

function marketsCatalogRows() {
  return tradableSymbolRows()
    .slice()
    .sort((a, b) => {
      const diff = marketsSourceSortKey(a) - marketsSourceSortKey(b);
      if (diff) return diff;
      return a.symbol.localeCompare(b.symbol);
    });
}

function marketsRowIsIndexEtf(row) {
  const sym = row?.symbol || "";
  return MARKETS_INDEX_ETFS.has(sym) || /^X[A-Z]{2}$/.test(sym);
}

function marketsRowIsMarketOnly(row) {
  const sources = row?.sources || [];
  return sources.length > 0 && sources.every((source) => source === "seed" || source === "market" || source === "fundamentals");
}

function marketsFilterMatches(row, filter) {
  if (!row) return false;
  if (filter === "all") return true;
  if (filter === "watchlist") return isOnWatchlist(row.symbol);
  if (filter === "contract") return symbolHasSource(row, "contract");
  if (filter === "legislation") return symbolHasSource(row, "bill");
  if (filter === "lobbying") return symbolHasSource(row, "lobby");
  if (filter === "indices") return marketsRowIsIndexEtf(row);
  if (filter === "market") return marketsRowIsMarketOnly(row);
  if (MARKETS_TOPIC_TAGS[filter]) return MARKETS_TOPIC_TAGS[filter].has(row.symbol);
  return true;
}

function marketsFilterLabel(filter) {
  const labels = {
    all: "All",
    contract: "Contract",
    legislation: "Legislation",
    lobbying: "Lobbying",
    indices: "Indices & ETFs",
    market: "Mega-cap / Market",
    watchlist: "Watchlist",
    defense: "Defense",
    crypto: "Crypto",
    tech: "Tech",
    pharma: "Pharma"
  };
  return labels[filter] || "All";
}

function filteredMarketsRows() {
  const filter = state.marketsFilter || "all";
  const query = String(state.marketsSearch || state.focusSymbol || "").trim().toUpperCase();
  return marketsCatalogRows().filter((row) => {
    if (!marketsFilterMatches(row, filter)) return false;
    if (state.focusSymbol && normalizeWatchSymbol(row.symbol) !== state.focusSymbol) return false;
    if (!query) return true;
    return row.symbol.includes(query) || String(row.name || "").toUpperCase().includes(query);
  });
}

function marketsVisibleSymbols() {
  const rows = filteredMarketsRows();
  const symbols = rows.map((row) => row.symbol);
  return symbols.length ? symbols : marketsDefaultSymbols();
}

function mergeQuotesIntoState(newQuotes) {
  const map = new Map((state.quotes || []).map((quote) => [quote.symbol, quote]));
  normalizeQuotes(newQuotes || []).forEach((quote) => map.set(quote.symbol, quote));
  state.quotes = Array.from(map.values());
}

function ensureQuotePendingSet() {
  if (!state.quotePendingSymbols) state.quotePendingSymbols = new Set();
  return state.quotePendingSymbols;
}

function markQuoteSymbolsPending(symbols) {
  const pending = ensureQuotePendingSet();
  for (const raw of symbols || []) {
    const sym = normalizeWatchSymbol(raw);
    if (sym) pending.add(sym);
  }
}

function clearQuoteSymbolPending(symbol) {
  const sym = normalizeWatchSymbol(symbol);
  if (sym) state.quotePendingSymbols?.delete(sym);
}

function resetQuoteRetryFailure(symbol) {
  const sym = normalizeWatchSymbol(symbol);
  if (sym) state.quoteRetryFailures?.delete(sym);
}

function bumpQuoteRetryFailures(symbols) {
  for (const raw of symbols || []) {
    const sym = normalizeWatchSymbol(raw);
    if (!sym) continue;
    state.quoteRetryFailures.set(sym, (state.quoteRetryFailures.get(sym) || 0) + 1);
  }
}

function quoteHasRenderablePrice(quote) {
  return quote?.price != null && Number.isFinite(Number(quote.price)) && Number(quote.price) > 0;
}

function chunkMissingQuoteSymbols(chunk, map) {
  return chunk.filter((symbol) => {
    const quote = map.get(symbol);
    return !quoteHasRenderablePrice(quote);
  });
}

function applyQuoteBatchToState(data, { render = true } = {}) {
  if (!data) return;
  mergeQuotesIntoState(data.quotes);
  normalizeQuotes(data.quotes || []).forEach((quote) => {
    if (quoteHasRenderablePrice(quote)) {
      clearQuoteSymbolPending(quote.symbol);
      if (!quote.pending) resetQuoteRetryFailure(quote.symbol);
    }
  });
  if (data.source) state.quoteFeedSource = data.source;
  if (data.hadError) {
    state.quoteFeedError = "Some live quotes are delayed — retrying in the background.";
  } else if (data.quotes?.length) {
    state.quoteFeedError = "";
  }
  rememberFeedMeta("market", data, data.source || "quotes");
  if (!render) return;
  renderSourceBadges();
  renderTape();
  thesisUpdateQuoteTrustUi();
  renderOverview();
  renderMarkets();
  renderAccount();
  if (state.tradeHistory) renderTradePanel();
  renderLiveAlerts();
  syncQuotesFallbackBanner(data);
  syncQuoteWarmupHint();
  if ($("#view-analysis")?.classList.contains("active") && state.analysis) {
    refreshActiveAnalysisChart();
  }
}

function quoteIsStaticFallback(quote) {
  const src = String(quote?.source || "").toLowerCase();
  return src === "fallback_static" || src === "fallback";
}

function summarizeQuoteBatchMeta(quotes, source = "") {
  const staticCount = quotes.filter(quoteIsStaticFallback).length;
  const fallback = quotes.length > 0 && staticCount === quotes.length;
  return {
    quotes,
    source,
    fallback,
    partialFallback: staticCount > 0 && !fallback,
    staticQuoteCount: staticCount,
    liveQuoteCount: quotes.length - staticCount
  };
}

const QUOTE_BATCH_CHUNK_SIZE = 6;
const QUOTE_BATCH_CHUNK_TIMEOUT_MS = 15000;
const QUOTE_BATCH_MAX_RETRY_PASSES = 2;
const QUOTE_LIVE_UPGRADE_POLL_MS = 60_000;
const QUOTE_LIVE_MAJORITY_RATIO = 0.5;
const QUOTE_CATALOG_TIMEOUT_MS = 8000;

function hotQuoteSymbols() {
  return [
    ...new Set(
      [
        ...marketsDefaultSymbols(),
        ...tapeDefaultQuoteSymbols(),
        ...watchlistRows().map((w) => w.symbol),
        ...paperPositionSymbols(),
        state.activeAnalysisSymbol,
        state.tradeSymbol
      ].filter(Boolean)
    )
  ];
}

