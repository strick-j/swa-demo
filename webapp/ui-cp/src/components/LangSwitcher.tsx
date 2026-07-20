// LangSwitcher -- EN/ES/PT locale toggle for the inspector chrome. It writes the
// shared `lang` cookie (read by both the SPA and the Go-rendered landing page)
// and reloads, so t() re-resolves at module load — the same reload-based model
// the landing-page switcher uses. See internal/i18n and docs/i18n-glossary.md.
import { SUPPORTED, getLocale, setLocale, type Locale } from "../i18n";
import { INK } from "../visualizations/common";

// Short pill label + full accessible name per locale.
const LABELS: Record<Locale, { short: string; name: string }> = {
  en: { short: "EN", name: "English" },
  "es-419": { short: "ES", name: "Español" },
  "pt-BR": { short: "PT", name: "Português" },
};

export function LangSwitcher() {
  const active = getLocale();
  return (
    <div role="group" aria-label="Language" style={ls.group}>
      {SUPPORTED.map((loc) => {
        const on = loc === active;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => {
              if (on) return;
              setLocale(loc);
              window.location.reload();
            }}
            aria-current={on ? "true" : undefined}
            title={LABELS[loc].name}
            style={{ ...ls.btn, ...(on ? ls.btnOn : null) }}
            onMouseEnter={(e) => {
              if (!on) e.currentTarget.style.color = INK.mono;
            }}
            onMouseLeave={(e) => {
              if (!on) e.currentTarget.style.color = INK.dim;
            }}
          >
            {LABELS[loc].short}
          </button>
        );
      })}
    </div>
  );
}

const ls = {
  group: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
  },
  btn: {
    color: INK.dim,
    background: "transparent",
    border: "none",
    borderRadius: 7,
    padding: "4px 8px",
    cursor: "pointer",
    letterSpacing: "0.04em",
    transition: "color 160ms var(--ease-standard)",
  },
  btnOn: {
    color: "#fff",
    background: "rgba(38,91,255,0.22)",
    cursor: "default",
  },
};
