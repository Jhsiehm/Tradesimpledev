const THEME_KEY = "ts_theme";
const BRIEF_MODE_KEY = "ts_bill_brief_mode";

const state = {
  billId: document.body.dataset.billId || pathBillId() || "",
  theme: storedTheme(),
  mode: storedBriefMode(),
  data: null,
  steps: [],
  stepIndex: 0
};

document.addEventListener("DOMContentLoaded", () => {
  applyTheme(state.theme);
  loadBillCard();
});

function pathBillId() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "bill") return "";
  return decodeURIComponent(parts[1] || "");
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
  state.mode = BriefShell.persistMode(BRIEF_MODE_KEY, mode);
}

function applyTheme(theme) {
  const normalized = theme === "light" ? "light" : "dark";
  state.theme = normalized;
  document.documentElement.dataset.theme = normalized;
  try {
    localStorage.setItem(THEME_KEY, normalized);
  } catch (_) {}
}

async function loadBillCard() {
  try {
    localStorage.setItem("ts_bill_brief_opened", "1");
  } catch (_) {}
  const root = document.getElementById("bill-card-root");
  if (!state.billId) {
    root.innerHTML = errorSection("Missing bill id", "Open a bill from the dashboard Bills tab.");
    return;
  }
  try {
    const data = await fetchJson(`/api/share/bill?billId=${encodeURIComponent(state.billId)}`);
    state.billId = data.billId || state.billId;
    state.data = data;
    const title = data.share?.title || data.bill?.shortTitle || state.billId;
    document.title = `${title} | TradeSimple bill brief`;
    renderApp();
  } catch (err) {
    const body = err.body || {};
    root.innerHTML = errorSection(state.billId, err.message || "Could not load this bill.", body);
  }
}

let billBriefShell = null;

function renderApp() {
  const root = document.getElementById("bill-card-root");
  const data = state.data;
  state.steps = buildSteps(data);
  if (state.stepIndex >= state.steps.length) state.stepIndex = 0;
  if (billBriefShell) BriefShell.detachWalkthrough(billBriefShell);
  billBriefShell = {
    prefix: "bill",
    storageKey: BRIEF_MODE_KEY,
    labels: {
      full: "Full brief",
      lastNext: "Open the dashboard",
      next: "Continue",
      back: "← Back"
    },
    escapeHtml,
    getMode: () => state.mode,
    setMode: (m) => {
      persistBriefMode(m);
    },
    getSteps: () => state.steps,
    getStepIndex: () => state.stepIndex,
    setStepIndex: (i) => {
      state.stepIndex = i;
    },
    isActive: () => state.mode === "guided",
    onLastStepNext: () => {
      window.location.href = `/dashboard?view=bills&bill=${encodeURIComponent(state.billId)}`;
    },
    ctx: data
  };
  if (state.mode === "guided") {
    root.innerHTML = renderGuided(data);
    bindSharedControls(data);
    BriefShell.attachWalkthrough(billBriefShell);
  } else {
    root.innerHTML = renderFullBrief(data);
    bindSharedControls(data);
  }
}

/* ---------- shared controls (copy link, dashboard, mode toggle) ---------- */

function bindSharedControls(data) {
  const share = document.getElementById("bill-share-copy");
  if (share) {
    share.addEventListener("click", async () => {
      const url = data.share?.canonicalUrl || `${window.location.origin}/bill/${encodeURIComponent(state.billId)}`;
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
    <div class="bill-card-actions">
      <button type="button" class="card-button ghost" id="bill-share-copy">Copy link</button>
      <a class="card-button ghost" href="/dashboard?view=bills">Dashboard</a>
    </div>`;
}

function classifyBarHtml(bill) {
  return `
    <div class="dossier-classify mono" aria-hidden="true">
      <span class="dossier-classify-id">TRADESIMPLE INTELLIGENCE BRIEF&ensp;//&ensp;${escapeHtml((bill.displayId || bill.id || state.billId || "").toUpperCase())}</span>
      <span class="dossier-classify-note">RESEARCH CONTEXT&ensp;·&ensp;NOT INVESTMENT ADVICE</span>
    </div>`;
}

function dossierMetaHtml(data) {
  const bill = data.bill || {};
  const status = data.statusInfo || {};
  const breakdown = data.breakdown || {};
  const prov = provenanceLabel(bill);
  const confidence = breakdown.billSignalConfidence?.label || bill.signalConfidence || "—";
  const dateLabel = formatShortDate(data.updatedAt || Date.now());
  const rows = [
    ["Date", dateLabel],
    ["Source", prov.text],
    ["Status", status.label || bill.status || "—"],
    ["Confidence", confidence]
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

/* ---------- guided walkthrough ---------- */

function buildSteps(data) {
  const bill = data.bill || {};
  const status = data.statusInfo || {};
  const breakdown = data.breakdown || {};
  const leg = data.legislativeContext || bill.legislativeContext || {};
  const steps = [];

  steps.push({
    id: "bill",
    short: "The bill",
    ref: "Subject bill",
    html: stepBillHtml(bill, data)
  });

  const whereHtml = stepWhereHtml(bill, status, leg);
  if (whereHtml) {
    steps.push({ id: "where", short: "Where it stands", ref: "Legislative position", html: whereHtml });
  }

  steps.push({
    id: "market",
    short: "Market impact",
    ref: "Market relevance",
    html: stepMarketHtml(bill, breakdown, data)
  });

  const scenarioHtml = stepScenariosHtml(data, bill);
  if (scenarioHtml) {
    steps.push({ id: "scenarios", short: "Two scenarios", ref: "Scenario analysis", html: scenarioHtml });
  }

  const lobbyHtml = stepLobbyHtml(bill);
  if (lobbyHtml) {
    steps.push({ id: "lobby", short: "Who's pushing", ref: "Stakeholder pressure", html: lobbyHtml });
  }

  steps.push({
    id: "next",
    short: "What to watch",
    ref: "Forward watch",
    html: stepNextHtml(bill, status, leg)
  });

  return steps;
}

function stepBillHtml(bill, data) {
  const prov = provenanceLabel(bill);
  const status = data.statusInfo || {};
  const oneLiner = bill.plainEnglish || bill.signal || (bill.title !== bill.shortTitle ? bill.title : "") || "";
  const ai = data.aiSummary?.text
    ? `<p class="bill-guided-lede bill-ai-lede">${escapeHtml(data.aiSummary.text)}</p><p class="muted">AI summary · from live bill data</p>`
    : "";
  return `
    <p class="bill-card-id mono">${escapeHtml(bill.displayId || bill.id || state.billId)}</p>
    <h1 class="bill-guided-title">${escapeHtml(bill.shortTitle || bill.title || state.billId)}</h1>
    ${ai || (oneLiner ? `<p class="bill-guided-lede">${escapeHtml(oneLiner)}</p>` : "")}
    <div class="bill-card-badges">
      <span class="dossier-stamp ${escapeHtml(prov.cls)}">${escapeHtml(prov.text)}</span>
      <span class="dossier-chip mono">${escapeHtml(status.label || bill.status || "Status")}</span>
      ${bill.chamber ? `<span class="dossier-chip mono">${escapeHtml(bill.chamber)}</span>` : ""}
    </div>`;
}

function stepWhereHtml(bill, status, leg) {
  const stagePath = Array.isArray(status.stagePath) ? status.stagePath : [];
  const lastAction = bill.latestAction || leg.latestActionText || "";
  if (!stagePath.length && !lastAction) return "";
  const days = leg.daysSinceIntroduced;
  const facts = [];
  if (lastAction) {
    facts.push(
      `<div class="bill-guided-fact"><span class="bill-guided-fact-label">Last action</span><p>${escapeHtml(String(lastAction).slice(0, 160))}</p>${
        leg.latestActionLabel ? `<p class="muted mono bill-guided-fact-date">${escapeHtml(leg.latestActionLabel)}</p>` : ""
      }</div>`
    );
  }
  if (Number.isFinite(days)) {
    facts.push(
      `<div class="bill-guided-fact"><span class="bill-guided-fact-label">Time in Congress</span><p><strong class="mono">${escapeHtml(String(days))}</strong> days since introduction${
        leg.introducedDate ? ` <span class="muted">(${escapeHtml(formatShortDate(leg.introducedDate))})</span>` : ""
      }</p></div>`
    );
  }
  return `
    <h2 class="bill-step-title">Where is it right now?</h2>
    ${stageTrackerHtml(stagePath, status.key)}
    ${status.marketMeaning ? `<p class="bill-guided-lede">${escapeHtml(status.marketMeaning)}</p>` : ""}
    ${facts.length ? `<div class="bill-guided-facts">${facts.join("")}</div>` : ""}`;
}

function stageTrackerHtml(stagePath, activeKey) {
  if (!stagePath.length) return "";
  return `
    <ol class="bill-stage-track" aria-label="Legislative stage">
      ${stagePath
        .map((s) => {
          const active = s.key === activeKey || s.state === "active";
          const done = s.state === "done";
          return `<li class="${active ? "active" : ""} ${done ? "done" : ""}">
            ${active ? `<span class="bill-stage-here">You are here</span>` : ""}
            <span class="bill-stage-dot" aria-hidden="true"></span>
            <span class="bill-stage-lbl">${escapeHtml(s.label)}</span>
          </li>`;
        })
        .join("")}
    </ol>`;
}

function stepMarketHtml(bill, breakdown, data) {
  const momentum = breakdown.legislativeMomentum?.score ?? bill.legislativeMomentum ?? "—";
  const signalConf = breakdown.billSignalConfidence?.label || bill.signalConfidence || "—";
  const exposureConf = data.exposureConfidence || bill.exposureConfidence || null;
  const catalyst = bill.catalyst || {};
  const tickers = (data.relatedTickers || bill.affected || []).slice(0, 12);
  const exposureNote = exposureConf
    ? `<div class="bill-guided-fact"><span class="bill-guided-fact-label">Exposure confidence</span><p><strong>${escapeHtml(exposureConf)}</strong> <span class="muted">· rules-based ticker mapping${exposureConf === "low" ? " (illustrative)" : ""}</span></p></div>`
    : "";
  return `
    <h2 class="bill-step-title">Why it matters for markets</h2>
    ${catalyst.label
      ? `<p class="bill-guided-lede">Catalyst: ${escapeHtml(catalyst.label)}${catalyst.dateLabel || bill.latestActionDate ? ` · ${escapeHtml(catalyst.dateLabel || bill.latestActionDate)}` : ""}</p>`
      : bill.signal
        ? `<p class="bill-guided-lede">${escapeHtml(bill.signal)}</p>`
        : ""}
    <div class="bill-guided-scores">
      <div><span class="score-label">Momentum</span><strong class="mono">${escapeHtml(String(momentum))}/100</strong></div>
      <div><span class="score-label">Signal confidence</span><strong>${escapeHtml(signalConf)}</strong></div>
    </div>
    ${exposureNote}
    ${tickers.length
      ? `<div class="bill-guided-fact"><span class="bill-guided-fact-label">Related tickers</span>
        <div class="bill-ticker-row">${tickers.map((t) => `<a class="ticker-chip-link" href="/stock/${encodeURIComponent(typeof t === "string" ? t : t.symbol || t)}">${escapeHtml(typeof t === "string" ? t : t.symbol || t)}</a>`).join("")}</div>
        <div class="brief-trace-row">${BriefShell.traceTickerCtaHtml(tickers[0], escapeHtml)}</div></div>`
      : `<p class="muted bill-guided-note">No ticker mapping yet — monitor sector headlines and committee action.</p>`}
    <p class="dossier-redaction mono">Illustrative model — not investment advice</p>`;
}

function stepScenariosHtml(data, bill) {
  const pass = Array.isArray(data.passImpacts) && data.passImpacts.length ? data.passImpacts : bill.passImpacts || [];
  const fail = Array.isArray(data.failImpacts) && data.failImpacts.length ? data.failImpacts : bill.failImpacts || [];
  if (!pass.length && !fail.length) return "";
  return `
    <h2 class="bill-step-title">If it passes vs. if it stalls</h2>
    <div class="bill-scenario-grid">
      ${scenarioCardHtml("If it passes", pass, "pass")}
      ${scenarioCardHtml("If it stalls or fails", fail, "fail")}
    </div>
    <p class="dossier-redaction mono">Illustrative models — not price targets or investment advice</p>`;
}

function scenarioCardHtml(title, rows, tone) {
  if (!rows.length) return "";
  return `
    <div class="bill-scenario-card ${tone}">
      <h3>${escapeHtml(title)}</h3>
      <ul class="bill-impact-list">
        ${rows
          .map(
            (row) =>
              `<li><span class="mono">${escapeHtml(row.symbol || row.sym || row.ticker || "")}</span> ${escapeHtml(row.headline || row.label || row.why || "")} <span class="muted">${escapeHtml(row.range || row.impact || "")}</span></li>`
          )
          .join("")}
      </ul>
    </div>`;
}

function stepLobbyHtml(bill) {
  const rows = bill.stakeholders?.lobbying || [];
  const hasLda = bill.lobbyingSource === "senate_lda";
  if (!rows.length && !hasLda) return "";
  return `
    <h2 class="bill-step-title">Who is pushing this bill?</h2>
    ${rows.length ? lobbyingTable(bill) : ""}
    ${hasLda
      ? `<p class="muted bill-guided-note">Senate LDA: ${escapeHtml(String(bill.lobbyingFilingsCount || 0))} matched filing(s) · against $${escapeHtml(String(bill.lobbyingAgainst ?? "—"))}M · for $${escapeHtml(String(bill.lobbyingFor ?? "—"))}M</p>`
      : `<p class="muted bill-guided-note">Stances and amounts shown when lobbying filings are matched.</p>`}`;
}

function stepNextHtml(bill, status, leg) {
  const vote = leg.voteWatch || {};
  const next = leg.nextMilestone || {};
  const watchItems = Array.isArray(bill.watchFor) ? bill.watchFor.slice(0, 4) : [];
  const voteUrgent = /floor|chamber|cross-chamber/i.test(vote.label || "");
  return `
    <h2 class="bill-step-title">What to watch next</h2>
    <div class="bill-guided-callouts">
      ${vote.label
        ? `<div class="bill-vote-callout${voteUrgent ? " is-urgent" : ""}"><span class="mini-label">Vote watch</span>
          <p class="bill-vote-callout-title">${escapeHtml(vote.label)}</p><p class="muted">${escapeHtml(vote.detail || "")}</p></div>`
        : ""}
      <div class="bill-next-milestone"><span class="mini-label">Next milestone</span>
        <p><strong>${escapeHtml(next.label || status.nextStep || "Watch the next official action.")}</strong></p>
        <p class="muted">${escapeHtml(next.detail || "")}</p></div>
    </div>
    ${watchItems.length ? `<ul class="bill-guided-watchlist">${watchItems.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>` : ""}
    <div class="bill-guided-cta">
      <a class="card-button bill-cta-primary" href="/dashboard?view=bills&bill=${encodeURIComponent(bill.id || state.billId)}">Track it on the dashboard</a>
      ${bill.congressUrl || bill.sourceUrl
        ? `<a class="card-button ghost" target="_blank" rel="noopener noreferrer" href="${escapeHtml(bill.congressUrl || bill.sourceUrl)}">Congress.gov / source</a>`
        : ""}
    </div>
    <p class="muted bill-guided-note">${escapeHtml(sourceNote(bill))}</p>`;
}

function renderGuided(data) {
  const bill = data.bill || {};
  const steps = state.steps.map((s) => ({ ...s, title: s.short, sectionRef: s.ref }));
  return BriefShell.renderGuidedArticle({
    mode: state.mode,
    steps,
    stepIndex: state.stepIndex,
    prefix: "bill",
    escapeHtml,
    classifyHtml: classifyBarHtml(bill),
    headerHtml: heroActionsHtml(),
    metaHtml: dossierMetaHtml(data),
    footerHtml: `
      <footer class="bill-guided-footer mono">
        <p>${escapeHtml((data.share?.disclaimer || data.methodologyDisclaimer || "").toUpperCase())}</p>
        <p class="bill-updated">END OF BRIEF&ensp;//&ensp;${escapeHtml((bill.displayId || bill.id || state.billId).toUpperCase())}&ensp;//&ensp;UPDATED ${escapeHtml(freshnessText(data.updatedAt).toUpperCase())}</p>
      </footer>`,
    labels: { full: "Full brief", lastNext: "Open the dashboard", next: "Continue", back: "← Back" }
  });
}

/* ---------- full single-scroll brief ---------- */

function renderFullBrief(data) {
  const bill = data.bill || {};
  const status = data.statusInfo || {};
  const breakdown = data.breakdown || {};
  const momentum = breakdown.legislativeMomentum?.score ?? bill.legislativeMomentum ?? "—";
  const lobby = breakdown.lobbyingPressureOnBillCard?.score ?? bill.lobbyingPressureScore ?? 0;
  const prov = provenanceLabel(bill);
  const stagePath = Array.isArray(status.stagePath) ? status.stagePath : [];
  const tickers = (data.relatedTickers || bill.affected || []).slice(0, 12);
  const catalyst = bill.catalyst || {};
  const leg = bill.legislativeContext || {};

  return `
    <article class="bill-card-page stock-card-shell">
      ${classifyBarHtml(bill)}
      <header class="bill-card-hero">
        <div class="bill-card-hero-top">
          ${modeToggleHtml()}
          ${heroActionsHtml()}
        </div>
        <p class="bill-card-id mono">${escapeHtml(bill.displayId || bill.id || state.billId)}</p>
        <h1>${escapeHtml(bill.shortTitle || bill.title || state.billId)}</h1>
        ${bill.title && bill.shortTitle && bill.title !== bill.shortTitle ? `<p class="bill-card-long-title muted">${escapeHtml(bill.title)}</p>` : ""}
        <div class="bill-card-badges">
          <span class="bill-prov-pill ${escapeHtml(prov.cls)}">${escapeHtml(prov.text)}</span>
          <span class="status-stage-chip">${escapeHtml(status.label || bill.status || "Status")}</span>
          ${bill.chamber ? `<span class="mini-pill">${escapeHtml(bill.chamber)}</span>` : ""}
        </div>
        <p class="bill-card-disclaimer muted">${escapeHtml(data.share?.disclaimer || data.methodologyDisclaimer || "")}</p>
      </header>
      ${data.aiSummary?.text ? `<section class="bill-card-panel bill-ai-summary"><h2>Plain-English summary</h2><p>${escapeHtml(data.aiSummary.text)}</p><p class="muted">AI synthesis from live bill data</p></section>` : ""}

      ${legislativeTimelineSection(leg, bill, status)}
      <section class="bill-card-grid">
        <div class="bill-card-panel">
          <h2>Legislative posture</h2>
          <p class="bill-next-step">${escapeHtml(status.nextStep || "Watch the next official action.")}</p>
          <p class="muted">${escapeHtml(status.marketMeaning || "")}</p>
          ${stagePathHtml(stagePath, status.key)}
          <dl class="bill-meta-dl">
            <div><dt>Sponsor</dt><dd>${escapeHtml(formatSponsor(bill.sponsor))}</dd></div>
            <div><dt>Cosponsors</dt><dd class="mono">${escapeHtml(String(bill.cosponsors ?? "—"))}</dd></div>
            <div><dt>Latest action</dt><dd>${escapeHtml(bill.latestAction || "—")}</dd></div>
            <div><dt>Date</dt><dd class="mono">${escapeHtml(bill.latestActionDate || "—")}</dd></div>
          </dl>
        </div>
        <div class="bill-card-panel">
          <h2>Scores</h2>
          <div class="bill-score-row">
            <div><span class="score-label">Momentum</span><strong class="mono">${escapeHtml(String(momentum))}/100</strong></div>
            <div><span class="score-label">Lobbying pressure</span><strong class="mono">${escapeHtml(String(lobby))}/100</strong></div>
            <div><span class="score-label">Signal confidence</span><strong>${escapeHtml(breakdown.billSignalConfidence?.label || bill.signalConfidence || "—")}</strong></div>
          </div>
          ${catalyst.label ? `<p class="muted">Catalyst: ${escapeHtml(catalyst.label)} · ${escapeHtml(catalyst.dateLabel || bill.latestActionDate || "")}</p>` : ""}
          <p class="muted">${escapeHtml(bill.plainEnglish || bill.signal || "")}</p>
        </div>
      </section>

      ${tickers.length ? `
      <section class="bill-card-panel">
        <h2>Related tickers</h2>
        <div class="bill-ticker-row">
          ${tickers.map((t) => `<a class="ticker-chip-link" href="/stock/${encodeURIComponent(t)}">${escapeHtml(t)}</a>`).join("")}
        </div>
        <div class="brief-trace-row">${BriefShell.traceTickerCtaHtml(tickers[0], escapeHtml)}</div>
      </section>` : ""}

      ${impactSection("If it passes", data.passImpacts || bill.passImpacts)}
      ${impactSection("If it stalls or fails", data.failImpacts || bill.failImpacts)}

      <section class="bill-card-panel">
        <h2>Lobbying & stakeholders</h2>
        ${lobbyingTable(bill)}
        ${bill.lobbyingSource === "senate_lda"
          ? `<p class="muted">Senate LDA: ${escapeHtml(String(bill.lobbyingFilingsCount || 0))} matched filing(s) · against $${escapeHtml(String(bill.lobbyingAgainst ?? "—"))}M · for $${escapeHtml(String(bill.lobbyingFor ?? "—"))}M</p>`
          : `<p class="muted">No firm-level LDA rows matched yet when keys are configured.</p>`}
      </section>

      ${momentumBreakdownHtml(breakdown)}
      ${historicalBlock(data.historicalAnalog || bill.historicalAnalog)}
      ${watchList(bill)}

      <footer class="bill-card-footer">
        <p class="muted">${escapeHtml(sourceNote(bill))}</p>
        <div class="bill-card-footer-links">
          ${bill.congressUrl || bill.sourceUrl
            ? `<a class="card-button" target="_blank" rel="noopener noreferrer" href="${escapeHtml(bill.congressUrl || bill.sourceUrl)}">Congress.gov / source</a>`
            : ""}
          <a class="card-button ghost" href="/dashboard?view=bills&bill=${encodeURIComponent(bill.id || state.billId)}">Back to bills table</a>
        </div>
        <p class="bill-updated muted">Updated ${escapeHtml(freshnessText(data.updatedAt))}</p>
      </footer>
    </article>`;
}

function legislativeTimelineSection(leg, bill, status) {
  if (!leg?.timelineRows?.length) return "";
  const vote = leg.voteWatch || {};
  const voteUrgent = /floor|chamber|cross-chamber/i.test(vote.label || "");
  const next = leg.nextMilestone || {};
  const primaryRows = leg.timelineRows.filter((r) => r.key !== "policy-area");
  return `
    <section class="bill-card-panel bill-legislative-timeline-panel">
      <div class="bill-timeline-head">
        <div>
          <h2>Legislative calendar</h2>
          <p class="muted bill-timeline-lead">What happened, which committee matters, and whether a floor vote is even on the calendar yet.</p>
        </div>
        ${bill.chamber ? `<span class="mini-pill">${escapeHtml(bill.chamber)}</span>` : ""}
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
            <p><strong>${escapeHtml(next.label || status.nextStep || "—")}</strong></p>
            <p class="muted">${escapeHtml(next.detail || "")}</p>
          </div>
        </aside>
      </div>
    </section>`;
}

function stagePathHtml(stagePath, activeKey) {
  if (!stagePath.length) return "";
  return `<ol class="bill-stage-path">${stagePath
    .map(
      (s) =>
        `<li class="${s.key === activeKey || s.state === "active" ? "active" : ""} ${s.state === "done" ? "done" : ""}"><span>${escapeHtml(s.label)}</span></li>`
    )
    .join("")}</ol>`;
}

function impactSection(title, impacts) {
  const rows = Array.isArray(impacts) ? impacts : [];
  if (!rows.length) return "";
  return `
    <section class="bill-card-panel">
      <h2>${escapeHtml(title)}</h2>
      <ul class="bill-impact-list">
        ${rows
          .map(
            (row) =>
              `<li><span class="mono">${escapeHtml(row.symbol || row.sym || row.ticker || "")}</span> ${escapeHtml(row.headline || row.label || row.why || "")} <span class="muted">${escapeHtml(row.range || row.impact || "")}</span></li>`
          )
          .join("")}
      </ul>
      <p class="muted">Scenario ranges are illustrative models, not price targets or investment advice.</p>
    </section>`;
}

function lobbyingFirmCell(row) {
  const name = row.name || "";
  const filingId = String(row.filingId || "").trim();
  const topTicker = Array.isArray(row.tickers) ? row.tickers[0] : null;
  const firmHtml = filingId
    ? `<a class="bill-lobby-firm-link" href="${escapeHtml(BriefShell.lobbyPageUrl(filingId))}">${escapeHtml(name)}</a>`
    : escapeHtml(name);
  const traceHtml = topTicker
    ? ` <a class="bill-lobby-ticker-link mono" href="${escapeHtml(BriefShell.stockPageUrl(topTicker))}">Trace ${escapeHtml(topTicker)} →</a>`
    : "";
  return `${firmHtml}${traceHtml}`;
}

function lobbyingTable(bill) {
  const rows = bill.stakeholders?.lobbying || [];
  if (!rows.length) {
    return `<p class="muted">No mapped lobbying rows for this bill.</p>`;
  }
  return `
    <table class="bill-lobby-table">
      <thead><tr><th>Firm</th><th>Stance</th><th>Amount</th><th>Issue</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (l) =>
              `<tr><td>${lobbyingFirmCell(l)}</td><td>${escapeHtml(l.stance || "")}</td><td class="mono">${money(l.amount || 0)}</td><td>${escapeHtml(l.issue || "")}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

function momentumBreakdownHtml(breakdown) {
  const comps = breakdown?.legislativeMomentum?.components;
  if (!Array.isArray(comps) || !comps.length) return "";
  return `
    <details class="bill-card-panel bill-collapse">
      <summary><h2>How momentum is scored</h2><span class="bill-collapse-hint muted">Reference</span></summary>
      <table class="bill-metric-table">
        <thead><tr><th>Factor</th><th>Score</th><th>Weight</th></tr></thead>
        <tbody>
          ${comps
            .map(
              (c) =>
                `<tr><td>${escapeHtml(c.label)}</td><td class="mono">${escapeHtml(String(c.value))}</td><td class="mono">${escapeHtml(String(c.weightPct ?? Math.round(c.weight * 100)))}%</td></tr>`
            )
            .join("")}
        </tbody>
      </table>
      <p class="muted">${escapeHtml(breakdown.legislativeMomentum?.note || "")}</p>
    </details>`;
}

function historicalBlock(analog) {
  if (!analog?.title) return "";
  const facts = Array.isArray(analog.verifiedFacts) ? analog.verifiedFacts : [];
  return `
    <details class="bill-card-panel bill-historical-block bill-collapse">
      <summary><h2>Verified historical analog</h2><span class="bill-collapse-hint muted">Reference</span></summary>
      <p><strong>${escapeHtml(analog.title)}</strong> — ${escapeHtml(analog.outcome || "")}</p>
      <p class="muted">${escapeHtml(analog.impact || "")}</p>
      ${facts.length
        ? `<ul>${facts.map((f) => `<li><a href="${escapeHtml(f.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(f.claim)}</a></li>`).join("")}</ul>`
        : ""}
    </details>`;
}

function watchList(bill) {
  const items = Array.isArray(bill.watchFor) ? bill.watchFor : [];
  if (!items.length) return "";
  return `
    <section class="bill-card-panel">
      <h2>What to watch</h2>
      <ul>${items.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
    </section>`;
}

/* ---------- shared helpers ---------- */

function provenanceLabel(bill) {
  if (bill?.exactCongressRecord) return { cls: "exact", text: "Live · Congress.gov" };
  if (bill?.scenarioOnly || bill?.dataLayer === "scenario") return { cls: "scenario", text: "Scenario model" };
  return { cls: "modeled", text: "Mixed / pending live" };
}

function sourceNote(bill) {
  if (bill?.exactCongressRecord) return "Exact Congress.gov bill record when API keys are configured.";
  if (bill?.scenarioOnly) return bill?.sourceNote || "TradeSimple scenario — not a live Congress.gov record.";
  return bill?.sourceNote || "Modeled seed; verify status on Congress.gov.";
}

function formatSponsor(sponsor) {
  if (!sponsor?.name) return "—";
  const party = sponsor.party ? ` (${sponsor.party}-${sponsor.state || ""})` : "";
  return `${sponsor.name}${party}`;
}

function formatShortDate(value) {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return String(value || "");
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function errorSection(id, message, body = {}) {
  const known =
    Array.isArray(body.knownBillIds) && body.knownBillIds.length
      ? `<p class="muted">Curated bills on this server:</p><ul class="bill-known-list">${body.knownBillIds
          .map((bid) => `<li><a href="/bill/${encodeURIComponent(bid)}">${escapeHtml(bid)}</a></li>`)
          .join("")}</ul>`
      : "";
  const congressNote = body.congressKeyRequired
    ? `<p class="muted">Arbitrary bill IDs require <code>CONGRESS_API_KEY</code> on the server (Railway Variables).</p>`
    : "";
  return `
    <section class="stock-card-error">
      <span class="mini-label">Bill unavailable</span>
      <h1>${escapeHtml(id)}</h1>
      <p>${escapeHtml(message)}</p>
      ${congressNote}
      ${known}
      <a class="card-button" href="/dashboard?view=bills">Open bills dashboard</a>
    </section>`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  let body = {};
  try {
    body = await res.json();
  } catch (_) {}
  if (!res.ok) {
    const err = new Error(body.message || body.error || `${res.status}`);
    err.body = body;
    throw err;
  }
  return body;
}

function freshnessText(value) {
  if (!value) return "recently";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "recently";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function money(value) {
  const n = Number(value || 0);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 1e6 ? 0 : 2 });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
