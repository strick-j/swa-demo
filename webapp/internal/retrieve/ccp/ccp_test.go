package ccp

import (
	"context"
	"strings"
	"testing"

	"github.com/strick-j/swa-demo/webapp/internal/svid"
)

// hasErrorStepAt reports whether the step at idx is marked failed.
func hasErrorStepAt(steps []svid.Step, idx int) bool {
	return idx >= 0 && idx < len(steps) && steps[idx].Status == "error"
}

func newSim() *Client {
	c, err := New(Config{}) // no live config -> simulated
	if err != nil {
		panic(err)
	}
	return c
}

func TestClient_ModeAndSimulated(t *testing.T) {
	c := newSim()
	if c.Mode() != "ccp" {
		t.Fatalf("Mode() = %q, want ccp", c.Mode())
	}
	if !c.Simulated() {
		t.Error("expected Simulated()=true with no config")
	}
}

func TestRun_Authorized_Succeeds(t *testing.T) {
	res := newSim().Run(context.Background(), Authorized)
	if !res.Simulated || !res.Retrieved {
		t.Fatalf("authorized: Simulated=%v Retrieved=%v, want both true", res.Simulated, res.Retrieved)
	}
	if res.CCP == nil || res.CCP.Account == "" {
		t.Fatal("authorized: expected a returned account in CCPInfo")
	}
	if !strings.Contains(res.Masked, "sha256") {
		t.Errorf("authorized: masked should be hashed, got %q", res.Masked)
	}
	if strings.Contains(res.Masked, "s1mul4ted") {
		t.Error("authorized: masked leaked the simulated secret")
	}
}

func TestRun_NoCert_DeniedAtAuthn(t *testing.T) {
	res := newSim().Run(context.Background(), NoCert)
	if res.Retrieved {
		t.Error("no-cert: must not retrieve a secret")
	}
	if res.Error == "" {
		t.Error("no-cert: expected an auth error")
	}
	if res.CCP != nil && res.CCP.CertCN != "" {
		t.Errorf("no-cert: no certificate should be presented, got CN %q", res.CCP.CertCN)
	}
	if !hasErrorStepAt(res.Steps, 1) {
		t.Error("no-cert: expected failure at the authentication step (index 1)")
	}
}

func TestRun_Denied_DeniedAtAuthz(t *testing.T) {
	res := newSim().Run(context.Background(), Denied)
	if res.Retrieved {
		t.Error("denied: must not retrieve a secret")
	}
	if !strings.Contains(res.Error, "not authorized") {
		t.Errorf("denied: expected an authorization error, got %q", res.Error)
	}
	if !hasErrorStepAt(res.Steps, 2) {
		t.Error("denied: expected failure at the authorization step (index 2)")
	}
}

func TestRun_Dual_ReturnsActive(t *testing.T) {
	res := newSim().Run(context.Background(), Dual)
	if !res.Retrieved {
		t.Error("dual: expected a retrieved secret")
	}
	if res.CCP == nil || res.CCP.DualActive == "" {
		t.Error("dual: expected an active-account indicator")
	}
}

func TestRun_UnknownScenario(t *testing.T) {
	res := newSim().Run(context.Background(), Scenario("bogus"))
	if res.Error == "" {
		t.Error("unknown scenario should return an error")
	}
	if res.Retrieved {
		t.Error("unknown scenario should not retrieve")
	}
}
