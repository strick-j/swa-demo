package cp

import (
	"time"

	"github.com/strick-j/swa-demo/webapp/internal/svid"
)

// label is the short scenario name shown in the mode label / UI.
func label(s Scenario) string {
	switch s {
	case Authorized:
		return "Authorized"
	case InvalidHash:
		return "Invalid hash"
	case Denied:
		return "Denied (authz)"
	case Dual:
		return "Dual account"
	}
	return string(s)
}

// okSteps is the four-step CP lifecycle, all succeeding, tailored per scenario.
// The first step differs from the CCP: the caller is authenticated by its
// application HASH, not a client certificate.
func okSteps(t0 time.Time, s Scenario) []svid.Step {
	ms := t0.UnixMilli()

	invokeDetail := "The app in the container asks the host cp-bridge to run the registered Java caller; the CP measures the caller's application HASH — it stores no Vault password or API key."
	invokeMeta := "app hash"
	if s == InvalidHash {
		invokeDetail = "The bridge runs a DIFFERENT jar whose hash is NOT registered on the Application."
		invokeMeta = "unregistered hash"
	}

	authzDetail := "The Credential Provider checks that this Application is permitted to read the requested Safe."
	returnDetail := "The CP returns the account; the secret is hashed on the host and only a short preview + its length + digest cross the bridge — the full value never leaves the host."
	if s == Dual {
		authzDetail = "The CP resolves the dual-account query to whichever account is currently ACTIVE."
		returnDetail = "The CP returns the active account of the dual pair. On rotation the other account goes active — no app change, no downtime."
	}

	return []svid.Step{
		{Name: "Invoke registered caller", Detail: invokeDetail, Meta: invokeMeta, Status: "ok", AtMillis: ms},
		{Name: "Application authentication", Detail: "The CP authenticates the calling application by its hash (plus path / OS user) to a registered Application identity.", Meta: "app-hash auth", Status: "ok", AtMillis: ms + 16},
		{Name: "Authorization · Safe access", Detail: authzDetail, Meta: "safe authorization", Status: "ok", AtMillis: ms + 30},
		{Name: "Return credential", Detail: returnDetail, Meta: "masked on host", Status: "ok", AtMillis: ms + 44},
	}
}

// stepsAt returns okSteps with the step at failIdx marked failed (carrying msg)
// and later steps pending — for the expected denials and error paths.
func stepsAt(t0 time.Time, s Scenario, failIdx int, msg string) []svid.Step {
	steps := okSteps(t0, s)
	for i := range steps {
		if i == failIdx {
			steps[i].Status = "error"
			steps[i].Meta = msg
		} else if i > failIdx {
			steps[i].Status = "pending"
		}
	}
	return steps
}
