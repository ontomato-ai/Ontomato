import { ref, watch } from "vue";

/**
 * Process views open while their work runs and fold once it ends. A block that is already finished
 * when it mounts (history) starts folded. After the user toggles it, their choice stands.
 */
export function useAutoFold(active: () => boolean) {
  const open = ref(active());
  let touched = false;
  watch(active, (running) => {
    if (!touched) open.value = running;
  });
  function toggle() {
    touched = true;
    open.value = !open.value;
  }
  return { open, toggle };
}
