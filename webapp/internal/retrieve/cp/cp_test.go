package cp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/strick-j/swa-demo/webapp/internal/svid"
)

// hasErrorStepAt reports whether the step at idx is marked failed.
func hasErrorStepAt(steps []svid.Step, idx int) bool {
	return idx >= 0 && idx < len(steps) && steps[idx].Status == "error"
}

// stubBridge stands in for the host cp-bridge, returning a canned response per
// scenario so the retriever can be exercised without a live Credential Provider.
// It never returns a raw secret — only the length + SHA-256, matching the real
// contract.
func stubBridge(t *testing.T) *Client {
	t.Helper()
	secret := []byte("s3cr3t-db-password")
	sum := sha256.Sum256(secret)
	digest := hex.EncodeToString(sum[:])
	prefix := "s3cr3t" // first 6 chars — the preview the caller emits

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/cp" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		br := bridgeResponse{
			AppID:      "SWA-CP-Demo",
			AppHash:    "a1b2c3",
			CallerPath: "/opt/swa-cp/cp-caller.jar",
			OSUser:     "svc_app",
			Safe:       "SWA-CP-Demo-Safe",
			Query:      "Object=db-credential",
		}
		switch Scenario(r.URL.Query().Get("scenario")) {
		case Authorized:
			br.OK = true
			br.Account = "svc-app-db"
			br.Address = "db.internal"
			br.ContentLen = len(secret)
			br.ContentSHA256 = digest
			br.ContentPrefix = prefix
		case InvalidHash:
			br.OK = false
			br.AppHash = ""
			br.ErrorCode = "APPAP008E"
			br.Error = "The application hash is not authorized to access the password"
		case Denied:
			br.OK = false
			br.Safe = "Restricted-Safe"
			br.ErrorCode = "APPAP004E"
			br.Error = "Application 'SWA-CP-Demo' is not authorized to access safe 'Restricted-Safe'"
		case Dual:
			br.OK = true
			br.Safe = "SWA-CP-Demo-Safe"
			br.Query = "VirtualUsername=svc-app-db"
			br.Account = "svc-app-db-A"
			br.Address = "db.internal"
			br.VirtualUsername = "svc-app-db"
			br.DualActive = "svc-app-db-A (Active, index 1)"
			br.ContentLen = len(secret)
			br.ContentSHA256 = digest
			br.ContentPrefix = prefix
		default:
			http.Error(w, `{"ok":false,"error":"unknown scenario"}`, http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(br)
	}))
	t.Cleanup(srv.Close)

	return New(Config{BridgeURL: srv.URL, AppID: "SWA-CP-Demo", Live: true})
}

func TestClient_Mode(t *testing.T) {
	c := New(Config{})
	if c.Mode() != "cp" {
		t.Fatalf("Mode() = %q, want cp", c.Mode())
	}
	if c.Live() {
		t.Error("expected Live()=false with no bridge URL")
	}
}

func TestRun_NotConfigured_ReturnsError(t *testing.T) {
	res := New(Config{}).Run(context.Background(), Authorized)
	if res.Retrieved {
		t.Error("unconfigured: must not retrieve")
	}
	if !strings.Contains(res.Error, "not configured") {
		t.Errorf("unconfigured: expected a not-configured error, got %q", res.Error)
	}
	if !hasErrorStepAt(res.Steps, 0) {
		t.Error("unconfigured: expected failure at the first step")
	}
}

func TestRun_Authorized_Succeeds(t *testing.T) {
	res := stubBridge(t).Run(context.Background(), Authorized)
	if !res.Retrieved {
		t.Fatalf("authorized: Retrieved=false, err=%q", res.Error)
	}
	if res.CP == nil || res.CP.Account == "" {
		t.Fatal("authorized: expected a returned account in CPInfo")
	}
	if res.CP.AppHash == "" {
		t.Error("authorized: expected an authenticated app hash")
	}
	if !strings.Contains(res.Masked, "sha256") {
		t.Errorf("authorized: masked should be hashed, got %q", res.Masked)
	}
	if !strings.HasPrefix(res.Masked, "s3cr3t") {
		t.Errorf("authorized: masked should reveal the 6-char preview, got %q", res.Masked)
	}
	if strings.Contains(res.Masked, "db-password") {
		t.Errorf("authorized: masked leaked the hidden remainder, got %q", res.Masked)
	}
}

func TestRun_InvalidHash_DeniedAtAuthn(t *testing.T) {
	res := stubBridge(t).Run(context.Background(), InvalidHash)
	if res.Retrieved {
		t.Error("invalid-hash: must not retrieve a secret")
	}
	if !strings.Contains(res.Error, "APPAP008E") {
		t.Errorf("invalid-hash: expected a CyberArk auth error code, got %q", res.Error)
	}
	if res.CP != nil && res.CP.AppHash != "" {
		t.Errorf("invalid-hash: no registered hash should be reported, got %q", res.CP.AppHash)
	}
	if !hasErrorStepAt(res.Steps, 1) {
		t.Error("invalid-hash: expected failure at the authentication step (index 1)")
	}
}

func TestRun_Denied_DeniedAtAuthz(t *testing.T) {
	res := stubBridge(t).Run(context.Background(), Denied)
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
	res := stubBridge(t).Run(context.Background(), Dual)
	if !res.Retrieved {
		t.Fatalf("dual: expected a retrieved secret, err=%q", res.Error)
	}
	if res.CP == nil || res.CP.DualActive == "" {
		t.Error("dual: expected an active-account indicator")
	}
	if res.CP.VirtualUsername == "" {
		t.Error("dual: expected a virtual username")
	}
}

func TestRun_UnknownScenario(t *testing.T) {
	res := stubBridge(t).Run(context.Background(), Scenario("bogus"))
	if res.Error == "" {
		t.Error("unknown scenario should return an error")
	}
	if res.Retrieved {
		t.Error("unknown scenario should not retrieve")
	}
}

func TestRun_BridgeUnreachable(t *testing.T) {
	// A live config pointing at a dead address surfaces a transport error, not a
	// panic or a synthesized success.
	c := New(Config{BridgeURL: "http://127.0.0.1:0", AppID: "x", Live: true})
	res := c.Run(context.Background(), Authorized)
	if res.Retrieved {
		t.Error("unreachable: must not retrieve")
	}
	if !strings.Contains(res.Error, "unreachable") {
		t.Errorf("unreachable: expected a transport error, got %q", res.Error)
	}
}
