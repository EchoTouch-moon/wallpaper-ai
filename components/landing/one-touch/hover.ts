import gsap from "gsap";

import { ONE_TOUCH_CONFIG } from "./config";
import type { OneTouchContext } from "./controller";

export type HoverController = {
  beginHover: () => void;
  endHover: () => void;
  scheduleHoverIntent: () => void;
  cancelHoverIntent: () => void;
};

export function createHover(
  ctx: OneTouchContext,
  master: gsap.core.Timeline,
): HoverController {
  const { elements, refs, contextSafe } = ctx;

  const cancelHoverIntent = () => {
    if (refs.hoverIntentTimer.current !== null) {
      window.clearTimeout(refs.hoverIntentTimer.current);
      refs.hoverIntentTimer.current = null;
    }
  };

  // Preserved for the upcoming hover redesign — NOT invoked under Direction ①
  // (hover no longer takes over the rays). This is the legacy ray "bounce"
  // feedback; rebuild or replace it when redesigning the hover effect.
  const startHoverBounce = () => {
    refs.hoverBounce.current?.kill();
    if (refs.reducedMotion.current || refs.state.current !== "hover") {
      return;
    }

    const bounce = gsap.timeline({
      repeat: -1,
      repeatDelay: ONE_TOUCH_CONFIG.timing.hoverRepeatGap,
      defaults: { ease: "power2.inOut" },
    });
    refs.hoverBounce.current = bounce;

    bounce.set(elements.rays, {
      x: (index) => refs.rayMotions.current[index]?.startX ?? 0,
      y: (index) => refs.rayMotions.current[index]?.startY ?? 0,
      rotation: (index) => refs.rayMotions.current[index]?.rotation ?? 0,
      scaleX: 0.78,
    });
    bounce.set(elements.hoverTracers, { drawSVG: "0% 2.5%", autoAlpha: 0 });
    bounce.fromTo(
      elements.rays,
      {
        x: (index) => refs.rayMotions.current[index]?.startX ?? 0,
        y: (index) => refs.rayMotions.current[index]?.startY ?? 0,
        autoAlpha: (index) =>
          index < refs.activeCutCount.current ? 0.34 : 0,
        scaleX: 0.78,
      },
      {
        x: (index) => refs.rayMotions.current[index]?.endX ?? 0,
        y: (index) => refs.rayMotions.current[index]?.endY ?? 0,
        autoAlpha: (index) =>
          index < refs.activeCutCount.current ? 1 : 0,
        scaleX: 1,
        duration: ONE_TOUCH_CONFIG.timing.hoverRayIn,
        ease: "power1.inOut",
        immediateRender: false,
      },
    );
    bounce.to(
      elements.rays,
      {
        autoAlpha: 0,
        duration: 0.16,
        ease: "power2.out",
      },
      ">-=0.05",
    );
    bounce.fromTo(
      elements.hoverTracers,
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
      elements.rays,
      {
        x: (index) => refs.rayMotions.current[index]?.endX ?? 0,
        y: (index) => refs.rayMotions.current[index]?.endY ?? 0,
        rotation: (index) =>
          (refs.rayMotions.current[index]?.rotation ?? 0) + 180,
        autoAlpha: (index) =>
          index < refs.activeCutCount.current ? 1 : 0,
        scaleX: 1,
      },
      {
        x: (index) => refs.rayMotions.current[index]?.startX ?? 0,
        y: (index) => refs.rayMotions.current[index]?.startY ?? 0,
        rotation: (index) =>
          (refs.rayMotions.current[index]?.rotation ?? 0) + 180,
        autoAlpha: (index) =>
          index < refs.activeCutCount.current ? 0.28 : 0,
        scaleX: 0.78,
        duration: ONE_TOUCH_CONFIG.timing.hoverRayOut,
        ease: "power1.inOut",
        immediateRender: false,
      },
      ">",
    );
    bounce.to(
      elements.hoverTracers,
      {
        drawSVG: "0% 2.5%",
        autoAlpha: 0.88,
        duration: ONE_TOUCH_CONFIG.timing.hoverRayOut,
        ease: "power2.inOut",
      },
      "<",
    );
    bounce.to(elements.hoverTracers, {
      autoAlpha: 0,
      duration: 0.12,
      ease: "power2.out",
    });
  };
  // Reference kept so the redesign can find it; Direction ① does not call it.
  void startHoverBounce;

  const beginHover = contextSafe(() => {
    cancelHoverIntent();
    // Direction ①: hover does NOT take over the rays/outline/innerCuts — they
    // keep running the opening converge loop uninterrupted. Only respond when
    // truly idle so we don't fight the intro/opening states.
    if (refs.state.current !== "idle" || master === null) {
      return;
    }

    refs.hoverTween.current.forEach((tween) => tween.kill());
    refs.hoverTween.current = [];

    refs.state.current = "hover";

    // Temporary hover feedback: gently scale the whole geometry. This element
    // is independent of the rays/outline/innerCuts driven by master, so the
    // converge animation never gets interrupted. (Hover effect to be redesigned.)
    refs.hoverTween.current.push(
      gsap.to(elements.geometry, {
        scale: 0.96,
        duration: refs.reducedMotion.current
          ? 0.18
          : ONE_TOUCH_CONFIG.timing.hoverIn,
        ease: "power2.out",
      }),
    );
  });

  const endHover = contextSafe(() => {
    cancelHoverIntent();
    if (refs.state.current !== "hover") {
      return;
    }

    refs.state.current = "idle";
    // Direction ①: rays/outline/innerCuts were never taken over — they're
    // still running the opening converge loop. Only revert the temporary
    // geometry hover feedback. No timelineDriver kill, no scheduleIdle: the
    // converge loop never stopped, so there is nothing to resume.
    refs.hoverTween.current.forEach((tween) => tween.kill());
    refs.hoverTween.current = [];
    refs.hoverTween.current.push(
      gsap.to(elements.geometry, {
        scale: 1,
        duration: refs.reducedMotion.current
          ? 0.18
          : ONE_TOUCH_CONFIG.timing.hoverIn,
        ease: "power2.out",
      }),
    );
  });

  const scheduleHoverIntent = () => {
    cancelHoverIntent();
    refs.hoverIntentTimer.current = window.setTimeout(() => {
      refs.hoverIntentTimer.current = null;
      beginHover();
    }, ONE_TOUCH_CONFIG.timing.hoverIntent * 1000);
  };

  return { beginHover, endHover, scheduleHoverIntent, cancelHoverIntent };
}
