import { computed, watch } from "vue";
import { mountPanel, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Built-in skills library panel: the domain's visible skill catalog on the left and the selected skill's package
 * (ObjectHeader with export/delete actions, file tree, and text viewer) on the right. Importing a skill ZIP runs
 * through the official FileUploadControl (`skills.import`), and opening a skill prefers `SKILL.md` before falling back
 * to the first file in folder-first alphabetical order.
 */

const SKILL_TYPE = "platform:Skill";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected ?? null);
    const filePath = computed(() => {
      const value = instance.state.values.value.filePath;
      return typeof value === "string" && value.length > 0 ? value : null;
    });
    const detailStatus = usePanelOutput("detail", "status");
    const detailReady = computed(() => detailStatus.value === "ready");

    // Clear filePath when selection clears or switches to another skill without an explicit filePath in the same
    // state patch; ObjectTree then picks defaultKey ("SKILL.md") or the first file once the new package's files load.
    // An atomic switch such as `present({ selected: B, filePath: "references/readme.md" })` keeps its explicit filePath.
    watch(
      () => selected.value?.primaryKey ?? null,
      (skillId, previousSkillId) => {
        if (!skillId) {
          if (filePath.value !== null) instance.state.setState({ filePath: null });
          return;
        }
        if (
          previousSkillId
          && previousSkillId !== skillId
          && !instance.state.lastPatchedKeys.has("filePath")
          && filePath.value !== null
        ) {
          instance.state.setState({ filePath: null });
        }
      },
      { immediate: true, flush: "sync" },
    );

    function onImported(response) {
      const outcome = response?.kind === "dispatched" ? response.outcome : null;
      const importedId = outcome?.kind === "success" && typeof outcome.data?.id === "string" ? outcome.data.id : null;
      if (importedId) {
        instance.state.setState({
          selected: { className: SKILL_TYPE, primaryKey: importedId },
          filePath: null,
        });
      }
    }

    function onHeaderOperationDone(operation, outcome) {
      if (operation === "remove" && outcome?.kind === "success") {
        instance.state.setState({ filePath: null });
      }
    }

    return { selected, detailReady, onImported, onHeaderOperationDone, refresh: () => instance.refreshObjects() };
  },
});
