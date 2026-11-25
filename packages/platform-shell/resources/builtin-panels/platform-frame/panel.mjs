import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const context = usePanelContext();
    const showMenu = computed(() => {
      const hostGroups = context.hostMenu?.value;
      if (hostGroups && hostGroups.length > 0) {
        return hostGroups.reduce((total, group) => total + group.items.length, 0) > 1;
      }
      const uses = context.entryMenu.value?.panelUses ?? [];
      return uses.filter((use) => Boolean(use.names)).length > 1;
    });
    return { showMenu };
  },
});
