import { onBeforeUnmount, ref } from "vue";

/** Width of a right-hand panel that the reader drags from its left edge. */
export function usePanelWidth() {
  const width = ref(Math.round(Math.min(Math.max(window.innerWidth * 0.42, 420), 760)));
  let dragStart: { x: number; width: number } | null = null;

  function resize(event: PointerEvent) {
    if (!dragStart) return;
    const next = dragStart.width + (dragStart.x - event.clientX);
    width.value = Math.min(Math.max(next, 360), Math.round(window.innerWidth * 0.7));
  }
  function stopResize() {
    dragStart = null;
    window.removeEventListener("pointermove", resize);
  }
  function startResize(event: PointerEvent) {
    dragStart = { x: event.clientX, width: width.value };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize, { once: true });
  }
  onBeforeUnmount(stopResize);
  return { width, startResize };
}
