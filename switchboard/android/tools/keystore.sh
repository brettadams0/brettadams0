#!/usr/bin/env sh
# Make the signing key, once. (Adapted from cue/tools/keystore.sh.)
#
# Self-update depends on it: Android only installs an update signed with the
# same key as the installed app. Lose this file and every phone has to
# uninstall and reinstall by hand. Both outputs are gitignored. Back them up.
set -eu
cd "$(dirname "$0")/.."
if [ -f switchboard-release.jks ]; then
  echo "switchboard-release.jks already exists; a new key could not update installed apps." >&2
  exit 1
fi
PASSWORD="${SB_KEYSTORE_PASSWORD:-$(head -c 24 /dev/urandom | base64 | tr -d '/+=')}"
keytool -genkeypair -keystore switchboard-release.jks -storepass "$PASSWORD" -keypass "$PASSWORD" \
  -alias switchboard -keyalg RSA -keysize 4096 -validity 10950 -dname "CN=Switchboard, O=Sideload"
cat > keystore.properties <<PROPS
storeFile=switchboard-release.jks
storePassword=$PASSWORD
keyAlias=switchboard
keyPassword=$PASSWORD
PROPS
echo "Wrote android/switchboard-release.jks and android/keystore.properties. Back them up outside this checkout."
