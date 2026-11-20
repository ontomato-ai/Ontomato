import { onBeforeUnmount, ref } from "vue";

const MIN_WIDTH = 360;
const MAX_SHARE = 0.7;
/** How far past a bound the pointer goes before releasing there switches the panel's state. */
const SNAP_DISTANCE = 80;

/** Past which bound a drag went: the wide one (the panel takes the whole area) or the narrow one (the panel goes). */
export type PanelSnap = "expand" | "close";

/**
 * Width of a right-hand panel that the reader drags from its left edge.
 *
 * The handle captures the pointer, so the drag follows and ends wherever the pointer goes, the release included. While
 * `resizing`, the panel's content must not take the pointer (`pointer-events: none`): an iframe in it (an app's
 * preview, an HTML card) would otherwise receive the moves and the release in its own document.
 *
 * With `snap`, the width stops at its bounds, and a drag carried on SNAP_DISTANCE past one is a request to leave the
 * side: `beyond` names it while the pointer is there, and releasing there calls `snap` with the width as the drag found
 * it, so the side comes back at that width. A drag the browser cancels, or whose capture is lost otherwise, only ends.
 */
export function usePanelWidth(snap?: (edge: PanelSnap) => void) {
  const width = ref(Math.round(Math.min(Math.max(window.innerWidth * 0.42, 420), 760)));
  const resizing = ref(false);
  const beyond = ref<PanelSnap | null>(null);
  let drag: { handle: HTMLElement; x: number; width: number; storedWidth: number; max: number } | null = null;

  function resize(event: PointerEvent) {
    const next = drag!.width + (drag!.x - event.clientX);
    const max = drag!.max;
    const min = Math.min(MIN_WIDTH, max);
    width.value = Math.min(Math.max(next, min), max);
    if (snap) beyond.value = next > max + SNAP_DISTANCE ? "expand" : next < min - SNAP_DISTANCE ? "close" : null;
  }
  function stopResize() {
    if (!drag) return;
    drag.handle.removeEventListener("pointermove", resize);
    drag.handle.removeEventListener("pointerup", release);
    drag.handle.removeEventListener("lostpointercapture", stopResize);
    drag = null;
    resizing.value = false;
    beyond.value = null;
  }
  function release() {
    const edge = beyond.value;
    const start = drag!.storedWidth;
    stopResize();
    if (!edge) return;
    width.value = start;
    snap!(edge);
  }
  function startResize(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement;
    const panel = handle.parentElement;
    const cssMax = panel ? getComputedStyle(panel).maxWidth : "";
    const viewportMax = Math.round(window.innerWidth * MAX_SHARE);
    const max = cssMax.endsWith("px") ? Math.min(viewportMax, Math.floor(parseFloat(cssMax))) : viewportMax;
    drag = { handle, x: event.clientX, width: panel?.offsetWidth || width.value, storedWidth: width.value, max };
    resizing.value = true;
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", resize);
    handle.addEventListener("pointerup", release);
    handle.addEventListener("lostpointercapture", stopResize);
  }
  onBeforeUnmount(stopResize);
  return { width, resizing, beyond, startResize };
}
