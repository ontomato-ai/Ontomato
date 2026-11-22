<script setup lang="ts">
import { computed, onBeforeUnmount, onErrorCaptured, onMounted, provide, ref, shallowRef, watch, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { DataState } from "@ontomato/foundation-ui/data-state";
import { isDomainComponentId } from "@ontomato/contracts/product-record-id";
import { componentFor } from "../catalogue-components";
import { panelContextKey, projectionKey, type ProjectionSlot } from "./context";
import { directPanelContext, PanelMemberUnavailable, type DirectPanelInstance } from "./direct";
import { memberComponentId } from "./projection-element";
import { panelMemberKey, type PanelMemberContext } from "./member";
import { isListAttachedPanelMember } from "./row-member";
import { useDataStateLabels } from "../base/data-state-labels";

/**
 * One member of a directly rendered panel, drawn in the platform's own document: the member's projection, read once for
 * the instance, names its component and its data; the component gets the member's inputs as its placement fills them
 * now, its configuration, and its data through the instance. Its typed outputs write the panel's state as the member
 * declares, and its operations are the projection's, registered with the instance under the member's key.
 *
 * A member placed from the panel's state draws what the state chose: a projection, as any member's; a panel, run by the
 * host in an element of its own, which is placed here; nothing chosen yet, which asks for a choice. What the reader may
 * not use, or what is not available there, is said in this member's place alone.
 */
const props = defineProps<{
  instance: DirectPanelInstance;
  /** The member's key in the panel's declaration. */
  member: string;
}>();

const { t } = useI18n();
const declaration = props.instance.direct.members[props.member];
if (!declaration) throw new Error(`The panel declares no member '${props.member}'`);
const hostMounted = isListAttachedPanelMember(declaration);
const stopDrawn = hostMounted ? () => {} : props.instance.markDrawn(props.member);
onBeforeUnmount(stopDrawn);
const failure = shallowRef<Error | null>(null);
const loaded = shallowRef<{ component: Component; slot: ProjectionSlot; member: PanelMemberContext } | null>(null);
/** A panel the member places, run by the host: its element, placed in this member's container once both are there. */
const nested = shallowRef<{ element: HTMLElement; failure: Readonly<{ value: Error | null }> } | null>(null);
const awaiting = ref(false);
/** The platform's current entry, asked for outside an application's frame: the place says it shows nothing here. */
const outsideFrame = ref(false);
const container = ref<HTMLElement | null>(null);

// Keep a member component's render or lifecycle error in its own place instead of failing the whole panel.
onErrorCaptured((reason: unknown) => {
  failure.value ??= reason instanceof Error ? reason : new Error(String(reason));
  return false;
});

// The member as the instance holds it — read, registered and kept current there, drawn here.
if (!hostMounted) {
  void props.instance.placing(props.member).then(async (placing) => {
    if (placing.kind === "hostMounted") return;
    if (placing.kind === "awaiting") awaiting.value = true;
    else if (placing.kind === "outsideFrame") outsideFrame.value = true;
    else if (placing.kind === "panel") nested.value = placing;
    else {
      const member = placing.context;
      const componentId = memberComponentId(member.projection);
      const component = isDomainComponentId(componentId)
        ? await props.instance.loadDomainComponent?.(member.projection)
        : await componentFor(componentId, props.instance.readComponentPackage);
      if (!component) throw new Error(`Component '${componentId}' has no runtime for this projection`);
      loaded.value = { component, slot: { slot: props.member, projection: member.projection, get inputs() { return member.inputs.value; } }, member };
    }
  }).catch((reason: unknown) => {
    stopDrawn();
    failure.value = reason instanceof Error ? reason : new Error(String(reason));
  });
}
function placeNested() {
  if (nested.value && container.value && nested.value.element.parentElement !== container.value) container.value.append(nested.value.element);
}
onMounted(placeNested);
watch([nested, container], placeNested, { flush: "post" });
/** What this member says in its place instead: the reader may not use what was chosen, or it is not available there. */
const refused = computed(() => {
  const reason = failure.value ?? nested.value?.failure.value ?? null;
  if (!reason) return null;
  if (reason instanceof PanelMemberUnavailable)
    return reason.status === 403 ? { status: "forbidden" as const } : { status: "error" as const, message: t("platform.memberUnavailable") };
  return { status: "error" as const, message: reason.message };
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
const labels = useDataStateLabels();
</script>

<template>
  <template v-if="hostMounted"></template>
  <data-state v-else-if="refused" :result="refused" :labels="labels"></data-state>
  <data-state v-else-if="awaiting" :result="{ status: 'awaiting' }" :labels="labels"></data-state>
  <p v-else-if="outsideFrame" class="sdk-panel-member-outside-frame" role="status">{{ t("platform.currentEntryOutsideFrame") }}</p>
  <div v-else-if="nested" ref="container" class="sdk-panel-member-nested"></div>
  <data-state v-else-if="!loaded" :result="{ status: 'loading' }" :labels="labels"></data-state>
  <component :is="loaded.component" v-else v-bind="bound">
    <!-- What the panel's template placed in the component's slots, drawn where the component puts each slot. -->
    <template v-for="(_, name) in $slots" #[name]="scope"><slot :name="name" v-bind="scope ?? {}"></slot></template>
  </component>
</template>
