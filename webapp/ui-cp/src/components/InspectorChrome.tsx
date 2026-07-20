// InspectorChrome -- shared chrome for the inspector right pane. Header lockup
// with Idira icon, view/pace controls, the CP trust-context bar (Application /
// Provider / Safe / Auth), status footer with phase indicator + Reset, the
// security-layers background texture, and an optional shimmer sweep.
import type { ReactNode } from "react";
import {
  CircleDashed,
  Loader,
  ShieldCheck,
  ShieldAlert,
  RotateCcw,
} from "lucide-react";
import { INK } from "../visualizations/common";
import type { Provider, ScenarioKey } from "../engine/providers";
import { LangSwitcher } from "./LangSwitcher";

interface InspectorChromeProps {
  provider: Provider;
  status: "idle" | "running" | "done" | "error";
  stage: number;
  scenario: ScenarioKey;
  shimmer: boolean;
  controls: ReactNode;
  onReset: () => void;
  children: ReactNode;
}

function CtxCell({
  k,
  v,
  wide,
  brand,
}: {
  k: string;
  v: string;
  wide?: boolean;
  brand?: boolean;
}) {
  return (
    <div style={{ ...ic.ctxCell, flex: wide ? 1.4 : 1 }}>
      <span style={ic.ctxK}>{k}</span>
      <span style={{ ...ic.ctxV, color: brand ? INK.mono : INK.text }}>
        {v}
      </span>
    </div>
  );
}

function PhaseIcon({
  status,
  tone,
}: {
  status: "idle" | "running" | "done" | "error";
  tone: string;
}) {
  const s = { width: 13, height: 13, color: tone };
  switch (status) {
    case "idle":
      return <CircleDashed style={s} />;
    case "running":
      return (
        <Loader style={{ ...s, animation: "icSpin 1s linear infinite" }} />
      );
    case "done":
      return <ShieldCheck style={s} />;
    case "error":
      return <ShieldAlert style={s} />;
  }
}

// The error-phase footer text, tuned to which boundary rejected the request.
function errorPhrase(scenario: ScenarioKey): string {
  switch (scenario) {
    case "invalid-hash":
      return "Rejected · application hash unauthorized";
    case "no-cert":
      return "Rejected · no client certificate";
    case "invalid":
      return "Rejected · authentication failed";
    case "denied":
      return "Denied · not authorized";
    case "untrusted":
      return "Denied · SPIFFE ID not allow-listed";
    case "unknown":
      return "Refused · no identity issued";
    case "foreign":
      return "Rejected · foreign trust domain";
    default:
      return "Rejected · retrieval failed";
  }
}

export function InspectorChrome({
  provider,
  status,
  stage,
  scenario,
  shimmer,
  controls,
  onReset,
  children,
}: InspectorChromeProps) {
  const verb =
    (stage >= 0 ? provider.stages[stage]?.verb : undefined)?.toLowerCase() ??
    "starting";

  const doneTxt =
    provider.id === "cp"
      ? "Retrieved · secret hashed on host, never stored"
      : provider.id === "swa"
        ? "Reached the database · authorized by SPIFFE ID"
        : provider.id === "conjur-jwt" || provider.id === "conjur-iam"
          ? "Retrieved · scoped token, secret masked at the source"
          : "Retrieved · credential masked at the source";

  const phase =
    status === "idle"
      ? { txt: "Click resolve to begin", tone: INK.dim }
      : status === "running"
        ? { txt: `Retrieving · ${verb}`, tone: "#9DB4FF" }
        : status === "done"
          ? { txt: doneTxt, tone: INK.ok }
          : { txt: errorPhrase(scenario), tone: INK.danger };

  return (
    <div style={ic.root}>
      <div style={ic.bgLayers} />
      {shimmer && <div className="ic-flow" style={ic.shimmer} />}

      <header style={ic.head}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img
            src="/cp/assets/idira-icon-white.png"
            alt="Idira"
            style={{ height: 24, width: "auto", opacity: 0.95 }}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              lineHeight: 1.1,
            }}
          >
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 700,
                color: INK.text,
                letterSpacing: "0.02em",
              }}
            >
              Idira Inspector
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: INK.faint,
                letterSpacing: "0.04em",
              }}
            >
              {provider.subtitle}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <LangSwitcher />
          {controls}
        </div>
      </header>

      <div style={ic.ctx}>
        {provider.ctx.map((c) => (
          <CtxCell key={c.k} k={c.k} v={c.v} wide={c.wide} brand={c.brand} />
        ))}
      </div>

      <div style={ic.stage}>{children}</div>

      <footer style={ic.footer}>
        <div style={{ ...ic.phase, color: phase.tone }}>
          <PhaseIcon status={status} tone={phase.tone} />
          <span>{phase.txt}</span>
        </div>
        {status !== "idle" && (
          <button
            onClick={onReset}
            style={ic.resetBtn}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = INK.text;
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = INK.dim;
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
            }}
          >
            <RotateCcw style={{ width: 12, height: 12 }} /> Reset
          </button>
        )}
      </footer>
    </div>
  );
}

const ic = {
  root: {
    position: "relative" as const,
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    background:
      "radial-gradient(120% 90% at 80% 0%, #0E2A78 0%, #061D63 38%, #050F38 100%)",
    color: INK.text,
    overflow: "hidden",
  },
  bgLayers: {
    position: "absolute" as const,
    inset: 0,
    backgroundImage: "url('/cp/assets/security-layers-blue.png')",
    backgroundRepeat: "no-repeat",
    backgroundSize: "contain",
    backgroundPosition: "right bottom",
    opacity: 0.45,
    pointerEvents: "none" as const,
    maskImage:
      "radial-gradient(120% 120% at 100% 100%, #000 12%, rgba(0,0,0,0.5) 45%, transparent 80%)",
    WebkitMaskImage:
      "radial-gradient(120% 120% at 100% 100%, #000 12%, rgba(0,0,0,0.5) 45%, transparent 80%)",
  },
  shimmer: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    width: "100%",
    height: "100%",
    background:
      "linear-gradient(105deg, transparent 30%, rgba(97,134,252,0.10) 50%, transparent 70%)",
    backgroundSize: "260% 100%",
    pointerEvents: "none" as const,
    animation: "icShimmer 7s linear infinite",
    zIndex: 1,
  },
  head: {
    position: "relative" as const,
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 30px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    flexShrink: 0,
  },
  ctx: {
    position: "relative" as const,
    zIndex: 2,
    display: "flex",
    gap: 0,
    padding: "14px 30px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    flexShrink: 0,
  },
  ctxCell: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    paddingRight: 18,
  },
  ctxK: {
    fontSize: 9,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: INK.faint,
    fontWeight: 600,
  },
  ctxV: {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    fontWeight: 500,
  },
  stage: {
    position: "relative" as const,
    zIndex: 2,
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  footer: {
    position: "relative" as const,
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "11px 30px",
    borderTop: "1px solid rgba(255,255,255,0.07)",
    flexShrink: 0,
    background: "rgba(4,12,40,0.5)",
  },
  phase: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.01em",
  },
  resetBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: INK.dim,
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 7,
    padding: "5px 11px",
    cursor: "pointer",
    transition: "all 160ms var(--ease-standard)",
    letterSpacing: "0.02em",
  },
};
