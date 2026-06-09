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
  try {
    const stored = localStorage.getItem(BRIEF_MODE_KEY);
    if (stored === "full" || stored === "guided") return stored;
  } catch (_) {}
  return "guided";
}

function persistBriefMode(mode) {
  state.mode = mode === "full" ? "full" : "guided";
  try {
    localStorage.setItem(BRIEF_MODE_KEY, state.mode);
  } catch (_) {}
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

function renderApp() {
  const root = document.getElementById("lobby-card-root");
  const data = state.data;
  if (state.mode === "guided") {
    state.steps = buildSteps(data);
    if (state.stepIndex >= state.steps.length) state.stepIndex = 0;
    root.innerHTML = renderGuided(data);
    bindSharedControls(data);
    bindGuidedControls();
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
  return `
    <div class="bill-mode-toggle" role="group" aria-label="Brief view mode">
      <button type="button" data-brief-mode="guided" class="bill-mode-btn${state.mode === "guided" ? " is-active" : ""}" aria-pressed="${state.mode === "guided"}">Guided</button>
      <button type="button" data-brief-mode="full" class="bill-mode-btn${state.mode === "full" ? " is-active" : ""}" aria-pressed="${state.mode === "full"}">Full brief</button>
    </div>`;
}

function heroActionsHtml() {
  return `
    <div class="bill-card-actions detail-card-actions">
      <button type="button" class="card-button ghost" id="detail-share-copy">Copy link</button>
      <a class="card-button ghost" href="/dashboard?view=lobbying">Dashboard</a>
    </div>`;
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
      html: stepTickersHtml(tickers)
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

function stepTickersHtml(tickers) {
  return `
    <h2 class="bill-step-title">Which tickers map to this client?</h2>
    <p class="bill-guided-lede">TradeSimple links lobbying clients to publicly traded symbols when the name match is clear.</p>
    <div class="bill-ticker-row">
      ${tickers.map((t) => `<a class="ticker-chip-link" href="/stock/${encodeURIComponent(t)}">${escapeHtml(t)}</a>`).join("")}
    </div>`;
}

function stepBillsHtml(bills) {
  return `
    <h2 class="bill-step-title">Related legislation</h2>
    <ul class="bill-guided-watchlist">
      ${bills
        .map(
          (b) =>
            `<li><a href="/bill/${encodeURIComponent(b.id)}">${escapeHtml(b.displayId || b.id)}</a> — ${escapeHtml(b.title || "")} <span class="muted">Momentum ${escapeHtml(String(b.momentum ?? "—"))}/100</span></li>`
        )
        .join("")}
    </ul>`;
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
  return `
    <article class="bill-guided stock-card-shell">
      ${classifyBarHtml(f)}
      <header class="bill-guided-top">
        ${modeToggleHtml()}
        ${heroActionsHtml()}
      </header>
      ${dossierMetaHtml(data)}
      <div class="bill-guided-bar">
        <nav class="bill-step-toc-wrap" aria-label="Brief steps">
          <ol class="bill-step-toc" id="bill-step-toc">
            ${state.steps
              .map(
                (s, i) => `<li><button type="button" data-goto-step="${i}" class="${i === state.stepIndex ? "is-current" : ""}${i < state.stepIndex ? " is-done" : ""}" aria-current="${i === state.stepIndex ? "step" : "false"}">
                  <span class="bill-step-num mono">${String(i + 1).padStart(2, "0")}</span><span class="bill-step-name">${escapeHtml(s.short)}</span>
                </button></li>`
              )
              .join("")}
          </ol>
        </nav>
        <span class="bill-step-count mono" id="bill-step-count" aria-live="polite">Step ${state.stepIndex + 1} of ${state.steps.length}</span>
      </div>
      <section class="bill-step-viewport" id="bill-step-viewport" tabindex="0" aria-label="Current step">
        ${stepInnerHtml(state.stepIndex)}
      </section>
      <div class="bill-step-controls">
        <button type="button" class="card-button ghost dossier-nav-btn" id="bill-step-back">&larr; Back</button>
        <button type="button" class="card-button bill-next-btn dossier-nav-btn" id="bill-step-next">Continue &rarr;</button>
      </div>
      <footer class="bill-guided-footer mono">
        <p>${escapeHtml((data.share?.disclaimer || "").toUpperCase())}</p>
        <p class="bill-updated">END OF BRIEF&ensp;//&ensp;${escapeHtml((f.filingId || state.filingId).toUpperCase())}&ensp;//&ensp;UPDATED ${escapeHtml(freshness(data.updatedAt).toUpperCase())}</p>
      </footer>
    </article>`;
}

function stepInnerHtml(index) {
  const step = state.steps[index];
  if (!step) return "";
  const total = state.steps.length;
  return `
    <div class="bill-step" data-step-id="${escapeHtml(step.id)}">
      <p class="bill-step-ref mono">SECTION ${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}&ensp;&mdash;&ensp;${escapeHtml(step.ref.toUpperCase())}</p>
      ${step.html}
    </div>`;
}

function bindGuidedControls() {
  const viewport = document.getElementById("bill-step-viewport");
  const back = document.getElementById("bill-step-back");
  const next = document.getElementById("bill-step-next");
  if (!viewport || !back || !next) return;

  back.addEventListener("click", () => goToStep(state.stepIndex - 1, -1));
  next.addEventListener("click", () => {
    if (state.stepIndex >= state.steps.length - 1) {
      window.location.href = `/dashboard?view=lobbying`;
      return;
    }
    goToStep(state.stepIndex + 1, 1);
  });
  document.querySelectorAll("[data-goto-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = Number(btn.dataset.gotoStep);
      if (Number.isFinite(target)) goToStep(target, target > state.stepIndex ? 1 : -1);
    });
  });

  document.addEventListener("keydown", onGuidedKeydown);

  let touchX = null;
  let touchY = null;
  viewport.addEventListener(
    "touchstart",
    (e) => {
      touchX = e.touches[0]?.clientX ?? null;
      touchY = e.touches[0]?.clientY ?? null;
    },
    { passive: true }
  );
  viewport.addEventListener(
    "touchend",
    (e) => {
      if (touchX == null || touchY == null) return;
      const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
      const dy = (e.changedTouches[0]?.clientY ?? touchY) - touchY;
      touchX = null;
      touchY = null;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      goToStep(state.stepIndex + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    },
    { passive: true }
  );

  syncGuidedControls();
}

function onGuidedKeydown(e) {
  if (state.mode !== "guided") return;
  const tag = (e.target?.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (e.key === "ArrowRight") {
    e.preventDefault();
    goToStep(state.stepIndex + 1, 1);
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    goToStep(state.stepIndex - 1, -1);
  }
}

function goToStep(index, dir) {
  if (index < 0 || index >= state.steps.length || index === state.stepIndex) return;
  state.stepIndex = index;
  const viewport = document.getElementById("bill-step-viewport");
  if (!viewport) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const swap = () => {
    viewport.innerHTML = stepInnerHtml(state.stepIndex);
    syncGuidedControls();
    if (!reduceMotion) {
      viewport.dataset.dir = dir > 0 ? "fwd" : "back";
      viewport.classList.remove("is-leaving");
      viewport.classList.add("is-entering");
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => viewport.classList.remove("is-entering"));
      });
    }
  };
  if (reduceMotion) {
    swap();
  } else {
    viewport.dataset.dir = dir > 0 ? "fwd" : "back";
    viewport.classList.add("is-leaving");
    window.setTimeout(swap, 130);
  }
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
}

function syncGuidedControls() {
  const back = document.getElementById("bill-step-back");
  const next = document.getElementById("bill-step-next");
  const count = document.getElementById("bill-step-count");
  const last = state.stepIndex >= state.steps.length - 1;
  if (back) back.disabled = state.stepIndex === 0;
  if (next) next.textContent = last ? "Open dashboard" : "Continue";
  if (count) count.textContent = `Step ${state.stepIndex + 1} of ${state.steps.length}`;
  document.querySelectorAll("[data-goto-step]").forEach((btn) => {
    const i = Number(btn.dataset.gotoStep);
    btn.classList.toggle("is-current", i === state.stepIndex);
    btn.classList.toggle("is-done", i < state.stepIndex);
    btn.setAttribute("aria-current", i === state.stepIndex ? "step" : "false");
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
