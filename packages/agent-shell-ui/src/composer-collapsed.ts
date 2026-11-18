import { ref, type Ref } from "vue";

/**
 * Whether the composer that floats over a page is folded into its round button: the reader's own choice, kept by this
 * browser the way the platform keeps its rail, so a page opens the way it was left. One choice for every floating
 * composer — the page's own foot and the conversation's over a full page. Each composer reads it when it is drawn.
 */
const KEY = "ontomato.shell.composerCollapsed";

export function useComposerCollapsed(): { collapsed: Readonly<Ref<boolean>>; setCollapsed(value: boolean): void } {
  let stored = false;
  try {
    stored = localStorage.getItem(KEY) === "true";
  } catch {
    // Reading the fold is a convenience only: without storage the composer opens.
  }
  const collapsed = ref(stored);
  return {
    collapsed,
    setCollapsed(value) {
      collapsed.value = value;
      try {
        localStorage.setItem(KEY, String(value));
      } catch {
        // Remembering the fold is a convenience only.
      }
    },
  };
}
