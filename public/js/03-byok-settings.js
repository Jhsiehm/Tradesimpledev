/* Extracted from app.js lines 10082-11157 */
// ── BYOK settings panel ───────────────────────────────────────────────────────

function renderByokPanel() {
  const log = $("#research-log");
  if (!log) return;

  log.querySelector(".byok-panel")?.remove();

  const panel = document.createElement("div");
  panel.className = "byok-panel";

  const providerOptions = Object.entries(BYOK_PROVIDERS)
    .map(([v, p]) => `<option value="${v}" ${state.byok.provider === v ? "selected" : ""}>${escapeHtml(p.label)}</option>`)
    .join("");

  const currentProvider = state.byok.provider || "anthropic";
  const providerConfig = BYOK_PROVIDERS[currentProvider];
  const modelOptions = (providerConfig?.models || [])
    .map((m) => `<option value="${m.value}" ${state.byok.model === m.value ? "selected" : ""}>${escapeHtml(m.label)}</option>`)
    .join("");

  panel.innerHTML = `
    <div class="byok-panel-head">
      <span class="byok-panel-title">AI Settings — use your own key</span>
      <button type="button" class="byok-panel-close" aria-label="Close AI settings">✕</button>
    </div>
    <div class="byok-panel-body">
      <p class="byok-panel-desc">
        Your key is saved in your browser only — never sent to TradeSimple's server.
        Get a key from your provider's website. Usage is billed to your own account.
      </p>
      <label class="byok-label">Provider
        <select class="byok-select" id="byok-provider-select">${providerOptions}</select>
      </label>
      <label class="byok-label">Model
        <select class="byok-select" id="byok-model-select">${modelOptions}</select>
      </label>
      <label class="byok-label">API key
        <input
          class="byok-input"
          id="byok-key-input"
          type="password"
          placeholder="${escapeHtml(providerConfig?.placeholder || "paste your key here")}"
          value="${state.byok.key ? "•".repeat(12) : ""}"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <div class="byok-actions">
        <button type="button" class="button button-primary compact" id="byok-save-btn">Save key</button>
        ${state.byok.key ? '<button type="button" class="button button-ghost compact" id="byok-clear-btn">Remove key</button>' : ""}
      </div>
      ${state.byok.key ? `<div class="byok-status-saved">Key saved · ${escapeHtml(BYOK_PROVIDERS[state.byok.provider]?.label || state.byok.provider)} · ${escapeHtml(state.byok.model || "")}</div>` : ""}
      <p class="byok-panel-links">
        Get a key:
        <a href="https://console.anthropic.com/keys" target="_blank" rel="noopener">Anthropic</a> ·
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">OpenAI</a> ·
        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Google Gemini</a>
      </p>
    </div>`;

  log.appendChild(panel);
  log.scrollTop = log.scrollHeight;

  panel.querySelector("#byok-provider-select")?.addEventListener("change", (e) => {
    const p = BYOK_PROVIDERS[e.target.value];
    if (!p) return;
    const modelSel = panel.querySelector("#byok-model-select");
    if (modelSel) {
      modelSel.innerHTML = p.models
        .map((m) => `<option value="${m.value}">${escapeHtml(m.label)}</option>`)
        .join("");
    }
    const keyInput = panel.querySelector("#byok-key-input");
    if (keyInput) keyInput.placeholder = p.placeholder;
  });

  panel.querySelector("#byok-save-btn")?.addEventListener("click", () => {
    const provider = panel.querySelector("#byok-provider-select")?.value;
    const model = panel.querySelector("#byok-model-select")?.value;
    const rawKey = panel.querySelector("#byok-key-input")?.value.trim();
    const key = rawKey.replace(/•/g, "").trim() || state.byok.key;
    if (!key) {
      panel.querySelector("#byok-key-input")?.focus();
      return;
    }
    saveByokToStorage(provider, key, model);
    panel.remove();
    appendMessage(
      `Key saved. Using ${BYOK_PROVIDERS[provider]?.label || provider} · ${model}. Your key stays in your browser — ask away.`,
      "ai"
    );
    renderByokStatus();
  });

  panel.querySelector("#byok-clear-btn")?.addEventListener("click", () => {
    clearByok();
    panel.remove();
    appendMessage("Key removed. Switching back to server AI (if available).", "ai");
    renderByokStatus();
  });

  panel.querySelector(".byok-panel-close")?.addEventListener("click", () => {
    panel.remove();
  });
}

function renderByokStatus() {
  const btn = document.querySelector(".byok-settings-btn");
  if (!btn) return;
  if (byokIsConfigured()) {
    btn.textContent = `AI: ${BYOK_PROVIDERS[state.byok.provider]?.label?.split(" ")[0] || "Custom"} key ✓`;
    btn.classList.add("byok-active");
  } else {
    btn.textContent = "AI Settings";
    btn.classList.remove("byok-active");
  }
}

function toggleByokPanel() {
  const existing = document.querySelector(".byok-panel");
  if (existing) {
    existing.remove();
    return;
  }
  renderByokPanel();
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

function appendResearchAiMessage(prose, watchFor, bullets) {
  const div = document.createElement("div");
  div.className = "message";
  const items = Array.isArray(bullets) && bullets.length ? bullets : parseAiBulletItems(prose);
  if (items.length) {
    const ul = document.createElement("ul");
    ul.className = "ai-analysis-bullets";
    for (const item of items) {
      const li = document.createElement("li");
      if (typeof item === "string" && item.includes("**")) {
        li.innerHTML = escapeHtml(item).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      } else {
        li.textContent = item;
      }
      ul.appendChild(li);
    }
    div.appendChild(ul);
  } else {
    const p = document.createElement("p");
    if (typeof prose === "string" && prose.includes("**")) {
      p.innerHTML = escapeHtml(prose).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    } else {
      p.textContent = prose || "";
    }
    div.appendChild(p);
  }
  if (Array.isArray(watchFor) && watchFor.length) {
    const label = document.createElement("p");
    label.className = "research-watch-label muted";
    label.textContent = "Watch for:";
    div.appendChild(label);
    const ul = document.createElement("ul");
    ul.className = "ai-analysis-bullets research-watch-bullets";
    for (const item of watchFor) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.appendChild(li);
    }
    div.appendChild(ul);
  }
  $("#research-log").appendChild(div);
  $("#research-log").scrollTop = $("#research-log").scrollHeight;
}

async function askWhyForBill(billId) {
  if (!billId) return;
  if (!isFeatureEnabled("AI_RESEARCH_ENABLED")) return;
  const id = String(billId);
  showView("bills");
  openGlobalResearchDrawer();
  appendMessage(`Ask why · ${id} (bill metrics)`, "user");
  appendMessage("Running bill metrics through research…", "ai", true);

  if (byokIsConfigured()) {
    try {
      const response = await callByokProvider("", id);
      document.querySelector("[data-pending-message]")?.remove();
      appendResearchAiMessage(response.prose || "", response.watchFor || [], response.bullets || []);
    } catch (error) {
      document.querySelector("[data-pending-message]")?.remove();
      appendMessage(`AI error: ${error.message || "Request failed."}. Check your key in AI Settings.`, "ai");
      renderByokStatus();
    }
    return;
  }

  if (!state.config?.data?.anthropic) {
    document.querySelector("[data-pending-message]")?.remove();
    appendMessage(
      "No AI key configured. Add your own API key using AI Settings, or ask the app owner to set ANTHROPIC_API_KEY on the server.",
      "ai"
    );
    renderByokPanel();
    return;
  }

  try {
    const response = await fetch("/api/research/ask", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(csrfTokenFromCookie() ? { "X-CSRF-Token": csrfTokenFromCookie() } : {})
      },
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
    if (payload.error) appendMessage(payload.error, "ai");
    else appendResearchAiMessage(payload.prose || "", payload.watchFor || [], payload.bullets || []);
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

function parseAiBulletItems(text) {
  if (global.BriefShell?.parseAiBulletItems) return BriefShell.parseAiBulletItems(text);
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bullets = [];
  for (const line of lines) {
    const matched = line.match(/^(?:[-•*]|\d+[.)])\s+(.+)$/);
    if (matched) bullets.push(matched[1].trim());
  }
  if (bullets.length >= 2) return bullets.slice(0, 6);
  if (bullets.length === 1 && lines.length === 1) return bullets;
  const sentences = raw
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  if (sentences.length >= 2) return sentences.slice(0, 6);
  if (bullets.length === 1) return bullets;
  return raw ? [raw] : [];
}

function aiAnalysisBulletsHtml(text) {
  if (global.BriefShell?.aiAnalysisBulletsHtml) return BriefShell.aiAnalysisBulletsHtml(text, escapeHtml);
  const items = parseAiBulletItems(text);
  if (!items.length) return `<p class="ai-analysis-prose">${escapeHtml(text)}</p>`;
  return `<ul class="ai-analysis-bullets">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function isAiExplainerSource(source) {
  const normalized = String(source || "").toLowerCase();
  return normalized && normalized !== "local_fallback" && normalized !== "fallback_error" && normalized !== "structured snapshot";
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

const ONBOARDING_STORAGE_KEY = "ts_onboarding_v3";
const ONBOARDING_COMPLETE_KEY = "ts_onboarding_complete";
const GUIDED_DEMO_KEY = "ts_guided_demo";
const GUIDED_DEMO_DISMISS_KEY = "ts_guided_demo_dismiss";
const GUIDED_DEMO_BRIEF_SCROLL_KEY = "ts_guided_brief_scrolled";
const GUIDED_DEMO_FOCUS = "PLTR";
const GUIDED_DEMO_STEP_KEYS = {
  brief: "ts_guided_step_brief",
  bill: "ts_guided_step_bill",
  trade: "ts_guided_step_trade"
};
let guidedDemoDismissedMemory = false;
let appConfirmResolver = null;

function isDemoSession(session = state.session) {
  const user = session?.user;
  if (!user) return false;
  if (user.provider === "demo") return true;
  return String(user.id || "").startsWith("demo-");
}

function guidedDemoActive() {
  if (guidedDemoDismissedMemory) return false;
  try {
    if (sessionStorage.getItem(GUIDED_DEMO_DISMISS_KEY) === "1") return false;
    if (sessionStorage.getItem(GUIDED_DEMO_KEY) === "done") return false;
  } catch (_) {}
  return isDemoSession();
}

function guidedDemoStepDone(step) {
  try {
    return sessionStorage.getItem(GUIDED_DEMO_STEP_KEYS[step]) === "1";
  } catch (_) {
    return false;
  }
}

function markGuidedDemoStep(step) {
  if (!guidedDemoActive()) return;
  try {
    sessionStorage.setItem(GUIDED_DEMO_STEP_KEYS[step], "1");
  } catch (_) {}
  renderGuidedDemoChecklist();
}

function scrollMorningBriefIntoView() {
  const card = $("#morning-brief-card");
  if (!card || card.hidden) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  card.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

function maybeScrollDemoMorningBrief() {
  if (!isDemoSession()) return;
  try {
    if (sessionStorage.getItem(GUIDED_DEMO_BRIEF_SCROLL_KEY) === "1") return;
    sessionStorage.setItem(GUIDED_DEMO_BRIEF_SCROLL_KEY, "1");
  } catch (_) {}
  renderMorningBrief();
  requestAnimationFrame(() => scrollMorningBriefIntoView());
}

function initGuidedDemoSession(session) {
  if (!isDemoSession(session)) return;
  try {
    if (sessionStorage.getItem(GUIDED_DEMO_DISMISS_KEY) === "1") {
      guidedDemoDismissedMemory = true;
    }
    if (sessionStorage.getItem(GUIDED_DEMO_KEY)) return;
    sessionStorage.setItem(GUIDED_DEMO_KEY, "active");
  } catch (_) {}
  if (!state.focusSymbol && !state._symbolFromUrl) {
    setFocusSymbol(GUIDED_DEMO_FOCUS, { persist: true, render: true, syncAnalysis: true });
  }
  renderGuidedDemoChecklist();
}

function dismissGuidedDemo() {
  guidedDemoDismissedMemory = true;
  try {
    sessionStorage.setItem(GUIDED_DEMO_DISMISS_KEY, "1");
    sessionStorage.setItem(GUIDED_DEMO_KEY, "done");
  } catch (_) {}
  renderGuidedDemoChecklist();
  syncDashChromeHeights();
}

function setupGuidedDemo() {
  $("#guided-demo-dismiss")?.addEventListener("click", dismissGuidedDemo);
}

function renderGuidedDemoChecklist() {
  const panel = $("#guided-demo-checklist");
  const list = $("#guided-demo-steps");
  if (!panel || !list) return;
  if (!guidedDemoActive()) {
    panel.hidden = true;
    syncDashChromeHeights();
    return;
  }
  const steps = [
    {
      id: "brief",
      label: "Read morning brief signal",
      done: guidedDemoStepDone("brief"),
      action: () => showView("overview")
    },
    {
      id: "bill",
      label: "Open linked bill or contract",
      done: guidedDemoStepDone("bill"),
      action: () => {
        const top = policyBills().slice().sort((a, b) => billMomentum(b) - billMomentum(a))[0];
        if (top?.id) {
          showView("bills");
          state.billsFilter = top.id;
          renderBills();
        } else {
          showView("contracts");
        }
      }
    },
    {
      id: "trade",
      label: "Optional: preview paper trade",
      done: guidedDemoStepDone("trade"),
      action: () => showView("trade")
    }
  ];
  const allDone = steps.every((s) => s.done);
  panel.hidden = false;
  panel.classList.toggle("is-collapsed", allDone);
  list.innerHTML = steps
    .map(
      (step, i) => `
    <li class="guided-demo-step${step.done ? " is-done" : ""}">
      <span class="guided-demo-step-num" aria-hidden="true">${step.done ? "✓" : i + 1}</span>
      <span>${escapeHtml(step.label)}${step.done ? "" : ` · <button type="button" class="link-button guided-demo-go" data-guided-step="${step.id}">Go</button>`}</span>
    </li>`
    )
    .join("");
  list.querySelectorAll("[data-guided-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = steps.find((s) => s.id === btn.dataset.guidedStep);
      step?.action();
    });
  });
  syncDashChromeHeights();
}

function momentumBandLabel(score) {
  const n = Number(score);
  if (n >= 67) return "High";
  if (n >= 35) return "Medium";
  return "Low";
}

function signalScanLineHtml({ source, date, tickers, band }) {
  const parts = [];
  if (source) parts.push(source);
  if (date) parts.push(formatSignalDate(date));
  if (tickers?.length) parts.push(tickers.slice(0, 4).join(", "));
  else if (tickers === "") parts.push("No ticker");
  if (band) parts.push(band);
  if (!parts.length) return "";
  return `<p class="signal-scan-line">${escapeHtml(parts.join(" · "))}</p>`;
}

function formatSignalDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function pickMorningBriefSignal() {
  const scopedFec = filteredFecPulses();
  if (scopedFec.length && (state.fecPulse?.source === "fec" || Math.random() < 0.35)) {
    const pulse = scopedFec[0];
    return {
      kind: "fec",
      data: {
        type: "fec",
        score: 72,
        date: pulse.filingDate || state.fecPulse?.updatedAt,
        tickers: pulse.tickers || [],
        title: pulse.plainEnglish || pulse.label,
        chain: ["FEC", pulse.plainEnglish || "", (pulse.tickers || []).join(", ")],
        _fecUrl: pulse.fecUrl
      }
    };
  }
  const feed = buildSignalFeed().filter((sig) => signalMatchesFocusFilter(sig));
  if (feed.length) return { kind: "signal", data: feed[0] };
  const bills = policyBills()
    .filter(billMatchesFocusFilter)
    .slice()
    .sort((a, b) => billMomentum(b) - billMomentum(a));
  if (bills.length) return { kind: "bill", data: bills[0] };
  return null;
}

function renderMorningBrief() {
  const card = $("#morning-brief-card");
  const inner = $("#morning-brief-inner");
  if (!card || !inner) return;
  const pick = pickMorningBriefSignal();
  if (!pick) {
    card.hidden = false;
    inner.innerHTML = isWatchlistScope() && !state.focusSymbol ? watchlistEmptyStateHtml() : "";
    if (!inner.innerHTML) card.hidden = true;
    inner.querySelector("[data-feed-scope-set]")?.addEventListener("click", () => setFeedScope("all"));
    return;
  }
  card.hidden = false;
  if (pick.kind === "signal") {
    const sig = pick.data;
    const source = signalSourceLabel(sig);
    const band = `${sig.score}/100 · ${momentumBandLabel(sig.score)}`;
    const convBand = sig.score >= 67 ? "high" : sig.score < 35 ? "low" : "medium";
    card.className = `morning-brief-card intel-card intel-card--${convBand} panel panel-emphasis`;
    const primaryTicker = (sig.tickers && sig.tickers[0]) || "";
    inner.innerHTML = `
      ${primaryTicker ? `<div class="morning-brief-ticker">${escapeHtml(primaryTicker)}</div>` : ""}
      <div class="morning-brief-eyebrow">
        <span class="top-signal-dot" aria-hidden="true"></span>
        <span>Morning brief</span>
        <span class="mini-pill">${escapeHtml(band)}</span>
      </div>
      <hr class="morning-brief-rule" aria-hidden="true">
      <h2 class="morning-brief-title">${escapeHtml(sig.title || "Top signal")}</h2>
      ${signalScanLineHtml({ source, date: sig.date, tickers: sig.tickers, band: momentumBandLabel(sig.score) })}
      <p class="morning-brief-why">${escapeHtml(twelveWordSummary(sig.chain?.[1] || sig.title || ""))}</p>
      <div class="morning-brief-actions">
        <button type="button" class="button button-primary compact" data-view-jump="signals">Open in Signals</button>
        ${sig._billId ? `<button type="button" class="button button-secondary compact" data-drill-action="bills" data-bill-id="${escapeHtml(sig._billId)}" role="link" tabindex="0">View bill</button>` : ""}
      </div>`;
  } else if (pick.kind === "fec") {
    const sig = pick.data;
    const convBand = "medium";
    card.className = `morning-brief-card intel-card intel-card--${convBand} panel panel-emphasis`;
    const primaryTicker = (sig.tickers && sig.tickers[0]) || "";
    inner.innerHTML = `
      ${primaryTicker ? `<div class="morning-brief-ticker">${escapeHtml(primaryTicker)}</div>` : ""}
      <div class="morning-brief-eyebrow">
        <span class="top-signal-dot" aria-hidden="true"></span>
        <span>Morning brief · FEC</span>
        <span class="mini-pill ${state.fecPulse?.source === "sample" ? "amber" : "green"}">${state.fecPulse?.source === "sample" ? "Sample" : "FEC"}</span>
      </div>
      <hr class="morning-brief-rule" aria-hidden="true">
      <h2 class="morning-brief-title">${escapeHtml(sig.title || "Campaign finance pulse")}</h2>
      ${signalScanLineHtml({ source: "FEC", date: sig.date, tickers: sig.tickers, band: String(state.fecPulse?.cycle || "") })}
      <p class="morning-brief-why">${escapeHtml(twelveWordSummary(sig.chain?.[1] || sig.title || ""))}</p>
      <div class="morning-brief-actions">
        <button type="button" class="button button-primary compact" data-view-jump="signals">Open in Signals</button>
        ${sig._fecUrl ? `<a class="button button-secondary compact" href="${escapeHtml(sig._fecUrl)}" target="_blank" rel="noopener noreferrer">Source: FEC</a>` : ""}
      </div>`;
  } else {
    const bill = pick.data;
    const m = billMomentum(bill);
    const convBand = m >= 67 ? "high" : m < 35 ? "low" : "medium";
    card.className = `morning-brief-card intel-card intel-card--${convBand} panel panel-emphasis`;
    const tickers = (bill.affected || []).slice(0, 4);
    const source = bill.exactCongressRecord ? "Congress.gov" : "Policy feed";
    const primaryTicker = tickers[0] || "";
    inner.innerHTML = `
      ${primaryTicker ? `<div class="morning-brief-ticker">${escapeHtml(primaryTicker)}</div>` : ""}
      <div class="morning-brief-eyebrow">
        <span class="top-signal-dot" aria-hidden="true"></span>
        <span>Morning brief</span>
        <span class="mini-pill">${m}/100 · ${escapeHtml(billConfidenceLabel(bill))}</span>
      </div>
      <hr class="morning-brief-rule" aria-hidden="true">
      <h2 class="morning-brief-title">${escapeHtml(bill.shortTitle || bill.title)}</h2>
      ${signalScanLineHtml({ source, date: bill.latestActionDate || bill.introduced, tickers, band: momentumBandLabel(m) })}
      <p class="morning-brief-why">${escapeHtml(bill.whyMarketsCare || bill.plainEnglish || bill.signal || bill.impact || "")}</p>
      <div class="morning-brief-actions">
        <button type="button" class="button button-primary compact" data-view-jump="signals">Open in Signals</button>
        <button type="button" class="button button-secondary compact" data-drill-action="bills" data-bill-id="${escapeHtml(bill.id)}" role="link" tabindex="0">View bill</button>
      </div>`;
  }
  inner.querySelectorAll("[data-view-jump]").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.viewJump));
  });
}

function isOnboardingComplete() {
  try {
    return localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "1";
  } catch (_) {
    return false;
  }
}

async function redirectToOnboardingIfNeeded(session, params) {
  if (!session?.user) return false;
  if (isOnboardingComplete()) return false;
  if (params.get("onboarded") === "1") return false;
  try {
    const meta = await fetchJson("/api/onboarding/bill");
    if (!meta?.billId) return false;
    window.location.replace(`/bill/${encodeURIComponent(meta.billId)}?onboarding=1`);
    return true;
  } catch (_) {
    return false;
  }
}

function markOnboardingCompleteFromUrl(params) {
  if (params.get("onboarded") !== "1") return;
  try {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, "1");
  } catch (_) {}
  params.delete("onboarded");
  const clean = params.toString();
  window.history.replaceState({}, "", clean ? `${window.location.pathname}?${clean}` : window.location.pathname);
}

function setupFeedScopeToggle() {
  const bar = $("#feed-scope-bar");
  if (!bar || bar.dataset.bound === "true") return;
  bar.dataset.bound = "true";
  bar.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-feed-scope]");
    if (!chip) return;
    setFeedScope(chip.dataset.feedScope || "watchlist");
  });
  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-feed-scope-set]");
    if (btn) setFeedScope(btn.dataset.feedScopeSet || "all");
  });
  renderFeedScopeToggle();
}

let watchlistPromptDraft = new Set();

function renderWatchlistPromptChips() {
  const host = $("#watchlist-prompt-chips");
  const countEl = $("#watchlist-prompt-count");
  const saveBtn = $("#watchlist-prompt-save");
  if (!host) return;
  host.innerHTML = WATCHLIST_SUGGESTED_CHIPS.map((sym) => {
    const active = watchlistPromptDraft.has(sym);
    return `<button type="button" class="watchlist-prompt-chip${active ? " is-active" : ""}" data-watchlist-chip="${escapeHtml(sym)}">${escapeHtml(sym)}</button>`;
  }).join("");
  host.querySelectorAll("[data-watchlist-chip]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sym = normalizeWatchSymbol(btn.dataset.watchlistChip);
      if (!sym) return;
      if (watchlistPromptDraft.has(sym)) watchlistPromptDraft.delete(sym);
      else if (watchlistPromptDraft.size < 10) watchlistPromptDraft.add(sym);
      renderWatchlistPromptChips();
    });
  });
  const n = watchlistPromptDraft.size;
  if (countEl) countEl.textContent = `${n} selected · ${n < 3 ? "need at least 3" : "ready to save"}`;
  if (saveBtn) saveBtn.disabled = n < 3 || n > 10;
}

function openWatchlistPromptModal() {
  const modal = $("#watchlist-prompt-modal");
  if (!modal) return;
  watchlistPromptDraft = new Set(getWatchlist().slice(0, 10));
  if (!watchlistPromptDraft.size) DEFAULT_WATCHLIST_SYMBOLS.forEach((sym) => watchlistPromptDraft.add(sym));
  renderWatchlistPromptChips();
  modal.hidden = false;
  document.body.classList.add("methodology-modal-open");
}

function closeWatchlistPromptModal({ markSeen = true } = {}) {
  const modal = $("#watchlist-prompt-modal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("methodology-modal-open");
  if (markSeen) {
    try {
      sessionStorage.setItem(WATCHLIST_PROMPT_SEEN_KEY, "1");
    } catch (_) {}
  }
  syncDashChromeHeights();
}

function maybeOpenWatchlistPrompt() {
  try {
    if (sessionStorage.getItem(WATCHLIST_PROMPT_SEEN_KEY) === "1") return;
  } catch (_) {}
  openWatchlistPromptModal();
}

function setupWatchlistPromptModal() {
  const modal = $("#watchlist-prompt-modal");
  if (!modal || modal.dataset.bound === "true") return;
  modal.dataset.bound = "true";
  $("#ts-book-summary")?.addEventListener("click", () => openWatchlistPromptModal());
  modal.querySelectorAll("[data-close-watchlist-prompt]").forEach((el) => {
    el.addEventListener("click", () => closeWatchlistPromptModal());
  });
  $("#watchlist-prompt-save")?.addEventListener("click", () => {
    const symbols = [...watchlistPromptDraft];
    if (symbols.length < 3) return;
    setWatchlist(symbols);
    closeWatchlistPromptModal();
    refreshPolicyScopedViews();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) closeWatchlistPromptModal();
  });
}

function setupOnboardingModal() {
  const modal = $("#onboarding-modal");
  if (!modal || modal.dataset.bound === "true") return;
  modal.dataset.bound = "true";
  const close = () => closeOnboardingModal();
  modal.querySelectorAll("[data-close-onboarding]").forEach((el) => el.addEventListener("click", close));
  modal.querySelectorAll("[data-onboarding-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showView(btn.dataset.onboardingGo);
      close();
    });
  });
  $("#onboarding-finish")?.addEventListener("click", () => {
    close();
    if (isViewEnabled("thesis")) showView("thesis");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) close();
  });
  try {
    if (!localStorage.getItem(ONBOARDING_STORAGE_KEY) && !isOnboardingComplete()) {
      setTimeout(() => openOnboardingModal(), 900);
    }
  } catch (_) {}
}

function openOnboardingModal({ force = false } = {}) {
  const modal = $("#onboarding-modal");
  if (!modal) return;
  if (!force) {
    try {
      if (localStorage.getItem(ONBOARDING_STORAGE_KEY)) return;
    } catch (_) {}
  }
  modal.hidden = false;
  document.body.classList.add("methodology-modal-open");
}

function closeOnboardingModal() {
  const modal = $("#onboarding-modal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("methodology-modal-open");
  if ($("#onboarding-dismiss")?.checked) {
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
    } catch (_) {}
  }
}

function setupAppConfirmModal() {
  const modal = $("#app-confirm-modal");
  if (!modal || modal.dataset.bound === "true") return;
  modal.dataset.bound = "true";
  modal.querySelectorAll("[data-close-confirm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ok = btn.dataset.closeConfirm === "ok";
      closeAppConfirm(ok);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) closeAppConfirm(false);
  });
}

function openAppConfirm({ title = "Confirm", body = "", lines = [] } = {}) {
  const modal = $("#app-confirm-modal");
  const titleEl = $("#app-confirm-title");
  const bodyEl = $("#app-confirm-body");
  if (!modal || !bodyEl) return Promise.resolve(false);
  if (titleEl) titleEl.textContent = title;
  const text = lines.length ? lines.join("\n") : String(body || "");
  bodyEl.textContent = text;
  modal.hidden = false;
  document.body.classList.add("methodology-modal-open");
  return new Promise((resolve) => {
    appConfirmResolver = resolve;
  });
}

function closeAppConfirm(result) {
  const modal = $("#app-confirm-modal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("methodology-modal-open");
  if (appConfirmResolver) {
    appConfirmResolver(Boolean(result));
    appConfirmResolver = null;
  }
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


