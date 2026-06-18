/**
 * BriefShell — shared guided walkthrough for public briefs and dashboard views.
 * Vanilla IIFE; zero dependencies.
 */
(function (global) {
  const DEFAULT_LABELS = {
    guided: "Guided",
    full: "Full brief",
    back: "← Back",
    next: "Continue →",
    lastNext: "Open dashboard",
    stepCount: (cur, total) => `Step ${cur} of ${total}`,
    sectionLine: (cur, total, ref) => String(ref || "").trim() || `Brief part ${cur} of ${total}`,
  };

  const SWIPE_THRESHOLD = 48;

  function storedMode(storageKey, fallback = "guided") {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "full" || stored === "guided") return stored;
    } catch (_) {}
    return fallback === "full" ? "full" : "guided";
  }

  function persistMode(storageKey, mode) {
    const normalized = mode === "full" ? "full" : "guided";
    try {
      localStorage.setItem(storageKey, normalized);
    } catch (_) {}
    return normalized;
  }

  function modeToggleHtml(activeMode, labels = {}) {
    const guided = labels.guided || DEFAULT_LABELS.guided;
    const full = labels.full || DEFAULT_LABELS.full;
    const mode = activeMode === "full" ? "full" : "guided";
    return `
      <div class="bill-mode-toggle" role="group" aria-label="Brief view mode">
        <button type="button" data-brief-mode="guided" class="bill-mode-btn${mode === "guided" ? " is-active" : ""}" aria-pressed="${mode === "guided"}">${guided}</button>
        <button type="button" data-brief-mode="full" class="bill-mode-btn${mode === "full" ? " is-active" : ""}" aria-pressed="${mode === "full"}">${full}</button>
      </div>`;
  }

  function stepTitle(step) {
    return step.title || step.short || step.id || "Step";
  }

  function stepRef(step) {
    return step.sectionRef || step.ref || stepTitle(step);
  }

  function resolveStepHtml(step, container, ctx) {
    if (typeof step.render === "function") {
      if (container) {
        container.innerHTML = "";
        step.render(container, ctx || {});
        return container.innerHTML;
      }
      const host = document.createElement("div");
      step.render(host, ctx || {});
      return host.innerHTML;
    }
    return step.html || "";
  }

  function stepInnerHtml(step, index, total, escapeHtml, labels) {
    if (!step) return "";
    const esc = escapeHtml || ((v) => String(v ?? ""));
    const line =
      typeof labels?.sectionLine === "function"
        ? labels.sectionLine(index + 1, total, stepRef(step))
        : DEFAULT_LABELS.sectionLine(index + 1, total, stepRef(step));
    const body = step.html != null ? step.html : "";
    return `
      <div class="bill-step" data-step-id="${esc(step.id)}">
        <p class="bill-step-ref mono">${esc(line)}</p>
        ${body}
      </div>`;
  }

  function renderToc(steps, stepIndex, escapeHtml) {
    const esc = escapeHtml || ((v) => String(v ?? ""));
    return steps
      .map((s, i) => {
        const cls = `${i === stepIndex ? "is-current" : ""}${i < stepIndex ? " is-done" : ""}`.trim();
        return `<li><button type="button" data-goto-step="${i}" class="${cls}" aria-current="${i === stepIndex ? "step" : "false"}">
          <span class="bill-step-num mono">${String(i + 1).padStart(2, "0")}</span><span class="bill-step-name">${esc(stepTitle(s))}</span>
        </button></li>`;
      })
      .join("");
  }

  function renderGuidedArticle(opts) {
    const {
      mode = "guided",
      steps = [],
      stepIndex = 0,
      prefix = "brief",
      escapeHtml,
      classifyHtml = "",
      headerHtml = "",
      metaHtml = "",
      footerHtml = "",
      shellClass = "bill-guided stock-card-shell",
      labels = {},
      showModeToggle = true
    } = opts;
    const esc = escapeHtml || ((v) => String(v ?? ""));
    const total = steps.length;
    const countLabel =
      typeof labels.stepCount === "function"
        ? labels.stepCount(stepIndex + 1, total)
        : DEFAULT_LABELS.stepCount(stepIndex + 1, total);
    const step = steps[stepIndex];
    return `
      <article class="${shellClass}" data-brief-shell="${esc(prefix)}">
        ${classifyHtml}
        ${showModeToggle || headerHtml
          ? `<header class="bill-guided-top">${showModeToggle ? modeToggleHtml(mode, labels) : ""}${headerHtml}</header>`
          : ""}
        ${metaHtml}
        <div class="bill-guided-bar">
          <nav class="bill-step-toc-wrap" aria-label="Brief steps">
            <ol class="bill-step-toc" id="${esc(prefix)}-step-toc">
              ${renderToc(steps, stepIndex, esc)}
            </ol>
          </nav>
          <span class="bill-step-count mono" id="${esc(prefix)}-step-count" aria-live="polite">${esc(countLabel)}</span>
        </div>
        <section class="bill-step-viewport" id="${esc(prefix)}-step-viewport" tabindex="0" aria-label="Current step">
          ${stepInnerHtml(step, stepIndex, total, esc, labels)}
        </section>
        <div class="bill-step-controls">
          <button type="button" class="card-button ghost dossier-nav-btn" id="${esc(prefix)}-step-back">${esc(labels.back || DEFAULT_LABELS.back)}</button>
          <button type="button" class="card-button bill-next-btn dossier-nav-btn" id="${esc(prefix)}-step-next">${esc(
            stepIndex >= total - 1 ? labels.lastNext || DEFAULT_LABELS.lastNext : labels.next || DEFAULT_LABELS.next
          )}</button>
        </div>
        ${footerHtml}
      </article>`;
  }

  function id(prefix, part) {
    return `${prefix}-${part}`;
  }

  function syncControls(instance) {
    const { prefix, getSteps, getStepIndex, labels = {} } = instance;
    const steps = getSteps();
    const stepIndex = getStepIndex();
    const back = document.getElementById(id(prefix, "step-back"));
    const next = document.getElementById(id(prefix, "step-next"));
    const count = document.getElementById(id(prefix, "step-count"));
    const last = stepIndex >= steps.length - 1;
    if (back) back.disabled = stepIndex === 0;
    if (next) {
      next.textContent = last
        ? labels.lastNext || DEFAULT_LABELS.lastNext
        : labels.next || DEFAULT_LABELS.next;
    }
    if (count) {
      const countLabel =
        typeof labels.stepCount === "function"
          ? labels.stepCount(stepIndex + 1, steps.length)
          : DEFAULT_LABELS.stepCount(stepIndex + 1, steps.length);
      count.textContent = countLabel;
    }
    document.querySelectorAll(`#${id(prefix, "step-toc")} [data-goto-step]`).forEach((btn) => {
      const i = Number(btn.dataset.gotoStep);
      btn.classList.toggle("is-current", i === stepIndex);
      btn.classList.toggle("is-done", i < stepIndex);
      btn.setAttribute("aria-current", i === stepIndex ? "step" : "false");
    });
  }

  function goToStep(instance, index, dir) {
    const steps = instance.getSteps();
    const stepIndex = instance.getStepIndex();
    if (index < 0 || index >= steps.length || index === stepIndex) return;
    instance.setStepIndex(index);
    const viewport = document.getElementById(id(instance.prefix, "step-viewport"));
    if (!viewport) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = steps[index];
    const swap = () => {
      if (typeof step.render === "function") {
        viewport.innerHTML = `<div class="bill-step" data-step-id="${instance.escapeHtml(step.id)}"><p class="bill-step-ref mono">${instance.escapeHtml(
          typeof instance.labels?.sectionLine === "function"
            ? instance.labels.sectionLine(index + 1, steps.length, stepRef(step))
            : DEFAULT_LABELS.sectionLine(index + 1, steps.length, stepRef(step))
        )}</p><div class="brief-step-body"></div></div>`;
        const body = viewport.querySelector(".brief-step-body");
        step.render(body, instance.ctx || {});
      } else {
        viewport.innerHTML = stepInnerHtml(step, index, steps.length, instance.escapeHtml, instance.labels);
      }
      syncControls(instance);
      if (typeof instance.onStepChange === "function") instance.onStepChange(index, instance);
      if (!reduceMotion) {
        viewport.dataset.dir = dir > 0 ? "fwd" : "back";
        viewport.classList.remove("is-leaving");
        viewport.classList.add("is-entering");
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => viewport.classList.remove("is-entering"));
        });
      }
    };
    if (reduceMotion) {
      swap();
    } else {
      viewport.dataset.dir = dir > 0 ? "fwd" : "back";
      viewport.classList.add("is-leaving");
      window.setTimeout(swap, 130);
    }
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  function attachWalkthrough(instance) {
    if (instance._wired) detachWalkthrough(instance);
    instance._wired = true;

    const viewport = document.getElementById(id(instance.prefix, "step-viewport"));
    const back = document.getElementById(id(instance.prefix, "step-back"));
    const next = document.getElementById(id(instance.prefix, "step-next"));
    if (!viewport || !back || !next) return instance;

    const onBack = () => goToStep(instance, instance.getStepIndex() - 1, -1);
    const onNext = () => {
      const steps = instance.getSteps();
      const stepIndex = instance.getStepIndex();
      if (stepIndex >= steps.length - 1) {
        if (typeof instance.onLastStepNext === "function") instance.onLastStepNext(instance);
        return;
      }
      goToStep(instance, stepIndex + 1, 1);
    };

    instance._handlers = { onBack, onNext };
    back.addEventListener("click", onBack);
    next.addEventListener("click", onNext);

    instance._tocHandler = (e) => {
      const btn = e.target.closest("[data-goto-step]");
      if (!btn || !btn.closest(`#${id(instance.prefix, "step-toc")}`)) return;
      const target = Number(btn.dataset.gotoStep);
      if (Number.isFinite(target)) goToStep(instance, target, target > instance.getStepIndex() ? 1 : -1);
    };
    document.addEventListener("click", instance._tocHandler);

    instance._keyHandler = (e) => {
      if (typeof instance.isActive === "function" && !instance.isActive()) return;
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        onNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onBack();
      }
    };
    document.addEventListener("keydown", instance._keyHandler);

    let touchX = null;
    let touchY = null;
    instance._touchStart = (e) => {
      touchX = e.touches[0]?.clientX ?? null;
      touchY = e.touches[0]?.clientY ?? null;
    };
    instance._touchEnd = (e) => {
      if (touchX == null || touchY == null) return;
      const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
      const dy = (e.changedTouches[0]?.clientY ?? touchY) - touchY;
      touchX = null;
      touchY = null;
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      goToStep(instance, instance.getStepIndex() + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    };
    viewport.addEventListener("touchstart", instance._touchStart, { passive: true });
    viewport.addEventListener("touchend", instance._touchEnd, { passive: true });

    syncControls(instance);
    return instance;
  }

  function detachWalkthrough(instance) {
    if (!instance?._wired) return;
    const viewport = document.getElementById(id(instance.prefix, "step-viewport"));
    const back = document.getElementById(id(instance.prefix, "step-back"));
    const next = document.getElementById(id(instance.prefix, "step-next"));
    if (back && instance._handlers?.onBack) back.removeEventListener("click", instance._handlers.onBack);
    if (next && instance._handlers?.onNext) next.removeEventListener("click", instance._handlers.onNext);
    if (instance._tocHandler) document.removeEventListener("click", instance._tocHandler);
    if (instance._keyHandler) document.removeEventListener("keydown", instance._keyHandler);
    if (viewport) {
      if (instance._touchStart) viewport.removeEventListener("touchstart", instance._touchStart);
      if (instance._touchEnd) viewport.removeEventListener("touchend", instance._touchEnd);
    }
    instance._wired = false;
  }

  function bindModeToggle(rootEl, storageKey, onChange, getMode) {
    if (!rootEl) return;
    rootEl.querySelectorAll("[data-brief-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.briefMode;
        if (mode === getMode()) return;
        const next = persistMode(storageKey, mode);
        if (typeof onChange === "function") onChange(next);
      });
    });
  }

  /**
   * init — primary entry for card briefs and dashboard guided views.
   * opts: { rootEl, steps, storageKey, renderFull, labels?, onStepChange?, prefix?, escapeHtml?, ... }
   */
  function init(opts) {
    const instance = {
      prefix: opts.prefix || "brief",
      storageKey: opts.storageKey || "",
      labels: opts.labels || {},
      escapeHtml: opts.escapeHtml || ((v) => String(v ?? "")),
      getMode: opts.getMode || (() => storedMode(opts.storageKey)),
      setMode: opts.setMode || ((m) => persistMode(opts.storageKey, m)),
      getSteps: opts.getSteps || (() => opts.steps || []),
      getStepIndex: opts.getStepIndex || (() => opts.stepIndex || 0),
      setStepIndex: opts.setStepIndex || ((i) => {
        if (opts.stepIndex != null) opts.stepIndex = i;
      }),
      onStepChange: opts.onStepChange,
      onLastStepNext: opts.onLastStepNext,
      isActive: opts.isActive || (() => true),
      ctx: opts.ctx || {},
      renderFull: opts.renderFull,
      renderGuided: opts.renderGuided,
      rootEl: opts.rootEl
    };

    instance.render = function renderCurrent() {
      const mode = instance.getMode();
      const root = instance.rootEl;
      if (!root) return;
      if (mode === "full" && typeof instance.renderFull === "function") {
        detachWalkthrough(instance);
        root.innerHTML = instance.renderFull(instance.ctx);
        bindModeToggle(root, instance.storageKey, (m) => {
          instance.setMode(m);
          instance.setStepIndex(0);
          instance.render();
          window.scrollTo({ top: 0 });
        }, instance.getMode);
        return;
      }
      if (typeof instance.renderGuided === "function") {
        root.innerHTML = instance.renderGuided(instance.ctx);
      }
      bindModeToggle(root, instance.storageKey, (m) => {
        instance.setMode(m);
        instance.setStepIndex(0);
        instance.render();
        window.scrollTo({ top: 0 });
      }, instance.getMode);
      attachWalkthrough(instance);
      if (typeof opts.onMount === "function") opts.onMount(instance);
    };

    instance.render();
    return instance;
  }

  function stockPageUrl(symbol) {
    const sym = String(symbol || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    return sym ? `/stock/${encodeURIComponent(sym)}` : "/dashboard?view=analysis";
  }

  function lobbyPageUrl(filingId) {
    const id = String(filingId || "").trim();
    return id ? `/lobby/${encodeURIComponent(id)}` : "/dashboard?view=lobbying";
  }

  function fecPageUrl(clusterKey) {
    const key = String(clusterKey || "").trim();
    return key ? `/fec/${encodeURIComponent(key)}` : "/dashboard?view=fec";
  }

  function traceTickerCtaHtml(symbol, escapeHtml, opts = {}) {
    const esc = escapeHtml || ((value) => String(value ?? ""));
    const sym = String(symbol || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    if (!sym) return "";
    const label = opts.generic ? "Trace this ticker" : `Trace ${sym}`;
    return `<a class="brief-trace-cta" href="${esc(stockPageUrl(sym))}">${esc(label)} →</a>`;
  }

  function freshnessChipHtml(freshness, escapeHtml) {
    if (!freshness?.level) return "";
    const esc = escapeHtml || ((value) => String(value ?? ""));
    const level = freshness.level === "verified" || freshness.level === "stale" ? freshness.level : "modeled";
    const label = freshness.label || (level === "verified" ? "Verified" : level === "stale" ? "Stale" : "Modeled");
    const detail = freshness.detail || "";
    const sources = freshness.sourcesLine || "";
    const title = [label, detail, sources].filter(Boolean).join(" · ");
    return `
      <details class="freshness-chip freshness-chip--${esc(level)}">
        <summary class="freshness-chip-summary" title="${esc(title)}">
          <span class="freshness-chip-dot" aria-hidden="true"></span>
          <span class="freshness-chip-label">${esc(label)}</span>
        </summary>
        ${detail ? `<p class="freshness-chip-detail muted">${esc(detail)}</p>` : ""}
        ${sources ? `<p class="freshness-chip-sources mono">${esc(sources)}</p>` : ""}
      </details>`;
  }

  /** Parse AI prose or markdown-style bullets into plain strings (3–6 items). */
  function parseAiBulletItems(text) {
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

  function aiAnalysisBulletsHtml(text, escapeHtmlFn) {
    const esc = typeof escapeHtmlFn === "function" ? escapeHtmlFn : (value) => String(value ?? "");
    const items = parseAiBulletItems(text);
    if (!items.length) return `<p class="ai-analysis-prose">${esc(text)}</p>`;
    return `<ul class="ai-analysis-bullets">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
  }

  global.BriefShell = {
    storedMode,
    persistMode,
    modeToggleHtml,
    stepInnerHtml,
    renderToc,
    renderGuidedArticle,
    attachWalkthrough,
    detachWalkthrough,
    syncControls,
    goToStep,
    bindModeToggle,
    resolveStepHtml,
    stockPageUrl,
    lobbyPageUrl,
    fecPageUrl,
    traceTickerCtaHtml,
    freshnessChipHtml,
    parseAiBulletItems,
    aiAnalysisBulletsHtml,
    init
  };
})(typeof window !== "undefined" ? window : globalThis);
