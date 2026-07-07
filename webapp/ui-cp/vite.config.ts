/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// The CP inspector UI is served by the Go webapp under /cp, so base=/cp/ and the
// build output goes into internal/ui/cpapp/ where a go:embed directive picks it
// up. Adapted from infamousjoeg/idira-swa-demo (Apache-2.0) — see NOTICE.
export default defineConfig({
  plugins: [react()],
  base: "/cp/",
  root: resolve(__dirname),
  // Unit tests (vitest). jsdom for the component smoke test; engine tests are
  // pure. Run with `pnpm test`.
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
  },
  build: {
    outDir: resolve(__dirname, "../internal/ui/cpapp"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    // During `vite dev`, proxy the retrieval API to the Go webapp.
    proxy: {
      "/api": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
});
