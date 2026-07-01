/* Extracted from app.js lines 1408-2619 */
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
