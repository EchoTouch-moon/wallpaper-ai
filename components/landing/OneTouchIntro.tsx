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
} from "react";
import styles from "./OneTouchIntro.module.css";
import {
  COMET_PATH,
  MAX_CUT_COUNT,
  ONE_TOUCH_CONFIG,
  ZERO_PATH,
  type InteractionState,
  type OneTouchIntroProps,
  type PanelMotion,
  type RayMotion,
  type Viewport,
} from "./one-touch/config";
import {
  createOneTouchController,
  type OneTouchController,
  type OneTouchElements,
  type OneTouchRefs,
} from "./one-touch/controller";

gsap.registerPlugin(useGSAP, DrawSVGPlugin, MorphSVGPlugin);

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
  const rayMotionsRef = useRef<RayMotion[]>([]);
  const panelMotionsRef = useRef<PanelMotion[]>([]);
  const activeCutCountRef = useRef(
    ONE_TOUCH_CONFIG.shapes[0].cutAngles.length,
  );
  const controllerRef = useRef<OneTouchController | null>(null);
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
        controllerRef.current?.updateViewport();
      });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  useGSAP(
    (_context, contextSafe) => {
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
        !content ||
        !contextSafe
      ) {
        return;
      }

      const elements: OneTouchElements = {
        root,
        geometry,
        button,
        outline,
        clipShape,
        morphTargetPath,
        pulse,
        content,
        rays: gsap.utils.toArray<SVGGElement>(`.${styles.ray}`, root),
        viewportCuts: gsap.utils.toArray<SVGPathElement>(
          `.${styles.viewportCut}`,
          root,
        ),
        innerCuts: gsap.utils.toArray<SVGPathElement>(
          `.${styles.innerCut}`,
          root,
        ),
        hoverTracers: gsap.utils.toArray<SVGPathElement>(
          `.${styles.hoverTracer}`,
          root,
        ),
        panels: gsap.utils.toArray<HTMLDivElement>(`.${styles.panel}`, root),
        prompt: gsap.utils.toArray<HTMLElement>(`.${styles.prompt}`, root),
      };

      const refs: OneTouchRefs = {
        masterTimeline: masterTimelineRef,
        timelineDriver: timelineDriverRef,
        hoverBounce: hoverBounceRef,
        hoverTween: hoverTweenRefs,
        idleTimer: idleTimerRef,
        hoverIntentTimer: hoverIntentTimerRef,
        state: stateRef,
        shapeIndex: shapeIndexRef,
        pendingShapeIndex: pendingShapeIndexRef,
        morphTarget: morphTargetRef,
        isMorphing: isMorphingRef,
        isFocused: isFocusedRef,
        resumeStableCycle: resumeStableCycleRef,
        reducedMotion: reducedMotionRef,
        viewport: viewportRef,
        rayMotions: rayMotionsRef,
        panelMotions: panelMotionsRef,
        activeCutCount: activeCutCountRef,
      };

      controllerRef.current = createOneTouchController({
        elements,
        refs,
        contextSafe,
        onRevealStart,
        onComplete,
      });

      return () => {
        controllerRef.current?.dispose();
        controllerRef.current = null;
      };
    },
    { scope: rootRef },
  );

  const handlePointerEnter = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "touch") {
      controllerRef.current?.scheduleHoverIntent();
    }
  };

  const handlePointerLeave = () => {
    controllerRef.current?.cancelHoverIntent();
    if (!isFocusedRef.current) {
      controllerRef.current?.endHover();
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
            controllerRef.current?.beginHover();
          }}
          onBlur={() => {
            isFocusedRef.current = false;
            controllerRef.current?.endHover();
          }}
          onClick={() => controllerRef.current?.activateTouch()}
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
