#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
project="$repo_root/ios/App/App.xcodeproj"
derived_data_path="${IOS_DERIVED_DATA_PATH:-$repo_root/ios/DerivedData}"
configuration="${IOS_CONFIGURATION:-Debug}"

if [[ -n "${IOS_SIMULATOR_ID:-}" ]]; then
  destination="platform=iOS Simulator,id=$IOS_SIMULATOR_ID"
elif [[ -n "${IOS_SIMULATOR_NAME:-}" ]]; then
  destination="platform=iOS Simulator,name=$IOS_SIMULATOR_NAME,OS=latest"
else
  destination="generic/platform=iOS Simulator"
fi

if [[ ! -f "$repo_root/ios/App/App/public/index.html" ]]; then
  echo "error: bundled web assets are missing; run npm run ios:sync first" >&2
  exit 1
fi

"$script_dir/check-ios.sh"

echo "Building Herdr Web for $destination"
xcodebuild \
  -quiet \
  -project "$project" \
  -scheme App \
  -configuration "$configuration" \
  -sdk iphonesimulator \
  -destination "$destination" \
  -derivedDataPath "$derived_data_path" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build

app_path="$derived_data_path/Build/Products/${configuration}-iphonesimulator/App.app"
if [[ ! -d "$app_path" ]]; then
  echo "error: expected simulator app was not produced at $app_path" >&2
  exit 1
fi
if [[ ! -f "$app_path/PrivacyInfo.xcprivacy" ]]; then
  echo "error: built simulator app is missing PrivacyInfo.xcprivacy" >&2
  exit 1
fi
plutil -lint "$app_path/Info.plist" "$app_path/PrivacyInfo.xcprivacy" >/dev/null

echo "Built simulator app: $app_path"
