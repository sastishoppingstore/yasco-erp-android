import path from "path"
import { fileURLToPath } from "url"
const __dirname = import.meta.dirname || path.dirname(fileURLToPath(import.meta.url))
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  define: {
    // Must be defined: the minifier removes React's own `typeof` guard around
    // this identifier, which otherwise becomes an unguarded ReferenceError and
    // leaves ReactDOM uninitialised (createRoot(...).render -> not a function).
    __REACT_DEVTOOLS_GLOBAL_HOOK__: "undefined",
  },
  plugins: [
    react({
      jsxRuntime: "automatic",
    }),
    // NOTE: the vite-plugin-pwa service worker was removed on purpose.
    //
    // The old worker routed every navigation through NetworkFirst; when the
    // origin was slow it answered `workbox no-response` and the entire site
    // (landing, /login, /app, travel dashboard) rendered blank. A service
    // worker that can break navigations is not worth the offline nicety for an
    // ERP. `public/sw.js` now ships a self-destroying worker that unregisters
    // itself and clears every cache on the next navigation.
  ],
  server: {
    port: 3000,
  },
  resolve: {
    dedupe: ["react", "react-dom", "react-router"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    // The APK supports Android 7 (API 24) and its bundled System WebView may
    // be old, so optional chaining / nullish coalescing are transpiled down
    // instead of shipping es2020 syntax that would throw a parse error.
    target: ["es2017", "chrome61"],
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      // No manualChunks at all.
      // Any manual chunking here duplicated React core into another chunk
      // (recharts dragged React along), which left ReactDOMRoot.prototype.render
      // undefined at call time -> "createRoot(...).render is not a function".
      // Rollup's default chunking emits one shared vendor chunk instead.
      output: {},
    },
  },
})
