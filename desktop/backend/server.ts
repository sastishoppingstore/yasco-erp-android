import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFileSync, existsSync, createReadStream, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 32145);
const STATIC_DIR = process.env.ERP_STATIC_DIR || join(process.cwd(), "dist", "public");

// Server-only mode: this sidecar is a static file server plus a reverse proxy.
// It keeps NO local database, no offline handlers and no background sync — all
// data comes from the live backend, exactly like the website. The only state is
// the browser session cookie, which is forwarded to the upstream verbatim.

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
};

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (!existsSync(STATIC_DIR)) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Frontend build not found — run: npm run build" }));
    return;
  }
  let rel = pathname;
  if (rel.startsWith("/app")) rel = rel.slice(4) || "/";
  if (rel === "/" ) rel = "/index.html";
  const filePath = normalize(join(STATIC_DIR, rel));
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    createReadStream(filePath).pipe(res);
    return;
  }
  const indexFile = join(STATIC_DIR, "index.html");
  if (existsSync(indexFile)) {
    const content = readFileSync(indexFile);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    res.end(content);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
}

// ── Live-backend proxy ───────────────────────────────────────────────
// The bundled UI is served from loopback, but every `/api/*` call is forwarded
// to the production backend, so the desktop is a real client of the live ERP
// (identical data and features to the web app). The public site is tried first
// (exactly what the website uses); a direct origin-IP fallback covers regions
// where Cloudflare is blocked. If nothing answers the request gets a 503.
const UPSTREAMS = (
  process.env.ERP_REMOTE_URLS || "https://yasco.tech,https://203.161.63.59#yasco.tech"
)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [origin, servername] = entry.split("#");
    return { origin, servername: servername || null };
  });

const PROXY_TIMEOUT_MS = Number(process.env.ERP_PROXY_TIMEOUT_MS || 25000);

// A dead or black-holed upstream must never stall the UI. Cap the connect phase
// to a few seconds; if nothing connects we move on to the next upstream (and
// ultimately a 503) instead of making the app look frozen.
const PROXY_CONNECT_TIMEOUT_MS = Number(process.env.ERP_PROXY_CONNECT_TIMEOUT_MS || 4000);

// Index of the upstream that last answered. Later requests try it first, so a
// machine that cannot reach the primary (origin IP) only pays the connect
// timeout once, not on every call.
let preferredUpstreamIndex = 0;

/**
 * Resolve to `fallback` if `p` has not settled within `ms`.
 *
 * A socket `timeout` does NOT bound a DNS lookup: if the resolver black-holes
 * the query, no socket is ever created and no `timeout`/`error` event fires.
 * Without this ceiling the startup probe could stay pending forever, and since
 * every `/api/*` call awaits it the whole UI would hang on the splash.
 */
function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/** One-line diagnostics (captured into %TEMP%\erp-system-backend.log). */
function logDebug(message: string): void {
  console.log(`[desktop ${new Date().toISOString()}] ${message}`);
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(Buffer.concat(chunks)));
  });
}

/** Loosen upstream cookies for the loopback http webview origin. */
function relaxCookies(cookies: string[]): string[] {
  return cookies.map((c) =>
    c
      .replace(/;\s*SameSite=None/i, "; SameSite=Lax")
      .replace(/;\s*Secure/i, "")
      .replace(/;\s*Domain=[^;]*/i, "")
      .replace(/;\s*Partitioned/i, "")
  );
}

function proxyOnce(
  upstream: { origin: string; servername: string | null },
  req: IncomingMessage,
  res: ServerResponse,
  body: Buffer,
  hasBody: boolean
): Promise<"ok" | "fail"> {
  return new Promise((resolve) => {
    let settled = false;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;
    const done = (r: "ok" | "fail") => {
      if (!settled) {
        settled = true;
        if (hardTimer) clearTimeout(hardTimer);
        resolve(r);
      }
    };

    let url: URL;
    try {
      url = new URL(upstream.origin);
    } catch {
      return done("fail");
    }

    const isTls = url.protocol === "https:";
    const headers: Record<string, string | string[]> = { ...(req.headers as Record<string, string | string[]>) };
    // The upstream must see its own public host so cookies, ZATCA links and
    // absolute URLs stay correct.
    headers.host = upstream.servername || url.host;
    delete headers["transfer-encoding"];
    delete headers["content-length"];
    if (hasBody) headers["content-length"] = String(body.length);
    // Forward the browser's own session cookie straight to the upstream — the
    // desktop is a normal client of the live backend, exactly like the website.
    headers["x-forwarded-proto"] = "https";

    const send = isTls ? httpsRequest : httpRequest;
    const proxyReq = send(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isTls ? 443 : 80),
        method: req.method,
        path: req.url,
        headers,
        servername: upstream.servername || undefined,
        timeout: PROXY_CONNECT_TIMEOUT_MS,
      } as Parameters<typeof httpsRequest>[0],
      (proxyRes) => {
        // Connected and receiving a response — allow the full (idle) budget from
        // here on so a large or slow body is not cut short by the connect cap.
        proxyReq.setTimeout(PROXY_TIMEOUT_MS);
        const outHeaders: Record<string, string | string[]> = { ...(proxyRes.headers as Record<string, string | string[]>) };
        delete outHeaders["transfer-encoding"];
        const sc = outHeaders["set-cookie"];
        if (sc) {
          outHeaders["set-cookie"] = relaxCookies(Array.isArray(sc) ? sc : [sc]);
        }
        res.writeHead(proxyRes.statusCode || 502, outHeaders);
        proxyRes.pipe(res);
        proxyRes.on("end", () => done("ok"));
        proxyRes.on("error", () => {
          try {
            res.destroy();
          } catch {
            /* ignore */
          }
          done("ok");
        });
      }
    );

    // Absolute ceiling for this attempt. Connect + response-idle timeouts are
    // enough for a healthy socket, but a DNS lookup (or a wedged socket) can
    // pass without either firing, so bound the whole attempt too.
    hardTimer = setTimeout(() => {
      try {
        proxyReq.destroy(new Error("proxy hard deadline"));
      } catch {
        /* ignore */
      }
      done("fail");
    }, PROXY_CONNECT_TIMEOUT_MS + PROXY_TIMEOUT_MS + 2000);

    proxyReq.on("timeout", () => proxyReq.destroy(new Error("upstream timeout")));
    proxyReq.on("error", (err) => {
      logDebug(`proxy error ${upstream.origin} ${req.method} ${req.url?.slice(0, 60)}: ${(err as Error).message}`);
      done("fail");
    });
    req.on("error", () => {
      try {
        proxyReq.destroy();
      } catch {
        /* ignore */
      }
      done("fail");
    });

    if (hasBody) proxyReq.end(body);
    else proxyReq.end();
  });
}

/** Probe one upstream with a short connect deadline; resolve true if it answers. */
function probeUpstream(upstream: { origin: string; servername: string | null }): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };

    let url: URL;
    try {
      url = new URL(upstream.origin);
    } catch {
      return done(false);
    }

    const isTls = url.protocol === "https:";
    const send = isTls ? httpsRequest : httpRequest;
    const probeReq = send(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isTls ? 443 : 80),
        method: "GET",
        path: "/api/health",
        headers: { host: upstream.servername || url.host, "x-forwarded-proto": "https" },
        servername: upstream.servername || undefined,
        timeout: PROXY_CONNECT_TIMEOUT_MS,
      } as Parameters<typeof httpsRequest>[0],
      (probeRes) => {
        // Any HTTP answer (even 404) means the upstream is reachable.
        probeRes.resume();
        done(true);
      }
    );

    probeReq.on("timeout", () => probeReq.destroy(new Error("probe timeout")));
    probeReq.on("error", () => done(false));
    probeReq.end();
  });
}

/**
 * Pick the first upstream that actually answers and stick to it, so a machine
 * that cannot reach the primary does not pay the connect timeout on every
 * single request. Runs once at startup; if nothing answers each request simply
 * returns a 503 until an upstream recovers.
 */
async function probeUpstreams(): Promise<void> {
  // Probe all upstreams concurrently (each bounded by the connect timeout) and
  // prefer the earliest in order that answered. The extra deadline covers DNS
  // lookups, which a socket timeout does not bound, so this always resolves.
  const probeBudget = PROXY_CONNECT_TIMEOUT_MS + 1500;
  const results = await withDeadline(
    Promise.all(UPSTREAMS.map((u) => withDeadline(probeUpstream(u), probeBudget, false))),
    probeBudget + 1500,
    UPSTREAMS.map(() => false)
  );
  const firstOk = results.findIndex(Boolean);
  if (firstOk >= 0) {
    preferredUpstreamIndex = firstOk;
    logDebug(`upstream ready: ${UPSTREAMS[firstOk].origin}`);
    return;
  }
  logDebug("no upstream reachable at startup; API requests will return 503 until one recovers");
}

/** Returns true when an upstream answered (response already streamed). */
async function proxyToRemote(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const method = (req.method || "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await readRequestBody(req) : Buffer.alloc(0);

  const count = UPSTREAMS.length;
  for (let n = 0; n < count; n++) {
    const idx = (preferredUpstreamIndex + n) % count;
    const upstream = UPSTREAMS[idx];
    const result = await proxyOnce(upstream, req, res, body, hasBody);
    if (result === "ok" || res.headersSent) {
      // Remember the winner so subsequent calls start here.
      preferredUpstreamIndex = idx;
      return true;
    }
  }
  return false;
}

// Choose a reachable upstream before the UI starts hammering the API. This runs
// in the background; the first API calls simply await it, so a black-holed
// primary upstream costs one short probe (not a 25 s stall per request).
const upstreamReady = probeUpstreams().catch(() => {});

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = url.pathname;
  const started = Date.now();
  try {
    if (pathname.startsWith("/api/")) {
      if (pathname === "/api/health" || pathname === "/api/ping") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, ts: Date.now(), desktop: true }));
        return;
      }
      // Wait for the upstream probe so we never start with a dead upstream — but
      // never longer than a bounded budget, so a wedged probe cannot stall the UI.
      await withDeadline(upstreamReady, PROXY_CONNECT_TIMEOUT_MS + 3000, undefined);
      // Prefer the live backend (full parity, real data). There is no local
      // fallback any more: if no upstream answers the client gets the same 503
      // a browser would get when the site is down.
      const proxied = await proxyToRemote(req, res, url);
      if (proxied) {
        logDebug(`${req.method} ${pathname} -> remote ${res.statusCode} ${Date.now() - started}ms`);
        return;
      }
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "upstream_unreachable", offline: true }));
      logDebug(`${req.method} ${pathname} -> 503 upstream unreachable ${Date.now() - started}ms`);
      return;
    }
    serveStatic(req, res, pathname);
  } catch (err) {
    try {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    } catch {
      /* socket may be closed */
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[desktop] YASCO desktop backend listening on http://${HOST}:${PORT}`);
  console.log(`[desktop] Mode: server-only (no local DB, no offline cache)`);
  console.log(`[desktop] Static: ${STATIC_DIR}`);
  console.log(`[desktop] Remote upstreams: ${UPSTREAMS.map((u) => u.origin).join(", ")}`);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
