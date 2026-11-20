#!/usr/bin/env bash
# Build a signed release APK and publish it to the switchboard. Every phone
# running the app downloads and installs it on its own.
#
#   android/tools/release.sh "what changed"
#
# Claude sessions run this after changing the app. Needs: an Android SDK
# (tools/android-sdk.sh), the signing key (tools/keystore.sh), `sb` set up.
set -euo pipefail
cd "$(dirname "$0")/.."
NOTES="${1:-}"
[ -f keystore.properties ] || { echo "No signing key. Run android/tools/keystore.sh once (and back it up)." >&2; exit 1; }
# Minutes since the epoch: always increasing, no counter to keep in sync.
CODE=$(( $(date +%s) / 60 ))
NAME="${SB_VERSION_NAME:-$(date -u +%Y.%m.%d-%H%M)}"
./gradlew --no-daemon -q :app:assembleRelease -PsbVersionCode="$CODE" -PsbVersionName="$NAME"
APK=app/build/outputs/apk/release/app-release.apk
SB="$(cd .. && pwd)/bin/sb"
"$SB" release "$APK" --code "$CODE" --name "$NAME" --notes "$NOTES"
