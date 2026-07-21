// LangSwitcher -- globe-icon locale menu for the inspector chrome. It writes the
// shared `lang` cookie (read by both the SPA and the Go-rendered landing page)
// and reloads, so t() re-resolves at module load — the same reload-based model
// the landing-page switcher uses. See internal/i18n and docs/i18n-glossary.md.
import { useEffect, useRef, useState } from "react";
import { Globe, Check } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (loc: Locale) => {
    if (loc === active) {
      setOpen(false);
      return;
    }
    setLocale(loc);
    window.location.reload();
  };

  return (
    <div ref={ref} style={ls.wrap}>
      <button
        type="button"
        aria-label="Language"
        aria-haspopup="menu"
        aria-expanded={open}
        title={LABELS[active].name}
        onClick={() => setOpen((o) => !o)}
        style={{ ...ls.trigger, ...(open ? ls.triggerOn : null) }}
        onMouseEnter={(e) => {
          if (open) return;
          e.currentTarget.style.color = "#fff";
          e.currentTarget.style.borderColor = "var(--idira-blue-500)";
        }}
        onMouseLeave={(e) => {
          if (open) return;
          e.currentTarget.style.color = INK.dim;
          e.currentTarget.style.borderColor = "rgba(97,134,252,0.28)";
        }}
      >
        <Globe style={{ width: 14, height: 14 }} />
        <span style={ls.short}>{LABELS[active].short}</span>
      </button>

      {open && (
        <div role="menu" aria-label="Language" style={ls.menu}>
          {SUPPORTED.map((loc) => {
            const on = loc === active;
            return (
              <button
                key={loc}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                aria-current={on ? "true" : undefined}
                onClick={() => choose(loc)}
                style={{ ...ls.item, ...(on ? ls.itemOn : null) }}
                onMouseEnter={(e) => {
                  if (!on) e.currentTarget.style.background = "rgba(97,134,252,0.14)";
                }}
                onMouseLeave={(e) => {
                  if (!on) e.currentTarget.style.background = "transparent";
                }}
              >
                <span style={ls.check}>{on && <Check style={{ width: 13, height: 13 }} />}</span>
                {LABELS[loc].name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ls = {
  wrap: { position: "relative" as const, display: "inline-flex" },
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: INK.dim,
    background: "rgba(6,18,55,0.6)",
    border: "1px solid rgba(97,134,252,0.28)",
    borderRadius: 8,
    padding: "5px 9px",
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    letterSpacing: "0.04em",
    transition: "all 160ms var(--ease-standard)",
  },
  triggerOn: {
    color: "#fff",
    borderColor: "var(--idira-blue-500)",
  },
  short: { fontWeight: 600 },
  menu: {
    position: "absolute" as const,
    top: "calc(100% + 6px)",
    right: 0,
    zIndex: 20,
    minWidth: 148,
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    padding: 5,
    background: "rgba(8,20,56,0.98)",
    border: "1px solid rgba(97,134,252,0.28)",
    borderRadius: 10,
    boxShadow: "0 14px 40px rgba(3,10,32,0.55)",
    backdropFilter: "blur(6px)",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    textAlign: "left" as const,
    color: INK.dim,
    background: "transparent",
    border: "none",
    borderRadius: 6,
    padding: "7px 9px",
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    fontSize: 12.5,
    fontWeight: 600,
    transition: "background 140ms var(--ease-standard)",
  },
  itemOn: { color: "#fff", background: "rgba(38,91,255,0.22)", cursor: "default" },
  check: { width: 14, display: "inline-flex", alignItems: "center", color: INK.mono },
};
