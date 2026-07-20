# i18n — locales, conventions & translation glossary

Status: **proof-of-concept**. This documents the conventions the i18n vertical
slice establishes so translators and future extraction work stay consistent.

## Locales

| Tag       | Meaning                              | Role            |
| --------- | ------------------------------------ | --------------- |
| `en`      | English                              | source of truth |
| `es-419`  | Spanish (Latin America)              | target          |
| `pt-BR`   | Portuguese (Brazil)                  | target          |

Catalogs are **region-first** (`es-419`, not `es`) so a European variant
(`es-ES`, `pt-PT`) can be added later without renaming existing files or keys.

Lookup falls back `<locale>` → `en` → the raw key, so a missing translation
degrades to English rather than a blank.

## How the active locale is chosen

A single `lang` cookie is the source of truth, read by **both** stacks:

1. `lang` cookie (`en` | `es-419` | `pt-BR`), if present and supported.
2. Otherwise the `Accept-Language` header (matched by primary subtag: any
   `es-*` → `es-419`, any `pt-*` → `pt-BR`, else `en`). First-visit default only.
3. Otherwise `en`.

The cookie is intentionally **not** `HttpOnly` — the React SPA reads it
client-side to select its catalog, so server and SPA never disagree.

The switcher writes the cookie via `GET /lang?set=<locale>&next=<path>` and
redirects back to `next` (restricted to local paths).

## Key naming

Dotted, screen-scoped, lower-kebab leaf: `landing.hero.eyebrow`,
`cp.scenario.authorized.desc`, `cp.trace.dispatch`. Keys carrying trusted markup
end in `_html` and are rendered unescaped (`tHTML` in Go, `dangerouslySet`-free
interpolation in the SPA). Interpolation uses named placeholders: `{appId}`,
`{safe}`.

## Do-NOT-translate glossary

These stay verbatim in every locale. Product, protocol, and anything that is
literal machine output.

- **Brand / product:** Idira, Idira Secrets, Palo Alto Networks, Conjur, Vault,
  AIM, AIMWebService, Credential Provider, CCP, CP, Secrets Manager.
- **Protocols / identifiers:** SPIFFE, SVID, JWT, JWT-SVID, X.509, mTLS, OIDC,
  SHA-256, STS, ARN, SPIFFE IDs (`spiffe://…`).
- **Console / trace output:** In `buildTrace`, only `kind: "comment"` lines are
  prose and get translated. `cmd` / `cont` / `out` / `ok` / `err` lines are
  literal shell, code, or server output and are **never** translated — a
  translated `curl` command or `401 Unauthorized` would be wrong/misleading.
- **Cloud provider names:** AWS, Azure, GCP, and their service/region strings.

Interpolated values (app IDs, Safe names, SPIFFE IDs, paths) pass through
untranslated — only the surrounding sentence is localized.

## Text expansion

es-419 / pt-BR run ~15–30% longer than English. The inspector chrome has tight
fixed widths (segmented controls, badges, tags); audit for clipping when
translating those, not just the landing prose.
