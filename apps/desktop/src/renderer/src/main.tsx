import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WallpaperStage } from "./WallpaperStage";
import "./global.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("renderer root element #root not found");
}
createRoot(container).render(
  <StrictMode>
    <WallpaperStage />
  </StrictMode>,
);
