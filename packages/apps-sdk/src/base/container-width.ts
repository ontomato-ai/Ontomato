import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

/**
 * Observes a layout container's own inline width via `ResizeObserver` and resolves its CSS breakpoint token (falling
 * back to `fallbackPx` when custom properties are absent, such as in headless unit tests). Never reads `window.innerWidth`.
 */
export function useContainerWidth(
  element: Ref<HTMLElement | null>,
  breakpointToken: `--${string}`,
  fallbackPx: number,
) {
  const width = ref(0);
  const breakpoint = ref(fallbackPx);
  let observer: ResizeObserver | null = null;

  function readBreakpoint(el: HTMLElement) {
    if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return;
    const raw = window.getComputedStyle(el).getPropertyValue(breakpointToken).trim();
    const parsed = Number.parseFloat(raw);
    breakpoint.value = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackPx;
  }

  function measure(el: HTMLElement) {
    readBreakpoint(el);
    const rectWidth = el.getBoundingClientRect().width;
    width.value = rectWidth > 0 ? rectWidth : el.clientWidth;
  }

  function disconnect() {
    observer?.disconnect();
    observer = null;
  }

  function attach(el: HTMLElement | null) {
    disconnect();
    if (!el) return;
    measure(el);
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        readBreakpoint(el);
        width.value = entry.contentRect.width;
      });
      observer.observe(el);
    }
  }

  onMounted(() => attach(element.value));
  watch(element, (next) => attach(next));
  onBeforeUnmount(disconnect);

  return { width, breakpoint };
}
