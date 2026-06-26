package spiffe

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/spiffe/go-spiffe/v2/svid/jwtsvid"
	"github.com/spiffe/go-spiffe/v2/workloadapi"

	"github.com/strick-j/swa-demo/webapp/internal/svid"
)

// OneShot is a Fetcher that performs a single Workload API RPC per request and
// returns the agent's raw outcome — it never falls back to a synthetic SVID.
// It backs the "unknown" workload (no registration policy): the point is to
// surface a GENUINE issuance refusal, so a fake success would defeat the demo.
// Unlike the streaming JWTSource, the package-level fetch does not watch trust
// bundles, so an unregistered workload returns its PermissionDenied promptly
// instead of blocking on a bundle update that never arrives.
type OneShot struct {
	socketAddr string
}

// NewOneShot returns a one-shot Fetcher bound to the Workload API socket.
func NewOneShot(socketAddr string) *OneShot {
	return &OneShot{socketAddr: socketAddr}
}

// Source implements svid.Fetcher.
func (o *OneShot) Source() string { return o.socketAddr + " (one-shot)" }

// FetchJWTSVID implements svid.Fetcher with a single RPC. For a workload with no
// registration entry the agent returns no identity, surfaced here as an error.
func (o *OneShot) FetchJWTSVID(ctx context.Context, audience string) (*svid.Result, error) {
	if o.socketAddr == "" {
		return nil, fmt.Errorf("%w: no workload api socket", svid.ErrUnavailable)
	}
	start := time.Now()

	jwt, err := workloadapi.FetchJWTSVID(ctx, jwtsvid.Params{Audience: audience},
		workloadapi.WithAddr(o.socketAddr))
	if err != nil {
		return nil, fmt.Errorf("no identity issued: %w", err)
	}
	if jwt == nil {
		return nil, errors.New("no identity issued: workload api returned no SVID")
	}

	token := jwt.Marshal()
	header, claims, err := decodeJWT(token)
	if err != nil {
		return nil, err
	}
	id := jwt.ID.String()
	ns, sa := svid.ParseNsSa(id)
	alg, _ := header["alg"].(string)
	kid, _ := header["kid"].(string)

	return &svid.Result{
		SPIFFEID:  id,
		Token:     token,
		Header:    header,
		Claims:    claims,
		Audience:  jwt.Audience,
		IssuedAt:  start,
		ExpiresAt: jwt.Expiry,
		Steps: svid.LifecycleSteps(svid.StepInputs{
			Source:      o.socketAddr,
			Audience:    audience,
			Namespace:   ns,
			ServiceAcct: sa,
			SPIFFEID:    id,
			Alg:         alg,
			Kid:         kid,
			TTL:         jwt.Expiry.Sub(start),
			Start:       start,
		}),
	}, nil
}
