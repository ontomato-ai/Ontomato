import { nextTick } from "vue";
import { ElMessage } from "element-plus";
import type { Router } from "vue-router";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { workbenchI18n } from "@ontomato/workbench-ui/i18n";
import { readAndServePanelEntries, servePanelEntries } from "./panel-entries";

type ApplicationAddressOpener = (address: string, options: { beside: boolean }) => boolean;
let applicationOpener: ApplicationAddressOpener | null = null;

/**
 * Registers the active platform shell's application opener so panel navigation to an application's landing address
 * (including external SSO launchers, standalone applications, and multi-page applications whose landing resolves to
 * the reader's first permitted entry) goes through the same `openApplication` path as the rail.
 */
export function installPanelApplicationOpener(opener: ApplicationAddressOpener | null): () => void {
  applicationOpener = opener;
  return () => {
    if (applicationOpener === opener) applicationOpener = null;
  };
}

/**
 * Where a panel's code goes when it asks to open an address (big main's ruling, 2026-11-21): a page of the platform,
 * opened by the router at the panel's own address, or by the conversation's display (`beside`) when the panel is shown
 * beside a conversation. An address the platform has no page for — none exists, or the reader's edition does not
 * register it — moves nothing: the reader is told on the page, and the call is refused with the same reason. Without
 * this, such an address landed on the start page, or nothing happened at all.
 *
 * A page that opened and then refuses the reader says so itself, as it does for any address. The reader keeping a page
 * with unsaved changes is the reader's own choice, and nothing is said.
 */
export function panelNavigator(router: Router, beside?: (address: string) => void) {
  return async (address: string): Promise<void> => {
    if (address.startsWith("/") && !address.startsWith("//") && applicationOpener?.(address, { beside: Boolean(beside) })) {
      return;
    }
    const served = () => address.startsWith("/") && !address.startsWith("//") && router.resolve(address).name !== platformRoutes.unknown.name;
    // A panel entry's route opens on the first address that asks for it, so another page's entry is opened here too.
    if (!served()) servePanelEntries(router);
    // Asked before the owning application's entry table was read: load it once, and only then call the address absent.
    if (!served()) await readAndServePanelEntries(router, address);
    if (!served()) {
      const reason = new Error(workbenchI18n().global.t("platform.panelAddressUnavailable", { address }));
      ElMessage.error(reason.message);
      throw reason;
    }
    // Flush any same-tick deep-link state watcher (`router.replace`) before pushing the destination route,
    // otherwise a leaving panel that clears state right before `navigate()` would abort its own navigation.
    await nextTick();
    if (beside) beside(address);
    else await router.push(address);
  };
}
