import { computed, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

/*
 * Built-in skills library panel: the domain's visible skill catalog on the left and the selected skill's package
 * (metadata, export/delete actions, file tree, and text viewer) on the right. Importing a skill ZIP runs through the
 * official FileUploadControl (`skills.import`), and opening a skill prefers `SKILL.md` before falling back to the first
 * file in folder-first alphabetical order.
 */

const SKILL_TYPE = "platform:Skill";

function compareTreePath(a, b) {
  const pa = a.split("/");
  const pb = b.split("/");
  const len = Math.min(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const aIsFile = i === pa.length - 1;
    const bIsFile = i === pb.length - 1;
    if (aIsFile !== bIsFile) return aIsFile ? 1 : -1;
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return pa.length - pb.length;
}

function defaultFileOf(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const skillDoc = records.find((entry) => entry.primaryKey === "SKILL.md");
  if (skillDoc) return skillDoc.primaryKey;
  return [...records].sort((a, b) => compareTreePath(a.primaryKey, b.primaryKey))[0]?.primaryKey ?? null;
}

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected ?? null);
    const filePath = computed(() => {
      const value = instance.state.values.value.filePath;
      return typeof value === "string" && value.length > 0 ? value : null;
    });
    const record = usePanelData("detail", "record");
    const files = usePanelData("tree", "files");

    const skill = computed(() => {
      const held = record.value.status === "ready" ? record.value.value : null;
      const fields = held?.fields ?? {};
      return {
        name: held?.label ?? "",
        summary: fields.description ?? "",
        source: fields.source ?? "",
      };
    });

    // Keep the current file while it belongs to the selected package; otherwise open SKILL.md first.
    watch(
      () => [selected.value?.primaryKey ?? null, files.value.status, files.value.status === "ready" ? files.value.value : null],
      ([skillId, status, list]) => {
        if (!skillId) {
          if (filePath.value !== null) instance.state.setState({ filePath: null });
          return;
        }
        if (status === "empty") {
          if (filePath.value !== null) instance.state.setState({ filePath: null });
          return;
        }
        if (status !== "ready" || !Array.isArray(list)) return;
        const current = filePath.value;
        if (current && list.some((entry) => entry.primaryKey === current)) return;
        const next = defaultFileOf(list);
        if (next !== current) instance.state.setState({ filePath: next });
      },
      { immediate: true },
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

    function onDeleted(outcome) {
      if (outcome?.kind === "success") {
        instance.state.setState({ filePath: null });
      }
    }

    return { selected, record, skill, onImported, onDeleted };
  },
});
