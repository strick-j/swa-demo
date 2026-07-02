// Placeholder -- a centered "coming next" panel for inspector views not yet
// implemented in this iteration.
import type { ReactNode } from "react";
import { INK } from "./common";

export function Placeholder({
  icon,
  title,
  body,
  status,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  status: "idle" | "running" | "done" | "error";
}) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "0 48px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `1px solid ${INK.line}`,
          background: INK.card,
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: INK.text, letterSpacing: "0.01em" }}>
        {title}
      </div>
      <div style={{ maxWidth: 420, fontSize: 13, lineHeight: 1.6, color: INK.dim }}>{body}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: INK.faint }}>
        current phase · {status}
      </div>
    </div>
  );
}
