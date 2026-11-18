# YASCO ERP — Android

Android build of the YASCO ERP. The complete front-end (`dist`) is **bundled
inside the APK** and served by an in-app loopback HTTP server; the app is not a
remote-URL wrapper.

```
┌──────────────────────────── APK ────────────────────────────┐
│  Tauri (Rust) shell                                          │
│                                                              │
│  WebView ──► http://127.0.0.1:<random>/app/                  │
│                 │                                            │
│                 ├── static assets  ──► embedded dist (memory)│
│                 └── /api/*         ──► https://yasco.tech    │
└──────────────────────────────────────────────────────────────┘
```

* The UI is the Vite build of this repository (`npm run build:frontend`).
* `/api/*` is reverse-proxied to the hosted ERP, so the existing cookie based
  authentication works unchanged — the live server needs **no CORS or config
  change**.
* `Set-Cookie` responses are rewritten to first-party cookies (the WebView runs
  on `127.0.0.1`).
* Because the shell is local, the app opens instantly and never shows a
  browser-hosted page.

## Install

Every build is published twice, both always serve the newest APK:

| Link | Source |
| --- | --- |
| `https://github.com/sastishoppingstore/yasco-erp-download/releases/latest/download/YASCO-ERP.apk` | GitHub release (linked from the landing page footer) |
| `https://yasco.tech/YASCO-ERP.apk` | mirror on the website's own server |

On the phone: open one of the links, download, allow *Install unknown apps*,
install and sign in with the normal ERP account.

## Build

GitHub Actions → **Android Build** → *Run workflow*, or push to `main`.

| Workflow | Purpose |
| --- | --- |
| `android.yml` | Release build (universal, 4 ABIs), signed APK, published to GitHub Releases |
| `android-smoke.yml` | Boots emulators for Android 8.0, 10, 12 and 14, installs the APK and checks WebView + back button |

Every push produces `android-build-<n>` in this repository and `v1.0.<n>` in the
public download repository (Actions artifact storage is not used).

Build facts:

| Item | Value |
| --- | --- |
| Framework | Tauri 2 (Rust shell + bundled web front-end + Android System WebView) |
| Package | `com.yasco.erp` |
| minSdkVersion | 24 (Android 7.0) |
| targetSdkVersion / compileSdk | 35 |
| versionCode | `150600 + <CI run number>` — grows on every build |
| ABIs | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` (one universal APK) |
| Signing | release keystore, APK Signature Scheme V1 + V2 + V3 |

Secrets:

| Secret | Meaning |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | base64 of `release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | store password |
| `ANDROID_KEY_ALIAS` | key alias (`yasco`) |
| `ANDROID_KEY_PASSWORD` | key password |
| `DOWNLOAD_REPO_TOKEN` | PAT used to publish the APK to `yasco-erp-download` |
| `VPS_SSH_KEY` | restricted key that can only write the landing page and `/var/www/YASCO-ERP.apk` |

If the keystore is lost, Android will refuse to update an installed app — keep a
backup (`~/.secrets/yasco-release.keystore` on the build machine).

## Offline behaviour

| Area | Status |
| --- | --- |
| App shell / navigation / UI | ✅ Fully offline (assets are inside the APK) |
| Static screens, forms, local calculations | ✅ Offline |
| Reading server data | ✅ Last successful response per query is cached in IndexedDB and served when the ERP is unreachable |
| Writing server data while offline | ✅ Mutations are queued in IndexedDB and replayed in order when the connection returns |
| Queue visibility | ✅ Floating bar: pending/rejected count, per-item retry and discard |

How the write queue behaves (`src/lib/offline/mutationQueue.ts`):

1. A mutation that cannot be delivered (no network, or the loopback proxy
   answers `503`) is stored with its exact request body.
2. The UI gets a marker result `{ ok: true, offline: true, queued: true }`, so
   the screen does not throw, and the floating bar shows the pending count.
3. When connectivity comes back (`online` event, app foreground, or every 20 s)
   the queue is replayed **in the original order**, one request at a time.
4. If the server answers with an error (401/403/422/500), the flush **stops** at
   that item so later changes cannot overtake it. The item is marked *rejected*
   with the server message and can be retried or discarded from the bar.

Limitations worth knowing:

* Requests are identified only by their body, so a double tap that produces two
  different bodies is queued twice (identical bodies are de-duplicated).
* Server-side IDs are unknown while offline: a screen that immediately navigates
  to `.../<new id>` will not have an id. Navigation itself is unaffected.
* Conflicts are resolved by the server when the queued change is applied; there
  is no field level merge.

## Splash screen and logo

* The launcher icon is a real 3D mark generated from
  `assets/branding/yasco-logo.svg` by `scripts/make-branding.py`
  (`npx tauri icon` writes the Android mipmaps afterwards).
* Android's `windowBackground` is replaced with a brand gradient + logo
  layer-list (`res/drawable/ys_splash.xml`), so there is no white flash while
  the WebView boots.
* `index.html` contains an inline splash overlay (logo, wordmark, progress
  bar) that fades out as soon as the bundle loads, with a 6 s hard fallback.

## Back button

## Build verification

CI fails the build unless `apksigner verify` reports V1, V2 **and** V3, `aapt
dump badging` shows `minSdk 24`, `targetSdk 35`, the expected `versionCode`,
`INTERNET` permission and all four ABIs. After publishing, the public asset is
downloaded again and compared by SHA-256 (a truncated upload is the usual cause
of *"package appears to be invalid"*), and the VPS mirror is checked the same
way.

`tauri android init` generates a `MainActivity` that inherits
`handleBackNavigation = false`, which closes the app from any screen. During CI,
`scripts/patch-android.py` sets it to `true`, so the hardware back button walks
the WebView history (React Router entries) and only closes the app when there is
nothing left to go back to. The emulator smoke test presses back and asserts the
process is still alive.

## Local desktop build (unchanged)

`npm run build && npx tauri build` still produces the Windows desktop app with
the Node sidecar; the Android changes are behind `#[cfg(target_os = "android")]`
and `tauri.android.conf.json`.