<script setup lang="ts">
import { computed, inject, onBeforeUnmount, provide, ref, shallowRef, watch, type Component } from "vue";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { type MemberInputs } from "./direct";
import { memberComponentId, memberProjectionId } from "./projection-element";
import { frameMemberData } from "./frame-member";
import { panelMemberKey, type PanelMemberContext } from "./member";
import { portsOf } from "./ports-of";
import { slotInputValues } from "./ports";
import { panelContextKey, projectionKey, type ProjectionSlot } from "./context";
import { componentFor } from "../catalogue-components";

/**
 * The SDK's projection component: `<Projection slot="taskForm"/>`. A panel author places it and names the member;
 * everything else is the SDK's. It reads the member's projection by ID through this frame's request path under the
 * reader's own credential, finds the component of the record's `componentId` in this release's own catalogue, draws it
 * with the record's `config` as configuration and the member's inputs as values, derives its ports from the data it reads
 * and that catalogue entry, registers them with the instance, and gives the drawn component the member's data, read here
 * through this release's resource modules.
 *
 * The record is read every time the projection appears, and again by the same ID when the platform says its definition
 * changed: that is what makes a change to a shared projection reach every instance of every panel that uses it.
 */
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** The slot of the panel's declaration this projection fills. */
  slot: string;
}>();

const panel = inject(panelContextKey, null);
if (!panel) throw new Error("<Projection> runs inside a panel, which provides its context");

const loading = ref(true);
const failure = shallowRef<Error | null>(null);
const loaded = shallowRef<{ projection: ProductProjection; component: Component; member: PanelMemberContext } | null>(null);
const inputs = ref<Record<string, unknown>>({});
/** A member's inputs are JSON as the state holds them. */
const memberInputs = computed(() => inputs.value as MemberInputs);
let registered: (() => void) | undefined;
let readGeneration = 0;
let requestedRevision = 0;

function start(revision = 0) {
  const generation = ++readGeneration;
  requestedRevision = revision;
  const projectionId = memberProjectionId(panel!.manifest, props.slot);
  loading.value = true;
  failure.value = null;
  void (async () => {
    const projection = await panel!.projection(projectionId);
    if (generation !== readGeneration) return;
    // The component the record names and the resource clients it binds are fetched together, each the first time a
    // panel names it; every later projection of the same one draws at once.
    const [component] = await Promise.all([componentFor(memberComponentId(projection)), panel!.resources(projection)]);
    if (generation !== readGeneration) return;
    // The ports are the record's and its catalogue entry's, registered before the component draws, so a form finds its
    // own save among them and the header and an agent can list them.
    registered?.();
    registered = panel!.instance.register({
      slot: props.slot,
      projectionId: projection.id,
      ports: portsOf(projection),
    });
    requestedRevision = 0;
    loaded.value = {
      projection, component,
      member: {
        key: props.slot, projection, inputs: memberInputs,
        data: frameMemberData(projection, props.slot, panel!.instance, () => memberInputs.value, panel!.readPanelData),
      },
    };
    loading.value = false;
  })().catch((reason: unknown) => {
    if (generation !== readGeneration) return;
    requestedRevision = 0;
    failure.value = reason instanceof Error ? reason : new Error(String(reason));
    loading.value = false;
  });
}

watch(
  () => props.slot,
  () => start(),
  { immediate: true },
);
// A changed definition is read again by the same ID here, so every instance that uses it redraws.
const stop = panel.projectionsChanged((id, revision) => {
  if (memberProjectionId(panel.manifest, props.slot) !== id) return;
  const currentRevision = loaded.value?.projection.id === id ? loaded.value.projection.revision : 0;
  if (revision === undefined || revision > Math.max(currentRevision, requestedRevision)) start(revision);
});
onBeforeUnmount(() => {
  readGeneration++;
  stop();
  registered?.();
});

// The slot's inputs follow the instance's state: the panel's own values, never a copy.
watch(
  () => panel.instance.state.values.value,
  () => {
    inputs.value = slotInputValues(panel.manifest, props.slot, panel.instance.state.values.value);
  },
  { immediate: true, deep: true },
);

provide(projectionKey, {
  slot: props.slot,
  get projection() {
    return loaded.value!.projection;
  },
  get inputs() {
    return inputs.value;
  },
} as ProjectionSlot);
provide(panelMemberKey, () => loaded.value!.member);
</script>

<template>
  <p v-if="failure" role="alert">{{ failure.message }}</p>
  <div v-else-if="loading || !loaded" class="sdk-projection-loading"></div>
  <component :is="loaded.component" v-else v-bind="{ ...loaded.projection.config, ...$attrs, ...inputs }">
    <template v-for="(_, name) in $slots" :key="name" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps ?? {}"></slot>
    </template>
  </component>
</template>
