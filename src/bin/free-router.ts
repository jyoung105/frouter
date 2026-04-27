#!/usr/bin/env node
// src/bin/free-router.ts — free-router main entry: TUI + --best mode
// Zero dependencies — pure Node.js built-ins

import {
  loadConfig,
  saveConfig,
  getApiKey,
  promptMasked,
  runFirstRunWizard,
  PROVIDERS_META,
  validateProviderApiKey,
  openBrowser,
  type FrouterConfig,
} from "../lib/config.js";
import { getAllModels } from "../lib/models.js";
import {
  ping,
  pingAllOnce,
  startPingLoop,
  stopPingLoop,
  destroyAgents,
  bumpPingEpoch,
} from "../lib/ping.js";
import {
  writeOpenCode,
  resolveOpenCodeSelection,
  isOpenCodeInstalled,
  detectAvailableInstallers,
  installOpenCode,
} from "../lib/targets.js";
import {
  getAvg,
  getUptime,
  getVerdict,
  findBestModel,
  sortModels,
  filterByTier,
  filterBySearch,
  tierColor,
  latColor,
  uptimeColor,
  TIER_CYCLE,
  pad,
  visLen,
  truncAnsiToWidth,
  R,
  B,
  D,
  RED,
  GREEN,
  YELLOW,
  CYAN,
  WHITE,
  ORANGE,
  BG_SEL,
  readEnv,
  type Model,
} from "../lib/utils.js";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname } from "node:path";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";

import { createRequire } from "node:module";

// ─── Version ─────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION: string = createRequire(import.meta.url)(
  "../../package.json",
).version;

// ─── ANSI shortcuts ────────────────────────────────────────────────────────────
const w = (s: string) => process.stdout.write(String(s));
const CLEAR = "\x1b[2J\x1b[H";
const CURSOR_HOME = "\x1b[H";
const HIDEC = "\x1b[?25l";
const SHOWC = "\x1b[?25h";
const INVERT = "\x1b[7m";
const BG_HDR = "\x1b[48;5;17m";
const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const ALLOW_PLAINTEXT_KEY_EXPORT =
  readEnv(
    "FREE_ROUTER_EXPORT_PLAINTEXT_KEYS",
    "FROUTER_EXPORT_PLAINTEXT_KEYS",
  ) === "1";
const FORCE_FRAME_CLEAR =
  readEnv("FREE_ROUTER_TUI_FORCE_CLEAR", "FROUTER_TUI_FORCE_CLEAR") === "1";
const STRICT_RENDER_AUTH =
  process.env.NODE_ENV === "test" ||
  readEnv("FREE_ROUTER_STRICT_RENDER_AUTH", "FROUTER_STRICT_RENDER_AUTH") ===
    "1";

// ─── Parse CLI args ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const BEST = argv.includes("--best");
const HELP = argv.includes("--help") || argv.includes("-h");
const VERSION = argv.includes("--version") || argv.includes("-v");

if (VERSION) {
  console.log(`free-router ${PKG_VERSION}`);
  process.exit(0);
}

if (HELP) {
  console.log(`
  free-router — Free Model Router

  Usage: free-router [flags]

  Flags:
    (none)    Interactive TUI — discover, compare, select
    --best    Non-interactive: print best model ID to stdout after ~10s
    --version Show version
    --help    Show this help

  TUI keys:
    ↑↓ / j k     Navigate models
    PgUp / PgDn   Jump one page
    g / G          Jump to top / bottom
    /              Search (type to filter, Enter opens opencode, ESC to clear)
    Enter          Save config + open current model in opencode
    A              Quick API key add/change (opens key editor)
    P              Settings (edit keys, toggle providers, test)
    T              Cycle tier filter
    W / X          Faster / slower ping interval
    ?              Help overlay
    q / Ctrl+C     Exit

  Sort keys (press to sort, press again to reverse):
    0:Priority  1:Tier  2:Provider  3:Model  4:Avg  5:Latest
    6:Uptime  7:Context  8:Verdict  9:Intelligence
`);
  process.exit(0);
}

// ─── State ─────────────────────────────────────────────────────────────────────
let config: FrouterConfig = {
  apiKeys: {},
  providers: {},
  ui: { scrollSortPauseMs: 1500 },
};
let models: Model[] = [];
let filtered: Model[] = [];
let cursor = 0;
let scrollOff = 0;
let sortCol = "priority";
let sortAsc = true;
let searchMode = false;
let searchQuery = "";
let searchTabScrolled = false;
let tierFilter = "All";
let pingMs = 2000;
let screen = "main"; // 'main' | 'settings' | 'help' | 'ink-subapp'
let sCursor = 0;
let selModel: Model | null = null;
let sEditing = false;
let sKeyBuf = "";
let sTestRes: Record<string, string> = {};
let sNotice = "";
let sAutoOpenedPk = "";
let pingRef: {
  running: boolean;
  timer: ReturnType<typeof setTimeout> | null;
} | null = null;
let userNavigated = false; // true once user actively moves cursor
let autoSortPauseUntil = 0;
const DEFAULT_USER_SCROLL_SORT_PAUSE_MS = 1500;
let userScrollSortPauseMs = DEFAULT_USER_SCROLL_SORT_PAUSE_MS;
let renderAuthorityViolations = 0;
let starPromptHandledThisLaunch = false;
let startupSearchRequestedThisLaunch = false;

// ─── Geometry ──────────────────────────────────────────────────────────────────
const DEFAULT_COLS = 80;
// Keep fallback rows compact: some remote PTYs report unknown size until a
// later resize, and an oversized fallback can push headers off-screen.
const DEFAULT_ROWS = 12;
const MIN_COLS = 40;
const MIN_ROWS = 8;
const CHROME_ROWS = 5;

function envSize(name: string): number | null {
  const raw = process.env[name];
  return raw ? positiveInt(Number.parseInt(raw, 10)) : null;
}

function positiveInt(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function viewport() {
  // Some remote terminals expose dimensions on stdin/stderr before stdout.
  // Probe all TTY streams first.
  const streams: any[] = [process.stdout, process.stderr, process.stdin];
  let c = null;
  let r = null;

  for (const stream of streams) {
    if (c == null) c = positiveInt(stream?.columns);
    if (r == null) r = positiveInt(stream?.rows);
    if (c != null && r != null) break;
  }

  // Some PTYs report 0x0 until the first SIGWINCH.
  if (c == null || r == null) {
    for (const stream of streams) {
      if (typeof stream?.getWindowSize !== "function") continue;
      try {
        const [wc, wr] = stream.getWindowSize();
        if (c == null) c = positiveInt(wc);
        if (r == null) r = positiveInt(wr);
        if (c != null && r != null) break;
      } catch {
        /* best-effort */
      }
    }
  }

  if (c == null) c = envSize("COLUMNS") ?? DEFAULT_COLS;
  if (r == null) r = envSize("LINES") ?? DEFAULT_ROWS;

  return {
    c: Math.max(MIN_COLS, Math.floor(c)),
    r: Math.max(MIN_ROWS, Math.floor(r)),
  };
}

const cols = () => viewport().c;
const rows = () => viewport().r;
// All lines are truncated to terminal width so nothing wraps.
// Chrome: header(1) + search bar(1) + colhdr(1) + detail(1) + footer(1) = 5 lines
const tRows = () => Math.max(0, rows() - CHROME_ROWS);
const WRAP_GUARD_COLS = 1;

// ─── Sort column metadata ──────────────────────────────────────────────────────
const SORT_COLS = [
  { key: "0", col: "priority", label: "Priority" },
  { key: "1", col: "tier", label: "Tier" },
  { key: "2", col: "provider", label: "Provider" },
  { key: "3", col: "model", label: "Model" },
  { key: "4", col: "avg", label: "Avg" },
  { key: "5", col: "latest", label: "Lat" },
  { key: "6", col: "uptime", label: "Up%" },
  { key: "7", col: "context", label: "Ctx" },
  { key: "8", col: "verdict", label: "Verdict" },
  { key: "9", col: "intel", label: "AA" },
];

function sortArrow(colName: string) {
  if (sortCol !== colName) return "";
  return sortAsc ? "▲" : "▼";
}

function colHdr(
  label: string,
  colName: string,
  width: number,
  rightAlign = false,
) {
  const arrow = sortArrow(colName);
  const text = arrow ? `${label}${arrow}` : label;
  return rightAlign ? text.padStart(width) : text.padEnd(width);
}

// ─── Render helpers ────────────────────────────────────────────────────────────
function fmtCtx(n: number) {
  if (!n) return "  —  ";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`.padStart(5);
  return `${Math.round(n / 1000)}k`.padStart(5);
}

function fmtMs(ms: number | null) {
  if (ms === Infinity || ms == null) return "   — ";
  return `${Math.round(ms)}ms`.padStart(6);
}

function fmtUp(pct: number, hasPings: boolean) {
  if (!hasPings) return "  — ";
  return `${pct}%`.padStart(4);
}

function fmtLatency(ms: number | null) {
  if (ms != null) return latColor(ms) + fmtMs(ms) + R;
  return `${D}${fmtMs(null)}${R}`;
}

function fullWidthBar(content: string, style = INVERT, lastLine = false) {
  return `${style}${fullWidthLine(content, lastLine)}${R}`;
}

function fullWidthLine(content: string, lastLine = false) {
  const c = cols();
  const guard = lastLine ? Math.max(1, WRAP_GUARD_COLS) : WRAP_GUARD_COLS;
  const maxW = Math.max(0, c - guard);
  const truncated = truncAnsi(content, maxW);
  return `${truncated}${" ".repeat(Math.max(0, maxW - visLen(truncated)))}`;
}

// Truncate a string with ANSI codes to at most `maxVis` visible columns.
// Preserves escape sequences but stops emitting visible chars once the limit is reached.
// Emoji are treated as 2 columns wide to prevent terminal line wrapping.
function truncAnsi(s: string, maxVis: number): string {
  return truncAnsiToWidth(s, maxVis);
}

const STARTUP_PIXEL_TITLE = [
  "  ███████╗ ██████╗  ███████╗ ███████╗     ",
  "  ██╔════╝ ██╔══██╗ ██╔════╝ ██╔════╝     ",
  "  █████╗   ██████╔╝ █████╗   █████╗   ████",
  "  ██╔══╝   ██╔══██╗ ██╔══╝   ██╔══╝   ╚══╝",
  "  ██║      ██║  ██║ ███████╗ ███████╗     ",
  "  ╚═╝      ╚═╝  ╚═╝ ╚══════╝ ╚══════╝     ",
  "  ██████╗   ██████╗  ██╗   ██╗ ████████╗ ███████╗ ██████╗",
  "  ██╔══██╗ ██╔═══██╗ ██║   ██║ ╚══██╔══╝ ██╔════╝ ██╔══██╗",
  "  ██████╔╝ ██║   ██║ ██║   ██║    ██║    █████╗   ██████╔╝",
  "  ██╔══██╗ ██║   ██║ ██║   ██║    ██║    ██╔══╝   ██╔══██╗",
  "  ██║  ██║ ╚██████╔╝ ╚██████╔╝    ██║    ███████╗ ██║  ██║",
  "  ╚═╝  ╚═╝  ╚═════╝   ╚═════╝     ╚═╝    ╚══════╝ ╚═╝  ╚═╝",
];

function startupPixelTitleLines() {
  return STARTUP_PIXEL_TITLE.map((line, idx) => {
    if (idx <= 2) return `${B}${line}${R}`;
    if (idx >= 8) return `${D}${line}${R}`;
    return line;
  });
}

function statusDot(model: Model) {
  switch (model.status) {
    case "up":
      return `${GREEN}*${R}`;
    case "noauth":
      return `${YELLOW}!${R}`;
    case "forbidden":
      return `${RED}!${R}`;
    case "ratelimit":
      return `${ORANGE}~${R}`;
    case "unavailable":
      return `${RED}#${R}`;
    case "notfound":
      return `${RED}?${R}`;
    case "timeout":
      return `${RED}o${R}`;
    case "down":
      return `${RED}x${R}`;
    default:
      return `${D}.${R}`;
  }
}

// ─── Expired key detection ───────────────────────────────────────────────────
function isProviderKeyExpired(providerKey: string): boolean {
  const provConf = config.providers?.[providerKey];
  if (provConf?.enabled === false) return false;
  const provModels = models.filter((m) => m.providerKey === providerKey);
  if (provModels.length === 0) return false;
  const pinged = provModels.filter((m) => m.status && m.status !== "pending");
  if (pinged.length === 0) return false;
  return pinged.every((m) => m.status === "noauth");
}

function findExpiredProvider(): string | null {
  for (const pk of Object.keys(PROVIDERS_META)) {
    if (isProviderKeyExpired(pk)) return pk;
  }
  return null;
}

// ─── Main TUI ──────────────────────────────────────────────────────────────────
function renderMain() {
  const { c, r } = viewport();
  const tr = Math.max(0, r - CHROME_ROWS);
  if (cursor < scrollOff) scrollOff = cursor;
  if (cursor >= scrollOff + tr) scrollOff = cursor - tr + 1;

  const provStatus = Object.entries(PROVIDERS_META)
    .map(([pk, m]) => {
      const on = config.providers?.[pk]?.enabled !== false;
      if (!on) return `${D}${m.name} off${R}`;
      const key = getApiKey(config, pk);
      if (!key) return `${YELLOW}${m.name} ○${R}`;
      if (isProviderKeyExpired(pk)) return `${RED}${m.name} ✗${R}`;
      return `${GREEN}${m.name} ✓${R}`;
    })
    .join("  ");

  const searchLabel = `${CYAN}${B}[Model Search]${R}`;
  const searchInput = searchMode
    ? `${CYAN}/${searchQuery}_${R}`
    : `${D}Press '/' to search models${R}`;
  const keyBadges = Object.entries(PROVIDERS_META)
    .filter(([pk]) => config.providers?.[pk]?.enabled !== false)
    .map(([pk, m]) => {
      const key = getApiKey(config, pk);
      if (!key) return `${YELLOW}${m.name}:○${R}`;
      if (isProviderKeyExpired(pk)) return `${RED}${m.name}:✗${R}`;
      return `${GREEN}${m.name}:✓${R}`;
    })
    .join("  ");
  const searchHint = searchMode
    ? `${YELLOW}[ESC clear]${R} ${GREEN}[Enter apply]${R}`
    : `${CYAN}[/ start]${R}`;
  const searchBar = `${searchLabel} ${searchInput} ${keyBadges}  ${searchHint}`;

  const tierBar =
    tierFilter !== "All" ? `${YELLOW}tier:${tierFilter}${R}  ` : "";
  const stats = `${D}${filtered.length}/${models.length} models  ${pingMs / 1000}s${R}`;

  // ── Loading splash — skip all chrome until data is ready ──────────────────
  const isLoading = filtered.length === 0 && models.length === 0;
  if (isLoading) {
    const splashLines = [
      ...startupPixelTitleLines(),
      `${D}  FREE-ROUTER · Free Model Router${R}`,
      `${D}  Loading models…${R}`,
    ];
    const topPad = Math.max(0, Math.floor((r - splashLines.length) / 3) - 5);
    let out = (FORCE_FRAME_CLEAR ? CLEAR : CURSOR_HOME) + HIDEC + "\x1b[J";
    for (let i = 0; i < topPad; i++) out += "\n";
    for (const line of splashLines) out += truncAnsi(line, c) + "\n";
    w(out);
    return;
  }

  let out = (FORCE_FRAME_CLEAR ? CLEAR : CURSOR_HOME) + HIDEC;

  // Header
  const hdrRaw = `${BG_HDR}${WHITE}${B} free-router ${R}  ${provStatus}${R}`;
  out += fullWidthLine(hdrRaw) + "\n";

  // Search + stats bar
  out += fullWidthLine(` ${searchBar}   ${tierBar}${stats}`) + "\n";

  // Column headers with sort indicators
  const hdr = `  ${"#".padStart(3)}  ${colHdr("Tier", "tier", 4)}  ${colHdr("Provider", "provider", 11)}  ${colHdr("Model", "model", 32)}  ${colHdr("Ctx", "context", 5, true)}  ${colHdr("AA", "intel", 3, true)}  ${colHdr("Avg", "avg", 6, true)}  ${colHdr("Lat", "latest", 6, true)}  ${colHdr("Up%", "uptime", 4, true)}  ${colHdr("Verdict", "verdict", 7)}`;
  out += fullWidthBar(hdr) + "\n";

  // Model rows (skip if terminal too small)
  if (tr === 0) {
    // Ensure stale lower lines are cleared when viewport is tiny.
    out += "\x1b[J";
    w(out);
    return;
  }
  {
    const showSearchPixelTitle =
      searchMode &&
      !searchTabScrolled &&
      scrollOff === 0 &&
      tr > STARTUP_PIXEL_TITLE.length;
    const titleLines = showSearchPixelTitle ? startupPixelTitleLines() : [];
    for (const line of titleLines) {
      out += fullWidthLine(line) + "\n";
    }

    const rowsAvailable = Math.max(0, tr - titleLines.length);
    const slice = filtered.slice(scrollOff, scrollOff + rowsAvailable);
    for (let i = 0; i < rowsAvailable; i++) {
      const m = slice[i];
      if (!m) {
        out += fullWidthLine("") + "\n";
        continue;
      }

      const idx = scrollOff + i;
      const isSel = idx === cursor;
      const rank = String(idx + 1).padStart(3);
      const tier = pad(tierColor(m.tier) + (m.tier || "?") + R, 4);
      const prov = pad(m.providerKey === "nvidia" ? "NIM" : "OpenRouter", 11);
      const name = pad(m.displayName || m.id, 32);
      const ctx = fmtCtx(m.context);
      const avg = getAvg(m);
      const avgStr = fmtLatency(avg !== Infinity ? avg : null);
      const last = m.pings.at(-1);
      const latMs = Number.isFinite(last?.ms) ? (last?.ms ?? null) : null;
      const latStr = fmtLatency(latMs);
      const up = getUptime(m);
      const upStr = uptimeColor(up) + fmtUp(up, m.pings.length > 0) + R;
      const dot = statusDot(m);
      const verdict = `${D}${getVerdict(m)}${R}`;
      const aaStr =
        m.aaIntelligence != null
          ? String(Math.round(m.aaIntelligence)).padStart(3)
          : `${D}  —${R}`;

      const row = fullWidthLine(
        `  ${rank}  ${tier}  ${prov}  ${name}  ${ctx}  ${aaStr}  ${avgStr}  ${latStr}  ${upStr}  ${dot} ${verdict}`,
      );
      if (isSel) out += `${BG_SEL}${B}${row}${R}\n`;
      else out += `${row}${R}\n`;
    }
  } // end if (!isLoading)

  // Detail bar — full model ID of highlighted model
  const sel = filtered[cursor];
  if (sel) {
    const fullId = `${sel.providerKey}/${sel.id}`;
    const sweStr = sel.sweScore != null ? `  SWE:${sel.sweScore}%` : "";
    const ctxStr = sel.context ? `  ctx:${fmtCtx(sel.context).trim()}` : "";
    out += fullWidthLine(`${D} ${fullId}${sweStr}${ctxStr}${R}`) + "\n";
  } else {
    out += fullWidthLine("") + "\n";
  }

  // Footer
  const footer = ` ↑↓/jk:nav  /:focus model search  Enter:open opencode  A:api key  P:settings  T:tier  ?:help  0-9:sort  q:quit `;
  out += fullWidthBar(footer, INVERT, true);
  w(out);
}

// ─── Help overlay ──────────────────────────────────────────────────────────────
function renderHelp() {
  const sortLines = SORT_COLS.map((s) => {
    const active = sortCol === s.col ? ` ${CYAN}← active${R}` : "";
    return `  ${s.key}           ${s.label}${active}`;
  }).join("\n");

  w(
    CLEAR +
      HIDEC +
      `${BG_HDR}${WHITE}${B} free-router — Keyboard Reference ${R}\n\n` +
      `${B}  Navigation${R}\n` +
      `  ↑ / k       Move up\n` +
      `  ↓ / j       Move down\n` +
      `  PgUp        Page up\n` +
      `  PgDn        Page down\n` +
      `  g           Jump to top\n` +
      `  G           Jump to bottom\n\n` +
      `${B}  Actions${R}\n` +
      `  Enter       Save config + open current model in opencode\n` +
      `  /           Focus model search (filter by model name; Enter opens opencode)\n` +
      `  A           Quick API key add/change (opens key editor)\n` +
      `  R           Change API key (auto-detects expired provider)\n` +
      `  T           Cycle tier filter (All → S+ → S → …)\n` +
      `  P           Settings (API keys, toggle providers)\n` +
      `  W / X       Faster / slower ping interval\n` +
      `  q           Quit\n\n` +
      `${B}  Sort (press key to sort, press again to reverse)${R}\n` +
      sortLines +
      "\n" +
      `\n${INVERT} Press any key to close ${R}\n`,
  );
}

// ─── Settings screen ───────────────────────────────────────────────────────────
function maskKey(key: string) {
  const masked = "•".repeat(Math.min(16, Math.max(4, key.length - 8)));
  return `${D}${key.slice(0, 4)}${masked}${key.slice(-4)}${R}`;
}

function renderSettings() {
  let out = CLEAR + HIDEC;
  out += `${BG_HDR}${WHITE}${B} free-router Settings ${R}\n\n`;

  const pks = Object.keys(PROVIDERS_META);
  for (let i = 0; i < pks.length; i++) {
    const pk = pks[i];
    const meta = PROVIDERS_META[pk];
    const enabled = config.providers?.[pk]?.enabled !== false;
    const key = getApiKey(config, pk);
    const isSel = i === sCursor;

    const toggleStr = enabled ? `${GREEN}[ ON  ]${R}` : `${RED}[ OFF ]${R}`;
    let keyDisp;
    if (sEditing && isSel) {
      keyDisp = `${CYAN}${"•".repeat(sKeyBuf.length)}_${R}`;
    } else if (key) {
      keyDisp = maskKey(key);
    } else {
      keyDisp = `${D}(no key)${R}`;
    }
    const testDisp = sTestRes[pk] ? `  ${D}[${sTestRes[pk]}]${R}` : "";

    const prefix = isSel ? `${B} ❯ ${R}` : "   ";
    out += `${prefix}${toggleStr} ${pad(meta.name, 14)} ${keyDisp}${testDisp}\n`;
  }

  out += `\n${INVERT} ↑↓:navigate  Enter:edit key  Space:toggle  T:test  D:delete key  ESC:back ${R}\n`;
  if (sEditing) out += `\n${D} Type key  •  Enter:save  •  ESC:cancel${R}\n`;
  if (sNotice) out += `\n${sNotice}\n`;
  w(out);
}

// ─── Render dispatcher ─────────────────────────────────────────────────────────
function render() {
  switch (screen) {
    case "main":
      renderMain();
      break;
    case "settings":
      renderSettings();
      break;
    case "help":
      renderHelp();
      break;
  }
}

const ALLOWED_RENDER_REASONS = new Set([
  "main-input",
  "main-search",
  "main-sort",
  "settings-open",
  "settings-ui",
  "settings-test",
  "settings-exit",
  "target-ui",
  "target-prompt",
  "help-close",
  "resize",
  "startup",
  "refresh-complete",
  "onPingTick",
  "round-complete",
  "timed-return",
  "throttled",
]);

function renderWithAuthority(reason: string) {
  if (!ALLOWED_RENDER_REASONS.has(reason)) {
    renderAuthorityViolations++;
    const msg = `[free-router] non-authoritative render attempt: ${reason}\n`;
    if (STRICT_RENDER_AUTH) throw new Error(msg.trim());
    process.stderr.write(msg);
  }
  render();
}

// ─── Filter + sort ─────────────────────────────────────────────────────────────
function applyFilters() {
  let r = models;
  if (tierFilter !== "All") r = filterByTier(r, tierFilter);
  if (searchQuery) r = filterBySearch(r, searchQuery);
  r = sortModels(r, sortCol, sortAsc);
  filtered = r;

  if (cursor >= filtered.length) cursor = Math.max(0, filtered.length - 1);
  if (cursor < 0) cursor = 0;
  // Keep scrollOff pinned to 0 until the user actively navigates
  if (!userNavigated) {
    scrollOff = 0;
  } else {
    scrollOff = Math.max(
      0,
      Math.min(scrollOff, Math.max(0, filtered.length - tRows())),
    );
  }
}

// ─── Key handlers ──────────────────────────────────────────────────────────────
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const PGUP = "\x1b[5~";
const PGDN = "\x1b[6~";
const HOME = "\x1b[H";
const END = "\x1b[F";

function maxCursorIndex() {
  return Math.max(0, filtered.length - 1);
}

function clampCursor(next: number) {
  return Math.max(0, Math.min(maxCursorIndex(), next));
}

function resolveUserScrollSortPauseMs(cfg: FrouterConfig): number {
  // Env overrides config so users can tune behavior per terminal/session.
  const raw =
    readEnv("FREE_ROUTER_SCROLL_SORT_PAUSE_MS", "FROUTER_SCROLL_SORT_PAUSE_MS") ??
    cfg?.ui?.scrollSortPauseMs;
  if (raw == null || raw === "") return DEFAULT_USER_SCROLL_SORT_PAUSE_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_USER_SCROLL_SORT_PAUSE_MS;
  }
  return Math.round(parsed);
}

function noteUserNavigation() {
  userNavigated = true;
  autoSortPauseUntil = Date.now() + userScrollSortPauseMs;
}

function navigate(target: number) {
  noteUserNavigation();
  cursor = clampCursor(target);
}

function isAutoSortPaused() {
  return Date.now() < autoSortPauseUntil;
}

function resetSearchState() {
  searchMode = false;
  searchQuery = "";
  searchTabScrolled = false;
  cursor = 0;
  scrollOff = 0;
}

function enterSearchMode() {
  resetSearchState();
  searchMode = true;
  applyFilters();
}

function consumeStartupSearchRequestFromEnv(): boolean {
  const requested =
    readEnv(OPEN_SEARCH_ON_START_ENV, LEGACY_OPEN_SEARCH_ON_START_ENV) === "1";
  delete process.env[OPEN_SEARCH_ON_START_ENV];
  delete process.env[LEGACY_OPEN_SEARCH_ON_START_ENV];
  return requested;
}

function markStartupSearchRequested() {
  startupSearchRequestedThisLaunch = true;
}

function handleGithubStarAccepted() {
  starPromptHandledThisLaunch = true;
  markStartupSearchRequested();
  openBrowser(GITHUB_REPO_URL);
}

function handleGithubStarDeclined() {
  starPromptHandledThisLaunch = true;
}

function _resetSettingsState() {
  sEditing = false;
  sKeyBuf = "";
  sNotice = "";
  sTestRes = {};
  sAutoOpenedPk = "";
}

function enterTargetPickerFromSelection() {
  if (!filtered.length) return false;
  selModel = filtered[cursor];
  searchMode = false;
  screen = "ink-subapp";
  void launchOpenCodeDirect();
  return true;
}

async function launchOpenCodeDirect() {
  prepareForInkSubApp();

  if (!selModel) {
    restoreAfterInkSubApp("main");
    restartLoop();
    return;
  }

  const { openCodeModel, openCodePk, openCodeApiKey } =
    resolveOpenCodeApplySelection(selModel);

  let launch = true;

  try {
    writeOpenCode(openCodeModel, openCodePk, openCodeApiKey, {
      persistApiKey: ALLOW_PLAINTEXT_KEY_EXPORT,
    });
  } catch (err: any) {
    w(`${RED} \u2717 OpenCode write failed: ${err.message}${R}\n`);
    setTimeout(() => {
      restoreAfterInkSubApp("main");
      restartLoop();
    }, 1400);
    return;
  }

  // Guard: missing API key → offer to add it
  if (launch && !openCodeApiKey) {
    const meta = PROVIDERS_META[openCodePk];
    const envVar = meta?.envVar || "API key";
    w(
      `\n${YELLOW} ! Missing ${meta?.name || openCodePk} API key (${envVar}).${R}\n`,
    );
    const addKey = await promptYesNoFromTarget(
      `${D}   Add API key now? (Y/n, default: Y): ${R}`,
      true,
    );
    if (addKey) {
      openApiKeyEditorFromMain(openCodePk);
      return;
    }
    w(
      `${YELLOW} Launch cancelled. Set ${envVar} in Settings (P), then retry.${R}\n`,
    );
    launch = false;
  }

  if (launch) {
    if (!isOpenCodeInstalled()) {
      w(
        `${YELLOW} ! opencode is not installed. Install from https://github.com/opencode-ai/opencode${R}\n`,
      );
      setTimeout(() => {
        restoreAfterInkSubApp("main");
        restartLoop();
      }, 1400);
      return;
    }
    const launchEnv = buildOpenCodeLaunchEnv(openCodePk, openCodeApiKey);
    cleanup();
    const proc = spawnSync("opencode", [], {
      stdio: "inherit",
      shell: true,
      env: launchEnv,
    });
    process.exit(Number.isInteger(proc.status) ? proc.status : 1);
  }

  // ── Save-only path: show messages briefly, then restore main TUI ──
  setTimeout(() => {
    restoreAfterInkSubApp("main");
    restartLoop();
  }, 1400);
}

function resolveOpenCodeApplySelection(selectedModel: Model) {
  const pk = selectedModel.providerKey;
  const resolved = resolveOpenCodeSelection(selectedModel, pk, models);
  const apiKey = getApiKey(config, resolved.providerKey);
  const notice =
    resolved.fallback &&
    (resolved.providerKey !== pk || resolved.model?.id !== selectedModel.id)
      ? `${YELLOW} ! OpenCode fallback: ${pk}/${selectedModel.id} → ${resolved.providerKey}/${resolved.model.id}${R}`
      : "";
  return {
    openCodeModel: resolved.model,
    openCodePk: resolved.providerKey,
    openCodeApiKey: apiKey,
    notice,
  };
}

function buildOpenCodeLaunchEnv(providerKey: string, apiKey: string | null) {
  const launchEnv = { ...process.env };
  const envVar = PROVIDERS_META[providerKey]?.envVar;
  if (apiKey && envVar) {
    launchEnv[envVar] = apiKey;
  }
  // Prevent oh-my-opencode startup auto-update/install logs from polluting
  // the interactive OpenCode TUI launched by free-router.
  if (launchEnv.OPENCODE_CLI_RUN_MODE == null) {
    launchEnv.OPENCODE_CLI_RUN_MODE = "true";
  }
  return launchEnv;
}

async function promptYesNoFromTarget(
  question: string,
  defaultValue = false,
): Promise<boolean> {
  process.stdin.removeListener("data", onData);
  try {
    return await promptYesNo(question, defaultValue);
  } finally {
    process.stdin.on("data", onData);
  }
}

async function _promptInstallOpenCode() {
  w(`\n${YELLOW} ! opencode CLI is not installed.${R}\n`);
  const installers = detectAvailableInstallers();
  if (!installers.length) {
    w(`${D}   No supported package manager found (npm, brew, go).${R}\n`);
    w(
      `${D}   Install manually: ${CYAN}https://github.com/opencode-ai/opencode${R}\n`,
    );
    return false;
  }

  w(`\n${B}   Available installers:${R}\n`);
  for (let i = 0; i < installers.length; i++) {
    const inst = installers[i];
    w(`   ${B}${i + 1}${R}) ${inst.label}  ${D}(${inst.command})${R}\n`);
  }

  const answer = await promptMasked(
    `\n   Install opencode? (1-${installers.length} to install, ESC to skip): `,
  );
  if (!answer) return false;

  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= installers.length) {
    w(`${RED}   Invalid choice.${R}\n`);
    return false;
  }

  const chosen = installers[idx];
  w(`\n${D}   Running: ${chosen.command}${R}\n\n`);
  const result = installOpenCode(chosen);

  if (!result.ok) {
    w(`\n${RED} ✗ Installation failed: ${result.error}${R}\n`);
    return false;
  }

  if (!isOpenCodeInstalled()) {
    w(`\n${YELLOW} ! opencode was installed but is not on your PATH.${R}\n`);
    w(
      `${D}   You may need to restart your shell or add its location to PATH.${R}\n`,
    );
    return false;
  }

  w(`\n${GREEN} ✓ opencode installed successfully.${R}\n`);
  return true;
}

function quickApplySelectionToTargets() {
  return enterTargetPickerFromSelection();
}

function resolveQuickApiKeyProviderIndex() {
  const pks = Object.keys(PROVIDERS_META);
  if (!pks.length) return 0;

  const selectedPk = filtered[cursor]?.providerKey;
  if (selectedPk) {
    const selectedIdx = pks.indexOf(selectedPk);
    if (selectedIdx !== -1) return selectedIdx;
  }

  const missingIdx = pks.findIndex((pk) => !config?.apiKeys?.[pk]);
  if (missingIdx !== -1) return missingIdx;

  return 0;
}

function openApiKeyEditorFromMain(providerKey?: string) {
  searchMode = false;
  const pks = Object.keys(PROVIDERS_META);
  const resolvedProviderKey =
    providerKey || pks[resolveQuickApiKeyProviderIndex()];
  _resetSettingsState();
  sCursor = Math.max(0, pks.indexOf(resolvedProviderKey));
  screen = "settings";
  sEditing = true;

  const meta = PROVIDERS_META[resolvedProviderKey];
  if (meta?.signupUrl && !getApiKey(config, resolvedProviderKey)) {
    openBrowser(meta.signupUrl);
    sNotice = `${D}Opened ${meta.name} key page in browser${R}`;
  }

  renderWithAuthority("settings-open");
}

function maybeAutoOpenSettingsSignup(providerKey: string) {
  if (!providerKey || sAutoOpenedPk === providerKey) return;

  const meta = PROVIDERS_META[providerKey];
  if (!meta?.signupUrl || getApiKey(config, providerKey)) return;

  openBrowser(meta.signupUrl);
  sAutoOpenedPk = providerKey;
  sNotice = `${D}Opened ${meta.name} key page in browser${R}`;
}

function handleMain(ch: string) {
  // Search mode: intercept all input
  if (searchMode) {
    let needsRefilter = false;
    if (ch === "\x1b") {
      resetSearchState();
      needsRefilter = true;
    } else if (ch === "\r") {
      if (quickApplySelectionToTargets()) {
        return;
      }
      searchMode = false;
    } else if (ch === "\x7f") {
      searchQuery = searchQuery.slice(0, -1);
      needsRefilter = true;
    } else if (ch === UP) {
      searchTabScrolled = true;
      navigate(cursor - 1);
    } else if (ch === DOWN) {
      searchTabScrolled = true;
      navigate(cursor + 1);
    } else if (ch.length === 1 && ch >= " ") {
      searchQuery += ch;
      needsRefilter = true;
    }

    if (needsRefilter) applyFilters();
    throttledRender();
    return;
  }

  // Navigation
  if (ch === UP || ch === "k") {
    navigate(cursor - 1);
  } else if (ch === DOWN || ch === "j") {
    navigate(cursor + 1);
  } else if (ch === PGUP) {
    navigate(cursor - tRows());
  } else if (ch === PGDN) {
    navigate(cursor + tRows());
  } else if (ch === "g" || ch === HOME) {
    navigate(0);
  } else if (ch === "G" || ch === END) {
    navigate(maxCursorIndex());
  }

  // Actions
  else if (ch === "/") {
    enterSearchMode();
  } else if (ch === "\r") {
    enterTargetPickerFromSelection();
  } else if (ch === "p" || ch === "P") {
    searchMode = false;
    _resetSettingsState();
    screen = "settings";
    maybeAutoOpenSettingsSignup(Object.keys(PROVIDERS_META)[sCursor] || "");
    renderWithAuthority("settings-open");
    return;
  } else if (ch === "a" || ch === "A") {
    openApiKeyEditorFromMain();
    return;
  } else if (ch === "r" || ch === "R") {
    const expired = findExpiredProvider();
    if (expired) {
      openApiKeyEditorFromMain(expired);
    } else {
      // Fall back to current model's provider or first provider
      const sel = filtered[cursor];
      const pk = sel?.providerKey || Object.keys(PROVIDERS_META)[0];
      openApiKeyEditorFromMain(pk);
    }
    return;
  } else if (ch === "?") {
    screen = "help";
  } else if (ch === "q") {
    cleanup();
    process.exit(0);
  } else if (ch === "t" || ch === "T") {
    tierFilter =
      TIER_CYCLE[(TIER_CYCLE.indexOf(tierFilter) + 1) % TIER_CYCLE.length];
    applyFilters();
  } else if (ch === "w" || ch === "W") {
    pingMs = Math.max(1000, pingMs - 1000);
    restartLoop();
  } else if (ch === "x" || ch === "X") {
    pingMs = Math.min(30000, pingMs + 1000);
    restartLoop();
  }

  // Number-key sorting (0-9)
  else {
    const sortDef = SORT_COLS.find((s) => s.key === ch);
    if (sortDef) toggleSort(sortDef.col);
  }

  throttledRender();
}

function toggleSort(col: string) {
  if (sortCol === col) sortAsc = !sortAsc;
  else {
    sortCol = col;
    sortAsc = true;
  }
  applyFilters();
}

function handleSettings(ch: string) {
  const pks = Object.keys(PROVIDERS_META);
  const currentPk = pks[sCursor];
  const currentMeta = PROVIDERS_META[currentPk];

  if (sEditing) {
    if (ch === "\x1b") {
      sEditing = false;
      sKeyBuf = "";
    } else if (ch === "\r") {
      config.apiKeys ??= {};
      if (sKeyBuf) {
        const checked = validateProviderApiKey(currentPk, sKeyBuf);
        if (!checked.ok) {
          sNotice = `${RED}Invalid key for ${currentMeta.name}: ${checked.reason}${R}`;
          renderWithAuthority("settings-ui");
          return;
        }
        config.apiKeys[currentPk] = checked.key!;
        sNotice = `${GREEN}Saved ${currentMeta.name} key${R}`;
      } else {
        delete config.apiKeys[currentPk];
        sNotice = `${YELLOW}Removed ${currentMeta.name} key${R}`;
      }
      saveConfig(config);
      sEditing = false;
      sKeyBuf = "";
    } else if (ch === "\x7f") {
      sKeyBuf = sKeyBuf.slice(0, -1);
    } else if (ch.length === 1 && ch >= " ") {
      sKeyBuf += ch;
    }
    renderWithAuthority("settings-ui");
    return;
  }

  if (ch === "\x1b" || ch === "q") {
    screen = "main";
    renderWithAuthority("settings-exit");
    void refreshModels().then(() => {
      restartLoop();
      renderWithAuthority("refresh-complete");
    });
    return;
  } else if (ch === UP || ch === "k" || ch === "K") {
    sCursor = Math.max(0, sCursor - 1);
    maybeAutoOpenSettingsSignup(pks[sCursor]);
  } else if (ch === DOWN || ch === "j" || ch === "J") {
    sCursor = Math.min(pks.length - 1, sCursor + 1);
    maybeAutoOpenSettingsSignup(pks[sCursor]);
  } else if (ch === " ") {
    config.providers ??= {};
    config.providers[currentPk] ??= { enabled: true };
    config.providers[currentPk].enabled = !(
      config.providers[currentPk].enabled !== false
    );
    saveConfig(config);
    sNotice = "";
  } else if (ch === "\r") {
    sEditing = true;
    sKeyBuf = "";
    sNotice = "";
  } else if (ch === "d" || ch === "D") {
    if (config.apiKeys?.[currentPk]) {
      delete config.apiKeys[currentPk];
      saveConfig(config);
      sNotice = `${YELLOW}Removed ${currentMeta.name} key${R}`;
    }
  } else if (ch === "t" || ch === "T") {
    const key = getApiKey(config, currentPk);
    sTestRes[currentPk] = "testing…";
    renderWithAuthority("settings-test");
    void ping(key, currentMeta.testModel, currentMeta.chatUrl).then((r) => {
      const msPart = Number.isFinite(r.ms) ? `${r.ms}ms ` : "";
      const ok = r.code === "200" || r.code === "401";
      sTestRes[currentPk] = `${msPart}${r.code} ${ok ? "✓" : "✗"}`;
      renderWithAuthority("settings-test");
    });
    return;
  }

  renderWithAuthority("settings-ui");
}

// ─── Raw input dispatcher ──────────────────────────────────────────────────────
// Buffer escape sequences: if \x1b arrives alone, wait 50ms to see if [ follows.
let escBuf = "";
let escTimer: ReturnType<typeof setTimeout> | null = null;
// Throttled rendering: cap at ~30fps to prevent terminal overwhelm during rapid input.
// Ensures smooth scrolling instead of freeze-then-jump when holding arrow keys.
let _lastRenderTime = 0;
let _renderTimer: ReturnType<typeof setTimeout> | null = null;
const RENDER_INTERVAL_MS = 33; // ~30fps

function throttledRender() {
  const now = Date.now();
  if (now - _lastRenderTime >= RENDER_INTERVAL_MS) {
    // Enough time has passed — render immediately
    if (_renderTimer) {
      clearTimeout(_renderTimer);
      _renderTimer = null;
    }
    _lastRenderTime = now;
    renderWithAuthority("throttled");
  } else if (!_renderTimer) {
    // Schedule a trailing render so the final cursor position is always shown
    _renderTimer = setTimeout(
      () => {
        _renderTimer = null;
        _lastRenderTime = Date.now();
        renderWithAuthority("throttled");
      },
      RENDER_INTERVAL_MS - (now - _lastRenderTime),
    );
  }
}

// Split a multi-byte chunk into individual escape sequences and plain chars.
// E.g. "\x1b[B\x1b[B\x1b[Bx" → ["\x1b[B", "\x1b[B", "\x1b[B", "x"]
function splitEscapeSequences(s: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\x1b" && i + 1 < s.length && s[i + 1] === "[") {
      // CSI sequence: \x1b[ followed by parameter bytes (0-9;) then a final byte (@-~)
      let j = i + 2;
      // Parameter bytes: digits and semicolons (handles multi-param like \x1b[38;5;214m)
      while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ";"))
        j++;
      if (j < s.length) j++; // consume final byte (A, B, ~, H, F, m, M, etc.)
      result.push(s.slice(i, j));
      i = j;
    } else if (s[i] === "\x1b") {
      // Bare escape — take just the ESC
      result.push("\x1b");
      i++;
    } else {
      result.push(s[i]);
      i++;
    }
  }
  return result;
}

function flushEsc() {
  const buf = escBuf;
  escBuf = "";
  escTimer = null;
  dispatch(buf);
}

function onData(raw: Buffer | string) {
  const ch = String(raw);
  if (ch.length > 1) {
    if (escTimer) {
      clearTimeout(escTimer);
      escBuf = "";
      escTimer = null;
    }
    const seqs = splitEscapeSequences(ch);
    for (const seq of seqs) dispatch(seq);
    return;
  }
  if (ch === "\x1b") {
    if (escTimer) {
      clearTimeout(escTimer);
      dispatch("\x1b");
    }
    escBuf = "\x1b";
    escTimer = setTimeout(flushEsc, 50);
    return;
  }
  if (escBuf) {
    escBuf += ch;
    // Complete sequences: \x1b[A (3 chars), \x1b[5~ (4 chars)
    if (
      escBuf.length >= 3 &&
      escBuf.at(-1) !== "[" &&
      !escBuf.endsWith("\x1b[")
    ) {
      // Check if we need more chars (e.g. \x1b[5 needs the trailing ~)
      if (escBuf.length === 3 && escBuf[2] >= "0" && escBuf[2] <= "9") {
        return; // wait for one more char
      }
      if (escTimer) clearTimeout(escTimer);
      const buf = escBuf;
      escBuf = "";
      escTimer = null;
      dispatch(buf);
    }
    return;
  }
  dispatch(ch);
}

function dispatch(ch: string) {
  if (ch === "\x03") {
    cleanup();
    process.exit(0);
  }

  if (screen === "help") {
    screen = "main";
    renderWithAuthority("help-close");
    return;
  }

  if (screen === "main") handleMain(ch);
  else if (screen === "settings") handleSettings(ch);
}

// ─── Model management ──────────────────────────────────────────────────────────
const PING_STATE_KEYS = [
  "pings",
  "status",
  "httpCode",
  "_metrics",
  "_consecutiveFails",
  "_skipUntilRound",
  "_seqEpoch",
  "_nextSeq",
  "_lastCommitEpoch",
  "_lastCommitSeq",
  "_staleCommitDrops",
];

function modelKey(m: Model) {
  return `${m.providerKey}|${m.id}`;
}

async function refreshModels() {
  const fresh = await getAllModels(config);
  const byKey = new Map(models.map((m) => [modelKey(m), m]));
  models = fresh.map((m) => {
    const existing = byKey.get(modelKey(m));
    if (!existing) return m;
    const preserved: Partial<Model> = {};
    for (const k of PING_STATE_KEYS)
      (preserved as Record<string, unknown>)[k] = (
        existing as Record<string, unknown>
      )[k];
    return { ...m, ...preserved };
  });
  applyFilters();
}

// ─── Throttled per-ping render (no re-sort, just refresh visible data) ───────
let _lastPingRender = 0;
const PING_RENDER_THROTTLE_MS = 300;

function onPingTick() {
  // Don't re-sort mid-round — just throttle-render current positions
  // so status dots / latency update in-place without row jumping.
  if (screen !== "main") return;
  const now = performance.now();
  if (now - _lastPingRender < PING_RENDER_THROTTLE_MS) return;
  _lastPingRender = now;
  renderWithAuthority("onPingTick");
}

function restartLoop() {
  bumpPingEpoch();
  stopPingLoop(pingRef);
  pingRef = startPingLoop(
    models,
    config,
    pingMs,
    () => {
      // End-of-round: freeze re-sorting while the user is actively navigating.
      if (!isAutoSortPaused()) applyFilters();
      if (screen === "main") renderWithAuthority("round-complete");
    },
    onPingTick,
  );
}

// ─── Ink sub-app lifecycle helpers ─────────────────────────────────────────────
// Used by runInkSubApp hooks to safely transition between raw ANSI and Ink rendering.

function prepareForInkSubApp() {
  process.stdin.removeListener("data", onData);
  if (escTimer) {
    clearTimeout(escTimer);
    escTimer = null;
  }
  escBuf = "";
  if (_renderTimer) {
    clearTimeout(_renderTimer);
    _renderTimer = null;
  }
  screen = "ink-subapp";
  stopPingLoop(pingRef);
  // Don't change raw mode — the harness manages stdin via a proxy stream.
  w(ALT_OFF + SHOWC);
}

function restoreAfterInkSubApp(returnScreen = "main") {
  w(ALT_ON + HIDEC);
  // The harness manages stdin directly (proxy pattern), so process.stdin
  // is still in raw/flowing/data-listener mode from prepareForInkSubApp's teardown.
  // We just need to re-attach our handler and restore raw mode.
  try {
    process.stdin.setRawMode(true);
  } catch {
    /* best-effort */
  }
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onData);
  process.stdin.resume();
  screen = returnScreen;
  renderWithAuthority("settings-exit");
}

// ─── Update check ────────────────────────────────────────────────────────────
const REGISTRY_URL =
  readEnv("FREE_ROUTER_REGISTRY_URL", "FROUTER_REGISTRY_URL") ||
  "https://registry.npmjs.org/@jyoung105%2ffree-router/latest";
const UPDATE_SKIP_ONCE_ENV = "FREE_ROUTER_SKIP_UPDATE_ONCE";
const LEGACY_UPDATE_SKIP_ONCE_ENV = "FROUTER_SKIP_UPDATE_ONCE";
const OPEN_SEARCH_ON_START_ENV = "FREE_ROUTER_OPEN_SEARCH_ON_START";
const LEGACY_OPEN_SEARCH_ON_START_ENV = "FROUTER_OPEN_SEARCH_ON_START";
const UPDATE_PACKAGE_NAME = "@jyoung105/free-router";
const GITHUB_REPO_URL = "https://github.com/jyoung105/free-router";

type UpdateInstallCommand = {
  bin: string;
  args: string[];
};

function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 1000);
    const getter = REGISTRY_URL.startsWith("http://") ? httpGet : httpsGet;
    const req = getter(
      REGISTRY_URL,
      { headers: { Accept: "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          clearTimeout(timeout);
          try {
            resolve(JSON.parse(data).version || null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

function promptYesNo(question: string, defaultValue = false): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  return new Promise((resolve) => {
    process.stdout.write(question);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    function finish(answer: boolean, echo = "") {
      process.stdin.removeListener("data", handler);
      try {
        process.stdin.setRawMode(wasRaw || false);
      } catch {
        /* best-effort */
      }
      process.stdout.write(`${echo}\n`);
      resolve(answer);
    }

    function handler(ch: string) {
      if (!ch) return;
      if (ch === "\x03") {
        finish(false);
        process.exit(0);
      } // Ctrl+C
      if (ch === "\x1b") {
        finish(false);
        return;
      } // ESC = no

      const yn = ch.toLowerCase().match(/[yn]/);
      if (yn) {
        finish(yn[0] === "y", yn[0]);
        return;
      }
      if (ch.includes("\r") || ch.includes("\n")) {
        finish(defaultValue);
      }
    }
    process.stdin.on("data", handler);
  });
}

function promptGithubStarSupport(): Promise<boolean> {
  return promptYesNo(`${D}  Support for github star: [Y/n] ${R}`, true);
}

function readHighestPercent(text: string): number | null {
  let highest = -1;
  for (const match of text.matchAll(/(\d{1,3})%/g)) {
    const pct = Number.parseInt(match[1], 10);
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
      highest = Math.max(highest, pct);
    }
  }
  return highest >= 0 ? highest : null;
}

function semverParts(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isStrictlyNewerVersion(current: string, latest: string): boolean {
  const c = semverParts(current);
  const l = semverParts(latest);
  if (!c || !l) return latest !== current;

  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return true;
    if (l[i] < c[i]) return false;
  }
  return false;
}

function hasCommand(bin: string): boolean {
  const probe = spawnSync(bin, ["--version"], {
    stdio: "ignore",
    env: process.env,
  });
  return !probe.error && probe.status === 0;
}

type UpdateInstaller = "npm" | "bun";

function inferPreferredUpdateInstaller(): UpdateInstaller | null {
  const ua = String(process.env.npm_config_user_agent || "").toLowerCase();
  if (ua.startsWith("bun/")) return "bun";
  if (ua.startsWith("npm/")) return "npm";

  const runtimeBin = basename(process.execPath).toLowerCase();
  if (runtimeBin.includes("bun")) return "bun";

  const rawHints = [process.argv[1], process.env._, process.env.npm_execpath];
  let resolvedArgvPath: string;
  try {
    resolvedArgvPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
  } catch {
    resolvedArgvPath = "";
  }
  rawHints.push(resolvedArgvPath);

  const hints = rawHints
    .map((hint) => String(hint || "").toLowerCase())
    .filter(Boolean);
  for (const hint of hints) {
    if (
      hint.includes("/.bun/") ||
      hint.includes("\\.bun\\") ||
      hint.includes("/bun/install/") ||
      hint.includes("\\bun\\install\\")
    ) {
      return "bun";
    }
    if (hint.includes("/node_modules/") || hint.includes("\\node_modules\\")) {
      return "npm";
    }
  }
  return null;
}

function detectUpdateInstallCommand(): UpdateInstallCommand | null {
  const npmCommand: UpdateInstallCommand = {
    bin: "npm",
    args: ["install", "-g", UPDATE_PACKAGE_NAME],
  };
  const bunCommand: UpdateInstallCommand = {
    bin: "bun",
    args: ["install", "-g", UPDATE_PACKAGE_NAME],
  };

  const preferred = inferPreferredUpdateInstaller();
  const candidates =
    preferred === "bun"
      ? [bunCommand, npmCommand]
      : preferred === "npm"
        ? [npmCommand, bunCommand]
        : [npmCommand, bunCommand];

  for (const candidate of candidates) {
    if (hasCommand(candidate.bin)) return candidate;
  }
  return null;
}

function restartAfterUpdate(extraEnv: NodeJS.ProcessEnv = {}): boolean {
  const restarted = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, [UPDATE_SKIP_ONCE_ENV]: "1", ...extraEnv },
  });
  if (restarted.error) return false;
  if (restarted.signal) process.exit(1);
  process.exit(restarted.status ?? 0);
}

async function runUpdateApp(
  latest: string,
): Promise<"skipped" | "updated" | "failed"> {
  const [{ render }, React, { UpdateApp }] = await Promise.all([
    import("ink"),
    import("react"),
    import("../tui/UpdateApp.js"),
  ]);

  return new Promise((resolve) => {
    let resolved = false;
    const element = React.createElement(UpdateApp, {
      currentVersion: PKG_VERSION,
      latestVersion: latest,
      detectInstallCommand: detectUpdateInstallCommand,
      readHighestPercent,
      onDone: (result: "skipped" | "updated" | "failed") => {
        if (resolved) return;
        resolved = true;
        instance.unmount();
        resolve(result);
      },
    });
    const instance = render(element, { exitOnCtrlC: false });
  });
}

async function checkForUpdate(): Promise<void> {
  if (readEnv(UPDATE_SKIP_ONCE_ENV, LEGACY_UPDATE_SKIP_ONCE_ENV) === "1") return;

  const latest = await fetchLatestVersion();
  if (!latest || !isStrictlyNewerVersion(PKG_VERSION, latest)) return;

  if (!detectUpdateInstallCommand()) {
    process.stdout.write(
      `\n${YELLOW}  Update available: ${D}${PKG_VERSION}${R} \u2192 ${GREEN}${latest}${R}${D} (no supported updater)${R}\n\n`,
    );
    return;
  }

  if (!process.stdin.isTTY) {
    process.stdout.write(
      `\n${YELLOW}  Update available: ${D}${PKG_VERSION}${R} \u2192 ${GREEN}${latest}${R}${D} (run interactively to update)${R}\n\n`,
    );
    return;
  }

  const result = await runUpdateApp(latest);
  if (result === "skipped") {
    process.stdout.write(`${D}  Skipped update.${R}\n\n`);
    return;
  }
  if (result === "failed") {
    process.stdout.write(
      `${RED}  \u2717 Update failed. Run manually: npm install -g free-router${R}\n${D}    (or: bun install -g free-router)${R}\n\n`,
    );
    return;
  }

  if (!starPromptHandledThisLaunch) {
    const support = await promptGithubStarSupport();
    if (support) handleGithubStarAccepted();
    else handleGithubStarDeclined();
  }
  process.stdout.write(
    `${GREEN}  \u2713 Updated to ${latest}. Restarting free-router now...${R}\n\n`,
  );
  const restartEnv = startupSearchRequestedThisLaunch
    ? { [OPEN_SEARCH_ON_START_ENV]: "1" }
    : {};
  if (restartAfterUpdate(restartEnv)) return;
  process.stdout.write(
    `${YELLOW}  ! Update finished, but restart failed. Run free-router manually to use ${latest}.${R}\n\n`,
  );
}

// ─── Cleanup ───────────────────────────────────────────────────────────────────
function cleanup() {
  stopPingLoop(pingRef);
  destroyAgents();
  if (renderAuthorityViolations > 0) {
    process.stderr.write(
      `[free-router] render authority violations: ${renderAuthorityViolations}\n`,
    );
  }
  w(SHOWC + ALT_OFF);
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    /* best-effort */
  }
}

process.on("exit", () => w(SHOWC + ALT_OFF));

// ─── --best mode ───────────────────────────────────────────────────────────────
async function runBest() {
  config = loadConfig();
  const hasKeys = Object.keys(PROVIDERS_META).some((providerKey) =>
    Boolean(getApiKey(config, providerKey)),
  );
  if (!hasKeys) {
    process.stderr.write(
      "No API keys configured. Run `free-router` to set up keys.\n",
    );
    process.exit(1);
  }

  models = await getAllModels(config);
  if (!models.length) {
    process.stderr.write("No enabled models available to test.\n");
    process.exit(1);
  }

  const MAX_ROUNDS = 4;
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const upCount = models.filter((m) => m.status === "up").length;
    process.stderr.write(
      `  Round ${i + 1}/${MAX_ROUNDS}… ${upCount} up of ${models.length}\n`,
    );
    await pingAllOnce(models, config);

    // Phase 3I: stop early if we have a clear winner after 2+ rounds
    if (i >= 1) {
      const candidate = findBestModel(models);
      if (candidate && candidate.pings.length >= 2 && getAvg(candidate) < 500) {
        process.stderr.write(`  Early stop — clear winner found.\n`);
        break;
      }
    }
  }

  const upFinal = models.filter((m) => m.status === "up").length;
  process.stderr.write(`  Done. ${upFinal} models responding.\n`);

  destroyAgents();
  const best = findBestModel(models);
  if (!best) {
    process.stderr.write("No models responded.\n");
    process.exit(1);
  }
  process.stdout.write(`${best.providerKey}/${best.id}\n`);
  process.exit(0);
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (BEST) {
    await runBest();
    return;
  }

  config = loadConfig();
  userScrollSortPauseMs = resolveUserScrollSortPauseMs(config);

  if (!Object.keys(config.apiKeys || {}).length && process.stdin.isTTY) {
    const outcome = await runFirstRunWizard(config);
    config = outcome.config;
    if (outcome.starPromptHandled) starPromptHandledThisLaunch = true;
    if (outcome.startupSearchRequested) startupSearchRequestedThisLaunch = true;
  }

  await checkForUpdate();

  if (!process.stdin.isTTY) {
    process.stderr.write("free-router requires an interactive terminal.\n");
    process.exit(1);
  }

  w(ALT_ON);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onData);

  const onSignal = () => {
    cleanup();
    process.exit(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.stdout.on("resize", () => renderWithAuthority("resize"));

  renderWithAuthority("startup"); // show loading state immediately
  await refreshModels();
  const shouldOpenSearch =
    consumeStartupSearchRequestFromEnv() || startupSearchRequestedThisLaunch;
  startupSearchRequestedThisLaunch = false;
  if (shouldOpenSearch) enterSearchMode();
  restartLoop();
  renderWithAuthority("refresh-complete");
}

main().catch((err) => {
  cleanup();
  console.error("Fatal:", err);
  process.exit(1);
});
