<script setup lang="ts">
import { computed, provide, shallowRef, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { DataState } from "@ontomato/foundation-ui/data-state";
import { componentFor } from "../catalogue-components";
import { panelContextKey, projectionKey, type ProjectionSlot } from "./context";
import { directPanelContext, type DirectPanelInstance } from "./direct";
import { memberComponentId } from "./projection-element";
import { panelMemberKey, type PanelMemberContext } from "./member";

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

// The member as the instance holds it — read, registered and kept current there, drawn here.
void props.instance.memberContext(props.member).then(async (member) => {
  const component = await componentFor(memberComponentId(member.projection));
  loaded.value = { component, slot: { slot: props.member, projection: member.projection, get inputs() { return member.inputs.value; } }, member };
}).catch((reason: unknown) => {
  failure.value = reason instanceof Error ? reason : new Error(String(reason));
});

provide(panelContextKey, directPanelContext(props.instance));
provide(projectionKey, { slot: props.member, get projection() { return loaded.value!.slot.projection; }, get inputs() { return loaded.value!.member.inputs.value; } });
provide(panelMemberKey, () => loaded.value!.member);
/**
 * What the component takes as its own props: its configuration and the inputs it declares as props, such as a graph's
 * `selected`. The rest of its inputs it reads through its slot; passed down, they would land on its root element as
 * attributes (`selected="[object Object]"`).
 */
const bound = computed(() => {
  const { component, slot, member } = loaded.value!;
  const options = component as { props?: readonly string[] | Record<string, unknown> };
  const declared = new Set(Array.isArray(options.props) ? options.props : Object.keys(options.props ?? {}));
  return Object.fromEntries(Object.entries({ ...slot.projection.config, ...member.inputs.value }).filter(([name]) => declared.has(name)));
});
const labels = computed(() => ({ empty: t("platform.dataEmpty"), forbidden: t("platform.dataForbidden"), awaiting: t("platform.dataAwaiting") }));
</script>

<template>
  <data-state v-if="failure" :result="{ status: 'error', message: failure.message }" :labels="labels"></data-state>
  <data-state v-else-if="!loaded" :result="{ status: 'loading' }" :labels="labels"></data-state>
  <component :is="loaded.component" v-else v-bind="bound"></component>
</template>
