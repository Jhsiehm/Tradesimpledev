const BRIEF_MODE_KEY = "ts_contract_brief_mode";

const state = {
  symbol: document.body.dataset.contractSymbol || pathSymbol() || "",
  mode: storedBriefMode(),
  data: null,
  steps: [],
  stepIndex: 0
};

document.addEventListener("DOMContentLoaded", loadContractCard);

function pathSymbol() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return (parts[1] || "").toUpperCase().replace(/[^A-Z]/g, "");
}

function storedBriefMode() {
  return BriefShell.storedMode(BRIEF_MODE_KEY, "guided");
}

function persistBriefMode(mode) {
  state.mode = BriefShell.persistMode(BRIEF_MODE_KEY, mode);
}

async function loadContractCard() {
  const root = document.getElementById("contract-card-root");
  if (!state.symbol) {
    root.innerHTML = errorBlock("Missing symbol", "Open a contract from the dashboard.");
    return;
  }
  try {
    const data = await fetchJson(`/api/share/contract?symbol=${encodeURIComponent(state.symbol)}`);
    state.symbol = data.symbol || state.symbol;
    state.data = data;
    document.title = `${data.share?.title || state.symbol} | TradeSimple`;
    renderApp();
  } catch (err) {
    root.innerHTML = errorBlock(state.symbol, err.message || "Could not load contract brief.");
  }
}

let contractBriefShell = null;

function renderApp() {
  const root = document.getElementById("contract-card-root");
  const data = state.data;
  state.steps = buildSteps(data);
  if (state.stepIndex >= state.steps.length) state.stepIndex = 0;
  if (contractBriefShell) BriefShell.detachWalkthrough(contractBriefShell);
  contractBriefShell = {
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
      window.location.href = "/dashboard?view=contracts";
    },
    labels: { full: "Full brief", lastNext: "Open dashboard", next: "Continue", back: "← Back" }
  };
  if (state.mode === "guided") {
    root.innerHTML = renderGuided(data);
    bindSharedControls(data);
    BriefShell.attachWalkthrough(contractBriefShell);
  } else {
    root.innerHTML = renderFullBrief(data);
    bindSharedControls(data);
  }
}

function bindSharedControls(data) {
  const share = document.getElementById("detail-share-copy");
  if (share) {
    share.addEventListener("click", async () => {
      const url = data.share?.canonicalUrl || `${location.origin}/contract/${encodeURIComponent(state.symbol)}`;
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
      <a class="card-button ghost" href="/stock/${encodeURIComponent(state.symbol)}">Stock card</a>
      <a class="card-button ghost" href="/dashboard?view=contracts">Dashboard</a>
    </div>`;
}

function classifyBarHtml(data) {
  return `
    <div class="dossier-classify mono" aria-hidden="true">
      <span class="dossier-classify-id">TRADESIMPLE CONTRACT BRIEF&ensp;//&ensp;${escapeHtml(state.symbol)}</span>
      <span class="dossier-classify-note">FEDERAL AWARDS&ensp;·&ensp;NOT INVESTMENT ADVICE</span>
    </div>`;
}

function dossierMetaHtml(data) {
  const c = data.causality || {};
  const profile = c.profile || {};
  const source = data.source || "usaspending.gov";
  const dateLabel = formatShortDate(data.updatedAt || Date.now());
  const rows = [
    ["Date", dateLabel],
    ["Source", source],
    ["Archetype", c.archetype || "—"],
    ["Confidence", c.scores?.confidence || "—"]
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

function topAward(data) {
  const awards = data.awards || [];
  if (!awards.length) return null;
  return awards.reduce((best, row) => (Number(row.obligatedAmount || 0) > Number(best?.obligatedAmount || 0) ? row : best), awards[0]);
}

function buildSteps(data) {
  const c = data.causality || {};
  const profile = c.profile || {};
  const steps = [];

  steps.push({
    id: "paid",
    short: "Who got paid",
    ref: "Award recipient",
    html: stepPaidHtml(data)
  });

  if (profile.governmentRevenuePct != null || c.archetype) {
    steps.push({
      id: "dependency",
      short: "Gov dependency",
      ref: "Revenue exposure",
      html: stepDependencyHtml(data, c, profile)
    });
  }

  const signal = topAward(data)?.eventSignal || computeAggregateSignal(data);
  if (signal) {
    steps.push({
      id: "priced",
      short: "Priced in?",
      ref: "Event signal",
      html: stepPricedHtml(signal, data)
    });
  }

  const nodes = c.nodes || [];
  if (nodes.length) {
    steps.push({
      id: "flow",
      short: "Money flow",
      ref: "Causality chain",
      html: stepFlowHtml(nodes)
    });
  }

  const awards = data.awards || [];
  if (awards.length) {
    steps.push({
      id: "awards",
      short: "Recent awards",
      ref: "USASpending rows",
      html: stepAwardsHtml(awards, data.symbol)
    });
  }

  const bills = relatedBillsList(data);
  if (bills.length) {
    steps.push({
      id: "bills",
      short: "Legislation",
      ref: "Related bills",
      html: stepBillsHtml(bills)
    });
  }

  const scenarios = c.scenarios || [];
  if (scenarios.length) {
    steps.push({
      id: "scenarios",
      short: "Scenarios",
      ref: "Bull / base / bear",
      html: stepScenariosHtml(scenarios)
    });
  }

  steps.push({
    id: "watch",
    short: "What to watch",
    ref: "Forward watch",
    html: stepWatchHtml(data, c, signal)
  });

  return steps;
}

function computeAggregateSignal(data) {
  const awards = (data.awards || []).filter((a) => a.eventSignal);
  if (!awards.length) return null;
  return awards.reduce((best, row) => (Number(row.eventSignal?.score || 0) > Number(best?.score || 0) ? row.eventSignal : best), awards[0].eventSignal);
}

function stepPaidHtml(data) {
  const award = topAward(data);
  return `
    <p class="bill-card-id mono">${escapeHtml(data.symbol)}</p>
    <h1 class="bill-guided-title">${escapeHtml(data.company || data.symbol)}</h1>
    <div class="brief-trace-row">${BriefShell.traceTickerCtaHtml(data.symbol, escapeHtml)}</div>
    <p class="bill-guided-lede">${escapeHtml(data.analysis?.plainEnglish || data.causality?.plainEnglish || "Federal contract exposure profile for this company.")}</p>
    ${award
      ? `<div class="bill-guided-facts">
          <div class="bill-guided-fact">
            <span class="bill-guided-fact-label">Top recent award</span>
            <p><strong class="mono">${money(award.obligatedAmount || 0)}</strong> from ${escapeHtml(award.awardingAgency || "Federal agency")}</p>
            ${award.description ? `<p class="muted">${escapeHtml(String(award.description).slice(0, 140))}</p>` : ""}
            <p class="muted mono bill-guided-fact-date">${escapeHtml(period(award))}</p>
          </div>
          <div class="bill-guided-fact">
            <span class="bill-guided-fact-label">Sample total obligated</span>
            <p><strong class="mono">${money(data.totalObligated || 0)}</strong> across ${escapeHtml(String(data.awardCount || 0))} row(s) in this pull</p>
          </div>
        </div>`
      : `<p class="muted bill-guided-note">No USASpending rows returned for this pull — profile data still applies.</p>`}`;
}

function stepDependencyHtml(data, c, profile) {
  const govPct = profile.governmentRevenuePct != null ? Math.round(profile.governmentRevenuePct * 100) : null;
  return `
    <h2 class="bill-step-title">How dependent is ${escapeHtml(data.symbol)} on government revenue?</h2>
    <div class="bill-guided-scores">
      <div><span class="score-label">Gov revenue share</span><strong class="mono">${govPct != null ? `${govPct}%` : "—"}</strong></div>
      <div><span class="score-label">Dependency score</span><strong class="mono">${escapeHtml(String(c.scores?.dependency ?? "—"))}/100</strong></div>
      <div><span class="score-label">Renewal risk</span><strong class="mono">${profile.renewalRisk != null ? Math.round(profile.renewalRisk * 100) : "—"}/100</strong></div>
    </div>
    <p class="bill-guided-lede">${escapeHtml(c.archetypeExplain || c.archetype || "")}</p>
    ${c.dogeRisk ? `<p class="dossier-redaction mono">Flagged for agency efficiency / DOGE-style review risk in TradeSimple model</p>` : ""}
    <p><strong>Agencies:</strong> ${escapeHtml((profile.primaryAgencies || []).join(", ") || "—")}</p>
    <p><strong>Programs:</strong> ${escapeHtml((profile.primaryPrograms || []).join(", ") || "—")}</p>`;
}

function stepPricedHtml(signal, data) {
  return `
    <h2 class="bill-step-title">Is this already priced in?</h2>
    <div class="bill-guided-scores">
      <div><span class="score-label">Event signal</span><strong class="mono">${escapeHtml(String(signal.score ?? "—"))}/100</strong></div>
      <div><span class="score-label">Assessment</span><strong>${escapeHtml(signal.label || "—")}</strong></div>
    </div>
    <p class="bill-guided-lede">${escapeHtml(signal.pricedInAssessment || "")}</p>
    <p>${escapeHtml(signal.plainEnglish || "")}</p>
    <p class="muted bill-guided-note">${escapeHtml(signal.dataNote || signal.confidence || "")}</p>`;
}

function stepFlowHtml(nodes) {
  return `
    <h2 class="bill-step-title">How money flows from Congress to ${escapeHtml(state.symbol)}</h2>
    <ol class="contract-flow-list">
      ${nodes
        .map(
          (n) =>
            `<li><span class="mono contract-flow-step">${escapeHtml(n.step)}</span><strong>${escapeHtml(n.title)}</strong><p class="muted">${escapeHtml(n.detail)}</p></li>`
        )
        .join("")}
    </ol>`;
}

function stepAwardsHtml(awards, symbol) {
  return `
    <h2 class="bill-step-title">Recent awards (USASpending)</h2>
    <div class="contract-awards-scroll">
      <table class="detail-table contract-awards-table">
        <thead><tr><th>ID</th><th>Agency</th><th>Amount</th><th>Period</th></tr></thead>
        <tbody>
          ${awards
            .slice(0, 12)
            .map(
              (a) => `<tr>
                <td class="mono">${escapeHtml(a.awardId || "—")}</td>
                <td>${escapeHtml(a.awardingAgency || "—")}</td>
                <td class="mono">${money(a.obligatedAmount || 0)}</td>
                <td class="mono muted">${escapeHtml(period(a))}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="bill-guided-cta">
      <a class="card-button bill-cta-primary" href="/dashboard?view=analysis&symbol=${encodeURIComponent(symbol)}">Open analysis tab</a>
      ${BriefShell.traceTickerCtaHtml(symbol, escapeHtml)}
    </div>`;
}

function stepBillsHtml(bills) {
  return `
    <h2 class="bill-step-title">Related legislation</h2>
    <p class="bill-guided-lede">Bills that map to ${escapeHtml(state.symbol)} in TradeSimple's policy graph.</p>
    ${relatedBillsCardsHtml(bills)}`;
}

function stepScenariosHtml(scenarios) {
  return `
    <h2 class="bill-step-title">Bull, base, and bear scenarios</h2>
    <div class="bill-scenario-grid">
      ${scenarios
        .map(
          (s) => `
        <div class="bill-scenario-card ${escapeHtml(s.cls || "")}">
          <h3>${escapeHtml(s.name)}</h3>
          <p>${escapeHtml(s.change)}</p>
          <p class="muted">${escapeHtml(s.read || "")}</p>
        </div>`
        )
        .join("")}
    </div>
    <p class="dossier-redaction mono">Illustrative models — not price targets or investment advice</p>`;
}

function stepWatchHtml(data, c, signal) {
  const watchItems = signal?.watchNext || [];
  const translation = (c.translation || []).find((t) => t.title?.toLowerCase().includes("watch"));
  return `
    <h2 class="bill-step-title">What to watch next</h2>
    ${watchItems.length ? `<ul class="bill-guided-watchlist">${watchItems.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>` : ""}
    ${translation ? `<p class="bill-guided-lede">${escapeHtml(translation.body || "")}</p>` : ""}
    <div class="bill-guided-cta">
      <a class="card-button bill-cta-primary" href="/dashboard?view=contracts">Track on dashboard</a>
      <a class="card-button ghost" href="/stock/${encodeURIComponent(state.symbol)}">Stock card</a>
    </div>
    <p class="muted bill-guided-note">Source: ${escapeHtml(data.source || "usaspending.gov")} · Updated ${escapeHtml(freshness(data.updatedAt))}</p>`;
}

function renderGuided(data) {
  const steps = state.steps.map((s) => ({ ...s, title: s.short, sectionRef: s.ref }));
  return BriefShell.renderGuidedArticle({
    mode: state.mode,
    steps,
    stepIndex: state.stepIndex,
    prefix: "bill",
    escapeHtml,
    classifyHtml: classifyBarHtml(data),
    headerHtml: heroActionsHtml(),
    metaHtml: dossierMetaHtml(data),
    footerHtml: `
      <footer class="bill-guided-footer mono">
        <p>${escapeHtml((data.share?.disclaimer || "").toUpperCase())}</p>
        <p class="bill-updated">END OF BRIEF&ensp;//&ensp;${escapeHtml(state.symbol)}&ensp;//&ensp;UPDATED ${escapeHtml(freshness(data.updatedAt).toUpperCase())}</p>
      </footer>`,
    labels: { full: "Full brief", lastNext: "Open dashboard", next: "Continue", back: "← Back" }
  });
}

function renderFullBrief(data) {
  const c = data.causality || {};
  const profile = c.profile || {};
  const awards = data.awards || [];
  return `
    <article class="bill-card-page stock-card-shell">
      ${classifyBarHtml(data)}
      <header class="bill-card-hero">
        <div class="bill-card-hero-top">
          ${modeToggleHtml()}
          ${heroActionsHtml()}
        </div>
        <p class="bill-card-id mono">${escapeHtml(data.symbol)}</p>
        <h1>${escapeHtml(data.company || data.symbol)}</h1>
        <p class="muted">${escapeHtml(c.archetype || "Government contractor profile")} · ${escapeHtml(c.scores?.confidence || "—")} confidence</p>
        <p class="bill-card-disclaimer muted">${escapeHtml(data.share?.disclaimer || "")}</p>
        <div class="brief-trace-row">${BriefShell.traceTickerCtaHtml(data.symbol, escapeHtml)}</div>
      </header>
      ${dossierMetaHtml(data)}

      <section class="detail-grid-2">
        <div class="detail-card-panel">
          <h2>Exposure snapshot</h2>
          <div class="detail-metric-row">
            <div><span class="label">Gov revenue share</span><strong>${profile.governmentRevenuePct != null ? Math.round(profile.governmentRevenuePct * 100) + "%" : "—"}</strong></div>
            <div><span class="label">Renewal risk</span><strong>${profile.renewalRisk != null ? Math.round(profile.renewalRisk * 100) + "/100" : "—"}</strong></div>
            <div><span class="label">Dependency score</span><strong>${escapeHtml(String(c.scores?.dependency ?? "—"))}/100</strong></div>
            <div><span class="label">Total obligated (sample)</span><strong>${money(data.totalObligated || 0)}</strong></div>
          </div>
          <p>${escapeHtml(data.analysis?.plainEnglish || c.plainEnglish || "")}</p>
        </div>
        <div class="detail-card-panel">
          <h2>Programs & agencies</h2>
          <p><strong>Agencies:</strong> ${escapeHtml((profile.primaryAgencies || []).join(", ") || "—")}</p>
          <p><strong>Programs:</strong> ${escapeHtml((profile.primaryPrograms || []).join(", ") || "—")}</p>
          <p class="muted">${escapeHtml(c.archetypeExplain || "")}</p>
        </div>
      </section>

      ${scenarioBlock(c.scenarios)}
      ${nodesBlock(c.nodes)}
      ${awardsBlock(awards, data.symbol)}
      ${billsBlock(relatedBillsList(data))}
      ${translationBlock(c.translation)}

      <footer class="detail-card-panel">
        <p class="muted">Source: ${escapeHtml(data.source || "usaspending.gov")} · Updated ${escapeHtml(freshness(data.updatedAt))}</p>
      </footer>
    </article>`;
}

function awardsBlock(awards, symbol) {
  if (!awards.length) {
    return `<section class="detail-card-panel"><h2>Recent awards</h2><p class="muted">No USASpending rows returned for this pull.</p></section>`;
  }
  return `
    <section class="detail-card-panel">
      <h2>Recent awards (USASpending)</h2>
      <div class="contract-awards-scroll">
        <table class="detail-table contract-awards-table">
          <thead><tr><th>ID</th><th>Agency</th><th>Amount</th><th>Period</th></tr></thead>
          <tbody>
            ${awards
              .slice(0, 12)
              .map(
                (a) => `<tr>
                  <td class="mono">${escapeHtml(a.awardId || "—")}</td>
                  <td>${escapeHtml(a.awardingAgency || "—")}</td>
                  <td class="mono">${money(a.obligatedAmount || 0)}</td>
                  <td class="mono muted">${escapeHtml(period(a))}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="detail-link-row">
        <a class="detail-chip-link" href="/dashboard?view=analysis&symbol=${encodeURIComponent(symbol)}">Analysis tab</a>
      </div>
    </section>`;
}

function relatedBillsList(data) {
  return (data.relatedBills || data.causality?.relatedBills || []).slice(0, 5);
}

function relatedBillsCardsHtml(bills) {
  const rows = Array.isArray(bills) ? bills.slice(0, 5) : [];
  if (!rows.length) return `<p class="muted">No mapped bills yet for this symbol.</p>`;
  return `
    <div class="brief-related-bill-cards">
      ${rows
        .map(
          (b) => `
        <a class="brief-related-bill-card" href="/bill/${encodeURIComponent(b.id)}">
          <span class="mono">${escapeHtml(b.displayId || b.id)}</span>
          <strong>${escapeHtml(b.title || "")}</strong>
          ${b.momentum != null ? `<span class="muted">Momentum ${escapeHtml(String(b.momentum))}/100</span>` : ""}
          ${b.latestAction ? `<span class="muted">${escapeHtml(String(b.latestAction).slice(0, 120))}</span>` : ""}
        </a>`
        )
        .join("")}
    </div>`;
}

function billsBlock(bills) {
  const rows = Array.isArray(bills) ? bills : [];
  if (!rows.length) return "";
  return `
    <section class="detail-card-panel">
      <h2>Related legislation</h2>
      ${relatedBillsCardsHtml(rows)}
    </section>`;
}

function scenarioBlock(scenarios) {
  const rows = Array.isArray(scenarios) ? scenarios : [];
  if (!rows.length) return "";
  return `
    <section class="detail-card-panel">
      <h2>Scenarios</h2>
      ${rows
        .map(
          (s) => `<div class="detail-scenario ${escapeHtml(s.cls || "")}">
            <strong>${escapeHtml(s.name)}</strong>
            <p>${escapeHtml(s.change)}</p>
            <p class="muted">${escapeHtml(s.read || "")}</p>
          </div>`
        )
        .join("")}
    </section>`;
}

function nodesBlock(nodes) {
  const rows = Array.isArray(nodes) ? nodes : [];
  if (!rows.length) return "";
  return `
    <details class="detail-card-panel bill-collapse">
      <summary><h2>How money flows</h2><span class="bill-collapse-hint muted">Reference</span></summary>
      <ol class="contract-flow-list">${rows.map((n) => `<li><strong>${escapeHtml(n.step)}</strong> ${escapeHtml(n.title)} — <span class="muted">${escapeHtml(n.detail)}</span></li>`).join("")}</ol>
    </details>`;
}

function translationBlock(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return "";
  return `
    <details class="detail-card-panel bill-collapse">
      <summary><h2>Plain-English translation</h2><span class="bill-collapse-hint muted">Reference</span></summary>
      ${list.map((t) => `<p><strong>${escapeHtml(t.title)}</strong> — ${escapeHtml(t.body)}</p>`).join("")}
    </details>`;
}

function period(a) {
  const s = a.startDate || "";
  const e = a.endDate || "";
  if (s && e) return `${s} → ${e}`;
  return s || e || "—";
}

function errorBlock(id, msg) {
  return `<section class="stock-card-error"><h1>${escapeHtml(id)}</h1><p>${escapeHtml(msg)}</p><a class="card-button" href="/dashboard?view=contracts">Dashboard</a></section>`;
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
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 1e6 ? 0 : 2 });
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
