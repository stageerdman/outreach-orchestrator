#!/bin/sh
# Builds Outreach.app (a native window around the local web UI) into dist/
# and installs it to ~/Applications. Needs Xcode's swiftc and Node.
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
NODE=$(command -v node)
APP=dist/Outreach.app

rm -rf "$APP" dist/icon.iconset
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" dist/icon.iconset

swiftc -O -o "$APP/Contents/MacOS/Outreach" macos/main.swift

swift macos/icon.swift dist/icon.png
for s in 16 32 128 256 512; do
  sips -z $s $s dist/icon.png --out "dist/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) dist/icon.png --out "dist/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns dist/icon.iconset -o "$APP/Contents/Resources/Outreach.icns"

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Outreach</string>
  <key>CFBundleDisplayName</key><string>Outreach</string>
  <key>CFBundleIdentifier</key><string>xyz.erdman.outreach</string>
  <key>CFBundleExecutable</key><string>Outreach</string>
  <key>CFBundleIconFile</key><string>Outreach</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>OutreachProjectDir</key><string>$ROOT</string>
  <key>OutreachNode</key><string>$NODE</string>
  <key>OutreachPort</key><string>${PORT:-3000}</string>
</dict></plist>
EOF

codesign --force --sign - "$APP"
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/Outreach.app"
cp -R "$APP" "$HOME/Applications/"
echo "Built $APP and installed ~/Applications/Outreach.app"
