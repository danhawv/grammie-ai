#!/bin/zsh
# Build Grammie for the App Store and upload it to TestFlight, with no iPhone
# registered on the team. Xcode's automatic signing only archives with a
# development profile (which needs a device), so: archive unsigned, sign the
# app and Share Extension ad hoc with their entitlements (so App Groups and
# Associated Domains survive), then let -exportArchive re-sign for the store.
# Bump CURRENT_PROJECT_VERSION before each upload.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${OUT:-/private/tmp/grammie-ios}
TEAM=5DB554F5CQ
rm -rf "$OUT" && mkdir -p "$OUT"
VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY:?set the pk_live key} npm run cap:sync
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$OUT/App.xcarchive" -derivedDataPath "$OUT/dd" CODE_SIGNING_ALLOWED=NO archive | tail -1
A="$OUT/App.xcarchive/Products/Applications/App.app"
ent() { cp "$1" "$OUT/$2.ent"; /usr/libexec/PlistBuddy -c "Add :application-identifier string $TEAM.$3" -c "Add :com.apple.developer.team-identifier string $TEAM" "$OUT/$2.ent"; }
ent App/App.entitlements app ai.grammie.app
ent ShareExtension/ShareExtension.entitlements ext ai.grammie.app.ShareExtension
for f in "$A"/Frameworks/*.framework; do codesign -f -s - "$f"; done
codesign -f -s - --entitlements "$OUT/ext.ent" "$A/PlugIns/ShareExtension.appex"
codesign -f -s - --entitlements "$OUT/app.ent" "$A"
cat > "$OUT/upload.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string><key>signingStyle</key><string>automatic</string>
<key>teamID</key><string>$TEAM</string><key>destination</key><string>${DEST:-upload}</string>
<key>uploadSymbols</key><true/><key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/upload.plist" -allowProvisioningUpdates | tail -3
