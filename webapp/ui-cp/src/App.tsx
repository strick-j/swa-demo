// App -- wires the portal (left) and the inspector (right) to the retrieval
// engine and view/pace controls. The provider (CP vs CCP) is chosen from the URL
// path; both are served by this one SPA. The left pane selects a use case; the
// inspector animates the provider's staged flow.
import { useState, useCallback, useEffect, useMemo } from "react";
import { GitFork, Layers, Terminal } from "lucide-react";
import { PortalPane } from "./components/PortalPane";
import { DarkSeg } from "./components/DarkSeg";
import { InspectorChrome } from "./components/InspectorChrome";
import { AccessibilityHints } from "./components/AccessibilityHints";
import { TopologyInspector } from "./visualizations/TopologyInspector";
import { LayersInspector } from "./visualizations/LayersInspector";
import { TraceInspector } from "./visualizations/TraceInspector";
import { Walkthrough } from "./visualizations/Walkthrough";
import { useResolveEngine } from "./engine/useResolveEngine";
import { providerFromPath, pmeta, type ScenarioKey } from "./engine/providers";
import * as paceQueue from "./engine/paceQueue";
import { t } from "./i18n";

type ViewMode = "topology" | "layers" | "trace" | "walkthrough";
type PaceMode = "off" | "fast" | "medium" | "slow";

const VIEW_OPTIONS: { v: ViewMode; label: string; icon: React.ReactNode }[] = [
  {
    v: "topology",
    label: t("chrome.view.topology"),
    icon: <GitFork style={{ width: 13, height: 13 }} />,
  },
  {
    v: "layers",
    label: t("chrome.view.layers"),
    icon: <Layers style={{ width: 13, height: 13 }} />,
  },
  {
    v: "trace",
    label: t("chrome.view.trace"),
    icon: <Terminal style={{ width: 13, height: 13 }} />,
  },
];

const PACE_OPTIONS: { v: PaceMode; label: string }[] = [
  { v: "off", label: t("chrome.pace.off") },
  { v: "fast", label: t("chrome.pace.fast") },
  { v: "medium", label: t("chrome.pace.medium") },
  { v: "slow", label: t("chrome.pace.slow") },
];

// Provider is fixed per page (chosen by URL + hash); resolve it once.
const provider =
  typeof window !== "undefined"
    ? providerFromPath(window.location.pathname, window.location.hash)
    : providerFromPath("/cp");

export function App() {
  const [scenario, setScenario] = useState<ScenarioKey>(
    () => provider.scenarioOrder[0]!,
  );
  const [view, setView] = useState<ViewMode>("topology");
  const [pace, setPace] = useState<PaceMode>("medium");
  const engine = useResolveEngine(provider);

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
    // If the "how it works" walkthrough is open, drop back to the topology view
    // so the caller can watch the run they just kicked off.
    setView((v) => (v === "walkthrough" ? "topology" : v));
    engine.run(scenario);
  }, [engine, scenario]);

  const handleReset = useCallback(() => {
    engine.reset();
  }, [engine]);

  const handleLearnMore = useCallback(() => {
    setView("walkthrough");
  }, []);

  const inspectorControls = useMemo(
    () => (
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <DarkSeg<ViewMode>
          value={view}
          onChange={setView}
          options={VIEW_OPTIONS}
        />
        <DarkSeg<PaceMode>
          value={pace}
          onChange={setPace}
          options={PACE_OPTIONS}
          label={t("chrome.pace.label")}
        />
      </div>
    ),
    [view, pace],
  );

  const vizProps = {
    provider,
    status: engine.status,
    stage: engine.stage,
    completed: engine.completed,
    scenario,
    failStage: pmeta(provider, scenario).failStage,
    result: engine.result,
  } as const;

  return (
    <div
      data-motion="cinematic"
      style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
      }}
    >
      <AccessibilityHints onReset={handleReset} targetId="main-content" />

      <div
        id="main-content"
        style={{
          flex: "0 0 44%",
          minWidth: 440,
          maxWidth: 640,
          height: "100%",
        }}
      >
        <PortalPane
          provider={provider}
          scenario={scenario}
          setScenario={handleScenarioChange}
          status={engine.status}
          stageVerb={engine.stageVerb}
          onResolve={handleResolve}
          result={engine.result}
          onLearnMore={handleLearnMore}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
        <InspectorChrome
          provider={provider}
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
          {view === "walkthrough" && <Walkthrough provider={provider} />}
        </InspectorChrome>
      </div>
    </div>
  );
}
