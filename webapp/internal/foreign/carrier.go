// Package foreign demonstrates the trust-domain boundary: a workload that holds
// a perfectly valid X.509-SVID issued by a DIFFERENT trust domain (acme.courier)
// is rejected at mTLS because our SWA trust bundle never anchors its CA. There
// is no second SWA server and no registered second trust domain — the foreign
// identity is a throwaway CA minted in-process by a pod the SWA agent ignores.
// This mirrors infamousjoeg/idira-swa-demo's acme-carrier (M7).
package foreign

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"time"
)

// ACMESPIFFEURI is the foreign workload's SPIFFE ID. It lives under a trust
// domain (acme.courier) that our SWA server knows nothing about.
const ACMESPIFFEURI = "spiffe://acme.courier/carrier/parcel"

// MintIdentity generates a self-signed CA ("acme.courier root") and a leaf cert
// signed by it. The leaf carries the SPIFFE ID in its URI SAN and a DNS SAN so
// Go's TLS verifier passes the hostname check and proceeds to chain validation
// — producing the intended "certificate signed by unknown authority" rather
// than a hostname-mismatch. The returned chain (leaf, CA) still does NOT verify
// against the SWA trust bundle, which is the entire point.
func MintIdentity(dnsName string) (*tls.Certificate, error) {
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("ca key: %w", err)
	}
	caSerial, err := randomSerial()
	if err != nil {
		return nil, fmt.Errorf("ca serial: %w", err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber:          caSerial,
		Subject:               pkix.Name{CommonName: "acme.courier root"},
		NotBefore:             time.Now().Add(-1 * time.Minute),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		return nil, fmt.Errorf("create ca cert: %w", err)
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		return nil, fmt.Errorf("parse ca cert: %w", err)
	}

	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("leaf key: %w", err)
	}
	leafSerial, err := randomSerial()
	if err != nil {
		return nil, fmt.Errorf("leaf serial: %w", err)
	}
	spiffeURI, err := url.Parse(ACMESPIFFEURI)
	if err != nil {
		return nil, fmt.Errorf("parse spiffe uri: %w", err)
	}
	leafTmpl := &x509.Certificate{
		SerialNumber: leafSerial,
		Subject:      pkix.Name{}, // SPIFFE identity lives in the SAN URI
		NotBefore:    time.Now().Add(-1 * time.Minute),
		NotAfter:     time.Now().Add(90 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		URIs:         []*url.URL{spiffeURI},
		DNSNames:     []string{dnsName},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTmpl, caCert, &leafKey.PublicKey, caKey)
	if err != nil {
		return nil, fmt.Errorf("create leaf cert: %w", err)
	}

	return &tls.Certificate{
		Certificate: [][]byte{leafDER, caDER},
		PrivateKey:  leafKey,
	}, nil
}

func randomSerial() (*big.Int, error) {
	max := new(big.Int).Lsh(big.NewInt(1), 128)
	return rand.Int(rand.Reader, max)
}

// RunCarrier serves the foreign workload: mTLS on mtlsAddr presenting the
// self-minted acme.courier identity (accepting any client cert — the demo tests
// OUR rejection of it, not the reverse), plus a plain-HTTP health endpoint on
// healthAddr so kubelet probes don't need a client cert. Blocks until the mTLS
// server stops.
func RunCarrier(mtlsAddr, healthAddr, dnsName string) error {
	leaf, err := MintIdentity(dnsName)
	if err != nil {
		return err
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/lookup/", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"carrier":"acme.courier","note":"if you can read this, mTLS unexpectedly succeeded"}`))
	})

	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{*leaf},
		ClientAuth:   tls.RequireAnyClientCert,
		MinVersion:   tls.VersionTLS13,
	}
	srv := &http.Server{
		Addr:              mtlsAddr,
		Handler:           mux,
		TLSConfig:         tlsCfg,
		ReadHeaderTimeout: 5 * time.Second,
	}

	health := &http.Server{
		Addr:              healthAddr,
		Handler:           http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		if err := health.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("foreign-carrier: health server: %v", err)
		}
	}()

	log.Printf("foreign-carrier: mTLS on %s; health on %s; SPIFFE id %s (trust domain acme.courier)", mtlsAddr, healthAddr, ACMESPIFFEURI)
	if err := srv.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
