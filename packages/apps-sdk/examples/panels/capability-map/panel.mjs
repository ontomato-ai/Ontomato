import { computed, ref, watch } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

/*
 * Four-layer platform capability map (M3). All platform ontology reads (schema, per-type counts, default starting user,
 * one-hop neighbors and per-type object lists) live inside the bound projections; this module only coordinates the
 * panel's own declared state:
 * - Default mode is `"instance"` when unset; switching mode clears the in-canvas highlight query and closes the user
 *   start picker.
 * - Choosing a starting object from the type object picker (in type mode) or the user picker (in instance mode) writes
 *   `start`, switches to instance mode when coming from type mode, closes the user picker, and selects the new start
 *   node so its one-hop relations appear immediately.
 * - "Set selected as start" promotes the currently selected instance node to `start`.
 */
function identityKey(value) {
  return value && typeof value === "object" ? `${value.className}\u0000${value.primaryKey}` : "";
}

const CapabilityMap = {
  setup() {
    const { instance } = usePanelContext();
    const state = instance.state;
    const showUserPicker = ref(false);

    const mode = computed(() => (state.values.value.mode === "type" ? "type" : "instance"));
    const start = computed(() => {
      const value = state.values.value.start;
      return value && typeof value === "object" ? value : null;
    });
    const selected = computed(() => {
      const value = state.values.value.selected;
      return value && typeof value === "object" ? value : null;
    });
    const query = computed(() => (typeof state.values.value.query === "string" ? state.values.value.query : ""));

    const hasCustomStart = computed(() => start.value !== null);
    const canUseSelectedAsStart = computed(() => {
      if (mode.value !== "instance" || !selected.value) return false;
      return identityKey(selected.value) !== identityKey(start.value);
    });

    watch(
      () => identityKey(start.value),
      (nextKey, prevKey) => {
        if (!nextKey || nextKey === prevKey) return;
        const nextStart = start.value;
        showUserPicker.value = false;
        if (mode.value === "type") {
          state.set("mode", "instance");
        }
        if (nextStart && identityKey(selected.value) !== nextKey) {
          state.set("selected", { className: nextStart.className, primaryKey: nextStart.primaryKey });
        }
      },
    );

    watch(mode, (next, prev) => {
      if (next === prev) return;
      showUserPicker.value = false;
      if (state.values.value.query) {
        state.set("query", null);
      }
    });

    function onQueryInput(event) {
      const text = event.target?.value ?? "";
      state.set("query", text || null);
    }

    function clearQuery() {
      state.set("query", null);
    }

    function toggleUserPicker() {
      showUserPicker.value = !showUserPicker.value;
    }

    function useSelectedAsStart() {
      if (!canUseSelectedAsStart.value || !selected.value) return;
      state.set("start", { className: selected.value.className, primaryKey: selected.value.primaryKey });
    }

    function resetStart() {
      showUserPicker.value = false;
      state.set("start", null);
      state.set("selected", null);
    }

    return {
      mode,
      query,
      showUserPicker,
      hasCustomStart,
      canUseSelectedAsStart,
      onQueryInput,
      clearQuery,
      toggleUserPicker,
      useSelectedAsStart,
      resetStart,
    };
  },
};

await mountPanel(CapabilityMap);
