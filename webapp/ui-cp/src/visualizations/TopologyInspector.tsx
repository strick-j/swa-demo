// TopologyInspector -- the provider's trust-path diagram: a vertical chain of
// node cards (from provider.nodes) that light and pulse as each stage fires, and
// mark the failing node on a denial. Generic across CP and CCP.
import { Fragment } from "react";
import { CircleCheckBig, ShieldOff } from "lucide-react";
import { INK, type InspectorProps, type CVS } from "./common";
import type { ScenarioKey } from "../engine/providers";

// Boundary panel copy for the error state, keyed by the rejecting scenario.
// SWA (SPIFFE) scenarios speak identity/trust-domain, not the Credential
// Providers' Application-hash/Safe vocabulary — each family owns its own copy.
function boundaryCopy(scenario: ScenarioKey): { title: string; body: string } {
  switch (scenario) {
    // SWA · SPIFFE
    case "untrusted":
      return {
        title: "Authorization boundary",
        body: "The workload holds a valid SVID, but its SPIFFE ID is not allow-listed at the gateway. ghostunnel refused the mTLS connection before Postgres was ever reached.",
      };
    case "unknown":
      return {
        title: "Identity boundary",
        body: "No registration policy matched this workload, so the trust domain declined to mint an SVID. With no identity, it could not even attempt the gateway — as designed.",
      };
    case "foreign":
      return {
        title: "Trust boundary",
        body: "The peer presented an SVID from a different trust domain. Its trust root does not anchor to this domain, so the connection was rejected at the boundary.",
      };
    case "trusted":
      return {
        title: "Retrieval failed",
        body: "The workload's identity checks out, but the database read through the SPIFFE gateway did not complete — check the SWA agent, the ghostunnel gateway, and Postgres reachability.",
      };
    // Credential Providers · CCP
    case "denied":
      return {
        title: "Authorization boundary",
        body: "The caller was authenticated, but the Application is not a member of the requested Safe. Nothing was returned.",
      };
    case "no-cert":
      return {
        title: "Authentication boundary",
        body: "No client certificate was presented. AIMWebService requires mutual TLS — rejected at the door, as designed.",
      };
    // Secrets Manager · Conjur (authn-jwt / authn-iam)
    case "invalid":
      return {
        title: "Authentication boundary",
        body: "The workload's signed identity was not accepted by the authenticator. Authentication failed before any variable was read — no scoped token was issued.",
      };
    default:
      return {
        title: "Authentication boundary",
        body: "The calling application's hash is not registered on the Application. Rejected before any Safe was evaluated — as designed.",
      };
  }
}

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
        {tag && <span style={{ ...ts.cardTag, color: tagColor }}>{tag}</span>}
      </div>
      {children}
    </div>
  );
}

export function TopologyInspector({
  provider,
  status,
  stage,
  completed,
  scenario,
  failStage,
  result,
}: InspectorProps) {
  const errored = status === "error";
  const done = status === "done";

  const stateFor = (
    stages: number[],
    doneAfter: number,
    failsAt: number[],
  ): CVS => {
    if (errored && failsAt.includes(failStage)) return "failed";
    if (completed >= doneAfter) return "done";
    if (stages.includes(stage)) return "active";
    return "locked";
  };

  const linkState = (into: number): CVS => {
    if (errored && failStage >= 0 && into > failStage) return "locked";
    if (stage === into) return "active";
    if (completed >= into) return "done";
    return "locked";
  };

  const { title: boundaryTitle, body: boundaryBody } = boundaryCopy(scenario);

  return (
    <div style={ts.scroll}>
      <div style={ts.canvas}>
        {provider.nodes.map((node, i) => {
          const st = stateFor(node.stages, node.doneAfter, node.failsAt);
          const next = provider.nodes[i + 1];
          return (
            <Fragment key={node.key}>
              <NodeCard title={node.title} tag={node.tag(st)} state={st}>
                {node.body({ state: st, result, scenario })}
              </NodeCard>
              {next && <VLink state={linkState(next.stages[0] ?? 0)} />}
            </Fragment>
          );
        })}

        {errored && (
          <div style={ts.boundary}>
            <span style={{ ...ts.cardTitle, color: INK.danger }}>
              <ShieldOff style={{ width: 13, height: 13 }} /> {boundaryTitle}
            </span>
            <span style={ts.boundaryBody}>{boundaryBody}</span>
          </div>
        )}

        {done && (
          <div style={ts.resolved}>
            <CircleCheckBig style={{ width: 14, height: 14 }} />
            credential returned · full secret never exposed
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
    overflowX: "hidden" as const,
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
