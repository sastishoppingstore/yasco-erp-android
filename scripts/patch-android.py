#!/usr/bin/env python3
"""Patch the generated Android project for the YASCO ERP build.

`tauri android init` regenerates `src-tauri/gen/android` from a template, so
every change the app needs is applied here, idempotently, right after init:

1. `AndroidManifest.xml`
   * `INTERNET` permission (the API is reached over https),
   * `usesCleartextTraffic` because the ERP is served by the app's own
     loopback server on http://127.0.0.1:<port>.

2. `MainActivity.kt`
   * `handleBackNavigation = true`. Tauri ships it as `false`, which makes the
     hardware back button close the app from anywhere, including three screens
     deep inside the ERP. With `true`, wry walks the WebView history first
     (React Router pushes real history entries) and only closes the app when
     there is nothing left to go back to.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAIN = ROOT / "src-tauri" / "gen" / "android" / "app" / "src" / "main"


def patch_manifest() -> str:
    path = MAIN / "AndroidManifest.xml"
    if not path.exists():
        sys.exit(f"missing {path}")
    text = path.read_text(encoding="utf-8")
    original = text

    if "usesCleartextTraffic" not in text:
        text = re.sub(
            r"<application\b",
            '<application android:usesCleartextTraffic="true"',
            text,
            count=1,
        )

    if 'android.permission.INTERNET' not in text:
        text = text.replace(
            "<application",
            '<uses-permission android:name="android.permission.INTERNET"/>\n    <application',
            1,
        )

    if text != original:
        path.write_text(text, encoding="utf-8")
    cleartext = "usesCleartextTraffic" in text
    internet = "android.permission.INTERNET" in text
    return f"manifest: cleartext={cleartext} internet={internet}"


BACK_NAV = """
    // Hardware back walks the WebView history (React Router routes) instead of
    // closing the app. When no history is left, wry falls back to the default
    // behaviour and the activity finishes.
    override val handleBackNavigation: Boolean = true
"""


def patch_main_activity() -> str:
    candidates = sorted(MAIN.rglob("MainActivity.kt"))
    if not candidates:
        candidates = sorted(MAIN.rglob("MainActivity.java"))
    if not candidates:
        sys.exit("MainActivity not found in src-tauri/gen/android")

    path = candidates[0]
    text = path.read_text(encoding="utf-8")

    if "handleBackNavigation" in text:
        return f"{path.name}: back navigation already enabled"

    pattern = re.compile(r"(class\s+MainActivity\s*(?::\s*[A-Za-z0-9_.]+\(\))?\s*\{)")
    match = pattern.search(text)
    if not match:
        sys.exit(f"cannot find MainActivity class declaration in {path}")

    inserted = text[: match.start()] + match.group(1) + "\n" + BACK_NAV + text[match.end():]
    path.write_text(inserted, encoding="utf-8")
    return f"{path.name}: back navigation enabled"


def main() -> None:
    print(patch_manifest())
    print(patch_main_activity())


if __name__ == "__main__":
    main()