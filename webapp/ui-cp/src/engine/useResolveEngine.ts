// useResolveEngine.ts -- provider-agnostic retrieval engine. The credential
// outcome comes from a single POST to the provider's API (/api/cp or /api/ccp);
// the staged animation is synthesized client-side by pushing "cp.stage.N" events
// into the pace queue, which releases them at the chosen tempo. The done/error
// outcome is applied when the walk settles.
import { useState, useEffect, useCallback, useRef } from "react";
import * as paceQueue from "./paceQueue";
import type { PaceEvent } from "./paceQueue";
import { eventToStage, stageVerb as getStageVerb } from "./stageMap";
import { pmeta, type Provider, type ScenarioKey } from "./providers";
import type { ProviderResult } from "../visualizations/common";

export type EngineStatus = "idle" | "running" | "done" | "error";

export interface ResolveEngine {
  status: EngineStatus;
  stage: number;
  stageVerb: string;
  completed: number;
  result: ProviderResult | null;
  run: (scenario: ScenarioKey) => void;
  reset: () => void;
}

type Pending = { kind: "done" | "error"; result: ProviderResult; failStage: number };

function codeOf(msg: string): string {
  const m = /[A-Z]{3,7}[0-9]{2,4}[A-Z]/.exec(msg || "");
  return m ? m[0] : "";
}

// Map the provider's API JSON (retrieve.Result) into a ProviderResult.
function mapResult(provider: Provider, json: Record<string, unknown>): ProviderResult {
  const obj = (json[provider.resultKey] as Record<string, unknown> | undefined) ?? {};
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  const error = s(json.error);
  return {
    retrieved: json.retrieved === true,
    simulated: json.simulated === true,
    masked: s(json.masked),
    error,
    errorCode: codeOf(error),
    appId: s(obj.app_id),
    appHash: s(obj.app_hash),
    callerPath: s(obj.caller_path),
    osUser: s(obj.os_user),
    certCn: s(obj.cert_cn),
    safe: s(obj.safe),
    query: s(obj.query),
    account: s(obj.account),
    address: s(obj.address),
    virtualUsername: s(obj.virtual_username),
    dualActive: s(obj.dual_active),
  };
}

const EMPTY: ProviderResult = {
  retrieved: false,
  simulated: false,
  masked: "",
  error: "",
  errorCode: "",
  appId: "",
  appHash: "",
  callerPath: "",
  osUser: "",
  certCn: "",
  safe: "",
  query: "",
  account: "",
  address: "",
  virtualUsername: "",
  dualActive: "",
};

export function useResolveEngine(provider: Provider): ResolveEngine {
  const [status, setStatus] = useState<EngineStatus>("idle");
  const [stage, setStage] = useState(-1);
  const [completed, setCompleted] = useState(0);
  const [result, setResult] = useState<ProviderResult | null>(null);

  const maxStage = useRef(-1);
  const statusRef = useRef<EngineStatus>("idle");
  const pending = useRef<Pending | null>(null);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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

  useEffect(() => {
    const unsub = paceQueue.onStateChange((state) => {
      if (state === "walking") {
        setStatus((prev) => (prev === "done" || prev === "error" ? prev : "running"));
        return;
      }
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      setResult(p.result);
      if (p.kind === "done") {
        setStage(-1);
        setCompleted(provider.stages.length);
        setStatus("done");
      } else {
        setStage(-1);
        setCompleted(Math.max(0, p.failStage));
        setStatus("error");
      }
    });
    return unsub;
  }, [provider]);

  const run = useCallback(
    (scenario: ScenarioKey) => {
      setStatus("running");
      setStage(-1);
      setCompleted(0);
      setResult(null);
      maxStage.current = -1;
      pending.current = null;
      paceQueue.preemptAndFlush();

      const meta = pmeta(provider, scenario);

      fetch(`${provider.apiPath}?scenario=${encodeURIComponent(scenario)}`, { method: "POST" })
        .then(async (resp) => {
          let json: Record<string, unknown> = {};
          try {
            json = (await resp.json()) as Record<string, unknown>;
          } catch {
            json = { error: `HTTP ${resp.status}` };
          }
          const res = mapResult(provider, json);
          const success = res.retrieved;
          const failStage = success ? -1 : meta.failStage >= 0 ? meta.failStage : 0;
          const target = success ? provider.stages.length - 1 : failStage;

          pending.current = { kind: success ? "done" : "error", result: res, failStage };
          for (let i = 0; i <= target; i++) {
            paceQueue.push({ type: `cp.stage.${i}` });
          }
        })
        .catch((err) => {
          pending.current = null;
          setResult({ ...EMPTY, error: String(err) });
          setStatus("error");
          setStage(-1);
        });
    },
    [provider],
  );

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
    stageVerb: getStageVerb(provider, stage),
    completed,
    result,
    run,
    reset,
  };
}
