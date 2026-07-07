// Command server runs the swa-demo webapp: it requests a JWT-SVID from the SWA
// Agent Workload API and serves a visual UI of the request -> validation -> SVID flow.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/strick-j/swa-demo/webapp/internal/db"
	"github.com/strick-j/swa-demo/webapp/internal/foreign"
	"github.com/strick-j/swa-demo/webapp/internal/handlers"
	"github.com/strick-j/swa-demo/webapp/internal/retrieve"
	"github.com/strick-j/swa-demo/webapp/internal/retrieve/ccp"
	"github.com/strick-j/swa-demo/webapp/internal/retrieve/conjuriam"
	"github.com/strick-j/swa-demo/webapp/internal/retrieve/conjurjwt"
	"github.com/strick-j/swa-demo/webapp/internal/retrieve/cp"
	"github.com/strick-j/swa-demo/webapp/internal/spiffe"
	"github.com/strick-j/swa-demo/webapp/internal/svid"
	"github.com/strick-j/swa-demo/webapp/internal/ui"
)

func main() {
	cfg := loadConfig()

	// Foreign-carrier mode: this pod is NOT a SWA workload. It serves a
	// self-minted acme.courier mTLS identity that our trusted app rejects.
	if cfg.foreignCarrierMode {
		log.Printf("FOREIGN_CARRIER_MODE: serving self-signed acme.courier mTLS carrier")
		if err := foreign.RunCarrier(":8443", ":8444", cfg.foreignDNSName); err != nil {
			log.Fatalf("foreign carrier: %v", err)
		}
		return
	}

	fetcher := buildFetcher(cfg)
	dbq := buildDB(cfg)     // nil in demo mode / when the agent socket is unavailable
	fp := buildForeign(cfg) // nil unless a live agent + FOREIGN_CARRIER_ADDR are set

	pages, err := loadPages()
	if err != nil {
		log.Fatalf("parse templates: %v", err)
	}
	static, err := ui.StaticFS()
	if err != nil {
		log.Fatalf("static fs: %v", err)
	}
	cpApp, err := ui.CPApp()
	if err != nil {
		log.Printf("CP inspector SPA unavailable (%v); /cp falls back to the legacy page", err)
		cpApp = nil
	}

	registry, jwtSimulated, iamSimulated := buildRegistry(cfg, fetcher)
	ccpClient := buildCCP(cfg)
	registry.Register(ccpClient) // flips the CCP catalog card to available
	cpClient := buildCP(cfg)
	registry.Register(cpClient) // flips the CP catalog card to available

	srv := handlers.New(handlers.Deps{
		Fetcher:  fetcher,
		DB:       dbq,
		Foreign:  fp,
		Registry: registry,
		CCP:      ccpClient,
		CP:       cpClient,
		Pages:    pages,
		Static:   static,
		CPApp:    cpApp,
		Cfg: handlers.Config{
			Audience:           cfg.audience,
			TrustDomain:        cfg.trustDomain,
			SourceLabel:        fetcher.Source(),
			ProbeURL:           cfg.probeURL,
			UntrustedSVIDURL:   cfg.untrustedSVIDURL,
			UnknownSVIDURL:     cfg.unknownSVIDURL,
			Demo:               cfg.demoMode || cfg.socketAddr == "",
			ConjurServiceID:    cfg.conjurJWTServiceID,
			ConjurSecretPath:   cfg.conjurJWTSecretPath,
			ConjurSimulated:    jwtSimulated,
			ConjurIAMService:   cfg.conjurIAMServiceID,
			ConjurIAMHostID:    cfg.conjurIAMHostID,
			ConjurIAMSecret:    cfg.conjurIAMSecretPath,
			ConjurIAMSimulated: iamSimulated,
		},
	})

	httpServer := &http.Server{
		Addr:              ":" + cfg.port,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
		// Bound every phase of a connection so a slow/hung client can't hold a
		// worker open. WriteTimeout must exceed the slowest handler's own
		// context (handleAPISWA/handleConjur use 20s), so 30s leaves margin.
		ReadTimeout:    15 * time.Second,
		WriteTimeout:   30 * time.Second,
		IdleTimeout:    60 * time.Second,
		MaxHeaderBytes: 1 << 20, // 1 MiB cap on request headers
	}
	log.Printf("swa-demo webapp listening on :%s (svid source: %s)", cfg.port, fetcher.Source())
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server: %v", err)
	}
}

type config struct {
	port        string
	audience    string
	trustDomain string
	nodeGroup   string
	namespace   string
	serviceAcct string
	socketAddr  string
	demoMode    bool
	gatewayAddr string
	dbUser      string
	dbName      string
	probeURL    string
	// rogueMode marks this pod as the "unknown" workload: it must surface a
	// genuine issuance refusal, so it uses the one-shot fetcher and never falls
	// back to the synthetic SVID.
	rogueMode bool
	// untrustedSVIDURL / unknownSVIDURL are the probe pods' /probe-svid URLs,
	// relayed by the main webapp to populate the scenario switcher.
	untrustedSVIDURL string
	unknownSVIDURL   string
	// foreignCarrierMode makes this pod serve the self-signed acme.courier mTLS
	// carrier (a foreign trust domain) instead of the webapp. foreignCarrierAddr
	// is where the main webapp dials it; foreignDNSName is the carrier's DNS SAN.
	foreignCarrierMode bool
	foreignCarrierAddr string
	foreignDNSName     string
	// Conjur authn-jwt (Secrets Manager SaaS) config. When the appliance URL /
	// secret path are empty (or there's no agent), the retriever simulates.
	conjurApplianceURL  string
	conjurAccount       string
	conjurJWTServiceID  string
	conjurJWTSecretPath string
	conjurJWTAudience   string
	// Conjur authn-iam (Secrets Manager SaaS) config. When the appliance URL /
	// host id / secret path are empty (or DEMO_MODE), the retriever simulates.
	// AWS credentials come from the default chain (instance profile via IMDS).
	conjurIAMServiceID  string
	conjurIAMHostID     string
	conjurIAMSecretPath string
	awsRegion           string
	// CCP (Central Credential Provider / AIMWebService) config. Simulated until
	// the host, app id, and client cert/key are set.
	ccpBaseURL      string
	ccpAppID        string
	ccpSafe         string
	ccpObject       string
	ccpDeniedSafe   string
	ccpDeniedObject string
	ccpDualQuery    string
	ccpCertFile     string
	ccpKeyFile      string
	ccpInsecure     bool
	// CP (local Credential Provider) config. The webapp reaches the host-installed
	// CP through the cp-bridge; the bridge holds the safe/object/dual coordinates.
	// Simulated/error until CP_BRIDGE_URL is set. Live-only by design.
	cpBridgeURL string
	cpAppID     string
}

func loadConfig() config {
	c := config{
		port:        env("PORT", "8080"),
		audience:    env("WEBAPP_JWT_AUDIENCE", "swa-demo-audience"),
		trustDomain: env("SWA_TRUST_DOMAIN", "swa-demo.example.com"),
		nodeGroup:   env("SWA_NODE_GROUP", "minikube-nodes"),
		namespace:   env("NS_DEMO", "swa-demo"),
		serviceAcct: env("WEBAPP_SA", "swa-demo-webapp"),
		socketAddr:  socketAddr(),
		demoMode:    strings.EqualFold(env("DEMO_MODE", "false"), "true"),
		gatewayAddr: env("PG_GATEWAY_ADDR", "pg-gateway.swa-data.svc.cluster.local:6432"),
		dbUser:      env("DB_USER", "appuser"),
		dbName:      env("DB_NAME", "swa"),
		// Set on the main webapp to the untrusted probe's /probe URL; empty on
		// the probe itself (and in demo mode).
		probeURL:         env("PROBE_URL", ""),
		rogueMode:        strings.EqualFold(env("ROGUE_MODE", "false"), "true"),
		untrustedSVIDURL: env("UNTRUSTED_SVID_URL", ""),
		unknownSVIDURL:   env("UNKNOWN_SVID_URL", ""),

		foreignCarrierMode: strings.EqualFold(env("FOREIGN_CARRIER_MODE", "false"), "true"),
		foreignCarrierAddr: env("FOREIGN_CARRIER_ADDR", ""),
		foreignDNSName:     env("FOREIGN_DNS_NAME", "foreign-carrier.acme-external.svc.cluster.local"),

		conjurApplianceURL:  env("CONJUR_APPLIANCE_URL", ""),
		conjurAccount:       env("CONJUR_ACCOUNT", "conjur"),
		conjurJWTServiceID:  env("CONJUR_AUTHN_JWT_SERVICE_ID", "authn-jwt/swa"),
		conjurJWTSecretPath: env("CONJUR_JWT_SECRET_PATH", "data/secrets/demo-db-password"),
		conjurJWTAudience:   env("CONJUR_JWT_AUDIENCE", "conjur"),

		conjurIAMServiceID:  env("CONJUR_AUTHN_IAM_SERVICE_ID", ""),
		conjurIAMHostID:     env("CONJUR_IAM_HOST_ID", ""),
		conjurIAMSecretPath: env("CONJUR_IAM_SECRET_PATH", "data/secrets/demo-db-password"),
		awsRegion:           env("AWS_REGION", "us-east-1"),

		ccpBaseURL:      env("CCP_BASE_URL", ""),
		ccpAppID:        env("CCP_APP_ID", ""),
		ccpSafe:         env("CCP_SAFE", ""),
		ccpObject:       env("CCP_OBJECT", ""),
		ccpDeniedSafe:   env("CCP_DENIED_SAFE", ""),
		ccpDeniedObject: env("CCP_DENIED_OBJECT", ""),
		ccpDualQuery:    env("CCP_DUAL_QUERY", ""),
		ccpCertFile:     env("CCP_CLIENT_CERT", ""),
		ccpKeyFile:      env("CCP_CLIENT_KEY", ""),
		ccpInsecure:     strings.EqualFold(env("CCP_INSECURE_SKIP_VERIFY", "false"), "true"),

		cpBridgeURL: env("CP_BRIDGE_URL", ""),
		cpAppID:     env("CP_APP_ID", ""),
	}
	return c
}

// loadPages parses every page template from the embedded ui package.
func loadPages() (handlers.Pages, error) {
	landing, err := ui.Page("landing.html")
	if err != nil {
		return handlers.Pages{}, err
	}
	swa, err := ui.Page("swa.html")
	if err != nil {
		return handlers.Pages{}, err
	}
	sm, err := ui.Page("secrets-manager.html")
	if err != nil {
		return handlers.Pages{}, err
	}
	ccpPage, err := ui.Page("credential-providers.html")
	if err != nil {
		return handlers.Pages{}, err
	}
	cpPage, err := ui.Page("credential-provider.html")
	if err != nil {
		return handlers.Pages{}, err
	}
	return handlers.Pages{Landing: landing, SWA: swa, SecretsManager: sm, CredentialProviders: ccpPage, CredentialProvider: cpPage}, nil
}

// buildCCP wires the Central Credential Provider client. It runs live when not in
// demo mode and the host, app id, and client cert/key are all set; otherwise (or
// if the cert fails to load) it runs simulated.
func buildCCP(cfg config) *ccp.Client {
	live := !cfg.demoMode && cfg.ccpBaseURL != "" && cfg.ccpAppID != "" &&
		cfg.ccpCertFile != "" && cfg.ccpKeyFile != ""
	ccfg := ccp.Config{
		BaseURL:            cfg.ccpBaseURL,
		AppID:              cfg.ccpAppID,
		Safe:               cfg.ccpSafe,
		Object:             cfg.ccpObject,
		DeniedSafe:         cfg.ccpDeniedSafe,
		DeniedObject:       cfg.ccpDeniedObject,
		DualQuery:          cfg.ccpDualQuery,
		CertFile:           cfg.ccpCertFile,
		KeyFile:            cfg.ccpKeyFile,
		InsecureSkipVerify: cfg.ccpInsecure,
		Live:               live,
	}
	client, err := ccp.New(ccfg)
	if err != nil {
		log.Printf("CCP: %v — running simulated", err)
		ccfg.Live = false
		client, _ = ccp.New(ccfg)
	}
	return client
}

// buildCP wires the local Credential Provider client. It runs live when not in
// demo mode and the cp-bridge URL is set; otherwise every scenario returns the
// explicit not-configured error (this mode has no synthesized happy path — the
// credential really comes from the host CP).
func buildCP(cfg config) *cp.Client {
	live := !cfg.demoMode && cfg.cpBridgeURL != ""
	return cp.New(cp.Config{
		BridgeURL: cfg.cpBridgeURL,
		AppID:     cfg.cpAppID,
		Live:      live,
	})
}

// buildRegistry wires the retrievers and returns the registry plus whether the
// Conjur JWT and IAM modes will run simulated (no live agent / Conjur / AWS).
func buildRegistry(cfg config, fetcher svid.Fetcher) (reg *retrieve.Registry, jwtSimulated, iamSimulated bool) {
	reg = retrieve.NewRegistry()

	// authn-jwt: live needs the agent socket (for the JWT-SVID) + Conjur config.
	jwtLive := !cfg.demoMode && cfg.socketAddr != "" &&
		cfg.conjurApplianceURL != "" && cfg.conjurJWTSecretPath != ""

	var jwt conjurjwt.JWTProvider
	if jwtLive {
		jwt = func(ctx context.Context, audience string) (string, string, error) {
			r, err := fetcher.FetchJWTSVID(ctx, audience)
			if err != nil {
				return "", "", err
			}
			return r.Token, r.SPIFFEID, nil
		}
	}
	reg.Register(conjurjwt.New(conjurjwt.Config{
		ApplianceURL: cfg.conjurApplianceURL,
		Account:      cfg.conjurAccount,
		ServiceID:    cfg.conjurJWTServiceID,
		SecretPath:   cfg.conjurJWTSecretPath,
		Audience:     cfg.conjurJWTAudience,
	}, jwt))

	// authn-iam: live needs Conjur config + an IAM host id; AWS credentials come
	// from the default chain (instance profile via IMDS) at call time.
	iamLive := !cfg.demoMode && cfg.conjurApplianceURL != "" &&
		cfg.conjurIAMServiceID != "" && cfg.conjurIAMHostID != "" &&
		cfg.conjurIAMSecretPath != ""
	reg.Register(conjuriam.New(conjuriam.Config{
		ApplianceURL: cfg.conjurApplianceURL,
		Account:      cfg.conjurAccount,
		ServiceID:    cfg.conjurIAMServiceID,
		HostID:       cfg.conjurIAMHostID,
		SecretPath:   cfg.conjurIAMSecretPath,
		Region:       cfg.awsRegion,
		Live:         iamLive,
	}))

	return reg, !jwtLive, !iamLive
}

// socketAddr resolves the Workload API endpoint from the standard env var or our
// own override, normalising to a unix:// address.
func socketAddr() string {
	for _, key := range []string{"SPIFFE_ENDPOINT_SOCKET", "SWA_AGENT_SOCKET"} {
		if v := os.Getenv(key); v != "" {
			if strings.Contains(v, "://") {
				return v
			}
			return "unix://" + v
		}
	}
	return ""
}

// buildFetcher returns the live SWA Agent client, falling back to the demo Fake
// when DEMO_MODE is set or the agent socket is unavailable.
func buildFetcher(cfg config) svid.Fetcher {
	// The unknown workload must report a REAL refusal — never a synthetic SVID.
	if cfg.rogueMode {
		log.Printf("ROGUE_MODE: using one-shot svid source (expects issuance refusal) socket=%q", cfg.socketAddr)
		return spiffe.NewOneShot(cfg.socketAddr)
	}
	if cfg.demoMode || cfg.socketAddr == "" {
		log.Printf("using DEMO svid source (demoMode=%v, socket=%q)", cfg.demoMode, cfg.socketAddr)
		return svid.NewFake(cfg.trustDomain, cfg.nodeGroup, cfg.namespace, cfg.serviceAcct)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := spiffe.New(ctx, cfg.socketAddr)
	if err != nil {
		log.Printf("WARNING: could not connect to Workload API at %s (%v); falling back to DEMO mode", cfg.socketAddr, err)
		return svid.NewFake(cfg.trustDomain, cfg.nodeGroup, cfg.namespace, cfg.serviceAcct)
	}
	return client
}

// buildDB returns a DB client that reaches Postgres through the SPIFFE gateway
// using this pod's X.509-SVID. Returns nil in demo mode / when the agent is
// unavailable, in which case /api/db reports DB access as unavailable.
func buildDB(cfg config) handlers.DBQuerier {
	if cfg.demoMode || cfg.socketAddr == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client, err := db.New(ctx, cfg.socketAddr, cfg.gatewayAddr, cfg.trustDomain, cfg.dbUser, cfg.dbName)
	if err != nil {
		log.Printf("WARNING: DB client unavailable (%v); DB access disabled", err)
		return nil
	}
	return client
}

// buildForeign returns a prober that dials the foreign-trust-domain carrier with
// this pod's X.509-SVID and the SWA trust bundle. Returns nil in demo mode / when
// the agent is unavailable / when no carrier address is configured, in which case
// the scenarios endpoint synthesizes the rejection.
func buildForeign(cfg config) handlers.ForeignProber {
	if cfg.demoMode || cfg.socketAddr == "" || cfg.foreignCarrierAddr == "" {
		return nil
	}
	// NewProber does not contact the Workload API — the X509Source is created
	// lazily on the first /api/scenarios request, so a slow agent at startup
	// never forces the synthesized fallback.
	p, err := foreign.NewProber(cfg.socketAddr, cfg.foreignCarrierAddr, cfg.trustDomain)
	if err != nil {
		log.Printf("WARNING: foreign prober unavailable (%v); foreign scenario synthesized", err)
		return nil
	}
	return p
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
