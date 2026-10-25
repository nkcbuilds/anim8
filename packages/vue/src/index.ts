import { describeScene, type DescribeSceneOptions } from "@anim8/a11y";
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  toRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type PropType,
  type Ref,
  type ShallowRef,
} from "vue";
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
  containerRef: Ref<HTMLDivElement | null>;
  controllerRef: ShallowRef<PlayerController | null>;
}

function normalizedInitialTime(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function useAnim8Player(
  scene: MaybeRefOrGetter<Anim8Scene>,
  options: MaybeRefOrGetter<UseAnim8PlayerOptions> = {},
): UseAnim8PlayerResult {
  const containerRef = ref<HTMLDivElement | null>(null);
  const controllerRef = shallowRef<PlayerController | null>(null);
  let activeController: PlayerController | null = null;
  let isMounted = false;

  const destroy = () => {
    activeController?.destroy();
    activeController = null;
    controllerRef.value = null;
  };

  const mount = () => {
    if (!isMounted || !containerRef.value) return;

    destroy();

    const resolvedOptions = toValue(options);
    const controller = mountPlayer(containerRef.value, toValue(scene), {
      autoplay: false,
      ...(resolvedOptions.loop !== undefined ? { loop: resolvedOptions.loop } : {}),
      ...(resolvedOptions.reducedMotion !== undefined
        ? { reducedMotion: resolvedOptions.reducedMotion }
        : {}),
      ...(resolvedOptions.speed !== undefined ? { speed: resolvedOptions.speed } : {}),
      onFrame: (frame) => toValue(options).onFrame?.(frame),
    });

    activeController = controller;
    controllerRef.value = controller;

    const startTime = normalizedInitialTime(resolvedOptions.initialTime);
    if (startTime > 0) controller.seek(startTime);
    if (resolvedOptions.autoplay) controller.play();
  };

  onMounted(() => {
    isMounted = true;
    mount();
  });

  watch(
    [
      () => toValue(scene),
      () => {
        const resolved = toValue(options);
        return [
          resolved.autoplay,
          resolved.initialTime,
          resolved.loop,
          resolved.reducedMotion,
          resolved.speed,
        ] as const;
      },
    ],
    () => mount(),
  );

  onBeforeUnmount(() => {
    isMounted = false;
    destroy();
  });

  return { containerRef, controllerRef };
}

export const Anim8Player = defineComponent({
  name: "Anim8Player",
  inheritAttrs: false,
  props: {
    scene: {
      type: Object as PropType<Anim8Scene>,
      required: true,
    },
    initialTime: {
      type: Number,
      default: 0,
    },
    options: {
      type: Object as PropType<PlayerOptions>,
      default: () => ({}),
    },
    accessibility: {
      type: [Object, Boolean] as PropType<false | Omit<DescribeSceneOptions, "time" | "context">>,
      default: undefined,
    },
  },
  setup(props, { attrs }) {
    const resolvedOptions = computed<UseAnim8PlayerOptions>(() => ({
      ...props.options,
      initialTime: props.initialTime,
    }));
    const { containerRef } = useAnim8Player(toRef(props, "scene"), resolvedOptions);

    return () => {
      const time = normalizedInitialTime(props.initialTime);
      const summary = props.accessibility === false
        ? undefined
        : describeScene(props.scene, { time, ...(props.accessibility ?? {}) });
      const generatedLabel = summary?.text;
      return h("div", {
        ...attrs,
        ...(generatedLabel && attrs["aria-label"] === undefined ? { "aria-label": generatedLabel } : {}),
        ...(generatedLabel && attrs.role === undefined ? { role: "group" } : {}),
        ref: containerRef,
        "data-anim8-player": "",
        innerHTML: renderSceneAt(props.scene, time),
      });
    };
  },
});
