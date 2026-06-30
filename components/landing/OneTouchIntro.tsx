"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import styles from "./OneTouchIntro.module.css";

gsap.registerPlugin(useGSAP, DrawSVGPlugin, MorphSVGPlugin);

type ShapeName =
  | "circle"
  | "triangle"
  | "square"
  | "pentagon"
  | "star"
  | "octagon";

type ShapeDefinition = {
  name: ShapeName;
  path: string;
  cutAngles: readonly number[];
};

type Viewport = {
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

type RayMotion = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  rotation: number;
};

type PanelMotion = {
  clipPath: string;
  x: number;
  y: number;
};

type InteractionState = "intro" | "idle" | "hover" | "opening" | "complete";

type OneTouchIntroProps = {
  contentRef: RefObject<HTMLDivElement | null>;
  onRevealStart: () => void;
  onComplete: () => void;
};

const MAX_CUT_COUNT = 8;
const ZERO_PATH = "M 0 0 L 0 0";
const COMET_PATH =
  "M 0 0 C -4 -1.2 -10 -1.72 -20 -1.58 C -43 -1.2 -76 -0.35 -94 0 C -76 0.35 -43 1.2 -20 1.58 C -10 1.72 -4 1.2 0 0 Z";

const polygonPath = (sides: number, radius: number, rotation = -90) => {
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = ((rotation + (360 / sides) * index) * Math.PI) / 180;
    return [
      50 + Math.cos(angle) * radius,
      50 + Math.sin(angle) * radius,
    ];
  });

  return `${points
    .map(
      ([x, y], index) =>
        `${index === 0 ? "M" : "L"} ${x.toFixed(3)} ${y.toFixed(3)}`,
    )
    .join(" ")} Z`;
};

const starPath = (points: number, outerRadius: number, innerRadius: number) => {
  const vertices = Array.from({ length: points * 2 }, (_, index) => {
    const angle = ((-90 + (360 / (points * 2)) * index) * Math.PI) / 180;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    return [
      50 + Math.cos(angle) * radius,
      50 + Math.sin(angle) * radius,
    ];
  });

  return `${vertices
    .map(
      ([x, y], index) =>
        `${index === 0 ? "M" : "L"} ${x.toFixed(3)} ${y.toFixed(3)}`,
    )
    .join(" ")} Z`;
};

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

const getViewportEdgePoint = (
  viewport: Viewport,
  angle: number,
  center: Point,
) => {
  const centerX = center.x;
  const centerY = center.y;
  const radians = (angle * Math.PI) / 180;
  const directionX = Math.cos(radians);
  const directionY = Math.sin(radians);
  const distances: number[] = [];

  if (Math.abs(directionX) > 0.0001) {
    const edgeX = directionX > 0 ? viewport.width + 4 : -4;
    const distanceX = (edgeX - centerX) / directionX;
    if (distanceX > 0) {
      distances.push(distanceX);
    }
  }

  if (Math.abs(directionY) > 0.0001) {
    const edgeY = directionY > 0 ? viewport.height + 4 : -4;
    const distanceY = (edgeY - centerY) / directionY;
    if (distanceY > 0) {
      distances.push(distanceY);
    }
  }

  const distance = Math.min(...distances);
  return {
    x: centerX + directionX * distance,
    y: centerY + directionY * distance,
  };
};

const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;

const getPanelMotions = (
  viewport: Viewport,
  angles: readonly number[],
  center: Point,
): PanelMotion[] => {
  const centerX = center.x;
  const centerY = center.y;
  const radius = Math.hypot(viewport.width, viewport.height) * 1.6;
  const sortedAngles = [...angles].map(normalizeAngle).sort((a, b) => a - b);

  return sortedAngles.map((startAngle, index) => {
    let endAngle = sortedAngles[(index + 1) % sortedAngles.length];
    if (endAngle <= startAngle) {
      endAngle += 360;
    }

    const sweep = endAngle - startAngle;
    const pointCount = Math.max(2, Math.ceil(sweep / 24));
    const arcPoints = Array.from({ length: pointCount + 1 }, (_, pointIndex) => {
      const angle =
        startAngle + (sweep * pointIndex) / Math.max(1, pointCount);
      const radians = (angle * Math.PI) / 180;
      return `${(centerX + Math.cos(radians) * radius).toFixed(2)}px ${(centerY + Math.sin(radians) * radius).toFixed(2)}px`;
    });
    const middleRadians = ((startAngle + sweep / 2) * Math.PI) / 180;

    return {
      clipPath: `polygon(${centerX.toFixed(2)}px ${centerY.toFixed(2)}px, ${arcPoints.join(", ")})`,
      x: Math.cos(middleRadians),
      y: Math.sin(middleRadians),
    };
  });
};

const getInnerCutPath = (angle: number) => {
  const radians = (angle * Math.PI) / 180;
  const x = 50 + Math.cos(radians) * 48;
  const y = 50 + Math.sin(radians) * 48;
  return `M 50 50 L ${x.toFixed(3)} ${y.toFixed(3)}`;
};

export function OneTouchIntro({
  contentRef,
  onRevealStart,
  onComplete,
}: OneTouchIntroProps) {
  const rootRef = useRef<HTMLElement>(null);
  const geometryRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const outlineRef = useRef<SVGPathElement>(null);
  const clipShapeRef = useRef<SVGPathElement>(null);
  const morphTargetPathRef = useRef<SVGPathElement>(null);
  const pulseRef = useRef<SVGCircleElement>(null);
  const masterTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const timelineDriverRef = useRef<gsap.core.Tween | null>(null);
  const hoverBounceRef = useRef<gsap.core.Timeline | null>(null);
  const hoverTweenRefs = useRef<gsap.core.Tween[]>([]);
  const idleTimerRef = useRef<number | null>(null);
  const hoverIntentTimerRef = useRef<number | null>(null);
  const stateRef = useRef<InteractionState>("intro");
  const shapeIndexRef = useRef(0);
  const pendingShapeIndexRef = useRef(0);
  const morphTargetRef = useRef<string>(ONE_TOUCH_CONFIG.shapes[0].path);
  const isMorphingRef = useRef(false);
  const isFocusedRef = useRef(false);
  const resumeStableCycleRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const viewportRef = useRef<Viewport>({ width: 1440, height: 900 });
  const rayElementsRef = useRef<SVGGElement[]>([]);
  const viewportCutElementsRef = useRef<SVGPathElement[]>([]);
  const innerCutElementsRef = useRef<SVGPathElement[]>([]);
  const hoverTracerElementsRef = useRef<SVGPathElement[]>([]);
  const rayMotionsRef = useRef<RayMotion[]>([]);
  const panelMotionsRef = useRef<PanelMotion[]>([]);
  const activeCutCountRef = useRef(
    ONE_TOUCH_CONFIG.shapes[0].cutAngles.length,
  );
  const updatePatternRef = useRef<() => void>(() => undefined);
  const scheduleIdleRef = useRef<(delay?: number) => void>(() => undefined);
  const startHoverBounceRef = useRef<() => void>(() => undefined);
  const [viewport, setViewport] = useState<Viewport>({
    width: 1440,
    height: 900,
  });

  useEffect(() => {
    let frame = 0;

    const updateViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nextViewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        viewportRef.current = nextViewport;
        setViewport(nextViewport);
        updatePatternRef.current();
      });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  const { contextSafe } = useGSAP(
    () => {
      const root = rootRef.current;
      const geometry = geometryRef.current;
      const button = buttonRef.current;
      const outline = outlineRef.current;
      const clipShape = clipShapeRef.current;
      const morphTargetPath = morphTargetPathRef.current;
      const pulse = pulseRef.current;
      const content = contentRef.current;

      if (
        !root ||
        !geometry ||
        !button ||
        !outline ||
        !clipShape ||
        !morphTargetPath ||
        !pulse ||
        !content
      ) {
        return;
      }

      const rays = gsap.utils.toArray<SVGGElement>(
        `.${styles.ray}`,
        root,
      );
      const viewportCuts = gsap.utils.toArray<SVGPathElement>(
        `.${styles.viewportCut}`,
        root,
      );
      const innerCuts = gsap.utils.toArray<SVGPathElement>(
        `.${styles.innerCut}`,
        root,
      );
      const hoverTracers = gsap.utils.toArray<SVGPathElement>(
        `.${styles.hoverTracer}`,
        root,
      );
      const panels = gsap.utils.toArray<HTMLDivElement>(
        `.${styles.panel}`,
        root,
      );
      const prompt = gsap.utils.toArray<HTMLElement>(
        `.${styles.prompt}`,
        root,
      );
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      rayElementsRef.current = rays;
      viewportCutElementsRef.current = viewportCuts;
      innerCutElementsRef.current = innerCuts;
      hoverTracerElementsRef.current = hoverTracers;
      reducedMotionRef.current = reduceMotion;

      const clearIdleTimer = () => {
        if (idleTimerRef.current !== null) {
          window.clearTimeout(idleTimerRef.current);
          idleTimerRef.current = null;
        }
      };

      const updateCutPattern = () => {
        const shape = ONE_TOUCH_CONFIG.shapes[shapeIndexRef.current];
        const currentViewport = viewportRef.current;
        const buttonBounds = button.getBoundingClientRect();
        const center = {
          x: buttonBounds.left + buttonBounds.width / 2,
          y: buttonBounds.top + buttonBounds.height / 2,
        };
        const centerX = center.x;
        const centerY = center.y;
        const panelMotions = getPanelMotions(
          currentViewport,
          shape.cutAngles,
          center,
        );

        activeCutCountRef.current = shape.cutAngles.length;
        panelMotionsRef.current = panelMotions;
        panels.forEach((panel, index) => {
          const motion = panelMotions[index];
          panel.style.clipPath =
            motion?.clipPath ?? "polygon(50% 50%, 50% 50%, 50% 50%)";
          panel.style.visibility = motion ? "visible" : "hidden";
        });

        for (let index = 0; index < MAX_CUT_COUNT; index += 1) {
          const angle = shape.cutAngles[index];
          const viewportCut = viewportCuts[index];
          const innerCut = innerCuts[index];
          const hoverTracer = hoverTracers[index];

          if (angle === undefined) {
            rayMotionsRef.current[index] = {
              startX: centerX,
              startY: centerY,
              endX: centerX,
              endY: centerY,
              rotation: 0,
            };
            viewportCut?.setAttribute(
              "d",
              `M ${centerX} ${centerY} L ${centerX} ${centerY}`,
            );
            innerCut?.setAttribute("d", "M 50 50 L 50 50");
            hoverTracer?.setAttribute("d", "M 50 50 L 50 50");
            continue;
          }

          const edge = getViewportEdgePoint(currentViewport, angle, center);
          const innerPath = getInnerCutPath(angle);
          rayMotionsRef.current[index] = {
            startX: edge.x,
            startY: edge.y,
            endX: centerX,
            endY: centerY,
            rotation:
              (Math.atan2(centerY - edge.y, centerX - edge.x) * 180) /
              Math.PI,
          };
          viewportCut?.setAttribute(
            "d",
            `M ${centerX.toFixed(2)} ${centerY.toFixed(2)} L ${edge.x.toFixed(2)} ${edge.y.toFixed(2)}`,
          );
          innerCut?.setAttribute("d", innerPath);
          hoverTracer?.setAttribute("d", innerPath);
        }
      };
      updatePatternRef.current = updateCutPattern;
      updateCutPattern();

      const master = gsap.timeline({
        paused: true,
        defaults: { ease: "power3.inOut" },
      });
      masterTimelineRef.current = master;

      gsap.set(root, { autoAlpha: 1 });
      gsap.set(content, {
        autoAlpha: 0,
        scale: 0.992,
        filter: reduceMotion ? "blur(0px)" : "blur(6px)",
      });
      gsap.set(geometry, { transformOrigin: "50% 50%" });
      gsap.set(outline, { drawSVG: "0% 0%" });
      gsap.set(innerCuts, { drawSVG: "0% 0%", autoAlpha: 0 });
      gsap.set(hoverTracers, { drawSVG: "0% 2.5%", autoAlpha: 0 });
      gsap.set(viewportCuts, { drawSVG: "0% 0%", autoAlpha: 0 });
      gsap.set(rays, {
        autoAlpha: 0,
        svgOrigin: "0 0",
        x: (index) => rayMotionsRef.current[index]?.startX ?? 0,
        y: (index) => rayMotionsRef.current[index]?.startY ?? 0,
        rotation: (index) => rayMotionsRef.current[index]?.rotation ?? 0,
      });
      gsap.set(pulse, { scale: 0.75, autoAlpha: 0, svgOrigin: "50 50" });
      gsap.set(panels, {
        x: 0,
        y: 0,
        scale: 1,
        autoAlpha: (index) =>
          index < activeCutCountRef.current ? 1 : 0,
      });

      master.addLabel("intro", 0);
      master.fromTo(
        geometry,
        { scale: 0.9, autoAlpha: 0 },
        {
          scale: 1,
          autoAlpha: 1,
          duration: reduceMotion ? 0.28 : 0.64,
          ease: "power3.out",
        },
        "intro+=0.08",
      );
      master.to(
        outline,
        {
          drawSVG: "0% 100%",
          duration: reduceMotion ? 0.22 : 0.46,
          ease: "power2.inOut",
        },
        "intro+=0.28",
      );
      master.fromTo(
        prompt,
        { y: 4, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: reduceMotion ? 0.18 : 0.34,
          stagger: 0.04,
          ease: "power2.out",
        },
        "intro+=0.48",
      );

      master.addLabel(
        "idleConverge",
        reduceMotion ? 0.58 : ONE_TOUCH_CONFIG.durations.intro,
      );
      master.set(
        rays,
        {
          x: (index) => rayMotionsRef.current[index]?.startX ?? 0,
          y: (index) => rayMotionsRef.current[index]?.startY ?? 0,
          rotation: (index) => rayMotionsRef.current[index]?.rotation ?? 0,
          scaleX: 0.78,
        },
        "idleConverge",
      );
      master.set(
        innerCuts,
        { drawSVG: "0% 0%", autoAlpha: 0, strokeWidth: 0.72 },
        "idleConverge",
      );
      master.fromTo(
        rays,
        {
          x: (index) => rayMotionsRef.current[index]?.startX ?? 0,
          y: (index) => rayMotionsRef.current[index]?.startY ?? 0,
          rotation: (index) => rayMotionsRef.current[index]?.rotation ?? 0,
          autoAlpha: (index) =>
            index < activeCutCountRef.current ? 0.34 : 0,
          scaleX: 0.78,
        },
        {
          x: (index) => rayMotionsRef.current[index]?.endX ?? 0,
          y: (index) => rayMotionsRef.current[index]?.endY ?? 0,
          rotation: (index) => rayMotionsRef.current[index]?.rotation ?? 0,
          autoAlpha: (index) =>
            index < activeCutCountRef.current ? 1 : 0,
          scaleX: 1,
          duration: reduceMotion ? 0 : ONE_TOUCH_CONFIG.timing.rayConverge,
          ease: "power1.inOut",
          immediateRender: false,
        },
        "idleConverge",
      );
      master.to(
        innerCuts,
        {
          drawSVG: "0% 100%",
          autoAlpha: 0.9,
          duration: reduceMotion ? 0 : ONE_TOUCH_CONFIG.timing.cutReveal,
          ease: "power2.inOut",
        },
        `idleConverge+=${ONE_TOUCH_CONFIG.timing.cutRevealStart}`,
      );
      master.to(
        rays,
        {
          autoAlpha: 0,
          duration: reduceMotion ? 0 : 0.2,
          ease: "power2.out",
        },
        `idleConverge+=${ONE_TOUCH_CONFIG.timing.rayConverge - 0.04}`,
      );
      master.fromTo(
        pulse,
        { scale: 0.86, autoAlpha: 0 },
        {
          scale: 1.16,
          autoAlpha: reduceMotion ? 0 : 0.42,
          duration: ONE_TOUCH_CONFIG.durations.settle,
          ease: "power2.out",
        },
        `idleConverge+=${ONE_TOUCH_CONFIG.timing.rayConverge - 0.05}`,
      );
      master.to(
        pulse,
        {
          scale: 1.34,
          autoAlpha: 0,
          duration: ONE_TOUCH_CONFIG.durations.settle,
          ease: "power2.out",
        },
        ">-=0.08",
      );

      master.addLabel(
        "idleMorph",
        `idleConverge+=${
          ONE_TOUCH_CONFIG.timing.rayConverge +
          ONE_TOUCH_CONFIG.timing.impactHold
        }`,
      );
      master.to(
        innerCuts,
        {
          drawSVG: "50% 50%",
          autoAlpha: 0,
          duration: reduceMotion ? 0 : 0.16,
          ease: "power2.in",
        },
        "idleMorph",
      );
      master.to(
        [outline, clipShape],
        {
          morphSVG: {
            shape: morphTargetPath,
            type: "rotational",
            map: "position",
          },
          duration: reduceMotion ? 0 : ONE_TOUCH_CONFIG.timing.morph,
          ease: "power3.inOut",
          onStart: () => {
            isMorphingRef.current = true;
          },
          onComplete: () => {
            isMorphingRef.current = false;
            shapeIndexRef.current = pendingShapeIndexRef.current;
            updateCutPattern();
            gsap.set(innerCuts, { drawSVG: "0% 0%", autoAlpha: 0 });
          },
        },
        "idleMorph",
      );

      master.addLabel(
        "hoverPreview",
        `idleMorph+=${
          ONE_TOUCH_CONFIG.timing.morph +
          ONE_TOUCH_CONFIG.timing.postMorphHold
        }`,
      );
      master.to(
        outline,
        {
          strokeWidth: 1.5,
          filter: "drop-shadow(0 0 4px rgba(244,244,244,0.48))",
          duration: reduceMotion ? 0.18 : ONE_TOUCH_CONFIG.timing.hoverIn,
          ease: "power2.out",
        },
        "hoverPreview",
      );
      master.to(
        innerCuts,
        {
          drawSVG: "0% 100%",
          autoAlpha: 0.24,
          duration: reduceMotion ? 0.18 : ONE_TOUCH_CONFIG.timing.hoverIn,
          ease: "power2.out",
        },
        "hoverPreview",
      );

      master.addLabel(
        "hoverLocked",
        `hoverPreview+=${reduceMotion ? 0.2 : ONE_TOUCH_CONFIG.timing.hoverIn + 0.04}`,
      );
      master.addLabel("touchImpact", "hoverLocked+=0.04");
      master.set(button, { pointerEvents: "none" }, "touchImpact");
      master.to(
        geometry,
        {
          scale: 0.94,
          duration: reduceMotion ? 0.08 : 0.1,
          ease: "power3.in",
        },
        "touchImpact",
      );
      master.to(
        geometry,
        {
          scale: 1,
          duration: reduceMotion ? 0.12 : ONE_TOUCH_CONFIG.durations.impact,
          ease: "power4.out",
        },
        ">",
      );
      master.to(
        innerCuts,
        {
          autoAlpha: 1,
          strokeWidth: 1.1,
          drawSVG: "0% 100%",
          duration: ONE_TOUCH_CONFIG.durations.impact,
          ease: "power2.out",
        },
        "touchImpact",
      );
      master.fromTo(
        pulse,
        { scale: 0.72, autoAlpha: 0.82 },
        {
          scale: reduceMotion ? 1.16 : 1.72,
          autoAlpha: 0,
          duration: reduceMotion ? 0.22 : 0.36,
          ease: "power3.out",
        },
        "touchImpact",
      );

      master.addLabel(
        "extendCuts",
        `touchImpact+=${reduceMotion ? 0.12 : 0.15}`,
      );
      master.to(
        viewportCuts,
        {
          drawSVG: "0% 100%",
          autoAlpha: reduceMotion ? 0.48 : 0.95,
          duration: reduceMotion
            ? 0.18
            : ONE_TOUCH_CONFIG.durations.extendCuts,
          ease: "power4.in",
        },
        "extendCuts",
      );

      master.addLabel(
        "openPanels",
        `extendCuts+=${reduceMotion ? 0.16 : 0.24}`,
      );
      if (reduceMotion) {
        master.to(
          root,
          {
            autoAlpha: 0,
            duration: 0.32,
            ease: "power2.out",
          },
          "openPanels",
        );
      } else {
        master.set(root, { backgroundColor: "rgba(5,5,5,0)" }, "openPanels");
        master.to(
          panels,
          {
            x: (index) => {
              const panel = panelMotionsRef.current[index];
              return panel
                ? panel.x *
                    Math.hypot(
                      viewportRef.current.width,
                      viewportRef.current.height,
                    ) *
                    1.15
                : 0;
            },
            y: (index) => {
              const panel = panelMotionsRef.current[index];
              return panel
                ? panel.y *
                    Math.hypot(
                      viewportRef.current.width,
                      viewportRef.current.height,
                    ) *
                    1.15
                : 0;
            },
            scale: 1.018,
            duration: ONE_TOUCH_CONFIG.durations.openPanels,
            stagger: { amount: 0.035, from: "center" },
            ease: "power4.inOut",
          },
          "openPanels",
        );
        master.to(
          [geometry, prompt],
          {
            autoAlpha: 0,
            duration: 0.18,
            ease: "power2.out",
          },
          "openPanels",
        );
        master.to(
          viewportCuts,
          {
            autoAlpha: 0,
            duration: 0.28,
            ease: "power2.out",
          },
          "openPanels+=0.34",
        );
      }

      master.addLabel(
        "revealContent",
        `openPanels+=${reduceMotion ? 0.04 : 0.12}`,
      );
      master.call(onRevealStart, undefined, "revealContent");
      master.to(
        content,
        {
          autoAlpha: 1,
          scale: 1,
          filter: "blur(0px)",
          duration: reduceMotion ? 0.3 : ONE_TOUCH_CONFIG.durations.reveal,
          ease: "power3.out",
        },
        "revealContent",
      );
      master.addLabel("complete", ">");

      const runIdleCycle = () => {
        // Direction ①: the converge loop must keep running in BOTH idle and
        // hover — hover no longer takes over the rays, so if we stopped looping
        // on hover the rays would freeze in the faded hoverPreview state and
        // look like they "vanished". Only opening/complete/intro halt it.
        if (
          (stateRef.current !== "idle" &&
            stateRef.current !== "hover") ||
          reduceMotion
        ) {
          return;
        }

        timelineDriverRef.current?.kill();
        master.seek("idleConverge", true);
        isMorphingRef.current = false;

        const stableShape = ONE_TOUCH_CONFIG.shapes[shapeIndexRef.current];
        outline.setAttribute("d", stableShape.path);
        clipShape.setAttribute("d", stableShape.path);
        updateCutPattern();

        const shouldHoldCurrentShape = resumeStableCycleRef.current;
        resumeStableCycleRef.current = false;
        const nextIndex = shouldHoldCurrentShape
          ? shapeIndexRef.current
          : (shapeIndexRef.current + 1) % ONE_TOUCH_CONFIG.shapes.length;
        pendingShapeIndexRef.current = nextIndex;
        morphTargetRef.current = ONE_TOUCH_CONFIG.shapes[nextIndex].path;
        morphTargetPath.setAttribute("d", morphTargetRef.current);
        master.invalidate();
        outline.setAttribute("d", stableShape.path);
        clipShape.setAttribute("d", stableShape.path);
        gsap.set(rays, {
          x: (index) => rayMotionsRef.current[index]?.startX ?? 0,
          y: (index) => rayMotionsRef.current[index]?.startY ?? 0,
          rotation: (index) => rayMotionsRef.current[index]?.rotation ?? 0,
          scaleX: 0.78,
          autoAlpha: (index) =>
            index < activeCutCountRef.current ? 0.34 : 0,
        });
        timelineDriverRef.current = master.tweenFromTo(
          "idleConverge",
          "hoverPreview",
          {
            ease: "none",
            onComplete: () => {
              if (
                stateRef.current === "idle" ||
                stateRef.current === "hover"
              ) {
                runIdleCycle();
              }
            },
          },
        );
      };

      const scheduleIdle = (
        delay: number = ONE_TOUCH_CONFIG.timing.initialHold,
      ) => {
        clearIdleTimer();
        if (stateRef.current !== "idle" || reduceMotion) {
          return;
        }
        idleTimerRef.current = window.setTimeout(
          runIdleCycle,
          Math.max(0, delay * 1000),
        );
      };
      scheduleIdleRef.current = scheduleIdle;

      const startHoverBounce = () => {
        hoverBounceRef.current?.kill();
        if (reduceMotion || stateRef.current !== "hover") {
          return;
        }

        const bounce = gsap.timeline({
          repeat: -1,
          repeatDelay: ONE_TOUCH_CONFIG.timing.hoverRepeatGap,
          defaults: { ease: "power2.inOut" },
        });
        hoverBounceRef.current = bounce;

        bounce.set(rays, {
          x: (index) => rayMotionsRef.current[index]?.startX ?? 0,
          y: (index) => rayMotionsRef.current[index]?.startY ?? 0,
          rotation: (index) => rayMotionsRef.current[index]?.rotation ?? 0,
          scaleX: 0.78,
        });
        bounce.set(hoverTracers, { drawSVG: "0% 2.5%", autoAlpha: 0 });
        bounce.fromTo(
          rays,
          {
            x: (index) => rayMotionsRef.current[index]?.startX ?? 0,
            y: (index) => rayMotionsRef.current[index]?.startY ?? 0,
            autoAlpha: (index) =>
              index < activeCutCountRef.current ? 0.34 : 0,
            scaleX: 0.78,
          },
          {
            x: (index) => rayMotionsRef.current[index]?.endX ?? 0,
            y: (index) => rayMotionsRef.current[index]?.endY ?? 0,
            autoAlpha: (index) =>
              index < activeCutCountRef.current ? 1 : 0,
            scaleX: 1,
            duration: ONE_TOUCH_CONFIG.timing.hoverRayIn,
            ease: "power1.inOut",
            immediateRender: false,
          },
        );
        bounce.to(
          rays,
          {
            autoAlpha: 0,
            duration: 0.16,
            ease: "power2.out",
          },
          ">-=0.05",
        );
        bounce.fromTo(
          hoverTracers,
          { drawSVG: "0% 2.5%", autoAlpha: 0 },
          {
            drawSVG: "97.5% 100%",
            autoAlpha: 1,
            duration: 0.9,
            ease: "power2.out",
            immediateRender: false,
          },
          "<",
        );
        bounce.fromTo(
          rays,
          {
            x: (index) => rayMotionsRef.current[index]?.endX ?? 0,
            y: (index) => rayMotionsRef.current[index]?.endY ?? 0,
            rotation: (index) =>
              (rayMotionsRef.current[index]?.rotation ?? 0) + 180,
            autoAlpha: (index) =>
              index < activeCutCountRef.current ? 1 : 0,
            scaleX: 1,
          },
          {
            x: (index) => rayMotionsRef.current[index]?.startX ?? 0,
            y: (index) => rayMotionsRef.current[index]?.startY ?? 0,
            rotation: (index) =>
              (rayMotionsRef.current[index]?.rotation ?? 0) + 180,
            autoAlpha: (index) =>
              index < activeCutCountRef.current ? 0.28 : 0,
            scaleX: 0.78,
            duration: ONE_TOUCH_CONFIG.timing.hoverRayOut,
            ease: "power1.inOut",
            immediateRender: false,
          },
          ">",
        );
        bounce.to(
          hoverTracers,
          {
            drawSVG: "0% 2.5%",
            autoAlpha: 0.88,
            duration: ONE_TOUCH_CONFIG.timing.hoverRayOut,
            ease: "power2.inOut",
          },
          "<",
        );
        bounce.to(hoverTracers, {
          autoAlpha: 0,
          duration: 0.12,
          ease: "power2.out",
        });
      };
      startHoverBounceRef.current = startHoverBounce;

      const introDriver = master.tweenFromTo("intro", "idleConverge", {
        ease: "none",
        onComplete: () => {
          stateRef.current = "idle";
          scheduleIdle(ONE_TOUCH_CONFIG.timing.initialHold);
        },
      });
      timelineDriverRef.current = introDriver;

      return () => {
        clearIdleTimer();
        if (hoverIntentTimerRef.current !== null) {
          window.clearTimeout(hoverIntentTimerRef.current);
          hoverIntentTimerRef.current = null;
        }
        hoverBounceRef.current?.kill();
        timelineDriverRef.current?.kill();
        master.kill();
        masterTimelineRef.current = null;
        updatePatternRef.current = () => undefined;
        startHoverBounceRef.current = () => undefined;
      };
    },
    { scope: rootRef },
  );

  const beginHover = () => {
    contextSafe(() => {
      if (hoverIntentTimerRef.current !== null) {
        window.clearTimeout(hoverIntentTimerRef.current);
        hoverIntentTimerRef.current = null;
      }
      // Direction ①: hover does NOT take over the rays/outline/innerCuts — they
      // keep running the opening converge loop uninterrupted. Only respond when
      // truly idle so we don't fight the intro/opening states.
      if (
        stateRef.current !== "idle" ||
        masterTimelineRef.current === null
      ) {
        return;
      }

      hoverTweenRefs.current.forEach((tween) => tween.kill());
      hoverTweenRefs.current = [];

      stateRef.current = "hover";

      // Temporary hover feedback: gently scale the whole geometry. This element
      // is independent of the rays/outline/innerCuts driven by master, so the
      // converge animation never gets interrupted. (Hover effect to be redesigned.)
      hoverTweenRefs.current.push(
        gsap.to(geometryRef.current, {
          scale: 0.96,
          duration: reducedMotionRef.current
            ? 0.18
            : ONE_TOUCH_CONFIG.timing.hoverIn,
          ease: "power2.out",
        }),
      );
    })();
  };

  const cancelHoverIntent = () => {
    if (hoverIntentTimerRef.current !== null) {
      window.clearTimeout(hoverIntentTimerRef.current);
      hoverIntentTimerRef.current = null;
    }
  };

  const scheduleHoverIntent = () => {
    cancelHoverIntent();
    hoverIntentTimerRef.current = window.setTimeout(() => {
      hoverIntentTimerRef.current = null;
      beginHover();
    }, ONE_TOUCH_CONFIG.timing.hoverIntent * 1000);
  };

  const endHover = () => {
    contextSafe(() => {
      cancelHoverIntent();
      if (stateRef.current !== "hover") {
        return;
      }

      stateRef.current = "idle";
      // Direction ①: rays/outline/innerCuts were never taken over — they're
      // still running the opening converge loop. Only revert the temporary
      // geometry hover feedback. No timelineDriver kill, no scheduleIdle: the
      // converge loop never stopped, so there is nothing to resume.
      hoverTweenRefs.current.forEach((tween) => tween.kill());
      hoverTweenRefs.current = [];
      hoverTweenRefs.current.push(
        gsap.to(geometryRef.current, {
          scale: 1,
          duration: reducedMotionRef.current
            ? 0.18
            : ONE_TOUCH_CONFIG.timing.hoverIn,
          ease: "power2.out",
        }),
      );
    })();
  };

  const activateTouch = () => {
    contextSafe(() => {
      const master = masterTimelineRef.current;
      if (
        !master ||
        stateRef.current === "opening" ||
        stateRef.current === "complete"
      ) {
        return;
      }

      stateRef.current = "opening";
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      hoverBounceRef.current?.kill();
      timelineDriverRef.current?.kill();
      // Same precise teardown as beginHover/endHover: only kill the standalone
      // hover tweens, never broad-kill innerCuts/outline here — the upcoming
      // tweenFromTo("touchImpact", "complete") still needs master's inner-cut
      // slice tweens to play during the opening animation.
      hoverTweenRefs.current.forEach((tween) => tween.kill());
      hoverTweenRefs.current = [];
      morphTargetRef.current =
        ONE_TOUCH_CONFIG.shapes[shapeIndexRef.current].path;
      morphTargetPathRef.current?.setAttribute("d", morphTargetRef.current);
      updatePatternRef.current();
      master.invalidate();

      timelineDriverRef.current = master.tweenFromTo(
        "touchImpact",
        "complete",
        {
          ease: "none",
          onComplete: () => {
            stateRef.current = "complete";
            onComplete();
          },
        },
      );
    })();
  };

  const handlePointerEnter = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "touch") {
      scheduleHoverIntent();
    }
  };

  const handlePointerLeave = () => {
    cancelHoverIntent();
    if (!isFocusedRef.current) {
      endHover();
    }
  };

  const overlayStyle = {
    "--one-touch-bg": ONE_TOUCH_CONFIG.colors.background,
    "--one-touch-silver": ONE_TOUCH_CONFIG.colors.silver,
    "--one-touch-muted": ONE_TOUCH_CONFIG.colors.mutedSilver,
    "--one-touch-size": `${ONE_TOUCH_CONFIG.geometrySize}px`,
  } as CSSProperties;

  return (
    <section
      ref={rootRef}
      className={styles.overlay}
      style={overlayStyle}
      aria-label="One Touch opening experience"
    >
      <div className={styles.panels} aria-hidden="true">
        {Array.from({ length: MAX_CUT_COUNT }, (_, index) => (
          <div
            className={styles.panel}
            key={`panel-${index}`}
            style={{ zIndex: MAX_CUT_COUNT - index }}
          />
        ))}
      </div>

      <svg
        className={styles.viewportSvg}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id="one-touch-comet-gradient"
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop offset="0%" stopColor="#E8E8E8" stopOpacity="0" />
            <stop offset="28%" stopColor="#E8E8E8" stopOpacity="0.08" />
            <stop offset="68%" stopColor="#ECECEC" stopOpacity="0.42" />
            <stop offset="90%" stopColor="#F7F7F7" stopOpacity="0.88" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="1" />
          </linearGradient>
        </defs>
        <g className={styles.rays}>
          {Array.from({ length: MAX_CUT_COUNT }, (_, index) => (
            <g className={styles.ray} key={`ray-${index}`}>
              <path
                className={styles.rayGlow}
                d={COMET_PATH}
                fill="url(#one-touch-comet-gradient)"
              />
              <path
                className={styles.rayBeam}
                d={COMET_PATH}
                fill="url(#one-touch-comet-gradient)"
              />
            </g>
          ))}
        </g>
        <g className={styles.viewportCuts}>
          {Array.from({ length: MAX_CUT_COUNT }, (_, index) => (
            <path
              className={styles.viewportCut}
              d={ZERO_PATH}
              key={`cut-${index}`}
              pathLength="100"
            />
          ))}
        </g>
      </svg>

      <div ref={geometryRef} className={styles.geometry}>
        <span className={`${styles.prompt} ${styles.promptTop}`}>
          ONE TOUCH
        </span>

        <button
          ref={buttonRef}
          className={styles.touchButton}
          type="button"
          aria-label="一触开启网站"
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onFocus={() => {
            isFocusedRef.current = true;
            beginHover();
          }}
          onBlur={() => {
            isFocusedRef.current = false;
            endHover();
          }}
          onClick={activateTouch}
        >
          <svg
            className={styles.coreSvg}
            viewBox="0 0 100 100"
            role="img"
            aria-label="等待触发的几何入口"
          >
            <defs>
              <path
                ref={morphTargetPathRef}
                d={ONE_TOUCH_CONFIG.shapes[0].path}
              />
              <clipPath id="one-touch-shape-clip">
                <path
                  ref={clipShapeRef}
                  d={ONE_TOUCH_CONFIG.shapes[0].path}
                />
              </clipPath>
            </defs>

            <g clipPath="url(#one-touch-shape-clip)">
              {Array.from({ length: MAX_CUT_COUNT }, (_, index) => (
                <path
                  className={styles.innerCut}
                  d="M 50 50 L 50 50"
                  key={`inner-cut-${index}`}
                  pathLength="100"
                />
              ))}
              {Array.from({ length: MAX_CUT_COUNT }, (_, index) => (
                <path
                  className={styles.hoverTracer}
                  d="M 50 50 L 50 50"
                  key={`hover-tracer-${index}`}
                  pathLength="100"
                />
              ))}
            </g>

            <circle
              ref={pulseRef}
              className={styles.pulse}
              cx="50"
              cy="50"
              r="39"
            />
            <path
              ref={outlineRef}
              className={styles.outline}
              d={ONE_TOUCH_CONFIG.shapes[0].path}
              pathLength="100"
            />
            <circle className={styles.touchPoint} cx="50" cy="50" r="1.35" />
          </svg>
        </button>

        <span className={`${styles.prompt} ${styles.promptBottom}`}>
          TO ENTER
        </span>
      </div>

      <a
        className={styles.credit}
        href="https://deerflow.tech"
        target="_blank"
        rel="noreferrer"
      >
        Created by Deerflow
      </a>
    </section>
  );
}
