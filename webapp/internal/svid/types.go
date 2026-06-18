// Package svid defines the transport-agnostic JWT-SVID types and the Fetcher
// interface. It intentionally does NOT import go-spiffe so the HTTP/UI layer and
// its tests can compile and run without the SPIFFE Workload API dependency.
package svid

import (
	"context"
	"errors"
	"time"
)

// ErrUnavailable indicates the Workload API / agent could not be reached.
var ErrUnavailable = errors.New("svid: workload api unavailable")

// Step is one stage in the identity-issuance lifecycle, surfaced to the UI.
type Step struct {
	Name    string `json:"name"`
	Detail  string `json:"detail"`
	Status  string `json:"status"` // "ok" | "pending" | "error"
	AtMillis int64 `json:"at_millis"`
}

// Result is a decoded JWT-SVID plus the lifecycle steps that produced it.
type Result struct {
	SPIFFEID  string                 `json:"spiffe_id"`
	Token     string                 `json:"token"`
	Header    map[string]interface{} `json:"header"`
	Claims    map[string]interface{} `json:"claims"`
	Audience  []string               `json:"audience"`
	IssuedAt  time.Time              `json:"issued_at"`
	ExpiresAt time.Time              `json:"expires_at"`
	Steps     []Step                 `json:"steps"`
}

// Fetcher obtains a JWT-SVID for the given audience from the SWA Agent.
type Fetcher interface {
	FetchJWTSVID(ctx context.Context, audience string) (*Result, error)
	// Source describes where SVIDs come from (e.g. the socket path or "demo").
	Source() string
}
