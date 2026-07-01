# CP host bridge

Lets the containerised webapp drive a **CyberArk Credential Provider installed on
the host**. The CP authenticates the *calling application* by its characteristics
(application **hash** + path + OS user), so the demo needs real per-application
binaries on the host — not something a pod can do directly.

| File | Role |
|------|------|
| `CpCaller.java` | The application whose identity the CP authenticates. Retrieves one account via `JavaPasswordSDK`, prints one JSON line, and emits only the secret's length + SHA-256 (never the raw value). |
| `CpBridge.java` | Long-running HTTP dispatcher. On `POST /cp?scenario=…` it runs the matching caller jar as a subprocess and relays its JSON. Binds `host.minikube.internal`-reachable port 8890. |
| `build.sh` | Compiles both against the SDK jar; emits `cp-bridge.jar`, `cp-caller.jar` (registered), and `cp-rogue.jar` (unregistered — differs by content + install path). |
| `cp-bridge.service` | systemd unit template (`__CP_RUN_USER__` substituted at install). |
| `cp-bridge.env.example` | Bridge config — App id, Safe/Object, dual query, SDK + jar paths. |

## Scenario → caller

| Scenario | Jar | Request | Expected |
|----------|-----|---------|----------|
| `authorized`   | `cp-caller.jar` (registered) | authorized Safe/Object | success |
| `invalid-hash` | `cp-rogue.jar` (unregistered) | same Safe/Object | authn deny (hash/path) |
| `denied`       | `cp-caller.jar` | a Safe the App may not read | authz deny |
| `dual`         | `cp-caller.jar` | dual-account query | active account |

## Install

From the control machine: `make cp-bridge-install` (runs `scripts/install-cp-bridge.sh`
on the host). Requires a JDK and the Credential Provider (with `JavaPasswordSDK.jar`
+ `libjavapasswordsdk.so`). See **RUNBOOK.md § 3c** for the CyberArk-side registration.

To get the **application hash** to register in PVWA, use CyberArk's own utility
(not the plain jar sha256): `make cp-app-hash` runs
`/opt/CARKaim/bin/javaaimgetappinfo.jar` against `cp-caller.jar`; add `--rogue` to
confirm the unregistered jar hashes differently.

## Contract

The bridge JSON matches `webapp/internal/retrieve/cp` `bridgeResponse`:

```json
{ "ok": true, "app_id": "SWA-CP-Demo", "app_hash": "a1b2c3",
  "caller_path": "/opt/swa-cp/cp-caller.jar", "os_user": "svc_app",
  "safe": "SWA-CP-Demo-Safe", "query": "Object=db-credential",
  "account": "svc-app-db", "address": "db.internal",
  "content_len": 18, "content_sha256": "…", "content_prefix": "s3cr3t",
  "error_code": "", "error": "" }
```

On denial: `"ok": false` with `error_code` (e.g. `APPAP008E`) and `error`; no
content fields. `content_prefix` is the first 6 chars of the secret (so it can be
matched by eye against the Vault / across a rotation); the rest stays on the host.
`app_hash` is an illustrative SHA-256 of the jar for the UI — the value you
register in PVWA comes from `JavaAIMGetAppInfo` (`make cp-app-hash`).
