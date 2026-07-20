// providers.tsx -- the provider abstraction that drives the inspector. Each
// Credential-Providers-family mode (CP = local host bridge, CCP = AIMWebService
// REST) supplies its own stages, use-case scenarios, trust context, topology
// nodes, defense layers, and console-trace builder. The App picks a provider from
// the URL (/cp vs /credential-providers) and every view renders from it.
import type { ReactNode } from "react";
import {
  Terminal,
  Fingerprint,
  BadgeCheck,
  Lock,
  KeyRound,
  FileCheck,
  Send,
  ShieldCheck,
  Database,
  Server,
  Cloud,
  type LucideIcon,
} from "lucide-react";
import {
  INK,
  Kv,
  type ProviderResult,
  type CVS,
} from "../visualizations/common";
import { t } from "../i18n";

export type ScenarioKey =
  | "authorized"
  | "invalid-hash"
  | "invalid"
  | "no-cert"
  | "denied"
  | "dual"
  | "trusted"
  | "untrusted"
  | "unknown"
  | "foreign";

export interface Stage {
  key: string;
  label: string;
  verb: string;
}

export interface EvidenceItem {
  lead: string;
  body: string;
}

export interface ScenarioMeta {
  key: ScenarioKey;
  label: string;
  tag: string;
  ok: boolean;
  failStage: number; // index into stages; -1 = succeeds
  desc: string;
  evidence: EvidenceItem[];
}

interface NodeArgs {
  state: CVS;
  result: ProviderResult | null;
  scenario: ScenarioKey;
}
export interface NodeDef {
  key: string;
  title: string;
  stages: number[]; // stages that make this node "active"
  doneAfter: number; // completed >= doneAfter => done
  failsAt: number[]; // failStage in here => failed
  tag: (state: CVS) => string;
  body: (a: NodeArgs) => ReactNode;
}

interface LayerArgs {
  result: ProviderResult | null;
  scenario: ScenarioKey;
}
export interface LayerDef {
  name: string;
  Icon: LucideIcon;
  pass: (a: LayerArgs) => string;
  reject: (a: LayerArgs) => string;
  idle: string;
}

export type LineKind = "comment" | "cmd" | "cont" | "out" | "ok" | "err";
export interface Line {
  s: number;
  kind: LineKind;
  text: string;
  terminal?: boolean;
}

export interface Provider {
  id: "cp" | "ccp" | "swa" | "conjur-jwt" | "conjur-iam";
  apiPath: string;
  resultKey: "cp" | "ccp" | "swa" | "conjur";
  subtitle: string;
  brand: { name: string; sub: string };
  heroTitle: string;
  heroLede: ReactNode;
  ctx: { k: string; v: string; wide?: boolean; brand?: boolean }[];
  stages: Stage[];
  scenarios: Partial<Record<ScenarioKey, ScenarioMeta>>;
  scenarioOrder: ScenarioKey[];
  nodes: NodeDef[];
  layers: LayerDef[];
  buildTrace: (scenario: ScenarioKey, result: ProviderResult | null) => Line[];
}

// Small helpers for node/trace bodies.
const dangerNote: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: INK.danger,
  lineHeight: 1.5,
};
const dimNote: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: INK.faint,
  fontStyle: "italic",
};
const foot: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  color: INK.faint,
  letterSpacing: "0.02em",
};
const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "11px 14px",
};

// emph renders a translated string with **bold** spans as <strong>, so the hero
// lede keeps its emphasis without hand-written per-locale JSX. Even segments are
// plain text; odd segments (between ** pairs) are bold. Translators mark the
// emphasized phrase with ** in the catalog.
function emph(s: string): ReactNode {
  return s
    .split("**")
    .map((seg, i) => (i % 2 === 1 ? <strong key={i}>{seg}</strong> : seg));
}

function CredentialBody({ state, result, scenario }: NodeArgs) {
  if (state !== "done") {
    return <span style={dimNote}>{t("chrome.cred.dimNote")}</span>;
  }
  const dual = scenario === "dual";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Kv
        k={dual ? t("chrome.cred.activeAccount") : t("chrome.cred.account")}
        v={
          (dual ? result?.dualActive : result?.account) ||
          result?.account ||
          "—"
        }
      />
      <Kv
        k={t("chrome.row.valueMasked")}
        v={result?.masked || "—"}
        vColor={INK.ok}
      />
    </div>
  );
}

/* ======================= CP (local Credential Provider) ======================= */

const CP_CTX = {
  application: "cp-demo-app",
  provider: "Prov_SWADEMOHOST",
  safe: "PIN-SEC-DEMO",
};

const cpProvider: Provider = {
  id: "cp",
  apiPath: "/api/cp",
  resultKey: "cp",
  subtitle: "credential provider · aim · vault",
  brand: { name: "Credential Provider", sub: t("cp.brand.sub") },
  heroTitle: t("cp.hero.title"),
  heroLede: emph(t("cp.hero.lede")),
  ctx: [
    { k: t("chrome.ctx.application"), v: CP_CTX.application, wide: true },
    { k: t("chrome.ctx.provider"), v: CP_CTX.provider },
    { k: t("chrome.ctx.safe"), v: CP_CTX.safe },
    { k: t("chrome.ctx.auth"), v: t("cp.ctx.authVal"), brand: true },
  ],
  stages: [
    {
      key: "invoke",
      label: t("cp.stage.invoke.label"),
      verb: t("cp.stage.invoke.verb"),
    },
    {
      key: "hash",
      label: t("cp.stage.hash.label"),
      verb: t("cp.stage.hash.verb"),
    },
    {
      key: "osuser",
      label: t("cp.stage.osuser.label"),
      verb: t("cp.stage.osuser.verb"),
    },
    {
      key: "authz",
      label: t("cp.stage.authz.label"),
      verb: t("cp.stage.authz.verb"),
    },
    {
      key: "return",
      label: t("cp.stage.return.label"),
      verb: t("cp.stage.return.verb"),
    },
  ],
  scenarioOrder: ["authorized", "invalid-hash", "denied", "dual"],
  scenarios: {
    authorized: {
      key: "authorized",
      label: t("cp.scenario.authorized.label"),
      tag: t("cp.scenario.authorized.tag"),
      ok: true,
      failStage: -1,
      desc: t("cp.scenario.authorized.desc"),
      evidence: [
        {
          lead: t("cp.scenario.authorized.ev1.lead"),
          body: t("cp.scenario.authorized.ev1.body"),
        },
        {
          lead: t("cp.scenario.authorized.ev2.lead"),
          body: t("cp.scenario.authorized.ev2.body"),
        },
        {
          lead: t("cp.scenario.authorized.ev3.lead"),
          body: t("cp.scenario.authorized.ev3.body"),
        },
      ],
    },
    "invalid-hash": {
      key: "invalid-hash",
      label: t("cp.scenario.invalid-hash.label"),
      tag: t("cp.scenario.invalid-hash.tag"),
      ok: false,
      failStage: 1,
      desc: t("cp.scenario.invalid-hash.desc"),
      evidence: [
        {
          lead: t("cp.scenario.invalid-hash.ev1.lead"),
          body: t("cp.scenario.invalid-hash.ev1.body"),
        },
        {
          lead: t("cp.scenario.invalid-hash.ev2.lead"),
          body: t("cp.scenario.invalid-hash.ev2.body"),
        },
        {
          lead: t("cp.scenario.invalid-hash.ev3.lead"),
          body: t("cp.scenario.invalid-hash.ev3.body"),
        },
      ],
    },
    denied: {
      key: "denied",
      label: t("cp.scenario.denied.label"),
      tag: t("cp.scenario.denied.tag"),
      ok: false,
      failStage: 3,
      desc: t("cp.scenario.denied.desc"),
      evidence: [
        {
          lead: t("cp.scenario.denied.ev1.lead"),
          body: t("cp.scenario.denied.ev1.body"),
        },
        {
          lead: t("cp.scenario.denied.ev2.lead"),
          body: t("cp.scenario.denied.ev2.body"),
        },
        {
          lead: t("cp.scenario.denied.ev3.lead"),
          body: t("cp.scenario.denied.ev3.body"),
        },
      ],
    },
    dual: {
      key: "dual",
      label: t("cp.scenario.dual.label"),
      tag: t("cp.scenario.dual.tag"),
      ok: true,
      failStage: -1,
      desc: t("cp.scenario.dual.desc"),
      evidence: [
        {
          lead: t("cp.scenario.dual.ev1.lead"),
          body: t("cp.scenario.dual.ev1.body"),
        },
        {
          lead: t("cp.scenario.dual.ev2.lead"),
          body: t("cp.scenario.dual.ev2.body"),
        },
        {
          lead: t("cp.scenario.dual.ev3.lead"),
          body: t("cp.scenario.dual.ev3.body"),
        },
      ],
    },
  },
  nodes: [
    {
      key: "app",
      title: t("cp.node.app.title"),
      stages: [0],
      doneAfter: 1,
      failsAt: [0],
      tag: (s) =>
        s === "done" ? t("chrome.state.invoked") : t("chrome.state.caller"),
      body: ({ result }) => (
        <>
          <Kv
            k={t("cp.node.app.kv")}
            v={result?.callerPath || "cp-caller.jar"}
          />
          <span style={foot}>{t("cp.node.app.foot")}</span>
        </>
      ),
    },
    {
      key: "provider",
      title: t("cp.node.provider.title"),
      stages: [1, 2],
      doneAfter: 3,
      failsAt: [1, 2],
      tag: (s) =>
        s === "failed"
          ? t("chrome.tag.authnDeny")
          : s === "done"
            ? t("chrome.state.authenticated")
            : t("chrome.state.measuring"),
      body: ({ state, result }) =>
        state === "failed" ? (
          <span style={dangerNote}>
            {t("cp.node.provider.danger", {
              code: result?.errorCode ? `${result.errorCode} · ` : "",
            })}
          </span>
        ) : (
          <>
            <div style={grid2}>
              <Kv
                k={t("cp.node.provider.kvFingerprint")}
                v={result?.appHash || "—"}
                vColor={state === "done" ? INK.ok : INK.mono}
              />
              <Kv
                k={t("cp.node.provider.kvOsUser")}
                v={result?.osUser || "hash · os-user · path"}
              />
            </div>
            <span style={foot}>{t("cp.node.provider.foot")}</span>
          </>
        ),
    },
    {
      key: "vault",
      title: t("cp.node.vault.title"),
      stages: [3],
      doneAfter: 4,
      failsAt: [3],
      tag: (s) =>
        s === "failed"
          ? t("chrome.tag.authzDeny")
          : s === "done"
            ? t("chrome.state.authorized")
            : "",
      body: ({ state, result }) =>
        state === "failed" ? (
          <span style={dangerNote}>
            {t("cp.node.vault.danger", {
              code: result?.errorCode ? `${result.errorCode} · ` : "",
              safe: result?.safe || CP_CTX.safe,
            })}
          </span>
        ) : (
          <Kv
            k={t("cp.node.vault.kvSafe")}
            v={result?.safe || CP_CTX.safe}
            vColor={state === "done" ? INK.ok : INK.mono}
          />
        ),
    },
    {
      key: "credential",
      title: t("cp.node.credential.title"),
      stages: [4],
      doneAfter: 5,
      failsAt: [],
      tag: (s) => (s === "done" ? t("chrome.state.returned") : ""),
      body: CredentialBody,
    },
  ],
  layers: [
    {
      name: t("cp.layer.invoke.name"),
      Icon: Terminal,
      pass: () => t("cp.layer.invoke.pass"),
      reject: () => t("cp.layer.invoke.reject"),
      idle: t("cp.layer.invoke.idle"),
    },
    {
      name: t("cp.layer.hash.name"),
      Icon: Fingerprint,
      pass: ({ result }) =>
        t("cp.layer.hash.pass", { appHash: result?.appHash || "—" }),
      reject: ({ result }) =>
        t("cp.layer.hash.reject", { code: result?.errorCode || "APPAP133E" }),
      idle: t("cp.layer.hash.idle"),
    },
    {
      name: t("cp.layer.osuser.name"),
      Icon: BadgeCheck,
      pass: ({ result }) =>
        t("cp.layer.osuser.pass", { osUser: result?.osUser || "—" }),
      reject: () => t("cp.layer.osuser.reject"),
      idle: t("cp.layer.osuser.idle"),
    },
    {
      name: t("cp.layer.authz.name"),
      Icon: Lock,
      pass: ({ result }) =>
        t("cp.layer.authz.pass", { safe: result?.safe || CP_CTX.safe }),
      reject: ({ result }) =>
        t("cp.layer.authz.reject", {
          code: result?.errorCode || "APPAP",
          safe: result?.safe || CP_CTX.safe,
        }),
      idle: t("cp.layer.authz.idle"),
    },
    {
      name: t("cp.layer.credential.name"),
      Icon: KeyRound,
      pass: ({ result }) =>
        t("cp.layer.credential.pass", { masked: result?.masked || "returned" }),
      reject: () => t("cp.layer.credential.reject"),
      idle: t("cp.layer.credential.idle"),
    },
  ],
  buildTrace: (scenario, r) => {
    const appId = r?.appId || CP_CTX.application;
    const safe = r?.safe || CP_CTX.safe;
    const query = r?.query || "Object=secrets-demo-1";
    const jar =
      scenario === "invalid-hash"
        ? "/opt/swa-cp/rogue/cp-caller.jar"
        : "/opt/swa-cp/cp-caller.jar";
    const args =
      scenario === "dual"
        ? `--appid ${appId} --query "${query}"${r?.virtualUsername ? ` --virtual ${r.virtualUsername}` : ""}`
        : `--appid ${appId} --safe ${safe} --${query.replace("=", " ")} --folder Root`;

    const lines: Line[] = [
      {
        s: 0,
        kind: "comment",
        text: t("cp.trace.pod"),
      },
      {
        s: 0,
        kind: "cmd",
        text: `curl -s -XPOST 'http://host.minikube.internal:8890/cp?scenario=${scenario}'`,
      },
      {
        s: 1,
        kind: "comment",
        text: t("cp.trace.dispatch"),
      },
      {
        s: 1,
        kind: "cmd",
        text: `java -Djava.library.path=/opt/CARKaim/sdk \\`,
      },
      {
        s: 1,
        kind: "cont",
        text: `  -cp /opt/CARKaim/sdk/javapasswordsdk.jar:${jar} \\`,
      },
      { s: 1, kind: "cont", text: `  CpCaller ${args}` },
      {
        s: 1,
        kind: "comment",
        text: t("cp.trace.measure"),
      },
      {
        s: 2,
        kind: "comment",
        text: t("cp.trace.checkOsUser", { osUser: r?.osUser || "svc-app" }),
      },
      {
        s: 3,
        kind: "comment",
        text: t("cp.trace.authzQuery", { appId, safe }),
      },
      { s: 4, kind: "cmd", text: "PasswordSDK.getPassword(req)" },
    ];
    appendOutcome(lines, scenario, r, {
      successStage: 4,
      denyStage: scenario === "denied" ? 3 : 1,
      appId,
      safe,
      query,
      style: "cp",
    });
    return lines;
  },
};

/* ================== CCP (Central Credential Provider / AIMWebService) ================== */

const CCP_CTX = {
  application: "ccp-demo-app",
  endpoint: "AIMWebService",
  safe: "PIN-SEC-DEMO",
};
const CCP_HOST = "aimws.example.com";

const ccpProvider: Provider = {
  id: "ccp",
  apiPath: "/api/ccp",
  resultKey: "ccp",
  subtitle: "central credential provider · mtls · rest",
  brand: {
    name: "Central Credential Provider",
    sub: t("ccp.brand.sub"),
  },
  heroTitle: t("ccp.hero.title"),
  heroLede: emph(t("ccp.hero.lede")),
  ctx: [
    { k: t("chrome.ctx.application"), v: CCP_CTX.application, wide: true },
    { k: t("chrome.ctx.endpoint"), v: CCP_CTX.endpoint },
    { k: t("chrome.ctx.safe"), v: CCP_CTX.safe },
    { k: t("chrome.ctx.auth"), v: t("ccp.ctx.authVal"), brand: true },
  ],
  stages: [
    {
      key: "present",
      label: t("ccp.stage.present.label"),
      verb: t("ccp.stage.present.verb"),
    },
    {
      key: "authn",
      label: t("ccp.stage.authn.label"),
      verb: t("ccp.stage.authn.verb"),
    },
    {
      key: "authz",
      label: t("ccp.stage.authz.label"),
      verb: t("ccp.stage.authz.verb"),
    },
    {
      key: "return",
      label: t("ccp.stage.return.label"),
      verb: t("ccp.stage.return.verb"),
    },
  ],
  scenarioOrder: ["authorized", "no-cert", "denied", "dual"],
  scenarios: {
    authorized: {
      key: "authorized",
      label: t("ccp.scenario.authorized.label"),
      tag: t("ccp.scenario.authorized.tag"),
      ok: true,
      failStage: -1,
      desc: t("ccp.scenario.authorized.desc"),
      evidence: [
        {
          lead: t("ccp.scenario.authorized.ev1.lead"),
          body: t("ccp.scenario.authorized.ev1.body"),
        },
        {
          lead: t("ccp.scenario.authorized.ev2.lead"),
          body: t("ccp.scenario.authorized.ev2.body"),
        },
        {
          lead: t("ccp.scenario.authorized.ev3.lead"),
          body: t("ccp.scenario.authorized.ev3.body"),
        },
      ],
    },
    "no-cert": {
      key: "no-cert",
      label: t("ccp.scenario.no-cert.label"),
      tag: t("ccp.scenario.no-cert.tag"),
      ok: false,
      failStage: 1,
      desc: t("ccp.scenario.no-cert.desc"),
      evidence: [
        {
          lead: t("ccp.scenario.no-cert.ev1.lead"),
          body: t("ccp.scenario.no-cert.ev1.body"),
        },
        {
          lead: t("ccp.scenario.no-cert.ev2.lead"),
          body: t("ccp.scenario.no-cert.ev2.body"),
        },
        {
          lead: t("ccp.scenario.no-cert.ev3.lead"),
          body: t("ccp.scenario.no-cert.ev3.body"),
        },
      ],
    },
    denied: {
      key: "denied",
      label: t("ccp.scenario.denied.label"),
      tag: t("ccp.scenario.denied.tag"),
      ok: false,
      failStage: 2,
      desc: t("ccp.scenario.denied.desc"),
      evidence: [
        {
          lead: t("ccp.scenario.denied.ev1.lead"),
          body: t("ccp.scenario.denied.ev1.body"),
        },
        {
          lead: t("ccp.scenario.denied.ev2.lead"),
          body: t("ccp.scenario.denied.ev2.body"),
        },
        {
          lead: t("ccp.scenario.denied.ev3.lead"),
          body: t("ccp.scenario.denied.ev3.body"),
        },
      ],
    },
    dual: {
      key: "dual",
      label: t("ccp.scenario.dual.label"),
      tag: t("ccp.scenario.dual.tag"),
      ok: true,
      failStage: -1,
      desc: t("ccp.scenario.dual.desc"),
      evidence: [
        {
          lead: t("ccp.scenario.dual.ev1.lead"),
          body: t("ccp.scenario.dual.ev1.body"),
        },
        {
          lead: t("ccp.scenario.dual.ev2.lead"),
          body: t("ccp.scenario.dual.ev2.body"),
        },
        {
          lead: t("ccp.scenario.dual.ev3.lead"),
          body: t("ccp.scenario.dual.ev3.body"),
        },
      ],
    },
  },
  nodes: [
    {
      key: "app",
      title: t("ccp.node.app.title"),
      stages: [0],
      doneAfter: 1,
      failsAt: [],
      tag: (s) =>
        s === "done" ? t("chrome.state.presented") : t("chrome.state.client"),
      body: ({ result, scenario }) => (
        <>
          <Kv
            k={t("chrome.row.clientCert")}
            v={
              scenario === "no-cert"
                ? t("ccp.node.app.none")
                : result?.certCn || "swa-demo-webapp"
            }
            vColor={scenario === "no-cert" ? INK.danger : undefined}
          />
          <span style={foot}>{t("ccp.node.app.foot")}</span>
        </>
      ),
    },
    {
      key: "aimws",
      title: t("ccp.node.aimws.title"),
      stages: [1],
      doneAfter: 2,
      failsAt: [1],
      tag: (s) =>
        s === "failed"
          ? t("chrome.tag.authnDeny")
          : s === "done"
            ? t("chrome.state.authenticated")
            : t("chrome.state.verifying"),
      body: ({ state, result, scenario }) =>
        state === "failed" ? (
          <span style={dangerNote}>
            {(result?.errorCode ? `${result.errorCode} · ` : "APPAP227E · ") +
              (scenario === "no-cert"
                ? t("ccp.node.aimws.dangerNoCert")
                : t("ccp.node.aimws.dangerNotAuthz"))}
          </span>
        ) : (
          <>
            <div style={grid2}>
              <Kv
                k={t("chrome.row.application")}
                v={result?.appId || CCP_CTX.application}
                vColor={state === "done" ? INK.ok : INK.mono}
              />
              <Kv
                k={t("ccp.node.aimws.kvCertCn")}
                v={result?.certCn || "swa-demo-webapp"}
              />
            </div>
            <span style={foot}>{t("ccp.node.aimws.foot")}</span>
          </>
        ),
    },
    {
      key: "vault",
      title: t("ccp.node.vault.title"),
      stages: [2],
      doneAfter: 3,
      failsAt: [2],
      tag: (s) =>
        s === "failed"
          ? t("chrome.tag.authzDeny")
          : s === "done"
            ? t("chrome.state.authorized")
            : "",
      body: ({ state, result }) =>
        state === "failed" ? (
          <span style={dangerNote}>
            {t("ccp.node.vault.danger", {
              code: result?.errorCode ? `${result.errorCode} · ` : "APPAP004E · ",
              safe: result?.safe || CCP_CTX.safe,
            })}
          </span>
        ) : (
          <Kv
            k={t("chrome.row.safe")}
            v={result?.safe || CCP_CTX.safe}
            vColor={state === "done" ? INK.ok : INK.mono}
          />
        ),
    },
    {
      key: "credential",
      title: t("ccp.node.credential.title"),
      stages: [3],
      doneAfter: 4,
      failsAt: [],
      tag: (s) => (s === "done" ? t("chrome.state.returned") : ""),
      body: CredentialBody,
    },
  ],
  layers: [
    {
      name: t("ccp.layer.present.name"),
      Icon: FileCheck,
      pass: () => t("ccp.layer.present.pass"),
      reject: () => t("ccp.layer.present.reject"),
      idle: t("ccp.layer.present.idle"),
    },
    {
      name: t("ccp.layer.authn.name"),
      Icon: BadgeCheck,
      pass: ({ result }) =>
        t("ccp.layer.authn.pass", {
          certCn: result?.certCn || "swa-demo-webapp",
        }),
      reject: ({ result }) =>
        t("ccp.layer.authn.reject", { code: result?.errorCode || "APPAP227E" }),
      idle: t("ccp.layer.authn.idle"),
    },
    {
      name: t("ccp.layer.authz.name"),
      Icon: Lock,
      pass: ({ result }) =>
        t("ccp.layer.authz.pass", { safe: result?.safe || CCP_CTX.safe }),
      reject: ({ result }) =>
        t("ccp.layer.authz.reject", {
          code: result?.errorCode || "APPAP004E",
          safe: result?.safe || CCP_CTX.safe,
        }),
      idle: t("ccp.layer.authz.idle"),
    },
    {
      name: t("ccp.layer.credential.name"),
      Icon: KeyRound,
      pass: ({ result }) =>
        t("ccp.layer.credential.pass", {
          masked: result?.masked || "returned",
        }),
      reject: () => t("ccp.layer.credential.reject"),
      idle: t("ccp.layer.credential.idle"),
    },
  ],
  buildTrace: (scenario, r) => {
    const appId = r?.appId || CCP_CTX.application;
    const safe = r?.safe || CCP_CTX.safe;
    const query = r?.query || "Object=secrets-demo-1";
    const noCert = scenario === "no-cert";
    const qp =
      scenario === "dual"
        ? `AppID=${appId}&Query=${encodeURIComponent(query)}&QueryFormat=Exact`
        : `AppID=${appId}&Safe=${safe}&${query}`;

    const lines: Line[] = [
      {
        s: 0,
        kind: "comment",
        text: t("ccp.trace.0", { host: CCP_HOST }),
      },
      {
        s: 0,
        kind: "cmd",
        text: noCert
          ? `curl -sk \\`
          : `curl -sk --cert ccp-client.crt --key ccp-client.key \\`,
      },
      {
        s: 0,
        kind: "cont",
        text: `  'https://${CCP_HOST}/AIMWebService/api/Accounts?${qp}'`,
      },
      {
        s: 1,
        kind: "comment",
        text: noCert ? t("ccp.trace.1.noCert") : t("ccp.trace.1.auth"),
      },
      {
        s: 2,
        kind: "comment",
        text: t("ccp.trace.2", { appId, safe }),
      },
    ];
    appendOutcome(lines, scenario, r, {
      successStage: 3,
      denyStage: noCert ? 1 : 2,
      appId,
      safe,
      query,
      style: "ccp",
    });
    return lines;
  },
};

// appendOutcome pushes the terminal response/denial lines for either provider.
function appendOutcome(
  lines: Line[],
  scenario: ScenarioKey,
  r: ProviderResult | null,
  o: {
    successStage: number;
    denyStage: number;
    appId: string;
    safe: string;
    query: string;
    style: "cp" | "ccp";
  },
): void {
  if (r?.retrieved) {
    const body =
      o.style === "cp"
        ? [
            "{",
            `  "ok": true,`,
            `  "app_id": "${o.appId}",`,
            `  "app_hash": "${r.appHash}",   // caller fingerprint (illustrative)`,
            `  "safe": "${o.safe}",`,
            `  "account": "${r.account}",`,
            r.address ? `  "address": "${r.address}",` : "",
            scenario === "dual" && r.dualActive
              ? `  "dual_active": "${r.dualActive}",`
              : "",
            `  "masked": "${r.masked}"`,
            "}",
          ]
        : [
            "HTTP/1.1 200 OK",
            "{",
            `  "UserName": "${r.account}",`,
            r.address ? `  "Address": "${r.address}",` : "",
            scenario === "dual" && r.dualActive
              ? `  "DualAccountStatus": "${r.dualActive}",`
              : "",
            `  "Content": "${r.masked}"   // ${t("conjur.trace.masked")}`,
            "}",
          ];
    for (const t of body.filter(Boolean))
      lines.push({ s: o.successStage, kind: "out", text: t, terminal: true });
    lines.push({
      s: o.successStage,
      kind: "ok",
      text:
        o.style === "cp"
          ? "✓ retrieved · secret hashed on host — never crossed the bridge"
          : "✓ retrieved · credential masked at the source",
      terminal: true,
    });
    return;
  }
  if (!r) return;
  const fs = o.denyStage;
  const code =
    r.errorCode ||
    (scenario === "denied"
      ? "APPAP004E"
      : o.style === "ccp"
        ? "APPAP227E"
        : "APPAP133E");
  if (o.style === "ccp")
    lines.push({
      s: fs,
      kind: "err",
      text: "HTTP/1.1 403 Forbidden",
      terminal: true,
    });
  else
    lines.push({
      s: fs,
      kind: "err",
      text: `APPConsole.log  ${r.error || `${code} the request was denied`}`,
      terminal: true,
    });
  lines.push({ s: fs, kind: "out", text: "{", terminal: true });
  lines.push({
    s: fs,
    kind: "out",
    text: `  "${o.style === "ccp" ? "ErrorCode" : "error_code"}": "${code}",`,
    terminal: true,
  });
  lines.push({
    s: fs,
    kind: "out",
    text: `  "${o.style === "ccp" ? "ErrorMsg" : "error"}": "${(r.error || "").replace(/"/g, "'")}"`,
    terminal: true,
  });
  lines.push({ s: fs, kind: "out", text: "}", terminal: true });
  lines.push({
    s: fs,
    kind: "err",
    text:
      scenario === "denied"
        ? "✗ denied at Safe authorization — the Application is not a member of the Safe"
        : o.style === "ccp"
          ? "✗ rejected at authentication — no valid client certificate"
          : "✗ rejected at application authentication — the caller's hash is not registered",
    terminal: true,
  });
}

/* ==================== SWA (Secure Workload Access · SPIFFE) ==================== */

const SWA_CTX = {
  trustDomain: "swa-demo.example.com",
  nodeGroup: "minikube-nodes",
  attestor: "k8s_psat",
  gateway: "pg-gateway",
};
const SWA_WORKLOAD =
  "spiffe://swa-demo.example.com/minikube-nodes/ns/swa-demo/sa/swa-demo-webapp";

const swaProvider: Provider = {
  id: "swa",
  apiPath: "/api/swa",
  resultKey: "swa",
  subtitle: "spiffe · mtls · jwt-svid",
  brand: { name: "Secure Workload Access", sub: t("swa.brand.sub") },
  heroTitle: t("swa.hero.title"),
  heroLede: emph(t("swa.hero.lede")),
  ctx: [
    { k: t("chrome.ctx.trustDomain"), v: SWA_CTX.trustDomain, wide: true },
    { k: t("chrome.ctx.nodeGroup"), v: SWA_CTX.nodeGroup },
    { k: t("chrome.ctx.attestor"), v: SWA_CTX.attestor },
    { k: t("chrome.ctx.gateway"), v: SWA_CTX.gateway, brand: true },
  ],
  stages: [
    {
      key: "request",
      label: t("swa.stage.request.label"),
      verb: t("swa.stage.request.verb"),
    },
    {
      key: "attest",
      label: t("swa.stage.attest.label"),
      verb: t("swa.stage.attest.verb"),
    },
    {
      key: "svid",
      label: t("swa.stage.svid.label"),
      verb: t("swa.stage.svid.verb"),
    },
    {
      key: "mtls",
      label: t("swa.stage.mtls.label"),
      verb: t("swa.stage.mtls.verb"),
    },
    {
      key: "authz",
      label: t("swa.stage.authz.label"),
      verb: t("swa.stage.authz.verb"),
    },
    {
      key: "resource",
      label: t("swa.stage.resource.label"),
      verb: t("swa.stage.resource.verb"),
    },
  ],
  scenarioOrder: ["trusted", "untrusted", "unknown", "foreign"],
  scenarios: {
    trusted: {
      key: "trusted",
      label: t("swa.scenario.trusted.label"),
      tag: t("swa.scenario.trusted.tag"),
      ok: true,
      failStage: -1,
      desc: t("swa.scenario.trusted.desc"),
      evidence: [
        {
          lead: t("swa.scenario.trusted.ev1.lead"),
          body: t("swa.scenario.trusted.ev1.body"),
        },
        {
          lead: t("swa.scenario.trusted.ev2.lead"),
          body: t("swa.scenario.trusted.ev2.body"),
        },
        {
          lead: t("swa.scenario.trusted.ev3.lead"),
          body: t("swa.scenario.trusted.ev3.body"),
        },
      ],
    },
    untrusted: {
      key: "untrusted",
      label: t("swa.scenario.untrusted.label"),
      tag: t("swa.scenario.untrusted.tag"),
      ok: false,
      failStage: 4,
      desc: t("swa.scenario.untrusted.desc"),
      evidence: [
        {
          lead: t("swa.scenario.untrusted.ev1.lead"),
          body: t("swa.scenario.untrusted.ev1.body"),
        },
        {
          lead: t("swa.scenario.untrusted.ev2.lead"),
          body: t("swa.scenario.untrusted.ev2.body"),
        },
        {
          lead: t("swa.scenario.untrusted.ev3.lead"),
          body: t("swa.scenario.untrusted.ev3.body"),
        },
      ],
    },
    unknown: {
      key: "unknown",
      label: t("swa.scenario.unknown.label"),
      tag: t("swa.scenario.unknown.tag"),
      ok: false,
      failStage: 2,
      desc: t("swa.scenario.unknown.desc"),
      evidence: [
        {
          lead: t("swa.scenario.unknown.ev1.lead"),
          body: t("swa.scenario.unknown.ev1.body"),
        },
        {
          lead: t("swa.scenario.unknown.ev2.lead"),
          body: t("swa.scenario.unknown.ev2.body"),
        },
        {
          lead: t("swa.scenario.unknown.ev3.lead"),
          body: t("swa.scenario.unknown.ev3.body"),
        },
      ],
    },
    foreign: {
      key: "foreign",
      label: t("swa.scenario.foreign.label"),
      tag: t("swa.scenario.foreign.tag"),
      ok: false,
      failStage: 3,
      desc: t("swa.scenario.foreign.desc"),
      evidence: [
        {
          lead: t("swa.scenario.foreign.ev1.lead"),
          body: t("swa.scenario.foreign.ev1.body"),
        },
        {
          lead: t("swa.scenario.foreign.ev2.lead"),
          body: t("swa.scenario.foreign.ev2.body"),
        },
        {
          lead: t("swa.scenario.foreign.ev3.lead"),
          body: t("swa.scenario.foreign.ev3.body"),
        },
      ],
    },
  },
  nodes: [
    {
      key: "workload",
      title: t("swa.node.workload.title"),
      stages: [0],
      doneAfter: 1,
      failsAt: [],
      tag: (s) =>
        s === "done"
          ? t("chrome.state.requested")
          : t("chrome.state.workload"),
      body: ({ result }) => (
        <>
          <Kv k={t("swa.node.workload.kv")} v={result?.spiffeId || SWA_WORKLOAD} />
          <span style={foot}>{t("swa.node.workload.foot")}</span>
        </>
      ),
    },
    {
      key: "attest",
      title: t("swa.node.attest.title"),
      stages: [1],
      doneAfter: 2,
      failsAt: [],
      tag: (s) =>
        s === "done"
          ? t("chrome.state.nodeAttested")
          : t("chrome.state.attesting"),
      body: ({ state }) => (
        <>
          <div style={grid2}>
            <Kv
              k={t("chrome.ctx.attestor")}
              v="k8s_psat"
              vColor={state === "done" ? INK.ok : INK.mono}
            />
            <Kv k={t("chrome.ctx.nodeGroup")} v={SWA_CTX.nodeGroup} />
          </div>
          <span style={foot}>{t("swa.node.attest.foot")}</span>
        </>
      ),
    },
    {
      key: "identity",
      title: t("swa.node.identity.title"),
      stages: [2],
      doneAfter: 3,
      failsAt: [2],
      tag: (s) =>
        s === "failed"
          ? t("chrome.state.noIdentity")
          : s === "done"
            ? t("chrome.state.svidIssued")
            : t("chrome.state.issuing"),
      body: ({ state, result }) =>
        state === "failed" ? (
          <span style={dangerNote}>{t("swa.node.identity.danger")}</span>
        ) : (
          <>
            <div style={grid2}>
              <Kv
                k={t("chrome.row.spiffeId")}
                v={result?.spiffeId || SWA_WORKLOAD}
                vColor={state === "done" ? INK.ok : INK.mono}
              />
              <Kv
                k={t("chrome.row.svid")}
                v={t("swa.node.identity.svidVal", {
                  alg: result?.jwtAlg || "jwt-svid",
                })}
              />
            </div>
            <span style={foot}>{t("swa.node.identity.foot")}</span>
          </>
        ),
    },
    {
      key: "gateway",
      title: t("swa.node.gateway.title"),
      stages: [3, 4],
      doneAfter: 5,
      failsAt: [3, 4],
      tag: (s) =>
        s === "failed"
          ? t("chrome.state.rejected")
          : s === "done"
            ? t("chrome.state.authorized")
            : t("chrome.state.verifying"),
      body: ({ state, scenario }) =>
        state === "failed" ? (
          <span style={dangerNote}>
            {scenario === "foreign"
              ? t("swa.node.gateway.dangerForeign")
              : t("swa.node.gateway.dangerNotListed")}
          </span>
        ) : (
          <>
            <Kv
              k={t("swa.node.gateway.kvMtls")}
              v={t("swa.node.gateway.mtlsVal")}
              vColor={state === "done" ? INK.ok : INK.mono}
            />
            <span style={foot}>{t("swa.node.gateway.foot")}</span>
          </>
        ),
    },
    {
      key: "resource",
      title: t("swa.node.resource.title"),
      stages: [5],
      doneAfter: 6,
      failsAt: [],
      tag: (s) => (s === "done" ? t("chrome.state.rowsReturned") : ""),
      body: ({ state, result }) =>
        state === "done" ? (
          <Kv
            k={t("swa.node.resource.kvResult")}
            v={t("swa.node.resource.resultVal", {
              n: result?.dbRows.length ?? 0,
            })}
            vColor={INK.ok}
          />
        ) : (
          <span style={dimNote}>{t("swa.node.resource.dimNote")}</span>
        ),
    },
  ],
  layers: [
    {
      name: t("swa.layer.request.name"),
      Icon: Send,
      pass: () => t("swa.layer.request.pass"),
      reject: () => t("swa.layer.request.reject"),
      idle: t("swa.layer.request.idle"),
    },
    {
      name: t("swa.layer.attest.name"),
      Icon: Fingerprint,
      pass: () => t("swa.layer.attest.pass"),
      reject: () => t("swa.layer.attest.reject"),
      idle: t("swa.layer.attest.idle"),
    },
    {
      name: t("swa.layer.svid.name"),
      Icon: BadgeCheck,
      pass: ({ result }) =>
        t("swa.layer.svid.pass", {
          alg: result?.jwtAlg ? ` · ${result.jwtAlg}` : "",
        }),
      reject: () => t("swa.layer.svid.reject"),
      idle: t("swa.layer.svid.idle"),
    },
    {
      name: t("swa.layer.mtls.name"),
      Icon: Lock,
      pass: () => t("swa.layer.mtls.pass"),
      reject: () => t("swa.layer.mtls.reject"),
      idle: t("swa.layer.mtls.idle"),
    },
    {
      name: t("swa.layer.authz.name"),
      Icon: ShieldCheck,
      pass: () => t("swa.layer.authz.pass", { gateway: SWA_CTX.gateway }),
      reject: () => t("swa.layer.authz.reject"),
      idle: t("swa.layer.authz.idle"),
    },
    {
      name: t("swa.layer.resource.name"),
      Icon: Database,
      pass: ({ result }) =>
        t("swa.layer.resource.pass", { n: result?.dbRows.length ?? 0 }),
      reject: () => t("swa.layer.resource.reject"),
      idle: t("swa.layer.resource.idle"),
    },
  ],
  buildTrace: (scenario, r) => {
    const spiffe = r?.spiffeId || SWA_WORKLOAD;
    const lines: Line[] = [
      {
        s: 0,
        kind: "comment",
        text: t("swa.trace.0"),
      },
      { s: 0, kind: "cmd", text: "FetchJWTSVID(audience=swa-demo-audience)" },
      {
        s: 1,
        kind: "comment",
        text: t("swa.trace.1"),
      },
      {
        s: 2,
        kind: "comment",
        text: t("swa.trace.2"),
      },
      {
        s: 3,
        kind: "comment",
        text: t("swa.trace.3", { gateway: SWA_CTX.gateway }),
      },
      {
        s: 4,
        kind: "comment",
        text: t("swa.trace.4"),
      },
      {
        s: 5,
        kind: "cmd",
        text: "psql 'host=pg-gateway.swa-data.svc.cluster.local port=6432' -c 'SELECT * FROM shipments'",
      },
    ];
    if (r?.retrieved) {
      lines.push({
        s: 2,
        kind: "out",
        text: `SVID: ${spiffe}`,
        terminal: true,
      });
      lines.push({
        s: 5,
        kind: "out",
        text: " ref          | origin    | destination | status     | carrier",
        terminal: true,
      });
      lines.push({
        s: 5,
        kind: "out",
        text: "--------------+-----------+-------------+------------+------------------",
        terminal: true,
      });
      const rows = (r.dbRows || []).slice(0, 4);
      for (const row of rows) {
        lines.push({
          s: 5,
          kind: "out",
          text: ` ${(row.ref || "").padEnd(12)} | ${(row.origin || "").padEnd(9)} | ${(row.destination || "").padEnd(11)} | ${(row.status || "").padEnd(10)} | ${row.carrier || ""}`,
          terminal: true,
        });
      }
      lines.push({
        s: 5,
        kind: "out",
        text: `(${r.dbRows?.length ?? 0} rows)`,
        terminal: true,
      });
      lines.push({
        s: 5,
        kind: "ok",
        text: "✓ authorized by SPIFFE ID · no stored credential",
        terminal: true,
      });
    } else if (r) {
      const fs = scenario === "unknown" ? 2 : scenario === "foreign" ? 3 : 4;
      const errLine =
        scenario === "unknown"
          ? "rpc error: code = PermissionDenied desc = no identity issued for this workload"
          : scenario === "foreign"
            ? "remote error: tls: bad certificate — certificate signed by unknown authority"
            : "pg-gateway: remote error: tls: bad certificate (SPIFFE ID not allow-listed)";
      lines.push({ s: fs, kind: "err", text: errLine, terminal: true });
      lines.push({
        s: fs,
        kind: "err",
        text:
          scenario === "unknown"
            ? "✗ no SVID — the workload has no identity to present"
            : scenario === "foreign"
              ? "✗ rejected at the mTLS trust boundary — foreign trust domain"
              : "✗ denied at the gateway — SPIFFE ID not allow-listed",
        terminal: true,
      });
    }
    return lines;
  },
};

/* =============== Conjur (Secrets Manager SaaS) · authn-jwt + authn-iam =============== */

const CONJUR_SECRET = "data/secrets/demo-db-password";
const CONJUR_WORKLOAD =
  "spiffe://swa-demo.example.com/minikube-nodes/ns/swa-demo/sa/swa-demo-webapp";

// makeConjur builds a Conjur provider. The two modes share the authenticate →
// scoped-token → read-variable flow and differ only in how the workload proves
// identity (JWT-SVID vs a signed sts:GetCallerIdentity).
function makeConjur(jwt: boolean): Provider {
  const authn = jwt ? "authn-jwt" : "authn-iam";
  const readStage = jwt ? 4 : 5; // index of the "retrieve secret" stage
  const authnFail = jwt ? 2 : 3; // index of the stage where authentication fails
  const arn = "arn:aws:sts::123456789012:assumed-role/swa-demo-host/i-0abc123";
  const authnDenyNote = jwt
    ? t("conjur.authnDeny.jwt")
    : t("conjur.authnDeny.iam");

  return {
    id: jwt ? "conjur-jwt" : "conjur-iam",
    apiPath: `/api/conjur?mode=${jwt ? "jwt" : "iam"}`,
    resultKey: "conjur",
    subtitle: `secrets manager · ${authn}`,
    brand: {
      name: jwt ? t("conjur.jwt.brand.name") : t("conjur.iam.brand.name"),
      sub: "Idira Secrets Manager",
    },
    heroTitle: t("conjur.hero.title"),
    heroLede: emph(jwt ? t("conjur.hero.lede.jwt") : t("conjur.hero.lede.iam")),
    ctx: [
      {
        k: t("chrome.ctx.tenant"),
        v: "swa-demo.secretsmgr.cyberark.cloud",
        wide: true,
      },
      { k: t("chrome.ctx.authenticator"), v: `${authn}/swa` },
      { k: t("chrome.ctx.variable"), v: CONJUR_SECRET },
      { k: t("chrome.ctx.auth"), v: authn, brand: true },
    ],
    stages: jwt
      ? [
          {
            key: "fetch",
            label: t("conjur.jwt.stage.fetch.label"),
            verb: t("conjur.jwt.stage.fetch.verb"),
          },
          {
            key: "present",
            label: t("conjur.jwt.stage.present.label"),
            verb: t("conjur.jwt.stage.present.verb"),
          },
          {
            key: "verify",
            label: t("conjur.jwt.stage.verify.label"),
            verb: t("conjur.jwt.stage.verify.verb"),
          },
          {
            key: "token",
            label: t("conjur.jwt.stage.token.label"),
            verb: t("conjur.jwt.stage.token.verb"),
          },
          {
            key: "read",
            label: t("conjur.jwt.stage.read.label"),
            verb: t("conjur.jwt.stage.read.verb"),
          },
        ]
      : [
          {
            key: "imds",
            label: t("conjur.iam.stage.imds.label"),
            verb: t("conjur.iam.stage.imds.verb"),
          },
          {
            key: "sign",
            label: t("conjur.iam.stage.sign.label"),
            verb: t("conjur.iam.stage.sign.verb"),
          },
          {
            key: "present",
            label: t("conjur.iam.stage.present.label"),
            verb: t("conjur.iam.stage.present.verb"),
          },
          {
            key: "verify",
            label: t("conjur.iam.stage.verify.label"),
            verb: t("conjur.iam.stage.verify.verb"),
          },
          {
            key: "token",
            label: t("conjur.iam.stage.token.label"),
            verb: t("conjur.iam.stage.token.verb"),
          },
          {
            key: "read",
            label: t("conjur.iam.stage.read.label"),
            verb: t("conjur.iam.stage.read.verb"),
          },
        ],
    scenarioOrder: ["authorized", "invalid", "denied"],
    scenarios: {
      authorized: {
        key: "authorized",
        label: t("conjur.scenario.authorized.label"),
        tag: t("conjur.scenario.authorized.tag"),
        ok: true,
        failStage: -1,
        desc: jwt
          ? t("conjur.scenario.authorized.desc.jwt")
          : t("conjur.scenario.authorized.desc.iam"),
        evidence: [
          {
            lead: t("conjur.scenario.authorized.ev1.lead"),
            body: jwt
              ? t("conjur.scenario.authorized.ev1.body.jwt")
              : t("conjur.scenario.authorized.ev1.body.iam"),
          },
          {
            lead: t("conjur.scenario.authorized.ev2.lead"),
            body: t("conjur.scenario.authorized.ev2.body"),
          },
          {
            lead: t("conjur.scenario.authorized.ev3.lead"),
            body: t("conjur.scenario.authorized.ev3.body"),
          },
        ],
      },
      invalid: {
        key: "invalid",
        label: t("conjur.scenario.invalid.label"),
        tag: t("conjur.scenario.invalid.tag"),
        ok: false,
        failStage: authnFail,
        desc: jwt
          ? t("conjur.scenario.invalid.desc.jwt")
          : t("conjur.scenario.invalid.desc.iam"),
        evidence: [
          {
            lead: jwt
              ? t("conjur.scenario.invalid.ev1.lead.jwt")
              : t("conjur.scenario.invalid.ev1.lead.iam"),
            body: jwt
              ? t("conjur.scenario.invalid.ev1.body.jwt")
              : t("conjur.scenario.invalid.ev1.body.iam"),
          },
          {
            lead: t("conjur.scenario.invalid.ev2.lead"),
            body: t("conjur.scenario.invalid.ev2.body"),
          },
          {
            lead: jwt
              ? t("conjur.scenario.invalid.ev3.lead.jwt")
              : t("conjur.scenario.invalid.ev3.lead.iam"),
            body: jwt
              ? t("conjur.scenario.invalid.ev3.body.jwt")
              : t("conjur.scenario.invalid.ev3.body.iam"),
          },
        ],
      },
      denied: {
        key: "denied",
        label: t("conjur.scenario.denied.label"),
        tag: t("conjur.scenario.denied.tag"),
        ok: false,
        failStage: readStage,
        desc: t("conjur.scenario.denied.desc"),
        evidence: [
          {
            lead: t("conjur.scenario.denied.ev1.lead"),
            body: t("conjur.scenario.denied.ev1.body"),
          },
          {
            lead: t("conjur.scenario.denied.ev2.lead"),
            body: t("conjur.scenario.denied.ev2.body"),
          },
          {
            lead: t("conjur.scenario.denied.ev3.lead"),
            body: t("conjur.scenario.denied.ev3.body"),
          },
        ],
      },
    },
    nodes: jwt
      ? [
          {
            key: "workload",
            title: t("conjur.jwt.node.workload.title"),
            stages: [0],
            doneAfter: 1,
            failsAt: [],
            tag: (s) =>
              s === "done"
                ? t("chrome.state.identity")
                : t("chrome.state.workload"),
            body: ({ result }) => (
              <>
                <Kv
                  k={t("conjur.node.workloadJwt.kv")}
                  v={result?.identity || result?.spiffeId || CONJUR_WORKLOAD}
                />
                <span style={foot}>{t("conjur.node.workloadJwt.foot")}</span>
              </>
            ),
          },
          {
            key: "authn",
            title: t("conjur.jwt.node.authn.title"),
            stages: [1, 2],
            doneAfter: 3,
            failsAt: [1, 2],
            tag: (s) =>
              s === "failed"
                ? t("chrome.tag.authnDeny")
                : s === "done"
                  ? t("chrome.state.authenticated")
                  : t("chrome.state.validating"),
            body: ({ state }) =>
              state === "failed" ? (
                <span style={dangerNote}>{authnDenyNote}</span>
              ) : (
                <>
                  <Kv
                    k={t("conjur.node.authnJwt.kv")}
                    v={t("conjur.node.authnJwt.val")}
                    vColor={state === "done" ? INK.ok : INK.mono}
                  />
                  <span style={foot}>{t("conjur.node.authnJwt.foot")}</span>
                </>
              ),
          },
          {
            key: "token",
            title: t("conjur.jwt.node.token.title"),
            stages: [3],
            doneAfter: 4,
            failsAt: [],
            tag: (s) => (s === "done" ? t("chrome.state.granted") : ""),
            body: ({ state, result }) => (
              <>
                <Kv
                  k={t("conjur.node.token.kv")}
                  v={result?.tokenScope || CONJUR_SECRET}
                  vColor={state === "done" ? INK.ok : INK.mono}
                />
                <span style={foot}>{t("conjur.node.token.foot")}</span>
              </>
            ),
          },
          {
            key: "secret",
            title: t("conjur.jwt.node.secret.title"),
            stages: [4],
            doneAfter: 5,
            failsAt: [4],
            tag: (s) =>
              s === "failed"
                ? t("chrome.tag.authzDeny")
                : s === "done"
                  ? t("chrome.state.returned")
                  : "",
            body: ({ state, result }) =>
              state === "failed" ? (
                <span style={dangerNote}>
                  {t("conjur.node.secret.danger", {
                    secretName:
                      result?.secretName || t("conjur.node.secret.thisVariable"),
                  })}
                </span>
              ) : state === "done" ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <Kv
                    k={t("chrome.ctx.variable")}
                    v={result?.secretName || CONJUR_SECRET}
                  />
                  <Kv
                    k={t("chrome.row.valueMasked")}
                    v={result?.masked || "—"}
                    vColor={INK.ok}
                  />
                </div>
              ) : (
                <span style={dimNote}>{t("conjur.node.secret.dimNote")}</span>
              ),
          },
        ]
      : [
          {
            key: "workload",
            title: t("conjur.iam.node.workload.title"),
            stages: [0],
            doneAfter: 1,
            failsAt: [],
            tag: (s) =>
              s === "done"
                ? t("chrome.state.profile")
                : t("chrome.state.workload"),
            body: ({ result }) => (
              <>
                <Kv
                  k={t("conjur.node.workloadIam.kv")}
                  v={result?.identity || arn}
                />
                <span style={foot}>{t("conjur.node.workloadIam.foot")}</span>
              </>
            ),
          },
          {
            key: "sts",
            title: t("conjur.iam.node.sts.title"),
            stages: [1],
            doneAfter: 2,
            failsAt: [],
            tag: (s) =>
              s === "done"
                ? t("chrome.state.signed")
                : t("chrome.state.signing"),
            body: ({ state, result }) => (
              <>
                <Kv
                  k={t("conjur.node.sts.kv")}
                  v={result?.identity || arn}
                  vColor={state === "done" ? INK.ok : INK.mono}
                />
                <span style={foot}>{t("conjur.node.sts.foot")}</span>
              </>
            ),
          },
          {
            key: "authn",
            title: t("conjur.iam.node.authn.title"),
            stages: [2, 3],
            doneAfter: 4,
            failsAt: [2, 3],
            tag: (s) =>
              s === "failed"
                ? t("chrome.tag.authnDeny")
                : s === "done"
                  ? t("chrome.state.verified")
                  : t("chrome.state.verifying"),
            body: ({ state }) =>
              state === "failed" ? (
                <span style={dangerNote}>{authnDenyNote}</span>
              ) : (
                <>
                  <Kv
                    k={t("conjur.node.authnIam.kv")}
                    v={t("conjur.node.authnIam.val")}
                    vColor={state === "done" ? INK.ok : INK.mono}
                  />
                  <span style={foot}>{t("conjur.node.authnIam.foot")}</span>
                </>
              ),
          },
          {
            key: "token",
            title: t("conjur.iam.node.token.title"),
            stages: [4],
            doneAfter: 5,
            failsAt: [],
            tag: (s) => (s === "done" ? t("chrome.state.granted") : ""),
            body: ({ state, result }) => (
              <>
                <Kv
                  k={t("conjur.node.token.kv")}
                  v={result?.tokenScope || CONJUR_SECRET}
                  vColor={state === "done" ? INK.ok : INK.mono}
                />
                <span style={foot}>{t("conjur.node.token.foot")}</span>
              </>
            ),
          },
          {
            key: "secret",
            title: t("conjur.iam.node.secret.title"),
            stages: [5],
            doneAfter: 6,
            failsAt: [5],
            tag: (s) =>
              s === "failed"
                ? t("chrome.tag.authzDeny")
                : s === "done"
                  ? t("chrome.state.returned")
                  : "",
            body: ({ state, result }) =>
              state === "failed" ? (
                <span style={dangerNote}>
                  {t("conjur.node.secret.danger", {
                    secretName:
                      result?.secretName || t("conjur.node.secret.thisVariable"),
                  })}
                </span>
              ) : state === "done" ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <Kv
                    k={t("chrome.ctx.variable")}
                    v={result?.secretName || CONJUR_SECRET}
                  />
                  <Kv
                    k={t("chrome.row.valueMasked")}
                    v={result?.masked || "—"}
                    vColor={INK.ok}
                  />
                </div>
              ) : (
                <span style={dimNote}>{t("conjur.node.secret.dimNote")}</span>
              ),
          },
        ],
    layers: jwt
      ? [
          {
            name: t("conjur.jwt.layer.fetch.name"),
            Icon: BadgeCheck,
            pass: () => t("conjur.jwt.layer.fetch.pass"),
            reject: () => t("conjur.jwt.layer.fetch.reject"),
            idle: t("conjur.jwt.layer.fetch.idle"),
          },
          {
            name: t("conjur.layer.present.name"),
            Icon: Send,
            pass: () => t("conjur.jwt.layer.present.pass"),
            reject: () => t("conjur.jwt.layer.present.reject"),
            idle: t("conjur.jwt.layer.present.idle"),
          },
          {
            name: t("conjur.jwt.layer.verify.name"),
            Icon: ShieldCheck,
            pass: () => t("conjur.jwt.layer.verify.pass"),
            reject: () => t("conjur.jwt.layer.verify.reject"),
            idle: t("conjur.jwt.layer.verify.idle"),
          },
          {
            name: t("conjur.layer.token.name"),
            Icon: KeyRound,
            pass: ({ result }) =>
              t("conjur.layer.token.pass", {
                scope: result?.tokenScope || CONJUR_SECRET,
              }),
            reject: () => t("conjur.layer.token.reject"),
            idle: t("conjur.layer.token.idle"),
          },
          {
            name: t("conjur.layer.read.name"),
            Icon: Database,
            pass: ({ result }) =>
              t("conjur.layer.read.pass", {
                masked: result?.masked || "returned",
                secretName: result?.secretName || CONJUR_SECRET,
              }),
            reject: ({ result }) =>
              t("conjur.layer.read.reject", {
                secretName:
                  result?.secretName || t("conjur.node.secret.thisVariable"),
              }),
            idle: t("conjur.layer.read.idle"),
          },
        ]
      : [
          {
            name: t("conjur.iam.layer.imds.name"),
            Icon: Server,
            pass: () => t("conjur.iam.layer.imds.pass"),
            reject: () => t("conjur.iam.layer.imds.reject"),
            idle: t("conjur.iam.layer.imds.idle"),
          },
          {
            name: t("conjur.iam.layer.sign.name"),
            Icon: Fingerprint,
            pass: () => t("conjur.iam.layer.sign.pass"),
            reject: () => t("conjur.iam.layer.sign.reject"),
            idle: t("conjur.iam.layer.sign.idle"),
          },
          {
            name: t("conjur.layer.present.name"),
            Icon: Send,
            pass: () => t("conjur.iam.layer.present.pass"),
            reject: () => t("conjur.iam.layer.present.reject"),
            idle: t("conjur.iam.layer.present.idle"),
          },
          {
            name: t("conjur.iam.layer.verify.name"),
            Icon: Cloud,
            pass: () => t("conjur.iam.layer.verify.pass"),
            reject: () => t("conjur.iam.layer.verify.reject"),
            idle: t("conjur.iam.layer.verify.idle"),
          },
          {
            name: t("conjur.layer.token.name"),
            Icon: KeyRound,
            pass: ({ result }) =>
              t("conjur.layer.token.pass", {
                scope: result?.tokenScope || CONJUR_SECRET,
              }),
            reject: () => t("conjur.layer.token.reject"),
            idle: t("conjur.layer.token.idle"),
          },
          {
            name: t("conjur.layer.read.name"),
            Icon: Database,
            pass: ({ result }) =>
              t("conjur.layer.read.pass", {
                masked: result?.masked || "returned",
                secretName: result?.secretName || CONJUR_SECRET,
              }),
            reject: ({ result }) =>
              t("conjur.layer.read.reject", {
                secretName:
                  result?.secretName || t("conjur.node.secret.thisVariable"),
              }),
            idle: t("conjur.layer.read.idle"),
          },
        ],
    buildTrace: (scenario, r) => {
      const secret = r?.secretName || CONJUR_SECRET;
      const ident = r?.identity || (jwt ? CONJUR_WORKLOAD : arn);
      const readCmd: Line = {
        s: readStage,
        kind: "cmd",
        text: `GET /secrets/idira/variable/${encodeURIComponent(secret)}   (Authorization: Token …)`,
      };
      const lines: Line[] = jwt
        ? [
            { s: 0, kind: "comment", text: t("conjur.trace.jwt.0") },
            { s: 0, kind: "cmd", text: "FetchJWTSVID(audience=idira)" },
            {
              s: 1,
              kind: "comment",
              text: t("conjur.trace.jwt.1"),
            },
            {
              s: 2,
              kind: "comment",
              text: t("conjur.trace.jwt.2"),
            },
            {
              s: 3,
              kind: "comment",
              text: t("conjur.trace.token"),
            },
            readCmd,
          ]
        : [
            {
              s: 0,
              kind: "comment",
              text: t("conjur.trace.iam.0"),
            },
            {
              s: 0,
              kind: "cmd",
              text: 'curl -s -H "X-aws-ec2-metadata-token: $TOK" http://169.254.169.254/latest/meta-data/iam/security-credentials/',
            },
            {
              s: 1,
              kind: "comment",
              text: t("conjur.trace.iam.1"),
            },
            {
              s: 1,
              kind: "cmd",
              text: "aws sts get-caller-identity   # produces a SigV4-signed request",
            },
            {
              s: 2,
              kind: "comment",
              text: t("conjur.trace.iam.2"),
            },
            {
              s: 3,
              kind: "comment",
              text: t("conjur.trace.iam.3"),
            },
            {
              s: 4,
              kind: "comment",
              text: t("conjur.trace.token"),
            },
            readCmd,
          ];

      if (r?.retrieved) {
        lines.push({
          s: authnFail,
          kind: "out",
          text: `identity: ${ident}`,
          terminal: true,
        });
        lines.push({
          s: readStage,
          kind: "out",
          text: "HTTP/1.1 200 OK",
          terminal: true,
        });
        lines.push({
          s: readStage,
          kind: "out",
          text: `${secret} = ${r.masked}   // ${t("conjur.trace.masked")}`,
          terminal: true,
        });
        lines.push({
          s: readStage,
          kind: "ok",
          text: t("conjur.trace.retrieved"),
          terminal: true,
        });
      } else if (r && scenario === "invalid") {
        lines.push({
          s: authnFail,
          kind: "err",
          text: "HTTP/1.1 401 Unauthorized",
          terminal: true,
        });
        lines.push({
          s: authnFail,
          kind: "out",
          text: `{ "error": "${(r.error || "authentication failed").replace(/"/g, "'")}" }`,
          terminal: true,
        });
        lines.push({
          s: authnFail,
          kind: "err",
          text: jwt
            ? t("conjur.trace.authnFail.jwt")
            : t("conjur.trace.authnFail.iam"),
          terminal: true,
        });
      } else if (r) {
        lines.push({
          s: readStage,
          kind: "err",
          text: "HTTP/1.1 403 Forbidden",
          terminal: true,
        });
        lines.push({
          s: readStage,
          kind: "out",
          text: `{ "error": "${(r.error || "not authorized").replace(/"/g, "'")}" }`,
          terminal: true,
        });
        lines.push({
          s: readStage,
          kind: "err",
          text: t("conjur.trace.denied"),
          terminal: true,
        });
      }
      return lines;
    },
  };
}

const conjurJwtProvider = makeConjur(true);
const conjurIamProvider = makeConjur(false);

export const PROVIDERS: Record<Provider["id"], Provider> = {
  cp: cpProvider,
  ccp: ccpProvider,
  swa: swaProvider,
  "conjur-jwt": conjurJwtProvider,
  "conjur-iam": conjurIamProvider,
};

/** Pick the provider from the page path (+ hash for the two Conjur modes). */
export function providerFromPath(pathname: string, hash = ""): Provider {
  if (pathname.startsWith("/credential-providers")) return ccpProvider;
  if (pathname.startsWith("/swa")) return swaProvider;
  if (pathname.startsWith("/secrets-manager")) {
    return /iam/i.test(hash) ? conjurIamProvider : conjurJwtProvider;
  }
  return cpProvider;
}

/** Scenario meta lookup with a safe fallback to the provider's first scenario. */
export function pmeta(p: Provider, k: ScenarioKey): ScenarioMeta {
  return p.scenarios[k] ?? p.scenarios[p.scenarioOrder[0]!]!;
}
