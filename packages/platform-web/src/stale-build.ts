import { ElButton, ElNotification } from "element-plus";
import { h } from "vue";
import { t } from "@ontomato/workbench-ui/i18n";

const STALE_BUILD_RELOAD_KEY = "ontology_manager_stale_build_reload";

export function reloadOnStaleBuild() {
  let noticeOpen = false;
  function handlePreloadError(event: Event) {
    if (document.getElementById("app")?.hasAttribute("data-v-app")) {
      // A lazy component can fail while a conversation is running. Let the failure reach its caller and keep the page alive.
      if (noticeOpen) return;
      noticeOpen = true;
      ElNotification({
        type: "warning",
        title: t("assistant.loadFailed"),
        message: h(ElButton, { text: true, onClick: () => window.location.reload() }, () => t("common.refresh")),
        duration: 0,
        onClose: () => { noticeOpen = false; },
      });
      return;
    }

    // An entry that has not mounted can still recover automatically, once per build.
    const entry = import.meta.url;
    try {
      if (sessionStorage.getItem(STALE_BUILD_RELOAD_KEY) === entry) return;
      sessionStorage.setItem(STALE_BUILD_RELOAD_KEY, entry);
    } catch {
      return;
    }
    event.preventDefault();
    window.location.reload();
  }
  window.addEventListener("vite:preloadError", handlePreloadError);
  return () => window.removeEventListener("vite:preloadError", handlePreloadError);
}
