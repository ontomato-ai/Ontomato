import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const context = usePanelContext();
    const showMenu = computed(() => {
      const hostGroups = context.hostMenu?.value;
      const visibleCount = hostGroups && hostGroups.length > 0
        ? hostGroups.reduce((total, group) => total + group.items.length, 0)
        : (context.entryMenu.value?.panelUses ?? []).filter((use) => Boolean(use.names)).length;
      if (visibleCount === 0) return false;
      const singleEntry = context.entryMenu.value?.singleEntry;
      if (singleEntry === false) return true;
      if (singleEntry === true) return false;
      return visibleCount > 1;
    });
    return { showMenu };
  },
});
