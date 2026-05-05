export type Locale = "en" | "ko";
export type Theme = "light" | "dark";

export const SITE_META = {
  themeKey: "fr-theme",
  localeKey: "fr-locale",
} as const;

export function isLocale(value: string | null): value is Locale {
  return value === "en" || value === "ko";
}

export function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark";
}
