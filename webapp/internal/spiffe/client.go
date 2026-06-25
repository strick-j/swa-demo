// Package spiffe holds the real go-spiffe Workload API implementation of
// svid.Fetcher. It is imported only by main so the rest of the app (and its
// tests) need not depend on go-spiffe.
package spiffe

import (
	"context"
	"fmt"
	"time"

	"github.com/spiffe/go-spiffe/v2/svid/jwtsvid"
	"github.com/spiffe/go-spiffe/v2/workloadapi"

	"github.com/strick-j/swa-demo/webapp/internal/svid"
)

// Client fetches JWT-SVIDs from the SWA Agent Workload API over a Unix socket.
type Client struct {
	source     *workloadapi.JWTSource
	socketAddr string
}

// New connects to the Workload API at socketAddr (e.g. unix:///run/swa-agent/api.sock).
func New(ctx context.Context, socketAddr string) (*Client, error) {
	src, err := workloadapi.NewJWTSource(ctx,
		workloadapi.WithClientOptions(workloadapi.WithAddr(socketAddr)),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", svid.ErrUnavailable, err)
	}
	return &Client{source: src, socketAddr: socketAddr}, nil
}

// Close releases the underlying Workload API source.
func (c *Client) Close() error { return c.source.Close() }

// Source implements svid.Fetcher.
func (c *Client) Source() string { return c.socketAddr }

// FetchJWTSVID implements svid.Fetcher using the live agent.
func (c *Client) FetchJWTSVID(ctx context.Context, audience string) (*svid.Result, error) {
	start := time.Now()

	jwt, err := c.source.FetchJWTSVID(ctx, jwtsvid.Params{Audience: audience})
	if err != nil {
		return nil, fmt.Errorf("fetch jwt-svid: %w", err)
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
			Source:      c.socketAddr,
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
