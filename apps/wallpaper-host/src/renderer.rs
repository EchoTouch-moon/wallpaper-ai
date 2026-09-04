//! Renderer loader — serves the built React static assets via a custom wry
//! protocol (`wallpaper://`). Files are read from the renderer dist root
//! passed on the CLI; `..` traversal is rejected and only paths inside the
//! root are served.
//!
//! P2.2: additionally serves `/manifest.json` (asset pool + slot assignment,
//! serialized from the shared AssetPool on every request so a rebuilt
//! generation always boots with the current assignment) and `/assets/<file>`
//! (only names currently known to the pool are ever read from disk).

use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Context, Result};
use wry::http::{header::CONTENT_TYPE, Request, Response, StatusCode};

use crate::assets::AssetPool;

/// Canonical scheme name used to load the renderer.
pub const SCHEME: &str = "wallpaper";

/// The URL the webview navigates to. wry maps the scheme to the handler.
pub const ENTRY_URL: &str = "wallpaper://localhost";

/// Validated renderer root (canonical absolute path).
#[derive(Clone)]
pub struct RendererRoot {
    inner: Arc<PathBuf>,
}

impl RendererRoot {
    /// Canonicalize + verify index.html exists.
    pub fn new(path: impl AsRef<Path>) -> Result<Self> {
        let p = path.as_ref();
        let canonical =
            std::fs::canonicalize(p).with_context(|| format!("renderer root {:?} not found", p))?;
        if !canonical.join("index.html").exists() {
            return Err(anyhow!(
                "{:?} is not a renderer dist (no index.html)",
                canonical
            ));
        }
        Ok(Self {
            inner: Arc::new(canonical),
        })
    }

    pub fn as_path(&self) -> &Path {
        &self.inner
    }
}

/// Build the synchronous protocol handler closure for wry. Returns owned
/// bytes (Cow::Owned) with a guessed MIME type. Rejects `..` traversal and
/// any path that canonicalizes outside the renderer root.
pub fn make_handler(
    root: RendererRoot,
    pool: Option<Arc<Mutex<AssetPool>>>,
) -> impl Fn(wry::WebViewId, Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    move |_id, request| match build_response(&root, pool.as_ref(), &request) {
        Ok((bytes, mime)) => Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, mime.as_str())
            .body(Cow::Owned(bytes))
            .unwrap(),
        Err(e) => {
            eprintln!("[renderer] {:?}: {}", request.uri(), e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
    }
}

fn build_response(
    root: &RendererRoot,
    pool: Option<&Arc<Mutex<AssetPool>>>,
    request: &Request<Vec<u8>>,
) -> Result<(Vec<u8>, String)> {
    let path = request.uri().path();

    // P2.2: manifest = current pool state, regenerated per request.
    if path == "/manifest.json" {
        let body = match pool {
            Some(p) => p
                .lock()
                .map(|p| p.manifest_json())
                .map_err(|_| anyhow!("asset pool poisoned"))?,
            // No --assets configured: empty manifest, renderer stays on its
            // gradient placeholders.
            None => "{\"assets\":[],\"assignment\":{}}".to_string(),
        };
        return Ok((body.into_bytes(), "application/json".to_string()));
    }

    // P2.2: image files, gated by the pool's scanned name list. NOTE: the
    // Vite renderer bundle's own hashed chunks also live under /assets/ —
    // names not in the pool fall through to the static root instead of
    // erroring (regression seen live: index-*.js/css 500'd, blank wallpaper).
    if let Some(name) = path.strip_prefix("/assets/") {
        if let Some(pool) = pool {
            if let Ok(p) = pool.lock() {
                if p.knows_file(name) {
                    let candidate = p.file_path(name);
                    let bytes = std::fs::read(&candidate)
                        .with_context(|| format!("read {:?}", candidate))?;
                    let mime = mime_guess::from_path(name)
                        .first_or_octet_stream()
                        .essence_str()
                        .to_string();
                    return Ok((bytes, mime));
                }
            }
        }
        return serve_static(root, path);
    }

    serve_static(root, path)
}

fn serve_static(root: &RendererRoot, path: &str) -> Result<(Vec<u8>, String)> {
    let rel = if path == "/" {
        "index.html"
    } else {
        path.trim_start_matches('/')
    };

    if rel.contains("..") {
        return Err(anyhow!("path traversal rejected"));
    }

    let candidate = root.as_path().join(rel);
    let canonical_candidate = std::fs::canonicalize(&candidate)
        .with_context(|| format!("file {:?} not readable", candidate))?;
    if !canonical_candidate.starts_with(root.as_path()) {
        return Err(anyhow!("path outside renderer root"));
    }

    let bytes = std::fs::read(&canonical_candidate)
        .with_context(|| format!("read {:?}", canonical_candidate))?;
    let mime = mime_guess::from_path(&canonical_candidate)
        .first_or_octet_stream()
        .essence_str()
        .to_string();
    Ok((bytes, mime))
}

fn error_response(status: StatusCode, msg: &str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain")
        .body(Cow::Owned(msg.as_bytes().to_vec()))
        .unwrap()
}
