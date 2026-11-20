<script setup lang="ts">
import { computed, onBeforeUnmount, provide, shallowRef, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { DataState } from "@ontomato/foundation-ui/data-state";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { componentFor } from "../catalogue-components";
import { panelContextKey, projectionKey, type ProjectionSlot } from "./context";
import { directPanelContext, memberComponentId, type DirectPanelInstance, type MemberInputs } from "./direct";
import { panelMemberKey, type PanelMemberContext } from "./member";
import { portsOf } from "./ports-of";

/**
 * One member of a directly rendered panel, drawn in the platform's own document: the member's projection, read once for
 * the instance, names its component and its data; the component gets the member's inputs as its placement fills them
 * now, its configuration, and its data through the instance. Its typed outputs write the panel's state as the member
 * declares, and its operations are the projection's, registered with the instance under the member's key.
 */
const props = defineProps<{
  instance: DirectPanelInstance;
  /** The member's key in the panel's declaration. */
  member: string;
}>();

const { t } = useI18n();
const declaration = props.instance.direct.members[props.member];
if (!declaration) throw new Error(`The panel declares no member '${props.member}'`);
const failure = shallowRef<Error | null>(null);
const loaded = shallowRef<{ component: Component; slot: ProjectionSlot; member: PanelMemberContext } | null>(null);

/** What the placement gives each input now: the state it names, or its literal. */
const inputs = computed<MemberInputs>(() => Object.fromEntries(Object.entries(declaration.inputs ?? {}).map(([name, source]) =>
  // A state value is JSON as it is: an object reference, a collection of them, a scalar, or null.
  [name, "state" in source ? (props.instance.state.values.value[source.state] ?? null) as RuntimeJsonValue : memberLiteral(name, source)])));

function memberLiteral(input: string, source: { literal: RuntimeJsonValue } | { item: true }): RuntimeJsonValue {
  if ("item" in source) throw new Error(`Member '${props.member}' fills '${input}' from a repeated item, which this SDK release does not place`);
  return source.literal;
}

let release: (() => void) | undefined;
void props.instance.projectionOf(props.member).then(async (projection) => {
  const component = await componentFor(memberComponentId(projection));
  release = props.instance.register({ slot: props.member, projectionId: projection.id, ports: portsOf(projection) });
  loaded.value = {
    component,
    slot: { slot: props.member, projection, get inputs() { return inputs.value; } },
    member: { key: props.member, projection, inputs, data: props.instance.memberData(props.member, projection, () => inputs.value) },
  };
}).catch((reason: unknown) => {
  failure.value = reason instanceof Error ? reason : new Error(String(reason));
});
onBeforeUnmount(() => release?.());

provide(panelContextKey, directPanelContext(props.instance));
provide(projectionKey, { slot: props.member, get projection() { return loaded.value!.slot.projection; }, get inputs() { return inputs.value; } });
provide(panelMemberKey, () => loaded.value!.member);
const labels = computed(() => ({ empty: t("platform.dataEmpty"), forbidden: t("platform.dataForbidden"), awaiting: t("platform.dataAwaiting") }));
</script>

<template>
  <data-state v-if="failure" :result="{ status: 'error', message: failure.message }" :labels="labels"></data-state>
  <data-state v-else-if="!loaded" :result="{ status: 'loading' }" :labels="labels"></data-state>
  <component :is="loaded.component" v-else v-bind="{ ...loaded.slot.projection.config, ...inputs }"></component>
</template>
