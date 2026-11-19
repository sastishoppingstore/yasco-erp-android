//! Android-only local serving layer for the bundled ERP front-end.
//!
//! The Android app runs the whole Vite build from inside the APK and must open
//! **without any network**, on every device from Android 7 to Android 16
//! (Android Go included). It also has to talk to the hosted ERP with the
//! existing cookie auth, which only works when the page and the API share one
//! origin.
//!
//! Two layers provide that same origin:
//!
//!   * a **custom URI scheme** (`erp`) which Android exposes as
//!     `http://erp.localhost`. The WebView itself answers those requests, so
//!     there is no TCP socket, no cleartext policy, no `INTERNET` round trip
//!     and nothing that an OEM ROM can block. This is the primary layer.
//!   * a **loopback HTTP server** on `127.0.0.1` exposing exactly the same
//!     surface, kept as a fallback for WebViews where the custom scheme is
//!     unavailable.
//!
//! Both layers call the same [`route`] function, so a request behaves
//! identically no matter which one answers it. Nothing here runs on desktop
//! builds.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use include_dir::{include_dir, Dir};
use tauri::http::{Request as HttpRequest, Response as HttpResponse, StatusCode as HttpStatus};
use tiny_http::{Header, Response, Server, StatusCode};

/// The bundled front-end (CI copies the Vite build output here before the
/// Android build, so the whole ERP ends up inside the APK binary).
static WEB: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/../appdist");

/// Hosted ERP. Only `/api/*` is reached, never the HTML/JS.
const UPSTREAM: &str = "https://yasco.tech";

/// The custom URI scheme registered with Tauri. On Android a page served from
/// it lives at `http://erp.localhost/...`.
pub const SCHEME: &str = "erp";

/// Origin advertised to the boot page for the custom-scheme layer.
pub const SCHEME_ORIGIN: &str = "http://erp.localhost";

/// Port the loopback layer listens on (0 while it is still unknown).
pub static PORT: AtomicU16 = AtomicU16::new(0);

/// Result of the startup work, shown verbatim on the boot screen so a failure
/// on a specific phone can be diagnosed without a debugger.
static STATUS: OnceLock<String> = OnceLock::new();

static AGENT: OnceLock<ureq::Agent> = OnceLock::new();

pub fn status() -> String {
  STATUS
    .get()
    .cloned()
    .unwrap_or_else(|| "offline engine not started".to_string())
}

fn set_status(text: String) -> String {
  let _ = STATUS.set(text);
  status()
}

// ---------------------------------------------------------------------------
// Shared reply model
// ---------------------------------------------------------------------------

struct Reply {
  status: u16,
  headers: Vec<(String, String)>,
  body: Vec<u8>,
}

impl Reply {
  fn text(status: u16, body: &str) -> Reply {
    Reply {
      status,
      headers: vec![(
        "Content-Type".to_string(),
        "text/plain; charset=utf-8".to_string(),
      )],
      body: body.as_bytes().to_vec(),
    }
  }
}

/// How many files the bundled front-end contains (health payload).
fn count_files(dir: &Dir<'_>) -> usize {
  dir.files().count() + dir.dirs().map(|child| count_files(child)).sum::<usize>()
}

/// Single entry point used by both serving layers.
fn route(
  method: &str,
  target: &str,
  headers: &[(String, String)],
  body: &[u8],
  origin: Option<&str>,
) -> Reply {
  let path = target.split('?').next().unwrap_or("/").to_string();
  let is_api = path == "/api" || path.starts_with("/api/");
  let is_options = method.eq_ignore_ascii_case("OPTIONS");

  let mut reply = if is_api && is_options {
    // CORS preflight (only reachable from the boot page; the app itself is
    // same-origin, so real requests never need this).
    Reply {
      status: 204,
      headers: Vec::new(),
      body: Vec::new(),
    }
  } else if path == "/health" {
    health_reply()
  } else if is_api {
    proxy_api(method, target, headers, body)
  } else {
    serve_static_file(&path)
  };

  apply_cors(&mut reply, origin, is_options, headers);
  reply
}

fn health_reply() -> Reply {
  let payload = format!(
    "{{\"ok\":true,\"scheme\":\"{SCHEME}\",\"port\":{},\"files\":{},\"status\":\"{}\"}}",
    PORT.load(Ordering::SeqCst),
    count_files(&WEB),
    status().replace('"', "'")
  );
  Reply {
    status: 200,
    headers: vec![
      ("Content-Type".to_string(), "application/json".to_string()),
      ("Cache-Control".to_string(), "no-store".to_string()),
    ],
    body: payload.into_bytes(),
  }
}

/// The boot page lives on Tauri's own origin, so its `/health` probe is cross
/// origin and needs these headers. Same-origin requests (the normal case) send
/// no `Origin` and are left untouched.
fn apply_cors(reply: &mut Reply, origin: Option<&str>, is_options: bool, headers: &[(String, String)]) {
  let Some(origin) = origin else { return };

  reply
    .headers
    .push(("Access-Control-Allow-Origin".into(), origin.to_string()));
  reply
    .headers
    .push(("Access-Control-Allow-Credentials".into(), "true".into()));
  reply.headers.push(("Vary".into(), "Origin".into()));

  if is_options {
    reply.headers.push((
      "Access-Control-Allow-Methods".into(),
      "GET, POST, PUT, PATCH, DELETE, OPTIONS".into(),
    ));
    let requested = headers
      .iter()
      .find(|(k, _)| k.eq_ignore_ascii_case("access-control-request-headers"))
      .map(|(_, v)| v.clone())
      .unwrap_or_else(|| "*".into());
    reply
      .headers
      .push(("Access-Control-Allow-Headers".into(), requested));
    reply
      .headers
      .push(("Access-Control-Max-Age".into(), "600".into()));
  }
}

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

fn serve_static_file(path: &str) -> Reply {
  let decoded = percent_decode(path);
  let rel = decoded.trim_start_matches('/');
  let rel = if rel.is_empty() { "index.html" } else { rel };

  let mut file = WEB.get_file(rel);
  let mut served_path = rel.to_string();

  // SPA fallback: unknown extension-less paths (such as `/`, `/app`, `/app/`)
  // render index.html so client side routes survive a reload.
  if file.is_none() && !has_extension(rel) {
    file = WEB.get_file("index.html");
    served_path = "index.html".to_string();
  }

  let Some(file) = file else {
    return Reply::text(404, "Not found");
  };

  let mime = mime_guess::from_path(&served_path).first_or_octet_stream();
  let cache = if served_path.starts_with("assets/") {
    "public, max-age=31536000, immutable"
  } else {
    "no-cache"
  };

  Reply {
    status: 200,
    headers: vec![
      ("Content-Type".to_string(), mime.as_ref().to_string()),
      ("Cache-Control".to_string(), cache.to_string()),
      ("X-Content-Type-Options".to_string(), "nosniff".to_string()),
    ],
    body: file.contents().to_vec(),
  }
}

fn has_extension(path: &str) -> bool {
  path
    .rsplit('/')
    .next()
    .map(|last| last.contains('.'))
    .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// API proxy
// ---------------------------------------------------------------------------

fn proxy_api(method: &str, target: &str, headers: &[(String, String)], body: &[u8]) -> Reply {
  let url = format!("{UPSTREAM}{target}");
  let mut call = agent().request(method, &url);

  for (name, value) in headers {
    let lower = name.to_ascii_lowercase();
    // Let the HTTP client negotiate framing/encoding; forward everything else
    // (auth cookies, content-type, accept, user-agent, ...). `origin` is
    // rewritten below so the hosted ERP sees its own origin (any CSRF check
    // then passes and CORS is never triggered).
    if matches!(
      lower.as_str(),
      "host"
        | "content-length"
        | "connection"
        | "accept-encoding"
        | "transfer-encoding"
        | "origin"
    ) {
      continue;
    }
    call = call.set(name, value);
  }

  // The page now runs on `erp.localhost` / `127.0.0.1`, so the browser sends
  // that origin. Replace it with the hosted origin: the request then looks like
  // a same-origin call from yasco.tech itself, which is what the existing
  // session/CSRF handling expects.
  call = call.set("Origin", UPSTREAM);
  call = call.set("Accept-Encoding", "identity");

  let result = if body.is_empty() {
    call.call()
  } else {
    call.send_bytes(body)
  };

  match result {
    Ok(response) => relay(response),
    // ureq reports every non-2xx as Error::Status; those are real API answers
    // (401, 422, ...) and must be relayed unchanged.
    Err(ureq::Error::Status(_, response)) => relay(response),
    Err(err) => {
      let payload = format!(
        "{{\"error\":\"offline\",\"message\":\"{}\"}}",
        err.to_string().replace('"', "'")
      );
      Reply {
        status: 503,
        headers: vec![
          ("Content-Type".to_string(), "application/json".to_string()),
          ("X-ERP-Offline".to_string(), "1".to_string()),
          ("Cache-Control".to_string(), "no-store".to_string()),
        ],
        body: payload.into_bytes(),
      }
    }
  }
}

fn relay(response: ureq::Response) -> Reply {
  let status = response.status();
  let mut headers: Vec<(String, String)> = Vec::new();

  for name in response.headers_names() {
    let lower = name.to_ascii_lowercase();
    if matches!(
      lower.as_str(),
      "transfer-encoding" | "connection" | "content-length" | "content-encoding"
    ) {
      continue;
    }

    if lower == "set-cookie" {
      for value in response.all("set-cookie") {
        headers.push(("Set-Cookie".to_string(), rewrite_cookie(value)));
      }
      continue;
    }

    if let Some(value) = response.header(&name) {
      headers.push((name.clone(), value.to_string()));
    }
  }

  let mut body = Vec::new();
  if let Err(err) = response.into_reader().read_to_end(&mut body) {
    return Reply::text(502, &format!("upstream read error: {err}"));
  }

  headers.push(("Content-Length".to_string(), body.len().to_string()));

  Reply {
    status,
    headers,
    body,
  }
}

/// The browser now talks to `http://` on `127.0.0.1` / `erp.localhost`, so the
/// upstream cookie must be turned into a valid first-party cookie over plain
/// HTTP:
///
///   * `Domain` is dropped so it becomes host-only for the local origin.
///   * `Secure` is dropped because the local origin is `http://`.
///   * `Partitioned` is dropped (needs `Secure`).
///   * `SameSite=None` becomes `SameSite=Lax`: a browser rejects `None` without
///     `Secure`, and it is unnecessary here because the page and `/api` share
///     one origin, so the cookie is always same-site.
///
/// Name / Path / HttpOnly / Expires / Max-Age survive unchanged.
fn rewrite_cookie(value: &str) -> String {
  let mut parts: Vec<String> = Vec::new();

  for raw in value.split(';') {
    let part = raw.trim();
    if part.is_empty() {
      continue;
    }
    let lower = part.to_ascii_lowercase();
    if lower.starts_with("domain=") || lower == "secure" || lower.starts_with("partitioned") {
      continue;
    }
    if lower.starts_with("samesite=") {
      if lower["samesite=".len()..].trim() == "none" {
        parts.push("SameSite=Lax".to_string());
      } else {
        parts.push(part.to_string());
      }
      continue;
    }
    parts.push(part.to_string());
  }

  parts.join("; ")
}

// ---------------------------------------------------------------------------
// Layer 1: custom URI scheme (primary, no TCP)
// ---------------------------------------------------------------------------

/// Serves the bundled front-end and proxies the API through the WebView's own
/// request pipeline. Registered with `Builder::register_asynchronous_uri_scheme_protocol`.
pub fn scheme_protocol<R: tauri::Runtime>(
  _ctx: tauri::UriSchemeContext<'_, R>,
  request: HttpRequest<Vec<u8>>,
  responder: tauri::UriSchemeResponder,
) {
  let method = request.method().as_str().to_string();
  let target = {
    let uri = request.uri();
    let mut target = uri.path().to_string();
    if let Some(query) = uri.query() {
      target.push('?');
      target.push_str(query);
    }
    target
  };
  let headers: Vec<(String, String)> = request
    .headers()
    .iter()
    .map(|(name, value)| {
      (
        name.as_str().to_string(),
        String::from_utf8_lossy(value.as_bytes()).into_owned(),
      )
    })
    .collect();
  let origin = headers
    .iter()
    .find(|(name, _)| name.eq_ignore_ascii_case("origin"))
    .map(|(_, value)| value.clone());
  let body = request.into_body();

  // The proxy blocks on the network; answer off the main thread.
  thread::spawn(move || {
    let reply = route(&method, &target, &headers, &body, origin.as_deref());

    let mut builder = HttpResponse::builder()
      .status(HttpStatus::from_u16(reply.status).unwrap_or(HttpStatus::OK));
    for (name, value) in &reply.headers {
      builder = builder.header(name.as_str(), value.as_str());
    }
    let response = match builder.body(reply.body) {
      Ok(response) => response,
      Err(_) => HttpResponse::builder()
        .status(HttpStatus::INTERNAL_SERVER_ERROR)
        .body(Vec::new())
        .expect("empty body"),
    };
    responder.respond(response);
  });
}

// ---------------------------------------------------------------------------
// Layer 2: loopback HTTP server (fallback)
// ---------------------------------------------------------------------------

fn agent() -> &'static ureq::Agent {
  AGENT.get_or_init(|| {
    ureq::AgentBuilder::new()
      .timeout_connect(Duration::from_secs(12))
      .timeout_read(Duration::from_secs(60))
      .timeout_write(Duration::from_secs(60))
      .build()
  })
}

/// Bind the loopback listener.
///
/// IPv4 is pinned explicitly on purpose: a dual stack bind can end up on the
/// IPv6 socket, and then the WebView's `http://127.0.0.1:<port>` request is
/// refused even though the server is running fine.
fn bind() -> Result<(Server, u16), String> {
  // Prefer a fixed port so localStorage / IndexedDB stay on the same origin
  // across launches (cookies ignore the port, storage keys do not).
  let attempts = [
    SocketAddr::from((Ipv4Addr::LOCALHOST, 41235)),
    SocketAddr::from((Ipv4Addr::LOCALHOST, 41236)),
    SocketAddr::from((Ipv4Addr::LOCALHOST, 0)),
  ];

  let mut last = String::from("no candidate address");
  for addr in attempts {
    match Server::http(addr) {
      Ok(server) => {
        let port = server
          .server_addr()
          .to_ip()
          .ok_or_else(|| "local server has no TCP address".to_string())?
          .port();
        return Ok((server, port));
      }
      Err(err) => last = format!("{addr}: {err}"),
    }
  }
  Err(format!("could not bind a loopback port ({last})"))
}

/// One real HTTP round trip through the just started server, so the boot page
/// never races the listener.
fn self_test(port: u16) -> Result<(), String> {
  let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
  let deadline = Instant::now() + Duration::from_secs(6);
  let mut last = String::from("no answer");

  while Instant::now() < deadline {
    if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) {
      let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
      let _ = stream.set_write_timeout(Some(Duration::from_millis(1500)));
      let request =
        format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
      if stream.write_all(request.as_bytes()).is_ok() {
        let mut buf = Vec::new();
        if stream.read_to_end(&mut buf).is_ok() {
          let text = String::from_utf8_lossy(&buf);
          if text.starts_with("HTTP/1.1 200") || text.starts_with("HTTP/1.0 200") {
            return Ok(());
          }
          last = text.lines().next().unwrap_or("empty response").to_string();
        } else {
          last = "the server closed without a response".to_string();
        }
      } else {
        last = "could not write the probe request".to_string();
      }
    }
    thread::sleep(Duration::from_millis(150));
  }
  Err(last)
}

/// Start the loopback fallback and return its port. Returns an error when the
/// bundled app cannot be served there; the custom scheme still works, so the
/// app is never left without a screen.
pub fn start() -> Result<u16, String> {
  let (server, port) = bind()?;
  PORT.store(port, Ordering::SeqCst);

  let server = Arc::new(server);
  for _ in 0..6 {
    let srv = Arc::clone(&server);
    thread::spawn(move || loop {
      match srv.recv() {
        Ok(request) => handle_http(request),
        Err(_) => break,
      }
    });
  }

  match self_test(port) {
    Ok(()) => {
      set_status(format!("loopback ready on 127.0.0.1:{port}"));
      Ok(port)
    }
    Err(err) => Err(set_status(format!(
      "no HTTP answer on 127.0.0.1:{port} ({err})"
    ))),
  }
}

fn handle_http(mut request: tiny_http::Request) {
  let method = request.method().as_str().to_string();
  let target = request.url().to_string();
  let headers: Vec<(String, String)> = request
    .headers()
    .iter()
    .map(|h| (h.field.as_str().to_string(), h.value.as_str().to_string()))
    .collect();
  let origin = headers
    .iter()
    .find(|(name, _)| name.eq_ignore_ascii_case("origin"))
    .map(|(_, value)| value.clone());

  let mut body = Vec::new();
  {
    let mut reader = request.as_reader();
    let _ = reader.read_to_end(&mut body);
  }

  let reply = route(&method, &target, &headers, &body, origin.as_deref());

  let mut response = Response::from_data(reply.body).with_status_code(StatusCode(reply.status));
  for (name, value) in reply.headers {
    if let Ok(header) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
      response.add_header(header);
    }
  }
  let _ = request.respond(response);
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

/// Create the main window.
///
/// It always starts on the bundled `boot.html` (served by Tauri's own asset
/// protocol, so it renders on every device). That page probes both local
/// backends and navigates to whichever answers, which keeps a real screen in
/// front of the user even when one layer is unavailable on a given phone.
pub fn open_window(
  app: &mut tauri::App,
  port: Result<u16, String>,
) -> Result<(), Box<dyn std::error::Error>> {
  let port = port.unwrap_or(0);
  let init = boot_script(port);

  let window = tauri::WebviewWindowBuilder::new(
    app,
    "main",
    tauri::WebviewUrl::App("boot.html".into()),
  )
  .initialization_script(init.as_str())
  .title("YASCO ERP")
  .build();

  if window.is_ok() {
    return Ok(());
  }

  // A WebView that refuses the asset page still gets a window, pointed at the
  // best local origin we have.
  let fallback = if port > 0 {
    format!("http://127.0.0.1:{port}/app/")
  } else {
    format!("{SCHEME_ORIGIN}/app/")
  };
  tauri::WebviewWindowBuilder::new(
    app,
    "main",
    tauri::WebviewUrl::External(fallback.parse()?),
  )
  .initialization_script(init.as_str())
  .title("YASCO ERP")
  .build()?;
  Ok(())
}

/// Script injected into every page of the main window.
///
/// It publishes the runtime facts the boot page needs and emits a small,
/// greppable marker once the real UI has painted (used by the emulator smoke
/// test to prove the WebView actually rendered, not just that it did not
/// crash). Everything is wrapped in try/catch: a diagnostics helper must never
/// be able to break the app.
fn boot_script(port: u16) -> String {
  let template = r#"
window.__YASCO_APP = true;
window.__YASCO_PORT = __PORT__;
window.__YASCO_STATUS = __STATUS__;
window.__YASCO_SCHEME = __SCHEME__;
(function () {
  function log(m) { try { console.log(m + ' ' + location.href); } catch (e) {} }
  try {
    window.addEventListener('error', function (e) {
      log('YASCO_JS_ERROR ' + (e && e.message ? e.message : 'unknown'));
    });
    window.addEventListener('unhandledrejection', function () {
      log('YASCO_JS_REJECTION');
    });
  } catch (e) {}
  // boot.html is our own launcher, not the app: no UI marker there.
  if (location.pathname.indexOf('boot.html') !== -1) return;
  function watch() {
    try {
      var splash = document.getElementById('yasco-splash');
      if (!splash || splash.className.indexOf('ys-hide') !== -1) { log('YASCO_UI_READY'); return; }
      if (window.MutationObserver) {
        new MutationObserver(function () {
          if (splash.className.indexOf('ys-hide') !== -1) log('YASCO_UI_READY');
        }).observe(splash, { attributes: true, attributeFilter: ['class'] });
      }
      setTimeout(function () { log('YASCO_UI_READY_SLOW'); }, 25000);
    } catch (e) {
      log('YASCO_UI_READY_UNKNOWN');
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(watch, 300); });
  } else {
    setTimeout(watch, 300);
  }
})();
"#;

  template
    .replace("__PORT__", &port.to_string())
    .replace("__STATUS__", &format!("{:?}", status()))
    .replace("__SCHEME__", &format!("{:?}", SCHEME_ORIGIN))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn percent_decode(input: &str) -> String {
  let bytes = input.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;

  while i < bytes.len() {
    if bytes[i] == b'%' && i + 2 < bytes.len() {
      let hi = (bytes[i + 1] as char).to_digit(16);
      let lo = (bytes[i + 2] as char).to_digit(16);
      if let (Some(hi), Some(lo)) = (hi, lo) {
        out.push((hi * 16 + lo) as u8);
        i += 3;
        continue;
      }
    }
    out.push(bytes[i]);
    i += 1;
  }

  String::from_utf8_lossy(&out).into_owned()
}
