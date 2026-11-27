<script setup lang="ts">
import { computed, watch } from "vue";
import { isPanelApplication } from "@ontomato/contracts/platform-identity";
import { useApplicationCatalog } from "../catalog";
import ApplicationRoute from "./ApplicationRoute.vue";
import PanelApplicationRoute from "./PanelApplicationRoute.vue";

const props = defineProps<{ applicationId: string; panelPath: string }>();
const { applicationById, ensureApplication } = useApplicationCatalog();
const application = computed(() => applicationById(props.applicationId));
watch(
  [() => props.applicationId, () => props.panelPath],
  ([id, panelPath]) => {
    if (!panelPath && !applicationById(id)) {
      void ensureApplication(id).catch(error => console.error(error));
    }
  },
  { immediate: true },
);

</script>

<template>
  <PanelApplicationRoute
    v-if="panelPath || (application && isPanelApplication(application))"
    :application-id="applicationId"
  />
  <ApplicationRoute v-else-if="application?.kind === 'connected'" />
</template>
