# Bug report — SWA X.509-SVID rotation wedges for long-lived workloads

## Summary

On CyberArk **Secure Workload Access (SWA)**, long-lived workloads never rotate
their **X.509-SVIDs**. When the agent's X.509 manager reconnects the workload's
SVID stream at the rotation boundary, the SWA **server rejects the re-subscribe**
with:

```
failed to get identity for workload: subscriber already exists for: id=<pid>
```

The previous subscriber for that workload is **not released before the reconnect**,
and because the subscriber is keyed by the workload **PID** (which is stable for a
long-lived pod under `hostPID`), the collision **never clears on its own**. The
SVID then expires at its TTL and the workload serves/presents an **expired
certificate**, breaking mTLS. The only recovery is to restart the workload pod
(new PID) or restart the SWA server (clears its subscriber registry).

Reproduced on **SWA v1.0.2** (also observed on v1.0.0). Upgrading v1.0.0 → v1.0.2
did **not** fix it.

## Impact

- Any workload that holds an X.509-SVID longer than one `workload_ttl` and does
  not get a new PID (i.e. is not restarted) will eventually present an expired
  cert and fail mTLS.
- In our environment a ghostunnel mTLS gateway (long-lived, never restarted)
  loses connectivity roughly every `workload_ttl` (1h in our config).
- Short-lived or frequently-redeployed workloads mask the bug because a restart
  yields a new PID that subscribes cleanly.

## Environment

| Component | Detail |
|---|---|
| SWA version | v1.0.2 (server + agent Helm charts from the release bundle) |
| Platform | single-node **minikube** (Docker driver) on RHEL 8/9 EC2 |
| Server / Agent namespace | `swa-system` (server Deployment + agent DaemonSet) |
| Node attestation | `k8s_psat` |
| Workload attestation | `k8s` (`skipKubeletVerification: true`) |
| Agent pod | `hostPID: true`, `hostNetwork: true`; Workload API socket on a hostPath `unix:///tmp/swa-agent/public/api.sock` |
| Trust domain | `swa-demo.example.com`; node group `minikube-nodes` |
| X.509 `workload_ttl` | `3600` (1h) at the time of capture |
| Affected workload | **ghostunnel v1.10.0** (`server` mode) fronting Postgres, fetching its server SVID + trust bundle from the Workload API (`--use-workload-api-addr`). SPIFFE ID `spiffe://swa-demo.example.com/minikube-nodes/ns/swa-data/sa/pg-gateway`. Long-lived; not restarted. |
| Consumer | a Go app (`go-spiffe/v2`) that dials the gateway with its own X.509-SVID; SPIFFE ID `spiffe://swa-demo.example.com/minikube-nodes/ns/swa-demo/sa/swa-demo-webapp` |

## Symptoms

**1) Client-side mTLS failure** — the consumer rejects the gateway's expired
server leaf:

```
dial error: x509svid: could not verify leaf certificate:
x509: certificate has expired or is not yet valid:
current time 2026-07-01T01:58:33Z is after 2026-06-30T17:54:23Z
```

**2) SWA server** — repeated rejection of the workload's X.509 re-subscribe
(subsystem `x509-service`), keyed by PID; note the same `id` == `pid`:

```
level=ERROR msg="Failed to get identity for workload" subsystem=x509-service \
  pid=2633672 node-group=minikube-nodes agent-ip=10.244.0.1 \
  error="subscriber already exists for: id=2633672"
```
…repeated every few seconds for the lifetime of the wedge. During the same window
the server mints X.509 SVIDs for *other* workloads (webapp, second app, the agent
node itself) but **never** for the wedged `ns/swa-data/sa/pg-gateway`. The old
subscriber is only released later, on stream teardown:

```
level=INFO msg="Shutting down svid stream" subsystem=x509-service \
  pid=2633672 node-group=minikube-nodes \
  spiffeids=[spiffe://swa-demo.example.com/minikube-nodes/ns/swa-demo/sa/swa-demo-webapp]
```

**3) SWA agent** — the X.509 manager retries the fetch and is rejected each time:

```
level=INFO  msg="Fetching x509 svid" subsystem=x509-manager
level=ERROR msg="Failed to stream results" subsystem=x509-manager \
  error="rpc error: code = Internal desc = failed to get identity for workload: subscriber already exists for: id=2633672"
level=ERROR msg="Failed to get SVID from server" subsystem=workload-api \
  pid=2633672 error="rpc error: code = Internal desc = failed to get identity for workload: subscriber already exists for: id=2633672"
```

## Suspected root cause

1. The SWA server registers an X.509 stream **subscriber keyed by the workload's
   attested PID**.
2. When the workload's X.509 stream drops and the agent reconnects (around the
   rotation boundary), the server still has the **prior subscriber registered for
   that PID** and rejects the new one with `subscriber already exists`.
3. Because the agent runs `hostPID: true` (required by the `k8s` workload
   attestor on the Docker driver), the workload PID is **host-global and stable**
   for the pod's lifetime, so retries collide forever.
4. The stale subscriber is only released on an explicit stream teardown; there is
   an ordering/cleanup gap between "old stream drop" and "new stream subscribe".

Net: a race in subscriber lifecycle where the old subscriber outlives the stream,
combined with PID-based keying, makes the reconnect unrecoverable for any
same-PID (long-lived) workload.

## Reproduction

1. Deploy SWA server + agent (agent `hostPID: true`, `k8s_psat` + `k8s` attestor),
   `x509.workload_ttl = 3600`.
2. Run a **long-lived** workload that holds an X.509-SVID via the Workload API and
   rotates it (e.g. ghostunnel `server --use-workload-api-addr=...`, or any
   `go-spiffe` X509Source). Do **not** restart it.
3. Wait past `workload_ttl`. The workload's rotation reconnect is rejected with
   `subscriber already exists for: id=<pid>`; the SVID expires and mTLS fails.

## Verification

```bash
# Server: the collision (and absence of issuance for the wedged workload)
kubectl -n swa-system logs deploy/swa-server --since=45m \
  | grep -iE 'SVIDIssued.*X509|subscriber already|Shutting down svid stream'

# Agent: the retry loop
kubectl -n swa-system logs ds/swa-agent --since=45m \
  | grep -iE 'Fetching x509|subscriber already|Failed to (stream|get SVID)'

# Confirm the wedged workload's SVID has expired (client rejects it)
#   -> "certificate has expired or is not yet valid"
```

Recovery (confirms the cause):
- Restart the **workload** pod → new PID → clean subscribe → fresh SVID; **or**
- Restart the **SWA server** → subscriber registry flushed → next re-subscribe
  succeeds.

## Workarounds in place (not fixes)

- Raised `x509.workload_ttl` 1h → 8h so rotation rarely fires within a session.
- A CronJob that `rollout restart`s the gateway every 4h (fresh PID before the
  wedge point).

Both only reduce exposure. The subscriber-cleanup race is the defect.

## Requested fix

Release/evict the prior X.509 stream subscriber when its stream drops (or make the
new subscribe supersede the stale one) so that a workload reconnecting with the
**same PID** can re-subscribe and resume rotation without a pod restart.
