const state = { filingId: document.body.dataset.lobbyId || pathFilingId() || "" };

document.addEventListener("DOMContentLoaded", loadLobbyCard);

function pathFilingId() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[0] === "lobby" ? decodeURIComponent(parts[1] || "") : "";
}

async function loadLobbyCard() {
  const root = document.getElementById("lobby-card-root");
  if (!state.filingId) {
    root.innerHTML = errorBlock("Missing filing", "Open a filing from the Lobbying tab.");
    return;
  }
  try {
    const data = await fetchJson(`/api/share/lobby?filingId=${encodeURIComponent(state.filingId)}`);
    const f = data.filing || {};
    document.title = `${data.share?.title || f.client || "Lobbying"} | TradeSimple`;
    root.innerHTML = renderLobby(data);
    bindCopyLink(data);
  } catch (err) {
    root.innerHTML = errorBlock(state.filingId, err.message || "Could not load filing.");
  }
}

function renderLobby(data) {
  const f = data.filing || {};
  const pressure = Number(f.lobbyingPressure ?? 0);
  return `
    <article class="detail-card-page stock-card-shell">
      <header class="detail-card-hero">
        <div class="detail-card-hero-top">
          <span class="mini-label">Lobbying filing brief</span>
          <div class="detail-card-actions">
            <button type="button" class="card-button ghost" id="detail-share-copy">Copy link</button>
            <a class="card-button ghost" href="/dashboard?view=lobbying">Dashboard</a>
          </div>
        </div>
        <p class="mono muted">${escapeHtml(f.filingId || state.filingId)}</p>
        <h1>${escapeHtml(f.client || "Lobbying client")}</h1>
        <p>${escapeHtml(f.issue || "Issue not listed")}</p>
        <p class="muted">Filed by ${escapeHtml(f.registrant || "unknown")} · ${escapeHtml(f.postedAt || "—")}</p>
        <p class="muted">${escapeHtml(data.share?.disclaimer || "")}</p>
      </header>

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
          <p class="muted">Source: ${escapeHtml(data.source || f.source || "lda")}</p>
        </div>
      </section>

      ${relatedBills(data.relatedBills)}
      <footer class="detail-card-panel"><p class="muted">Updated ${escapeHtml(freshness(data.updatedAt))}</p></footer>
    </article>`;
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

function bindCopyLink(data) {
  const btn = document.getElementById("detail-share-copy");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const url = data.share?.canonicalUrl || `${location.origin}/lobby/${encodeURIComponent(state.filingId)}`;
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
