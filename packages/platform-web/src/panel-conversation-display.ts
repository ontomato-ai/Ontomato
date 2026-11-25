import { watch, watchEffect } from "vue";
import { isNavigationFailure, NavigationFailureType, type Router } from "vue-router";
import { useConversationDisplay, type DisplayObjectChange, type DisplayPageController } from "@ontomato/agent-shell-ui";
import { useLeaveConfirmation, usePageAdmission } from "@ontomato/platform-shell";
import type { DisplayLoad } from "@ontomato/contracts/agent-presentation";
import type { PageContext } from "@ontomato/contracts/page-context";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";

export interface DisplayedPanel {
  controller: DisplayPageController | null;
  context: PageContext | null;
  skill: PageSkillContext | null;
  dirty: boolean;
  load?: DisplayLoad;
}

/** Give the existing presentation controller the panel that the platform is showing. */
export function usePanelConversationDisplay(options: {
  router: Router;
  address: () => string | null;
  contains: (path: string) => boolean;
  panel: () => DisplayedPanel | null;
  refresh: (change: DisplayObjectChange) => void;
}) {
  const { router } = options;
  const leave = useLeaveConfirmation();
  const admitPage = usePageAdmission();
  function resolve(address: string) {
    if (!address.startsWith("/") || address.startsWith("//")) return null;
    const { path, fullPath } = router.resolve(address);
    return options.contains(path) ? { featureId: path, instance: path, address: fullPath } : null;
  }

  const display = useConversationDisplay({
    features: () => [],
    embedded: true,
    resolve,
    admit: async (address) => {
      if (!resolve(address)) return { ok: false, reason: "outside_embedded_host" };
      return admitPage ? admitPage(address) : { ok: true };
    },
    async serialize(page, _view, history) {
      if (!page) return false;
      const openedEntry = page.takeOpenedEntry?.();
      const stop = openedEntry && router.beforeResolve(to => {
        if (to.fullPath === page.address) to.meta.openedPanelEntry = openedEntry;
      });
      try {
        const failure = await (history === "push" ? router.push(page.address) : router.replace(page.address));
        return !failure || isNavigationFailure(failure, NavigationFailureType.duplicated);
      } finally {
        stop?.();
      }
    },
    context: (page, reported) => ({ label: page.address, selection: [], ...reported, url: page.address }),
    leave: { leaves: (address) => leave.leaves(address?.split(/[?#]/, 1)[0] ?? ""), confirm: () => leave.confirm() },
  });

  watch(options.address, (address) => display.follow(address, "full"), { immediate: true });
  watch(
    [() => options.address()?.split(/[?#]/, 1)[0], () => options.panel()?.controller],
    ([path, controller], _, onCleanup) => {
      if (path && controller) onCleanup(display.registerPageController(path, controller));
    },
    { immediate: true },
  );
  watchEffect(() => {
    const panel = options.panel();
    if (panel?.context) display.context(panel.context);
    display.skill(panel?.skill ?? null);
    display.dirty(panel?.dirty ?? false);
    display.loaded(panel?.load ?? { status: "ready" });
  });
  watch(display.objectRefresh, (change) => {
    if (change) options.refresh(change);
  }, { flush: "post" });
  return display;
}
