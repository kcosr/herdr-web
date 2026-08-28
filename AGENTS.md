# Agent Onboarding (herdr-web)

This is a lightweight internal onboarding note for agents working in this repo.

## Start Here

- Read `README.md` for the product shape, bridge runtime model, and local run commands.
- Read `web/README.md` before changing the React/Vite app.
- Read `docs/vendoring.md` before touching `vendor/herdr-compat/`.
- Read `docs/packaging.md` before changing desktop tarball or Android release artifact behavior.
- Read `docs/release.md` before changing release scripts or release checklists.
- Web source lives in `web/src/`.
- The repo-owned bridge implementation lives in `bridge/src/web_bridge.rs`.
- The minimal Herdr compatibility crate lives in `vendor/herdr-compat/`.
- Do not recreate a full `vendor/herdr/` upstream snapshot; use a separate Herdr checkout for
  refreshes and audits.

## Conventions

- Keep product changes scoped to the web app, bridge executable, and minimal compatibility crate
  unless the user explicitly asks for core Herdr changes.
- Prefer small pure helpers in `web/src/` for state, launch, and protocol formatting logic that can be unit tested.
- Keep bridge command exposure narrow. Browser commands should stay allow-listed and parameter-validated in `web_bridge.rs`.
- Keep generated outputs out of commits: `web/dist/`, `bridge/target/`, and
  `vendor/herdr-compat/target/`, `dist-packages/`, and Android build outputs.
- The bridge is local-first and currently has no full browser authentication. Treat LAN binding and upload behavior as security-sensitive.
- Never call a secure-context-only browser API unguarded. herdr-web's whole mobile story is being
  served over plain HTTP to a non-localhost origin (LAN IP, `.local`, Tailscale), which is *not* a
  secure context — but `http://localhost` is, so local dev silently masks these. `crypto.randomUUID`
  is the one that has already bitten; generate ids via `randomId()` in `web/src/randomId.ts`.
- Persisted mobile display prefs in `web/src/App.tsx` (`DisplayPrefs`) need six touchpoints kept in
  sync: the type, `readDisplayPrefs()` default, `parseDisplayPrefsValue()`, a `useState`, the
  restore-on-load effect, and the save effect (object + dependency array). `isCompactLayout` (narrow
  viewport, `max-width: 820px`) and `isTouchInput`/`mobileControls` (coarse pointer, no hover) are
  separate signals gating different mobile behaviors — do not assume one implies the other.
- Remote bridges (`--remote-bridge <url>`, proxied under `/api/remote/{bridge_id}/...` and
  `/ws/remote/{bridge_id}/terminal`) are only reachable if the local bridge process was started with
  that URL — bridge ids are derived server-side from the URL hostname. Any client-side UI for adding
  remote bridges must either mirror what the server actually has configured or call a registration
  API; a purely client-local list of URLs cannot work standalone.
- The REST proxy (`remote_api_proxy_handler`) enforces an explicit allow-list via
  `is_proxy_path_allowed()`. Only the paths in that list are forwarded; command-execution and upload
  endpoints are never proxied. Add new proxied paths there; do not widen the allow-list without
  review.
- `@parlay/client` (used by `web/src/ParlayInput.tsx`) is a permanently OPTIONAL, LOCAL-ONLY,
  NEVER-PUBLISHED dependency. It is deliberately absent from `web/package.json` and
  `web/package-lock.json` so `npm ci` never fetches it from a registry, and it resolves only via the
  gitignored symlink `web/local-deps/parlay-client` (setup in `web/README.md`). Do not add it as a
  registry dependency or commit the symlink. Two mechanisms keep it optional and must stay in sync:
  the `parlayClientResolver` in `web/vite.config.ts` (resolves the local package's entry from its
  own `package.json` `exports`/`module`/`main` when the symlink is present, for `vite dev`, tests,
  and production alike) with `build.rolldownOptions.external`, which externalizes it **only when the
  symlink is absent** — with the symlink present the real package is bundled into `web/dist` so
  parlay voice-submit works in the built app, which also means production output is
  build-host-dependent; and the guarded `try { await import("@parlay/client") }` in
  `ParlayInput.tsx` that falls back to a plain input at runtime when the module is absent (the
  externalized specifier never resolves). The type side is the single ambient shim
  `web/types/parlay-client.d.ts` — do not reintroduce a duplicate under `web/src/`.

## Merging

- After any merge that touches `web/package-lock.json`, regenerate it (`npm install --prefix web`)
  and verify with a clean `npm ci`. Git resolves lockfiles line-by-line and reports no conflict,
  but the result is routinely an inconsistent tree that fails `npm ci` outright.
- A merge that brings in a `vendor/herdr-compat` refresh can silently drop a `match` arm the
  refresh added, since neither side conflicts. `cargo build` catches it as `E0004`; run it before
  assuming a clean merge is correct.
- Treat `vendor/herdr-compat/` as one atomic snapshot: take a whole side rather than blending
  fixtures and type definitions from both.

## Testing

- Run `npm install --prefix web` if dependencies are missing. This requires the local
  `web/local-deps/parlay-client` symlink described in `web/README.md`.
- Run `npm run vendor:check` to verify the vendored layout.
- Run `npm run lint:web` for ESLint.
- Run `npm run test:web` for Vitest.
- Run `npm run build:web` for the frontend production build.
- Run `npm run bridge:test` for bridge unit tests when a Rust toolchain (cargo) is available.
- Run `npm run check` before committing or releasing.
- If cargo/Rust is missing, call out that bridge build/test verification could not run.

## Build And Packaging

- Development build: `npm run build` builds the web app and debug bridge binary.
- Android debug build: `npm run android:build:debug`; output is
  `android/app/build/outputs/apk/debug/app-debug.apk`.
- Desktop release tarball: `scripts/package-tarball.sh vX.Y.Z PLATFORM`; outputs go under
  `dist-packages/`.
- Build or provide `linux-x86_64` tarballs from Linux, `macos-arm64` tarballs from an Apple Silicon
  Mac, and `macos-x86_64` tarballs from an Intel Mac. Supplemental local build-service notes may
  describe the release operator's available build hosts, but the repo-owned packaging script remains
  the source of truth for tarball layout.
- Build final release artifacts from the final release commit/tag after `scripts/release.mjs`
  stamps the changelog and creates the release. Inspect tarball/APK contents before upload.
- Desktop tarballs include only `herdr-web-bridge`, bundled `web/dist` assets, a wrapper script, and
  docs. They do not include Herdr itself.
- The locally running bridge serves static assets from `~/.local/share/herdr-web/dist`, which is a
  *copy* of `web/dist`, not a symlink — a rebuild alone changes nothing for a live phone/browser
  client. To redeploy: `npm run build:web`, then `rsync -a --delete web/dist/ ~/.local/share/herdr-web/dist/`.
  No bridge restart is needed; it reads from disk per request. `--delete` is correct here: every file
  in that directory is build output, and stale content-hashed chunks left behind are dead weight.

## Changelog

- Add user-facing changes to `CHANGELOG.md` under `## [Unreleased]`.
- Use these subsections when applicable: Breaking Changes, Added, Changed, Fixed, Removed.
- Add the needed subsection under `## [Unreleased]` if it is missing; do not create duplicate subsection headings.
- After opening a PR and before merging it, update each relevant changelog entry with the PR number
  or link.
- Include bridge compatibility and vendored Herdr refresh notes when protocol or overlay compatibility changes.
- When cutting a release, the release script removes empty unused subsections from the released
  version section; keep the fresh `## [Unreleased]` template headings intact.

## Release

- Release from a clean `main` branch.
- Ensure `CHANGELOG.md` has the release notes under `## [Unreleased]`.
- Run `npm run check`.
- Run the browser smoke checklist in `docs/release.md`.
- Run `node scripts/release.mjs vX.Y.Z`.
- The release script promotes the changelog, commits, tags, pushes, creates a GitHub release from changelog notes, and opens the next `## [Unreleased]` section.
- Build/upload tarball and APK artifacts manually after the release exists. Use
  `docs/packaging.md` and `docs/release.md`; do not commit `dist-packages/`, APKs, or generated
  Android outputs.
- Do not bump npm package versions until package publishing is defined.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
