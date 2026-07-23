// App -- wires the portal (left) and the inspector (right) to the retrieval
// engine and view/pace controls. The provider (CP vs CCP) is chosen from the URL
// path; both are served by this one SPA. The left pane selects a use case; the
// inspector animates the provider's staged flow.
import { useState, useCallback, useEffect, useMemo } from "react";
import { GitFork, Layers, Terminal, PanelRightClose } from "lucide-react";
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
          position: "relative",
          flex: collapsed ? "0 0 64px" : "0 0 44%",
          minWidth: collapsed ? 64 : 440,
          maxWidth: collapsed ? 64 : 640,
          height: "100%",
          overflow: "hidden",
          transition:
            "flex-basis 260ms var(--ease-standard), min-width 260ms var(--ease-standard), max-width 260ms var(--ease-standard)",
        }}
      >
        {/* Expanded portal (faded out under the collapsing width). */}
        <div
          style={{
            height: "100%",
            opacity: collapsed ? 0 : 1,
            pointerEvents: collapsed ? "none" : "auto",
            transition: "opacity 140ms var(--ease-standard)",
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

        {/* Collapse control — top-right of the white pane (expanded only). */}
        {!collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse use cases"
            aria-expanded={true}
            title="Collapse"
            style={{
              position: "absolute",
              top: 20,
              right: 20,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              borderRadius: "var(--radius-md)",
              border: "1px solid rgba(97,134,252,0.35)",
              background: "#fff",
              color: "var(--idira-blue-750)",
              cursor: "pointer",
              transition: "background 160ms var(--ease-standard), border-color 160ms var(--ease-standard)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(97,134,252,0.10)";
              e.currentTarget.style.borderColor = "var(--idira-blue-500)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#fff";
              e.currentTarget.style.borderColor = "rgba(97,134,252,0.35)";
            }}
          >
            <PanelRightClose style={{ width: 18, height: 18 }} />
          </button>
        )}

        {/* Collapsed rail — ~80px white bar with just the Idira mark (collapsed only). */}
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Show use cases"
            aria-expanded={false}
            title="Show use cases"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              paddingTop: 18,
              background: "#fff",
              border: "none",
              borderRight: "1px solid rgba(16,24,64,0.10)",
              cursor: "pointer",
            }}
          >
            <img
              src="/cp/assets/idira-icon-color.png"
              alt="Idira — show use cases"
              style={{ width: 32, height: 32 }}
            />
            <span style={{ width: 28, height: 1, background: "rgba(16,24,64,0.12)" }} />
          </button>
        )}
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
