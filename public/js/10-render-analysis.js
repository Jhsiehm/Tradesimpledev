/* Extracted from app.js lines 2622-2993 */
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
}

function renderAnalysisLobbyTab() {
  const mappedEl = $("#analysis-lobby-mapped");
  const otherEl = $("#analysis-lobby-other");
  const toggleBtn = $("#analysis-lobby-other-toggle");
  if (!mappedEl || !otherEl || !toggleBtn) return;

  renderLobbyMappingStatus(state.analysis?.lobbyMapping);

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

function contractCrsDisplay(award, symbol) {
  const sig = award?.eventSignal;
  if (sig?.label) {
    const crsLabel =
      sig.pricedInAssessment === "Likely already priced in"
        ? "Likely priced in"
        : sig.score >= 75 || sig.pricedInAssessment === "More likely new information"
          ? "Higher signal"
          : "Monitor";
    const crsClass =
      crsLabel === "Higher signal" ? "green" : crsLabel === "Likely priced in" ? "neutral" : "";
    return { crsLabel, crsClass, title: `Contract Revenue Signal: ${sig.plainEnglish || sig.label}` };
  }
  const agName = award?.awardingAgency || "";
  const agLower = agName.toLowerCase();
  const agScore = agLower.includes("health") || agLower.includes("veteran") ? 85
    : agLower.includes("homeland") || agLower.includes("transport") ? 70
    : agLower.includes("energy") || agLower.includes("education") ? 65
    : agLower.includes("defense") || agLower.includes("army") || agLower.includes("navy") || agLower.includes("air force") ? 35
    : agLower.includes("general services") ? 45 : 55;
  const logAmt = Math.log(Math.max(Number(award?.obligatedAmount) || 1e6, 1e6));
  const novelty = Math.round(Math.min(100, Math.max(0, (23.0 - logAmt) / (23.0 - 16.1) * 100)));
  const crsLabel = agScore >= 70 && novelty >= 50 ? "Higher signal"
    : agScore <= 40 && novelty <= 30 ? "Likely priced in"
    : "Monitor";
  const crsClass = agScore >= 70 && novelty >= 50 ? "green"
    : agScore <= 40 && novelty <= 30 ? "neutral" : "";
  return {
    crsLabel,
    crsClass,
    title: `Contract Revenue Signal: how likely this award contains new information (${symbol || "tracked contractor"})`
  };
}

function renderMoneyTrailPanel(trail) {
  const panel = $("#analysis-money-trail");
  const chainEl = $("#money-trail-chain");
  const limitsEl = $("#money-trail-limits");
  if (!panel || !chainEl) return;
  if (!trail) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  chainEl.innerHTML = (trail.chain || [])
    .map(
      (step) => `
      <div class="money-trail-step">
        <span class="money-trail-step-label">${escapeHtml(step.label)}</span>
        <div>
          <div class="money-trail-step-value">${escapeHtml(step.value)}</div>
          <div class="money-trail-step-explain">${escapeHtml(step.explanation)}</div>
        </div>
      </div>`
    )
    .join("");
  if (limitsEl) {
    limitsEl.innerHTML = (trail.limitations || []).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  }
}

function renderContractInsightBanner(analysis) {
  const banner   = $("#analysis-contract-insight");
  const pill     = $("#contract-archetype-pill");
  const dogePill = $("#contract-doge-pill");
  const explain  = $("#contract-archetype-explain");
  const bull     = $("#contract-bull");
  const bear     = $("#contract-bear");
  const cp = analysis?.contractProfile;
  if (!banner) return;
  if (!cp) { banner.hidden = true; return; }
  banner.hidden = false;
  if (pill)     pill.textContent    = cp.archetype || "";
  if (dogePill) dogePill.hidden     = !cp.dogeRisk;
  if (explain)  explain.textContent = cp.archetypeExplain || cp.note || "";
  if (bull)     bull.textContent    = cp.bull || "";
  if (bear)     bear.textContent    = cp.bear || "";
}

function renderAnalysisPolicyChains(chains) {
  const targets = [$("#analysis-policy-chains"), $("#analysis-stock-policy-chains")].filter(Boolean);
  if (!targets.length) return;
  if (!chains || !chains.length) {
    targets.forEach((el) => {
      el.innerHTML = "";
    });
    return;
  }
  const html = chains.map((chain) => {
    const toneClass = chain.tone === "green" ? "green" : chain.tone === "red" ? "red" : "amber";
    const steps = (chain.steps || []).map((step) =>
      `<div class="chain-step">
        <span class="chain-step-label mono">${escapeHtml(step.label)}</span>
        <span class="chain-step-text">${escapeHtml(step.text)}</span>
      </div>`
    ).join("");
    return `
      <div class="policy-chain-card ${toneClass}-card">
        <div class="chain-head">
          <strong>${escapeHtml(chain.title)}</strong>
        </div>
        <p class="chain-summary muted">${escapeHtml(chain.summary)}</p>
        <div class="chain-steps">${steps}</div>
      </div>
    `;
  }).join("");
  targets.forEach((el) => {
    el.innerHTML = html;
  });
}

function renderAnalysisContractsTab(symbol, companyName) {
  const tbody = $("#analysis-contracts-tbody");
  if (!tbody) return;
  const co = companyName || symbol;
  const watch = contractWatchlist().find((w) => w.symbol === symbol);
  const fetchCo = watch?.company || co;
  const cached = state.contractCache[symbol] || state.contracts.find((r) => r.symbol === symbol);
  if (!cached) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Loading live USASpending.gov awards for <strong>${escapeHtml(co)}</strong>…</td></tr>`;
    loadAnalysisContractsData(symbol, fetchCo);
    return;
  }
  if (cached.loading) {
    tbody.innerHTML = `<tr><td colspan="6">Loading live awards for ${escapeHtml(co)}…</td></tr>`;
    return;
  }
  if (cached.error || !cached.results?.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      No recent federal contract awards found for ${escapeHtml(co)} in USASpending.gov.
      <a class="link-button" href="${usaspendingSearchUrl(fetchCo, cached.recipientId)}" target="_blank" rel="noopener noreferrer">Search directly ↗</a>
    </td></tr>`;
    return;
  }

  const now = Date.now();
  const rows = (cached.results || []).slice(0, 8);
  tbody.innerHTML = rows.map((award, idx) => {
    const normalized = normalizeContractAward(award);
    const daysToEnd = normalized.endDate
      ? Math.round((new Date(normalized.endDate).getTime() - now) / 864e5)
      : null;
    const status = daysToEnd == null ? "Unknown"
      : daysToEnd < 0 ? "Expired"
      : daysToEnd <= 90 ? "Expires soon"
      : daysToEnd <= 365 ? "Active"
      : "Active";
    const sClass = daysToEnd == null ? "neutral"
      : daysToEnd < 0 ? "low"
      : daysToEnd <= 90 ? "medium"
      : "neutral";
    const period = contractAwardPeriodLabel(normalized);
    const fullDesc = contractAwardDisplayDescription(normalized) || "No description";
    const desc = fullDesc.slice(0, 120) + (fullDesc.length > 120 ? "…" : "");
    const linkUrl = contractAwardDirectUrl(normalized) || usaspendingSearchUrl(fetchCo, cached.recipientId);
    const { crsLabel, crsClass, title: crsTitle } = contractCrsDisplay(award, symbol);
    const trail = award.moneyTrail || null;
    return `
      <tr class="contract-award-row-click" data-award-idx="${idx}" style="cursor:${trail ? "pointer" : "default"}">
        <td>
          <div>${escapeHtml(normalized.awardingAgency || "Agency not listed")}</div>
          <small class="muted mono">${escapeHtml(normalized.awardId || "")}</small>
        </td>
        <td title="${escapeHtml(fullDesc)}">${escapeHtml(desc)}</td>
        <td class="mono">${compactMoney(normalized.obligatedAmount || 0)}</td>
        <td class="muted mono" style="font-size:11px">${escapeHtml(period)}</td>
        <td>
          <span class="score-badge ${sClass}">${status}</span>
          <span class="mini-pill ${crsClass}" title="${escapeHtml(crsTitle)}">${escapeHtml(crsLabel)}</span>
        </td>
        <td>
          <a class="link-button" href="${linkUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">↗</a>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".contract-award-row-click").forEach((row) => {
    row.addEventListener("click", () => {
      const idx = Number(row.dataset.awardIdx);
      const award = rows[idx];
      if (award?.moneyTrail) renderMoneyTrailPanel(award.moneyTrail);
    });
  });
}

async function loadAnalysisContractsData(symbol, companyName) {
  if (!isFeatureEnabled("CONTRACTS_ANALYZER_ENABLED")) {
    state.contractCache[symbol] = { disabled: true, results: [] };
    return;
  }
  if (state.contractCache[symbol]?.loading) return;
  state.contractCache[symbol] = { loading: true };
  try {
    const data = await fetchJson(`/api/contracts/${encodeURIComponent(companyName || symbol)}`);
    state.contractCache[symbol] = summarizeContractResults({ symbol, company: companyName || symbol }, data);
  } catch (error) {
    console.error("[contracts] analysis fetch failed", error);
    state.contractCache[symbol] = { error: true, results: [] };
  }
  if (state.activeAnalysisSymbol === symbol) renderAnalysisContractsTab(symbol, companyName);
}

