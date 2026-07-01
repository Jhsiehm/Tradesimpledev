/* Extracted from app.js lines 9680-10081 */
// ── BYOK helpers ─────────────────────────────────────────────────────────────

const BYOK_STORAGE_KEY = "ts_byok_v1";

const BYOK_PROVIDERS = {
  anthropic: {
    label: "Anthropic (Claude)",
    placeholder: "sk-ant-...",
    defaultModel: "claude-sonnet-4-5",
    models: [
      { value: "claude-opus-4-5", label: "Claude Opus 4.5 (most capable)" },
      { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (fast, recommended)" },
      { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (cheapest)" }
    ]
  },
  openai: {
    label: "OpenAI (ChatGPT)",
    placeholder: "sk-...",
    defaultModel: "gpt-4o-mini",
    models: [
      { value: "gpt-4o", label: "GPT-4o (most capable)" },
      { value: "gpt-4o-mini", label: "GPT-4o mini (fast, recommended)" },
      { value: "gpt-4-turbo", label: "GPT-4 Turbo" }
    ]
  },
  gemini: {
    label: "Google Gemini",
    placeholder: "AIza...",
    defaultModel: "gemini-2.0-flash",
    models: [
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash (recommended)" },
      { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite (cheapest)" },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" }
    ]
  }
};

function loadByokFromStorage() {
  try {
    const raw = localStorage.getItem(BYOK_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved?.provider && saved?.key && BYOK_PROVIDERS[saved.provider]) {
      state.byok.provider = saved.provider;
      state.byok.key = saved.key;
      state.byok.model = saved.model || BYOK_PROVIDERS[saved.provider].defaultModel;
    }
  } catch {
    /* localStorage unavailable or malformed */
  }
}

function saveByokToStorage(provider, key, model) {
  try {
    if (!provider || !key) {
      localStorage.removeItem(BYOK_STORAGE_KEY);
      state.byok = { provider: null, key: null, model: null };
    } else {
      localStorage.setItem(BYOK_STORAGE_KEY, JSON.stringify({ provider, key, model }));
      state.byok = { provider, key, model };
    }
  } catch {
    /* ignore */
  }
}

function clearByok() {
  saveByokToStorage(null, null, null);
}

function byokIsConfigured() {
  return Boolean(state.byok.provider && state.byok.key);
}

async function callByokProvider(question, billContext) {
  const { provider, key, model } = state.byok;
  if (!provider || !key) throw new Error("No BYOK key configured.");

  const systemPrompt = `You are TradeSimple's research assistant. Explain how congressional bills, lobbying activity, federal contracts, and government policy might affect specific stocks in plain English for retail investors.
RULES: Write the main answer as 3-6 bullet points. Put each bullet on its own line starting with "- ". No markdown headers or paragraph blocks. Keep responses under 250 words. End with "Watch for:" on its own line followed by up to 3 bullets (each starting with "- ").
TONE: No dramatic language. Let numbers speak. Use "this suggests" not "this means". Disclose: Research signal only. Not financial advice.`;

  const billDigest = (window._policyBillsForByok || [])
    .map((b) => `${b.id}: ${b.title}; affected: ${(b.affected || []).join(", ")}; signal: ${b.signal}`)
    .join("\n");

  let userContent;
  if (billContext) {
    const bill = (window._policyBillsForByok || []).find((b) => b.id === billContext);
    if (bill) {
      userContent = `Bill focus (scenario model, not a forecast):\n${bill.id}: ${bill.title}; affected: ${(bill.affected || []).join(", ")}; signal: ${bill.signal}\n\n${question || "Explain why this bill matters for investors and which tickers are most exposed."}`;
    } else {
      userContent = question || `Explain bill ${billContext} for investors.`;
    }
  } else if (billDigest) {
    userContent = `Bill context (scenario model, not a forecast):\n${billDigest}\n\nUser question:\n${question}`;
  } else {
    userContent = question;
  }

  let text = "";

  if (provider === "anthropic") {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Anthropic API error ${resp.status}`);
    }
    const data = await resp.json();
    text = data.content?.[0]?.text || "";
  } else if (provider === "openai") {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenAI API error ${resp.status}`);
    }
    const data = await resp.json();
    text = data.choices?.[0]?.message?.content || "";
  } else if (provider === "gemini") {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: systemPrompt + "\n\n" + userContent }]
        }]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Gemini API error ${resp.status}`);
    }
    const data = await resp.json();
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  return parseByokResponse(text);
}

function parseByokResponse(text) {
  if (!text) return { prose: "No response returned.", bullets: [], watchFor: [] };
  const watchMatch = text.match(/Watch\s+for[:\s]+([\s\S]+)$/i);
  let main = text;
  if (watchMatch) main = text.slice(0, watchMatch.index).trim();
  const watchFor = watchMatch ? parseAiBulletItems(watchMatch[1]).slice(0, 3) : [];
  const bullets = parseAiBulletItems(main);
  const prose = bullets.length ? bullets.join("\n") : main.trim();
  return { prose, bullets, watchFor };
}

window._policyBillsForByok = [];

function paperOrderPreviewLines() {
  const sym = normalizeWatchSymbol($("#order-symbol")?.value || "");
  const qty = Number($("#order-qty")?.value || 0);
  const side = String($("#order-side")?.value || "buy");
  if (!sym || !Number.isFinite(qty) || qty <= 0) return null;
  const quote = quoteFor(sym);
  const price = Number(quote?.price || 0);
  const meta = paperAccountMeta(state.account);
  const cash = Number(meta.cash ?? meta.buyingPower ?? PAPER_STARTING_CASH);
  const equity = paperEquity(state.account) || PAPER_STARTING_CASH;
  const estCost = price > 0 ? price * qty : 0;
  const position = (state.account?.positions || []).find((p) => normalizeWatchSymbol(p.symbol) === sym);
  const heldQty = Number(position?.qty || 0);
  const heldValue = heldQty * (Number(position?.price || price) || price);
  const afterCash = side === "buy" ? cash - estCost : cash + estCost;
  const afterValue = side === "buy" ? heldValue + estCost : Math.max(0, heldValue - estCost);
  const positionPct = equity > 0 && estCost > 0 ? (afterValue / equity) * 100 : 0;
  return {
    sym,
    qty,
    side,
    price,
    cash,
    estCost,
    afterCash,
    positionPct,
    hasQuote: price > 0
  };
}

function renderPaperOrderPreview() {
  const el = $("#paper-order-preview");
  if (!el) return;
  const data = paperOrderPreviewLines();
  if (!data) {
    el.innerHTML = `<span class="paper-order-preview-label">Order preview</span><p class="paper-order-preview-copy muted">Enter a symbol and quantity to see cash impact.</p>`;
    return;
  }
  const sideLbl = data.side === "buy" ? "Buy" : "Sell";
  const priceLine = data.hasQuote
    ? `Est. ${money(data.estCost)} at ${money(data.price)}`
    : "Price unavailable — order may reject without a live quote";
  const cashLine = data.side === "buy"
    ? `Cash after fill: ${money(Math.max(0, data.afterCash))} (now ${money(data.cash)})`
    : `Cash after fill: ${money(data.afterCash)} (now ${money(data.cash)})`;
  const pctLine = data.hasQuote && data.side === "buy"
    ? `Position would be ~${fmt(data.positionPct)}% of portfolio`
    : "";
  el.innerHTML = `
    <span class="paper-order-preview-label">Paper mode · simulated only</span>
    <p class="paper-order-preview-copy"><strong>${escapeHtml(sideLbl)} ${fmt(data.qty)} ${escapeHtml(data.sym)}</strong> — ${escapeHtml(priceLine)}</p>
    <p class="paper-order-preview-copy muted">${escapeHtml(cashLine)}${pctLine ? ` · ${escapeHtml(pctLine)}` : ""}</p>`;
}

function setOrderStatus(message, { tone = "neutral" } = {}) {
  const el = $("#order-result");
  if (!el) return;
  el.className = `order-status-line order-status-line--${tone}`;
  if (typeof message === "string" && message.includes("<")) el.innerHTML = message;
  else el.textContent = message;
}

function highlightOrderPosition(symbol) {
  const sym = normalizeWatchSymbol(symbol);
  if (!sym) return;
  state.lastOrderSymbol = sym;
  renderAccount();
  const row = document.querySelector(`#paper-positions-body tr.position-row-highlight`);
  row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  setTimeout(() => {
    if (state.lastOrderSymbol === sym) {
      state.lastOrderSymbol = null;
      renderAccount();
    }
  }, 4000);
}

function setupPaperOrderPreview() {
  const form = $("#order-form");
  if (!form || form.dataset.previewReady === "true") return;
  form.dataset.previewReady = "true";
  const refresh = () => renderPaperOrderPreview();
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  $("#order-symbol")?.addEventListener("change", refresh);
  refresh();
}

window.__tsByokStatusLabel = function __tsByokStatusLabel() {
  if (byokIsConfigured()) {
    const provider = BYOK_PROVIDERS[state.byok.provider]?.label || state.byok.provider || "Provider";
    return `Personal key saved · ${provider}`;
  }
  return "No personal key saved";
};

function setupForms() {
  setupPaperOrderPreview();
  $("#order-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const preview = paperOrderPreviewLines();
    if (!preview) {
      setOrderStatus("Enter a valid symbol and quantity.", { tone: "error" });
      return;
    }
    const sideLbl = preview.side === "buy" ? "Buy" : "Sell";
    const confirmLines = [
      "Paper mode — this order uses simulated cash only.",
      `${sideLbl} ${preview.qty} ${preview.sym}${preview.hasQuote ? ` at ~${money(preview.price)}` : ""}`,
      preview.hasQuote ? `Estimated cost: ${money(preview.estCost)}` : "Live quote unavailable — proceed anyway?",
      `Cash after fill: ~${money(preview.afterCash)}`,
      preview.side === "buy" && preview.hasQuote ? `Position ~${fmt(preview.positionPct)}% of portfolio` : ""
    ].filter(Boolean);
    const ok = await openAppConfirm({
      title: "Confirm paper order",
      lines: confirmLines
    });
    if (!ok) {
      setOrderStatus("Order cancelled.", { tone: "neutral" });
      return;
    }
    const form = new FormData(event.currentTarget);
    setOrderStatus("Submitting paper order…", { tone: "pending" });
    try {
      const response = await fetchJson("/api/trading/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: form.get("symbol"),
          qty: form.get("qty"),
          side: form.get("side"),
          ...(state.pendingThesisId ? { thesisId: state.pendingThesisId } : {})
        })
      });
      state.account = response;
      renderAccount();
      renderPaperOrderPreview();
      if (state.pendingThesisId) {
        void thesisRefreshSavedOutcome();
        state.pendingThesisId = null;
      }
      const orderSym = normalizeWatchSymbol(response?.order?.symbol || form.get("symbol"));
      setOrderStatus(`${orderSuccessMessage(response)} New buying power: ${money(response.account.buyingPower)}.`, { tone: "success" });
      highlightOrderPosition(orderSym);
    } catch (error) {
      let msg = "Paper order rejected. Check the symbol and quantity.";
      try {
        const m = /^400:\s*(.+)$/s.exec(error.message || "");
        if (m) {
          const body = JSON.parse(m[1]);
          if (body.error === "no_position" || body.error === "insufficient_shares") {
            msg = body.message || msg;
          }
        }
      } catch (_) {
        /* keep default */
      }
      if (msg === "Paper order rejected. Check the symbol and quantity." && error.message.includes("insufficient")) {
        msg = "Paper order rejected: not enough cash or shares for that order.";
      }
      setOrderStatus(msg, { tone: "error" });
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
    const question = $("#research-question")?.value.trim();
    if (!question) return;
    appendMessage(question, "user");
    if ($("#research-question")) $("#research-question").value = "";

    if (byokIsConfigured()) {
      appendMessage("Analyzing with your AI key…", "ai", true);
      try {
        const response = await callByokProvider(question, null);
        document.querySelector("[data-pending-message]")?.remove();
        appendResearchAiMessage(response.prose || "", response.watchFor || [], response.bullets || []);
      } catch (error) {
        document.querySelector("[data-pending-message]")?.remove();
        const msg = error.message || "Request failed.";
        appendMessage(`AI error: ${msg}. Check your key in AI Settings.`, "ai");
        renderByokStatus();
      }
      return;
    }

    if (state.config?.data?.anthropic) {
      appendMessage("Analyzing policy signal...", "ai", true);
      try {
        const response = await fetchJson("/api/research/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question })
        });
        document.querySelector("[data-pending-message]")?.remove();
        if (response.error) appendMessage(response.error, "ai");
        else appendResearchAiMessage(response.prose || "", response.watchFor || [], response.bullets || []);
      } catch (error) {
        document.querySelector("[data-pending-message]")?.remove();
        appendMessage(error.message || "Request failed.", "ai");
      }
      return;
    }

    appendMessage(
      "No AI key configured. Add your own API key using the AI Settings button above, or ask the app owner to set ANTHROPIC_API_KEY on the server.",
      "ai"
    );
    renderByokPanel();
  });

  loadByokFromStorage();
  renderByokStatus();
}

