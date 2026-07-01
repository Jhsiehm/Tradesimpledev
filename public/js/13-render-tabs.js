/* Extracted from app.js lines 6326-7854 */
function renderMarkets() {
  const tbody = $("#market-body");
  if (!tbody) return;
  updateMarketsTableMeta();
  syncMarketsDeskToggleVisibility();

  const rows = filteredMarketsRows();
  if (!rows.length) {
    const focusHint = state.focusSymbol
      ? `No markets row for <strong>${escapeHtml(state.focusSymbol)}</strong> with these filters.`
      : "No symbols match this filter.";
    tbody.innerHTML = `<tr><td colspan="7" class="markets-empty-row">${focusHint} Try <strong>All</strong> or <button type="button" class="link-button" id="markets-clear-focus-inline">clear focus</button>.</td></tr>`;
    $("#markets-clear-focus-inline")?.addEventListener("click", () => clearFocusSymbol());
    renderTabFilterContexts();
    return;
  }

  tbody.innerHTML = rows.map((row) => {
    const sym = row.symbol;
    const focusMatch = state.focusSymbol && normalizeWatchSymbol(sym) === state.focusSymbol;
    const quote = quoteFor(sym);
    const pctRaw = quote ? Number(quote.changePercent ?? quote.pct ?? 0) : null;
    const pct = pctRaw != null && Number.isFinite(pctRaw) ? pctRaw : null;
    const chg = quote?.change != null ? Number(quote.change) : null;
    const pctCls = pct == null ? "muted" : pct >= 0 ? "up" : "down";
    const pctTxt = pct == null ? "—" : `${pct >= 0 ? "+" : ""}${fmt(pct)}%`;
    const chgTxt = chg == null ? "—" : signed(chg);
    const watching = isOnWatchlist(sym);
    const policyHtml = marketsPolicySignalHtml(sym);
    return `
      <tr class="markets-row markets-card-row clickable-row${focusMatch ? " is-focus-match" : ""}" data-symbol="${escapeHtml(sym)}">
        <td class="mono ticker-link-cell markets-ticker-cell">
          <a class="markets-ticker-link" href="${escapeHtml(stockPageUrl(sym))}" onclick="event.stopPropagation()">${escapeHtml(sym)}</a>
          <span class="markets-ticker-name">${escapeHtml(row.name || sym)}</span>
          ${shareCardLink(sym, "Share")}
        </td>
        <td class="markets-name-cell">${escapeHtml(row.name || sym)}</td>
        <td class="mono num">${marketsQuoteCellHtml(sym)}</td>
        <td class="mono num ${pctCls}">${chgTxt} <span class="markets-pct">(${pctTxt})</span></td>
        <td class="markets-sources-cell"><div class="markets-source-badges">${marketsSourceBadgesHtml(row)}</div></td>
        <td class="markets-links-cell"><div class="markets-link-row">${marketsConnectedLinksHtml(row)}</div><div class="markets-policy-signal">${policyHtml}</div></td>
        <td><button type="button" class="button button-secondary compact watch-toggle-btn${watching ? " is-watching" : ""}" data-watch-toggle="${escapeHtml(sym)}" title="${watching ? "Remove from watchlist" : "Add to watchlist"}">${watching ? "★" : "☆"}</button></td>
      </tr>
    `;
  }).join("");
  renderTabFilterContexts();
}

function renderCrypto() {
  const grid = $("#crypto-grid");
  if (!grid) return;
  const cryptoData = state.crypto || [];
  if (!cryptoData.length) {
    grid.innerHTML =
      '<p class="muted mono" style="padding:16px;font-size:11px;">Crypto prices unavailable. Set COINGECKO_API_KEY in .env.local for live data.</p>';
    if ((state.marketsSubTab || "equities") === "crypto") renderTabFilterContexts();
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
    <article class="crypto-card actionable-card" ${drilldownAttrs("source", {
      url: tickerSourceUrl(asset.symbol || asset.id)
    }, `Open ${asset.symbol || label} source`)}>
      <span class="mini-pill">${escapeHtml(asset.symbol || asset.id || "")}</span>
      <strong>${priceHtml}</strong>
      <p class="${pctCls}">${pctLine}</p>
      <p class="muted">Market cap ${asset.marketCap ? compactMoney(asset.marketCap) : "not available"}</p>
      <p class="muted mono" style="font-size:10px;">${escapeHtml(label)}</p>
    </article>
  `;
  }).join("");
  if ((state.marketsSubTab || "equities") === "crypto") renderTabFilterContexts();
}

async function refreshContractsFeed({ render = true } = {}) {
  if (!isFeatureEnabled("CONTRACTS_ANALYZER_ENABLED")) {
    state.contracts = [];
    state.contractsLoadedAt = new Date().toISOString();
    rememberFeedMeta("contracts", {
      source: "feature_disabled",
      confidence: "Hidden",
      updatedAt: state.contractsLoadedAt
    });
    return state.contracts;
  }
  const requests = contractWatchlist().map(async (item) => {
    try {
      const data = await fetchJson(`/api/contracts/${encodeURIComponent(item.company)}`);
      return summarizeContractResults(item, data);
    } catch (error) {
      console.warn(`[contracts] ${item.symbol} fetch failed`, error);
      return null;
    }
  });
  const settled = await Promise.allSettled(requests);
  state.contracts = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value)
    .filter(Boolean);
  state.contractsFeedErrors = settled.filter((r) => r.status === "rejected").length;
  state.contractsLoadedAt = new Date().toISOString();
  rememberFeedMeta("contracts", {
    source: state.contracts.length ? "usaspending.gov" : "contracts_unavailable",
    confidence: state.contracts.length ? "Medium" : "Low",
    updatedAt: state.contractsLoadedAt
  });
  if (render) {
    renderSourceBadges();
    renderContracts();
    renderLiveAlerts();
    renderSignalFeed();
    if (state.analysis) renderAnalysisContractsTab(state.analysis.symbol, state.analysis.company?.name);
  }
  return state.contracts;
}

function summarizeContractResults(item, data) {
  const results = (data.results || []).map(normalizeContractAward);
  const recipientId = data.recipientId || results.find((row) => row.recipientId)?.recipientId || null;
  const now = Date.now();
  const activeResults = results.filter((row) => {
    const end = row.endDate ? new Date(row.endDate).getTime() : null;
    return !Number.isFinite(end) || end >= now;
  });
  const sorted = (activeResults.length ? activeResults : results)
    .slice()
    .sort((a, b) => Number(b.obligatedAmount || 0) - Number(a.obligatedAmount || 0));
  const top = sorted[0] || {};
  const totalObligated = results.reduce((sum, row) => sum + Number(row.obligatedAmount || 0), 0);
  const endDates = results
    .map((row) => row.endDate)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => Number.isFinite(t) && t >= now);
  const soonestEnd = endDates.length ? new Date(Math.min(...endDates)).toISOString().slice(0, 10) : "";
  const daysToSoonest = soonestEnd ? Math.round((new Date(soonestEnd).getTime() - now) / 864e5) : null;
  const exposureClass = totalObligated >= 1e9 ? "high" : totalObligated >= 1e8 ? "medium" : "low";
  const riskLabel = daysToSoonest != null && daysToSoonest <= 180
    ? "Renewal / recompete watch"
    : results.length
      ? "Active award monitor"
      : "No recent awards found";
  const riskClass = daysToSoonest != null && daysToSoonest <= 180 ? "medium"
    : results.length ? "neutral" : "low";
  return {
    ...item,
    source: "usaspending.gov",
    resultCount: results.length,
    activeResultCount: activeResults.length,
    totalObligated,
    topAward: Number(top.obligatedAmount || 0),
    topAgency: top.awardingAgency || "Agency not listed",
    topRecipient: top.recipientName || item.company,
    startDate: top.startDate || "",
    endDate: top.endDate || "",
    soonestEnd,
    exposureClass,
    riskLabel,
    riskClass,
    recipientId,
    results
  };
}

function renderContracts() {
  const tbody = $("#contracts-body");
  if (!tbody) return;
  const intro = $("#contracts-intro");
  if (intro) {
    intro.textContent = state.contractsLoadedAt
      ? `Showing live USASpending.gov award data for ${state.contracts.length} government-exposed companies. Awards can lag agency disclosure by up to 90 days. Click a row to see individual awards.`
      : "Loading recent awards from USASpending.gov…";
  }
  if (!state.contractsLoadedAt) {
    tbody.innerHTML = `<tr><td colspan="7">Loading USASpending.gov awards…</td></tr>`;
    return;
  }
  if (!state.contracts.length) {
    tbody.innerHTML = `<tr><td colspan="7">Contract feed unavailable — USASpending.gov did not return awards. Try <strong>Refresh all</strong>. If this persists, the federal API may be down or rate-limited.</td></tr>`;
    return;
  }

  const filtered = state.contracts.filter(contractMatchesTabFilters);
  if (!filtered.length) {
    const focusMsg = state.focusSymbol
      ? `No contract exposure for <strong>${escapeHtml(state.focusSymbol)}</strong> with these filters.`
      : "No contracts match these filters.";
    tbody.innerHTML = `<tr><td colspan="7"><div class="guided-empty-state">${focusMsg} <button type="button" class="link-button" data-view-jump="markets">Browse Markets</button> or adjust agency/amount chips.</div></td></tr>`;
    renderTabFilterContexts();
    return;
  }

  tbody.innerHTML = filtered.map((row) => {
    const detailId = `cd-${escapeHtml(row.symbol)}`;
    const pageUrl = contractPageUrl(row.symbol);
    return `
      <tr class="clickable-row contract-summary-row"
          data-contract-toggle="${detailId}"
          data-symbol="${escapeHtml(row.symbol)}"
          role="button" tabindex="0"
          title="Expand awards · open full page from symbol">
        <td class="mono"><a class="bill-page-link" href="${escapeHtml(pageUrl)}">${escapeHtml(row.symbol)}</a></td>
        <td><a class="bill-page-link" href="${escapeHtml(pageUrl)}">${escapeHtml(row.company)}</a></td>
        <td><span class="score-badge ${row.exposureClass}">${compactMoney(row.totalObligated)}</span></td>
        <td class="mono">${row.topAward ? compactMoney(row.topAward) : "—"}</td>
        <td>${escapeHtml(row.topAgency)}</td>
        <td><span class="score-badge ${row.riskClass}">${escapeHtml(row.riskLabel)}</span></td>
        <td class="mono contract-expand-hint">▸ <a class="bill-page-open muted" href="${escapeHtml(pageUrl)}">Full page</a></td>
      </tr>
      <tr id="${detailId}" class="contract-detail-row" hidden>
        <td colspan="7">
          ${renderContractDetailPanel(row)}
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".contract-summary-row").forEach((summaryRow) => {
    summaryRow.addEventListener("click", (event) => {
      if (event.target.closest("a.bill-page-link, a.bill-page-open")) return;
      const detailId = summaryRow.dataset.contractToggle;
      if (!detailId) return;
      const detail = document.getElementById(detailId);
      if (!detail) return;
      const isOpen = !detail.hidden;
      tbody.querySelectorAll(".contract-detail-row").forEach((d) => { d.hidden = true; });
      tbody.querySelectorAll(".contract-expand-hint").forEach((h) => { h.textContent = "▸ Awards"; });
      tbody.querySelectorAll(".contract-summary-row").forEach((r) => r.classList.remove("contract-row-open"));
      if (!isOpen) {
        detail.hidden = false;
        summaryRow.querySelector(".contract-expand-hint").textContent = "▾ Awards";
        summaryRow.classList.add("contract-row-open");
        detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
    summaryRow.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        summaryRow.click();
      }
    });
  });
  const headerSource = $("#contracts-header-source");
  if (headerSource) {
    headerSource.textContent = state.contractsLoadedAt
      ? `${filtered.length} exposed · USASpending`
      : "Connecting";
  }
  renderTabFilterContexts();
  clearSkeleton("#contracts-body");
}

function renderContractDetailPanel(row) {
  const companySearchUrl = usaspendingSearchUrl(row.company, row.recipientId);
  if (!row.results || !row.results.length) {
    return `<div class="contract-detail-panel">
      <p class="muted">No individual award records were returned for ${escapeHtml(row.company)}.</p>
      <a class="link-button" href="${companySearchUrl}" target="_blank" rel="noopener noreferrer">
        Search USASpending.gov for ${escapeHtml(row.company)}
      </a>
    </div>`;
  }

  const now = Date.now();
  const awardRows = row.results.slice(0, 10).map((award) => {
    const normalized = normalizeContractAward(award);
    const daysToEnd = normalized.endDate
      ? Math.round((new Date(normalized.endDate).getTime() - now) / 864e5)
      : null;
    const statusLabel = daysToEnd == null ? "Period unknown"
      : daysToEnd < 0 ? "Expired"
      : daysToEnd <= 90 ? "Expires soon"
      : daysToEnd <= 365 ? "Active"
      : "Active";
    const statusClass = daysToEnd == null ? "neutral"
      : daysToEnd < 0 ? "low"
      : daysToEnd <= 90 ? "medium"
      : "neutral";
    const periodStr = contractAwardPeriodLabel(normalized);
    const fullDesc = contractAwardDisplayDescription(normalized) || "No description provided";
    const desc = fullDesc.slice(0, 160) + (fullDesc.length > 160 ? "…" : "");
    const directUrl = contractAwardDirectUrl(normalized);
    const linkUrl = directUrl || usaspendingSearchUrl(normalized.recipientName || row.company, row.recipientId);
    const linkLabel = directUrl ? `Award ${escapeHtml(normalized.awardId || "detail")}` : "USASpending search";
    return `
      <div class="contract-award-row">
        <div class="contract-award-head">
          <span class="contract-award-id mono">${escapeHtml(normalized.awardId || "—")}</span>
          <span class="contract-award-agency">${escapeHtml(normalized.awardingAgency || "Agency not listed")}</span>
          <span class="score-badge ${statusClass} contract-award-status">${statusLabel}</span>
          <strong class="contract-award-amount mono">${compactMoney(normalized.obligatedAmount || 0)}</strong>
        </div>
        <p class="contract-award-desc">${escapeHtml(desc)}</p>
        <div class="contract-award-foot">
          <span class="muted mono contract-award-period">${escapeHtml(periodStr)}</span>
          <a class="link-button" href="${linkUrl}" target="_blank" rel="noopener noreferrer">${linkLabel} ↗</a>
        </div>
      </div>
    `;
  }).join("");

  const totalLabel = `${row.resultCount} award${row.resultCount !== 1 ? "s" : ""} found · ${row.activeResultCount} active`;
  return `
    <div class="contract-detail-panel">
      <div class="contract-detail-header">
        <span class="contract-detail-company">${escapeHtml(row.company)}</span>
        <span class="muted mono contract-detail-count">${totalLabel}</span>
        <a class="link-button" href="${contractPageUrl(row.symbol)}">Open full contract page →</a>
        <a class="link-button" href="${companySearchUrl}" target="_blank" rel="noopener noreferrer">All on USASpending ↗</a>
      </div>
      <div class="contract-award-list">
        ${awardRows}
      </div>
      <p class="contract-detail-disclaimer muted">
        Awards from USASpending.gov. Data may lag agency disclosure by up to 90 days.
        Dollar amounts are total obligated value. Not a prediction of contract continuation or cancellation.
      </p>
    </div>
  `;
}

function renderBills() {
  renderBillsGuided();
  if (billsGuidedMode() === "guided") return;
  clearSkeleton("#bill-feed");
  const query = ($("#bill-filter")?.value || "").toLowerCase();
  const bills = filteredBillsRows();
  renderBillAlertCards();
  const feed = $("#bill-feed");
  if (!feed) return;
  if (!bills.length) {
    const focusMsg = state.focusSymbol
      ? `No bills linked to <strong>${escapeHtml(state.focusSymbol)}</strong> yet. <button type="button" class="link-button" data-view-jump="markets">Browse Markets</button> or clear focus.`
      : "";
    feed.innerHTML = focusMsg
      ? `<tr><td colspan="8"><div class="guided-empty-state">${focusMsg}</div></td></tr>`
      : isWatchlistScope()
        ? `<tr><td colspan="8">${watchlistEmptyStateHtml()}</td></tr>`
        : query
          ? `<tr><td colspan="8">No bill matched that filter. Try a ticker like LLY, NVDA, AMZN, COIN, or TSLA.</td></tr>`
          : `<tr><td colspan="8"><div class="guided-empty-state"><strong>No bills loaded yet.</strong> Bill data is still connecting — hit Refresh in the top bar, or start by filtering for a ticker you own (LLY, NVDA, TSLA) once the feed arrives.</div></td></tr>`;
    feed.querySelector("[data-feed-scope-set]")?.addEventListener("click", () => setFeedScope("all"));
    return;
  }
  feed.innerHTML = sortBillsForTable(bills).map((bill) => {
    const tickerLinks = (bill.affected || [])
      .map((ticker) => `<span class="ticker-inline-chip">${escapeHtml(ticker)}${shareCardLink(ticker, "Card")}</span>`)
      .join("");
    const status = billStatusInfo(bill);
    const stageColor = stageColorForBill(bill);
    const momentum = billMomentum(bill);
    const lobby = Number(bill.lobbyingPressureScore ?? 0);
    const catalyst = bill.catalyst || {};
    const prov = billProvenanceBadge(bill);
    const detailsId = `bill-detail-${escapeHtml(bill.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const idSub = bill.exactCongressRecord ? "" : `<span class="bill-id-sub mono">${escapeHtml(bill.id)}</span>`;
    const pageUrl = billPageUrl(bill);
    return `
      <tr class="clickable-row" data-bill-toggle="${detailsId}" role="button" tabindex="0" title="Expand quick preview · open full page from title">
        <td class="mono">
          <a class="bill-page-link" href="${escapeHtml(pageUrl)}">${escapeHtml(billDisplayLabel(bill))}</a>
          ${idSub}
          <small class="bill-source-mini ${prov.cls}">${escapeHtml(prov.text)}</small>
          <a class="bill-page-open muted" href="${escapeHtml(pageUrl)}">Full page →</a>
        </td>
        <td><a class="bill-page-link" href="${escapeHtml(pageUrl)}">${escapeHtml(bill.title || "")}</a></td>
        <td class="bill-stage-cell" data-label="Stage">
          <span class="status-stage-chip ${toneClassFromStatus(status.tone)}" style="color:${stageColor}">${escapeHtml(status.label)}</span>
          ${billLegislativeContext(bill)?.primaryCommittee && billLegislativeContext(bill).primaryCommittee !== "—"
            ? `<small class="stage-cell-committee">${escapeHtml(billLegislativeContext(bill).primaryCommittee)}</small>`
            : ""}
          <small class="stage-cell-next">${escapeHtml(status.nextStep || "")}</small>
        </td>
        <td data-label="Momentum"><span class="score-badge ${momentum >= 67 ? "high" : momentum < 35 ? "low" : "medium"}">${momentum}/100</span></td>
        <td data-label="Lobby pressure"><span class="score-badge ${lobby >= 67 ? "high" : lobby < 35 ? "low" : "medium"}">${lobby}/100</span></td>
        <td data-label="Confidence">${escapeHtml(billConfidenceLabel(bill))}</td>
        <td class="mono ticker-link-cell" data-label="Tickers">${tickerLinks || "—"}</td>
        <td class="bill-calendar-cell" data-label="Calendar">${billCalendarCellHtml(bill)}</td>
      </tr>
      <tr id="${detailsId}" hidden>
        <td colspan="8">
          <div class="bill-detail-shell">
            ${billLegislativeTimelineBlock(bill)}
            <div class="bill-detail-grid">
              <div>
                <h4>What happens next</h4>
                <p>${escapeHtml(status.nextStep || "Watch the next official action.")}</p>
                <p class="muted">${escapeHtml(status.marketMeaning || "")}</p>
              </div>
              <div>
                <h4>Catalyst watch</h4>
                <p>${escapeHtml(catalyst.label || status.label)} · ${escapeHtml(catalyst.dateLabel || bill.latestActionDate || "No date posted")}</p>
                <p class="muted">Urgency ${Number(catalyst.urgency || 0)}/100 · ${escapeHtml(catalyst.source || "modeled status")}</p>
              </div>
            </div>
            <p>${escapeHtml(bill.plainEnglish || bill.signal || "")}</p>
            ${renderBillFecBlockFromPulse(bill)}
            ${momentumDriversHtml(bill)}
            <table>
              <thead><tr><th>Firm</th><th>Stance</th><th>Amount</th><th>Issue Area</th></tr></thead>
              <tbody>
                ${(bill.stakeholders?.lobbying?.length
                  ? bill.stakeholders.lobbying.map((l) => `<tr><td>${escapeHtml(l.name || "")}</td><td>${escapeHtml(l.stance || "")}</td><td class="mono">${money(l.amount || 0)}</td><td>${escapeHtml(l.issue || "")}</td></tr>`)
                  : [`<tr><td colspan="4" class="muted">No firm-level lobbying mapped to this bill yet.</td></tr>`]
                ).join("")}
              </tbody>
            </table>
            <ul>${watchForBullets(bill).map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
            ${historicalAnalogHtml(bill)}
            <p class="bill-source-note">${escapeHtml(billSourceNote(bill))}</p>
            ${bill.lobbyingSource === "senate_lda" ? `<p class="muted">Lobbying: ${escapeHtml(String(bill.lobbyingFilingsCount || 0))} matched LDA filing(s) · against $${escapeHtml(String(bill.lobbyingAgainst ?? "—"))}M · for $${escapeHtml(String(bill.lobbyingFor ?? "—"))}M</p>` : ""}
            <a class="link-button" href="${escapeHtml(pageUrl)}">Open full bill page →</a>
            <a class="link-button" target="_blank" rel="noopener noreferrer" href="${billSourceUrl(bill)}">${escapeHtml(billSourceLabel(bill))}</a>
          </div>
        </td>
      </tr>
    `;
  }).join("");
  renderBillStakeholders();
  renderPolicyCatalysts();
  renderTabFilterContexts();
}

/* Bill alert spotlight — renders the two highest-momentum tracked bills as
   legisAlertCard()s. Buttons inside the cards (Ask why, Explain metrics,
   Ask AI) are handled globally by setupLegisCardDelegation(). */
function renderBillAlertCards() {
  const host = $("#bill-alert-cards");
  if (!host) return;
  const top = policyBills()
    .slice()
    .sort((a, b) => billMomentum(b) - billMomentum(a))
    .slice(0, 2);
  if (!top.length) {
    host.innerHTML = `<div class="guided-empty-state"><strong>No alerts yet.</strong> High-momentum bills appear here as soon as the policy feed loads.</div>`;
    return;
  }
  host.innerHTML = top.map((bill) => legisAlertCard(bill, { compact: true })).join("");
}

function renderLobbying() {
  renderLobbyBridge();
  const feedEl = $("#lobby-feed");
  const emptyEl = $("#lobby-feed-empty");
  const sourceEl = $("#lobby-source");
  const badgeEl = $("#lobby-data-badge");
  const meta = state.feedMeta?.lobbying;
  const isLive = meta?.source === "senate_lda";
  const isSample = meta?.source === "fallback";
  if (sourceEl) {
    sourceEl.textContent = isLive ? "Senate LDA" : isSample ? "Sample filings" : "Connecting";
  }
  if (badgeEl) {
    badgeEl.textContent = isLive ? "Live LDA" : isSample ? "Sample filings" : "Connecting";
    badgeEl.className = `mini-pill ${isLive ? "green" : isSample ? "amber" : ""}`;
  }
  if (!feedEl) return;
  const filtered = (state.lobbying || []).filter(lobbyingMatchesTabFilters);
  if (!filtered.length) {
    feedEl.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      if (state.focusSymbol) {
        emptyEl.innerHTML = `<strong>No lobbying filings for ${escapeHtml(state.focusSymbol)} yet.</strong> Try clearing focus or broadening the issue keyword. <button type="button" class="link-button" data-view-jump="markets">Browse Markets</button>`;
      } else if (isSample) {
        emptyEl.innerHTML = `<strong>Showing sample filings.</strong> Live Senate LDA data is not configured — browse the sample feed or refresh to retry.`;
      } else if (!isLive) {
        emptyEl.innerHTML = `<strong>No lobbying filings loaded.</strong> The feed is still connecting — use Refresh in the top bar.`;
      }
    }
    renderTabFilterContexts();
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  feedEl.innerHTML = filtered.map((filing) => {
    const pageUrl = lobbyPageUrl(filing);
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
        <a class="lobby-card-title-link" href="${escapeHtml(pageUrl)}"><h3>${escapeHtml(filing.client)}</h3></a>
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
        <a class="link-button" href="${escapeHtml(pageUrl)}">Open full filing page →</a>
        ${connectedBill ? `<a class="link-button" href="${escapeHtml(billPageUrl(connectedBill))}">Related bill →</a>` : ""}
      </article>
    `;
  }).join("");
  renderTabFilterContexts();
  clearSkeleton("#lobby-feed");
}

function renderAccount() {
  renderTradeGuided();
  if (tradeGuidedMode() === "guided") return;
  const account = state.account?.account || {};
  $("#account-grid").innerHTML = [
    ["Liquid cash", money(Number(account.cash || account.buyingPower || 0)), "Available to buy stocks right now"],
    ["Equity", money(Number(account.equity || 0)), "Cash plus current paper positions"],
    ["Invested", money(Number(account.portfolioValue || 0)), "Current value of paper holdings"],
    ["Total return", `${signed(account.totalReturnPct || 0)}%`, `${money(Number(account.totalReturn || 0))} since the $100,000 start`]
  ].map(([label, value, subtitle]) => `
    <article class="overview-metric-cell" role="listitem">
      <span class="overview-metric-label">${escapeHtml(label)}</span>
      <strong class="overview-metric-value">${value}</strong>
      <small class="overview-metric-sub">${escapeHtml(subtitle)}</small>
    </article>
  `).join("");

  $("#paper-positions-body").innerHTML = (state.account?.positions || []).length
    ? state.account.positions.map((position) => `
      <tr class="${state.lastOrderSymbol && normalizeWatchSymbol(position.symbol) === state.lastOrderSymbol ? "position-row-highlight" : ""}">
        <td>${escapeHtml(position.symbol)}</td>
        <td>${fmt(position.qty)}</td>
        <td>${money(position.avgCost)}</td>
        <td>${money(position.price)}</td>
        <td>${money(position.marketValue)}</td>
        <td class="${position.unrealizedPnl >= 0 ? "up" : "down"}">${money(position.unrealizedPnl)} (${signed(position.unrealizedPnlPct)}%)</td>
        <td>${positionPolicyRiskHtml(position.symbol)}</td>
      </tr>
    `).join("")
    : `<tr class="empty-state-row"><td colspan="7"><div class="guided-empty-state positions-empty-state"><strong>No positions yet.</strong> Pick a symbol in the order ticket, choose a quantity, and place your first paper trade — you start with $100,000 of simulated cash. Nothing here touches real money.</div></td></tr>`;

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
    : `<article class="empty-state" style="padding:1.5rem;text-align:center"><p style="margin:0 0 0.35rem;font-weight:600">No orders yet</p><p class="muted" style="margin:0;font-size:0.85rem">Your paper trade history will appear here once you place an order.</p></article>`;

  renderTradePanel();
  renderPaperOrderPreview();
  if (isFeatureEnabled("FUNDS_HYPOTHETICALS_ENABLED")) void loadFunds();
}

const FUND_TAG_LABELS = {
  legislation: "Legislation",
  contracts: "Contracts",
  lobbying: "Lobbying",
  figures: "Figures",
  custom: "Custom"
};

function parseFundTickerInput(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase().replace(/[^A-Z.]/g, ""))
    .filter(Boolean);
}

function renderFundTickerChips() {
  const host = $("#fund-ticker-chips");
  const editor = $("#fund-weight-editor");
  const rowsHost = $("#fund-weight-rows");
  if (!host) return;
  const chips = state.fundTickerDraft;
  host.innerHTML = chips.length
    ? chips.map((sym) => `
      <button type="button" class="mini-pill fund-chip" data-remove-fund-ticker="${escapeHtml(sym)}">${escapeHtml(sym)} ×</button>
    `).join("")
    : `<span class="muted">Add tickers above or pull from a bill’s affected list.</span>`;
  host.querySelectorAll("[data-remove-fund-ticker]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sym = btn.dataset.removeFundTicker;
      state.fundTickerDraft = state.fundTickerDraft.filter((t) => t !== sym);
      delete state.fundWeightDraft[sym];
      renderFundTickerChips();
    });
  });

  if (editor && rowsHost) {
    editor.hidden = !chips.length;
    rowsHost.innerHTML = chips
      .map(
        (sym) => `
      <label class="fund-weight-row">
        <span>${escapeHtml(sym)}</span>
        <input type="number" min="0" step="0.01" placeholder="equal" data-fund-weight="${escapeHtml(sym)}" value="${state.fundWeightDraft[sym] != null ? escapeHtml(String(state.fundWeightDraft[sym])) : ""}" />
      </label>`
      )
      .join("");
    rowsHost.querySelectorAll("[data-fund-weight]").forEach((input) => {
      input.addEventListener("input", () => {
        const sym = input.dataset.fundWeight;
        const val = Number(input.value);
        if (Number.isFinite(val) && val > 0) state.fundWeightDraft[sym] = val;
        else delete state.fundWeightDraft[sym];
      });
    });
  }
}

function fundSymbolsPayloadFromDraft() {
  const symbols = [...new Set(state.fundTickerDraft)];
  const pending = parseFundTickerInput($("#fund-tickers-input")?.value);
  pending.forEach((sym) => {
    if (!symbols.includes(sym)) symbols.push(sym);
  });
  const explicit = symbols.some((sym) => state.fundWeightDraft[sym] != null);
  return symbols.map((symbol) => {
    if (!explicit) return symbol;
    const weight = state.fundWeightDraft[symbol];
    return weight != null && weight > 0 ? { symbol, weight } : { symbol, weight: null };
  });
}

function populateFundBillPicker() {
  const select = $("#fund-bill-picker");
  if (!select) return;
  const bills = policyBills().slice().sort((a, b) => billMomentum(b) - billMomentum(a));
  select.innerHTML = [
    `<option value="">Choose a bill…</option>`,
    ...bills.map((bill) => {
      const label = `${bill.id} — ${(bill.shortTitle || bill.title || "").slice(0, 72)}`;
      return `<option value="${escapeHtml(bill.id)}">${escapeHtml(label)}</option>`;
    })
  ].join("");
}

function setupHypotheticalFunds() {
  const form = $("#fund-create-form");
  if (!form) return;

  state.fundTickerDraft = [];
  state.fundWeightDraft = {};
  renderFundTickerChips();
  populateFundBillPicker();

  const tickersInput = $("#fund-tickers-input");
  tickersInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    const added = parseFundTickerInput(tickersInput.value);
    if (!added.length) return;
    const set = new Set(state.fundTickerDraft);
    added.forEach((sym) => set.add(sym));
    state.fundTickerDraft = [...set];
    tickersInput.value = "";
    renderFundTickerChips();
  });

  $("#fund-add-from-bill")?.addEventListener("click", () => {
    const billId = $("#fund-bill-picker")?.value;
    if (!billId) return;
    const bill = policyBills().find((b) => b.id === billId);
    const affected = (bill?.affected || []).map((s) => String(s).toUpperCase());
    if (!affected.length) return;
    const set = new Set(state.fundTickerDraft);
    affected.forEach((sym) => set.add(sym));
    state.fundTickerDraft = [...set];
    renderFundTickerChips();
    const status = $("#fund-create-status");
    if (status) {
      status.textContent = `Added ${affected.length} tickers from ${bill.id}. Review weights — defaults are equal.`;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("#fund-name")?.value?.trim();
    const tag = $("#fund-tag")?.value || "custom";
    const symbols = fundSymbolsPayloadFromDraft();
    const benchmark = $("#fund-benchmark-spy")?.checked ? "SPY" : null;
    const status = $("#fund-create-status");
    if (!symbols.length) {
      if (status) status.textContent = "Add at least one ticker.";
      return;
    }
    if (status) status.textContent = "Creating hypothetical fund…";
    try {
      const response = await fetchJson("/api/funds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, tag, symbols, benchmark })
      });
      state.funds.unshift(response.fund);
      state.activeFundId = response.fund.id;
      if ($("#fund-name")) $("#fund-name").value = "";
      if (tickersInput) tickersInput.value = "";
      state.fundTickerDraft = [];
      state.fundWeightDraft = {};
      renderFundTickerChips();
      renderFundsUi();
      populateFundCompareSelects();
      await loadFundDetail(response.fund.id);
      if (status) status.textContent = `Created “${response.fund.name}”.`;
    } catch (error) {
      if (status) status.textContent = "Could not create fund. Check tickers and try again.";
      console.error("[funds] create failed", error);
    }
  });

  $("#fund-select")?.addEventListener("change", (event) => {
    const id = event.target.value;
    state.activeFundId = id || null;
    if (id) void loadFundDetail(id);
    else renderFundsUi();
  });

  document.querySelectorAll("[data-fund-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-fund-range]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.fundRange = btn.dataset.fundRange || "6m";
      if (state.activeFundId) void loadFundDetail(state.activeFundId);
    });
  });

  $("#fund-compare-run")?.addEventListener("click", () => void runFundCompare());
  populateFundCompareSelects();

  window.addEventListener("resize", () => {
    if (state.fundAttribution?.graph) renderFundRelationshipGraph(state.fundAttribution);
  });
}

function populateFundCompareSelects() {
  const bar = $("#fund-compare-bar");
  const selA = $("#fund-compare-a");
  const selB = $("#fund-compare-b");
  if (!selA || !selB) return;
  if (!state.funds.length) {
    if (bar) bar.hidden = true;
    return;
  }
  if (bar) bar.hidden = false;
  const options = state.funds.map(
    (fund) => `<option value="${escapeHtml(fund.id)}">${escapeHtml(fund.name)}</option>`
  );
  selA.innerHTML = options.join("");
  selB.innerHTML = options.join("");
  if (state.funds.length > 1) {
    selB.selectedIndex = 1;
  }
}

async function runFundCompare() {
  if (!isFeatureEnabled("FUNDS_HYPOTHETICALS_ENABLED")) return;
  const idA = $("#fund-compare-a")?.value;
  const idB = $("#fund-compare-b")?.value;
  const tbody = $("#fund-compare-compare-body");
  if (!idA || !idB || idA === idB || !tbody) return;
  tbody.innerHTML = `<tr><td colspan="3">Loading comparison…</td></tr>`;
  try {
    const data = await fetchJson(
      `/api/funds/compare?ids=${encodeURIComponent(idA)},${encodeURIComponent(idB)}`
    );
    const [fundA, fundB] = data.funds || [];
    $("#fund-compare-th-a").textContent = fundA?.name || "Fund A";
    $("#fund-compare-th-b").textContent = fundB?.name || "Fund B";
    const fmtPct = (v) => (v == null ? "—" : `${signed(v)}%`);
    const metrics = data.comparison?.metrics || [];
    tbody.innerHTML = metrics
      .map((row) => {
        if (row.format === "count") {
          return `<tr><td>${escapeHtml(row.label)}</td><td>${row.a ?? "—"}</td><td>${row.b ?? "—"}</td></tr>`;
        }
        return `<tr><td>${escapeHtml(row.label)}</td><td class="${Number(row.a) >= 0 ? "up" : "down"}">${fmtPct(row.a)}</td><td class="${Number(row.b) >= 0 ? "up" : "down"}">${fmtPct(row.b)}</td></tr>`;
      })
      .join("");
  } catch {
    tbody.innerHTML = `<tr><td colspan="3">Could not compare funds.</td></tr>`;
  }
}

async function loadFunds() {
  if (!isFeatureEnabled("FUNDS_HYPOTHETICALS_ENABLED")) return;
  try {
    const data = await fetchJson("/api/funds");
    state.funds = data.funds || [];
    if (!state.activeFundId && state.funds.length) state.activeFundId = state.funds[0].id;
    populateFundCompareSelects();
    renderFundsUi();
    if (state.activeFundId) await loadFundDetail(state.activeFundId);
  } catch (error) {
    console.warn("[funds] list failed", error);
  }
}

function renderFundsUi() {
  const select = $("#fund-select");
  const empty = $("#fund-detail-empty");
  const body = $("#fund-detail-body");
  if (!select) return;

  if (!state.funds.length) {
    select.innerHTML = `<option value="">No funds yet</option>`;
    if (empty) empty.hidden = false;
    if (body) body.hidden = true;
    stopFundPulseRefresh();
    return;
  }

  select.innerHTML = state.funds
    .map((fund) => `<option value="${escapeHtml(fund.id)}" ${fund.id === state.activeFundId ? "selected" : ""}>${escapeHtml(fund.name)}</option>`)
    .join("");

  if (empty) empty.hidden = Boolean(state.activeFundId);
  if (body) body.hidden = !state.activeFundId;
}

async function loadFundDetail(fundId) {
  if (!isFeatureEnabled("FUNDS_HYPOTHETICALS_ENABLED")) return;
  const range = state.fundRange || "6m";
  const chartHost = $("#fund-performance-chart");
  if (chartHost) {
    if (window.TSCharts) window.TSCharts.destroy(chartHost);
    delete chartHost.dataset.tsChartMounted;
    chartHost.innerHTML = `<div class="empty-chart">Loading basket index…</div>`;
  }

  try {
    const [perf, attr, pulse] = await Promise.all([
      fetchJson(`/api/funds/${encodeURIComponent(fundId)}/performance?range=${encodeURIComponent(range)}`),
      fetchJson(`/api/funds/${encodeURIComponent(fundId)}/attribution?range=${encodeURIComponent(range)}`),
      fetchJson(`/api/funds/${encodeURIComponent(fundId)}/pulse`).catch(() => null)
    ]);
    state.fundPerformance = perf;
    state.fundAttribution = attr;
    state.fundPulse = pulse;
    renderFundDetail();
    scheduleFundPulseRefresh(fundId);
  } catch (error) {
    console.error("[funds] detail failed", error);
    if (chartHost) chartHost.innerHTML = `<div class="empty-chart">Fund data unavailable.</div>`;
  }
}

function renderFundDetail() {
  renderFundsUi();
  const perf = state.fundPerformance;
  const attr = state.fundAttribution;
  const fund = perf?.fund || attr?.fund;
  if (!fund) return;

  const meta = $("#fund-meta-line");
  if (meta) {
    const syms = (fund.symbols || []).map((row) => `${row.symbol} ${(row.weight * 100).toFixed(0)}%`).join(" · ");
    meta.innerHTML = `
      <span class="mini-pill">${escapeHtml(FUND_TAG_LABELS[fund.tag] || fund.tag)}</span>
      <span class="muted">${escapeHtml(syms)}</span>
      ${fund.benchmark ? `<span class="mini-pill">Benchmark ${escapeHtml(fund.benchmark)}</span>` : ""}
    `;
  }

  renderFundCompareTable(perf);
  renderFundLeaderboard(perf);
  renderFundRelationshipMatrix(attr);
  renderFundRelationshipGraph(attr);
  renderFundLivePulse(state.fundPulse);
  renderFundAttributionTray(attr);
  renderFundPerformanceChart(perf, attr);
}

function stopFundPulseRefresh() {
  if (!state.fundPulseTimer) return;
  clearInterval(state.fundPulseTimer);
  state.fundPulseTimer = null;
}

function scheduleFundPulseRefresh(fundId) {
  stopFundPulseRefresh();
  if (!isFeatureEnabled("FUNDS_HYPOTHETICALS_ENABLED")) return;
  if (!fundId || !$("#view-overview")?.classList.contains("active")) return;
  state.fundPulseTimer = setInterval(async () => {
    if (state.activeFundId !== fundId) return;
    if (!$("#view-overview")?.classList.contains("active")) return;
    try {
      state.fundPulse = await fetchJson(`/api/funds/${encodeURIComponent(fundId)}/pulse`);
      renderFundLivePulse(state.fundPulse);
    } catch {
      /* keep last pulse */
    }
  }, 20_000);
}

function fundPulseStatusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("catalyst")) return "pulse-catalyst";
  if (s.includes("watch")) return "pulse-watch";
  if (s.includes("broken")) return "pulse-broken";
  return "pulse-normal";
}

function renderFundLivePulse(pulse) {
  const tray = $("#fund-pulse-tray");
  if (!tray) return;
  const quotes = pulse?.quotePulse || [];
  const figures = pulse?.figurePulse || [];
  if (!quotes.length && !figures.length) {
    tray.innerHTML = `<p class="muted">No pulse data yet for this basket.</p>`;
    return;
  }

  const quoteHtml = quotes.length
    ? `
    <section class="fund-pulse-block">
      <h5>Market heartbeat</h5>
      ${quotes
        .map(
          (row) => `
        <article class="fund-pulse-row">
          <div class="fund-pulse-head">
            <strong>${escapeHtml(row.symbol)}</strong>
            <span class="fund-pulse-status ${fundPulseStatusClass(row.status)}">${escapeHtml(row.status || "Normal")}</span>
          </div>
          <p class="muted">
            ${row.price != null ? money(row.price) : "—"}
            ${row.pct != null ? ` · ${signed(row.pct)}%` : ""}
            ${row.source ? ` · ${escapeHtml(sourceLabel(row.source))}` : ""}
          </p>
        </article>`
        )
        .join("")}
    </section>`
    : "";

  const figureHtml = figures.length
    ? `
    <section class="fund-pulse-block">
      <h5>Public figure pulse</h5>
      ${figures
        .map(
          (row) => `
        <article class="fund-pulse-row">
          <div class="fund-pulse-head">
            <strong>${escapeHtml(row.name || "Figure")}</strong>
            <span class="social-badge curated">Curated</span>
            <span class="fund-pulse-status ${fundPulseStatusClass(row.status)}">${escapeHtml(row.status || "Normal")}</span>
          </div>
          <p class="muted">${escapeHtml(row.label || "")}</p>
          <p class="muted">${(row.symbolsAffected || []).map((s) => `<span class="mini-pill green">${escapeHtml(s)}</span>`).join(" ")}</p>
          ${row.url ? `<a class="link-button" href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">Open source</a>` : ""}
        </article>`
        )
        .join("")}
    </section>`
    : "";

  const socialItems = pulse?.socialPulse?.items || [];
  const socialHtml = socialItems.length
    ? `
    <section class="fund-pulse-block">
      <h5>Social pulse <span class="social-badge ${escapeHtml((pulse.socialPulse.primaryBadge || "Curated").toLowerCase().replace(/\s+/g, "-"))}">${escapeHtml(pulse.socialPulse.primaryBadge || "Curated")}</span></h5>
      ${socialItems
        .slice(0, 6)
        .map(
          (row) => `
        <article class="fund-pulse-row">
          <div class="fund-pulse-head">
            <strong>${escapeHtml(row.title || "Item")}</strong>
            <span class="social-badge ${escapeHtml(String(row.badge || "Curated").toLowerCase().replace(/\s+/g, "-"))}">${escapeHtml(row.badge || "Curated")}</span>
          </div>
          <p class="muted">${escapeHtml(row.summary || "")}</p>
          ${row.url ? `<a class="link-button" href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">Open source</a>` : ""}
        </article>`
        )
        .join("")}
      <p class="muted">${escapeHtml(pulse.socialPulse.disclaimer || "")}</p>
    </section>`
    : "";

  tray.innerHTML = quoteHtml + figureHtml + socialHtml;
  if (pulse?.disclaimer) {
    tray.insertAdjacentHTML("beforeend", `<p class="funds-disclaimer muted">${escapeHtml(pulse.disclaimer)}</p>`);
  }
  if (pulse?.updatedAt) {
    tray.insertAdjacentHTML(
      "beforeend",
      `<p class="muted fund-pulse-updated">Updated ${escapeHtml(freshnessText(pulse.updatedAt))}</p>`
    );
  }
}

function fundGraphNodeColor(node) {
  if (node.kind === "symbol") return "#d85a30";
  if (node.type === "bill") return "#378add";
  if (node.type === "lobby") return "#ba7517";
  if (node.type === "contract") return "#639922";
  if (node.type === "figure") return "#7f77dd";
  return "#888";
}

function renderFundRelationshipGraph(attr) {
  const canvas = document.getElementById("fund-map-canvas");
  const legend = $("#fund-map-legend");
  if (!canvas) return;
  const graph = attr?.graph;
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const wrap = canvas.parentElement;
  const W = Math.max(320, wrap?.clientWidth || 640);
  const H = 220;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  if (!nodes.length) {
    ctx.font = "12px Geist, sans-serif";
    ctx.fillStyle = "#888";
    ctx.fillText("No relationship edges in this window.", 16, 28);
    if (legend) legend.innerHTML = "";
    return;
  }

  const sources = nodes.filter((n) => n.kind === "source");
  const symbols = nodes.filter((n) => n.kind === "symbol");
  const placed = new Map();
  const leftX = W * 0.2;
  const rightX = W * 0.8;
  const padY = 24;
  const usable = H - padY * 2;

  sources.forEach((node, i) => {
    const y = padY + (usable * (i + 1)) / (sources.length + 1);
    placed.set(node.id, { x: leftX, y, node });
  });
  symbols.forEach((node, i) => {
    const y = padY + (usable * (i + 1)) / (symbols.length + 1);
    placed.set(node.id, { x: rightX, y, node });
  });

  const maxWeight = Math.max(1, ...edges.map((e) => Number(e.weight || 1)));
  edges.forEach((edge) => {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) return;
    const weight = Number(edge.weight || 1);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = "rgba(91, 191, 130, 0.35)";
    ctx.lineWidth = 1 + (weight / maxWeight) * 4;
    ctx.stroke();
  });

  placed.forEach(({ x, y, node }) => {
    const r = node.kind === "symbol" ? 16 : 12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fundGraphNodeColor(node);
    ctx.fill();
    ctx.font = node.kind === "symbol" ? "10px Geist Mono, monospace" : "9px Geist Mono, monospace";
    ctx.fillStyle = "#f4f1ea";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = String(node.label || "").slice(0, node.kind === "symbol" ? 5 : 10);
    ctx.fillText(label, x, y);
  });

  if (legend) {
    legend.innerHTML = [
      graph.legend ? `<span class="mini-pill">${escapeHtml(graph.legend)}</span>` : "",
      `<span class="mini-pill">Legislation</span>`,
      `<span class="mini-pill">Lobbying</span>`,
      `<span class="mini-pill">Contracts</span>`,
      `<span class="mini-pill">Figures</span>`,
      `<span class="mini-pill green">Tickers</span>`
    ].join("");
  }
}

function renderFundCompareTable(perf) {
  const tbody = $("#fund-compare-body");
  if (!tbody) return;
  const rets = perf?.basket?.returns || {};
  const benchRets = perf?.benchmark?.returns || {};
  const maxDd = perf?.basket?.maxDrawdownPct;

  const rows = [
    ["1W", rets["1w"], benchRets["1w"]],
    ["1M", rets["1m"], benchRets["1m"]],
    ["6M", rets["6m"], benchRets["6m"]]
  ];

  tbody.innerHTML = rows.map(([label, basketPct, benchPct]) => `
    <tr>
      <td>${label}</td>
      <td class="${Number(basketPct) >= 0 ? "up" : "down"}">${basketPct == null ? "—" : `${signed(basketPct)}%`}</td>
      <td class="${Number(benchPct) >= 0 ? "up" : "down"}">${benchPct == null ? "—" : `${signed(benchPct)}%`}</td>
      <td>${label === "6M" && maxDd != null ? `${maxDd}%` : "—"}</td>
    </tr>
  `).join("");
}

function renderFundLeaderboard(perf) {
  const host = $("#fund-leaderboard");
  if (!host) return;
  const rows = perf?.leaderboard || [];
  host.innerHTML = rows.length
    ? rows.map((row, idx) => `
      <article class="fund-leader-row ${idx === 0 ? "top" : ""}">
        <strong>${escapeHtml(row.symbol)}</strong>
        <span class="${Number(row.returnPct) >= 0 ? "up" : "down"}">${signed(row.returnPct)}%</span>
        <small class="muted">${Number((row.weight || 0) * 100).toFixed(0)}% weight · ${escapeHtml(row.source || "")}</small>
      </article>
    `).join("")
    : `<p class="muted">No symbol returns yet.</p>`;
}

function attributionTypeLabel(type) {
  return { bill: "Bill", lobby: "Lobbying", contract: "Contract", figure: "Figure" }[type] || type;
}

function renderFundAttributionTray(attr) {
  const tray = $("#fund-attribution-tray");
  if (!tray) return;
  const events = attr?.events || [];
  tray.innerHTML = events.length
    ? events.map((ev, idx) => `
      <article class="fund-attrib-row" data-type="${escapeHtml(ev.type)}" data-attrib-idx="${idx}" data-attrib-date="${escapeHtml(ev.date || "")}" tabindex="0" role="button">
        <div class="fund-attrib-head">
          <span class="mini-pill">${escapeHtml(attributionTypeLabel(ev.type))}</span>
          <time datetime="${escapeHtml(ev.date)}">${escapeHtml(ev.date)}</time>
        </div>
        <h5>${escapeHtml(ev.label)}</h5>
        <p class="muted">${(ev.symbolsAffected || []).map((s) => `<span class="mini-pill green">${escapeHtml(s)}</span>`).join(" ")}</p>
        <p class="muted">${escapeHtml(ev.source || "")}</p>
        ${ev.url ? `<a class="link-button" href="${escapeHtml(ev.url)}" target="_blank" rel="noopener noreferrer">Open source</a>` : ""}
        <details class="fund-attrib-evidence">
          <summary>View evidence</summary>
          <div class="fund-attrib-evidence-body">${renderEvidenceDrawerItems(ev.evidence || [], "No receipt items for this event.")}</div>
          <p class="muted fund-attrib-evidence-note">Research context only — not causal attribution.</p>
        </details>
      </article>
    `).join("")
    : `<p class="muted">No mapped events in this window for these tickers.</p>`;

  tray.querySelectorAll(".fund-attrib-row[data-attrib-date]").forEach((row) => {
    const activate = () => {
      tray.querySelectorAll(".fund-attrib-row").forEach((r) => r.classList.remove("fund-attrib-row-focus"));
      row.classList.add("fund-attrib-row-focus");
      const chartHost = $("#fund-performance-chart");
      if (chartHost && window.TSCharts?.focusMarker) {
        window.TSCharts.focusMarker(chartHost, {
          date: row.dataset.attribDate,
          type: row.dataset.type
        });
      }
    };
    row.addEventListener("click", activate);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
  });

  if (attr?.disclaimer) {
    tray.insertAdjacentHTML(
      "beforeend",
      `<p class="funds-disclaimer muted">${escapeHtml(attr.disclaimer)}</p>`
    );
  }
}

function matrixCellColor(score) {
  const n = Math.max(0, Math.min(100, Number(score) || 0));
  const alpha = (0.16 + n / 150).toFixed(3);
  return `rgba(91, 191, 130, ${alpha})`;
}

function renderFundRelationshipMatrix(attr) {
  const host = $("#fund-matrix-grid");
  const summary = $("#fund-matrix-summary");
  if (!host || !summary) return;
  const matrix = attr?.matrix;
  const symbols = matrix?.symbols || [];
  const rows = matrix?.rows || [];
  if (!symbols.length || !rows.length) {
    host.innerHTML = `<p class="muted" style="padding:10px">No matrix data for this range yet.</p>`;
    summary.innerHTML = "";
    return;
  }

  const header = symbols.map((sym) => `<th>${escapeHtml(sym)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = (row.cells || [])
        .map((cell) => {
          const score = Number(cell.score || 0);
          return `<td class="fund-matrix-cell" style="background:${matrixCellColor(score)}">${score.toFixed(0)}</td>`;
        })
        .join("");
      return `
      <tr>
        <td class="fund-matrix-row-head">${escapeHtml(row.label || row.type)} <span class="muted">(${Number(row.eventCount || 0)})</span></td>
        ${cells}
        <td class="up">${Number(row.rowScore || 0).toFixed(0)}</td>
      </tr>`;
    })
    .join("");

  host.innerHTML = `
    <table class="fund-matrix-table">
      <thead>
        <tr>
          <th>Source</th>
          ${header}
          <th>Row score</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;

  const topCols = (matrix.columnScores || [])
    .slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 4);
  summary.innerHTML = [
    matrix.legend ? `<span class="mini-pill">${escapeHtml(matrix.legend)}</span>` : "",
    ...topCols.map(
      (col) => `<span class="mini-pill green">${escapeHtml(col.symbol)} ${Number(col.score || 0).toFixed(0)}</span>`
    )
  ].join("");
}

function renderFundPerformanceChart(perf, attr) {
  const host = $("#fund-performance-chart");
  if (!host || !window.TSCharts) return;
  const points = perf?.basket?.points || [];
  if (!points.length) {
    window.TSCharts.destroy(host);
    host.innerHTML = `<div class="empty-chart">${escapeHtml(perf?.message || "Not enough history for this basket.")}</div>`;
    return;
  }

  const markers = (attr?.events || []).slice(0, 12).map((ev) => ({
    type: ev.type,
    date: ev.date,
    label: ev.label,
    url: ev.url
  }));
  const sources = (perf?.sources || []).map((s) => s.source).filter(Boolean);
  const sourceLabel = sources.length ? [...new Set(sources)].join(" · ") : "mixed";

  const normalized = window.TSCharts.normalizePoints(points);
  if (!host.dataset.tsChartMounted) {
    window.TSCharts.mount(host, {
      points: normalized,
      mode: "line",
      symbol: perf?.fund?.name || "Basket",
      source: `Index start=100 · ${sourceLabel}`,
      yLabel: "Basket index",
      xLabel: "Date →",
      height: 200,
      markers,
      formatMoney: (v) => Number(v).toFixed(2)
    });
    host.dataset.tsChartMounted = "1";
  } else {
    window.TSCharts.update(host, { points: normalized, source: `Index start=100 · ${sourceLabel}`, markers });
  }
}

function positionPolicyRiskHtml(symbol) {
  const bill = policyBills()
    .filter((item) => (item.affected || []).includes(symbol))
    .sort((a, b) => billMomentum(b) - billMomentum(a))[0];
  if (!bill) return `<span class="score-badge neutral">No mapped risk</span>`;
  const score = Number(bill.policyExposure ?? billMomentum(bill));
  const cls = score >= 67 ? "high" : score < 35 ? "low" : "medium";
  return `<span class="score-badge ${cls}" title="${escapeHtml(bill.title || "")}">${score}/100 ${escapeHtml(bill.id || "")}</span>`;
}

async function loadTradeHistory(symbol, range = state.tradeRange) {
  state.tradeSymbol = symbol;
  state.tradeRange = range;
  const title = $("#trade-symbol-title");
  if (title) title.textContent = `${symbol} paper trade setup`;
  const chart = $("#trade-history-chart");
  if (chart) {
    if (window.TSCharts) window.TSCharts.destroy(chart);
    delete chart.dataset.tsChartMounted;
    chart.innerHTML = `<div class="empty-chart">Loading ${symbol} history...</div>`;
  }
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
  renderTradeHistoryChart(history, symbol, quote);
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

function ensureChartMetaEl(host, id) {
  let meta = document.getElementById(id);
  if (!meta && host?.parentElement) {
    meta = document.createElement("div");
    meta.id = id;
    meta.className = "sparkline-meta";
    host.after(meta);
  }
  return meta;
}

function renderTradeHistoryChart(history, symbol, quote) {
  const host = $("#trade-history-chart");
  if (!host) return;
  const points = history?.points || [];
  if (!points.length || !window.TSCharts) {
    if (window.TSCharts) window.TSCharts.destroy(host);
    delete host.dataset.tsChartMounted;
    host.innerHTML = `<div class="empty-chart">No historical data loaded.</div>`;
    const meta = document.getElementById("trade-history-meta");
    if (meta) meta.innerHTML = "";
    return;
  }

  const normalized = window.TSCharts.normalizePoints(points);
  const source = sourceLabel(history?.source || "loading");
  const mode = window.TSCharts.hasOhlc(normalized) ? "candle" : "line";

  if (!host.dataset.tsChartMounted) {
    window.TSCharts.mount(host, {
      points: normalized,
      mode,
      symbol,
      source,
      yLabel: `${symbol} price (USD)`,
      xLabel: "Time →",
      height: 280,
      formatMoney: money,
      formatDate: formatPointDate,
      liveLabel: quote?.price ? `Live ${money(quote.price)}` : ""
    });
    host.dataset.tsChartMounted = "1";
  } else {
    window.TSCharts.update(host, {
      points: normalized,
      mode,
      liveValue: quote?.price,
      source,
      liveLabel: quote?.price ? `Live ${money(quote.price)}` : ""
    });
  }

  const closes = normalized.map((p) => p.close);
  const up = closes[closes.length - 1] >= closes[0];
  const sampled = normalized.filter((_, i) => i % Math.max(1, Math.floor(normalized.length / 4)) === 0).slice(0, 4);
  const meta = ensureChartMetaEl(host, "trade-history-meta");
  if (meta) {
    meta.innerHTML = `
      <span>${escapeHtml(sampled[0]?.date || "")}</span>
      <strong class="${up ? "up" : "down"}">${money(closes[closes.length - 1])}</strong>
      <span>${escapeHtml(normalized[normalized.length - 1]?.date || "")}</span>`;
  }
}

function renderAnalysisPriceChart(symbol, pts, charts, quote) {
  const host = $("#analysis-sparkline");
  if (!host) return;
  if (!pts.length || !window.TSCharts) {
    if (window.TSCharts) window.TSCharts.destroy(host);
    delete host.dataset.tsChartMounted;
    host.innerHTML = `<div class="empty-chart">No trend data for this window.</div>`;
    return;
  }

  const normalized = window.TSCharts.normalizePoints(
    pts.map((p) => ({
      date: p.date || p.label || "",
      close: p.value ?? p.close,
      open: p.open,
      high: p.high,
      low: p.low
    }))
  );
  const caption = priceTrendCaption(symbol, charts);
  const mode = window.TSCharts.hasOhlc(normalized) ? "candle" : "line";

  if (!host.dataset.tsChartMounted) {
    window.TSCharts.mount(host, {
      points: normalized,
      mode,
      symbol,
      source: caption,
      yLabel: `${symbol} price (USD)`,
      xLabel: "Time →",
      height: 210,
      formatMoney: money,
      formatDate: formatPointDate,
      liveLabel: quote?.price ? `Live ${money(quote.price)}` : ""
    });
    host.dataset.tsChartMounted = "1";
  } else {
    window.TSCharts.update(host, {
      points: normalized,
      liveValue: quote?.price,
      source: caption,
      liveLabel: quote?.price ? `Live ${money(quote.price)}` : ""
    });
  }
}

function renderLobbyMappingStatus(lobby) {
  const el = $("#analysis-lobby-map-status");
  if (!el) return;
  const data = lobby || {};
  const reason = data.reason || data.status || "no_match";
  const pillClass =
    reason === "matched" ? "green" : reason === "api_error" ? "red" : reason === "not_requested" ? "" : "amber";
  const copy =
    reason === "api_error"
      ? data.error || "Lobby mapper could not run. Bill-linked filings below may still appear."
      : reason === "not_requested"
        ? data.summary || "Lobby mapping was not requested for this snapshot."
        : data.summary ||
          (data.matches?.length
            ? `${data.matches.length} lobbying ${data.matches.length === 1 ? "filing is" : "filings are"} mapped to active policy issues.`
            : "No lobbying activity mapped to this ticker yet.");
  el.innerHTML = `
    <div class="lobby-map-status empty-state-card ${escapeHtml(reason)}">
      <div class="meta-line">
        <span class="mini-pill ${pillClass}">${escapeHtml(data.confidence || (reason === "matched" ? "Medium" : "No match"))}</span>
        <span class="muted">${escapeHtml(data.source || "TradeSimple mapper")}</span>
      </div>
      <p>${escapeHtml(copy)}</p>
    </div>`;
}


