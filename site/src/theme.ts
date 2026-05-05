import { SITE_META, type Theme, isTheme } from "./content";
import { getElement, readStorage, writeStorage } from "./utils";

const FAVICON_FILES = {
  "favicon-ico": "favicon.ico",
  "favicon-32": "favicon-32x32.png",
  "favicon-16": "favicon-16x16.png",
  "apple-touch-icon": "apple-touch-icon.png",
} as const;

function syncFavicons(theme: Theme) {
  const base = `${import.meta.env.BASE_URL}logo/${theme}/`;
  Object.entries(FAVICON_FILES).forEach(([id, file]) => {
    getElement<HTMLLinkElement>(id)?.setAttribute("href", `${base}${file}`);
  });
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  syncFavicons(theme);
}

function getInitialTheme(): Theme {
  const stored = readStorage(SITE_META.themeKey);
  if (isTheme(stored)) return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function initTheme() {
  const button = getElement<HTMLButtonElement>("theme-toggle");
  const initial = getInitialTheme();
  applyTheme(initial);
  button?.setAttribute("aria-pressed", String(initial === "dark"));

  button?.addEventListener("click", () => {
    const next: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    button.setAttribute("aria-pressed", String(next === "dark"));
    writeStorage(SITE_META.themeKey, next);
  });
}
