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

    /// Poll interval for the guardian watchdog, in milliseconds.
    #[arg(long, default_value_t = 500)]
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
        "[host] top-level window created + visible; hwnd = 0x{:x}",
        hwnd
    );
    log_window_state(hwnd, "after create");

    // Strip WS_CAPTION/WS_THICKFRAME/WS_SYSMENU NOW (before WebView2 creation)
    // and force a frame change. tao's with_decorations(false) does NOT remove
    // these styles on Windows — the window is born with WS_CAPTION, which gives
    // it ~11px non-client insets at DPI 1.5x. If we leave them, WRY_WEBVIEW
    // anchors at client (0,0) = screen (11,2), producing the off-center gap.
    // Clearing here + SWP_FRAMECHANGED makes the whole window rect client area,
    // so children anchor at screen (0,0).
    strip_non_client(hwnd);
    log_window_state(hwnd, "after strip_non_client");

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
fn run_event_loop(
    event_loop: EventLoop<()>,
    args: Args,
    hwnd: isize,
    target: DesktopTarget,
    mode: Mode,
    webview: wry::WebView,
) {
    // Reparent delay: gives WebView2 + page time to initialize on the
    // top-level window before we move it. Logged as an explicit timing hack.
    // 1500ms per spec; a page-load callback would be better but wry's API
    // makes that awkward in this PoC.
    const REPARENT_DELAY_MS: u64 = 1500;
    let mut reparent_done = mode == Mode::TopLevel; // A0 never reparents
    let start = Instant::now();
    let guardian_interval = Duration::from_millis(args.guardian_interval_ms);
    let mut last_guardian = Instant::now();
    let mut last_status = Instant::now();

    // Hold webview + window alive via the closure. window is moved in below.
    let webview = webview;
    event_loop.run(move |event, _, control_flow| {
        // Poll instead of Wait so MainEventsCleared fires continuously — needed
        // for the reparent delay + guardian tick to actually run. Wait blocks
        // when there are no window events (e.g. after WS_EX_TRANSPARENT).
        *control_flow = ControlFlow::Poll;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
            }
            Event::MainEventsCleared => {
                // Reparent step (A1/A2) after the delay.
                if !reparent_done && start.elapsed() >= Duration::from_millis(REPARENT_DELAY_MS) {
                    reparent_done = true;
                    let _ = do_reparent(hwnd, &target, mode, &webview);
                }
                // Guardian: healthy = no-op.
                if last_guardian.elapsed() >= guardian_interval {
                    last_guardian = Instant::now();
                    guardian_tick(hwnd, target.parent);
                }
                // Periodic status log every ~3s.
                if last_status.elapsed() >= Duration::from_millis(3000) {
                    last_status = Instant::now();
                    log_window_state(hwnd, "alive");
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
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMNCRENDERINGPOLICY, DWMWA_NCRENDERING_POLICY,
    };
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

        // SetParent with proper error checking. windows 0.61: returns Result<HWND>.
        SetLastError(windows::Win32::Foundation::WIN32_ERROR(0));
        match SetParent(hwnd, Some(target.parent)) {
            Ok(prev) => println!("[reparent] SetParent OK; prev parent = {:?}", prev),
            Err(e) => {
                let le = GetLastError();
                eprintln!("[reparent] SetParent err: {} (GetLastError={:?})", e, le);
            }
        }

        // Use primary screen size (SM_CXSCREEN/SM_CYSCREEN), NOT the parent
        // WorkerW's GetWindowRect — the WorkerW rect can include virtual-display
        // extension (e.g. 2560x1600 when the real screen is 1707x1067), which
        // makes the wallpaper overflow and clip.
        let (w, h) = primary_screen_size();
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_BOTTOM),
            0,
            0,
            w,
            h,
            SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
        );
        println!("[reparent] SetWindowPos HWND_BOTTOM {}x{}", w, h);

        // Tell DWM NOT to render any non-client area for this window. Even with
        // WS_CAPTION/WS_THICKFRAME cleared, Win11 DWM adds a hidden ~11px resize
        // border (for snap gestures) that shrinks client area below the window
        // size. DWMWA_NCRENDERING_POLICY=DWMNCRP_DISABLED makes the entire window
        // rect usable as client area, eliminating the 22x13px letterbox.
        let policy = DWMNCRENDERINGPOLICY(2); // DWMNCRP_DISABLED
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_NCRENDERING_POLICY,
            &policy as *const _ as *const _,
            std::mem::size_of::<DWMNCRENDERINGPOLICY>() as u32,
        );
        println!("[reparent] DWM NC rendering disabled");

        // Verify final client area matches what we asked for. Per spec: use
        // the host WorkerW's GetClientRect to confirm the target paint surface.
        let mut client = windows::Win32::Foundation::RECT::default();
        if GetClientRect(hwnd, &mut client).is_ok() {
            println!(
                "[reparent] host GetClientRect = {}x{}",
                client.right - client.left,
                client.bottom - client.top
            );
        }
        let mut parent_client = windows::Win32::Foundation::RECT::default();
        if GetClientRect(target.parent, &mut parent_client).is_ok() {
            println!(
                "[reparent] WorkerW GetClientRect = {}x{}",
                parent_client.right - parent_client.left,
                parent_client.bottom - parent_client.top
            );
        }
    }

    // Sync webview bounds. Use LogicalSize because wry's Rect.size is dpi::Size
    // which it converts via to_physical(scale_factor) internally — passing
    // PhysicalSize would be double-scaled on a 1.5x DPI display. Compute the
    // logical size from the physical screen size + the host's DPI.
    let (sw, sh) = primary_screen_size();
    let dpi = dpi_for_hwnd(hwnd_isize(hwnd));
    let scale = dpi as f64 / 96.0;
    let logical_w = sw as f64 / scale;
    let logical_h = sh as f64 / scale;
    let _ = webview.set_bounds(wry::Rect {
        position: tao::dpi::LogicalPosition::new(0.0, 0.0).into(),
        size: tao::dpi::LogicalSize::new(logical_w, logical_h).into(),
    });
    println!(
        "[reparent] webview.set_bounds logical {}x{} (physical {}x{}, dpi={}, scale={})",
        logical_w, logical_h, sw, sh, dpi, scale
    );

    log_window_state(hwnd_isize(hwnd), "after reparent");
    println!("[reparent] mode={:?} done", mode);
    Ok(())
}

/// Convert windows HWND back to isize for logging helpers.
fn hwnd_isize(hwnd: windows::Win32::Foundation::HWND) -> isize {
    hwnd.0 as isize
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
fn strip_non_client(hwnd_isize: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WINDOW_LONG_PTR_INDEX, WS_CAPTION, WS_MAXIMIZEBOX,
        WS_MINIMIZEBOX, WS_POPUP, WS_SYSMENU, WS_THICKFRAME,
    };
    const GWLP_STYLE_IDX: WINDOW_LONG_PTR_INDEX = WINDOW_LONG_PTR_INDEX(-16);
    let hwnd = HWND(hwnd_isize as _);
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWLP_STYLE_IDX) as u32;
        let clear = WS_CAPTION.0
            | WS_THICKFRAME.0
            | WS_SYSMENU.0
            | WS_MINIMIZEBOX.0
            | WS_MAXIMIZEBOX.0
            | WS_POPUP.0;
        let new_style = style & !clear;
        SetWindowLongPtrW(hwnd, GWLP_STYLE_IDX, new_style as isize);
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        );
        println!(
            "[strip_non_client] GWL_STYLE 0x{:x} -> 0x{:x}",
            style, new_style
        );
    }
}

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
