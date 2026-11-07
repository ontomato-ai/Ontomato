<script setup lang="ts">
import { computed, onMounted, provide, ref } from "vue";
import { RouterView } from "vue-router";
import { ID_INJECTION_KEY, useGetDerivedNamespace } from "element-plus";
import { useManagerContext, useManagerCounts } from "./context";
import { provideManagerFeedback } from "./feedback";
import { nextElementIdPrefix } from "./instance-id";
import ManagerConfirmDialog from "./ManagerConfirmDialog.vue";
import { managerOverlayKey } from "./overlay";
import "./theme.css";
import "./style.css";
import "./buttons.css";

/*
 * The frame around the Manager pages inside the service layout. It stays mounted while the address moves between
 * Manager pages, so messages, confirmations and the resource counts survive page changes; it unmounts when a platform
 * page opens.
 */
const context = useManagerContext();
const counts = useManagerCounts();

/*
 * Dropdowns, selects, tooltips and dialogs of the Manager pages mount in a popper container inside this frame, so they
 * keep the Manager's component styles (theme.css is scoped to .ontology-manager) and the container-query breakpoints.
 */
const idPrefix = nextElementIdPrefix();
provide(ID_INJECTION_KEY, { prefix: idPrefix, current: 0 });
const namespace = useGetDerivedNamespace();
const popperContainerId = computed(() => `${namespace.value}-popper-container-${idPrefix}`);
const overlayId = `ontology-manager-overlay-${idPrefix}`;
provide(managerOverlayKey, `#${overlayId}`);

const shell = ref<HTMLElement>();
provideManagerFeedback(shell);

// Poppers look up their container by id when mounted: render the pages once the container is in the document.
const mounted = ref(false);
onMounted(() => {
  mounted.value = true;
  counts.ensure();
});
</script>

<template>
  <div
    :class="[
      'ontology-manager',
      { 'is-dark': context.theme === 'dark', 'is-compact-dialogs': context.presentation.compactDialogs },
    ]"
  >
    <Teleport to="body">
      <div :id="overlayId" class="ontology-manager ontology-manager-shell manager-overlay-host"
        :class="{ 'is-dark': context.theme === 'dark', 'is-compact-dialogs': context.presentation.compactDialogs }"
        :style="context.presentation.themeProperties[context.theme]">
        <div :id="popperContainerId" />
      </div>
    </Teleport>
    <main ref="shell" class="ontology-manager-shell">
      <RouterView v-if="mounted" />
      <ManagerConfirmDialog />
    </main>
  </div>
</template>

<style scoped>
.ontology-manager {
  height: 100%;
  min-height: 0;
  /* Overlays, dialogs and messages of the Manager pages are positioned within this frame. */
  contain: layout;
  /* Breakpoints and cqw/cqh limits use the page area, not the viewport. */
  container: ontology-manager / size;
}

/*
 * The frame paints no background: the Manager's pages sit on the application's own area, which is the darkest band in
 * dark mode (DESIGN.md "Colour roles"). Their tables, inputs and cards keep their own surfaces.
 */
.ontology-manager-shell {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}
.manager-overlay-host {
  position: fixed;
  inset: 0;
  height: auto;
  contain: none;
  container-type: normal;
  overflow: visible;
  pointer-events: none;
}
.manager-overlay-host :deep(.el-overlay) {
  pointer-events: auto;
}
.manager-overlay-host :deep(.el-drawer) {
  max-width: calc(100vw - 32px);
}
.manager-overlay-host :deep(.el-popper) {
  pointer-events: auto;
}
</style>
