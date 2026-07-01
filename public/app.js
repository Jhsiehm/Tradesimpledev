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


