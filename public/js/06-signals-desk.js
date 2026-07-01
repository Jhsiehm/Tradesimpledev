/* Extracted from app.js lines 7909-9679 */
// ── Today's Top Signal ────────────────────────────────────────────────────────
// Surfaces the single highest-momentum bill on first open so users immediately
// understand the core value prop: policy → ticker connection.
function policyRefreshCadenceLabel() {
  const minutes = Math.max(1, Math.round(LIVE_FEED_INTERVALS.policyMs / 60000));
  return minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`;
}

function topSignalDataBasisLabel(bill) {
  if (bill?.exactCongressRecord) return "Live Congress record";
  if (bill?.scenarioOnly) return "Scenario model";
  if (bill?.sourceKind === "tradesimple_modeled_seed") return "Curated policy map";
  return "Policy feed";
}

function topSignalTrustMarkup(top, bills) {
  const meta = state.dataMeta.bills || {};
  const source = sourceLabel(meta.source || (top.exactCongressRecord ? "congress.gov" : "policy feed"));
  const freshness = freshnessText(meta.updatedAt);
  const liveCount = Number(meta.liveBillCount);
  const scenarioCount = Number(meta.scenarioBillCount);
  const coverage =
    Number.isFinite(liveCount) && Number.isFinite(scenarioCount)
      ? `${liveCount} live / ${scenarioCount} modeled`
      : `${bills.length} market-linked bills`;
  const basis = topSignalDataBasisLabel(top);
  const note = top.sourceNote || "Top signal is selected automatically from the current policy feed.";

  return `
    <div class="top-signal-trust" aria-label="Top signal source and refresh details">
      <span><span class="top-signal-trust-dot" aria-hidden="true"></span><strong>Auto-selected</strong> by highest momentum</span>
      <span>${escapeHtml(source)} · ${escapeHtml(freshness)} · refresh ${escapeHtml(policyRefreshCadenceLabel())}</span>
      <span>${escapeHtml(coverage)}</span>
      <span title="${escapeHtml(note)}">${escapeHtml(basis)}</span>
    </div>
  `;
}

function renderTopSignal() {
  const el = $("#signals-top-signal");
  if (!el) return;
  const type = state.signalsTypeFilter || "all";
  if (type !== "all" && type !== "bills") {
    el.hidden = true;
    return;
  }
  const bills = policyBills().filter((b) => !b.scenarioOnly && b.affected?.length && billMatchesFocusFilter(b));
  if (!bills.length) {
    if (isWatchlistScope() && !state.focusSymbol) {
      el.hidden = false;
      el.innerHTML = watchlistEmptyStateHtml();
      el.querySelector("[data-feed-scope-set]")?.addEventListener("click", () => setFeedScope("all"));
    }
    return;
  }

  // Pick the bill with the highest legislative momentum score
  const top = bills.slice().sort((a, b) => billMomentum(b) - billMomentum(a))[0];
  const momentum = billMomentum(top);
  const tickers = (top.affected || []).slice(0, 4);
  const conf = billConfidenceLabel ? billConfidenceLabel(top) : "Medium";
  const passImpact = (top.passImpacts || [])[0];
  const impactLine = passImpact
    ? `If passes → <strong>${escapeHtml(passImpact.sym)} ${passImpact.dir > 0 ? "↑" : "↓"} ${escapeHtml(passImpact.range || "")}</strong>`
    : `Affects: <strong>${tickers.map(escapeHtml).join(", ")}</strong>`;

  el.hidden = false;
  el.innerHTML = `
    <div class="top-signal-inner">
      <div class="top-signal-eyebrow">
        <span class="top-signal-dot"></span>
        <span>Today's top signal</span>
        <span class="mini-pill">${momentum}/100 momentum · ${escapeHtml(conf)} confidence</span>
        <button type="button" class="top-signal-dismiss" aria-label="Dismiss" title="Dismiss">✕</button>
      </div>
      <div class="top-signal-body">
        <div class="top-signal-copy">
          <h3>${escapeHtml(top.shortTitle || top.title)}</h3>
          <p>${escapeHtml(top.whyMarketsCare || top.plainEnglish || top.signal || "")}</p>
          <p class="top-signal-impact">${impactLine}</p>
        </div>
        <div class="top-signal-actions">
          <button type="button" class="button button-secondary" data-ask-why="${escapeHtml(top.id)}">Ask AI why →</button>
          <button type="button" class="button button-ghost" data-show-view="signals">All signals</button>
        </div>
      </div>
      ${topSignalTrustMarkup(top, bills)}
    </div>
  `;
  el.querySelector(".top-signal-dismiss")?.addEventListener("click", () => {
    el.hidden = true;
  });
}

function renderAiBanner() {
  // Show a persistent but unobtrusive banner when no AI key is configured server-side
  // and the user hasn't set a BYOK key either.
  const hasServerAi = Boolean(state.config?.data?.anthropic);
  const hasByok = byokIsConfigured();
  const existing = $("#ai-unconfigured-banner");
  if (hasServerAi || hasByok) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return; // already shown
  const drawer = globalResearchDrawerEl?.() || document.querySelector(".research-drawer");
  if (!drawer) return;
  const banner = document.createElement("div");
  banner.id = "ai-unconfigured-banner";
  banner.setAttribute("role", "status");
  banner.style.cssText = "background:rgba(200,148,44,0.12);border:1px solid rgba(200,148,44,0.35);border-radius:8px;padding:0.65rem 0.85rem;margin:0.75rem;font-size:0.82rem;line-height:1.5;display:flex;gap:0.5rem;align-items:flex-start";
  banner.innerHTML = `<span style="font-size:1rem;flex-shrink:0">⚠️</span><span>AI features need an API key. <button type="button" style="background:none;border:none;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;padding:0" onclick="document.querySelector('.byok-settings-btn')?.click()">Add your key →</button></span>`;
  drawer.prepend(banner);
}

function renderConnections() {
  const config = state.config;
  const grid = $("#connection-grid");
  if (!config || !grid) return;
  // Expose AI availability to inline scripts (e.g. causality loading message)
  document.body.dataset.anthropicReady = String(Boolean(config.data?.anthropic));
  renderAiBanner();
  const rows = [
    ["Email sign-in", config.auth.email, "Enabled by default"],
    ["Finnhub equities", config.data.finnhub, "FINNHUB_API_KEY"],
    ["CoinGecko crypto", config.data.coingecko, "COINGECKO_API_KEY"],
    ["Congress.gov bills", config.data.congress, "CONGRESS_API_KEY"],
    ["Senate LDA lobbying", config.data.senateLda, "SENATE_LDA_API_KEY"],
    ["FEC campaign finance", config.data.fec, "FEC_API_KEY"],
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
      <p class="connection-env-hint muted">Configure in Railway or <code>.env.local</code></p>
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
      ? renderEdgarSection(
          "Are the numbers moving the right way?",
          Array.isArray(simplified.numbersGoingRight)
            ? simplified.numbersGoingRight
            : [String(simplified.numbersGoingRight)]
        )
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

async function loadPolicyTrail(symbol) {
  if (!symbol) return null;
  try {
    const data = await fetchJson(`/api/policy-trail?ticker=${encodeURIComponent(symbol)}`);
    state.policyTrail = data;
    renderUnifiedPolicyTrail(data);
    return data;
  } catch (err) {
    console.warn("[policy-trail]", err);
    state.policyTrail = null;
    renderUnifiedPolicyTrail(null);
    return null;
  }
}

function renderUnifiedPolicyTrail(data) {
  const host = $("#analysis-unified-trail");
  if (!host) return;
  if (!data?.trail) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  const { fec, bills, lobbying, contracts } = data.trail;
  host.innerHTML = `
    <div class="money-trail-head">
      <h3>Unified money trail · ${escapeHtml(data.ticker)}</h3>
      <span class="mini-pill green">Explicit maps</span>
    </div>
    <p class="muted">FEC clusters, bills, LDA filings, and contract awards linked via fec-committee-map.json and policy-crosswalk.json.</p>
    ${renderExplainabilitySection("FEC clusters", fec || [], { idKey: "clusterKey", labelKey: "label" })}
    ${renderExplainabilitySection("Bills", bills || [], { idKey: "id", labelKey: "title" })}
    ${renderExplainabilitySection("Lobbying", lobbying || [], { idKey: "id", labelKey: "client" })}
    ${renderExplainabilitySection("Contracts", contracts || [], { idKey: "id", labelKey: "recipient" })}
  `;
}

async function loadAnalysis(symbol) {
  if (!isFeatureEnabled("ANALYSIS_LAB_ENABLED")) {
    state.activeAnalysisSymbol = symbol;
    state.analysis = null;
    return null;
  }
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
    void loadPolicyTrail(symbol);
  } catch (error) {
    console.error("[analysis] /api/share/stock failed:", error);
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
  const aiNarrator = isAiExplainerSource(explainer.source);

  if (nowEl) {
    if (aiNarrator) nowEl.innerHTML = aiAnalysisBulletsHtml(explainer.now || fallbackNow);
    else nowEl.textContent = explainer.now || fallbackNow;
  }
  if (whyEl) {
    if (aiNarrator) whyEl.innerHTML = aiAnalysisBulletsHtml(explainer.whyItMatters || fallbackWhy);
    else whyEl.textContent = explainer.whyItMatters || fallbackWhy;
  }
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
          ${(bill.affected || [])[0]
            ? `<a class="brief-trace-cta" href="${escapeHtml(publicStockCardUrl((bill.affected || [])[0]))}">Trace ${escapeHtml((bill.affected || [])[0])} →</a>`
            : ""}
          <button type="button" class="button button-ghost compact" data-methodology-bill="${escapeHtml(bill.id)}">Explain metrics</button>
          <button type="button" class="button button-secondary compact" data-ask-why="${escapeHtml(bill.id)}">Ask why (metrics)</button>
          <button type="button" class="button button-ghost compact" data-show-view="research">Ask AI</button>
        </div>
      </div>
    </article>
  `;
}

function renderBillStakeholders() {
  const el = $("#bill-stakeholders");
  if (!el) return;
  const network = state.policyNetwork;
  const fecPulses = (state.fecPulse?.pulses || []).filter((pulse) => {
    if (!state.focusSymbol) return true;
    return (pulse.tickers || []).includes(state.focusSymbol);
  });
  const fecHtml = fecPulses.length
    ? `
    <section class="fec-stakeholder-block money-context">
      <div class="money-context-head">
        <h4>Campaign finance lens</h4>
        <span class="mini-pill ${fecSourceBadge(state.fecPulse?.source).className}">${escapeHtml(fecSourceBadge(state.fecPulse?.source).label)}</span>
      </div>
      ${fecPulses.slice(0, 2).map((pulse) => `
        <article class="fec-pulse-card fec-pulse-card--compact">
          <p class="fec-pulse-line">${escapeHtml(pulse.plainEnglish || "")}</p>
          ${signalScanLineHtml({ source: "FEC", date: pulse.filingDate, tickers: pulse.tickers, band: pulse.period })}
        </article>`).join("")}
      <ul class="money-context-bullets">
        <li>What this means for markets: PAC filing spikes can precede committee markup — not a price forecast.</li>
        <li>Mapped tickers above share a policy cluster with this feed — verify against your holdings.</li>
      </ul>
      <button type="button" class="link-button" data-view-jump="fec">View all filings →</button>
    </section>`
    : "";
  if (!network?.stakeholderMap && !fecHtml) {
    el.innerHTML = `<article class="empty-state">Pick a ticker in Analysis Lab to load its stakeholder graph.</article>`;
    return;
  }
  if (network?.stakeholderMap) {
    $("#bill-network-source").textContent = sourceLabel(network.source?.relationships || "modeled");
  }
  const graphHtml = network?.stakeholderMap
    ? `
    <div class="stakeholder-side-head">
      <span class="mini-pill green">${escapeHtml(network.focusSymbol)}</span>
      <h3>${escapeHtml(network.summary?.headline || "Policy graph loaded")}</h3>
      <p>${escapeHtml(network.summary?.detail || "")}</p>
    </div>
    <div class="stakeholder-mini-list">
      ${(network.stakeholderMap.nodes || []).filter((node) => node.type !== "ticker").slice(0, 9).map((node) => `
        <div class="stakeholder-mini ${toneClass(node.tone)}">
          <span>${escapeHtml(node.label)}</span>
          <small>${escapeHtml(node.detail || node.title || "")}</small>
        </div>
      `).join("")}
    </div>
    <div class="relationship-flow compact-flow">
      ${(network.stakeholderMap.links || []).slice(0, 6).map((link) => {
        const nodes = network.stakeholderMap.nodes || [];
        const from = nodes.find((node) => node.id === link.from);
        const to = nodes.find((node) => node.id === link.to);
        return `
          <article class="relationship-link ${toneClass(link.tone)}">
            <strong>${escapeHtml(from?.label || "Signal")} -> ${escapeHtml(to?.label || "Bill")}</strong>
            <p>${escapeHtml(link.label || "")}</p>
          </article>
        `;
      }).join("")}
    </div>`
    : "";
  el.innerHTML = `${fecHtml}${graphHtml}`;
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
      <a class="bill-page-link" href="${escapeHtml(billPageUrl(bill))}"><span class="mini-pill">${escapeHtml(bill.displayId || bill.id)}</span></a>
      <h3><a class="bill-page-link" href="${escapeHtml(billPageUrl(bill))}">${escapeHtml(bill.title)}</a></h3>
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

const SIGNAL_OVERVIEW_VISIBLE = 3;
let _signalFeedExpanded = false;

function signalSourceLabel(sig) {
  if (sig.type === "fec") return "FEC";
  if (sig.type === "contract") return "USASpending.gov";
  if (sig.type === "lobbying") return "Senate LDA";
  return sig._billId || "Congress.gov";
}

function signalConfidenceFor(sig) {
  if (sig._billId) {
    const bill = policyBills().find((item) => item.id === sig._billId);
    if (bill) return billConfidenceLabel(bill);
  }
  return sig.type === "contract" ? "Medium" : "Modeled";
}

function signalPlainEnglish(sig) {
  const mechanism = sig.chain?.[1] || sig.title || "";
  return twelveWordSummary(mechanism);
}

function signalDrillAttrs(sig) {
  if (sig._billId) {
    return drilldownAttrs("bills", { billId: sig._billId }, `Open ${sig._billId} in Bills`);
  }
  if (sig._fecKey) {
    return `data-fec-brief="${escapeHtml(sig._fecKey)}" tabindex="0" role="link" aria-label="Open FEC brief for ${escapeHtml(sig._fecKey)}"`;
  }
  if (sig._contractSymbol) {
    return drilldownAttrs("view", { viewName: "contracts" }, "Open contracts view");
  }
  return "";
}

function renderSignalRanges(sig) {
  const impacts = sig.impacts.slice(0, 4);
  if (!impacts.length) {
    return sig.tickers.length
      ? `<div class="signal-range-row"><span>${escapeHtml(sig.tickers[0])}</span><span class="muted">Exposure</span></div>`
      : "";
  }
  return impacts
    .map((imp) => {
      const arrow = imp.dir > 0 ? "+" : imp.dir < 0 ? "−" : "±";
      const range = imp.range ? imp.range.replace(/^\+/, "") : "—";
      const cls = imp.dir < 0 ? "down" : "muted";
      return `<div class="signal-range-row"><span>${escapeHtml(imp.sym)}</span><span class="${cls}">${arrow}${escapeHtml(range)}</span></div>`;
    })
    .join("");
}

function renderSignalTickerRow(tickers, compact) {
  const list = tickers.slice(0, compact ? 4 : 6);
  if (!list.length) return "";
  return `<div class="signal-ticker-row${compact ? " signal-ticker-row--compact" : ""}">${list
    .map((t) => `<span class="signal-ticker-chip">${escapeHtml(t)}</span>`)
    .join("")}</div>`;
}

function renderFeaturedSignal(sig) {
  const typeLabel =
    sig.type === "fec" ? "FEC" : sig.type === "lobbying" ? "Lobby" : sig.type === "contract" ? "Contract" : "Bill";
  const typeClass = `signal-type--${sig.type}`;
  const source = signalSourceLabel(sig);

  return `
    <article class="signal-featured intel-card ${typeClass} actionable-card" ${signalDrillAttrs(sig)} tabindex="0" role="button" aria-label="${escapeHtml(sig.title)}">
      <header class="signal-featured-head">
        <span class="signal-type-label">${typeLabel}</span>
        <span class="signal-score-mono">${sig.score}/100</span>
      </header>
      <div class="signal-featured-body">
        <div class="signal-featured-main">
          <p class="signal-plain">${escapeHtml(signalPlainEnglish(sig))}</p>
          ${signalScanLineHtml({ source, date: sig.date, tickers: sig.tickers, band: momentumBandLabel(sig.score) })}
          ${sig.type === "fec" && sig._linkCounts ? renderFecLinkChips({ linkCounts: sig._linkCounts }, { compact: true }) : ""}
        </div>
        <div class="signal-ranges-col" aria-label="Predicted ranges">
          ${renderSignalRanges(sig)}
        </div>
      </div>
    </article>
  `;
}

function renderSecondarySignal(sig) {
  const typeLabel =
    sig.type === "fec" ? "FEC" : sig.type === "lobbying" ? "Lobby" : sig.type === "contract" ? "Contract" : "Bill";
  const typeClass = `signal-type--${sig.type}`;
  const source = signalSourceLabel(sig);

  return `
    <article class="signal-secondary intel-card ${typeClass} actionable-card" ${signalDrillAttrs(sig)} tabindex="0" role="button" aria-label="${escapeHtml(sig.title)}">
      <div class="signal-secondary-head">
        <span class="signal-type-label">${typeLabel}</span>
        <span class="signal-secondary-title">${escapeHtml(sig.title)}</span>
        <span class="signal-score-mono">${sig.score}/100</span>
      </div>
      ${signalScanLineHtml({ source, date: sig.date, tickers: sig.tickers, band: momentumBandLabel(sig.score) })}
      ${sig.type === "fec" && sig._linkCounts ? renderFecLinkChips({ linkCounts: sig._linkCounts }, { compact: true }) : ""}
    </article>
  `;
}

function observeSignalReveal(container) {
  if (!container || typeof IntersectionObserver === "undefined") {
    container?.querySelectorAll(".signal-featured, .signal-secondary").forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const nodes = container.querySelectorAll(".signal-featured, .signal-secondary");
  if (!nodes.length) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { root: null, threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  nodes.forEach((node, index) => {
    if (index === 0) node.classList.add("is-visible");
    observer.observe(node);
  });
  requestAnimationFrame(() => {
    nodes.forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92) node.classList.add("is-visible");
    });
  });
}

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

  // FEC campaign finance signals
  for (const pulse of state.fecPulse?.pulses || []) {
    const val = Number(String(pulse.amountSummary || "").replace(/[^\d.]/g, "")) || 0;
    const score = Math.min(95, Math.round(val / 0.05 + (pulse.recentFilings || 0) * 8 + 40));
    const date = pulse.filingDate || state.fecPulse?.updatedAt || "";
    const tickers = (pulse.tickers || []).slice(0, 4);
    signals.push({
      type: "fec",
      score,
      date,
      tickers,
      title: `${pulse.committee || pulse.label} — ${pulse.amountSummary || "FEC activity"}`,
      chain: ["FEC", pulse.plainEnglish || pulse.label || "", tickers.join(", ") || "Policy cluster"],
      impacts: tickers.map((sym) => ({ sym, dir: 0, range: "Exposure" })),
      footer: `${pulse.chamber || ""} · ${pulse.period || state.fecPulse?.cycle || ""}`.trim(),
      footerDate: pulse.filingDate || "",
      sortKey: score * signalRecencyFactor(date),
      _fecKey: pulse.clusterKey || pulse.committee,
      _fecUrl: pulse.fecUrl || null,
      _linkCounts: pulse.linkCounts || null
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

function renderSignalFeed() {
  const feed = $("#signal-chain-feed");
  const footer = $("#signal-chain-footer");
  if (!feed) return;

  const signals = buildSignalFeed().filter((sig) => signalMatchesTypeFilter(sig) && signalMatchesFocusFilter(sig));

  if (!signals.length) {
    const focusMsg = state.focusSymbol ? ` for ${state.focusSymbol}` : "";
    feed.innerHTML = isWatchlistScope() && !state.focusSymbol
      ? watchlistEmptyStateHtml()
      : `<div class="sc-empty muted">No signals${escapeHtml(focusMsg)} match this filter — waiting for bills and contract data.</div>`;
    feed.querySelector("[data-feed-scope-set]")?.addEventListener("click", () => setFeedScope("all"));
    if (footer) footer.hidden = true;
    return;
  }

  const featured = signals[0];
  const secondary = _signalFeedExpanded ? signals.slice(1) : signals.slice(1, SIGNAL_OVERVIEW_VISIBLE);
  feed.innerHTML = [
    renderFeaturedSignal(featured),
    secondary.length
      ? `<div class="signal-secondary-list">${secondary.map(renderSecondarySignal).join("")}</div>`
      : ""
  ].join("");

  observeSignalReveal(feed);

  if (footer) {
    const hasMore = signals.length > SIGNAL_OVERVIEW_VISIBLE;
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
  const isCurrentSeed =
    String(bill.id || "").endsWith(`-${CURRENT_CONGRESS}`) || bill.scenarioOnly || bill.scenarioId;
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
  const convBand = m >= 67 ? "high" : m < 35 ? "low" : "medium";
  const conf = billConfidenceLabel(bill);
  const status = billStatusInfo(bill);
  const tickers = (bill.affected || []).slice(0, 4);
  const source = bill.exactCongressRecord ? "Congress.gov" : bill.id || "Policy feed";
  return `
    <article class="sc-card intel-card sc-card--bill sc-card-conviction sc-card-conviction--${convBand} actionable-card" ${drilldownAttrs("bills", { billId: bill.id }, `Open ${bill.id} in Bills`)}>
      <div class="sc-card-header">
        <span class="sc-type-badge">Bill</span>
        <span class="score-badge ${m >= 67 ? "high" : m < 35 ? "low" : "medium"}">${m}/100</span>
        <span class="mini-pill muted">${escapeHtml(conf)}</span>
      </div>
      <h3 class="sc-title">${escapeHtml(bill.title)}</h3>
      ${signalScanLineHtml({ source, date: bill.latestActionDate || bill.introduced, tickers, band: momentumBandLabel(m) })}
      <p class="sc-sub">${escapeHtml(bill.impact || bill.signal || status.label || "")}</p>
    </article>
  `;
}

function buildNavigation() {
  const navItems = [
    { id: "overview", label: "Home", enabled: isViewEnabled("overview") },
    { id: "thesis", label: "Thesis Lab", enabled: isViewEnabled("thesis") },
    { id: "signals", label: "Signals", enabled: isViewEnabled("signals") },
    { id: "trade", label: "Account", enabled: isViewEnabled("trade") },
    { id: "bills", label: "Bills", enabled: isViewEnabled("bills") },
    { id: "lobbying", label: "Lobbying", enabled: isViewEnabled("lobbying") },
    { id: "fec", label: "FEC Filings", enabled: isViewEnabled("fec") },
    { id: "contracts", label: "Contracts", enabled: isViewEnabled("contracts") },
    { id: "analysis", label: "Analysis", enabled: isViewEnabled("analysis") },
    { id: "markets", label: "Markets", enabled: isViewEnabled("markets") },
    { id: "track-record", label: "Track Record", enabled: isViewEnabled("track-record") },
    { id: "settings", label: "Settings", enabled: isViewEnabled("settings") }
  ];
  return navItems.filter((item) => item.enabled);
}

function syncOnboardingSteps() {
  const checklist = $("#onboarding-checklist");
  if (!checklist) return;
  const stepViews = {
    watchlist: "overview",
    thesis: "thesis",
    bills: "bills",
    share: "bills"
  };
  checklist.querySelectorAll("li[data-step]").forEach((li) => {
    const view = stepViews[li.dataset.step];
    li.hidden = view ? !isViewEnabled(view) : false;
  });
  const watchlistCopy = checklist.querySelector('[data-step="watchlist"] p');
  if (watchlistCopy && !isFeatureEnabled("SETTINGS_PAGE_ENABLED")) {
    watchlistCopy.textContent = "Use the ☆ button on Markets to add tickers — they sync across devices when you are signed in.";
  }
  const billsCopy = checklist.querySelector('[data-step="bills"] p');
  if (billsCopy && !isFeatureEnabled("LOBBYING_EXPLORER_ENABLED")) {
    billsCopy.textContent = "Open a bill, follow the causal chain, and jump to exposed tickers.";
  }
  const shareCopy = checklist.querySelector('[data-step="share"] p');
  if (shareCopy) {
    shareCopy.textContent = "Bills, contracts, and stocks have public share pages you can send to collaborators.";
  }
}

function applyFeatureGateVisibility() {
  const enabledViews = new Set(buildNavigation().map((item) => item.id));
  syncOnboardingSteps();
  document.querySelectorAll("[data-view]").forEach((button) => {
    const view = button.dataset.view;
    button.hidden = !enabledViews.has(view);
    button.setAttribute("aria-hidden", button.hidden ? "true" : "false");
  });
  document.querySelectorAll("[data-view-jump], [data-show-view], [data-onboarding-go]").forEach((button) => {
    const view = button.dataset.viewJump || button.dataset.showView || button.dataset.onboardingGo;
    if (!view) return;
    const enabled = isViewEnabled(view);
    button.hidden = !enabled;
    button.disabled = !enabled;
    button.setAttribute("aria-hidden", enabled ? "false" : "true");
  });
  document.querySelectorAll(".view[id^='view-']").forEach((section) => {
    const view = section.id.replace(/^view-/, "");
    const disabled = !isViewEnabled(view);
    section.hidden = disabled;
    if (disabled) section.classList.remove("active");
  });
  document.querySelectorAll("[data-thesis-outer='map'], #thesis-pane-map").forEach((el) => {
    el.hidden = !isFeatureEnabled("RELATIONSHIP_MAPS_ENABLED");
  });
  if (!isFeatureEnabled("RELATIONSHIP_MAPS_ENABLED")) {
    document.querySelector("[data-thesis-outer='map']")?.classList.remove("active");
    document.getElementById("thesis-pane-map")?.classList.remove("active");
    document.querySelector("[data-thesis-outer='build']")?.classList.add("active");
    document.getElementById("thesis-pane-build")?.classList.add("active");
  }
  document.querySelectorAll(".research-drawer-btn, .research-drawer-global, .byok-settings-btn, #analysis-ticker-ai-btn").forEach((el) => {
    el.hidden = !isFeatureEnabled("AI_RESEARCH_ENABLED");
  });
  const fundsPanel = document.getElementById("hypothetical-funds-fold") || document.getElementById("hypothetical-funds-panel");
  if (fundsPanel) fundsPanel.hidden = !isFeatureEnabled("FUNDS_HYPOTHETICALS_ENABLED");
}

function setupNavigation() {
  applyFeatureGateVisibility();
  document.querySelectorAll("[data-view], [data-view-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view || button.dataset.viewJump;
      if (!isViewEnabled(view)) return;
      showView(view);
    });
  });
}

function globalResearchDrawerEl() {
  return document.querySelector("aside.research-drawer-global");
}

function openGlobalResearchDrawer() {
  if (!isFeatureEnabled("AI_RESEARCH_ENABLED")) return;
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
  if (view === "home") view = "overview";
  if (!isViewEnabled(view)) {
    showView(disabledFeatureFallbackView(), updateUrl);
    return;
  }

  /* Research UI lives in the global drawer; there is no #view-research — pair drawer with Bills so nav/state stay coherent. */
  if (view === "research") {
    if (!isFeatureEnabled("AI_RESEARCH_ENABLED")) return showView(disabledFeatureFallbackView(), updateUrl);
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
  syncMobileBottomNav(view);
  if (view === "overview" || view === "signals") markGuidedDemoStep("brief");
  if (view === "bills" || view === "contracts") markGuidedDemoStep("bill");
  if (view === "trade") markGuidedDemoStep("trade");
  if (updateUrl && view) {
    const params = new URLSearchParams(window.location.search);
    params.set("view", view);
    if (view === "analysis") params.set("symbol", state.activeAnalysisSymbol);
    if (view === "trade") params.set("symbol", state.tradeSymbol);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }
  if (view === "analysis" && isFeatureEnabled("ANALYSIS_LAB_ENABLED") && !state.analysis) loadAnalysis(state.activeAnalysisSymbol);
  if (view === "trade" && !state.tradeHistory) loadTradeHistory(state.tradeSymbol, state.tradeRange);
  if (view === "trade") {
    if (!state.account) {
      showSkeleton("#account-grid", 4, "default");
      showSkeleton("#paper-positions-body", 3, "row");
      showSkeleton("#paper-orders", 2, "card");
    }
    renderAccount();
  }
  if (view === "markets" && isViewEnabled("markets")) {
    renderMarkets();
    if (!state.marketsCatalogQuotesLoaded) {
      showSkeleton("#market-body", 8, "row");
      void loadMarketsData().finally(() => clearSkeleton("#market-body"));
    }
  }
  if (view === "overview" || view === "signals") {
    renderSinceLastVisitStrip();
  }
  if (view === "signals" && isViewEnabled("signals")) {
    if (!state.bills?.length && !state.trending?.length) showSkeleton("#signal-list", 4, "card");
    renderSignalsDesk();
  }
  if (view === "bills" && isFeatureEnabled("BILLS_EXPLORER_ENABLED")) {
    if (!state.bills?.length) showSkeleton("#bill-feed", 5, "card");
    renderBills();
  }
  if (view === "contracts" && isFeatureEnabled("CONTRACTS_ANALYZER_ENABLED")) {
    renderContractsTabWatch();
    if (!state.contractsLoadedAt) {
      showSkeleton("#contracts-body", 6, "row");
      void refreshContractsFeed().finally(() => clearSkeleton("#contracts-body"));
    } else {
      renderContracts();
    }
  }
  if (view === "lobbying" && isFeatureEnabled("LOBBYING_EXPLORER_ENABLED")) {
    if (!state.lobbying?.length) {
      showSkeleton("#lobby-feed", 4, "card");
      void refreshPolicyFeed().finally(() => clearSkeleton("#lobby-feed"));
    } else renderLobbying();
  }
  if (view === "fec" && isViewEnabled("fec")) {
    if (!state.fecPulse?.pulses?.length) {
      showSkeleton("#fec-feed", 4, "card");
      void refreshFecPulse().finally(() => clearSkeleton("#fec-feed"));
    } else renderFecView();
  }
  if (view === "track-record" && isFeatureEnabled("ADVANCED_ANALYTICS_ENABLED")) void loadTrackRecord();
  if (view === "thesis") {
    ensureThesisLabReady();
    thesisSyncIntakeState({ renderSummary: true });
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
  setSymbolPickerValue(select, state.activeAnalysisSymbol, { notify: false });
  wireSymbolCombobox(select);
  select.addEventListener("change", () => {
    state.activeAnalysisSymbol = normalizeWatchSymbol(select.value);
    setFocusSymbol(state.activeAnalysisSymbol, { render: true, syncAnalysis: false });
    if ($("#view-analysis")?.classList.contains("active")) {
      const params = new URLSearchParams(window.location.search);
      params.set("view", "analysis");
      params.set("symbol", state.activeAnalysisSymbol);
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    }
    loadAnalysis(state.activeAnalysisSymbol);
  });
}

function setupTradeControls() {
  const symbolSelect = $("#order-symbol");
  const qtyInput = $("#order-qty");
  const sideSelect = $("#order-side");
  if (!symbolSelect) return;
  setSymbolPickerValue(symbolSelect, state.tradeSymbol, { notify: false });
  wireSymbolCombobox(symbolSelect);
  symbolSelect.addEventListener("change", () => {
    state.tradeSymbol = normalizeWatchSymbol(symbolSelect.value);
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
  let _billFilterTimer = 0;
  $("#bill-filter").addEventListener("input", () => {
    clearTimeout(_billFilterTimer);
    _billFilterTimer = setTimeout(renderBills, 200);
  });
  $("#clear-bill-filter").addEventListener("click", () => {
    $("#bill-filter").value = "";
    renderBills();
  });
  const billSort = $("#bill-sort");
  if (billSort) {
    billSort.value = state.billSort || "recent";
    billSort.addEventListener("change", () => {
      state.billSort = billSort.value || "recent";
      renderBills();
    });
  }
  $("#terminal-search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toUpperCase();
    if (!query) return;
    if (isTrackedTicker(query)) {
      setFocusSymbol(query, { render: true });
      showView("markets");
    }
    if (state.bills.some((bill) => [bill.id, bill.title, ...(bill.affected || [])].join(" ").toUpperCase().includes(query))) {
      setFocusSymbol(query, { render: true });
      showView("bills");
      $("#bill-filter").value = query;
      renderBills();
    }
  });
}

