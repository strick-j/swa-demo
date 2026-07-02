// TraceInspector -- a console-style trace of the CP retrieval. It shows the
// actual commands the demo runs: the pod's POST to the host cp-bridge, the
// bridge's `java … CpCaller` subprocess invocation (registered jar on the happy
// path, the rogue jar for invalid-hash), the provider's authn/authz steps, and
// the JSON / APPAP response. Lines reveal as each stage fires, at the chosen pace.
import { useRef, useEffect } from "react";
import { INK, type InspectorProps, type CpResult } from "./common";
import { CP } from "../engine/cp";

type LineKind = "comment" | "cmd" | "cont" | "out" | "ok" | "err";

interface Line {
  s: number; // stage this line belongs to
  kind: LineKind;
  text: string;
  terminal?: boolean; // only shown once the run settles (done/error)
}

const REGISTERED_JAR = "/opt/swa-cp/cp-caller.jar";
const ROGUE_JAR = "/opt/swa-cp/rogue/cp-caller.jar";
const SDK_JAR = "/opt/CARKaim/sdk/javapasswordsdk.jar";
const SDK_LIB = "/opt/CARKaim/sdk";

// Build the ordered console lines for a scenario + (settled) result.
function buildLines(scenario: string, r: CpResult | null): Line[] {
  const appId = r?.appId || CP.ctx.application;
  const safe = r?.safe || CP.ctx.safe;
  const query = r?.query || "Object=secrets-demo-1";
  const jar = scenario === "invalid-hash" ? ROGUE_JAR : REGISTERED_JAR;
  const args =
    scenario === "dual"
      ? `--appid ${appId} --query "${query}"${r?.virtualUsername ? ` --virtual ${r.virtualUsername}` : ""}`
      : `--appid ${appId} --safe ${safe} --${query.replace("=", " ")} --folder Root`;

  const lines: Line[] = [
    {
      s: 0,
      kind: "comment",
      text: "webapp pod → host cp-bridge (host.minikube.internal:8890)",
    },
    {
      s: 0,
      kind: "cmd",
      text: `curl -s -XPOST 'http://host.minikube.internal:8890/cp?scenario=${scenario}'`,
    },

    {
      s: 1,
      kind: "comment",
      text: "cp-bridge dispatch → java caller (subprocess)",
    },
    { s: 1, kind: "cmd", text: `java -Djava.library.path=${SDK_LIB} \\` },
    { s: 1, kind: "cont", text: `  -cp ${SDK_JAR}:${jar} \\` },
    { s: 1, kind: "cont", text: `  CpCaller ${args}` },
    {
      s: 1,
      kind: "comment",
      text: "Credential Provider measures the calling application (hash + path)",
    },

    {
      s: 2,
      kind: "comment",
      text: `checks OS user (${r?.osUser || "svc-app"}) and executable path`,
    },

    {
      s: 3,
      kind: "comment",
      text: `Vault: is Application '${appId}' authorized for Safe ${safe}?`,
    },

    { s: 4, kind: "cmd", text: "PasswordSDK.getPassword(req)" },
  ];

  // Terminal outcome lines.
  if (r?.retrieved) {
    const body = [
      "{",
      `  "ok": true,`,
      `  "app_id": "${appId}",`,
      `  "app_hash": "${r.appHash}",   // caller fingerprint (illustrative)`,
      `  "safe": "${safe}",`,
      `  "query": "${query}",`,
      `  "account": "${r.account}",`,
      r.address ? `  "address": "${r.address}",` : "",
      scenario === "dual" && r.virtualUsername
        ? `  "virtual_username": "${r.virtualUsername}",`
        : "",
      scenario === "dual" && r.dualActive
        ? `  "dual_active": "${r.dualActive}",`
        : "",
      `  "masked": "${r.masked}"`,
      "}",
    ].filter(Boolean);
    for (const t of body)
      lines.push({ s: 4, kind: "out", text: t, terminal: true });
    lines.push({
      s: 4,
      kind: "ok",
      text: "✓ retrieved · secret hashed on host — the full value never crossed the bridge",
      terminal: true,
    });
  } else if (r) {
    const failS = scenario === "denied" ? 3 : 1;
    const code =
      r.errorCode || (scenario === "denied" ? "APPAP004E" : "APPAP133E");
    // A representative APPConsole.log line, then the bridge JSON.
    lines.push({
      s: failS,
      kind: "err",
      text: `APPConsole.log  ${r.error || `${code} the request was denied`}`,
      terminal: true,
    });
    lines.push({ s: failS, kind: "out", text: "{", terminal: true });
    lines.push({
      s: failS,
      kind: "out",
      text: `  "ok": false,`,
      terminal: true,
    });
    lines.push({
      s: failS,
      kind: "out",
      text: `  "error_code": "${code}",`,
      terminal: true,
    });
    lines.push({
      s: failS,
      kind: "out",
      text: `  "error": "${(r.error || "").replace(/"/g, "'")}"`,
      terminal: true,
    });
    lines.push({ s: failS, kind: "out", text: "}", terminal: true });
    lines.push({
      s: failS,
      kind: "err",
      text:
        scenario === "denied"
          ? "✗ denied at Safe authorization — the Application is not a member of the Safe"
          : "✗ rejected at application authentication — the caller's hash is not registered",
      terminal: true,
    });
  }

  return lines;
}

const KIND_STYLE: Record<LineKind, React.CSSProperties> = {
  comment: { color: INK.faint },
  cmd: { color: INK.text },
  cont: { color: INK.dim },
  out: { color: "#9BE7C0" },
  ok: { color: INK.ok, fontWeight: 600 },
  err: { color: INK.danger, fontWeight: 600 },
};

function Prompt({ kind }: { kind: LineKind }) {
  if (kind === "cmd")
    return <span style={{ color: INK.mono, userSelect: "none" }}>$&nbsp;</span>;
  if (kind === "comment")
    return (
      <span style={{ color: INK.faint, userSelect: "none" }}>#&nbsp;</span>
    );
  if (kind === "out")
    return (
      <span style={{ color: "rgba(155,231,192,0.4)", userSelect: "none" }}>
        &nbsp;&nbsp;
      </span>
    );
  return <span style={{ userSelect: "none" }}>&nbsp;&nbsp;</span>;
}

export function TraceInspector({
  status,
  stage,
  completed,
  scenario,
  failStage,
  result,
}: InspectorProps) {
  const all = buildLines(scenario, result);

  const revealIndex =
    status === "done"
      ? 4
      : status === "error"
        ? failStage
        : status === "running"
          ? Math.max(stage, completed)
          : -1;

  const settled = status === "done" || status === "error";
  const visible = all.filter(
    (l) => l.s <= revealIndex && (!l.terminal || settled),
  );

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [visible.length, status]);

  const eventCount = visible.length;

  return (
    <div style={tc.root}>
      <div style={tc.head}>
        <span style={tc.title}>identity trace</span>
        <span style={tc.sub}>
          {status === "idle"
            ? "run a use case to stream the retrieval"
            : `${eventCount} lines · ${scenario}`}
        </span>
      </div>

      <div style={tc.console} ref={logRef}>
        {visible.length === 0 && (
          <div
            style={{
              ...KIND_STYLE.comment,
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
            }}
          >
            # cp-bridge idle — click Retrieve credential
          </div>
        )}
        {visible.map((l, i) => (
          <div key={i} style={{ ...tc.line, ...KIND_STYLE[l.kind] }}>
            <Prompt kind={l.kind} />
            <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {l.text}
            </span>
          </div>
        ))}
        {status === "running" && <span style={tc.cursor} />}
      </div>
    </div>
  );
}

const tc = {
  root: {
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    padding: "20px 26px 26px",
    minHeight: 0,
  },
  head: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: INK.mono,
  },
  sub: { fontFamily: "var(--font-mono)", fontSize: 11, color: INK.faint },
  console: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto" as const,
    background: "rgba(3,9,28,0.55)",
    border: `1px solid ${INK.line}`,
    borderRadius: "var(--radius-md)",
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
  },
  line: {
    fontFamily: "var(--font-mono)",
    fontSize: 12.5,
    lineHeight: 1.6,
    display: "flex",
    alignItems: "flex-start",
    animation: "praetorRise 240ms var(--ease-emphasis) both",
  },
  cursor: {
    display: "inline-block",
    width: 8,
    height: 15,
    marginTop: 3,
    background: INK.mono,
    animation: "trcBlink 1s step-end infinite",
  },
};
