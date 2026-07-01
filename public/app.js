
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

async function fetchJsonTimed(url, init, timeoutMs = QUOTE_BATCH_CHUNK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchJson(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCatalogQuotes(options = {}) {
  const timeoutMs = Number(options.timeoutMs) || QUOTE_CATALOG_TIMEOUT_MS;
  const data = await fetchJsonTimed("/api/market/quotes/catalog", null, timeoutMs);
  return summarizeQuoteBatchMeta(normalizeQuotes(data.quotes || []), data.source || "");
}

function catalogQuoteCoverage() {
  const catalog = marketsCatalogRows().map((row) => row.symbol);
  if (!catalog.length) return { total: 0, priced: 0, missing: [] };
  const missing = catalog.filter((symbol) => !quoteHasRenderablePrice(quoteFor(symbol)));
  return { total: catalog.length, priced: catalog.length - missing.length, missing };
}

async function fetchQuotesBatched(symbols, options = {}) {
  const unique = [...new Set((symbols || []).map((sym) => normalizeWatchSymbol(sym)).filter(Boolean))];
  if (!unique.length) return summarizeQuoteBatchMeta([], "");
  const chunkSize = Math.max(1, Number(options.chunkSize) || QUOTE_BATCH_CHUNK_SIZE);
  const chunkTimeoutMs = Number(options.chunkTimeoutMs) || QUOTE_BATCH_CHUNK_TIMEOUT_MS;
  const onChunk = typeof options.onChunk === "function" ? options.onChunk : null;
  const trackPending = options.trackPending !== false;
  const retryPass = Number(options._retryPass) || 0;
  const allowRetry = options.retryMissing !== false && retryPass < QUOTE_BATCH_MAX_RETRY_PASSES;
  if (trackPending && retryPass === 0) markQuoteSymbolsPending(unique);
  const chunks = [];
  for (let i = 0; i < unique.length; i += chunkSize) chunks.push(unique.slice(i, i + chunkSize));
  const map = new Map();
  let source = "";
  let hadError = false;
  const missingAfterPass = [];
  for (const chunk of chunks) {
    try {
      const data = await fetchJsonTimed(
        `/api/market/quotes?symbols=${chunk.join(",")}`,
        null,
        chunkTimeoutMs
      );
      normalizeQuotes(data.quotes || []).forEach((quote) => {
        if (quoteHasRenderablePrice(quote)) {
          map.set(quote.symbol, quote);
          if (trackPending) clearQuoteSymbolPending(quote.symbol);
        }
      });
      source = data.source || source;
      const missing = chunkMissingQuoteSymbols(chunk, map);
      if (missing.length) missingAfterPass.push(...missing);
      if (onChunk) {
        onChunk(summarizeQuoteBatchMeta(Array.from(map.values()), source), { chunk, hadError });
      }
    } catch (error) {
      hadError = true;
      console.warn("[quotes] chunk fetch failed", chunk.join(","), error);
      missingAfterPass.push(...chunkMissingQuoteSymbols(chunk, map));
      if (onChunk) {
        onChunk(summarizeQuoteBatchMeta(Array.from(map.values()), source), { chunk, hadError: true, error });
      }
    }
  }
  if (allowRetry && missingAfterPass.length) {
    const retrySymbols = [...new Set(missingAfterPass)].filter((symbol) => !quoteHasRenderablePrice(map.get(symbol)));
    if (retrySymbols.length) {
      const retryMeta = await fetchQuotesBatched(retrySymbols, {
        ...options,
        chunkSize: Math.min(4, chunkSize),
        _retryPass: retryPass + 1,
        trackPending
      });
      retryMeta.quotes.forEach((quote) => {
        if (quoteHasRenderablePrice(quote)) {
          map.set(quote.symbol, quote);
          if (trackPending) clearQuoteSymbolPending(quote.symbol);
        }
      });
      source = retryMeta.source || source;
      if (retryMeta.hadError) hadError = true;
    }
  }
  const meta = summarizeQuoteBatchMeta(Array.from(map.values()), source);
  if (hadError) meta.hadError = true;
  if (trackPending && retryPass === 0) {
    const stillMissing = unique.filter((symbol) => !quoteHasRenderablePrice(map.get(symbol)));
    if (stillMissing.length) bumpQuoteRetryFailures(stillMissing);
  }
  return meta;
}

function missingQuoteSymbols() {
  const catalog = marketsCatalogRows().map((row) => row.symbol);
  const universe = catalog.length ? catalog : quoteSymbolUniverse();
  return universe.filter((symbol) => !quoteHasRenderablePrice(quoteFor(symbol)));
}

function staticFallbackQuoteSymbols() {
  const catalog = marketsCatalogRows().map((row) => row.symbol);
  const universe = catalog.length ? catalog : quoteSymbolUniverse();
  return universe.filter((symbol) => {
    const quote = quoteFor(symbol);
    return quoteHasRenderablePrice(quote) && quoteIsStaticFallback(quote);
  });
}

function catalogLiveQuoteStats() {
  const symbols = marketsCatalogRows().map((row) => row.symbol);
  const total = symbols.length;
  let live = 0;
  for (const sym of symbols) {
    const quote = quoteFor(sym);
    if (quoteHasRenderablePrice(quote) && !quoteIsStaticFallback(quote)) live += 1;
  }
  return { total, live, static: total - live };
}

function syncQuoteWarmupHint() {
  const el = $("#quote-warmup-hint");
  if (!el) return;
  const { total, live, static: staticCount } = catalogLiveQuoteStats();
  if (!total || staticCount === 0) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = `Upgrading to live prices… ${live}/${total} live`;
}

function quoteUpgradeTargets() {
  const missing = missingQuoteSymbols();
  const staticRefs = staticFallbackQuoteSymbols();
  return [...new Set([...missing, ...staticRefs])];
}

function quoteUpgradePollActive() {
  const { total, live } = catalogLiveQuoteStats();
  if (!total) return false;
  return live / total < QUOTE_LIVE_MAJORITY_RATIO || missingQuoteSymbols().length > 0;
}

async function pollQuoteUpgrades({ render = true } = {}) {
  if (!quoteUpgradePollActive()) {
    syncQuoteWarmupHint();
    return;
  }
  const targets = quoteUpgradeTargets();
  if (!targets.length) {
    syncQuoteWarmupHint();
    return;
  }
  markQuoteSymbolsPending(targets);
  if (render) {
    syncQuoteWarmupHint();
    renderMarkets();
  }
  try {
    const data = await fetchCatalogQuotes({ timeoutMs: QUOTE_CATALOG_TIMEOUT_MS });
    applyQuoteBatchToState(data, { render });
    syncQuotesFallbackBanner(data);
    syncQuoteWarmupHint();
    const stillNeeding = quoteUpgradeTargets();
    if (stillNeeding.length) {
      const batch = stillNeeding.slice(0, QUOTE_BATCH_CHUNK_SIZE * 2);
      const retry = await fetchQuotesBatched(batch, { trackPending: true, retryMissing: true });
      applyQuoteBatchToState(retry, { render });
      syncQuoteWarmupHint();
    }
  } catch (error) {
    console.warn("[quotes] live-upgrade poll failed", error);
    bumpQuoteRetryFailures(targets);
    try {
      const retry = await fetchQuotesBatched(targets.slice(0, QUOTE_BATCH_CHUNK_SIZE * 2), {
        trackPending: true,
        retryMissing: true
      });
      applyQuoteBatchToState(retry, { render });
    } catch (retryError) {
      console.warn("[quotes] batched live-upgrade retry failed", retryError);
    }
    syncQuoteWarmupHint();
    if (render) renderMarkets();
  }
}

function startMissingQuotePoll() {
  if (state.missingQuotePollTimer) clearInterval(state.missingQuotePollTimer);
  state.missingQuotePollTimer = setInterval(() => {
    const onMarkets = $("#view-markets")?.classList.contains("active");
    void pollQuoteUpgrades({ render: onMarkets || quoteUpgradePollActive() });
  }, QUOTE_LIVE_UPGRADE_POLL_MS);
}

function billsForSymbol(symbol) {
  return policyBills()
    .filter((bill) => (bill.affected || []).includes(symbol))
    .slice()
    .sort((a, b) => billMomentum(b) - billMomentum(a));
}

function marketsConnectedLinksHtml(row) {
  const sym = row.symbol;
  const parts = [
    `<a class="markets-link-chip" href="${escapeHtml(stockPageUrl(sym))}" onclick="event.stopPropagation()">Trace</a>`
  ];
  if (symbolHasSource(row, "contract")) {
    parts.push(`<a class="markets-link-chip" href="${escapeHtml(contractPageUrl(sym))}" onclick="event.stopPropagation()">Contract</a>`);
  }
  const bills = billsForSymbol(sym);
  if (bills.length) {
    const top = bills[0];
    const label = bills.length === 1 ? "1 bill" : `${bills.length} bills`;
    parts.push(`<a class="markets-link-chip markets-link-chip--bill" href="${escapeHtml(billPageUrl(top))}" onclick="event.stopPropagation()" title="${escapeHtml(top.shortTitle || top.title || "")}">${escapeHtml(label)}</a>`);
  }
  return parts.join("");
}

function marketsSourceBadgesHtml(row) {
  const order = ["contract", "bill", "lobby", "seed", "market", "fundamentals"];
  const seen = new Set();
  const badges = [];
  for (const source of order) {
    if (!symbolHasSource(row, source) || seen.has(source)) continue;
    seen.add(source);
    badges.push(`<span class="symbol-source-badge symbol-source-${escapeHtml(source)}">${escapeHtml(symbolSourceBadgeLabel(source))}</span>`);
  }
  return badges.join("") || `<span class="symbol-source-badge symbol-source-seed">Market</span>`;
}

function marketsQuoteCellHtml(symbol) {
  const quote = quoteFor(symbol);
  if (quoteHasRenderablePrice(quote)) {
    const src = String(quote.source || "").toLowerCase();
    const isStatic = quoteIsStaticFallback(quote);
    const priceHtml = isStatic
      ? `<span class="markets-quote-fallback" title="Static reference price">${money(quote.price)}</span>`
      : money(quote.price);
    const srcBadge = isStatic
      ? `<span class="markets-quote-src markets-quote-src--static" title="Static reference price">ref</span>`
      : src && src !== "unavailable"
        ? `<span class="markets-quote-src markets-quote-src--live" title="${escapeHtml(quoteSourceDisplay(quote.source))}">live</span>`
        : "";
    return `<span class="markets-quote-cell">${priceHtml}${srcBadge}</span>`;
  }
  return `<span class="markets-quote-pending" title="Fetching quote — auto-retry every 60s">Loading…</span>`;
}

function updateMarketsTableMeta() {
  const meta = $("#market-table-meta");
  if (!meta) return;
  const total = marketsCatalogRows().length;
  const rows = filteredMarketsRows();
  const shown = rows.length;
  const filter = state.marketsFilter || "all";
  const label = marketsFilterLabel(filter);
  const focus = state.focusSymbol ? ` · focus ${state.focusSymbol}` : "";
  let live = 0;
  let ref = 0;
  let pending = 0;
  for (const row of rows) {
    const quote = quoteFor(row.symbol);
    if (!quote?.price) pending += 1;
    else if (quote.source === "fallback" || quote.placeholder) ref += 1;
    else live += 1;
  }
  const feedHint = pending ? ` · ${pending} loading` : ref ? ` · ${ref} ref · ${live} live` : ` · ${live} live`;
  meta.textContent = shown === total
    ? `Showing ${shown} symbols · ${label}${focus}${feedHint}`
    : `Showing ${shown} of ${total} · ${label}${focus}${feedHint}`;

  const sourcePill = $("#market-source");
  if (sourcePill) {
    if (pending && !live && !ref) sourcePill.textContent = "Connecting";
    else if (ref && live === 0) sourcePill.textContent = "Reference prices";
    else if (ref && live > 0) sourcePill.textContent = "Mixed feed";
    else sourcePill.textContent = "Live feed";
    sourcePill.classList.toggle("amber", ref > 0);
  }
}

function mergePickerSymbolRows(extra = []) {
  const map = new Map();
  for (const row of tradableSymbolRows()) {
    map.set(row.symbol, { ...row, sources: [...(row.sources || [])] });
  }
  for (const raw of extra) {
    const sym = normalizeWatchSymbol(raw);
    if (!sym || map.has(sym)) continue;
    map.set(sym, { symbol: sym, name: sym, sources: [] });
  }
  return [...map.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function filterPickerSymbolRows(query, extra = []) {
  const q = String(query || "").trim().toUpperCase();
  const rows = mergePickerSymbolRows(extra);
  if (!q) return rows.slice(0, 80);
  return rows
    .filter((row) => row.symbol.includes(q) || String(row.name || "").toUpperCase().includes(q))
    .slice(0, 40);
}

function renderSymbolPickerOptions(rows, { activeSymbol = "" } = {}) {
  if (!rows.length) {
    return `<li class="symbol-combobox-empty" role="option">No matching symbols</li>`;
  }
  return rows
    .map((row) => {
      const badges = (row.sources || [])
        .slice(0, 3)
        .map((source) => `<span class="symbol-source-badge symbol-source-${escapeHtml(source)}">${escapeHtml(symbolSourceBadgeLabel(source))}</span>`)
        .join("");
      const selected = row.symbol === activeSymbol ? ' aria-selected="true"' : "";
      return `<li class="symbol-combobox-option" role="option" data-symbol="${escapeHtml(row.symbol)}"${selected}>
        <span class="symbol-combobox-sym">${escapeHtml(row.symbol)}</span>
        <span class="symbol-combobox-name">${escapeHtml(row.name || row.symbol)}</span>
        <span class="symbol-combobox-badges">${badges}</span>
      </li>`;
    })
    .join("");
}

function pickerExtraSymbols() {
  return [
    ...paperPositionSymbols(),
    ...watchlistRows().map((w) => w.symbol),
    state.activeAnalysisSymbol,
    state.tradeSymbol
  ].filter(Boolean);
}

function setSymbolPickerValue(input, symbol, { notify = true } = {}) {
  if (!input) return;
  const sym = normalizeWatchSymbol(symbol);
  input.value = sym;
  const wrap = input.closest(".symbol-combobox");
  const list = wrap?.querySelector(".symbol-combobox-list");
  if (list) {
    list.innerHTML = renderSymbolPickerOptions(filterPickerSymbolRows(sym, pickerExtraSymbols()), { activeSymbol: sym });
    list.hidden = true;
  }
  if (notify) {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function wireSymbolCombobox(input) {
  if (!input || input.dataset.comboboxReady === "true") return;
  input.dataset.comboboxReady = "true";
  const wrap = input.closest(".symbol-combobox");
  const list = wrap?.querySelector(".symbol-combobox-list");
  if (!list) return;

  const refreshList = (open = true) => {
    const sym = normalizeWatchSymbol(input.value);
    list.innerHTML = renderSymbolPickerOptions(filterPickerSymbolRows(input.value, pickerExtraSymbols()), {
      activeSymbol: sym
    });
    list.hidden = !open;
    input.setAttribute("aria-expanded", open ? "true" : "false");
  };

  input.addEventListener("focus", () => refreshList(true));
  input.addEventListener("input", () => refreshList(true));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      return;
    }
    if (event.key === "Enter") {
      const first = list.querySelector(".symbol-combobox-option[data-symbol]");
      if (first && list.hidden === false) {
        event.preventDefault();
        setSymbolPickerValue(input, first.dataset.symbol);
        list.hidden = true;
      }
    }
  });

  list.addEventListener("mousedown", (event) => {
    const option = event.target.closest(".symbol-combobox-option[data-symbol]");
    if (!option) return;
    event.preventDefault();
    setSymbolPickerValue(input, option.dataset.symbol);
    list.hidden = true;
  });

  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target)) {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
    }
  });

  input.addEventListener("change", () => {
    input.value = normalizeWatchSymbol(input.value);
  });
}

function initSymbolPickers() {
  document.querySelectorAll(".symbol-combobox-input").forEach((input) => wireSymbolCombobox(input));
  populateThesisSymbolDatalist();
}

function populateThesisSymbolDatalist() {
  const list = document.getElementById("thesis-symbol-datalist");
  if (!list) return;
  list.innerHTML = mergePickerSymbolRows(pickerExtraSymbols())
    .slice(0, 120)
    .map((row) => `<option value="${escapeHtml(row.symbol)}">${escapeHtml(row.name || row.symbol)}</option>`)
    .join("");
}

function orderSuccessMessage(response) {
  const order = response?.order || {};
  const sym = String(order.symbol || "").toUpperCase();
  const base = `${String(order.side || "").toUpperCase()} ${order.qty} ${sym} filled at ${money(order.price)}.`;
  const links = [`<a href="${escapeHtml(stockPageUrl(sym))}">Stock brief</a>`];
  const row = tradableSymbolRows().find((item) => item.symbol === sym);
  if (row && symbolHasSource(row, "contract")) {
    links.push(`<a href="/contract/${encodeURIComponent(sym)}">Contract brief</a>`);
  }
  const brokerNote = response.broker === "alpaca_paper" ? " Routed via Alpaca paper API." : "";
  return `${base}${brokerNote} <span class="order-success-links">${links.join(" · ")}</span>`;
}

const LIVE_FEED_INTERVALS = {
  marketMs: 30000,
  cryptoMs: 30000,
  accountMs: 15000,
  policyMs: 300000,
  fecMs: 480000,
  contractsMs: 600000,
  tradeHistoryMs: 12000,
  analysisChartMs: 12000,
  portfolioChartMs: 5000
};

const PAPER_STARTING_CASH = 100000;

const THEME_STORAGE_KEY = "ts_theme";
const READER_MODE_STORAGE_KEY = "ts_reader_mode";
const MARKETS_SUBTAB_KEY = "ts_markets_subtab";

function readerModeCopy(mode) {
  if (mode === "citizen") {
    return {
      buttonHint: "Plain English",
      note: "Citizen mode explains the policy story without market jargon — shorter copy, fewer tickers, and everyday language.",
      title: "Plain English — policy story without market jargon"
    };
  }
  if (mode === "analyst") {
    return {
      buttonHint: "Scores + limits",
      note: "Analyst mode keeps source metadata, confidence scores, and model limits closer to the surface — denser detail with less hand-holding.",
      title: "Scores and limits — source metadata, confidence, and model limits"
    };
  }
  return {
    buttonHint: "Investor context",
    note: "Investor mode uses normal market language: revenue, margins, guidance risk, and expectations — balanced density for everyday investors.",
    title: "Investor context — revenue, margins, guidance risk, and expectations"
  };
}

function updateReaderModeNote(mode) {
  const noteEl = $("#reader-mode-note");
  if (!noteEl) return;
  const copy = readerModeCopy(mode);
  noteEl.textContent = copy.note;
  document.querySelectorAll(".reader-mode-btn").forEach((btn) => {
    const hint = readerModeCopy(btn.dataset.readerMode || "investor");
    btn.setAttribute("title", hint.title);
  });
}

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
  updateReaderModeNote(next);
  if (reload && state.activeAnalysisSymbol && isFeatureEnabled("ANALYSIS_LAB_ENABLED")) {
    loadAnalysis(state.activeAnalysisSymbol);
  }
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
  const catalog = tradableSymbolRows().map((row) => row.symbol);
  return [
    ...new Set([
      ...marketsDefaultSymbols(),
      ...tapeDefaultQuoteSymbols(),
      ...watchlistRows().map((w) => w.symbol),
      ...paperPositionSymbols(),
      state.activeAnalysisSymbol,
      state.tradeSymbol,
      ...marketSymbols(),
      ...catalog
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
  return tradableSymbolRows().some((row) => row.symbol === sym) || marketSymbols().includes(sym) || portfolioTickerSet().has(sym);
}

function populateSymbolSelects() {
  const symbols = mergePickerSymbolRows(pickerExtraSymbols()).map((row) => row.symbol);
  for (const id of ["analysis-symbol", "order-symbol"]) {
    const input = document.getElementById(id);
    if (!input) continue;
    const current = normalizeWatchSymbol(input.value || (id === "analysis-symbol" ? state.activeAnalysisSymbol : state.tradeSymbol));
    setSymbolPickerValue(input, current, { notify: false });
  }
  initSymbolPickers();
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
    const boot = await fetchJson("/api/dashboard/bootstrap");
    state.dashboardBootstrap = boot;
    const userId = state.session?.user?.id;
    const fromStorage = readWatchlistFromStorage(userId);
    let fromDb = [];
    if (!fromStorage?.length) {
      try {
        const wl = await fetchJson("/api/watchlist");
        fromDb = Array.isArray(wl.symbols) ? wl.symbols.map((s) => String(s).toUpperCase()).filter(Boolean) : [];
      } catch (_) {}
    }
    const fromDefault = DEFAULT_WATCHLIST_SYMBOLS.length
      ? DEFAULT_WATCHLIST_SYMBOLS
      : (boot.watchlistDefault || []).map((w) => w.symbol).filter(Boolean);
    const resolved = fromStorage?.length ? fromStorage : fromDb.length ? fromDb : fromDefault;
    state.watchlistSymbols = resolved.map(normalizeWatchSymbol).filter(Boolean);
    if (!fromStorage?.length) writeWatchlistToStorage(state.watchlistSymbols, userId);
    state.feedScope = getFeedScope();
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
    try {
      if (!sessionStorage.getItem(MARKETS_FILTER_STORAGE_KEY) && !localStorage.getItem(MARKETS_FILTER_STORAGE_KEY)) {
        state.marketsFilter = resolveDefaultMarketsFilter();
        const bar = $("#markets-filter-bar");
        bar?.querySelectorAll("[data-markets-filter]").forEach((chip) => {
          chip.classList.toggle("is-active", chip.dataset.marketsFilter === state.marketsFilter);
        });
      }
    } catch (_) {}
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

function billActionTimestamp(bill) {
  const raw = bill?.latestActionDate || bill?.introduced || bill?.updatedAt || "";
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : 0;
}

function sortBillsForTable(bills, mode = state.billSort || "recent") {
  const list = [...(bills || [])];
  if (mode === "momentum") {
    return list.sort((a, b) => billMomentum(b) - billMomentum(a));
  }
  return list.sort((a, b) => billActionTimestamp(b) - billActionTimestamp(a));
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

function billLegislativeContext(bill) {
  return bill?.legislativeContext || null;
}

function billCalendarCellHtml(bill) {
  const ctx = billLegislativeContext(bill);
  if (!ctx?.timelineRows?.length) {
    const date = bill.latestActionDate || "—";
    return `<div class="bill-leg-rail bill-leg-rail--sparse"><span class="bill-leg-date mono">${escapeHtml(date)}</span><span class="bill-leg-detail muted">${escapeHtml((bill.latestAction || "").slice(0, 88))}</span></div>`;
  }
  const vote = ctx.voteWatch || {};
  const voteUrgent = /floor|chamber|cross-chamber/i.test(vote.label || "");
  const rows = [
    { key: "intro", k: "Introduced", v: ctx.introducedLabel || ctx.timelineRows.find((r) => r.key === "introduced")?.value || "—", mono: true },
    { key: "last", k: "Last action", v: ctx.latestActionDate ? formatBillDateShort(ctx.latestActionDate) : "—", sub: (ctx.latestActionText || "").slice(0, 90), mono: true },
    { key: "committee", k: "Committee", v: ctx.committeeSummary || ctx.primaryCommittee || "—", mono: false },
    { key: "vote", k: "Vote timing", v: vote.label || "—", sub: vote.detail ? String(vote.detail).slice(0, 72) : "", tone: voteUrgent ? "watch" : "neutral" }
  ];
  return `
    <div class="bill-leg-rail" role="group" aria-label="Legislative calendar">
      ${rows
        .map(
          (row, i) => `
        <div class="bill-leg-item bill-leg-item--${escapeHtml(row.key)} ${row.tone ? `is-${row.tone}` : ""}" style="--leg-i:${i}">
          <span class="bill-leg-k">${escapeHtml(row.k)}</span>
          <span class="bill-leg-v ${row.mono ? "mono" : ""}">${escapeHtml(row.v)}</span>
          ${row.sub ? `<span class="bill-leg-sub muted">${escapeHtml(row.sub)}${row.sub.length >= 90 ? "…" : ""}</span>` : ""}
        </div>`
        )
        .join("")}
    </div>`;
}

function billLegislativeTimelineBlock(bill) {
  const ctx = billLegislativeContext(bill);
  if (!ctx?.timelineRows?.length) return "";
  const vote = ctx.voteWatch || {};
  const voteUrgent = /floor|chamber|cross-chamber/i.test(vote.label || "");
  const next = ctx.nextMilestone || {};
  const primaryRows = ctx.timelineRows.filter((r) => !["vote", "policy-area"].includes(r.key));
  return `
    <section class="bill-legislative-timeline" aria-labelledby="bill-timeline-heading-${escapeHtml(bill.id).replace(/[^a-zA-Z0-9_-]/g, "")}">
      <div class="bill-timeline-head">
        <div>
          <h4 id="bill-timeline-heading-${escapeHtml(bill.id).replace(/[^a-zA-Z0-9_-]/g, "")}">Legislative calendar</h4>
          <p class="muted bill-timeline-lead">Dates and committee gates Congress actually publishes — not a price forecast.</p>
        </div>
        <span class="bill-timeline-chamber mini-pill">${escapeHtml(bill.chamber || ctx.chamber || "Federal")}</span>
      </div>
      <div class="bill-timeline-layout">
        <div class="bill-timeline-rail">
          ${primaryRows
            .map(
              (row, i) => `
            <article class="bill-timeline-step" style="--step-i:${i}">
              <span class="bill-timeline-step-label">${escapeHtml(row.label)}</span>
              <p class="bill-timeline-step-value">${escapeHtml(row.value)}</p>
              ${row.hint ? `<p class="bill-timeline-step-hint muted">${escapeHtml(row.hint)}</p>` : ""}
            </article>`
            )
            .join("")}
        </div>
        <aside class="bill-timeline-aside">
          <div class="bill-vote-callout${voteUrgent ? " is-urgent" : ""}">
            <span class="mini-label">Vote watch</span>
            <p class="bill-vote-callout-title">${escapeHtml(vote.label || "—")}</p>
            <p class="muted">${escapeHtml(vote.detail || "")}</p>
          </div>
          <div class="bill-next-milestone">
            <span class="mini-label">Next milestone</span>
            <p><strong>${escapeHtml(next.label || "—")}</strong></p>
            <p class="muted">${escapeHtml(next.detail || "")}</p>
          </div>
        </aside>
      </div>
    </section>`;
}

function formatBillDateShort(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function watchForBullets(bill) {
  const ctx = billLegislativeContext(bill);
  if (ctx?.nextMilestone?.label) {
    const items = [
      `${ctx.nextMilestone.label}: ${ctx.nextMilestone.detail}`,
      ctx.voteWatch?.detail,
      ctx.latestActionText ? `Last action (${ctx.latestActionLabel || "recent"}): ${ctx.latestActionText.slice(0, 120)}` : null
    ].filter(Boolean);
    if (items.length) return items.slice(0, 4);
  }
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
  let rows = fromServer.length
    ? fromServer
    : policyBills()
        .map((bill) => bill.catalyst)
        .filter(Boolean)
        .sort((a, b) => Number(b.urgency || 0) - Number(a.urgency || 0));
  if (isWatchlistScope() && !state.focusSymbol) {
    rows = rows.filter((item) => itemMatchesWatchlist(item.tickers || []));
  }
  return rows.slice(0, 6);
}

function renderPolicyCatalysts() {
  const targets = [$("#policy-catalyst-feed"), $("#bill-catalyst-feed")].filter(Boolean);
  if (!targets.length) return;
  const catalysts = catalystCandidates().slice(0, 4);
  const warming = !state.dataMeta.bills?.updatedAt && !catalysts.length;
  if (warming) {
    const skel = `<div class="policy-catalyst-list">${skeletonFeedMarkup(2)}</div>`;
    targets.forEach((target) => {
      target.innerHTML = skel;
    });
    const source = $("#policy-catalyst-source");
    if (source) source.textContent = "Loading…";
    return;
  }
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
    : isWatchlistScope() && !state.focusSymbol
      ? watchlistEmptyStateHtml()
      : `<article class="empty-state">No near-term Congress catalysts loaded yet. Refresh bills or try a ticker filter.</article>`;
  targets.forEach((target) => {
    target.innerHTML = html;
    target.querySelectorAll("[data-feed-scope-set]").forEach((btn) => {
      btn.addEventListener("click", () => setFeedScope(btn.dataset.feedScopeSet || "all"));
    });
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

function billPageUrl(bill) {
  const id = String(bill?.canonicalId || bill?.id || "").trim();
  if (!id) return "/dashboard?view=bills";
  return `/bill/${encodeURIComponent(id)}`;
}

function contractPageUrl(symbol) {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (!sym) return "/dashboard?view=contracts";
  return `/contract/${encodeURIComponent(sym)}`;
}

function lobbyPageUrl(filing) {
  const id = String(filing?.filingId || filing?.id || "").trim();
  if (!id) return "/dashboard?view=lobbying";
  return `/lobby/${encodeURIComponent(id)}`;
}

function fecPageUrl(clusterKey) {
  const key = String(clusterKey || "").trim();
  if (!key) return "/dashboard?view=fec";
  return `/fec/${encodeURIComponent(key)}`;
}

function billSourceUrl(bill) {
  if (bill?.congressUrl) return bill.congressUrl;
  const id = String(bill?.id || "");
  if (bill?.scenarioOnly || id.startsWith("scenario:") || bill?.sourceKind === "tradesimple_scenario") {
    return `https://www.congress.gov/search?q=${encodeURIComponent(bill?.title || bill?.shortTitle || bill?.scenarioId || "market bill")}`;
  }
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
  if (bill?.exactCongressRecord === true) return "Open exact Congress.gov record";
  if (bill?.scenarioOnly || bill?.dataLayer === "scenario") return "Search Congress.gov (scenario topic)";
  return "Search Congress.gov by title";
}

function billSourceNote(bill) {
  if (bill?.exactCongressRecord === true) return "Exact Congress.gov bill record.";
  if (bill?.scenarioOnly) {
    return bill?.sourceNote || "TradeSimple scenario — factual status updates when Congress.gov is linked.";
  }
  return bill?.sourceNote || "Modeled TradeSimple seed. Its internal bill-style ID may not match a real Congress.gov bill number.";
}

function billDisplayLabel(bill) {
  return bill?.displayId || bill?.id || "Bill";
}

function billProvenanceBadge(bill) {
  if (bill?.exactCongressRecord) return { cls: "exact", text: "live · Congress.gov" };
  if (bill?.scenarioOnly || bill?.dataLayer === "scenario") return { cls: "scenario", text: "scenario model" };
  return { cls: "modeled", text: "pending live" };
}

function historicalAnalogHtml(bill) {
  const analog = bill?.historicalAnalog;
  if (!analog?.title) return "";
  const facts = Array.isArray(analog.verifiedFacts) ? analog.verifiedFacts : [];
  const factLinks = facts
    .slice(0, 3)
    .map(
      (f) =>
        `<li><a href="${escapeHtml(f.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(f.claim)}</a></li>`
    )
    .join("");
  return `<div class="bill-historical-block">
    <h4>Verified historical analog</h4>
    <p><strong>${escapeHtml(analog.title)}</strong> — ${escapeHtml(analog.outcome || "")}</p>
    <p class="muted">${escapeHtml(analog.impact || "")}</p>
    ${factLinks ? `<ul class="verified-facts-list">${factLinks}</ul>` : ""}
  </div>`;
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
    if (!isFeatureEnabled("AI_RESEARCH_ENABLED")) return;
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

function setupMarketsWatchToggle() {
  if (document.body.dataset.marketsWatchReady === "true") return;
  document.body.dataset.marketsWatchReady = "true";
  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-watch-toggle]");
    if (btn) {
      event.preventDefault();
      event.stopPropagation();
      toggleWatchlistSymbol(btn.dataset.watchToggle);
      renderMarkets();
      return;
    }
    const row = event.target.closest(".markets-row[data-symbol]");
    if (!row || event.target.closest("a, button, [data-watch-toggle]")) return;
    const sym = row.dataset.symbol;
    if (sym) setFocusSymbol(sym, { render: true });
  });
}

let marketsSearchTimer = null;

function resolveDefaultMarketsFilter() {
  try {
    if (sessionStorage.getItem(MARKETS_FILTER_STORAGE_KEY) || localStorage.getItem(MARKETS_FILTER_STORAGE_KEY)) {
      return getStoredMarketsFilter();
    }
  } catch (_) {}
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
  if (isMobile) return "watchlist";
  return state.watchlistSymbols?.length ? "watchlist" : "all";
}

function isMarketsMobileDeskView() {
  try {
    return sessionStorage.getItem(MARKETS_MOBILE_DESK_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function setMarketsMobileDeskView(enabled) {
  try {
    if (enabled) sessionStorage.setItem(MARKETS_MOBILE_DESK_KEY, "1");
    else sessionStorage.removeItem(MARKETS_MOBILE_DESK_KEY);
  } catch (_) {}
  document.body.classList.toggle("markets-mobile-desk", Boolean(enabled));
  const btn = $("#markets-desk-toggle");
  if (btn) {
    btn.textContent = enabled ? "Card feed" : "Desk view";
    btn.setAttribute("aria-pressed", enabled ? "true" : "false");
  }
}

function syncMarketsDeskToggleVisibility() {
  const btn = $("#markets-desk-toggle");
  if (!btn) return;
  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  btn.hidden = !isMobile;
  if (isMobile) setMarketsMobileDeskView(isMarketsMobileDeskView());
  else document.body.classList.remove("markets-mobile-desk");
}

function setupMarketsDeskToggle() {
  const btn = $("#markets-desk-toggle");
  if (!btn || btn.dataset.bound === "true") return;
  btn.dataset.bound = "true";
  btn.addEventListener("click", () => {
    setMarketsMobileDeskView(!isMarketsMobileDeskView());
    renderMarkets();
  });
  syncMarketsDeskToggleVisibility();
  window.matchMedia("(max-width: 760px)").addEventListener("change", syncMarketsDeskToggleVisibility);
}

function getStoredMarketsSubTab() {
  try {
    const tab = localStorage.getItem(MARKETS_SUBTAB_KEY);
    if (tab === "equities" || tab === "crypto") return tab;
  } catch (_) {}
  return "equities";
}

function applyMarketsSubTab(tab) {
  const next = tab === "crypto" ? "crypto" : "equities";
  state.marketsSubTab = next;
  try {
    localStorage.setItem(MARKETS_SUBTAB_KEY, next);
  } catch (_) {}
  const equitiesPanel = $("#markets-equities-panel");
  const cryptoPanel = $("#markets-crypto-panel");
  if (equitiesPanel) equitiesPanel.hidden = next !== "equities";
  if (cryptoPanel) cryptoPanel.hidden = next !== "crypto";
  document.querySelectorAll("[data-markets-subtab]").forEach((btn) => {
    const active = btn.dataset.marketsSubtab === next;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  renderTabFilterContexts();
}

function setupMarketsSubTabs() {
  const bar = document.querySelector(".markets-sub-tabs");
  if (!bar || bar.dataset.ready === "true") return;
  bar.dataset.ready = "true";
  applyMarketsSubTab(getStoredMarketsSubTab());
  bar.querySelectorAll("[data-markets-subtab]").forEach((btn) => {
    btn.addEventListener("click", () => applyMarketsSubTab(btn.dataset.marketsSubtab));
  });
}

function setupMarketsFilters() {
  const bar = $("#markets-filter-bar");
  if (!bar || bar.dataset.ready === "true") return;
  bar.dataset.ready = "true";
  state.marketsFilter = resolveDefaultMarketsFilter();
  state.marketsSearch = state.focusSymbol || "";
  bar.querySelectorAll("[data-markets-filter]").forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.marketsFilter === state.marketsFilter);
    chip.addEventListener("click", () => {
      const next = chip.dataset.marketsFilter || "all";
      state.marketsFilter = next;
      persistMarketsFilter(next);
      bar.querySelectorAll("[data-markets-filter]").forEach((node) => {
        node.classList.toggle("is-active", node.dataset.marketsFilter === next);
      });
      renderMarkets();
    });
  });
  const search = $("#markets-search");
  if (search) {
    if (state.focusSymbol) search.value = state.focusSymbol;
    search.addEventListener("input", () => {
      if (marketsSearchTimer) clearTimeout(marketsSearchTimer);
      marketsSearchTimer = setTimeout(() => {
        state.marketsSearch = search.value;
        const typed = normalizeWatchSymbol(search.value);
        if (typed && typed.length >= 1 && typed.length <= 6 && isTrackedTicker(typed)) {
          setFocusSymbol(typed, { render: false });
          renderFocusBar();
          renderTabFilterContexts();
        }
        renderMarkets();
      }, 200);
    });
  }
}

function setupFocusBar() {
  $("#ts-focus-clear")?.addEventListener("click", () => clearFocusSymbol());
}

function setupTabFilters() {
  state.billsStageFilter = getStoredTabFilter(BILLS_STAGE_FILTER_KEY, new Set(["all", "floor", "passed"]), "all");
  state.signalsTypeFilter = getStoredTabFilter(SIGNALS_TYPE_FILTER_KEY, new Set(["all", "bills", "contracts", "trending"]), "all");
  state.contractsAgencyFilter = getStoredTabFilter(CONTRACTS_AGENCY_FILTER_KEY, new Set(["all", "dod", "nasa", "dhs"]), "all");
  state.contractsMinAmount = getStoredTabFilter(CONTRACTS_MIN_AMOUNT_KEY, new Set(["0", "1000000", "10000000", "50000000"]), "0");
  try {
    state.lobbyKeyword = sessionStorage.getItem(LOBBY_KEYWORD_KEY) || localStorage.getItem(LOBBY_KEYWORD_KEY) || "";
    state.lobbyTopicFilter = sessionStorage.getItem(LOBBY_TOPIC_KEY) || localStorage.getItem(LOBBY_TOPIC_KEY) || "";
  } catch (_) {
    state.lobbyKeyword = "";
    state.lobbyTopicFilter = "";
  }

  const billsBar = $("#bills-filter-bar");
  if (billsBar && billsBar.dataset.ready !== "true") {
    billsBar.dataset.ready = "true";
    syncFilterChipGroup(billsBar, "data-bills-stage", state.billsStageFilter);
    billsBar.querySelectorAll("[data-bills-stage]").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.billsStageFilter = chip.dataset.billsStage || "all";
        persistTabFilter(BILLS_STAGE_FILTER_KEY, state.billsStageFilter);
        syncFilterChipGroup(billsBar, "data-bills-stage", state.billsStageFilter);
        renderBills();
      });
    });
  }

  const signalsBar = $("#signals-filter-bar");
  if (signalsBar && signalsBar.dataset.ready !== "true") {
    signalsBar.dataset.ready = "true";
    syncFilterChipGroup(signalsBar, "data-signals-filter", state.signalsTypeFilter);
    signalsBar.querySelectorAll("[data-signals-filter]").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.signalsTypeFilter = chip.dataset.signalsFilter || "all";
        persistTabFilter(SIGNALS_TYPE_FILTER_KEY, state.signalsTypeFilter);
        syncFilterChipGroup(signalsBar, "data-signals-filter", state.signalsTypeFilter);
        _trendingDeskExpanded = state.signalsTypeFilter === "trending";
        renderSignalsDesk();
      });
    });
  }

  const contractsBar = $("#contracts-filter-bar");
  if (contractsBar && contractsBar.dataset.ready !== "true") {
    contractsBar.dataset.ready = "true";
    syncFilterChipGroup(contractsBar, "data-contracts-agency", state.contractsAgencyFilter);
    syncFilterChipGroup(contractsBar, "data-contracts-min", state.contractsMinAmount);
    contractsBar.querySelectorAll("[data-contracts-agency]").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.contractsAgencyFilter = chip.dataset.contractsAgency || "all";
        persistTabFilter(CONTRACTS_AGENCY_FILTER_KEY, state.contractsAgencyFilter);
        syncFilterChipGroup(contractsBar, "data-contracts-agency", state.contractsAgencyFilter);
        renderContracts();
        renderContractsTabWatch();
      });
    });
    contractsBar.querySelectorAll("[data-contracts-min]").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.contractsMinAmount = chip.dataset.contractsMin || "0";
        persistTabFilter(CONTRACTS_MIN_AMOUNT_KEY, state.contractsMinAmount);
        syncFilterChipGroup(contractsBar, "data-contracts-min", state.contractsMinAmount);
        renderContracts();
        renderContractsTabWatch();
      });
    });
  }

  const lobbyKeyword = $("#lobby-keyword-filter");
  if (lobbyKeyword && lobbyKeyword.dataset.ready !== "true") {
    lobbyKeyword.dataset.ready = "true";
    lobbyKeyword.value = state.lobbyKeyword || "";
    let lobbyTimer = 0;
    lobbyKeyword.addEventListener("input", () => {
      clearTimeout(lobbyTimer);
      lobbyTimer = setTimeout(() => {
        state.lobbyKeyword = lobbyKeyword.value.trim();
        try {
          sessionStorage.setItem(LOBBY_KEYWORD_KEY, state.lobbyKeyword);
          localStorage.setItem(LOBBY_KEYWORD_KEY, state.lobbyKeyword);
        } catch (_) {}
        renderLobbying();
      }, 200);
    });
  }

  const lobbyBar = $("#lobby-filter-bar");
  if (lobbyBar && lobbyBar.dataset.topicReady !== "true") {
    lobbyBar.dataset.topicReady = "true";
    syncFilterChipGroup(lobbyBar, "data-lobby-topic", state.lobbyTopicFilter || "");
    lobbyBar.querySelectorAll("[data-lobby-topic]").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.lobbyTopicFilter = chip.dataset.lobbyTopic || "";
        try {
          sessionStorage.setItem(LOBBY_TOPIC_KEY, state.lobbyTopicFilter);
          localStorage.setItem(LOBBY_TOPIC_KEY, state.lobbyTopicFilter);
        } catch (_) {}
        syncFilterChipGroup(lobbyBar, "data-lobby-topic", state.lobbyTopicFilter || "");
        renderLobbying();
      });
    });
  }

  $("#trending-more-btn")?.addEventListener("click", () => {
    _trendingDeskExpanded = true;
    renderTrendingSection();
  });
  $("#contract-watch-more-btn")?.addEventListener("click", () => {
    _contractWatchDeskExpanded = true;
    renderContractWatchSection();
  });

  renderTabFilterContexts();
}

function setupWatchlistStripInteraction() {
  const strip = $("#watchlist-strip");
  if (!strip) return;
  if (strip.dataset.interactionReady === "true") return;
  strip.dataset.interactionReady = "true";
  strip.addEventListener("click", (event) => {
    const removeBtn = event.target.closest("[data-watch-remove]");
    if (removeBtn) {
      event.preventDefault();
      event.stopPropagation();
      toggleWatchlistSymbol(removeBtn.dataset.watchRemove);
      return;
    }
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
    const fecBrief = event.target.closest("[data-fec-brief]");
    if (fecBrief) {
      const nested = event.target.closest("a, button, input, select, textarea, label");
      if (nested && nested !== fecBrief) return;
      event.preventDefault();
      window.location.href = fecPageUrl(fecBrief.dataset.fecBrief || "");
      return;
    }
    const target = event.target.closest("[data-drill-action]");
    if (!target) return;
    const nestedControl = event.target.closest("a, button, input, select, textarea, label");
    if (nestedControl && nestedControl !== target) return;
    event.preventDefault();
    activateDrilldown(target.dataset);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const fecBrief = event.target.closest("[data-fec-brief]");
    if (fecBrief && fecBrief === event.target) {
      event.preventDefault();
      window.location.href = fecPageUrl(fecBrief.dataset.fecBrief || "");
      return;
    }
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
  if (action === "signals") return showView("signals");
  if (action === "contracts") return openContractsDrilldown(data.company || data.symbol || "");
  if (action === "source" && data.url) return window.open(data.url, "_blank", "noopener,noreferrer");
  if (action === "view" && data.viewName) return showView(data.viewName);
}

function openTickerAnalysis(symbol) {
  const sym = String(symbol || "").toUpperCase().replace(/[^A-Z.]/g, "");
  if (!sym) return;
  setFocusSymbol(sym, { render: true, syncAnalysis: true });
  if (!isFeatureEnabled("ANALYSIS_LAB_ENABLED")) {
    thesisPrimeTicker(sym);
    return showView("thesis");
  }
  if (!isTrackedTicker(sym)) {
    showView("markets");
    return;
  }
  state.activeAnalysisSymbol = sym;
  const sel = $("#analysis-symbol");
  if (sel) setSymbolPickerValue(sel, sym, { notify: false });
  showView("analysis");
  loadAnalysis(sym);
}

function openTradeForSymbol(symbol, options = {}) {
  const sym = normalizeWatchSymbol(symbol);
  if (!sym) return showView("trade");
  state.tradeSymbol = sym;
  const orderSelect = $("#order-symbol");
  if (orderSelect) setSymbolPickerValue(orderSelect, sym, { notify: false });
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
  if (!isFeatureEnabled("BILLS_EXPLORER_ENABLED")) return showView("thesis");
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
  if (!isFeatureEnabled("CONTRACTS_ANALYZER_ENABLED")) return showView("thesis");
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
    if (event.target.closest("a.bill-page-link, a.bill-page-open")) return;
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
  if (!isFeatureEnabled("CONTRACTS_ANALYZER_ENABLED")) {
    state.contractCache[symbol] = { disabled: true, results: [] };
    return;
  }
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
  quoteFeedError: "",
  marketsQuotesLoading: false,
  marketsCatalogQuotesLoaded: false,
  quotePendingSymbols: new Set(),
  quoteRetryFailures: new Map(),
  missingQuotePollTimer: null,
  byok: {
    provider: null,
    key: null,
    model: null
  },
  analysis: null,
  policyNetwork: null,
  policyCatalysts: [],
  trending: [],
  trendingLoadedAt: null,
  contractWatch: [],
  contractWatchLoadedAt: null,
  contractWatchMeta: null,
  fecPulse: null,
  methodology: null,
  focusSymbol: null,
  billsStageFilter: "all",
  signalsTypeFilter: "all",
  contractsAgencyFilter: "all",
  contractsMinAmount: "0",
  lobbyKeyword: "",
  lobbyTopicFilter: "",
  fecTopicFilter: "",
  lastOrderSymbol: null,
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
  feedScope: null,
  dataHealth: null,
  _symbolFromUrl: false,
  billSort: "recent",
  tradeGuidedMode: null,
  billsGuidedMode: null,
  tradeGuidedStep: 0,
  billsGuidedStep: 0
};

const TRADE_GUIDED_KEY = "ts_trade_guided_mode";
const BILLS_GUIDED_KEY = "ts_bills_guided_mode";
let tradeGuidedShell = null;
let billsGuidedShell = null;

function bumpSessionCount() {
  try {
    const n = Number(localStorage.getItem("ts_session_count") || 0) + 1;
    localStorage.setItem("ts_session_count", String(n));
    return n;
  } catch (_) {
    return 1;
  }
}

function defaultTradeGuidedMode() {
  try {
    const stored = localStorage.getItem(TRADE_GUIDED_KEY);
    if (stored === "full" || stored === "guided") return stored;
    const positions = state.account?.positions?.length || 0;
    if (positions > 0) return "full";
    const visits = Number(localStorage.getItem("ts_session_count") || 0);
    return visits <= 3 ? "guided" : "full";
  } catch (_) {
    return "guided";
  }
}

function defaultBillsGuidedMode() {
  try {
    const sessionMode = sessionStorage.getItem(BILLS_MODE_SESSION_KEY);
    if (sessionMode === "full" || sessionMode === "guided") return sessionMode;
    const stored = localStorage.getItem(BILLS_GUIDED_KEY);
    if (stored === "full" || stored === "guided") return stored;
    const opened = localStorage.getItem("ts_bill_brief_opened");
    return opened ? "full" : "guided";
  } catch (_) {
    return "guided";
  }
}

function seedBillsGuidedModeForNewUsers() {
  try {
    if (sessionStorage.getItem(BILLS_MODE_SESSION_KEY)) return;
    if (localStorage.getItem(BILLS_GUIDED_KEY)) return;
    if (localStorage.getItem("ts_bill_brief_opened")) return;
    sessionStorage.setItem(BILLS_MODE_SESSION_KEY, "guided");
  } catch (_) {}
}

function tradeGuidedMode() {
  if (state.tradeGuidedMode == null) state.tradeGuidedMode = defaultTradeGuidedMode();
  return state.tradeGuidedMode;
}

function billsGuidedMode() {
  if (state.billsGuidedMode == null) state.billsGuidedMode = defaultBillsGuidedMode();
  return state.billsGuidedMode;
}

function persistTradeGuidedMode(mode) {
  state.tradeGuidedMode = BriefShell.persistMode(TRADE_GUIDED_KEY, mode);
  state.tradeGuidedStep = 0;
}

function persistBillsGuidedMode(mode) {
  state.billsGuidedMode = BriefShell.persistMode(BILLS_GUIDED_KEY, mode);
  state.billsGuidedStep = 0;
  try {
    sessionStorage.setItem(BILLS_MODE_SESSION_KEY, mode);
  } catch (_) {}
}

function tradeSymbolUniverse() {
  return mergePickerSymbolRows(pickerExtraSymbols()).map((row) => row.symbol);
}

function tradeSymbolPickerHtml(inputId, selected) {
  const sym = normalizeWatchSymbol(selected);
  return `
    <div class="symbol-combobox symbol-combobox--guided">
      <input type="text" class="symbol-combobox-input dashboard-guided-highlight" id="${escapeHtml(inputId)}" name="symbol" value="${escapeHtml(sym)}" autocomplete="off" spellcheck="false" placeholder="Search symbol…" aria-autocomplete="list" aria-expanded="false" />
      <ul class="symbol-combobox-list" role="listbox" hidden></ul>
    </div>`;
}

function tradeSymbolOptionsHtml(selected) {
  return tradeSymbolPickerHtml("guided-order-symbol-fallback", selected);
}

function topMomentumBill() {
  return policyBills()
    .slice()
    .sort((a, b) => billMomentum(b) - billMomentum(a))[0] || null;
}

function syncTradeBillsGuidedChrome() {
  if (typeof BriefShell === "undefined") return;
  const tradeToggle = $("#trade-mode-toggle");
  const billsToggle = $("#bills-mode-toggle");
  if (tradeToggle) {
    tradeToggle.innerHTML = BriefShell.modeToggleHtml(tradeGuidedMode(), { full: "Full", guided: "Guided" });
    BriefShell.bindModeToggle(tradeToggle, TRADE_GUIDED_KEY, (mode) => {
      persistTradeGuidedMode(mode);
      renderAccount();
    }, tradeGuidedMode);
  }
  if (billsToggle) {
    billsToggle.innerHTML = BriefShell.modeToggleHtml(billsGuidedMode(), { full: "Full", guided: "Guided" });
    BriefShell.bindModeToggle(billsToggle, BILLS_GUIDED_KEY, (mode) => {
      persistBillsGuidedMode(mode);
      renderBills();
    }, billsGuidedMode);
  }
}

function buildTradeGuidedSteps() {
  const account = state.account?.account || {};
  const cash = money(Number(account.cash || account.buyingPower || 0));
  const equity = money(Number(account.equity || 0));
  const positions = state.account?.positions || [];
  const symbol = state.tradeSymbol;
  const bill = policyBills().find((item) => (item.affected || []).includes(symbol));
  const steps = [
    {
      id: "account",
      title: "Paper account",
      sectionRef: "Simulated cash",
      html: `
        <h2 class="bill-step-title">Your paper account</h2>
        <p class="bill-guided-lede">Every TradeSimple user starts with <strong>$100,000</strong> of simulated cash. Nothing here touches real money or a real brokerage.</p>
        <div class="trade-guided-account-grid">
          <div class="trade-guided-account-cell"><span>Liquid cash</span><strong>${cash}</strong></div>
          <div class="trade-guided-account-cell"><span>Total equity</span><strong>${equity}</strong></div>
        </div>
        <p class="dossier-redaction mono">Paper trading only · not investment advice</p>`
    },
    {
      id: "ticker",
      title: "Pick a ticker",
      sectionRef: "Symbol search",
      html: `
        <h2 class="bill-step-title">Pick a ticker to practice with</h2>
        <p class="bill-guided-lede">Choose a stock symbol tied to policy signals you are tracking. Quotes fill at the latest simulated price.</p>
        <form class="trade-guided-form" id="guided-pick-form">
          <label>Symbol
            ${tradeSymbolPickerHtml("guided-order-symbol", symbol)}
          </label>
        </form>
        <p class="muted bill-guided-note">Try SPCX, PLTR, LMT, NVDA, or search the full policy-linked catalog.</p>`
    },
    {
      id: "order",
      title: "Place an order",
      sectionRef: "Paper ticket",
      html: `
        <h2 class="bill-step-title">Place a paper order</h2>
        <p class="bill-guided-lede">Pick a side, enter a share quantity, and submit. The fill uses the latest quote in your simulated account.</p>
        <form class="trade-guided-form" id="guided-order-form">
          <label>Symbol
            ${tradeSymbolPickerHtml("guided-order-symbol-ticket", symbol)}
          </label>
          <label>Quantity
            <input name="qty" id="guided-order-qty" type="number" min="0.0001" step="0.0001" value="1" />
          </label>
          <label>Side
            <select name="side" id="guided-order-side"><option value="buy">Buy</option><option value="sell">Sell</option></select>
          </label>
          <button class="button button-primary" type="submit">Place paper order</button>
        </form>
        <pre class="order-result" id="guided-order-result">No order submitted yet.</pre>
        <p class="muted bill-guided-note">This does not send real money or real shares anywhere.</p>`
    },
    {
      id: "position",
      title: "Your position",
      sectionRef: "Holdings check",
      html: `
        <h2 class="bill-step-title">Your paper position</h2>
        ${positions.length
          ? `<p class="bill-guided-lede">You own ${positions.length} simulated ${positions.length === 1 ? "position" : "positions"}. Marks update with live quotes.</p>
            <div class="table-wrap">
              <table class="terminal-table terminal-table--positions">
                <thead><tr><th>Symbol</th><th class="num">Qty</th><th class="num">Value</th><th class="num">P/L</th></tr></thead>
                <tbody>${positions
                  .map(
                    (p) =>
                      `<tr><td>${escapeHtml(p.symbol)}</td><td class="num">${fmt(p.qty)}</td><td class="num">${money(p.marketValue)}</td><td class="num ${p.unrealizedPnl >= 0 ? "up" : "down"}">${money(p.unrealizedPnl)}</td></tr>`
                  )
                  .join("")}</tbody>
              </table>
            </div>`
          : `<div class="guided-empty-state"><strong>No positions yet.</strong> Place a paper buy on the previous step — you still have ${cash} of simulated cash.</div>`}
        <p class="muted bill-guided-note">Positions are stored in your isolated demo account.</p>`
    },
    {
      id: "cta",
      title: "Next step",
      sectionRef: "Continue research",
      html: `
        <h2 class="bill-step-title">What to do next</h2>
        <p class="bill-guided-lede">Connect your paper trade to the policy story — track a thesis or open the bill brief behind this ticker.</p>
        <div class="bill-guided-cta">
          <a class="card-button bill-cta-primary" href="/dashboard?view=thesis">Track a thesis</a>
          <a class="brief-trace-cta" href="${escapeHtml(publicStockCardUrl(symbol))}">Trace ${escapeHtml(symbol)} →</a>
          ${bill
            ? `<a class="card-button ghost" href="${escapeHtml(billPageUrl(bill))}">Explore related bill</a>`
            : `<a class="card-button ghost" href="/dashboard?view=bills">Explore bills</a>`}
          <button type="button" class="card-button ghost" data-trade-guided-full>Switch to full account view</button>
        </div>`
    }
  ];
  return steps;
}

function buildBillsGuidedSteps() {
  const top = policyBills()
    .slice()
    .sort((a, b) => billMomentum(b) - billMomentum(a))
    .slice(0, 2);
  const leadBill = top[0] || null;
  const alertHtml = top.length
    ? `<div class="bill-alert-cards">${top.map((bill) => legisAlertCard(bill, { compact: true })).join("")}</div>`
    : `<div class="guided-empty-state"><strong>No alerts yet.</strong> High-momentum bills appear here once the policy feed loads.</div>`;
  return [
    {
      id: "tracks",
      title: "What we track",
      sectionRef: "Policy to markets",
      html: `
        <h2 class="bill-step-title">What TradeSimple tracks</h2>
        <p class="bill-guided-lede">Congressional bills, lobbying filings, and federal contracts — mapped to publicly traded tickers in plain English, before headlines.</p>
        <p class="dossier-redaction mono">Research context · not investment advice</p>`
    },
    {
      id: "alerts",
      title: "Momentum alerts",
      sectionRef: "High-momentum bills",
      html: `
        <h2 class="bill-step-title">High-momentum alerts</h2>
        <p class="bill-guided-lede">These are the top tracked bills by legislative momentum right now.</p>
        ${alertHtml}`
    },
    {
      id: "filter",
      title: "Filter bills",
      sectionRef: "Sort and search",
      html: `
        <h2 class="bill-step-title">How to filter the table</h2>
        <p class="bill-guided-lede">Use the search box to filter by ticker, title, or issue. Sort by recency or momentum — no interaction required on this step.</p>
        <div class="bills-guided-filter-hint dashboard-guided-panel">
          <div class="filter-row dashboard-guided-highlight">
            <input placeholder="Filter bills by ticker, title, or issue" disabled value="" />
            <label class="filter-select-wrap">
              <span class="sr-only">Sort bills</span>
              <select disabled aria-label="Sort bills"><option>Most recent first</option></select>
            </label>
            <button class="button button-secondary compact" type="button" disabled>Clear</button>
          </div>
        </div>`
    },
    {
      id: "open",
      title: "Open a bill",
      sectionRef: "Guided brief",
      html: `
        <h2 class="bill-step-title">Open a bill brief</h2>
        <p class="bill-guided-lede">${leadBill
          ? `Start with <strong>${escapeHtml(leadBill.shortTitle || leadBill.title)}</strong> — momentum ${billMomentum(leadBill)}/100. The guided brief walks through status, market impact, and what to watch.`
          : "Once bills load, open any row to launch the guided public brief."}</p>
        <div class="bill-guided-cta">
          ${leadBill
            ? `<a class="card-button bill-cta-primary" href="${escapeHtml(billPageUrl(leadBill))}">Open ${escapeHtml(billDisplayLabel(leadBill))} brief</a>`
            : ""}
          <button type="button" class="card-button ghost" data-bills-guided-full>Switch to full bills table</button>
        </div>`
    }
  ];
}

function wireTradeGuidedExtras() {
  const pick = $("#guided-order-symbol");
  const ticket = $("#guided-order-symbol-ticket");
  initSymbolPickers();
  const syncPickers = (sym) => {
    state.tradeSymbol = sym;
    if (pick) setSymbolPickerValue(pick, sym, { notify: false });
    if (ticket) setSymbolPickerValue(ticket, sym, { notify: false });
    const main = $("#order-symbol");
    if (main) setSymbolPickerValue(main, sym, { notify: false });
    loadTradeHistory(sym, state.tradeRange);
  };
  if (pick) {
    setSymbolPickerValue(pick, state.tradeSymbol, { notify: false });
    pick.addEventListener("change", () => syncPickers(normalizeWatchSymbol(pick.value)));
  }
  if (ticket && !ticket.dataset.wired) {
    ticket.dataset.wired = "1";
    setSymbolPickerValue(ticket, state.tradeSymbol, { notify: false });
    ticket.addEventListener("change", () => syncPickers(normalizeWatchSymbol(ticket.value)));
  }
  const form = $("#guided-order-form");
  if (form && !form.dataset.wired) {
    form.dataset.wired = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = new FormData(form);
      const result = $("#guided-order-result");
      if (result) result.textContent = "Submitting paper order...";
      try {
        const response = await fetchJson("/api/trading/orders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            symbol: payload.get("symbol"),
            qty: payload.get("qty"),
            side: payload.get("side"),
            ...(state.pendingThesisId ? { thesisId: state.pendingThesisId } : {})
          })
        });
        state.account = response;
        if (result) {
          result.innerHTML = orderSuccessMessage(response);
        }
        renderAccount();
      } catch (error) {
        if (result) result.textContent = "Paper order rejected. Check the symbol and quantity.";
      }
    });
  }
  document.querySelectorAll("[data-trade-guided-full]").forEach((btn) => {
    btn.addEventListener("click", () => {
      persistTradeGuidedMode("full");
      renderAccount();
    });
  });
}

function wireBillsGuidedExtras() {
  document.querySelectorAll("[data-bills-guided-full]").forEach((btn) => {
    btn.addEventListener("click", () => {
      persistBillsGuidedMode("full");
      renderBills();
    });
  });
}

function renderTradeGuided() {
  const host = $("#trade-guided-root");
  const full = $("#trade-full-root");
  if (!host || !full) return;
  if (typeof BriefShell === "undefined") {
    host.hidden = true;
    full.hidden = false;
    return;
  }
  syncTradeBillsGuidedChrome();
  const fundsPanel = $("#hypothetical-funds-fold") || $("#hypothetical-funds-panel");
  if (tradeGuidedMode() !== "guided") {
    host.hidden = true;
    full.hidden = false;
    if (fundsPanel) fundsPanel.hidden = false;
    if (tradeGuidedShell) BriefShell.detachWalkthrough(tradeGuidedShell);
    return;
  }
  if (fundsPanel) fundsPanel.hidden = true;
  host.hidden = false;
  full.hidden = true;
  const steps = buildTradeGuidedSteps();
  if (state.tradeGuidedStep >= steps.length) state.tradeGuidedStep = 0;
  if (tradeGuidedShell) BriefShell.detachWalkthrough(tradeGuidedShell);
  tradeGuidedShell = {
    prefix: "trade",
    escapeHtml,
    labels: { full: "Full", guided: "Guided", lastNext: "Done", next: "Continue", back: "← Back" },
    getMode: () => "guided",
    getSteps: () => steps,
    getStepIndex: () => state.tradeGuidedStep,
    setStepIndex: (i) => {
      state.tradeGuidedStep = i;
    },
    isActive: () => tradeGuidedMode() === "guided" && $("#view-trade")?.classList.contains("active"),
    onLastStepNext: () => {
      persistTradeGuidedMode("full");
      renderAccount();
    },
    onStepChange: (index) => {
      if (index === 2 || index === 3) wireTradeGuidedExtras();
    }
  };
  host.innerHTML = BriefShell.renderGuidedArticle({
    mode: "guided",
    steps,
    stepIndex: state.tradeGuidedStep,
    prefix: "trade",
    escapeHtml,
    shellClass: "bill-guided dashboard-guided-shell",
    labels: tradeGuidedShell.labels,
    showModeToggle: false
  });
  BriefShell.attachWalkthrough(tradeGuidedShell);
  wireTradeGuidedExtras();
}

function renderBillsGuided() {
  const host = $("#bills-guided-root");
  const full = $("#bills-full-root");
  if (!host || !full) return;
  if (typeof BriefShell === "undefined") {
    host.hidden = true;
    full.hidden = false;
    return;
  }
  syncTradeBillsGuidedChrome();
  if (billsGuidedMode() !== "guided") {
    host.hidden = true;
    full.hidden = false;
    if (billsGuidedShell) BriefShell.detachWalkthrough(billsGuidedShell);
    return;
  }
  host.hidden = false;
  full.hidden = true;
  const steps = buildBillsGuidedSteps();
  if (state.billsGuidedStep >= steps.length) state.billsGuidedStep = 0;
  if (billsGuidedShell) BriefShell.detachWalkthrough(billsGuidedShell);
  billsGuidedShell = {
    prefix: "bills",
    escapeHtml,
    labels: { full: "Full", guided: "Guided", lastNext: "Open bill brief", next: "Continue", back: "← Back" },
    getMode: () => "guided",
    getSteps: () => steps,
    getStepIndex: () => state.billsGuidedStep,
    setStepIndex: (i) => {
      state.billsGuidedStep = i;
    },
    isActive: () => billsGuidedMode() === "guided" && $("#view-bills")?.classList.contains("active"),
    onLastStepNext: () => {
      const lead = topMomentumBill();
      if (lead) window.location.href = billPageUrl(lead);
      else persistBillsGuidedMode("full");
      renderBills();
    }
  };
  host.innerHTML = BriefShell.renderGuidedArticle({
    mode: "guided",
    steps,
    stepIndex: state.billsGuidedStep,
    prefix: "bills",
    escapeHtml,
    shellClass: "bill-guided dashboard-guided-shell",
    labels: billsGuidedShell.labels,
    showModeToggle: false
  });
  BriefShell.attachWalkthrough(billsGuidedShell);
  wireBillsGuidedExtras();
}

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
  });

  const sessionLink = document.querySelector("[data-session-link]");
  if (session?.user) {
    sessionLink.textContent = "Open terminal";
    sessionLink.href = "/dashboard?view=home";
  } else if (config.auth.demo) {
    sessionLink.textContent = "Try demo terminal";
    sessionLink.href = "/auth/demo?next=/dashboard%3Fview%3Dhome";
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
  bumpSessionCount();
  seedBillsGuidedModeForNewUsers();
  const params = new URLSearchParams(window.location.search);
  markOnboardingCompleteFromUrl(params);
  const initialSymbol = String(params.get("symbol") || "").toUpperCase().replace(/[^A-Z.]/g, "");
  if (initialSymbol) state._symbolFromUrl = true;

  try {
    state.account = await fetchJson("/api/trading/account");
  } catch (e) {
    console.warn("[init] trading account prefetch failed", e);
  }
  state.tradeGuidedMode = defaultTradeGuidedMode();
  state.billsGuidedMode = defaultBillsGuidedMode();

  setupNavigation();
  setupDashboardDrilldowns();
  setupForms();
  setupFilters();
  setupAnalysisControls();
  setupTradeControls();
  setupRefreshAllControl();
  setupDashPolishControls();
  setupMethodologyModal();
  setupOnboardingModal();
  setupAppConfirmModal();
  setupAnalysisTabs();
  initMoneyTrailClose();
  setupAnalysisTickerAi();
  setupAnalysisLobbyBillJump();
  setupWatchlistStripInteraction();
  setupMarketsWatchToggle();
  setupMarketsSubTabs();
  setupMarketsFilters();
  setupMarketsDeskToggle();
  setupFocusBar();
  setupTabFilters();
  setupFeedHealthDrawer();
  setupMobileBottomNav();
  setupDashChromeMetrics();
  setupClassbarScrollHide();
  setupGuidedDemo();
  setupSinceLastVisit();
  setupFeedScopeToggle();
  setupWatchlistPromptModal();
  setupPullToRefresh();
  setupFecControls();
  setupFecDetailDrawer();
  setupBillsFeedInteraction();
  setupAnalysisBillsInteraction();
  setupSignalChainInteraction();
  setupLegisCardDelegation();
  setupTrackRecordTabs();
  if (isFeatureEnabled("FUNDS_HYPOTHETICALS_ENABLED")) setupHypotheticalFunds();

  const [config, session] = await Promise.all([fetchJson("/api/config"), fetchJson("/api/session")]);
  if (await redirectToOnboardingIfNeeded(session, params)) return;
  syncFeatureGatesFromConfig(config);
  applyFeatureGateVisibility();
  if (isFeatureEnabled("AI_RESEARCH_ENABLED")) setupResearchDrawer();
  if (isFeatureEnabled("FUNDS_HYPOTHETICALS_ENABLED")) setupHypotheticalFunds();
  state.config = config;
  state.session = session;
  renderDashTelemetryStrip();
  if (!window.__dashTelemetryTimer) {
    window.__dashTelemetryTimer = setInterval(renderDashTelemetryStrip, 1000);
  }
  loadByokFromStorage();
  renderSession();
  renderConnections();

  await loadDashboardBootstrap();
  await loadDataHealth();
  thesisSyncIntakeState();

  const storedFocus = getStoredFocusSymbol();
  const focusSym = initialSymbol || storedFocus;
  if (focusSym) {
    setFocusSymbol(focusSym, { persist: Boolean(initialSymbol), render: false, syncAnalysis: true });
  }
  if (initialSymbol && !isOnWatchlist(initialSymbol)) {
    setWatchlistSymbols([...state.watchlistSymbols, initialSymbol], { persist: true });
  }
  if (initialSymbol) {
    state.activeAnalysisSymbol = initialSymbol;
    state.tradeSymbol = initialSymbol;
    thesisPrimeTicker(initialSymbol);
    const analysisSelect = $("#analysis-symbol");
    if (analysisSelect) setSymbolPickerValue(analysisSelect, initialSymbol, { notify: false });
    const orderSelect = $("#order-symbol");
    if (orderSelect) setSymbolPickerValue(orderSelect, initialSymbol, { notify: false });
  }
  renderFocusBar();
  renderMobileContextBar();
  syncResearchFabLabel();
  renderTabFilterContexts();
  renderBookSummaryHeader();
  renderFeedScopeToggle();

  initGuidedDemoSession(session);

  const isDemo = isDemoSession(session);
  const hasViewParam = Boolean(params.get("view"));
  const defaultView = isDemo && !hasViewParam ? "overview" : isViewEnabled("thesis") ? "thesis" : "overview";
  const rawView = params.get("view") || defaultView;
  const requestedView = rawView === "home" ? "overview" : rawView;
  const initialView = isViewEnabled(requestedView) ? requestedView : disabledFeatureFallbackView();
  showView(initialView, false);
  if (isDemo && initialView === "overview") renderMorningBrief();

  if (params.get("welcome") === "1") {
    openOnboardingModal({ force: true });
    params.delete("welcome");
    const clean = params.toString();
    window.history.replaceState(
      {},
      "",
      clean ? `${window.location.pathname}?${clean}` : window.location.pathname
    );
  }

  await Promise.allSettled([
    refreshTerminalData(),
    isFeatureEnabled("ANALYSIS_LAB_ENABLED") ? loadAnalysis(state.activeAnalysisSymbol) : Promise.resolve(),
    loadTradeHistory(state.tradeSymbol, state.tradeRange)
  ]);
  if (isFeatureEnabled("CONTRACTS_ANALYZER_ENABLED")) void refreshContractsFeed();
  renderSinceLastVisitStrip();
  if (isDemo && initialView === "overview") maybeScrollDemoMorningBrief();
  maybeOpenWatchlistPrompt();
  setupEdgarControls();
  startLiveFeeds();
}

function startLiveFeeds() {
  state.feedTimers.forEach((timer) => clearInterval(timer));
  state.feedTimers = [
    setInterval(() => runFeed("market", refreshMarketFeed), LIVE_FEED_INTERVALS.marketMs),
    setInterval(() => runFeed("account", refreshAccountFeed), LIVE_FEED_INTERVALS.accountMs),
    setInterval(() => runFeed("policy", refreshPolicyFeed), LIVE_FEED_INTERVALS.policyMs),
    setInterval(() => runFeed("fec", refreshFecPulse), LIVE_FEED_INTERVALS.fecMs),
    setInterval(() => runFeed("trending", refreshTrendingFeed), LIVE_FEED_INTERVALS.policyMs),
    setInterval(() => runFeed("contractWatch", refreshContractWatchFeed), LIVE_FEED_INTERVALS.contractsMs),
    setInterval(() => runFeed("tradeHistory", refreshActiveTradeHistory), LIVE_FEED_INTERVALS.tradeHistoryMs),
    setInterval(() => runFeed("analysisChart", refreshActiveAnalysisChart), LIVE_FEED_INTERVALS.analysisChartMs),
    setInterval(() => runFeed("portfolioChart", refreshPortfolioChartLive), LIVE_FEED_INTERVALS.portfolioChartMs)
  ].filter(Boolean);
  if (isFeatureEnabled("CRYPTO_TRACKER_ENABLED")) {
    state.feedTimers.push(setInterval(() => runFeed("crypto", refreshCryptoFeed), LIVE_FEED_INTERVALS.cryptoMs));
  }
  if (isFeatureEnabled("CONTRACTS_ANALYZER_ENABLED")) {
    state.feedTimers.push(setInterval(() => runFeed("contracts", refreshContractsFeed), LIVE_FEED_INTERVALS.contractsMs));
  }
  startMissingQuotePoll();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      runFeed("resume", async () => {
        const tasks = [
          refreshMarketFeed(),
          refreshAccountFeed(),
          refreshPolicyFeed(),
          refreshFecPulse(),
          refreshTrendingFeed(),
          refreshContractWatchFeed()
        ];
        if (isFeatureEnabled("CRYPTO_TRACKER_ENABLED")) tasks.push(refreshCryptoFeed());
        await Promise.allSettled(tasks);
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
    updatedAt: payload.updatedAt || new Date().toISOString(),
    dataMode: payload.dataMode || "",
    liveBillCount: payload.liveBillCount,
    scenarioBillCount: payload.scenarioBillCount
  };
}

async function loadDataHealth() {
  try {
    state.dataHealth = await fetchJson("/api/health/data");
  } catch (e) {
    console.warn("[data-health] load failed", e);
    state.dataHealth = null;
  }
  renderSystemStatusChrome();
}

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
      height: 132,
      compact: true,
      hideYLabels: true,
      animateIn: true,
      emptyMessage,
      formatMoney: money,
      formatDate: formatPointDate,
      liveLabel: ""
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
  const universe = quoteSymbolUniverse();
  const hot = hotQuoteSymbols();
  const deferred = universe.filter((symbol) => !hot.includes(symbol));

  const applyBatch = (data) => applyQuoteBatchToState(data, { render });

  const data = await fetchQuotesBatched(hot, {
    onChunk: (partial) => applyBatch(partial)
  });
  applyBatch(data);

  if (deferred.length) {
    markQuoteSymbolsPending(deferred);
    void fetchQuotesBatched(deferred, {
      onChunk: (partial) => applyBatch(partial)
    })
      .then((secondary) => {
        applyBatch(secondary);
        deferred.forEach((symbol) => {
          if (quoteHasRenderablePrice(quoteFor(symbol))) clearQuoteSymbolPending(symbol);
        });
        if (render) renderMarkets();
      })
      .catch((error) => {
        console.warn("[market] deferred quotes fetch failed", error);
        state.quoteFeedError = "Live quotes partially unavailable — tap Refresh to retry.";
        if (render) {
          renderSourceBadges();
          renderMarkets();
        }
      });
  }

  if (!render && $("#view-overview")?.classList.contains("active") && state.account) {
    recordPortfolioEquitySnapshot(state.account);
    renderPortfolioChart();
  }
  return data;
}

async function refreshCryptoFeed({ render = true } = {}) {
  if (!isFeatureEnabled("CRYPTO_TRACKER_ENABLED")) {
    state.crypto = [];
    return { assets: [], source: "feature_disabled" };
  }
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
    isFeatureEnabled("LOBBYING_EXPLORER_ENABLED")
      ? fetchJson("/api/lobbying")
      : Promise.resolve({ filings: [], source: "feature_disabled", updatedAt: new Date().toISOString() })
  ]);
  state.bills = bills.bills || [];
  window._policyBillsForByok = state.bills || [];
  state.policyCatalysts = bills.catalysts || [];
  state.lobbying = lobbying.filings || [];
  rememberFeedMeta("bills", bills, bills.source || "bills");
  rememberFeedMeta("lobbying", lobbying, lobbying.source || "lobbying");
  renderSystemStatusChrome();
  if (render) {
    renderSourceBadges();
    renderOverview();
    renderSignalsDesk();
    if (isFeatureEnabled("BILLS_EXPLORER_ENABLED")) renderBills();
    populateFundBillPicker();
    if (isFeatureEnabled("LOBBYING_EXPLORER_ENABLED")) renderLobbying();
    if (state.analysis) renderAnalysis();
  }
  return { bills, lobbying };
}

async function refreshFecPulse({ render = true, force = false } = {}) {
  try {
    const data = await fetchJson(`/api/fec/pulse${force ? "?refresh=1" : ""}`);
    state.fecPulse = data;
    rememberFeedMeta("fec", data, data.source || "fec");
    if (render) {
      renderSourceBadges();
      renderFecPulseStrip();
      renderFecView();
      renderOverview();
      renderSignalsDesk();
      renderBillStakeholders();
      renderMorningBrief();
      renderSinceLastVisitStrip();
    }
    return data;
  } catch (err) {
    console.warn("[fec] pulse unavailable", err);
    return null;
  }
}

function fecLinkCountSummary(pulse) {
  const counts = pulse?.linkCounts || {};
  const parts = [];
  if (counts.bills) parts.push(`${counts.bills} bill${counts.bills === 1 ? "" : "s"}`);
  if (counts.lobbyingFilings) parts.push(`${counts.lobbyingFilings} lobby filing${counts.lobbyingFilings === 1 ? "" : "s"}`);
  if (counts.contracts) parts.push(`${counts.contracts} contract${counts.contracts === 1 ? "" : "s"}`);
  if (counts.tickers) parts.push(`${counts.tickers} ticker${counts.tickers === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function renderFecLinkChips(pulse, { compact = false } = {}) {
  const counts = pulse?.linkCounts || {};
  const chips = [];
  if (counts.bills) chips.push({ label: `${counts.bills} bill${counts.bills === 1 ? "" : "s"}`, kind: "bill" });
  if (counts.lobbyingFilings) chips.push({ label: `${counts.lobbyingFilings} lobby`, kind: "lobby" });
  if (counts.contracts) chips.push({ label: `${counts.contracts} contract${counts.contracts === 1 ? "" : "s"}`, kind: "contract" });
  if (counts.tickers) chips.push({ label: `${counts.tickers} ticker${counts.tickers === 1 ? "" : "s"}`, kind: "ticker" });
  if (!chips.length) return "";
  return `<div class="link-chip-row${compact ? " link-chip-row--compact" : ""}" aria-label="Linked entities">${chips
    .map((chip) => `<span class="link-chip link-chip--${escapeHtml(chip.kind)}">${escapeHtml(chip.label)}</span>`)
    .join("")}</div>`;
}

function renderProvenanceLine(text) {
  if (!text) return "";
  return `<p class="provenance-line muted">${escapeHtml(text)}</p>`;
}

function renderExplainabilitySection(title, rows, { idKey = "id", labelKey = "title", actionAttr = null } = {}) {
  if (!rows?.length) {
    return `<section class="explain-panel-section"><h4>${escapeHtml(title)}</h4><p class="muted">No explicit links in map yet.</p></section>`;
  }
  return `
    <section class="explain-panel-section">
      <h4>${escapeHtml(title)}</h4>
      <ul class="explain-link-list">
        ${rows
          .map((row) => {
            const label = row[labelKey] || row.symbol || row.client || row.recipient || row.id;
            const action = actionAttr && row[idKey]
              ? ` data-${actionAttr}="${escapeHtml(String(row[idKey]))}" role="button" tabindex="0"`
              : "";
            return `<li class="explain-link-item"${action}>
              <span class="explain-link-label">${escapeHtml(label)}</span>
              ${renderProvenanceLine(row.linkReason)}
            </li>`;
          })
          .join("")}
      </ul>
    </section>`;
}

const FEC_TOPIC_FILTERS = {
  defense: ["defense", "national security", "military", "foreign affairs", "ndaa", "armed"],
  energy: ["energy", "climate", "utilities", "telecom", "grid", "oil", "gas"],
  finance: ["banking", "finance", "financial", "fintech", "payments", "capital", "stablecoin"],
  health: ["health", "pharma", "medicare", "medicaid", "drug", "hospital"],
  tech: ["tech", "semiconductor", "ai", "cyber", "software", "digital", "chips"]
};

function fecSourceBadge(source) {
  const isLive = source === "fec";
  return {
    label: isLive ? "Live FEC" : "Sample FEC",
    className: isLive ? "green" : "amber"
  };
}

function fecPulseMatchesTopic(pulse, topic) {
  if (!topic) return true;
  const keywords = FEC_TOPIC_FILTERS[topic] || [];
  const haystack = [
    ...(pulse.policyTags || []),
    pulse.label,
    pulse.committee,
    pulse.plainEnglish,
    pulse.clusterKey
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return keywords.some((kw) => haystack.includes(kw));
}

function filteredFecPulses() {
  const topic = state.fecTopicFilter || "";
  const pulses = state.fecPulse?.pulses || [];
  return pulses.filter((pulse) => {
    if (!fecPulseMatchesTopic(pulse, topic)) return false;
    if (state.focusSymbol) return (pulse.tickers || []).map(normalizeWatchSymbol).includes(state.focusSymbol);
    if (isWatchlistScope()) return itemMatchesWatchlist(pulse.tickers || []);
    return true;
  });
}

function renderFecPulseStrip() {
  const strip = $("#fec-pulse-strip");
  const inner = $("#fec-pulse-strip-inner");
  if (!strip || !inner) return;
  const payload = state.fecPulse;
  const filtered = filteredFecPulses();
  if (!filtered.length) {
    strip.hidden = true;
    return;
  }
  const top = filtered[0];
  const badge = fecSourceBadge(payload.source);
  strip.hidden = false;
  inner.innerHTML = `
    <article class="fec-pulse-card intel-card intel-card--fec">
      <div class="fec-pulse-head">
        <span class="mini-pill ${badge.className}">${escapeHtml(badge.label)}</span>
        <span class="fec-pulse-committee">${escapeHtml(top.committee || "Committee")} · ${escapeHtml(top.chamber || "")}</span>
      </div>
      <p class="fec-pulse-line">${escapeHtml(top.plainEnglish || top.label || "")}</p>
      ${renderFecLinkChips(top, { compact: true })}
      ${signalScanLineHtml({ source: "FEC", date: top.filingDate, tickers: top.tickers, band: top.period || payload.cycle })}
      <div class="fec-pulse-actions">
        <a class="link-button" href="${escapeHtml(fecPageUrl(top.clusterKey || top.committee))}">Read brief →</a>
        <button type="button" class="link-button" data-view-jump="fec">View all filings →</button>
        <button type="button" class="link-button" data-view-jump="signals">Signals →</button>
        ${top.fecUrl ? `<a class="link-button" href="${escapeHtml(top.fecUrl)}" target="_blank" rel="noopener noreferrer">FEC.gov →</a>` : ""}
      </div>
    </article>`;
}

function renderFecView() {
  const feedEl = $("#fec-feed");
  const emptyEl = $("#fec-feed-empty");
  const sourceEl = $("#fec-source");
  const badgeEl = $("#fec-data-badge");
  const payload = state.fecPulse;
  const badge = fecSourceBadge(payload?.source || "sample");
  if (sourceEl) {
    sourceEl.textContent = badge.label;
    sourceEl.classList.toggle("source-live", badge.className === "green");
    sourceEl.classList.toggle("source-fallback", badge.className === "amber");
  }
  if (badgeEl) {
    badgeEl.textContent = badge.label;
    badgeEl.className = `mini-pill ${badge.className}`;
  }
  if (!feedEl) return;
  const filtered = filteredFecPulses();
  const ctxEl = $("#fec-filter-context");
  if (ctxEl) {
    const topic = state.fecTopicFilter || "";
    const topicLbl = topic ? ` · ${topic.charAt(0).toUpperCase()}${topic.slice(1)}` : "";
    const scopeLbl = isWatchlistScope() && !state.focusSymbol ? " · watchlist" : "";
    const focusSuffix = state.focusSymbol ? ` · focus ${state.focusSymbol}` : "";
    ctxEl.hidden = false;
    ctxEl.textContent = `${filtered.length} pulse${filtered.length === 1 ? "" : "s"}${topicLbl}${scopeLbl}${focusSuffix}`;
  }
  if (!filtered.length) {
    feedEl.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.innerHTML =
        isWatchlistScope() && !state.focusSymbol
          ? watchlistEmptyStateHtml()
          : payload?.source === "sample"
            ? `<strong>Showing illustrative FEC pulses.</strong> Set FEC_API_KEY for live Open FEC filings — or clear sector/focus filters.`
            : `<strong>No pulses match this filter.</strong> Try another sector or clear focus.`;
      emptyEl.querySelector("[data-feed-scope-set]")?.addEventListener("click", () => setFeedScope("all"));
    }
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  feedEl.innerHTML = filtered
    .map((pulse, index) => {
      const pulseKey = pulse.clusterKey || `${pulse.committee}-${index}`;
      const tickers = (pulse.tickers || []).slice(0, 6);
      return `
      <article class="money-trail-card fec-feed-card intel-card intel-card--fec" data-fec-pulse-key="${escapeHtml(pulseKey)}">
        <div class="fec-pulse-head">
          <span class="mini-pill ${badge.className}">${escapeHtml(badge.label)}</span>
          <span class="fec-pulse-committee">${escapeHtml(pulse.committee || "Committee")} · ${escapeHtml(pulse.chamber || "")}</span>
        </div>
        <h3 class="fec-feed-title">${escapeHtml(pulse.label || pulse.committee || "Committee cluster")}</h3>
        <p class="fec-pulse-line">${escapeHtml(pulse.plainEnglish || "")}</p>
        <div class="money-trail-linked-label muted">Linked to</div>
        ${renderFecLinkChips(pulse)}
        <div class="fec-feed-meta muted">
          <span>${escapeHtml(pulse.amountSummary || "—")}</span>
          <span>Filed ${escapeHtml(pulse.filingDate || "—")}</span>
          ${pulse.recentFilings ? `<span>${escapeHtml(String(pulse.recentFilings))} recent filing${pulse.recentFilings === 1 ? "" : "s"}</span>` : ""}
        </div>
        ${signalScanLineHtml({ source: "FEC", date: pulse.filingDate, tickers, band: pulse.period })}
        <div class="fec-pulse-actions">
          <a class="button button-primary compact" href="${escapeHtml(fecPageUrl(pulseKey))}">Read brief</a>
          <button type="button" class="button button-secondary compact" data-fec-open="${escapeHtml(pulseKey)}">Explain links</button>
          ${pulse.fecUrl ? `<a class="link-button" href="${escapeHtml(pulse.fecUrl)}" target="_blank" rel="noopener noreferrer">View on FEC.gov →</a>` : ""}
        </div>
      </article>`;
    })
    .join("");
}

function openFecDetailDrawer(pulseKey) {
  const pulse = (state.fecPulse?.pulses || []).find(
    (row, index) => (row.clusterKey || `${row.committee}-${index}`) === pulseKey
  );
  if (!pulse) return;
  const drawer = $("#fec-detail-drawer");
  const body = $("#fec-detail-body");
  const title = $("#fec-detail-title");
  if (!drawer || !body) return;
  const badge = fecSourceBadge(state.fecPulse?.source || "sample");
  if (title) title.textContent = pulse.label || pulse.committee || "Money trail";
  body.innerHTML = `
    <div class="fec-detail-head">
      <span class="mini-pill ${badge.className}">${escapeHtml(badge.label)}</span>
      <span class="muted">${escapeHtml(pulse.committee || "")} · ${escapeHtml(pulse.chamber || "")}</span>
    </div>
    <p class="fec-pulse-line">${escapeHtml(pulse.plainEnglish || "")}</p>
    ${renderFecLinkChips(pulse)}
    <div class="explain-panel" aria-label="Explainability graph">
      <h3 class="explain-panel-title">Why these links</h3>
      <p class="muted explain-panel-lede">Every connection uses explicit maps in fec-committee-map.json and policy-crosswalk.json — not keyword guessing.</p>
      <div class="explain-panel-loading muted">Loading link graph…</div>
    </div>
    ${signalScanLineHtml({ source: "FEC", date: pulse.filingDate, tickers: pulse.tickers, band: pulse.period })}
    <div class="fec-pulse-actions">
      <a class="button button-primary compact" href="${escapeHtml(fecPageUrl(clusterKey))}">Read brief →</a>
      ${pulse.fecUrl ? `<a class="button button-secondary compact" href="${escapeHtml(pulse.fecUrl)}" target="_blank" rel="noopener noreferrer">View on FEC.gov →</a>` : ""}
      <button type="button" class="button button-ghost compact" data-view-jump="signals">Open Signals</button>
    </div>`;
  drawer.hidden = false;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  body.querySelector("[data-view-jump]")?.addEventListener("click", () => {
    closeFecDetailDrawer();
    showView("signals");
  });
  const clusterKey = pulse.clusterKey || pulseKey;
  fetchJson(`/api/fec/filing/${encodeURIComponent(clusterKey)}`)
    .then((detail) => {
      const enriched = detail.pulse || pulse;
      const links = enriched.links || pulse.links || {};
      const panel = body.querySelector(".explain-panel");
      if (!panel) return;
      panel.innerHTML = `
        <h3 class="explain-panel-title">Why these links</h3>
        <p class="muted explain-panel-lede">Map key <span class="mono">${escapeHtml(detail.cluster?.key || clusterKey)}</span> · ${escapeHtml(fecLinkCountSummary(enriched))}</p>
        ${renderExplainabilitySection("Tickers", links.tickers || [], { idKey: "symbol", labelKey: "symbol" })}
        ${renderExplainabilitySection("Bills", links.bills || [], { idKey: "id", labelKey: "title", actionAttr: "fec-bill-open" })}
        ${renderExplainabilitySection("Lobbying filings", links.lobbyingFilings || [], { idKey: "id", labelKey: "client" })}
        ${renderExplainabilitySection("Contract awards", links.contracts || [], { idKey: "id", labelKey: "recipient" })}
      `;
      panel.querySelectorAll("[data-fec-bill-open]").forEach((el) => {
        el.addEventListener("click", () => {
          const billId = el.dataset.fecBillOpen;
          if (billId) {
            closeFecDetailDrawer();
            window.location.href = billPageUrl({ id: billId });
          }
        });
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            el.click();
          }
        });
      });
    })
    .catch(() => {
      const links = pulse.links || {};
      const panel = body.querySelector(".explain-panel");
      if (!panel) return;
      panel.innerHTML = `
        <h3 class="explain-panel-title">Why these links</h3>
        ${renderExplainabilitySection("Tickers", links.tickers || [], { idKey: "symbol", labelKey: "symbol" })}
        ${renderExplainabilitySection("Bills", links.bills || [], { idKey: "id", labelKey: "title", actionAttr: "fec-bill-open" })}
        ${renderExplainabilitySection("Lobbying filings", links.lobbyingFilings || [], { idKey: "id", labelKey: "client" })}
        ${renderExplainabilitySection("Contract awards", links.contracts || [], { idKey: "id", labelKey: "recipient" })}
      `;
    });
}

function closeFecDetailDrawer() {
  const drawer = $("#fec-detail-drawer");
  if (!drawer) return;
  drawer.classList.remove("open");
  drawer.hidden = true;
  drawer.setAttribute("aria-hidden", "true");
}

function setupFecDetailDrawer() {
  $("#fec-detail-close")?.addEventListener("click", closeFecDetailDrawer);
  $("#fec-detail-backdrop")?.addEventListener("click", closeFecDetailDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#fec-detail-drawer")?.classList.contains("open")) closeFecDetailDrawer();
  });
}

function setupFecControls() {
  document.querySelectorAll("[data-fec-topic]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-fec-topic]").forEach((chip) => chip.classList.toggle("is-active", chip === btn));
      state.fecTopicFilter = btn.dataset.fecTopic || "";
      renderFecView();
    });
  });
  document.getElementById("fec-feed")?.addEventListener("click", (e) => {
    const openBtn = e.target.closest("[data-fec-open]");
    if (openBtn) {
      e.preventDefault();
      openFecDetailDrawer(openBtn.dataset.fecOpen || "");
    }
  });
}

function renderBillFecBlock(bill) {
  const ctx = bill?.moneyContext || bill?._fecContext;
  if (!ctx) return "";
  if (!ctx.matched) {
    return `<details class="fec-stakeholder-block money-context money-context-expand">
      <summary>Money context · no match yet</summary>
      <p class="muted">${escapeHtml(ctx.message || "No committee money match for this bill yet.")}</p>
    </details>`;
  }
  const badge = fecSourceBadge(ctx.source);
  return `
    <details class="fec-stakeholder-block money-context money-context-expand">
      <summary>Money context · <span class="mini-pill ${badge.className}">${escapeHtml(badge.label)}</span></summary>
      <p class="fec-pulse-line">${escapeHtml(ctx.plainEnglish || "")}</p>
      <ul class="money-context-bullets">
        ${(ctx.marketBullets || []).slice(0, 3).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
      </ul>
      ${ctx.sponsorSummary ? `<p class="muted">Sponsor: ${escapeHtml(ctx.sponsorSummary.name)} · ${escapeHtml(compactMoney(ctx.sponsorSummary.receipts || 0))} ${escapeHtml(String(ctx.cycle || ""))} cycle receipts</p>` : ""}
      <div class="money-context-tickers">${(ctx.tickers || []).slice(0, 4).map((t) => `<span class="mini-pill green">${escapeHtml(t)}</span>`).join(" ")}</div>
      ${ctx.linkCounts ? renderFecLinkChips({ linkCounts: ctx.linkCounts }, { compact: true }) : ""}
      <div class="fec-pulse-actions">
        ${ctx.clusterKey ? `<a class="link-button" href="${escapeHtml(fecPageUrl(ctx.clusterKey))}">Read FEC brief →</a>` : ""}
        ${ctx.fecUrl ? `<a class="link-button" href="${escapeHtml(ctx.fecUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ctx.attribution || "View on FEC.gov")}</a>` : ""}
        <button type="button" class="link-button" data-view-jump="fec">Related FEC pulses →</button>
      </div>
    </details>`;
}

function renderBillFecBlockFromPulse(bill) {
  const haystack = [bill.title, bill.shortTitle, bill.policyArea, ...(bill.tags || []), ...(bill.committees || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const pulse = (state.fecPulse?.pulses || []).find((row) => {
    const label = `${row.committee || ""} ${row.label || ""}`.toLowerCase();
    return haystack.split(/\s+/).some((word) => word.length > 4 && label.includes(word));
  });
  if (!pulse) {
    return `<details class="fec-stakeholder-block money-context money-context-expand">
      <summary>Money context · no match yet</summary>
      <p class="muted">No committee money match for this bill yet.</p>
    </details>`;
  }
  return renderBillFecBlock({
    matched: true,
    source: state.fecPulse?.source || "sample",
    plainEnglish: pulse.plainEnglish,
    marketBullets: [
      `${pulse.committee} PAC cluster filed ${pulse.amountSummary || "activity"} — ${pulse.period || ""}.`,
      `Tickers mapped: ${(pulse.tickers || []).slice(0, 3).join(", ") || "—"}.`,
      "FEC receipts track political committees, not stock prices — use as context only."
    ],
    tickers: pulse.tickers,
    fecUrl: pulse.fecUrl,
    attribution: "Source: FEC",
    cycle: state.fecPulse?.cycle
  });
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
  thesisSyncIntakeState({ renderSummary: true });
  renderOverview();
  renderSignalsDesk();
  renderMarkets();
  renderCrypto();
  renderBills();
  renderLobbying();
  renderFecView();
  renderAccount();
  renderContracts();
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
  if (!data?.fallback && !data?.partialFallback) {
    existing?.remove();
    return;
  }
  const note =
    data.fallbackNote ||
    (data.partialFallback
      ? `${data.staticQuoteCount ?? "Some"} symbols still on reference prices — live refresh in progress.`
      : "Static reference prices — live data unavailable");
  if (existing) {
    existing.textContent = note.startsWith("⚠") ? note : `⚠ ${note}`;
    return;
  }
  const banner = document.createElement("div");
  banner.id = "ts-fallback-banner";
  banner.style.background = "#1a1a00";
  banner.style.border = "1px solid #665500";
  banner.style.color = "#ccaa00";
  banner.style.fontSize = "0.78rem";
  banner.style.padding = "6px 12px";
  banner.style.marginBottom = "8px";
  banner.style.borderRadius = "4px";
  banner.textContent = note.startsWith("⚠") ? note : `⚠ ${note}`;
  tableWrap.parentNode.insertBefore(banner, tableWrap);
}

async function loadMarketsData() {
  state.marketsQuotesLoading = true;
  state.quoteFeedError = "";
  const catalogSymbols = marketsCatalogRows().map((row) => row.symbol);
  markQuoteSymbolsPending(catalogSymbols);
  renderMarkets();

  const applyBatch = (data) => {
    applyQuoteBatchToState(data, { render: true });
    syncQuotesFallbackBanner(data);
    renderMarkets();
  };

  try {
    const data = await fetchCatalogQuotes();
    applyBatch(data);
    state.marketsCatalogQuotesLoaded = true;
  } catch (e) {
    console.warn("[markets] catalog quotes failed, falling back to batched fetch", e);
    try {
      const hot = hotQuoteSymbols();
      const data = await fetchQuotesBatched(hot, {
        onChunk: (partial) => applyBatch(partial)
      });
      applyBatch(data);
      state.marketsCatalogQuotesLoaded = true;
    } catch (err) {
      console.error("[markets] quotes fetch failed", err);
      state.quoteFeedError = "Could not load quotes — check connection or tap Refresh.";
      syncQuotesFallbackBanner({ fallback: false });
      renderSourceBadges();
      renderMarkets();
    }
  } finally {
    state.marketsQuotesLoading = false;
    renderMarkets();
  }

  void fetchQuotesBatched(hotQuoteSymbols(), {
    trackPending: true,
    onChunk: (partial) => applyBatch(partial)
  })
    .then(applyBatch)
    .catch((err) => console.warn("[markets] live refresh failed", err));

  void pollQuoteUpgrades({ render: true });

  if (!isFeatureEnabled("CRYPTO_TRACKER_ENABLED")) {
    state.crypto = [];
    renderCrypto();
    renderTape();
    return;
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
  const tapeEl = $("#ticker-tape");
  const symbols = [...tapeDefaultQuoteSymbols(), "BTC", "ETH"];
  const hasQuotes = state.quotes?.length > 0 || state.crypto?.length > 0;
  if (tapeEl && !hasQuotes && !state.dataMeta.market?.updatedAt) {
    tapeEl.classList.add("is-loading");
    tapeEl.textContent = "Loading market feed…";
    return;
  }
  tapeEl?.classList.remove("is-loading");
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
  if (!state.account) showSkeleton("#holdings-body", 4, "row");
  let investedValue = 0;
  let cost = 0;
  let dayChange = 0;
  const positions = [];
  const accountMeta = paperAccountMeta(state.account);
  const cash = Number(accountMeta.cash ?? PAPER_STARTING_CASH);
  const fromAccount = (state.account?.positions || []).slice().sort((a, b) => Number(b.marketValue || 0) - Number(a.marketValue || 0));
  const rows = !fromAccount.length
    ? `<tr class="empty-state-row"><td colspan="6"><div class="guided-empty-state"><strong>Start here:</strong> you hold $100,000 of simulated cash and no positions. Place a paper trade to light up this table and your policy exposure map. <button type="button" class="button button-secondary compact" data-show-view="trade">Open paper trading →</button></div></td></tr>`
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
        <td class="num">${fmt(shares)}</td>
        <td class="num">${money(quote.price)}${position.priceBasis === "cost_basis_fallback" ? ' <small class="muted">(cost basis)</small>' : ""}</td>
        <td class="num">${money(positionValue)}</td>
        <td class="num ${quote.pct >= 0 ? "up" : "down"}">${signed(quote.pct)}%</td>
        <td>${policyBlurbFor(sym)}</td>
      </tr>
    `;
        })
        .filter(Boolean)
        .join("");

  $("#holdings-body").innerHTML = rows;
  clearSkeleton("#holdings-body");
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

  const policyRisk = portfolioPolicyRisk();
  const statPolicy = $("#stat-policy-exposure");
  const statPolicySub = $("#stat-policy-exposure-sub");
  if (statPolicy) statPolicy.textContent = `${policyRisk.score}/100`;
  if (statPolicySub) statPolicySub.textContent = `${policyRisk.label} · ${policyRisk.sub}`;
  $("#portfolio-hero-value").textContent = money(equity);
  const heroDay = fromAccount.length
    ? `<span class="muted">${dayChange >= 0 ? "+" : ""}${money(Math.abs(dayChange))} today</span>`
    : `<span class="muted">All cash · no open positions</span>`;
  const returnCls = returnPct >= 0 ? "muted" : "down";
  $("#portfolio-hero-change").innerHTML = `${heroDay} · <span class="${returnCls}">${signed(returnPct)}% vs start</span>`;

  if (state.account) recordPortfolioEquitySnapshot(state.account);
  renderPortfolioChart();
  $("#holdings-updated").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("#overview-subtitle").textContent =
    state.quoteFeedSource === "fallback" || state.quoteFeedSource === "mixed"
      ? `Tracking ${state.quotes.length} equities using modeled fallback prices (set FINNHUB_API_KEY on the server for live tape), ${state.crypto.length} crypto assets, and ${policyBills().length} market-relevant bills.`
      : `Tracking ${state.quotes.length} equities, ${state.crypto.length} crypto assets, and ${policyBills().length} market-relevant bills.`;

  const safety = state.config?.safety;
  const tradeModeEl = $("#trade-mode");
  if (tradeModeEl) {
    tradeModeEl.textContent = safety?.liveTradingEnabled ? "Live enabled" : "Paper";
    tradeModeEl.className = safety?.liveTradingEnabled ? "overview-metric-value amber" : "overview-metric-value";
  }
  $("#trade-mode-sub").textContent = safety?.liveTradingEnabled ? "Broker live mode enabled" : "Live trading locked by default";
  const classMode = $("#dash-classbar-mode");
  if (classMode) {
    classMode.textContent = safety?.liveTradingEnabled
      ? "Live mode · broker enabled"
      : "Paper mode · simulated capital";
  }

  const bills = (isWatchlistScope() && !state.focusSymbol
    ? policyBills().filter(billMatchesFocusFilter)
    : policyBills());
  const maxMom = bills.reduce((max, b) => Math.max(max, billMomentum(b)), 0);
  const statBillCount = $("#stat-bill-count");
  const statBillMomentum = $("#stat-bill-momentum");
  if (statBillCount) statBillCount.textContent = String(bills.length);
  if (statBillMomentum) {
    statBillMomentum.textContent = bills.length
      ? `Max legislative momentum ${maxMom}/100${isWatchlistScope() && !state.focusSymbol ? " · watchlist" : ""}`
      : isWatchlistScope() && !state.focusSymbol
        ? "No watchlist bills today"
        : "No bills loaded yet";
  }

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

  renderPortfolioDashboard(positions, equity, returnPct, dayChange);
  renderWatchlistStrip();
  renderBookSummaryHeader();
  renderFeedScopeToggle();
  renderMorningBrief();
  renderFecPulseStrip();
  renderSinceLastVisitStrip();
  renderMarketMood();
  renderResearchJourney();
  renderGuidedDemoChecklist();
}

function renderSignalsConvictionList() {
  const el = $("#signal-list");
  if (!el) return;
  const type = state.signalsTypeFilter || "all";
  if (type === "contracts" || type === "trending") {
    const hint = type === "contracts"
      ? `<div class="sc-empty guided-empty-state"><strong>Conviction scans are bill-driven.</strong> Switch to All or Bills to see ranked catalysts, or browse contract awards below. <button type="button" class="button button-secondary compact" data-signals-filter-hint="bills">Show bill signals</button> <button type="button" class="link-button" data-view-jump="contracts">View all in Contracts</button></div>`
      : `<div class="sc-empty muted">Conviction scans are bill-driven — switch type to All or Bills.</div>`;
    el.innerHTML = hint;
    el.querySelector("[data-signals-filter-hint]")?.addEventListener("click", () => {
      state.signalsTypeFilter = "bills";
      const bar = $("#signals-filter-bar");
      syncFilterChipGroup(bar, "data-signals-filter", "bills");
      renderSignalsDesk();
    });
    clearSkeleton("#signal-list");
    return;
  }
  let bills = policyBills().slice().sort((a, b) => billMomentum(b) - billMomentum(a));
  bills = bills.filter(billMatchesFocusFilter);
  if (!bills.length) {
    el.innerHTML = state.focusSymbol
      ? `<div class="sc-empty muted">No conviction signals for ${escapeHtml(state.focusSymbol)} yet.</div>`
      : isWatchlistScope()
        ? watchlistEmptyStateHtml()
        : `<div class="sc-empty muted">No conviction signals loaded yet.</div>`;
    el.querySelector("[data-feed-scope-set]")?.addEventListener("click", () => setFeedScope("all"));
    clearSkeleton("#signal-list");
    return;
  }
  el.innerHTML = bills.slice(0, 8).map(signalCard).join("");
  clearSkeleton("#signal-list");
}

function renderSignalsDesk() {
  const type = state.signalsTypeFilter || "all";
  applySignalsDeskVisibility();
  renderTopSignal();
  renderTrendingSection();
  renderContractWatchSection();
  renderSignalFeed();
  renderPolicyCatalysts();
  renderSignalsConvictionList();
  renderLiveAlerts();
  renderTabFilterContexts();
  renderMorningBrief();
}

const TRENDING_TYPE_LABELS = {
  ma: "M&A",
  contract: "Contract",
  legislation: "Legislation",
  topic: "Topic"
};

function trendingTypeLabel(type) {
  return TRENDING_TYPE_LABELS[type] || String(type || "Topic");
}

function trendingTickerLine(topic) {
  const direct = topic.tickers || [];
  const related = (topic.relatedTickers || []).filter((t) => !direct.includes(t));
  if (direct.length) return direct.join(", ");
  if (related.length) return `No listed ticker · related: ${related.slice(0, 4).join(", ")}`;
  return "No public ticker";
}

function trendingCardLink(topic) {
  if (topic.briefUrl) return topic.briefUrl;
  const contract = (topic.contractMatches || []).find((row) => row.directUrl);
  if (contract?.directUrl) return contract.directUrl;
  const headline = (topic.headlineMatches || []).find((row) => row.url);
  if (headline?.url) return headline.url;
  if ((topic.tickers || [])[0]) return `/stock/${encodeURIComponent(topic.tickers[0])}`;
  if ((topic.relatedTickers || [])[0]) return `/stock/${encodeURIComponent(topic.relatedTickers[0])}`;
  return null;
}

function renderTrendingCard(topic) {
  const type = topic.type || "topic";
  const typeClass = `sc-card--${type === "contract" ? "contract" : type === "ma" ? "bill" : "lobbying"}`;
  const link = trendingCardLink(topic);
  const headline = (topic.headlineMatches || [])[0];
  const bill = (topic.congressMatches || [])[0];
  const contract = (topic.contractMatches || [])[0];
  const freshness = topic.freshness?.label || topic.freshness?.status || "";
  const subline = headline?.headline || bill?.title || contract?.description || topic.keywords?.join(" · ") || "";
  const tickers = topic.tickers || [];
  const scanSource = trendingTypeLabel(type);
  const scanDate = topic.updatedAt || headline?.publishedAt || "";
  const linkAttrs = link
    ? `href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer"`
    : `data-show-view="signals" role="button" tabindex="0"`;

  return `
    <article class="sc-card trending-card ${typeClass}" ${link ? "" : 'data-show-view="signals"'}>
      <a class="trending-card-link" ${linkAttrs}>
        <div class="sc-card-header">
          <span class="sc-type-badge">${escapeHtml(trendingTypeLabel(type))}</span>
          ${topic.privateCompany ? `<span class="trending-private-badge">No public ticker</span>` : ""}
          ${freshness ? `<span class="trending-freshness muted">${escapeHtml(freshness)}</span>` : ""}
        </div>
        <h3 class="sc-title">${escapeHtml(topic.title || topic.id)}</h3>
        ${signalScanLineHtml({ source: scanSource, date: scanDate, tickers: trendingTickerLine(topic).includes("No public") ? [] : tickers, band: freshness || "Topic" })}
        ${subline ? `<p class="sc-sub muted">${escapeHtml(String(subline).slice(0, 120))}</p>` : ""}
        <p class="trending-card-foot muted">${escapeHtml(topic.disclaimer || "Monitoring topic · not investment advice")}</p>
      </a>
    </article>`;
}

function renderTrendingSection() {
  const feed = $("#trending-feed");
  const source = $("#trending-source");
  if (!feed) return;
  const topics = state.trending || [];
  if (source) {
    source.textContent = state.trendingLoadedAt
      ? `Updated ${new Date(state.trendingLoadedAt).toLocaleTimeString()}`
      : "Monitoring topics";
  }
  let filtered = topics.filter(trendingMatchesSignalsFilter);
  if (isWatchlistScope() && !state.focusSymbol) {
    filtered = filtered.filter((topic) =>
      itemMatchesWatchlist([...(topic.tickers || []), ...(topic.relatedTickers || [])])
    );
  }
  if (!filtered.length) {
    feed.innerHTML = isWatchlistScope() && !state.focusSymbol
      ? watchlistEmptyStateHtml()
      : `<div class="sc-empty muted">No trending topics match this filter${state.focusSymbol ? ` for ${escapeHtml(state.focusSymbol)}` : ""}.</div>`;
    feed.querySelector("[data-feed-scope-set]")?.addEventListener("click", () => setFeedScope("all"));
    const moreWrap = $("#trending-more-wrap");
    if (moreWrap) moreWrap.hidden = true;
    return;
  }
  const preview = _trendingDeskExpanded ? filtered : filtered.slice(0, SIGNALS_DESK_PREVIEW);
  feed.innerHTML = preview.map(renderTrendingCard).join("");
  const moreWrap = $("#trending-more-wrap");
  const moreBtn = $("#trending-more-btn");
  if (moreWrap && moreBtn) {
    const hasMore = filtered.length > SIGNALS_DESK_PREVIEW && !_trendingDeskExpanded;
    moreWrap.hidden = !hasMore;
    if (hasMore) moreBtn.textContent = `Show ${filtered.length - SIGNALS_DESK_PREVIEW} more trending`;
  }
  feed.querySelectorAll("[data-show-view]").forEach((el) => {
    el.addEventListener("click", () => showView(el.dataset.showView || "signals"));
  });
}

async function refreshTrendingFeed({ render = true } = {}) {
  try {
    const data = await fetchJson("/api/trending");
    state.trending = data.topics || [];
    state.trendingLoadedAt = data.updatedAt || new Date().toISOString();
    rememberFeedMeta("trending", data, "trending");
    if (render) {
      renderSourceBadges();
      renderTrendingSection();
    }
    return data;
  } catch (err) {
    console.warn("[trending] feed unavailable", err);
    if (render) renderTrendingSection();
    return { topics: [], error: true };
  }
}

function contractWatchTickerLine(award) {
  const mapped = award.mappedTickers || [];
  const related = (award.relatedTickers || []).filter((t) => !mapped.includes(t));
  if (mapped.length) return mapped.join(", ");
  if (related.length) return `No public ticker · related: ${related.slice(0, 4).join(", ")}`;
  return "No public ticker";
}

function renderContractWatchCard(award) {
  const freshness = award.freshness?.label || (award.isNew ? "New" : "Recent");
  const tickers = contractWatchTickerLine(award);
  const primaryTicker = (award.mappedTickers || [])[0] || (award.relatedTickers || [])[0] || "";
  const briefUrl = primaryTicker ? contractPageUrl(primaryTicker) : award.contractBriefUrl;
  const usaspendingUrl = award.contractUrl;
  const firstSeen = award.firstSeenAt ? `First seen by TradeSimple: ${freshnessText(award.firstSeenAt)}` : "";
  const actionDate = award.awardDate ? `Award date ${award.awardDate}` : "";
  const meta = [firstSeen, actionDate].filter(Boolean).join(" · ");

  return `
    <article class="sc-card trending-card sc-card--contract contract-watch-card">
      <div class="sc-card-header">
        <span class="sc-type-badge">Federal award</span>
        ${award.isNew ? `<span class="trending-private-badge contract-watch-new">Recent award</span>` : ""}
        ${award.noPublicTicker ? `<span class="trending-private-badge">No public ticker</span>` : ""}
        <span class="trending-freshness muted">${escapeHtml(freshness)}</span>
      </div>
      <h3 class="sc-title">${escapeHtml(compactMoney(award.amount))} → ${escapeHtml(award.recipient || "Recipient")}</h3>
      ${signalScanLineHtml({
        source: "USASpending.gov",
        date: award.awardDate || award.firstSeenAt,
        tickers: (award.mappedTickers || []).slice(0, 4),
        band: award.isNew ? "New award" : "Recent"
      })}
      <p class="sc-sub muted">${escapeHtml(award.agency || "Federal agency")}${award.descriptionSnippet ? ` · ${escapeHtml(String(award.descriptionSnippet).slice(0, 100))}` : ""}</p>
      ${meta ? `<p class="contract-watch-meta muted">${escapeHtml(meta)}</p>` : ""}
      <div class="contract-watch-actions">
        ${briefUrl ? `<a class="link-button" href="${escapeHtml(briefUrl)}">${primaryTicker ? `${escapeHtml(primaryTicker)} brief →` : "Contract brief →"}</a>` : ""}
        ${usaspendingUrl ? `<a class="link-button" href="${escapeHtml(usaspendingUrl)}" target="_blank" rel="noopener noreferrer">USASpending →</a>` : ""}
      </div>
      <p class="trending-card-foot muted">${escapeHtml(award.disclaimer || "USASpending.gov · not investment advice")}</p>
    </article>`;
}

function renderContractWatchSection() {
  const feed = $("#contract-watch-feed");
  const source = $("#contract-watch-source");
  const summary = $("#contract-watch-summary");
  const evidenceSummary = $("#contract-watch-evidence-summary");
  const disclaimer = $("#contract-watch-disclaimer");
  const moreWrap = $("#contract-watch-more-wrap");
  const moreBtn = $("#contract-watch-more-btn");
  if (!feed) return;
  const awards = (state.contractWatch || []).slice().sort((a, b) => {
    const aTs = Date.parse(a.firstSeenAt || a.lastModifiedDate || 0);
    const bTs = Date.parse(b.firstSeenAt || b.lastModifiedDate || 0);
    return bTs - aTs;
  });
  if (source) {
    const refreshed = state.contractWatchMeta?.lastRefreshAt || state.contractWatchLoadedAt;
    source.textContent = refreshed
      ? `Updated ${new Date(refreshed).toLocaleTimeString()} · ${awards.length} award(s)`
      : "Polling USASpending";
  }
  const filtered = awards.filter(contractWatchMatchesTabFilters);
  const signalsSummaryMode = !_contractWatchDeskExpanded;
  if (!filtered.length) {
    const focusMsg = state.focusSymbol ? ` for ${state.focusSymbol}` : "";
    if (summary) summary.hidden = true;
    if (evidenceSummary) evidenceSummary.textContent = `No significant awards${focusMsg} in the last 7 days.`;
    if (disclaimer) disclaimer.hidden = false;
    feed.hidden = false;
    feed.innerHTML = `<div class="sc-empty muted">No significant awards${escapeHtml(focusMsg)} in the last 7 days. TradeSimple polls USASpending every ~30 minutes.</div>`;
    if (moreWrap) moreWrap.hidden = true;
    return;
  }
  if (signalsSummaryMode) {
    const top = filtered[0];
    const topAmt = top?.amount ? compactMoney(top.amount) : "—";
    const topSym = (top?.mappedTickers || top?.relatedTickers || [])[0] || "—";
    if (summary) {
      summary.hidden = false;
      summary.innerHTML = `${filtered.length} recent award${filtered.length === 1 ? "" : "s"} · latest ${escapeHtml(topSym)} ${escapeHtml(topAmt)} · <button type="button" class="link-button" data-view-jump="contracts">View all in Contracts</button> <button type="button" class="link-button" id="contract-watch-expand-inline">Expand here</button>`;
      summary.querySelector("#contract-watch-expand-inline")?.addEventListener("click", () => {
        _contractWatchDeskExpanded = true;
        renderContractWatchSection();
      });
    }
    if (evidenceSummary) {
      evidenceSummary.innerHTML = `${filtered.length} recent award${filtered.length === 1 ? "" : "s"} · latest ${escapeHtml(topSym)} ${escapeHtml(topAmt)} · ${escapeHtml(freshnessText(top?.firstSeenAt || top?.lastModifiedDate))}`;
    }
    if (disclaimer) disclaimer.hidden = true;
    feed.hidden = true;
    feed.innerHTML = "";
    if (moreWrap) moreWrap.hidden = true;
    return;
  }
  if (summary) summary.hidden = true;
  if (disclaimer) disclaimer.hidden = false;
  feed.hidden = false;
  const preview = filtered.slice(0, SIGNALS_DESK_PREVIEW);
  feed.innerHTML = preview.map(renderContractWatchCard).join("");
  if (moreWrap && moreBtn) {
    const hasMore = filtered.length > SIGNALS_DESK_PREVIEW;
    moreWrap.hidden = !hasMore;
    if (hasMore) moreBtn.textContent = `Show ${filtered.length - SIGNALS_DESK_PREVIEW} more awards`;
  }
}

function renderContractsTabWatch() {
  const feed = $("#contracts-tab-watch-feed");
  const source = $("#contracts-tab-watch-source");
  if (!feed) return;
  const awards = (state.contractWatch || [])
    .slice()
    .sort((a, b) => Date.parse(b.firstSeenAt || b.lastModifiedDate || 0) - Date.parse(a.firstSeenAt || a.lastModifiedDate || 0))
    .filter(contractWatchMatchesTabFilters);
  if (source) {
    const refreshed = state.contractWatchMeta?.lastRefreshAt || state.contractWatchLoadedAt;
    source.textContent = refreshed
      ? `Updated ${new Date(refreshed).toLocaleTimeString()} · ${awards.length} award(s)`
      : "Polling USASpending";
  }
  if (!awards.length) {
    const focusMsg = state.focusSymbol ? ` for ${state.focusSymbol}` : "";
    feed.innerHTML = `<div class="sc-empty muted">No recent awards${escapeHtml(focusMsg)} match these filters.</div>`;
    return;
  }
  feed.innerHTML = awards.slice(0, 8).map(renderContractWatchCard).join("");
}

async function refreshContractWatchFeed({ render = true } = {}) {
  try {
    const data = await fetchJson("/api/contract-watch");
    state.contractWatch = data.awards || [];
    state.contractWatchLoadedAt = data.updatedAt || new Date().toISOString();
    state.contractWatchMeta = {
      lastRefreshAt: data.lastRefreshAt,
      minAmount: data.minAmount,
      alertCount: data.alertCount
    };
    rememberFeedMeta("contractWatch", data, "usaspending.gov");
    if (render) {
      renderSourceBadges();
      renderContractWatchSection();
      renderContractsTabWatch();
      renderLiveAlerts();
    }
    return data;
  } catch (err) {
    console.warn("[contract-watch] feed unavailable", err);
    if (render) {
      renderContractWatchSection();
      renderContractsTabWatch();
    }
    return { awards: [], error: true };
  }
}

function renderResearchJourney() {
  const strip = $("#research-journey-strip");
  if (!strip) return;
  const sym = state.activeAnalysisSymbol || "NVDA";
  const steps = [
    { title: "Thesis", desc: "Write view & map signals", view: "thesis", cta: "Thesis Lab" },
    { title: "Signals", desc: "Conviction scans & catalyst queue", view: "signals", cta: "Signals" },
    { title: "Lobbying", desc: "Issue-area spend by registrant", view: "lobbying", cta: "Lobbying" },
    { title: "Contracts", desc: "Federal award exposure", view: "contracts", cta: "Contracts" },
    { title: "Analysis", desc: `Deep dive · ${sym}`, view: "analysis", cta: sym }
  ];
  strip.innerHTML = `
    <div class="research-journey-head">
      <span class="mini-label">Research path</span>
      <button type="button" class="button button-ghost compact" id="research-journey-replay">Orientation</button>
    </div>
    <div class="research-journey-steps">
      ${steps
        .map(
          (s) =>
            `<button type="button" class="research-journey-step" data-journey-view="${escapeHtml(s.view)}">
              <span class="research-journey-copy"><strong>${escapeHtml(s.title)}</strong><small>${escapeHtml(s.desc)}</small></span>
              <span class="research-journey-cta">${escapeHtml(s.cta)} →</span>
            </button>`
        )
        .join("")}
    </div>`;
  strip.querySelectorAll("[data-journey-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.journeyView;
      if (view === "analysis") {
        state.activeAnalysisSymbol = sym;
        const sel = $("#analysis-symbol");
        if (sel) setSymbolPickerValue(sel, sym, { notify: false });
      }
      showView(view);
    });
  });
  $("#research-journey-replay")?.addEventListener("click", () => openOnboardingModal({ force: true }));
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
  const { score: policyRisk, label: policyLbl } = portfolioPolicyRisk();

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

  const moodChip = $("#overview-mood-chip");
  if (moodChip) {
    const chipLbl = fearGreed >= 58 ? "Tape risk-on" : fearGreed <= 42 ? "Tape defensive" : "Tape balanced";
    moodChip.hidden = false;
    moodChip.textContent = `${chipLbl} · policy ${policyLbl.toLowerCase()} · lobby ${lobbyLbl.toLowerCase()}`;
  }
}

function renderLiveAlerts() {
  const el = $("#live-alerts");
  if (!el) return;
  const alerts = buildLiveAlerts();
  const updated = $("#live-alert-updated");
  const latest = latestFeedTime(["market", "crypto", "bills", "lobbying", "contracts"]);
  if (updated) {
    updated.textContent = latest ? `Latest feed ${freshnessText(latest)}` : "Waiting for feeds";
  }
  if (!alerts.length && !latest) {
    el.innerHTML = skeletonFeedMarkup(3);
    return;
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

  const newWatch = (state.contractWatch || []).filter((row) => row.isNew).slice().sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
  if (newWatch) {
    alerts.push({
      label: "Contract Watch",
      pillClass: "green",
      tone: "good",
      title: `${compactMoney(newWatch.amount)} → ${newWatch.recipient || "Recipient"}`,
      body: `${newWatch.agency || "Federal agency"} · ${contractWatchTickerLine(newWatch)} · ${freshnessText(newWatch.firstSeenAt || newWatch.lastModifiedDate)}.`,
      action: "view",
      viewName: "signals",
      url: newWatch.contractUrl || ""
    });
  }

  return alerts.slice(0, 6);
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
        <button type="button" class="watchlist-chip-remove" data-watch-remove="${escapeHtml(row.symbol)}" title="Remove ${escapeHtml(row.symbol)} from watchlist" aria-label="Remove ${escapeHtml(row.symbol)}">×</button>
        ${shareCardLink(row.symbol, "Card")}
      </span>
    `;
  }).join("");
}

function renderMarkets() {
  const tbody = $("#market-body");
  if (!tbody) return;
  updateMarketsTableMeta();
  syncMarketsDeskToggleVisibility();

  const rows = filteredMarketsRows();
  if (!rows.length) {
    const focusHint = state.focusSymbol
      ? `No markets row for <strong>${escapeHtml(state.focusSymbol)}</strong> with these filters.`
      : "No symbols match this filter.";
    tbody.innerHTML = `<tr><td colspan="7" class="markets-empty-row">${focusHint} Try <strong>All</strong> or <button type="button" class="link-button" id="markets-clear-focus-inline">clear focus</button>.</td></tr>`;
    $("#markets-clear-focus-inline")?.addEventListener("click", () => clearFocusSymbol());
    renderTabFilterContexts();
    return;
  }

  tbody.innerHTML = rows.map((row) => {
    const sym = row.symbol;
    const focusMatch = state.focusSymbol && normalizeWatchSymbol(sym) === state.focusSymbol;
    const quote = quoteFor(sym);
    const pctRaw = quote ? Number(quote.changePercent ?? quote.pct ?? 0) : null;
    const pct = pctRaw != null && Number.isFinite(pctRaw) ? pctRaw : null;
    const chg = quote?.change != null ? Number(quote.change) : null;
    const pctCls = pct == null ? "muted" : pct >= 0 ? "up" : "down";
    const pctTxt = pct == null ? "—" : `${pct >= 0 ? "+" : ""}${fmt(pct)}%`;
    const chgTxt = chg == null ? "—" : signed(chg);
    const watching = isOnWatchlist(sym);
    const policyHtml = marketsPolicySignalHtml(sym);
    return `
      <tr class="markets-row markets-card-row clickable-row${focusMatch ? " is-focus-match" : ""}" data-symbol="${escapeHtml(sym)}">
        <td class="mono ticker-link-cell markets-ticker-cell">
          <a class="markets-ticker-link" href="${escapeHtml(stockPageUrl(sym))}" onclick="event.stopPropagation()">${escapeHtml(sym)}</a>
          <span class="markets-ticker-name">${escapeHtml(row.name || sym)}</span>
          ${shareCardLink(sym, "Share")}
        </td>
        <td class="markets-name-cell">${escapeHtml(row.name || sym)}</td>
        <td class="mono num">${marketsQuoteCellHtml(sym)}</td>
        <td class="mono num ${pctCls}">${chgTxt} <span class="markets-pct">(${pctTxt})</span></td>
        <td class="markets-sources-cell"><div class="markets-source-badges">${marketsSourceBadgesHtml(row)}</div></td>
        <td class="markets-links-cell"><div class="markets-link-row">${marketsConnectedLinksHtml(row)}</div><div class="markets-policy-signal">${policyHtml}</div></td>
        <td><button type="button" class="button button-secondary compact watch-toggle-btn${watching ? " is-watching" : ""}" data-watch-toggle="${escapeHtml(sym)}" title="${watching ? "Remove from watchlist" : "Add to watchlist"}">${watching ? "★" : "☆"}</button></td>
      </tr>
    `;
  }).join("");
  renderTabFilterContexts();
}

function renderCrypto() {
  const grid = $("#crypto-grid");
  if (!grid) return;
  const cryptoData = state.crypto || [];
  if (!cryptoData.length) {
    grid.innerHTML =
      '<p class="muted mono" style="padding:16px;font-size:11px;">Crypto prices unavailable. Set COINGECKO_API_KEY in .env.local for live data.</p>';
    if ((state.marketsSubTab || "equities") === "crypto") renderTabFilterContexts();
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
  if ((state.marketsSubTab || "equities") === "crypto") renderTabFilterContexts();
}

async function refreshContractsFeed({ render = true } = {}) {
  if (!isFeatureEnabled("CONTRACTS_ANALYZER_ENABLED")) {
    state.contracts = [];
    state.contractsLoadedAt = new Date().toISOString();
    rememberFeedMeta("contracts", {
      source: "feature_disabled",
      confidence: "Hidden",
      updatedAt: state.contractsLoadedAt
    });
    return state.contracts;
  }
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
    renderSignalFeed();
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

  const filtered = state.contracts.filter(contractMatchesTabFilters);
  if (!filtered.length) {
    const focusMsg = state.focusSymbol
      ? `No contract exposure for <strong>${escapeHtml(state.focusSymbol)}</strong> with these filters.`
      : "No contracts match these filters.";
    tbody.innerHTML = `<tr><td colspan="7"><div class="guided-empty-state">${focusMsg} <button type="button" class="link-button" data-view-jump="markets">Browse Markets</button> or adjust agency/amount chips.</div></td></tr>`;
    renderTabFilterContexts();
    return;
  }

  tbody.innerHTML = filtered.map((row) => {
    const detailId = `cd-${escapeHtml(row.symbol)}`;
    const pageUrl = contractPageUrl(row.symbol);
    return `
      <tr class="clickable-row contract-summary-row"
          data-contract-toggle="${detailId}"
          data-symbol="${escapeHtml(row.symbol)}"
          role="button" tabindex="0"
          title="Expand awards · open full page from symbol">
        <td class="mono"><a class="bill-page-link" href="${escapeHtml(pageUrl)}">${escapeHtml(row.symbol)}</a></td>
        <td><a class="bill-page-link" href="${escapeHtml(pageUrl)}">${escapeHtml(row.company)}</a></td>
        <td><span class="score-badge ${row.exposureClass}">${compactMoney(row.totalObligated)}</span></td>
        <td class="mono">${row.topAward ? compactMoney(row.topAward) : "—"}</td>
        <td>${escapeHtml(row.topAgency)}</td>
        <td><span class="score-badge ${row.riskClass}">${escapeHtml(row.riskLabel)}</span></td>
        <td class="mono contract-expand-hint">▸ <a class="bill-page-open muted" href="${escapeHtml(pageUrl)}">Full page</a></td>
      </tr>
      <tr id="${detailId}" class="contract-detail-row" hidden>
        <td colspan="7">
          ${renderContractDetailPanel(row)}
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".contract-summary-row").forEach((summaryRow) => {
    summaryRow.addEventListener("click", (event) => {
      if (event.target.closest("a.bill-page-link, a.bill-page-open")) return;
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
  const headerSource = $("#contracts-header-source");
  if (headerSource) {
    headerSource.textContent = state.contractsLoadedAt
      ? `${filtered.length} exposed · USASpending`
      : "Connecting";
  }
  renderTabFilterContexts();
  clearSkeleton("#contracts-body");
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
        <a class="link-button" href="${contractPageUrl(row.symbol)}">Open full contract page →</a>
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
  renderBillsGuided();
  if (billsGuidedMode() === "guided") return;
  clearSkeleton("#bill-feed");
  const query = ($("#bill-filter")?.value || "").toLowerCase();
  const bills = filteredBillsRows();
  renderBillAlertCards();
  const feed = $("#bill-feed");
  if (!feed) return;
  if (!bills.length) {
    const focusMsg = state.focusSymbol
      ? `No bills linked to <strong>${escapeHtml(state.focusSymbol)}</strong> yet. <button type="button" class="link-button" data-view-jump="markets">Browse Markets</button> or clear focus.`
      : "";
    feed.innerHTML = focusMsg
      ? `<tr><td colspan="8"><div class="guided-empty-state">${focusMsg}</div></td></tr>`
      : isWatchlistScope()
        ? `<tr><td colspan="8">${watchlistEmptyStateHtml()}</td></tr>`
        : query
          ? `<tr><td colspan="8">No bill matched that filter. Try a ticker like LLY, NVDA, AMZN, COIN, or TSLA.</td></tr>`
          : `<tr><td colspan="8"><div class="guided-empty-state"><strong>No bills loaded yet.</strong> Bill data is still connecting — hit Refresh in the top bar, or start by filtering for a ticker you own (LLY, NVDA, TSLA) once the feed arrives.</div></td></tr>`;
    feed.querySelector("[data-feed-scope-set]")?.addEventListener("click", () => setFeedScope("all"));
    return;
  }
  feed.innerHTML = sortBillsForTable(bills).map((bill) => {
    const tickerLinks = (bill.affected || [])
      .map((ticker) => `<span class="ticker-inline-chip">${escapeHtml(ticker)}${shareCardLink(ticker, "Card")}</span>`)
      .join("");
    const status = billStatusInfo(bill);
    const stageColor = stageColorForBill(bill);
    const momentum = billMomentum(bill);
    const lobby = Number(bill.lobbyingPressureScore ?? 0);
    const catalyst = bill.catalyst || {};
    const prov = billProvenanceBadge(bill);
    const detailsId = `bill-detail-${escapeHtml(bill.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const idSub = bill.exactCongressRecord ? "" : `<span class="bill-id-sub mono">${escapeHtml(bill.id)}</span>`;
    const pageUrl = billPageUrl(bill);
    return `
      <tr class="clickable-row" data-bill-toggle="${detailsId}" role="button" tabindex="0" title="Expand quick preview · open full page from title">
        <td class="mono">
          <a class="bill-page-link" href="${escapeHtml(pageUrl)}">${escapeHtml(billDisplayLabel(bill))}</a>
          ${idSub}
          <small class="bill-source-mini ${prov.cls}">${escapeHtml(prov.text)}</small>
          <a class="bill-page-open muted" href="${escapeHtml(pageUrl)}">Full page →</a>
        </td>
        <td><a class="bill-page-link" href="${escapeHtml(pageUrl)}">${escapeHtml(bill.title || "")}</a></td>
        <td class="bill-stage-cell" data-label="Stage">
          <span class="status-stage-chip ${toneClassFromStatus(status.tone)}" style="color:${stageColor}">${escapeHtml(status.label)}</span>
          ${billLegislativeContext(bill)?.primaryCommittee && billLegislativeContext(bill).primaryCommittee !== "—"
            ? `<small class="stage-cell-committee">${escapeHtml(billLegislativeContext(bill).primaryCommittee)}</small>`
            : ""}
          <small class="stage-cell-next">${escapeHtml(status.nextStep || "")}</small>
        </td>
        <td data-label="Momentum"><span class="score-badge ${momentum >= 67 ? "high" : momentum < 35 ? "low" : "medium"}">${momentum}/100</span></td>
        <td data-label="Lobby pressure"><span class="score-badge ${lobby >= 67 ? "high" : lobby < 35 ? "low" : "medium"}">${lobby}/100</span></td>
        <td data-label="Confidence">${escapeHtml(billConfidenceLabel(bill))}</td>
        <td class="mono ticker-link-cell" data-label="Tickers">${tickerLinks || "—"}</td>
        <td class="bill-calendar-cell" data-label="Calendar">${billCalendarCellHtml(bill)}</td>
      </tr>
      <tr id="${detailsId}" hidden>
        <td colspan="8">
          <div class="bill-detail-shell">
            ${billLegislativeTimelineBlock(bill)}
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
            ${renderBillFecBlockFromPulse(bill)}
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
            ${historicalAnalogHtml(bill)}
            <p class="bill-source-note">${escapeHtml(billSourceNote(bill))}</p>
            ${bill.lobbyingSource === "senate_lda" ? `<p class="muted">Lobbying: ${escapeHtml(String(bill.lobbyingFilingsCount || 0))} matched LDA filing(s) · against $${escapeHtml(String(bill.lobbyingAgainst ?? "—"))}M · for $${escapeHtml(String(bill.lobbyingFor ?? "—"))}M</p>` : ""}
            <a class="link-button" href="${escapeHtml(pageUrl)}">Open full bill page →</a>
            <a class="link-button" target="_blank" rel="noopener noreferrer" href="${billSourceUrl(bill)}">${escapeHtml(billSourceLabel(bill))}</a>
          </div>
        </td>
      </tr>
    `;
  }).join("");
  renderBillStakeholders();
  renderPolicyCatalysts();
  renderTabFilterContexts();
}

/* Bill alert spotlight — renders the two highest-momentum tracked bills as
   legisAlertCard()s. Buttons inside the cards (Ask why, Explain metrics,
   Ask AI) are handled globally by setupLegisCardDelegation(). */
function renderBillAlertCards() {
  const host = $("#bill-alert-cards");
  if (!host) return;
  const top = policyBills()
    .slice()
    .sort((a, b) => billMomentum(b) - billMomentum(a))
    .slice(0, 2);
  if (!top.length) {
    host.innerHTML = `<div class="guided-empty-state"><strong>No alerts yet.</strong> High-momentum bills appear here as soon as the policy feed loads.</div>`;
    return;
  }
  host.innerHTML = top.map((bill) => legisAlertCard(bill, { compact: true })).join("");
}

function renderLobbying() {
  renderLobbyBridge();
  const feedEl = $("#lobby-feed");
  const emptyEl = $("#lobby-feed-empty");
  const sourceEl = $("#lobby-source");
  const badgeEl = $("#lobby-data-badge");
  const meta = state.feedMeta?.lobbying;
  const isLive = meta?.source === "senate_lda";
  const isSample = meta?.source === "fallback";
  if (sourceEl) {
    sourceEl.textContent = isLive ? "Senate LDA" : isSample ? "Sample filings" : "Connecting";
  }
  if (badgeEl) {
    badgeEl.textContent = isLive ? "Live LDA" : isSample ? "Sample filings" : "Connecting";
    badgeEl.className = `mini-pill ${isLive ? "green" : isSample ? "amber" : ""}`;
  }
  if (!feedEl) return;
  const filtered = (state.lobbying || []).filter(lobbyingMatchesTabFilters);
  if (!filtered.length) {
    feedEl.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      if (state.focusSymbol) {
        emptyEl.innerHTML = `<strong>No lobbying filings for ${escapeHtml(state.focusSymbol)} yet.</strong> Try clearing focus or broadening the issue keyword. <button type="button" class="link-button" data-view-jump="markets">Browse Markets</button>`;
      } else if (isSample) {
        emptyEl.innerHTML = `<strong>Showing sample filings.</strong> Live Senate LDA data is not configured — browse the sample feed or refresh to retry.`;
      } else if (!isLive) {
        emptyEl.innerHTML = `<strong>No lobbying filings loaded.</strong> The feed is still connecting — use Refresh in the top bar.`;
      }
    }
    renderTabFilterContexts();
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  feedEl.innerHTML = filtered.map((filing) => {
    const pageUrl = lobbyPageUrl(filing);
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
        <a class="lobby-card-title-link" href="${escapeHtml(pageUrl)}"><h3>${escapeHtml(filing.client)}</h3></a>
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
        <a class="link-button" href="${escapeHtml(pageUrl)}">Open full filing page →</a>
        ${connectedBill ? `<a class="link-button" href="${escapeHtml(billPageUrl(connectedBill))}">Related bill →</a>` : ""}
      </article>
    `;
  }).join("");
  renderTabFilterContexts();
  clearSkeleton("#lobby-feed");
}

function renderAccount() {
  renderTradeGuided();
  if (tradeGuidedMode() === "guided") return;
  const account = state.account?.account || {};
  $("#account-grid").innerHTML = [
    ["Liquid cash", money(Number(account.cash || account.buyingPower || 0)), "Available to buy stocks right now"],
    ["Equity", money(Number(account.equity || 0)), "Cash plus current paper positions"],
    ["Invested", money(Number(account.portfolioValue || 0)), "Current value of paper holdings"],
    ["Total return", `${signed(account.totalReturnPct || 0)}%`, `${money(Number(account.totalReturn || 0))} since the $100,000 start`]
  ].map(([label, value, subtitle]) => `
    <article class="overview-metric-cell" role="listitem">
      <span class="overview-metric-label">${escapeHtml(label)}</span>
      <strong class="overview-metric-value">${value}</strong>
      <small class="overview-metric-sub">${escapeHtml(subtitle)}</small>
    </article>
  `).join("");

  $("#paper-positions-body").innerHTML = (state.account?.positions || []).length
    ? state.account.positions.map((position) => `
      <tr class="${state.lastOrderSymbol && normalizeWatchSymbol(position.symbol) === state.lastOrderSymbol ? "position-row-highlight" : ""}">
        <td>${escapeHtml(position.symbol)}</td>
        <td>${fmt(position.qty)}</td>
        <td>${money(position.avgCost)}</td>
        <td>${money(position.price)}</td>
        <td>${money(position.marketValue)}</td>
        <td class="${position.unrealizedPnl >= 0 ? "up" : "down"}">${money(position.unrealizedPnl)} (${signed(position.unrealizedPnlPct)}%)</td>
        <td>${positionPolicyRiskHtml(position.symbol)}</td>
      </tr>
    `).join("")
    : `<tr class="empty-state-row"><td colspan="7"><div class="guided-empty-state positions-empty-state"><strong>No positions yet.</strong> Pick a symbol in the order ticket, choose a quantity, and place your first paper trade — you start with $100,000 of simulated cash. Nothing here touches real money.</div></td></tr>`;

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
    : `<article class="empty-state" style="padding:1.5rem;text-align:center"><p style="margin:0 0 0.35rem;font-weight:600">No orders yet</p><p class="muted" style="margin:0;font-size:0.85rem">Your paper trade history will appear here once you place an order.</p></article>`;

  renderTradePanel();
  renderPaperOrderPreview();
  if (isFeatureEnabled("FUNDS_HYPOTHETICALS_ENABLED")) void loadFunds();
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
  if (!isFeatureEnabled("FUNDS_HYPOTHETICALS_ENABLED")) return;
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
  if (!isFeatureEnabled("FUNDS_HYPOTHETICALS_ENABLED")) return;
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
  if (!isFeatureEnabled("FUNDS_HYPOTHETICALS_ENABLED")) return;
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
  if (!isFeatureEnabled("FUNDS_HYPOTHETICALS_ENABLED")) return;
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
    ctx.font = "12px Geist, sans-serif";
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
    ctx.font = node.kind === "symbol" ? "10px Geist Mono, monospace" : "9px Geist Mono, monospace";
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


