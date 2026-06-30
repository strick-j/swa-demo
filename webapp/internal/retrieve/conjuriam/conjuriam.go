// Package conjuriam retrieves a secret from Conjur Cloud (Secrets Manager SaaS)
// using authn-iam: the workload signs an sts:GetCallerIdentity request with its
// AWS IAM role credentials (resolved from the AWS default chain — on EC2 that is
// the instance-profile role via IMDS), Conjur replays the signed request to AWS
// STS to verify the caller ARN, maps it to a Conjur host, returns a short-lived
// access token, and the app reads a variable with it. The app stores no Conjur
// API key and no long-lived AWS secret. Only a masked proof-of-retrieval is
// surfaced — never the raw secret.
//
// The actual authn-iam exchange (request signing + token handling) is delegated
// to the official github.com/cyberark/conjur-api-go client; this package only
// wires config, narrates the lifecycle, and surfaces the caller identity.
package conjuriam

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/cyberark/conjur-api-go/conjurapi"

	"github.com/strick-j/swa-demo/webapp/internal/retrieve"
	"github.com/strick-j/swa-demo/webapp/internal/svid"
)

const defaultRegion = "us-east-1"

// Config is the Conjur authn-iam wiring. When Live is false, or any of the
// required fields are empty, the retriever runs in simulated mode.
type Config struct {
	ApplianceURL string // e.g. https://<tenant>.secretsmgr.cyberark.cloud/api
	Account      string // e.g. conjur
	ServiceID    string // authn-iam service id (bare), e.g. "swa"
	HostID       string // Conjur host the verified ARN maps to, e.g. data/aws/demo-webapp
	SecretPath   string // variable id, e.g. data/secrets/demo-db-password
	Region       string // AWS region for STS signing (default us-east-1)
	Live         bool   // false forces simulated mode (demo / unconfigured)
}

func (c Config) complete() bool {
	return c.ApplianceURL != "" && c.Account != "" && c.ServiceID != "" &&
		c.HostID != "" && c.SecretPath != ""
}

// Retriever implements retrieve.Retriever for Conjur authn-iam.
type Retriever struct {
	cfg Config
}

// New builds the retriever, defaulting the region when unset.
func New(cfg Config) *Retriever {
	if cfg.Region == "" {
		cfg.Region = defaultRegion
	}
	return &Retriever{cfg: cfg}
}

// Mode implements retrieve.Retriever.
func (r *Retriever) Mode() string { return "conjur-iam" }

func (r *Retriever) base() retrieve.Result {
	return retrieve.Result{
		Family:     retrieve.FamilySecretsManager,
		Mode:       "conjur-iam",
		ModeLabel:  "Conjur · AWS STS",
		AuthMethod: "authn-iam",
		SecretName: r.cfg.SecretPath,
	}
}

// Retrieve runs the authn-iam flow (or synthesizes it when unconfigured).
func (r *Retriever) Retrieve(ctx context.Context) retrieve.Result {
	if !r.cfg.Live || !r.cfg.complete() {
		return r.simulate()
	}

	res := r.base()
	t0 := time.Now()

	// 1) Resolve the caller ARN for DISPLAY only — best-effort. The real auth
	//    below does its own credential/identity handling via conjur-api-go; this
	//    separate sts:GetCallerIdentity is just to surface the ARN in the UI, so
	//    if it fails we still attempt auth and let that step report the true
	//    error, rather than aborting here on a cosmetic call.
	awsInfo := retrieve.AWSInfo{Region: r.cfg.Region, HostID: r.cfg.HostID}
	if got, idErr := r.callerIdentity(ctx); idErr == nil {
		awsInfo = got
	} else {
		awsInfo.CallerARN = "(caller ARN unavailable for display)"
		log.Printf("conjuriam: display GetCallerIdentity failed (non-fatal): %v", idErr)
	}
	res.AWS = &awsInfo
	res.Identity = awsInfo.CallerARN

	// 2+3) Authenticate to Conjur authn-iam and read the variable. The client
	//      signs sts:GetCallerIdentity, posts the signed headers to Conjur, and
	//      exchanges the verified identity for a short-lived access token. This is
	//      the step that actually matters — it needs creds + Conjur reachability.
	secret, err := r.authenticateAndRead(r.cfg.SecretPath)
	if err != nil {
		res.Steps = stepsThrough(t0, 1, err.Error())
		res.Error = err.Error()
		return res
	}

	// 4) Mask immediately — the raw value is discarded here.
	res.Masked = retrieve.Mask(secret)
	res.Retrieved = true
	res.Steps = okSteps(t0, r.cfg)
	return res
}

// callerIdentity loads AWS credentials from the default chain and calls
// sts:GetCallerIdentity for the ARN/account/userId we display (and that Conjur
// independently re-verifies during authn-iam).
func (r *Retriever) callerIdentity(ctx context.Context) (retrieve.AWSInfo, error) {
	awscfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(r.cfg.Region))
	if err != nil {
		return retrieve.AWSInfo{}, fmt.Errorf("load aws config: %w", err)
	}
	out, err := sts.NewFromConfig(awscfg).GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if err != nil {
		return retrieve.AWSInfo{}, fmt.Errorf("sts:GetCallerIdentity: %w", err)
	}
	info := retrieve.AWSInfo{Region: awscfg.Region, HostID: r.cfg.HostID}
	if out.Arn != nil {
		info.CallerARN = *out.Arn
	}
	if out.Account != nil {
		info.Account = *out.Account
	}
	if out.UserId != nil {
		info.UserID = *out.UserId
	}
	return info, nil
}

// authenticateAndRead performs the authn-iam exchange via the official client
// and reads the variable. The client signs/sends GetCallerIdentity internally.
func (r *Retriever) authenticateAndRead(variableID string) ([]byte, error) {
	client, err := conjurapi.NewClientFromAWSCredentials(conjurapi.Config{
		Account:      r.cfg.Account,
		ApplianceURL: r.cfg.ApplianceURL,
		AuthnType:    "iam",
		ServiceID:    r.cfg.ServiceID,
		JWTHostID:    r.cfg.HostID, // the conjur-api-go field reused as the IAM host id
		HTTPTimeout:  12,
	})
	if err != nil {
		return nil, fmt.Errorf("authn-iam client: %s", clean(err.Error()))
	}
	secret, err := client.RetrieveSecret(variableID)
	if err != nil {
		return nil, fmt.Errorf("authn-iam read denied: %s", clean(err.Error()))
	}
	return secret, nil
}

// simulate returns an illustrative success when no live Conjur/AWS is configured.
func (r *Retriever) simulate() retrieve.Result {
	res := r.base()
	if res.SecretName == "" {
		res.SecretName = "data/secrets/demo-db-password"
	}
	hostID := r.cfg.HostID
	if hostID == "" {
		hostID = "data/aws/swa-demo-webapp"
	}
	res.AWS = &retrieve.AWSInfo{
		CallerARN: "arn:aws:sts::123456789012:assumed-role/swa-demo-host/i-0abc123def456",
		Account:   "123456789012",
		UserID:    "AROAEXAMPLEID:i-0abc123def456",
		Region:    r.cfg.Region,
		HostID:    hostID,
	}
	res.Identity = res.AWS.CallerARN
	res.Masked = retrieve.Mask([]byte("s1mul4ted-demo-secret-value"))
	res.Retrieved = true
	res.Simulated = true
	res.Steps = okSteps(time.Now(), r.cfg)
	return res
}

// clean collapses a client error to a single bounded line for display. Conjur
// auth-failure messages are error text, not secrets, so they're safe to surface.
func clean(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 300 {
		return s[:300] + "…"
	}
	return s
}

func okSteps(t0 time.Time, cfg Config) []svid.Step {
	svc := cfg.ServiceID
	if svc == "" {
		svc = "<service>"
	}
	host := cfg.HostID
	if host == "" {
		host = "data/aws/swa-demo-webapp"
	}
	path := cfg.SecretPath
	if path == "" {
		path = "data/secrets/demo-db-password"
	}
	ms := t0.UnixMilli()
	return []svid.Step{
		{Name: "Resolve AWS identity", Detail: "The app loads its IAM role credentials from the AWS default chain (on EC2: the instance-profile role via IMDS) and signs an sts:GetCallerIdentity request — it holds no long-lived AWS key.", Meta: "sts:GetCallerIdentity (SigV4)", Status: "ok", AtMillis: ms},
		{Name: "authn-iam", Detail: "It posts the signed request to Conjur authn-iam/" + svc + ". Conjur replays it to AWS STS, verifies the caller ARN, and maps it to host " + host + ".", Meta: "authn-iam/" + svc, Status: "ok", AtMillis: ms + 22},
		{Name: "Conjur access token", Detail: "Conjur returns a short-lived access token bound to that host's permissions.", Meta: "Token token=\"…\"", Status: "ok", AtMillis: ms + 36},
		{Name: "Read variable", Detail: "The app reads " + path + " over the Conjur API and masks it immediately — never written to disk.", Meta: path, Status: "ok", AtMillis: ms + 50},
	}
}

// stepsThrough returns okSteps with the step at failIdx (and beyond) marked
// failed, carrying the error on the failing step.
func stepsThrough(t0 time.Time, failIdx int, errMsg string) []svid.Step {
	steps := okSteps(t0, Config{})
	for i := range steps {
		if i == failIdx {
			steps[i].Status = "error"
			steps[i].Meta = errMsg
		} else if i > failIdx {
			steps[i].Status = "pending"
		}
	}
	return steps
}
