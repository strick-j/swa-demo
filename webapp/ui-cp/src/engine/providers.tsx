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
  type LucideIcon,
} from "lucide-react";
import {
  INK,
  Kv,
  type ProviderResult,
  type CVS,
} from "../visualizations/common";

export type ScenarioKey =
  "authorized" | "invalid-hash" | "no-cert" | "denied" | "dual";

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
  id: "cp" | "ccp";
  apiPath: string;
  resultKey: "cp" | "ccp";
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

export const PROVIDERS: Record<"cp" | "ccp", Provider> = {
  cp: cpProvider,
  ccp: ccpProvider,
};

/** Pick the provider from the page path: /credential-providers → CCP, else CP. */
export function providerFromPath(pathname: string): Provider {
  return pathname.startsWith("/credential-providers")
    ? ccpProvider
    : cpProvider;
}

/** Scenario meta lookup with a safe fallback to the provider's first scenario. */
export function pmeta(p: Provider, k: ScenarioKey): ScenarioMeta {
  return p.scenarios[k] ?? p.scenarios[p.scenarioOrder[0]!]!;
}
