// cp.ts -- static domain model for the Credential Provider inspector. The five
// stages of a local CP retrieval, the four use-case scenarios (with the stage
// each is expected to fail at), the trust context shown in the inspector chrome,
// and the per-scenario evidence copy for the left pane.

export type ScenarioKey = "authorized" | "invalid-hash" | "denied" | "dual";

export interface Stage {
  key: string;
  n: number;
  label: string;
  verb: string;
  node: "app" | "provider" | "vault" | "credential";
  detail: string;
  line: string;
}

export interface EvidenceItem {
  lead: string;
  body: string;
}

export interface ScenarioMeta {
  key: ScenarioKey;
  label: string;
  tag: string;
  ok: boolean; // expected to succeed
  // Index into CP.stages the scenario is expected to fail at (-1 = succeeds).
  failStage: number;
  desc: string;
  evidence: EvidenceItem[];
}

export const CP = {
  // Trust context bar (four cells in the inspector chrome).
  ctx: {
    application: "cp-demo-app",
    provider: "Prov_SWADEMOHOST",
    safe: "PIN-SEC-DEMO",
    auth: "hash · os-user · path",
  },
  vault: "Privilege Cloud",

  // The five animated stages of a successful retrieval. `node` groups stages
  // onto the four topology cards (the provider card spans hash + os-user).
  stages: [
    {
      key: "invoke",
      n: 1,
      label: "Invoke caller",
      verb: "Invoking caller",
      node: "app",
      detail: "trusted JAR",
      line: "host cp-bridge runs the registered Java caller (cp-caller.jar)",
    },
    {
      key: "hash",
      n: 2,
      label: "Application hash",
      verb: "Measuring application hash",
      node: "provider",
      detail: "AIM provider",
      line: "Credential Provider measures the caller's application hash",
    },
    {
      key: "osuser",
      n: 3,
      label: "OS user / path",
      verb: "Checking OS user and path",
      node: "provider",
      detail: "os-user · path",
      line: "OS user and executable path checked against the Application",
    },
    {
      key: "authz",
      n: 4,
      label: "Safe authorization",
      verb: "Authorizing safe",
      node: "vault",
      detail: "app permission",
      line: "Vault authorizes the Application for the requested Safe",
    },
    {
      key: "return",
      n: 5,
      label: "Credential returned",
      verb: "Returning credential",
      node: "credential",
      detail: "masked on host",
      line: "account returned; secret hashed on host — only the preview crosses the bridge",
    },
  ] as Stage[],

  // Four didactic use cases. failStage indexes CP.stages.
  scenarios: {
    "authorized": {
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
          body: "Authentication failed first, so no Safe authorization was even evaluated and no credential was returned.",
        },
        {
          lead: "This is the boundary working.",
          body: "Only the exact registered jar can retrieve. Recompiling or moving it changes the hash and is rejected — as designed.",
        },
      ],
    },
    "denied": {
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
    "dual": {
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
          body: "When the active account rotates to its partner, the same query resolves to the new active account — no code or config change in the workload.",
        },
        {
          lead: "Still hashed on the host.",
          body: "As with every CP retrieval, only the preview + length + SHA-256 of the active account's secret cross the bridge.",
        },
      ],
    },
  } as Record<ScenarioKey, ScenarioMeta>,

  scenarioOrder: ["authorized", "invalid-hash", "denied", "dual"] as ScenarioKey[],
} as const;
