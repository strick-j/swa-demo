package foreign

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"testing"
	"time"
)

func TestMintIdentity(t *testing.T) {
	cert, err := MintIdentity("foreign-carrier.acme-external.svc.cluster.local")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if len(cert.Certificate) != 2 {
		t.Fatalf("expected leaf+CA chain, got %d certs", len(cert.Certificate))
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatalf("parse leaf: %v", err)
	}
	if len(leaf.URIs) != 1 || leaf.URIs[0].String() != ACMESPIFFEURI {
		t.Errorf("leaf URIs = %v, want [%s]", leaf.URIs, ACMESPIFFEURI)
	}
	if leaf.Issuer.CommonName != "acme.courier root" {
		t.Errorf("issuer = %q, want acme.courier root", leaf.Issuer.CommonName)
	}
}

// A standard Go verifier (empty/foreign roots) must reject the minted cert with
// a CertificateVerificationError that still carries the foreign SAN URI — the
// exact mechanic the Prober relies on.
func TestForeignHandshakeRejected(t *testing.T) {
	leaf, err := MintIdentity("localhost")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{
		Certificates: []tls.Certificate{*leaf},
		MinVersion:   tls.VersionTLS13,
	})
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				if tc, ok := conn.(*tls.Conn); ok {
					_ = tc.Handshake()
				}
				_ = conn.Close()
			}()
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	dialer := &tls.Dialer{Config: &tls.Config{
		RootCAs:    x509.NewCertPool(), // anchors nothing — foreign CA can't verify
		ServerName: "localhost",
		MinVersion: tls.VersionTLS13,
	}}
	conn, err := dialer.DialContext(ctx, "tcp", ln.Addr().String())
	if err == nil {
		_ = conn.(net.Conn).Close()
		t.Fatal("handshake unexpectedly succeeded; want rejection")
	}
	var cve *tls.CertificateVerificationError
	if !errors.As(err, &cve) {
		t.Fatalf("want CertificateVerificationError, got %v", err)
	}
	if len(cve.UnverifiedCertificates) == 0 {
		t.Fatal("no unverified certificates captured")
	}
	seen := cve.UnverifiedCertificates[0]
	if len(seen.URIs) == 0 || seen.URIs[0].String() != ACMESPIFFEURI {
		t.Errorf("peer URI = %v, want %s", seen.URIs, ACMESPIFFEURI)
	}
}
