import type { RefObject } from "react";

import { polygonPath, starPath } from "./geometry";

export type ShapeName =
  | "circle"
  | "triangle"
  | "square"
  | "pentagon"
  | "star"
  | "octagon";

export type ShapeDefinition = {
  name: ShapeName;
  path: string;
  cutAngles: readonly number[];
};

export type Viewport = {
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

export type RayMotion = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  rotation: number;
};

export type PanelMotion = {
  clipPath: string;
  x: number;
  y: number;
};

export type InteractionState = "intro" | "idle" | "hover" | "opening" | "complete";

export type OneTouchIntroProps = {
  contentRef: RefObject<HTMLDivElement | null>;
  onRevealStart: () => void;
  onComplete: () => void;
};

export const MAX_CUT_COUNT = 8;
export const ZERO_PATH = "M 0 0 L 0 0";
export const COMET_PATH =
  "M 0 0 C -4 -1.2 -10 -1.72 -20 -1.58 C -43 -1.2 -76 -0.35 -94 0 C -76 0.35 -43 1.2 -20 1.58 C -10 1.72 -4 1.2 0 0 Z";

export const ONE_TOUCH_CONFIG = {
  colors: {
    background: "#050505",
    silver: "#F4F4F4",
    mutedSilver: "rgba(232, 232, 232, 0.42)",
  },
  geometrySize: 126,
  timing: {
    initialHold: 1,
    rayConverge: 5,
    cutRevealStart: 4.18,
    cutReveal: 0.72,
    impactHold: 0.5,
    morph: 0.56,
    postMorphHold: 1,
    hoverIntent: 0.12,
    hoverIn: 0.3,
    hoverRayIn: 5,
    hoverRayOut: 3.6,
    hoverRepeatGap: 0.28,
    resumeDelay: 0,
  },
  durations: {
    intro: 1,
    settle: 0.24,
    impact: 0.16,
    extendCuts: 0.36,
    openPanels: 0.72,
    reveal: 0.64,
  },
  shapes: [
    {
      name: "octagon",
      path: polygonPath(8, 35, -67.5),
      cutAngles: [-67.5, -22.5, 22.5, 67.5, 112.5, 157.5, 202.5, 247.5],
    },
    {
      name: "circle",
      path:
        "M 50 14 C 69.882 14 86 30.118 86 50 C 86 69.882 69.882 86 50 86 C 30.118 86 14 69.882 14 50 C 14 30.118 30.118 14 50 14 Z",
      cutAngles: [-28, 152],
    },
    {
      name: "triangle",
      path: polygonPath(3, 38, -90),
      cutAngles: [-90, 30, 150],
    },
    {
      name: "square",
      path: polygonPath(4, 34, -45),
      cutAngles: [-45, 45, 135, 225],
    },
    {
      name: "pentagon",
      path: polygonPath(5, 37, -90),
      cutAngles: [-90, -18, 54, 126, 198],
    },
    {
      name: "star",
      path: starPath(5, 38, 17),
      cutAngles: [-90, -18, 54, 126, 198],
    },
  ] satisfies ShapeDefinition[],
} as const;
