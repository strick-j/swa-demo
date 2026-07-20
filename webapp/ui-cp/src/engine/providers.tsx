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
    return (
      <span style={dimNote}>secret masked at the source · never on disk</span>
    );
  }
  const dual = scenario === "dual";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Kv
        k={dual ? "Active account" : "Account"}
        v={
          (dual ? result?.dualActive : result?.account) ||
          result?.account ||
          "—"
        }
      />
      <Kv k="Value (masked)" v={result?.masked || "—"} vColor={INK.ok} />
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
    { k: "Application", v: CP_CTX.application, wide: true },
    { k: "Provider", v: CP_CTX.provider },
    { k: "Safe", v: CP_CTX.safe },
    { k: "Auth", v: "hash · os-user · path", brand: true },
  ],
  stages: [
    { key: "invoke", label: "Invoke caller", verb: "Invoking caller" },
    {
      key: "hash",
      label: "Application hash",
      verb: "Measuring application hash",
    },
    {
      key: "osuser",
      label: "OS user / path",
      verb: "Checking OS user and path",
    },
    { key: "authz", label: "Safe authorization", verb: "Authorizing safe" },
    {
      key: "return",
      label: "Credential returned",
      verb: "Returning credential",
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
      title: "App · Trusted JAR",
      stages: [0],
      doneAfter: 1,
      failsAt: [0],
      tag: (s) => (s === "done" ? "invoked" : "caller"),
      body: ({ result }) => (
        <>
          <Kv
            k="Calling application"
            v={result?.callerPath || "cp-caller.jar"}
          />
          <span style={foot}>
            the workload stores no password or client cert
          </span>
        </>
      ),
    },
    {
      key: "provider",
      title: "AIM Credential Provider",
      stages: [1, 2],
      doneAfter: 3,
      failsAt: [1, 2],
      tag: (s) =>
        s === "failed"
          ? "authn deny"
          : s === "done"
            ? "authenticated"
            : "measuring",
      body: ({ state, result }) =>
        state === "failed" ? (
          <span style={dangerNote}>
            {result?.errorCode ? `${result.errorCode} · ` : ""}application hash
            is not authorized
          </span>
        ) : (
          <>
            <div style={grid2}>
              <Kv
                k="App fingerprint"
                v={result?.appHash || "—"}
                vColor={state === "done" ? INK.ok : INK.mono}
              />
              <Kv
                k="OS user · path"
                v={result?.osUser || "hash · os-user · path"}
              />
            </div>
            <span style={foot}>
              authenticates the calling application by its characteristics
            </span>
          </>
        ),
    },
    {
      key: "vault",
      title: "Vault · App permission",
      stages: [3],
      doneAfter: 4,
      failsAt: [3],
      tag: (s) =>
        s === "failed" ? "authz deny" : s === "done" ? "authorized" : "",
      body: ({ state, result }) =>
        state === "failed" ? (
          <span style={dangerNote}>
            {result?.errorCode ? `${result.errorCode} · ` : ""}Application not
            permitted for Safe {result?.safe || CP_CTX.safe}
          </span>
        ) : (
          <Kv
            k="Safe"
            v={result?.safe || CP_CTX.safe}
            vColor={state === "done" ? INK.ok : INK.mono}
          />
        ),
    },
    {
      key: "credential",
      title: "Credential",
      stages: [4],
      doneAfter: 5,
      failsAt: [],
      tag: (s) => (s === "done" ? "returned" : ""),
      body: CredentialBody,
    },
  ],
  layers: [
    {
      name: "Invoke caller",
      Icon: Terminal,
      pass: () => "host cp-bridge ran the registered Java caller",
      reject: () => "cp-bridge could not run the caller",
      idle: "run cp-caller.jar via the host bridge",
    },
    {
      name: "Application hash",
      Icon: Fingerprint,
      pass: ({ result }) =>
        `fingerprint ${result?.appHash || "—"} · matched a registered Application`,
      reject: ({ result }) =>
        `${result?.errorCode || "APPAP133E"} · application hash is not authorized`,
      idle: "measure the calling application's hash",
    },
    {
      name: "OS user / path",
      Icon: BadgeCheck,
      pass: ({ result }) =>
        `os-user ${result?.osUser || "—"} + executable path matched`,
      reject: () => "OS user / path did not match the Application",
      idle: "verify OS user and executable path",
    },
    {
      name: "Safe authorization",
      Icon: Lock,
      pass: ({ result }) =>
        `Application authorized for Safe ${result?.safe || CP_CTX.safe}`,
      reject: ({ result }) =>
        `${result?.errorCode || "APPAP"} · not permitted for Safe ${result?.safe || CP_CTX.safe}`,
      idle: "authorize the Application for the Safe",
    },
    {
      name: "Credential",
      Icon: KeyRound,
      pass: ({ result }) =>
        `${result?.masked || "returned"} · hashed on host · never on disk`,
      reject: () => "no credential returned",
      idle: "return the account, masked on the host",
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
        text: "webapp pod → host cp-bridge (host.minikube.internal:8890)",
      },
      {
        s: 0,
        kind: "cmd",
        text: `curl -s -XPOST 'http://host.minikube.internal:8890/cp?scenario=${scenario}'`,
      },
      {
        s: 1,
        kind: "comment",
        text: "cp-bridge dispatch → java caller (subprocess)",
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
    { k: "Application", v: CCP_CTX.application, wide: true },
    { k: "Endpoint", v: CCP_CTX.endpoint },
    { k: "Safe", v: CCP_CTX.safe },
    { k: "Auth", v: "client cert · mTLS", brand: true },
  ],
  stages: [
    {
      key: "present",
      label: "Present certificate",
      verb: "Presenting client certificate",
    },
    {
      key: "authn",
      label: "Certificate authentication",
      verb: "Authenticating certificate",
    },
    { key: "authz", label: "Safe authorization", verb: "Authorizing safe" },
    {
      key: "return",
      label: "Credential returned",
      verb: "Returning credential",
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
      title: "App · client",
      stages: [0],
      doneAfter: 1,
      failsAt: [],
      tag: (s) => (s === "done" ? "presented" : "client"),
      body: ({ result, scenario }) => (
        <>
          <Kv
            k="Client certificate (CN)"
            v={
              scenario === "no-cert"
                ? "(none presented)"
                : result?.certCn || "swa-demo-webapp"
            }
            vColor={scenario === "no-cert" ? INK.danger : undefined}
          />
          <span style={foot}>
            mTLS to AIMWebService · no stored password or API key
          </span>
        </>
      ),
    },
    {
      key: "aimws",
      title: "AIMWebService",
      stages: [1],
      doneAfter: 2,
      failsAt: [1],
      tag: (s) =>
        s === "failed"
          ? "authn deny"
          : s === "done"
            ? "authenticated"
            : "verifying",
      body: ({ state, result, scenario }) =>
        state === "failed" ? (
          <span style={dangerNote}>
            {result?.errorCode ? `${result.errorCode} · ` : "APPAP227E · "}
            {scenario === "no-cert"
              ? "no client certificate presented"
              : "certificate not authorized"}
          </span>
        ) : (
          <>
            <div style={grid2}>
              <Kv
                k="Application"
                v={result?.appId || CCP_CTX.application}
                vColor={state === "done" ? INK.ok : INK.mono}
              />
              <Kv k="Certificate CN" v={result?.certCn || "swa-demo-webapp"} />
            </div>
            <span style={foot}>
              authenticates the client certificate to a registered Application
            </span>
          </>
        ),
    },
    {
      key: "vault",
      title: "Vault · App permission",
      stages: [2],
      doneAfter: 3,
      failsAt: [2],
      tag: (s) =>
        s === "failed" ? "authz deny" : s === "done" ? "authorized" : "",
      body: ({ state, result }) =>
        state === "failed" ? (
          <span style={dangerNote}>
            {result?.errorCode ? `${result.errorCode} · ` : "APPAP004E · "}not
            permitted for Safe {result?.safe || CCP_CTX.safe}
          </span>
        ) : (
          <Kv
            k="Safe"
            v={result?.safe || CCP_CTX.safe}
            vColor={state === "done" ? INK.ok : INK.mono}
          />
        ),
    },
    {
      key: "credential",
      title: "Credential",
      stages: [3],
      doneAfter: 4,
      failsAt: [],
      tag: (s) => (s === "done" ? "returned" : ""),
      body: CredentialBody,
    },
  ],
  layers: [
    {
      name: "Present certificate",
      Icon: FileCheck,
      pass: () => "mTLS handshake opened · client certificate presented",
      reject: () => "no client certificate presented",
      idle: "open mTLS and present the client certificate",
    },
    {
      name: "Certificate authentication",
      Icon: BadgeCheck,
      pass: ({ result }) =>
        `cert CN ${result?.certCn || "swa-demo-webapp"} matched a registered Application`,
      reject: ({ result }) =>
        `${result?.errorCode || "APPAP227E"} · certificate not authorized`,
      idle: "authenticate the certificate to an Application",
    },
    {
      name: "Safe authorization",
      Icon: Lock,
      pass: ({ result }) =>
        `Application authorized for Safe ${result?.safe || CCP_CTX.safe}`,
      reject: ({ result }) =>
        `${result?.errorCode || "APPAP004E"} · not permitted for Safe ${result?.safe || CCP_CTX.safe}`,
      idle: "authorize the Application for the Safe",
    },
    {
      name: "Credential",
      Icon: KeyRound,
      pass: ({ result }) =>
        `${result?.masked || "returned"} · masked at the source · never on disk`,
      reject: () => "no credential returned",
      idle: "return the account, masked",
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
        text: `webapp pod → ${CCP_HOST} (AIMWebService, mTLS)`,
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
        text: noCert
          ? "no client certificate presented — AIMWebService requires mTLS"
          : "AIMWebService authenticates the client certificate → Application",
      },
      {
        s: 2,
        kind: "comment",
        text: `authorizes Application '${appId}' for Safe ${safe}`,
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
            `  "Content": "${r.masked}"   // masked — full value never shown`,
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
    { k: "Trust domain", v: SWA_CTX.trustDomain, wide: true },
    { k: "Node group", v: SWA_CTX.nodeGroup },
    { k: "Attestor", v: SWA_CTX.attestor },
    { k: "Gateway", v: SWA_CTX.gateway, brand: true },
  ],
  stages: [
    { key: "request", label: "Request identity", verb: "Requesting identity" },
    { key: "attest", label: "Node attestation", verb: "Attesting node" },
    { key: "svid", label: "SVID issued", verb: "Issuing SVID" },
    { key: "mtls", label: "mTLS trust", verb: "Verifying trust" },
    {
      key: "authz",
      label: "Gateway authorization",
      verb: "Authorizing at gateway",
    },
    { key: "resource", label: "Resource access", verb: "Reading the database" },
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
      title: "Workload · this pod",
      stages: [0],
      doneAfter: 1,
      failsAt: [],
      tag: (s) => (s === "done" ? "requested" : "workload"),
      body: ({ result }) => (
        <>
          <Kv k="Workload" v={result?.spiffeId || SWA_WORKLOAD} />
          <span style={foot}>
            holds no stored credential — asks the Workload API for an SVID
          </span>
        </>
      ),
    },
    {
      key: "attest",
      title: "Node attestation · k8s_psat",
      stages: [1],
      doneAfter: 2,
      failsAt: [],
      tag: (s) => (s === "done" ? "node attested" : "attesting"),
      body: ({ state }) => (
        <>
          <div style={grid2}>
            <Kv
              k="Attestor"
              v="k8s_psat"
              vColor={state === "done" ? INK.ok : INK.mono}
            />
            <Kv k="Node group" v={SWA_CTX.nodeGroup} />
          </div>
          <span style={foot}>
            agent proves the node to the SWA server (projected SA token ·
            TokenReview)
          </span>
        </>
      ),
    },
    {
      key: "identity",
      title: "SWA identity · SVID",
      stages: [2],
      doneAfter: 3,
      failsAt: [2],
      tag: (s) =>
        s === "failed"
          ? "no identity"
          : s === "done"
            ? "SVID issued"
            : "issuing",
      body: ({ state, result }) =>
        state === "failed" ? (
          <span style={dangerNote}>
            no identity issued — workload attestation found no matching policy
          </span>
        ) : (
          <>
            <div style={grid2}>
              <Kv
                k="SPIFFE ID"
                v={result?.spiffeId || SWA_WORKLOAD}
                vColor={state === "done" ? INK.ok : INK.mono}
              />
              <Kv
                k="SVID"
                v={
                  result?.jwtAlg
                    ? `${result.jwtAlg} · short-lived`
                    : "jwt-svid · short-lived"
                }
              />
            </div>
            <span style={foot}>
              server attests the workload (ns/sa) · SVID minted by the trust
              domain
            </span>
          </>
        ),
    },
    {
      key: "gateway",
      title: "SPIFFE gateway",
      stages: [3, 4],
      doneAfter: 5,
      failsAt: [3, 4],
      tag: (s) =>
        s === "failed" ? "rejected" : s === "done" ? "authorized" : "verifying",
      body: ({ state, scenario, result }) =>
        state === "failed" ? (
          <span style={dangerNote}>
            {scenario === "foreign"
              ? "foreign trust domain — trust roots do not anchor it"
              : "SPIFFE ID not allow-listed at the gateway"}
          </span>
        ) : (
          <>
            <Kv
              k="mTLS"
              v="peer verified by SPIFFE ID"
              vColor={state === "done" ? INK.ok : INK.mono}
            />
            <span style={foot}>
              ghostunnel authorizes{" "}
              {result?.spiffeId ? "the SPIFFE ID" : "by SPIFFE ID"} before
              Postgres
            </span>
          </>
        ),
    },
    {
      key: "resource",
      title: "Postgres · shipments",
      stages: [5],
      doneAfter: 6,
      failsAt: [],
      tag: (s) => (s === "done" ? "rows returned" : ""),
      body: ({ state, result }) =>
        state === "done" ? (
          <Kv
            k="Result"
            v={`${result?.dbRows.length ?? 0} shipment rows · via the SPIFFE gateway`}
            vColor={INK.ok}
          />
        ) : (
          <span style={dimNote}>
            authorized by SPIFFE ID before the query runs
          </span>
        ),
    },
  ],
  layers: [
    {
      name: "Request identity",
      Icon: Send,
      pass: () => "workload called the Workload API for an SVID",
      reject: () => "could not reach the Workload API",
      idle: "call the SWA Agent Workload API",
    },
    {
      name: "Node attestation",
      Icon: Fingerprint,
      pass: () => "node attested · k8s_psat (projected SA token · TokenReview)",
      reject: () => "node attestation failed",
      idle: "attest the node identity (k8s_psat)",
    },
    {
      name: "SVID issued",
      Icon: BadgeCheck,
      pass: ({ result }) =>
        `SVID minted${result?.jwtAlg ? ` · ${result.jwtAlg}` : ""} · workload attested (ns/sa)`,
      reject: () => "no identity issued — no matching workload policy",
      idle: "attest the workload and mint a short-lived SVID",
    },
    {
      name: "mTLS trust",
      Icon: Lock,
      pass: () => "peer verified by SPIFFE ID · same trust domain",
      reject: () => "foreign trust domain — trust roots do not anchor it",
      idle: "verify the presented SVID at the gateway",
    },
    {
      name: "Gateway authorization",
      Icon: ShieldCheck,
      pass: () => `SPIFFE ID allow-listed at ${SWA_CTX.gateway}`,
      reject: () => "SPIFFE ID not allow-listed at the gateway",
      idle: "authorize the connection by SPIFFE ID",
    },
    {
      name: "Resource access",
      Icon: Database,
      pass: ({ result }) =>
        `${result?.dbRows.length ?? 0} rows · Postgres via the SPIFFE gateway`,
      reject: () => "no resource access",
      idle: "read the shipments database",
    },
  ],
  buildTrace: (scenario, r) => {
    const spiffe = r?.spiffeId || SWA_WORKLOAD;
    const lines: Line[] = [
      {
        s: 0,
        kind: "comment",
        text: "workload → SWA Agent Workload API (unix:///run/swa-agent/api.sock)",
      },
      { s: 0, kind: "cmd", text: "FetchJWTSVID(audience=swa-demo-audience)" },
      {
        s: 1,
        kind: "comment",
        text: "SWA Agent attests the node to the server · k8s_psat (projected SA token · TokenReview)",
      },
      {
        s: 2,
        kind: "comment",
        text: "server attests the workload (ns/sa selectors) and mints the SVID",
      },
      {
        s: 3,
        kind: "comment",
        text: `present SVID to ${SWA_CTX.gateway}.swa-data.svc · mutual TLS`,
      },
      {
        s: 4,
        kind: "comment",
        text: "ghostunnel authorizes by SPIFFE ID (allow-uri)",
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
    ? "401 · authn-jwt rejected — the JWT failed validation"
    : "401 · authn-iam rejected — AWS did not verify the signed request";

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
      { k: "Tenant", v: "swa-demo.secretsmgr.cyberark.cloud", wide: true },
      { k: "Authenticator", v: `${authn}/swa` },
      { k: "Variable", v: CONJUR_SECRET },
      { k: "Auth", v: authn, brand: true },
    ],
    stages: jwt
      ? [
          { key: "fetch", label: "Fetch JWT-SVID", verb: "Fetching JWT-SVID" },
          {
            key: "present",
            label: "Send to Secrets Manager",
            verb: "Sending to Secrets Manager",
          },
          {
            key: "verify",
            label: "Validate JWT",
            verb: "Validating JWT (JWKS + claims)",
          },
          {
            key: "token",
            label: "Access token",
            verb: "Granting scoped token",
          },
          {
            key: "read",
            label: "Retrieve secret",
            verb: "Reading the variable",
          },
        ]
      : [
          {
            key: "imds",
            label: "Instance profile",
            verb: "Fetching instance profile",
          },
          {
            key: "sign",
            label: "Sign STS identity",
            verb: "Signing STS identity",
          },
          {
            key: "present",
            label: "Send to Secrets Manager",
            verb: "Sending to Secrets Manager",
          },
          {
            key: "verify",
            label: "AWS verification",
            verb: "Verifying with AWS STS",
          },
          {
            key: "token",
            label: "Access token",
            verb: "Granting scoped token",
          },
          {
            key: "read",
            label: "Retrieve secret",
            verb: "Reading the variable",
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
            title: "Workload · JWT-SVID",
            stages: [0],
            doneAfter: 1,
            failsAt: [],
            tag: (s) => (s === "done" ? "identity" : "workload"),
            body: ({ result }) => (
              <>
                <Kv
                  k="SPIFFE ID (sub)"
                  v={result?.identity || result?.spiffeId || CONJUR_WORKLOAD}
                />
                <span style={foot}>
                  fetches a JWT-SVID from the SWA Workload API · aud=idira
                </span>
              </>
            ),
          },
          {
            key: "authn",
            title: "Secrets Manager · authn-jwt",
            stages: [1, 2],
            doneAfter: 3,
            failsAt: [1, 2],
            tag: (s) =>
              s === "failed"
                ? "authn deny"
                : s === "done"
                  ? "authenticated"
                  : "validating",
            body: ({ state }) =>
              state === "failed" ? (
                <span style={dangerNote}>{authnDenyNote}</span>
              ) : (
                <>
                  <Kv
                    k="Validated"
                    v="trust-domain JWKS + claims"
                    vColor={state === "done" ? INK.ok : INK.mono}
                  />
                  <span style={foot}>
                    Secrets Manager checks the JWT signature, issuer, and audience
                  </span>
                </>
              ),
          },
          {
            key: "token",
            title: "Access token · scoped",
            stages: [3],
            doneAfter: 4,
            failsAt: [],
            tag: (s) => (s === "done" ? "granted" : ""),
            body: ({ state, result }) => (
              <>
                <Kv
                  k="Scope"
                  v={result?.tokenScope || CONJUR_SECRET}
                  vColor={state === "done" ? INK.ok : INK.mono}
                />
                <span style={foot}>
                  short-lived · limited to specific variables by policy
                </span>
              </>
            ),
          },
          {
            key: "secret",
            title: "Secret · variable",
            stages: [4],
            doneAfter: 5,
            failsAt: [4],
            tag: (s) =>
              s === "failed" ? "authz deny" : s === "done" ? "returned" : "",
            body: ({ state, result }) =>
              state === "failed" ? (
                <span style={dangerNote}>
                  403 · token not authorized to read{" "}
                  {result?.secretName || "this variable"}
                </span>
              ) : state === "done" ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <Kv k="Variable" v={result?.secretName || CONJUR_SECRET} />
                  <Kv
                    k="Value (masked)"
                    v={result?.masked || "—"}
                    vColor={INK.ok}
                  />
                </div>
              ) : (
                <span style={dimNote}>
                  read the variable with the scoped token
                </span>
              ),
          },
        ]
      : [
          {
            key: "workload",
            title: "Workload · this pod",
            stages: [0],
            doneAfter: 1,
            failsAt: [],
            tag: (s) => (s === "done" ? "profile" : "workload"),
            body: ({ result }) => (
              <>
                <Kv k="Instance role" v={result?.identity || arn} />
                <span style={foot}>
                  asks the host (IMDS) for its instance-profile role
                </span>
              </>
            ),
          },
          {
            key: "sts",
            title: "AWS STS · signed identity",
            stages: [1],
            doneAfter: 2,
            failsAt: [],
            tag: (s) => (s === "done" ? "signed" : "signing"),
            body: ({ state, result }) => (
              <>
                <Kv
                  k="Caller ARN"
                  v={result?.identity || arn}
                  vColor={state === "done" ? INK.ok : INK.mono}
                />
                <span style={foot}>
                  signs sts:GetCallerIdentity with the role credentials
                </span>
              </>
            ),
          },
          {
            key: "authn",
            title: "Secrets Manager · authn-iam",
            stages: [2, 3],
            doneAfter: 4,
            failsAt: [2, 3],
            tag: (s) =>
              s === "failed"
                ? "authn deny"
                : s === "done"
                  ? "verified"
                  : "verifying",
            body: ({ state }) =>
              state === "failed" ? (
                <span style={dangerNote}>{authnDenyNote}</span>
              ) : (
                <>
                  <Kv
                    k="AWS verify"
                    v="replayed · ARN confirmed"
                    vColor={state === "done" ? INK.ok : INK.mono}
                  />
                  <span style={foot}>
                    Secrets Manager replays the signed request to AWS STS and maps the
                    ARN to a host
                  </span>
                </>
              ),
          },
          {
            key: "token",
            title: "Access token · scoped",
            stages: [4],
            doneAfter: 5,
            failsAt: [],
            tag: (s) => (s === "done" ? "granted" : ""),
            body: ({ state, result }) => (
              <>
                <Kv
                  k="Scope"
                  v={result?.tokenScope || CONJUR_SECRET}
                  vColor={state === "done" ? INK.ok : INK.mono}
                />
                <span style={foot}>
                  short-lived · limited to specific variables by policy
                </span>
              </>
            ),
          },
          {
            key: "secret",
            title: "Secret · variable",
            stages: [5],
            doneAfter: 6,
            failsAt: [5],
            tag: (s) =>
              s === "failed" ? "authz deny" : s === "done" ? "returned" : "",
            body: ({ state, result }) =>
              state === "failed" ? (
                <span style={dangerNote}>
                  403 · token not authorized to read{" "}
                  {result?.secretName || "this variable"}
                </span>
              ) : state === "done" ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <Kv k="Variable" v={result?.secretName || CONJUR_SECRET} />
                  <Kv
                    k="Value (masked)"
                    v={result?.masked || "—"}
                    vColor={INK.ok}
                  />
                </div>
              ) : (
                <span style={dimNote}>
                  read the variable with the scoped token
                </span>
              ),
          },
        ],
    layers: jwt
      ? [
          {
            name: "Fetch JWT-SVID",
            Icon: BadgeCheck,
            pass: () => "JWT-SVID fetched from the Workload API · aud=idira",
            reject: () => "could not obtain a JWT-SVID",
            idle: "fetch a JWT-SVID from SWA",
          },
          {
            name: "Send to Secrets Manager",
            Icon: Send,
            pass: () => "JWT presented to authn-jwt",
            reject: () => "could not reach Secrets Manager",
            idle: "present the JWT to Secrets Manager",
          },
          {
            name: "Validate JWT",
            Icon: ShieldCheck,
            pass: () => "JWKS + claims verified (issuer · audience · expiry)",
            reject: () => "401 · authn-jwt: the JWT failed validation",
            idle: "validate signature, issuer, and audience",
          },
          {
            name: "Access token",
            Icon: KeyRound,
            pass: ({ result }) =>
              `scoped token granted · ${result?.tokenScope || CONJUR_SECRET}`,
            reject: () => "no access token granted",
            idle: "receive a short-lived, scoped token",
          },
          {
            name: "Retrieve secret",
            Icon: Database,
            pass: ({ result }) =>
              `${result?.masked || "returned"} · ${result?.secretName || CONJUR_SECRET}`,
            reject: ({ result }) =>
              `403 · token not authorized to read ${result?.secretName || "this variable"}`,
            idle: "read the variable with the scoped token",
          },
        ]
      : [
          {
            name: "Instance profile",
            Icon: Server,
            pass: () => "instance-profile role obtained from IMDS",
            reject: () => "could not read instance metadata",
            idle: "fetch the instance-profile role (IMDS)",
          },
          {
            name: "Sign STS identity",
            Icon: Fingerprint,
            pass: () =>
              "sts:GetCallerIdentity signed with the role credentials",
            reject: () => "could not sign the STS request",
            idle: "sign an STS caller identity",
          },
          {
            name: "Send to Secrets Manager",
            Icon: Send,
            pass: () => "signed request presented to authn-iam",
            reject: () => "could not reach Secrets Manager",
            idle: "present the signed request to Secrets Manager",
          },
          {
            name: "AWS verification",
            Icon: Cloud,
            pass: () => "Secrets Manager replayed to AWS STS · caller ARN verified",
            reject: () => "401 · authn-iam: AWS rejected the signed request",
            idle: "Secrets Manager replays the request to AWS STS",
          },
          {
            name: "Access token",
            Icon: KeyRound,
            pass: ({ result }) =>
              `scoped token granted · ${result?.tokenScope || CONJUR_SECRET}`,
            reject: () => "no access token granted",
            idle: "receive a short-lived, scoped token",
          },
          {
            name: "Retrieve secret",
            Icon: Database,
            pass: ({ result }) =>
              `${result?.masked || "returned"} · ${result?.secretName || CONJUR_SECRET}`,
            reject: ({ result }) =>
              `403 · token not authorized to read ${result?.secretName || "this variable"}`,
            idle: "read the variable with the scoped token",
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
            { s: 0, kind: "comment", text: "workload → SWA Workload API" },
            { s: 0, kind: "cmd", text: "FetchJWTSVID(audience=idira)" },
            {
              s: 1,
              kind: "comment",
              text: "POST /authn-jwt/swa/idira/authenticate   (present the JWT-SVID)",
            },
            {
              s: 2,
              kind: "comment",
              text: "Secrets Manager validates the JWT against the trust-domain JWKS + claims (iss · aud · exp)",
            },
            {
              s: 3,
              kind: "comment",
              text: "Secrets Manager returns a short-lived access token (scoped to specific variables)",
            },
            readCmd,
          ]
        : [
            {
              s: 0,
              kind: "comment",
              text: "container → host instance metadata (IMDS v2)",
            },
            {
              s: 0,
              kind: "cmd",
              text: 'curl -s -H "X-aws-ec2-metadata-token: $TOK" http://169.254.169.254/latest/meta-data/iam/security-credentials/',
            },
            {
              s: 1,
              kind: "comment",
              text: "sign sts:GetCallerIdentity with the instance-profile role",
            },
            {
              s: 1,
              kind: "cmd",
              text: "aws sts get-caller-identity   # produces a SigV4-signed request",
            },
            {
              s: 2,
              kind: "comment",
              text: "POST /authn-iam/swa/idira/<host>/authenticate   (signed STS headers)",
            },
            {
              s: 3,
              kind: "comment",
              text: "Secrets Manager replays the signed request to AWS STS → AWS returns the verified caller ARN",
            },
            {
              s: 4,
              kind: "comment",
              text: "Secrets Manager returns a short-lived access token (scoped to specific variables)",
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
          text: `${secret} = ${r.masked}   // masked — full value never shown`,
          terminal: true,
        });
        lines.push({
          s: readStage,
          kind: "ok",
          text: "✓ retrieved · scoped token · secret masked at the source",
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
            ? "✗ authn-jwt failed — the JWT did not validate; no token was issued"
            : "✗ authn-iam failed — AWS rejected the signed request; no token was issued",
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
          text: "✗ denied — the scoped token is not authorized for this variable",
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
