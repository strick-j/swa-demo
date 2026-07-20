# SPA i18n — Phase-1 proof-of-concept

`index.ts` is a dependency-free `t(key, vars?)` that reads the same `lang` cookie
the Go server sets, so the SPA and the server-rendered pages agree on locale.
Production should swap the internals for **react-i18next** behind the same
`t(key, vars)` surface (plurals, lazy per-locale catalogs) — call sites don't change.

The `locales/*.json` here carry the **CP `authorized` scenario** and its
translatable trace comments. That scenario **is wired** in `providers.tsx` (the
`cpProvider.scenarios.authorized` block and the three `comment` lines in its
`buildTrace`) — it is the worked example. Extending to the remaining scenarios /
providers is the same mechanical edit repeated. The before/after below documents
the exact shape.

## Wiring a scenario (static strings)

`providers.tsx`, `cpProvider.scenarios.authorized` — before:

```tsx
authorized: {
  key: "authorized",
  label: "Expected success",
  tag: "expect ✓",
  desc: "A caller whose application hash IS registered ... the credential is returned.",
  evidence: [
    { lead: "Authenticated by application hash, not a key.", body: "The Credential Provider ..." },
    // ...
  ],
},
```

after:

```tsx
import { t } from "../i18n";

authorized: {
  key: "authorized",
  label: t("cp.scenario.authorized.label"),
  tag: t("cp.scenario.authorized.tag"),
  desc: t("cp.scenario.authorized.desc"),
  evidence: [
    { lead: t("cp.scenario.authorized.ev1.lead"), body: t("cp.scenario.authorized.ev1.body") },
    // ...
  ],
},
```

> Note: this metadata is currently a module-level constant evaluated at import.
> Because the switcher **reloads** the page, resolving `t()` at module load is
> fine. If the SPA later switches locale without a reload, move provider
> construction behind a `buildProvider(locale)` factory so `t()` re-runs.

## Wiring a trace line (interpolation + do-not-translate)

`buildTrace` mixes prose and literal shell. **Only `kind: "comment"` prose is
translated**; `cmd` / `cont` lines stay verbatim. Before:

```tsx
{ s: 2, kind: "comment", text: `checks OS user (${r?.osUser || "svc-app"}) and executable path` },
{ s: 3, kind: "comment", text: `Vault: is Application '${appId}' authorized for Safe ${safe}?` },
{ s: 1, kind: "cmd",     text: `java -Djava.library.path=/opt/CARKaim/sdk \\` },   // NOT translated
```

after:

```tsx
{ s: 2, kind: "comment", text: t("cp.trace.checkOsUser", { osUser: r?.osUser || "svc-app" }) },
{ s: 3, kind: "comment", text: t("cp.trace.authzQuery", { appId, safe }) },
{ s: 1, kind: "cmd",     text: `java -Djava.library.path=/opt/CARKaim/sdk \\` },   // unchanged
```

The interpolated values (`appId`, `safe`, `osUser`) pass through untranslated —
only the surrounding sentence is localized. See `../../../../docs/i18n-glossary.md`.
