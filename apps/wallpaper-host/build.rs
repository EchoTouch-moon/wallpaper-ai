//! Build script — injects the git short hash + build time into the binary so
//! every running `wallpaper-host` can be traced back to a specific commit via
//! its startup banner. This was added in response to a Codex BLOCKED review
//! where a screenshot of a regressed (captioned) window could not be
//! attributed to a specific binary instance.
//!
//! We deliberately do NOT fail the build if `git` is unavailable (e.g. a
//! tarball extract) — the banner falls back to "unknown" and the rest of the
//! diagnostics still work.

use std::process::Command;

fn main() {
    // Re-run if the source changes (so the hash stays in sync with HEAD).
    println!("cargo:rerun-if-changed=src/main.rs");
    println!("cargo:rerun-if-changed=src/desktop.rs");
    println!("cargo:rerun-if-changed=src/renderer.rs");

    // Inject the short git hash of HEAD. Fallback to "unknown" if git fails
    // (e.g. building from a tarball without .git).
    let git_hash = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=WALLPAPER_HOST_GIT_HASH={}", git_hash);

    // Build timestamp (UTC) so two builds at the same commit are
    // distinguishable. Kept human-readable for log scanning.
    let build_time = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            "[DateTime]::UtcNow.ToString(\"yyyy-MM-ddTHH:mm:ssZ\")",
        ])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=WALLPAPER_HOST_BUILD_TIME={}", build_time);
}
