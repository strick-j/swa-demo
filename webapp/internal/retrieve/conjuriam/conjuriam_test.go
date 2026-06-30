package conjuriam

import (
	"context"
	"strings"
	"testing"
)

func TestRetriever_Mode(t *testing.T) {
	if got := New(Config{}).Mode(); got != "conjur-iam" {
		t.Fatalf("Mode() = %q, want conjur-iam", got)
	}
}

// With Live=false the retriever must synthesize a complete, clearly-marked
// simulated result without touching AWS or Conjur.
func TestRetrieve_SimulatesWhenNotLive(t *testing.T) {
	res := New(Config{}).Retrieve(context.Background())

	if !res.Simulated {
		t.Error("expected Simulated=true when not live")
	}
	if !res.Retrieved {
		t.Error("expected Retrieved=true in simulated mode")
	}
	if res.AuthMethod != "authn-iam" {
		t.Errorf("AuthMethod = %q, want authn-iam", res.AuthMethod)
	}
	if res.AWS == nil || res.AWS.CallerARN == "" {
		t.Fatal("simulated result must carry an AWS caller ARN")
	}
	if res.Identity != res.AWS.CallerARN {
		t.Errorf("Identity = %q, want the caller ARN %q", res.Identity, res.AWS.CallerARN)
	}
	if res.AWS.Region != defaultRegion {
		t.Errorf("Region = %q, want default %q", res.AWS.Region, defaultRegion)
	}
	if !strings.Contains(res.Masked, "sha256") {
		t.Errorf("Masked should be a hashed summary, got %q", res.Masked)
	}
	if strings.Contains(res.Masked, "s1mul4ted-demo-secret-value") {
		t.Error("Masked leaked the simulated secret value")
	}
}

// A live-flagged but incomplete config must fall back to simulation rather than
// attempt a real (and guaranteed-to-fail) call.
func TestRetrieve_IncompleteLiveConfigSimulates(t *testing.T) {
	cfg := Config{Live: true, ApplianceURL: "https://example/api"} // missing the rest
	res := New(cfg).Retrieve(context.Background())
	if !res.Simulated {
		t.Error("incomplete live config should simulate")
	}
}

func TestConfig_Complete(t *testing.T) {
	full := Config{
		ApplianceURL: "https://t/api", Account: "conjur", ServiceID: "swa",
		HostID: "data/aws/app", SecretPath: "data/secrets/x",
	}
	if !full.complete() {
		t.Error("fully-populated config should be complete")
	}
	if (Config{ApplianceURL: "https://t/api"}).complete() {
		t.Error("partial config should not be complete")
	}
}
