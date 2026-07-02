# Build a static, self-contained webapp image (templates/static + the built CP
# inspector SPA are embedded). go >= 1.25 required by github.com/cyberark/conjur-api-go.

# Stage 1 — build the CP inspector SPA (Vite/React). Its Vite outDir is
# ../internal/ui/cpapp, so it lands where the Go stage's go:embed picks it up.
FROM node:22 AS ui
WORKDIR /src/ui-cp
COPY ui-cp/package.json ui-cp/pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate && pnpm install --frozen-lockfile
COPY ui-cp/ ./
RUN pnpm build   # writes /src/internal/ui/cpapp

# Stage 2 — Go build. Overlays the freshly built SPA over the committed placeholder.
FROM golang:1.25 AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
COPY --from=ui /src/internal/ui/cpapp ./internal/ui/cpapp
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /
COPY --from=build /out/server /server
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/server"]
