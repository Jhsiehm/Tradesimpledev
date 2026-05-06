const POLICY_BLURB = {
  NVDA: "CHIPS tailwind; export-control risk",
  AAPL: "Platform antitrust risk fading",
  LLY: "Drug-pricing bill exposure",
  TSLA: "Permitting reform watch",
  AMZN: "Antitrust overhang easing"
};

const HOLDING_PALETTE = ["#5eead4", "#93c5fd", "#fcd34d", "#f87171", "#c4b5fd", "#a78bfa", "#fb923c", "#60a5fa", "#e879f9", "#4ade80"];

const MARKET_SYMBOLS = ["SPY", "QQQ", "NVDA", "AAPL", "LLY", "TSLA", "AMZN", "MSFT", "AMD", "GOOGL", "META", "COIN"];

/** Markets tab ticker table — matches GET /api/market/quotes?symbols=… comma list. */
const MARKETS_DEFAULT_SYMBOLS = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA", "LLY", "AMZN", "MSFT", "AMD", "META"];

/** Always requested so topbar tape (SPY, QQQ, NVDA, LLY, TSLA) + crypto have prices once feed loads. */
const TAPE_DEFAULT_QUOTE_SYMBOLS = ["SPY", "QQQ", "NVDA", "LLY", "TSLA"];

/** Watch-only tickers (quoted + surfaced in strip; not in the simulated holdings table). */
const WATCHLIST = [
  { symbol: "MSFT", color: "#a78bfa" },
  { symbol: "AMD", color: "#fb923c" },
  { symbol: "GOOGL", color: "#60a5fa" },
  { symbol: "META", color: "#e879f9" },
  { symbol: "COIN", color: "#4ade80" }
];

function paperPositionSymbols() {
  const positions = state?.account?.positions;
  if (!Array.isArray(positions)) return [];
  return positions.map((p) => p.symbol).filter(Boolean);
}

function quoteSymbolUniverse() {
  return [
    ...new Set([
      ...MARKETS_DEFAULT_SYMBOLS,
      ...TAPE_DEFAULT_QUOTE_SYMBOLS,
      ...MARKET_SYMBOLS,
      ...paperPositionSymbols(),
      ...WATCHLIST.map((w) => w.symbol)
    ])
  ];
}

/** Align server fields (pct vs change24h) for tape + markets crypto cards. */
function normalizeCryptoAssets(assets) {
  return (assets || []).map((a) => {
    const pctRaw = a.pct ?? a.change24h;
    const pct = pctRaw != null && Number.isFinite(Number(pctRaw)) ? Number(pctRaw) : null;
    return { ...a, pct };
  });
}

function policyBlurbFor(symbol) {
  return POLICY_BLURB[symbol] || "Mapped bills update from your open positions — open Bills for full detail.";
}

function holdingColor(symbol) {
  const w = WATCHLIST.find((item) => item.symbol === symbol);
  if (w?.color) return w.color;
  const syms = paperPositionSymbols().slice().sort();
  const idx = syms.indexOf(symbol);
  if (idx >= 0) return HOLDING_PALETTE[idx % HOLDING_PALETTE.length];
  return "var(--line)";
}

function portfolioTickerSet() {
  return new Set([...paperPositionSymbols(), ...WATCHLIST.map((w) => w.symbol)]);
}

function isTrackedTicker(sym) {
  return MARKET_SYMBOLS.includes(sym) || portfolioTickerSet().has(sym);
}

function formatSpendZ(z) {
  if (z == null || Number.isNaN(Number(z))) return "—";
  const n = Number(z);
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}σ`;
}

function lobbyZClass(z) {
  const n = Number(z);
  if (Number.isNaN(n)) return "";
  if (n >= 1.2) return "lobby-z-hot";
  if (n <= -0.8) return "lobby-z-cool";
  return "lobby-z-mid";
}

function formatBillAnalogText(bill) {
  const h = bill.historicalAnalog || bill.analog;
  if (!h) return "";
  if (typeof h === "string") return h;
  return [h.title, h.outcome, h.impact].filter(Boolean).join(" — ");
}

function billMomentum(bill) {
  return Number(bill?.legislativeMomentum ?? bill?.passageOdds ?? 0);
}

function billConfidenceLabel(bill) {
  return bill?.signalConfidence || bill?.confidence || "Low";
}

function twelveWordSummary(text) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "—";
  const slice = words.slice(0, 12).join(" ");
  return words.length > 12 ? `${slice}…` : slice;
}

function industryStanceForBill(bill) {
  const against = Number(bill.lobbyingAgainst || 0);
  const fo = Number(bill.lobbyingFor || 0);
  if (against > fo * 1.02) return { text: "Industry opposes", kind: "opp" };
  if (fo > against * 1.02) return { text: "Industry supports", kind: "for" };
  return { text: "Mixed industry signals", kind: "mix" };
}

function watchForBullets(bill) {
  const parts = String(bill.nextWatch || "")
    .split(/[.;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = parts.slice(0, 3);
  if (out.length < 3 && bill.latestAction) out.push(`Latest action: ${bill.latestAction.slice(0, 140)}${bill.latestAction.length > 140 ? "…" : ""}`);
  if (out.length < 3) out.push(bill.floorScheduled ? "Watch for a possible floor vote or scheduling update." : "Watch for committee movement and new cosponsors.");
  if (out.length < 3) out.push("Watch for new lobbying filings tied to this issue.");
  return out.slice(0, 3);
}

function analysisFocusBills() {
  if (state.policyNetwork?.focusBills?.length) return state.policyNetwork.focusBills;
  return state.analysis?.legisAlert || [];
}

function setupAnalysisTabs() {
  const buttons = document.querySelectorAll("[data-analysis-tab]");
  const panels = document.querySelectorAll("[data-analysis-panel]");
  if (!buttons.length) return;
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.analysisTab;
      buttons.forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      panels.forEach((p) => {
        p.hidden = p.dataset.analysisPanel !== tab;
      });
    });
  });
}

function setupAnalysisTickerAi() {
  const btn = $("#analysis-ticker-ai-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    openGlobalResearchDrawer();
    const q = $("#research-question");
    if (q && state.activeAnalysisSymbol) {
      q.value = `Help me understand policy, lobbying, and fundamentals for ${state.activeAnalysisSymbol}.`;
      q.focus();
    }
  });
}

function setupAnalysisLobbyBillJump() {
  const mapped = $("#analysis-lobby-mapped");
  if (!mapped) return;
  mapped.addEventListener("click", (event) => {
    const btn = event.target.closest(".analysis-jump-bill");
    const billId = btn?.dataset?.billId;
    if (!billId) return;
    event.preventDefault();
    showView("bills");
    const filter = $("#bill-filter");
    if (filter) filter.value = billId;
    renderBills();
  });
}

function analysisPlainImpactSentence(text) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return "Impact not summarized for this filing.";
  const first = t.split(/(?<=[.!?])\s+/)[0] || t;
  return first.length > 220 ? `${first.slice(0, 217)}…` : first;
}

function analysisLobbyRecencyLine(filing) {
  const d = filing.filingDate || filing.date || filing.periodEnd || filing.quarter || "";
  return d ? `Filed ${d}` : "Filing period not shown in this dataset";
}

function toggleAnalysisBillDetail(detailId) {
  const row = document.getElementById(detailId);
  if (!row) return;
  const opening = row.hidden;
  document.querySelectorAll(".analysis-bill-detail-row").forEach((r) => {
    r.hidden = true;
  });
  document.querySelectorAll(".analysis-bill-row").forEach((r) => {
    r.classList.remove("expanded");
  });
  if (opening) {
    row.hidden = false;
    document.querySelector(`[data-analysis-bill-detail="${detailId}"]`)?.classList.add("expanded");
  }
}

function renderAnalysisBillsTable(symbol) {
  const tbody = $("#analysis-bills-tbody");
  const emptyEl = $("#analysis-bills-empty");
  const billsPanel = document.querySelector('#view-analysis [data-analysis-panel="bills"]');
  const tableWrap = billsPanel?.querySelector(".table-wrap");
  if (!tbody) return;

  const bills = analysisFocusBills();
  if (!bills.length) {
    tbody.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent =
        "No bills are currently mapped to this ticker. This means no legislation in our tracked set directly names this company or sector. This is useful information — it suggests lower near-term policy risk.";
    }
    if (tableWrap) tableWrap.hidden = true;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  if (tableWrap) tableWrap.hidden = false;

  tbody.innerHTML = bills
    .map((bill, idx) => {
      const mom = billMomentum(bill);
      const lob = Number(bill.lobbyingPressureScore ?? 0);
      const stance = industryStanceForBill(bill);
      const momCls = mom >= 67 ? "high" : mom < 35 ? "low" : "medium";
      const lobCls = lob >= 67 ? "high" : lob < 35 ? "low" : "medium";
      const titleLine = bill.shortTitle || bill.title || "—";
      const what = twelveWordSummary(bill.plainEnglish || bill.signal || bill.title || "");
      const stage = String(bill.status || "introduced").toLowerCase();
      const tickers = (bill.affected || []).join(", ");
      const stanceClass =
        stance.kind === "for" ? "industry-stance-for" : stance.kind === "opp" ? "industry-stance-opp" : "industry-stance-mix";
      const stanceLabel = stance.text;
      const safeId = String(bill.id || idx).replace(/[^a-zA-Z0-9_-]/g, "");
      const detailId = `analysis-bill-detail-${safeId}-${idx}`;
      const lobbyList = bill.stakeholders?.lobbying || [];
      const lobbyRows =
        lobbyList.length > 0
          ? lobbyList
              .map(
                (l) =>
                  `<li><strong>${escapeHtml(l.name || "")}</strong> — ${money(Number(l.amount || 0))}${
                    l.issue ? ` · ${escapeHtml(l.issue)}` : ""
                  }</li>`
              )
              .join("")
          : "<li>No firm-level lobbying lines are mapped to this bill in the dataset.</li>";
      const watches = watchForBullets(bill)
        .map((w) => `<li>${escapeHtml(w)}</li>`)
        .join("");
      return `
      <tr class="analysis-bill-row" data-analysis-bill-detail="${detailId}" role="button" tabindex="0" aria-expanded="false">
        <td>
          <div class="analysis-bill-cell-title">
            <span class="mono">${escapeHtml(bill.id || "")}</span>
            <span>${escapeHtml(titleLine)}</span>
          </div>
        </td>
        <td>${escapeHtml(what)}</td>
        <td>${escapeHtml(stage)}</td>
        <td><span class="score-badge ${momCls}">${mom}/100</span></td>
        <td><span class="score-badge ${lobCls}">${lob}/100</span></td>
        <td><span class="${stanceClass}">${escapeHtml(stanceLabel)}</span></td>
        <td class="mono">${escapeHtml(tickers)}</td>
      </tr>
      <tr id="${detailId}" class="analysis-bill-detail-row" hidden>
        <td colspan="7">
          <div class="analysis-bill-detail">
            <p>${escapeHtml(bill.plainEnglish || bill.signal || "")}</p>
            <h4>Lobbying firms and spend</h4>
            <ul class="analysis-bill-lobby-list">${lobbyRows}</ul>
            <h4>Watch for:</h4>
            <ul>${watches}</ul>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");

  tbody.querySelectorAll(".analysis-bill-row").forEach((row) => {
    const detailId = row.dataset.analysisBillDetail;
    row.addEventListener("click", () => {
      const target = document.getElementById(detailId);
      const willOpen = !!(target?.hidden);
      toggleAnalysisBillDetail(detailId);
      document.querySelectorAll(".analysis-bill-row").forEach((r) => {
        r.setAttribute("aria-expanded", r === row && willOpen ? "true" : "false");
      });
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        row.click();
      }
    });
  });
}

function renderAnalysisLobbyTab() {
  const mappedEl = $("#analysis-lobby-mapped");
  const otherEl = $("#analysis-lobby-other");
  const toggleBtn = $("#analysis-lobby-other-toggle");
  if (!mappedEl || !otherEl || !toggleBtn) return;

  const sym = state.activeAnalysisSymbol;
  const filings = state.lobbying || [];
  const mapped = [];
  const other = [];

  for (const filing of filings) {
    const rel = relatedBillForFiling(filing);
    if (rel?.bill && (rel.bill.affected || []).includes(sym)) {
      mapped.push({ filing, bill: rel.bill, relationship: rel.relationship });
    } else {
      other.push(filing);
    }
  }

  if (mapped.length) {
    mappedEl.innerHTML = mapped
      .map(({ filing, bill, relationship }) => {
        const impactSrc = relationship || bill.relationshipSummary || bill.impact || bill.plainEnglish || bill.signal || "";
        const impactLine = analysisPlainImpactSentence(impactSrc);
        const billTitle = (bill.shortTitle || bill.title || bill.id || "").slice(0, 72);
        return `
        <div class="analysis-lobby-item">
          <div class="analysis-lobby-item-head"><strong>${escapeHtml(filing.client || "")}</strong></div>
          <div class="lobby-reg">${escapeHtml(filing.registrant || "")}</div>
          <div class="analysis-lobby-spend-row">
            <span class="lobby-spend">${money(Number(filing.amount || 0))}</span>
            <span class="muted">${escapeHtml(analysisLobbyRecencyLine(filing))}</span>
          </div>
          ${filing.issue ? `<span class="mini-pill">${escapeHtml(filing.issue)}</span>` : ""}
          <div class="analysis-lobby-bill-line">
            <button type="button" class="link-button analysis-jump-bill" data-bill-id="${escapeHtml(bill.id || "")}">
              ${escapeHtml(bill.id || "")} — ${escapeHtml(billTitle)}${billTitle.length >= 72 ? "…" : ""}
            </button>
          </div>
          <p class="muted" style="margin:8px 0 0;font-size:13px;line-height:1.5">${escapeHtml(impactLine)}</p>
        </div>`;
      })
      .join("");
  } else {
    mappedEl.innerHTML = `<p class="muted">No lobbying filings in the current feed are connected to a bill that names ${escapeHtml(
      sym
    )}. That can mean spend is broad-issue, not yet mapped in our model, or simply absent from the snapshot.</p>`;
  }

  toggleBtn.replaceWith(toggleBtn.cloneNode(true));
  const newToggle = $("#analysis-lobby-other-toggle");
  otherEl.innerHTML = "";
  if (!other.length) {
    newToggle.hidden = true;
    otherEl.hidden = true;
    return;
  }

  newToggle.hidden = false;
  otherEl.hidden = true;
  newToggle.textContent = `Show ${other.length} other filing${other.length === 1 ? "" : "s"}`;

  otherEl.innerHTML = other
    .map(
      (f) => `
    <div class="analysis-lobby-compact">
      <div><strong>${escapeHtml(f.client || "")}</strong> <span class="lobby-reg">${escapeHtml(f.registrant || "")}</span></div>
      <div class="analysis-lobby-compact-meta"><span>${escapeHtml(f.issue || "—")}</span> · <span class="mono">${money(
        Number(f.amount || 0)
      )}</span></div>
    </div>`
    )
    .join("");

  newToggle.addEventListener("click", () => {
    otherEl.hidden = !otherEl.hidden;
    newToggle.textContent = otherEl.hidden
      ? `Show ${other.length} other filing${other.length === 1 ? "" : "s"}`
      : "Hide other filings";
  });
}

function renderAnalysisContractsTab(symbol, companyName) {
  const tbody = $("#analysis-contracts-tbody");
  if (!tbody) return;
  const co = companyName || symbol;
  tbody.innerHTML = `
    <tr>
      <td colspan="5" class="muted" style="font-size:12px;line-height:1.5">
        Placeholder only — live rows should load from <span class="mono">GET /api/contracts/${escapeHtml(symbol)}</span> when implemented.
        Showing sample shape for <strong>${escapeHtml(co)}</strong>.
      </td>
    </tr>
    <tr>
      <td>Defense Health Agency (example)</td>
      <td>Enterprise IT support — illustrative</td>
      <td class="mono">—</td>
      <td>FY sample · not live</td>
      <td><span class="score-badge medium">Expiring</span></td>
    </tr>
    <tr>
      <td>GSA (example)</td>
      <td>Software licenses — illustrative</td>
      <td class="mono">—</td>
      <td>Sample period</td>
      <td><span class="score-badge high">Active</span></td>
    </tr>
  `;
}

const state = {
  config: null,
  session: null,
  quotes: [],
  crypto: [],
  bills: [],
  lobbying: [],
  account: null,
  quoteFeedSource: "",
  analysis: null,
  policyNetwork: null,
  methodology: null,
  activeAnalysisSymbol: "NVDA",
  tradeSymbol: "NVDA",
  tradeRange: "1d",
  tradeHistory: null
};

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "landing") initLanding();
  if (page === "dashboard") initDashboard();
});

async function initLanding() {
  initScrollReveal();
  const [config, session] = await Promise.all([fetchJson("/api/config"), fetchJson("/api/session")]);
  state.config = config;
  state.session = session;
  setupWaitlistForm();

  document.querySelectorAll("[data-provider]").forEach((link) => {
    const provider = link.dataset.provider;
    if (provider === "demo" && !config.auth.demo) setDisabled(link, "Demo disabled");
    if ((provider === "google" || provider === "apple") && !config.auth[provider]) {
      setDisabled(link, `Add ${provider} OAuth keys`);
    }
  });

  const sessionLink = document.querySelector("[data-session-link]");
  if (session?.user) {
    sessionLink.textContent = "Open terminal";
    sessionLink.href = "/dashboard?view=trade";
  } else if (config.auth.demo) {
    sessionLink.textContent = "Try demo terminal";
    sessionLink.href = "/auth/demo?next=/dashboard%3Fview%3Dtrade";
  }
}

function setupWaitlistForm() {
  const form = $("#waitlist-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#waitlist-email");
    const status = $("#waitlist-status");
    const button = form.querySelector("button");
    const email = input.value.trim();

    status.className = "waitlist-status";
    status.textContent = "Adding you to the early access list...";
    button.disabled = true;

    try {
      const response = await fetchJson("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, source: "landing_waitlist" })
      });
      status.className = "waitlist-status success";
      status.textContent = response.message || "You're on the waitlist.";
      input.value = "";
    } catch (error) {
      status.className = "waitlist-status error";
      status.textContent = error.message.includes("invalid_email")
        ? "Enter a valid email address."
        : "Could not join the waitlist. Try again in a moment.";
    } finally {
      button.disabled = false;
    }
  });
}

async function initDashboard() {
  const params = new URLSearchParams(window.location.search);
  const initialSymbol = String(params.get("symbol") || "").toUpperCase().replace(/[^A-Z.]/g, "");

  try {
    state.account = await fetchJson("/api/trading/account");
  } catch (e) {
    console.warn("[init] trading account prefetch failed", e);
  }

  if (initialSymbol && isTrackedTicker(initialSymbol)) {
    state.activeAnalysisSymbol = initialSymbol;
    state.tradeSymbol = initialSymbol;
  }

  setupNavigation();
  setupForms();
  setupFilters();
  setupAnalysisControls();
  setupTradeControls();
  setupRefreshAllControl();
  setupMethodologyModal();
  setupResearchDrawer();
  setupAnalysisTabs();
  setupAnalysisTickerAi();
  setupAnalysisLobbyBillJump();

  const [config, session] = await Promise.all([fetchJson("/api/config"), fetchJson("/api/session")]);
  state.config = config;
  state.session = session;
  renderSession();
  renderConnections();

  const initialView = params.get("view") || "overview";
  showView(initialView, false);

  await Promise.all([
    refreshTerminalData(),
    loadAnalysis(state.activeAnalysisSymbol),
    loadTradeHistory(state.tradeSymbol, state.tradeRange)
  ]);
  setupEdgarControls();
  setInterval(refreshTerminalData, 60000);
}

function setupRefreshAllControl() {
  const btn = $("#refresh-all-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Refreshing…";
    try {
      await Promise.all([
        refreshTerminalData(),
        loadAnalysis(state.activeAnalysisSymbol),
        loadTradeHistory(state.tradeSymbol, state.tradeRange)
      ]);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

async function refreshTerminalData() {
  let account = state.account || null;
  try {
    account = await fetchJson("/api/trading/account");
    state.account = account;
  } catch (error) {
    console.error("[terminal] account fetch failed", error);
  }

  const settled = await Promise.allSettled([
    fetchJson(`/api/market/quotes?symbols=${quoteSymbolUniverse().join(",")}`),
    fetchJson("/api/crypto?ids=bitcoin,ethereum"),
    fetchJson("/api/congress/bills"),
    fetchJson("/api/lobbying")
  ]);

  const quotes = settled[0].status === "fulfilled" ? settled[0].value : null;
  const crypto = settled[1].status === "fulfilled" ? settled[1].value : null;
  const bills = settled[2].status === "fulfilled" ? settled[2].value : null;
  const lobbying = settled[3].status === "fulfilled" ? settled[3].value : null;

  if (settled[0].status === "rejected") console.error("[terminal] quotes fetch failed", settled[0].reason);
  if (settled[1].status === "rejected") console.error("[terminal] crypto fetch failed", settled[1].reason);
  if (settled[2].status === "rejected") console.error("[terminal] bills fetch failed", settled[2].reason);
  if (settled[3].status === "rejected") console.error("[terminal] lobbying fetch failed", settled[3].reason);

  if (quotes) {
    console.log("[client] GET /api/market/quotes raw response:", JSON.stringify(quotes));
    const rawList = quotes.quotes || [];
    state.quotes = rawList.map((q) => {
      const pctNum =
        q.pct != null ? Number(q.pct) : q.changePercent != null ? Number(q.changePercent) : 0;
      const cp = q.changePercent != null ? Number(q.changePercent) : pctNum;
      return { ...q, pct: pctNum, changePercent: cp };
    });
    state.quoteFeedSource = quotes.source || "";
  }

  if (crypto) {
    state.crypto = normalizeCryptoAssets(crypto.assets || []);
  }

  if (bills) {
    state.bills = bills.bills || [];
  }

  if (lobbying) {
    state.lobbying = lobbying.filings || [];
  }

  const mSrc = $("#market-source");
  if (mSrc) mSrc.textContent = sourceLabel(quotes?.source);
  const cSrc = $("#crypto-source");
  if (cSrc) cSrc.textContent = sourceLabel(crypto?.source);
  const bSrc = $("#bill-source");
  if (bSrc) bSrc.textContent = sourceLabel(bills?.source);
  const lSrc = $("#lobby-source");
  if (lSrc) lSrc.textContent = sourceLabel(lobbying?.source);
  const aSrc = $("#account-source");
  if (aSrc) aSrc.textContent = sourceLabel(account?.source);

  renderTape();
  const fbBadge = $("#quote-fallback-badge");
  if (fbBadge) {
    fbBadge.hidden = state.quoteFeedSource === "finnhub";
    fbBadge.title =
      "Live prices require a Finnhub API key in .env.local. Set FINNHUB_API_KEY to enable real-time quotes.";
  }
  renderOverview();
  renderMarkets();
  renderCrypto();
  renderBills();
  renderLobbying();
  renderAccount();
  if (state.analysis) renderAnalysis();
}

async function loadMarketsData() {
  try {
    const data = await fetchJson(`/api/market/quotes?symbols=${MARKETS_DEFAULT_SYMBOLS.join(",")}`);
    console.log("Quotes response:", JSON.stringify(data));
    const rawList = data.quotes || [];
    const normalized = rawList.map((q) => {
      const pctNum =
        q.pct != null ? Number(q.pct) : q.changePercent != null ? Number(q.changePercent) : 0;
      const cp = q.changePercent != null ? Number(q.changePercent) : pctNum;
      return { ...q, pct: pctNum, changePercent: cp };
    });
    const map = new Map((state.quotes || []).map((q) => [q.symbol, q]));
    normalized.forEach((q) => map.set(q.symbol, q));
    state.quotes = Array.from(map.values());
    state.quoteFeedSource = data.source || state.quoteFeedSource;
    const mSrc = $("#market-source");
    if (mSrc) mSrc.textContent = sourceLabel(data.source);
    const fbBadge = $("#quote-fallback-badge");
    if (fbBadge) {
      fbBadge.hidden = state.quoteFeedSource === "finnhub";
      fbBadge.title =
        "Live prices require a Finnhub API key in .env.local. Set FINNHUB_API_KEY to enable real-time quotes.";
    }
    renderTape();
    renderMarkets();
  } catch (e) {
    console.error("[markets] quotes fetch failed", e);
    renderMarkets();
  }

  try {
    const crypto = await fetchJson("/api/crypto?ids=bitcoin,ethereum");
    state.crypto = normalizeCryptoAssets(crypto.assets || []);
    const cSrc = $("#crypto-source");
    if (cSrc) cSrc.textContent = sourceLabel(crypto.source);
    renderCrypto();
    renderTape();
  } catch (e) {
    console.error("[markets] crypto fetch failed", e);
    renderCrypto();
    renderTape();
  }
}

function renderSession() {
  const user = state.session?.user;
  if (!user) return;
  $("[data-user-name]").textContent = user.name || "Trader";
  $("[data-user-email]").textContent = `${user.email || "local session"} - ${user.provider}`;
  $("[data-user-initials]").textContent = initials(user.name || user.email || "TS");
}

function renderTape() {
  const symbols = [...TAPE_DEFAULT_QUOTE_SYMBOLS, "BTC", "ETH"];
  const parts = symbols.map((symbol) => {
    const quote = symbol === "BTC" || symbol === "ETH"
      ? state.crypto.find((asset) => asset.symbol === symbol)
      : quoteFor(symbol);
    if (!quote) return `${symbol} waiting`;
    const pct = Number(quote.pct || 0);
    return `${symbol} <span class="${pct >= 0 ? "up" : "down"}">${pct >= 0 ? "+" : ""}${fmt(pct)}%</span>`;
  });
  $("#ticker-tape").innerHTML = parts.join("  /  ");
}

function renderOverview() {
  let value = 0;
  let cost = 0;
  let dayChange = 0;
  const positions = [];
  const fromAccount = (state.account?.positions || []).slice().sort((a, b) => Number(b.marketValue || 0) - Number(a.marketValue || 0));
  const rows = !fromAccount.length
    ? `<tr><td colspan="6">No open positions yet. Place a paper trade in Account to populate this table and the policy map.</td></tr>`
    : fromAccount
        .map((position) => {
          let quote = quoteFor(position.symbol);
          if (!quote && position.price != null) {
            quote = { price: position.price, pct: Number(position.dayPct || 0), change: 0 };
          }
          if (!quote && position.marketValue != null && Number(position.qty) > 0) {
            quote = {
              price: Number(position.marketValue) / Number(position.qty),
              pct: Number(position.dayPct || 0),
              change: 0
            };
          }
          if (!quote) return "";
          const shares = Number(position.qty || 0);
          const positionValue = Number(quote.price || 0) * shares;
          const positionCost = Number(position.avgCost || 0) * shares;
          const totalReturn = positionCost ? ((positionValue - positionCost) / positionCost) * 100 : 0;
          value += positionValue;
          cost += positionCost;
          dayChange += Number(quote.change || 0) * shares;
          const sym = position.symbol;
          const accent = holdingColor(sym);
          positions.push({
            symbol: sym,
            shares,
            avgCost: position.avgCost,
            policy: policyBlurbFor(sym),
            quote,
            value: positionValue,
            cost: positionCost,
            totalReturn
          });
          const stripe = ` style="box-shadow:inset 3px 0 0 0 ${accent}"`;
          return `
      <tr${stripe}>
        <td><span class="ticker-swatch" style="--swatch:${accent}"></span>${sym}</td>
        <td>${fmt(shares)}</td>
        <td>${money(quote.price)}${position.priceBasis === "cost_basis_fallback" ? ' <small class="muted">(cost basis)</small>' : ""}</td>
        <td>${money(positionValue)}</td>
        <td class="${quote.pct >= 0 ? "up" : "down"}">${signed(quote.pct)}%</td>
        <td>${policyBlurbFor(sym)}</td>
      </tr>
    `;
        })
        .filter(Boolean)
        .join("");

  $("#holdings-body").innerHTML = rows;
  $("#portfolio-value").textContent = money(value);
  const returnPct = cost ? ((value - cost) / cost) * 100 : 0;
  $("#portfolio-change").innerHTML = `<span class="${returnPct >= 0 ? "up" : "down"}">${signed(returnPct)}% all time</span> - ${money(dayChange)} today`;
  $("#portfolio-hero-value").textContent = money(value);
  $("#portfolio-hero-change").innerHTML = `<span class="${dayChange >= 0 ? "up" : "down"}">${dayChange >= 0 ? "+" : ""}${money(Math.abs(dayChange))} today</span> / ${signed(returnPct)}% since entry`;
  $("#portfolio-sparkline").innerHTML = portfolioSparklineSvg(value, returnPct, dayChange);
  attachLineChartInteraction("#portfolio-sparkline", portfolioSparklinePoints(value, returnPct), {
    valueKey: "value",
    dateKey: "label",
    priceLabel: "Portfolio value"
  });
  $("#holdings-updated").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("#overview-subtitle").textContent =
    state.quoteFeedSource === "fallback" || state.quoteFeedSource === "mixed"
      ? `Tracking ${state.quotes.length} equities using modeled fallback prices (set FINNHUB_API_KEY on the server for live tape), ${state.crypto.length} crypto assets, and ${state.bills.length} bills.`
      : `Tracking ${state.quotes.length} equities, ${state.crypto.length} crypto assets, and ${state.bills.length} bills.`;

  const safety = state.config?.safety;
  $("#trade-mode").textContent = safety?.liveTradingEnabled ? "Live enabled" : "Paper";
  $("#trade-mode-sub").textContent = safety?.liveTradingEnabled ? "Broker live mode is unlocked" : "Live trading is locked";

  const bills = state.bills || [];
  const maxMom = bills.reduce((max, b) => Math.max(max, billMomentum(b)), 0);
  const statBillCount = $("#stat-bill-count");
  const statBillMomentum = $("#stat-bill-momentum");
  if (statBillCount) statBillCount.textContent = String(bills.length);
  if (statBillMomentum) statBillMomentum.textContent = bills.length ? `Max legislative momentum ${maxMom}/100` : "No bills loaded yet";

  const filings = state.lobbying || [];
  const topFiling = filings.length
    ? filings.reduce(
        (best, f) => (Number(f.lobbyingPressure || 0) >= Number(best.lobbyingPressure || 0) ? f : best),
        filings[0]
      )
    : null;
  const statLobbyP = $("#stat-lobby-pressure");
  const statLobbyC = $("#stat-lobby-confidence");
  if (statLobbyP) statLobbyP.textContent = topFiling && topFiling.lobbyingPressure != null ? `${topFiling.lobbyingPressure}/100` : "—";
  if (statLobbyC) {
    statLobbyC.textContent = topFiling
      ? `Top filing · ${topFiling.filingConfidence || "Low"} confidence`
      : "No filings loaded yet";
  }

  $("#signal-list").innerHTML = state.bills
    .slice()
    .sort((a, b) => billMomentum(b) - billMomentum(a))
    .slice(0, 4)
    .map(signalCard)
    .join("");
  renderPortfolioDashboard(positions, value, returnPct, dayChange);
  renderWatchlistStrip();
  renderMarketMood();
}

function renderMarketMood() {
  if (!$("#market-mood-panel")) return;
  const spy = quoteFor("SPY");
  const qqq = quoteFor("QQQ");
  const spyPct = spy ? Number(spy.pct || 0) : 0;
  const qqqPct = qqq ? Number(qqq.pct || 0) : 0;
  const tapePct = spy && qqq ? (spyPct + qqqPct) / 2 : spyPct || qqqPct || 0;
  const fearGreed = Math.round(Math.min(92, Math.max(12, 50 + tapePct * 14)));
  const fearLbl =
    fearGreed >= 58 ? "Risk-on tilt — tape supportive today" : fearGreed <= 42 ? "Defensive tilt — tape soft today" : "Balanced — tape mixed";

  const wsbProxy = tapePct > 0.35 ? Math.min(88, 52 + tapePct * 12) : tapePct < -0.35 ? Math.max(18, 48 + tapePct * 12) : 50 + tapePct * 8;
  const wsbRounded = Math.round(Math.min(95, Math.max(8, wsbProxy)));
  const wsbLbl = wsbRounded >= 58 ? "Bullish tilt" : wsbRounded <= 42 ? "Bearish tilt" : "Neutral";

  const holdingSyms = paperPositionSymbols();
  const bills = policyBills();
  const relevant = bills.filter((b) => (b.affected || []).some((t) => holdingSyms.includes(t)));
  let policyRisk = 0;
  if (relevant.length) {
    policyRisk = Math.round(relevant.reduce((m, b) => Math.max(m, billMomentum(b)), 0));
  } else if (bills.length) {
    policyRisk = Math.round(bills.reduce((m, b) => Math.max(m, billMomentum(b)), 0) * 0.55);
  } else {
    policyRisk = 32;
  }
  const policyLbl = policyRisk >= 67 ? "Elevated" : policyRisk >= 40 ? "Medium" : "Contained";

  const filings = state.lobbying || [];
  let lobbyIntensity = 0;
  if (filings.length) {
    const slice = filings.slice(0, 8).map((f) => Number(f.lobbyingPressure || 0));
    lobbyIntensity = Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
  } else {
    lobbyIntensity = policyRisk > 50 ? 54 : 38;
  }
  const lobbyLbl = lobbyIntensity >= 67 ? "High" : lobbyIntensity >= 40 ? "Medium" : "Low";

  const setBar = (id, pct) => {
    const el = document.getElementById(id);
    if (el) el.style.width = `${Math.max(3, Math.min(100, pct))}%`;
  };
  setBar("mood-fear-greed-bar", fearGreed);
  setBar("mood-wsb-bar", wsbRounded);
  setBar("mood-policy-bar", policyRisk);
  setBar("mood-lobby-bar", lobbyIntensity);

  const fgVal = $("#mood-fear-greed-val");
  if (fgVal) {
    fgVal.textContent = String(fearGreed);
    fgVal.className = `mood-meter-val ${fearGreed >= 55 ? "up" : fearGreed <= 45 ? "down" : ""}`;
  }
  const fgLbl = $("#mood-fear-greed-lbl");
  if (fgLbl) fgLbl.textContent = fearLbl;

  const wsbVal = $("#mood-wsb-val");
  if (wsbVal) {
    wsbVal.textContent = wsbLbl;
    wsbVal.className = `mood-meter-val ${wsbRounded >= 55 ? "up" : wsbRounded <= 45 ? "down" : ""}`;
  }

  const polVal = $("#mood-policy-val");
  if (polVal) {
    polVal.textContent = `${policyLbl} (${policyRisk})`;
    polVal.className = `mood-meter-val ${policyRisk >= 60 ? "amber-text" : ""}`;
  }

  const lobVal = $("#mood-lobby-val");
  if (lobVal) {
    lobVal.textContent = `${lobbyLbl} (${lobbyIntensity})`;
    lobVal.className = `mood-meter-val ${lobbyIntensity >= 60 ? "down" : ""}`;
  }

  const maxBill = relevant.slice().sort((a, b) => billMomentum(b) - billMomentum(a))[0];
  const lly = holdingSyms.includes("LLY") ? relevant.find((b) => (b.affected || []).includes("LLY")) : null;
  const nvda = holdingSyms.includes("NVDA") ? relevant.find((b) => (b.affected || []).includes("NVDA")) : null;

  let summary = `Tape mood is ${tapePct >= 0 ? "positive" : "negative"} on a blended SPY/QQQ move (${signed(tapePct)}% average). `;
  if (maxBill) {
    const title = maxBill.shortTitle || maxBill.title || maxBill.id;
    const snippet = title.length > 118 ? `${title.slice(0, 118)}…` : title;
    summary += `The strongest legislative momentum touching your holdings is ${maxBill.id} at ${billMomentum(maxBill)}/100 — ${snippet}. `;
  } else {
    summary += "No curated bill maps cleanly onto these holdings right now; policy heat is mostly benchmark-level. ";
  }
  if (lly && maxBill?.id !== lly.id) {
    summary += `LLY still carries drug-pricing narrative risk (${billMomentum(lly)}/100). `;
  }
  if (nvda && maxBill?.id !== nvda.id) {
    summary += `NVDA remains tied to implementation-era chips policy (${billMomentum(nvda)}/100). `;
  }
  summary += `Lobbying reads ${lobbyIntensity}/100 on recent filings — informational, not a timing signal.`;
  const sumEl = $("#market-mood-summary");
  if (sumEl) sumEl.textContent = summary;
}

function renderPortfolioDashboard(positions, totalValue, returnPct, dayChange) {
  const allocationEl = $("#portfolio-allocation");
  const policyEl = $("#portfolio-policy-feed");
  const summaryEl = $("#portfolio-dashboard-summary");
  if (!allocationEl || !policyEl || !summaryEl) return;

  const sorted = positions.slice().sort((a, b) => b.value - a.value);
  allocationEl.innerHTML = sorted.map((position) => {
    const weight = totalValue ? (position.value / totalValue) * 100 : 0;
    const col = holdingColor(position.symbol);
    return `
      <article class="allocation-row" style="--holding-accent:${col}">
        <div>
          <span class="ticker-swatch" style="--swatch:${col}"></span>
          <strong>${escapeHtml(position.symbol)}</strong>
          <span>${money(position.value)} / ${fmt(weight)}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill allocation-bar-fill" style="width:${Math.max(2, Math.min(100, weight))}%"></div></div>
        <small class="${position.totalReturn >= 0 ? "up" : "down"}">${signed(position.totalReturn)}% total return</small>
      </article>
    `;
  }).join("");

  const policyRows = sorted.map((position) => {
    const bill = policyBills().find((item) => (item.affected || []).includes(position.symbol));
    const acc = holdingColor(position.symbol);
    return `
      <article class="portfolio-policy-card ${bill ? momentumClass(bill) : ""}" style="--holding-accent:${acc}">
        <div>
          <span class="mini-pill ${bill ? momentumClass(bill) : ""}" style="border-color:${acc}">${escapeHtml(position.symbol)}</span>
          <strong>${escapeHtml(bill?.title || "No active mapped bill")}</strong>
        </div>
        <p>${escapeHtml(bill?.relationshipSummary || bill?.impact || position.policy || "This holding is mainly driven by market and company fundamentals right now.")}</p>
        ${bill ? `<small>Legislative momentum ${billMomentum(bill)}/100 · Policy exposure ${Number(bill.policyExposure ?? billMomentum(bill))}/100 · Confidence ${escapeHtml(billConfidenceLabel(bill))} · ${escapeHtml(bill.status)}</small>` : `<small>No LegisAlert pressure mapped</small>`}
      </article>
    `;
  }).join("");
  policyEl.innerHTML = policyRows;

  const best = sorted.slice().sort((a, b) => Number(b.quote?.pct || 0) - Number(a.quote?.pct || 0))[0];
  const exposed = sorted.filter((position) => policyBills().some((bill) => (bill.affected || []).includes(position.symbol)));
  const biggestBill = policyBills()
    .filter((bill) => bill.affected?.some((ticker) => positions.some((position) => position.symbol === ticker)))
    .sort((a, b) => Number(b.policyExposure ?? billMomentum(b)) - Number(a.policyExposure ?? billMomentum(a)))[0];
  summaryEl.innerHTML = `
    <article>
      <span class="mini-pill ${dayChange >= 0 ? "green" : "red"}">Today</span>
      <p>Your portfolio is ${dayChange >= 0 ? "up" : "down"} ${money(Math.abs(dayChange))} today and ${returnPct >= 0 ? "up" : "down"} ${fmt(Math.abs(returnPct))}% from entry.</p>
    </article>
    <article>
      <span class="mini-pill green">Top mover</span>
      <p>${escapeHtml(best?.symbol || "N/A")} is the strongest holding today at ${signed(best?.quote?.pct || 0)}%.</p>
    </article>
    <article>
      <span class="mini-pill amber">Policy exposure</span>
      <p>${exposed.length} holdings have mapped policy chains. ${biggestBill ? `${biggestBill.title} is the highest-impact watch item.` : "No high-impact bill is mapped to current holdings."}</p>
    </article>
    <p class="muted" style="font-size:11px;margin-top:12px;line-height:1.5">Informational scenarios only — not financial advice.</p>
  `;
}

function renderWatchlistStrip() {
  const el = $("#watchlist-strip");
  if (!el) return;
  const wlSyms = WATCHLIST.map((w) => w.symbol);
  console.log(
    "[client] watchlist symbols requested vs quotes:",
    JSON.stringify({
      watchlist: wlSyms,
      prices: wlSyms.map((sym) => {
        const q = quoteFor(sym);
        return { symbol: sym, price: q?.price, pct: q?.pct };
      })
    })
  );
  el.innerHTML = WATCHLIST.map((row) => {
    const quote = quoteFor(row.symbol);
    const pct = quote ? Number(quote.pct || 0) : null;
    const pctCls = pct == null ? "muted" : pct >= 0 ? "up" : "down";
    const pctTxt = pct == null ? "…" : `${pct >= 0 ? "+" : ""}${fmt(pct)}%`;
    return `
      <button type="button" class="watchlist-chip" data-watch-symbol="${escapeHtml(row.symbol)}" style="--watch-accent:${row.color}">
        <span class="watchlist-chip-sym">${escapeHtml(row.symbol)}</span>
        <span class="watchlist-chip-price">${quote ? money(quote.price) : "—"}</span>
        <span class="${pctCls}">${pctTxt}</span>
      </button>
    `;
  }).join("");
  el.querySelectorAll("[data-watch-symbol]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const sym = chip.dataset.watchSymbol;
      state.activeAnalysisSymbol = sym;
      const sel = $("#analysis-symbol");
      if (sel) sel.value = sym;
      showView("analysis");
      loadAnalysis(sym);
    });
  });
}

function renderMarkets() {
  console.log("Markets view activated");
  console.log("Fetching quotes for:", MARKETS_DEFAULT_SYMBOLS);
  const tbody = $("#market-body");
  if (!tbody) return;

  tbody.innerHTML = MARKETS_DEFAULT_SYMBOLS.map((sym) => {
    const quote = quoteFor(sym);
    const pctRaw = quote ? Number(quote.changePercent ?? quote.pct ?? 0) : null;
    const pct = pctRaw != null && Number.isFinite(pctRaw) ? pctRaw : null;
    const chg = quote?.change != null ? Number(quote.change) : null;
    const pctCls = pct == null ? "muted" : pct >= 0 ? "up" : "down";
    const pctTxt = pct == null ? "N/A" : `${pct >= 0 ? "+" : ""}${fmt(pct)}%`;
    const chgTxt = chg == null ? "N/A" : signed(chg);
    const policyHtml = marketsPolicySignalHtml(sym);
    return `
      <tr>
        <td class="mono">${escapeHtml(sym)}</td>
        <td class="mono">${quote?.price != null ? money(quote.price) : "N/A"}</td>
        <td class="mono ${pctCls}">${chgTxt} (${pctTxt})</td>
        <td class="mono">${quote?.open != null ? money(quote.open) : "N/A"}</td>
        <td class="mono">${quote?.high != null ? money(quote.high) : "N/A"}</td>
        <td class="mono">${quote?.low != null ? money(quote.low) : "N/A"}</td>
        <td>${policyHtml}</td>
      </tr>
    `;
  }).join("");
}

function renderCrypto() {
  const grid = $("#crypto-grid");
  if (!grid) return;
  const cryptoData = state.crypto || [];
  if (!cryptoData.length) {
    grid.innerHTML =
      '<p class="muted mono" style="padding:16px;font-size:11px;">Crypto prices unavailable. Set COINGECKO_API_KEY in .env.local for live data.</p>';
    return;
  }
  grid.innerHTML = cryptoData.map((asset) => {
    const label = asset.name || asset.id || asset.symbol || "—";
    const pct = asset.pct != null ? Number(asset.pct) : null;
    const pctCls = pct == null ? "muted" : pct >= 0 ? "up" : "down";
    const pctLine =
      pct != null ? `${signed(pct)}% in 24h` : asset.placeholder ? "Sample / offline (24h)" : "— in 24h";
    const priceNum = asset.price != null ? Number(asset.price) : NaN;
    const priceHtml =
      Number.isFinite(priceNum) && priceNum > 0 ? money(priceNum) : "— (placeholder)";
    return `
    <article class="crypto-card">
      <span class="mini-pill">${escapeHtml(asset.symbol || asset.id || "")}</span>
      <strong>${priceHtml}</strong>
      <p class="${pctCls}">${pctLine}</p>
      <p class="muted">Market cap ${asset.marketCap ? compactMoney(asset.marketCap) : "not available"}</p>
      <p class="muted mono" style="font-size:10px;">${escapeHtml(label)}</p>
    </article>
  `;
  }).join("");
}

function renderBills() {
  const query = ($("#bill-filter")?.value || "").toLowerCase();
  const bills = policyBills().filter((bill) => {
    if (!query) return true;
    return [bill.id, bill.title, bill.shortTitle, bill.status, bill.signal, ...(bill.affected || []), ...(bill.tags || [])]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const feed = $("#bill-feed");
  if (!feed) return;
  if (!bills.length) {
    feed.innerHTML = `<tr><td colspan="8">No bill matched that filter. Try a ticker like LLY, NVDA, AMZN, COIN, or TSLA.</td></tr>`;
    return;
  }
  feed.innerHTML = bills.map((bill) => {
    const tickers = (bill.affected || []).join(", ");
    const stage = String(bill.status || "").toLowerCase();
    const stageColor = stage.includes("pass")
      ? "var(--green)"
      : stage.includes("floor")
        ? "var(--green)"
        : stage.includes("committee")
          ? "var(--amber)"
          : "var(--faint)";
    const momentum = billMomentum(bill);
    const lobby = Number(bill.lobbyingPressureScore ?? 0);
    const detailsId = `bill-detail-${escapeHtml(bill.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
    return `
      <tr data-bill-toggle="${detailsId}">
        <td class="mono">${escapeHtml(bill.id)}</td>
        <td>${escapeHtml(bill.title || "")}</td>
        <td style="color:${stageColor}">${escapeHtml(stage || "introduced")}</td>
        <td><span class="score-badge ${momentum >= 67 ? "high" : momentum < 35 ? "low" : "medium"}">${momentum}/100</span></td>
        <td><span class="score-badge ${lobby >= 67 ? "high" : lobby < 35 ? "low" : "medium"}">${lobby}/100</span></td>
        <td>${escapeHtml(billConfidenceLabel(bill))}</td>
        <td class="mono">${escapeHtml(tickers)}</td>
        <td class="mono">${escapeHtml(bill.latestActionDate || "")}</td>
      </tr>
      <tr id="${detailsId}" hidden>
        <td colspan="8">
          <div style="padding:12px 0;">
            <p>${escapeHtml(bill.plainEnglish || bill.signal || "")}</p>
            <table>
              <thead><tr><th>Client</th><th>Registrant</th><th>Amount</th><th>Issue Area</th></tr></thead>
              <tbody>
                ${(state.lobbying || []).slice(0, 3).map((f) => `<tr><td>${escapeHtml(f.client || "")}</td><td>${escapeHtml(f.registrant || "")}</td><td class="mono">${money(f.amount || 0)}</td><td>${escapeHtml(f.issue || "")}</td></tr>`).join("")}
              </tbody>
            </table>
            <ul>
              <li>Watch for committee calendar movement.</li>
              <li>Watch for new bipartisan cosponsors.</li>
              <li>Watch for lobbying pressure acceleration.</li>
            </ul>
          </div>
        </td>
      </tr>
    `;
  }).join("");
  document.querySelectorAll("[data-bill-toggle]").forEach((row) => {
    row.onclick = () => {
      const target = document.getElementById(row.dataset.billToggle);
      if (target) target.hidden = !target.hidden;
    };
  });
  renderBillStakeholders();
}

function renderLobbying() {
  renderLobbyBridge();
  $("#lobby-feed").innerHTML = state.lobbying.map((filing) => {
    const pressure = Number(filing.lobbyingPressure ?? 0);
    const fConf = filing.filingConfidence || "Low";
    const z = filing.spendSpikeZ;
    const spikeX = filing.spikeVsTrail;
    const zLabel = formatSpendZ(z);
    const zPillClass = lobbyZClass(z);
    const spikeLine =
      spikeX != null && !Number.isNaN(Number(spikeX))
        ? `${Number(spikeX).toFixed(2)}× vs trail`
        : "Trail baseline";
    const connection = relatedBillForFiling(filing);
    const connectedBill = connection?.bill;
    return `
      <article class="lobby-card">
        <div class="meta-line lobby-card-metrics">
          <span class="mini-pill ${pressure >= 67 ? "red" : pressure >= 40 ? "amber" : ""}">Pressure ${pressure}/100</span>
          <span class="lobby-z-pill mini-pill ${zPillClass}">Z ${escapeHtml(zLabel)}</span>
          <span class="mini-pill lobby-spike-pill">${escapeHtml(spikeLine)}</span>
          <span class="mini-pill">Filing: ${escapeHtml(fConf)}</span>
        </div>
        <div class="lobby-pressure-bar" aria-hidden="true"><span style="width:${Math.max(4, Math.min(100, pressure))}%"></span></div>
        <div class="lobby-subconf muted">
          <span>Recency · ${escapeHtml(filing.recencySignalConfidence || "—")}</span>
          <span>Issue · ${escapeHtml(filing.issueSignalConfidence || "—")}</span>
          <span>Spend · ${escapeHtml(filing.spendSignalConfidence || "—")}</span>
        </div>
        <h3>${escapeHtml(filing.client)}</h3>
        <p>${escapeHtml(filing.issue || "Issue not listed")}</p>
        <p class="muted">Filed by ${escapeHtml(filing.registrant || "unknown registrant")}</p>
        <div class="lobby-causal-box ${connectedBill ? "" : "muted-box"}">
          ${connectedBill ? `
            <span>${escapeHtml(filing.client)} -> ${escapeHtml(connectedBill.title)}</span>
            <p>${escapeHtml(connection.relationship || connectedBill.relationshipSummary || connectedBill.impact || "")}</p>
            <div class="meta-line">
              <span class="mini-pill ${momentumClass(connectedBill)}">Legislative momentum ${billMomentum(connectedBill)}/100</span>
              ${(connectedBill.affected || []).slice(0, 4).map((ticker) => `<span class="mini-pill green">${escapeHtml(ticker)}</span>`).join("")}
            </div>
          ` : `
            <span>No mapped bill yet</span>
            <p>This filing is still useful context, but it has not been tied to a specific TradeSimple bill-impact chain.</p>
          `}
        </div>
      </article>
    `;
  }).join("");
}

function renderAccount() {
  const account = state.account?.account || {};
  $("#account-grid").innerHTML = [
    ["Liquid cash", money(Number(account.cash || account.buyingPower || 0)), "Available to buy stocks right now"],
    ["Equity", money(Number(account.equity || 0)), "Cash plus current paper positions"],
    ["Invested", money(Number(account.portfolioValue || 0)), "Current value of paper holdings"],
    ["Total return", `${signed(account.totalReturnPct || 0)}%`, `${money(Number(account.totalReturn || 0))} since the $100,000 start`]
  ].map(([label, value, subtitle]) => `
    <article class="connection-card paper-stat-card">
      <span class="mini-pill">${label}</span>
      <strong>${value}</strong>
      <p class="muted">${escapeHtml(subtitle)}</p>
    </article>
  `).join("");

  $("#paper-positions-body").innerHTML = (state.account?.positions || []).length
    ? state.account.positions.map((position) => `
      <tr>
        <td>${escapeHtml(position.symbol)}</td>
        <td>${fmt(position.qty)}</td>
        <td>${money(position.avgCost)}</td>
        <td>${money(position.price)}</td>
        <td>${money(position.marketValue)}</td>
        <td class="${position.unrealizedPnl >= 0 ? "up" : "down"}">${money(position.unrealizedPnl)} (${signed(position.unrealizedPnlPct)}%)</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6">No paper positions yet. Use the order ticket to make your first simulated trade.</td></tr>`;

  $("#paper-orders").innerHTML = (state.account?.orders || []).length
    ? state.account.orders.slice(0, 8).map((order) => `
      <article class="paper-order-row ${order.side === "buy" ? "green" : "red"}">
        <div>
          <strong>${escapeHtml(order.side?.toUpperCase() || "ORDER")} ${escapeHtml(order.symbol)}</strong>
          <span>${fmt(order.qty)} shares at ${money(order.price)}</span>
        </div>
        <small>${money(order.notional)} / ${new Date(order.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
      </article>
    `).join("")
    : `<article class="empty-state">No orders yet. Paper fills will appear here.</article>`;

  renderTradePanel();
}

async function loadTradeHistory(symbol, range = state.tradeRange) {
  state.tradeSymbol = symbol;
  state.tradeRange = range;
  const title = $("#trade-symbol-title");
  if (title) title.textContent = `${symbol} paper trade setup`;
  const chart = $("#trade-history-chart");
  if (chart) chart.innerHTML = `<div class="empty-chart">Loading ${symbol} history...</div>`;
  try {
    state.tradeHistory = await fetchJson(`/api/market/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`);
    renderTradePanel();
  } catch {
    if (chart) chart.innerHTML = `<div class="empty-chart">Historical chart unavailable.</div>`;
  }
}

function renderTradePanel() {
  const symbol = state.tradeSymbol;
  const quote = quoteFor(symbol);
  const history = state.tradeHistory?.symbol === symbol ? state.tradeHistory : null;
  const stats = history?.stats || {};
  const position = (state.account?.positions || []).find((item) => item.symbol === symbol);

  const symbolSelect = $("#order-symbol");
  if (symbolSelect && symbolSelect.value !== symbol) symbolSelect.value = symbol;
  $("#trade-symbol-title").textContent = `${symbol} paper trade setup`;
  $("#trade-symbol-price").textContent = quote ? money(quote.price) : "Loading";
  $("#trade-symbol-price").className = quote?.pct >= 0 ? "up" : "down";
  $("#trade-history-range").textContent = stats.low ? `${money(stats.low)} - ${money(stats.high)}` : "Loading";
  $("#trade-history-return").textContent = `${signed(stats.pct || 0)}%`;
  $("#trade-history-return").className = Number(stats.pct || 0) >= 0 ? "up" : "down";
  $("#trade-history-chart").innerHTML = history?.points?.length ? tradeHistorySvg(history.points) : `<div class="empty-chart">No historical data loaded.</div>`;
  if (history?.points?.length) attachLineChartInteraction("#trade-history-chart", history.points, {
    valueKey: "close",
    dateKey: "date",
    priceLabel: `${symbol} price`
  });
  $("#trade-plain-context").innerHTML = tradePlainContext(symbol, quote, stats, position, history?.source);
  updateOrderEstimate();
}

function tradePlainContext(symbol, quote, stats, position, source) {
  const bill = policyBills().find((item) => (item.affected || []).includes(symbol));
  const trend = Number(stats.pct || 0) >= 0 ? "up" : "down";
  const owned = position ? `You currently own ${fmt(position.qty)} paper shares with ${money(position.marketValue)} marked value.` : "You do not currently own this stock in the paper account.";
  const policy = bill
    ? `Policy watch: ${bill.title} — Legislative momentum ${billMomentum(bill)}/100 · Policy exposure ${Number(bill.policyExposure ?? billMomentum(bill))}/100 · Confidence ${billConfidenceLabel(bill)}. ${bill.relationshipSummary || bill.impact}`
    : "No high-conviction bill is mapped to this ticker right now.";
  return `
    <strong>Plain-English chart read</strong>
    <p>${symbol} is ${trend} ${fmt(Math.abs(stats.pct || 0))}% over this selected range. Today it is ${quote ? signed(quote.pct) : "0.00"}%.</p>
    <p>${owned}</p>
    <p>${escapeHtml(policy)}</p>
    <small>History source: ${escapeHtml(sourceLabel(source || "loading"))}. This is practice trading, not financial advice.</small>
  `;
}

function updateOrderEstimate() {
  const symbol = $("#order-symbol")?.value || state.tradeSymbol;
  const qty = Number($("#order-qty")?.value || 0);
  const side = $("#order-side")?.value || "buy";
  const quote = quoteFor(symbol);
  const notional = quote && qty > 0 ? quote.price * qty : 0;
  const estimate = $("#trade-order-estimate");
  if (estimate) estimate.textContent = `${side.toUpperCase()} est. ${money(notional)}`;
}

function tradeHistorySvg(points) {
  if (!points.length) return `<div class="empty-chart">No history</div>`;
  const closes = points.map((point) => Number(point.close || 0));
  const up = closes[closes.length - 1] >= closes[0];
  const sampledLabels = points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 4)) === 0).slice(0, 4);
  return `
    ${lineChartSvg(points, { valueKey: "close", gradientId: "tradeArea", ariaLabel: "Historical closing prices", height: 280 })}
    <div class="sparkline-meta">
      <span>${escapeHtml(sampledLabels[0]?.date || "")}</span>
      <strong class="${up ? "up" : "down"}">${money(closes[closes.length - 1])}</strong>
      <span>${escapeHtml(points[points.length - 1]?.date || "")}</span>
    </div>
  `;
}

function lineChartSvg(points, options = {}) {
  if (!points.length) return `<div class="empty-chart">No trend data</div>`;
  const width = options.width || 760;
  const height = options.height || 220;
  const padding = options.padding || 16;
  const valueKey = options.valueKey || "value";
  const gradientId = options.gradientId || `area-${Math.random().toString(36).slice(2)}`;
  const values = points.map((point) => Number(point[valueKey] || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coords = values.map((value, index) => {
    const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const area = `${padding},${height - padding} ${coords} ${width - padding},${height - padding}`;
  const up = values[values.length - 1] >= values[0];
  return `
    <div class="interactive-line-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.ariaLabel || "Interactive trend chart")}">
        <defs>
          <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="${up ? "#7ec84a" : "#e24b4a"}" stop-opacity="0.22" />
            <stop offset="100%" stop-color="${up ? "#7ec84a" : "#e24b4a"}" stop-opacity="0" />
          </linearGradient>
        </defs>
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" />
        <polygon points="${area}" fill="url(#${gradientId})" />
        <polyline points="${coords}" fill="none" stroke="${up ? "#7ec84a" : "#e24b4a"}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div class="chart-crosshair"></div>
      <div class="chart-dot"></div>
      <div class="chart-tooltip"></div>
    </div>
  `;
}

function attachLineChartInteraction(containerSelector, points, options = {}) {
  const container = $(containerSelector);
  const wrap = container?.querySelector(".interactive-line-chart");
  const crosshair = wrap?.querySelector(".chart-crosshair");
  const tooltip = wrap?.querySelector(".chart-tooltip");
  const dot = wrap?.querySelector(".chart-dot");
  if (!wrap || !crosshair || !tooltip || !dot || !points.length) return;

  const valueKey = options.valueKey || "value";
  const dateKey = options.dateKey || "date";
  const values = points.map((point) => Number(point[valueKey] || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const first = values[0] || 1;

  wrap.addEventListener("mousemove", (event) => {
    const rect = wrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const index = Math.max(0, Math.min(points.length - 1, Math.round(pct * (points.length - 1))));
    const point = points[index];
    const value = Number(point[valueKey] || 0);
    const yPct = 1 - ((value - min) / range);
    const x = (index / Math.max(1, points.length - 1)) * rect.width;
    const y = yPct * rect.height;
    const progression = first ? ((value - first) / first) * 100 : 0;
    const hasOhlc = point.open != null || point.high != null || point.low != null;

    crosshair.style.left = `${x}px`;
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    tooltip.style.left = `${Math.min(rect.width - 190, Math.max(8, x + 12))}px`;
    tooltip.style.top = `${Math.min(rect.height - 116, Math.max(8, y - 42))}px`;
    tooltip.innerHTML = `
      <strong>${escapeHtml(formatPointDate(point[dateKey] || point.label))}</strong>
      <span>${money(value)}</span>
      <small>${escapeHtml(options.priceLabel || "Value")}</small>
      <small class="${progression >= 0 ? "up" : "down"}">${signed(progression)}% from range start</small>
      ${hasOhlc ? `<small>O ${money(point.open || value)} / H ${money(point.high || value)} / L ${money(point.low || value)}</small>` : ""}
      ${point.volume ? `<small>Vol ${compactNumber(point.volume)}</small>` : ""}
    `;
    wrap.classList.add("tracing");
  });

  wrap.addEventListener("mouseleave", () => {
    wrap.classList.remove("tracing");
  });
}

function formatPointDate(value) {
  if (!value) return "Point";
  if (String(value).includes("T")) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }
  return value;
}

function renderConnections() {
  const config = state.config;
  const grid = $("#connection-grid");
  if (!config || !grid) return;
  const rows = [
    ["Google OAuth", config.auth.google, "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"],
    ["Apple OAuth", config.auth.apple, "APPLE_CLIENT_ID and APPLE_CLIENT_SECRET"],
    ["Finnhub equities", config.data.finnhub, "FINNHUB_API_KEY"],
    ["CoinGecko crypto", config.data.coingecko, "COINGECKO_API_KEY"],
    ["Congress.gov bills", config.data.congress, "CONGRESS_API_KEY"],
    ["Senate LDA lobbying", config.data.senateLda, "SENATE_LDA_API_KEY"],
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
    </article>
  `).join("");
}

function resetEdgarPanel() {
  const meta = $("#edgar-meta");
  const body = $("#edgar-risk-body");
  const link = $("#edgar-source-link");
  const btn = $("#edgar-load-btn");
  if (meta) meta.textContent = "";
  if (body) body.textContent = "";
  if (link) {
    link.hidden = true;
    link.href = "#";
  }
  if (btn) btn.disabled = false;
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

async function loadAnalysis(symbol) {
  state.activeAnalysisSymbol = symbol;
  resetEdgarPanel();
  const source = $("#analysis-source");
  if (source) source.textContent = "Loading";

  try {
    const [analysis, policyNetwork] = await Promise.all([
      fetchJson(`/api/analysis/stock?symbol=${encodeURIComponent(symbol)}`),
      fetchJson(`/api/policy/network?symbol=${encodeURIComponent(symbol)}`)
    ]);
    state.analysis = analysis;
    state.policyNetwork = policyNetwork;
    renderAnalysis();
    renderOverview();
    renderBills();
    renderLobbying();
  } catch (error) {
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

function renderAnalysis() {
  const analysis = state.analysis;
  if (!analysis) return;
  const quote = analysis.quote || {};
  const change = Number(quote.pct || 0);
  const symbol = analysis.symbol;
  const focusBills = analysisFocusBills();

  $("#analysis-source").textContent = `quotes: ${sourceLabel(analysis.source?.quote)} / policy: ${sourceLabel(analysis.source?.policy)}`;

  const name = analysis.company?.name || symbol;
  const sector = analysis.company?.sector || "tracked";
  const moat = String(analysis.company?.moat || "").trim();
  const billN = focusBills.length;
  const pe = Number(analysis.fundamentals?.pe || 0);
  const growthExpect = pe > 40 || Number(analysis.fundamentals?.forwardPe || 0) > 35;
  const lineA = moat
    ? `${name} — ${moat.endsWith(".") ? moat.slice(0, -1) : moat}.`
    : `${name} is a ${sector} company.`;
  const lineB = `Its stock price reflects ${growthExpect ? "high growth expectations in the market" : "how investors are pricing earnings today"}.`;
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
        ? `${symbol} is ${signed(change)}% today. It has ${trendPct >= 0 ? "gained" : "fallen"} ${fmt(
            Math.abs(trendPct)
          )}% over the trend window shown in the chart below.`
        : `${symbol} is ${signed(change)}% today. We need a longer modeled price series to summarize performance over time.`;
  }

  $("#sparkline-caption").textContent = `${symbol} modeled trend`;
  $("#analysis-sparkline").innerHTML = sparklineSvg(pts);
  attachLineChartInteraction("#analysis-sparkline", pts, {
    valueKey: "value",
    dateKey: "label",
    priceLabel: `${symbol} modeled price`
  });

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
            <div class="analysis-fund-mono"><strong>${escapeHtml(label)}</strong><span>${val}</span></div>
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
    const rating = f.analystRating != null && String(f.analystRating).trim() !== "" ? escapeHtml(String(f.analystRating)) : "—";
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
          <p><span class="mini-pill green">Bull</span> ${escapeHtml(f.plainBull || "")}</p>
          <p><span class="mini-pill red">Bear</span> ${escapeHtml(f.plainBear || "")}</p>
        </div>
      </div>
    `;
  }

  const shortCo = name.split(" ")[0];
  const edBtn = $("#edgar-load-btn");
  if (edBtn) edBtn.textContent = `Load what ${shortCo} says could hurt it (from their annual report)`;

  renderAnalysisBillsTable(symbol);
  renderAnalysisLobbyTab();
  renderAnalysisContractsTab(symbol, name);
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

  // Stage tracker
  const STAGES = ["introduced", "committee", "markup", "floor", "passed"];
  const STAGE_LABELS = ["Introduced", "Committee", "Markup", "Floor", "Passed"];
  const statusNorm = (bill.status || "").toLowerCase();
  const isEnacted = statusNorm === "enacted" || statusNorm === "passed";
  const stageIdx = isEnacted ? 4 : STAGES.indexOf(statusNorm);
  const stageTrack = isEnacted
    ? `<div class="stage-enacted">✓ ENACTED — disbursements underway</div>`
    : `<div class="stage-track">${STAGE_LABELS.map((lbl, i) => {
        const cls = i < stageIdx ? "done" : i === stageIdx ? "active" : "";
        const line = i < STAGE_LABELS.length - 1
          ? `<div class="stage-line${i < stageIdx ? " done" : ""}"></div>`
          : "";
        return `<div class="stage-node ${cls}">${escapeHtml(lbl)}</div>${line}`;
      }).join("")}</div>`;

  // Pass / fail impact chips
  const passImpacts = bill.passImpacts || bill.tickerImpacts?.filter(t => t.direction === "upside" || t.direction === "downside").map(t => ({
    sym: t.symbol, dir: t.direction === "upside" ? 1 : -1, range: t.impact, why: t.mechanism
  })) || [];
  const failImpacts = bill.failImpacts || [];
  const chipHtml = (arr) => arr.map(i => {
    const cls = i.dir > 0 ? "pass-up" : i.dir < 0 ? "pass-dn" : "pass-neu";
    const arrow = i.dir > 0 ? "↑" : i.dir < 0 ? "↓" : "→";
    return `<span class="impact-chip ${cls}" title="${escapeHtml(i.why || "")}">${escapeHtml(i.sym)} ${arrow} ${escapeHtml(i.range || "")}</span>`;
  }).join("") || `<span class="muted" style="font-size:11px">No major impact predicted</span>`;

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
          <span class="mini-pill">${escapeHtml(bill.id)} · ${escapeHtml(bill.chamber || "")} · ${(bill.affected || []).slice(0, 2).join(" · ")}</span>
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
        <div class="impact-disclaimer muted">⚠ Impact ranges are estimates based on historical analogs. Click a ticker chip to research. Not financial advice.</div>
      `}
      <div class="legis-card-footer">
        <span class="muted" style="font-size:11px;font-family:var(--mono)">${sponsorLine}</span>
        <div class="legis-card-footer-actions">
          <button type="button" class="button button-ghost compact" onclick="window.openMethodologyModal({ billId: ${JSON.stringify(bill.id)} })">Explain metrics</button>
          <button type="button" class="button button-secondary compact" onclick="window.askWhyForBill(${JSON.stringify(bill.id)})">Ask why (metrics)</button>
          <button type="button" class="button button-ghost compact" onclick="window.showView('research')">✦ Ask AI</button>
        </div>
      </div>
    </article>
  `;
}

function renderBillStakeholders() {
  const el = $("#bill-stakeholders");
  if (!el) return;
  const network = state.policyNetwork;
  if (!network?.stakeholderMap) {
    el.innerHTML = `<article class="empty-state">Pick a ticker in Analysis Lab to load its stakeholder graph.</article>`;
    return;
  }
  const nodes = network.stakeholderMap.nodes || [];
  const links = network.stakeholderMap.links || [];
  $("#bill-network-source").textContent = sourceLabel(network.source?.relationships || "modeled");
  el.innerHTML = `
    <div class="stakeholder-side-head">
      <span class="mini-pill green">${escapeHtml(network.focusSymbol)}</span>
      <h3>${escapeHtml(network.summary?.headline || "Policy graph loaded")}</h3>
      <p>${escapeHtml(network.summary?.detail || "")}</p>
    </div>
    <div class="stakeholder-mini-list">
      ${nodes.filter((node) => node.type !== "ticker").slice(0, 9).map((node) => `
        <div class="stakeholder-mini ${toneClass(node.tone)}">
          <span>${escapeHtml(node.label)}</span>
          <small>${escapeHtml(node.detail || node.title || "")}</small>
        </div>
      `).join("")}
    </div>
    <div class="relationship-flow compact-flow">
      ${links.slice(0, 6).map((link) => {
        const from = nodes.find((node) => node.id === link.from);
        const to = nodes.find((node) => node.id === link.to);
        return `
          <article class="relationship-link ${toneClass(link.tone)}">
            <strong>${escapeHtml(from?.label || "Signal")} -> ${escapeHtml(to?.label || "Bill")}</strong>
            <p>${escapeHtml(link.label || "")}</p>
          </article>
        `;
      }).join("")}
    </div>
  `;
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
      <span class="mini-pill">${escapeHtml(bill.id)}</span>
      <h3>${escapeHtml(bill.title)}</h3>
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

function sparklineSvg(points) {
  if (!points.length) return `<div class="empty-chart">No trend data</div>`;
  const values = points.map((point) => Number(point.value || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const latest = values[values.length - 1];
  const first = values[0];
  const up = latest >= first;
  return `
    ${lineChartSvg(points, { valueKey: "value", gradientId: "sparkArea", ariaLabel: "Modeled price trend", height: 210 })}
    <div class="sparkline-meta">
      <span>${money(min)} low model</span>
      <strong class="${up ? "up" : "down"}">${money(latest)}</strong>
      <span>${money(max)} high model</span>
    </div>
  `;
}

function portfolioSparklinePoints(value, returnPct) {
  const base = value / (1 + (returnPct / 100 || 0)) || value || 10000;
  const points = Array.from({ length: 42 }, (_, index) => {
    const progress = index / 41;
    const wave = Math.sin(index / 3) * 0.012 + Math.cos(index / 5) * 0.008;
    const slope = (returnPct / 100) * progress;
    return {
      label: index === 41 ? "now" : `${41 - index} sessions ago`,
      value: base * (1 + slope + wave)
    };
  });
  points[points.length - 1].value = value || points[points.length - 1].value;
  return points;
}

function portfolioSparklineSvg(value, returnPct, dayChange) {
  const points = portfolioSparklinePoints(value, returnPct);
  const up = dayChange >= 0;
  return `
    ${lineChartSvg(points, { valueKey: "value", gradientId: up ? "portfolioAreaUp" : "portfolioAreaDown", ariaLabel: "Portfolio performance path", width: 460, height: 156, padding: 12 })}
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

function policyBills() {
  return state.policyNetwork?.allBills?.length ? state.policyNetwork.allBills : state.bills;
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
  const conf = billConfidenceLabel(bill);
  return `
    <article class="signal-card">
      <h3>${escapeHtml(bill.title)}</h3>
      <p>${escapeHtml(bill.impact || bill.signal || "")}</p>
      <div class="meta-line">
        <span class="mini-pill ${m >= 67 ? "green" : m < 35 ? "red" : "amber"}">Legislative momentum ${m}/100</span>
        <span class="mini-pill">Confidence ${escapeHtml(conf)}</span>
        ${(bill.affected || []).slice(0, 4).map((ticker) => `<span class="mini-pill">${ticker}</span>`).join("")}
      </div>
    </article>
  `;
}

function setupNavigation() {
  document.querySelectorAll("[data-view], [data-view-jump]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view || button.dataset.viewJump));
  });
}

function globalResearchDrawerEl() {
  return document.querySelector("aside.research-drawer-global");
}

function openGlobalResearchDrawer() {
  globalResearchDrawerEl()?.classList.add("open");
}

function showView(view, updateUrl = true) {
  /* Research UI lives in the global drawer; there is no #view-research — pair drawer with Bills so nav/state stay coherent. */
  if (view === "research") {
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
  if (updateUrl && view) {
    const params = new URLSearchParams(window.location.search);
    params.set("view", view);
    if (view === "analysis") params.set("symbol", state.activeAnalysisSymbol);
    if (view === "trade") params.set("symbol", state.tradeSymbol);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }
  if (view === "analysis" && !state.analysis) loadAnalysis(state.activeAnalysisSymbol);
  if (view === "trade" && !state.tradeHistory) loadTradeHistory(state.tradeSymbol, state.tradeRange);
  if (view === "markets") void loadMarketsData();
}

function setupAnalysisControls() {
  const select = $("#analysis-symbol");
  if (!select) return;
  select.value = state.activeAnalysisSymbol;
  select.addEventListener("change", () => {
    state.activeAnalysisSymbol = select.value;
    if ($("#view-analysis")?.classList.contains("active")) {
      const params = new URLSearchParams(window.location.search);
      params.set("view", "analysis");
      params.set("symbol", select.value);
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    }
    loadAnalysis(select.value);
  });
}

function setupTradeControls() {
  const symbolSelect = $("#order-symbol");
  const qtyInput = $("#order-qty");
  const sideSelect = $("#order-side");
  if (!symbolSelect) return;
  symbolSelect.value = state.tradeSymbol;
  symbolSelect.addEventListener("change", () => {
    state.tradeSymbol = symbolSelect.value;
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
  $("#bill-filter").addEventListener("input", renderBills);
  $("#clear-bill-filter").addEventListener("click", () => {
    $("#bill-filter").value = "";
    renderBills();
  });
  $("#terminal-search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toUpperCase();
    if (!query) return;
    if (isTrackedTicker(query)) showView("markets");
    if (state.bills.some((bill) => [bill.id, bill.title, ...(bill.affected || [])].join(" ").toUpperCase().includes(query))) {
      showView("bills");
      $("#bill-filter").value = query;
      renderBills();
    }
  });
}

function setupForms() {
  $("#order-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    $("#order-result").textContent = "Submitting paper order...";
    try {
      const response = await fetchJson("/api/trading/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: form.get("symbol"),
          qty: form.get("qty"),
          side: form.get("side")
        })
      });
      state.account = response;
      renderAccount();
      $("#order-result").textContent = `${response.order.side.toUpperCase()} ${response.order.qty} ${response.order.symbol} filled at ${money(response.order.price)}. New buying power: ${money(response.account.buyingPower)}.`;
    } catch (error) {
      $("#order-result").textContent = error.message.includes("insufficient")
        ? "Paper order rejected: not enough cash or shares for that order."
        : "Paper order rejected. Check the symbol and quantity.";
    }
  });

  $("#research-log").innerHTML = `
    <div class="message">
      Ask about a bill, ticker, lobbying spike, or portfolio exposure. Use <strong>Ask why (metrics)</strong> on a bill card for the research model, or <strong>Explain metrics</strong> (top bar) for the full transparent rubric and line-item bill breakdowns.
      Without ANTHROPIC_API_KEY the server returns a short local summary for bill-why requests.
    </div>
  `;
  $("#research-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = $("#research-question").value.trim();
    if (!question) return;
    appendMessage(question, "user");
    $("#research-question").value = "";
    appendMessage("Analyzing policy signal...", "ai", true);
    try {
      const response = await fetchJson("/api/research/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question })
      });
      document.querySelector("[data-pending-message]")?.remove();
      appendMessage(response.answer || response.error || "No response returned.", "ai");
    } catch (error) {
      document.querySelector("[data-pending-message]")?.remove();
      appendMessage(error.message || "Request failed.", "ai");
    }
  });
}

function appendMessage(text, kind, pending = false) {
  const div = document.createElement("div");
  div.className = `message ${kind === "user" ? "user" : ""}`;
  if (pending) div.dataset.pendingMessage = "true";
  if (kind === "ai" && typeof text === "string" && text.includes("**")) {
    div.innerHTML = escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  } else {
    div.textContent = text;
  }
  $("#research-log").appendChild(div);
  $("#research-log").scrollTop = $("#research-log").scrollHeight;
}

async function askWhyForBill(billId) {
  if (!billId) return;
  const id = String(billId);
  showView("bills");
  openGlobalResearchDrawer();
  appendMessage(`Ask why · ${id} (bill metrics)`, "user");
  appendMessage("Running bill metrics through research…", "ai", true);
  try {
    const response = await fetch("/api/research/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ billId: id, question: "" })
    });
    document.querySelector("[data-pending-message]")?.remove();
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg =
        payload.error === "unknown_bill_id"
          ? `No seeded scoring packet for ${id}. Ask a free-form question, or pick a bill from the curated POLICY set in LegisAlert.`
          : payload.detail || payload.error || `Request failed (${response.status}).`;
      appendMessage(msg, "ai");
      return;
    }
    appendMessage(payload.answer || "No response returned.", "ai");
  } catch (error) {
    document.querySelector("[data-pending-message]")?.remove();
    appendMessage(error.message || "Request failed.", "ai");
  }
}

function policyFor(symbol) {
  const bill = policyBills().find((item) => (item.affected || []).includes(symbol));
  if (!bill) return "No mapped bill";
  return `${bill.status}: Legislative momentum ${billMomentum(bill)}/100`;
}

/** POLICY column on Markets — uses in-memory bills only (no extra API). */
function marketsPolicySignalHtml(symbol) {
  const bills = policyBills()
    .filter((b) => (b.affected || []).includes(symbol))
    .slice()
    .sort((a, b) => billMomentum(b) - billMomentum(a));
  const top = bills[0];
  if (!top) {
    return `<span class="muted mono" style="color:var(--text-dim)">No signal</span>`;
  }
  const text = top.signal || top.shortTitle || top.title || "Policy watch";
  return escapeHtml(twelveWordSummary(text));
}

function quoteFor(symbol) {
  return state.quotes.find((quote) => quote.symbol === symbol);
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }
  return response.json();
}

function setDisabled(link, title) {
  link.setAttribute("aria-disabled", "true");
  link.href = "#";
  link.title = title;
}

function sourceLabel(source) {
  return String(source || "unknown").replaceAll("_", " ");
}

function money(value) {
  const number = Number(value || 0);
  return number.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: number >= 1000 ? 0 : 2 });
}

function compactMoney(value) {
  const number = Number(value || 0);
  if (number >= 1e12) return `$${fmt(number / 1e12)}T`;
  if (number >= 1e9) return `$${fmt(number / 1e9)}B`;
  if (number >= 1e6) return `$${fmt(number / 1e6)}M`;
  return money(number);
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1e9) return `${fmt(number / 1e9)}B`;
  if (number >= 1e6) return `${fmt(number / 1e6)}M`;
  if (number >= 1e3) return `${fmt(number / 1e3)}K`;
  return fmt(number);
}

function fmt(value) {
  return Number(value || 0).toFixed(2);
}

function signed(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? "+" : ""}${fmt(number)}`;
}

function initials(value) {
  return String(value)
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TS";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let methodologyUiBound = false;

async function ensureMethodology() {
  if (state.methodology) return state.methodology;
  state.methodology = await fetchJson("/api/methodology");
  return state.methodology;
}

function closeMethodologyModal() {
  const modal = $("#methodology-modal");
  if (modal) {
    modal.hidden = true;
    document.body.classList.remove("methodology-modal-open");
  }
}

function renderMethodologyHtml(opts, breakdown) {
  const doc = state.methodology;
  const requestedBillId = opts.billId;
  let html = `<p class="methodology-lede">${escapeHtml(doc.disclaimer)}</p>`;

  if (requestedBillId && !breakdown) {
    html += `<div class="methodology-callout" id="method-bill-breakdown"><p><strong>No line-item breakdown</strong> for <span class="mono-inline">${escapeHtml(requestedBillId)}</span>. Only curated TradeSimple policy seeds expose decomposed sub-scores. Congress-only records still follow the rubric below.</p></div>`;
  } else if (breakdown) {
    const lm = breakdown.legislativeMomentum;
    const lb = breakdown.lobbyingPressureOnBillCard;
    html += `<section class="methodology-section methodology-bill-breakdown" id="method-bill-breakdown">`;
    html += `<h3>Transparent breakdown · ${escapeHtml(breakdown.bill.id)}</h3>`;
    html += `<p class="muted">${escapeHtml(breakdown.bill.title)}</p>`;
    html += `<p>Legislative momentum <strong>${lm.score}/100</strong>. Weighted sum before rounding/clamp: <strong>${lm.weightedRawBeforeClamp}</strong>. ${escapeHtml(lm.note)}</p>`;
    html += `<table class="methodology-table"><thead><tr><th>Input</th><th>Sub-score (0–100)</th><th>Weight</th><th>Weighted contribution</th></tr></thead><tbody>`;
    for (const row of lm.components) {
      html += `<tr><td>${escapeHtml(row.label)}</td><td>${row.value}</td><td>${row.weightPct}%</td><td>${row.contribution}</td></tr>`;
    }
    html += `</tbody></table>`;
    html += `<p><strong>Bill signal confidence:</strong> ${escapeHtml(breakdown.billSignalConfidence.label)}. ${escapeHtml(breakdown.billSignalConfidence.rubric)}</p>`;
    html += `<p><strong>Lobbying pressure on card:</strong> ${lb.score}/100 · synthetic spike ${lb.pseudoSpike}× · modeled notional ${money(Number(lb.pseudoAmountUsd || 0))}. ${escapeHtml(lb.note)}</p>`;
    if (breakdown.curatedSignals && Object.keys(breakdown.curatedSignals).length) {
      html += `<dl class="methodology-dl">`;
      for (const [k, v] of Object.entries(breakdown.curatedSignals)) {
        html += `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`;
      }
      html += `</dl>`;
    }
    html += `</section><div class="methodology-between-sections"></div>`;
  }

  for (const sec of doc.sections) {
    html += `<section class="methodology-section" id="method-${escapeHtml(sec.id)}">`;
    html += `<h3>${escapeHtml(sec.title)}</h3>`;
    html += `<p class="muted">${escapeHtml(sec.summary)}</p>`;
    if (sec.weights?.length) {
      html += `<ul class="methodology-detail-list">`;
      for (const w of sec.weights) {
        const head = w.pct != null ? `${w.name} (${w.pct}%)` : w.name;
        html += `<li><strong>${escapeHtml(head)}</strong> — ${escapeHtml(w.detail)}</li>`;
      }
      html += `</ul>`;
    }
    html += `</section>`;
  }
  return html;
}

async function openMethodologyModal(arg) {
  const opts = typeof arg === "string" ? { focus: arg } : { ...(arg || {}) };
  const modal = $("#methodology-modal");
  const bodyEl = $("#methodology-modal-body");
  if (!modal || !bodyEl) return;
  modal.hidden = false;
  document.body.classList.add("methodology-modal-open");
  bodyEl.innerHTML = `<p class="muted">Loading methodology…</p>`;
  try {
    await ensureMethodology();
    let breakdown = null;
    if (opts.billId) {
      const r = await fetch(`/api/policy/bill-metrics?id=${encodeURIComponent(opts.billId)}`);
      if (r.ok) breakdown = (await r.json()).breakdown;
    }
    bodyEl.innerHTML = renderMethodologyHtml(opts, breakdown);
    const scrollId =
      opts.billId ? "method-bill-breakdown" : `method-${opts.focus || "legislativeMomentum"}`;
    requestAnimationFrame(() => {
      document.getElementById(scrollId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } catch (err) {
    bodyEl.innerHTML = `<p class="muted">Could not load methodology: ${escapeHtml(err.message || String(err))}</p>`;
  }
}

function methodologyModalClick(e) {
  if (e.target.closest("[data-close-methodology]")) {
    e.preventDefault();
    closeMethodologyModal();
    return;
  }
  const foc = e.target.closest("[data-methodology-focus]");
  if (foc?.dataset.methodologyFocus) {
    e.preventDefault();
    openMethodologyModal({ focus: foc.dataset.methodologyFocus });
  }
}

function methodologyModalEscape(e) {
  if (e.key !== "Escape") return;
  const modal = $("#methodology-modal");
  if (modal && !modal.hidden) closeMethodologyModal();
}

function setupMethodologyModal() {
  const modal = $("#methodology-modal");
  if (!modal || methodologyUiBound) return;
  methodologyUiBound = true;
  document.body.addEventListener("click", methodologyModalClick);
  document.addEventListener("keydown", methodologyModalEscape);
  $("#methodology-open-btn")?.addEventListener("click", () => openMethodologyModal({}));
}

function initScrollReveal() {
  if (typeof IntersectionObserver === "undefined") return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.06, rootMargin: "0px 0px -32px 0px" }
  );

  // Hero copy and phone — stagger phone slightly
  document.querySelectorAll(".brand-hero .hero-copy").forEach((el) => {
    el.classList.add("reveal-ready");
    observer.observe(el);
  });

  const phoneStage = document.querySelector(".phone-stage");
  if (phoneStage) {
    phoneStage.classList.add("reveal-ready");
    phoneStage.style.transitionDelay = "0.12s";
    observer.observe(phoneStage);
  }

  // Ticker bar
  const ticker = document.querySelector(".landing-ticker");
  if (ticker) {
    ticker.classList.add("reveal-ready");
    observer.observe(ticker);
  }

  // Features strip — cascade with 100ms stagger
  document.querySelectorAll(".features-strip article").forEach((el, i) => {
    el.classList.add("reveal-ready");
    el.setAttribute("data-delay", String(i + 1));
    observer.observe(el);
  });

  // Site sections (LegisAlert, Sentiment, etc.)
  document.querySelectorAll(".site-section, .comparison-section").forEach((el) => {
    el.classList.add("reveal-ready");
    observer.observe(el);
  });

  // Signal cards inside landing stagger
  document.querySelectorAll(".signal-stack .signal-card").forEach((el, i) => {
    el.classList.add("reveal-ready");
    el.setAttribute("data-delay", String(i + 1));
    observer.observe(el);
  });

  // Sentiment demo rows
  document.querySelectorAll(".sentiment-demo div").forEach((el, i) => {
    el.classList.add("reveal-ready");
    el.setAttribute("data-delay", String(i + 1));
    observer.observe(el);
  });

  // Waitlist
  const waitlist = document.querySelector(".waitlist-inner");
  if (waitlist) {
    waitlist.classList.add("reveal-ready");
    observer.observe(waitlist);
  }
}

function $(selector) {
  return document.querySelector(selector);
}

function setupResearchDrawer() {
  const btn = document.querySelector(".research-drawer-btn");
  const drawer = globalResearchDrawerEl();
  const close = drawer?.querySelector(".research-drawer-close");
  if (!btn || !drawer || !close) return;
  btn.addEventListener("click", () => drawer.classList.toggle("open"));
  close.addEventListener("click", () => drawer.classList.remove("open"));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer.classList.contains("open")) drawer.classList.remove("open");
  });
}

window.showView = showView;
window.askWhyForBill = askWhyForBill;
window.openMethodologyModal = openMethodologyModal;
