/* Extracted from app.js lines 4774-6324 */
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
