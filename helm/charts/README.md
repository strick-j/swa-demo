# Local SWA Helm charts

If your SWA entitlement ships the Helm charts as packages (no pullable registry),
drop them here:

```
helm/charts/swa-server-<version>.tgz
helm/charts/swa-agent-<version>.tgz
```

`scripts/deploy-swa.sh` auto-discovers `swa-server*.tgz` / `swa-agent*.tgz` here
and installs from them. These files are synced to the host with the rest of the
project. To use a registry/OCI ref instead, set `SWA_SERVER_CHART` /
`SWA_AGENT_CHART` in `.env`.

> `*.tgz` here are gitignored (they are vendor artifacts) — keep them out of git.
