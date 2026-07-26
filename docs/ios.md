# iOS App

`herdr-web` includes a Capacitor iOS shell that bundles the same React/Vite app used by the browser
and Android shell. It preserves the Android product model: the app owns the local UI and settings,
while API and WebSocket traffic goes to one or more user-configured Herdr bridges.

The iOS app does not run Herdr and does not download its UI from a bridge. A bridge must already be
running on another machine or otherwise be reachable from the iOS device.

## Package Shape

- Capacitor config: `capacitor.config.ts`
- Xcode project: `ios/App/App.xcodeproj`
- iOS bundle identifier: `dev.herdr.web`
- Minimum deployment target: iOS 15.0
- Bundled web assets source: `web/dist`
- Runtime profile storage: Capacitor Preferences on iOS, browser `localStorage` elsewhere
- Capacitor native dependencies: Swift Package Manager, pinned by the committed
  `Package.resolved`

The generated native project, app icon, launch artwork, `Info.plist`, and privacy manifest are
committed. Generated sync and build outputs remain ignored, including:

- `ios/App/App/public`
- `ios/App/App/capacitor.config.json`
- `ios/App/App/config.xml`
- `ios/capacitor-cordova-ios-plugins`
- `ios/DerivedData*`
- archives, result bundles, IPA files, and dSYM bundles

Run `npm run ios:sync` before opening or building iOS from a fresh checkout.

## Runtime Behavior

Browser-served builds default to the bridge that served the page. The bundled iOS app has no
serving bridge, so it starts disconnected until the user adds and enables a saved bridge in the
Bridge area of Settings. This is the same disconnected-first flow used by Android.

Supported backend examples:

```text
http://192.168.1.20:4000
http://10.0.0.42:8787
http://herdr-host.local:4000
https://herdr.example.test
```

Backend URLs must be HTTP or HTTPS origins. Credentials, paths, query strings, and fragments are
rejected. Hostnames remain subject to the bridge's independent `Host` policy.

## Bridge Origin And Host Policy

The iOS WebView origin is exactly `capacitor://localhost`. A bridge must explicitly allow that
origin before the iOS app can call `/api/*` or `/ws/*` endpoints:

```bash
HOST=0.0.0.0 PORT=4000 scripts/run-bridge.sh \
  --allow-origin capacitor://localhost
```

The custom origin permission is deliberately narrow. Near-miss origins are rejected, and an allowed
origin never bypasses the bridge's separate `Host` validation. If the backend URL uses a DNS
hostname instead of an IP literal, allow that exact hostname too:

```bash
HOST=0.0.0.0 PORT=4000 scripts/run-bridge.sh \
  --allow-origin capacitor://localhost \
  --allow-host herdr-host.local
```

Use `--allow-origin`, not `--allow-connect-origin`, for the bundled iOS app.
`--allow-connect-origin` only extends the Content Security Policy of a bridge-served HTTP page and
accepts only HTTP or HTTPS origins.

The bridge currently has no full browser authentication. Bind it to `0.0.0.0` only on a trusted
network, and do not expose bridge-owned terminal control, uploads, or notes to untrusted clients.

## ATS And Local-Network Trust

The iOS shell supports user-managed HTTP bridge URLs because Herdr bridges commonly run on a trusted
LAN or mesh network without TLS. Its `Info.plist`:

- allows local networking through App Transport Security;
- allows cleartext loads in the app's WebView;
- includes a user-facing local-network purpose string; and
- keeps the shell in dark appearance to match the bundled app.

These settings make HTTP possible; they do not make it private or authenticated. Prefer HTTPS when
the bridge is reachable beyond a trusted network.

On a physical device, iOS may ask for local-network access when the app first contacts a LAN
bridge. If access is denied, the app should remain usable in its disconnected state so the user can
edit or test another backend. Simulator success is not evidence that the physical-device
permission flow works; allow, deny, and retry behavior remains a required device check.

## Privacy Manifest

`ios/App/App/PrivacyInfo.xcprivacy` is included in the app target. It declares Capacitor Preferences'
UserDefaults access with required-reason code `CA92.1`. The current manifest declares no tracking
and no collected-data categories.

Revisit the manifest and platform privacy disclosures whenever native plugins, analytics, pairing
tokens, or other data collection/storage behavior changes.

## Build Prerequisites

- macOS
- Xcode 26 with an installed iOS Simulator runtime
- Node.js 22 or newer
- npm

The project targets iOS 15.0 and newer. A running Herdr `v0.7.5` or newer daemon that reports
terminal protocol `17` is needed for runtime smoke testing, but not for compiling the simulator
app.

## Build Commands

Install dependencies:

```bash
npm ci
npm ci --prefix web
```

Build the web app and sync it into the native project:

```bash
npm run ios:sync
```

Audit the synced project, plist values, privacy manifest, branding assets, ignored outputs, and
Xcode scheme:

```bash
npm run ios:check
```

Build an unsigned Debug app for a generic iOS Simulator destination:

```bash
npm run ios:build:debug
```

The default simulator output is:

```text
ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app
```

Choose an installed simulator by name or stable identifier when a concrete destination is useful:

```bash
IOS_SIMULATOR_NAME="iPhone 17 Pro" npm run ios:build:debug
IOS_SIMULATOR_ID="SIMULATOR-UDID" npm run ios:build:debug
```

`IOS_DERIVED_DATA_PATH` can move the build directory, and `IOS_CONFIGURATION` can select another
configuration. The build remains unsigned because the validation script sets
`CODE_SIGNING_ALLOWED=NO`.

Open the synced project in Xcode:

```bash
npm run ios:open
```

Select an installed simulator and run the `App` scheme. Run `npm run ios:sync` again after changing
the web app or Capacitor dependencies.

## Verification Status

The current iOS implementation has been verified on macOS with Xcode 26.6 and iOS 26.5 Simulator:

- the project audit and unsigned generic Simulator build passed;
- the app built, installed, and launched without Xcode warnings on iPhone 17 Pro and iPad Pro
  13-inch (M5) simulators;
- an iPhone connected to an isolated Herdr server through `capacitor://localhost`, loaded
  capabilities and snapshots, created a workspace, attached its terminal WebSocket, sent a shell
  command, and rendered the result;
- the saved bridge profile survived app termination and relaunch;
- portrait and landscape iPhone layouts and the regular iPad split layout rendered without safe-area
  clipping; and
- the built app contained the expected `Info.plist` values and `PrivacyInfo.xcprivacy`.

That verification proves the checked-in shell compiles and its core loopback runtime path works in
Simulator. It does not prove code signing, physical-device behavior, VoiceOver traversal, LAN
permission handling, or App Store readiness.

## Simulator Smoke Checklist

On a trusted LAN:

1. Start or attach Herdr `v0.7.5` or newer with terminal protocol `17`.
2. Start the bridge with `--allow-origin capacitor://localhost` and, for a DNS backend, the required
   `--allow-host` value.
3. Run `npm run ios:sync`, open the Xcode project, and launch the `App` scheme on both an iPhone and
   iPad simulator.
4. Confirm the branded launch screen transitions to the app without needing a network connection.
5. Confirm the app starts disconnected and the Bridge settings remain reachable.
6. Add the bridge URL, use `Test`, save it, enable it, and confirm its bridge chip appears.
7. Verify snapshot loading, event updates, pane selection, terminal attach, text input, stage-only
   input, scrolling, refit, uploads, and pane controls.
8. Change terminal input transport and batching settings, then confirm input still works.
9. Exercise the mobile sidebar, settings, dialogs, notes, context menus, and keyboard dismissal.
10. Rotate simulated devices and confirm safe areas, the software keyboard, and terminal sizing are
    correct in compact and regular layouts.
11. Terminate and relaunch the app; confirm enabled bridges and settings persist.
12. Test an unreachable backend and confirm the disconnected UI stays usable enough to edit or
    replace it.

## Distribution Gate

The simulator build is verified, but signed iOS distribution is not complete. Before distributing
to testers or the App Store, an operator must:

- select an Apple Developer team and establish signing/provisioning for `dev.herdr.web`;
- define and verify a reproducible signed archive/export or TestFlight/App Store workflow;
- complete App Store metadata, privacy disclosures, and review of the HTTP/LAN trust policy;
- smoke test supported physical iPhones and iPads, including iOS 15 compatibility where practical;
- verify local-network permission allow, deny, Settings recovery, and retry behavior against real
  HTTP and HTTPS bridges;
- test VoiceOver, software and hardware keyboards, rotation, safe areas, terminal HTTP(S) link
  opening, uploads, icon, and launch appearance on physical devices; and
- decide the signed artifact name, inspection checks, and release-upload procedure.

Until that work is complete, do not publish Simulator `App.app` bundles, Derived Data, `.xcarchive`
directories, or unsigned `.ipa` files as recommended GitHub release assets.
