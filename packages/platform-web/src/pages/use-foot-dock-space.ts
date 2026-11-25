import { computed, inject, onBeforeUnmount, provide, ref, watch, type Ref } from "vue";
import { pageDockSpaceKey } from "@ontomato/agent-shell-ui";

/**
 * Measures a page's floating foot (`PageComposer` or custom foot slot) and publishes its live pixel height through
 * `--pane-dock-space` and `pageDockSpaceKey` — the same single contract `ShellPagePane` owns beside a conversation.
 * When no foot is mounted (for example inside `ShellPagePane`), it yields to any ancestor's measurement without
 * overriding `--pane-dock-space`.
 */
export function useFootDockSpace(foot: Ref<HTMLElement | null>) {
  const parentDockSpace = inject(pageDockSpaceKey, null);
  const ownSpace = ref(0);
  const measure = (element: HTMLElement | null) => {
    ownSpace.value = element ? Math.ceil(element.offsetHeight) : 0;
  };
  const observer = typeof ResizeObserver === "function"
    ? new ResizeObserver(([entry]) => measure((entry?.target as HTMLElement | undefined) ?? foot.value))
    : null;
  watch(
    foot,
    (element, previous) => {
      if (previous) observer?.unobserve(previous);
      measure(element);
      if (element) observer?.observe(element);
    },
    { flush: "post" },
  );
  onBeforeUnmount(() => observer?.disconnect());
  const dockSpace = computed(() => (foot.value ? ownSpace.value : parentDockSpace?.value ?? 0));
  provide(pageDockSpaceKey, dockSpace);
  const dockStyle = computed(() => (foot.value ? { "--pane-dock-space": `${ownSpace.value}px` } : undefined));
  return { dockSpace, dockStyle };
}
