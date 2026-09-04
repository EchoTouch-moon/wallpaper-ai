/**
 * P2.2 swap bridge — how wallpaper-host.exe pushes slot changes into this
 * renderer.
 *
 * The host evaluates `window.__wallpaper.applySwap([...])` in the page. The
 * global is installed in module scope (before React mounts) with a pending
 * queue so a swap arriving during boot is never lost: early messages queue,
 * and `subscribeSwaps` drains the backlog when the stage mounts.
 *
 * Electron/Octos hosts never set `window.__wallpaper`; they keep using the
 * preload bridge (`window.wallpaper`), so this module is inert there.
 */

export interface SwapMsg {
  slot: string;
  url: string;
}

interface WallpaperGlobal {
  applySwap(swaps: SwapMsg[]): void;
}

declare global {
  interface Window {
    __wallpaper?: WallpaperGlobal;
  }
}

const pending: SwapMsg[] = [];
let deliver: ((swaps: SwapMsg[]) => void) | null = null;

if (!window.__wallpaper) {
  window.__wallpaper = {
    applySwap(swaps) {
      if (deliver) {
        deliver(swaps);
      } else {
        pending.push(...swaps);
      }
    },
  };
}

/**
 * Install the live handler and replay anything that arrived before mount.
 * Returns an unsubscribe fn for useEffect cleanup. The host batches a whole
 * /swap into one applySwap call, so updates land in a single React setState.
 */
export function subscribeSwaps(handler: (swaps: SwapMsg[]) => void): () => void {
  deliver = handler;
  const backlog = pending.splice(0);
  if (backlog.length > 0) {
    handler(backlog);
  }
  return () => {
    if (deliver === handler) {
      deliver = null;
    }
  };
}
