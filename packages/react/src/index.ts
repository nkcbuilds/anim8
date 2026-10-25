import { describeScene, type DescribeSceneOptions } from "@anim8/a11y";
import {
  createElement,
  useEffect,
  useRef,
  type HTMLAttributes,
  type RefObject,
} from "react";
import {
  mountPlayer,
  type PlayerController,
  type PlayerOptions,
} from "@anim8/player";
import { renderSceneAt } from "@anim8/renderer-svg";

export type Anim8Scene = Parameters<typeof mountPlayer>[1];

export interface UseAnim8PlayerOptions extends PlayerOptions {
  initialTime?: number;
}

export interface UseAnim8PlayerResult {
  containerRef: RefObject<HTMLDivElement | null>;
  controllerRef: RefObject<PlayerController | null>;
}

export interface Anim8PlayerProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "dangerouslySetInnerHTML"> {
  scene: Anim8Scene;
  initialTime?: number;
  options?: PlayerOptions;
  /** Deterministic accessible scene summary. Set false to disable the generated label. */
  accessibility?: false | Omit<DescribeSceneOptions, "time" | "context">;
}

function normalizedInitialTime(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function useAnim8Player(
  scene: Anim8Scene,
  options: UseAnim8PlayerOptions = {},
): UseAnim8PlayerResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<PlayerController | null>(null);
  const onFrameRef = useRef(options.onFrame);
  onFrameRef.current = options.onFrame;

  const {
    autoplay = false,
    initialTime,
    loop,
    reducedMotion,
    speed,
  } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const controller = mountPlayer(container, scene, {
      autoplay: false,
      ...(loop !== undefined ? { loop } : {}),
      ...(reducedMotion !== undefined ? { reducedMotion } : {}),
      ...(speed !== undefined ? { speed } : {}),
      onFrame: (frame) => onFrameRef.current?.(frame),
    });

    controllerRef.current = controller;
    const startTime = normalizedInitialTime(initialTime);
    if (startTime > 0) controller.seek(startTime);
    if (autoplay) controller.play();

    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
      controller.destroy();
    };
  }, [autoplay, initialTime, loop, reducedMotion, scene, speed]);

  return { containerRef, controllerRef };
}

export function Anim8Player({
  scene,
  initialTime = 0,
  options,
  accessibility,
  ...hostProps
}: Anim8PlayerProps) {
  const { containerRef } = useAnim8Player(scene, {
    ...options,
    initialTime,
  });
  const time = normalizedInitialTime(initialTime);
  const svg = renderSceneAt(scene, time);
  const summary = accessibility === false
    ? undefined
    : describeScene(scene, { time, ...(accessibility ?? {}) });
  const generatedLabel = summary?.text;

  return createElement("div", {
    ...hostProps,
    ...(generatedLabel && hostProps["aria-label"] === undefined ? { "aria-label": generatedLabel } : {}),
    ...(generatedLabel && hostProps.role === undefined ? { role: "group" } : {}),
    ref: containerRef,
    "data-anim8-player": "",
    dangerouslySetInnerHTML: { __html: svg },
  });
}
