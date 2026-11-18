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

## Build

GitHub Actions → **Android Build** → *Run workflow*, or push to `main`.
The signed APK is attached as the `yasco-erp-apk` artifact (kept 30 days).

The keystore lives only in repository secrets:

| Secret | Meaning |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | base64 of `release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | store password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

If the keystore is lost, Android will refuse to update an installed app —
keep a backup. The current keystore backup is outside this repository.

## Offline behaviour

| Area | Status |
| --- | --- |
| App shell / navigation / UI | ✅ Fully offline (assets are in the APK) |
| Static screens, forms, local calculations | ✅ Offline |
| Reading server data | ⏳ offline query cache (next step) |
| Writing server data while offline | ⏳ sync queue (next step) |

The ERP already contains two offline engines that this app can reuse:

* `src/lib/desktop/*` + `desktop/backend/*` — SQLite mirror used by the
  Windows desktop build (Node sidecar, not available on Android).
* `src/lib/db/localDatabase.ts` + `src/lib/sync/*` — Dexie/IndexedDB queue and
  pull/push engine (runs in the WebView, works on Android).

## Local desktop build (unchanged)

`npm run build && npx tauri build` still produces the Windows desktop app with
the Node sidecar; the Android changes are behind `#[cfg(target_os = "android")]`
and `tauri.android.conf.json`.
