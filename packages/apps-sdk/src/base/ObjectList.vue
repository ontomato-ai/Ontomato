<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { slotState, usePanelContext, useProjectionObjectRefresh, useProjectionSlot } from "../panel/context";
import { platformObjectFor, selectedKey } from "../panel/platform-objects";

/**
 * A read-only platform object as a list a reader picks from. It shows what the object's owner lists, in the owner's
 * order and by the owner's label, and writes the chosen object into the panel state its slot's input is filled from; it
 * changes nothing itself.
 *
 * Everything business about it comes from the projection: the type it lists from the record's `binding`, the order and
 * the label from the owner, and the panel state a choice goes to from the slot's input. A panel that lists another type
 * lists another type, with no other component and no field of this one written for it.
 */
const props = defineProps<{
  /** The slot input whose name is the panel state a choice is written to; the panel declares it. */
  input?: string;
}>();

const slot = useProjectionSlot();
const panel = usePanelContext();
const rows = shallowRef<readonly { primaryKey: string; label: string }[]>([]);
const loading = ref(true);
const failure = shallowRef<Error | null>(null);

/** The panel state a choice is written to: the one this slot's input is filled from. */
const state = computed(() => slotState(panel.manifest, slot.slot, props.input));

const chosen = computed(() => selectedKey(panel.instance.state.values.value[state.value]));

function load() {
  void platformObjectFor(slot.projection.binding.id).list().then(
    (listed) => {
      rows.value = listed.map((item) => ({ primaryKey: item.primaryKey, label: item.label }));
      loading.value = false;
    },
    (reason: unknown) => {
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
      loading.value = false;
    },
  );
}
onMounted(load);
useProjectionObjectRefresh(id => rows.value.some(row => row.primaryKey === id), load);

/** A row chosen becomes the panel's selected object; a second click on it lets go. */
function choose(primaryKey: string) {
  panel.instance.state.set(
    state.value,
    chosen.value === primaryKey ? null : { className: slot.projection.binding.id, primaryKey },
  );
}
</script>

<template>
  <div class="sdk-object-list">
    <p v-if="failure" role="alert">{{ failure.message }}</p>
    <el-skeleton v-else-if="loading" :rows="3" animated></el-skeleton>
    <ul v-else role="listbox">
      <li v-for="row in rows" :key="row.primaryKey">
        <button
          type="button"
          role="option"
          :aria-selected="row.primaryKey === chosen"
          :class="{ chosen: row.primaryKey === chosen }"
          @click="choose(row.primaryKey)"
        >
          {{ row.label }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
ul {
  display: flex;
  flex-direction: column;
  gap: 2px;
  list-style: none;
  margin: 0;
  padding: 0;
}
button {
  background: none;
  border: 0;
  border-radius: 4px;
  color: var(--el-text-color-primary);
  cursor: pointer;
  padding: 6px 8px;
  text-align: left;
  width: 100%;
}
button:hover {
  background: var(--el-fill-color-light);
}
.chosen {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
</style>
