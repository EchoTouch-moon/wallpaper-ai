//! Desktop topology probe — discovers where to attach the wallpaper window.
//!
//! Three Win11 desktop variants are handled (matching Lively's WinDesktopCore
//! logic, plus the collapsed-desktop edge case observed on Win11 22H2 where
//! 0x052C does NOT spawn a separate paint WorkerW):
//!
//! - **Classic** (Win10 / older Win11): SHELLDLL_DefView lives under Progman,
//!   and a full-screen WorkerW sibling exists as the paint surface.
//!   Attach: parent = that sibling WorkerW.
//!
//! - **Raised** (newer Win11): Progman carries WS_EX_NOREDIRECTIONBITMAP and
//!   hosts a WS_EX_LAYERED SHELLDLL_DefView child. Microsoft's guidance says
//!   the app must create its own WS_EX_LAYERED child HWND of Progman, z-ordered
//!   under DefView. Attach: parent = Progman, insert_after = DefView.
//!
//! - **Collapsed** (Win11 22H2 observed): the only full-screen WorkerW IS the
//!   DefView host itself; no separate paint WorkerW exists. The wallpaper must
//!   attach as a child of that host, z-ordered under DefView.
//!   Attach: parent = DefView host, insert_after = DefView.

use anyhow::{Context, Result};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetAncestor, GetClassNameW, GetWindowLongPtrW,
    GetWindowRect, IsWindowVisible, SendMessageTimeoutW, GA_PARENT, SMTO_NORMAL,
    WINDOW_LONG_PTR_INDEX, WS_EX_NOREDIRECTIONBITMAP,
};

/// WM_SPAWN_WORKERW — undocumented message that directs Progman to spawn a
/// WorkerW behind the desktop icons. wParam=0xD, lParam=0x1 (the values used
/// by both electron-as-wallpaper and Lively; passing 0,0 does not reliably
/// trigger spawn on Win11).
const WM_SPAWN_WORKERW: u32 = 0x052C;

// GWLP_EXSTYLE as a WINDOW_LONG_PTR_INDEX (windows 0.61 uses the typed index
// struct instead of the raw GWLP_EXSTYLE i32 constant).
const GWLP_EXSTYLE: WINDOW_LONG_PTR_INDEX = WINDOW_LONG_PTR_INDEX(-20);

/// Variant of the Windows desktop shell hierarchy we detected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopVariant {
    Classic,
    Raised,
    Collapsed,
}

/// Where the wallpaper window should attach.
#[derive(Debug, Clone, Copy)]
pub struct DesktopTarget {
    pub variant: DesktopVariant,
    /// HWND to create our window as a child of.
    pub parent: HWND,
    /// Z-order anchor: our window goes just below this HWND. None = HWND_BOTTOM.
    pub insert_after: Option<HWND>,
    /// SHELLDLL_DefView HWND (icons container). Used by Raised/Collapsed branches.
    #[allow(dead_code)]
    pub def_view: HWND,
    /// The wallpaper-paint WorkerW, if separate from parent. Used by guardian.
    #[allow(dead_code)]
    pub worker_w: Option<HWND>,
}

/// Snapshot of a WorkerW candidate for selection + diagnostics.
#[derive(Debug, Clone)]
struct WorkerCandidate {
    hwnd: HWND,
    visible: bool,
    area: i64,
    contains_def_view: bool,
}

/// Per-enumeration state passed via LPARAM.
struct EnumState {
    def_view_host: Option<HWND>,
    def_view: Option<HWND>,
    workers: Vec<WorkerCandidate>,
}

/// Probe the desktop and decide where to attach. Sends 0x052C exactly once
/// (idempotent — caller must NOT loop this on every guardian tick).
pub fn probe() -> Result<DesktopTarget> {
    let progman = unsafe { FindWindowW(w!("Progman"), None).context("Progman not found")? };
    println!("[desktop] Progman = {:?}", progman);

    spawn_worker_w(progman)?;

    let progman_ex = unsafe { GetWindowLongPtrW(progman, GWLP_EXSTYLE) } as u32;
    let is_raised = (progman_ex & WS_EX_NOREDIRECTIONBITMAP.0) != 0;
    println!(
        "[desktop] Progman EX=0x{:x} NOREDIR={} raised={}",
        progman_ex, is_raised, is_raised
    );

    let state = enumerate_shell()?;

    let def_view_host = state.def_view_host;
    let def_view = state.def_view;

    if is_raised {
        return select_raised(progman, def_view);
    }
    select_classic_or_collapsed(def_view_host, def_view, state.workers)
}

/// Send WM_SPAWN_WORKERW to Progman. Idempotent.
fn spawn_worker_w(progman: HWND) -> Result<()> {
    let mut result = 0usize;
    let _ = unsafe {
        SendMessageTimeoutW(
            progman,
            WM_SPAWN_WORKERW,
            windows::Win32::Foundation::WPARAM(0xD),
            LPARAM(0x1),
            SMTO_NORMAL,
            1000,
            Some(&mut result),
        )
    };
    Ok(())
}

/// Enumerate all top-level windows, finding DefView host/DefView + WorkerW candidates.
fn enumerate_shell() -> Result<EnumState> {
    let mut state = EnumState {
        def_view_host: None,
        def_view: None,
        workers: Vec::new(),
    };
    unsafe {
        EnumWindows(Some(enum_proc), LPARAM(&mut state as *mut _ as isize))
            .ok()
            .context("EnumWindows failed")?;
    }

    println!(
        "[desktop] DefView host = {:?}, DefView = {:?}, WorkerW count = {}",
        state.def_view_host,
        state.def_view,
        state.workers.len()
    );
    for w in &state.workers {
        println!(
            "[desktop]   WorkerW {:?} visible={} area={}px² def_view_child={}",
            w.hwnd, w.visible, w.area, w.contains_def_view
        );
    }
    Ok(state)
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
    let state = &mut *(lparam.0 as *mut EnumState);
    let class = class_name(hwnd);

    if let Ok(dv) = FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), None) {
        if dv != HWND::default() {
            state.def_view_host = Some(hwnd);
            state.def_view = Some(dv);
        }
    }

    if class == "WorkerW" {
        let visible = IsWindowVisible(hwnd).as_bool();
        let area = window_area(hwnd);
        let contains_def_view = match FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), None)
        {
            Ok(h) => h != HWND::default(),
            Err(_) => false,
        };
        state.workers.push(WorkerCandidate {
            hwnd,
            visible,
            area,
            contains_def_view,
        });
    }

    windows::core::BOOL(1)
}

/// Read a window's class name (up to 256 wchars).
fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

/// Compute on-screen area in px² (0 if rect invalid).
fn window_area(hwnd: HWND) -> i64 {
    let mut rect = RECT::default();
    let ok = unsafe { GetWindowRect(hwnd, &mut rect) };
    if ok.is_err() {
        return 0;
    }
    let w = (rect.right - rect.left) as i64;
    let h = (rect.bottom - rect.top) as i64;
    if w > 0 && h > 0 {
        w * h
    } else {
        0
    }
}

/// Raised-desktop branch: attach as WS_EX_LAYERED child of Progman.
fn select_raised(progman: HWND, def_view: Option<HWND>) -> Result<DesktopTarget> {
    let dv = def_view.context("Raised desktop but SHELLDLL_DefView not found")?;
    Ok(DesktopTarget {
        variant: DesktopVariant::Raised,
        parent: progman,
        insert_after: Some(dv),
        def_view: dv,
        worker_w: None,
    })
}

/// Classic or collapsed: pick based on whether a real full-screen sibling exists.
fn select_classic_or_collapsed(
    def_view_host: Option<HWND>,
    def_view: Option<HWND>,
    workers: Vec<WorkerCandidate>,
) -> Result<DesktopTarget> {
    let host = def_view_host.context("DefView host not found")?;
    let dv = def_view.context("SHELLDLL_DefView not found")?;

    let sibling = workers
        .iter()
        .find(|w| w.hwnd != host && w.visible && w.area > 1_000_000 && !w.contains_def_view);

    if let Some(w) = sibling {
        println!(
            "[desktop] Classic: full-screen WorkerW sibling {:?} (area={})",
            w.hwnd, w.area
        );
        return Ok(DesktopTarget {
            variant: DesktopVariant::Classic,
            parent: w.hwnd,
            insert_after: None,
            def_view: dv,
            worker_w: Some(w.hwnd),
        });
    }

    let host_area = window_area(host);
    println!(
        "[desktop] Collapsed: DefView host {:?} (area={}) is the wallpaper target",
        host, host_area
    );
    Ok(DesktopTarget {
        variant: DesktopVariant::Collapsed,
        parent: host,
        insert_after: Some(dv),
        def_view: dv,
        worker_w: None,
    })
}

/// Read the true parent of a window via GetAncestor(GA_PARENT). Unlike
/// GetParent, this returns the actual parent regardless of WS_POPUP style.
pub fn true_parent(hwnd: HWND) -> HWND {
    unsafe { GetAncestor(hwnd, GA_PARENT) }
}
