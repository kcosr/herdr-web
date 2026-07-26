#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
source_svg="$repo_root/web/public/herdr-logo.svg"
app_icon="$script_dir/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
splash_dir="$script_dir/App/App/Assets.xcassets/Splash.imageset"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "error: rsvg-convert is required to regenerate iOS branding assets" >&2
  exit 1
fi
if [[ ! -f "$source_svg" ]]; then
  echo "error: canonical Herdr logo not found at $source_svg" >&2
  exit 1
fi

asset_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/herdr-ios-assets.XXXXXX")"
cleanup() {
  rm -rf "$asset_tmp_dir"
}
trap cleanup EXIT

# Add an iOS-safe margin around the canonical artwork without maintaining a
# second copy of its path data.
sed \
  -e 's/width="512" height="512" viewBox="0 0 512 512"/width="1024" height="1024" viewBox="-64 -64 640 640"/' \
  -e 's/<rect width="512" height="512" fill="#d9dad8"\/>/<rect x="-64" y="-64" width="640" height="640" fill="#d9dad8"\/>/' \
  "$source_svg" > "$asset_tmp_dir/app-icon.svg"

rsvg-convert \
  --format=png \
  --width=1024 \
  --height=1024 \
  --background-color="#d9dad8" \
  --output="$app_icon" \
  "$asset_tmp_dir/app-icon.svg"

# The launch artwork uses the app's Catppuccin crust background and a compact,
# high-contrast rendering of the same canonical logo.
sed \
  -e 's/width="512" height="512" viewBox="0 0 512 512"/width="2732" height="2732" viewBox="-1110 -1110 2732 2732"/' \
  -e 's/<rect width="512" height="512" fill="#d9dad8"\/>/<rect x="-1110" y="-1110" width="2732" height="2732" fill="#11111b"\/>/' \
  -e 's/<g fill="#303438"/<g fill="#d9dad8"/' \
  "$source_svg" > "$asset_tmp_dir/splash.svg"

rsvg-convert \
  --format=png \
  --width=2732 \
  --height=2732 \
  --background-color="#11111b" \
  --output="$asset_tmp_dir/splash.png" \
  "$asset_tmp_dir/splash.svg"

for filename in splash-2732x2732.png splash-2732x2732-1.png splash-2732x2732-2.png; do
  cp "$asset_tmp_dir/splash.png" "$splash_dir/$filename"
done

echo "Generated iOS icon and splash assets from web/public/herdr-logo.svg"
