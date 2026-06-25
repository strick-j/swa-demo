package svid

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"
)

// Fake is an in-memory Fetcher that mints a realistic-looking JWT-SVID without a
// live SWA Agent. Used for local UI development and as the default when no agent
// socket is present (DEMO mode), and as a deterministic-shape stand-in in tests.
type Fake struct {
	TrustDomain string
	NodeGroup   string
	Namespace   string
	ServiceAcct string
	TTL         time.Duration
	// now is injectable so tests are deterministic.
	now func() time.Time
}

// NewFake builds a Fake fetcher with sensible defaults.
func NewFake(trustDomain, nodeGroup, namespace, serviceAcct string) *Fake {
	return &Fake{
		TrustDomain: trustDomain,
		NodeGroup:   nodeGroup,
		Namespace:   namespace,
		ServiceAcct: serviceAcct,
		TTL:         5 * time.Minute,
		now:         time.Now,
	}
}

// Source implements Fetcher.
func (f *Fake) Source() string { return "demo (no agent socket)" }

// FetchJWTSVID implements Fetcher, returning a synthetic but well-formed SVID.
func (f *Fake) FetchJWTSVID(_ context.Context, audience string) (*Result, error) {
	issued := f.now()
	expires := issued.Add(f.TTL)
	// Matches the node-group SPIFFE ID template:
	// spiffe://{trustdomain}/{nodegroup}/ns/{ns}/sa/{sa}
	spiffeID := fmt.Sprintf("spiffe://%s/%s/ns/%s/sa/%s", f.TrustDomain, f.NodeGroup, f.Namespace, f.ServiceAcct)

	header := map[string]interface{}{
		"alg": "RS256",
		"typ": "JWT",
		"kid": "demo-signing-key",
	}
	claims := map[string]interface{}{
		"sub": spiffeID,
		"aud": []string{audience},
		"iss": fmt.Sprintf("https://%s", f.TrustDomain),
		"iat": issued.Unix(),
		"exp": expires.Unix(),
	}

	token, err := encodeToken(header, claims)
	if err != nil {
		return nil, err
	}

	return &Result{
		SPIFFEID:  spiffeID,
		Token:     token,
		Header:    header,
		Claims:    claims,
		Audience:  []string{audience},
		IssuedAt:  issued,
		ExpiresAt: expires,
		Steps: LifecycleSteps(StepInputs{
			Source:      f.Source(),
			Audience:    audience,
			Namespace:   f.Namespace,
			ServiceAcct: f.ServiceAcct,
			SPIFFEID:    spiffeID,
			Alg:         header["alg"].(string),
			Kid:         header["kid"].(string),
			TTL:         f.TTL,
			Start:       issued,
		}),
	}, nil
}

// encodeToken produces a base64url header.payload.signature string so the UI can
// decode the header/claims exactly as it would a real JWT-SVID.
func encodeToken(header, claims map[string]interface{}) (string, error) {
	h, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	c, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	sig := make([]byte, 32)
	if _, err := rand.Read(sig); err != nil {
		return "", err
	}
	enc := base64.RawURLEncoding.EncodeToString
	return fmt.Sprintf("%s.%s.%s", enc(h), enc(c), enc(sig)), nil
}
