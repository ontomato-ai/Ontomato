import { computed, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

/*
 * Built-in skills library panel: the domain's visible skill catalog on the left and the selected skill's package
 * (metadata, export/delete actions, file tree, and text viewer) on the right. Importing a skill ZIP runs through the
 * official FileUploadControl (`skills.import`), and opening a skill prefers `SKILL.md` before falling back to the first
 * file in folder-first alphabetical order.
 */

const SKILL_TYPE = "platform:Skill";
const DEFAULT_FILE = "SKILL.md";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected ?? null);
    const filePath = computed(() => {
      const value = instance.state.values.value.filePath;
      return typeof value === "string" && value.length > 0 ? value : null;
    });
    const record = usePanelData("detail", "record");

    const skill = computed(() => {
      const held = record.value.status === "ready" ? record.value.value : null;
      const fields = held?.fields ?? {};
      return {
        name: held?.label ?? "",
        summary: fields.description ?? "",
        source: fields.source ?? "",
      };
    });

    // Select SKILL.md synchronously on first selection or skill switch so tree and content load in parallel with detail;
    // ObjectTree (fallbackToFirst: true) keeps SKILL.md or any deep-linked file when present and falls back otherwise.
    watch(
      () => selected.value?.primaryKey ?? null,
      (skillId, previousSkillId) => {
        if (!skillId) {
          if (filePath.value !== null) instance.state.setState({ filePath: null });
          return;
        }
        if (!filePath.value || (previousSkillId && previousSkillId !== skillId)) {
          if (filePath.value !== DEFAULT_FILE) instance.state.setState({ filePath: DEFAULT_FILE });
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
          filePath: DEFAULT_FILE,
        });
      }
    }

    function onDeleted(outcome) {
      if (outcome?.kind === "success") {
        instance.state.setState({ filePath: null });
      }
    }

    return { selected, record, skill, onImported, onDeleted };
  },
});
