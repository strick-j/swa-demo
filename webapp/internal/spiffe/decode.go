package spiffe

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
)

// decodeJWT splits a compact JWT and decodes its header and claims (without
// verifying the signature — the SVID is already verified by the Workload API).
func decodeJWT(token string) (header, claims map[string]interface{}, err error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, nil, fmt.Errorf("malformed jwt: expected 3 parts, got %d", len(parts))
	}
	if header, err = decodeSegment(parts[0]); err != nil {
		return nil, nil, fmt.Errorf("decode header: %w", err)
	}
	if claims, err = decodeSegment(parts[1]); err != nil {
		return nil, nil, fmt.Errorf("decode claims: %w", err)
	}
	return header, claims, nil
}

func decodeSegment(seg string) (map[string]interface{}, error) {
	raw, err := base64.RawURLEncoding.DecodeString(seg)
	if err != nil {
		return nil, err
	}
	out := map[string]interface{}{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}
