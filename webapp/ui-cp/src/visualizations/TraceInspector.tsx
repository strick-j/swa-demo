// TraceInspector -- a console-style trace of the retrieval. It renders the real
// commands the demo runs (from provider.buildTrace): the pod's request to the
// provider, the caller/curl invocation, the authn/authz steps, and the JSON /
// APPAP response — revealed line by line at the chosen pace.
import { useRef, useEffect } from "react";
import { INK, type InspectorProps } from "./common";
import type { LineKind } from "../engine/providers";

const KIND_STYLE: Record<LineKind, React.CSSProperties> = {
  comment: { color: INK.faint },
  cmd: { color: INK.text },
  cont: { color: INK.dim },
  out: { color: "#9BE7C0" },
  ok: { color: INK.ok, fontWeight: 600 },
  err: { color: INK.danger, fontWeight: 600 },
};

function Prompt({ kind }: { kind: LineKind }) {
  if (kind === "cmd") return <span style={{ color: INK.mono, userSelect: "none" }}>$&nbsp;</span>;
  if (kind === "comment") return <span style={{ color: INK.faint, userSelect: "none" }}>#&nbsp;</span>;
  if (kind === "out") return <span style={{ color: "rgba(155,231,192,0.4)", userSelect: "none" }}>&nbsp;&nbsp;</span>;
  return <span style={{ userSelect: "none" }}>&nbsp;&nbsp;</span>;
}

export function TraceInspector({ provider, status, stage, completed, scenario, failStage, result }: InspectorProps) {
  const all = provider.buildTrace(scenario, result);

  const revealIndex =
    status === "done"
      ? provider.stages.length - 1
      : status === "error"
        ? failStage
        : status === "running"
          ? Math.max(stage, completed)
          : -1;

  const settled = status === "done" || status === "error";
  const visible = all.filter((l) => l.s <= revealIndex && (!l.terminal || settled));

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [visible.length, status]);

  return (
    <div style={tc.root}>
      <div style={tc.head}>
        <span style={tc.title}>identity trace</span>
        <span style={tc.sub}>
          {status === "idle" ? "run a use case to stream the retrieval" : `${visible.length} lines · ${scenario}`}
        </span>
      </div>

      <div style={tc.console} ref={logRef}>
        {visible.length === 0 && (
          <div style={{ ...KIND_STYLE.comment, fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
            # idle — click Retrieve credential
          </div>
        )}
        {visible.map((l, i) => (
          <div key={i} style={{ ...tc.line, ...KIND_STYLE[l.kind] }}>
            <Prompt kind={l.kind} />
            <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{l.text}</span>
          </div>
        ))}
        {status === "running" && <span style={tc.cursor} />}
      </div>
    </div>
  );
}

const tc = {
  root: { height: "100%", display: "flex", flexDirection: "column" as const, padding: "20px 26px 26px", minHeight: 0 },
  head: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 11.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: INK.mono },
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
