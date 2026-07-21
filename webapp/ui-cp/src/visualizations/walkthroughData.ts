// walkthroughData -- content + geometry for the "Learn how it works" step-through
// animations shown in the inspector. Fully data-driven: each flow carries its own
// nodes (cards + container rings), connector geometry, and steps, so one generic
// renderer (Walkthrough.tsx) serves every walkthrough.
//
// A provider can expose SEVERAL flows (e.g. Retrieval + Rotation); the walkthrough
// header shows a selector to switch between them — the same slot a future flow
// (e.g. Dual control) would drop into.
//
// Authored English-only and deliberately kept OUT of the parity-checked i18n
// catalogs (see src/i18n/parity.test.ts). Only the small "Learn how it works"
// trigger label is localized.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A diagram element: a `card` (filled, focusable) or a `container` (labelled
 *  ring that groups cards). Positions are in % of the diagram canvas. */
export interface WNode {
  key: string;
  title: string;
  sub?: string;
  box: Box;
  kind?: "card" | "container";
}

/** Fixed connector geometry (svg path + label anchor + arrow head), % coords. */
export interface WLinkDef {
  id: string;
  d: string;
  label: { x: number; y: number };
  head: { x: number; y: number };
}

/** A connector activated during a step. */
export interface WLink {
  id: string;
  label?: string;
  tone?: "brand" | "ok";
}

/** Per-node detail rendered inside a card for a given step. */
export interface WDetail {
  lines?: string[];
  ok?: boolean;
  rows?: { k: string; v: string }[];
}

export interface WStep {
  title: string;
  body: string;
  /** Node keys (cards and/or containers) drawn lit this step. */
  focus?: string[];
  /** Connectors animated this step. */
  links?: WLink[];
  /** Node key -> inline detail (mono lines / check rows) for this step. */
  detail?: Record<string, WDetail>;
  /** Node keys under which to render the credential/token chip this step. */
  chips?: string[];
  /** Optional badge on the step header, e.g. "Background". */
  badge?: string;
}

export interface FlowConfig {
  /** Stable id for this flow within a provider. */
  key: string;
  /** Short label shown in the flow selector. */
  navLabel: string;
  eyebrow: string;
  title: string;
  lede: string;
  nodes: WNode[];
  links: WLinkDef[];
  /** Credential/token chip segments (rendered where a step lists a chip node). */
  chip?: string[];
  /** Canvas height in px (default 360). CP/CCP use a taller canvas. */
  canvasHeight?: number;
  steps: WStep[];
  features?: { title: string; body: string }[];
}

/* =========================================================================
   Secrets Manager family (authn-jwt / authn-iam) — shared geometry
   ========================================================================= */

const SM = {
  idp: { left: 2, top: 10, width: 18, height: 18 },
  workload: { left: 2, top: 48, width: 18, height: 18 },
  manager: { left: 36, top: 6, width: 30, height: 86 },
  validator: { left: 39, top: 13, width: 24, height: 23 },
  policy: { left: 39, top: 40, width: 24, height: 23 },
  vault: { left: 39, top: 66, width: 24, height: 23 },
  privcloud: { left: 70, top: 58, width: 28, height: 32 },
  privvault: { left: 73, top: 66, width: 22, height: 20 },
} as const;

const SM_LINKS: WLinkDef[] = [
  { id: "idp_to_workload", d: "M13,28 C20,33 20,43 13,48", label: { x: 24, y: 38 }, head: { x: 13, y: 48 } },
  { id: "workload_to_manager", d: "M20,54 C27,50 31,42 36,38", label: { x: 28, y: 43 }, head: { x: 36, y: 38 } },
  { id: "manager_to_idp", d: "M36,18 C30,18 26,19 20,20", label: { x: 28, y: 14 }, head: { x: 20, y: 20 } },
  { id: "manager_to_workload", d: "M36,52 C29,56 25,58 20,59", label: { x: 28, y: 57 }, head: { x: 20, y: 59 } },
  { id: "policy_to_vault", d: "M51,63 L51,66", label: { x: 57, y: 64 }, head: { x: 51, y: 66 } },
  { id: "vault_to_workload", d: "M39,82 C31,92 25,84 20,63", label: { x: 29, y: 86 }, head: { x: 20, y: 63 } },
  { id: "privvault_to_vault", d: "M73,76 C69,76 66,77 63,77", label: { x: 68, y: 71 }, head: { x: 63, y: 77 } },
];

function smNodes(o: {
  idpTitle: string;
  idpSub: string;
  validatorSub: string;
  policySub: string;
  workloadSub: string;
}): WNode[] {
  return [
    { key: "idp", title: o.idpTitle, sub: o.idpSub, box: SM.idp },
    { key: "workload", title: "Workload", sub: o.workloadSub, box: SM.workload },
    { key: "manager", kind: "container", title: "Idira Secrets Manager", box: SM.manager },
    { key: "validator", title: "JWT Validator", sub: o.validatorSub, box: SM.validator },
    { key: "policy", title: "Policy Engine", sub: o.policySub, box: SM.policy },
    { key: "vault", title: "Secrets Vault", sub: "secret values", box: SM.vault },
    { key: "privcloud", kind: "container", title: "Idira Privilege Cloud", box: SM.privcloud },
    { key: "privvault", title: "Privilege Cloud Safe", sub: "synced secrets", box: SM.privvault },
  ];
}

const jwtFlow: FlowConfig = {
  key: "authn-jwt",
  navLabel: "JWT auth",
  eyebrow: "JWT Authenticator",
  title: "How JWT Authentication Works",
  lede: "From workload identity to secret retrieval — how a workload obtains a short-lived JWT-SVID from Secure Workload Access and uses it to authenticate to the Idira Secrets Manager (authn-jwt), without any stored credentials.",
  nodes: smNodes({
    idpTitle: "Secure Workload Access",
    idpSub: "SPIFFE · JWT-SVID issuer",
    validatorSub: "JWKS · signature · claims",
    policySub: "SPIFFE ID · host mapping",
    workloadSub: "app container",
  }),
  links: SM_LINKS,
  chip: ["header", "payload", "sig"],
  steps: [
    {
      title: "The JWT Authenticator — Actors Overview",
      body: "The Workload holds no stored credential. It obtains a short-lived JWT-SVID from Secure Workload Access (SWA), then presents it to the Idira Secrets Manager (authn-jwt) — which houses the JWT Validator, the Policy Engine, and its own Secrets Vault. Secrets Manager validates the token against the SWA trust-domain JWKS. Vault secrets are created there directly or synchronized from an Idira Privilege Cloud safe.",
      focus: ["workload", "idp", "manager", "validator", "policy", "vault", "privcloud", "privvault"],
    },
    {
      title: "Workload Requests a JWT-SVID from SWA",
      body: "The app opens the SWA Agent Workload API over its local Unix socket and requests a JWT-SVID for audience conjur. It asserts no identity and stores no credential — its identity will be observed by the agent, not presented. (Generically the token could come from any OIDC/JWKS issuer such as the K8s API server; in this demo it comes from SWA.)",
      focus: ["workload", "idp"],
    },
    {
      title: "SWA Attests the Workload & Issues the JWT-SVID",
      body: "SWA identifies the calling pod from its Kubernetes runtime attributes (namespace, service account) and verifies its node identity against node-group policy. It then mints a short-lived JWT-SVID for the workload's SPIFFE ID — sub=spiffe://swa-demo.example.com/…/sa/swa-demo-webapp, aud=conjur, iss=https://swa-demo.example.com — signed by the trust-domain key. It expires in minutes and is never written to disk.",
      focus: ["idp", "workload"],
      links: [{ id: "idp_to_workload", label: "JWT-SVID", tone: "brand" }],
      chips: ["workload"],
    },
    {
      title: "Workload Presents the JWT-SVID to Secrets Manager",
      body: "The app presents the JWT-SVID to the authn-jwt endpoint: POST /api/authn-jwt/swa/conjur/authenticate with the URL-encoded token. No password, no API key, no Conjur credential — the SVID is the proof of identity.",
      focus: ["workload", "manager"],
      links: [{ id: "workload_to_manager", label: "present svid", tone: "brand" }],
      chips: ["workload"],
    },
    {
      title: "Secrets Manager Validates Against the SWA Trust-Domain JWKS",
      body: "Secrets Manager fetches the JWKS from the configured issuer — the SWA trust domain — and cryptographically verifies the SVID signature, then checks the standard claims: iss (matches the configured issuer), aud (conjur), and exp (not expired). A forged, expired, or wrong-audience token fails here.",
      focus: ["manager", "validator", "idp"],
      links: [{ id: "manager_to_idp", label: "JWKS", tone: "brand" }],
      detail: { validator: { lines: ["trust-domain JWKS", "iss · aud · exp ✓", "RS256 verified"], ok: true } },
      chips: ["workload"],
    },
    {
      title: "Identity Resolved — SPIFFE ID Mapped to a Host",
      body: "Secrets Manager reads the token-app-property claim (sub) and maps the SPIFFE ID to a Conjur host, then verifies the host's annotations. Only a workload whose SVID carries this exact identity is authorized.",
      focus: ["manager", "policy"],
      detail: { policy: { rows: [{ k: "trust-domain", v: "swa-demo.example.com" }, { k: "workload", v: "sa/swa-demo-webapp" }] } },
      chips: ["workload"],
    },
    {
      title: "Short-Lived Access Token Issued",
      body: "Authentication succeeds. Secrets Manager returns a short-lived access token bound to that host's permissions — valid for minutes. The JWT-SVID is never stored or forwarded.",
      focus: ["manager", "workload"],
      links: [{ id: "manager_to_workload", label: "access token", tone: "brand" }],
      chips: ["workload"],
    },
    {
      title: "Secret Retrieved — Flow Complete",
      body: 'The workload reads the variable with the access token: GET /api/secrets/conjur/variable/data/secrets/demo-db-password with Authorization: Token token="…". The Policy Engine authorizes the request and the Secrets Vault returns the value — created in the vault directly or synchronized from an Idira Privilege Cloud safe — masked immediately, never written to disk.',
      focus: ["workload", "policy", "vault", "privcloud", "privvault"],
      links: [
        { id: "privvault_to_vault", label: "sync", tone: "brand" },
        { id: "policy_to_vault", label: "authorize", tone: "brand" },
        { id: "vault_to_workload", label: "secret", tone: "ok" },
      ],
      chips: ["workload"],
    },
  ],
  features: [
    { title: "Zero Stored Credentials", body: "The workload holds no Conjur API key and no static secret. Its only credential is a short-lived JWT-SVID issued on demand by Secure Workload Access — if the pod is compromised, there is nothing durable to steal." },
    { title: "Attested, Cryptographic Identity", body: "SWA doesn't take the workload's word for it — it attests the pod from Kubernetes runtime attributes, then signs the SVID with the trust-domain key. Secrets Manager verifies that signature against the published JWKS before trusting any claim." },
    { title: "Policy as Code", body: "Every SPIFFE-ID-to-host mapping is declared in Secrets Manager policy and version-controlled. Change the policy to grant or revoke access — no credential rotation needed." },
  ],
};

const iamFlow: FlowConfig = {
  key: "authn-iam",
  navLabel: "IAM auth",
  eyebrow: "IAM Authenticator",
  title: "How IAM Authentication Works",
  lede: "From instance-profile role to secret retrieval — how AWS workloads authenticate to the Idira Secrets Manager using a signed sts:GetCallerIdentity, with no stored AWS secret.",
  nodes: smNodes({
    idpTitle: "AWS STS",
    idpSub: "IMDS · GetCallerIdentity",
    validatorSub: "signed request · ARN",
    policySub: "identity · annotations",
    workloadSub: "EC2 / app container",
  }),
  links: SM_LINKS,
  chip: ["akid", "sig"],
  steps: [
    {
      title: "The IAM Authenticator — Actors Overview",
      body: "The Workload (an app on an EC2 instance or IRSA-enabled pod) authenticates to the Idira Secrets Manager, which houses the STS Verifier, the Policy Engine, and its own Secrets Vault. AWS STS validates the caller's signed identity via the instance metadata service. Secrets in the vault are created there directly or synchronized from an Idira Privilege Cloud safe.",
      focus: ["workload", "idp", "manager", "validator", "policy", "vault", "privcloud", "privvault"],
    },
    {
      title: "Workload Reads Role Credentials from IMDS",
      body: "The workload has no stored AWS secret. It queries the instance metadata service (IMDS) at 169.254.169.254 for the temporary credentials of its instance-profile role — an access key, secret key, and session token that AWS rotates automatically.",
      focus: ["idp", "workload"],
      links: [{ id: "idp_to_workload", label: "role creds", tone: "brand" }],
      chips: ["workload"],
    },
    {
      title: "Workload Signs an sts:GetCallerIdentity",
      body: "Using those role credentials, the workload builds and SigV4-signs an sts:GetCallerIdentity request. The signature proves the caller controls the role — without ever revealing the secret key. Nothing is called yet; the signed request itself is the credential.",
      focus: ["workload"],
      chips: ["workload"],
    },
    {
      title: "Workload POSTs the Signed Request",
      body: "The workload sends the pre-signed request to the authn-iam endpoint: POST /api/authn-iam/swa/conjur/authenticate. The body contains only the signed STS request — no AWS secret key ever leaves the instance.",
      focus: ["workload", "manager"],
      links: [{ id: "workload_to_manager", label: "signed req", tone: "brand" }],
      chips: ["workload"],
    },
    {
      title: "Secrets Manager Replays to AWS STS",
      body: "Secrets Manager forwards the signed request to AWS STS exactly as received. AWS validates the SigV4 signature and returns the caller's identity — the assumed-role ARN (arn:aws:sts::123456789012:assumed-role/swa-demo-host/i-0abc123). Secrets Manager never sees or stores AWS credentials.",
      focus: ["manager", "validator", "idp"],
      links: [{ id: "manager_to_idp", label: "replay", tone: "brand" }],
      detail: { validator: { lines: ["sts:GetCallerIdentity", "SigV4 verify", "caller ARN"] } },
    },
    {
      title: "Identity Resolved — ARN Annotations Matched",
      body: "Secrets Manager matches the returned ARN against the mapped Conjur host (e.g. data/aws/demo-webapp) and verifies its annotations. Every annotation is a mandatory constraint.",
      focus: ["manager", "policy"],
      detail: { policy: { rows: [{ k: "account-id", v: "123456789012" }, { k: "role-name", v: "swa-demo-host" }] } },
    },
    {
      title: "Short-Lived API Token Issued",
      body: "Authentication succeeds. Secrets Manager issues a short-lived, scoped API token — valid for roughly 8 minutes. It proves the workload's authenticated identity to the Secrets Vault. No AWS credential is stored or forwarded.",
      focus: ["manager", "workload"],
      links: [{ id: "manager_to_workload", label: "api-token", tone: "brand" }],
      chips: ["workload"],
    },
    {
      title: "Secret Retrieved — Flow Complete",
      body: 'The workload uses the API token to fetch secrets: GET /api/secrets/conjur/variable/… with Authorization: Token token="…". The Policy Engine authorizes the request and the Secrets Vault returns the value — created in the vault directly or synchronized from an Idira Privilege Cloud safe — masked immediately, never written to disk.',
      focus: ["workload", "policy", "vault", "privcloud", "privvault"],
      links: [
        { id: "privvault_to_vault", label: "sync", tone: "brand" },
        { id: "policy_to_vault", label: "authorize", tone: "brand" },
        { id: "vault_to_workload", label: "secret", tone: "ok" },
      ],
      chips: ["workload"],
    },
  ],
  features: [
    { title: "Zero Stored Credentials", body: "The workload authenticates with the temporary role credentials AWS already rotates via IMDS — signed, never sent. No static AWS access keys live in the cluster, an image, or a CI variable." },
    { title: "Verified by AWS", body: "Secrets Manager doesn't take the caller's word for it — it replays the signed request to AWS STS, which cryptographically verifies the SigV4 signature and returns the true assumed-role ARN. Identity cannot be spoofed." },
    { title: "Policy as Code", body: "Every ARN-to-identity mapping is declared in Secrets Manager policy YAML and version-controlled. Annotations pin the exact account and role required. Grant or revoke access by changing policy — no credential rotation needed." },
  ],
};

/* =========================================================================
   Central Credential Provider (CCP) — REST / mTLS, cached, Privilege Cloud
   ========================================================================= */

const CCP = {
  app: { left: 2, top: 24, width: 20, height: 22 },
  ccp: { left: 30, top: 16, width: 30, height: 32 },
  cache: { left: 33, top: 27, width: 24, height: 17 },
  privcloud: { left: 70, top: 10, width: 28, height: 62 },
  safe: { left: 73, top: 18, width: 22, height: 20 },
  cpm: { left: 73, top: 46, width: 22, height: 22 },
  target: { left: 30, top: 76, width: 30, height: 18 },
} as const;

const CCP_NODES: WNode[] = [
  { key: "app", title: "Application", sub: "REST client · mTLS", box: CCP.app },
  { key: "ccp", kind: "container", title: "Central Credential Provider", box: CCP.ccp },
  { key: "cache", title: "Local Credential / Policy Cache", sub: "policy + credentials", box: CCP.cache },
  { key: "privcloud", kind: "container", title: "Idira Privilege Cloud", box: CCP.privcloud },
  { key: "safe", title: "Privilege Cloud Safe", sub: "secret values", box: CCP.safe },
  { key: "cpm", title: "Central Policy Mgr / SRS", sub: "rotation service", box: CCP.cpm },
  { key: "target", title: "Target", sub: "server · database · service", box: CCP.target },
];

const CCP_LINKS: WLinkDef[] = [
  { id: "app_to_ccp", d: "M22,30 C25,30 27,30 30,30", label: { x: 26, y: 26 }, head: { x: 30, y: 30 } },
  { id: "ccp_to_app", d: "M30,40 C27,40 25,40 22,40", label: { x: 26, y: 44 }, head: { x: 22, y: 40 } },
  { id: "ccp_to_pc", d: "M60,30 C64,29 67,28 70,28", label: { x: 65, y: 25 }, head: { x: 70, y: 28 } },
  { id: "pc_to_ccp", d: "M70,40 C67,40 64,40 60,40", label: { x: 65, y: 44 }, head: { x: 60, y: 40 } },
  { id: "app_to_target", d: "M12,46 C12,82 18,85 30,85", label: { x: 14, y: 68 }, head: { x: 30, y: 85 } },
  { id: "cpm_to_target", d: "M84,68 C84,86 70,86 60,85", label: { x: 70, y: 81 }, head: { x: 60, y: 85 } },
];

const ccpRetrieval: FlowConfig = {
  key: "retrieval",
  navLabel: "Retrieval",
  eyebrow: "Central Credential Provider",
  title: "How the Central Credential Provider Works",
  lede: "From REST request to secret retrieval — how an application fetches a credential from the Central Credential Provider over mTLS, scoped by Safe membership, with no stored password or API key on the workload.",
  nodes: CCP_NODES,
  links: CCP_LINKS,
  chip: ["client cert"],
  canvasHeight: 380,
  steps: [
    {
      title: "The Central Credential Provider — Actors Overview",
      body: "The Application authenticates to the Central Credential Provider (CCP) over REST/mTLS and asks for a credential. CCP serves it from a local credential + policy cache, kept current by Idira Privilege Cloud. The app then uses the credential to reach its Target. The workload stores no Vault password or API key.",
      focus: ["app", "ccp", "cache", "privcloud", "safe", "cpm", "target"],
    },
    {
      title: "App Makes a REST Call to CCP",
      body: "The app opens an mTLS connection to AIMWebService (REST, 443) and requests a credential by AppID + SafeName + ObjectName, presenting its client certificate. No Vault password or API key lives on the workload.",
      focus: ["app", "ccp", "cache"],
      links: [{ id: "app_to_ccp", label: "REST 443", tone: "brand" }],
      chips: ["app"],
    },
    {
      title: "CCP Authenticates & Authorizes from Cache",
      body: "CCP maps the client certificate to a registered Application, then checks that the Application is a member of the requested Safe — also weighing the request's source (allowed machines). Both policy and credentials are served from the local cache.",
      focus: ["ccp", "cache"],
      detail: { cache: { lines: ["cert → Application", "Safe membership ✓", "source / allowed machines"], ok: true } },
      chips: ["app"],
    },
    {
      title: "CCP Returns the Credential",
      body: "CCP returns the account over REST; the app masks it immediately — the full value is never logged or written to disk (APPAP227E for a missing certificate, APPAP004E for an unauthorized Safe).",
      focus: ["ccp", "app"],
      links: [{ id: "ccp_to_app", label: "credential", tone: "ok" }],
    },
    {
      title: "App Calls the Target Application",
      body: "The app uses the retrieved credential to reach its target — a server, database, or service. The secret lives only in the request; nothing durable is persisted on the workload.",
      focus: ["app", "target"],
      links: [{ id: "app_to_target", label: "access", tone: "ok" }],
    },
  ],
  features: [
    { title: "No Stored Secrets on the Workload", body: "The app proves identity with a client certificate over mTLS — not a Vault password or API key. There is no long-lived secret on the workload to leak or rotate." },
    { title: "Scoped by Safe Membership", body: "Authorization is least-privilege and evaluated per request: AppID, Safe, Object, and source must all line up. A valid certificate alone is not enough." },
    { title: "Masked at the Source", body: "The credential is masked as soon as it is returned — only a short preview and hash are ever shown; the full value is never written to disk or logged." },
  ],
};

const ccpRotation: FlowConfig = {
  key: "rotation",
  navLabel: "Rotation & refresh",
  eyebrow: "Central Credential Provider",
  title: "How Rotation & Cache Refresh Work",
  lede: "Running continuously behind every request: how Idira Privilege Cloud rotates the target credential and keeps the CCP's cache current, so the app always retrieves a valid secret without any change.",
  nodes: CCP_NODES,
  links: CCP_LINKS,
  canvasHeight: 380,
  steps: [
    {
      title: "Background — Rotation & Refresh Overview",
      body: "Independently of any app request, Idira Privilege Cloud keeps target credentials fresh and pushes updates down to the CCP. Because the app always asks the CCP for the same object, rotation is invisible to it.",
      focus: ["privcloud", "safe", "cpm", "ccp", "cache", "target"],
      badge: "Background",
    },
    {
      title: "Privilege Cloud Rotates the Target Credential",
      body: "On a schedule (or on demand), the Central Policy Manager / Secrets Rotation Service changes the credential on the target system and updates the Privilege Cloud Safe. The new value is generated centrally — no human handles it.",
      focus: ["privcloud", "cpm", "target"],
      links: [{ id: "cpm_to_target", label: "rotate", tone: "brand" }],
      badge: "Background",
    },
    {
      title: "New Credential Pushed to CCP",
      body: "Privilege Cloud pushes the updated credential (and any policy changes) to the CCP over 1858/TCP. The CCP does not need to poll the Safe on every request.",
      focus: ["privcloud", "ccp", "cache"],
      links: [{ id: "pc_to_ccp", label: "1858/TCP push", tone: "brand" }],
      badge: "Background",
    },
    {
      title: "CCP Cache Refreshed",
      body: "The CCP's cache — both policy and credentials — refreshes on the interval set in its configuration. The next app request is served the current secret with no code or config change, and zero downtime.",
      focus: ["ccp", "cache"],
      detail: { cache: { lines: ["policy refreshed", "credentials refreshed", "per config interval"], ok: true } },
      badge: "Background",
    },
  ],
  features: [
    { title: "Rotation Without App Changes", body: "The app keeps asking for the same object and always receives the current secret. Rotating the credential requires no redeploy, no config edit, and causes no downtime." },
    { title: "Centrally Governed", body: "The Central Policy Manager / Secrets Rotation Service owns the credential lifecycle — generation, rotation, and reconciliation — so no human ever needs to see or handle the value." },
    { title: "Cache Tuned to Your Needs", body: "Refresh cadence for policy and credentials is a configuration setting, letting you balance freshness against load on the Privilege Cloud tenant." },
  ],
};

/* =========================================================================
   Credential Provider (CP) — local agent on the app host, SDK/CLI, app-hash
   ========================================================================= */

const CP = {
  apphost: { left: 2, top: 12, width: 58, height: 54 },
  app: { left: 6, top: 26, width: 20, height: 24 },
  cp: { left: 32, top: 20, width: 25, height: 40 },
  cache: { left: 35, top: 31, width: 19, height: 20 },
  privcloud: { left: 70, top: 10, width: 28, height: 60 },
  safe: { left: 73, top: 17, width: 22, height: 20 },
  cpm: { left: 73, top: 44, width: 22, height: 22 },
  target: { left: 18, top: 76, width: 30, height: 18 },
} as const;

const CP_NODES: WNode[] = [
  { key: "apphost", kind: "container", title: "Application Host", box: CP.apphost },
  { key: "app", title: "Application", sub: "APP SDK · CLI", box: CP.app },
  { key: "cp", kind: "container", title: "Credential Provider", box: CP.cp },
  { key: "cache", title: "Local Credential / Policy Cache", sub: "policy + credentials", box: CP.cache },
  { key: "privcloud", kind: "container", title: "Idira Privilege Cloud", box: CP.privcloud },
  { key: "safe", title: "Privilege Cloud Safe", sub: "secret values", box: CP.safe },
  { key: "cpm", title: "Central Policy Mgr / SRS", sub: "rotation service", box: CP.cpm },
  { key: "target", title: "Target", sub: "server · database · service", box: CP.target },
];

const CP_LINKS: WLinkDef[] = [
  { id: "app_to_cp", d: "M26,38 C28,38 30,38 32,38", label: { x: 29, y: 34 }, head: { x: 32, y: 38 } },
  { id: "cp_to_app", d: "M32,45 C30,45 28,45 26,45", label: { x: 29, y: 49 }, head: { x: 26, y: 45 } },
  { id: "cp_to_pc", d: "M57,32 C63,30 66,28 70,26", label: { x: 64, y: 25 }, head: { x: 70, y: 26 } },
  { id: "pc_to_cp", d: "M70,40 C66,39 61,38 57,38", label: { x: 64, y: 43 }, head: { x: 57, y: 38 } },
  { id: "app_to_target", d: "M16,50 C16,68 20,76 26,76", label: { x: 15, y: 66 }, head: { x: 26, y: 76 } },
  { id: "cpm_to_target", d: "M84,66 C84,85 56,85 48,85", label: { x: 64, y: 81 }, head: { x: 48, y: 85 } },
];

const cpRetrieval: FlowConfig = {
  key: "retrieval",
  navLabel: "Retrieval",
  eyebrow: "Credential Provider",
  title: "How the Credential Provider Works",
  lede: "From an SDK/CLI request to an in-memory secret — how an application retrieves a credential from a local Credential Provider authenticated by its application identity, with nothing written to disk.",
  nodes: CP_NODES,
  links: CP_LINKS,
  chip: ["app hash"],
  canvasHeight: 380,
  steps: [
    {
      title: "The Credential Provider — Actors Overview",
      body: "The Credential Provider runs on the application host; the Application talks to it locally through an SDK or the CLI — no network hop. The provider serves credentials from a local cache kept current by Idira Privilege Cloud, and the app uses them to reach its Target.",
      focus: ["apphost", "app", "cp", "cache", "privcloud", "safe", "cpm", "target"],
    },
    {
      title: "App Requests via SDK / CLI",
      body: "The app calls the local Credential Provider through an SDK (C/C++, Java v8+, .NET) or the CLI, asking for a credential by AppID + SafeName + ObjectName. The call never leaves the host.",
      focus: ["app", "cp"],
      links: [{ id: "app_to_cp", label: "SDK / CLI", tone: "brand" }],
      chips: ["app"],
    },
    {
      title: "CP Authenticates the Calling Application",
      body: "The Credential Provider measures the caller's application hash and checks its OS user and executable path against a registered Application. Recompiling or relocating the binary changes the hash and is rejected (APPAP133E).",
      focus: ["app", "cp", "cache"],
      detail: { cache: { lines: ["app hash + path", "OS user check", "→ registered Application"], ok: true } },
      chips: ["app"],
    },
    {
      title: "CP Authorizes & Reads from Cache",
      body: "The provider confirms the Application is a member of the requested Safe, serving both policy and the credential from its local cache — no per-request round trip to the Vault.",
      focus: ["cp", "cache"],
      detail: { cache: { lines: ["Safe membership ✓", "policy from cache", "credential from cache"], ok: true } },
    },
    {
      title: "CP Returns the Credential to App Memory",
      body: "The credential is handed back into the application's memory — never written to disk, never baked into config or an image.",
      focus: ["cp", "app"],
      links: [{ id: "cp_to_app", label: "in-memory", tone: "ok" }],
    },
    {
      title: "App Calls the Target Application",
      body: "The app uses the in-memory credential to reach its target — a server, database, or service. When the process ends, the secret is gone with it.",
      focus: ["app", "target"],
      links: [{ id: "app_to_target", label: "access", tone: "ok" }],
    },
  ],
  features: [
    { title: "Credentials in Memory, Never on Disk", body: "The provider hands the secret into the app's memory at request time. Nothing is written to disk, baked into an image, or stored in config." },
    { title: "Application-Aware Authentication", body: "Beyond OS user and path, the CP measures the calling application's hash and matches it to a registered Application. Recompiling or moving the binary changes the hash and is refused." },
    { title: "Scoped by Safe Membership", body: "A valid application identity is not enough — it must also be granted the specific Safe. Authorization is least-privilege at the Safe boundary." },
  ],
};

const cpRotation: FlowConfig = {
  key: "rotation",
  navLabel: "Rotation & refresh",
  eyebrow: "Credential Provider",
  title: "How Rotation & Cache Refresh Work",
  lede: "Running continuously behind every request: how Idira Privilege Cloud rotates the target credential and keeps the local Credential Provider's cache current, so the app always retrieves a valid secret without any change.",
  nodes: CP_NODES,
  links: CP_LINKS,
  canvasHeight: 380,
  steps: [
    {
      title: "Background — Rotation & Refresh Overview",
      body: "Independently of any app request, Idira Privilege Cloud keeps target credentials fresh and pushes updates down to the local Credential Provider. Because the app always asks for the same object, rotation is invisible to it.",
      focus: ["privcloud", "safe", "cpm", "apphost", "cp", "cache", "target"],
      badge: "Background",
    },
    {
      title: "Privilege Cloud Rotates the Target Credential",
      body: "On a schedule (or on demand), the Central Policy Manager / Secrets Rotation Service changes the credential on the target system and updates the Privilege Cloud Safe. The new value is generated centrally — no human handles it.",
      focus: ["privcloud", "cpm", "target"],
      links: [{ id: "cpm_to_target", label: "rotate", tone: "brand" }],
      badge: "Background",
    },
    {
      title: "New Credential Pushed to the CP",
      body: "Privilege Cloud pushes the updated credential (and any policy changes) to the Credential Provider over 1858/TCP, so the provider does not need to reach the Safe on every request.",
      focus: ["privcloud", "cp", "cache"],
      links: [{ id: "pc_to_cp", label: "1858/TCP push", tone: "brand" }],
      badge: "Background",
    },
    {
      title: "CP Cache Refreshed",
      body: "The provider's local cache — policy and credentials — refreshes on the interval set in its configuration. The next SDK/CLI request resolves to the current secret with no code or config change, and zero downtime.",
      focus: ["cp", "cache"],
      detail: { cache: { lines: ["policy refreshed", "credentials refreshed", "per config interval"], ok: true } },
      badge: "Background",
    },
  ],
  features: [
    { title: "Rotation Without App Changes", body: "The app keeps asking for the same object and always receives the current secret. Rotating the credential requires no redeploy, no config edit, and causes no downtime." },
    { title: "Works Offline of the Vault", body: "Because credentials and policy are cached locally and refreshed on a schedule, the app can retrieve even during brief Privilege Cloud connectivity gaps." },
    { title: "Cache Tuned to Your Needs", body: "Refresh cadence for policy and credentials is a configuration setting, letting you balance freshness against load on the Privilege Cloud tenant." },
  ],
};

/* =========================================================================
   Dual Account — zero-downtime credential rotation (CP + CCP)
   Two accounts, one always ACTIVE. The Vault's DualAccountStatus is the switch;
   CPM / SRS flips it, then rotates the now-inactive account after a grace period.
   ========================================================================= */

const DUAL = {
  app: { left: 2, top: 38, width: 17, height: 18 },
  cp: { left: 23, top: 33, width: 20, height: 28 },
  vault: { left: 47, top: 12, width: 27, height: 66 },
  acctA: { left: 49, top: 19, width: 23, height: 25 },
  acctB: { left: 49, top: 50, width: 23, height: 25 },
  cpm: { left: 78, top: 18, width: 20, height: 19 },
  target: { left: 77, top: 58, width: 21, height: 19 },
} as const;

const DUAL_LINKS: WLinkDef[] = [
  { id: "app_to_cp", d: "M19,44 C20,44 22,44 23,44", label: { x: 21, y: 40 }, head: { x: 23, y: 44 } },
  { id: "cp_to_app", d: "M23,51 C22,51 20,51 19,51", label: { x: 21, y: 55 }, head: { x: 19, y: 51 } },
  { id: "cp_to_acctA", d: "M43,42 C46,37 47,34 49,32", label: { x: 46, y: 35 }, head: { x: 49, y: 32 } },
  { id: "cp_to_acctB", d: "M43,54 C46,58 47,61 49,62", label: { x: 46, y: 60 }, head: { x: 49, y: 62 } },
  { id: "cpm_to_acctA", d: "M78,28 C76,28 74,29 72,30", label: { x: 75, y: 24 }, head: { x: 72, y: 30 } },
  { id: "cpm_to_target", d: "M88,37 L88,58", label: { x: 93, y: 48 }, head: { x: 88, y: 58 } },
];

// Account status detail (rendered inside the Account A/B cards).
const A_ACTIVE: WDetail = { lines: ["appuser_01", "● ACTIVE", "DualAccountStatus"], ok: true };
const A_INACTIVE: WDetail = { lines: ["appuser_01", "○ INACTIVE", "DualAccountStatus"], ok: false };
const A_RESET: WDetail = { lines: ["appuser_01", "○ INACTIVE", "password reset"], ok: false };
const B_ACTIVE: WDetail = { lines: ["appuser_02", "● ACTIVE", "DualAccountStatus"], ok: true };
const B_INACTIVE: WDetail = { lines: ["appuser_02", "○ INACTIVE", "DualAccountStatus"], ok: false };
const CP_SERVE_A: WDetail = { lines: ["in-memory cache", "→ serving Account A"] };
const CP_SERVE_A_STALE: WDetail = { lines: ["in-memory cache", "→ Account A (stale)"] };
const CP_SERVE_B: WDetail = { lines: ["in-memory cache", "→ serving Account B"] };

function makeDual(providerTitle: string): FlowConfig {
  return {
    key: "dual",
    navLabel: "Dual account",
    eyebrow: "Dual Account",
    title: "Zero-Downtime Credential Rotation",
    lede: "Two accounts, one always active — how IDIRA Dual Accounts guarantee the Credential Provider always serves a valid credential, even during password rotation.",
    canvasHeight: 400,
    nodes: [
      { key: "app", title: "Application", sub: "requests credentials", box: DUAL.app },
      { key: "cp", title: providerTitle, sub: "in-memory cache", box: DUAL.cp },
      { key: "vault", kind: "container", title: "IDIRA Vault", box: DUAL.vault },
      { key: "acctA", title: "Account A", box: DUAL.acctA },
      { key: "acctB", title: "Account B", box: DUAL.acctB },
      { key: "cpm", title: "Central Policy Mgr / SRS", sub: "rotation service", box: DUAL.cpm },
      { key: "target", title: "Target System", sub: "DB / Server · A + B enabled", box: DUAL.target },
    ],
    links: DUAL_LINKS,
    steps: [
      {
        title: "The Setup — Two Accounts, One Active",
        body: "In the Vault, Account A is tagged ACTIVE and Account B INACTIVE via the DualAccountStatus property. On the target system both accounts exist with identical permissions and are both enabled — the Vault status is the only switch.",
        focus: ["vault", "acctA", "cp", "target"],
        detail: { acctA: A_ACTIVE, acctB: B_INACTIVE, cp: CP_SERVE_A },
        links: [{ id: "cp_to_acctA", label: "serving", tone: "brand" }],
      },
      {
        title: "Steady State — the App Is Served Account A",
        body: "The application requests its credential and the Credential Provider returns Account A from its in-memory cache. Account B stays enabled but idle — a warm standby.",
        focus: ["app", "cp", "acctA"],
        detail: { acctA: A_ACTIVE, acctB: B_INACTIVE, cp: CP_SERVE_A },
        links: [
          { id: "app_to_cp", label: "request", tone: "brand" },
          { id: "cp_to_app", label: "cred", tone: "ok" },
          { id: "cp_to_acctA", label: "serving", tone: "brand" },
        ],
      },
      {
        title: "CPM / SRS Detects the Rotation Schedule",
        body: "The Central Policy Mgr / SRS detects that the rotational group is due for a password change based on platform settings. It prepares to flip the DualAccountStatus of both accounts — no passwords have been touched yet.",
        focus: ["cpm", "vault", "acctA"],
        detail: { acctA: A_ACTIVE, acctB: B_INACTIVE, cp: CP_SERVE_A },
        links: [{ id: "cpm_to_acctA", label: "manage", tone: "brand" }],
      },
      {
        title: "The Status Flip — A → Inactive, B → Active",
        body: "CPM / SRS simultaneously updates DualAccountStatus: Account A becomes INACTIVE, Account B becomes ACTIVE. On the target both accounts are still valid and enabled — no lockout, no error. The grace period begins now.",
        focus: ["cpm", "vault", "acctB"],
        detail: { acctA: A_INACTIVE, acctB: B_ACTIVE, cp: CP_SERVE_A_STALE },
        links: [{ id: "cpm_to_acctA", label: "manage", tone: "brand" }],
      },
      {
        title: "Grace Period — CP Refreshes Its Cache",
        body: "The Credential Provider detects the status change in the Vault and refreshes its cache — it now serves Account B. The grace period gives every CP in the environment time to switch before any password is touched.",
        focus: ["cp", "acctB", "vault"],
        detail: { acctA: A_INACTIVE, acctB: B_ACTIVE, cp: CP_SERVE_B },
        links: [{ id: "cp_to_acctB", label: "serving", tone: "brand" }],
      },
      {
        title: "Business Continues — Zero Interruption",
        body: "The application keeps requesting credentials and the CP now returns Account B seamlessly. Zero restarts, zero errors, zero downtime — the active account's password is never changed while it is active.",
        focus: ["app", "cp", "acctB"],
        detail: { acctA: A_INACTIVE, acctB: B_ACTIVE, cp: CP_SERVE_B },
        links: [
          { id: "app_to_cp", label: "request", tone: "brand" },
          { id: "cp_to_app", label: "cred", tone: "ok" },
          { id: "cp_to_acctB", label: "serving", tone: "brand" },
        ],
      },
      {
        title: "Grace Period Ends — CPM Resets Account A",
        body: "After the grace period, CPM / SRS rotates the password of Account A (now inactive) on the target system and updates the Vault. Account A gets a fresh, secure password while Account B serves all traffic undisturbed.",
        focus: ["cpm", "target", "acctA"],
        detail: { acctA: A_RESET, acctB: B_ACTIVE, cp: CP_SERVE_B },
        links: [
          { id: "cpm_to_acctA", label: "update vault", tone: "brand" },
          { id: "cpm_to_target", label: "reset pw", tone: "brand" },
        ],
      },
      {
        title: "Cycle Complete — Ready for Next Rotation",
        body: "Account A now holds a rotated, secured password; Account B is active and serving all traffic. At the next scheduled rotation the process repeats in reverse — B → inactive, A → active, then B is rotated. Always two accounts, always one active.",
        focus: ["vault", "acctB", "cp", "app", "target"],
        detail: { acctA: A_INACTIVE, acctB: B_ACTIVE, cp: CP_SERVE_B },
        links: [
          { id: "app_to_cp", label: "request", tone: "brand" },
          { id: "cp_to_app", label: "cred", tone: "ok" },
          { id: "cp_to_acctB", label: "serving", tone: "brand" },
        ],
      },
    ],
    features: [
      { title: "Zero Downtime", body: "The active account's password is never changed while it is active. Only the inactive account is rotated — and only after the grace period ensures every CP has already switched to the new active account." },
      { title: "Grace Period", body: "A configurable delay between the status flip and the password reset. It gives every Credential Provider time to refresh its cache and start serving the newly active account before any credential becomes invalid." },
      { title: "Always One Active", body: "Both accounts exist and are valid on the target system at all times. The Vault's DualAccountStatus is the only control — and it flips atomically, with no window of unavailability." },
    ],
  };
}

/* ----------------------------- registry ----------------------------- */

const FLOWS: Record<string, FlowConfig[]> = {
  "conjur-jwt": [jwtFlow],
  "conjur-iam": [iamFlow],
  ccp: [ccpRetrieval, ccpRotation, makeDual("Central Credential Provider")],
  cp: [cpRetrieval, cpRotation, makeDual("Credential Provider")],
};

/** All walkthrough flows for a provider id, or null when it has none. */
export function flowsForProvider(providerId: string): FlowConfig[] | null {
  return FLOWS[providerId] ?? null;
}
