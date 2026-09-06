# Android App

`herdr-web` includes a Capacitor Android shell that bundles the React/Vite app from
`web/dist` and connects only API/WebSocket traffic to a configured Herdr bridge.

The Android app does not run Herdr and does not fetch the web UI from a bridge. A bridge must
already be running on another machine or on the same network.

## Package Shape

- Capacitor config: `capacitor.config.ts`
- Android project: `android/`
- Android application id: `dev.herdr.web`
- Bundled web assets source: `web/dist`
- Runtime profile storage: Capacitor Preferences on Android, browser `localStorage` elsewhere

The generated native project is committed, but generated sync/build outputs remain ignored:

- `android/app/src/main/assets/public`
- `android/app/src/main/assets/capacitor.config.json`
- `android/app/src/main/assets/capacitor.plugins.json`
- `android/app/src/main/res/xml/config.xml`
- `android/capacitor-cordova-android-plugins`
- `android/app/build`
- `android/build`

Run `npm run android:sync` before opening or building Android from a fresh checkout.

## Android Runtime Behavior

The browser-served web app still defaults to the bridge that served the page. The bundled Android
app has no serving bridge origin, so it starts disconnected until the user adds and activates a
saved bridge in the Bridge area of Settings.

Supported backend examples:

```text
http://192.168.1.20:4000
http://10.0.0.42:8787
http://herdr-host.local:4000
https://herdr.example.test
```

The web app validates backend URLs before saving them:

- accepted URLs must be origin-style HTTP or HTTPS URLs;
- credentials, paths, query strings, and fragments are rejected;
- HTTP and HTTPS URLs may use any valid hostname or IP literal;
- hostnames are syntax-validated in the app and still must be accepted by the bridge Host policy.

The Android WebView app origin is `http://localhost`. A LAN bridge must allow that origin before
the Android app can call `/api/*` or `/ws/*` endpoints:

```bash
HOST=0.0.0.0 PORT=4000 scripts/run-bridge.sh --allow-origin http://localhost
```

If the Android backend URL uses a DNS hostname instead of an IP literal, also allow the exact
hostname in the bridge Host policy:

```bash
HOST=0.0.0.0 PORT=4000 scripts/run-bridge.sh \
  --allow-origin http://localhost \
  --allow-host herdr-host.local
```

`--allow-origin` is the Android-relevant setting because the bundled WebView does not load its page
from a bridge. Browser-served multi-bridge pages have an additional Content Security Policy gate on
the bridge serving the page; use `--allow-connect-origin http://other-bridge:8787` there when that
page should connect to another bridge.

## HTTP And Cleartext

The Android shell currently enables Capacitor cleartext support:

```ts
server: {
  androidScheme: "http",
  cleartext: true,
},
```

This is intentional for the current Herdr bridge workflow because user-managed bridge URLs are often
plain `http://host:port`, including LAN and mesh-network addresses. The app does not enable
mixed-content mode because its WebView origin is also HTTP. Treat cleartext bridge URLs as a user
trust decision: only point the app at Herdr bridges on networks you trust. For a public or
store-distributed build, prefer HTTPS bridge URLs and revisit whether cleartext should remain enabled.

Android cloud auto-backup is disabled for the shell, so saved bridge profiles are not copied into
device backup storage.

## Settings On Android

The Android shell uses the same area-based Settings UI described in the project README. Android
starts disconnected, so the Bridge area is required for selecting a backend. On narrow screens the
area selector appears as horizontal tabs. Android-specific touch behavior lives in the Mobile area. Enable **Focus command input after Send** there to refocus the cleared command field
for continued typing. This option is off by default and does not change Stage behavior.

## Build Prerequisites

- Node.js 22 or newer
- npm
- JDK 21
- Android SDK command-line tools
- Android SDK Platform 36
- Android SDK Build Tools 36.0.0
- Android SDK Platform Tools

Set these environment variables when using command-line SDK tools:

```bash
export ANDROID_HOME="$HOME/.local/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
```

If Gradle is run without those environment variables, create the ignored local SDK pointer instead:

```properties
# android/local.properties
sdk.dir=/absolute/path/to/android-sdk
```

Known verified versions:

- OpenJDK 21
- Android SDK command-line tools 20.0
- Android SDK Platform 36
- Android SDK Build Tools 36.0.0
- Android SDK Platform Tools 37.0.0

## Build Commands

Install dependencies:

```bash
npm install
npm install --prefix web
```

Sync the web build into Android:

```bash
npm run android:sync
```

Build a debug APK:

```bash
npm run android:build:debug
```

The debug APK is written to:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Open in Android Studio after syncing:

```bash
npm run android:open
```

## Verification Status

This branch was command-line verified with:

```bash
HERDR_SRC=/path/to/herdr scripts/check-vendor.sh
npm run check
npm run android:build:debug
```

The debug APK is produced at `android/app/build/outputs/apk/debug/app-debug.apk`. Install that
artifact on a device or emulator for the manual smoke checklist below.

## Manual Smoke Checklist

On a trusted LAN:

1. Start the bridge, for example:

   ```bash
   HOST=0.0.0.0 PORT=4000 scripts/run-bridge.sh --allow-origin http://localhost
   ```

2. Install the debug APK on an Android device.
3. Open the app and confirm the shell loads without network access.
4. Open Settings and select the Bridge area.
5. Add a backend such as `http://192.168.1.20:4000`.
6. Use `Test` and confirm it reports reachable.
7. Use `Save`, enable the saved bridge with its Enable toggle, and confirm the bridge chip appears
   in the sidebar.
8. Confirm snapshot, event updates, terminal attach, text input, stage-only input, uploads, and pane controls work.
9. Open the Terminal area, change input transport and batching delay, and confirm terminal input
   still works.
10. Open the Mobile area, toggle the mobile terminal tap setting, and confirm terminal taps can
    focus either the text input or terminal.
11. Force-close and reopen the app; confirm the active backend and settings persist.
12. Test Android back behavior from the mobile sidebar/detail views.
13. Test an unreachable backend and confirm the app stays usable enough to edit settings.

## Release Notes

The generated debug APK is unsigned for distribution. A production release still needs:

- final Android application id decision;
- app icon and splash assets;
- signing key and release signing config;
- release build command/checklist;
- device/emulator smoke testing;
- release validation for `--allow-origin http://localhost` and any documented `--allow-host` names;
- backup policy review before any secret or pairing-token storage is added;
- a decision on whether HTTP cleartext remains enabled for production builds.
