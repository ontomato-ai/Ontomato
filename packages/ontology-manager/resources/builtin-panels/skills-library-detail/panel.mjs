import { computed, nextTick, watch } from "vue";
import { mountPanel, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Built-in skill detail panel: full-width read-only inspection of one skill's metadata, package file tree, and
 * file contents, with export and delete actions in the page header.
 */

const CATALOG_PATH = "/ontology/skills";

await mountPanel({
  setup() {
    const { instance, navigateBack, t } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const filePath = computed(() => {
      const value = instance.state.values.value.filePath;
      return typeof value === "string" && value.length > 0 ? value : null;
    });
    // Keep CSV/TSV files in the read-only text/code editor instead of table preview, while preserving auto format for Markdown and code files.
    const contentFormat = computed(() => {
      const normalized = filePath.value?.trim().toLowerCase() ?? "";
      return normalized.endsWith(".csv") || normalized.endsWith(".tsv") ? "code" : "auto";
    });

    const headerStatus = usePanelOutput("headerTitle", "status");
    const headerError = usePanelOutput("headerTitle", "errorMessage");
    const detailStatus = computed(() => {
      if (!selectedKey.value) return "empty";
      return headerStatus.value ?? "loading";
    });
    const detailReady = computed(() => detailStatus.value === "ready");
    const detailErrorText = computed(() => {
      const message = typeof headerError.value === "string" ? headerError.value.trim() : "";
      return message || t("panel.loadFailed");
    });

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

    function goBack() {
      void navigateBack(CATALOG_PATH);
    }

    async function onRemoveDone(outcome) {
      if (outcome?.kind !== "success") return;
      instance.state.setState({ selected: null, filePath: null });
      await nextTick();
      void navigateBack(CATALOG_PATH);
    }

    function retry() {
      instance.refreshObjects();
    }

    return {
      t,
      selectedKey,
      detailStatus,
      detailReady,
      detailErrorText,
      contentFormat,
      goBack,
      onRemoveDone,
      retry,
    };
  },
});
