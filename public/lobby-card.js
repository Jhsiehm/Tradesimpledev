const BRIEF_MODE_KEY = "ts_lobby_brief_mode";

const state = {
  filingId: document.body.dataset.lobbyId || pathFilingId() || "",
  mode: storedBriefMode(),
  data: null,
  steps: [],
  stepIndex: 0
};

document.addEventListener("DOMContentLoaded", loadLobbyCard);

function pathFilingId() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[0] === "lobby" ? decodeURIComponent(parts[1] || "") : "";
}

function storedBriefMode() {
  return BriefShell.storedMode(BRIEF_MODE_KEY, "guided");
}

function persistBriefMode(mode) {
  state.mode = BriefShell.persistMode(BRIEF_MODE_KEY, mode);
}

async function loadLobbyCard() {
  const root = document.getElementById("lobby-card-root");
  if (!state.filingId) {
    root.innerHTML = errorBlock("Missing filing", "Open a filing from the Lobbying tab.");
    return;
  }
  try {
    const data = await fetchJson(`/api/share/lobby?filingId=${encodeURIComponent(state.filingId)}`);
    state.filingId = data.filing?.filingId || state.filingId;
    state.data = data;
    const f = data.filing || {};
    document.title = `${data.share?.title || f.client || "Lobbying"} | TradeSimple`;
    renderApp();
  } catch (err) {
    root.innerHTML = errorBlock(state.filingId, err.message || "Could not load filing.");
  }
}

let lobbyBriefShell = null;

function renderApp() {
  const root = document.getElementById("lobby-card-root");
  const data = state.data;
  state.steps = buildSteps(data);
  if (state.stepIndex >= state.steps.length) state.stepIndex = 0;
  if (lobbyBriefShell) BriefShell.detachWalkthrough(lobbyBriefShell);
  lobbyBriefShell = {
    prefix: "bill",
    escapeHtml,
    getMode: () => state.mode,
    getSteps: () => state.steps.map((s) => ({ ...s, title: s.short, sectionRef: s.ref })),
    getStepIndex: () => state.stepIndex,
    setStepIndex: (i) => {
      state.stepIndex = i;
    },
    isActive: () => state.mode === "guided",
    onLastStepNext: () => {
      window.location.href = "/dashboard?view=lobbying";
    },
    labels: { full: "Full brief", lastNext: "Open dashboard", next: "Continue", back: "← Back" }
  };
  if (state.mode === "guided") {
    root.innerHTML = renderGuided(data);
    bindSharedControls(data);
    BriefShell.attachWalkthrough(lobbyBriefShell);
  } else {
    root.innerHTML = renderFullBrief(data);
    bindSharedControls(data);
  }
}

function bindSharedControls(data) {
  const share = document.getElementById("detail-share-copy");
  if (share) {
    share.addEventListener("click", async () => {
      const url = data.share?.canonicalUrl || `${location.origin}/lobby/${encodeURIComponent(state.filingId)}`;
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
      if (mode === state.mode) return;
      persistBriefMode(mode);
      state.stepIndex = 0;
      renderApp();
      window.scrollTo({ top: 0 });
    });
  });
}

function modeToggleHtml() {
  return BriefShell.modeToggleHtml(state.mode, { full: "Full brief" });
}

function heroActionsHtml() {
  return `
    <div class="bill-card-actions detail-card-actions">
      <button type="button" class="card-button ghost" id="detail-share-copy">Copy link</button>
      <a class="card-button ghost" href="/dashboard?view=lobbying">Dashboard</a>
    </div>`;
}

function freshnessChipHtml(data) {
  return BriefShell.freshnessChipHtml(data?.freshness, escapeHtml);
}

function classifyBarHtml(f) {
  return `
    <div class="dossier-classify mono" aria-hidden="true">
      <span class="dossier-classify-id">TRADESIMPLE LOBBYING BRIEF&ensp;//&ensp;${escapeHtml((f.filingId || state.filingId || "").toUpperCase())}</span>
      <span class="dossier-classify-note">SENATE LDA&ensp;·&ensp;NOT INVESTMENT ADVICE</span>
    </div>`;
}

function dossierMetaHtml(data) {
  const f = data.filing || {};
  const dateLabel = formatShortDate(f.postedAt || data.updatedAt || Date.now());
  const rows = [
    ["Date", dateLabel],
    ["Source", data.source || f.source || "lda"],
    ["Pressure", `${Number(f.lobbyingPressure ?? 0)}/100`],
    ["Confidence", f.filingConfidence || "—"]
  ];
  return `
    <dl class="dossier-meta mono">
      ${rows
        .map(
          ([label, value]) =>
            `<div class="dossier-meta-row"><dt>${escapeHtml(label)}</dt><span class="dossier-leader" aria-hidden="true"></span><dd>${escapeHtml(String(value).toUpperCase())}</dd></div>`
        )
        .join("")}
    </dl>`;
}

function buildSteps(data) {
  const f = data.filing || {};
  const steps = [];

  steps.push({
    id: "filer",
    short: "Who filed",
    ref: "Filing identity",
    html: stepFilerHtml(f, data)
  });

  if (f.issue) {
    steps.push({
      id: "issue",
      short: "What issue",
      ref: "Policy topic",
      html: stepIssueHtml(f)
    });
  }

  steps.push({
    id: "spend",
    short: "Spend unusual?",
    ref: "Spike metrics",
    html: stepSpendHtml(f)
  });

  const tickers = data.relatedTickers || [];
  if (tickers.length) {
    steps.push({
      id: "tickers",
      short: "Related tickers",
      ref: "Mapped symbols",
      html: stepTickersHtml(tickers, data)
    });
  }

  const bills = data.relatedBills || [];
  if (bills.length) {
    steps.push({
      id: "bills",
      short: "Legislation",
      ref: "Related bills",
      html: stepBillsHtml(bills)
    });
  }

  steps.push({
    id: "watch",
    short: "What to watch",
    ref: "Forward watch",
    html: stepWatchHtml(f, data)
  });

  return steps;
}

function stepFilerHtml(f, data) {
  const stance = f.stance ? `<span class="dossier-chip mono">${escapeHtml(f.stance)}</span>` : "";
  return `
    <p class="bill-card-id mono">${escapeHtml(f.filingId || state.filingId)}</p>
    <h1 class="bill-guided-title">${escapeHtml(f.client || "Lobbying client")}</h1>
    <div class="freshness-chip-row">${freshnessChipHtml(data)}</div>
    <div class="bill-card-badges">
      ${stance}
      <span class="dossier-stamp modeled">Lobbying disclosure</span>
    </div>
    <div class="bill-guided-facts">
      <div class="bill-guided-fact">
        <span class="bill-guided-fact-label">Registrant</span>
        <p>${escapeHtml(f.registrant || "Unknown")}</p>
      </div>
      <div class="bill-guided-fact">
        <span class="bill-guided-fact-label">Amount reported</span>
        <p><strong class="mono">${money(f.amount || 0)}</strong></p>
      </div>
      <div class="bill-guided-fact">
        <span class="bill-guided-fact-label">Posted</span>
        <p class="mono">${escapeHtml(f.postedAt || "—")}</p>
      </div>
    </div>
    <p class="muted bill-guided-note">${escapeHtml(data.share?.disclaimer || "")}</p>`;
}

function stepIssueHtml(f) {
  return `
    <h2 class="bill-step-title">What issue is this filing about?</h2>
    <p class="bill-guided-lede">${escapeHtml(f.issue || "Issue not listed")}</p>
    <div class="bill-guided-scores">
      <div><span class="score-label">Issue confidence</span><strong>${escapeHtml(f.issueSignalConfidence || "—")}</strong></div>
      <div><span class="score-label">Recency confidence</span><strong>${escapeHtml(f.recencySignalConfidence || "—")}</strong></div>
    </div>
    <p>Lobbying filings show who is paying to influence which issues. A filing alone is not a buy or sell signal — it is context for legislative pressure.</p>`;
}

function stepSpendHtml(f) {
  const z = Number(f.spendSpikeZ);
  const unusual = Number.isFinite(z) && z >= 1.5;
  return `
    <h2 class="bill-step-title">Is this spend unusual?</h2>
    <div class="bill-guided-scores">
      <div><span class="score-label">Lobbying pressure</span><strong class="mono">${Number(f.lobbyingPressure ?? 0)}/100</strong></div>
      <div><span class="score-label">Spend Z-score</span><strong class="mono">${escapeHtml(String(f.spendSpikeZ ?? "—"))}</strong></div>
      <div><span class="score-label">Vs trailing avg</span><strong class="mono">${f.spikeVsTrail != null ? `${Math.round(Number(f.spikeVsTrail) * 100)}%` : "—"}</strong></div>
      <div><span class="score-label">Spend confidence</span><strong>${escapeHtml(f.spendSignalConfidence || "—")}</strong></div>
    </div>
    <p class="bill-guided-lede">${unusual
      ? "This filing is above the client's recent trailing average — worth watching for coordinated pressure ahead of legislative movement."
      : "Spend looks closer to baseline for this client. Still useful context, but less likely to be a standalone catalyst."}</p>
    ${f.stance ? `<p><strong>Inferred stance:</strong> ${escapeHtml(f.stance)}</p>` : ""}`;
}

function stepTickersHtml(tickers, data) {
  const traceUrls = data?.mapping?.traceUrls || {};
  return `
    <h2 class="bill-step-title">Which tickers map to this client?</h2>
    <p class="bill-guided-lede">TradeSimple links lobbying clients to publicly traded symbols when the name match is clear.</p>
    <div class="bill-ticker-row">
      ${tickers.map((t) => {
        const href = traceUrls[t] || `/stock/${encodeURIComponent(t)}`;
        return `<a class="ticker-chip-link" href="${escapeHtml(href)}">${escapeHtml(t)}</a>`;
      }).join("")}
    </div>
    <div class="brief-trace-row">${BriefShell.traceTickerCtaHtml(tickers[0], escapeHtml)}</div>`;
}

function stepBillsHtml(bills) {
  return `
    <h2 class="bill-step-title">Related legislation</h2>
    <div class="brief-related-bill-cards">
      ${bills
        .slice(0, 6)
        .map(
          (b) =>
            `<a class="brief-related-bill-card" href="${escapeHtml(b.url || `/bill/${encodeURIComponent(b.id)}`)}">
              <span class="mono">${escapeHtml(b.displayId || b.id)}</span>
              <strong>${escapeHtml(b.title || "")}</strong>
              ${b.momentum != null ? `<span class="muted">Momentum ${escapeHtml(String(b.momentum))}/100</span>` : ""}
            </a>`
        )
        .join("")}
    </div>`;
}

function stepWatchHtml(f, data) {
  const watchItems = [
    "Next quarterly LDA filing for the same client and issue",
    "Committee markups on related bill language",
    "Company earnings commentary on regulatory risk",
    f.stance === "against" ? "Counter-lobbying filings from opposing industry groups" : null
  ].filter(Boolean);
  return `
    <h2 class="bill-step-title">What to watch next</h2>
    <ul class="bill-guided-watchlist">${watchItems.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
    <div class="bill-guided-cta">
      <a class="card-button bill-cta-primary" href="/dashboard?view=lobbying">Track on dashboard</a>
    </div>
    <p class="muted bill-guided-note">Source: ${escapeHtml(data.source || f.source || "lda")} · Updated ${escapeHtml(freshness(data.updatedAt))}</p>`;
}

function renderGuided(data) {
  const f = data.filing || {};
  const steps = state.steps.map((s) => ({ ...s, title: s.short, sectionRef: s.ref }));
  return BriefShell.renderGuidedArticle({
    mode: state.mode,
    steps,
    stepIndex: state.stepIndex,
    prefix: "bill",
    escapeHtml,
    classifyHtml: classifyBarHtml(f),
    headerHtml: heroActionsHtml(),
    metaHtml: dossierMetaHtml(data),
    footerHtml: `
      <footer class="bill-guided-footer mono">
        <p>${escapeHtml((data.share?.disclaimer || "").toUpperCase())}</p>
        <p class="bill-updated">END OF BRIEF&ensp;//&ensp;${escapeHtml((f.filingId || state.filingId).toUpperCase())}&ensp;//&ensp;UPDATED ${escapeHtml(freshness(data.updatedAt).toUpperCase())}</p>
      </footer>`,
    labels: { full: "Full brief", lastNext: "Open dashboard", next: "Continue", back: "← Back" }
  });
}

function renderFullBrief(data) {
  const f = data.filing || {};
  const pressure = Number(f.lobbyingPressure ?? 0);
  return `
    <article class="bill-card-page stock-card-shell">
      ${classifyBarHtml(f)}
      <header class="bill-card-hero">
        <div class="bill-card-hero-top">
          ${modeToggleHtml()}
          ${heroActionsHtml()}
        </div>
        <p class="bill-card-id mono">${escapeHtml(f.filingId || state.filingId)}</p>
        <h1>${escapeHtml(f.client || "Lobbying client")}</h1>
        <div class="freshness-chip-row">${freshnessChipHtml(data)}</div>
        <p>${escapeHtml(f.issue || "Issue not listed")}</p>
        <p class="muted">Filed by ${escapeHtml(f.registrant || "unknown")} · ${escapeHtml(f.postedAt || "—")}</p>
        <p class="bill-card-disclaimer muted">${escapeHtml(data.share?.disclaimer || "")}</p>
      </header>
      ${dossierMetaHtml(data)}

      <section class="detail-grid-2">
        <div class="detail-card-panel">
          <h2>Pressure & confidence</h2>
          <div class="detail-metric-row">
            <div><span class="label">Lobbying pressure</span><strong>${pressure}/100</strong></div>
            <div><span class="label">Filing confidence</span><strong>${escapeHtml(f.filingConfidence || "—")}</strong></div>
            <div><span class="label">Spend Z-score</span><strong class="mono">${escapeHtml(String(f.spendSpikeZ ?? "—"))}</strong></div>
            <div><span class="label">Amount</span><strong class="mono">${money(f.amount || 0)}</strong></div>
          </div>
          <p class="muted">Recency ${escapeHtml(f.recencySignalConfidence || "—")} · Issue ${escapeHtml(f.issueSignalConfidence || "—")} · Spend ${escapeHtml(f.spendSignalConfidence || "—")}</p>
        </div>
        <div class="detail-card-panel">
          <h2>What this means</h2>
          <p>Lobbying filings show who is paying to influence which issues. Spikes can appear weeks before visible legislative movement — but a filing alone is not a buy or sell signal.</p>
          ${f.stance ? `<p><strong>Stance:</strong> ${escapeHtml(f.stance)}</p>` : ""}
        </div>
      </section>

      ${relatedTickers(data.relatedTickers)}
      ${relatedBills(data.relatedBills)}

      <footer class="detail-card-panel"><p class="muted">Updated ${escapeHtml(freshness(data.updatedAt))}</p></footer>
    </article>`;
}

function relatedTickers(tickers) {
  const rows = Array.isArray(tickers) ? tickers : [];
  if (!rows.length) return "";
  return `
    <section class="detail-card-panel">
      <h2>Related tickers</h2>
      <div class="detail-link-row">
        ${rows.map((t) => `<a class="detail-chip-link" href="/stock/${encodeURIComponent(t)}">${escapeHtml(t)}</a>`).join("")}
      </div>
      <div class="brief-trace-row">${BriefShell.traceTickerCtaHtml(rows[0], escapeHtml)}</div>
    </section>`;
}

function relatedBills(bills) {
  const rows = Array.isArray(bills) ? bills : [];
  if (!rows.length) {
    return `<section class="detail-card-panel"><h2>Related bills</h2><p class="muted">No bill mapped yet — check the Bills tab for issue-area matches.</p></section>`;
  }
  return `
    <section class="detail-card-panel">
      <h2>Related bills</h2>
      <ul>
        ${rows
          .map(
            (b) =>
              `<li><a href="/bill/${encodeURIComponent(b.id)}">${escapeHtml(b.displayId || b.id)}</a> — ${escapeHtml(b.title || "")} <span class="muted">Momentum ${escapeHtml(String(b.momentum ?? "—"))}/100</span></li>`
          )
          .join("")}
      </ul>
    </section>`;
}

function errorBlock(id, msg) {
  return `<section class="stock-card-error"><h1>${escapeHtml(id)}</h1><p>${escapeHtml(msg)}</p><a class="card-button" href="/dashboard?view=lobbying">Dashboard</a></section>`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      msg = body.message || body.error || msg;
    } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

function money(n) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatShortDate(value) {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return String(value || "");
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function freshness(v) {
  if (!v) return "recently";
  const m = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  return m < 1 ? "just now" : `${m}m ago`;
}

function escapeHtml(v) {
  return String(v || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
