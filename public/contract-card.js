const state = { symbol: document.body.dataset.contractSymbol || pathSymbol() || "" };

document.addEventListener("DOMContentLoaded", loadContractCard);

function pathSymbol() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return (parts[1] || "").toUpperCase().replace(/[^A-Z]/g, "");
}

async function loadContractCard() {
  const root = document.getElementById("contract-card-root");
  if (!state.symbol) {
    root.innerHTML = errorBlock("Missing symbol", "Open a contract from the dashboard.");
    return;
  }
  try {
    const data = await fetchJson(`/api/share/contract?symbol=${encodeURIComponent(state.symbol)}`);
    document.title = `${data.share?.title || state.symbol} | TradeSimple`;
    root.innerHTML = renderContract(data);
    bindCopyLink(data);
  } catch (err) {
    root.innerHTML = errorBlock(state.symbol, err.message || "Could not load contract brief.");
  }
}

function renderContract(data) {
  const c = data.causality || {};
  const profile = c.profile || data.causality?.profile || {};
  const awards = data.awards || [];
  return `
    <article class="detail-card-page stock-card-shell">
      <header class="detail-card-hero">
        <div class="detail-card-hero-top">
          <span class="mini-label">Federal contract brief</span>
          <div class="detail-card-actions">
            <button type="button" class="card-button ghost" id="detail-share-copy">Copy link</button>
            <a class="card-button ghost" href="/stock/${encodeURIComponent(data.symbol)}">Stock card</a>
            <a class="card-button ghost" href="/dashboard?view=contracts">Dashboard</a>
          </div>
        </div>
        <p class="mono muted">${escapeHtml(data.symbol)}</p>
        <h1>${escapeHtml(data.company || data.symbol)}</h1>
        <p class="muted">${escapeHtml(c.archetype || "Government contractor profile")} · ${escapeHtml(c.scores?.confidence || "—")} confidence</p>
        <p class="muted">${escapeHtml(data.share?.disclaimer || "")}</p>
      </header>

      <section class="detail-grid-2">
        <div class="detail-card-panel">
          <h2>Exposure snapshot</h2>
          <div class="detail-metric-row">
            <div><span class="label">Gov revenue share</span><strong>${profile.governmentRevenuePct != null ? Math.round(profile.governmentRevenuePct * 100) + "%" : "—"}</strong></div>
            <div><span class="label">Renewal risk</span><strong>${profile.renewalRisk != null ? Math.round(profile.renewalRisk * 100) + "/100" : "—"}</strong></div>
            <div><span class="label">Dependency score</span><strong>${escapeHtml(String(c.scores?.dependency ?? "—"))}/100</strong></div>
            <div><span class="label">Total obligated (sample)</span><strong>${money(data.totalObligated || 0)}</strong></div>
          </div>
          <p>${escapeHtml(c.plainEnglish || "")}</p>
          ${c.dogeRisk ? `<p class="muted">Flagged for agency efficiency / DOGE-style review risk in TradeSimple model.</p>` : ""}
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
      ${billsBlock(c.relatedBills)}
      ${translationBlock(c.translation)}

      <footer class="detail-card-panel">
        <p class="muted">Source: ${escapeHtml(data.source || "usaspending.gov")} · Updated ${escapeHtml(freshness(data.updatedAt))}</p>
      </footer>
    </article>`;
}

function awardsBlock(awards, symbol) {
  if (!awards.length) {
    return `<section class="detail-card-panel"><h2>Recent awards</h2><p class="muted">No USASpending rows returned for this pull. Try again later.</p></section>`;
  }
  return `
    <section class="detail-card-panel">
      <h2>Recent awards (USASpending)</h2>
      <table class="detail-table">
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
      <div class="detail-link-row">
        <a class="detail-chip-link" href="/dashboard?view=analysis&symbol=${encodeURIComponent(symbol)}">Analysis tab</a>
      </div>
    </section>`;
}

function billsBlock(bills) {
  const rows = Array.isArray(bills) ? bills : [];
  if (!rows.length) return "";
  return `
    <section class="detail-card-panel">
      <h2>Related legislation</h2>
      <div class="detail-link-row">
        ${rows.map((b) => `<a class="detail-chip-link" href="/bill/${encodeURIComponent(b.id)}">${escapeHtml(b.displayId || b.id)}</a>`).join("")}
      </div>
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
    <section class="detail-card-panel">
      <h2>How money flows</h2>
      <ol>${rows.map((n) => `<li><strong>${escapeHtml(n.step)}</strong> ${escapeHtml(n.title)} — <span class="muted">${escapeHtml(n.detail)}</span></li>`).join("")}</ol>
    </section>`;
}

function translationBlock(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return "";
  return `
    <section class="detail-card-panel">
      <h2>Plain-English translation</h2>
      ${list.map((t) => `<p><strong>${escapeHtml(t.title)}</strong> — ${escapeHtml(t.body)}</p>`).join("")}
    </section>`;
}

function bindCopyLink(data) {
  const btn = document.getElementById("detail-share-copy");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const url = data.share?.canonicalUrl || `${location.origin}/contract/${encodeURIComponent(state.symbol)}`;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = "Copied";
      setTimeout(() => {
        btn.textContent = "Copy link";
      }, 1500);
    } catch {
      btn.textContent = url;
    }
  });
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
    .replaceAll('"', "&quot;");
}
