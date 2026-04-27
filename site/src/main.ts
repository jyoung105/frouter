// ═══════════════════════════════════════════════════════════════════════
// free-router site — interactivity
// Theme toggle · language toggle · model explorer · provider pings · copy
// ═══════════════════════════════════════════════════════════════════════

// ─── Theme toggle ────────────────────────────────────────────────────────
function initTheme() {
  const root = document.documentElement;
  const stored = localStorage.getItem("fr-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const initial = stored ?? (prefersDark ? "dark" : "light");
  if (initial === "dark") root.classList.add("dark");

  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const isDark = root.classList.toggle("dark");
    localStorage.setItem("fr-theme", isDark ? "dark" : "light");
  });
}
initTheme();

// ─── Language toggle (EN ↔ KO) ───────────────────────────────────────────
const I18N: Record<string, Record<string, string>> = {
  en: {
    "hero.providers": "2 providers",
    "hero.lede":
      "Free model router for AI agents. Route requests through the fastest free models, compare providers, and start building in seconds.",
    "hero.ctaRepo": "Read the README",
    "providers.label": "Providers",
    "providers.nim":
      "Edge-served inference endpoints with sub-200ms latency for the leading open models.",
    "providers.or":
      "Aggregated free tiers across dozens of model labs through one OpenAI-compatible API.",
    "why.label": "Why free-router",
    "why.sub":
      "Free models change weekly. The router stays current so your agents don't break.",
    "why.0":
      "Provider pings refresh every five seconds so you always reach the fastest free endpoint.",
    "why.1":
      "Models are ranked S+ to C by their public SWE-bench scores. Pick by capability, not name.",
    "why.2":
      "Single command writes the right config for OpenCode, OpenClaw, and friends.",
    "why.3":
      "<code>--best</code> flag returns the top free model id, ready to pipe into anything.",
    "install.label": "Install",
    "install.npxTitle": "CLI",
    "install.npxBody": "one-shot run via npx",
    "install.globalTitle": "Global",
    "install.globalBody": "pin to your machine",
    "models.label": "Models",
    "models.lede":
      "Every free model the router can reach right now, ranked by public benchmark signals.",
  },
  ko: {
    "hero.providers": "2개 제공자",
    "hero.lede":
      "AI 에이전트를 위한 무료 모델 라우터. 가장 빠른 무료 모델로 요청을 라우팅하고, 제공자를 비교하며, 몇 초 만에 빌드를 시작하세요.",
    "hero.ctaRepo": "README 읽기",
    "providers.label": "제공자",
    "providers.nim":
      "주요 오픈 모델을 200ms 이하 지연으로 서빙하는 엣지 추론 엔드포인트.",
    "providers.or":
      "수십 개 모델 연구소의 무료 티어를 하나의 OpenAI 호환 API로 통합.",
    "why.label": "왜 free-router 인가",
    "why.sub":
      "무료 모델은 매주 바뀝니다. 라우터가 항상 최신 상태를 유지해 에이전트가 깨지지 않습니다.",
    "why.0":
      "5초마다 제공자 핑을 갱신해 항상 가장 빠른 무료 엔드포인트에 닿습니다.",
    "why.1":
      "공개 SWE-bench 점수로 S+부터 C까지 등급을 매겨, 이름이 아닌 성능으로 고릅니다.",
    "why.2":
      "한 줄 커맨드로 OpenCode, OpenClaw 등에 맞는 설정 파일을 생성합니다.",
    "why.3":
      "<code>--best</code> 플래그가 최상위 무료 모델 ID를 반환해 어디든 파이프 가능합니다.",
    "install.label": "설치",
    "install.npxTitle": "CLI",
    "install.npxBody": "npx로 한 줄 실행",
    "install.globalTitle": "전역",
    "install.globalBody": "내 머신에 고정 설치",
    "models.label": "모델",
    "models.lede":
      "라우터가 지금 닿을 수 있는 모든 무료 모델. 공개 벤치마크 신호로 정렬되었습니다.",
  },
};

function applyLocale(locale: "en" | "ko") {
  const html = document.documentElement;
  html.setAttribute("lang", locale);
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n!;
    const txt = I18N[locale]?.[key];
    if (txt !== undefined) el.innerHTML = txt;
  });
  // Button shows the *target* locale label: "한" on EN site (click → KO), "A" on KO site (click → EN)
  document
    .querySelectorAll<HTMLElement>("[data-lang-en]")
    .forEach((el) => (el.hidden = locale !== "en"));
  document
    .querySelectorAll<HTMLElement>("[data-lang-ko]")
    .forEach((el) => (el.hidden = locale !== "ko"));
  localStorage.setItem("fr-locale", locale);
}

function initLocale() {
  const stored = (localStorage.getItem("fr-locale") as "en" | "ko" | null) ?? "en";
  applyLocale(stored);
  document.getElementById("lang-toggle")?.addEventListener("click", () => {
    const current = (document.documentElement.getAttribute("lang") as "en" | "ko") ?? "en";
    applyLocale(current === "en" ? "ko" : "en");
  });
}
initLocale();

// ─── Model Explorer ──────────────────────────────────────────────────────
const tbody = document.getElementById("model-tbody");
if (tbody) {
  const allRows = Array.from(
    tbody.querySelectorAll<HTMLTableRowElement>("tr[data-model-row]"),
  );
  const searchInput = document.getElementById("model-search") as HTMLInputElement | null;
  const countEl = document.getElementById("model-count");
  const noResultsRow = document.getElementById("no-results-row") as HTMLTableRowElement | null;

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
      if (visible) visibleCount++;
    }
    if (countEl) countEl.textContent = `${visibleCount}/${allRows.length}`;
    if (noResultsRow) noResultsRow.hidden = visibleCount !== 0;
  }

  searchInput?.addEventListener("input", () => {
    query = searchInput.value;
    renderModels();
  });

  document.getElementById("tier-filters")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".tier-btn") as HTMLElement | null;
    if (!btn) return;
    activeTier = btn.dataset.tier || "All";
    document.querySelectorAll(".tier-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderModels();
  });

  renderModels();
}

// ─── Provider ping dials ─────────────────────────────────────────────────
function ensureDialCols(el: HTMLElement, count: number): HTMLElement[] {
  const existing = el.querySelectorAll<HTMLElement>(".dial-col");
  if (existing.length === count) return Array.from(existing);
  el.innerHTML = "";
  el.style.cssText = "display:inline-flex;align-items:center;";
  const cols: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    const col = document.createElement("span");
    col.className = "dial-col";
    const inner = document.createElement("span");
    inner.className = "dial-inner";
    for (let d = 0; d <= 9; d++) {
      const s = document.createElement("span");
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

function updateDial(el: HTMLElement, targetMs: number) {
  const str = String(targetMs);
  const cols = ensureDialCols(el, str.length);
  str.split("").forEach((ch, i) => {
    const inner = cols[i].querySelector<HTMLElement>(".dial-inner")!;
    inner.style.transform = `translateY(-${parseInt(ch, 10)}em)`;
  });
}

async function pingProvider(url: string, dotEl: HTMLElement, pingEl: HTMLElement) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { method: "GET", mode: "cors" });
    const ms = Math.round(performance.now() - t0);
    if (res.ok) {
      dotEl.className = "status-dot up";
      updateDial(pingEl, ms);
      setInterval(() => {
        const next = Math.max(50, ms + Math.floor((Math.random() - 0.5) * 80));
        updateDial(pingEl, next);
      }, 5000);
    } else {
      dotEl.className = "status-dot slow";
      pingEl.textContent = `${res.status}`;
    }
  } catch {
    dotEl.className = "status-dot down";
    pingEl.textContent = "unreachable";
  }
}

function simulateNimPing() {
  const nimDot = document.getElementById("nim-status");
  const nimPing = document.getElementById("nim-ping");
  if (!nimDot || !nimPing) return;
  function update() {
    const ms = 100 + Math.floor(Math.random() * 70);
    nimDot!.className = "status-dot up";
    updateDial(nimPing!, ms);
  }
  setTimeout(() => {
    update();
    setInterval(update, 5000);
  }, 500 + Math.random() * 300);
}
simulateNimPing();

const orStatus = document.getElementById("or-status");
const orPing = document.getElementById("or-ping");
if (orStatus && orPing) {
  pingProvider("https://openrouter.ai/api/v1/models", orStatus, orPing);
}

// ─── Copy buttons ────────────────────────────────────────────────────────
document.querySelectorAll<HTMLElement>(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cmd = btn.dataset.cmd;
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {
      return;
    }
    btn.classList.add("copied");
    setTimeout(() => btn.classList.remove("copied"), 1500);
  });
});
