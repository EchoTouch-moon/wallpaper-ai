import gsap from "gsap";

import {
  MAX_CUT_COUNT,
  ONE_TOUCH_CONFIG,
  type InteractionState,
  type PanelMotion,
  type RayMotion,
  type Viewport,
} from "./config";
import {
  getInnerCutPath,
  getPanelMotions,
  getViewportEdgePoint,
} from "./geometry";
import { createHover } from "./hover";

// ---- shared types (kept here so config.ts stays free of gsap) ----
export type ContextSafe = (fn: () => void) => () => void;
export type Ref<T> = { current: T };

export type OneTouchElements = {
  root: HTMLElement;
  geometry: HTMLDivElement;
  button: HTMLButtonElement;
  outline: SVGPathElement;
  clipShape: SVGPathElement;
  morphTargetPath: SVGPathElement;
  pulse: SVGCircleElement;
  content: HTMLDivElement;
  rays: SVGGElement[];
  viewportCuts: SVGPathElement[];
  innerCuts: SVGPathElement[];
  hoverTracers: SVGPathElement[];
  panels: HTMLDivElement[];
  prompt: HTMLElement[];
};

export type OneTouchRefs = {
  masterTimeline: Ref<gsap.core.Timeline | null>;
  timelineDriver: Ref<gsap.core.Tween | null>;
  hoverBounce: Ref<gsap.core.Timeline | null>;
  hoverTween: Ref<gsap.core.Tween[]>;
  idleTimer: Ref<number | null>;
  hoverIntentTimer: Ref<number | null>;
  state: Ref<InteractionState>;
  shapeIndex: Ref<number>;
  pendingShapeIndex: Ref<number>;
  morphTarget: Ref<string>;
  isMorphing: Ref<boolean>;
  isFocused: Ref<boolean>;
  resumeStableCycle: Ref<boolean>;
  reducedMotion: Ref<boolean>;
  viewport: Ref<Viewport>;
  rayMotions: Ref<RayMotion[]>;
  panelMotions: Ref<PanelMotion[]>;
  activeCutCount: Ref<number>;
};

export type OneTouchContext = {
  elements: OneTouchElements;
  refs: OneTouchRefs;
  contextSafe: ContextSafe;
  updatePattern: () => void;
  scheduleIdle: (delay?: number) => void;
};

export type OneTouchControllerOptions = {
  elements: OneTouchElements;
  refs: OneTouchRefs;
  contextSafe: ContextSafe;
  onRevealStart: () => void;
  onComplete: () => void;
};

export type OneTouchController = {
  scheduleHoverIntent: () => void;
  cancelHoverIntent: () => void;
  beginHover: () => void;
  endHover: () => void;
  activateTouch: () => void;
  updateViewport: () => void;
  dispose: () => void;
};

export function createOneTouchController({
  elements,
  refs,
  contextSafe,
  onRevealStart,
  onComplete,
}: OneTouchControllerOptions): OneTouchController {
  const {
    root,
    geometry,
    button,
    outline,
    clipShape,
    morphTargetPath,
    pulse,
    content,
    rays,
    viewportCuts,
    innerCuts,
    hoverTracers,
    panels,
    prompt,
  } = elements;

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  refs.reducedMotion.current = reduceMotion;

  const clearIdleTimer = () => {
    if (refs.idleTimer.current !== null) {
      window.clearTimeout(refs.idleTimer.current);
      refs.idleTimer.current = null;
    }
  };

  const updateCutPattern = () => {
    const shape = ONE_TOUCH_CONFIG.shapes[refs.shapeIndex.current];
    const currentViewport = refs.viewport.current;
    const buttonBounds = button.getBoundingClientRect();
    const center = {
      x: buttonBounds.left + buttonBounds.width / 2,
      y: buttonBounds.top + buttonBounds.height / 2,
    };
    const centerX = center.x;
    const centerY = center.y;
    const panelMotions: PanelMotion[] = getPanelMotions(
      currentViewport,
      shape.cutAngles,
      center,
    );

    refs.activeCutCount.current = shape.cutAngles.length;
    refs.panelMotions.current = panelMotions;
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
        refs.rayMotions.current[index] = {
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
      refs.rayMotions.current[index] = {
        startX: edge.x,
        startY: edge.y,
        endX: centerX,
        endY: centerY,
        rotation:
          (Math.atan2(centerY - edge.y, centerX - edge.x) * 180) / Math.PI,
      };
      viewportCut?.setAttribute(
        "d",
        `M ${centerX.toFixed(2)} ${centerY.toFixed(2)} L ${edge.x.toFixed(2)} ${edge.y.toFixed(2)}`,
      );
      innerCut?.setAttribute("d", innerPath);
      hoverTracer?.setAttribute("d", innerPath);
    }
  };

  const master = gsap.timeline({
    paused: true,
    defaults: { ease: "power3.inOut" },
  });
  refs.masterTimeline.current = master;

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
    x: (index) => refs.rayMotions.current[index]?.startX ?? 0,
    y: (index) => refs.rayMotions.current[index]?.startY ?? 0,
    rotation: (index) => refs.rayMotions.current[index]?.rotation ?? 0,
  });
  gsap.set(pulse, { scale: 0.75, autoAlpha: 0, svgOrigin: "50 50" });
  gsap.set(panels, {
    x: 0,
    y: 0,
    scale: 1,
    autoAlpha: (index) => (index < refs.activeCutCount.current ? 1 : 0),
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
      x: (index) => refs.rayMotions.current[index]?.startX ?? 0,
      y: (index) => refs.rayMotions.current[index]?.startY ?? 0,
      rotation: (index) => refs.rayMotions.current[index]?.rotation ?? 0,
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
      x: (index) => refs.rayMotions.current[index]?.startX ?? 0,
      y: (index) => refs.rayMotions.current[index]?.startY ?? 0,
      rotation: (index) => refs.rayMotions.current[index]?.rotation ?? 0,
      autoAlpha: (index) =>
        index < refs.activeCutCount.current ? 0.34 : 0,
      scaleX: 0.78,
    },
    {
      x: (index) => refs.rayMotions.current[index]?.endX ?? 0,
      y: (index) => refs.rayMotions.current[index]?.endY ?? 0,
      rotation: (index) => refs.rayMotions.current[index]?.rotation ?? 0,
      autoAlpha: (index) => (index < refs.activeCutCount.current ? 1 : 0),
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
      ONE_TOUCH_CONFIG.timing.rayConverge + ONE_TOUCH_CONFIG.timing.impactHold
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
        refs.isMorphing.current = true;
      },
      onComplete: () => {
        refs.isMorphing.current = false;
        refs.shapeIndex.current = refs.pendingShapeIndex.current;
        updateCutPattern();
        gsap.set(innerCuts, { drawSVG: "0% 0%", autoAlpha: 0 });
      },
    },
    "idleMorph",
  );

  master.addLabel(
    "hoverPreview",
    `idleMorph+=${
      ONE_TOUCH_CONFIG.timing.morph + ONE_TOUCH_CONFIG.timing.postMorphHold
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
          const panel = refs.panelMotions.current[index];
          return panel
            ? panel.x *
                Math.hypot(
                  refs.viewport.current.width,
                  refs.viewport.current.height,
                ) *
                1.15
            : 0;
        },
        y: (index) => {
          const panel = refs.panelMotions.current[index];
          return panel
            ? panel.y *
                Math.hypot(
                  refs.viewport.current.width,
                  refs.viewport.current.height,
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
      (refs.state.current !== "idle" && refs.state.current !== "hover") ||
      reduceMotion
    ) {
      return;
    }

    refs.timelineDriver.current?.kill();
    master.seek("idleConverge", true);
    refs.isMorphing.current = false;

    const stableShape = ONE_TOUCH_CONFIG.shapes[refs.shapeIndex.current];
    outline.setAttribute("d", stableShape.path);
    clipShape.setAttribute("d", stableShape.path);
    updateCutPattern();

    const shouldHoldCurrentShape = refs.resumeStableCycle.current;
    refs.resumeStableCycle.current = false;
    const nextIndex = shouldHoldCurrentShape
      ? refs.shapeIndex.current
      : (refs.shapeIndex.current + 1) % ONE_TOUCH_CONFIG.shapes.length;
    refs.pendingShapeIndex.current = nextIndex;
    refs.morphTarget.current = ONE_TOUCH_CONFIG.shapes[nextIndex].path;
    morphTargetPath.setAttribute("d", refs.morphTarget.current);
    master.invalidate();
    outline.setAttribute("d", stableShape.path);
    clipShape.setAttribute("d", stableShape.path);
    gsap.set(rays, {
      x: (index) => refs.rayMotions.current[index]?.startX ?? 0,
      y: (index) => refs.rayMotions.current[index]?.startY ?? 0,
      rotation: (index) => refs.rayMotions.current[index]?.rotation ?? 0,
      scaleX: 0.78,
      autoAlpha: (index) =>
        index < refs.activeCutCount.current ? 0.34 : 0,
    });
    refs.timelineDriver.current = master.tweenFromTo(
      "idleConverge",
      "hoverPreview",
      {
        ease: "none",
        onComplete: () => {
          if (
            refs.state.current === "idle" ||
            refs.state.current === "hover"
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
    if (refs.state.current !== "idle" || reduceMotion) {
      return;
    }
    refs.idleTimer.current = window.setTimeout(
      runIdleCycle,
      Math.max(0, delay * 1000),
    );
  };

  updateCutPattern();

  const ctx: OneTouchContext = {
    elements,
    refs,
    contextSafe,
    updatePattern: updateCutPattern,
    scheduleIdle,
  };
  const hover = createHover(ctx, master);

  const introDriver = master.tweenFromTo("intro", "idleConverge", {
    ease: "none",
    onComplete: () => {
      refs.state.current = "idle";
      scheduleIdle(ONE_TOUCH_CONFIG.timing.initialHold);
    },
  });
  refs.timelineDriver.current = introDriver;

  const activateTouch = contextSafe(() => {
    if (
      !master ||
      refs.state.current === "opening" ||
      refs.state.current === "complete"
    ) {
      return;
    }

    refs.state.current = "opening";
    clearIdleTimer();
    refs.hoverBounce.current?.kill();
    refs.timelineDriver.current?.kill();
    // Only kill the standalone hover tweens, never broad-kill innerCuts/outline
    // here — the upcoming tweenFromTo("touchImpact", "complete") still needs
    // master's inner-cut slice tweens to play during the opening animation.
    refs.hoverTween.current.forEach((tween) => tween.kill());
    refs.hoverTween.current = [];
    refs.morphTarget.current =
      ONE_TOUCH_CONFIG.shapes[refs.shapeIndex.current].path;
    morphTargetPath.setAttribute("d", refs.morphTarget.current);
    updateCutPattern();
    master.invalidate();

    refs.timelineDriver.current = master.tweenFromTo(
      "touchImpact",
      "complete",
      {
        ease: "none",
        onComplete: () => {
          refs.state.current = "complete";
          onComplete();
        },
      },
    );
  });

  const dispose = () => {
    clearIdleTimer();
    if (refs.hoverIntentTimer.current !== null) {
      window.clearTimeout(refs.hoverIntentTimer.current);
      refs.hoverIntentTimer.current = null;
    }
    refs.hoverBounce.current?.kill();
    refs.timelineDriver.current?.kill();
    master.kill();
    refs.masterTimeline.current = null;
  };

  return {
    scheduleHoverIntent: hover.scheduleHoverIntent,
    cancelHoverIntent: hover.cancelHoverIntent,
    beginHover: hover.beginHover,
    endHover: hover.endHover,
    activateTouch,
    updateViewport: updateCutPattern,
    dispose,
  };
}
