import { initLocale } from "./i18n";
import { initTheme } from "./theme";
import { getElement, initCopyButtons } from "./utils";

initTheme();
initLocale();
initModelExplorer();
initProviderPings();
initCopyButtons();

function initModelExplorer() {
  const tbody = getElement<HTMLTableSectionElement>("model-tbody");
  if (!tbody) return;

  const allRows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>("tr[data-model-row]"));
  const searchInput = getElement<HTMLInputElement>("model-search");
  const countEl = getElement("model-count");
  const noResultsRow = getElement<HTMLTableRowElement>("no-results-row");

  let activeTier = "All";
  let query = "";

  function renderModels() {
    const normalizedQuery = query.toLowerCase();
    let visibleCount = 0;

    for (const row of allRows) {
      const matchesTier = activeTier === "All" || row.dataset.tier === activeTier;
      const matchesQuery = !normalizedQuery || (row.dataset.search ?? "").includes(normalizedQuery);
      const visible = matchesTier && matchesQuery;
      row.hidden = !visible;
      if (visible) visibleCount++;
    }

    if (countEl) countEl.textContent = `${visibleCount}/${allRows.length}`;
    if (noResultsRow) noResultsRow.hidden = visibleCount !== 0;
  }

  searchInput?.addEventListener("input", () => {
    query = searchInput.value;
    renderModels();
  });

  getElement("tier-filters")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest(".tier-btn") as HTMLElement | null;
    if (!button) return;

    activeTier = button.dataset.tier || "All";
    document.querySelectorAll(".tier-btn").forEach((el) => el.classList.remove("active"));
    button.classList.add("active");
    renderModels();
  });

  renderModels();
}

function ensureDialCols(element: HTMLElement, count: number): HTMLElement[] {
  const existing = element.querySelectorAll<HTMLElement>(".dial-col");
  if (existing.length === count) return Array.from(existing);

  element.innerHTML = "";
  element.style.cssText = "display:inline-flex;align-items:center;";
  const cols: HTMLElement[] = [];

  for (let i = 0; i < count; i++) {
    const col = document.createElement("span");
    col.className = "dial-col";
    const inner = document.createElement("span");
    inner.className = "dial-inner";
    for (let digit = 0; digit <= 9; digit++) {
      const span = document.createElement("span");
      span.textContent = String(digit);
      inner.appendChild(span);
    }
    col.appendChild(inner);
    element.appendChild(col);
    cols.push(col);
  }

  const suffix = document.createElement("span");
  suffix.style.marginLeft = "1px";
  suffix.textContent = "ms";
  element.appendChild(suffix);
  return cols;
}

function updateDial(element: HTMLElement, targetMs: number) {
  const digits = String(targetMs);
  const cols = ensureDialCols(element, digits.length);

  digits.split("").forEach((digit, index) => {
    const inner = cols[index]?.querySelector<HTMLElement>(".dial-inner");
    if (inner) inner.style.transform = `translateY(-${parseInt(digit, 10)}em)`;
  });
}

async function pingProvider(url: string, dotEl: HTMLElement, pingEl: HTMLElement) {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { method: "GET", mode: "cors" });
    const ms = Math.round(performance.now() - startedAt);
    if (!response.ok) {
      dotEl.className = "status-dot slow";
      pingEl.textContent = `${response.status}`;
      return;
    }

    dotEl.className = "status-dot up";
    updateDial(pingEl, ms);
    setInterval(() => {
      updateDial(pingEl, Math.max(50, ms + Math.floor((Math.random() - 0.5) * 80)));
    }, 5000);
  } catch {
    dotEl.className = "status-dot down";
    pingEl.textContent = "unreachable";
  }
}

function simulateNimPing() {
  const dot = getElement("nim-status");
  const ping = getElement("nim-ping");
  if (!dot || !ping) return;

  const statusDot = dot;
  const pingValue = ping;
  function update() {
    statusDot.className = "status-dot up";
    updateDial(pingValue, 100 + Math.floor(Math.random() * 70));
  }

  setTimeout(() => {
    update();
    setInterval(update, 5000);
  }, 500 + Math.random() * 300);
}

function initProviderPings() {
  simulateNimPing();

  const openRouterStatus = getElement("or-status");
  const openRouterPing = getElement("or-ping");
  if (openRouterStatus && openRouterPing) {
    pingProvider("https://openrouter.ai/api/v1/models", openRouterStatus, openRouterPing);
  }
}
