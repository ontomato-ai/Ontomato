import { onBeforeUnmount, ref } from "vue";

/**
 * Width of a right-hand panel that the reader drags from its left edge.
 *
 * The handle captures the pointer, so the drag follows and ends wherever the pointer goes, the release included. While
 * `resizing`, the panel's content must not take the pointer (`pointer-events: none`): an iframe in it (an app's
 * preview, an HTML card) would otherwise receive the moves and the release in its own document.
 */
export function usePanelWidth() {
  const width = ref(Math.round(Math.min(Math.max(window.innerWidth * 0.42, 420), 760)));
  const resizing = ref(false);
  let drag: { handle: HTMLElement; x: number; width: number } | null = null;

  function resize(event: PointerEvent) {
    const next = drag!.width + (drag!.x - event.clientX);
    width.value = Math.min(Math.max(next, 360), Math.round(window.innerWidth * 0.7));
  }
  function stopResize() {
    if (!drag) return;
    drag.handle.removeEventListener("pointermove", resize);
    drag.handle.removeEventListener("lostpointercapture", stopResize);
    drag = null;
    resizing.value = false;
  }
  function startResize(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement;
    drag = { handle, x: event.clientX, width: width.value };
    resizing.value = true;
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", resize);
    // Releasing the pointer ends the capture; so does anything else that takes it away.
    handle.addEventListener("lostpointercapture", stopResize);
  }
  onBeforeUnmount(stopResize);
  return { width, resizing, startResize };
}
