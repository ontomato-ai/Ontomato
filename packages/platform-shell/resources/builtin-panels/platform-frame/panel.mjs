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
    const activeUse = computed(() => {
      const uses = context.entryMenu.value?.panelUses ?? [];
      const current = context.currentEntry.value;
      if (current) {
        const matched = uses.find((use) => use.path === current.path);
        if (matched) return matched;
      }
      return uses[0] ?? null;
    });
    const singleEntryNames = computed(() =>
      activeUse.value?.names ?? context.entryMenu.value?.names ?? null,
    );
    const showSingleEntryHeader = computed(() =>
      !showMenu.value && activeUse.value?.frameHeader === true && Boolean(singleEntryNames.value),
    );
    return { showMenu, showSingleEntryHeader, singleEntryNames };
  },
});
