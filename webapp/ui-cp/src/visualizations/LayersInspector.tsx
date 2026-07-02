// LayersInspector -- the "layers of defense" view for the CP flow. Five gates
// (one per stage) illuminate top-to-bottom as each fires: invoke, application
// hash, OS user / path, Safe authorization, credential. On a denial the failing
// gate is marked rejected and the rest stay locked.
import {
  Terminal,
  Fingerprint,
  BadgeCheck,
  Lock,
  KeyRound,
  Check,
  X,
  ShieldOff,
} from "lucide-react";
import { INK, type InspectorProps, type CpResult } from "./common";
import { CP } from "../engine/cp";

type LayerState = "locked" | "active" | "passed" | "rejected";

interface LayerDef {
  name: string;
  Icon: React.ComponentType<{ style?: React.CSSProperties }>;
  pass: (r: CpResult | null) => string;
  reject: (r: CpResult | null) => string;
  idle: string;
}

const LAYERS: LayerDef[] = [
  {
    name: "Invoke caller",
    Icon: Terminal,
    pass: () => "host cp-bridge ran the registered Java caller",
    reject: () => "cp-bridge could not run the caller",
    idle: "run cp-caller.jar via the host bridge",
  },
  {
    name: "Application hash",
    Icon: Fingerprint,
    pass: (r) =>
      `fingerprint ${r?.appHash || "—"} · matched a registered Application`,
    reject: (r) =>
      `${r?.errorCode || "APPAP133E"} · application hash is not authorized`,
    idle: "measure the calling application's hash",
  },
  {
    name: "OS user / path",
    Icon: BadgeCheck,
    pass: (r) => `os-user ${r?.osUser || "—"} + executable path matched`,
    reject: () => "OS user / path did not match the Application",
    idle: "verify OS user and executable path",
  },
  {
    name: "Safe authorization",
    Icon: Lock,
    pass: (r) => `Application authorized for Safe ${r?.safe || CP.ctx.safe}`,
    reject: (r) =>
      `${r?.errorCode || "APPAP"} · not permitted for Safe ${r?.safe || CP.ctx.safe}`,
    idle: "authorize the Application for the Safe",
  },
  {
    name: "Credential",
    Icon: KeyRound,
    pass: (r) => `${r?.masked || "returned"} · hashed on host · never on disk`,
    reject: () => "no credential returned",
    idle: "return the account, masked on the host",
  },
];

// Decorative bar-curtain on the right edge of each layer.
function Curtain({ state }: { state: LayerState }) {
  const bars = Array.from({ length: 22 });
  return (
    <div style={ls.curtain}>
      {bars.map((_, i) => {
        const danger = state === "rejected";
        const lit = state === "passed" || state === "active";
        return (
          <span
            key={i}
            className={state === "active" ? "ic-flow" : undefined}
            style={{
              flex: 1,
              background: danger
                ? "linear-gradient(180deg, #FF724D, #B23808)"
                : "linear-gradient(180deg, #6186FC, #173EB8)",
              opacity: lit
                ? 0.35 + 0.65 * Math.sin((i / bars.length) * Math.PI)
                : 0.08,
              transform: lit ? "scaleY(1)" : "scaleY(0.45)",
              transformOrigin: "bottom",
              transition: `opacity 420ms ${i * 22}ms var(--ease-standard), transform 420ms ${i * 22}ms var(--ease-emphasis)`,
              animation:
                state === "active"
                  ? `layShimmer 1.1s ${i * 40}ms ease-in-out infinite`
                  : "none",
              borderRadius: 1,
            }}
          />
        );
      })}
    </div>
  );
}

export function LayersInspector({
  status,
  stage,
  completed,
  scenario,
  failStage,
  result,
}: InspectorProps) {
  const errored = status === "error";
  const n = LAYERS.length;

  const stateFor = (idx: number): LayerState => {
    if (errored) {
      if (idx === failStage) return "rejected";
      if (idx > failStage) return "locked";
      return "passed";
    }
    if (completed > idx) return "passed";
    if (stage === idx) return "active";
    return "locked";
  };

  const passedCount = errored ? Math.max(0, failStage) : completed;
  const dotPos = errored
    ? failStage
    : stage >= 0
      ? stage
      : status === "done"
        ? n
        : 0;
  const railDotTop = `calc(${(Math.min(dotPos + 0.5, n) / n) * 100}%)`;

  return (
    <div style={ls.scroll}>
      <div style={ls.canvas}>
        <div style={ls.headline}>
          <span className="idira-eyebrow" style={{ color: INK.mono }}>
            Layers of defense
          </span>
          <span style={ls.headSub}>
            {status === "idle"
              ? "five gates between the caller and the credential"
              : errored
                ? scenario === "denied"
                  ? "the request stopped at Safe authorization"
                  : "the request stopped at application authentication"
                : status === "done"
                  ? "every gate cleared by application identity"
                  : "the request is descending the trust path…"}
          </span>
        </div>

        <div style={ls.stack}>
          <div style={ls.rail}>
            <div
              style={{
                ...ls.railFill,
                height: `${(Math.min(passedCount, n) / n) * 100}%`,
                background: errored ? INK.dangerLine : "var(--idira-blue-500)",
              }}
            />
            <div
              style={{
                ...ls.railDot,
                top: railDotTop,
                background: errored ? INK.danger : "#9DB4FF",
                display: status === "idle" ? "none" : "block",
              }}
            />
          </div>

          <div style={ls.layers}>
            {LAYERS.map((L, i) => {
              const st = stateFor(i);
              const danger = st === "rejected";
              const lit = st === "passed" || st === "active";
              const detail =
                st === "passed" || st === "active"
                  ? L.pass(result)
                  : danger
                    ? L.reject(result)
                    : L.idle;

              return (
                <div
                  key={i}
                  style={{
                    ...ls.layer,
                    borderColor: danger
                      ? INK.dangerLine
                      : lit
                        ? "var(--idira-blue-500)"
                        : INK.line,
                    background: danger
                      ? "rgba(250,88,45,0.08)"
                      : st === "active"
                        ? "rgba(38,91,255,0.12)"
                        : st === "passed"
                          ? "rgba(38,91,255,0.06)"
                          : "rgba(120,150,255,0.03)",
                    boxShadow:
                      st === "active"
                        ? "0 0 0 1px var(--idira-blue-500), 0 10px 30px rgba(38,91,255,0.22)"
                        : "none",
                    opacity: st === "locked" ? 0.5 : 1,
                  }}
                >
                  <div
                    style={{
                      ...ls.num,
                      color: danger ? INK.danger : lit ? "#fff" : INK.faint,
                      background: danger
                        ? "rgba(250,88,45,0.18)"
                        : lit
                          ? "var(--idira-blue-500)"
                          : "rgba(255,255,255,0.05)",
                    }}
                  >
                    {st === "passed" ? (
                      <Check style={{ width: 15, height: 15 }} />
                    ) : danger ? (
                      <X style={{ width: 15, height: 15 }} />
                    ) : (
                      <L.Icon style={{ width: 15, height: 15 }} />
                    )}
                  </div>

                  <div style={ls.meta}>
                    <div style={ls.layerName}>
                      {L.name}
                      <span
                        style={{
                          ...ls.layerStatus,
                          color: danger
                            ? INK.danger
                            : st === "passed"
                              ? INK.ok
                              : st === "active"
                                ? INK.mono
                                : INK.faint,
                        }}
                      >
                        {danger
                          ? "rejected"
                          : st === "passed"
                            ? "cleared"
                            : st === "active"
                              ? "verifying…"
                              : "waiting"}
                      </span>
                    </div>
                    <div
                      style={{
                        ...ls.layerDetail,
                        color:
                          lit && !danger
                            ? INK.dim
                            : danger
                              ? "rgba(255,170,140,0.85)"
                              : INK.faint,
                      }}
                    >
                      {detail}
                    </div>
                  </div>

                  <Curtain state={st} />
                </div>
              );
            })}
          </div>
        </div>

        {errored && (
          <div style={ls.boundary}>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: INK.danger,
              }}
            >
              <ShieldOff style={{ width: 13, height: 13 }} /> Boundary held
            </span>
            <span style={ls.boundaryBody}>
              {scenario === "denied"
                ? "The caller was authenticated, but the Application is not a member of the requested Safe. No credential crossed the bridge."
                : "The calling application's hash is not registered. Rejected before any Safe was evaluated — as designed."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const ls = {
  scroll: {
    height: "100%",
    overflowY: "auto" as const,
    padding: "24px 32px 32px",
  },
  canvas: { maxWidth: 580, margin: "0 auto" },
  headline: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    marginBottom: 18,
  },
  headSub: { fontSize: 13.5, color: INK.dim, lineHeight: 1.4 },
  stack: { display: "flex", gap: 16 },
  rail: {
    position: "relative" as const,
    width: 3,
    borderRadius: 3,
    background: "rgba(255,255,255,0.07)",
    flexShrink: 0,
    marginTop: 6,
    marginBottom: 6,
  },
  railFill: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: "100%",
    borderRadius: 3,
    transition: "height 600ms var(--ease-emphasis)",
  },
  railDot: {
    position: "absolute" as const,
    left: "50%",
    width: 11,
    height: 11,
    borderRadius: 999,
    transform: "translate(-50%,-50%)",
    boxShadow: "0 0 12px #9DB4FF",
    transition: "top 600ms var(--ease-emphasis)",
  },
  layers: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  },
  layer: {
    position: "relative" as const,
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    border: "1px solid",
    borderRadius: "var(--radius-md)",
    overflow: "hidden",
    transition: "all 340ms var(--ease-standard)",
    minHeight: 74,
  },
  num: {
    width: 34,
    height: 34,
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    transition: "all 320ms",
  },
  meta: { flex: 1, minWidth: 0, zIndex: 1 },
  layerName: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    fontSize: 14.5,
    fontWeight: 700,
    color: INK.text,
    fontFamily: "var(--font-display)",
  },
  layerStatus: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    fontWeight: 600,
  },
  layerDetail: {
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    lineHeight: 1.45,
    marginTop: 3,
  },
  curtain: {
    position: "absolute" as const,
    right: 0,
    top: 0,
    bottom: 0,
    width: "38%",
    display: "flex",
    gap: 2,
    alignItems: "stretch",
    padding: "10px 0",
    opacity: 0.9,
    maskImage: "linear-gradient(90deg, transparent, #000 60%)",
    WebkitMaskImage: "linear-gradient(90deg, transparent, #000 60%)",
    pointerEvents: "none" as const,
  },
  boundary: {
    marginTop: 18,
    padding: "14px 16px",
    border: `1.5px dashed ${INK.dangerLine}`,
    borderRadius: "var(--radius-md)",
    background: "rgba(250,88,45,0.07)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 7,
    animation: "layPop 360ms var(--ease-emphasis) both",
  },
  boundaryBody: {
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    color: "rgba(255,180,150,0.85)",
    lineHeight: 1.55,
  },
};
