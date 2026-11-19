<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import { slotState, usePanelContext, useProjectionObjectRefresh, useProjectionObjects, useProjectionSlot } from "../panel/context";
import { selectedKey } from "../panel/platform-objects";

/**
 * One platform object as a few facts a reader recognises it by. Which facts are shown, and in what order, is the
 * projection's `display`; what each holds is the object's owner's. So "change how this summary looks" is a change to the
 * projection's display, and every panel and every instance that uses the same projection shows it the same way.
 */
const props = defineProps<{
  /** The facts to show, by the owner's field name, in this order; absent shows all of them in the owner's order. */
  fields?: readonly string[];
  /** The slot input whose panel state names the object; the first, by default. */
  input?: string;
}>();

const slot = useProjectionSlot();
const panel = usePanelContext();
const objects = useProjectionObjects();
const record = shallowRef<{ label: string; fields: Readonly<Record<string, string>> } | null>(null);
const loading = ref(true);
const failure = shallowRef<Error | null>(null);

// The object this summary is about: the panel state its slot's input is filled from, so a panel never passes a state name.
const key = computed(() => selectedKey(panel.instance.state.values.value[slotState(panel.manifest, slot.slot, props.input)]));
const shown = computed(() => {
  const fields = record.value?.fields ?? {};
  return (props.fields ?? Object.keys(fields)).filter((name) => name in fields);
});

function load(primaryKey: string | null) {
  if (!primaryKey) {
    record.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  void objects.read(primaryKey).then(
    (found) => {
      record.value = found;
      loading.value = false;
    },
    (reason: unknown) => {
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
      loading.value = false;
    },
  );
}

onMounted(() => load(key.value));
watch(key, (next) => load(next));
useProjectionObjectRefresh(id => id === key.value, () => load(key.value));
</script>

<template>
  <div class="sdk-object-summary">
    <p v-if="failure" role="alert">{{ failure.message }}</p>
    <el-skeleton v-else-if="loading" :rows="2" animated></el-skeleton>
    <el-empty v-else-if="!record" :image-size="48"></el-empty>
    <template v-else>
      <h3 class="sdk-object-summary-title">{{ record.label }}</h3>
      <dl>
        <template v-for="name in shown" :key="name">
          <dt>{{ name }}</dt>
          <dd>{{ record.fields[name] || "—" }}</dd>
        </template>
      </dl>
    </template>
  </div>
</template>

<style scoped>
dl {
  display: grid;
  gap: 4px 12px;
  grid-template-columns: auto 1fr;
  margin: 0;
}
dt {
  color: var(--el-text-color-secondary);
}
dd {
  margin: 0;
}
.sdk-object-summary-title {
  font-size: 14px;
  margin: 0 0 8px;
}
</style>
