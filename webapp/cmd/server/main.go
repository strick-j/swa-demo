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
	"github.com/strick-j/swa-demo/webapp/internal/handlers"
	"github.com/strick-j/swa-demo/webapp/internal/spiffe"
	"github.com/strick-j/swa-demo/webapp/internal/svid"
	"github.com/strick-j/swa-demo/webapp/internal/ui"
)

func main() {
	cfg := loadConfig()

	fetcher := buildFetcher(cfg)
	dbq := buildDB(cfg) // nil in demo mode / when the agent socket is unavailable

	tmpl, err := ui.IndexTemplate()
	if err != nil {
		log.Fatalf("parse template: %v", err)
	}
	static, err := ui.StaticFS()
	if err != nil {
		log.Fatalf("static fs: %v", err)
	}

	srv := handlers.New(fetcher, dbq, tmpl, static, handlers.Config{
		Audience:    cfg.audience,
		TrustDomain: cfg.trustDomain,
		SourceLabel: fetcher.Source(),
		ProbeURL:    cfg.probeURL,
	})

	httpServer := &http.Server{
		Addr:              ":" + cfg.port,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
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
		probeURL: env("PROBE_URL", ""),
	}
	return c
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

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
