//! wallpaper-host — native WebView2 wallpaper host for WallpaperAI.
//!
//! Pipeline (the OPPOSITE of the failed Electron route):
//!   1. Probe desktop topology → find correct parent HWND + Z-order anchor
//!   2. Create a tao Window as a CHILD of that HWND (creation-time parent,
//!      not事后 SetParent) with NOREDIR=false + skip-taskbar
//!   3. Apply WS_EX_TRANSPARENT | WS_EX_NOACTIVATE so clicks pass through to
//!      desktop icons and the wallpaper never steals focus
//!   4. Create a wry WebView2 as a child of our window, loading the renderer
//!      via a sandboxed custom protocol
//!
//! Guardian (Explorer-restart recovery) lands in a later iteration — this
//! build is the minimum visual + interaction proof.

mod desktop;
mod renderer;

use std::time::Duration;

use clap::Parser;
use tao::platform::windows::{WindowBuilderExtWindows, WindowExtWindows};
use tao::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

use crate::desktop::{probe, DesktopVariant};
use crate::renderer::{make_handler, RendererRoot, ENTRY_URL};

/// CLI args — renderer path is required.
#[derive(Parser, Debug)]
#[command(name = "wallpaper-host", about = "Native WebView2 wallpaper host")]
struct Args {
    /// Path to the renderer dist root (must contain index.html).
    #[arg(long)]
    renderer: String,

    /// Poll interval for the guardian watchdog, in milliseconds.
    #[arg(long, default_value_t = 500)]
    guardian_interval_ms: u64,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    println!("[host] wallpaper-host starting; renderer={}", args.renderer);

    // 1. Probe desktop topology.
    let target = probe()?;
    println!(
        "[host] desktop variant = {:?}, parent = {:?}, insert_after = {:?}",
        target.variant, target.parent, target.insert_after
    );

    // 2. Load + validate renderer root.
    let root = RendererRoot::new(&args.renderer)?;

    // 3. Create the event loop + child window.
    let event_loop = EventLoop::new();
    let parent_isize = target.parent.0 as isize;
    let mut builder = WindowBuilder::new()
        .with_title("WallpaperAI")
        .with_decorations(false)
        .with_resizable(false)
        .with_minimizable(false)
        .with_maximizable(false)
        .with_fullscreen(None)
        // Native child of the discovered desktop HWND — creation-time parent,
        // not事后 SetParent. This is the key difference from the Electron route.
        .with_parent_window(parent_isize)
        // Critical: do NOT create with NOREDIRECTIONBITMAP — that flag is what
        // made Electron BrowserWindow invisible after cross-process reparent.
        .with_no_redirection_bitmap(false)
        .with_skip_taskbar(true);

    // Cover the primary monitor (bounds approximated from the parent's rect;
    // a proper multi-monitor pass comes later).
    builder = cover_primary_monitor(builder);

    let window = builder.build(&event_loop)?;
    window.set_visible(true);
    let hwnd = window.hwnd();
    println!("[host] window created + visible; hwnd = 0x{:x}", hwnd);

    // 4. Apply click-through + no-activate ex-styles so the wallpaper never
    //    intercepts mouse events meant for desktop icons.
    apply_click_through(hwnd)?;

    // 5. Position Z-order below DefView if the variant requires it.
    if let Some(anchor) = target.insert_after {
        position_under(anchor, hwnd, target.variant)?;
    }

    // 6. Create WebView2 in our window.
    //
    // BLOCKER (P2.0 PARTIAL): wry 0.55 uses the legacy CreateCoreWebView2Controller,
    // which fails with E_INVALIDARG (0x80070057) when the parent window is itself
    // a child of WorkerW (nested child window — no valid render-target surface).
    // Both build() and build_as_child() fail the same way. Octos (the PASS
    // reference) avoids this by using CreateCoreWebView2CompositionController +
    // DirectComposition, which wry does not expose. See
    // plan/p2.0-webview2-blocker.md for the full analysis.
    let webview = WebViewBuilder::new()
        .with_url(ENTRY_URL)
        .with_custom_protocol(renderer::SCHEME.to_string(), make_handler(root))
        .build(&window)?;
    let _ = webview; // keep alive
    println!("[host] webview created; loaded {}", ENTRY_URL);

    // 7. Run the event loop. Guardian tick fires on a timer (no-op when healthy).
    let guardian_interval = Duration::from_millis(args.guardian_interval_ms);
    let mut last_guardian = std::time::Instant::now();
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
            }
            Event::MainEventsCleared => {
                if last_guardian.elapsed() >= guardian_interval {
                    last_guardian = std::time::Instant::now();
                    guardian_tick(hwnd, target.parent);
                }
            }
            _ => {}
        }
    });
}

/// Configure the window to cover the primary monitor.
fn cover_primary_monitor(builder: WindowBuilder) -> WindowBuilder {
    use tao::window::Fullscreen;
    // Fullscreen-borderless covers the whole virtual screen and lets DWM
    // handle per-monitor clipping later. For the single-monitor PoC this is
    // sufficient.
    builder
        .with_fullscreen(None)
        .with_inner_size(tao::dpi::LogicalSize::new(1920f64, 1080f64))
}

/// Apply WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW so mouse
/// events pass through to desktop icons and the wallpaper never steals focus.
fn apply_click_through(hwnd: isize) -> anyhow::Result<()> {
    use windows::Win32::Foundation::{COLORREF, HWND};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, SetWindowPos, LWA_ALPHA,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
        WINDOW_LONG_PTR_INDEX, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        WS_EX_TRANSPARENT,
    };
    const GWLP_EXSTYLE: WINDOW_LONG_PTR_INDEX = WINDOW_LONG_PTR_INDEX(-20);

    let hwnd = HWND(hwnd as _);
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWLP_EXSTYLE) as u32;
        let new_ex =
            ex | WS_EX_TRANSPARENT.0 | WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0 | WS_EX_LAYERED.0;
        SetWindowLongPtrW(hwnd, GWLP_EXSTYLE, new_ex as isize);
        // SWP_FRAMECHANGED MUST come before SetLayeredWindowAttributes —
        // otherwise the LAYERED bit isn't committed to DWM yet and
        // SetLayeredWindowAttributes returns E_INVALIDARG (0x80070057).
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
        );
        SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA).unwrap_or_else(|e| {
            eprintln!(
                "[host] SetLayeredWindowAttributes failed (non-fatal): {}",
                e
            )
        });
        println!(
            "[host] click-through applied; EX 0x{:x} -> 0x{:x}",
            ex, new_ex
        );
    }
    Ok(())
}

/// Position the host window immediately below `anchor` in Z-order.
fn position_under(
    anchor_hwnd: windows::Win32::Foundation::HWND,
    hwnd: isize,
    _variant: DesktopVariant,
) -> anyhow::Result<()> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOP, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    let hwnd = HWND(hwnd as _);
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(anchor_hwnd), // place ourselves just below DefView
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
        );
    }
    Ok(())
}

/// Minimal guardian: healthy path is a no-op. If the parent window is no
/// longer valid (Explorer restarted, WorkerW destroyed), log it. Full
/// recovery (re-create window + webview) lands in the next iteration.
fn guardian_tick(hwnd: isize, expected_parent: windows::Win32::Foundation::HWND) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, IsWindow};

    let hwnd = HWND(hwnd as _);
    let valid = unsafe { IsWindow(Some(hwnd)) }.as_bool();
    if !valid {
        eprintln!("[guardian] host window invalid — recovery not yet implemented");
        return;
    }
    let parent = desktop::true_parent(hwnd);
    if parent != expected_parent {
        let mut cls = [0u16; 64];
        unsafe { GetClassNameW(parent, &mut cls) };
        eprintln!(
            "[guardian] parent changed: expected {:?} got {:?} ({})",
            expected_parent,
            parent,
            String::from_utf16_lossy(&cls)
        );
    }
    // Healthy: silent (no SetWindowPos, no 0x052C).
}
