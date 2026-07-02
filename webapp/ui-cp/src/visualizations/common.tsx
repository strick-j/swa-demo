// common.tsx -- shared palette, helpers, small primitives, and the shared
// result/prop types used by the provider-driven inspector visualizations.
import type { ScenarioKey, Provider } from "../engine/providers";

export const INK = {
  text: "#E6ECF7",
  dim: "rgba(210,222,255,0.82)",
  faint: "rgba(188,203,252,0.66)",
  mono: "#9DB4FF",
  line: "rgba(97,134,252,0.22)",
  lineActive: "var(--idira-blue-500)",
  card: "rgba(120,150,255,0.045)",
  cardActive: "rgba(38,91,255,0.12)",
  danger: "#FF7A57",
  dangerLine: "rgba(250,88,45,0.55)",
  ok: "#43E08B",
} as const;

/** Card visual state used by the topology + layers views. */
export type CVS = "locked" | "active" | "done" | "failed";

/** One row of the demo Postgres shipments table (SWA resource access). */
export interface DbRow {
  ref: string;
  origin: string;
  destination: string;
  status: string;
  carrier: string;
}

/** Result payload the engine derives from the provider's API. Carries fields for
 *  the CP (hash/path/os-user), CCP (cert CN), and SWA (SPIFFE/JWT/DB) providers;
 *  the unused ones are empty. Never the full secret — `masked` is a preview. */
export interface ProviderResult {
  retrieved: boolean;
  simulated: boolean;
  masked: string;
  error: string;
  errorCode: string;
  appId: string;
  appHash: string; // CP: caller fingerprint
  callerPath: string; // CP
  osUser: string; // CP
  certCn: string; // CCP: client-cert CN
  safe: string;
  query: string;
  account: string;
  address: string;
  virtualUsername: string;
  dualActive: string;
  // SWA (workload identity) fields:
  spiffeId: string;
  issued: boolean;
  jwtAlg: string;
  jwtKid: string;
  audience: string;
  expiresAt: string;
  dbAllowed: boolean;
  dbRows: DbRow[];
  dbError: string;
  peerUri: string;
  issuer: string;
  trustDomain: string;
  // Conjur (Secrets Manager) fields:
  identity: string; // spiffe sub (jwt) or caller ARN (iam)
  authMethod: string;
  conjurHost: string;
  awsAccount: string;
  awsRegion: string;
  secretName: string;
  tokenScope: string;
}

/** Shared props for all inspector visualizations. */
export interface InspectorProps {
  provider: Provider;
  status: "idle" | "running" | "done" | "error";
  stage: number;
  completed: number;
  scenario: ScenarioKey;
  failStage: number;
  result: ProviderResult | null;
}

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
