import { computed, onBeforeUnmount, onMounted, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from "vue";

export interface UsePanelNarrowOptions {
  /** Design token CSS variable defining the narrow breakpoint (default `"--pane-narrow-breakpoint"`). */
  readonly token?: `--${string}`;
}

const DEFAULT_BREAKPOINT_TOKEN: `--${string}` = "--pane-narrow-breakpoint";
const TOKEN_FALLBACK_PX: Readonly<Record<string, number>> = {
  "--pane-narrow-breakpoint": 680,
  "--workbench-narrow-breakpoint": 880,
};
const DEFAULT_FALLBACK_PX = 680;

function parseLengthPx(raw: string): number {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return Number.NaN;
  if (raw.endsWith("rem") && typeof document !== "undefined") {
    const rootSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    return value * (Number.isFinite(rootSize) && rootSize > 0 ? rootSize : 16);
  }
  return value;
}

/**
 * Observes a panel container element's own inline width via `ResizeObserver` and reports whether it is narrow
 * (`width > 0` and `width <= breakpoint`), resolving the breakpoint from a CSS design token on that element
 * (default `--pane-narrow-breakpoint`). Never reads `window.innerWidth`.
 *
 * ```js
 * const rootRef = ref(null);
 * const narrow = usePanelNarrow(rootRef);
 * // For a three-pane workbench container:
 * const narrow = usePanelNarrow(rootRef, { token: "--workbench-narrow-breakpoint" });
 * ```
 */
export function usePanelNarrow(
  element: MaybeRefOrGetter<HTMLElement | null | undefined>,
  options: UsePanelNarrowOptions = {},
): ComputedRef<boolean> {
  const token = options.token ?? DEFAULT_BREAKPOINT_TOKEN;
  const fallbackPx = TOKEN_FALLBACK_PX[token] ?? DEFAULT_FALLBACK_PX;
  const width = ref(0);
  const breakpoint = ref(fallbackPx);
  let observer: ResizeObserver | null = null;
  let currentElement: HTMLElement | null = null;

  function readBreakpoint(el: HTMLElement) {
    if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return;
    const raw = window.getComputedStyle(el).getPropertyValue(token).trim();
    const parsed = parseLengthPx(raw);
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
    currentElement = null;
  }

  function attach(el: HTMLElement | null) {
    if (el === currentElement) return;
    disconnect();
    if (!el) {
      width.value = 0;
      return;
    }
    currentElement = el;
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

  onMounted(() => attach(toValue(element) ?? null));
  watch(() => toValue(element) ?? null, (next) => attach(next));
  onBeforeUnmount(disconnect);

  return computed(() => width.value > 0 && width.value <= breakpoint.value);
}
