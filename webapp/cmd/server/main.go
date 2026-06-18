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

	"github.com/strick-j/swa-demo/webapp/internal/handlers"
	"github.com/strick-j/swa-demo/webapp/internal/spiffe"
	"github.com/strick-j/swa-demo/webapp/internal/svid"
	"github.com/strick-j/swa-demo/webapp/internal/ui"
)

func main() {
	cfg := loadConfig()

	fetcher := buildFetcher(cfg)

	tmpl, err := ui.IndexTemplate()
	if err != nil {
		log.Fatalf("parse template: %v", err)
	}
	static, err := ui.StaticFS()
	if err != nil {
		log.Fatalf("static fs: %v", err)
	}

	srv := handlers.New(fetcher, tmpl, static, handlers.Config{
		Audience:    cfg.audience,
		TrustDomain: cfg.trustDomain,
		SourceLabel: fetcher.Source(),
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
	namespace   string
	serviceAcct string
	socketAddr  string
	demoMode    bool
}

func loadConfig() config {
	c := config{
		port:        env("PORT", "8080"),
		audience:    env("WEBAPP_JWT_AUDIENCE", "swa-demo-audience"),
		trustDomain: env("SWA_TRUST_DOMAIN", "swa-demo.example.com"),
		namespace:   env("NS_DEMO", "swa-demo"),
		serviceAcct: env("WEBAPP_SA", "swa-demo-webapp"),
		socketAddr:  socketAddr(),
		demoMode:    strings.EqualFold(env("DEMO_MODE", "false"), "true"),
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
		return svid.NewFake(cfg.trustDomain, cfg.namespace, cfg.serviceAcct)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := spiffe.New(ctx, cfg.socketAddr)
	if err != nil {
		log.Printf("WARNING: could not connect to Workload API at %s (%v); falling back to DEMO mode", cfg.socketAddr, err)
		return svid.NewFake(cfg.trustDomain, cfg.namespace, cfg.serviceAcct)
	}
	return client
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
