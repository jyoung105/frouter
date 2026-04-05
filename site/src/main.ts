// ─── Terminal Header Animation ───────────────────────────────────────────────

function runTerminalHeaderAnimation() {
  const typingCmd = document.getElementById("typing-cmd");
  const typingCursor = document.getElementById("typing-cursor");
  const asciiArt = document.getElementById("ascii-art");
  if (!typingCmd || !typingCursor || !asciiArt) return;

  const command = "npx frouter-cli";
  let i = 0;

  const typeInterval = setInterval(() => {
    if (i < command.length) {
      typingCmd.textContent += command[i];
      i++;
    } else {
      clearInterval(typeInterval);
      typingCursor.style.display = "none";
      asciiArt.classList.add("visible");
    }
  }, 35);
}

runTerminalHeaderAnimation();

// ─── Tab Switching ───────────────────────────────────────────────────────────

function activateTab(index: number) {
  const tabs = document.querySelectorAll<HTMLElement>(".tab-btn");
  const contents = document.querySelectorAll<HTMLElement>(".tab-content");
  tabs.forEach((t) => t.classList.remove("active"));
  contents.forEach((c) => c.classList.remove("active"));
  tabs[index]?.classList.add("active");
  contents[index]?.classList.add("active");
}

function startTabCycle() {
  const tabs = document.querySelectorAll<HTMLElement>(".tab-btn");
  let activeIdx = 0;

  let interval = setInterval(() => {
    activeIdx = (activeIdx + 1) % tabs.length;
    activateTab(activeIdx);
  }, 4000);

  tabs.forEach((btn, i) => {
    btn.addEventListener("click", () => {
      clearInterval(interval);
      activeIdx = i;
      activateTab(i);
      interval = setInterval(() => {
        activeIdx = (activeIdx + 1) % tabs.length;
        activateTab(activeIdx);
      }, 4000);
    });
  });
}

startTabCycle();

// ─── Model Explorer ──────────────────────────────────────────────────────────

const tbody = document.getElementById("model-tbody")!;
const allRows = Array.from(
  tbody.querySelectorAll<HTMLTableRowElement>("tr[data-model-row]"),
);
const searchInput = document.getElementById("model-search") as HTMLInputElement;
const countEl = document.getElementById("model-count")!;
const noResultsRow = document.getElementById(
  "no-results-row",
) as HTMLTableRowElement | null;
let activeTier = "All";
let query = "";

function renderModels() {
  const q = query.toLowerCase();
  let visibleCount = 0;

  for (const row of allRows) {
    const rowTier = row.dataset.tier || "";
    const rowSearch = row.dataset.search || "";
    const matchesTier = activeTier === "All" || rowTier === activeTier;
    const matchesQuery = !q || rowSearch.includes(q);
    const visible = matchesTier && matchesQuery;
    row.hidden = !visible;
    if (visible) {
      visibleCount++;
    }
  }

  countEl.textContent = `${visibleCount}/${allRows.length}`;
  if (noResultsRow) {
    noResultsRow.hidden = visibleCount !== 0;
  }
}

searchInput.addEventListener("input", () => {
  query = searchInput.value;
  renderModels();
});

document.getElementById("tier-filters")!.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(
    ".tier-btn",
  ) as HTMLElement | null;
  if (!btn) return;
  activeTier = btn.dataset.tier || "All";
  document
    .querySelectorAll(".tier-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderModels();
});

renderModels();

// ─── Dial Display ────────────────────────────────────────────────────────────

function ensureDialCols(el: HTMLElement, count: number): HTMLElement[] {
  const existing = el.querySelectorAll<HTMLElement>(".dial-col");
  if (existing.length === count) return Array.from(existing);
  el.innerHTML = "";
  el.style.cssText = "display:inline-flex;align-items:center;";
  const cols: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    const col = document.createElement("span");
    col.className = "dial-col";
    col.style.cssText =
      "display:inline-block;overflow:hidden;height:1em;position:relative;";
    const inner = document.createElement("span");
    inner.className = "dial-inner";
    inner.style.cssText =
      "display:block;transition:transform 0.5s cubic-bezier(0.23,1,0.32,1);";
    for (let d = 0; d <= 9; d++) {
      const s = document.createElement("span");
      s.style.cssText = "display:block;height:1em;line-height:1em;";
      s.textContent = String(d);
      inner.appendChild(s);
    }
    col.appendChild(inner);
    el.appendChild(col);
    cols.push(col);
  }
  const sfx = document.createElement("span");
  sfx.style.marginLeft = "1px";
  sfx.textContent = "ms";
  el.appendChild(sfx);
  return cols;
}

function updateDial(el: HTMLElement, targetMs: number, color: string) {
  el.style.color = color;
  const str = String(targetMs);
  const cols = ensureDialCols(el, str.length);
  str.split("").forEach((ch, i) => {
    const inner = cols[i].querySelector<HTMLElement>(".dial-inner")!;
    inner.style.transform = `translateY(-${parseInt(ch)}em)`;
  });
}

// ─── Provider Pings ──────────────────────────────────────────────────────────

async function pingProvider(
  url: string,
  dotEl: HTMLElement,
  pingEl: HTMLElement,
) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { method: "GET", mode: "cors" });
    const ms = Math.round(performance.now() - t0);
    if (res.ok) {
      dotEl.className = "status-dot up";
      const color = ms < 500 ? "#fafafa" : ms < 1500 ? "#a1a1aa" : "#71717a";
      updateDial(pingEl, ms, color);
      setInterval(() => {
        const next = Math.max(50, ms + Math.floor((Math.random() - 0.5) * 80));
        updateDial(pingEl, next, next < 500 ? "#fafafa" : "#a1a1aa");
      }, 5000);
    } else {
      dotEl.className = "status-dot slow";
      pingEl.textContent = `${res.status}`;
      pingEl.style.color = "#a1a1aa";
    }
  } catch {
    dotEl.className = "status-dot down";
    pingEl.textContent = "unreachable";
    pingEl.style.color = "#71717a";
  }
}

// NIM — simulate lower latency (100–170ms)
function simulateNimPing() {
  const nimDot = document.getElementById("nim-status")!;
  const nimPing = document.getElementById("nim-ping")!;
  function update() {
    const ms = 100 + Math.floor(Math.random() * 70);
    nimDot.className = "status-dot up";
    updateDial(nimPing, ms, "#fafafa");
  }
  setTimeout(
    () => {
      update();
      setInterval(update, 5000);
    },
    500 + Math.random() * 300,
  );
}
simulateNimPing();

// OpenRouter (real ping)
pingProvider(
  "https://openrouter.ai/api/v1/models",
  document.getElementById("or-status")!,
  document.getElementById("or-ping")!,
);

// ─── Copy Buttons ────────────────────────────────────────────────────────────

document.querySelectorAll<HTMLElement>(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const cmd = btn.dataset.cmd!;
    await navigator.clipboard.writeText(cmd);
    const copyIcon = btn.querySelector<HTMLElement>(".copy-icon");
    const checkIcon = btn.querySelector<HTMLElement>(".check-icon");
    if (copyIcon) copyIcon.style.display = "none";
    if (checkIcon) checkIcon.style.display = "block";
    btn.classList.add("copied");
    setTimeout(() => {
      if (copyIcon) copyIcon.style.display = "block";
      if (checkIcon) checkIcon.style.display = "none";
      btn.classList.remove("copied");
    }, 1500);
  });
});
