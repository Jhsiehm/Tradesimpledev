/* Extracted from app.js lines 11158-11220 */
// ── Skeleton loaders ──────────────────────────────────────────────────────────
// Call showSkeleton(containerSelector, rowCount) before a data fetch,
// clearSkeleton(containerSelector) once the real content renders.
function skeletonRows(n, type) {
  if (type === "card") {
    return Array.from({ length: n }, () =>
      `<div class="skeleton-wrap"><div class="sk-block"></div><div class="sk-line wide"></div><div class="sk-line med"></div></div>`
    ).join("");
  }
  if (type === "row") {
    return Array.from({ length: n }, () =>
      `<div class="sk-row skeleton-wrap"><div class="sk-avatar sk-line"></div><div class="sk-col"><div class="sk-line wide"></div><div class="sk-line short"></div></div></div>`
    ).join("");
  }
  return Array.from({ length: n }, () =>
    `<div class="skeleton-wrap"><div class="sk-line wide"></div><div class="sk-line med"></div><div class="sk-line short"></div></div>`
  ).join("");
}
function showSkeleton(selector, rowCount = 4, type = "default") {
  const el = $(selector);
  if (!el || el.querySelector(".skeleton-wrap")) return; // already showing
  const placeholder = document.createElement("div");
  placeholder.dataset.skeleton = "true";
  placeholder.innerHTML = skeletonRows(rowCount, type);
  el.prepend(placeholder);
}
function clearSkeleton(selector) {
  $(selector)?.querySelector("[data-skeleton]")?.remove();
}

function setupLegisCardDelegation() {
  document.addEventListener("click", (e) => {
    const askBtn = e.target.closest("[data-ask-why]");
    if (askBtn) { askWhyForBill(askBtn.dataset.askWhy); return; }
    const methodBtn = e.target.closest("[data-methodology-bill]");
    if (methodBtn) { openMethodologyModal({ billId: methodBtn.dataset.methodologyBill }); return; }
    const viewBtn = e.target.closest("[data-show-view]");
    if (viewBtn) { showView(viewBtn.dataset.showView); return; }
  });
}

function setupSignalChainInteraction() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#signal-chain-more");
    if (!btn) return;
    _signalFeedExpanded = true;
    renderSignalFeed();
  });
}

function setupResearchDrawer() {
  if (!isFeatureEnabled("AI_RESEARCH_ENABLED")) return;
  const btn = document.querySelector(".research-drawer-btn");
  const drawer = globalResearchDrawerEl();
  const close = drawer?.querySelector(".research-drawer-close");
  if (!btn || !drawer || !close) return;
  btn.addEventListener("click", () => drawer.classList.toggle("open"));
  close.addEventListener("click", () => drawer.classList.remove("open"));
  document.querySelector(".byok-settings-btn")?.addEventListener("click", toggleByokPanel);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer.classList.contains("open")) drawer.classList.remove("open");
  });
}
