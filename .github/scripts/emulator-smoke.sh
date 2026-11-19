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

# A surviving process is not proof that the UI painted: a WebView error page or
# a blank screen keeps the app alive too. The ERP always draws its branded
# splash/UI, which has hundreds of distinct colours at 64x64, so a nearly
# uniform screenshot means nothing rendered.
render_check() {
  local tag="$1"
  adb exec-out screencap -p > "/tmp/ys-render-$tag.png" 2>/dev/null || return 0
  python3 - "/tmp/ys-render-$tag.png" "$tag" <<'PY'
import sys
try:
    from PIL import Image
except Exception:
    print("pillow missing; skipping render check")
    sys.exit(0)
path, tag = sys.argv[1], sys.argv[2]
try:
    im = Image.open(path).convert("RGB").resize((64, 64))
except Exception as exc:
    print(f"render[{tag}]: cannot read screenshot ({exc}); skipping")
    sys.exit(0)
uniq = len(im.getcolors(64 * 64) or [])
print(f"render[{tag}]: unique colours = {uniq}")
if uniq < 24:
    print("::error::the WebView painted nothing (blank screen)")
    sys.exit(1)
PY
}

echo "=== install ==="
adb install -r -t "$APK"
# `logcat -c` fails on some older images while logd is still starting; the
# check below does not depend on a clean buffer.
adb logcat -c 2>/dev/null || true

echo "=== launch ==="
adb shell am start -W -n com.yasco.erp/.MainActivity
sleep 20

echo "=== render check ==="
render_check "first"

echo "=== UI marker (informational) ==="
if adb logcat -d | grep -q "YASCO_UI_READY"; then
  echo "the bundled UI reported itself ready"
else
  echo "note: no YASCO_UI_READY marker (console may not be forwarded to logcat)"
fi

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
CRASH=$(adb logcat -d | grep -A40 "FATAL EXCEPTION" || true)
if [ -n "$CRASH" ]; then
  echo "$CRASH"
  echo "::error::the app crashed during startup"
  exit 1
fi
if adb logcat -d | grep -E "ERR_CONNECTION_REFUSED|net::ERR_"; then
  echo "::error::WebView could not load the bundled app"
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

# A cold second start is what the customer does after the phone reboots, so
# force-stop first: relaunching an app that is already resumed returns stale
# state on some API levels and made this check flaky on Android 14.
echo "=== relaunch (cold second start) ==="
adb shell am force-stop com.yasco.erp || true
sleep 2
adb shell am start -W -n com.yasco.erp/.MainActivity || true

PID=""
for _ in $(seq 1 20); do
  PID="$(adb shell pidof com.yasco.erp | tr -d '\r' || true)"
  [ -n "$PID" ] && break
  sleep 1
done
if [ -z "$PID" ]; then
  echo "::error::app did not restart"
  echo "=== logcat (last 80) ==="
  adb logcat -d | tail -80 || true
  echo "=== activities ==="
  adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity|com.yasco" | head -10 || true
  exit 1
fi
echo "restarted with pid $PID"

echo "=== render check after cold start ==="
sleep 10
render_check "cold"

echo "=== foreground activity after restart ==="
adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | head -3 || true

echo "smoke test passed on Android $(adb shell getprop ro.build.version.release)"