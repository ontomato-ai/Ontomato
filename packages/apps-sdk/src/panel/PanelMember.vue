<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onErrorCaptured, onMounted, provide, ref, shallowRef, useAttrs, watch, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { DataState } from "@ontomato/foundation-ui/data-state";
import { isDomainComponentId } from "@ontomato/contracts/product-record-id";
import { projectionSlotInputsGuidance } from "@ontomato/contracts/panel-module";
import { componentFor } from "../catalogue-components";
import { panelContextKey, projectionKey, type ProjectionSlot } from "./context";
import { directPanelContext, PanelMemberUnavailable, type DirectPanelInstance, type MemberInputs } from "./direct";
import { localDraftStoreKey } from "./local-drafts";
import { memberComponentId } from "./projection-element";
import { declaredComponentProps, placementListeners } from "./projection-attrs";
import { panelMemberKey, type PanelMemberContext } from "./member";
import { hasDeclaredComponentAncestor, useFormFieldSlot, useListRowSlot } from "./slot-context";
import { useDataStateLabels } from "../base/data-state-labels";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  instance: DirectPanelInstance;
  /** The member's key in the panel's declaration. */
  member: string;
  /** Input values a slot supplies to an isolated instance of this member (a row's `{ target: ref }`). */
  inputs?: MemberInputs;
  /** Values that follow the page, given where the member is placed; a fixed value belongs in the member's config. */
  values?: Readonly<Record<string, unknown>>;
}>();

const attrs = useAttrs();

const { t } = useI18n();
const declaration = props.instance.direct.members[props.member];
if (!declaration) throw new Error(`The panel declares no member '${props.member}'`);
const listRowSlot = useListRowSlot();
if (props.inputs !== undefined && listRowSlot === null && inject(projectionKey, null) === null
  && useFormFieldSlot() === null && !hasDeclaredComponentAncestor(props.instance.direct.components)) {
  throw new Error(`Panel member '${props.member}': ${projectionSlotInputsGuidance}`);
}
/** A placement given inputs inside a slot is an instance of its own; one in the page's own template is the panel's member. */
const isScoped = props.inputs !== undefined || listRowSlot !== null;
let disposeScoped: (() => void) | undefined;
onBeforeUnmount(() => {
  disposeScoped?.();
});
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

async function loadComponentFor(member: PanelMemberContext): Promise<Component> {
  const componentId = memberComponentId(member.projection);
  const component = isDomainComponentId(componentId)
    ? await props.instance.loadDomainComponent?.(member.projection)
    : await componentFor(componentId, props.instance.readComponentPackage);
  if (!component) throw new Error(`Component '${componentId}' has no runtime for this projection`);
  return component;
}

let loadSeq = 0;

function load() {
  const seq = ++loadSeq;
  disposeScoped?.();
  disposeScoped = undefined;
  failure.value = null;
  loaded.value = null;
  nested.value = null;
  awaiting.value = false;
  outsideFrame.value = false;
  if (isScoped) {
    void props.instance.placingScoped(props.member, () => props.inputs ?? {}, listRowSlot?.itemKey.value).then(async ({ context, dispose }) => {
      if (seq !== loadSeq) {
        dispose();
        return;
      }
      disposeScoped = dispose;
      const component = await loadComponentFor(context);
      if (seq !== loadSeq) return;
      loaded.value = { component, slot: { slot: props.member, projection: context.projection, get inputs() { return context.inputs.value; } }, member: context };
    }).catch((reason: unknown) => {
      if (seq !== loadSeq) return;
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
    });
  } else {
    // The member as the instance holds it — read, registered and kept current there, drawn here.
    void props.instance.placing(props.member).then(async (placing) => {
      if (seq !== loadSeq) return;
      if (placing.kind === "awaiting") awaiting.value = true;
      else if (placing.kind === "outsideFrame") outsideFrame.value = true;
      else if (placing.kind === "panel") nested.value = placing;
      else {
        const member = placing.context;
        const component = await loadComponentFor(member);
        if (seq !== loadSeq) return;
        loaded.value = { component, slot: { slot: props.member, projection: member.projection, get inputs() { return member.inputs.value; } }, member };
      }
    }).catch((reason: unknown) => {
      if (seq !== loadSeq) return;
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
    });
  }
}
load();
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
    return reason.status === 403 ? { status: "forbidden" as const } : { status: "error" as const, message: t("platform.memberUnavailable"), retry: load };
  return { status: "error" as const, message: reason.message, retry: load };
});

provide(panelContextKey, directPanelContext(props.instance));
if (props.instance.localDrafts) provide(localDraftStoreKey, props.instance.localDrafts);
provide(projectionKey, { slot: props.member, get projection() { return loaded.value!.slot.projection; }, get inputs() { return loaded.value!.member.inputs.value; } });
provide(panelMemberKey, () => loaded.value!.member);
/**
 * What the component takes as its own props: its fixed configuration, the values that follow the page (those of this
 * placement and its declared inputs), and the panel's listeners. Any undeclared value is filtered out so it does not fall
 * through as a DOM attribute.
 */
const bound = computed(() => {
  const { component, slot, member } = loaded.value!;
  const declared = declaredComponentProps(component);
  const values = { ...slot.projection.config, ...member.inputs.value, ...props.values };
  return {
    ...Object.fromEntries(Object.entries(values).filter(([name]) => declared.has(name))),
    ...placementListeners(attrs),
  };
});
const labels = useDataStateLabels();
const innerRef = ref<{ refresh?: () => void } | null>(null);

function refresh() {
  if (typeof innerRef.value?.refresh === "function") {
    innerRef.value.refresh();
    return;
  }
  loaded.value?.member.data.refresh?.();
}

defineExpose({ refresh });
</script>

<template>
  <data-state v-if="refused" :result="refused" :labels="labels"></data-state>
  <data-state v-else-if="awaiting" :result="{ status: 'awaiting' }" :labels="labels"></data-state>
  <p v-else-if="outsideFrame" class="sdk-panel-member-outside-frame" role="status">{{ t("platform.currentEntryOutsideFrame") }}</p>
  <div v-else-if="nested" ref="container" class="sdk-panel-member-nested"></div>
  <data-state v-else-if="!loaded" :result="{ status: 'loading' }" :labels="labels"></data-state>
  <component :is="loaded.component" v-else ref="innerRef" v-bind="bound">
    <!-- What the panel's template placed in the component's slots, drawn where the component puts each slot. -->
    <template v-for="(_, name) in $slots" #[name]="scope"><slot :name="name" v-bind="scope ?? {}"></slot></template>
  </component>
</template>

<style src="./panel-member.css"></style>
