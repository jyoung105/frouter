#!/usr/bin/env node
// src/bin/frouter.ts — frouter main entry: TUI + --best mode
// Zero dependencies — pure Node.js built-ins

import {
  loadConfig,
  saveConfig,
  getApiKey,
  runFirstRunWizard,
  promptMasked,
  PROVIDERS_META,
  validateProviderApiKey,
} from "../lib/config.js";
import { getAllModels } from "../lib/models.js";
import {
  ping,
  pingAllOnce,
  startPingLoop,
  stopPingLoop,
  destroyAgents,
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
} from "../lib/utils.js";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";

// ─── Version ─────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
).version;

// ─── ANSI shortcuts ────────────────────────────────────────────────────────────
const w = (s) => process.stdout.write(String(s));
const CLEAR = "\x1b[2J\x1b[H";
const CURSOR_HOME = "\x1b[H";
const HIDEC = "\x1b[?25l";
const SHOWC = "\x1b[?25h";
const INVERT = "\x1b[7m";
const BG_HDR = "\x1b[48;5;17m";
const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const ALLOW_PLAINTEXT_KEY_EXPORT =
  process.env.FROUTER_EXPORT_PLAINTEXT_KEYS === "1";
const FORCE_FRAME_CLEAR = process.env.FROUTER_TUI_FORCE_CLEAR === "1";

// ─── Parse CLI args ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const BEST = argv.includes("--best");
const HELP = argv.includes("--help") || argv.includes("-h");
const VERSION = argv.includes("--version") || argv.includes("-v");

if (VERSION) {
  console.log(`frouter ${PKG_VERSION}`);
  process.exit(0);
}

if (HELP) {
  console.log(`
  frouter — Free Model Router

  Usage: frouter [flags]

  Flags:
    (none)    Interactive TUI — discover, compare, select
    --best    Non-interactive: print best model ID to stdout after ~10s
    --version Show version
    --help    Show this help

  TUI keys:
    ↑↓ / j k     Navigate models
    PgUp / PgDn   Jump one page
    g / G          Jump to top / bottom
    /              Search (type to filter, ESC to clear)
    Enter          Select model → choose target (OpenClaw currently disabled)
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
let config = null;
let models = [];
let filtered = [];
let cursor = 0;
let scrollOff = 0;
let sortCol = "priority";
let sortAsc = true;
let searchMode = false;
let searchQuery = "";
let tierFilter = "All";
let pingMs = 2000;
let screen = "main"; // 'main' | 'settings' | 'target' | 'help'
let sCursor = 0;
let tCursor = 0;
let selModel = null;
let sEditing = false;
let sKeyBuf = "";
let sTestRes = {};
let sNotice = "";
let tNotice = "";
let pingRef = null;
let userNavigated = false; // true once user actively moves cursor
let autoSortPauseUntil = 0;
const DEFAULT_USER_SCROLL_SORT_PAUSE_MS = 1500;
let userScrollSortPauseMs = DEFAULT_USER_SCROLL_SORT_PAUSE_MS;

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
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
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

function sortArrow(colName) {
  if (sortCol !== colName) return "";
  return sortAsc ? "▲" : "▼";
}

function colHdr(label, colName, width, rightAlign = false) {
  const arrow = sortArrow(colName);
  const text = arrow ? `${label}${arrow}` : label;
  return rightAlign ? text.padStart(width) : text.padEnd(width);
}

// ─── Render helpers ────────────────────────────────────────────────────────────
function fmtCtx(n) {
  if (!n) return "  —  ";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`.padStart(5);
  return `${Math.round(n / 1000)}k`.padStart(5);
}

function fmtMs(ms) {
  if (ms === Infinity || ms == null) return "   — ";
  return `${Math.round(ms)}ms`.padStart(6);
}

function fmtUp(pct, hasPings) {
  if (!hasPings) return "  — ";
  return `${pct}%`.padStart(4);
}

function fmtLatency(ms) {
  if (ms != null) return latColor(ms) + fmtMs(ms) + R;
  return `${D}${fmtMs(null)}${R}`;
}

function fullWidthBar(content, style = INVERT, lastLine = false) {
  const c = cols();
  // Reserve one column on every row. This avoids edge autowrap drift in some
  // terminals (especially with wide glyphs / emoji width differences).
  const guard = lastLine ? Math.max(1, WRAP_GUARD_COLS) : WRAP_GUARD_COLS;
  const maxW = Math.max(0, c - guard);
  const truncated = truncAnsi(content, maxW);
  return `${style}${truncated}${" ".repeat(Math.max(0, maxW - visLen(truncated)))}${R}`;
}

function fullWidthLine(content, lastLine = false) {
  const c = cols();
  const guard = lastLine ? Math.max(1, WRAP_GUARD_COLS) : WRAP_GUARD_COLS;
  const maxW = Math.max(0, c - guard);
  const truncated = truncAnsi(content, maxW);
  return `${truncated}${" ".repeat(Math.max(0, maxW - visLen(truncated)))}`;
}

// Truncate a string with ANSI codes to at most `maxVis` visible columns.
// Preserves escape sequences but stops emitting visible chars once the limit is reached.
function truncAnsi(s: string, maxVis: number): string {
  let vis = 0;
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\x1b") {
      // Copy the entire escape sequence verbatim (zero visible width)
      const start = i;
      i++; // skip ESC
      if (i < s.length && s[i] === "[") {
        i++; // skip [
        while (i < s.length && s[i] >= "\x20" && s[i] <= "\x3f") i++; // params
        if (i < s.length) i++; // final byte
      }
      out += s.slice(start, i);
    } else {
      if (vis >= maxVis) break;
      out += s[i];
      vis++;
      i++;
    }
  }
  return out;
}

const STARTUP_PIXEL_TITLE = [
  "  █████  ████    ███   █   █  █████  █████  ████   ",
  "  █      █   █  █   █  █   █    █    █      █   █  ",
  "  ████   ████   █   █  █   █    █    ████   ████   ",
  "  █      █ █    █   █  █   █    █    █      █ █    ",
  "  █      █  ██   ███    ███     █    █████  █  ██  ",
];

function startupPixelTitleLines() {
  return STARTUP_PIXEL_TITLE.map((line, idx) => {
    if (idx <= 1) return `${B}${line}${R}`;
    if (idx >= 3) return `${D}${line}${R}`;
    return line;
  });
}

function statusDot(model) {
  switch (model.status) {
    case "up":
      return `${GREEN}*${R}`;
    case "noauth":
      return `${YELLOW}!${R}`;
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

// ─── Main TUI ──────────────────────────────────────────────────────────────────
function renderMain() {
  const { c, r } = viewport();
  const tr = Math.max(0, r - CHROME_ROWS);
  if (cursor < scrollOff) scrollOff = cursor;
  if (cursor >= scrollOff + tr) scrollOff = cursor - tr + 1;

  const provStatus = Object.entries(PROVIDERS_META)
    .map(([pk, m]) => {
      const on = config.providers?.[pk]?.enabled !== false;
      return on ? `${GREEN}${m.name}${R}` : `${D}${m.name} off${R}`;
    })
    .join("  ");

  const searchLabel = `${CYAN}${B}[Model Search]${R}`;
  const searchInput = searchMode
    ? `${CYAN}/${searchQuery}_${R}`
    : `${D}Press '/' to search models${R}`;
  const searchHint = searchMode
    ? `${YELLOW}[ESC clear]${R} ${GREEN}[Enter apply]${R}`
    : `${CYAN}[/ start]${R}`;
  const searchBar = `${searchLabel} ${searchInput} ${searchHint}`;

  const tierBar =
    tierFilter !== "All" ? `${YELLOW}tier:${tierFilter}${R}  ` : "";
  const stats = `${D}${filtered.length}/${models.length} models  ${pingMs / 1000}s${R}`;

  let out = (FORCE_FRAME_CLEAR ? CLEAR : CURSOR_HOME) + HIDEC;

  // Header
  const hdrRaw = `${BG_HDR}${WHITE}${B} frouter ${R}  ${provStatus}${R}`;
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
  const isLoading = filtered.length === 0 && models.length === 0;
  if (isLoading) {
    const loadingLines = [
      ...startupPixelTitleLines(),
      `${D}  FROUTER · Free Model Router${R}`,
      `${D}  Loading models…${R}`,
    ];
    for (let i = 0; i < tr; i++) {
      out += truncAnsi(loadingLines[i] ?? "", c) + "\n";
    }
  }
  if (!isLoading) {
    const slice = filtered.slice(scrollOff, scrollOff + tr);
    for (let i = 0; i < tr; i++) {
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
      const latMs = last?.code === "200" ? last.ms : null;
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
  const footer = ` ↑↓/jk:nav  /:focus model search  Enter:target (search Enter=apply OpenCode)  A:api key  P:settings  T:tier  ?:help  0-9:sort  q:quit `;
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
      `${BG_HDR}${WHITE}${B} frouter — Keyboard Reference ${R}\n\n` +
      `${B}  Navigation${R}\n` +
      `  ↑ / k       Move up\n` +
      `  ↓ / j       Move down\n` +
      `  PgUp        Page up\n` +
      `  PgDn        Page down\n` +
      `  g           Jump to top\n` +
      `  G           Jump to bottom\n\n` +
      `${B}  Actions${R}\n` +
      `  Enter       Select model → target picker (OpenCode / OpenClaw disabled)\n` +
      `  /           Focus model search (filter by model name; Enter applies to OpenCode only)\n` +
      `  A           Quick API key add/change (opens key editor)\n` +
      `  T           Cycle tier filter (All → S+ → S → …)\n` +
      `  P           Settings (API keys, toggle providers)\n` +
      `  W / X       Faster / slower ping interval\n` +
      `  q           Quit\n\n` +
      `${B}  Sort (press key to sort, press again to reverse)${R}\n` +
      sortLines +
      "\n" +
      `\n${B}  Target Picker${R}\n` +
      `  Enter       Save config + open selected target (OpenCode only)\n` +
      `  G           Same as Enter\n` +
      `  S           Save config only\n` +
      `  ESC         Cancel\n` +
      `\n${INVERT} Press any key to close ${R}\n`,
  );
}

// ─── Settings screen ───────────────────────────────────────────────────────────
function maskKey(key) {
  const masked = "•".repeat(Math.min(16, Math.max(4, key.length - 8)));
  return `${D}${key.slice(0, 4)}${masked}${key.slice(-4)}${R}`;
}

function renderSettings() {
  let out = CLEAR + HIDEC;
  out += `${BG_HDR}${WHITE}${B} frouter Settings ${R}\n\n`;

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

// ─── Target picker ─────────────────────────────────────────────────────────────
const TARGETS = [
  {
    id: "opencode",
    label: "OpenCode CLI",
    path: "~/.config/opencode/opencode.json",
    enabled: true,
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    path: "~/.openclaw/openclaw.json",
    enabled: false,
  },
];

function renderTarget() {
  const name = selModel?.displayName || selModel?.id || "?";
  const fullId = selModel ? `${selModel.providerKey}/${selModel.id}` : "";
  let out = CLEAR + HIDEC;
  out += `${BG_HDR}${WHITE}${B} Configure: ${name} ${R}\n`;
  out += `${D}  ${fullId}${R}\n\n`;

  for (let i = 0; i < TARGETS.length; i++) {
    const t = TARGETS[i];
    const isSel = i === tCursor;
    const prefix = isSel ? `${B} ❯ ${R}` : "   ";
    const status = t.enabled
      ? `${GREEN}[enabled]${R}`
      : `${YELLOW}[disabled]${R}`;
    out += `${prefix}${pad(t.label, 12)} ${status}  ${D}${t.path}${R}\n`;
  }

  const target = TARGETS[tCursor];
  if (target && !target.enabled) {
    out += `\n${YELLOW} ${target.label} is currently disabled.${R}\n`;
  } else if (tNotice) {
    out += `\n${tNotice}\n`;
  }

  out += `\n${INVERT} Enter:save + open  G:same  S:save only  ESC:cancel ${R}\n`;
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
    case "target":
      renderTarget();
      break;
    case "help":
      renderHelp();
      break;
  }
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

function clampCursor(next) {
  return Math.max(0, Math.min(maxCursorIndex(), next));
}

function parseSortPauseMs(raw: unknown): number {
  if (raw == null || raw === "") return DEFAULT_USER_SCROLL_SORT_PAUSE_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_USER_SCROLL_SORT_PAUSE_MS;
  }
  return Math.round(parsed);
}

function resolveUserScrollSortPauseMs(cfg: any): number {
  // Env overrides config so users can tune behavior per terminal/session.
  if (process.env.FROUTER_SCROLL_SORT_PAUSE_MS != null) {
    return parseSortPauseMs(process.env.FROUTER_SCROLL_SORT_PAUSE_MS);
  }
  return parseSortPauseMs(cfg?.ui?.scrollSortPauseMs);
}

function noteUserNavigation() {
  userNavigated = true;
  autoSortPauseUntil = Date.now() + userScrollSortPauseMs;
}

function isAutoSortPaused() {
  return Date.now() < autoSortPauseUntil;
}

function resetSearchState() {
  searchMode = false;
  searchQuery = "";
  cursor = 0;
  scrollOff = 0;
}

function resetSettingsState() {
  sEditing = false;
  sKeyBuf = "";
  sNotice = "";
  sTestRes = {};
}

function enterTargetPickerFromSelection() {
  if (!filtered.length) return false;
  selModel = filtered[cursor];
  tCursor = 0;
  tNotice = "";
  searchMode = false;
  screen = "target";
  return true;
}

function resolveOpenCodeApplySelection(selectedModel) {
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

function getOpenCodeAuthHint(providerKey, apiKey, { launch = false } = {}) {
  const envVar = PROVIDERS_META[providerKey]?.envVar;
  if (!envVar || ALLOW_PLAINTEXT_KEY_EXPORT) return "";
  if (!apiKey) {
    if (launch) return "";
    return `${YELLOW} ! OpenCode auth missing: ${envVar}. Configure key in Settings (P) before launching.${R}`;
  }
  if (launch || process.env[envVar]) return "";
  return `${YELLOW} ! OpenCode auth uses ${envVar}. Export it before launching opencode outside frouter.${R}`;
}

function buildOpenCodeLaunchEnv(providerKey, apiKey) {
  const launchEnv = { ...process.env };
  const envVar = PROVIDERS_META[providerKey]?.envVar;
  if (apiKey && envVar) {
    launchEnv[envVar] = apiKey;
  }
  return launchEnv;
}

async function promptYesNoFromTarget(question: string): Promise<boolean> {
  process.stdin.removeListener("data", onData);
  try {
    return await promptYesNo(question);
  } finally {
    process.stdin.on("data", onData);
  }
}

async function promptInstallOpenCode() {
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
  if (!filtered.length) return false;
  selModel = filtered[cursor];
  searchMode = false;

  const { openCodeModel, openCodePk, openCodeApiKey, notice } =
    resolveOpenCodeApplySelection(selModel);

  let ok = true;

  try {
    if (notice) w(`${notice}\n`);
    const ocPath = writeOpenCode(openCodeModel, openCodePk, openCodeApiKey, {
      persistApiKey: ALLOW_PLAINTEXT_KEY_EXPORT,
    });
    w(
      `\n${GREEN} ✓ OpenCode model set → ${openCodePk}/${openCodeModel.id}${R}\n${D}   ${ocPath}${R}\n`,
    );
    const authHint = getOpenCodeAuthHint(openCodePk, openCodeApiKey);
    if (authHint) w(`${authHint}\n`);
    if (!isOpenCodeInstalled()) {
      w(
        `${YELLOW} ! opencode CLI is not installed. Install it to use this config.${R}\n`,
      );
    }
  } catch (err) {
    ok = false;
    w(`\n${RED} ✗ OpenCode write failed: ${err.message}${R}\n`);
  }

  setTimeout(
    () => {
      screen = "main";
      render();
    },
    ok ? 1400 : 2000,
  );
  return true;
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

function openApiKeyEditorFromMain() {
  stopPingLoop(pingRef);
  sCursor = resolveQuickApiKeyProviderIndex();
  resetSettingsState();
  sEditing = true;
  searchMode = false;
  screen = "settings";
}

function handleMain(ch) {
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
      noteUserNavigation();
      cursor = Math.max(0, cursor - 1);
    } else if (ch === DOWN) {
      noteUserNavigation();
      cursor = clampCursor(cursor + 1);
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
    noteUserNavigation();
    cursor = Math.max(0, cursor - 1);
  } else if (ch === DOWN || ch === "j") {
    noteUserNavigation();
    cursor = clampCursor(cursor + 1);
  } else if (ch === PGUP) {
    noteUserNavigation();
    cursor = Math.max(0, cursor - tRows());
  } else if (ch === PGDN) {
    noteUserNavigation();
    cursor = clampCursor(cursor + tRows());
  } else if (ch === "g" || ch === HOME) {
    noteUserNavigation();
    cursor = 0;
  } else if (ch === "G" || ch === END) {
    noteUserNavigation();
    cursor = maxCursorIndex();
  }

  // Actions
  else if (ch === "/") {
    resetSearchState();
    searchMode = true;
    applyFilters();
  } else if (ch === "\r") {
    enterTargetPickerFromSelection();
  } else if (ch === "p" || ch === "P") {
    stopPingLoop(pingRef);
    sCursor = 0;
    resetSettingsState();
    screen = "settings";
  } else if (ch === "a" || ch === "A") {
    openApiKeyEditorFromMain();
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

function toggleSort(col) {
  if (sortCol === col) sortAsc = !sortAsc;
  else {
    sortCol = col;
    sortAsc = true;
  }
  applyFilters();
}

function handleSettings(ch) {
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
          render();
          return;
        }
        config.apiKeys[currentPk] = checked.key;
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
    render();
    return;
  }

  if (ch === "\x1b" || ch === "q") {
    screen = "main";
    render();
    void refreshModels().then(() => {
      restartLoop();
      render();
    });
    return;
  } else if (ch === UP) {
    sCursor = Math.max(0, sCursor - 1);
  } else if (ch === DOWN) {
    sCursor = Math.min(pks.length - 1, sCursor + 1);
  } else if (ch === " ") {
    config.providers ??= {};
    config.providers[currentPk] ??= {};
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
    render();
    void ping(key, currentMeta.testModel, currentMeta.chatUrl).then((r) => {
      sTestRes[currentPk] = r.code === "200" ? `${r.ms}ms ✓` : `${r.code} ✗`;
      render();
    });
    return;
  }

  render();
}

async function handleTarget(ch) {
  if (ch === "\x1b" || ch === "q") {
    screen = "main";
    tNotice = "";
    render();
    return;
  } else if (ch === UP) {
    tCursor = Math.max(0, tCursor - 1);
    tNotice = "";
  } else if (ch === DOWN) {
    tCursor = Math.min(TARGETS.length - 1, tCursor + 1);
    tNotice = "";
  }

  // Enter/G = write config + open target; S = write config only
  if (ch === "\r" || ch === "g" || ch === "G" || ch === "s" || ch === "S") {
    const target = TARGETS[tCursor];
    if (!target?.enabled) {
      tNotice = `${YELLOW} ${target?.label || "This target"} is currently disabled.${R}`;
      render();
      return;
    }

    const launch = !(ch === "s" || ch === "S");
    const { openCodeModel, openCodePk, openCodeApiKey, notice } =
      resolveOpenCodeApplySelection(selModel);

    if (launch && !openCodeApiKey) {
      const meta = PROVIDERS_META[openCodePk];
      const envVar = meta?.envVar || "API key";

      w(
        `\n${YELLOW} ! Missing ${meta?.name || openCodePk} API key (${envVar}).${R}\n`,
      );
      if (notice) w(`${notice}\n`);

      const proceed = await promptYesNoFromTarget(
        `${D}   Launch opencode anyway? (Y/n, default: n): ${R}`,
      );
      if (!proceed) {
        tNotice = `${YELLOW} Launch cancelled. Set ${envVar} in Settings (P), then retry.${R}`;
        render();
        return;
      }
    }

    if (launch && !isOpenCodeInstalled()) {
      cleanup();
      const installed = await promptInstallOpenCode();
      if (!installed) {
        process.exit(0);
      }
    }

    try {
      if (notice) w(`\n${notice}\n`);
      const writtenPath = writeOpenCode(
        openCodeModel,
        openCodePk,
        openCodeApiKey,
        {
          persistApiKey: ALLOW_PLAINTEXT_KEY_EXPORT,
        },
      );
      w(`\n${GREEN} ✓ OpenCode config written → ${writtenPath}${R}\n`);
      if (launch) {
        cleanup();
        const launchEnv = buildOpenCodeLaunchEnv(openCodePk, openCodeApiKey);
        const result = spawnSync("opencode", [], {
          stdio: "inherit",
          shell: true,
          env: launchEnv,
        });
        const code = Number.isInteger(result.status) ? result.status : 1;
        process.exit(code);
      }
      const authHint = getOpenCodeAuthHint(openCodePk, openCodeApiKey, {
        launch,
      });
      if (authHint) w(`${authHint}\n`);
      if (!launch && !isOpenCodeInstalled()) {
        w(
          `${YELLOW} ! opencode CLI is not installed. Install it to use this config.${R}\n`,
        );
      }
    } catch (err) {
      w(`\n${RED} ✗ ${err.message}${R}\n`);
    }

    setTimeout(
      () => {
        screen = "main";
        render();
      },
      launch ? 2000 : 1400,
    );
    return;
  }

  render();
}

// ─── Raw input dispatcher ──────────────────────────────────────────────────────
// Buffer escape sequences: if \x1b arrives alone, wait 50ms to see if [ follows.
let escBuf = "";
let escTimer = null;
// Throttled rendering: cap at ~30fps to prevent terminal overwhelm during rapid input.
// Ensures smooth scrolling instead of freeze-then-jump when holding arrow keys.
let _lastRenderTime = 0;
let _renderTimer = null;
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
    render();
  } else if (!_renderTimer) {
    // Schedule a trailing render so the final cursor position is always shown
    _renderTimer = setTimeout(
      () => {
        _renderTimer = null;
        _lastRenderTime = Date.now();
        render();
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

function onData(raw) {
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
      clearTimeout(escTimer);
      const buf = escBuf;
      escBuf = "";
      escTimer = null;
      dispatch(buf);
    }
    return;
  }
  dispatch(ch);
}

function dispatch(ch) {
  if (ch === "\x03") {
    cleanup();
    process.exit(0);
  }

  if (screen === "help") {
    screen = "main";
    render();
    return;
  }

  if (screen === "main") handleMain(ch);
  else if (screen === "settings") handleSettings(ch);
  else if (screen === "target") handleTarget(ch).catch(() => {});
}

// ─── Model management ──────────────────────────────────────────────────────────
const PING_STATE_KEYS = [
  "pings",
  "status",
  "httpCode",
  "_consecutiveFails",
  "_skipUntilRound",
];

function modelKey(m) {
  return `${m.providerKey}|${m.id}`;
}

async function refreshModels() {
  const fresh = await getAllModels(config);
  const byKey = new Map(models.map((m) => [modelKey(m), m]));
  models = fresh.map((m) => {
    const existing = byKey.get(modelKey(m));
    if (!existing) return m;
    const preserved = {};
    for (const k of PING_STATE_KEYS) preserved[k] = existing[k];
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
  render();
}

function restartLoop() {
  stopPingLoop(pingRef);
  pingRef = startPingLoop(
    models,
    config,
    pingMs,
    () => {
      // End-of-round: freeze re-sorting while the user is actively navigating.
      if (!isAutoSortPaused()) applyFilters();
      if (screen === "main") render();
    },
    onPingTick,
  );
}

// ─── Update check ────────────────────────────────────────────────────────────
const REGISTRY_URL =
  process.env.FROUTER_REGISTRY_URL ||
  "https://registry.npmjs.org/frouter-cli/latest";

function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 3000);
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

const UPDATE_BAR_WIDTH = 24;

function renderUpdateProgress(percent: number): void {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((pct / 100) * UPDATE_BAR_WIDTH);
  const bar =
    `${"█".repeat(filled)}${"░".repeat(Math.max(0, UPDATE_BAR_WIDTH - filled))}`;
  process.stdout.write(
    `\r${D}  Updating frouter-cli [${bar}] ${String(pct).padStart(3)}%${R}`,
  );
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

async function runNpmGlobalUpdate(): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let progress = 0;

    function finish(ok: boolean) {
      if (done) return;
      done = true;
      process.stdout.write("\n");
      resolve(ok);
    }

    function setProgress(next: number) {
      const pct = Math.max(progress, Math.min(100, Math.round(next)));
      if (pct === progress) return;
      progress = pct;
      renderUpdateProgress(progress);
    }

    renderUpdateProgress(progress);

    const child = spawn("npm", ["install", "-g", "frouter-cli"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    const fallback = setInterval(() => {
      if (progress < 95) setProgress(progress + 1);
    }, 120);

    const onChunk = (chunk: string | Buffer) => {
      const highest = readHighestPercent(String(chunk));
      if (highest != null) setProgress(Math.min(highest, 99));
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);

    child.on("error", () => {
      clearInterval(fallback);
      finish(false);
    });

    child.on("close", (code) => {
      clearInterval(fallback);
      if (code === 0) {
        setProgress(100);
        finish(true);
        return;
      }
      finish(false);
    });
  });
}

async function checkForUpdate(): Promise<void> {
  const latest = await fetchLatestVersion();
  if (!latest || !isStrictlyNewerVersion(PKG_VERSION, latest)) return;

  process.stdout.write(
    `\n${YELLOW}  Update available: ${D}${PKG_VERSION}${R} → ${GREEN}${latest}${R}\n`,
  );

  const yes = await promptYesNo(`${D}  Update now? (Y/n, default: n): ${R}`);
  if (!yes) {
    process.stdout.write(`${D}  Skipped update.${R}\n\n`);
    return;
  }
  try {
    const ok = await runNpmGlobalUpdate();
    if (!ok) throw new Error("npm update failed");
    process.stdout.write(
      `${GREEN}  ✓ Updated to ${latest}. Restart frouter to use the new version.${R}

`,
    );
  } catch {
    process.stdout.write(
      `${RED}  ✗ Update failed. Run manually: npm install -g frouter-cli${R}

`,
    );
  }
}

// ─── Cleanup ───────────────────────────────────────────────────────────────────
function cleanup() {
  stopPingLoop(pingRef);
  destroyAgents();
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
      "No API keys configured. Run `frouter` to set up keys.\n",
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

  if (!Object.keys(config.apiKeys || {}).length) {
    config = await runFirstRunWizard(config);
  }

  await checkForUpdate();

  if (!process.stdin.isTTY) {
    process.stderr.write("frouter requires an interactive terminal.\n");
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
  process.stdout.on("resize", render);

  render(); // show loading state immediately
  await refreshModels();
  restartLoop();
  render();
}

main().catch((err) => {
  cleanup();
  console.error("Fatal:", err);
  process.exit(1);
});
