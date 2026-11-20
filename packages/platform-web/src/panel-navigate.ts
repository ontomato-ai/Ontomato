import { ElMessage } from "element-plus";
import type { Router } from "vue-router";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { workbenchI18n } from "@ontomato/workbench-ui/i18n";

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
    const known = address.startsWith("/") && !address.startsWith("//") && router.resolve(address).name !== platformRoutes.unknown.name;
    if (!known) {
      const reason = new Error(workbenchI18n().global.t("platform.panelAddressUnavailable", { address }));
      ElMessage.error(reason.message);
      throw reason;
    }
    if (beside) beside(address);
    else await router.push(address);
  };
}
