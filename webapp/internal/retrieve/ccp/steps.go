package ccp

import (
	"time"

	"github.com/strick-j/swa-demo/webapp/internal/retrieve"
	"github.com/strick-j/swa-demo/webapp/internal/svid"
)

// label is the short scenario name shown in the mode label / UI.
func label(s Scenario) string {
	switch s {
	case Authorized:
		return "Authorized"
	case NoCert:
		return "No certificate"
	case Denied:
		return "Denied (authz)"
	case Dual:
		return "Dual account"
	}
	return string(s)
}

// okSteps is the four-step CCP lifecycle, all succeeding, tailored per scenario.
func okSteps(t0 time.Time, s Scenario) []svid.Step {
	ms := t0.UnixMilli()
	certDetail := "The app opens an mTLS connection to AIMWebService and presents its client certificate — it stores no Vault password or API key."
	certMeta := "client-cert"
	if s == NoCert {
		certDetail = "The app connects to AIMWebService WITHOUT a client certificate."
		certMeta = "no certificate"
	}
	authzDetail := "CCP checks that this application is permitted to read the requested Safe."
	returnDetail := "CCP returns the account; the app masks the credential immediately — never written to disk."
	if s == Dual {
		authzDetail = "CCP resolves the dual-account query to whichever account is currently ACTIVE."
		returnDetail = "CCP returns the active account of the dual pair; the app masks it. On rotation the other account goes active — no app change, no downtime."
	}
	return []svid.Step{
		{Name: "Present client certificate", Detail: certDetail, Meta: certMeta, Status: "ok", AtMillis: ms},
		{Name: "AIMWebService authentication", Detail: "CCP authenticates the certificate to a registered Application identity.", Meta: "AIMWebService", Status: "ok", AtMillis: ms + 16},
		{Name: "Authorization · Safe access", Detail: authzDetail, Meta: "safe authorization", Status: "ok", AtMillis: ms + 30},
		{Name: "Return credential", Detail: returnDetail, Meta: "masked", Status: "ok", AtMillis: ms + 44},
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

// simulate returns an illustrative outcome per scenario when no live CCP/cert is
// configured. The auth/authz denials are rendered as the EXPECTED result.
func (c *Client) simulate(s Scenario) retrieve.Result {
	res := c.base(s)
	res.Simulated = true
	appID := c.cfg.AppID
	if appID == "" {
		appID = "swa-demo-app"
	}
	cn := c.certCN
	if cn == "" {
		cn = "swa-demo-webapp"
	}
	safe := firstNonEmpty(c.cfg.Safe, "Demo-App-Safe")

	switch s {
	case NoCert:
		res.Identity = ""
		res.CCP = &retrieve.CCPInfo{AppID: appID, Safe: safe, Query: firstNonEmpty(c.cfg.Object, "db-credential")}
		res.SecretName = secretName(safe, firstNonEmpty(c.cfg.Object, "db-credential"), "")
		res.Error = "APPAP227E No client certificate presented — authentication rejected (403)."
		res.Steps = stepsAt(time.Now(), s, 1, res.Error)
		return res
	case Denied:
		deniedSafe := firstNonEmpty(c.cfg.DeniedSafe, "Restricted-Safe")
		res.Identity = cn
		res.CCP = &retrieve.CCPInfo{AppID: appID, CertCN: cn, Safe: deniedSafe, Query: firstNonEmpty(c.cfg.DeniedObject, "privileged-credential")}
		res.SecretName = secretName(deniedSafe, firstNonEmpty(c.cfg.DeniedObject, "privileged-credential"), "")
		res.Error = "APPAP004E Application '" + appID + "' is not authorized to access safe '" + deniedSafe + "' (403)."
		res.Steps = stepsAt(time.Now(), s, 2, res.Error)
		return res
	case Dual:
		dq := firstNonEmpty(c.cfg.DualQuery, "Safe="+safe+";VirtualUsername=svc-app-db")
		res.Identity = cn
		res.CCP = &retrieve.CCPInfo{AppID: appID, CertCN: cn, Safe: safe, Query: dq, Account: "svc-app-db-A", Address: "db.internal", DualActive: "svc-app-db-A (active)"}
		res.SecretName = "Query: " + dq
		res.Masked = retrieve.Mask([]byte("s1mul4ted-dual-active-secret"))
		res.Retrieved = true
		res.Steps = okSteps(time.Now(), s)
		return res
	default: // Authorized
		obj := firstNonEmpty(c.cfg.Object, "db-credential")
		res.Identity = cn
		res.CCP = &retrieve.CCPInfo{AppID: appID, CertCN: cn, Safe: safe, Query: obj, Account: "svc-app-db", Address: "db.internal"}
		res.SecretName = secretName(safe, obj, "")
		res.Masked = retrieve.Mask([]byte("s1mul4ted-ccp-secret-value"))
		res.Retrieved = true
		res.Steps = okSteps(time.Now(), s)
		return res
	}
}
