// walkthroughData -- content for the "Learn More" step-through animations shown
// in the inspector when a Secrets Manager use-case page invokes the walkthrough.
//
// Deliberately kept OUT of the i18n JSON catalogs (src/i18n/locales/*.json): the
// walkthrough is authored English-only and is exempt from the strict per-locale
// parity test (see src/i18n/parity.test.ts). If this copy is ever localized,
// move it behind t() and add the keys to every catalog.
//
// Geometry lives in Walkthrough.tsx; this file only supplies labels, per-step
// narration, and which actors / connectors light up at each step.

/** Fixed connector ids; their paths are defined in Walkthrough.tsx. */
export type LinkId =
  | "idp_to_workload"
  | "workload_to_manager"
  | "manager_to_idp"
  | "manager_to_workload"
  | "policy_to_vault"
  | "vault_to_workload"
  | "privvault_to_vault";

/** The actor / sub-card / container slots the diagram can highlight.
 *  `manager` and `privcloud` are containers (drawn as rings, no card of their
 *  own); the others are cards. */
export type ActorKey =
  | "workload"
  | "idp"
  | "manager"
  | "validator"
  | "policy"
  | "vault"
  | "privcloud"
  | "privvault";

export interface WLink {
  id: LinkId;
  label?: string;
  tone?: "brand" | "ok";
}

export interface WStep {
  title: string;
  body: string;
  /** Actors / sub-cards drawn in the lit (focused) state this step. */
  focus: ActorKey[];
  /** Draw the Secrets Manager container in its dashed "under evaluation" ring. */
  container?: boolean;
  /** Connectors animated this step. */
  links?: WLink[];
  /** Mono lines rendered inside the JWT/STS validator sub-card. */
  validatorLines?: string[];
  /** Whether the validator lines read as verified (green) rather than pending. */
  validatorOk?: boolean;
  /** Annotation rows rendered inside the Policy Engine sub-card. */
  policyRows?: { k: string; v: string }[];
  /** Whether the workload is holding the token chip this step. */
  token?: boolean;
}

export interface FlowConfig {
  eyebrow: string;
  title: string;
  lede: string;
  actors: Record<ActorKey, { title: string; sub: string }>;
  /** Small colored token segments shown under the workload while it holds one. */
  chip: string[];
  steps: WStep[];
  features: { title: string; body: string }[];
}

/* ----------------------------- authn-jwt flow ----------------------------- */

const jwtFlow: FlowConfig = {
  eyebrow: "JWT Authenticator",
  title: "How JWT Authentication Works",
  lede: "From workload identity to secret retrieval — a step-by-step animation of how a workload obtains a short-lived JWT-SVID from Secure Workload Access and uses it to authenticate to the Idira Secrets Manager (authn-jwt), without any stored credentials.",
  actors: {
    workload: { title: "Workload", sub: "app container" },
    idp: { title: "Secure Workload Access", sub: "SPIFFE · JWT-SVID issuer" },
    manager: { title: "Idira Secrets Manager", sub: "authn-jwt authenticator" },
    validator: { title: "JWT Validator", sub: "JWKS · signature · claims" },
    policy: { title: "Policy Engine", sub: "SPIFFE ID · host mapping" },
    vault: { title: "Secrets Vault", sub: "secret values" },
    privcloud: { title: "Idira Privilege Cloud", sub: "" },
    privvault: { title: "Privilege Cloud Safe", sub: "synced secrets" },
  },
  chip: ["header", "payload", "sig"],
  steps: [
    {
      title: "The JWT Authenticator — Actors Overview",
      body: "The Workload holds no stored credential. It obtains a short-lived JWT-SVID from Secure Workload Access (SWA), then presents it to the Idira Secrets Manager (authn-jwt) — which houses the JWT Validator, the Policy Engine, and its own Secrets Vault. Secrets Manager validates the token against the SWA trust-domain JWKS. Vault secrets are created there directly or synchronized from an Idira Privilege Cloud safe.",
      focus: ["workload", "idp", "manager", "validator", "policy", "vault", "privcloud", "privvault"],
      container: true,
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
      token: true,
    },
    {
      title: "Workload Presents the JWT-SVID to Secrets Manager",
      body: "The app presents the JWT-SVID to the authn-jwt endpoint: POST /api/authn-jwt/swa/conjur/authenticate with the URL-encoded token. No password, no API key, no Conjur credential — the SVID is the proof of identity.",
      focus: ["workload", "manager"],
      container: true,
      links: [{ id: "workload_to_manager", label: "present svid", tone: "brand" }],
      token: true,
    },
    {
      title: "Secrets Manager Validates Against the SWA Trust-Domain JWKS",
      body: "Secrets Manager fetches the JWKS from the configured issuer — the SWA trust domain — and cryptographically verifies the SVID signature, then checks the standard claims: iss (matches the configured issuer), aud (conjur), and exp (not expired). A forged, expired, or wrong-audience token fails here.",
      focus: ["manager", "validator", "idp"],
      container: true,
      links: [{ id: "manager_to_idp", label: "JWKS", tone: "brand" }],
      validatorLines: ["trust-domain JWKS", "iss · aud · exp ✓", "RS256 verified"],
      validatorOk: true,
      token: true,
    },
    {
      title: "Identity Resolved — SPIFFE ID Mapped to a Host",
      body: "Secrets Manager reads the token-app-property claim (sub) and maps the SPIFFE ID to a Conjur host, then verifies the host's annotations. Only a workload whose SVID carries this exact identity is authorized.",
      focus: ["manager", "policy"],
      container: true,
      policyRows: [
        { k: "trust-domain", v: "swa-demo.example.com" },
        { k: "workload", v: "sa/swa-demo-webapp" },
      ],
      token: true,
    },
    {
      title: "Short-Lived Access Token Issued",
      body: "Authentication succeeds. Secrets Manager returns a short-lived access token bound to that host's permissions — valid for minutes. The JWT-SVID is never stored or forwarded.",
      focus: ["manager", "workload"],
      container: true,
      links: [{ id: "manager_to_workload", label: "access token", tone: "brand" }],
      token: true,
    },
    {
      title: "Secret Retrieved — Flow Complete",
      body: 'The workload reads the variable with the access token: GET /api/secrets/conjur/variable/data/secrets/demo-db-password with Authorization: Token token="…". The Policy Engine authorizes the request and the Secrets Vault returns the value — created in the vault directly or synchronized from an Idira Privilege Cloud safe — masked immediately, never written to disk.',
      focus: ["workload", "policy", "vault", "privcloud", "privvault"],
      container: true,
      links: [
        { id: "privvault_to_vault", label: "sync", tone: "brand" },
        { id: "policy_to_vault", label: "authorize", tone: "brand" },
        { id: "vault_to_workload", label: "secret", tone: "ok" },
      ],
      token: true,
    },
  ],
  features: [
    {
      title: "Zero Stored Credentials",
      body: "The workload holds no Conjur API key and no static secret. Its only credential is a short-lived JWT-SVID issued on demand by Secure Workload Access — if the pod is compromised, there is nothing durable to steal.",
    },
    {
      title: "Attested, Cryptographic Identity",
      body: "SWA doesn't take the workload's word for it — it attests the pod from Kubernetes runtime attributes, then signs the SVID with the trust-domain key. Secrets Manager verifies that signature against the published JWKS before trusting any claim.",
    },
    {
      title: "Policy as Code",
      body: "Every SPIFFE-ID-to-host mapping is declared in Secrets Manager policy and version-controlled. Change the policy to grant or revoke access — no credential rotation needed.",
    },
  ],
};

/* ----------------------------- authn-iam flow ----------------------------- */

const iamFlow: FlowConfig = {
  eyebrow: "IAM Authenticator",
  title: "How IAM Authentication Works",
  lede: "From instance-profile role to secret retrieval — a step-by-step animation of how AWS workloads authenticate to Secrets Manager using a signed sts:GetCallerIdentity, with no stored AWS secret.",
  actors: {
    workload: { title: "Workload", sub: "EC2 / app container" },
    idp: { title: "AWS STS", sub: "IMDS · GetCallerIdentity" },
    manager: { title: "Idira Secrets Manager", sub: "authn-iam authenticator" },
    validator: { title: "STS Verifier", sub: "signed request · ARN" },
    policy: { title: "Policy Engine", sub: "identity · annotations" },
    vault: { title: "Secrets Vault", sub: "secret values" },
    privcloud: { title: "Idira Privilege Cloud", sub: "" },
    privvault: { title: "Privilege Cloud Safe", sub: "synced secrets" },
  },
  chip: ["akid", "sig"],
  steps: [
    {
      title: "The IAM Authenticator — Actors Overview",
      body: "The Workload (an app on an EC2 instance or IRSA-enabled pod) authenticates to the Idira Secrets Manager, which houses the STS Verifier, the Policy Engine, and its own Secrets Vault. AWS STS validates the caller's signed identity via the instance metadata service. Secrets in the vault are created there directly or synchronized from an Idira Privilege Cloud safe.",
      focus: ["workload", "idp", "manager", "validator", "policy", "vault", "privcloud", "privvault"],
      container: true,
    },
    {
      title: "Workload Reads Role Credentials from IMDS",
      body: "The workload has no stored AWS secret. It queries the instance metadata service (IMDS) at 169.254.169.254 for the temporary credentials of its instance-profile role — an access key, secret key, and session token that AWS rotates automatically.",
      focus: ["idp", "workload"],
      links: [{ id: "idp_to_workload", label: "role creds", tone: "brand" }],
      token: true,
    },
    {
      title: "Workload Signs an sts:GetCallerIdentity",
      body: "Using those role credentials, the workload builds and SigV4-signs an sts:GetCallerIdentity request. The signature proves the caller controls the role — without ever revealing the secret key. Nothing is called yet; the signed request itself is the credential.",
      focus: ["workload"],
      token: true,
    },
    {
      title: "Workload POSTs the Signed Request",
      body: "The workload sends the pre-signed request to the authn-iam endpoint: POST /api/authn-iam/swa/conjur/authenticate. The body contains only the signed STS request — no AWS secret key ever leaves the instance.",
      focus: ["workload", "manager"],
      container: true,
      links: [{ id: "workload_to_manager", label: "signed req", tone: "brand" }],
      token: true,
    },
    {
      title: "Secrets Manager Replays to AWS STS",
      body: "Secrets Manager forwards the signed request to AWS STS exactly as received. AWS validates the SigV4 signature and returns the caller's identity — the assumed-role ARN (arn:aws:sts::123456789012:assumed-role/swa-demo-host/i-0abc123). Secrets Manager never sees or stores AWS credentials.",
      focus: ["manager", "validator", "idp"],
      container: true,
      links: [{ id: "manager_to_idp", label: "replay", tone: "brand" }],
      validatorLines: ["sts:GetCallerIdentity", "SigV4 verify", "caller ARN"],
    },
    {
      title: "Identity Resolved — ARN Annotations Matched",
      body: "Secrets Manager matches the returned ARN against the mapped Conjur host (e.g. data/aws/demo-webapp) and verifies its annotations. Every annotation is a mandatory constraint.",
      focus: ["manager", "policy"],
      container: true,
      policyRows: [
        { k: "account-id", v: "123456789012" },
        { k: "role-name", v: "swa-demo-host" },
      ],
    },
    {
      title: "Short-Lived API Token Issued",
      body: "Authentication succeeds. Secrets Manager issues a short-lived, scoped API token — valid for roughly 8 minutes. It proves the workload's authenticated identity to the Secrets Vault. No AWS credential is stored or forwarded.",
      focus: ["manager", "workload"],
      container: true,
      links: [{ id: "manager_to_workload", label: "api-token", tone: "brand" }],
      token: true,
    },
    {
      title: "Secrets Retrieved — Flow Complete",
      body: 'The workload uses the API token to fetch secrets: GET /api/secrets/conjur/variable/… with Authorization: Token token="<api-token>". The Policy Engine authorizes the request and the Secrets Vault returns the value — a secret created in the vault directly or synchronized from an Idira Privilege Cloud safe. No static AWS secret ever touches source code, an image, or a CI variable.',
      focus: ["workload", "policy", "vault", "privcloud", "privvault"],
      container: true,
      links: [
        { id: "privvault_to_vault", label: "sync", tone: "brand" },
        { id: "policy_to_vault", label: "authorize", tone: "brand" },
        { id: "vault_to_workload", label: "secret", tone: "ok" },
      ],
      token: true,
    },
  ],
  features: [
    {
      title: "Zero Stored Credentials",
      body: "The workload authenticates with the temporary role credentials AWS already rotates via IMDS — signed, never sent. No static AWS access keys live in the cluster, an image, or a CI variable.",
    },
    {
      title: "Verified by AWS",
      body: "Secrets Manager doesn't take the caller's word for it — it replays the signed request to AWS STS, which cryptographically verifies the SigV4 signature and returns the true assumed-role ARN. Identity cannot be spoofed.",
    },
    {
      title: "Policy as Code",
      body: "Every ARN-to-identity mapping is declared in Secrets Manager policy YAML and version-controlled. Annotations pin the exact account and role required. Grant or revoke access by changing policy — no credential rotation needed.",
    },
  ],
};

/** Pick the walkthrough flow for a provider id. Returns null for pages that
 *  have no walkthrough (only the two Secrets Manager pages do). */
export function flowForProvider(providerId: string): FlowConfig | null {
  if (providerId === "conjur-jwt") return jwtFlow;
  if (providerId === "conjur-iam") return iamFlow;
  return null;
}
