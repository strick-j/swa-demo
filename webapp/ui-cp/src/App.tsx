// App -- wires the CP portal (left) and the inspector (right) to the retrieval
// engine, pace controls, and view/pace DarkSeg controls. The left pane selects
// one of four CP use cases; the inspector animates the five-stage flow.
import { useState, useCallback, useEffect, useMemo } from "react";
import { GitFork, Layers, Terminal } from "lucide-react";
import { PortalPane } from "./components/PortalPane";
import { DarkSeg } from "./components/DarkSeg";
import { InspectorChrome } from "./components/InspectorChrome";
import { AccessibilityHints } from "./components/AccessibilityHints";
import { TopologyInspector } from "./visualizations/TopologyInspector";
import { LayersInspector } from "./visualizations/LayersInspector";
import { TraceInspector } from "./visualizations/TraceInspector";
import { useResolveEngine } from "./engine/useResolveEngine";
import { CP, type ScenarioKey } from "./engine/cp";
import * as paceQueue from "./engine/paceQueue";

type ViewMode = "topology" | "layers" | "trace";
type PaceMode = "off" | "fast" | "medium" | "slow";

const VIEW_OPTIONS: { v: ViewMode; label: string; icon: React.ReactNode }[] = [
  { v: "topology", label: "Topo", icon: <GitFork style={{ width: 13, height: 13 }} /> },
  { v: "layers", label: "Layers", icon: <Layers style={{ width: 13, height: 13 }} /> },
  { v: "trace", label: "Trace", icon: <Terminal style={{ width: 13, height: 13 }} /> },
];

const PACE_OPTIONS: { v: PaceMode; label: string }[] = [
  { v: "off", label: "Off" },
  { v: "fast", label: "Fast" },
  { v: "medium", label: "Med" },
  { v: "slow", label: "Slow" },
];

export function App() {
  const [scenario, setScenario] = useState<ScenarioKey>("authorized");
  const [view, setView] = useState<ViewMode>("topology");
  const [pace, setPace] = useState<PaceMode>("medium");
  const engine = useResolveEngine();

  useEffect(() => {
    paceQueue.setPace(pace);
  }, [pace]);

  const handleScenarioChange = useCallback(
    (v: ScenarioKey) => {
      setScenario(v);
      engine.reset();
    },
    [engine],
  );

  const handleResolve = useCallback(() => {
    engine.run(scenario);
  }, [engine, scenario]);

  const handleReset = useCallback(() => {
    engine.reset();
  }, [engine]);

  const inspectorControls = useMemo(
    () => (
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <DarkSeg<ViewMode> value={view} onChange={setView} options={VIEW_OPTIONS} />
        <DarkSeg<PaceMode> value={pace} onChange={setPace} options={PACE_OPTIONS} label="Pace" />
      </div>
    ),
    [view, pace],
  );

  const vizProps = {
    status: engine.status,
    stage: engine.stage,
    completed: engine.completed,
    scenario,
    failStage: CP.scenarios[scenario].failStage,
    result: engine.result,
  } as const;

  return (
    <div
      data-motion="cinematic"
      style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}
    >
      <AccessibilityHints onReset={handleReset} targetId="main-content" />

      {/* Left pane: CP portal (44%) */}
      <div
        id="main-content"
        style={{ flex: "0 0 44%", minWidth: 440, maxWidth: 640, height: "100%" }}
      >
        <PortalPane
          scenario={scenario}
          setScenario={handleScenarioChange}
          status={engine.status}
          stageVerb={engine.stageVerb}
          onResolve={handleResolve}
          result={engine.result}
        />
      </div>

      {/* Right pane: inspector */}
      <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
        <InspectorChrome
          status={engine.status}
          stage={engine.stage}
          scenario={scenario}
          shimmer
          controls={inspectorControls}
          onReset={handleReset}
        >
          {view === "topology" && <TopologyInspector {...vizProps} />}
          {view === "layers" && <LayersInspector {...vizProps} />}
          {view === "trace" && <TraceInspector {...vizProps} />}
        </InspectorChrome>
      </div>
    </div>
  );
}
