import { describe, expect, it } from "vitest";
import { SUPPORTED, DEFAULT_LOCALE, type Locale } from "./index";
import en from "./locales/en.json";
import es419 from "./locales/es-419.json";
import ptBR from "./locales/pt-BR.json";

// Mirrors the server-side TestCatalogParity: every target locale must define the
// same key set as the English source of truth. Missing keys silently fall back
// to English (masking untranslated copy); extra keys are dead weight/typos.
// Typed over the finite Locale union (not an index signature) so lookups are
// total under noUncheckedIndexedAccess.
const CATALOGS: Record<Locale, Record<string, string>> = {
  en,
  "es-419": es419,
  "pt-BR": ptBR,
};

const source: Record<string, string> = en;

describe("SPA catalog parity", () => {
  for (const loc of SUPPORTED) {
    if (loc === DEFAULT_LOCALE) continue;
    it(`${loc} has exactly the ${DEFAULT_LOCALE} key set`, () => {
      const target: Record<string, string> = CATALOGS[loc];
      const missing = Object.keys(source).filter((k) => !(k in target));
      const extra = Object.keys(target).filter((k) => !(k in source));
      expect(missing, `${loc} missing keys`).toEqual([]);
      expect(extra, `${loc} extra keys`).toEqual([]);
    });
  }
});
