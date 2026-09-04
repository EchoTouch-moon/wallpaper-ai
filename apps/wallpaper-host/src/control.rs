//! Local-only control plane for P2.2 region-level swap.
//!
//! Binds `127.0.0.1:<port>` (loopback never triggers the Windows firewall
//! prompt) and speaks just enough HTTP/1.1 for curl-style clients:
//!
//! - `GET  /health`            → `{ok, assets, assignment}` (no side effect)
//! - `POST /swap[?slot=<id>]`  → advance one slot (or all slots) and forward
//!   the change to the live renderer via `HostEvent::SwapApplied`.
//! - `POST /reload-assets`     → re-scan the assets directory.
//!
//! The control thread mutates the `AssetPool` and `send_event`s the resulting
//! swaps; all WebView access stays on the event-loop thread (wry is `!Send`),
//! mirroring how the guardian and page-load handler already work. Until the
//! host is `Running` the renderer simply isn't notified yet — a later
//! generation picks the new assignment up from `/manifest.json` at load.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tao::event_loop::EventLoopProxy;

use crate::assets::AssetPool;
use crate::HostEvent;

/// Request line + headers read cap. We never accept bodies.
const MAX_HEAD: usize = 8 * 1024;
/// Per-connection read timeout so a half-open client can't pin a thread.
const CONN_TIMEOUT: Duration = Duration::from_secs(5);

pub fn spawn(
    port: u16,
    proxy: EventLoopProxy<HostEvent>,
    pool: Arc<Mutex<AssetPool>>,
) -> std::io::Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    let local_port = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    println!("[control] listening on http://127.0.0.1:{} (loopback only)", local_port);
    std::thread::Builder::new()
        .name("control-http".into())
        .spawn(move || serve(listener, local_port, proxy, pool))?;
    Ok(())
}

fn serve(
    listener: TcpListener,
    port: u16,
    proxy: EventLoopProxy<HostEvent>,
    pool: Arc<Mutex<AssetPool>>,
) {
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let proxy = proxy.clone();
        let pool = pool.clone();
        // Thread-per-conn is fine at human interaction rates and keeps the
        // accept loop immune to a slow client.
        let _ = std::thread::Builder::new().name("control-conn".into()).spawn(move || {
            handle_conn(stream, port, proxy, pool);
        });
    }
}

/// P2.2-hardening (moonpulse review): every request must carry the custom
/// `X-Wallpaper-Control` header — browsers refuse to attach custom headers
/// cross-origin without a successful CORS preflight, which we never answer,
/// so a drive-by web page cannot mutate the wallpaper (or read /health) via
/// no-cors fetch / form POST. The Host check additionally blocks DNS
/// rebinding, where an attacker-resolved hostname still sends our headerless
/// simple request but the Host header betrays the rebinding.
fn check_origin(head_str: &str, port: u16) -> Result<(), (&'static str, u16)> {
    let mut host: Option<String> = None;
    let mut control_header = false;
    for line in head_str.lines().skip(1) {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            match name.trim().to_ascii_lowercase().as_str() {
                "host" => host = Some(value.trim().to_string()),
                "x-wallpaper-control" => control_header = true,
                _ => {}
            }
        }
    }
    if !control_header {
        return Err(("missing X-Wallpaper-Control header", 403));
    }
    let expected = format!("127.0.0.1:{}", port);
    if host.as_deref() != Some(expected.as_str()) {
        return Err(("host header mismatch (DNS rebinding guard)", 403));
    }
    Ok(())
}

fn handle_conn(
    stream: TcpStream,
    port: u16,
    proxy: EventLoopProxy<HostEvent>,
    pool: Arc<Mutex<AssetPool>>,
) {
    let mut stream = stream;
    let _ = stream.set_read_timeout(Some(CONN_TIMEOUT));
    let _ = stream.set_write_timeout(Some(CONN_TIMEOUT));

    let mut head = Vec::with_capacity(1024);
    let mut buf = [0u8; 1024];
    // Read until end of headers (or cap). We ignore bodies entirely.
    loop {
        let Ok(n) = stream.read(&mut buf) else { break };
        if n == 0 {
            break;
        }
        head.extend_from_slice(&buf[..n]);
        if head.len() > MAX_HEAD || head.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    let Ok(head_str) = std::str::from_utf8(&head) else {
        respond(&mut stream, 400, "{\"ok\":false,\"error\":\"bad request\"}");
        return;
    };
    if let Err((reason, status)) = check_origin(head_str, port) {
        eprintln!("[control] rejected: {}", reason);
        let body = format!("{{\"ok\":false,\"error\":\"{}\"}}", reason);
        respond(&mut stream, status, &body);
        return;
    }
    let Some(request_line) = head_str.lines().next() else {
        respond(&mut stream, 400, "{\"ok\":false,\"error\":\"bad request\"}");
        return;
    };
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (target, ""),
    };

    match (method, path) {
        ("GET", "/health") => {
            let body = pool.lock().map(|p| {
                format!(
                    "{{\"ok\":true,\"assets\":{},\"assignment\":{}}}",
                    p.asset_count(),
                    assignment_json(&p)
                )
            });
            match body {
                Ok(b) => respond(&mut stream, 200, &b),
                Err(_) => respond(&mut stream, 500, "{\"ok\":false,\"error\":\"pool poisoned\"}"),
            }
        }
        ("GET", "/swap") => respond(
            &mut stream,
            405,
            "{\"ok\":false,\"error\":\"POST /swap[?slot=<id>] (X-Wallpaper-Control required)\"}",
        ),
        ("POST", "/swap") => {
            let slot = parse_query(query).into_iter().find(|(k, _)| k == "slot").map(|(_, v)| v);
            // Send the event while still holding the pool lock so concurrent
            // control requests enqueue SwapApplied in the same order they
            // mutated the pool (renderer never lags the pool's assignment).
            let sent = pool.lock().map(|mut p| {
                let count = p.asset_count();
                let swaps = p.rotate(slot.as_deref());
                if swaps.is_empty() {
                    return Err(if count < 2 { "need-at-least-2-assets" } else { "unknown-slot" });
                }
                let event = HostEvent::SwapApplied {
                    swaps: swaps.clone(),
                };
                if let Err(e) = proxy.send_event(event) {
                    eprintln!("[control] send_event SwapApplied failed: {:?}", e);
                }
                Ok((swaps, count))
            });
            match sent {
                Ok(Ok((swaps, _count))) => {
                    let body = format!(
                        "{{\"ok\":true,\"swapped\":{},\"changes\":[{}]}}",
                        swaps.len(),
                        swaps
                            .iter()
                            .map(|(s, u)| format!("{{\"slot\":\"{}\",\"url\":\"{}\"}}", s, u))
                            .collect::<Vec<_>>()
                            .join(",")
                    );
                    respond(&mut stream, 200, &body);
                }
                Ok(Err(reason)) => {
                    respond(
                        &mut stream,
                        409,
                        &format!("{{\"ok\":false,\"swapped\":0,\"reason\":\"{}\"}}", reason),
                    );
                }
                Err(_) => {
                    respond(&mut stream, 500, "{\"ok\":false,\"error\":\"pool poisoned\"}");
                }
            }
        }
        ("POST", "/reload-assets") => {
            let (count, changed) = match pool.lock() {
                Ok(mut p) => {
                    let before = p.asset_count();
                    match p.rescan() {
                        Ok(()) => (p.asset_count(), before != p.asset_count()),
                        Err(e) => {
                            respond(
                                &mut stream,
                                500,
                                &format!("{{\"ok\":false,\"error\":\"rescan failed: {}\"}}", e),
                            );
                            return;
                        }
                    }
                }
                Err(_) => {
                    respond(&mut stream, 500, "{\"ok\":false,\"error\":\"pool poisoned\"}");
                    return;
                }
            };
            respond(
                &mut stream,
                200,
                &format!("{{\"ok\":true,\"assets\":{},\"changed\":{}}}", count, changed),
            );
        }
        _ => respond(&mut stream, 404, "{\"ok\":false,\"error\":\"not found\"}"),
    }
}

/// Serialize just the assignment map for /health.
fn assignment_json(pool: &AssetPool) -> String {
    pool.assignment_json()
}

/// Minimal `k=v&k=v` query parse. Values are slot ids / plain tokens — no
/// URL-decoding on purpose; anything that needs decoding is rejected later.
fn parse_query(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|kv| !kv.is_empty())
        .map(|kv| match kv.split_once('=') {
            Some((k, v)) => (k.to_string(), v.to_string()),
            None => (kv.to_string(), String::new()),
        })
        .collect()
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        _ => "Internal Server Error",
    };
    let resp = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{}",
        status,
        reason,
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}
