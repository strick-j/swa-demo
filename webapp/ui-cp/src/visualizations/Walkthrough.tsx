// Walkthrough -- the "Learn More" step-through animation shown in the inspector
// stage when a Secrets Manager use-case page invokes it. Renders a horizontal
// actor diagram (Workload · IdP · Secrets Manager [Validator + Policy] · Vault)
// with animated SVG connectors, and a controller (prev / next / play-pause /
// reset) that steps through the flow one screen at a time or auto-advances.
//
// Layout uses a single 0–100 % coordinate space shared by HTML actor cards
// (absolute-positioned) and an SVG connector overlay (viewBox 0 0 100 100,
// preserveAspectRatio="none", non-scaling strokes) so cards and lines stay
// aligned at any pane width. Content comes from walkthroughData; geometry lives
// here. Palette matches the inspector's INK tokens.
import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Check,
} from "lucide-react";
import { INK } from "./common";
import type { Provider } from "../engine/providers";
import {
  flowForProvider,
  type ActorKey,
  type LinkId,
  type WStep,
} from "./walkthroughData";

// Auto-advance dwell per step while "playing".
const PLAY_MS = 3600;

interface WalkthroughProps {
  provider: Provider;
}

// Box geometry in % of the diagram canvas. left/top/width/height.
// `container` is the Idira Secrets Manager ring wrapping the validator, policy,
// and vault cards; `privcontainer` is the Idira Privilege Cloud ring wrapping
// the Privilege Cloud Safe. Neither "manager" nor "privcloud" gets a card of its
// own — they are drawn as the two container rings.
type BoxKey =
  | "workload"
  | "idp"
  | "validator"
  | "policy"
  | "vault"
  | "privvault"
  | "container"
  | "privcontainer";
const BOX: Record<
  BoxKey,
  { left: number; top: number; width: number; height: number }
> = {
  idp: { left: 2, top: 10, width: 18, height: 18 },
  workload: { left: 2, top: 48, width: 18, height: 18 },
  container: { left: 36, top: 6, width: 30, height: 86 },
  validator: { left: 39, top: 13, width: 24, height: 23 },
  policy: { left: 39, top: 40, width: 24, height: 23 },
  vault: { left: 39, top: 66, width: 24, height: 23 },
  privcontainer: { left: 70, top: 58, width: 28, height: 32 },
  privvault: { left: 73, top: 66, width: 22, height: 20 },
};

// Connector geometry (path + label anchor + arrow head) in the same % space.
const LINK: Record<
  LinkId,
  { d: string; label: { x: number; y: number }; head: { x: number; y: number } }
> = {
  idp_to_workload: {
    d: "M13,28 C20,33 20,43 13,48",
    label: { x: 24, y: 38 },
    head: { x: 13, y: 48 },
  },
  workload_to_manager: {
    d: "M20,54 C27,50 31,42 36,38",
    label: { x: 28, y: 43 },
    head: { x: 36, y: 38 },
  },
  manager_to_idp: {
    d: "M36,18 C30,18 26,19 20,20",
    label: { x: 28, y: 14 },
    head: { x: 20, y: 20 },
  },
  manager_to_workload: {
    d: "M36,52 C29,56 25,58 20,59",
    label: { x: 28, y: 57 },
    head: { x: 20, y: 59 },
  },
  policy_to_vault: {
    d: "M51,63 L51,66",
    label: { x: 57, y: 64 },
    head: { x: 51, y: 66 },
  },
  vault_to_workload: {
    d: "M39,82 C31,92 25,84 20,63",
    label: { x: 29, y: 86 },
    head: { x: 20, y: 63 },
  },
  privvault_to_vault: {
    d: "M73,76 C69,76 66,77 63,77",
    label: { x: 68, y: 71 },
    head: { x: 63, y: 77 },
  },
};

function toneColor(tone: "brand" | "ok" | undefined): string {
  return tone === "ok" ? INK.ok : "var(--idira-blue-500)";
}

// One actor card. `lit` = focused this step (blue glow); otherwise dimmed.
function ActorCard({
  box,
  title,
  sub,
  lit,
  keyProp,
  children,
}: {
  box: { left: number; top: number; width: number; height: number };
  title: string;
  sub: string;
  lit: boolean;
  keyProp: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      key={keyProp}
      style={{
        position: "absolute",
        left: `${box.left}%`,
        top: `${box.top}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "9px 11px",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${lit ? "var(--idira-blue-500)" : INK.line}`,
        background: lit ? INK.cardActive : INK.card,
        boxShadow: lit
          ? "0 0 0 1px var(--idira-blue-500), 0 8px 30px rgba(38,91,255,0.25)"
          : "none",
        opacity: lit ? 1 : 0.62,
        backdropFilter: "blur(2px)",
        transition: "all 300ms var(--ease-standard)",
        animation: lit ? "topoPop 320ms var(--ease-emphasis) both" : "none",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.02em",
          color: lit ? INK.text : INK.dim,
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: INK.faint,
          letterSpacing: "0.01em",
          lineHeight: 1.35,
        }}
      >
        {sub}
      </span>
      {children}
    </div>
  );
}

// Colored token segments under the workload while it holds the credential.
function TokenChip({ segments }: { segments: string[] }) {
  const colors = [
    "var(--idira-blue-500)",
    "var(--status-warning)",
    "var(--idira-blue-250)",
  ];
  return (
    <div
      style={{
        position: "absolute",
        left: `${BOX.workload.left}%`,
        top: `${BOX.workload.top + BOX.workload.height + 2}%`,
        display: "flex",
        gap: 4,
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: INK.faint,
          marginRight: 2,
        }}
      >
        token:
      </span>
      {segments.map((s, i) => (
        <span
          key={s}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 8.5,
            fontWeight: 600,
            color: "#0A0E18",
            background: colors[i % colors.length],
            borderRadius: 3,
            padding: "1px 5px",
            letterSpacing: "0.02em",
          }}
        >
          {s}
        </span>
      ))}
    </div>
  );
}

// A labelled boundary ring (Idira Secrets Manager / Idira Privilege Cloud).
// `active` draws the dashed brand-blue "in focus" state; otherwise a faint rail.
function ContainerRing({
  box,
  label,
  active,
}: {
  box: { left: number; top: number; width: number; height: number };
  label: string;
  active: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${box.left}%`,
        top: `${box.top}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
        borderRadius: "var(--radius-lg)",
        border: `1.5px ${active ? "dashed" : "solid"} ${
          active ? "var(--idira-blue-500)" : INK.line
        }`,
        background: active ? "rgba(38,91,255,0.06)" : "rgba(120,150,255,0.02)",
        boxShadow: active
          ? "0 0 0 1px rgba(38,91,255,0.25), 0 10px 40px rgba(38,91,255,0.18)"
          : "none",
        transition: "all 320ms var(--ease-standard)",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: -9,
          left: 12,
          padding: "0 6px",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: active ? INK.mono : INK.faint,
          background:
            "radial-gradient(120% 90% at 80% 0%, #0E2A78 0%, #061D63 60%, #050F38 100%)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// The diagram: SVG connectors under, HTML actor cards over.
function Diagram({ flow, step }: { flow: FlowConfigLite; step: WStep }) {
  const focus = new Set<ActorKey>(step.focus);
  const activeLinks = step.links ?? [];
  const a = flow.actors;

  return (
    <div style={ws.canvas}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {/* dormant connector rails */}
        {(Object.keys(LINK) as LinkId[]).map((id) => (
          <path
            key={`rail-${id}`}
            d={LINK[id].d}
            fill="none"
            stroke={INK.line}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* active connectors this step */}
        {activeLinks.map((l) => {
          const g = LINK[l.id];
          const col = toneColor(l.tone);
          return (
            <g key={`live-${l.id}`}>
              <path
                d={g.d}
                fill="none"
                stroke={col}
                strokeWidth={1.6}
                vectorEffect="non-scaling-stroke"
                className="wk-flow"
              />
              <circle cx={g.head.x} cy={g.head.y} r={0.9} fill={col} />
            </g>
          );
        })}
      </svg>

      {/* container rings */}
      <ContainerRing
        box={BOX.container}
        label={a.manager.title}
        active={!!step.container}
      />
      <ContainerRing
        box={BOX.privcontainer}
        label={a.privcloud.title}
        active={focus.has("privvault") || focus.has("privcloud")}
      />

      {/* actor cards */}
      <ActorCard
        box={BOX.workload}
        title={a.workload.title}
        sub={a.workload.sub}
        lit={focus.has("workload")}
        keyProp={`wl-${step.title}-${focus.has("workload")}`}
      />
      <ActorCard
        box={BOX.idp}
        title={a.idp.title}
        sub={a.idp.sub}
        lit={focus.has("idp")}
        keyProp={`idp-${step.title}-${focus.has("idp")}`}
      />
      <ActorCard
        box={BOX.validator}
        title={a.validator.title}
        sub={step.validatorLines ? "" : a.validator.sub}
        lit={focus.has("validator")}
        keyProp={`val-${step.title}-${focus.has("validator")}`}
      >
        {step.validatorLines && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {step.validatorLines.map((ln) => (
              <span
                key={ln}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  color: step.validatorOk ? INK.ok : INK.mono,
                  lineHeight: 1.4,
                }}
              >
                {ln}
              </span>
            ))}
          </div>
        )}
      </ActorCard>
      <ActorCard
        box={BOX.policy}
        title={a.policy.title}
        sub={step.policyRows ? "" : a.policy.sub}
        lit={focus.has("policy")}
        keyProp={`pol-${step.title}-${focus.has("policy")}`}
      >
        {step.policyRows && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {step.policyRows.map((r) => (
              <span
                key={r.k}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  color: INK.dim,
                  lineHeight: 1.35,
                }}
              >
                <Check style={{ width: 9, height: 9, color: INK.ok }} />
                {r.k}: {r.v}
              </span>
            ))}
          </div>
        )}
      </ActorCard>
      <ActorCard
        box={BOX.vault}
        title={a.vault.title}
        sub={a.vault.sub}
        lit={focus.has("vault")}
        keyProp={`vlt-${step.title}-${focus.has("vault")}`}
      />
      <ActorCard
        box={BOX.privvault}
        title={a.privvault.title}
        sub={a.privvault.sub}
        lit={focus.has("privvault")}
        keyProp={`pv-${step.title}-${focus.has("privvault")}`}
      />

      {step.token && flow.chip.length > 0 && <TokenChip segments={flow.chip} />}

      {/* connector labels (HTML, for crisp text over the distorted SVG space) */}
      {activeLinks.map((l) => {
        const g = LINK[l.id];
        if (!l.label) return null;
        return (
          <span
            key={`lbl-${l.id}`}
            style={{
              position: "absolute",
              left: `${g.label.x}%`,
              top: `${g.label.y}%`,
              transform: "translate(-50%, -50%)",
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: "0.02em",
              color: l.tone === "ok" ? INK.ok : INK.mono,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {l.label}
          </span>
        );
      })}
    </div>
  );
}

// Minimal shape the Diagram needs from a FlowConfig (avoids a circular import name).
type FlowConfigLite = NonNullable<ReturnType<typeof flowForProvider>>;

function CtrlButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: 8,
        border: "1px solid rgba(97,134,252,0.28)",
        background: "rgba(6,18,55,0.6)",
        color: disabled ? "rgba(196,210,250,0.3)" : INK.dim,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 160ms var(--ease-standard)",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.color = "#fff";
        e.currentTarget.style.borderColor = "var(--idira-blue-500)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.color = INK.dim;
        e.currentTarget.style.borderColor = "rgba(97,134,252,0.28)";
      }}
    >
      {children}
    </button>
  );
}

export function Walkthrough({ provider }: WalkthroughProps) {
  const flow = flowForProvider(provider.id);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);

  const total = flow?.steps.length ?? 0;

  // Auto-advance while playing; stop at the last step.
  useEffect(() => {
    if (!playing || total === 0) return;
    if (i >= total - 1) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setI((s) => s + 1), PLAY_MS);
    return () => clearTimeout(id);
  }, [playing, i, total]);

  if (!flow) return null;
  const step = flow.steps[i]!;
  const atStart = i === 0;
  const atEnd = i === total - 1;
  const pct = ((i + 1) / total) * 100;

  const go = (n: number) => {
    setPlaying(false);
    setI(Math.max(0, Math.min(total - 1, n)));
  };
  const reset = () => {
    setPlaying(false);
    setI(0);
  };
  const togglePlay = () => {
    if (atEnd) {
      setI(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  };

  return (
    <div style={ws.scroll}>
      <div style={ws.wrap}>
        <header style={ws.header}>
          <span style={ws.eyebrow}>{flow.eyebrow}</span>
          <h2 style={ws.title}>{flow.title}</h2>
          <p style={ws.lede}>{flow.lede}</p>
        </header>

        <div style={ws.stage}>
          <div style={ws.stageHead}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={ws.stepCount}>
                Step {i + 1} of {total}
              </span>
              <span style={ws.stepTitle}>{step.title}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <CtrlButton onClick={togglePlay} title={playing ? "Pause" : "Play"}>
                {playing ? (
                  <Pause style={{ width: 14, height: 14 }} />
                ) : (
                  <Play style={{ width: 14, height: 14 }} />
                )}
              </CtrlButton>
              <CtrlButton
                onClick={() => go(i - 1)}
                disabled={atStart}
                title="Previous step"
              >
                <ChevronLeft style={{ width: 15, height: 15 }} />
              </CtrlButton>
              <CtrlButton
                onClick={() => go(i + 1)}
                disabled={atEnd}
                title="Next step"
              >
                <ChevronRight style={{ width: 15, height: 15 }} />
              </CtrlButton>
              <CtrlButton onClick={reset} title="Restart">
                <RotateCcw style={{ width: 13, height: 13 }} />
              </CtrlButton>
            </div>
          </div>

          <Diagram flow={flow} step={step} />

          <div style={ws.narration}>
            <p style={ws.body}>{step.body}</p>
            <div style={ws.progressTrack}>
              <div style={{ ...ws.progressFill, width: `${pct}%` }} />
            </div>
          </div>
        </div>

        <div style={ws.features}>
          {flow.features.map((f) => (
            <div key={f.title} style={ws.feature}>
              <span style={ws.featureTitle}>{f.title}</span>
              <span style={ws.featureBody}>{f.body}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const ws = {
  scroll: {
    position: "relative" as const,
    height: "100%",
    overflowY: "auto" as const,
    overflowX: "hidden" as const,
    padding: "20px 30px 30px",
  },
  wrap: {
    maxWidth: 720,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column" as const,
    gap: 18,
  },
  header: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center" as const,
    textAlign: "center" as const,
    gap: 8,
  },
  eyebrow: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.16em",
    textTransform: "uppercase" as const,
    color: INK.mono,
    padding: "4px 12px",
    borderRadius: 999,
    border: "1px solid rgba(97,134,252,0.3)",
    background: "rgba(38,91,255,0.1)",
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: INK.text,
  },
  lede: {
    margin: 0,
    maxWidth: 560,
    fontSize: 13,
    lineHeight: 1.55,
    color: INK.dim,
  },
  stage: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
    padding: 18,
    borderRadius: "var(--radius-lg)",
    border: "1px solid rgba(97,134,252,0.18)",
    background: "rgba(6,18,55,0.4)",
    backdropFilter: "blur(2px)",
  },
  stageHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  stepCount: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: INK.faint,
  },
  stepTitle: {
    fontSize: 14.5,
    fontWeight: 700,
    color: INK.text,
    letterSpacing: "-0.01em",
  },
  narration: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  },
  body: {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.6,
    color: INK.dim,
    minHeight: 60,
  },
  progressTrack: {
    height: 3,
    borderRadius: 3,
    background: "rgba(255,255,255,0.08)",
    overflow: "hidden" as const,
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    background: "var(--idira-blue-500)",
    boxShadow: "0 0 10px var(--idira-blue-500)",
    transition: "width 500ms var(--ease-emphasis)",
  },
  features: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 12,
  },
  feature: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 7,
    padding: "14px 15px",
    borderRadius: "var(--radius-md)",
    border: "1px solid rgba(97,134,252,0.15)",
    background: "rgba(120,150,255,0.035)",
  },
  featureTitle: {
    fontSize: 12.5,
    fontWeight: 700,
    color: INK.text,
  },
  featureBody: {
    fontSize: 11,
    lineHeight: 1.55,
    color: INK.faint,
  },
  canvas: {
    position: "relative" as const,
    width: "100%",
    height: 360,
  },
};
