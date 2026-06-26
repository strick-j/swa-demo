// Package db reads the demo Postgres data through the SPIFFE mTLS gateway. The
// workload's X.509-SVID is the ONLY credential: a custom DialFunc opens an mTLS
// tunnel to the gateway (which authorizes by SPIFFE ID), and pgx then speaks
// plaintext Postgres over that tunnel (ghostunnel handles TLS, not libpq). An
// unauthorized SPIFFE ID gets a valid SVID but is rejected at the gateway, so
// the same call returns a TLS/connection error instead of rows.
package db

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"

	"github.com/jackc/pgx/v5"
	"github.com/spiffe/go-spiffe/v2/spiffeid"
	"github.com/spiffe/go-spiffe/v2/spiffetls/tlsconfig"
	"github.com/spiffe/go-spiffe/v2/workloadapi"
)

// Shipment is one row of the demo data, surfaced to the UI.
type Shipment struct {
	Ref         string `json:"ref"`
	Origin      string `json:"origin"`
	Destination string `json:"destination"`
	Status      string `json:"status"`
	Carrier     string `json:"carrier"`
}

// Result is the outcome of a DB read attempt (allowed + rows, or denied + error).
type Result struct {
	Allowed  bool       `json:"allowed"`
	SPIFFEID string     `json:"spiffe_id,omitempty"`
	Rows     []Shipment `json:"rows,omitempty"`
	Error    string     `json:"error,omitempty"`
}

// Client dials Postgres through the SPIFFE gateway using its X.509-SVID.
type Client struct {
	source      *workloadapi.X509Source
	gatewayAddr string
	trustDomain spiffeid.TrustDomain
	dbUser      string
	dbName      string
}

// New builds a Client backed by an X509Source from the agent Workload API.
func New(ctx context.Context, socketAddr, gatewayAddr, trustDomain, dbUser, dbName string) (*Client, error) {
	src, err := workloadapi.NewX509Source(ctx,
		workloadapi.WithClientOptions(workloadapi.WithAddr(socketAddr)),
	)
	if err != nil {
		return nil, fmt.Errorf("x509 source: %w", err)
	}
	td, err := spiffeid.TrustDomainFromString(trustDomain)
	if err != nil {
		src.Close()
		return nil, fmt.Errorf("trust domain: %w", err)
	}
	return &Client{source: src, gatewayAddr: gatewayAddr, trustDomain: td, dbUser: dbUser, dbName: dbName}, nil
}

// SPIFFEID returns the workload's own SPIFFE ID (for display), best-effort.
func (c *Client) SPIFFEID() string {
	if svid, err := c.source.GetX509SVID(); err == nil {
		return svid.ID.String()
	}
	return ""
}

// Query reads shipments through the gateway. The X.509-SVID is the credential;
// the gateway authorizes by SPIFFE ID. A denied identity yields Allowed=false.
func (c *Client) Query(ctx context.Context) Result {
	res := Result{SPIFFEID: c.SPIFFEID()}

	// Verify the gateway's server SVID is a member of our trust domain; present
	// our own SVID as the client cert. SPIFFE verifies by URI SAN, not DNS.
	tlsCfg := tlsconfig.MTLSClientConfig(c.source, c.source, tlsconfig.AuthorizeMemberOf(c.trustDomain))

	cfg, err := pgx.ParseConfig(fmt.Sprintf("postgres://%s@%s/%s?sslmode=disable", c.dbUser, c.gatewayAddr, c.dbName))
	if err != nil {
		res.Error = err.Error()
		return res
	}
	// Open the mTLS tunnel to the gateway; pgx then runs plaintext Postgres over it.
	cfg.DialFunc = func(ctx context.Context, _, _ string) (net.Conn, error) {
		d := tls.Dialer{Config: tlsCfg}
		return d.DialContext(ctx, "tcp", c.gatewayAddr)
	}

	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer conn.Close(ctx)

	rows, err := conn.Query(ctx, "SELECT ref, origin, destination, status, carrier FROM shipments ORDER BY id")
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer rows.Close()

	for rows.Next() {
		var s Shipment
		if err := rows.Scan(&s.Ref, &s.Origin, &s.Destination, &s.Status, &s.Carrier); err != nil {
			res.Error = err.Error()
			return res
		}
		res.Rows = append(res.Rows, s)
	}
	if err := rows.Err(); err != nil {
		res.Error = err.Error()
		return res
	}
	res.Allowed = true
	return res
}

// Close releases the X509Source.
func (c *Client) Close() {
	if c.source != nil {
		c.source.Close()
	}
}
