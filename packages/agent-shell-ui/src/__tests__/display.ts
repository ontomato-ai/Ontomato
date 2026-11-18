import { useConversationDisplay, type ConversationDisplayHost } from "../conversation-display";
import type { ShellWorkbenchDeclaration } from "../types";

/**
 * A display for a shell under test: the workbench's pages by their feature, with no address bar and no unsaved draft. A
 * test that is about the address or the guard passes its own host parts.
 */
export function testDisplay(workbench: ShellWorkbenchDeclaration, host: Partial<ConversationDisplayHost> = {}) {
  return useConversationDisplay({
    features: () => workbench.features,
    feature: (id) => ({ featureId: id, address: `/${id}`, instance: id }),
    context: (page) => ({ url: page.address, label: "", selection: [] }),
    leave: { leaves: () => false, confirm: async () => true },
    ...host,
  });
}
