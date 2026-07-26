# Agent Onboarding (herdr-web)

This is a lightweight internal onboarding note for agents working in this repo.

## Start Here

- Read `README.md` for the product shape, bridge runtime model, and local run commands.
- Read `web/README.md` before changing the React/Vite app.
- Read `docs/ios.md` before changing the Capacitor iOS shell, network/privacy declarations, or
  simulator workflow.
- Read `docs/vendoring.md` before touching `vendor/herdr-compat/`.
- Read `docs/packaging.md` before changing desktop tarball, Android release artifact, or iOS
  packaging behavior.
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
- Keep generated outputs out of commits: `web/dist/`, `bridge/target/`,
  `vendor/herdr-compat/target/`, `dist-packages/`, Android build outputs, and iOS synced web/config
  assets, Derived Data, archives, result bundles, IPA files, and dSYM bundles.
- The bridge is local-first and currently has no full browser authentication. Treat LAN binding and upload behavior as security-sensitive.

## Testing

- Run `npm install --prefix web` if dependencies are missing.
- Run `npm run vendor:check` to verify the vendored layout.
- Run `npm run lint:web` for ESLint.
- Run `npm run test:web` for Vitest.
- Run `npm run build:web` for the frontend production build.
- Run `npm run bridge:test` for bridge unit tests when a Rust toolchain (cargo) is available.
- On macOS with Xcode 26, run `npm run ios:check` and `npm run ios:build:debug` for iOS or shared
  mobile-web changes.
- Run `npm run check` before committing or releasing.
- If cargo/Rust is missing, call out that bridge build/test verification could not run.

## Build And Packaging

- Development build: `npm run build` builds the web app and debug bridge binary.
- Android debug build: `npm run android:build:debug`; output is
  `android/app/build/outputs/apk/debug/app-debug.apk`.
- iOS Simulator validation: `npm run ios:build:debug`; unsigned output is
  `ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app`.
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
- Do not stage or upload iOS Simulator output as a GitHub release asset. Signed iOS packaging is not
  defined until team/signing, physical-device, accessibility, LAN-permission, and App Store gates
  are complete.

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
- For iOS or shared mobile-web changes, run the iOS Simulator checklist in `docs/ios.md` and record
  it as Simulator-only verification.
- Run `node scripts/release.mjs vX.Y.Z`.
- The release script promotes the changelog, commits, tags, pushes, creates a GitHub release from changelog notes, and opens the next `## [Unreleased]` section.
- Build/upload tarball and APK artifacts manually after the release exists. Use
  `docs/packaging.md` and `docs/release.md`; do not commit `dist-packages/`, APKs, or generated
  Android outputs.
- Do not bump npm package versions until package publishing is defined.
