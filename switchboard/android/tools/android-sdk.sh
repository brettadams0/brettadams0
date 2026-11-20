#!/usr/bin/env bash
# Installs just enough Android SDK to build the Switchboard APK, without Android Studio.
#
# Android Studio is a ~1 GB IDE you would open once. What the build actually
# needs is three packages and a licence acceptance, all free, all from Google's
# own endpoints. This fetches them into a directory you own and writes the
# local.properties that Gradle looks for.
#
#   ./tools/android-sdk.sh && ./gradlew :app:assembleDebug
#
# Re-running is safe: sdkmanager skips anything already installed.
set -euo pipefail

SDK_ROOT="${ANDROID_HOME:-$HOME/android-sdk}"
# Kept in step with app/build.gradle.kts. If compileSdk moves, move these.
PLATFORM="platforms;android-35"
BUILD_TOOLS="build-tools;35.0.0"

case "$(uname -s)" in
  Darwin) TOOLS_ZIP="commandlinetools-mac-11076708_latest.zip" ;;
  Linux)  TOOLS_ZIP="commandlinetools-linux-11076708_latest.zip" ;;
  *)      echo "Unsupported OS: $(uname -s). On Windows, use Android Studio." >&2; exit 1 ;;
esac

command -v java >/dev/null || { echo "A JDK 17+ is required and was not found." >&2; exit 1; }

if [ ! -x "$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "Installing command-line tools into $SDK_ROOT"
  mkdir -p "$SDK_ROOT/cmdline-tools"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "https://dl.google.com/android/repository/$TOOLS_ZIP" -o "$TMP/tools.zip"
  unzip -q "$TMP/tools.zip" -d "$TMP"
  # The zip unpacks to cmdline-tools/; sdkmanager insists on being at
  # cmdline-tools/latest/ or it cannot locate the SDK root.
  rm -rf "$SDK_ROOT/cmdline-tools/latest"
  mv "$TMP/cmdline-tools" "$SDK_ROOT/cmdline-tools/latest"
fi

SDKMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"

# Licences are a one-time interactive prompt otherwise, and the build fails
# opaquely without them.
yes | "$SDKMANAGER" --sdk_root="$SDK_ROOT" --licenses >/dev/null 2>&1 || true
"$SDKMANAGER" --sdk_root="$SDK_ROOT" "platform-tools" "$PLATFORM" "$BUILD_TOOLS"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "sdk.dir=$SDK_ROOT" > "$REPO_ROOT/local.properties"

cat <<EOF

Done. $SDK_ROOT

  ./gradlew :app:assembleDebug
  $SDK_ROOT/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk

local.properties now points Gradle at that SDK. It is in .gitignore, because it
is a path on your machine and nobody else's.
EOF
