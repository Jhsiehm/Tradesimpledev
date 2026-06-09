const READER_MODE_KEY = "ts_reader_mode";
const THEME_KEY = "ts_theme";
const BRIEF_MODE_KEY = "ts_stock_brief_mode";

const state = {
  symbol: document.body.dataset.symbol || pathSymbol() || "NVDA",
  readerMode: storedReaderMode(),
  theme: storedTheme(),
  briefMode: storedBriefMode(),
  data: null,
  steps: [],
  stepIndex: 0
};

document.addEventListener("DOMContentLoaded", () => {
  applyTheme(state.theme);
  loadStockCard();
});

function pathSymbol() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return (parts[1] || "").toUpperCase().replace(/[^A-Z.]/g, "");
}

function storedReaderMode() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("mode");
  if (isReaderMode(fromUrl)) return fromUrl;
  try {
    const stored = localStorage.getItem(READER_MODE_KEY);
    if (isReaderMode(stored)) return stored;
  } catch (_) {}
  return "investor";
}

function isReaderMode(mode) {
  return mode === "citizen" || mode === "investor" || mode === "analyst";
}

function storedTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch (_) {}
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function storedBriefMode() {
  return BriefShell.storedMode(BRIEF_MODE_KEY, "guided");
}

function persistBriefMode(mode) {
  state.briefMode = BriefShell.persistMode(BRIEF_MODE_KEY, mode);
}

function applyTheme(theme) {
  const normalized = theme === "light" ? "light" : "dark";
  state.theme = normalized;
  document.documentElement.dataset.theme = normalized;
  try {
    localStorage.setItem(THEME_KEY, normalized);
  } catch (_) {}
}

async function loadStockCard() {
  const root = document.getElementById("stock-card-root");
  const fetchMode = state.briefMode === "guided" ? "citizen" : state.readerMode;
  try {
    const data = await fetchJson(`/api/share/stock?symbol=${encodeURIComponent(state.symbol)}&mode=${encodeURIComponent(fetchMode)}`);
    state.symbol = data.symbol || state.symbol;
    state.data = data;
    document.title = `${state.symbol} government-to-market explainer | TradeSimple`;
    renderApp();
  } catch (err) {
    root.innerHTML = `
      <section class="stock-card-error">
        <span class="mini-label">Snapshot unavailable</span>
        <h1>${escapeHtml(state.symbol)}</h1>
        <p>${escapeHtml(err.message || "Could not load the public stock card.")}</p>
        <a class="card-button" href="/dashboard?view=analysis">Open dashboard</a>
      </section>`;
  }
}

let stockBriefShell = null;

function renderApp() {
  const root = document.getElementById("stock-card-root");
  const data = state.data;
  if (!data) return;
  state.steps = buildSteps(data);
  if (state.stepIndex >= state.steps.length) state.stepIndex = 0;
  if (stockBriefShell) BriefShell.detachWalkthrough(stockBriefShell);
  stockBriefShell = {
    prefix: "bill",
    storageKey: BRIEF_MODE_KEY,
    labels: { full: "Full brief", lastNext: "Open dashboard", next: "Continue", back: "← Back" },
    escapeHtml,
    getMode: () => state.briefMode,
    setMode: (m) => {
      persistBriefMode(m);
    },
    getSteps: () => state.steps.map((s) => ({ ...s, title: s.short, sectionRef: s.ref })),
    getStepIndex: () => state.stepIndex,
    setStepIndex: (i) => {
      state.stepIndex = i;
    },
    isActive: () => state.briefMode === "guided",
    onLastStepNext: () => {
      window.location.href = `/dashboard?view=analysis&symbol=${encodeURIComponent(state.symbol)}`;
    },
    ctx: data
  };
  if (state.briefMode === "guided") {
    root.innerHTML = renderGuided(data);
    bindSharedControls(data);
    BriefShell.attachWalkthrough(stockBriefShell);
  } else {
    root.innerHTML = renderFullBrief(data);
    bindSharedControls(data);
  }
}

/* ---------- shared controls ---------- */

function bindSharedControls(data) {
  document.querySelectorAll("[data-reader-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.readerMode;
      if (!isReaderMode(mode) || mode === state.readerMode) return;
      state.readerMode = mode;
      try {
        localStorage.setItem(READER_MODE_KEY, mode);
      } catch (_) {}
      loadStockCard();
    });
  });

  document.querySelectorAll("[data-theme-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.themeMode === "light" ? "light" : "dark";
      applyTheme(theme);
      document.querySelectorAll("[data-theme-mode]").forEach((item) => {
        item.classList.toggle("active", item.dataset.themeMode === theme);
        item.setAttribute("aria-pressed", String(item.dataset.themeMode === theme));
      });
    });
  });

  const share = document.getElementById("public-share-copy");
  if (share) {
    share.addEventListener("click", async () => {
      const url = `${window.location.origin}/stock/${encodeURIComponent(state.symbol)}`;
      try {
        await navigator.clipboard.writeText(url);
        share.textContent = "Link copied";
        window.setTimeout(() => {
          share.textContent = "Copy link";
        }, 1600);
      } catch (_) {
        share.textContent = url;
      }
    });
  }

  document.querySelectorAll("[data-brief-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.briefMode;
      if (mode === state.briefMode) return;
      persistBriefMode(mode);
      state.stepIndex = 0;
      loadStockCard();
      window.scrollTo({ top: 0 });
    });
  });
}

function modeToggleHtml() {
  return BriefShell.modeToggleHtml(state.briefMode, { full: "Full brief" });
}

function heroActionsHtml() {
  return `
    <div class="bill-card-actions">
      <button type="button" class="card-button ghost" id="public-share-copy">Copy link</button>
      <a class="card-button ghost" href="/dashboard?view=analysis">Dashboard</a>
    </div>`;
}

function themeSwitchHtml() {
  return `
    <div class="theme-switch" aria-label="Theme mode">
      <button type="button" data-theme-mode="dark" class="${state.theme === "dark" ? "active" : ""}" aria-pressed="${state.theme === "dark"}">Dark</button>
      <button type="button" data-theme-mode="light" class="${state.theme === "light" ? "active" : ""}" aria-pressed="${state.theme === "light"}">Light</button>
    </div>`;
}

function classifyBarHtml(data) {
  return `
    <div class="dossier-classify mono" aria-hidden="true">
      <span class="dossier-classify-id">TRADESIMPLE STOCK BRIEF&ensp;//&ensp;${escapeHtml((data.symbol || state.symbol).toUpperCase())}</span>
      <span class="dossier-classify-note">GOVERNMENT-TO-MARKET&ensp;·&ensp;NOT INVESTMENT ADVICE</span>
    </div>`;
}

function dossierMetaHtml(data) {
  const quote = data.quote || {};
  const quoteMeta = formatQuoteMeta(quote, data.updatedAt);
  const policyRow = (data.charts?.riskRadar || []).find((row) => /policy/i.test(row.label || ""));
  const rows = [
    ["Symbol", (data.symbol || state.symbol).toUpperCase()],
    ["Company", data.company?.name || data.symbol || "—"],
    ["Quote", quote.price ? money(quote.price) : "Unavailable"],
    ["Policy exposure", policyRow ? `${Math.round(Number(policyRow.value || 0))}/100` : "—"]
  ];
  return `
    <dl class="dossier-meta mono">
      ${rows
        .map(
          ([label, value]) =>
            `<div class="dossier-meta-row"><dt>${escapeHtml(label)}</dt><span class="dossier-leader" aria-hidden="true"></span><dd>${escapeHtml(String(value).toUpperCase())}</dd></div>`
        )
        .join("")}
    </dl>
    <p class="muted mono stock-meta-note">${escapeHtml(quoteMeta)}</p>`;
}

/* ---------- guided walkthrough ---------- */

function buildSteps(data) {
  const explainer = data.explainer || {};
  const evidence = data.evidence || {};
  const riskRows = data.charts?.riskRadar || [];
  const steps = [];

  steps.push({
    id: "exposure",
    short: "Exposure",
    ref: "Policy exposure",
    html: stepExposureHtml(data)
  });

  const changedHtml = stepChangedHtml(data.whatChanged, evidence);
  if (changedHtml) {
    steps.push({ id: "changed", short: "What changed", ref: "Recent updates", html: changedHtml });
  }

  steps.push({
    id: "now",
    short: "Happening now",
    ref: "Plain English signal",
    html: stepNowHtml(explainer, data)
  });

  steps.push({
    id: "matter",
    short: "Why it matters",
    ref: "Market mechanism",
    html: stepMatterHtml(explainer, evidence)
  });

  steps.push({
    id: "watch",
    short: "Watch next",
    ref: "Forward watch",
    html: stepWatchHtml(explainer, data)
  });

  if (riskRows.length) {
    steps.push({
      id: "scores",
      short: "Scores",
      ref: "Sensitivity metrics",
      html: stepScoresHtml(riskRows, data)
    });
  }

  return steps;
}

function stepExposureHtml(data) {
  const quote = data.quote || {};
  const pct = Number(quote.pct ?? quote.changePercent ?? 0);
  const changeClass = pct >= 0 ? "up" : "down";
  const explainer = data.explainer || {};
  const headline = data.governmentSignals?.headline || explainer.headline || "";
  const policyRow = (data.charts?.riskRadar || []).find((row) => /policy/i.test(row.label || ""));
  const policyCaption = policyRow?.caption || policyRow?.explain || data.governmentSignals?.detail || "";
  return `
    <p class="bill-card-id mono">${escapeHtml(data.symbol)} · ${escapeHtml(data.company?.name || data.symbol)}</p>
    <h1 class="bill-guided-title">${escapeHtml(headline || `${data.symbol} government-to-market profile`)}</h1>
    <div class="bill-guided-facts">
      <div class="bill-guided-fact">
        <span class="bill-guided-fact-label">Quote context</span>
        <p><strong class="mono">${quote.price ? money(quote.price) : "Unavailable"}</strong>${quote.price ? ` <span class="${changeClass} mono">${signed(quote.change || 0)} / ${signed(pct)}%</span>` : ""}</p>
      </div>
      ${policyCaption
        ? `<div class="bill-guided-fact">
            <span class="bill-guided-fact-label">Policy exposure summary</span>
            <p>${escapeHtml(policyCaption)}</p>
            ${policyRow ? `<p class="muted mono bill-guided-fact-date">Policy exposure score ${Math.round(Number(policyRow.value || 0))}/100</p>` : ""}
          </div>`
        : ""}
    </div>
    <p class="hero-disclaimer stock-guided-disclaimer">Market data may be delayed. TradeSimple explains policy-market relationships, not investment advice.</p>`;
}

function stepChangedHtml(whatChanged, evidence) {
  const items = Array.isArray(whatChanged?.items) ? whatChanged.items.slice(0, 4) : [];
  if (!items.length) return "";
  return `
    <h2 class="bill-step-title">What changed recently?</h2>
    <div class="stock-guided-changed">
      ${items.slice(0, 3).map((item) => `
        <article class="changed-item ${escapeHtml(item.severity || "info")}">
          <span>${escapeHtml(item.label || "Snapshot item")}</span>
          <p>${escapeHtml(item.detail || String(item))}</p>
        </article>`).join("")}
    </div>
    ${sourceDetails("Why this appears", [
      ...items,
      evidence?.recentNews?.[0]?.headline ? {
        label: "Top headline",
        detail: evidence.recentNews[0].headline,
        sourceType: evidence.recentNews[0].sourceLabel || evidence.recentNews[0].source || "News",
        freshness: evidence.recentNews[0].publishedAt,
        confidence: evidence.recentNews[0].confidence || "Medium",
        reason: "Top company headline included in the current news window."
      } : null
    ])}`;
}

function stepNowHtml(explainer, data) {
  const copy = readerModeCopy("citizen");
  return `
    <h2 class="bill-step-title">${escapeHtml(copy.signalLabel)}</h2>
    <p class="bill-guided-lede">${escapeHtml(explainer.now || data.governmentSignals?.detail || "No government signal summary available.")}</p>
    ${sourceDetails("Sources", evidenceSummaryItems(data.evidence || {}, "policy"))}`;
}

function stepMatterHtml(explainer, evidence) {
  const copy = readerModeCopy("citizen");
  return `
    <h2 class="bill-step-title">${escapeHtml(copy.mechanismLabel)}</h2>
    <p class="bill-guided-lede">${escapeHtml(explainer.whyItMatters || "Government action can matter through revenue, margins, capex, compliance costs, contract visibility, and investor expectations.")}</p>
    ${sourceDetails("Evidence", evidenceSummaryItems(evidence, "mechanism"))}`;
}

function stepWatchHtml(explainer, data) {
  const copy = readerModeCopy("citizen");
  const watchItems = (explainer.watchFor || []).slice(0, 4);
  return `
    <h2 class="bill-step-title">${escapeHtml(copy.watchLabel)}</h2>
    <ul class="bill-guided-watchlist">${watchItems.length ? watchItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>New filings, rule text, contracts, and company commentary.</li>"}</ul>
    <div class="bill-guided-cta">
      <a class="card-button bill-cta-primary" href="/dashboard?view=analysis&symbol=${encodeURIComponent(data.symbol || state.symbol)}">Open on dashboard</a>
      <button type="button" class="card-button ghost" data-brief-mode="full">Switch to full brief</button>
    </div>
    <p class="muted bill-guided-note">${escapeHtml(data.share?.evidenceDisclaimer || data.evidence?.disclaimer || "Research context only. Linked sources do not imply causation or investment advice.")}</p>`;
}

function stepScoresHtml(riskRows, data) {
  const mode = data.readerMode || state.readerMode;
  return `
    <h2 class="bill-step-title">Sensitivity and context scores</h2>
    <p class="bill-guided-lede muted">Modeled context scores — not buy/sell signals. Switch to full brief for Investor and Analyst reader modes.</p>
    <div class="stock-guided-score-grid">
      ${riskRows.slice(0, 5).map((row) => guidedRiskCard(row, mode)).join("")}
    </div>
    <p class="dossier-redaction mono">Deterministic models · not investment advice</p>`;
}

function guidedRiskCard(row, mode = "citizen") {
  const value = Math.max(0, Math.min(100, Number(row.value || 0)));
  const analystLine = mode === "analyst"
    ? `<small class="analyst-meta">Raw score ${Math.round(value)}/100 · confidence ${escapeHtml(row.confidence || "Medium")}</small>`
    : "";
  return `
    <div class="bill-guided-scores stock-guided-score-card">
      <div>
        <span class="score-label">${escapeHtml(row.label || "Risk")}</span>
        <strong class="mono">${Math.round(value)}</strong>
      </div>
      <div class="risk-track"><i style="width:${value}%"></i></div>
      <p class="muted">${escapeHtml(row.caption || row.explain || "")}</p>
      ${analystLine}
    </div>`;
}

function renderGuided(data) {
  const steps = state.steps.map((s) => ({ ...s, title: s.short, sectionRef: s.ref }));
  return BriefShell.renderGuidedArticle({
    mode: state.briefMode,
    steps,
    stepIndex: state.stepIndex,
    prefix: "bill",
    escapeHtml,
    classifyHtml: classifyBarHtml(data),
    headerHtml: `<div class="bill-card-actions stock-guided-toolbar">${themeSwitchHtml()}${heroActionsHtml()}</div>`,
    metaHtml: dossierMetaHtml(data),
    footerHtml: `
      <footer class="bill-guided-footer mono">
        <p>${escapeHtml((data.share?.evidenceDisclaimer || data.evidence?.disclaimer || "Research context only.").toUpperCase())}</p>
        <p class="bill-updated">END OF BRIEF&ensp;//&ensp;${escapeHtml((data.symbol || state.symbol).toUpperCase())}&ensp;//&ensp;UPDATED ${escapeHtml(freshnessText(data.updatedAt).toUpperCase())}</p>
      </footer>`,
    labels: { full: "Full brief", lastNext: "Open dashboard", next: "Continue", back: "← Back" }
  });
}

/* ---------- full brief ---------- */

function renderFullBrief(data) {
  const quote = data.quote || {};
  const pct = Number(quote.pct ?? quote.changePercent ?? 0);
  const changeClass = pct >= 0 ? "up" : "down";
  const explainer = data.explainer || {};
  const chains = data.governmentToMarketChain || data.policyChains || [];
  const riskRows = data.charts?.riskRadar || [];
  const evidence = data.evidence || {};
  const edgar = data.edgar || {};
  const modeCopy = readerModeCopy(data.readerMode || state.readerMode);
  const quoteMeta = formatQuoteMeta(quote, data.updatedAt);

  return `
    <div class="public-shell">
      <header class="public-nav">
        <a class="public-brand" href="/">
          <span class="brand-mark">T</span>
          <span>TradeSimple</span>
        </a>
        <div class="public-nav-actions">
          ${modeToggleHtml()}
          ${themeSwitchHtml()}
          <a href="/dashboard?view=analysis" class="nav-link">Dashboard</a>
          <button type="button" id="public-share-copy" class="nav-button">Copy link</button>
        </div>
      </header>

      <section class="memo-card">
        ${classifyBarHtml(data)}
        <div class="card-topline">
          <span class="mini-label">Government-to-market snapshot</span>
          <span>${escapeHtml(quoteMeta)}</span>
        </div>

        <div class="hero-grid">
          <div>
            <div class="ticker-row">
              <h1>${escapeHtml(data.symbol)}</h1>
              <span>${escapeHtml(data.company?.name || data.symbol)}</span>
            </div>
            <p class="hero-lede">${escapeHtml(data.governmentSignals?.headline || explainer.headline || "")}</p>
            <p class="hero-disclaimer">Market data may be delayed. TradeSimple explains policy-market relationships, not investment advice.</p>
          </div>
          <aside class="quote-box">
            <span>Supporting quote context</span>
            <strong>${quote.price ? money(quote.price) : "Quote unavailable"}</strong>
            ${quote.price ? `<p class="${changeClass}">${signed(quote.change || 0)} / ${signed(pct)}%</p>` : `<p class="muted-copy">Policy and filing context may still load.</p>`}
            <small>${escapeHtml(quoteMeta)}</small>
          </aside>
        </div>

        ${renderWhatChanged(data.whatChanged, evidence)}

        <section class="reader-strip" aria-label="Reader mode">
          ${["citizen", "investor", "analyst"].map((mode) => `
            <button type="button" data-reader-mode="${mode}" class="${state.readerMode === mode ? "active" : ""}" aria-pressed="${state.readerMode === mode}">
              <span>${titleCase(mode)}</span>
              <small>${escapeHtml(readerModeCopy(mode).buttonHint)}</small>
            </button>`).join("")}
        </section>
        <p class="reader-mode-note">${escapeHtml(modeCopy.note)}</p>

        <section class="main-explainer">
          <article>
            <span class="mini-label explainer-label">${escapeHtml(modeCopy.signalLabel)}</span>
            <h2>${escapeHtml(explainer.now || data.governmentSignals?.detail || "No government signal summary available.")}</h2>
            ${sourceDetails("Sources", evidenceSummaryItems(evidence, "policy"))}
          </article>
          <article>
            <span class="mini-label explainer-label">${escapeHtml(modeCopy.mechanismLabel)}</span>
            <p>${escapeHtml(explainer.whyItMatters || "Government action can matter through revenue, margins, capex, compliance costs, contract visibility, and investor expectations.")}</p>
            ${sourceDetails("Evidence", evidenceSummaryItems(evidence, "mechanism"))}
          </article>
          <article>
            <span class="mini-label explainer-label">${escapeHtml(modeCopy.watchLabel)}</span>
            <ul>${(explainer.watchFor || []).slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>New filings, rule text, contracts, and company commentary.</li>"}</ul>
          </article>
        </section>

        <section class="score-row">
          ${riskRows.slice(0, 5).map((row) => riskCard(row, data.readerMode || state.readerMode)).join("")}
        </section>

        <section class="two-col">
          <article class="section-card policy-chain-card">
            <div class="section-head">
              <span class="mini-label">Policy chain</span>
              <strong>Government Action -> Company Exposure -> Market Mechanism -> Investor Question</strong>
            </div>
            <div class="chain-stack">${chains.slice(0, 3).map((chain) => chainCard(chain)).join("")}</div>
          </article>

          <article class="section-card">
            <div class="section-head">
              <span class="mini-label">Lobbying signal</span>
              <strong>${escapeHtml(data.lobbyMapping?.summary || "Lobbying map unavailable.")}</strong>
            </div>
            ${renderLobbyRows(data.lobbyMapping)}
            ${sourceDetails("Lobbying sources", evidenceSummaryItems(evidence, "lobby"))}
          </article>
        </section>

        <section class="two-col">
          <article class="section-card">
            <div class="section-head">
              <span class="mini-label">From the 10-K, in plain English</span>
              <strong>${escapeHtml(edgar.status === "available" ? `${edgar.form || "10-K"} filed ${edgar.filingDate || ""}` : edgar.message || "SEC summary unavailable")}</strong>
            </div>
            ${renderEdgar(edgar)}
          </article>

          <article class="section-card">
            <div class="section-head">
              <span class="mini-label">Recent news</span>
              <strong>${Number(evidence.recentNews?.length || 0)} headline${Number(evidence.recentNews?.length || 0) === 1 ? "" : "s"} included</strong>
            </div>
            ${renderNews(evidence.recentNews || [])}
          </article>
        </section>

        <section class="two-col">
          <article class="section-card">
            <div class="section-head">
              <span class="mini-label">Mechanism scenarios</span>
              <strong>Context, not prediction</strong>
            </div>
            <p><span class="scenario-label">Positive mechanism</span>${escapeHtml(data.summary?.bull || data.fundamentals?.plainBull || "")}</p>
            <p><span class="scenario-label risk">Risk mechanism</span>${escapeHtml(data.summary?.bear || data.fundamentals?.plainBear || "")}</p>
          </article>

          <article class="section-card">
            <div class="section-head">
              <span class="mini-label">Sources</span>
              <strong>Receipts before interpretation</strong>
            </div>
            ${renderSources(evidence)}
          </article>
        </section>

        <section class="spark-card">
          <div class="section-head">
            <span class="mini-label">Quote path</span>
            <strong>${escapeHtml(data.symbol)} ${escapeHtml(data.charts?.priceTrendRange || "6m")} price context</strong>
          </div>
          ${sparkline(data.charts?.priceTrend || [])}
        </section>

        <p class="hero-disclaimer evidence-disclaimer-footer">
          ${escapeHtml(data.share?.evidenceDisclaimer || evidence.disclaimer || "Research context only. Linked sources do not imply causation or investment advice.")}
        </p>
      </section>
    </div>`;
}

function readerModeCopy(mode) {
  if (mode === "citizen") {
    return {
      buttonHint: "Plain English",
      note: "Citizen mode explains the policy story without market jargon.",
      signalLabel: "What's happening now",
      mechanismLabel: "Why it could matter",
      watchLabel: "What to watch next"
    };
  }
  if (mode === "analyst") {
    return {
      buttonHint: "Scores + limits",
      note: "Analyst mode keeps source metadata, confidence, and model limits closer to the surface.",
      signalLabel: "Structured signal",
      mechanismLabel: "Model pathway",
      watchLabel: "Variables to monitor"
    };
  }
  return {
    buttonHint: "Investor context",
    note: "Investor mode uses normal market language: revenue, margins, guidance risk, and expectations.",
    signalLabel: "Government signal",
    mechanismLabel: "Market mechanism",
    watchLabel: "Watch next"
  };
}

function renderWhatChanged(whatChanged, evidence) {
  const items = Array.isArray(whatChanged?.items) ? whatChanged.items.slice(0, 4) : [];
  if (!items.length) {
    return `
    <section class="changed-ribbon">
      <div>
        <span class="mini-label changed-label">What changed?</span>
        <p class="muted">No change items in this snapshot yet. Open a prior share or wait for the next refresh.</p>
      </div>
    </section>`;
  }
  return `
    <section class="changed-ribbon">
      <div>
        <span class="mini-label changed-label">What changed?</span>
        <div class="changed-list">
          ${items.slice(0, 3).map((item) => `
            <article class="changed-item ${escapeHtml(item.severity || "info")}">
              <span>${escapeHtml(item.label || "Snapshot item")}</span>
              <p>${escapeHtml(item.detail || String(item))}</p>
            </article>`).join("")}
        </div>
      </div>
      ${sourceDetails("Why this appears", [
        ...items,
        evidence?.recentNews?.[0]?.headline ? {
          label: "Top headline",
          detail: evidence.recentNews[0].headline,
          sourceType: evidence.recentNews[0].sourceLabel || evidence.recentNews[0].source || "News",
          freshness: evidence.recentNews[0].publishedAt,
          confidence: evidence.recentNews[0].confidence || "Medium",
          reason: "Top company headline included in the current news window."
        } : null
      ])}
    </section>`;
}

function riskCard(row, mode = "investor") {
  const value = Math.max(0, Math.min(100, Number(row.value || 0)));
  const analystLine = mode === "analyst"
    ? `<small class="analyst-meta">Raw score ${Math.round(value)}/100 · confidence ${escapeHtml(row.confidence || "Medium")}</small>`
    : "";
  return `
    <article class="risk-card">
      <div><span>${escapeHtml(row.label || "Risk")}</span><strong>${Math.round(value)}</strong></div>
      <div class="risk-track"><i style="width:${value}%"></i></div>
      <p>${escapeHtml(row.caption || row.explain || "")}</p>
      ${analystLine}
      ${sourceDetails("Why this score appears", [{
        label: row.label || "Risk score",
        detail: row.explain || row.caption || "Modeled from the public snapshot.",
        sourceType: "TradeSimple risk model",
        confidence: row.value > 0 ? "Medium" : "No match",
        reason: "Risk radar scores are deterministic context, not recommendations."
      }])}
    </article>`;
}

function chainCard(chain) {
  const steps = (chain.steps && chain.steps.length ? chain.steps : [
    { label: "Government Action", text: chain.governmentAction },
    { label: "Company Exposure", text: chain.companyExposure },
    { label: "Market Mechanism", text: chain.marketMechanism },
    { label: "Investor Question", text: chain.investorQuestion }
  ]).filter((step) => step && step.text);
  return `
    <details class="chain-card" open>
      <summary>
        <strong>${escapeHtml(chain.title || "Policy chain")}</strong>
        <span>${escapeHtml(chain.summary || "")}</span>
      </summary>
      <div class="chain-steps">
        ${steps.map((step) => `
          <div>
            <span>${escapeHtml(step.label || "")}</span>
            <p>${escapeHtml(step.text || "")}</p>
          </div>`).join("")}
      </div>
    </details>`;
}

function renderLobbyRows(lobby) {
  const matches = lobby?.matches || [];
  if (!matches.length) {
    const reason = lobby?.reason || lobby?.status || "no_match";
    const copy = reason === "api_error"
      ? "Lobbying map unavailable. The mapper could not run, but bill and filing evidence may still appear below."
      : reason === "not_requested"
        ? "Lobby mapping was not requested for this snapshot."
        : "No lobbying activity mapped to this ticker yet. TradeSimple did not find a high-confidence connection between recent filings and tracked policy issues.";
    return `<div class="empty-state-card ${escapeHtml(reason)}"><strong>${escapeHtml(lobby?.summary || "Lobbying signal")}</strong><p>${escapeHtml(copy)}</p></div>`;
  }
  return `
    <div class="compact-list">
      ${matches.slice(0, 4).map((row) => `
        <div>
          <strong>${escapeHtml(row.client || "Mapped filing")}</strong>
          <span>${escapeHtml(row.billId || "")} ${escapeHtml(row.direction || "neutral")}${row.amount ? ` - ${compactMoney(row.amount)}` : ""}</span>
        </div>`).join("")}
    </div>`;
}

function renderEdgar(edgar) {
  const simplified = edgar?.simplified || {};
  const revenueSegments = edgar?.revenueSegments || simplified.whereMoneyComesFrom || [];
  const topRisks = edgar?.topRisks || simplified.whatCouldHurtIt || [];
  const yoyDirection = edgar?.yoyDirection || (simplified.numbersGoingRight ? [simplified.numbersGoingRight] : []);
  if (edgar?.status !== "available") {
    return `<div class="empty-state-card ${escapeHtml(edgar?.status || "unavailable")}"><strong>SEC summary unavailable.</strong><p>${escapeHtml(edgar?.message || "TradeSimple could not simplify the latest filing, but raw SEC source links are still shown when available.")}</p></div>`;
  }
  const block = (title, items) => {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!list.length) return "";
    return `<div class="edgar-block"><span>${escapeHtml(title)}</span><ul>${list.slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
  };
  return `
    ${block("Where the money comes from", revenueSegments)}
    ${block("What could hurt the company", topRisks)}
    ${block("Are the numbers improving?", yoyDirection)}
    ${edgar.sourceUrl ? `<a class="source-link" href="${escapeHtml(edgar.sourceUrl)}" target="_blank" rel="noopener noreferrer">View original SEC filing</a>` : ""}`;
}

function renderNews(items) {
  if (!items.length) {
    return `<div class="empty-state-card no_match"><strong>No recent company headlines found.</strong><p>The government, lobbying, and filing sections are still available.</p></div>`;
  }
  return `<div class="news-list">${items.slice(0, 5).map((item) => `
    <a href="${escapeHtml(item.url || "#")}" target="_blank" rel="noopener noreferrer">
      <span>${escapeHtml(item.source || "News")}</span>
      <strong>${escapeHtml(item.headline || "")}</strong>
      <small>${escapeHtml(item.publishedAt ? freshnessText(item.publishedAt) : "")}</small>
    </a>`).join("")}</div>`;
}

function renderSources(evidence) {
  const links = [];
  (evidence.relatedBills || []).slice(0, 3).forEach((row) => links.push({ label: row.sourceLabel || "Congress.gov", text: row.title, url: row.sourceUrl }));
  (evidence.lobbyingFilings || []).slice(0, 2).forEach((row) => links.push({ label: row.sourceLabel || "Senate LDA", text: row.client, url: row.sourceUrl }));
  if (evidence.secFiling) links.push({ label: evidence.secFiling.sourceLabel || "SEC EDGAR", text: `${evidence.secFiling.form} ${evidence.secFiling.filingDate}`, url: evidence.secFiling.sourceUrl });
  (evidence.secFilings || []).slice(0, 1).forEach((row) => {
    if (!evidence.secFiling) links.push({ label: row.sourceLabel || "SEC EDGAR", text: `${row.form || "Filing"} ${row.filingDate || ""}`, url: row.sourceUrl });
  });
  if (evidence.governmentContracts) links.push({ label: evidence.governmentContracts.sourceLabel || "USASpending.gov", text: evidence.governmentContracts.summary, url: evidence.governmentContracts.sourceUrl });
  if (evidence.analystConsensus) links.push({ label: evidence.analystConsensus.sourceLabel || "Consensus", text: evidence.analystConsensus.label, url: evidence.analystConsensus.sourceUrl });
  if (!links.length) return `<div class="empty-state-card unavailable"><strong>No source links returned.</strong><p>The snapshot loaded, but TradeSimple did not receive source metadata for this symbol.</p></div>`;
  return `<div class="source-list">${links.map((link) => `
    <a href="${escapeHtml(link.url || "#")}" target="_blank" rel="noopener noreferrer">
      <span>${escapeHtml(link.label)}</span>
      <p>${escapeHtml(link.text || "")}</p>
    </a>`).join("")}</div>`;
}

function sourceDetails(label, items) {
  const clean = (items || []).filter(Boolean).slice(0, 5);
  return `
    <details class="claim-sources">
      <summary>${escapeHtml(label || "Sources")}</summary>
      <div class="source-detail-list">${(clean.length ? clean : [{
        label: "No source detail available",
        detail: "This claim did not return source metadata.",
        confidence: "Unavailable",
        sourceType: "Not available"
      }]).map(sourceDetailItemHtml).join("")}</div>
    </details>`;
}

function sourceDetailItemHtml(item) {
  if (typeof item === "string") {
    return `<article><p>${escapeHtml(item)}</p></article>`;
  }
  const freshness = item.freshness ? freshnessText(item.freshness) : "";
  return `
    <article>
      <div class="source-detail-top">
        <span>${escapeHtml(item.sourceType || item.sourceLabel || "Source")}</span>
        <b>${escapeHtml(item.confidence || "Medium confidence")}</b>
      </div>
      <p>${escapeHtml(item.detail || item.reason || item.title || item.headline || item.label || "")}</p>
      <small>${escapeHtml([item.label, freshness, item.reason].filter(Boolean).join(" · "))}</small>
      ${item.sourceUrl || item.url ? `<a href="${escapeHtml(item.sourceUrl || item.url)}" target="_blank" rel="noopener noreferrer">Open source</a>` : ""}
    </article>`;
}

function evidenceSummaryItems(evidence, kind) {
  if (kind === "lobby") {
    return (evidence.lobbyingFilings || []).map((row) => ({
      label: row.client || "Lobbying filing",
      detail: `${row.issue || row.billId || "Mapped issue"}`,
      sourceType: row.sourceType || row.sourceLabel || "Senate LDA",
      freshness: row.freshness,
      confidence: row.confidence || "Medium",
      reason: row.reason || row.reasoning,
      sourceUrl: row.sourceUrl
    }));
  }
  if (kind === "mechanism") {
    return [
      evidence.secFiling ? {
        label: `${evidence.secFiling.form || "10-K"} filed ${evidence.secFiling.filingDate || ""}`,
        detail: evidence.secFiling.reason || "SEC filing provides revenue and risk context.",
        sourceType: evidence.secFiling.sourceType || "SEC filing",
        freshness: evidence.secFiling.freshness || evidence.secFiling.filingDate,
        confidence: evidence.secFiling.confidence || "High",
        sourceUrl: evidence.secFiling.sourceUrl
      } : null,
      evidence.governmentContracts ? {
        label: evidence.governmentContracts.relevant ? "Government contract exposure" : "No contract dependency mapped",
        detail: evidence.governmentContracts.summary,
        sourceType: evidence.governmentContracts.sourceType || "USASpending.gov",
        freshness: evidence.governmentContracts.freshness,
        confidence: evidence.governmentContracts.confidence || "Medium",
        reason: evidence.governmentContracts.reason,
        sourceUrl: evidence.governmentContracts.sourceUrl
      } : null,
      evidence.analystConsensus ? {
        label: evidence.analystConsensus.label,
        detail: "Consensus is supporting context, not a TradeSimple recommendation.",
        sourceType: evidence.analystConsensus.sourceType || "Analyst consensus",
        freshness: evidence.analystConsensus.freshness,
        confidence: evidence.analystConsensus.confidence || "Low",
        reason: evidence.analystConsensus.reason,
        sourceUrl: evidence.analystConsensus.sourceUrl
      } : null
    ];
  }
  return [
    ...(evidence.relatedBills || []).map((row) => ({
      label: row.id,
      detail: row.title,
      sourceType: row.sourceType || row.sourceLabel || "Congress.gov",
      freshness: row.freshness || row.latestActionDate,
      confidence: row.confidence || "Medium",
      reason: row.reason || row.latestAction,
      sourceUrl: row.sourceUrl
    })),
    ...(evidence.recentNews || []).slice(0, 2).map((row) => ({
      label: "Recent headline",
      detail: row.headline,
      sourceType: row.sourceType || row.sourceLabel || row.source || "Finnhub News",
      freshness: row.freshness || row.publishedAt,
      confidence: row.confidence || "Medium",
      reason: row.reason || row.summary,
      sourceUrl: row.url
    }))
  ];
}

function sparkline(points) {
  const series = (points || []).filter((p) => Number.isFinite(Number(p.value)));
  if (series.length < 2) return `<p class="empty-copy">No price path available.</p>`;
  const values = series.map((p) => Number(p.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 760;
  const height = 180;
  const d = series.map((p, i) => {
    const x = (i / (series.length - 1)) * width;
    const y = height - ((Number(p.value) - min) / range) * height;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Price path">
      <path d="${d}" fill="none" stroke="currentColor" stroke-width="3" />
    </svg>
    <div class="spark-meta"><span>${money(min)} low</span><span>${money(values[values.length - 1])} latest</span><span>${money(max)} high</span></div>`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

function formatQuoteMeta(quote, fallbackDate) {
  if (!quote) return "Quote status unavailable";
  if (quote.status === "unavailable" || quote.price == null) {
    return "Quote unavailable · Policy and filing context may still load";
  }
  const provider = quote.provider || sourceLabel(quote.source);
  const label = quote.delayLabel || (quote.fetchedAt || fallbackDate ? `Fetched ${freshnessText(quote.fetchedAt || fallbackDate)} ago` : "Fetched recently");
  const stale = quote.isStale || Number(quote.freshnessMs || 0) > 120000 ? " · quote may be stale" : "";
  return `${label} · ${provider} · Market data may be delayed${stale}`;
}

function freshnessText(value) {
  if (typeof value === "string" && Number.isNaN(new Date(value).getTime())) return value;
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "recently";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function money(value) {
  const n = Number(value || 0);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 1000 ? 0 : 2 });
}

function compactMoney(value) {
  const n = Number(value || 0);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return money(n);
}

function signed(value) {
  const n = Number(value || 0);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}

function titleCase(value) {
  return String(value || "").slice(0, 1).toUpperCase() + String(value || "").slice(1);
}

function sourceLabel(source) {
  return String(source || "provider").replaceAll("_", " ");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
