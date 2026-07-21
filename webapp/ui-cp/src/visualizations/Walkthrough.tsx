// Walkthrough -- the "Learn how it works" step-through animation shown in the
// inspector stage. Fully data-driven: it renders whatever nodes (cards +
// container rings) and connectors a flow declares, and steps through them one at
// a time or auto-advances. A provider may expose several flows (e.g. Retrieval +
// Rotation); a selector switches between them.
//
// Layout uses a single 0–100 % coordinate space shared by HTML nodes
// (absolute-positioned) and an SVG connector overlay (viewBox 0 0 100 100,
// preserveAspectRatio="none", non-scaling strokes) so cards and lines stay
// aligned at any pane width. Palette matches the inspector's INK tokens.
import { useEffect, useMemo, useState } from "react";
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
  flowsForProvider,
  type Box,
  type FlowConfig,
  type WNode,
  type WStep,
} from "./walkthroughData";

// Auto-advance dwell per step while "playing".
const PLAY_MS = 3600;

interface WalkthroughProps {
  provider: Provider;
}

function toneColor(tone: "brand" | "ok" | undefined): string {
  return tone === "ok" ? INK.ok : "var(--idira-blue-500)";
}

const boxStyle = (box: Box) => ({
  position: "absolute" as const,
  left: `${box.left}%`,
  top: `${box.top}%`,
  width: `${box.width}%`,
  height: `${box.height}%`,
});

// A labelled boundary ring (a container node). `active` = focused this step.
function ContainerRing({ box, label, active }: { box: Box; label: string; active: boolean }) {
  return (
    <div
      style={{
        ...boxStyle(box),
        borderRadius: "var(--radius-lg)",
        border: `1.5px ${active ? "dashed" : "solid"} ${active ? "var(--idira-blue-500)" : INK.line}`,
        background: active ? "rgba(38,91,255,0.06)" : "rgba(120,150,255,0.02)",
        boxShadow: active ? "0 0 0 1px rgba(38,91,255,0.25), 0 10px 40px rgba(38,91,255,0.18)" : "none",
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
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: active ? INK.mono : INK.faint,
          background: "radial-gradient(120% 90% at 80% 0%, #0E2A78 0%, #061D63 60%, #050F38 100%)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// A filled node card. Shows either inline detail (mono lines / check rows) or its
// static sub-label.
function ActorCard({
  node,
  lit,
  detailLines,
  detailOk,
  detailRows,
  keyProp,
}: {
  node: WNode;
  lit: boolean;
  detailLines?: string[];
  detailOk?: boolean;
  detailRows?: { k: string; v: string }[];
  keyProp: string;
}) {
  const hasDetail = !!(detailLines || detailRows);
  return (
    <div
      key={keyProp}
      style={{
        ...boxStyle(node.box),
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "9px 11px",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${lit ? "var(--idira-blue-500)" : INK.line}`,
        background: lit ? INK.cardActive : INK.card,
        boxShadow: lit ? "0 0 0 1px var(--idira-blue-500), 0 8px 30px rgba(38,91,255,0.25)" : "none",
        opacity: lit ? 1 : 0.62,
        backdropFilter: "blur(2px)",
        transition: "all 300ms var(--ease-standard)",
        animation: lit ? "topoPop 320ms var(--ease-emphasis) both" : "none",
        overflow: "hidden",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.02em", color: lit ? INK.text : INK.dim }}>
        {node.title}
      </span>
      {!hasDetail && node.sub && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: INK.faint, lineHeight: 1.35 }}>
          {node.sub}
        </span>
      )}
      {detailLines && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {detailLines.map((ln) => (
            <span key={ln} style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: detailOk ? INK.ok : INK.mono, lineHeight: 1.4 }}>
              {ln}
            </span>
          ))}
        </div>
      )}
      {detailRows && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {detailRows.map((r) => (
            <span key={r.k} style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: 9, color: INK.dim, lineHeight: 1.35 }}>
              <Check style={{ width: 9, height: 9, color: INK.ok }} />
              {r.k}: {r.v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Colored credential/token segments rendered under a node.
function Chip({ box, segments }: { box: Box; segments: string[] }) {
  const colors = ["var(--idira-blue-500)", "var(--status-warning)", "var(--idira-blue-250)"];
  return (
    <div
      style={{
        position: "absolute",
        left: `${box.left}%`,
        top: `${box.top + box.height + 1.5}%`,
        display: "flex",
        gap: 4,
        alignItems: "center",
      }}
    >
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

function Diagram({ flow, step }: { flow: FlowConfig; step: WStep }) {
  const focus = new Set(step.focus ?? []);
  const activeLinks = step.links ?? [];
  const linkById = useMemo(() => Object.fromEntries(flow.links.map((l) => [l.id, l])), [flow]);
  const containers = flow.nodes.filter((n) => n.kind === "container");
  const cards = flow.nodes.filter((n) => n.kind !== "container");
  const chipNodes = (step.chips ?? [])
    .map((k) => flow.nodes.find((n) => n.key === k))
    .filter((n): n is WNode => !!n);

  return (
    <div style={{ position: "relative", width: "100%", height: flow.canvasHeight ?? 360 }}>
      {/* dormant rails — painted behind everything */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        {flow.links.map((l) => (
          <path key={`rail-${l.id}`} d={l.d} fill="none" stroke={INK.line} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>

      {/* container rings behind cards */}
      {containers.map((n) => (
        <ContainerRing key={n.key} box={n.box} label={n.title} active={focus.has(n.key)} />
      ))}

      {/* cards */}
      {cards.map((n) => {
        const d = step.detail?.[n.key];
        return (
          <ActorCard
            key={n.key}
            node={n}
            lit={focus.has(n.key)}
            detailLines={d?.lines}
            detailOk={d?.ok}
            detailRows={d?.rows}
            keyProp={`${n.key}-${step.title}-${focus.has(n.key)}`}
          />
        );
      })}

      {/* active connectors + end-dots — painted ABOVE the cards (DOM order) so
          a line terminating on a box edge sits on the top-most layer */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      >
        {activeLinks.map((l) => {
          const g = linkById[l.id];
          if (!g) return null;
          const col = toneColor(l.tone);
          return (
            <g key={`live-${l.id}`}>
              <path d={g.d} fill="none" stroke={col} strokeWidth={1.6} vectorEffect="non-scaling-stroke" className="wk-flow" />
              <circle cx={g.head.x} cy={g.head.y} r={1} fill={col} />
            </g>
          );
        })}
      </svg>

      {/* credential chips */}
      {flow.chip &&
        flow.chip.length > 0 &&
        chipNodes.map((n) => <Chip key={`chip-${n.key}`} box={n.box} segments={flow.chip!} />)}

      {/* connector labels (crisp HTML over the distorted SVG space) */}
      {activeLinks.map((l) => {
        const g = linkById[l.id];
        if (!g || !l.label) return null;
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

// Segmented control to switch between a provider's flows.
function FlowSelector({
  flows,
  active,
  onChange,
}: {
  flows: FlowConfig[];
  active: number;
  onChange: (i: number) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 2, padding: 3, background: "rgba(6,18,55,0.6)", border: "1px solid rgba(97,134,252,0.2)", borderRadius: 9 }}>
      {flows.map((f, i) => {
        const on = i === active;
        return (
          <button
            key={f.key + i}
            onClick={() => onChange(i)}
            style={{
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.01em",
              padding: "5px 12px",
              color: on ? "#fff" : "rgba(196,210,250,0.6)",
              background: on ? "var(--idira-blue-500)" : "transparent",
              boxShadow: on ? "0 2px 10px rgba(38,91,255,0.45)" : "none",
              transition: "all 160ms var(--ease-standard)",
            }}
          >
            {f.navLabel}
          </button>
        );
      })}
    </div>
  );
}

export function Walkthrough({ provider }: WalkthroughProps) {
  const flows = flowsForProvider(provider.id);
  const [flowIdx, setFlowIdx] = useState(0);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);

  const flow = flows?.[Math.min(flowIdx, (flows?.length ?? 1) - 1)] ?? null;
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
  const switchFlow = (n: number) => {
    setFlowIdx(n);
    setI(0);
    setPlaying(false);
  };

  return (
    <div style={ws.scroll}>
      <div style={ws.wrap}>
        <header style={ws.header}>
          <span style={ws.eyebrow}>{flow.eyebrow}</span>
          <h2 style={ws.title}>{flow.title}</h2>
          <p style={ws.lede}>{flow.lede}</p>
          {flows && flows.length > 1 && (
            <FlowSelector flows={flows} active={flowIdx} onChange={switchFlow} />
          )}
        </header>

        <div style={ws.stage}>
          <div style={ws.stageHead}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={ws.stepCount}>
                Step {i + 1} of {total}
                {step.badge && <span style={ws.badge}>{step.badge}</span>}
              </span>
              <span style={ws.stepTitle}>{step.title}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <CtrlButton onClick={togglePlay} title={playing ? "Pause" : "Play"}>
                {playing ? <Pause style={{ width: 14, height: 14 }} /> : <Play style={{ width: 14, height: 14 }} />}
              </CtrlButton>
              <CtrlButton onClick={() => go(i - 1)} disabled={atStart} title="Previous step">
                <ChevronLeft style={{ width: 15, height: 15 }} />
              </CtrlButton>
              <CtrlButton onClick={() => go(i + 1)} disabled={atEnd} title="Next step">
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

        {flow.features && flow.features.length > 0 && (
          <div style={ws.features}>
            {flow.features.map((f) => (
              <div key={f.title} style={ws.feature}>
                <span style={ws.featureTitle}>{f.title}</span>
                <span style={ws.featureBody}>{f.body}</span>
              </div>
            ))}
          </div>
        )}
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
  title: { margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: INK.text },
  lede: { margin: 0, maxWidth: 560, fontSize: 13, lineHeight: 1.55, color: INK.dim },
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
  stageHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  stepCount: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: INK.faint,
  },
  badge: {
    fontFamily: "var(--font-mono)",
    fontSize: 8.5,
    fontWeight: 700,
    letterSpacing: "0.1em",
    color: "var(--status-warning)",
    border: "1px solid rgba(214,159,37,0.5)",
    borderRadius: 999,
    padding: "1px 7px",
  },
  stepTitle: { fontSize: 14.5, fontWeight: 700, color: INK.text, letterSpacing: "-0.01em" },
  narration: { display: "flex", flexDirection: "column" as const, gap: 12 },
  body: { margin: 0, fontSize: 12.5, lineHeight: 1.6, color: INK.dim, minHeight: 60 },
  progressTrack: { height: 3, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" as const },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    background: "var(--idira-blue-500)",
    boxShadow: "0 0 10px var(--idira-blue-500)",
    transition: "width 500ms var(--ease-emphasis)",
  },
  features: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 },
  feature: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 7,
    padding: "14px 15px",
    borderRadius: "var(--radius-md)",
    border: "1px solid rgba(97,134,252,0.15)",
    background: "rgba(120,150,255,0.035)",
  },
  featureTitle: { fontSize: 12.5, fontWeight: 700, color: INK.text },
  featureBody: { fontSize: 11, lineHeight: 1.55, color: INK.faint },
};
