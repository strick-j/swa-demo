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
  brand: { name: "Credential Provider", sub: "Local AIM · host bridge" },
  heroTitle: "Retrieve a credential.",
  heroLede: (
    <>
      A trusted Java application asks a Credential Provider on the host for a
      Vault credential at request time. The Provider authenticates the calling
      application by its <strong>hash</strong> (plus OS user and path) — no
      stored password, no client certificate.
    </>
  ),
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
      label: "Expected success",
      tag: "expect ✓",
      ok: true,
      failStage: -1,
      desc: "A caller whose application hash IS registered on the App, reading a Safe it may access → the credential is returned.",
      evidence: [
        {
          lead: "Authenticated by application hash, not a key.",
          body: "The Credential Provider measured the calling jar's hash (plus OS user and path) and matched it to a registered Application — no client certificate, no stored password.",
        },
        {
          lead: "The full secret never left the host.",
          body: "The caller hashed the credential on the host; only a 6-char preview, its length, and SHA-256 crossed the bridge into the cluster.",
        },
        {
          lead: "Scoped to exactly one Safe/Object.",
          body: "The App is provisioned for PIN-SEC-DEMO only; every other Safe is denied at the authorization layer.",
        },
      ],
    },
    "invalid-hash": {
      key: "invalid-hash",
      label: "Expected authentication failure",
      tag: "authn deny",
      ok: false,
      failStage: 1,
      desc: "A DIFFERENT jar whose hash is NOT registered on the Application → the Credential Provider rejects it at the application-authentication layer.",
      evidence: [
        {
          lead: "The hash did not match a registered Application.",
          body: "The rogue jar has a different application hash (and install path). The provider logs APPAP133E — the calling application is unauthorized.",
        },
        {
          lead: "Rejected before any Safe was touched.",
          body: "Authentication failed first, so no Safe authorization was evaluated and no credential was returned.",
        },
        {
          lead: "This is the boundary working.",
          body: "Only the exact registered jar can retrieve. Recompiling or moving it changes the hash and is rejected — as designed.",
        },
      ],
    },
    denied: {
      key: "denied",
      label: "Expected authorization failure",
      tag: "authz deny",
      ok: false,
      failStage: 3,
      desc: "A registered caller, but a Safe this Application is NOT permitted to read → the Credential Provider denies it at the authorization layer.",
      evidence: [
        {
          lead: "Authentication passed, authorization did not.",
          body: "The caller's hash/OS-user/path matched a registered Application, but that App is not a member of the requested Safe.",
        },
        {
          lead: "Least privilege at the Safe boundary.",
          body: "Being a valid application is not enough — the App must also be granted the specific Safe. It was not, so the request was refused.",
        },
        {
          lead: "No credential crossed the bridge.",
          body: "The denial happened in the vault; nothing was returned to the caller or the cluster.",
        },
      ],
    },
    dual: {
      key: "dual",
      label: "Dual account · expected success",
      tag: "expect ✓",
      ok: true,
      failStage: -1,
      desc: "A registered caller queries a dual-account pair → the Credential Provider returns whichever account is ACTIVE. On rotation the other goes active — zero downtime, no app change.",
      evidence: [
        {
          lead: "Zero-downtime rotation, resolved for you.",
          body: "The query fronts a dual-account pair by virtual username; the provider returns whichever account is currently active.",
        },
        {
          lead: "The app never changes.",
          body: "When the active account rotates to its partner, the same query resolves to the new active account — no code or config change.",
        },
        {
          lead: "Still hashed on the host.",
          body: "As with every CP retrieval, only the preview + length + SHA-256 of the active account's secret cross the bridge.",
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
        text: "Credential Provider measures the calling application (hash + path)",
      },
      {
        s: 2,
        kind: "comment",
        text: `checks OS user (${r?.osUser || "svc-app"}) and executable path`,
      },
      {
        s: 3,
        kind: "comment",
        text: `Vault: is Application '${appId}' authorized for Safe ${safe}?`,
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
    sub: "AIMWebService · client cert",
  },
  heroTitle: "Retrieve via REST.",
  heroLede: (
    <>
      The app authenticates to the Central Credential Provider with a{" "}
      <strong>client certificate</strong> (mTLS) and fetches a credential over
      REST — no Vault password or API key stored on the workload.
    </>
  ),
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
      label: "Expected success",
      tag: "expect ✓",
      ok: true,
      failStage: -1,
      desc: "Valid client certificate, and a Safe this Application IS permitted to read → the credential is returned over REST.",
      evidence: [
        {
          lead: "Authenticated by certificate, not a key.",
          body: "The app proved its identity with a client certificate mapped to a registered Application — no static API key or Vault password on the workload.",
        },
        {
          lead: "Masked at the source.",
          body: "Only a short preview + hash is shown; the full credential is never logged or written to disk.",
        },
        {
          lead: "Scoped to exactly one Safe/Object.",
          body: "The App is provisioned for PIN-SEC-DEMO only; every other Safe is denied at the authorization layer.",
        },
      ],
    },
    "no-cert": {
      key: "no-cert",
      label: "No certificate · expected authn failure",
      tag: "authn deny",
      ok: false,
      failStage: 1,
      desc: "The app connects WITHOUT a client certificate → AIMWebService rejects it at the authentication layer (this denial is the point).",
      evidence: [
        {
          lead: "No client certificate, no identity.",
          body: "AIMWebService requires mutual TLS. Without a client certificate there is no Application to authenticate — APPAP227E.",
        },
        {
          lead: "Rejected before any Safe was touched.",
          body: "Authentication failed at the door; no Safe authorization was evaluated and no credential was returned.",
        },
        {
          lead: "This is the boundary working.",
          body: "Require SSL + client certificates on the AIMWebService site is exactly what turns an anonymous call away.",
        },
      ],
    },
    denied: {
      key: "denied",
      label: "Denied safe · expected authz failure",
      tag: "authz deny",
      ok: false,
      failStage: 2,
      desc: "Valid client certificate, but a Safe this Application is NOT permitted to read → AIMWebService denies it at the authorization layer.",
      evidence: [
        {
          lead: "Authentication passed, authorization did not.",
          body: "The certificate mapped to a registered Application, but that App is not a member of the requested Safe.",
        },
        {
          lead: "Least privilege at the Safe boundary.",
          body: "A valid certificate is not enough — the Application must also be granted the specific Safe. It was not, so the request was refused (APPAP004E).",
        },
        {
          lead: "No credential returned.",
          body: "The denial happened server-side; nothing crossed back to the workload.",
        },
      ],
    },
    dual: {
      key: "dual",
      label: "Dual account · expected success",
      tag: "expect ✓",
      ok: true,
      failStage: -1,
      desc: "Query a dual-account pair by custom property → AIMWebService returns whichever account is ACTIVE. On rotation the other goes active — zero downtime, no app change.",
      evidence: [
        {
          lead: "Zero-downtime rotation, resolved for you.",
          body: "The query fronts a dual-account pair by virtual username; AIMWebService returns whichever account is currently active.",
        },
        {
          lead: "The app never changes.",
          body: "When the active account rotates to its partner, the same query resolves to the new active account — no code or config change.",
        },
        {
          lead: "Still masked at the source.",
          body: "As with every CCP retrieval, only the preview + hash of the active account's secret is shown.",
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
  brand: { name: "Secure Workload Access", sub: "SPIFFE workload identity" },
  heroTitle: "Reach the database by identity.",
  heroLede: (
    <>
      This workload stores <strong>no credential</strong>. It proves who it is
      with a short-lived SPIFFE SVID; the gateway authorizes by{" "}
      <strong>SPIFFE ID</strong> before Postgres is ever reached.
    </>
  ),
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
      label: "Trusted workload",
      tag: "expect ✓",
      ok: true,
      failStage: -1,
      desc: "Issued a valid SVID, passes mTLS, and its SPIFFE ID is allow-listed at the gateway → it reads the shipments database.",
      evidence: [
        {
          lead: "Cryptographic identity, not a key.",
          body: "The workload proved who it is with a short-lived SPIFFE SVID issued by the trust domain — no static API key or password anywhere.",
        },
        {
          lead: "Authorized by SPIFFE ID at the gateway.",
          body: "ghostunnel allow-lists the exact SPIFFE ID before the connection reaches Postgres; identity is the authorization.",
        },
        {
          lead: "Nothing stored, nothing to leak.",
          body: "The SVID is ephemeral and rotates; there is no credential on disk to steal or rotate manually.",
        },
      ],
    },
    untrusted: {
      key: "untrusted",
      label: "Untrusted workload",
      tag: "authz deny",
      ok: false,
      failStage: 4,
      desc: "Holds a valid SVID, but its SPIFFE ID is NOT allow-listed at the gateway → rejected during the mTLS handshake, before Postgres.",
      evidence: [
        {
          lead: "Valid identity, not authorized.",
          body: "The workload has a genuine SVID from the same trust domain — but the gateway's allow-list does not include its SPIFFE ID.",
        },
        {
          lead: "Authorization is on the identity.",
          body: "Same CA, valid certificate — the gateway rejects the handshake purely because the SPIFFE ID is not permitted.",
        },
        {
          lead: "No data crossed the wire.",
          body: "The connection was refused at the gateway; Postgres was never reached.",
        },
      ],
    },
    unknown: {
      key: "unknown",
      label: "Unknown workload",
      tag: "no identity",
      ok: false,
      failStage: 2,
      desc: "The node attests, but no registration policy matches this workload → the SWA server refuses to issue an SVID. With no identity, it cannot even attempt the resource.",
      evidence: [
        {
          lead: "No policy, no identity.",
          body: "The SWA server has no node-group selector matching this workload, so it declines to mint an SVID at all.",
        },
        {
          lead: "Failure is the default.",
          body: "Without an SVID there is nothing to present at the gateway — the request never leaves the starting line.",
        },
        {
          lead: "Explicit allow-listing.",
          body: "Only workloads whose ns/sa match a registration entry receive an identity — everything else is unknown by design.",
        },
      ],
    },
    foreign: {
      key: "foreign",
      label: "Foreign trust domain",
      tag: "trust boundary",
      ok: false,
      failStage: 3,
      desc: "A workload from a foreign trust domain (acme.courier) presents a self-signed identity → rejected at the mTLS trust boundary; no federation is configured.",
      evidence: [
        {
          lead: "Signed by a CA you don't anchor.",
          body: "The peer presented a valid certificate — just from a foreign trust domain. Without federation, your trust roots don't anchor it.",
        },
        {
          lead: "Rejected before any data moved.",
          body: "The mTLS handshake failed at the door; no SVID exchange, no gateway authorization, no database access.",
        },
        {
          lead: "This is the boundary working.",
          body: "acme.courier still has its own identity — your trust roots simply do not anchor it. SWA trust-domain federation would resolve this.",
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
      name: jwt ? "Open Standard · JWT" : "Native Platform · AWS STS",
      sub: "Idira Secrets Manager",
    },
    heroTitle: "Fetch a scoped secret.",
    heroLede: jwt ? (
      <>
        The workload presents a <strong>JWT-SVID</strong> to Secrets Manager (authn-jwt).
        Secrets Manager validates it against the trust-domain JWKS, returns a{" "}
        <strong>short-lived, scoped</strong> access token, and the app reads a
        variable — no stored API key.
      </>
    ) : (
      <>
        The workload signs an <strong>sts:GetCallerIdentity</strong> with its
        instance-profile role (via IMDS). Secrets Manager replays it to AWS (authn-iam),
        verifies the ARN, and returns a <strong>short-lived, scoped</strong>{" "}
        access token — no static AWS secret, no API key.
      </>
    ),
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
        label: "Authorized retrieval",
        tag: "expect ✓",
        ok: true,
        failStage: -1,
        desc: jwt
          ? "Present a JWT-SVID → Secrets Manager authenticates it (authn-jwt), grants a scoped token, and the app reads the in-scope variable."
          : "Sign an STS caller identity → Secrets Manager verifies the ARN (authn-iam), grants a scoped token, and the app reads the in-scope variable.",
        evidence: [
          {
            lead: "Workload-native identity, no key.",
            body: jwt
              ? "The app authenticated with a JWT-SVID from SWA — no static API key and no long-lived credential."
              : "The app authenticated with a signed sts:GetCallerIdentity from its instance-profile role — no static AWS secret, no Secrets Manager API key.",
          },
          {
            lead: "Short-lived, scoped token.",
            body: "Secrets Manager returned an access token scoped to a limited set of variables; it expires quickly and is held only in memory.",
          },
          {
            lead: "Masked at the source.",
            body: "Only a short preview + hash is shown; the full secret is never logged or written to disk.",
          },
        ],
      },
      invalid: {
        key: "invalid",
        label: "Invalid credential · expected authn deny",
        tag: "authn deny",
        ok: false,
        failStage: authnFail,
        desc: jwt
          ? "Present an invalid or expired JWT (bad signature / wrong audience / expired) → Secrets Manager's authn-jwt validation rejects it before any token is issued."
          : "Present a tampered or expired STS request (or an ARN mapped to no host) → Secrets Manager replays it to AWS, AWS rejects it, and authn-iam fails before any token is issued.",
        evidence: [
          {
            lead: jwt
              ? "The token failed validation."
              : "AWS didn't verify the request.",
            body: jwt
              ? "Secrets Manager checked the JWT against the trust-domain JWKS and required claims (issuer, audience, expiry) — it did not pass."
              : "Secrets Manager replayed the sts:GetCallerIdentity to AWS; AWS rejected it (bad or expired signature), or the verified ARN maps to no Secrets Manager host.",
          },
          {
            lead: "No token, no secret.",
            body: "Authentication failed before any access token was issued — nothing was authorized and nothing was read.",
          },
          {
            lead: jwt
              ? "Signatures, not secrets."
              : "Verified, not trusted blindly.",
            body: jwt
              ? "A forged or expired JWT can't be minted without the trust domain's signing key — the boundary holds."
              : "Secrets Manager doesn't take the caller's word for it; it re-verifies the identity with AWS on every request.",
          },
        ],
      },
      denied: {
        key: "denied",
        label: "Out of scope · expected authz deny",
        tag: "authz deny",
        ok: false,
        failStage: readStage,
        desc: "Authentication succeeds and a scoped token is granted — but the token is NOT authorized to read a variable outside its scope → Secrets Manager refuses the read (403).",
        evidence: [
          {
            lead: "The token is scoped.",
            body: "The access token may only read the variables its Secrets Manager policy grants — this one is outside that set.",
          },
          {
            lead: "Least privilege by policy.",
            body: "Even a valid identity and token cannot read arbitrary secrets; the token is scoped to specific variables by policy.",
          },
          {
            lead: "No secret returned.",
            body: "The read was refused (403 Forbidden); nothing crossed back to the workload.",
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
