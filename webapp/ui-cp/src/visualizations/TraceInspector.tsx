// TraceInspector -- the timestamped identity-trace log for the CP flow.
// Placeholder for this iteration (Topology ships first); the full event-log
// view lands next.
import { Terminal } from "lucide-react";
import { INK, type InspectorProps } from "./common";
import { Placeholder } from "./Placeholder";

export function TraceInspector({ status }: InspectorProps) {
  return (
    <Placeholder
      icon={<Terminal style={{ width: 20, height: 20, color: INK.mono }} />}
      title="Identity trace"
      body="A timestamped log of the retrieval — bridge invoke, provider hash measure, OS-user/path check, Safe authorization, and the masked return. Coming next; use the Topology view for now."
      status={status}
    />
  );
}
