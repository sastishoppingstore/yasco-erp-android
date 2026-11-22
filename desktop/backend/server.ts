import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFileSync, existsSync, createReadStream, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { initDb } from "./sqlite";
import { serialize } from "./superjson";
import { handlers, MUTATIONS, AUTH_REQUIRED, authMeHandler, ApiError, type RequestLike } from "./handlers";
import { startSyncEngine, syncOnce } from "./sync";
import { setRemoteCookies, clearRemoteCookies, remoteCookieHeader } from "./remote";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 32145);
const STATIC_DIR = process.env.ERP_STATIC_DIR || join(process.cwd(), "dist", "public");
const DB_PATH = process.env.ERP_DB_PATH || join(process.env.APPDATA || process.env.HOME || ".", ".yasco", "erp.sqlite");

initDb(DB_PATH);
startSyncEngine();

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

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseInputJson(raw: string | undefined): Record<string, { json: unknown }> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

interface CookieSetter {
  name: string;
  value: string;
  opts: Record<string, unknown>;
}

function buildSetCookie(c: CookieSetter): string {
  const parts = [`${c.name}=${c.value}`];
  const o = c.opts;
  if (o.maxAge !== undefined) parts.push(`Max-Age=${o.maxAge}`);
  if (o.path) parts.push(`Path=${o.path}`);
  if (o.httpOnly) parts.push("HttpOnly");
  if (o.sameSite) parts.push(`SameSite=${o.sameSite}`);
  if (o.secure) parts.push("Secure");
  return parts.join("; ");
}

async function handleTrpc(req: IncomingMessage, res: ServerResponse, pathname: string, query: URLSearchParams) {
  const procNames = pathname.replace(/^\/api\/trpc\/?/, "").split(",").filter(Boolean);
  if (procNames.length === 0) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "No procedure path" }));
    return;
  }
  const method = (req.method || "GET").toUpperCase();
  const isBatch = query.get("batch") === "1";
  const isGet = method === "GET";

  let inputMap: Record<string, { json: unknown }> = {};
  if (isGet) {
    inputMap = parseInputJson(query.get("input") || undefined);
  } else {
    const body = await parseBody(req);
    inputMap = parseInputJson(body);
  }

  const reqLike: RequestLike = {
    headers: req.headers as Record<string, string | undefined>,
    cookies: parseCookies(req.headers.cookie),
  };

  const setCookies: CookieSetter[] = [];
  const setCookieFn = (name: string, value: string, opts: Record<string, unknown>) => {
    setCookies.push({ name, value, opts });
  };

  const results = await Promise.all(
    procNames.map(async (proc, i) => {
      const input = inputMap[String(i)]?.json ?? {};
      const isMutation = MUTATIONS.has(proc);
      if (isGet && isMutation) {
        return errorEnvelope(proc, new ApiError(`Unsupported GET-request to mutation procedure at path "${proc}"`, { code: "METHOD_NOT_SUPPORTED", httpStatus: 405 }));
      }
      if (!isGet && !isMutation) {
        return errorEnvelope(proc, new ApiError(`Unsupported POST-request to query procedure at path "${proc}"`, { code: "METHOD_NOT_SUPPORTED", httpStatus: 405 }));
      }
      if (AUTH_REQUIRED.has(proc) && !handlers[proc]) {
        return errorEnvelope(proc, new ApiError(`Procedure not found: ${proc}`, { code: "NOT_FOUND", httpStatus: 404 }));
      }
      if (!handlers[proc]) {
        return errorEnvelope(proc, new ApiError(`Procedure not found: ${proc}`, { code: "NOT_FOUND", httpStatus: 404 }));
      }
      try {
        if (AUTH_REQUIRED.has(proc) && proc !== "auth.passwordLogin" && proc !== "auth.logout") {
          authMeHandler(reqLike);
        }
        const value = await handlers[proc](input, reqLike, setCookieFn);
        const ser = serialize(value);
        return {
          result: {
            data: ser,
          },
        };
      } catch (err) {
        return errorEnvelope(proc, err);
      }
    })
  );

  if (setCookies.length > 0) {
    res.setHeader("set-cookie", setCookies.map(buildSetCookie));
  }
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(isBatch ? results : results[0]));
}

function errorEnvelope(proc: string, err: unknown) {
  const apiErr = err instanceof ApiError ? err : new ApiError(err instanceof Error ? err.message : String(err));
  return {
    error: {
      json: {
        message: apiErr.message,
        code: apiErr.code,
        data: { code: apiErr.trpcCode, httpStatus: apiErr.httpStatus, path: proc },
      },
    },
  };
}

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
// to the production Hono backend, so the desktop is a real client of the live
// ERP (identical data and features to the web app). The first upstream points
// straight at the origin server (SNI + Host = the real domain) which bypasses
// Cloudflare, so the app keeps working from regions where the Cloudflare edge
// blocks or challenges the domain. When no upstream answers, the request falls
// back to the bundled offline SQLite backend below.
const UPSTREAMS = (
  process.env.ERP_REMOTE_URLS || "https://203.161.63.59#yasco.tech,https://yasco.tech"
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
// to a few seconds; if nothing connects we move on to the next upstream (or the
// bundled offline backend) instead of making the app look frozen.
const PROXY_CONNECT_TIMEOUT_MS = Number(process.env.ERP_PROXY_CONNECT_TIMEOUT_MS || 4000);

// Index of the upstream that last answered. Later requests try it first, so a
// machine that cannot reach the primary (origin IP) only pays the connect
// timeout once, not on every call.
let preferredUpstreamIndex = 0;

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
  return cookies.map((c) => c.replace(/;\s*SameSite=None/i, "; SameSite=Lax").replace(/;\s*Secure/i, ""));
}

/** Remember the live session cookie so the background sync engine can use it. */
function captureRemoteSession(cookies: string[]): void {
  try {
    for (const c of cookies) {
      const m = /^erp_sid=([^;]*)/.exec(c);
      if (!m) continue;
      if (m[1]) setRemoteCookies({ erp_sid: m[1] });
      else clearRemoteCookies();
    }
  } catch {
    /* ignore */
  }
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
    const done = (r: "ok" | "fail") => {
      if (!settled) {
        settled = true;
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
    const cookieHeader = remoteCookieHeader(req.headers.cookie);
    if (cookieHeader) headers.cookie = cookieHeader;
    else delete headers.cookie;
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
          const list = relaxCookies(Array.isArray(sc) ? sc : [sc]);
          outHeaders["set-cookie"] = list;
          captureRemoteSession(list);
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

    proxyReq.on("timeout", () => proxyReq.destroy(new Error("upstream timeout")));
    proxyReq.on("error", () => done("fail"));
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
 * that cannot reach the primary (the raw origin IP) does not pay the connect
 * timeout on every single request. Runs once at startup; if nothing answers we
 * leave the default order and each request simply falls back to the bundled
 * offline backend.
 */
async function probeUpstreams(): Promise<void> {
  // Probe all upstreams concurrently (each bounded by the connect timeout) and
  // prefer the earliest in order that answered.
  const results = await Promise.all(UPSTREAMS.map((u) => probeUpstream(u)));
  const firstOk = results.findIndex(Boolean);
  if (firstOk >= 0) {
    preferredUpstreamIndex = firstOk;
    console.log(`[desktop] upstream ready: ${UPSTREAMS[firstOk].origin}`);
    return;
  }
  console.log("[desktop] no upstream reachable at startup; using bundled offline backend");
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
  try {
    if (pathname.startsWith("/api/")) {
      if (pathname === "/api/health" || pathname === "/api/ping") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, ts: Date.now(), desktop: true }));
        return;
      }
      // Wait for the upstream probe so we never start with a dead upstream.
      await upstreamReady;
      // Prefer the live backend (full parity, real data). If no upstream is
      // reachable, fall back to the bundled offline SQLite backend so the user
      // can keep working and the changes sync up once the network returns.
      const proxied = await proxyToRemote(req, res, url);
      if (proxied) return;
      if (pathname.startsWith("/api/trpc")) {
        await handleTrpc(req, res, pathname, url.searchParams);
        return;
      }
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "offline", offline: true }));
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
  console.log(`[desktop] DB: ${DB_PATH}`);
  console.log(`[desktop] Static: ${STATIC_DIR}`);
  console.log(`[desktop] Remote: ${process.env.ERP_REMOTE_URL || "https://www.yasco.tech"}`);
  syncOnce().catch(() => {});
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
