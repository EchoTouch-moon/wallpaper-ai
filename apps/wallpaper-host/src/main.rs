//! wallpaper-host — native WebView2 wallpaper host for WallpaperAI.
//!
//! Three diagnostic modes isolate the WebView2 Controller's real limits:
//!
//! - `top-level` (A0): plain top-level window, NO parent, NO style changes
//!   before WebView2 creation. Proves the wry + WebView2 baseline works at all.
//!
//! - `reparent` (A1): A0 PASS → create WebView2 first, THEN SetParent into the
//!   desktop target. Proves the traditional Controller survives reparent when
//!   its surface is already established on a top-level window.
//!
//! - `reparent-click-through` (A2): A1 PASS → add WS_EX_NOACTIVATE /
//!   WS_EX_TOOLWINDOW / WS_EX_TRANSPARENT incrementally and verify icons still
//!   work.
//!
//! The previous "nested child = no surface" claim is UNVERIFIED — these modes
//! exist to test it. See plan/p2.0-webview2-blocker.md.

mod desktop;
mod renderer;

use std::time::{Duration, Instant};

use clap::{Parser, ValueEnum};
use tao::platform::windows::{WindowBuilderExtWindows, WindowExtWindows};
use tao::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

use crate::desktop::{probe, DesktopTarget};
use crate::renderer::{make_handler, RendererRoot, ENTRY_URL};

/// Diagnostic mode controlling how/when the window attaches to the desktop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum Mode {
    /// A0: plain top-level window, no desktop attach. Baseline for WebView2.
    #[value(name = "top-level")]
    TopLevel,
    /// A1: WebView2 created on top-level window, then SetParent to desktop.
    #[value(name = "reparent")]
    Reparent,
    /// A2: A1 + incremental click-through ex-styles.
    #[value(name = "reparent-click-through")]
    ReparentClickThrough,
}

/// CLI args.
#[derive(Parser, Debug)]
#[command(name = "wallpaper-host", about = "Native WebView2 wallpaper host")]
struct Args {
    /// Path to the renderer dist root (must contain index.html).
    #[arg(long)]
    renderer: String,

    /// Diagnostic mode.
    #[arg(long, value_enum, default_value_t = Mode::TopLevel)]
    mode: Mode,

    /// Watchdog interval for the guardian tick, in milliseconds (min 50).
    #[arg(long, default_value_t = 500, value_parser = clap::value_parser!(u64).range(50..))]
    guardian_interval_ms: u64,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    println!(
        "[host] starting; renderer={} mode={:?}",
        args.renderer, args.mode
    );

    // Probe desktop topology (always — cheap, gives diagnostics even in A0).
    let target = probe()?;
    println!(
        "[host] desktop variant = {:?}, parent = {:?}, insert_after = {:?}",
        target.variant, target.parent, target.insert_after
    );

    let root = RendererRoot::new(&args.renderer)?;
    let mode = args.mode;

    // Window creation: A0/A1/A2 all start as a plain top-level window with NO
    // parent and NO exotic ex-styles. with_parent_window is NEVER used — the
    // "creation-time parent" route caused E_INVALIDARG and is not what we test
    // here. Reparent (when used) happens AFTER WebView2 creation.
    let event_loop = EventLoop::new();
    // Size the window to the actual primary monitor (physical px), not a
    // hardcoded 1920x1080 — that clips on displays with different resolution.
    let (screen_w, screen_h) = primary_screen_size();
    let builder = WindowBuilder::new()
        .with_title("WallpaperAI")
        .with_decorations(false)
        // tao default: decoration_shadow=true. On a frameless window this draws a
        // ~11px resize/snap border (the source of the (11,2) WRY_WEBVIEW offset).
        // Explicitly disable it. Per Codex verdict this must be tried before any
        // custom WM_NCCALCSIZE subclass.
        .with_undecorated_shadow(false)
        .with_resizable(false)
        .with_minimizable(false)
        .with_maximizable(false)
        .with_fullscreen(None)
        // NO with_parent_window here.
        // NO_REDIRECTION_BITMAP false: ensure a normal redirectable surface.
        .with_no_redirection_bitmap(false)
        .with_skip_taskbar(true)
        .with_inner_size(tao::dpi::PhysicalSize::new(
            screen_w as f64,
            screen_h as f64,
        ));
    println!("[host] primary screen = {}x{} px", screen_w, screen_h);

    let window = builder.build(&event_loop)?;
    window.set_visible(true);
    let hwnd = window.hwnd();
    println!(
        "[host] top-level window created + visible; hwnd = 0x{:x}; undecorated_shadow={}",
        hwnd,
        window.has_undecorated_shadow()
    );
    log_window_state(hwnd, "after create");
    log_full_geometry(hwnd, "after create (full geom)");

    // A0 critical: do NOT touch styles before WebView2 creation. No WS_CHILD,
    // no WS_EX_LAYERED, no WS_EX_TRANSPARENT, no SetLayeredWindowAttributes.
    // The previous code mixed these in and they may have caused E_INVALIDARG.

    // Create WebView2 on the clean top-level window.
    println!("[host] creating WebView2 (build)...");
    let webview = WebViewBuilder::new()
        .with_url(ENTRY_URL)
        .with_custom_protocol(renderer::SCHEME.to_string(), make_handler(root))
        .build(&window);
    match webview {
        Ok(wv) => {
            println!("[host] WebView2 created OK; loaded {}", ENTRY_URL);
            run_event_loop(event_loop, args, hwnd, target, mode, wv);
        }
        Err(e) => {
            eprintln!("[host] WebView2 creation FAILED: {}", e);
            eprintln!("[host] A0 failure means the issue is NOT reparent-related; stopping.");
            return Err(e.into());
        }
    }
    Ok(())
}

/// Run the event loop. In reparent modes, schedule the reparent after a delay
/// so the page has time to load.
///
/// Uses ControlFlow::WaitUntil with absolute deadlines (per Codex verdict):
/// tao 0.35 Windows has a dedicated wait thread using MsgWaitForMultipleObjectsEx,
/// which wakes on timeout independent of whether the (transparent/noactivate)
/// wallpaper HWND receives input. Each tick advances the fired task's deadline
/// by its interval; if a deadline has fallen behind `now`, it is advanced in a
/// loop until it's in the future (avoids busy-looping on a stale Instant).
fn run_event_loop(
    event_loop: EventLoop<()>,
    args: Args,
    hwnd: isize,
    target: DesktopTarget,
    mode: Mode,
    webview: wry::WebView,
) {
    const REPARENT_DELAY: Duration = Duration::from_millis(1500);
    const STATUS_INTERVAL: Duration = Duration::from_millis(3000);

    let guardian_interval = Duration::from_millis(args.guardian_interval_ms);
    let now = Instant::now();

    // Absolute deadlines. reparent_at is one-shot: set to None once consumed.
    let mut reparent_at: Option<Instant> = if mode == Mode::TopLevel {
        None // A0 never reparents
    } else {
        Some(now + REPARENT_DELAY)
    };
    let mut next_guardian_at = now + guardian_interval;
    let mut next_status_at = now + STATUS_INTERVAL;

    // Diagnostic counters for the trace log.
    // Diagnostic: confirm WaitUntil wakes via ResumeTimeReached (log once).
    let mut trace_logged = false;

    let webview = webview;
    event_loop.run(move |event, _, control_flow| {
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
                return;
            }
            Event::NewEvents(start_cause) => {
                // Diagnostic: log StartCause once to confirm WaitUntil wakes
                // via ResumeTimeReached (not just Poll-like spam).
                if !trace_logged {
                    if let tao::event::StartCause::ResumeTimeReached { .. } = start_cause {
                        println!("[trace] NewEvents: ResumeTimeReached (WaitUntil working)");
                        trace_logged = true;
                    }
                }
            }
            Event::MainEventsCleared => {
                let now = Instant::now();

                // One-shot reparent. Only consume the one-shot on full success;
                // on failure reschedule +1s so it retries (proper backoff lands
                // with the recovery state machine).
                if let Some(deadline) = reparent_at {
                    if now >= deadline {
                        let t0 = Instant::now();
                        match do_reparent(hwnd, &target, mode, &webview) {
                            Ok(()) => {
                                println!(
                                    "[trace] reparent fired at {:?} (scheduled at start+{:?}) — OK",
                                    t0, REPARENT_DELAY
                                );
                                reparent_at = None; // consume one-shot
                            }
                            Err(e) => {
                                eprintln!("[trace] reparent failed: {} — retry in 1s", e);
                                reparent_at = Some(now + Duration::from_secs(1));
                            }
                        }
                    }
                }

                // Guardian tick.
                if now >= next_guardian_at {
                    // Advance past now in a loop so a stale deadline doesn't
                    // immediately re-trigger on the next MainEventsCleared.
                    while next_guardian_at <= now {
                        next_guardian_at += guardian_interval;
                    }
                    guardian_tick(hwnd, target.parent);
                }

                // Periodic status log.
                if now >= next_status_at {
                    while next_status_at <= now {
                        next_status_at += STATUS_INTERVAL;
                    }
                    log_window_state(hwnd, "alive");
                }

                // Compute next deadline = min of remaining absolute deadlines.
                let next = [reparent_at, Some(next_guardian_at), Some(next_status_at)]
                    .into_iter()
                    .flatten()
                    .min();
                match next {
                    Some(deadline) => {
                        // Advance if already past (defensive; the per-task
                        // loops above should have prevented this).
                        let deadline = if deadline <= now { now } else { deadline };
                        *control_flow = ControlFlow::WaitUntil(deadline);
                    }
                    // No future tasks (e.g. A0 with reparent_at=None after
                    // guardian/status also exhausted — shouldn't happen, but
                    // fall back to a long Wait rather than busy-loop).
                    None => *control_flow = ControlFlow::Wait,
                }
            }
            _ => {}
        }
    });
}

/// A1/A2 reparent: move the top-level window into the desktop target.
fn do_reparent(
    hwnd: isize,
    target: &DesktopTarget,
    mode: Mode,
    webview: &wry::WebView,
) -> anyhow::Result<()> {
    use windows::Win32::Foundation::{GetLastError, SetLastError, HWND};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowLongPtrW, SetParent, SetWindowLongPtrW, SetWindowPos, HWND_BOTTOM,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_SHOWWINDOW, WINDOW_LONG_PTR_INDEX, WS_CAPTION,
        WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_EX_APPWINDOW, WS_EX_LAYERED,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, WS_MAXIMIZEBOX, WS_MINIMIZEBOX,
        WS_POPUP, WS_SYSMENU, WS_THICKFRAME, WS_VISIBLE,
    };
    const GWLP_STYLE_IDX: WINDOW_LONG_PTR_INDEX = WINDOW_LONG_PTR_INDEX(-16);
    const GWLP_EXSTYLE_IDX: WINDOW_LONG_PTR_INDEX = WINDOW_LONG_PTR_INDEX(-20);

    println!("[reparent] mode={:?} starting", mode);
    log_window_state(hwnd, "before reparent");

    let hwnd_isize = hwnd; // keep isize copy for post-unsafe-block logging
    let hwnd = HWND(hwnd as _);
    unsafe {
        // GWL_STYLE: clear ALL non-client-area styles (caption/sysmenu/thickframe
        // + minimize/maximize boxes) — these are what produce the visible
        // "WallpaperAI" title bar + border ("shell") when reparented into WorkerW.
        // Also clear WS_POPUP. Keep only WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN |
        // WS_CLIPSIBLINGS (the bare minimum for a child that paints content).
        let style = GetWindowLongPtrW(hwnd, GWLP_STYLE_IDX) as u32;
        let clear_mask = WS_POPUP.0
            | WS_CAPTION.0
            | WS_THICKFRAME.0
            | WS_SYSMENU.0
            | WS_MINIMIZEBOX.0
            | WS_MAXIMIZEBOX.0;
        let keep_mask = WS_CHILD.0 | WS_VISIBLE.0 | WS_CLIPCHILDREN.0 | WS_CLIPSIBLINGS.0;
        let new_style = (style & !clear_mask) | keep_mask;
        SetWindowLongPtrW(hwnd, GWLP_STYLE_IDX, new_style as isize);
        println!("[reparent] GWL_STYLE 0x{:x} -> 0x{:x}", style, new_style);

        let ex = GetWindowLongPtrW(hwnd, GWLP_EXSTYLE_IDX) as u32;
        let mut new_ex = (ex & !WS_EX_APPWINDOW.0) | WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0;
        if mode == Mode::ReparentClickThrough {
            new_ex |= WS_EX_TRANSPARENT.0;
        }
        new_ex &= !WS_EX_LAYERED.0; // Classic branch: NO LAYERED
        SetWindowLongPtrW(hwnd, GWLP_EXSTYLE_IDX, new_ex as isize);
        println!("[reparent] GWL_EXSTYLE 0x{:x} -> 0x{:x}", ex, new_ex);

        // SetParent — propagate errors instead of swallowing. windows 0.61
        // returns Result<HWND>; on Err the attach must NOT be marked successful.
        SetLastError(windows::Win32::Foundation::WIN32_ERROR(0));
        let prev = SetParent(hwnd, Some(target.parent)).map_err(|e| {
            let le = GetLastError();
            anyhow::anyhow!("SetParent failed: {} (GetLastError={:?})", e, le)
        })?;
        println!("[reparent] SetParent OK; prev parent = {:?}", prev);

        // Size the window to cover the parent WorkerW's client rect. Use
        // GetClientRect(parent) — NOT primary_screen_size() — so the wallpaper
        // always服从 the actual paint target (matters for multi-monitor,
        // recovery onto a fresh WorkerW, etc.).
        let mut parent_client = windows::Win32::Foundation::RECT::default();
        GetClientRect(target.parent, &mut parent_client).map_err(|e| {
            let le = GetLastError();
            anyhow::anyhow!(
                "GetClientRect(parent) failed: {} (GetLastError={:?})",
                e,
                le
            )
        })?;
        let pw = parent_client.right - parent_client.left;
        let ph = parent_client.bottom - parent_client.top;
        println!("[reparent] WorkerW GetClientRect = {}x{}", pw, ph);

        SetWindowPos(
            hwnd,
            Some(HWND_BOTTOM),
            0,
            0,
            pw,
            ph,
            SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
        )
        .map_err(|e| {
            let le = GetLastError();
            anyhow::anyhow!("SetWindowPos failed: {} (GetLastError={:?})", e, le)
        })?;
        println!("[reparent] SetWindowPos HWND_BOTTOM {}x{}", pw, ph);
    }

    // Read the host's ACTUAL client rect after attach — this is the source of
    // truth for the webview bounds (not primary_screen_size, not parent rect).
    // Per Codex verdict: use PhysicalPosition(0,0) + PhysicalSize(client_w,
    // client_h). wry 0.55's Size::Physical branch is a no-op in to_physical,
    // so no double-scaling.
    let mut host_client = windows::Win32::Foundation::RECT::default();
    unsafe {
        GetClientRect(HWND(hwnd_isize as _), &mut host_client).map_err(|e| {
            let le = GetLastError();
            anyhow::anyhow!("GetClientRect(host) failed: {} (GetLastError={:?})", e, le)
        })?;
    }
    let cw = host_client.right - host_client.left;
    let ch = host_client.bottom - host_client.top;
    if cw <= 0 || ch <= 0 {
        return Err(anyhow::anyhow!(
            "host GetClientRect returned non-positive size: {}x{}",
            cw,
            ch
        ));
    }
    println!("[reparent] host GetClientRect = {}x{}", cw, ch);

    webview
        .set_bounds(wry::Rect {
            position: tao::dpi::PhysicalPosition::new(0.0, 0.0).into(),
            size: tao::dpi::PhysicalSize::new(cw as f64, ch as f64).into(),
        })
        .map_err(|e| anyhow::anyhow!("webview.set_bounds failed: {}", e))?;
    println!("[reparent] webview.set_bounds physical {}x{}", cw, ch);

    log_window_state(hwnd_isize, "after reparent");
    println!("[reparent] mode={:?} done", mode);
    log_full_geometry(hwnd_isize, "after reparent (full geom)");
    Ok(())
}

/// Log a window's HWND, parent, style, exstyle, rect, and direct children.
fn log_window_state(hwnd_isize: isize, label: &str) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, GetWindowLongPtrW, GetWindowRect, WINDOW_LONG_PTR_INDEX,
    };
    const GWLP_STYLE_IDX: WINDOW_LONG_PTR_INDEX = WINDOW_LONG_PTR_INDEX(-16);
    const GWLP_EXSTYLE_IDX: WINDOW_LONG_PTR_INDEX = WINDOW_LONG_PTR_INDEX(-20);

    let hwnd = HWND(hwnd_isize as _);
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWLP_STYLE_IDX) as u32;
        let ex = GetWindowLongPtrW(hwnd, GWLP_EXSTYLE_IDX) as u32;
        let mut rect = windows::Win32::Foundation::RECT::default();
        let _ = GetWindowRect(hwnd, &mut rect);
        let parent = desktop::true_parent(hwnd);
        let parent_cls = class_name(parent);
        println!(
            "[state {}] hwnd=0x{:x} style=0x{:x} ex=0x{:x} parent=0x{:x}({}) rect={},{},{},{}",
            label,
            hwnd_isize,
            style,
            ex,
            parent.0 as usize,
            parent_cls,
            rect.left,
            rect.top,
            rect.right - rect.left,
            rect.bottom - rect.top
        );
        // List direct children (WRY_WEBVIEW container + WebView2 children).
        // Record rect to diagnose alignment (does WRY_WEBVIEW fill the client area?).
        let mut kids: Vec<(isize, String, bool, i32, i32, i32, i32)> = Vec::new();
        unsafe extern "system" fn child_proc(
            hwnd: HWND,
            lparam: windows::Win32::Foundation::LPARAM,
        ) -> windows::core::BOOL {
            let kids = &mut *(lparam.0 as *mut Vec<(isize, String, bool, i32, i32, i32, i32)>);
            use windows::Win32::UI::WindowsAndMessaging::{
                GetClassNameW, GetWindowRect, IsWindowVisible,
            };
            let mut buf = [0u16; 64];
            GetClassNameW(hwnd, &mut buf);
            let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            let cls = String::from_utf16_lossy(&buf[..len]);
            let mut r = windows::Win32::Foundation::RECT::default();
            let _ = GetWindowRect(hwnd, &mut r);
            kids.push((
                hwnd.0 as isize,
                cls,
                IsWindowVisible(hwnd).as_bool(),
                r.left,
                r.top,
                r.right - r.left,
                r.bottom - r.top,
            ));
            windows::core::BOOL(1)
        }
        let _ = EnumChildWindows(
            Some(hwnd),
            Some(child_proc),
            windows::Win32::Foundation::LPARAM(&mut kids as *mut _ as isize),
        );
        for (k, cls, vis, x, y, w, h) in &kids {
            println!(
                "  child 0x{:x} {} vis={} rect={},{},{}x{}",
                k, cls, vis, x, y, w, h
            );
        }
    }
}

fn class_name(hwnd: windows::Win32::Foundation::HWND) -> String {
    use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;
    let mut buf = [0u16; 64];
    unsafe { GetClassNameW(hwnd, &mut buf) };
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

/// Primary monitor size in physical pixels via GetSystemMetrics.
/// SM_CXSCREEN=0, SM_CYSCREEN=1. This is the actual display resolution
/// (e.g. 1707x1067 on this machine), NOT the WorkerW rect (which may include
/// virtual-display extension). Used for both window creation and webview bounds
/// so the renderer fills the screen exactly with no clipping.
/// Remove WS_CAPTION/WS_THICKFRAME/WS_SYSMENU and force a frame change so the
/// window has ZERO non-client area. tao's with_decorations(false) leaves these
/// styles in place on Windows, giving the window ~11px insets at DPI 1.5x that
/// offset WRY_WEBVIEW from (0,0). Must be called before WebView2 creation so
/// the webview anchors at the true client origin.
fn primary_screen_size() -> (i32, i32) {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SYSTEM_METRICS_INDEX};
    const SM_CXSCREEN: SYSTEM_METRICS_INDEX = SYSTEM_METRICS_INDEX(0);
    const SM_CYSCREEN: SYSTEM_METRICS_INDEX = SYSTEM_METRICS_INDEX(1);
    let w = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let h = unsafe { GetSystemMetrics(SM_CYSCREEN) };
    (w, h)
}

/// Get the DPI for a window (via Win32 GetDpiForWindow). Falls back to system
/// DPI (96) if the call fails. Used to convert physical screen px → logical px
/// for wry's set_bounds (which expects logical sizes and scales internally).
fn dpi_for_hwnd(hwnd_isize: isize) -> u32 {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    let hwnd = HWND(hwnd_isize as _);
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 {
        96
    } else {
        dpi
    }
}

/// Full geometry diagnostic per Codex verdict §2. Records the 6 rect sources +
/// DPI awareness context so the (11,2) offset can be attributed to the right
/// layer (window rect / client rect / DWM extended bounds / DPI virtualization).
fn log_full_geometry(hwnd_isize: isize, label: &str) {
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::HiDpi::{
        AreDpiAwarenessContextsEqual, GetWindowDpiAwarenessContext,
        DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, DPI_AWARENESS_CONTEXT_SYSTEM_AWARE,
        DPI_AWARENESS_CONTEXT_UNAWARE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect};

    let hwnd = HWND(hwnd_isize as _);
    println!("[geom {}] hwnd=0x{:x}", label, hwnd_isize);

    unsafe {
        // 1. GetWindowRect (may be DPI-virtualized)
        let mut wr = RECT::default();
        if GetWindowRect(hwnd, &mut wr).is_ok() {
            println!(
                "  GetWindowRect       = {},{} {}x{}",
                wr.left,
                wr.top,
                wr.right - wr.left,
                wr.bottom - wr.top
            );
        }
        // 2. GetClientRect
        let mut cr = RECT::default();
        if GetClientRect(hwnd, &mut cr).is_ok() {
            println!(
                "  GetClientRect       = {}x{}",
                cr.right - cr.left,
                cr.bottom - cr.top
            );
        }
        // 3. ClientToScreen(0,0) — where does client origin sit on screen?
        let mut origin = POINT { x: 0, y: 0 };
        if ClientToScreen(hwnd, &mut origin).as_bool() {
            println!("  ClientToScreen(0,0) = {},{}", origin.x, origin.y);
        }
        // 4. DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS) — DWM's true bounds
        let mut ext = RECT::default();
        let _ = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut ext as *mut _ as *mut _,
            std::mem::size_of::<RECT>() as u32,
        );
        println!(
            "  DWMWA_EXTENDED_FRAME_BOUNDS = {},{} {}x{}",
            ext.left,
            ext.top,
            ext.right - ext.left,
            ext.bottom - ext.top
        );
        // 5. DPI
        let dpi = dpi_for_hwnd(hwnd_isize);
        println!("  DPI = {} (scale {:.2}x)", dpi, dpi as f64 / 96.0);
        // 6. DPI awareness context
        let ctx = GetWindowDpiAwarenessContext(hwnd);
        let aware = if AreDpiAwarenessContextsEqual(ctx, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
            .as_bool()
        {
            "PER_MONITOR_V2"
        } else if AreDpiAwarenessContextsEqual(ctx, DPI_AWARENESS_CONTEXT_SYSTEM_AWARE).as_bool() {
            "SYSTEM_AWARE"
        } else if AreDpiAwarenessContextsEqual(ctx, DPI_AWARENESS_CONTEXT_UNAWARE).as_bool() {
            "UNAWARE"
        } else {
            "OTHER"
        };
        println!("  DPI awareness = {}", aware);
    }
}

/// Minimal guardian: healthy path is a no-op.
fn guardian_tick(hwnd: isize, expected_parent: windows::Win32::Foundation::HWND) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, IsWindow};

    let hwnd = HWND(hwnd as _);
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        eprintln!("[guardian] host window invalid");
        return;
    }
    let parent = desktop::true_parent(hwnd);
    if parent != expected_parent {
        let mut cls = [0u16; 64];
        unsafe { GetClassNameW(parent, &mut cls) };
        eprintln!(
            "[guardian] parent changed: expected 0x{:x} got 0x{:x} ({})",
            expected_parent.0 as usize,
            parent.0 as usize,
            String::from_utf16_lossy(&cls)
        );
    }
}
