// i18n -- the inspector SPA's client-side localization. It reads the SAME "lang"
// cookie the Go server sets (see internal/i18n), so the SPA and the server-rendered
// pages never disagree on locale. This is the Phase-1 proof-of-concept: a tiny
// dependency-free t() with {name} interpolation. Production should swap this for
// react-i18next (plurals, lazy catalogs) behind the same t(key, vars) surface.
//
// Only the CP `authorized` scenario + its translatable trace comments are wired
// as a reference; extending it is a matter of moving more strings into the
// locale JSON and calling t() at the read site. See docs/i18n-glossary.md.
import en from "./locales/en.json";
import es419 from "./locales/es-419.json";
import ptBR from "./locales/pt-BR.json";

export const SUPPORTED = ["en", "es-419", "pt-BR"] as const;
export type Locale = (typeof SUPPORTED)[number];
export const DEFAULT_LOCALE: Locale = "en";
const COOKIE_NAME = "lang";

// Catalogs are flat key -> string maps. `en` is the source of truth and the
// fallback; targets may omit keys and degrade to English.
type Catalog = Record<string, string>;
const CATALOGS: Record<Locale, Catalog> = {
  en: en as Catalog,
  "es-419": es419 as Catalog,
  "pt-BR": ptBR as Catalog,
};

function isLocale(v: string): v is Locale {
  return (SUPPORTED as readonly string[]).includes(v);
}

// readCookie returns the raw value of a cookie, or "" when absent / not in a DOM.
function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const hit = document.cookie
    .split("; ")
    .find((row) => row.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
}

// detectLocale mirrors the server: the lang cookie if valid, else browser
// languages (any es-* -> es-419, any pt-* -> pt-BR), else the default.
export function detectLocale(): Locale {
  const fromCookie = readCookie(COOKIE_NAME);
  if (isLocale(fromCookie)) return fromCookie;

  const navLangs =
    typeof navigator !== "undefined"
      ? [navigator.language, ...(navigator.languages ?? [])]
      : [];
  for (const raw of navLangs) {
    if (!raw) continue;
    if (isLocale(raw)) return raw;
    const primary = raw.toLowerCase().split("-")[0];
    if (primary === "es") return "es-419";
    if (primary === "pt") return "pt-BR";
    if (primary === "en") return "en";
  }
  return DEFAULT_LOCALE;
}

// setLocale persists the choice in the shared cookie (matching the server's
// path/lifetime) so a reload — and the Go pages — pick it up.
export function setLocale(loc: Locale): void {
  if (typeof document === "undefined" || !isLocale(loc)) return;
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${COOKIE_NAME}=${loc}; path=/; max-age=${oneYear}; samesite=lax`;
}

// The active locale is resolved once per page load (the switcher reloads).
let active: Locale = detectLocale();
export function getLocale(): Locale {
  return active;
}
export function setActiveLocale(loc: Locale): void {
  active = loc;
}

// t looks up key in the active locale, falls back to English, then echoes the
// key. vars fill {name} placeholders — used for trace lines that interpolate
// runtime values (appId, safe, osUser, …) into an otherwise translatable
// sentence. Interpolated values are NOT translated; only the frame is.
export function t(key: string, vars?: Record<string, string | number>): string {
  const raw =
    CATALOGS[active]?.[key] ?? CATALOGS[DEFAULT_LOCALE]?.[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole: string, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
