# i18n Rollout Plan — Landing Page + Use-Case Pages (es-419, pt-BR)

Extends the existing English/Spanish/Portuguese support from the landing-page hero
slice to the **entire landing page** and **all use-case pages**. Builds on the
patterns already in `internal/i18n` (server) and `ui-cp/src/i18n` (SPA); see
`docs/i18n-glossary.md`.

## Status

- ✅ **Phase 0** — parity guardrails landed (`internal/i18n/i18n_test.go`, `ui-cp/src/i18n/parity.test.ts`). Both made **active** (not skipped): server catalog reaches parity within Phase 1, and the SPA catalog was already at parity.
- ✅ **Phase 1** — full landing page localized (en/es-419/pt-BR). 74 server keys, exact parity; `go build`, `go test ./...`, `go vet`, and `npm test` (16 tests) all green.
- **Deviation**: no registry change was needed — `retrieve.FamilyInfo.Family` and `ModeInfo.Mode` are already stable identifiers, so the template keys off `.Family`/`.Mode` via `printf` directly. es-419/pt-BR copy drafted in this pass (Phase 5 now covers only the SPA strings from Phases 3–4), pending owner review.
- ✅ **Phase 2** — in-SPA EN/ES/PT switcher (`components/LangSwitcher.tsx`) wired into the inspector chrome header; writes the shared `lang` cookie + reloads. The committed SPA bundle (`internal/ui/cpapp/`) was rebuilt via `pnpm build` (frozen lockfile) and re-embedded. Confirmed the pnpm artifact hash is reproducible.
- ✅ **Phase 3** — all **PortalPane** provider content localized across the 4 provider definitions (CP, CCP, SWA, Conjur jwt+iam): `brand.sub`, `heroTitle`, `heroLede`, and every scenario's `label`/`tag`/`desc`/`evidence` (14 scenarios). SPA catalogs grew 12 → **159 keys**, exact parity across en/es-419/pt-BR (drafted via parallel subagents, validated: 0 missing/extra, placeholder + `**bold**` integrity OK). A new `emph()` helper renders `**bold**` from translated strings into `<strong>` so hero ledes keep emphasis without per-locale JSX.
  - **Scope note**: Phase 3 covers the PortalPane (the "brief" users read). The InspectorChrome + visualization content in `providers.tsx` — `subtitle`, `ctx` labels, `stages`, `nodes[]`, `layers[]`, and the remaining `buildTrace` `comment` lines (CP's trace is already localized from the PoC) — moves to **Phase 4**, localized together with `components/` + `visualizations/`.
- ✅ **Phase 4** — fixed component/App chrome under a `chrome.*` namespace: App view/pace toggles, InspectorChrome status/error/reset, Evidence headers, AccessibilityHints skip link, and all PortalPane buttons/labels/result-rows (incl. the Retrieve / Retrieve-again button). SPA catalogs grew 159 → **221 keys**, exact parity. Bundle rebuilt + re-embedded.
- ✅ **Phase 5** — the topology/layers/trace **view structure**: both visualization boundary panels (`TopologyInspector` + `LayersInspector`), all four providers' `ctx` labels, `stages` (label + verb), topology **node titles**, and layers **card names**. SPA catalogs grew 221 → **357 keys**, exact parity (view keys drafted via parallel subagents; placeholder integrity verified). `subtitle`/`brand.name` stay verbatim (product/protocol names).
- 🟡 **Phase 6 (in progress)** — the *in-card detail sentences*: node `body` prose (foot/danger), layer `pass`/`reject`/`idle` status lines, node state `tag`s, and the remaining `buildTrace` `comment` lines (CCP/SWA/Conjur; CP already localized). These are the interpolated per-state strings inside each card.

## Decisions (locked)

1. **Translations**: Claude drafts es-419 + pt-BR for every new key; owner reviews/corrects.
2. **Legacy Go templates** (`swa.html`, `secrets-manager.html`, `credential-provider(s).html`, `static/*.js`): **out of scope** — they only render when the SPA build is absent. Landing page + React SPA only.
3. **In-SPA switcher**: add an EN/ES/PT control to the inspector chrome (calls `setLocale()` + `location.reload()`, matching the landing pattern).

## Conventions (keep the established ones)

- Flat `key → string` catalogs; `en` is source-of-truth and the fallback.
- Server keys namespaced `landing.<section>.<field>`; keys ending `_html` carry trusted author markup via `tHTML`.
- SPA keys namespaced `<provider>.<area>...` (e.g. `cp.scenario.authorized.label`), shared UI under `chrome.*` / `common.*`.
- `t()` resolves at module load; the switcher **reloads** — so no reactive plumbing. Keep this; do **not** move provider construction behind a `buildProvider(locale)` factory unless we later add reload-free switching.
- Interpolated runtime values (`appId`, `safe`, `osUser`, …) pass through `{name}` placeholders untranslated; only the sentence frame is localized.

---

## Phase 0 — Guardrails (do first)

- **Catalog parity test (server)**: add a Go test asserting every key in `en.json` also exists in `es-419.json` and `pt-BR.json` (and no extra keys). Prevents silent English fallback from masking missing copy.
- **Catalog parity test (SPA)**: add a Vitest equivalent over `ui-cp/src/i18n/locales/*.json`.
- These tests will fail until translations land (Phase 5) — keep them `t.todo`/skipped or gate on an env flag until then, or land them last. Recommended: write them now, mark skipped, un-skip in Phase 5.

## Phase 1 — Finish the landing page (server, `internal/i18n` + `landing.html`)

Extract every remaining hardcoded string in `internal/ui/templates/landing.html` into catalog keys and swap to `{{ t .Locale "…" }}` / `{{ tHTML … }}`:

- **How-it-works strip** (3 steps): `landing.strip.01.title/body` … `landing.strip.03.*` (6 keys).
- **Problem section**: `landing.problem.eyebrow/title/intro` + 3 cards `landing.problem.cardN.k/title/body` (~12 keys).
- **Variety section**: `landing.variety.eyebrow/title/intro` + 3 cards `landing.variety.cardN.tag/title/who/body` (~15 keys). `<span class="who">` fragments use `&middot;`/`&amp;` → use `_html` keys via `tHTML`.
- **Solutions section**: `landing.solutions.eyebrow/title/intro_html` (intro has an embedded `<a href="/swa">` → `_html` key).
- **Trust bar**: `landing.trust.item1..4` (4 keys).
- **Footer**: `landing.footer.secured`, plus keep the `/api/catalog`·`/healthz` line as literal code.
- **Chip/CTA literals** in the modes loop: `landing.mode.chip.live`, `landing.mode.chip.soon`, `landing.mode.explore`.

**Registry-driven solutions cards** (the one non-trivial bit). The family/mode copy
(`Title`, `Tagline`, `Label`, `Auth`, `Summary`) comes from `retrieve.Registry.Catalog()`,
not the template. Keep the registry as pure data + English source/fallback, and translate
**template-side by stable identifier**:

- Add a stable `Key string` field to `retrieve.FamilyInfo` (values `credential-providers`, `secrets-manager`, `swa`); `ModeInfo.Mode` already provides mode keys (`cp`, `ccp`, `conjur-jwt`, `conjur-iam`, `swa`).
- In `landing.html`, inside `{{range .Families}}` use root locale via `$.Locale`:
  - `{{ t $.Locale (printf "landing.family.%s.title" .Key) }}` / `.tagline`
  - `{{ t $.Locale (printf "landing.mode.%s.label" .Mode) }}` / `.auth` / `.summary`
- Add matching keys to all three catalogs (registry English copied verbatim into `en.json`).
- Fallback: `T()` already degrades a missing key to English then to the raw key, so an un-added key is visible, not blank.

**Tests**: extend `handlers_test.go` — request `/` with `Cookie: lang=es-419` and `lang=pt-BR`, assert a representative translated string from each section renders (and English for no-cookie). Existing `handleSetLang` + landing tests are the template.

## Phase 2 — SPA switcher + infra (`ui-cp`)

- Add an EN/ES/PT switcher to `components/InspectorChrome.tsx` header (near the lockup). On click: `setLocale(loc); location.reload();`. Import `getLocale`, `setLocale`, `SUPPORTED` from `../i18n`. Highlight the active locale (`getLocale()`).
- Reuse the landing `.langsel` visual language for consistency (small mono EN/ES/PT pills).
- No route/data changes needed — reload re-runs `detectLocale()` from the cookie the switcher just wrote.

## Phase 3 — SPA provider content (`ui-cp/src/engine/providers.tsx`)

The bulk of the work. For **all 14 scenarios across 5 providers**, replace hardcoded
strings with `t()` calls and add keys to `en.json` (mirrors the CP-`authorized` worked
example already in the file / README):

| Provider | Scenarios | Key prefix |
|---|---|---|
| `cpProvider` | authorized *(done)*, invalid-hash, denied, dual | `cp.scenario.<k>.*`, `cp.trace.*` |
| `ccpProvider` | authorized, no-cert, denied, dual | `ccp.scenario.<k>.*`, `ccp.trace.*` |
| `swaProvider` | trusted, untrusted, unknown, foreign | `swa.scenario.<k>.*`, `swa.trace.*` |
| `makeConjur(jwt)` | authorized, denied (instantiated as jwt + iam) | `conjur.scenario.<k>.*` |

Per scenario: `label`, `tag`, `desc`, `evidence[].lead/body`, and `kind:"comment"` trace
lines (only comments; `cmd`/`cont` shell text stays verbatim). Also extract per-provider
chrome: `brand.name/sub`, overview/`desc` prose, `steps[].label/verb`, context-row labels.

**`makeConjur` note**: it builds both the JWT and IAM providers from one function. Decide
per string whether jwt/iam share a key or need distinct keys (`conjur.jwt.*` vs `conjur.iam.*`);
where the factory already branches on `jwt`, branch the key too. Keep interpolation for the
auth-mechanism differences.

**Tests**: extend `engine/providers.test.ts` — assert `pmeta()` for each provider/scenario
returns non-empty, non-raw-key strings, and (for a chosen locale) differs from English where
a translation exists. Add a "no un-wired hardcoded string" spot-check if practical.

## Phase 4 — SPA shared chrome (`ui-cp/src/components/*`, `ui-cp/src/visualizations/*`)

Extract remaining user-facing literals (~30 in components, ~9 in visualizations) into
`chrome.*` / `common.*` keys and wire `t()`:

- `InspectorChrome.tsx`: view/pace control labels, status/phase text, Reset, context-cell keys.
- `PortalPane.tsx`, `Evidence.tsx`, `AccessibilityHints.tsx`, `Badge.tsx`, `Tag.tsx`, `DarkSeg.tsx`.
- `visualizations/LayersInspector.tsx`, `TopologyInspector.tsx`, `TraceInspector.tsx`: axis/layer/legend labels.
- Skip purely technical/verbatim tokens (shell commands, SPIFFE IDs, code) — those are not translated by design.

## Phase 5 — Translations

- Draft es-419 + pt-BR for **every** new key added in Phases 1, 3, 4 (server + SPA catalogs).
- Un-skip the Phase-0 parity tests; they must pass (all three catalogs same key set).
- Keep glossary terms consistent with existing es-419/pt-BR copy already in the catalogs and `docs/i18n-glossary.md` (e.g. how "SVID", "Safe", "credential", "workload" are rendered).
- Owner reviews wording.

## Phase 6 — Verification

- `go test ./...` (server catalog parity + handler render tests).
- `npm run test` in `ui-cp` (Vitest: providers + catalog parity).
- `npm run build` in `ui-cp`, then the Go embed of the built SPA (confirm `internal/ui/cpapp/assets/*` regenerated if the build output is committed — check how the SPA bundle is produced/embedded before finalizing).
- Manual smoke: for each of `/`, `/swa`, `/credential-providers`, `/secrets-manager`, `/cp`, switch EN→ES→PT (landing switcher + new SPA switcher) and confirm no raw keys, no English leakage in translated sections, layout holds with longer es/pt strings.
- Confirm the shared cookie keeps landing ↔ SPA in sync (switch on `/swa`, navigate to `/`, locale persists).

## Open items to confirm during implementation

- **SPA build embedding**: verify how `ui-cp` compiles into `internal/ui/cpapp/` and whether the built bundle is committed — Phase 6 build step depends on it. If committed, the PR must include the rebuilt assets.
- **Longer-string layout**: es/pt copy runs ~15–30% longer; watch the landing `.strip`/`.cols-3` cards and the SPA scenario `tag`/`chip` pills for overflow.
- **Conjur jwt vs iam key granularity**: finalize shared-vs-split keys when wiring `makeConjur`.
