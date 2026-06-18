package spiffe

import (
	"encoding/base64"
	"testing"
)

func TestDecodeJWT(t *testing.T) {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	claims := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"spiffe://td/ns/x/sa/y","aud":["a"]}`))
	token := header + "." + claims + ".sig"

	h, c, err := decodeJWT(token)
	if err != nil {
		t.Fatalf("decodeJWT: %v", err)
	}
	if h["alg"] != "RS256" {
		t.Errorf("alg = %v, want RS256", h["alg"])
	}
	if c["sub"] != "spiffe://td/ns/x/sa/y" {
		t.Errorf("sub = %v", c["sub"])
	}
}

func TestDecodeJWT_Malformed(t *testing.T) {
	if _, _, err := decodeJWT("only.two"); err == nil {
		t.Error("expected error for 2-part token")
	}
	if _, _, err := decodeJWT("!!!.@@@.###"); err == nil {
		t.Error("expected error for non-base64 segments")
	}
}

func TestDecodeSegment_BadJSON(t *testing.T) {
	seg := base64.RawURLEncoding.EncodeToString([]byte(`not-json`))
	if _, err := decodeSegment(seg); err == nil {
		t.Error("expected json error")
	}
}
