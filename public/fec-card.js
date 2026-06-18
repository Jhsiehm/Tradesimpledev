const THEME_KEY = "ts_theme";
const BRIEF_MODE_KEY = "ts_fec_brief_mode";

const state = {
  clusterKey: document.body.dataset.fecClusterKey || pathClusterKey() || "",
  theme: storedTheme(),
  mode: storedBriefMode(),
  data: null,
  steps: [],
  stepIndex: 0
};

document.addEventListener("DOMContentLoaded", () => {
  applyTheme(state.theme);
  loadFecCard();
});

function pathClusterKey() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "fec") return "";
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

async function loadFecCard() {
  const root = document.getElementById("fec-card-root");
  if (!state.clusterKey) {
    root.innerHTML = errorSection("Missing cluster key", "Open a filing from the Money Trail tab.");
    return;
  }
  try {
    const data = await fetchJson(`/api/share/fec?clusterKey=${encodeURIComponent(state.clusterKey)}`);
    state.clusterKey = data.clusterKey || state.clusterKey;
    state.data = data;
    const title = data.share?.title || data.cluster?.label || state.clusterKey;
    document.title = `${title} | TradeSimple FEC brief`;
    renderApp();
  } catch (err) {
    const body = err.body || {};
    root.innerHTML = errorSection(state.clusterKey, err.message || "Could not load this FEC filing.", body);
  }
}

let fecBriefShell = null;

function renderApp() {
  const root = document.getElementById("fec-card-root");
  const data = state.data;
  state.steps = buildSteps(data);
  if (state.stepIndex >= state.steps.length) state.stepIndex = 0;
  if (fecBriefShell) BriefShell.detachWalkthrough(fecBriefShell);
  fecBriefShell = {
    prefix: "fec",
    storageKey: BRIEF_MODE_KEY,
    labels: {
      full: "Full brief",
      lastNext: "Open Money Trail",
      next: "Continue",
      back: "← Back"
    },
    escapeHtml,
    getMode: () => state.mode,
    setMode: (m) => persistBriefMode(m),
    getSteps: () => state.steps,
    getStepIndex: () => state.stepIndex,
    setStepIndex: (i) => {
      state.stepIndex = i;
    },
    isActive: () => state.mode === "guided",
    onLastStepNext: () => {
      window.location.href = `/dashboard?view=fec&cluster=${encodeURIComponent(state.clusterKey)}`;
    },
    ctx: data
  };
  if (state.mode === "guided") {
    root.innerHTML = renderGuided(data);
    bindSharedControls(data);
    BriefShell.attachWalkthrough(fecBriefShell);
  } else {
    root.innerHTML = renderFullBrief(data);
    bindSharedControls(data);
  }
}

function bindSharedControls(data) {
  const share = document.getElementById("fec-share-copy");
  const toast = document.getElementById("fec-share-toast");
  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  };
  if (share) {
    share.addEventListener("click", async () => {
      const url = data.share?.canonicalUrl || `${window.location.origin}/fec/${encodeURIComponent(state.clusterKey)}`;
      try {
        await navigator.clipboard.writeText(url);
        share.textContent = "Copied!";
        showToast("Brief link copied — share it anywhere.");
        window.setTimeout(() => {
          share.textContent = "Copy link";
        }, 1600);
      } catch (_) {
        share.textContent = "Copy failed";
        showToast(url);
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
      <button type="button" class="card-button primary bill-share-copy-btn" id="fec-share-copy">Copy link</button>
      <a class="card-button ghost" href="/dashboard?view=fec">Money Trail</a>
    </div>
    <p class="bill-share-toast mono" id="fec-share-toast" role="status" aria-live="polite" hidden></p>`;
}

function sourceLabel(data) {
  return data.source === "fec" ? { cls: "exact", text: "Live · FEC.gov" } : { cls: "modeled", text: "Sample · illustrative" };
}

function classifyBarHtml(data) {
  const cluster = data.cluster || {};
  const fileId = (cluster.key || state.clusterKey || "").toUpperCase();
  return `
    <div class="dossier-classify mono" aria-hidden="true">
      <span class="dossier-classify-id"><span class="dossier-ts-mark">TS//</span>INTEL&ensp;//&ensp;FEC&ensp;//&ensp;${escapeHtml(fileId)}</span>
      <span class="dossier-classify-note">CAMPAIGN FINANCE CONTEXT&ensp;·&ensp;NOT INVESTMENT ADVICE</span>
    </div>`;
}

function dossierMetaHtml(data) {
  const pulse = data.pulse || {};
  const cluster = data.cluster || {};
  const prov = sourceLabel(data);
  const rows = [
    ["File ID", cluster.key || state.clusterKey],
    ["Source", prov.text],
    ["Date", formatShortDate(pulse.filingDate || data.updatedAt)],
    ["Confidence", data.source === "fec" ? "Verified FEC" : "Modeled sample"]
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
  const pulse = data.pulse || {};
  const cluster = data.cluster || {};
  const links = pulse.links || {};
  const steps = [];

  steps.push({
    id: "filed",
    short: "What filed",
    ref: "Filing summary",
    html: stepFiledHtml(data, pulse, cluster)
  });

  steps.push({
    id: "touches",
    short: "Who it touches",
    ref: "Linked entities",
    html: stepTouchesHtml(links, pulse)
  });

  steps.push({
    id: "markets",
    short: "Why markets care",
    ref: "Market relevance",
    html: stepMarketsHtml(data, pulse, links)
  });

  return steps;
}

function stepFiledHtml(data, pulse, cluster) {
  const prov = sourceLabel(data);
  return `
    <p class="bill-card-id mono">${escapeHtml(cluster.key || state.clusterKey)}</p>
    <h1 class="bill-guided-title">${escapeHtml(cluster.label || pulse.label || cluster.committee || "FEC cluster")}</h1>
    <div class="intelligence-meta-strip">
      <span class="dossier-stamp ${escapeHtml(prov.cls)}">${escapeHtml(prov.text)}</span>
      <span class="dossier-chip mono">${escapeHtml(cluster.committee || pulse.committee || "Committee")}</span>
      ${cluster.chamber || pulse.chamber ? `<span class="dossier-chip mono">${escapeHtml(cluster.chamber || pulse.chamber)}</span>` : ""}
    </div>
    <p class="bill-guided-lede">${escapeHtml(pulse.plainEnglish || "")}</p>
    <div class="bill-guided-facts">
      <div class="bill-guided-fact"><span class="bill-guided-fact-label">Cycle</span><p class="mono">${escapeHtml(String(data.cycle || pulse.period || "—"))}</p></div>
      <div class="bill-guided-fact"><span class="bill-guided-fact-label">Amount</span><p class="mono">${escapeHtml(pulse.amountSummary || "—")}</p></div>
      <div class="bill-guided-fact"><span class="bill-guided-fact-label">Last filing</span><p class="mono">${escapeHtml(formatShortDate(pulse.filingDate || "—"))}</p></div>
      ${pulse.recentFilings ? `<div class="bill-guided-fact"><span class="bill-guided-fact-label">Recent filings</span><p><strong class="mono">${escapeHtml(String(pulse.recentFilings))}</strong> in last 48h</p></div>` : ""}
    </div>`;
}

function stepTouchesHtml(links, pulse) {
  const sections = [
    linkSectionHtml("Tickers", links.tickers || [], (row) => row.symbol, (row) => BriefShell.stockPageUrl(row.symbol)),
    linkSectionHtml("Bills", links.bills || [], (row) => row.title || row.id, (row) => `/bill/${encodeURIComponent(row.id)}`),
    linkSectionHtml("Lobbying filings", links.lobbyingFilings || [], (row) => row.client || row.id, (row) => BriefShell.lobbyPageUrl(row.id)),
    linkSectionHtml("Contract awards", links.contracts || [], (row) => row.recipient || row.id, null)
  ].filter(Boolean);
  const tickers = (pulse.tickers || []).slice(0, 8);
  return `
    <h2 class="bill-step-title">Who does this filing touch?</h2>
    <p class="bill-guided-lede muted">Every link uses explicit maps in fec-committee-map.json and policy-crosswalk.json — not keyword guessing.</p>
    ${tickers.length ? `<div class="bill-ticker-row">${tickers.map((t) => `<span class="ticker-chip-link">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
    ${sections.length ? sections.join("") : `<p class="muted">No explicit cross-links in map yet for this cluster.</p>`}`;
}

function stepMarketsHtml(data, pulse, links) {
  const tickers = (links.tickers || pulse.tickers || []).slice(0, 6);
  const marketLines = marketBullets(pulse, links);
  return `
    <h2 class="bill-step-title">Why markets care</h2>
    <p class="bill-guided-lede">${escapeHtml(pulse.plainEnglish || "PAC receipts signal committee influence that can precede contract awards, lobbying, and bill action.")}</p>
    ${marketLines.length ? `<ul class="bill-guided-watchlist">${marketLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : ""}
    ${tickers.length
      ? `<div class="bill-guided-fact"><span class="bill-guided-fact-label">Tickers in play</span>
        <div class="bill-ticker-row">${tickers.map((t) => {
          const sym = typeof t === "string" ? t : t.symbol;
          return `<a class="ticker-chip-link" href="${escapeHtml(BriefShell.stockPageUrl(sym))}">${escapeHtml(sym)}</a>`;
        }).join("")}</div></div>`
      : ""}
    <p class="dossier-redaction mono">Campaign finance context — not investment advice</p>
    <div class="bill-guided-cta">
      ${pulse.fecUrl ? `<a class="card-button bill-cta-primary" target="_blank" rel="noopener noreferrer" href="${escapeHtml(pulse.fecUrl)}">View on FEC.gov</a>` : ""}
      <a class="card-button ghost" href="/dashboard?view=fec">Open Money Trail</a>
    </div>`;
}

function renderGuided(data) {
  const cluster = data.cluster || {};
  const steps = state.steps.map((s) => ({ ...s, title: s.short, sectionRef: s.ref }));
  return BriefShell.renderGuidedArticle({
    mode: state.mode,
    steps,
    stepIndex: state.stepIndex,
    prefix: "fec",
    escapeHtml,
    classifyHtml: classifyBarHtml(data),
    headerHtml: heroActionsHtml(),
    metaHtml: dossierMetaHtml(data),
    showModeToggle: true,
    footerHtml: `
      <footer class="bill-guided-footer mono">
        <p>${escapeHtml((data.share?.disclaimer || "Campaign finance context only. Not investment advice.").toUpperCase())}</p>
        <p class="bill-updated">END OF BRIEF&ensp;//&ensp;${escapeHtml((cluster.key || state.clusterKey).toUpperCase())}&ensp;//&ensp;UPDATED ${escapeHtml(freshnessText(data.updatedAt).toUpperCase())}</p>
      </footer>`,
    labels: { full: "Full brief", lastNext: "Open Money Trail", next: "Continue", back: "← Back" }
  });
}

function renderFullBrief(data) {
  const pulse = data.pulse || {};
  const cluster = data.cluster || {};
  const links = pulse.links || {};
  const prov = sourceLabel(data);
  const accentClass = data.source === "fec" ? "brief-accent--high" : "brief-accent--medium";

  return `
    <article class="bill-card-page intelligence-file stock-card-shell ${accentClass}">
      ${classifyBarHtml(data)}
      <header class="bill-card-hero">
        <div class="bill-card-hero-top">
          ${modeToggleHtml()}
          ${heroActionsHtml()}
        </div>
        ${dossierMetaHtml(data)}
        <p class="bill-card-id mono">${escapeHtml(cluster.key || state.clusterKey)}</p>
        <h1>${escapeHtml(cluster.label || pulse.label || cluster.committee || "FEC cluster")}</h1>
        <div class="intelligence-meta-strip">
          <span class="dossier-stamp ${escapeHtml(prov.cls)}">${escapeHtml(prov.text)}</span>
          <span class="dossier-chip mono">${escapeHtml(cluster.committee || pulse.committee || "Committee")}</span>
          ${cluster.chamber || pulse.chamber ? `<span class="dossier-chip mono">${escapeHtml(cluster.chamber || pulse.chamber)}</span>` : ""}
          ${data.cycle ? `<span class="dossier-chip mono">${escapeHtml(String(data.cycle))} cycle</span>` : ""}
        </div>
        <p class="intelligence-lede">${escapeHtml(pulse.plainEnglish || "")}</p>
        <p class="bill-card-disclaimer muted">${escapeHtml(data.share?.disclaimer || "Campaign finance context only. Not investment advice.")}</p>
      </header>

      <section class="intelligence-annex">
        <p class="intelligence-annex-id mono">ANNEX A · FILING SUMMARY</p>
        <div class="bill-guided-facts">
          <div class="bill-guided-fact"><span class="bill-guided-fact-label">Amount</span><p class="mono">${escapeHtml(pulse.amountSummary || "—")}</p></div>
          <div class="bill-guided-fact"><span class="bill-guided-fact-label">Period</span><p>${escapeHtml(pulse.period || String(data.cycle || "—"))}</p></div>
          <div class="bill-guided-fact"><span class="bill-guided-fact-label">Last filing</span><p class="mono">${escapeHtml(formatShortDate(pulse.filingDate || "—"))}</p></div>
          ${pulse.recentFilings ? `<div class="bill-guided-fact"><span class="bill-guided-fact-label">Recent activity</span><p><strong class="mono">${escapeHtml(String(pulse.recentFilings))}</strong> filing(s) in 48h</p></div>` : ""}
        </div>
      </section>

      ${moneyTrailAnnex(links, pulse)}

      <section class="intelligence-annex">
        <p class="intelligence-annex-id mono">ANNEX C · MARKET RELEVANCE</p>
        <h2 class="intelligence-annex-title">Why this matters</h2>
        <ul class="money-context-bullets">
          ${marketBullets(pulse, links).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ul>
        <p class="dossier-redaction mono">Campaign finance context — not investment advice</p>
      </section>

      <footer class="bill-card-footer intelligence-file-footer">
        <p class="muted">Source: FEC.gov via Open FEC API when configured. Links from fec-committee-map.json and policy-crosswalk.json.</p>
        <div class="bill-card-footer-links">
          ${pulse.fecUrl ? `<a class="card-button" target="_blank" rel="noopener noreferrer" href="${escapeHtml(pulse.fecUrl)}">View on FEC.gov</a>` : ""}
          <a class="card-button ghost" href="/dashboard?view=fec">Open Money Trail</a>
        </div>
        <p class="bill-updated muted mono">END OF BRIEF&ensp;//&ensp;${escapeHtml((cluster.key || state.clusterKey).toUpperCase())}&ensp;//&ensp;UPDATED ${escapeHtml(freshnessText(data.updatedAt).toUpperCase())}</p>
      </footer>
    </article>`;
}

function moneyTrailAnnex(links, pulse) {
  const sections = [
    annexLinkBlock("Tickers", links.tickers || [], (row) => row.symbol, (row) => BriefShell.stockPageUrl(row.symbol)),
    annexLinkBlock("Bills", links.bills || [], (row) => row.title || row.id, (row) => `/bill/${encodeURIComponent(row.id)}`),
    annexLinkBlock("Lobbying filings", links.lobbyingFilings || [], (row) => row.client || row.id, (row) => BriefShell.lobbyPageUrl(row.id)),
    annexLinkBlock("Contract awards", links.contracts || [], (row) => row.recipient || row.id, null)
  ].filter(Boolean);
  if (!sections.length && !(pulse.tickers || []).length) {
    return `
      <section class="intelligence-annex">
        <p class="intelligence-annex-id mono">ANNEX B · MONEY TRAIL</p>
        <p class="muted">No explicit cross-links in map yet for this cluster.</p>
      </section>`;
  }
  return `
    <section class="intelligence-annex">
      <p class="intelligence-annex-id mono">ANNEX B · MONEY TRAIL</p>
      <h2 class="intelligence-annex-title">Linked entities</h2>
      ${(pulse.tickers || []).length ? `<div class="bill-ticker-row">${(pulse.tickers || []).slice(0, 8).map((t) => `<span class="ticker-chip-link">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      ${sections.join("")}
    </section>`;
}

function annexLinkBlock(title, rows, labelFn, hrefFn) {
  if (!rows.length) return "";
  return `
    <div class="bill-guided-fact" style="margin-top:1rem">
      <span class="bill-guided-fact-label">${escapeHtml(title)}</span>
      <ul class="intelligence-link-list">
        ${rows.slice(0, 8).map((row) => {
          const label = labelFn(row);
          const href = hrefFn ? hrefFn(row) : null;
          const labelHtml = href
            ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
            : escapeHtml(label);
          return `<li class="intelligence-link-item">
            <span class="intelligence-link-label">${labelHtml}</span>
            ${row.linkReason ? `<p class="intelligence-link-reason muted">${escapeHtml(row.linkReason)}</p>` : ""}
          </li>`;
        }).join("")}
      </ul>
    </div>`;
}

function linkSectionHtml(title, rows, labelFn, hrefFn) {
  if (!rows.length) return "";
  return `
    <div class="bill-guided-fact">
      <span class="bill-guided-fact-label">${escapeHtml(title)}</span>
      <ul class="intelligence-link-list">
        ${rows.slice(0, 6).map((row) => {
          const label = labelFn(row);
          const href = hrefFn ? hrefFn(row) : null;
          const labelHtml = href
            ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
            : escapeHtml(label);
          return `<li class="intelligence-link-item">
            <span class="intelligence-link-label">${labelHtml}</span>
            ${row.linkReason ? `<p class="intelligence-link-reason muted">${escapeHtml(row.linkReason)}</p>` : ""}
          </li>`;
        }).join("")}
      </ul>
    </div>`;
}

function marketBullets(pulse, links) {
  const lines = [];
  const counts = pulse.linkCounts || {};
  if (counts.tickers) lines.push(`${counts.tickers} ticker(s) mapped via explicit PAC cluster map.`);
  if (counts.bills) lines.push(`${counts.bills} bill(s) share committee or policy tags with this cluster.`);
  if (counts.lobbyingFilings) lines.push(`${counts.lobbyingFilings} lobbying filing(s) cross-linked via client/ticker maps.`);
  if (counts.contracts) lines.push(`${counts.contracts} contract award(s) tied to cluster recipients or agencies.`);
  if (pulse.recentFilings) lines.push(`${pulse.recentFilings} fresh filing(s) in the last 48 hours — watch for follow-on lobbying or bill action.`);
  if (!lines.length && (links.tickers || pulse.tickers || []).length) {
    lines.push(`Tickers ${(pulse.tickers || []).slice(0, 4).join(", ")} sit in this committee's influence zone.`);
  }
  return lines.slice(0, 5);
}

function errorSection(id, message, body = {}) {
  const known =
    Array.isArray(body.knownClusterKeys) && body.knownClusterKeys.length
      ? `<p class="muted">Known clusters on this server:</p><ul class="bill-known-list">${body.knownClusterKeys
          .map((key) => `<li><a href="/fec/${encodeURIComponent(key)}">${escapeHtml(key)}</a></li>`)
          .join("")}</ul>`
      : "";
  return `
    <section class="stock-card-error">
      <span class="mini-label">FEC brief unavailable</span>
      <h1>${escapeHtml(id)}</h1>
      <p>${escapeHtml(message)}</p>
      ${known}
      <a class="card-button" href="/dashboard?view=fec">Open Money Trail</a>
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

function formatShortDate(value) {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return String(value || "—");
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
