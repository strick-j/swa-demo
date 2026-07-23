// App -- wires the portal (left) and the inspector (right) to the retrieval
// engine and view/pace controls. The provider (CP vs CCP) is chosen from the URL
// path; both are served by this one SPA. The left pane selects a use case; the
// inspector animates the provider's staged flow.
import { useState, useCallback, useEffect, useMemo } from "react";
import { GitFork, Layers, Terminal, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
  // Collapse the left (use-case) pane to give the inspector full width. On
  // laptops the walkthrough ("Learn how it works") is cramped otherwise.
  const [collapsed, setCollapsed] = useState(false);
  const engine = useResolveEngine(provider);

  useEffect(() => {
    paceQueue.setPace(pace);
  }, [pace]);

  // Auto-collapse when the walkthrough opens; restore on any other view. The
  // manual toggle still overrides within the current view (this only re-fires
  // when the view itself changes).
  useEffect(() => {
    setCollapsed(view === "walkthrough");
  }, [view]);

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
          flex: collapsed ? "0 0 0px" : "0 0 44%",
          minWidth: collapsed ? 0 : 440,
          maxWidth: collapsed ? 0 : 640,
          height: "100%",
          overflow: "hidden",
          transition:
            "flex-basis 260ms var(--ease-standard), min-width 260ms var(--ease-standard), max-width 260ms var(--ease-standard)",
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

      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Show use cases" : "Hide use cases"}
        aria-expanded={!collapsed}
        title={collapsed ? "Show use cases" : "Hide use cases"}
        style={{
          flex: "0 0 auto",
          width: 20,
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          border: "none",
          borderRight: "1px solid rgba(97,134,252,0.18)",
          background: "#070d20",
          color: "rgba(196,210,250,0.65)",
          cursor: "pointer",
          transition: "background 160ms var(--ease-standard), color 160ms var(--ease-standard)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#0c1633";
          e.currentTarget.style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "#070d20";
          e.currentTarget.style.color = "rgba(196,210,250,0.65)";
        }}
      >
        {collapsed ? (
          <PanelLeftOpen style={{ width: 15, height: 15 }} />
        ) : (
          <PanelLeftClose style={{ width: 15, height: 15 }} />
        )}
      </button>

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
