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
  lede: "From pod startup to secret retrieval — a step-by-step animation of how workloads authenticate to Secrets Manager using Kubernetes ServiceAccount JWTs, without any stored credentials.",
  actors: {
    workload: { title: "Workload", sub: "app container" },
    idp: { title: "K8s API Server", sub: "OIDC / JWKS endpoint" },
    manager: { title: "Idira Secrets Manager", sub: "authn-jwt authenticator" },
    validator: { title: "JWT Validator", sub: "JWKS · signature · claims" },
    policy: { title: "Policy Engine", sub: "identity · annotations" },
    vault: { title: "Secrets Vault", sub: "secret values" },
    privcloud: { title: "Idira Privilege Cloud", sub: "" },
    privvault: { title: "Privilege Cloud Safe", sub: "synced secrets" },
  },
  chip: ["header", "payload", "sig"],
  steps: [
    {
      title: "The JWT Authenticator — Actors Overview",
      body: "The Workload (an app container in Kubernetes) authenticates to the Idira Secrets Manager, which houses the JWT Validator, the Policy Engine, and its own Secrets Vault. The K8s API Server issues and validates the JWT. Secrets in the vault are created there directly or synchronized from an Idira Privilege Cloud safe.",
      focus: ["workload", "idp", "manager", "validator", "policy", "vault", "privcloud", "privvault"],
      container: true,
    },
    {
      title: "K8s Projects a JWT into the Pod",
      body: "When the pod starts, Kubernetes automatically mounts a short-lived ServiceAccount JWT at /var/run/secrets/tokens/jwt. This token is signed by K8s and carries claims about the workload identity: sub (system:serviceaccount:conjur:springboot-app), namespace, serviceaccount name, iss (https://kubernetes.default.svc), and aud (conjur). No manual credential management.",
      focus: ["idp", "workload"],
      links: [{ id: "idp_to_workload", label: "JWT", tone: "brand" }],
      token: true,
    },
    {
      title: "Workload POSTs JWT to Secrets Manager",
      body: "The application reads the JWT from its projected volume and sends it to the authn-jwt endpoint: POST /api/authn-jwt/eks-acme/conjur/authenticate. The body contains only the URL-encoded JWT — no password, no API key. The workload's Kubernetes identity is the credential.",
      focus: ["workload", "manager"],
      container: true,
      links: [{ id: "workload_to_manager", label: "POST jwt", tone: "brand" }],
      token: true,
    },
    {
      title: "Secrets Manager Fetches JWKS from K8s",
      body: "Secrets Manager reads the jwks-uri policy variable (pointing to the K8s OIDC discovery URL) and fetches the JSON Web Key Set — the RSA public keys K8s uses to sign ServiceAccount JWTs. If the signing key rotates, Secrets Manager automatically fetches the new key when it first sees a token signed with it.",
      focus: ["manager", "validator", "idp"],
      container: true,
      links: [{ id: "manager_to_idp", label: "JWKS", tone: "brand" }],
      validatorLines: ["JWKS · signature · claims", "exp · iss · aud · sig", "RSA-256 verify"],
      token: true,
    },
    {
      title: "Signature & Standard Claims Verified",
      body: "Using the fetched JWKS, Secrets Manager cryptographically verifies the JWT signature — confirming it was genuinely signed by this K8s cluster. It validates exp (not expired), iss (matches the configured issuer), and aud (matches the configured audience). A forged token, an expired token, or a token from a different cluster all fail here.",
      focus: ["manager", "validator"],
      container: true,
      validatorLines: ["signature ✓", "exp · iss · aud ✓", "RSA-256 verified"],
      validatorOk: true,
      token: true,
    },
    {
      title: "Identity Resolved — Annotations Matched",
      body: "Secrets Manager extracts the claim named in token-app-property (e.g. sub), locates the matching host in policy (host/conjur/authn-jwt/eks-acme/springboot-app), and verifies ALL of its annotations against the JWT claims. Every annotation is a mandatory constraint.",
      focus: ["manager", "policy"],
      container: true,
      policyRows: [
        { k: "namespace", v: "conjur" },
        { k: "service-account", v: "springboot-app" },
      ],
      token: true,
    },
    {
      title: "Short-Lived API Token Issued",
      body: "Authentication succeeds. Secrets Manager issues a short-lived API token — valid for roughly 8 minutes. This token proves the workload's authenticated identity to the Secrets Vault. The original K8s JWT is never stored or forwarded.",
      focus: ["manager", "workload"],
      container: true,
      links: [{ id: "manager_to_workload", label: "api-token", tone: "brand" }],
      token: true,
    },
    {
      title: "Secrets Retrieved — Flow Complete",
      body: 'The workload uses the API token to fetch secrets: GET /api/secrets/conjur/variable/… with Authorization: Token token="<api-token>". The Policy Engine authorizes the request and the Secrets Vault returns the value — a secret created in the vault directly or synchronized from an Idira Privilege Cloud safe. No credential ever touches source code, a container image, or a CI variable.',
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
      body: "The workload authenticates using its Kubernetes identity — a JWT projected by K8s itself. No API keys, no passwords, no certificates stored in the cluster. If the pod is compromised, there are no credentials to steal.",
    },
    {
      title: "Cryptographic Identity",
      body: "The JWT is signed by the Kubernetes API Server's RSA private key. Secrets Manager verifies this signature against the public JWKS before trusting any claim. Identity cannot be forged — only the real K8s cluster can produce a valid signature.",
    },
    {
      title: "Policy as Code",
      body: "Every claim-to-identity mapping is declared in Secrets Manager policy YAML and version-controlled. Annotations on host resources define exactly which namespace, ServiceAccount, and pod labels are required. Change the policy to grant or revoke access — no credential rotation needed.",
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
      body: "The workload sends the pre-signed request to the authn-iam endpoint: POST /api/authn-iam/eks-acme/conjur/authenticate. The body contains only the signed STS request — no AWS secret key ever leaves the instance.",
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
      body: "Secrets Manager matches the returned ARN against the host in policy (host/conjur/authn-iam/eks-acme/swa-demo-host) and verifies its annotations. Every annotation is a mandatory constraint.",
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
