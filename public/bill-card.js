const THEME_KEY = "ts_theme";

const state = {
  billId: document.body.dataset.billId || pathBillId() || "",
  theme: storedTheme()
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

function applyTheme(theme) {
  const normalized = theme === "light" ? "light" : "dark";
  state.theme = normalized;
  document.documentElement.dataset.theme = normalized;
  try {
    localStorage.setItem(THEME_KEY, normalized);
  } catch (_) {}
}

async function loadBillCard() {
  const root = document.getElementById("bill-card-root");
  if (!state.billId) {
    root.innerHTML = errorSection("Missing bill id", "Open a bill from the dashboard Bills tab.");
    return;
  }
  try {
    const data = await fetchJson(`/api/share/bill?billId=${encodeURIComponent(state.billId)}`);
    state.billId = data.billId || state.billId;
    const title = data.share?.title || data.bill?.shortTitle || state.billId;
    document.title = `${title} | TradeSimple bill brief`;
    root.innerHTML = renderBillCard(data);
    bindBillCardControls(data);
  } catch (err) {
    root.innerHTML = errorSection(state.billId, err.message || "Could not load this bill.");
  }
}

function bindBillCardControls(data) {
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
}

function renderBillCard(data) {
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
      <header class="bill-card-hero">
        <div class="bill-card-hero-top">
          <span class="mini-label">TradeSimple bill brief</span>
          <div class="bill-card-actions">
            <button type="button" class="card-button ghost" id="bill-share-copy">Copy link</button>
            <a class="card-button ghost" href="/dashboard?view=bills">Dashboard</a>
          </div>
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
              `<li><span class="mono">${escapeHtml(row.symbol || row.ticker || "")}</span> ${escapeHtml(row.headline || row.label || "")} <span class="muted">${escapeHtml(row.range || row.impact || "")}</span></li>`
          )
          .join("")}
      </ul>
      <p class="muted">Scenario ranges are illustrative models, not price targets or investment advice.</p>
    </section>`;
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
              `<tr><td>${escapeHtml(l.name || "")}</td><td>${escapeHtml(l.stance || "")}</td><td class="mono">${money(l.amount || 0)}</td><td>${escapeHtml(l.issue || "")}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

function momentumBreakdownHtml(breakdown) {
  const comps = breakdown?.legislativeMomentum?.components;
  if (!Array.isArray(comps) || !comps.length) return "";
  return `
    <section class="bill-card-panel">
      <h2>How momentum is scored</h2>
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
    </section>`;
}

function historicalBlock(analog) {
  if (!analog?.title) return "";
  const facts = Array.isArray(analog.verifiedFacts) ? analog.verifiedFacts : [];
  return `
    <section class="bill-card-panel bill-historical-block">
      <h2>Verified historical analog</h2>
      <p><strong>${escapeHtml(analog.title)}</strong> — ${escapeHtml(analog.outcome || "")}</p>
      <p class="muted">${escapeHtml(analog.impact || "")}</p>
      ${facts.length
        ? `<ul>${facts.map((f) => `<li><a href="${escapeHtml(f.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(f.claim)}</a></li>`).join("")}</ul>`
        : ""}
    </section>`;
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

function errorSection(id, message) {
  return `
    <section class="stock-card-error">
      <span class="mini-label">Bill unavailable</span>
      <h1>${escapeHtml(id)}</h1>
      <p>${escapeHtml(message)}</p>
      <a class="card-button" href="/dashboard?view=bills">Open bills dashboard</a>
    </section>`;
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
