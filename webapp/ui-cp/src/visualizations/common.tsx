// common.tsx -- shared palette, helpers, and small primitives used by the
// inspector visualizations. Dark-theme ink palette + CP result/prop types.
import type { ScenarioKey } from "../engine/cp";

export const INK = {
  text: "#E6ECF7",
  dim: "rgba(196,210,250,0.62)",
  faint: "rgba(173,192,252,0.40)",
  mono: "#9DB4FF",
  line: "rgba(97,134,252,0.22)",
  lineActive: "var(--idira-blue-500)",
  card: "rgba(120,150,255,0.045)",
  cardActive: "rgba(38,91,255,0.12)",
  danger: "#FF7A57",
  dangerLine: "rgba(250,88,45,0.55)",
  ok: "#43E08B",
} as const;

/** Masked-result payload the engine derives from POST /api/cp. Never the full
 *  secret — the `masked` string is a preview + length + SHA-256 summary. */
export interface CpResult {
  retrieved: boolean;
  simulated: boolean;
  masked: string;
  error: string;
  errorCode: string;
  appId: string;
  appHash: string;
  callerPath: string;
  osUser: string;
  safe: string;
  query: string;
  account: string;
  address: string;
  virtualUsername: string;
  dualActive: string;
}

/** Shared props for all inspector visualizations. */
export interface InspectorProps {
  status: "idle" | "running" | "done" | "error";
  /** Currently animating stage index (-1 when idle/settled). */
  stage: number;
  /** Count of completed stages. */
  completed: number;
  scenario: ScenarioKey;
  /** Stage index the active scenario fails at (-1 = succeeds). */
  failStage: number;
  result: CpResult | null;
}

// Thin meter bar -- progress visualization used by the topology cards.
interface MeterProps {
  pct: number;
  tone?: "brand" | "danger" | "muted";
  active?: boolean;
}

export function Meter({ pct, tone = "brand", active = false }: MeterProps) {
  const color =
    tone === "danger"
      ? INK.danger
      : tone === "muted"
        ? INK.faint
        : "var(--idira-blue-500)";
  return (
    <div
      style={{
        position: "relative",
        height: 3,
        borderRadius: 3,
        background: "rgba(255,255,255,0.08)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${pct}%`,
          background: color,
          borderRadius: 3,
          transition: "width 600ms var(--ease-emphasis)",
          boxShadow: active ? `0 0 10px ${color}` : "none",
        }}
      />
    </div>
  );
}

// Label + value token row -- used by topology cards.
interface KvProps {
  k: string;
  v: string;
  vColor?: string;
}

export function Kv({ k, v, vColor }: KvProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span
        style={{
          fontSize: 9.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: INK.faint,
          fontWeight: 600,
        }}
      >
        {k}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: vColor ?? INK.mono,
          wordBreak: "break-all",
          lineHeight: 1.45,
        }}
      >
        {v}
      </span>
    </div>
  );
}
