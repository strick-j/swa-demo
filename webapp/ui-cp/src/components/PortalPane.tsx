// PortalPane -- left pane of the CP demo. "Retrieve a credential": pick one of
// four use cases, run it, and render idle / running / done (masked result) /
// error (APPAP denial), with the per-scenario evidence copy.
import {
  KeyRound,
  Info,
  ScanSearch,
  XOctagon,
  CheckCircle2,
  ChevronLeft,
} from "lucide-react";
import { Button } from "./Button";
import { Badge } from "./Badge";
import { Tag } from "./Tag";
import { Evidence } from "./Evidence";
import { pmeta, type Provider, type ScenarioKey } from "../engine/providers";
import type { EngineStatus } from "../engine/useResolveEngine";
import type { DbRow, ProviderResult } from "../visualizations/common";

interface PortalPaneProps {
  provider: Provider;
  scenario: ScenarioKey;
  setScenario: (v: ScenarioKey) => void;
  status: EngineStatus;
  stageVerb: string;
  onResolve: () => void;
  result: ProviderResult | null;
}

const ps = {
  pane: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    background: "var(--surface-card)",
    overflow: "hidden",
  },
  appbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 36px",
    borderBottom: "1px solid var(--border-subtle)",
    flexShrink: 0,
  },
  homeBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "var(--font-sans)",
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-muted)",
    textDecoration: "none",
    padding: "7px 12px 7px 9px",
    border: "1px solid var(--border-default)",
    borderRadius: 999,
    background: "var(--neutral-0)",
    transition: "all 160ms var(--ease-standard)",
    whiteSpace: "nowrap" as const,
  },
  brand: { display: "flex", alignItems: "center", gap: 11 },
  brandName: {
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    fontSize: 15,
    color: "var(--text-strong)",
    letterSpacing: "-0.01em",
  },
  brandSub: {
    fontSize: 11,
    color: "var(--text-muted)",
    letterSpacing: "0.01em",
  },
  secured: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.02em",
    padding: "6px 11px 6px 9px",
    border: "1px solid var(--border-subtle)",
    borderRadius: 999,
  },
  body: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "36px 36px 16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 24,
  },
  // A non-shrinking flow child guarantees bottom breathing room: a flex-item
  // scroll container clips its own padding-bottom, but a real child stays in the
  // scroll range.
  bottomPad: { height: 56, flexShrink: 0 as const },
  hero: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
    maxWidth: 470,
  },
  h1: {
    fontSize: "clamp(1.9rem, 1.2rem + 2vw, 2.7rem)",
    margin: 0,
    color: "var(--text-strong)",
    letterSpacing: "-0.025em",
    lineHeight: 1.04,
  },
  lede: {
    margin: 0,
    fontSize: 14.5,
    lineHeight: 1.55,
    color: "var(--text-muted)",
    maxWidth: 460,
  },
  selectWrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
    maxWidth: 470,
  },
  ucList: { display: "flex", flexDirection: "column" as const, gap: 8 },
  ucBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    width: "100%",
    textAlign: "left" as const,
    padding: "12px 14px",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    transition: "all 160ms var(--ease-standard)",
  },
  ucLabel: { fontSize: 14, fontWeight: 600, color: "var(--text-strong)" },
  desc: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-muted)",
    maxWidth: 470,
    minHeight: 40,
  },
  formHint: {
    display: "flex",
    gap: 7,
    fontSize: 12.5,
    color: "var(--text-subtle)",
    lineHeight: 1.45,
    marginTop: -2,
    maxWidth: 470,
  },
  result: { minHeight: 60, maxWidth: 470 },
  empty: {
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "22px 0",
    borderTop: "1px solid var(--border-subtle)",
    color: "var(--text-subtle)",
    fontSize: 13.5,
  },
  workingDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    background: "var(--brand)",
    flexShrink: 0,
    animation: "praetorPulse 1.1s var(--ease-standard) infinite",
  },
  resultIn: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 18,
    paddingTop: 22,
    borderTop: "1px solid var(--border-subtle)",
    animation: "praetorRise 420ms var(--ease-emphasis) both",
  },
  mfHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mfTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-strong)",
  },
  manifest: { display: "flex", flexDirection: "column" as const },
  mfRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 16,
    padding: "10px 0",
    borderBottom: "1px solid var(--border-subtle)",
  },
  mfKey: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    letterSpacing: "0.01em",
    flexShrink: 0,
  },
  mfVal: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-body)",
    fontFamily: "var(--font-mono)",
    textAlign: "right" as const,
    wordBreak: "break-all" as const,
  },
  token: {
    fontFamily: "var(--font-mono)",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--idira-blue-750)",
    background: "var(--surface-brand-tint)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 8,
    padding: "10px 12px",
    wordBreak: "break-all" as const,
  },
  dbTable: {
    marginTop: 8,
    border: "1px solid var(--border-subtle)",
    borderRadius: 10,
    overflow: "hidden" as const,
  },
  dbRow: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    gap: 10,
    alignItems: "baseline",
    padding: "9px 12px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  dbRef: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-strong)",
  },
  dbRoute: { fontSize: 12.5, color: "var(--text-muted)" },
  dbStatus: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--idira-blue-750)",
    background: "var(--surface-brand-tint)",
    borderRadius: 999,
    padding: "2px 9px",
    whiteSpace: "nowrap" as const,
  },
  errAccent: { borderLeft: "3px solid var(--status-danger)", paddingLeft: 12 },
  errBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  errCode: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    color: "var(--status-danger)",
    fontFamily: "var(--font-mono)",
    fontSize: 16,
    fontWeight: 600,
  },
  errMsg: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.55,
    fontFamily: "var(--font-mono)",
    wordBreak: "break-all" as const,
  },
};

function Row({ k, v, token }: { k: string; v: string; token?: boolean }) {
  if (!v) return null;
  if (token) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "12px 0 2px",
        }}
      >
        <span style={ps.mfKey}>{k}</span>
        <span style={ps.token}>{v}</span>
      </div>
    );
  }
  return (
    <div style={ps.mfRow}>
      <span style={ps.mfKey}>{k}</span>
      <span style={ps.mfVal}>{v}</span>
    </div>
  );
}

// DbTable renders the shipments rows returned through the SPIFFE gateway (SWA).
function DbTable({ rows }: { rows: DbRow[] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div>
      <span className="idira-eyebrow" style={{ color: "var(--text-muted)" }}>
        Shipments · via the SPIFFE gateway
      </span>
      <div style={ps.dbTable}>
        {rows.map((r, i) => (
          <div key={i} style={ps.dbRow}>
            <span style={ps.dbRef}>{r.ref}</span>
            <span style={ps.dbRoute}>
              {r.origin} → {r.destination}
            </span>
            <span style={ps.dbStatus}>{r.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PortalPane({
  provider,
  scenario,
  setScenario,
  status,
  stageVerb,
  onResolve,
  result,
}: PortalPaneProps) {
  const busy = status === "running";
  const done = status === "done";
  const isError = status === "error";
  const meta = pmeta(provider, scenario);
  const r = result;
  const isSwa = provider.id === "swa";

  return (
    <div style={ps.pane}>
      <header style={ps.appbar}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <a
            href="/"
            style={ps.homeBtn}
            title="Back to all demos"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-brand-tint)";
              e.currentTarget.style.color = "var(--idira-blue-750)";
              e.currentTarget.style.borderColor = "var(--border-brand)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--neutral-0)";
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.borderColor = "var(--border-default)";
            }}
          >
            <ChevronLeft size={16} />
            <span>All demos</span>
          </a>
          <div style={ps.brand}>
            <img
              src="/cp/assets/idira-icon-color.png"
              alt=""
              style={{ height: 22, width: "auto" }}
            />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                lineHeight: 1.05,
              }}
            >
              <span style={ps.brandName}>{provider.brand.name}</span>
              <span style={ps.brandSub}>{provider.brand.sub}</span>
            </div>
          </div>
        </div>
        <div style={ps.secured}>
          <img
            src="/cp/assets/idira-icon-color.png"
            alt=""
            style={{ height: 16, width: "auto" }}
          />
          <span>Secured by Idira</span>
        </div>
      </header>

      <div style={ps.body}>
        <div style={ps.hero}>
          <h1 style={ps.h1}>{provider.heroTitle}</h1>
          <p style={ps.lede}>{provider.heroLede}</p>
        </div>

        {/* use-case selection */}
        <div style={ps.selectWrap}>
          <label
            className="idira-eyebrow"
            style={{ color: "var(--text-muted)" }}
          >
            Use case
          </label>
          <div style={ps.ucList}>
            {provider.scenarioOrder.map((k) => {
              const s = pmeta(provider, k);
              const on = k === scenario;
              return (
                <button
                  key={k}
                  onClick={() => setScenario(k)}
                  disabled={busy}
                  style={{
                    ...ps.ucBtn,
                    border: `1px solid ${on ? "var(--border-brand)" : "var(--border-default)"}`,
                    background: on
                      ? "var(--surface-brand-tint)"
                      : "var(--neutral-0)",
                    boxShadow: on ? "var(--shadow-xs)" : "none",
                    cursor: busy ? "not-allowed" : "pointer",
                  }}
                >
                  <span style={ps.ucLabel}>{s.label}</span>
                  <Tag tone={s.ok ? "success" : "danger"}>{s.tag}</Tag>
                </button>
              );
            })}
          </div>
          <p style={ps.desc}>{meta.desc}</p>
          <Button
            size="lg"
            fullWidth
            onClick={onResolve}
            loading={busy}
            iconLeft={!busy ? <KeyRound size={19} /> : undefined}
          >
            {busy
              ? stageVerb || "Retrieving…"
              : done || isError
                ? "Retrieve again"
                : "Retrieve credential"}
          </Button>
          <div style={ps.formHint}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Watch the identity exchange unfold in the Idira Inspector on the
              right.
            </span>
          </div>
        </div>

        {/* result region */}
        <div style={ps.result}>
          {status === "idle" && (
            <div style={ps.empty}>
              <ScanSearch size={22} style={{ opacity: 0.5 }} />
              <span>
                Run a use case to authenticate the caller and retrieve the
                credential.
              </span>
            </div>
          )}

          {busy && (
            <div style={ps.empty}>
              <span style={ps.workingDot} />
              <span>
                {stageVerb || "Working"} — this workload stores no credential…
              </span>
            </div>
          )}

          {done && r && !isSwa && (
            <div style={ps.resultIn}>
              <div style={ps.mfHead}>
                <span style={ps.mfTitle}>
                  <CheckCircle2
                    size={18}
                    style={{ color: "var(--status-success)" }}
                  />
                  Credential retrieved
                </span>
                <Badge tone="success" dot>
                  {r.simulated ? "Simulated" : "Live"}
                </Badge>
              </div>
              <div style={ps.manifest}>
                <Row k="Application" v={r.appId} />
                <Row k="Identity" v={r.identity} />
                <Row k="Auth method" v={r.authMethod} />
                <Row k="Secrets Manager host" v={r.conjurHost} />
                <Row k="Variable" v={r.secretName} />
                <Row k="Client certificate (CN)" v={r.certCn} />
                <Row k="Caller fingerprint" v={r.appHash} />
                <Row
                  k="Caller · OS user"
                  v={[r.callerPath, r.osUser && `(${r.osUser})`]
                    .filter(Boolean)
                    .join(" ")}
                />
                <Row k="Safe" v={r.safe} />
                <Row k="Object / query" v={r.query} />
                <Row k="Returned account" v={r.account} />
                <Row k="Address" v={r.address} />
                <Row k="Virtual username" v={r.virtualUsername} />
                <Row k="Active account" v={r.dualActive} />
              </div>
              <Row k="Value (masked)" v={r.masked} token />
              <Evidence kind="success" items={meta.evidence} />
            </div>
          )}

          {done && r && isSwa && (
            <div style={ps.resultIn}>
              <div style={ps.mfHead}>
                <span style={ps.mfTitle}>
                  <CheckCircle2
                    size={18}
                    style={{ color: "var(--status-success)" }}
                  />
                  Identity verified · resource reached
                </span>
                <Badge tone="success" dot>
                  {r.simulated ? "Simulated" : "Live"}
                </Badge>
              </div>
              <div style={ps.manifest}>
                <Row k="SPIFFE ID" v={r.spiffeId} />
                <Row
                  k="SVID"
                  v={[r.jwtAlg, r.audience && `aud=${r.audience}`]
                    .filter(Boolean)
                    .join(" · ")}
                />
              </div>
              <DbTable rows={r.dbRows} />
              <Evidence kind="success" items={meta.evidence} />
            </div>
          )}

          {isError && !isSwa && (
            <div style={ps.resultIn}>
              <div style={ps.errAccent}>
                <div style={ps.errBar}>
                  <div style={ps.errCode}>
                    <XOctagon size={18} />
                    <span>{r?.errorCode || meta.label}</span>
                  </div>
                  <Tag tone="danger">
                    {scenario === "denied" ? "authz deny" : "authn deny"}
                  </Tag>
                </div>
              </div>
              {r?.error && <p style={ps.errMsg}>{r.error}</p>}
              <Evidence kind="error" items={meta.evidence} />
            </div>
          )}

          {isError && isSwa && (
            <div style={ps.resultIn}>
              <div style={ps.errAccent}>
                <div style={ps.errBar}>
                  <div style={ps.errCode}>
                    <XOctagon size={18} />
                    <span>{meta.label}</span>
                  </div>
                  <Tag tone="danger">{meta.tag}</Tag>
                </div>
              </div>
              {r?.spiffeId && (
                <div style={ps.manifest}>
                  <Row
                    k={scenario === "foreign" ? "Peer identity" : "SPIFFE ID"}
                    v={r.spiffeId}
                  />
                  {r.issuer && <Row k="Issuer" v={r.issuer} />}
                </div>
              )}
              {r?.error && <p style={ps.errMsg}>{r.error}</p>}
              <Evidence kind="error" items={meta.evidence} />
            </div>
          )}
        </div>

        <div style={ps.bottomPad} />
      </div>
    </div>
  );
}
