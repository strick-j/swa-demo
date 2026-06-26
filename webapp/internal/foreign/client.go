package foreign

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"sync"

	"github.com/spiffe/go-spiffe/v2/spiffeid"
	"github.com/spiffe/go-spiffe/v2/workloadapi"
)

// Result is the outcome of our trusted app dialing the foreign carrier. The
// expected outcome is Rejected=true with a "certificate signed by unknown
// authority" error and the foreign peer's SAN URI captured for display.
type Result struct {
	Rejected bool   `json:"rejected"`
	PeerURI  string `json:"peer_uri,omitempty"` // foreign SAN URI we saw
	Issuer   string `json:"issuer,omitempty"`   // foreign CA common name
	OwnID    string `json:"own_id,omitempty"`   // our (client) SPIFFE ID
	Error    string `json:"error,omitempty"`
}

// Prober dials a host that is intentionally OUTSIDE our trust domain, using
// Go's STANDARD verifier with the SWA trust bundle as RootCAs — exactly as a
// trusted workload would. A foreign CA therefore fails to anchor and the
// handshake is rejected, which is the demonstration.
//
// The X509Source is created LAZILY on the first Probe (within the request's
// context budget) rather than at construction, so a slow agent at startup never
// blocks boot or forces the synthesized fallback.
type Prober struct {
	socketAddr  string
	carrierAddr string
	trustDomain spiffeid.TrustDomain

	mu     sync.Mutex
	source *workloadapi.X509Source
}

// NewProber validates config and returns a Prober. It does NOT contact the
// Workload API yet — that happens on the first Probe.
func NewProber(socketAddr, carrierAddr, trustDomain string) (*Prober, error) {
	td, err := spiffeid.TrustDomainFromString(trustDomain)
	if err != nil {
		return nil, fmt.Errorf("trust domain: %w", err)
	}
	return &Prober{socketAddr: socketAddr, carrierAddr: carrierAddr, trustDomain: td}, nil
}

// ensureSource builds (and caches) the X509Source using the caller's context.
func (p *Prober) ensureSource(ctx context.Context) (*workloadapi.X509Source, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.source != nil {
		return p.source, nil
	}
	src, err := workloadapi.NewX509Source(ctx,
		workloadapi.WithClientOptions(workloadapi.WithAddr(p.socketAddr)),
	)
	if err != nil {
		return nil, fmt.Errorf("x509 source: %w", err)
	}
	p.source = src
	return src, nil
}

// Probe attempts the mTLS handshake and reports the (expected) rejection.
func (p *Prober) Probe(ctx context.Context) Result {
	res := Result{}

	source, err := p.ensureSource(ctx)
	if err != nil {
		res.Error = err.Error()
		return res
	}

	svid, err := source.GetX509SVID()
	if err != nil {
		res.Error = "own svid: " + err.Error()
		return res
	}
	res.OwnID = svid.ID.String()

	bundle, err := source.GetX509BundleForTrustDomain(p.trustDomain)
	if err != nil {
		res.Error = "trust bundle: " + err.Error()
		return res
	}
	pool := x509.NewCertPool()
	for _, c := range bundle.X509Authorities() {
		pool.AddCert(c)
	}

	clientCert := tls.Certificate{PrivateKey: svid.PrivateKey}
	for _, c := range svid.Certificates {
		clientCert.Certificate = append(clientCert.Certificate, c.Raw)
	}

	dialer := &tls.Dialer{Config: &tls.Config{
		Certificates:       []tls.Certificate{clientCert},
		RootCAs:            pool,
		InsecureSkipVerify: false, // STANDARD verification — we WANT rejection
		MinVersion:         tls.VersionTLS13,
	}}

	conn, err := dialer.DialContext(ctx, "tcp", p.carrierAddr)
	if err != nil {
		var cve *tls.CertificateVerificationError
		if errors.As(err, &cve) && len(cve.UnverifiedCertificates) > 0 {
			res.Rejected = true
			leaf := cve.UnverifiedCertificates[0]
			if len(leaf.URIs) > 0 {
				res.PeerURI = leaf.URIs[0].String()
			}
			res.Issuer = leaf.Issuer.CommonName
		}
		res.Error = err.Error()
		return res
	}
	// A successful handshake against the foreign peer is unexpected.
	_ = conn.Close()
	res.Error = "handshake unexpectedly succeeded (expected rejection at the trust boundary)"
	return res
}

// Close releases the X509Source, if one was created.
func (p *Prober) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.source != nil {
		p.source.Close()
	}
}
