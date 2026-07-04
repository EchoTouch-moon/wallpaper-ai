import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WallpaperStage } from "./WallpaperStage";
import "./global.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("renderer root element #root not found");
}

// Signal that React mounted. If the diagnostic boot badge stays visible,
// React never mounted (script error / module load failure). If it disappears
// but triptych doesn't show, the issue is inside WallpaperStage.
const badge = document.getElementById("boot-badge");
if (badge) {
  badge.textContent = "React mounted, rendering triptych…";
}

createRoot(container).render(
  <StrictMode>
    <WallpaperStage />
  </StrictMode>,
);

// Remove the badge after first paint so it doesn't overlap the triptych.
requestAnimationFrame(() => {
  badge?.remove();
});
