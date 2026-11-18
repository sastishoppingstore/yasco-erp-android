#!/usr/bin/env bash
# Emulator smoke test for the Android build.
#
# Runs inside `reactivecircus/android-emulator-runner`, which executes the
# `script:` input line by line in separate shells — so everything has to live
# in one file instead of inline commands.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APK_DIR="$ROOT/src-tauri/gen/android/app/build/outputs/apk"

# The smoke workflow signs the APK and drops it in the workspace root; an
# unsigned build cannot be installed (INSTALL_PARSE_FAILED_NO_CERTIFICATES).
if [ -f "$ROOT/yasco-smoke.apk" ]; then
  APK="$ROOT/yasco-smoke.apk"
else
  APK="$(find "$APK_DIR" -name '*-signed.apk' | head -1)"
  [ -n "$APK" ] || APK="$(find "$APK_DIR" -name '*.apk' | head -1)"
fi

echo "workspace: $ROOT"
echo "APK: ${APK:-<none>}"
if [ -z "$APK" ] || [ ! -f "$APK" ]; then
  echo "::error::APK not found under $APK_DIR"
  ls -R "$APK_DIR" 2>/dev/null | head -30 || true
  exit 1
fi

echo "=== android version ==="
adb shell getprop ro.build.version.release || true
adb shell getprop ro.build.version.sdk || true

echo "=== install ==="
adb install -r -t "$APK"
# `logcat -c` fails on some older images while logd is still starting; the
# check below does not depend on a clean buffer.
adb logcat -c 2>/dev/null || true

echo "=== launch ==="
adb shell am start -W -n com.yasco.erp/.MainActivity
sleep 20

echo "=== foreground activity ==="
adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | head -3 || true

echo "=== process ==="
PID="$(adb shell pidof com.yasco.erp || true)"
echo "pid: ${PID:-<none>}"
if [ -z "$PID" ]; then
  echo "::error::app is not running after launch"
  adb logcat -d | tail -80
  exit 1
fi

echo "=== WebView / crash check ==="
if adb logcat -d | grep -E "ERR_CONNECTION_REFUSED|net::ERR_|FATAL EXCEPTION"; then
  echo "::error::WebView could not load the bundled app, or the app crashed"
  exit 1
fi

# At the very first screen there is no WebView history yet, so wry falls back
# to the default behaviour and the activity finishes. Both outcomes are fine;
# a crash is not.
echo "=== back button ==="
adb shell input keyevent KEYCODE_BACK
sleep 3
if adb shell pidof com.yasco.erp >/dev/null 2>&1; then
  echo "back navigated inside the app (history existed)"
else
  echo "app closed on back (no history at the start screen)"
fi

if adb logcat -d | grep -E "FATAL EXCEPTION|ERR_CONNECTION_REFUSED"; then
  echo "::error::crash or WebView failure after the back press"
  exit 1
fi

echo "=== relaunch (second start must work too) ==="
adb shell am start -W -n com.yasco.erp/.MainActivity
sleep 8
adb shell pidof com.yasco.erp >/dev/null || { echo "::error::app did not restart"; exit 1; }

echo "smoke test passed on Android $(adb shell getprop ro.build.version.release)"