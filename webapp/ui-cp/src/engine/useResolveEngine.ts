// useResolveEngine.ts -- CP retrieval engine. Unlike the SSE-driven SWA original,
// the credential outcome comes from a single POST /api/cp?scenario=… ; the staged
// animation is then synthesized client-side by pushing "cp.stage.N" events into
// the pace queue, which releases them at the chosen tempo. The done/error outcome
// is applied when the walk settles, so the animation always plays to its fail
// point before the result renders.
import { useState, useEffect, useCallback, useRef } from "react";
import * as paceQueue from "./paceQueue";
import type { PaceEvent } from "./paceQueue";
import { eventToStage, stageVerb as getStageVerb } from "./stageMap";
import { CP, type ScenarioKey } from "./cp";
import type { CpResult } from "../visualizations/common";

export type EngineStatus = "idle" | "running" | "done" | "error";

export interface ResolveEngine {
  status: EngineStatus;
  stage: number;
  stageVerb: string;
  completed: number;
  result: CpResult | null;
  run: (scenario: ScenarioKey) => void;
  reset: () => void;
}

type Pending = { kind: "done" | "error"; result: CpResult; failStage: number };

// Parse a CyberArk error code (e.g. APPAP133E) out of an error string.
function codeOf(msg: string): string {
  const m = /[A-Z]{3,7}[0-9]{2,4}[A-Z]/.exec(msg || "");
  return m ? m[0] : "";
}

// Map the /api/cp JSON (retrieve.Result) into the UI's CpResult.
function mapResult(json: Record<string, unknown>): CpResult {
  const cp = (json.cp as Record<string, unknown> | undefined) ?? {};
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  const error = s(json.error);
  return {
    retrieved: json.retrieved === true,
    simulated: json.simulated === true,
    masked: s(json.masked),
    error,
    errorCode: codeOf(error),
    appId: s(cp.app_id),
    appHash: s(cp.app_hash),
    callerPath: s(cp.caller_path),
    osUser: s(cp.os_user),
    safe: s(cp.safe),
    query: s(cp.query),
    account: s(cp.account),
    address: s(cp.address),
    virtualUsername: s(cp.virtual_username),
    dualActive: s(cp.dual_active),
  };
}

export function useResolveEngine(): ResolveEngine {
  const [status, setStatus] = useState<EngineStatus>("idle");
  const [stage, setStage] = useState(-1);
  const [completed, setCompleted] = useState(0);
  const [result, setResult] = useState<CpResult | null>(null);

  const maxStage = useRef(-1);
  const statusRef = useRef<EngineStatus>("idle");
  const pending = useRef<Pending | null>(null);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Advance the stage indicator as pace events fire.
  useEffect(() => {
    const unsub = paceQueue.subscribe((ev: PaceEvent) => {
      if (statusRef.current !== "running") return;
      const idx = eventToStage(ev.type);
      if (idx >= 0 && idx > maxStage.current) {
        maxStage.current = idx;
        setStage(idx);
        setCompleted(idx);
      }
    });
    return unsub;
  }, []);

  // Apply the settled outcome when the walk drains to idle.
  useEffect(() => {
    const unsub = paceQueue.onStateChange((state) => {
      if (state === "walking") {
        setStatus((prev) => (prev === "done" || prev === "error" ? prev : "running"));
        return;
      }
      // idle: the walk finished — commit the pending outcome exactly once.
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      setResult(p.result);
      if (p.kind === "done") {
        setStage(-1);
        setCompleted(CP.stages.length);
        setStatus("done");
      } else {
        setStage(-1);
        setCompleted(Math.max(0, p.failStage));
        setStatus("error");
      }
    });
    return unsub;
  }, []);

  const run = useCallback((scenario: ScenarioKey) => {
    setStatus("running");
    setStage(-1);
    setCompleted(0);
    setResult(null);
    maxStage.current = -1;
    pending.current = null;
    paceQueue.preemptAndFlush();

    const meta = CP.scenarios[scenario];

    fetch(`/api/cp?scenario=${encodeURIComponent(scenario)}`, { method: "POST" })
      .then(async (resp) => {
        let json: Record<string, unknown> = {};
        try {
          json = (await resp.json()) as Record<string, unknown>;
        } catch {
          json = { error: `HTTP ${resp.status}` };
        }
        const res = mapResult(json);
        const success = res.retrieved;
        const failStage = success ? -1 : meta.failStage >= 0 ? meta.failStage : 0;
        const target = success ? CP.stages.length - 1 : failStage;

        pending.current = {
          kind: success ? "done" : "error",
          result: res,
          failStage,
        };

        // Synthesize the staged walk up to the target stage.
        for (let i = 0; i <= target; i++) {
          paceQueue.push({ type: `cp.stage.${i}` });
        }
      })
      .catch((err) => {
        pending.current = null;
        setResult({
          retrieved: false,
          simulated: false,
          masked: "",
          error: String(err),
          errorCode: "",
          appId: "",
          appHash: "",
          callerPath: "",
          osUser: "",
          safe: "",
          query: "",
          account: "",
          address: "",
          virtualUsername: "",
          dualActive: "",
        });
        setStatus("error");
        setStage(-1);
      });
  }, []);

  const reset = useCallback(() => {
    paceQueue.preemptAndFlush();
    pending.current = null;
    setStatus("idle");
    setStage(-1);
    setCompleted(0);
    setResult(null);
    maxStage.current = -1;
  }, []);

  return {
    status,
    stage,
    stageVerb: getStageVerb(stage),
    completed,
    result,
    run,
    reset,
  };
}
