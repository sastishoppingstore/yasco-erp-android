//! Android-only local HTTP server.
//!
//! The Android build must run entirely from the bundled Vite `dist` (no remote
//! page load, works without a network) while still being able to talk to the
//! hosted ERP API.  The WebView therefore loads `http://127.0.0.1:<port>/app/`.
//!
//! This server:
//!   * serves the bundled front-end from memory (`appdist/`, embedded at build),
//!   * reverse-proxies `/api/*` to the hosted ERP,
//!   * keeps the browser same-origin so the existing cookie based auth works
//!     unchanged (no CORS change and no change to the live server is needed).
//!
//! Nothing here runs on desktop builds.

use std::io::Read;
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::Duration;

use include_dir::{include_dir, Dir};
use tiny_http::{Header, Response, Server, StatusCode};

static WEB: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/../appdist");

/// Hosted ERP. Only the API is reached, never the HTML/JS.
const UPSTREAM: &str = "https://yasco.tech";

static AGENT: OnceLock<ureq::Agent> = OnceLock::new();

fn agent() -> &'static ureq::Agent {
  AGENT.get_or_init(|| {
    ureq::AgentBuilder::new()
      .timeout_connect(Duration::from_secs(12))
      .timeout_read(Duration::from_secs(60))
      .timeout_write(Duration::from_secs(60))
      .build()
  })
}

/// Start the server on a free loopback port and return that port.
pub fn start() -> Result<u16, String> {
  let server = Arc::new(Server::http("127.0.0.1:0").map_err(|e| e.to_string())?);
  let port = server
    .server_addr()
    .to_ip()
    .ok_or_else(|| "local server has no TCP address".to_string())?
    .port();

  for _ in 0..6 {
    let srv = Arc::clone(&server);
    thread::spawn(move || loop {
      match srv.recv() {
        Ok(request) => handle(request),
        Err(_) => break,
      }
    });
  }

  Ok(port)
}

/// Create the main window pointed at the bundled app.
pub fn open_window(app: &mut tauri::App, port: u16) -> Result<(), Box<dyn std::error::Error>> {
  let url: tauri::Url = format!("http://127.0.0.1:{port}/app/").parse()?;
  tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url))
    .title("YASCO ERP")
    .build()?;
  Ok(())
}

fn handle(request: tiny_http::Request) {
  let path = request
    .url()
    .split('?')
    .next()
    .unwrap_or("/")
    .to_string();

  if path == "/api" || path.starts_with("/api/") {
    proxy(request);
  } else {
    serve_static(request, &path);
  }
}

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

fn serve_static(request: tiny_http::Request, path: &str) {
  let decoded = percent_decode(path);
  let rel = decoded.trim_start_matches('/');
  let rel = if rel.is_empty() { "index.html" } else { rel };

  let mut file = WEB.get_file(rel);
  let mut served_path = rel.to_string();

  // SPA fallback: unknown extension-less paths render index.html so that
  // client side routes such as /app/invoices survive a refresh.
  if file.is_none() && !has_extension(rel) {
    file = WEB.get_file("index.html");
    served_path = "index.html".to_string();
  }

  let Some(file) = file else {
    let _ = request.respond(
      Response::from_string("Not found").with_status_code(StatusCode(404)),
    );
    return;
  };

  let mime = mime_guess::from_path(&served_path).first_or_octet_stream();
  let cache = if served_path.starts_with("assets/") {
    "public, max-age=31536000, immutable"
  } else {
    "no-cache"
  };

  let headers = vec![
    header("Content-Type", mime.as_ref()),
    header("Cache-Control", cache),
    header("X-Content-Type-Options", "nosniff"),
  ];

  let _ = request.respond(Response::from_data(file.contents()).with_headers(headers));
}

fn has_extension(path: &str) -> bool {
  path.rsplit('/')
    .next()
    .map(|last| last.contains('.'))
    .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// API proxy
// ---------------------------------------------------------------------------

fn proxy(mut request: tiny_http::Request) {
  let method = request.method().as_str().to_string();
  let url = format!("{UPSTREAM}{}", request.url());

  let mut body = Vec::new();
  let _ = request.as_reader().read_to_end(&mut body);

  let mut call = agent().request(&method, &url);

  for h in request.headers() {
    let name = h.field.as_str().to_string();
    let lower = name.to_ascii_lowercase();
    // Let the HTTP client negotiate framing/encoding; forward everything else
    // (auth cookies, content-type, accept, user-agent, ...).
    if matches!(
      lower.as_str(),
      "host" | "content-length" | "connection" | "accept-encoding" | "transfer-encoding"
    ) {
      continue;
    }
    call = call.set(&name, h.value.as_str());
  }

  call = call.set("Accept-Encoding", "identity");

  let result = if body.is_empty() {
    call.call()
  } else {
    call.send_bytes(&body)
  };

  match result {
    Ok(response) => relay(request, response),
    // ureq reports every non-2xx as Error::Status; those are real API answers
    // (401, 422, ...) and must be relayed unchanged.
    Err(ureq::Error::Status(_, response)) => relay(request, response),
    Err(err) => {
      let payload = format!(
        "{{\"error\":\"offline\",\"message\":\"{}\"}}",
        err.to_string().replace('"', "'")
      );
      let _ = request.respond(
        Response::from_string(payload)
          .with_status_code(StatusCode(503))
          .with_header(header("Content-Type", "application/json"))
          .with_header(header("X-ERP-Offline", "1"))
          .with_header(header("Cache-Control", "no-store")),
      );
    }
  }
}

fn relay(request: tiny_http::Request, response: ureq::Response) {
  let status = response.status();
  let mut headers: Vec<Header> = Vec::new();

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
        headers.push(header("Set-Cookie", &rewrite_cookie(value)));
      }
      continue;
    }

    if let Some(value) = response.header(&name) {
      headers.push(header(&name, value));
    }
  }

  let mut data = Vec::new();
  if let Err(err) = response.into_reader().read_to_end(&mut data) {
    let _ = request.respond(
      Response::from_string(format!("upstream read error: {err}"))
        .with_status_code(StatusCode(502)),
    );
    return;
  }

  headers.push(header("Content-Length", &data.len().to_string()));

  let _ = request.respond(
    Response::from_data(data)
      .with_status_code(StatusCode(status))
      .with_headers(headers),
  );
}

/// The browser now lives on 127.0.0.1, so upstream cookies must become
/// first-party cookies: drop `Domain`, and `Secure` (loopback over plain HTTP)
/// plus `Partitioned`.  Name/Path/HttpOnly/SameSite/Expires are preserved.
fn rewrite_cookie(value: &str) -> String {
  value
    .split(';')
    .map(str::trim)
    .filter(|part| {
      let lower = part.to_ascii_lowercase();
      !lower.starts_with("domain=") && lower != "secure" && !lower.starts_with("partitioned")
    })
    .collect::<Vec<_>>()
    .join("; ")
}

fn header(name: &str, value: &str) -> Header {
  Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

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
