const HOLDINGS = [
  { symbol: "NVDA", shares: 12, avgCost: 554, policy: "CHIPS tailwind; export-control risk" },
  { symbol: "AAPL", shares: 8, avgCost: 165, policy: "Platform antitrust risk fading" },
  { symbol: "LLY", shares: 3, avgCost: 620, policy: "Drug-pricing bill exposure" },
  { symbol: "TSLA", shares: 10, avgCost: 210, policy: "Permitting reform watch" },
  { symbol: "AMZN", shares: 1, avgCost: 178, policy: "Antitrust overhang easing" }
];

const MARKET_SYMBOLS = ["SPY", "QQQ", "NVDA", "AAPL", "LLY", "TSLA", "AMZN", "MSFT", "AMD", "GOOGL", "META", "COIN"];
const state = {
  config: null,
  session: null,
  quotes: [],
  crypto: [],
  bills: [],
  lobbying: [],
  account: null,
  analysis: null,
  policyNetwork: null,
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
  const initialSymbol = String(params.get("symbol") || "").toUpperCase();
  if (MARKET_SYMBOLS.includes(initialSymbol)) state.activeAnalysisSymbol = initialSymbol;
  if (MARKET_SYMBOLS.includes(initialSymbol)) state.tradeSymbol = initialSymbol;

  setupNavigation();
  setupForms();
  setupFilters();
  setupAnalysisControls();
  setupTradeControls();

  const [config, session] = await Promise.all([fetchJson("/api/config"), fetchJson("/api/session")]);
  state.config = config;
  state.session = session;
  renderSession();
  renderConnections();

  const initialView = params.get("view") || "trade";
  showView(initialView, false);

  await refreshTerminalData();
  await loadAnalysis(state.activeAnalysisSymbol);
  await loadTradeHistory(state.tradeSymbol, state.tradeRange);
  setInterval(refreshTerminalData, 60000);
}

async function refreshTerminalData() {
  const [quotes, crypto, bills, lobbying, account] = await Promise.all([
    fetchJson(`/api/market/quotes?symbols=${MARKET_SYMBOLS.join(",")}`),
    fetchJson("/api/crypto"),
    fetchJson("/api/congress/bills"),
    fetchJson("/api/lobbying"),
    fetchJson("/api/trading/account")
  ]);

  state.quotes = quotes.quotes || [];
  state.crypto = crypto.assets || [];
  state.bills = bills.bills || [];
  state.lobbying = lobbying.filings || [];
  state.account = account;

  $("#market-source").textContent = sourceLabel(quotes.source);
  $("#crypto-source").textContent = sourceLabel(crypto.source);
  $("#bill-source").textContent = sourceLabel(bills.source);
  $("#lobby-source").textContent = sourceLabel(lobbying.source);
  $("#account-source").textContent = sourceLabel(account.source);

  renderTape();
  renderOverview();
  renderMarkets();
  renderCrypto();
  renderBills();
  renderLobbying();
  renderAccount();
}

function renderSession() {
  const user = state.session?.user;
  if (!user) return;
  $("[data-user-name]").textContent = user.name || "Trader";
  $("[data-user-email]").textContent = `${user.email || "local session"} - ${user.provider}`;
  $("[data-user-initials]").textContent = initials(user.name || user.email || "TS");
}

function renderTape() {
  const symbols = ["SPY", "QQQ", "NVDA", "LLY", "TSLA", "BTC", "ETH"];
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
  const rows = HOLDINGS.map((holding) => {
    const quote = quoteFor(holding.symbol);
    if (!quote) return "";
    const positionValue = quote.price * holding.shares;
    const positionCost = holding.avgCost * holding.shares;
    const totalReturn = positionCost ? ((positionValue - positionCost) / positionCost) * 100 : 0;
    value += positionValue;
    cost += positionCost;
    dayChange += (quote.change || 0) * holding.shares;
    positions.push({ ...holding, quote, value: positionValue, cost: positionCost, totalReturn });
    return `
      <tr>
        <td>${holding.symbol}</td>
        <td>${holding.shares}</td>
        <td>${money(quote.price)}</td>
        <td>${money(positionValue)}</td>
        <td class="${quote.pct >= 0 ? "up" : "down"}">${signed(quote.pct)}%</td>
        <td>${holding.policy}</td>
      </tr>
    `;
  }).join("");

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
  $("#overview-subtitle").textContent = `Tracking ${state.quotes.length} equities, ${state.crypto.length} crypto assets, and ${state.bills.length} bills.`;

  const safety = state.config?.safety;
  $("#trade-mode").textContent = safety?.liveTradingEnabled ? "Live enabled" : "Paper";
  $("#trade-mode-sub").textContent = safety?.liveTradingEnabled ? "Broker live mode is unlocked" : "Live trading is locked";

  $("#signal-list").innerHTML = state.bills
    .slice()
    .sort((a, b) => Number(b.lobbyingAgainst || 0) - Number(a.lobbyingAgainst || 0))
    .slice(0, 4)
    .map(signalCard)
    .join("");
  renderPortfolioDashboard(positions, value, returnPct, dayChange);
}

function renderPortfolioDashboard(positions, totalValue, returnPct, dayChange) {
  const allocationEl = $("#portfolio-allocation");
  const policyEl = $("#portfolio-policy-feed");
  const summaryEl = $("#portfolio-dashboard-summary");
  if (!allocationEl || !policyEl || !summaryEl) return;

  const sorted = positions.slice().sort((a, b) => b.value - a.value);
  allocationEl.innerHTML = sorted.map((position) => {
    const weight = totalValue ? (position.value / totalValue) * 100 : 0;
    return `
      <article class="allocation-row">
        <div>
          <strong>${escapeHtml(position.symbol)}</strong>
          <span>${money(position.value)} / ${fmt(weight)}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.min(100, weight))}%"></div></div>
        <small class="${position.totalReturn >= 0 ? "up" : "down"}">${signed(position.totalReturn)}% total return</small>
      </article>
    `;
  }).join("");

  const policyRows = sorted.map((position) => {
    const bill = policyBills().find((item) => (item.affected || []).includes(position.symbol));
    return `
      <article class="portfolio-policy-card ${bill ? passageClass(bill) : ""}">
        <div>
          <span class="mini-pill ${bill ? passageClass(bill) : ""}">${escapeHtml(position.symbol)}</span>
          <strong>${escapeHtml(bill?.title || "No active mapped bill")}</strong>
        </div>
        <p>${escapeHtml(bill?.relationshipSummary || bill?.impact || position.policy || "This holding is mainly driven by market and company fundamentals right now.")}</p>
        ${bill ? `<small>${bill.passageOdds}% odds / impact ${bill.impactScore || 1}/5 / ${escapeHtml(bill.status)}</small>` : `<small>No LegisAlert pressure mapped</small>`}
      </article>
    `;
  }).join("");
  policyEl.innerHTML = policyRows;

  const best = sorted.slice().sort((a, b) => Number(b.quote?.pct || 0) - Number(a.quote?.pct || 0))[0];
  const exposed = sorted.filter((position) => policyBills().some((bill) => (bill.affected || []).includes(position.symbol)));
  const biggestBill = policyBills()
    .filter((bill) => bill.affected?.some((ticker) => positions.some((position) => position.symbol === ticker)))
    .sort((a, b) => Number(b.impactScore || 0) - Number(a.impactScore || 0))[0];
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
  `;
}

function renderMarkets() {
  $("#market-body").innerHTML = state.quotes.map((quote) => {
    const policy = policyFor(quote.symbol);
    return `
      <tr>
        <td>${quote.symbol}</td>
        <td>${money(quote.price)}</td>
        <td class="${quote.pct >= 0 ? "up" : "down"}">${signed(quote.change)} (${signed(quote.pct)}%)</td>
        <td>${quote.open ? money(quote.open) : "-"}</td>
        <td>${quote.high ? money(quote.high) : "-"}</td>
        <td>${quote.low ? money(quote.low) : "-"}</td>
        <td>${policy}</td>
      </tr>
    `;
  }).join("");
}

function renderCrypto() {
  $("#crypto-grid").innerHTML = state.crypto.map((asset) => `
    <article class="crypto-card">
      <span class="mini-pill">${asset.symbol || asset.id}</span>
      <strong>${money(asset.price)}</strong>
      <p class="${asset.pct >= 0 ? "up" : "down"}">${signed(asset.pct)}% in 24h</p>
      <p class="muted">Market cap ${asset.marketCap ? compactMoney(asset.marketCap) : "not available"}</p>
    </article>
  `).join("");
}

function renderBills() {
  const query = ($("#bill-filter")?.value || "").toLowerCase();
  const bills = policyBills().filter((bill) => {
    if (!query) return true;
    return [bill.id, bill.title, bill.shortTitle, bill.status, bill.signal, ...(bill.affected || [])]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  $("#bill-feed").innerHTML = bills.length
    ? bills.map((bill) => legisAlertCard(bill, { expanded: true })).join("")
    : `<article class="empty-state">No bill matched that filter. Try a ticker like LLY, NVDA, AMZN, COIN, or TSLA.</article>`;
  renderBillStakeholders();
}

function renderLobbying() {
  renderLobbyBridge();
  $("#lobby-feed").innerHTML = state.lobbying.map((filing) => {
    const spike = Number(filing.spike || 0);
    const connection = relatedBillForFiling(filing);
    const connectedBill = connection?.bill;
    return `
      <article class="lobby-card">
        <span class="mini-pill ${spike >= 2 ? "red" : spike >= 1.5 ? "amber" : ""}">${spike ? `${fmt(spike)}x normal` : "live filing"}</span>
        <h3>${escapeHtml(filing.client)}</h3>
        <strong class="${spike >= 2 ? "down" : "amber"}">${compactMoney(filing.amount || 0)}</strong>
        <p>${escapeHtml(filing.issue || "Issue not listed")}</p>
        <p class="muted">Filed by ${escapeHtml(filing.registrant || "unknown registrant")}</p>
        <div class="lobby-causal-box ${connectedBill ? "" : "muted-box"}">
          ${connectedBill ? `
            <span>${escapeHtml(filing.client)} -> ${escapeHtml(connectedBill.title)}</span>
            <p>${escapeHtml(connection.relationship || connectedBill.relationshipSummary || connectedBill.impact || "")}</p>
            <div class="meta-line">
              <span class="mini-pill ${passageClass(connectedBill)}">${connectedBill.passageOdds}% passage</span>
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
    ? `Policy watch: ${bill.title} is mapped at ${bill.passageOdds}% odds. ${bill.relationshipSummary || bill.impact}`
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
  if (!config) return;
  const rows = [
    ["Google OAuth", config.auth.google, "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"],
    ["Apple OAuth", config.auth.apple, "APPLE_CLIENT_ID and APPLE_CLIENT_SECRET"],
    ["Finnhub equities", config.data.finnhub, "FINNHUB_API_KEY"],
    ["CoinGecko crypto", config.data.coingecko, "COINGECKO_API_KEY"],
    ["Congress.gov bills", config.data.congress, "CONGRESS_API_KEY"],
    ["Senate LDA lobbying", config.data.senateLda, "SENATE_LDA_API_KEY"],
    ["Alpaca paper broker", config.data.alpaca, "ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY"],
    ["Anthropic research", config.data.anthropic, "ANTHROPIC_API_KEY"],
    ["Live trading lock", !config.safety.liveTradingEnabled, "ALLOW_LIVE_TRADING=false"]
  ];

  $("#connection-grid").innerHTML = rows.map(([name, ok, env]) => `
    <article class="connection-card ${ok ? "ok" : "missing"}">
      <span class="mini-pill ${ok ? "green" : "red"}">${ok ? "Configured" : "Needs key"}</span>
      <strong>${name}</strong>
      <p class="muted">${env}</p>
    </article>
  `).join("");
}

async function loadAnalysis(symbol) {
  state.activeAnalysisSymbol = symbol;
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
    const summary = $("#analysis-summary");
    if (summary) summary.textContent = "The analysis endpoint did not return. Check the server console and try again.";
  }
}

function renderAnalysis() {
  const analysis = state.analysis;
  if (!analysis) return;
  const quote = analysis.quote || {};
  const change = Number(quote.pct || 0);

  $("#analysis-source").textContent = `quotes: ${sourceLabel(analysis.source?.quote)} / policy: ${sourceLabel(analysis.source?.policy)}`;
  $("#analysis-sector").textContent = analysis.company?.sector || "Tracked equity";
  $("#analysis-title").textContent = `${analysis.symbol} - ${analysis.company?.name || analysis.symbol}`;
  $("#analysis-summary").textContent = analysis.summary?.plainEnglish || "Analysis loaded.";
  $("#analysis-price").textContent = money(quote.price);
  $("#analysis-change").textContent = `${signed(change)}% today`;
  $("#analysis-change").className = change >= 0 ? "up" : "down";
  $("#analysis-updated").textContent = `Updated ${new Date(analysis.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  $("#sparkline-caption").textContent = `${analysis.symbol} modeled trend`;
  $("#analysis-sparkline").innerHTML = sparklineSvg(analysis.charts?.priceTrend || []);
  attachLineChartInteraction("#analysis-sparkline", analysis.charts?.priceTrend || [], {
    valueKey: "value",
    dateKey: "label",
    priceLabel: `${analysis.symbol} modeled price`
  });

  $("#metric-grid").innerHTML = (analysis.metrics || []).map((metric) => `
    <article class="metric-card">
      <div>
        <span class="mini-pill ${toneClass(metric.tone)}">${escapeHtml(metric.label)}</span>
        <strong>${escapeHtml(metric.value)}</strong>
      </div>
      <p>${escapeHtml(metric.plain)}</p>
      <small>${escapeHtml(metric.takeaway)}</small>
    </article>
  `).join("");

  $("#analysis-bars").innerHTML = [
    barGroup("Valuation pressure", analysis.charts?.valuation || [], "Higher bars mean more growth is already priced in."),
    barGroup("Business quality", analysis.charts?.businessQuality || [], "Higher bars usually mean stronger economics or less balance-sheet stress."),
    barGroup("Risk radar", analysis.charts?.riskRadar || [], "Risk is a scenario score, not a price target.")
  ].join("");

  $("#policy-chains").innerHTML = (analysis.policyChains || []).map((chain) => `
    <article class="impact-chain ${toneClass(chain.tone)}">
      <h3>${escapeHtml(chain.title)}</h3>
      <p>${escapeHtml(chain.summary)}</p>
      <div class="chain-steps">
        ${(chain.steps || []).map((step) => `
          <div class="chain-step">
            <span>${escapeHtml(step.label)}</span>
            <p>${escapeHtml(step.text)}</p>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");

  $("#api-explainer").innerHTML = (analysis.apiExplanations || []).map((item) => `
    <article class="api-card">
      <div class="api-card-title">
        <strong>${escapeHtml(item.name)}</strong>
        <span class="mini-pill ${item.status === "connected" ? "green" : item.status === "fallback" || item.status === "simulated" ? "amber" : ""}">${escapeHtml(item.status)}</span>
      </div>
      <p>${escapeHtml(item.what)}</p>
      <small>${escapeHtml(item.investorUse)}</small>
      <div class="causal-line">${escapeHtml(item.causalChain)}</div>
    </article>
  `).join("");

  renderAnalysisLegisAlert(analysis);
  renderStakeholderMap(analysis.stakeholderMap || state.policyNetwork?.stakeholderMap);

  $("#analysis-prompts").innerHTML = (analysis.promptHints || []).map((prompt, index) => `
    <button class="prompt-chip" type="button" data-prompt-index="${index}">${escapeHtml(prompt)}</button>
  `).join("");
  document.querySelectorAll("[data-prompt-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = analysis.promptHints[Number(button.dataset.promptIndex)];
      $("#research-question").value = prompt;
      showView("research");
      $("#research-question").focus();
    });
  });
}

function renderAnalysisLegisAlert(analysis) {
  const el = $("#analysis-legisalert");
  if (!el) return;
  const bills = (analysis.legisAlert?.length ? analysis.legisAlert : state.policyNetwork?.focusBills) || [];
  el.innerHTML = bills.length
    ? bills.map((bill) => legisAlertCard(bill, { compact: true })).join("")
    : `<article class="empty-state">No LegisAlert chain is mapped to ${escapeHtml(analysis.symbol)} yet. Search the bill feed or switch tickers.</article>`;
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
  const odds = Number(bill.passageOdds || 0);
  const compact = options.compact;
  const pClass = passageClass(bill);

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
      ${bill.lobbyingAgainst ? `<span class="mini-pill red">$${fmt(bill.lobbyingAgainst)}M against</span>` : ""}
      ${bill.lobbyingFor ? `<span class="mini-pill green">$${fmt(bill.lobbyingFor)}M for</span>` : ""}
      ${bipartisan ? `<span class="mini-pill green">${bill.bipartisanCosponsors} bipartisan</span>` : ""}
      <span class="mini-pill">${escapeHtml(bill.latestActionDate || "")}</span>
    </div>` : `
    <div class="bill-signal-grid">
      <div class="bill-signal-col">
        <div class="signal-label-sm">Passage signals</div>
        <div class="signal-row-item">
          <span class="signal-ico">💰</span>
          <span class="signal-lbl">Lobbying against</span>
          <span class="signal-val ${Number(bill.lobbyingAgainst) > 15 ? "dn" : Number(bill.lobbyingAgainst) > 5 ? "amber-text" : ""}">
            $${fmt(bill.lobbyingAgainst || 0)}M${Number(bill.lobbyingAgainst) > 15 ? " ⚠" : ""}
          </span>
        </div>
        <div class="signal-row-item">
          <span class="signal-ico">💚</span>
          <span class="signal-lbl">Lobbying for</span>
          <span class="signal-val up">$${fmt(bill.lobbyingFor || 0)}M</span>
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
        ${bill.analog ? `<div class="analog-box"><div class="analog-lbl">Historical analog</div><p>${escapeHtml(bill.analog)}</p></div>` : ""}
      </div>
    </div>`;

  const sponsor = bill.sponsor;
  const sponsorLine = sponsor
    ? `Sponsor: ${escapeHtml(sponsor.name)} (${escapeHtml(sponsor.party)}-${escapeHtml(sponsor.state)}) · ${escapeHtml(bill.latestActionDate || "")}`
    : escapeHtml(bill.latestActionDate || "");

  return `
    <article class="legis-card ${pClass}">
      <div class="legis-card-head">
        <div>
          <span class="mini-pill">${escapeHtml(bill.id)} · ${escapeHtml(bill.chamber || "")} · ${(bill.affected || []).slice(0, 2).join(" · ")}</span>
          <h3>${escapeHtml(bill.title)}</h3>
        </div>
        <div class="impact-score">
          <strong>${odds}%</strong>
          <span>passage</span>
          ${bill.confidence ? `<span class="conf-badge">${escapeHtml(bill.confidence)}</span>` : ""}
        </div>
      </div>
      <p class="bill-plain-english">${escapeHtml(bill.plainEnglish || bill.shortTitle || bill.signal || "")}</p>
      <div class="passage-meter" aria-label="Passage probability ${odds}%">
        <span style="width:${Math.max(0, Math.min(100, odds))}%"></span>
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
        <span class="muted" style="font-size:11px;font-family:var(--font-mono)">${sponsorLine}</span>
        <button class="button button-ghost compact" onclick="setView('ai')">✦ Ask AI</button>
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
    <article class="bridge-card ${passageClass(bill)}">
      <span class="mini-pill">${escapeHtml(bill.id)}</span>
      <h3>${escapeHtml(bill.title)}</h3>
      <p>${escapeHtml(bill.signal || bill.relationshipSummary || "")}</p>
      <div class="bridge-chain">
        <span>${compactMoney(Number(bill.lobbyingAgainst || 0) * 1000000)} against</span>
        <span>${bill.passageOdds}% odds</span>
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

function passageClass(bill) {
  const odds = Number(bill?.passageOdds || 0);
  if (odds >= 70) return "green";
  if (odds < 35) return "red";
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
  const odds = Number(bill.passageOdds || 0);
  return `
    <article class="signal-card">
      <h3>${escapeHtml(bill.title)}</h3>
      <p>${escapeHtml(bill.impact || bill.signal || "")}</p>
      <div class="meta-line">
        <span class="mini-pill ${odds >= 70 ? "green" : odds < 35 ? "red" : "amber"}">${odds}% passage</span>
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

function showView(view, updateUrl = true) {
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
    if (MARKET_SYMBOLS.includes(query)) showView("markets");
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
      Ask about a bill, ticker, lobbying spike, or portfolio exposure. If ANTHROPIC_API_KEY is missing,
      the server returns a local policy-model answer so the workflow still works.
    </div>
  `;
  $("#research-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = $("#research-question").value.trim();
    if (!question) return;
    appendMessage(question, "user");
    $("#research-question").value = "";
    appendMessage("Analyzing policy signal...", "ai", true);
    const response = await fetchJson("/api/research/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question })
    });
    document.querySelector("[data-pending-message]")?.remove();
    appendMessage(response.answer || response.error || "No response returned.", "ai");
  });
}

function appendMessage(text, kind, pending = false) {
  const div = document.createElement("div");
  div.className = `message ${kind === "user" ? "user" : ""}`;
  if (pending) div.dataset.pendingMessage = "true";
  div.textContent = text;
  $("#research-log").appendChild(div);
  $("#research-log").scrollTop = $("#research-log").scrollHeight;
}

function policyFor(symbol) {
  const bill = policyBills().find((item) => (item.affected || []).includes(symbol));
  if (!bill) return "No mapped bill";
  return `${bill.status}: ${bill.passageOdds}% odds`;
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
