import { useEffect, useState } from "react";
import { getTemplate, type TemplateSlot } from "@wallpaper/core/layout";
import { wallpaperHost } from "./wallpaper-host";
import { subscribeSwaps, type SwapMsg } from "./swap-bus";

/**
 * P1 wallpaper stage: renders the canonical `triptych_desktop_equal` template
 * geometry from @wallpaper/core, with placeholder gradient fills per slot.
 *
 * P2.2: when served by wallpaper-host with `--assets`, the stage loads
 * `/manifest.json` (asset pool + slot assignment maintained by the host's
 * control server) and shows real images per slot. Swaps arrive through
 * `window.__wallpaper.applySwap` (see swap-bus.ts) and update exactly one
 * slot's <img>, so only that region repaints — no full-stage re-render.
 * Without a manifest (Electron dev, Octos, A0 without assets) the gradients
 * remain, keeping all diagnostic modes usable.
 *
 * Real Fabric-based rendering (crop math from @wallpaper/core) lands in a
 * later P2 slice; CSS object-fit:center-crop matches the template's aspect
 * handling for now.
 */

const TEMPLATE_ID = "triptych_desktop_equal";

// Distinct gradients per slot role so the triptych is visually obvious.
const ROLE_GRADIENT: Record<string, string> = {
  hero: "linear-gradient(135deg, #1e3a8a, #3b82f6)",
  support: "linear-gradient(135deg, #0f766e, #14b8a6)",
  background: "linear-gradient(135deg, #1f2937, #374151)",
};

interface PlatformInfo {
  name: string;
  embedded: boolean;
  displayCount: number;
}

/** Shape of wallpaper-host's /manifest.json (an empty one is served too). */
interface Manifest {
  assets: { id: string; url: string }[];
  assignment: Record<string, string>;
}

function usePlatformInfo(): PlatformInfo | null {
  const [info, setInfo] = useState<PlatformInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = wallpaperHost;
      const [name, embedded, displays] = await Promise.all([
        api.getPlatformName(),
        api.isEmbedded(),
        api.getDisplays(),
      ]);
      if (!cancelled) {
        setInfo({
          name,
          embedded,
          displayCount: Array.isArray(displays) ? displays.length : 0,
        });
      }
    })().catch((error) => console.error("[renderer] platform info failed:", error));
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}

/**
 * Manifest + swap subscription. urlBySlot maps the template's slot ids to the
 * currently assigned image URL; applySwap updates only the touched slots so
 * React re-renders just those <img> elements.
 */
function useManifest(): { urlBySlot: Record<string, string>; assetCount: number } {
  const [state, setState] = useState<{ urlBySlot: Record<string, string>; assetCount: number }>({
    urlBySlot: {},
    assetCount: 0,
  });

  // Initial load: one fetch against the wallpaper:// origin. On hosts without
  // the custom protocol this 404s/throws and we stay on gradients.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("./manifest.json", { cache: "no-store" });
        if (!res.ok) return;
        const manifest: Manifest = await res.json();
        if (cancelled) return;
        setState({
          urlBySlot: Object.fromEntries(
            Object.entries(manifest.assignment ?? {}).map(([slot, assetId]) => [
              slot,
              (manifest.assets ?? []).find((a) => a.id === assetId)?.url ?? "",
            ]),
          ),
          assetCount: (manifest.assets ?? []).length,
        });
      } catch {
        // Not a wallpaper-host page — fine, gradients stay.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live swaps from the host (single-slot or batched).
  useEffect(
    () =>
      subscribeSwaps((swaps: SwapMsg[]) => {
        setState((prev) => {
          const urlBySlot = { ...prev.urlBySlot };
          for (const swap of swaps) {
            urlBySlot[swap.slot] = swap.url;
          }
          return { ...prev, urlBySlot };
        });
      }),
    [],
  );

  return state;
}

function Slot({ slot, assetUrl }: { slot: TemplateSlot; assetUrl?: string }) {
  // Template geometry is normalized 0..1 of the canvas. The stage fills the
  // window, so we map directly to percentages.
  const style: React.CSSProperties = {
    position: "absolute",
    left: `${slot.x * 100}%`,
    top: `${slot.y * 100}%`,
    width: `${slot.width * 100}%`,
    height: `${slot.height * 100}%`,
    background: ROLE_GRADIENT[slot.role] ?? ROLE_GRADIENT.support,
    borderRadius: slot.shape === "rounded-rect" ? "12px" : "0",
    boxSizing: "border-box",
    transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
    overflow: "hidden",
  };
  return (
    <div style={style} data-slot-id={slot.id} data-role={slot.role}>
      {assetUrl ? (
        <img
          src={assetUrl}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            userSelect: "none",
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "flex-end",
            padding: "24px",
            color: "rgba(255,255,255,0.85)",
            fontFamily: "system-ui, sans-serif",
            fontSize: "18px",
            fontWeight: 600,
            textShadow: "0 1px 4px rgba(0,0,0,0.4)",
          }}
        >
          <span>
            {slot.id} · {slot.role}
          </span>
        </div>
      )}
    </div>
  );
}

export function WallpaperStage() {
  const template = getTemplate(TEMPLATE_ID);
  const info = usePlatformInfo();
  const { urlBySlot, assetCount } = useManifest();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0b1120",
        overflow: "hidden",
      }}
    >
      {template.slots.map((slot) => (
        <Slot key={slot.id} slot={slot} assetUrl={urlBySlot[slot.id]} />
      ))}

      {/* Diagnostics badge — helps confirm the layer/platform on first run.
          Remove or hide behind a flag once stable. */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          background: "rgba(0,0,0,0.55)",
          color: "#e5e7eb",
          padding: "8px 12px",
          borderRadius: 8,
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
          lineHeight: 1.6,
          pointerEvents: "none",
          backdropFilter: "blur(4px)",
        }}
      >
        <div>platform: {info?.name ?? "…"}</div>
        <div>embedded: {info ? String(info.embedded) : "…"}</div>
        <div>displays: {info?.displayCount ?? "…"}</div>
        <div>template: {TEMPLATE_ID}</div>
        <div>assets: {assetCount}</div>
      </div>
    </div>
  );
}
