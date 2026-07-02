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

type Pending = {
  kind: "done" | "error";
  failStage: number;
};

function codeOf(msg: string): string {
  const m = /[A-Z]{3,7}[0-9]{2,4}[A-Z]/.exec(msg || "");
  return m ? m[0] : "";
}

// Map the provider's API JSON (retrieve.Result / swaResp) into a ProviderResult.
function mapResult(
  provider: Provider,
  json: Record<string, unknown>,
): ProviderResult {
  const obj =
    (json[provider.resultKey] as Record<string, unknown> | undefined) ?? {};
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  const rows = Array.isArray(obj.db_rows)
    ? (obj.db_rows as Record<string, unknown>[]).map((r) => ({
        ref: s(r.ref),
        origin: s(r.origin),
        destination: s(r.destination),
        status: s(r.status),
        carrier: s(r.carrier),
      }))
    : [];
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
    spiffeId: s(obj.spiffe_id),
    issued: obj.issued === true,
    jwtAlg: s(obj.jwt_alg),
    jwtKid: s(obj.jwt_kid),
    audience: s(obj.audience),
    expiresAt: s(obj.expires_at),
    dbAllowed: obj.db_allowed === true,
    dbRows: rows,
    dbError: s(obj.db_error),
    peerUri: s(obj.peer_uri),
    issuer: s(obj.issuer) || s(json.issuer),
    trustDomain: s(obj.trust_domain),
    identity: s(obj.identity),
    authMethod: s(obj.auth_method),
    conjurHost: s(obj.host_id),
    awsAccount: s(obj.aws_account),
    awsRegion: s(obj.aws_region),
    secretName: s(obj.secret_name),
    tokenScope: s(obj.token_scope),
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
  spiffeId: "",
  issued: false,
  jwtAlg: "",
  jwtKid: "",
  audience: "",
  expiresAt: "",
  dbAllowed: false,
  dbRows: [],
  dbError: "",
  peerUri: "",
  issuer: "",
  trustDomain: "",
  identity: "",
  authMethod: "",
  conjurHost: "",
  awsAccount: "",
  awsRegion: "",
  secretName: "",
  tokenScope: "",
};

export function useResolveEngine(provider: Provider): ResolveEngine {
  const [status, setStatus] = useState<EngineStatus>("idle");
  const [stage, setStage] = useState(-1);
  const [completed, setCompleted] = useState(0);
  const [result, setResult] = useState<ProviderResult | null>(null);

  const maxStage = useRef(-1);
  const statusRef = useRef<EngineStatus>("idle");
  const pending = useRef<Pending | null>(null);
  // Latest fetched result, applied whenever it arrives (may be after the walk
  // settles — e.g. a slow foreign-carrier dial).
  const fetchRes = useRef<ProviderResult | null>(null);
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
        setStatus((prev) =>
          prev === "done" || prev === "error" ? prev : "running",
        );
        return;
      }
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      setStage(-1);
      // Prefer the real fetched result if it has landed; otherwise the outcome
      // renders from scenario metadata and the details fill in when it arrives.
      if (fetchRes.current) setResult(fetchRes.current);
      if (p.kind === "done") {
        setCompleted(provider.stages.length);
        setStatus("done");
      } else {
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
      fetchRes.current = null;
      paceQueue.preemptAndFlush();

      const meta = pmeta(provider, scenario);
      const walk = (target: number) => {
        for (let i = 0; i <= target; i++) {
          paceQueue.push({ type: `cp.stage.${i}` });
        }
      };

      // The fetch never rejects — it always resolves to a ProviderResult and
      // updates the displayed data as soon as it lands (even after the walk).
      const sep = provider.apiPath.includes("?") ? "&" : "?";
      const fetched = fetch(
        `${provider.apiPath}${sep}scenario=${encodeURIComponent(scenario)}`,
        {
          method: "POST",
        },
      )
        .then(async (resp) => {
          let json: Record<string, unknown> = {};
          try {
            json = (await resp.json()) as Record<string, unknown>;
          } catch {
            json = { error: `HTTP ${resp.status}` };
          }
          return mapResult(provider, json);
        })
        .catch((err) => ({ ...EMPTY, error: String(err) }) as ProviderResult)
        .then((res) => {
          fetchRes.current = res;
          setResult(res);
          return res;
        });

      if (!meta.ok) {
        // Expected-failure scenarios are deterministic — animate the denial
        // immediately (don't wait for a possibly-slow backend call, e.g. the
        // foreign-carrier dial). The fetch fills in the real error details.
        const failStage = meta.failStage >= 0 ? meta.failStage : 0;
        pending.current = { kind: "error", failStage };
        walk(failStage);
      } else {
        // Expected-success scenarios confirm via the fetch (fast) so a
        // not-configured backend still surfaces the real failure.
        fetched.then((res) => {
          const success = res.retrieved;
          pending.current = {
            kind: success ? "done" : "error",
            failStage: success ? -1 : 0,
          };
          walk(success ? provider.stages.length - 1 : 0);
        });
      }
    },
    [provider],
  );

  const reset = useCallback(() => {
    paceQueue.preemptAndFlush();
    pending.current = null;
    fetchRes.current = null;
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
