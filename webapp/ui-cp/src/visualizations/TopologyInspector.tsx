// TopologyInspector -- the CP trust-path diagram. A vertical chain of four
// cards: the trusted app, the AIM Credential Provider (application-hash + OS
// user/path authentication), the Vault (Safe authorization), and the returned
// credential. Edges carry energy pulses as each of the five stages fires.
import { CircleCheckBig, ShieldOff } from "lucide-react";
import { INK, Kv, type InspectorProps } from "./common";
import { CP } from "../engine/cp";

type CVS = "locked" | "active" | "done" | "failed";

function VLink({ state }: { state: CVS }) {
  const lit = state === "done";
  return (
    <div style={ts.vlinkWrap}>
      <div
        style={{
          ...ts.vlinkBase,
          background: lit
            ? "var(--idira-blue-500)"
            : state === "failed"
              ? INK.dangerLine
              : INK.line,
        }}
      >
        {state === "active" && (
          <div className="ic-flow" style={ts.vlinkPulse} />
        )}
      </div>
      {state !== "locked" && (
        <div
          style={{
            ...ts.vArrow,
            borderTopColor: lit
              ? "var(--idira-blue-500)"
              : state === "failed"
                ? INK.danger
                : INK.mono,
          }}
        />
      )}
    </div>
  );
}

function NodeCard({
  title,
  tag,
  state,
  children,
}: {
  title: string;
  tag: string;
  state: CVS;
  children?: React.ReactNode;
}) {
  const isActive = state === "active";
  const isDone = state === "done";
  const isFailed = state === "failed";
  const border = isFailed
    ? INK.dangerLine
    : isDone || isActive
      ? "var(--idira-blue-500)"
      : INK.line;
  const tagColor = isFailed ? INK.danger : isDone ? INK.ok : INK.mono;

  return (
    <div
      style={{
        ...ts.card,
        borderColor: border,
        borderStyle: isFailed ? "dashed" : "solid",
        background: isFailed
          ? "rgba(250,88,45,0.07)"
          : isActive
            ? INK.cardActive
            : isDone
              ? "rgba(38,91,255,0.07)"
              : INK.card,
        boxShadow: isActive
          ? "0 0 0 1px var(--idira-blue-500), 0 8px 30px rgba(38,91,255,0.25)"
          : "none",
        opacity: state === "locked" ? 0.5 : 1,
        animation: isActive
          ? "topoPop 360ms var(--ease-emphasis) both"
          : "none",
      }}
    >
      <div style={ts.cardHead}>
        <span
          style={{ ...ts.cardTitle, color: isFailed ? INK.danger : INK.text }}
        >
          <span
            style={{
              ...ts.cornerTick,
              borderColor: isFailed ? INK.danger : "var(--idira-blue-500)",
              opacity: isDone || isActive || isFailed ? 1 : 0.2,
            }}
          />
          {title}
        </span>
        <span style={{ ...ts.cardTag, color: tagColor }}>{tag}</span>
      </div>
      {children}
    </div>
  );
}

export function TopologyInspector({
  status,
  stage,
  completed,
  scenario,
  failStage,
  result,
}: InspectorProps) {
  const errored = status === "error";
  const done = status === "done";
  const dual = scenario === "dual";

  // Card state helper. activeStages = stages that light this card; doneAfter =
  // completed threshold at which it is fully passed; failsAt = fail indices.
  const stateFor = (
    activeStages: number[],
    doneAfter: number,
    failsAt: number[],
  ): CVS => {
    if (errored && failsAt.includes(failStage)) return "failed";
    if (completed >= doneAfter) return "done";
    if (activeStages.includes(stage)) return "active";
    return "locked";
  };

  const appState = stateFor([0], 1, [0]);
  const provState = stateFor([1, 2], 3, [1, 2]);
  const vaultState = stateFor([3], 4, [3]);
  const credState = stateFor([4], 5, []);

  const linkState = (into: number): CVS => {
    if (errored && failStage >= 0 && into > failStage) return "locked";
    if (stage === into) return "active";
    if (completed >= into) return "done";
    return "locked";
  };

  const appHash = result?.appHash || "—";
  const osUser = result?.osUser || CP.ctx.auth;
  const callerPath = result?.callerPath || "cp-caller.jar";
  const safe = result?.safe || CP.ctx.safe;
  const account = result?.account || "—";

  return (
    <div style={ts.scroll}>
      <div style={ts.canvas}>
        {/* App / trusted JAR */}
        <NodeCard
          title="App · Trusted JAR"
          tag={appState === "done" ? "invoked" : "caller"}
          state={appState}
        >
          <Kv k="Calling application" v={callerPath} />
          <span style={ts.foot}>
            the workload stores no password or client cert
          </span>
        </NodeCard>

        <VLink state={linkState(1)} />

        {/* AIM Credential Provider */}
        <NodeCard
          title="AIM Credential Provider"
          tag={
            provState === "failed"
              ? "authn deny"
              : provState === "done"
                ? "authenticated"
                : "measuring"
          }
          state={provState}
        >
          {provState === "failed" ? (
            <span style={ts.dangerNote}>
              {result?.errorCode ? `${result.errorCode} · ` : ""}application
              hash is not authorized
            </span>
          ) : (
            <div style={ts.grid2}>
              <Kv
                k="Application hash"
                v={appHash}
                vColor={provState === "done" ? INK.ok : INK.mono}
              />
              <Kv k="OS user · path" v={osUser} />
            </div>
          )}
          <span style={ts.foot}>
            authenticates the calling application by its characteristics
          </span>
        </NodeCard>

        <VLink state={linkState(3)} />

        {/* Vault -- Safe authorization */}
        <NodeCard
          title="Vault · App permission"
          tag={
            vaultState === "failed"
              ? "authz deny"
              : vaultState === "done"
                ? "authorized"
                : ""
          }
          state={vaultState}
        >
          {vaultState === "failed" ? (
            <span style={ts.dangerNote}>
              {result?.errorCode ? `${result.errorCode} · ` : ""}Application not
              permitted for Safe {safe}
            </span>
          ) : (
            <Kv
              k="Safe"
              v={safe}
              vColor={vaultState === "done" ? INK.ok : INK.mono}
            />
          )}
          <span style={ts.foot}>
            authorizes the Application for the requested Safe
          </span>
        </NodeCard>

        <VLink state={linkState(4)} />

        {/* Credential */}
        <NodeCard
          title="Credential"
          tag={credState === "done" ? "returned" : ""}
          state={credState}
        >
          {credState === "done" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Kv
                k={dual ? "Active account" : "Account"}
                v={dual ? result?.dualActive || account : account}
              />
              <Kv
                k="Value (masked)"
                v={result?.masked || "—"}
                vColor={INK.ok}
              />
            </div>
          ) : (
            <span style={ts.dimNote}>
              secret hashed on host · only the preview crosses the bridge
            </span>
          )}
        </NodeCard>

        {errored && (
          <div style={ts.boundary}>
            <span style={{ ...ts.cardTitle, color: INK.danger }}>
              <ShieldOff style={{ width: 13, height: 13 }} />{" "}
              {scenario === "denied"
                ? "Authorization boundary"
                : "Authentication boundary"}
            </span>
            <span style={ts.boundaryBody}>
              {scenario === "denied"
                ? "The caller was authenticated, but the Application is not a member of the requested Safe. Nothing was returned."
                : "The calling application's hash is not registered on the Application. Rejected before any Safe was evaluated — as designed."}
            </span>
          </div>
        )}

        {done && (
          <div style={ts.resolved}>
            <CircleCheckBig style={{ width: 14, height: 14 }} />
            credential returned · full secret never left the host
          </div>
        )}
      </div>

      {done && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, transparent, rgba(38,91,255,0.4), transparent)",
            animation: "topoFlash 280ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
            pointerEvents: "none" as const,
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
}

const ts = {
  scroll: {
    position: "relative" as const,
    height: "100%",
    overflowY: "auto" as const,
    padding: "22px 30px 30px",
  },
  canvas: {
    maxWidth: 560,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column" as const,
  },
  card: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 9,
    padding: "14px 16px",
    border: "1px solid",
    borderRadius: "var(--radius-md)",
    transition: "all 320ms var(--ease-standard)",
    backdropFilter: "blur(2px)",
  },
  cardHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "space-between",
  },
  cardTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  cornerTick: {
    width: 7,
    height: 7,
    borderLeft: "2px solid",
    borderTop: "2px solid",
    display: "inline-block",
  },
  cardTag: {
    fontFamily: "var(--font-mono)",
    fontSize: 10.5,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    fontWeight: 600,
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "11px 14px",
  },
  foot: {
    fontFamily: "var(--font-mono)",
    fontSize: 10.5,
    color: INK.faint,
    letterSpacing: "0.02em",
  },
  vlinkWrap: {
    position: "relative" as const,
    height: 30,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  vlinkBase: {
    position: "relative" as const,
    width: 2,
    height: "100%",
    overflow: "hidden",
    transition: "background 300ms",
  },
  vlinkPulse: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: "100%",
    height: "50%",
    background: "linear-gradient(180deg, transparent, #9DB4FF, transparent)",
    animation: "topoFlowY 0.9s linear infinite",
  },
  vArrow: {
    position: "absolute" as const,
    bottom: -1,
    width: 0,
    height: 0,
    borderLeft: "4px solid transparent",
    borderRight: "4px solid transparent",
    borderTop: "5px solid",
  },
  dimNote: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: INK.faint,
    fontStyle: "italic" as const,
  },
  dangerNote: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: INK.danger,
    lineHeight: 1.5,
  },
  boundary: {
    marginTop: 20,
    padding: "13px 16px",
    border: `1.5px dashed ${INK.dangerLine}`,
    borderRadius: "var(--radius-md)",
    background: "rgba(250,88,45,0.07)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 7,
    animation: "topoPop 360ms var(--ease-emphasis) both",
  },
  boundaryBody: {
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    color: "rgba(255,180,150,0.85)",
    lineHeight: 1.55,
  },
  resolved: {
    marginTop: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 600,
    color: INK.ok,
    fontFamily: "var(--font-mono)",
    animation: "topoPop 360ms var(--ease-emphasis) both",
  },
};
