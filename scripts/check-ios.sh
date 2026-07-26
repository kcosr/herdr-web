#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
ios_root="$repo_root/ios"
project="$ios_root/App/App.xcodeproj"
info_plist="$ios_root/App/App/Info.plist"
privacy_manifest="$ios_root/App/App/PrivacyInfo.xcprivacy"
generated_config="$ios_root/App/App/capacitor.config.json"
project_file="$project/project.pbxproj"
app_icon="$ios_root/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
splash="$ios_root/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: iOS checks require macOS" >&2
  exit 1
fi

for command_name in plutil sips xcodebuild; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "error: required command is unavailable: $command_name" >&2
    exit 1
  fi
done

for required_path in \
  "$project_file" \
  "$info_plist" \
  "$privacy_manifest" \
  "$generated_config" \
  "$ios_root/App/App/Base.lproj/Main.storyboard" \
  "$ios_root/App/App/Base.lproj/LaunchScreen.storyboard" \
  "$ios_root/App/CapApp-SPM/Package.swift" \
  "$project/project.xcworkspace/xcshareddata/swiftpm/Package.resolved" \
  "$app_icon" \
  "$splash"; do
  if [[ ! -f "$required_path" ]]; then
    echo "error: required iOS project file is missing: $required_path" >&2
    exit 1
  fi
done

plutil -lint "$info_plist" "$privacy_manifest" >/dev/null

plist_buddy="/usr/libexec/PlistBuddy"
assert_plist_value() {
  local plist_path="$1"
  local key_path="$2"
  local expected="$3"
  local actual
  actual="$("$plist_buddy" -c "Print :$key_path" "$plist_path")"
  if [[ "$actual" != "$expected" ]]; then
    echo "error: $plist_path:$key_path expected '$expected', found '$actual'" >&2
    exit 1
  fi
}

assert_plist_value "$info_plist" "CFBundleDisplayName" "Herdr Web"
assert_plist_value "$info_plist" "UIUserInterfaceStyle" "Dark"
assert_plist_value "$info_plist" "UIStatusBarStyle" "UIStatusBarStyleLightContent"
assert_plist_value "$info_plist" "NSAppTransportSecurity:NSAllowsLocalNetworking" "true"
assert_plist_value "$info_plist" "NSAppTransportSecurity:NSAllowsArbitraryLoadsInWebContent" "true"
assert_plist_value \
  "$privacy_manifest" \
  "NSPrivacyAccessedAPITypes:0:NSPrivacyAccessedAPIType" \
  "NSPrivacyAccessedAPICategoryUserDefaults"
assert_plist_value \
  "$privacy_manifest" \
  "NSPrivacyAccessedAPITypes:0:NSPrivacyAccessedAPITypeReasons:0" \
  "CA92.1"

local_network_description="$("$plist_buddy" -c "Print :NSLocalNetworkUsageDescription" "$info_plist")"
if [[ -z "${local_network_description//[[:space:]]/}" ]]; then
  echo "error: NSLocalNetworkUsageDescription must not be empty" >&2
  exit 1
fi

assert_json_value() {
  local key_path="$1"
  local expected="$2"
  local actual
  actual="$(plutil -extract "$key_path" raw -o - "$generated_config")"
  if [[ "$actual" != "$expected" ]]; then
    echo "error: $generated_config:$key_path expected '$expected', found '$actual'" >&2
    exit 1
  fi
}

assert_json_value "backgroundColor" "#11111b"
assert_json_value "ios.allowsLinkPreview" "false"
assert_json_value "ios.contentInset" "never"
assert_json_value "ios.initialFocus" "false"
assert_json_value "ios.preferredContentMode" "mobile"
assert_json_value "plugins.Keyboard.autoBackdropColor" "auto"
assert_json_value "plugins.Keyboard.resize" "native"
assert_json_value "plugins.Keyboard.style" "DARK"

if ! grep -q "PrivacyInfo.xcprivacy in Resources" "$project_file"; then
  echo "error: PrivacyInfo.xcprivacy is not included in the App resources phase" >&2
  exit 1
fi
if ! grep -q "IPHONEOS_DEPLOYMENT_TARGET = 15.0;" "$project_file"; then
  echo "error: iOS deployment target is not 15.0" >&2
  exit 1
fi
if ! grep -q "PRODUCT_BUNDLE_IDENTIFIER = dev.herdr.web;" "$project_file"; then
  echo "error: iOS bundle identifier is not dev.herdr.web" >&2
  exit 1
fi

assert_image() {
  local image_path="$1"
  local expected_width="$2"
  local expected_height="$3"
  local width
  local height
  local has_alpha
  width="$(sips -g pixelWidth "$image_path" 2>/dev/null | awk '/pixelWidth:/ {print $2}')"
  height="$(sips -g pixelHeight "$image_path" 2>/dev/null | awk '/pixelHeight:/ {print $2}')"
  has_alpha="$(sips -g hasAlpha "$image_path" 2>/dev/null | awk '/hasAlpha:/ {print $2}')"
  if [[ "$width" != "$expected_width" || "$height" != "$expected_height" ]]; then
    echo "error: $image_path must be ${expected_width}x${expected_height}, found ${width}x${height}" >&2
    exit 1
  fi
  if [[ "$has_alpha" != "no" ]]; then
    echo "error: $image_path must be opaque, found hasAlpha=$has_alpha" >&2
    exit 1
  fi
}

assert_image "$app_icon" 1024 1024
for splash_filename in \
  "splash-2732x2732.png" \
  "splash-2732x2732-1.png" \
  "splash-2732x2732-2.png"; do
  assert_image \
    "$ios_root/App/App/Assets.xcassets/Splash.imageset/$splash_filename" \
    2732 \
    2732
done

if ! cmp -s \
  "$ios_root/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png" \
  "$ios_root/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png" ||
  ! cmp -s \
    "$ios_root/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png" \
    "$ios_root/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png"; then
  echo "error: iOS splash variants must be identical source artwork" >&2
  exit 1
fi

for ignored_path in \
  "ios/App/App/public/index.html" \
  "ios/App/App/capacitor.config.json" \
  "ios/App/App/config.xml" \
  "ios/capacitor-cordova-ios-plugins/resources/.gitkeep" \
  "ios/DerivedData/probe"; do
  if ! git -C "$repo_root" check-ignore -q "$ignored_path"; then
    echo "error: generated path is not ignored: $ignored_path" >&2
    exit 1
  fi
done

if ! xcodebuild -project "$project" -scheme App -list >/dev/null 2>&1; then
  echo "error: Xcode could not load the App scheme" >&2
  exit 1
fi

echo "iOS project audit passed"
