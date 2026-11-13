#!/usr/bin/env bash
# Run at repo root. Android SDK (API 34/build-tools 34), JDK 17, Gradle 8.9 required.
# Release: export BLUEOS_KEYSTORE_PROPERTIES=/absolute/path/outside/repo/keystore.properties
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ANDROID_HOME:?Set ANDROID_HOME to Android SDK path}"
: "${JAVA_HOME:?Set JAVA_HOME to JDK 17 path}"
npm ci --no-audit --no-fund
npm run build:android-web
cd android
"${GRADLE_BIN:-gradle}" testDebugUnitTest assembleDebug assembleRelease --no-daemon
printf '\nAPKs (release is UNSIGNED if no release signing properties were supplied):\n'
sha256sum app/build/outputs/apk/*/*.apk
