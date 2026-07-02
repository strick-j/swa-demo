// LayersInspector -- "layers of defense" view for the CP flow. Placeholder for
// this iteration (Topology ships first); the full gated-layers view lands next.
import { Layers } from "lucide-react";
import { INK, type InspectorProps } from "./common";
import { Placeholder } from "./Placeholder";

export function LayersInspector({ status }: InspectorProps) {
  return (
    <Placeholder
      icon={<Layers style={{ width: 20, height: 20, color: INK.mono }} />}
      title="Layers of defense"
      body="Each CP gate — application hash, OS user / path, and Safe authorization — as a stacked layer that clears or rejects. Coming next; use the Topology view for now."
      status={status}
    />
  );
}
