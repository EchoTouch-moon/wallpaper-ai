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
//!
//! ## P2.1: Explorer recovery state machine
//!
//! The host runs a 4-state lifecycle so that an Explorer restart (or any
//! failure between probe and page-ready) is recovered without exiting:
//!
//! ```text
//! RecoverQueued ─► (sync build candidate) ─► WaitingForPage
//!      ▲                                         │
//!      │                                         ▼ PageLoadFinished
//!      │                                   attach/bounds/show ─► Running
//!      │                                         │
//!      │              any failure ◄──────────────┴──────────► guardian verdict
//!      │                                         │
//!      └──────────── Backoff (exp. retry) ◄──────┘
//! ```
//!
//! Key invariants (per Codex review msg_2zt1fuY):
//! - `page-ready` is the *only* attach gate; the old `reparent_at` one-shot
//!   delay is gone.
//! - `WebViewBuilder::build` is synchronous (wry 0.55 waits on the WebView2
//!   COM controller), but page load is not — `WaitingForPage` has a hard
//!   timeout (default 12s) that drops the candidate and backs off.
//! - `with_on_page_load_handler` closures only `send_event`; all state
//!   mutation and `do_reparent` happen back inside `Event::UserEvent`.
//! - 0x052C is sent at most once per Explorer shell identity (Progman HWND +
//!   PID); repeated retries for the same shell skip it (see `desktop.rs`).
//! - Window events are filtered by `WindowId` so a stale destroyed window
//!   cannot trip the active generation.

mod desktop;
mod renderer;

use std::time::{Duration, Instant};

use clap::{Parser, ValueEnum};
use tao::event_loop::{
    ControlFlow, EventLoop, EventLoopBuilder, EventLoopProxy, EventLoopWindowTarget,
};
use tao::platform::windows::{WindowBuilderExtWindows, WindowExtWindows};
use tao::{
    event::{Event, WindowEvent},
    window::{Window, WindowBuilder, WindowId},
};
use wry::{PageLoadEvent, Rect, WebView, WebViewBuilder};

use crate::desktop::{probe_for_recovery, DesktopTarget, DesktopVariant, SpawnSession};
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

impl Mode {
    /// Whether this mode performs a SetParent into the desktop target after
    /// page-ready. A0 does not.
    fn attaches_to_desktop(self) -> bool {
        match self {
            Mode::TopLevel => false,
            Mode::Reparent | Mode::ReparentClickThrough => true,
        }
    }
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

    /// Page-ready timeout: how long to wait for `PageLoadEvent::Finished`
    /// after `WebViewBuilder::build` returns before declaring the candidate
    /// failed and backing off (seconds).
    #[arg(long, default_value_t = 12, value_parser = clap::value_parser!(u64).range(3..))]
    page_timeout_secs: u64,
}

// ─── Recovery state machine ────────────────────────────────────────────────

/// User events delivered through `EventLoopProxy::send_event`. Both the
/// guardian and the page-load handler use this channel; all state mutation
/// happens back inside `Event::UserEvent`, never in the page-load closure
/// (which is `'static` and cannot borrow `HostState`).
#[derive(Debug, Clone)]
enum HostEvent {
    /// Guardian (or page-timeout / startup) decided a rebuild is needed.
    /// Carries the token of the generation it was issued for, so a stale
    /// event arriving after a newer rebuild started is ignored.
    RecoveryRequested { token: u64, reason: RecoveryReason },
    /// `PageLoadEvent::Finished` fired for a candidate. The page-load closure
    /// only forwards this; the actual attach happens in the handler.
    PageLoadFinished { token: u64, url: String },
}

/// Why a recovery was requested. Diagnostic only — drives the log line.
#[derive(Debug, Clone, Copy)]
#[allow(dead_code)] // some variants only surfaced via logs / future IPC
enum RecoveryReason {
    /// `IsWindow(host) == false` — our own window was destroyed.
    HostWindowInvalid,
    /// `IsWindow(parent) == false` — WorkerW/Progman gone (Explorer died).
    ParentInvalid,
    /// Parent HWND changed since attach — reparented away from the target.
    ParentMismatch,
    /// Page did not fire `Finished` within `page_timeout_secs`.
    PageTimeout,
    /// Initial startup / first generation.
    Startup,
}

impl RecoveryReason {
    fn as_str(self) -> &'static str {
        match self {
            RecoveryReason::HostWindowInvalid => "host-hwnd-invalid",
            RecoveryReason::ParentInvalid => "parent-invalid",
            RecoveryReason::ParentMismatch => "parent-mismatch",
            RecoveryReason::PageTimeout => "page-timeout",
            RecoveryReason::Startup => "startup",
        }
    }
}

/// 4-state lifecycle (per Codex review). `Running` is the only state where the
/// runtime is considered the *active* generation; everything else is either
/// building a candidate or waiting/backoff before another attempt.
#[derive(Debug)]
#[allow(dead_code)] // some fields are surfaced via Debug / logs only
enum Lifecycle {
    /// A rebuild has been requested (or initial startup). `build_candidate`
    /// runs on the next `MainEventsCleared` (or directly off the
    /// `RecoveryRequested` UserEvent).
    RecoverQueued {
        token: u64,
        attempt: u32,
        reason: RecoveryReason,
    },
    /// Candidate window + WebView built; waiting for `PageLoadEvent::Finished`
    /// before attaching. Has a hard timeout to avoid hanging forever if the
    /// page never loads.
    WaitingForPage {
        token: u64,
        attempt: u32,
        timeout_at: Instant,
    },
    /// Candidate is attached, visible, and monitored by the guardian.
    Running,
    /// Last attempt failed (probe / build / attach / page-timeout). Wait
    /// until `retry_at`, then re-queue with `attempt` (already incremented
    /// when entering Backoff) and a fresh token.
    Backoff {
        token: u64,
        attempt: u32,
        retry_at: Instant,
    },
}

/// Owned wallpaper surface for one generation. The webview is dropped before
/// the window (both must die on the UI/COM thread; `WebView` is `!Send`).
struct HostRuntime {
    generation: u64,
    window: Window,
    webview: WebView,
    target: DesktopTarget,
    window_id: WindowId,
}

impl HostRuntime {
    /// Drop the WebView before the Window, explicitly and in order. We want
    /// the WebView controller closed before the HWND is destroyed, and we do
    /// NOT want a partially-SetParent'd HWND reused on a retry — so the caller
    /// controls timing via this method rather than letting `drop` reorder.
    fn destroy(self) {
        drop(self.webview);
        drop(self.window);
    }
}

/// All mutable host state, captured by the event-loop closure.
struct HostState {
    runtime: Option<HostRuntime>,
    lifecycle: Lifecycle,
    next_guardian_at: Instant,
    next_status_at: Instant,
    spawn_session: SpawnSession,
    proxy: EventLoopProxy<HostEvent>,
    /// Generation counter of the currently Running runtime. The candidate
    /// being built carries `active_generation + 1` and only commits here once
    /// attach + show succeed.
    active_generation: u64,
    /// Monotonic token used to invalidate in-flight page-load callbacks. Bumped
    /// on every rebuild start; a `PageLoadFinished` whose token no longer
    /// matches the current `WaitingForPage` token is ignored.
    next_token: u64,
}

impl HostState {
    fn current_window_id(&self) -> Option<WindowId> {
        self.runtime.as_ref().map(|r| r.window_id)
    }

    /// Allocate the next token and bump the counter. Used when queueing a
    /// rebuild.
    fn alloc_token(&mut self) -> u64 {
        let t = self.next_token;
        self.next_token += 1;
        t
    }

    /// Transition into `Backoff` after a failed attempt, computing the retry
    /// deadline from the (already-incremented) attempt number.
    fn enter_backoff(&mut self, token: u64, attempt_before_increment: u32) {
        let attempt = attempt_before_increment + 1;
        let delay = backoff_delay(attempt);
        eprintln!(
            "[recovery] → Backoff (token={}, attempt={}, retry in {:?})",
            token, attempt, delay
        );
        self.lifecycle = Lifecycle::Backoff {
            token,
            attempt,
            retry_at: Instant::now() + delay,
        };
    }
}

/// Exponential backoff with a cap. attempt=1 → 500ms, 2 → 1s, 3 → 2s,
/// 4 → 4s, ≥5 → 8s. attempt=0 (initial startup retry) is the short 200ms.
fn backoff_delay(attempt: u32) -> Duration {
    match attempt {
        0 => Duration::from_millis(200),
        1 => Duration::from_millis(500),
        2 => Duration::from_secs(1),
        3 => Duration::from_secs(2),
        4 => Duration::from_secs(4),
        _ => Duration::from_secs(8),
    }
}

/// Status log cadence. Kept slow — guardian already ticks every
/// `guardian_interval_ms` and the status line is for offline log analysis.
const STATUS_INTERVAL: Duration = Duration::from_secs(3);

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    println!(
        "[host] starting; renderer={} mode={:?}",
        args.renderer, args.mode
    );

    let root = RendererRoot::new(&args.renderer)?;

    // EventLoop with a custom user-event type so guardian + page-load handler
    // can decouple "discovery" from "execute" via send_event. The custom type
    // must be set on the builder, not on EventLoop::new() (which pins T=()).
    let event_loop: EventLoop<HostEvent> = EventLoopBuilder::<HostEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let now = Instant::now();
    let guardian_interval = Duration::from_millis(args.guardian_interval_ms);
    let page_timeout = Duration::from_secs(args.page_timeout_secs);
    let first_token = 1;

    let state = HostState {
        runtime: None,
        // First generation: queue an immediate build. attempt=0 so the first
        // backoff_delay (if it ever fires) is the short 200ms.
        lifecycle: Lifecycle::RecoverQueued {
            token: first_token,
            attempt: 0,
            reason: RecoveryReason::Startup,
        },
        next_guardian_at: now + guardian_interval,
        next_status_at: now + STATUS_INTERVAL,
        spawn_session: SpawnSession::new(),
        proxy: proxy.clone(),
        active_generation: 0,
        next_token: first_token + 1,
    };

    let ctx = Ctx {
        args,
        root,
        guardian_interval,
        page_timeout,
    };

    run_event_loop(event_loop, state, ctx);
    // run() diverges; this is unreachable but keeps the signature honest.
    #[allow(unreachable_code)]
    Ok(())
}

/// Immutable config threaded into the event loop.
struct Ctx {
    args: Args,
    root: RendererRoot,
    guardian_interval: Duration,
    page_timeout: Duration,
}

/// Run the event loop with the recovery state machine.
///
/// Uses `ControlFlow::WaitUntil` with absolute deadlines (per earlier Codex
/// verdict): tao 0.35 Windows has a dedicated wait thread using
/// `MsgWaitForMultipleObjectsEx`, which wakes on timeout independent of
/// whether the (transparent/noactivate) wallpaper HWND receives input.
fn run_event_loop(event_loop: EventLoop<HostEvent>, mut state: HostState, ctx: Ctx) {
    event_loop.run(move |event, target, control_flow| {
        match event {
            Event::UserEvent(HostEvent::RecoveryRequested { token, reason }) => {
                handle_recovery_requested(&mut state, target, &ctx, token, reason);
            }
            Event::UserEvent(HostEvent::PageLoadFinished { token, url }) => {
                on_page_load_finished(&mut state, &ctx, token, url);
            }
            Event::WindowEvent {
                window_id, event, ..
            } => {
                handle_window_event(&mut state, window_id, event, control_flow);
            }
            Event::MainEventsCleared => {
                let now = Instant::now();
                schedule(&mut state, target, &ctx, now);
                *control_flow = ControlFlow::WaitUntil(next_deadline(&state, now));
            }
            _ => {}
        }
    });
}

/// Decide what to do based on the current lifecycle when the loop wakes up.
/// `target` is the `EventLoopWindowTarget` we use to create new windows.
fn schedule(
    state: &mut HostState,
    target: &EventLoopWindowTarget<HostEvent>,
    ctx: &Ctx,
    now: Instant,
) {
    match state.lifecycle {
        Lifecycle::RecoverQueued { .. } => {
            build_candidate(state, target, ctx);
        }
        Lifecycle::WaitingForPage { timeout_at, .. } if now >= timeout_at => {
            // Page-ready timeout: drop the candidate, back off.
            let (token, attempt) = match state.lifecycle {
                Lifecycle::WaitingForPage { token, attempt, .. } => (token, attempt),
                _ => unreachable!(),
            };
            eprintln!(
                "[recovery] page-ready timeout (token={}, attempt={}) → Backoff",
                token, attempt
            );
            if let Some(old) = state.runtime.take() {
                eprintln!("[recovery] dropping candidate gen={}", old.generation);
                old.destroy();
            }
            state.enter_backoff(token, attempt);
        }
        Lifecycle::Backoff { retry_at, .. } if now >= retry_at => {
            // Retry: re-queue with a fresh token, same attempt count (already
            // incremented when entering Backoff).
            let attempt = match state.lifecycle {
                Lifecycle::Backoff { attempt, .. } => attempt,
                _ => unreachable!(),
            };
            let token = state.alloc_token();
            println!(
                "[recovery] Backoff expired → RecoverQueued (token={}, attempt={})",
                token, attempt
            );
            state.lifecycle = Lifecycle::RecoverQueued {
                token,
                attempt,
                reason: RecoveryReason::Startup,
            };
            build_candidate(state, target, ctx);
        }
        Lifecycle::Running => {
            if now >= state.next_guardian_at {
                while state.next_guardian_at <= now {
                    state.next_guardian_at += ctx.guardian_interval;
                }
                run_guardian(state, ctx.args.mode.attaches_to_desktop());
            }
            if now >= state.next_status_at {
                while state.next_status_at <= now {
                    state.next_status_at += STATUS_INTERVAL;
                }
                if let Some(rt) = state.runtime.as_ref() {
                    log_window_state(rt.window.hwnd() as isize, "alive");
                }
            }
        }
        _ => {}
    }
}

/// `RecoveryRequested` arrives from guardian / startup / page-load handler.
/// Only act if we are still in `RecoverQueued` for the same token — otherwise
/// it's a duplicate or stale event (a newer rebuild already started).
fn handle_recovery_requested(
    state: &mut HostState,
    target: &EventLoopWindowTarget<HostEvent>,
    ctx: &Ctx,
    token: u64,
    reason: RecoveryReason,
) {
    let current_token_matches = matches!(state.lifecycle,
        Lifecycle::RecoverQueued { token: t, .. } if t == token);
    if !current_token_matches {
        println!(
            "[recovery] RecoveryRequested token={} ignored (lifecycle no longer RecoverQueued for that token)",
            token
        );
        return;
    }
    println!(
        "[recovery] RecoveryRequested token={} reason={}",
        token,
        reason.as_str()
    );
    build_candidate(state, target, ctx);
}

/// Build a candidate window + WebView. Synchronous: `WebViewBuilder::build`
/// blocks until the WebView2 controller is initialised (wry 0.55 pumps
/// messages internally). On any failure we enter Backoff without touching
/// `runtime`. On success we move to `WaitingForPage` and let the page-load
/// handler drive the attach.
fn build_candidate(
    state: &mut HostState,
    target: &EventLoopWindowTarget<HostEvent>,
    ctx: &Ctx,
) {
    let (token, attempt) = match state.lifecycle {
        Lifecycle::RecoverQueued { token, attempt, .. } => (token, attempt),
        _ => return,
    };

    // 1. Drop any previous runtime (initial startup has none; a rebuild after
    // a guardian verdict has the dead one).
    if let Some(old) = state.runtime.take() {
        eprintln!(
            "[recovery] dropping previous runtime gen={}",
            old.generation
        );
        old.destroy();
    }

    // 2. Probe desktop topology. 0x052C is sent only if the Explorer shell
    // identity changed since the last successful spawn.
    let desktop_target = match probe_for_recovery(&mut state.spawn_session) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[recovery] probe failed: {} → Backoff", e);
            state.enter_backoff(token, attempt);
            return;
        }
    };
    println!(
        "[recovery] desktop variant = {:?}, parent = {:?}, insert_after = {:?}",
        desktop_target.variant, desktop_target.parent, desktop_target.insert_after
    );

    // Raised/Collapsed: fail-closed. Do not attempt an unverified attach.
    if ctx.args.mode.attaches_to_desktop() && desktop_target.variant != DesktopVariant::Classic {
        eprintln!(
            "[recovery] variant {:?} not supported → Backoff (fail-closed)",
            desktop_target.variant
        );
        state.enter_backoff(token, attempt);
        return;
    }

    // 3. Create the host window hidden. We only show it after a successful
    // attach so a failing candidate never flashes on the desktop.
    let window = match build_window(target) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[recovery] window build failed: {} → Backoff", e);
            state.enter_backoff(token, attempt);
            return;
        }
    };
    let window_id = window.id();
    let hwnd = window.hwnd();
    println!(
        "[recovery] candidate window created hidden; hwnd=0x{:x}; undecorated_shadow={}",
        hwnd,
        window.has_undecorated_shadow()
    );

    // 4. Build the WebView synchronously and register a page-load handler
    // that ONLY forwards Finished events via send_event. The closure cannot
    // borrow HostState ('static), so it carries just the proxy + token.
    let proxy = state.proxy.clone();
    let webview = WebViewBuilder::new()
        .with_url(ENTRY_URL)
        .with_custom_protocol(renderer::SCHEME.to_string(), make_handler(ctx.root.clone()))
        .with_on_page_load_handler(move |event, url| {
            if matches!(event, PageLoadEvent::Finished) {
                if let Err(e) = proxy.send_event(HostEvent::PageLoadFinished {
                    token,
                    url: url.clone(),
                }) {
                    eprintln!("[recovery] PageLoadFinished send_event failed: {:?}", e);
                }
            }
        })
        .build(&window);
    let webview = match webview {
        Ok(wv) => {
            println!("[recovery] WebView2 created; loaded {}", ENTRY_URL);
            wv
        }
        Err(e) => {
            eprintln!("[recovery] WebView build failed: {} → Backoff", e);
            // window dropped here implicitly
            drop(window);
            state.enter_backoff(token, attempt);
            return;
        }
    };

    // 5. Candidate ready. Move to WaitingForPage with a hard timeout.
    let candidate_generation = state.active_generation + 1;
    state.runtime = Some(HostRuntime {
        generation: candidate_generation,
        window,
        webview,
        target: desktop_target,
        window_id,
    });
    let timeout_at = Instant::now() + ctx.page_timeout;
    state.lifecycle = Lifecycle::WaitingForPage {
        token,
        attempt,
        timeout_at,
    };
    println!(
        "[recovery] candidate gen={} built → WaitingForPage (timeout {:?})",
        candidate_generation, ctx.page_timeout
    );
}

/// `PageLoadEvent::Finished` arrived for a candidate. Validate token + URL,
/// then attach + show. Any attach failure tears the candidate down and enters
/// Backoff (we never retry attach in place on a partially-SetParent'd HWND).
fn on_page_load_finished(state: &mut HostState, ctx: &Ctx, token: u64, url: String) {
    // Must be WaitingForPage for the same token; otherwise stale/duplicate.
    let attempt = match state.lifecycle {
        Lifecycle::WaitingForPage {
            token: t,
            attempt,
            ..
        } if t == token => attempt,
        _ => {
            println!(
                "[recovery] PageLoadFinished token={} ignored (not WaitingForPage for that token); url={}",
                token, url
            );
            return;
        }
    };

    // URL sanity: only attach on the entry URL (allow trailing slash). A later
    // in-page navigation must not re-trigger attach.
    if !is_entry_url(&url) {
        eprintln!(
            "[recovery] PageLoadFinished url mismatch: {} → ignored",
            url
        );
        return;
    }

    let (hwnd, target, generation) = match state.runtime.as_ref() {
        Some(r) => (r.window.hwnd() as isize, r.target, r.generation),
        None => {
            eprintln!("[recovery] PageLoadFinished but runtime is None → Backoff");
            state.enter_backoff(token, attempt);
            return;
        }
    };

    // For A0 (top-level) we skip SetParent entirely — there is no desktop
    // attach. We still set bounds from the host client rect so the WebView
    // fills the window.
    let attach_result = if ctx.args.mode.attaches_to_desktop() {
        do_reparent(hwnd, &target, ctx.args.mode, state.runtime.as_ref().unwrap().webview_ref())
    } else {
        set_webview_bounds_from_host(hwnd, state.runtime.as_ref().unwrap().webview_ref())
    };

    match attach_result {
        Ok(()) => {
            // Surface + bounds OK. Make it visible and commit the generation.
            if let Some(rt) = state.runtime.as_ref() {
                rt.window.set_visible(true);
            }
            state.active_generation = generation;
            state.lifecycle = Lifecycle::Running;
            state.next_guardian_at = Instant::now() + ctx.guardian_interval;
            state.next_status_at = Instant::now() + STATUS_INTERVAL;
            println!(
                "[recovery] ✓ generation {} active (Running)",
                state.active_generation
            );
            if let Some(rt) = state.runtime.as_ref() {
                log_window_state(rt.window.hwnd() as isize, "after attach");
                log_full_geometry(rt.window.hwnd() as isize, "after attach (full geom)");
            }
        }
        Err(e) => {
            eprintln!("[recovery] attach failed: {} → cleanup + Backoff", e);
            if let Some(old) = state.runtime.take() {
                old.destroy();
            }
            state.enter_backoff(token, attempt);
        }
    }
}

/// Guardian: only runs in `Running`. For desktop-attaching modes (A1/A2),
/// checks (a) host window still valid, (b) parent still valid, (c) parent
/// unchanged. For A0 (top-level, no SetParent) we only check the host window
/// itself — there is no desktop parent to monitor, so the parent checks would
/// always mismatch and spuriously trigger recovery.
fn run_guardian(state: &mut HostState, attaches_to_desktop: bool) {
    let (hwnd, expected_parent) = match state.runtime.as_ref() {
        Some(r) => (r.window.hwnd() as isize, r.target.parent),
        None => return,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::IsWindow;

    let host_hwnd = HWND(hwnd as _);
    if !unsafe { IsWindow(Some(host_hwnd)) }.as_bool() {
        request_recovery(state, RecoveryReason::HostWindowInvalid);
        return;
    }
    if !attaches_to_desktop {
        // A0: no desktop parent to monitor. Healthy.
        return;
    }
    if !unsafe { IsWindow(Some(expected_parent)) }.as_bool() {
        request_recovery(state, RecoveryReason::ParentInvalid);
        return;
    }
    let actual_parent = desktop::true_parent(host_hwnd);
    if actual_parent != expected_parent {
        use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;
        let mut cls = [0u16; 64];
        unsafe { GetClassNameW(actual_parent, &mut cls) };
        eprintln!(
            "[guardian] parent changed: expected 0x{:x} got 0x{:x} ({})",
            expected_parent.0 as usize,
            actual_parent.0 as usize,
            String::from_utf16_lossy(&cls)
        );
        request_recovery(state, RecoveryReason::ParentMismatch);
    }
    // Healthy: nothing to log per-tick (status log covers it).
}

/// Transition Running → RecoverQueued and queue the UserEvent. Idempotent:
/// no-op if already recovering.
fn request_recovery(state: &mut HostState, reason: RecoveryReason) {
    if !matches!(state.lifecycle, Lifecycle::Running) {
        return;
    }
    let token = state.alloc_token();
    state.lifecycle = Lifecycle::RecoverQueued {
        token,
        attempt: 0,
        reason,
    };
    println!(
        "[recovery] requested: {} (token={})",
        reason.as_str(),
        token
    );
    if let Err(e) = state
        .proxy
        .send_event(HostEvent::RecoveryRequested { token, reason })
    {
        // EventLoop closed — host is shutting down. Nothing to do.
        eprintln!("[recovery] send_event failed (loop closed?): {:?}", e);
    }
}

/// Filter window events by the active window id. A destroyed previous window
/// can still deliver late events (CloseRequested / Destroyed); we ignore
/// those so they cannot trip the current generation.
fn handle_window_event(
    state: &mut HostState,
    window_id: WindowId,
    event: WindowEvent,
    control_flow: &mut ControlFlow,
) {
    if Some(window_id) != state.current_window_id() {
        // Stale event from a previous-generation window.
        return;
    }
    if let WindowEvent::CloseRequested = event {
        // Host window close = shut down the whole host (user asked us to exit).
        println!("[host] CloseRequested on active window → exit");
        *control_flow = ControlFlow::Exit;
    }
}

/// Compute the next WaitUntil deadline from the current lifecycle + periodic
/// timers. `RecoverQueued` resolves immediately (build on next wake).
fn next_deadline(state: &HostState, now: Instant) -> Instant {
    let mut candidates: Vec<Instant> = Vec::new();
    match state.lifecycle {
        Lifecycle::RecoverQueued { .. } => candidates.push(now),
        Lifecycle::WaitingForPage { timeout_at, .. } => candidates.push(timeout_at),
        Lifecycle::Backoff { retry_at, .. } => candidates.push(retry_at),
        Lifecycle::Running => {
            candidates.push(state.next_guardian_at);
            candidates.push(state.next_status_at);
        }
    }
    candidates
        .into_iter()
        .min()
        .unwrap_or_else(|| now + Duration::from_secs(60))
}

/// Accept the entry URL across wry/WebView2's normalisations. We registered
/// the custom protocol as `wallpaper://`, but WebView2 reports the navigated
/// URL back to the page-load handler as `http://wallpaper.localhost/`
/// (virtual-host form). Accept both shapes so the page-ready signal from the
/// initial navigation is not mistakenly rejected as a URL mismatch.
fn is_entry_url(url: &str) -> bool {
    const ALLOWED: &[&str] = &[
        "wallpaper://localhost",
        "wallpaper://localhost/",
        "http://wallpaper.localhost",
        "http://wallpaper.localhost/",
        "https://wallpaper.localhost",
        "https://wallpaper.localhost/",
    ];
    ALLOWED.iter().any(|a| url == *a)
}

/// Build the host window hidden, with the same options as the pre-recovery
/// implementation (frameless, undecorated-shadow off, primary-screen sized).
fn build_window(
    target: &EventLoopWindowTarget<HostEvent>,
) -> Result<Window, tao::error::OsError> {
    let (screen_w, screen_h) = primary_screen_size();
    WindowBuilder::new()
        .with_title("WallpaperAI")
        .with_decorations(false)
        // tao default: decoration_shadow=true. On a frameless window this draws
        // a ~11px resize/snap border (the source of the (11,2) WRY_WEBVIEW
        // offset). Explicitly disable it.
        .with_undecorated_shadow(false)
        .with_resizable(false)
        .with_minimizable(false)
        .with_maximizable(false)
        .with_fullscreen(None)
        // NO with_parent_window here.
        // NO_REDIRECTION_BITMAP false: ensure a normal redirectable surface.
        .with_no_redirection_bitmap(false)
        .with_skip_taskbar(true)
        // Hidden until attach succeeds — a failing candidate never flashes.
        .with_visible(false)
        .with_inner_size(tao::dpi::PhysicalSize::new(
            screen_w as f64,
            screen_h as f64,
        ))
        .build(target)
}

/// Size the WebView to the host's actual client rect. Used for A0
/// (top-level) where there is no SetParent. Returns Err if the rect is
/// non-positive or set_bounds fails — propagated to the recovery state
/// machine so a failure is treated as an attach failure (Backoff).
fn set_webview_bounds_from_host(hwnd_isize: isize, webview: &WebView) -> anyhow::Result<()> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

    let hwnd = HWND(hwnd_isize as _);
    let mut host_client = windows::Win32::Foundation::RECT::default();
    unsafe {
        GetClientRect(hwnd, &mut host_client)
            .map_err(|e| anyhow::anyhow!("GetClientRect(host) failed: {}", e))?;
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
    webview.set_bounds(Rect {
        position: tao::dpi::PhysicalPosition::new(0.0, 0.0).into(),
        size: tao::dpi::PhysicalSize::new(cw as f64, ch as f64).into(),
    })?;
    println!("[reparent] webview.set_bounds physical {}x{}", cw, ch);
    Ok(())
}

/// A1/A2 reparent: move the top-level window into the desktop target.
///
/// Per Codex review (msg_2zt1fuY §6): `SWP_SHOWWINDOW` is removed — the
/// candidate window is created hidden and only `set_visible(true)` after the
/// full attach + bounds succeed (caller's responsibility). A failure here
/// must not flash a blank window.
fn do_reparent(
    hwnd_isize: isize,
    target: &DesktopTarget,
    mode: Mode,
    webview: &WebView,
) -> anyhow::Result<()> {
    use windows::Win32::Foundation::{GetLastError, SetLastError, HWND};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowLongPtrW, SetParent, SetWindowLongPtrW, SetWindowPos, HWND_BOTTOM,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, WINDOW_LONG_PTR_INDEX, WS_CAPTION, WS_CHILD,
        WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP, WS_SYSMENU,
        WS_THICKFRAME, WS_VISIBLE,
    };
    const GWLP_STYLE_IDX: WINDOW_LONG_PTR_INDEX = WINDOW_LONG_PTR_INDEX(-16);
    const GWLP_EXSTYLE_IDX: WINDOW_LONG_PTR_INDEX = WINDOW_LONG_PTR_INDEX(-20);

    println!("[reparent] mode={:?} starting", mode);
    log_window_state(hwnd_isize, "before reparent");

    let hwnd = HWND(hwnd_isize as _);
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

        // SWP_SHOWWINDOW removed (Codex §6): the candidate is hidden and the
        // caller shows it only after attach + bounds fully succeed.
        SetWindowPos(
            hwnd,
            Some(HWND_BOTTOM),
            0,
            0,
            pw,
            ph,
            SWP_NOACTIVATE | SWP_FRAMECHANGED,
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
        GetClientRect(hwnd, &mut host_client).map_err(|e| {
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
        .set_bounds(Rect {
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

// Allow HostRuntime to hand out a &WebView without moving it out, used by
// on_page_load_finished when calling do_reparent / set_webview_bounds_from_host.
impl HostRuntime {
    fn webview_ref(&self) -> &WebView {
        &self.webview
    }
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
/// SM_CXSCREEN=0, SM_CYSCREEN=1. This is the actual display resolution.
fn primary_screen_size() -> (i32, i32) {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SYSTEM_METRICS_INDEX};
    const SM_CXSCREEN: SYSTEM_METRICS_INDEX = SYSTEM_METRICS_INDEX(0);
    const SM_CYSCREEN: SYSTEM_METRICS_INDEX = SYSTEM_METRICS_INDEX(1);
    let w = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let h = unsafe { GetSystemMetrics(SM_CYSCREEN) };
    (w, h)
}

/// Get the DPI for a window (via Win32 GetDpiForWindow). Falls back to system
/// DPI (96) if the call fails.
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
