"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import NextImage from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
} from "react";

import type {
  CompositionBrief,
  CompositionTarget,
} from "@wallpaper/core/layout-generation";
import type {
  ImageAssetAnalysis,
  LayoutCandidate,
  WallpaperItem,
} from "@wallpaper/core/types";
import {
  computeSlotPlacement,
  subjectPolygonOf,
} from "@/lib/client/cutoutGeometry";

import styles from "./OneTouchStudio.module.css";

gsap.registerPlugin(useGSAP);

type StudioMode =
  | "idle"
  | "uploading"
  | "generating"
  | "result"
  | "refining";

type CompositionIntentProfile = "calm" | "editorial" | "dynamic";

type StudioAsset = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  aspectRatio: number;
  analysis: ImageAssetAnalysis;
  analysisSource: "basic" | "vision";
  analysisWarnings: string[];
  thumbnailUrl: string;
  contentUrl: string;
  createdAt: string;
  expiresAt: string;
};

type CompositionView = {
  id: string;
  status: "generating" | "ready" | "failed";
  stage: "planning" | "compiling" | "rendering" | "ready" | "failed";
  brief: CompositionBrief;
  assetIds: string[];
  candidates: LayoutCandidate[];
  source: "ai" | "recipe-fallback";
  warnings: string[];
  revisionCount: number;
  canUndoCandidateId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

type ApiErrorBody = {
  error?: string;
};

const SESSION_STORAGE_KEY = "one-touch:session-id";
const COMPOSITION_STORAGE_KEY = "one-touch:composition-id";

const TARGET_PRESETS: Array<CompositionTarget & { label: string; hint: string }> = [
  {
    ratioId: "16:9",
    width: 3840,
    height: 2160,
    usage: "desktop",
    label: "Desktop",
    hint: "16:9",
  },
  {
    ratioId: "16:10",
    width: 2560,
    height: 1600,
    usage: "laptop",
    label: "Laptop",
    hint: "16:10",
  },
  {
    ratioId: "21:9",
    width: 3440,
    height: 1440,
    usage: "ultrawide",
    label: "Ultrawide",
    hint: "21:9",
  },
  {
    ratioId: "9:16",
    width: 1440,
    height: 2560,
    usage: "mobile",
    label: "Mobile",
    hint: "9:16",
  },
  {
    ratioId: "9:19.5",
    width: 1290,
    height: 2795,
    usage: "lock-screen",
    label: "Lock screen",
    hint: "9:19.5",
  },
];

const PROFILE_CONFIG = {
  calm: {
    label: "Calm",
    density: "minimal",
    rhythm: "ordered",
    moodTags: ["calm", "spacious"],
  },
  editorial: {
    label: "Editorial",
    density: "balanced",
    rhythm: "asymmetric",
    moodTags: ["editorial", "structured"],
  },
  dynamic: {
    label: "Dynamic",
    density: "dense",
    rhythm: "layered",
    moodTags: ["dynamic", "layered"],
  },
} as const;

function OrbitMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="10.5" />
      <circle cx="27.2" cy="8.8" r="3.2" />
      <path d="M5.5 19.5C6 9.9 12.3 4.4 21.9 4.2" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8c.8 5.5 3.7 8.4 9.2 9.2-5.5.8-8.4 3.7-9.2 9.2-.8-5.5-3.7-8.4-9.2-9.2C8.3 11.2 11.2 8.3 12 2.8Z" />
      <path d="M19.2 2.5c.2 1.5 1 2.3 2.5 2.5-1.5.2-2.3 1-2.5 2.5C19 6 18.2 5.2 16.7 5c1.5-.2 2.3-1 2.5-2.5Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3" />
    </svg>
  );
}

function safeAreasForTarget(target: CompositionTarget) {
  if (target.usage === "lock-screen") {
    return ["mobile-clock"] as const;
  }
  if (target.usage === "mobile") {
    return ["mobile-widget-center"] as const;
  }
  return ["desktop-icons-left", "desktop-dock"] as const;
}

function targetIsValid(target: CompositionTarget) {
  const ratio = target.width / target.height;
  return (
    target.width >= 720 &&
    target.width <= 7680 &&
    target.height >= 720 &&
    target.height <= 7680 &&
    target.width * target.height <= 33_000_000 &&
    ratio >= 0.4 &&
    ratio <= 3
  );
}

function buildBrief(
  target: CompositionTarget,
  prompt: string,
  heroAssetId: string | undefined,
  profile: CompositionIntentProfile,
): CompositionBrief {
  const profileConfig = PROFILE_CONFIG[profile];
  const mobile =
    target.usage === "mobile" || target.usage === "lock-screen";
  const protocolTarget: CompositionTarget = {
    ratioId: target.ratioId,
    width: target.width,
    height: target.height,
    usage: target.usage,
  };
  return {
    version: "1.0",
    target: protocolTarget,
    intent: {
      prompt: prompt.trim(),
      heroAssetId,
      hierarchy: heroAssetId ? "hero-support" : "balanced",
      density: profileConfig.density,
      rhythm: profileConfig.rhythm,
      visualFlow: mobile ? "top-to-bottom" : "left-to-right",
      moodTags: [...profileConfig.moodTags],
    },
    constraints: {
      safeAreas: [...safeAreasForTarget(target)],
      preserveFaces: true,
      preserveText: true,
      cropTolerance: profile === "dynamic" ? "high" : "medium",
    },
  };
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody & T;
  if (!response.ok) {
    throw new Error(body.error || "The request could not be completed");
  }
  return body;
}

function imageForItem(
  item: WallpaperItem,
  assetById: Map<string, StudioAsset>,
) {
  return assetById.get(item.assetId);
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.roundRect(x, y, width, height, safeRadius);
  context.closePath();
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load source image"));
    image.src = source;
  });
}

export function OneTouchStudio() {
  const rootRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<HTMLButtonElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbRefs = useRef(new Map<string, HTMLDivElement>());
  const slotRefs = useRef(new Map<string, HTMLDivElement>());
  const flightRefs = useRef(new Map<string, HTMLDivElement>());
  const generationTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const requestInFlightRef = useRef(false);

  const [mode, setMode] = useState<StudioMode>("idle");
  const [target, setTarget] = useState<CompositionTarget>(TARGET_PRESETS[0]);
  const [customTarget, setCustomTarget] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [profile, setProfile] =
    useState<CompositionIntentProfile>("editorial");
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [composition, setComposition] =
    useState<CompositionView | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] =
    useState<string | null>(null);
  const [heroAssetId, setHeroAssetId] = useState<string | undefined>();
  const [generationKey, setGenerationKey] = useState(0);
  const [generationMessage, setGenerationMessage] =
    useState("Reading image structure");
  const [refineInstruction, setRefineInstruction] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);

  const selectedCandidate = useMemo(
    () =>
      composition?.candidates.find(
        (candidate) => candidate.id === selectedCandidateId,
      ) ??
      composition?.candidates[0] ??
      null,
    [composition, selectedCandidateId],
  );
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );
  const targetError = targetIsValid(target)
    ? null
    : "Use 720–7680 px per side, 0.4–3 ratio, and no more than 33 MP.";
  const busy =
    mode === "uploading" ||
    mode === "generating" ||
    mode === "refining";
  const canGenerate =
    assets.length >= 2 &&
    assets.length <= 6 &&
    !targetError &&
    !busy;

  const clearStoredComposition = useCallback(() => {
    setComposition(null);
    setSelectedCandidateId(null);
    localStorage.removeItem(COMPOSITION_STORAGE_KEY);
  }, []);

  useEffect(() => {
    const restore = async () => {
      const storedSessionId = localStorage.getItem(SESSION_STORAGE_KEY);
      const storedCompositionId = localStorage.getItem(
        COMPOSITION_STORAGE_KEY,
      );
      if (!storedSessionId) {
        setIsRestoring(false);
        return;
      }
      setSessionId(storedSessionId);
      if (!storedCompositionId) {
        setIsRestoring(false);
        return;
      }
      try {
        const compositionResponse = await fetch(
          `/api/compositions/${encodeURIComponent(storedCompositionId)}`,
          { headers: { "x-one-touch-session": storedSessionId } },
        );
        const { composition: restoredComposition } = await readApiResponse<{
          composition: CompositionView;
        }>(compositionResponse);
        const restoredAssets = await Promise.all(
          restoredComposition.assetIds.map(async (assetId) => {
            const response = await fetch(
              `/api/assets/${encodeURIComponent(assetId)}`,
              { headers: { "x-one-touch-session": storedSessionId } },
            );
            return (
              await readApiResponse<{ asset: StudioAsset }>(response)
            ).asset;
          }),
        );
        setAssets(restoredAssets);
        setComposition(restoredComposition);
        setSelectedCandidateId(restoredComposition.candidates[0]?.id ?? null);
        setTarget(restoredComposition.brief.target);
        setCustomTarget(restoredComposition.brief.target.ratioId === "custom");
        setPrompt(restoredComposition.brief.intent.prompt);
        setHeroAssetId(restoredComposition.brief.intent.heroAssetId);
        setMode("result");
        setNotice("Restored your 24-hour composition session.");
      } catch {
        localStorage.removeItem(COMPOSITION_STORAGE_KEY);
        setNotice("The previous composition has expired. Start a new touch.");
      } finally {
        setIsRestoring(false);
      }
    };
    void restore();
  }, []);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: reduce)", () => {
        gsap.from(
          [
            `.${styles.header}`,
            `.${styles.composerShell}`,
            `.${styles.assetDock}`,
          ],
          { autoAlpha: 0, duration: 0.2 },
        );
      });
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap
          .timeline({ defaults: { ease: "power3.out" } })
          .from(`.${styles.header}`, {
            y: -16,
            autoAlpha: 0,
            duration: 0.65,
          })
          .from(
            `.${styles.controlPanel}`,
            { x: -24, autoAlpha: 0, duration: 0.8 },
            "<0.1",
          )
          .from(
            `.${styles.previewPanel}`,
            { y: 20, scale: 0.985, autoAlpha: 0, duration: 0.9 },
            "<0.05",
          )
          .from(
            `.${styles.assetDock}`,
            { y: 20, autoAlpha: 0, duration: 0.72 },
            "<0.12",
          );
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  useGSAP(
    () => {
      if (
        mode !== "generating" ||
        !selectedCandidate ||
        generationKey === 0
      ) {
        return;
      }
      const preview = previewRef.current;
      const touch = touchRef.current;
      const progress = progressRef.current;
      if (!preview || !touch || !progress) {
        return;
      }
      const frame = window.requestAnimationFrame(() => {
        const items = [...selectedCandidate.layout.items].sort(
          (left, right) => left.zIndex - right.zIndex,
        );
        const reduced = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        const slots = items.flatMap((item) => {
          const slot = slotRefs.current.get(item.assetId);
          return slot ? [slot] : [];
        });
        gsap.set(slots, { autoAlpha: 0, scale: reduced ? 1 : 0.96 });
        gsap.set(progress, { scaleX: 0, transformOrigin: "0% 50%" });

        const flights = items.flatMap((item) => {
          const flight = flightRefs.current.get(item.assetId);
          const thumb = thumbRefs.current.get(item.assetId);
          const slot = slotRefs.current.get(item.assetId);
          if (!flight || !thumb || !slot) {
            return [];
          }
          const source = thumb.getBoundingClientRect();
          const destination = slot.getBoundingClientRect();
          gsap.set(flight, {
            x: source.left,
            y: source.top,
            width: source.width,
            height: source.height,
            scaleX: 1,
            scaleY: 1,
            autoAlpha: reduced ? 0 : 1,
            transformOrigin: "0 0",
          });
          return [{ element: flight, source, destination }];
        });

        const complete = () => {
          setGenerationMessage("Composition complete");
          setMode("result");
        };
        if (reduced) {
          generationTimelineRef.current = gsap
            .timeline({ onComplete: complete })
            .to(slots, {
              autoAlpha: 1,
              duration: 0.24,
              stagger: 0.025,
            })
            .to(progress, { scaleX: 1, duration: 0.24 }, 0);
          return;
        }

        generationTimelineRef.current = gsap
          .timeline({
            defaults: { ease: "power3.inOut" },
            onComplete: complete,
          })
          .addLabel("focus")
          .to(
            preview,
            {
              scale: 0.985,
              filter: "brightness(0.68) saturate(0.78)",
              duration: 0.38,
            },
            "focus",
          )
          .to(
            touch,
            {
              scale: 1.06,
              boxShadow: "0 0 76px rgba(115,89,255,.72)",
              duration: 0.34,
            },
            "focus",
          )
          .to(progress, { scaleX: 0.18, duration: 0.38 }, "focus")
          .addLabel("detach", "focus+=0.24")
          .call(() => setGenerationMessage("Releasing source frames"))
          .to(
            [...thumbRefs.current.values()],
            {
              y: -8,
              scale: 0.96,
              autoAlpha: 0.38,
              duration: 0.34,
              stagger: 0.03,
            },
            "detach",
          )
          .addLabel("fly", "detach+=0.16")
          .call(() => setGenerationMessage("Compiling spatial rhythm"))
          .to(
            flights.map((flight) => flight.element),
            {
              x: (index) => flights[index].destination.left,
              y: (index) => flights[index].destination.top,
              scaleX: (index) =>
                flights[index].destination.width / flights[index].source.width,
              scaleY: (index) =>
                flights[index].destination.height /
                flights[index].source.height,
              duration: 1.05,
              stagger: 0.065,
              ease: "expo.inOut",
            },
            "fly",
          )
          .to(progress, { scaleX: 0.72, duration: 0.9 }, "fly")
          .addLabel("settle", "fly+=0.72")
          .call(() => setGenerationMessage("Balancing light and hierarchy"))
          .to(
            slots,
            {
              autoAlpha: 1,
              scale: 1,
              duration: 0.44,
              stagger: 0.04,
              ease: "power3.out",
            },
            "settle",
          )
          .to(
            flights.map((flight) => flight.element),
            { autoAlpha: 0, duration: 0.2, stagger: 0.02 },
            "settle+=0.06",
          )
          .to(
            preview,
            {
              scale: 1,
              filter: "brightness(1) saturate(1)",
              duration: 0.62,
              ease: "power3.out",
            },
            "settle+=0.1",
          )
          .to(progress, { scaleX: 1, duration: 0.38 }, "settle+=0.12")
          .to(
            touch,
            {
              scale: 1,
              boxShadow: "0 0 42px rgba(95,75,255,.42)",
              duration: 0.46,
            },
            "settle+=0.16",
          );
      });

      return () => {
        window.cancelAnimationFrame(frame);
        generationTimelineRef.current?.kill();
        generationTimelineRef.current = null;
        const thumbnails = [...thumbRefs.current.values()];
        if (thumbnails.length > 0) {
          gsap.set(thumbnails, {
            clearProps: "opacity,transform,visibility",
          });
        }
      };
    },
    {
      scope: rootRef,
      dependencies: [generationKey, mode],
      revertOnUpdate: true,
    },
  );

  useGSAP(
    () => {
      if (mode !== "result" || !selectedCandidate) {
        return;
      }
      gsap.fromTo(
        previewRef.current,
        { autoAlpha: 0.72, scale: 0.992 },
        {
          autoAlpha: 1,
          scale: 1,
          duration: 0.42,
          ease: "power3.out",
        },
      );
    },
    {
      scope: rootRef,
      dependencies: [selectedCandidateId, mode],
      revertOnUpdate: true,
    },
  );

  const uploadFiles = async (files: File[]) => {
    if (requestInFlightRef.current) {
      return;
    }
    const allowed = files
      .filter((file) =>
        ["image/jpeg", "image/png", "image/webp"].includes(file.type),
      )
      .slice(0, Math.max(0, 6 - assets.length));
    if (allowed.length === 0) {
      setNotice(
        assets.length >= 6
          ? "Six photographs is the current maximum."
          : "Choose JPEG, PNG, or WebP images.",
      );
      return;
    }
    setMode("uploading");
    requestInFlightRef.current = true;
    setNotice("Uploading and analyzing photographs…");
    clearStoredComposition();
    let activeSessionId = sessionId;
    const uploaded: StudioAsset[] = [];
    try {
      for (const file of allowed) {
        const form = new FormData();
        form.set("file", file);
        if (activeSessionId) {
          form.set("sessionId", activeSessionId);
        }
        const response = await fetch("/api/assets", {
          method: "POST",
          body: form,
        });
        const result = await readApiResponse<{
          sessionId: string;
          asset: StudioAsset;
        }>(response);
        activeSessionId = result.sessionId;
        uploaded.push(result.asset);
      }
      if (activeSessionId) {
        setSessionId(activeSessionId);
        localStorage.setItem(SESSION_STORAGE_KEY, activeSessionId);
      }
      setAssets((current) => [...current, ...uploaded]);
      setNotice(
        uploaded.some((asset) => asset.analysisSource === "vision")
          ? "Semantic composition analysis complete."
          : "Image structure and color analysis complete.",
      );
    } catch (error) {
      if (activeSessionId && uploaded.length > 0) {
        setSessionId(activeSessionId);
        localStorage.setItem(SESSION_STORAGE_KEY, activeSessionId);
        setAssets((current) => [...current, ...uploaded]);
      }
      setNotice(
        error instanceof Error ? error.message : "Image upload failed.",
      );
    } finally {
      requestInFlightRef.current = false;
      setMode("idle");
    }
  };

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void uploadFiles(files);
  };

  const removeAsset = async (assetId: string) => {
    if (!sessionId || busy) {
      return;
    }
    clearStoredComposition();
    setMode("idle");
    setAssets((current) => current.filter((asset) => asset.id !== assetId));
    if (heroAssetId === assetId) {
      setHeroAssetId(undefined);
    }
    await fetch(`/api/assets/${encodeURIComponent(assetId)}`, {
      method: "DELETE",
      headers: { "x-one-touch-session": sessionId },
    }).catch(() => undefined);
  };

  const moveAsset = (assetId: string, offset: -1 | 1) => {
    setAssets((current) => {
      const sourceIndex = current.findIndex((asset) => asset.id === assetId);
      const targetIndex = sourceIndex + offset;
      if (
        sourceIndex < 0 ||
        targetIndex < 0 ||
        targetIndex >= current.length
      ) {
        return current;
      }
      const reordered = [...current];
      const [source] = reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, source);
      return reordered;
    });
    clearStoredComposition();
    setMode("idle");
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault();
    const sourceId = draggingId ?? event.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId) {
      setDraggingId(null);
      return;
    }
    setAssets((current) => {
      const sourceIndex = current.findIndex((asset) => asset.id === sourceId);
      const targetIndex = current.findIndex((asset) => asset.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) {
        return current;
      }
      const reordered = [...current];
      const [source] = reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, source);
      return reordered;
    });
    clearStoredComposition();
    setMode("idle");
    setDraggingId(null);
  };

  const beginGeneration = async () => {
    if (!canGenerate || !sessionId || requestInFlightRef.current) {
      setNotice(
        assets.length < 2
          ? "Add at least two photographs before touching."
          : targetError ?? "The composition is not ready yet.",
      );
      return;
    }
    requestInFlightRef.current = true;
    setMode("generating");
    setGenerationMessage("Reading image structure");
    setNotice(null);
    try {
      const response = await fetch("/api/compositions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          brief: buildBrief(target, prompt, heroAssetId, profile),
          assetIds: assets.map((asset) => asset.id),
        }),
      });
      const result = await readApiResponse<{ composition: CompositionView }>(
        response,
      );
      setComposition(result.composition);
      const firstCandidateId = result.composition.candidates[0]?.id ?? null;
      setSelectedCandidateId(firstCandidateId);
      localStorage.setItem(COMPOSITION_STORAGE_KEY, result.composition.id);
      setGenerationKey((value) => value + 1);
    } catch (error) {
      setMode("idle");
      setNotice(
        error instanceof Error ? error.message : "Composition failed.",
      );
    } finally {
      requestInFlightRef.current = false;
    }
  };

  const refineSelectedCandidate = async () => {
    if (
      !composition ||
      !selectedCandidate ||
      !sessionId ||
      !refineInstruction.trim() ||
      mode === "refining" ||
      requestInFlightRef.current
    ) {
      return;
    }
    requestInFlightRef.current = true;
    setMode("refining");
    setNotice("Applying your instruction to the selected composition…");
    try {
      const response = await fetch(
        `/api/compositions/${encodeURIComponent(composition.id)}/refine`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            candidateId: selectedCandidate.id,
            instruction: refineInstruction.trim(),
            locked: {
              target: true,
              heroAsset: Boolean(heroAssetId),
              safeAreas: true,
            },
          }),
        },
      );
      const result = await readApiResponse<{
        composition: CompositionView;
        candidate: LayoutCandidate;
      }>(response);
      setComposition(result.composition);
      setSelectedCandidateId(result.candidate.id);
      setRefineInstruction("");
      setMode("result");
      setNotice("Refinement applied. The previous layout remains in history.");
    } catch (error) {
      setMode("result");
      setNotice(
        error instanceof Error ? error.message : "Refinement failed.",
      );
    } finally {
      requestInFlightRef.current = false;
    }
  };

  const undoSelectedRefinement = async () => {
    if (
      !composition ||
      !selectedCandidate ||
      !sessionId ||
      composition.canUndoCandidateId !== selectedCandidate.id ||
      requestInFlightRef.current
    ) {
      return;
    }
    requestInFlightRef.current = true;
    setMode("refining");
    setNotice("Restoring the previous composition…");
    try {
      const response = await fetch(
        `/api/compositions/${encodeURIComponent(composition.id)}/undo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            candidateId: selectedCandidate.id,
          }),
        },
      );
      const result = await readApiResponse<{
        composition: CompositionView;
        candidate: LayoutCandidate;
      }>(response);
      setComposition(result.composition);
      setSelectedCandidateId(result.candidate.id);
      setMode("result");
      setNotice("Previous composition restored.");
    } catch (error) {
      setMode("result");
      setNotice(
        error instanceof Error ? error.message : "Undo failed.",
      );
    } finally {
      requestInFlightRef.current = false;
    }
  };

  const startNewComposition = async () => {
    if (busy || requestInFlightRef.current) {
      return;
    }
    const currentSessionId = sessionId;
    const currentCompositionId = composition?.id;
    const currentAssets = [...assets];
    setMode("idle");
    setAssets([]);
    setComposition(null);
    setSelectedCandidateId(null);
    setSessionId(null);
    setHeroAssetId(undefined);
    setPrompt("");
    setNotice("New composition ready.");
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(COMPOSITION_STORAGE_KEY);
    if (currentSessionId && currentCompositionId) {
      void fetch(
        `/api/compositions/${encodeURIComponent(currentCompositionId)}`,
        {
          method: "DELETE",
          headers: { "x-one-touch-session": currentSessionId },
        },
      );
    }
    if (currentSessionId) {
      currentAssets.forEach((asset) => {
        void fetch(`/api/assets/${encodeURIComponent(asset.id)}`, {
          method: "DELETE",
          headers: { "x-one-touch-session": currentSessionId },
        });
      });
    }
  };

  const downloadWallpaper = async () => {
    if (!selectedCandidate || isExporting) {
      return;
    }
    setIsExporting(true);
    setNotice("Rendering the selected layout at its target resolution…");
    try {
      const { layout } = selectedCandidate;
      const canvas = document.createElement("canvas");
      canvas.width = layout.canvas.width;
      canvas.height = layout.canvas.height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas rendering is unavailable");
      }
      context.fillStyle = layout.canvas.backgroundColor;
      context.fillRect(0, 0, canvas.width, canvas.height);
      const images = new Map<string, HTMLImageElement>();
      await Promise.all(
        assets.map(async (asset) => {
          images.set(asset.id, await loadImage(asset.contentUrl));
        }),
      );
      const polygonByAssetId = new Map(
        assets.flatMap((asset) => {
          const polygon = subjectPolygonOf(asset.analysis);
          return polygon ? ([[asset.id, polygon]] as const) : [];
        }),
      );

      [...layout.items]
        .sort((left, right) => left.zIndex - right.zIndex)
        .forEach((item) => {
          const image = images.get(item.assetId);
          if (!image) {
            return;
          }
          const crop = item.crop ?? {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          };
          // Protocol treatments: full = contain without cropping, cutout =
          // contain + subject-polygon clip (Path2D), crop = cover crop.
          // fit=contain (treatment crop) also lands on the contain branch.
          // Without a subject polygon a cutout degrades to plain contain so
          // the subject stays whole instead of being sliced by a cover crop.
          const polygon =
            item.treatment === "cutout"
              ? polygonByAssetId.get(item.assetId) ?? null
              : null;
          const placement =
            item.treatment === "crop" && item.fit === "cover"
              ? null
              : computeSlotPlacement({
                  slot: {
                    x: item.x,
                    y: item.y,
                    width: item.width,
                    height: item.height,
                  },
                  imageSize: {
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                  },
                  crop: item.crop,
                  polygon,
                });
          const centerX = item.x + item.width / 2;
          const centerY = item.y + item.height / 2;
          context.save();
          context.translate(centerX, centerY);
          context.rotate((item.rotation * Math.PI) / 180);
          context.translate(-centerX, -centerY);
          roundedRectPath(
            context,
            item.x,
            item.y,
            item.width,
            item.height,
            item.mask?.radius ?? item.style?.radius ?? 0,
          );
          context.clip();
          context.globalAlpha = item.opacity;
          if (placement) {
            if (placement.polygonPoints) {
              const clipPath = new Path2D();
              placement.polygonPoints.forEach((point, index) => {
                if (index === 0) {
                  clipPath.moveTo(point.x, point.y);
                } else {
                  clipPath.lineTo(point.x, point.y);
                }
              });
              clipPath.closePath();
              context.clip(clipPath);
            }
            context.drawImage(
              image,
              placement.imageRect.x,
              placement.imageRect.y,
              placement.imageRect.width,
              placement.imageRect.height,
            );
          } else {
            context.drawImage(
              image,
              crop.x * image.naturalWidth,
              crop.y * image.naturalHeight,
              crop.width * image.naturalWidth,
              crop.height * image.naturalHeight,
              item.x,
              item.y,
              item.width,
              item.height,
            );
          }
          context.restore();
        });

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) {
        throw new Error("The wallpaper could not be encoded");
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `one-touch-${layout.canvas.width}x${layout.canvas.height}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setNotice("Wallpaper downloaded.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Wallpaper export failed.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const modeLabel =
    mode === "uploading"
      ? "Analyzing assets"
      : mode === "generating"
        ? "Synthesizing composition"
        : mode === "refining"
          ? "Refining selected layout"
          : composition
            ? "Composition ready"
            : `${assets.length} / 6 assets`;

  return (
    <main
      ref={rootRef}
      className={styles.studio}
      data-mode={mode}
      aria-busy={
        mode === "uploading" ||
        mode === "generating" ||
        mode === "refining"
      }
    >
      <div className={styles.ambient} aria-hidden="true">
        <span className={styles.ambientOrbA} />
        <span className={styles.ambientOrbB} />
        <span className={styles.ambientGrid} />
        <span className={styles.ambientArc} />
      </div>

      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="One Touch home">
          <span className={styles.brandMark}>
            <OrbitMark />
          </span>
          <span>one touch</span>
        </Link>
        <div className={styles.headerCenter}>
          <span>AI wallpaper composer</span>
          <i />
          <span>24h private session</span>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.headerStatus}>
            <i />
            {isRestoring ? "Restoring session" : modeLabel}
          </span>
          <button
            type="button"
            onClick={startNewComposition}
            disabled={busy}
          >
            New composition
          </button>
        </div>
      </header>

      <section className={styles.workspace}>
        <div className={styles.composerShell}>
          <aside className={styles.controlPanel}>
            <div className={styles.controlIntro}>
              <span className={styles.modeBadge}>
                <SparkIcon />
                Composition brief
              </span>
              <p>One input. Three spatial answers.</p>
              <h1>
                Describe the feeling.
                <span>We compose the space.</span>
              </h1>
            </div>

            <section className={styles.controlSection}>
              <div className={styles.sectionHeading}>
                <span>01</span>
                <div>
                  <h2>Target screen</h2>
                  <p>Choose where this wallpaper will live.</p>
                </div>
              </div>
              <div className={styles.targetGrid}>
                {TARGET_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset.label}
                    className={
                      !customTarget &&
                      target.ratioId === preset.ratioId &&
                      target.usage === preset.usage
                        ? styles.optionActive
                        : ""
                    }
                    onClick={() => {
                      setTarget(preset);
                      setCustomTarget(false);
                      clearStoredComposition();
                      setMode("idle");
                    }}
                    disabled={busy}
                  >
                    <strong>{preset.label}</strong>
                    <small>{preset.hint}</small>
                  </button>
                ))}
                <button
                  type="button"
                  className={customTarget ? styles.optionActive : ""}
                  onClick={() => {
                    setCustomTarget(true);
                    setTarget({
                      ratioId: "custom",
                      width: 1920,
                      height: 1200,
                      usage: "desktop",
                    });
                    clearStoredComposition();
                    setMode("idle");
                  }}
                  disabled={busy}
                >
                  <strong>Custom</strong>
                  <small>W × H</small>
                </button>
              </div>
              {customTarget ? (
                <div className={styles.customSize}>
                  <label>
                    <span>Width</span>
                    <input
                      type="number"
                      min={720}
                      max={7680}
                      value={target.width}
                      onChange={(event) =>
                        setTarget((current) => ({
                          ...current,
                          width: Number(event.target.value),
                        }))
                      }
                      disabled={busy}
                    />
                  </label>
                  <i>×</i>
                  <label>
                    <span>Height</span>
                    <input
                      type="number"
                      min={720}
                      max={7680}
                      value={target.height}
                      onChange={(event) =>
                        setTarget((current) => ({
                          ...current,
                          height: Number(event.target.value),
                        }))
                      }
                      disabled={busy}
                    />
                  </label>
                </div>
              ) : null}
              {targetError ? (
                <p className={styles.fieldError}>{targetError}</p>
              ) : null}
            </section>

            <section className={styles.controlSection}>
              <div className={styles.sectionHeading}>
                <span>02</span>
                <div>
                  <h2>Composition intent</h2>
                  <p>Optional language. Blank means fully automatic.</p>
                </div>
              </div>
              <textarea
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  clearStoredComposition();
                }}
                maxLength={1200}
                disabled={busy}
                placeholder="e.g. Keep the person intact, leave quiet space on the right, make it feel like a magazine spread."
              />
              <div className={styles.intentProfiles}>
                {(Object.keys(PROFILE_CONFIG) as CompositionIntentProfile[]).map(
                  (item) => (
                    <button
                      type="button"
                      key={item}
                      className={profile === item ? styles.optionActive : ""}
                      onClick={() => {
                        setProfile(item);
                        clearStoredComposition();
                      }}
                      disabled={busy}
                    >
                      {PROFILE_CONFIG[item].label}
                    </button>
                  ),
                )}
              </div>
            </section>

            <div className={styles.touchZone}>
              <div>
                <span>{assets.length >= 2 ? "Ready for touch" : "Add 2–6 images"}</span>
                <p>
                  {target.width} × {target.height} · {PROFILE_CONFIG[profile].label}
                </p>
              </div>
              <button
                ref={touchRef}
                className={styles.touchButton}
                type="button"
                disabled={!canGenerate}
                onClick={() => void beginGeneration()}
              >
                <span className={styles.touchPulse} />
                <span className={styles.touchIcon}>
                  <SparkIcon />
                </span>
                <strong>
                  {mode === "generating" ? "THINKING" : "TOUCH"}
                </strong>
              </button>
            </div>
          </aside>

          <section className={styles.previewPanel}>
            <div className={styles.previewHeading}>
              <div>
                <span>Live composition field</span>
                <h2>
                  {selectedCandidate?.label ?? "Awaiting visual material"}
                </h2>
                {selectedCandidate ? (
                  <p>{selectedCandidate.reason}</p>
                ) : null}
              </div>
              <div className={styles.previewMeta}>
                <span>{target.ratioId}</span>
                <span>
                  {target.width} × {target.height}
                </span>
                <span>{composition?.source === "ai" ? "AI plan" : "Recipe engine"}</span>
              </div>
            </div>

            <div className={styles.previewViewport}>
              <div
                ref={previewRef}
                className={styles.wallpaperPreview}
                style={{
                  aspectRatio: `${target.width} / ${target.height}`,
                  width:
                    target.width < target.height
                      ? `min(100%, ${(target.width / target.height) * 58}vh)`
                      : "100%",
                }}
              >
                {selectedCandidate ? (
                  <>
                    <div
                      className={styles.layoutCanvas}
                      style={{
                        backgroundColor:
                          selectedCandidate.layout.canvas.backgroundColor,
                      }}
                      aria-label={`${selectedCandidate.label} wallpaper preview`}
                    >
                      {[...selectedCandidate.layout.items]
                        .sort((left, right) => left.zIndex - right.zIndex)
                        .map((item) => {
                          const asset = imageForItem(item, assetById);
                          const focalPoint = item.crop?.focalPoint;
                          return (
                            <div
                              ref={(element) => {
                                if (element) {
                                  slotRefs.current.set(item.assetId, element);
                                } else {
                                  slotRefs.current.delete(item.assetId);
                                }
                              }}
                              className={styles.layoutSlot}
                              key={`${selectedCandidate.id}-${item.id}`}
                              style={
                                {
                                  left: `${(item.x / selectedCandidate.layout.canvas.width) * 100}%`,
                                  top: `${(item.y / selectedCandidate.layout.canvas.height) * 100}%`,
                                  width: `${(item.width / selectedCandidate.layout.canvas.width) * 100}%`,
                                  height: `${(item.height / selectedCandidate.layout.canvas.height) * 100}%`,
                                  zIndex: item.zIndex,
                                  rotate: `${item.rotation}deg`,
                                  borderRadius:
                                    item.mask?.type === "rounded-rect"
                                      ? "2.2%"
                                      : 0,
                                } as CSSProperties
                              }
                            >
                              {asset ? (
                                <NextImage
                                  src={asset.contentUrl}
                                  alt=""
                                  fill
                                  unoptimized
                                  sizes="(max-width: 860px) 100vw, 70vw"
                                  draggable={false}
                                  style={{
                                    objectPosition: focalPoint
                                      ? `${focalPoint.x * 100}% ${focalPoint.y * 100}%`
                                      : "50% 50%",
                                  }}
                                />
                              ) : null}
                              <span>{item.role}</span>
                            </div>
                          );
                        })}
                    </div>
                    <div className={styles.safeAreaOverlay} aria-hidden="true">
                      {selectedCandidate.layout.safeAreas.map((area) => (
                        <span
                          key={area.id}
                          style={{
                            left: `${(area.x / selectedCandidate.layout.canvas.width) * 100}%`,
                            top: `${(area.y / selectedCandidate.layout.canvas.height) * 100}%`,
                            width: `${(area.width / selectedCandidate.layout.canvas.width) * 100}%`,
                            height: `${(area.height / selectedCandidate.layout.canvas.height) * 100}%`,
                          }}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className={styles.emptyPreview}>
                    <span>
                      <SparkIcon />
                    </span>
                    <strong>
                      {isRestoring
                        ? "Restoring your composition"
                        : assets.length < 2
                          ? "Select photographs to begin"
                          : "Ready for one touch"}
                    </strong>
                    <p>
                      Real layout slots, protected regions and crop decisions
                      will appear here.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {(mode === "generating" || mode === "refining") && (
              <div className={styles.generationStrip} role="status">
                <span className={styles.spinner} />
                <strong>
                  {mode === "refining"
                    ? "Recompiling selected recipe"
                    : generationMessage}
                </strong>
                <i>
                  <span ref={progressRef} />
                </i>
              </div>
            )}

            {composition ? (
              <div className={styles.resultPanel}>
                <div className={styles.candidateRail}>
                  {composition.candidates.map((candidate, index) => (
                    <button
                      type="button"
                      key={candidate.id}
                      className={
                        candidate.id === selectedCandidate?.id
                          ? styles.candidateActive
                          : ""
                      }
                      onClick={() => {
                        if (mode === "generating" || mode === "refining") {
                          return;
                        }
                        setSelectedCandidateId(candidate.id);
                      }}
                    >
                      <span>0{index + 1}</span>
                      <div>
                        <strong>{candidate.label}</strong>
                        <small>
                          {candidate.layout.template?.recipe?.family ??
                            candidate.layout.template?.type}
                        </small>
                      </div>
                      <i />
                    </button>
                  ))}
                </div>

                <div className={styles.resultActions}>
                  <label className={styles.refineField}>
                    <span>Refine with language</span>
                    <input
                      value={refineInstruction}
                      onChange={(event) =>
                        setRefineInstruction(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void refineSelectedCandidate();
                        }
                      }}
                      placeholder="More whitespace, larger hero, keep faces…"
                      disabled={mode === "refining"}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void refineSelectedCandidate()}
                    disabled={
                      !refineInstruction.trim() || mode === "refining"
                    }
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => void undoSelectedRefinement()}
                    disabled={
                      composition.canUndoCandidateId !==
                        selectedCandidate?.id || mode === "refining"
                    }
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    className={styles.downloadAction}
                    onClick={() => void downloadWallpaper()}
                    disabled={isExporting}
                  >
                    <DownloadIcon />
                    {isExporting ? "Rendering…" : "Download"}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <section
          className={styles.assetDock}
          aria-busy={mode === "uploading"}
        >
          <div className={styles.dockHeading}>
            <div>
              <span>03</span>
              <div>
                <h2>Visual material</h2>
                <p>
                  Drag to reorder · mark one hero · JPEG, PNG or WebP · 24h
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={assets.length >= 6 || busy}
            >
              <PlusIcon />
              Add photos
            </button>
          </div>

          <div
            className={styles.assetTrack}
            onDragOver={(event) => event.preventDefault()}
          >
            {assets.map((asset, index) => (
              <div
                ref={(element) => {
                  if (element) {
                    thumbRefs.current.set(asset.id, element);
                  } else {
                    thumbRefs.current.delete(asset.id);
                  }
                }}
                className={`${styles.assetCard} ${
                  draggingId === asset.id ? styles.assetDragging : ""
                } ${heroAssetId === asset.id ? styles.assetHero : ""}`}
                key={asset.id}
                draggable={!busy}
                onDragStart={(event) => {
                  if (busy) {
                    event.preventDefault();
                    return;
                  }
                  setDraggingId(asset.id);
                  event.dataTransfer.setData("text/plain", asset.id);
                }}
                onDragEnd={() => setDraggingId(null)}
                onDrop={(event) => handleDrop(event, asset.id)}
              >
                <NextImage
                  src={asset.thumbnailUrl}
                  alt={asset.name}
                  fill
                  unoptimized
                  sizes="(max-width: 620px) 50vw, 16vw"
                />
                <span className={styles.assetOrder}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <button
                  type="button"
                  className={styles.heroToggle}
                  aria-pressed={heroAssetId === asset.id}
                  onClick={() => {
                    setHeroAssetId((current) =>
                      current === asset.id ? undefined : asset.id,
                    );
                    clearStoredComposition();
                    setMode("idle");
                  }}
                  disabled={busy}
                >
                  {heroAssetId === asset.id ? "Hero" : "Set hero"}
                </button>
                <div className={styles.assetControls}>
                  <button
                    type="button"
                    onClick={() => moveAsset(asset.id, -1)}
                    disabled={index === 0 || busy}
                    aria-label={`Move ${asset.name} earlier`}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => moveAsset(asset.id, 1)}
                    disabled={index === assets.length - 1 || busy}
                    aria-label={`Move ${asset.name} later`}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeAsset(asset.id)}
                    aria-label={`Remove ${asset.name}`}
                    disabled={busy}
                  >
                    ×
                  </button>
                </div>
                <div className={styles.assetInfo}>
                  <strong>{asset.name}</strong>
                  <span>
                    {asset.analysisSource === "vision" ? "semantic" : "basic"} ·{" "}
                    {asset.analysis.orientation}
                  </span>
                </div>
              </div>
            ))}

            {assets.length < 6 ? (
              <button
                type="button"
                className={styles.addCard}
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                <span>
                  <PlusIcon />
                </span>
                <strong>
                  {mode === "uploading" ? "Analyzing…" : "Add material"}
                </strong>
                <small>{assets.length} / 6 selected</small>
              </button>
            ) : null}
          </div>

          <input
            ref={fileInputRef}
            className={styles.fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={handleFiles}
            disabled={busy || assets.length >= 6}
          />
        </section>
      </section>

      <div className={styles.flyingLayer} aria-hidden="true">
        {assets.map((asset) => (
          <div
            ref={(element) => {
              if (element) {
                flightRefs.current.set(asset.id, element);
              } else {
                flightRefs.current.delete(asset.id);
              }
            }}
            className={styles.flightCard}
            key={`${asset.id}-flight`}
            style={{ backgroundImage: `url("${asset.thumbnailUrl}")` }}
          />
        ))}
      </div>

      <footer className={styles.footer}>
        <span aria-live="polite">
          {notice ??
            "Images are private to this session and expire automatically after 24 hours."}
        </span>
        <a href="https://deerflow.tech" target="_blank" rel="noreferrer">
          Created by Deerflow
        </a>
      </footer>
    </main>
  );
}
