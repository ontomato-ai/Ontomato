import { onScopeDispose, readonly, shallowRef, type Ref } from "vue";

/**
 * Whether this tab is in the foreground, as the browser reports it (design "long connections" 2). It is the one switch
 * for a background tab: a hidden document — a tab in the background, a minimised window, a page leaving for the
 * back-forward cache — holds no long connection, and a visible one may follow its streams again. Two windows side by side
 * can both be visible, so focus and blur say nothing here, and whether a covered window counts as hidden is the browser's
 * call; a frame hidden by CSS is not a hidden document either.
 *
 * Only the switch lives here. Whether a view follows a stream at all, and what it reads back when it resumes, belongs to
 * the view that owns the stream.
 */
let visible: boolean | null = null;
const listeners = new Set<(visible: boolean) => void>();

function set(next: boolean) {
  if (next === visible) return;
  visible = next;
  for (const listener of [...listeners]) listener(next);
}

/** Starts following the browser's reports on first use; every caller shares what they say. */
function follow(): boolean {
  if (visible !== null) return visible;
  visible = document.visibilityState === "visible";
  const read = () => set(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", read);
  // Leaving for the back-forward cache keeps the page alive without showing it; coming back shows it as it is now.
  window.addEventListener("pagehide", () => set(false));
  window.addEventListener("pageshow", read);
  return visible;
}

/** Whether the tab is in the foreground now. */
export function documentVisible(): boolean {
  return follow();
}

/** Calls `listener` each time the tab goes to the background or comes back; the returned function stops that. */
export function onDocumentVisibility(listener: (visible: boolean) => void): () => void {
  follow();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The foreground state as a ref, for as long as the calling component (or effect scope) lives. */
export function useDocumentVisible(): Readonly<Ref<boolean>> {
  const state = shallowRef(follow());
  const stop = onDocumentVisibility((next) => (state.value = next));
  onScopeDispose(stop);
  return readonly(state);
}
