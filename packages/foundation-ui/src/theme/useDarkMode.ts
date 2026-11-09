import { onBeforeUnmount, onMounted, ref } from "vue";

/** Follows the host's dark mode, expressed as the `dark` class on the document root. */
export function useDarkMode() {
  const isDark = ref(document.documentElement.classList.contains("dark"));
  let observer: MutationObserver | null = null;
  onMounted(() => {
    observer = new MutationObserver(() => {
      isDark.value = document.documentElement.classList.contains("dark");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  });
  onBeforeUnmount(() => observer?.disconnect());
  return isDark;
}
