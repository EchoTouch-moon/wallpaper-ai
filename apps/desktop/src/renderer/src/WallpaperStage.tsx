import { useEffect, useState } from "react";
import { getTemplate, type TemplateSlot } from "@wallpaper/core/layout";

/**
 * P1 wallpaper stage: renders the canonical `triptych_desktop_equal` template
 * geometry from @wallpaper/core, with placeholder gradient fills per slot.
 *
 * No real image assets in P1 — the point is to prove:
 *   1. the wallpaper renderer boots inside Electron,
 *   2. it consumes @wallpaper/core's real template geometry,
 *   3. on Windows it sits behind desktop icons (WorkerW), on Mac (mock) it
 *      shows as a normal window so the layout can be verified.
 *
 * Real image rendering (Fabric) and per-slot swap land in P2.
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

function usePlatformInfo(): PlatformInfo | null {
  const [info, setInfo] = useState<PlatformInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = window.wallpaper;
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

function Slot({ slot }: { slot: TemplateSlot }) {
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
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "flex-start",
    padding: "24px",
    overflow: "hidden",
    color: "rgba(255,255,255,0.85)",
    fontFamily: "system-ui, sans-serif",
    fontSize: "18px",
    fontWeight: 600,
    textShadow: "0 1px 4px rgba(0,0,0,0.4)",
  };
  return (
    <div style={style} data-slot-id={slot.id} data-role={slot.role}>
      <span>
        {slot.id} · {slot.role}
      </span>
    </div>
  );
}

export function WallpaperStage() {
  const template = getTemplate(TEMPLATE_ID);
  const info = usePlatformInfo();

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
        <Slot key={slot.id} slot={slot} />
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
      </div>
    </div>
  );
}
